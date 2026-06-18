import { readFile, writeFile, mkdir, access, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AtlasData, Repo } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const EMBEDDINGS_DIR = join(DATA_DIR, "embeddings");
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

const DATA_FILES = [
  { key: "repos" as const, file: "repos.json", url: "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/repos.json" },
  { key: "summaries" as const, file: "summaries.json", url: "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/summaries.json" },
  { key: "lists" as const, file: "lists.json", url: "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/lists.json" },
  { key: "listSummaries" as const, file: "list-summaries.json", url: "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/list-summaries.json" },
  { key: "featured" as const, file: "featured.json", url: "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/featured.json" },
  { key: "latestRelease" as const, file: "latest-release.json", url: "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/latest-release.json" },
  { key: "handbookMentions" as const, file: "handbook-mentions.json", url: "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/handbook-mentions.json" },
  { key: "reports" as const, file: "reports.json", url: "https://raw.githubusercontent.com/ksimback/hermes-ecosystem/main/data/reports.json" },
];

interface CacheMeta {
  fetchedAt: number;
}

type DataKey = 'repos' | 'summaries' | 'lists' | 'listSummaries' | 'featured' | 'latestRelease' | 'handbookMentions' | 'reports';

function cachePath(file: string): string {
  return join(DATA_DIR, file);
}

function cacheMetaPath(file: string): string {
  return join(DATA_DIR, `${file}.meta`);
}

async function isCacheFresh(file: string): Promise<boolean> {
  try {
    const meta = JSON.parse(await readFile(cacheMetaPath(file), "utf-8")) as CacheMeta;
    return Date.now() - meta.fetchedAt < CACHE_TTL;
  } catch {
    return false;
  }
}

async function markCacheFetched(file: string): Promise<void> {
  const meta: CacheMeta = { fetchedAt: Date.now() };
  await writeFile(cacheMetaPath(file), JSON.stringify(meta));
}

async function fetchRemote(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

async function loadJsonFile<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(cachePath(file), "utf-8")) as T;
}

export async function loadAtlasData(): Promise<AtlasData> {
  await mkdir(DATA_DIR, { recursive: true });

  // Try to load from local bundled data first (for offline/npm package use)
  let bundled: Partial<Record<DataKey, unknown>> = {};
  try {
    bundled.repos = JSON.parse(await readFile(join(__dirname, "..", "data", "repos.json"), "utf-8"));
    bundled.summaries = JSON.parse(await readFile(join(__dirname, "..", "data", "summaries.json"), "utf-8"));
  } catch {
    // No bundled data — will fetch from remote
  }

  const data: Record<string, unknown> = {};

  for (const { key, file, url } of DATA_FILES) {
    const cached = cachePath(file);
    const hasBundled = key in bundled;

    if (hasBundled) {
      // Use bundled data as fallback, but try to fetch fresh
      data[key] = bundled[key];
      try {
        const fresh = await fetchRemote(url);
        await writeFile(cached, fresh);
        await markCacheFetched(file);
        data[key] = JSON.parse(fresh);
      } catch {
        // Bundled data is fine
      }
    } else if (await isCacheFresh(file)) {
      data[key] = await loadJsonFile(file);
    } else {
      try {
        const fresh = await fetchRemote(url);
        await writeFile(cached, fresh);
        await markCacheFetched(file);
        data[key] = JSON.parse(fresh);
      } catch {
        // Try stale cache as last resort
        try {
          data[key] = await loadJsonFile(file);
        } catch {
          throw new Error(`No data available for ${key}. Need network access or bundled data.`);
        }
      }
    }
  }

  return data as unknown as AtlasData;
}

// Embeddings support
export async function embeddingsAvailable(): Promise<boolean> {
  try {
    await stat(join(EMBEDDINGS_DIR, "chunks.json"));
    return true;
  } catch {
    return false;
  }
}

export async function searchChunks(query: string, limit = 5): Promise<Array<{ id: string; text: string; source: string; score: number }>> {
  const chunksFile = join(EMBEDDINGS_DIR, "chunks.json");
  const raw = await readFile(chunksFile, "utf-8");
  // Parse incrementally to handle large file
  const chunks: Array<{ id: string; text: string; source: string; section?: string; metadata?: Record<string, string> }> = [];

  // Simple streaming JSON array parse — chunks.json is too large for JSON.parse
  let depth = 0;
  let inString = false;
  let escape = false;
  let current = "";
  let started = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) { escape = false; current += ch; continue; }
    if (ch === "\\" && inString) { escape = true; current += ch; continue; }
    if (ch === '"' && !inString) { inString = true; current += ch; continue; }
    if (ch === '"' && inString) { inString = false; current += ch; continue; }
    if (inString) { current += ch; continue; }

    if (ch === "[" || ch === "{") {
      if (ch === "{" && depth === 1) started = true;
      depth++;
      if (depth > 1) current += ch;
    } else if (ch === "]" || ch === "}") {
      depth--;
      if (ch === "}" && depth === 1) {
        try {
          const obj = JSON.parse(current);
          // Skip embedding array to save memory — we'll do BM25 only
          chunks.push({
            id: obj.id,
            text: obj.text,
            source: obj.source,
            section: obj.section,
            metadata: obj.metadata,
          });
        } catch {
          // skip malformed
        }
        current = "";
        started = false;
      } else if (depth > 1) {
        current += ch;
      }
    } else if (depth > 1) {
      current += ch;
    }
  }

  // BM25-like scoring: count query term matches in text
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const scored = chunks
    .map(chunk => {
      const text = chunk.text.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        const regex = new RegExp(term, "gi");
        const matches = text.match(regex);
        if (matches) score += matches.length;
      }
      // Boost official/curated sources
      if (chunk.metadata?.official === "true") score *= 1.5;
      return { ...chunk, score };
    })
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

// Helper: build slug from owner/repo
export function toSlug(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

// Simple full-text search over repos
export function searchRepos(repos: Repo[], query: string, limit = 20): Repo[] {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored = repos.map(repo => {
    const text = `${repo.name} ${repo.description} ${repo.category} ${repo.owner}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const regex = new RegExp(term, "gi");
      const matches = text.match(regex);
      if (matches) score += matches.length;
      if (repo.name.toLowerCase().includes(term)) score += 3;
      if (repo.category.toLowerCase().includes(term)) score += 2;
      if (repo.official) score *= 1.5;
    }
    return { repo, score };
  });
  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).map(s => s.repo).slice(0, limit);
}

// Get unique categories with counts
export function getCategories(repos: Repo[]): Array<{ category: string; count: number }> {
  const map = new Map<string, number>();
  for (const repo of repos) {
    map.set(repo.category, (map.get(repo.category) || 0) + 1);
  }
  return [...map.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
