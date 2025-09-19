# LLM Memory MCP Server (Memory-First)

A local-first, team-ready MCP server that provides a durable memory system for LLM-based coding workflows. It’s optimized for JavaScript/TypeScript development (web and mobile), but works for any stack. Memory items can be stored globally, locally per project, or committed to the repo for team sharing — with fast search, ranking, and per-scope tuning.

## Highlights

- Unified Memory model: snippet, pattern, config, insight, runbook, fact, note
- Scopes: global (personal), local (per-project, uncommitted), committed (project/.llm-memory)
- Fast search: BM25 scoring + boosts (scope, pin, recency) with phrase/title bonuses
- Tuning via config.json per scope (field weights, bm25, boosts)
- Atomic writes, journaling, and rebuildable index/catalog
- Secret redaction on ingestion (common API key patterns)
- MCP tools for authoring, curation, linking, and project management

## Installation

Prerequisites:
- Node.js 18+
- pnpm 9+ (install with `npm install -g pnpm`)

Setup:
```bash
git clone <repository-url>
cd llm-memory-mcp
pnpm install
pnpm run build
```

## Quick Start

1) Start the server
```bash
pnpm start
```

2) Configure in your MCP client

- Claude Code
  - Settings → Extensions → MCP Servers
  - Name: `llm-memory`
  - Command: `node`
  - Args: `["/absolute/path/to/llm-memory-mcp/dist/index.js"]`

- Cursor
  - Settings → Extensions → MCP
  - Server name: `llm-memory`
  - Command: `node`
  - Arguments: `/absolute/path/to/llm-memory-mcp/dist/index.js`

- Codex CLI
```bash
codex config set mcp.servers.llm-memory.command "node"
codex config set mcp.servers.llm-memory.args "['/absolute/path/to/llm-memory-mcp/dist/index.js']"
```

## Scopes and Storage Layout

- global: personal memory across projects (`~/.llm-memory/global`)
- local: per-project (uncommitted) memory (`~/.llm-memory/projects/<repoId>`)
- committed: shared memory committed in repo (`<project>/.llm-memory`)

On-disk layout
```
<scope-root>/
  items/              # one JSON per MemoryItem
  index/
    inverted.json     # inverted index
    lengths.json      # document lengths
    meta.json         # index metadata
  catalog.json        # id -> MemoryItemSummary
  journal.ndjson      # append-only change log
  locks/              # advisory lock files
  tmp/                # atomic write staging
  config.json         # per-scope configuration
```

Initialize committed scope in current project:
```json
{ "name": "project.initCommitted", "arguments": {} }
```

## MCP Tools

- memory.upsert — Create/update items
- memory.get — Fetch by id
- memory.delete — Delete by id
- memory.list — List summaries (scope: global|local|committed|project|all)
- memory.query — Ranked search with filters and top-k
- memory.link — Link items (refines|duplicates|depends|fixes|relates)
- memory.pin / memory.unpin — Pin/unpin for ranking
- memory.tag — Add/remove tags
- project.info — Project root, repoId, committed status
- project.initCommitted — Create `.llm-memory` in repo
- project.config.get — Read `config.json` for a scope
- project.config.set — Write `config.json` for a scope
- maintenance.rebuild — Rebuild catalog/index from items on disk

Resources
- kb://project/info — Project info + recent items
- kb://health — Minimal health/status

## Memory Item (shape)

Key fields (see `src/types/Memory.ts`):
- type: snippet | pattern | config | insight | runbook | fact | note
- scope: global | local | committed
- title, text, code, language
- facets: tags[], files[], symbols[]
- context: repoId, branch, commit, file, range, tool, etc.
- quality: confidence, reuseCount, pinned, ttlDays
- security: sensitivity (public/team/private), secretHashRefs

Recommended usage for JS/TS projects:
- Use `type: 'snippet'`, set `language: 'typescript'` or `'javascript'`.
- Attach `files` and `symbols` for better retrieval.
- Use `pattern` for recurring designs; `config` for templates; `insight`/`fact` for distilled learnings.
- Pin high-value items; store team standards in committed scope.

## Examples

Create a snippet (local scope):
```json
{
  "name": "memory.upsert",
  "arguments": {
    "type": "snippet",
    "scope": "local",
    "title": "React Error Boundary",
    "language": "typescript",
    "code": "class ErrorBoundary extends React.Component { /* ... */ }",
    "tags": ["react", "error-handling"],
    "files": ["src/components/ErrorBoundary.tsx"],
    "symbols": ["ErrorBoundary"]
  }
}
```

Query snippets/patterns for React:
```json
{
  "name": "memory.query",
  "arguments": {
    "q": "react",
    "scope": "project",
    "k": 10,
    "filters": { "type": ["snippet", "pattern"] }
  }
}
```

Pin an important pattern:
```json
{ "name": "memory.pin", "arguments": { "id": "01H..." } }
```

Link related items:
```json
{ "name": "memory.link", "arguments": { "from": "01A...", "to": "01B...", "rel": "refines" } }
```

Rebuild catalog and index for project scopes:
```json
{ "name": "maintenance.rebuild", "arguments": { "scope": "project" } }
```

## Ranking and Tuning

Search uses BM25 with configurable boosts. Tune per scope via `config.json` and `project.config.*`.

Config (subset):
```ts
interface MemoryConfig {
  version: string;
  ranking?: {
    fieldWeights?: { title?: number; text?: number; code?: number; tag?: number };
    bm25?: { k1?: number; b?: number };
    scopeBonus?: { global?: number; local?: number; committed?: number };
    pinBonus?: number;
    recency?: { halfLifeDays?: number; scale?: number };
    phrase?: { bonus?: number; exactTitleBonus?: number };
  };
}
```

Recommended defaults (JS/TS):
- fieldWeights: title=5, text=2, code=1.5, tag=3
- bm25: k1=1.5, b=0.75
- scopeBonus: committed=1.5, local=1.0, global=0.5
- pinBonus: 2
- recency: halfLifeDays=14, scale=2
- phrase: bonus=2.5, exactTitleBonus=6

Set committed-scope tuning:
```json
{
  "name": "project.config.set",
  "arguments": {
    "scope": "committed",
    "config": {
      "version": "1",
      "ranking": {
        "fieldWeights": { "title": 6, "text": 2, "code": 1.2, "tag": 3 },
        "bm25": { "k1": 1.4, "b": 0.7 },
        "scopeBonus": { "committed": 2.0, "local": 1.0, "global": 0.3 },
        "pinBonus": 3,
        "recency": { "halfLifeDays": 7, "scale": 2.5 },
        "phrase": { "bonus": 3, "exactTitleBonus": 8 }
      }
    }
  }
}
```

After changing field weights, run `maintenance.rebuild` for the affected scope to re-apply indexing weights.

## Secret Redaction

On upsert, common credential patterns are redacted from `text`/`code` and hashed into `security.secretHashRefs` to prevent leakage into committed memory.

## Development

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run typecheck
pnpm run lint
```

Manual test:
- `node test-memory-tools.js` — exercises memory.* tools via stdio

## Notes

- The previous kb.* tools were replaced by memory.* tools.
- Offline-first; no external services required.
- For teams, prefer committed scope and stricter committed config.

