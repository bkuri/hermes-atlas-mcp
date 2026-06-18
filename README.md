# 🗺️ Hermes Atlas MCP Server

**MCP server for the [Hermes Atlas](https://hermesatlas.com) ecosystem directory** — gives AI agents instant access to 169+ quality-filtered tools, skills, plugins, and integrations for [Hermes Agent](https://github.com/NousResearch/hermes-agent).

## Why?

Hermes Agent has a massive and growing ecosystem. This MCP server turns that ecosystem into **instant expandability** — agents can discover, compare, and recommend tools without leaving their conversation.

## Quick Start

Add to your MCP client config:

```json
{
  "mcpServers": {
    "hermes-atlas": {
      "command": "npx",
      "args": ["hermes-atlas-mcp"]
    }
  }
}
```

Or with Docker/stdio:

```json
{
  "mcpServers": {
    "hermes-atlas": {
      "command": "node",
      "args": ["/path/to/hermes-atlas-mcp/dist/index.js"]
    }
  }
}
```

## Tools

| Tool | Description | Example |
|------|-------------|---------|
| `search_repos` | Full-text search across 169 repos | `search_repos("memory persistence")` |
| `list_categories` | Browse 12 ecosystem categories | `list_categories()` |
| `get_repo` | Detailed repo info + AI summary | `get_repo("NousResearch/hermes-agent")` |
| `recommend` | **Match tools to your use case** | `recommend("I need to deploy on K8s")` |
| `get_featured` | Trending/rising repos this week | `get_featured()` |
| `get_lists` | Curated lists overview | `get_lists()` |
| `get_list` | Specific curated list with per-repo descriptions | `get_list("best-memory-providers")` |
| `ecosystem_stats` | Aggregate stats, category breakdown, latest version | `ecosystem_stats()` |
| `ask_atlas` | RAG over research knowledge base *(requires embeddings)* | `ask_atlas("How do skills work?")` |

## Optional: Local Embeddings

The `ask_atlas` tool provides RAG-powered answers grounded in 27 research files (6,500+ chunks) covering Hermes Agent installation, architecture, skills system, deployment, and best practices.

Install the embeddings (~70MB) separately:

```bash
npx hermes-atlas-mcp install-embeddings
# or equivalently:
npx hermes-atlas-install
```

The server auto-detects the embeddings at startup and adds the `ask_atlas` tool when available. Without embeddings, all other tools work perfectly using the summaries index.

## How It Works

```
┌────────────────────────────────────────────┐
│           hermes-atlas-mcp                │
│                                            │
│  ┌──────────┐  ┌──────────────┐           │
│  │ repos    │  │ summaries    │           │
│  │ (169)    │  │ (AI-generated│  ← bundled │
│  └────┬─────┘  │  per-repo)  │  or fetched│
│       │        └──────────────┘           │
│  ┌────┴──────────────────────┐             │
│  │ lists, featured, stats   │ ← cached    │
│  └───────────────────────────┘   (4hr TTL) │
│                                            │
│  ┌───────────────────────────┐  optional   │
│  │ chunks.json (70MB)        │ ← install   │
│  │ RAG knowledge base        │   separately│
│  └───────────────────────────┘             │
└────────────────────────────────────────────┘
          │
    stdio (MCP)
```

- **Zero-config**: Works immediately with no API keys needed
- **Offline-capable**: Bundled data works without network; fresh data fetched in background
- **Light**: Core data is ~300KB; embeddings are opt-in at 70MB
- **Fast**: Full-text search and recommendations complete in <50ms

## Data Sources

All data sourced from [ksimback/hermes-ecosystem](https://github.com/ksimback/hermes-ecosystem) — a community-curated directory security-reviewed before inclusion.

| File | Size | Content |
|------|------|---------|
| `repos.json` | 60KB | 169 repos — owner, name, description, stars, category, official flag |
| `summaries.json` | 189KB | AI-generated summaries + highlights per repo |
| `lists.json` | 2KB | 6 curated lists (best memory, top skills, deployment, etc.) |
| `list-summaries.json` | 26KB | Per-repo descriptions within each curated list |
| `featured.json` | 241B | Currently featured/trending repos |
| `latest-release.json` | 374B | Latest Hermes Agent version |
| `chunks.json` | 70MB | 6,554 research chunks with pre-computed embeddings *(optional)* |

## Development

```bash
git clone https://github.com/your-user/hermes-atlas-mcp.git
cd hermes-atlas-mcp
npm install
npm run build

# Test interactively
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | npm start

# Watch mode
npm run dev
```

## License

MIT. Data sourced from [hermes-ecosystem](https://github.com/ksimback/hermes-ecosystem) (MIT/CC BY 4.0).
