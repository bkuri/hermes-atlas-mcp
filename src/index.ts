#!/usr/bin/env node
/**
 * Hermes Atlas MCP Server
 *
 * MCP server exposing the Hermes Atlas ecosystem directory.
 * Gives AI agents instant access to the full Hermes ecosystem —
 * tools, skills, plugins, integrations, and curated rankings.
 *
 * Usage:
 *   npx hermes-atlas-mcp
 *   npx hermes-atlas-mcp install-embeddings   (optional: enable RAG)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadAtlasData, searchRepos, getCategories, toSlug, embeddingsAvailable, searchChunks } from "./data-loader.js";
import type { Repo, Summary, ListEntry } from "./types.js";

const server = new Server(
  { name: "hermes-atlas", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// Load data at startup
let atlasData: Awaited<ReturnType<typeof loadAtlasData>> | null = null;

// ─── Tool Definitions ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const hasEmbeddings = await embeddingsAvailable();

  const tools: Array<{ name: string; description: string; inputSchema: { type: "object"; properties: Record<string, { type: string; description: string } | { type: string; description: string; enum?: string[] }>; required?: string[] } }> = [
    {
      name: "search_repos",
      description: "Search the Hermes Atlas ecosystem for repos matching a query. Searches across repo names, descriptions, categories, and owners. Returns ranked results with star counts and official badges.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description: "Search query (e.g. 'memory persistence', 'cybersecurity skills', 'deployment docker')",
          },
          category: {
            type: "string",
            description: "Optional category filter (e.g. 'Skills & Skill Registries', 'Memory & Context')",
          },
          official_only: {
            type: "boolean",
            description: "Only return official Nous Research repos",
          },
          limit: {
            type: "number",
            description: "Max results to return (default: 20)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "list_categories",
      description: "List all ecosystem categories with repo counts. Useful for discovering what types of tools exist in the Hermes ecosystem.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "get_repo",
      description: "Get detailed information about a specific repo including its AI-generated summary, highlights, and category. Use owner/repo format (e.g. 'NousResearch/hermes-agent').",
      inputSchema: {
        type: "object" as const,
        properties: {
          slug: {
            type: "string",
            description: "Repo slug in owner/repo format (e.g. 'NousResearch/hermes-agent')",
          },
        },
        required: ["slug"],
      },
    },
    {
      name: "recommend",
      description: "Get personalized recommendations for Hermes ecosystem tools based on a use case description. Matches repos using AI-generated summaries and highlights. Great for answering 'what should I use for X?' questions.",
      inputSchema: {
        type: "object" as const,
        properties: {
          use_case: {
            type: "string",
            description: "Describe what you're trying to accomplish (e.g. 'I need persistent memory for my agent', 'I want to deploy Hermes on Kubernetes')",
          },
          limit: {
            type: "number",
            description: "Max recommendations (default: 10)",
          },
        },
        required: ["use_case"],
      },
    },
    {
      name: "get_featured",
      description: "Get currently featured/trending repos in the Hermes ecosystem — the best new additions and rising projects.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "get_lists",
      description: "Get curated lists (best memory providers, top skills, deployment options, etc.). Each list has a title, description, and per-repo descriptions.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "get_list",
      description: "Get a specific curated list with per-repo descriptions and recommendations.",
      inputSchema: {
        type: "object" as const,
        properties: {
          slug: {
            type: "string",
            description: "List slug (e.g. 'best-memory-providers', 'deployment-options')",
          },
        },
        required: ["slug"],
      },
    },
    {
      name: "ecosystem_stats",
      description: "Get aggregate ecosystem statistics — total repos, total stars, category breakdown, latest Hermes version.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ];

  if (hasEmbeddings) {
    tools.push({
      name: "ask_atlas",
      description: "Ask questions about Hermes Agent grounded in the Atlas research knowledge base (27 research files, 6500+ chunks). Returns source-attributed answers. Topics include installation, architecture, skills system, deployment, best practices, and community.",
      inputSchema: {
        type: "object" as const,
        properties: {
          question: {
            type: "string",
            description: "Your question about Hermes Agent (e.g. 'How does the skills system work?', 'What are the deployment options?')",
          },
          limit: {
            type: "number",
            description: "Max source chunks to return (default: 5)",
          },
        },
        required: ["question"],
      },
    });
  }

  return { tools };
});

// ─── Tool Handler ───────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!atlasData) {
    atlasData = await loadAtlasData();
  }
  const { repos, summaries, lists, listSummaries, featured, latestRelease } = atlasData;

  function formatRepo(repo: Repo): string {
    const badge = repo.official ? " ⭐ official" : "";
    return `- **[${repo.name}](${repo.url})**${badge} — ${repo.description} (⭐${repo.stars.toLocaleString()}, ${repo.category})`;
  }

  function formatRepoWithSummary(repo: Repo, summary?: Summary): string {
    let result = formatRepo(repo);
    if (summary) {
      result += `\n  ${summary.summary}`;
      if (summary.highlights?.length) {
        result += "\n  Highlights: " + summary.highlights.map(h => `• ${h}`).join(" ");
      }
    }
    return result;
  }

  switch (name) {
    // ── search_repos ──
    case "search_repos": {
      const query = args!.query as string;
      const category = args!.category as string | undefined;
      const officialOnly = args!.official_only as boolean | undefined;
      const limit = (args!.limit as number) || 20;

      let filtered = repos;
      if (category) {
        filtered = filtered.filter(r => r.category === category);
      }
      if (officialOnly) {
        filtered = filtered.filter(r => r.official);
      }

      const results = searchRepos(filtered, query, limit);

      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `No repos found matching "${query}"${category ? ` in category "${category}"` : ""}. Try a broader query or use list_categories to see what's available.` }],
        };
      }

      const text = results.map(r => formatRepo(r)).join("\n");
      return {
        content: [{ type: "text", text: `Found ${results.length} repos matching "${query}" (showing top ${Math.min(results.length, limit)}):\n\n${text}` }],
      };
    }

    // ── list_categories ──
    case "list_categories": {
      const cats = getCategories(repos);
      const text = cats.map(c => `**${c.category}** — ${c.count} repos`).join("\n");
      return {
        content: [{ type: "text", text: `Hermes Atlas has ${repos.length} repos across ${cats.length} categories:\n\n${text}` }],
      };
    }

    // ── get_repo ──
    case "get_repo": {
      const slug = args!.slug as string;
      const repo = repos.find(r => toSlug(r.owner, r.repo) === slug || r.name === slug);

      if (!repo) {
        // Try fuzzy match
        const lower = slug.toLowerCase();
        const matches = repos.filter(r => r.name.toLowerCase().includes(lower) || toSlug(r.owner, r.repo).toLowerCase().includes(lower));
        if (matches.length === 1) {
          const summary = summaries[toSlug(matches[0].owner, matches[0].repo)];
          return {
            content: [{ type: "text", text: `Assuming you meant ${toSlug(matches[0].owner, matches[0].repo)}:\n\n${formatRepoWithSummary(matches[0], summary)}` }],
          };
        } else if (matches.length > 1) {
          return {
            content: [{ type: "text", text: `Multiple matches for "${slug}". Did you mean:\n${matches.map(r => `  - ${toSlug(r.owner, r.repo)}`).join("\n")}` }],
          };
        }
        return {
          content: [{ type: "text", text: `Repo "${slug}" not found in the Hermes Atlas. Use search_repos to find it.` }],
        };
      }

      const summary = summaries[toSlug(repo.owner, repo.repo)];
      return {
        content: [{ type: "text", text: formatRepoWithSummary(repo, summary) }],
      };
    }

    // ── recommend ──
    case "recommend": {
      const useCase = args!.use_case as string;
      const limit = (args!.limit as number) || 10;

      // Search repos by use case terms
      const repoResults = searchRepos(repos, useCase, limit);

      // Also search through summaries for better semantic matching
      const summaryMatches: Array<{ repo: Repo; summary: Summary; score: number }> = [];
      for (const [slug, summary] of Object.entries(summaries)) {
        const repo = repos.find(r => toSlug(r.owner, r.repo) === slug);
        if (!repo) continue;
        const text = `${summary.summary} ${summary.highlights?.join(" ") || ""}`.toLowerCase();
        const terms = useCase.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        let score = 0;
        for (const term of terms) {
          const regex = new RegExp(term, "gi");
          const matches = text.match(regex);
          if (matches) score += matches.length;
        }
        if (repo.official) score *= 1.3;
        if (score > 0) summaryMatches.push({ repo, summary, score });
      }

      // Merge results: repo matches + summary matches, deduplicated
      const seen = new Set<string>();
      const results: Array<{ repo: Repo; summary?: Summary; score: number }> = [];

      for (const repo of repoResults) {
        const slug = toSlug(repo.owner, repo.repo);
        if (!seen.has(slug)) {
          seen.add(slug);
          results.push({ repo, summary: summaries[slug], score: Infinity });
        }
      }

      for (const match of summaryMatches.sort((a, b) => b.score - a.score)) {
        const slug = toSlug(match.repo.owner, match.repo.repo);
        if (!seen.has(slug)) {
          seen.add(slug);
          results.push({ repo: match.repo, summary: match.summary, score: match.score });
        }
      }

      const top = results.slice(0, limit);

      if (top.length === 0) {
        return {
          content: [{ type: "text", text: `No recommendations found for "${useCase}". Try rephrasing or use search_repos with broader terms.` }],
        };
      }

      const text = `Recommended tools for: "${useCase}"\n\n${top.map(({ repo, summary }) => formatRepoWithSummary(repo, summary)).join("\n\n")}`;
      return {
        content: [{ type: "text", text }],
      };
    }

    // ── get_featured ──
    case "get_featured": {
      if (featured.length === 0) {
        return {
          content: [{ type: "text", text: "No featured repos at this time." }],
        };
      }

      const entries = featured.map(f => {
        const repo = repos.find(r => toSlug(r.owner, r.repo) === f.slug);
        if (!repo) return `  - ${f.slug} (featured week of ${f.weekStart})`;
        const summary = summaries[f.slug];
        return formatRepoWithSummary(repo, summary) + ` (featured week of ${f.weekStart})`;
      });

      return {
        content: [{ type: "text", text: `⭐ Featured repos in the Hermes ecosystem:\n\n${entries.join("\n\n")}` }],
      };
    }

    // ── get_lists ──
    case "get_lists": {
      const text = lists.map((list: ListEntry) => {
        const count = Object.keys(listSummaries[list.slug]?.entries || {}).length;
        return `- **${list.title}** (\`${list.slug}\`) — ${list.description}${count > 0 ? ` (${count} repos)` : ""}`;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `📚 Curated lists in the Hermes Atlas:\n\n${text}\n\nUse get_list(slug) to get the full list with per-repo descriptions.` }],
      };
    }

    // ── get_list ──
    case "get_list": {
      const slug = args!.slug as string;
      const list = lists.find(l => l.slug === slug);

      if (!list) {
        const available = lists.map(l => `  - \`${l.slug}\`: ${l.title}`).join("\n");
        return {
          content: [{ type: "text", text: `List "${slug}" not found. Available lists:\n${available}` }],
        };
      }

      const listSummary = listSummaries[slug];
      let text = `## ${list.title}\n\n${list.description}\n\n`;

      if (listSummary?.entries) {
        text += "### Repos in this list\n\n";
        for (const [entrySlug, entryDesc] of Object.entries(listSummary.entries)) {
          const repo = repos.find(r => toSlug(r.owner, r.repo) === entrySlug);
          if (repo) {
            text += `- **[${repo.name}](${repo.url})** (⭐${repo.stars.toLocaleString()}) — ${entryDesc}\n`;
          } else {
            text += `- **${entrySlug}** — ${entryDesc}\n`;
          }
        }
      }

      return { content: [{ type: "text", text }] };
    }

    // ── ecosystem_stats ──
    case "ecosystem_stats": {
      const cats = getCategories(repos);
      const totalStars = repos.reduce((sum, r) => sum + r.stars, 0);
      const officialCount = repos.filter(r => r.official).length;
      const topRepos = [...repos].sort((a, b) => b.stars - a.stars).slice(0, 5);

      const text = [
        `📊 Hermes Atlas Ecosystem Stats`,
        ``,
        `**Total repos:** ${repos.length}`,
        `**Total stars:** ${totalStars.toLocaleString()}`,
        `**Official repos:** ${officialCount}`,
        `**Latest Hermes version:** ${latestRelease.version || "unknown"}`,
        `**Categories:** ${cats.length}`,
        ``,
        `### By category`,
        ...cats.map(c => `  - ${c.category}: ${c.count} repos`),
        ``,
        `### Top 5 by stars`,
        ...topRepos.map(r => `  - **${r.name}**: ${r.stars.toLocaleString()} ⭐${r.official ? " (official)" : ""}`),
      ].join("\n");

      return { content: [{ type: "text", text }] };
    }

    // ── ask_atlas (requires embeddings) ──
    case "ask_atlas": {
      if (!await embeddingsAvailable()) {
        return {
          content: [{ type: "text", text: "The ask_atlas tool requires local embeddings. Install them with:\n  npx hermes-atlas-mcp install-embeddings\n\nWithout embeddings, use search_repos and recommend instead — they provide excellent results using the summaries index." }],
        };
      }

      const question = args!.question as string;
      const limit = (args!.limit as number) || 5;

      const chunks = await searchChunks(question, limit);

      if (chunks.length === 0) {
        return {
          content: [{ type: "text", text: `No relevant research found for "${question}". Try rephrasing or use search_repos for tool discovery.` }],
        };
      }

      const text = [
        `📚 Atlas Knowledge Base results for: "${question}"`,
        ``,
        ...chunks.map(c => {
          const source = c.source.replace("research/", "").replace(".md", "");
          const excerpt = c.text.length > 600 ? c.text.slice(0, 600) + "..." : c.text;
          return `### Source: ${source} (score: ${c.score.toFixed(1)})\n\n${excerpt}`;
        }),
        `\n---\nFound ${chunks.length} relevant chunks. Sources: ${chunks.map(c => c.source).join(", ")}`,
      ].join("\n\n");

      return { content: [{ type: "text", text }] };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ─── Start ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Data loaded lazily on first tool call
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
