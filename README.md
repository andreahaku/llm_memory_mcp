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
- memory.contextPack — IDE-ready context pack (see Context Packs below)
- memory.link — Link items (refines|duplicates|depends|fixes|relates)
- memory.pin / memory.unpin — Pin/unpin for ranking
- memory.tag — Add/remove tags
- vectors.set — Set/update an item embedding (for hybrid search)
- vectors.remove — Remove an item embedding
- vectors.importBulk — Bulk import vectors (same dimension enforced)
- vectors.importJsonl — Bulk import vectors from JSONL file; optional dim override
- project.info — Project root, repoId, committed status
- project.initCommitted — Create `.llm-memory` in repo
- project.config.get — Read `config.json` for a scope
- project.config.set — Write `config.json` for a scope
- maintenance.rebuild — Rebuild catalog/index from items on disk
- maintenance.replay — Replay journal; optional compaction
- maintenance.compact — Compact journal
- maintenance.compact.now — Trigger immediate compaction
- maintenance.compactSnapshot — One-click compaction + snapshot
- maintenance.snapshot — Write snapshot meta (lastTs + checksum)
- maintenance.verify — Verify current checksum vs snapshot and state-ok markers

Resources
- kb://project/info — Project info + recent items
- kb://health — Minimal health/status
- kb://context/pack — Build a context pack; supports URI query args

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
    hybrid?: { enabled?: boolean; wBM25?: number; wVec?: number; model?: string };
  };
  contextPack?: {
    order?: Array<'snippets'|'facts'|'patterns'|'configs'>;
    caps?: { snippets?: number; facts?: number; patterns?: number; configs?: number };
  };
  maintenance?: {
    compactEvery?: number;          // compact after N journal appends (default: 500)
    compactIntervalMs?: number;     // time-based compaction (default: 24h)
    snapshotIntervalMs?: number;    // time-based snapshot (default: 24h)
    indexFlush?: { maxOps?: number; maxMs?: number }; // index scheduler flush thresholds
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
        "phrase": { "bonus": 3, "exactTitleBonus": 8 },
        "hybrid": { "enabled": true, "wBM25": 0.7, "wVec": 0.3, "model": "local-emb" }
      }
    }
  }
}
```

After changing field weights, run `maintenance.rebuild` for the affected scope to re-apply indexing weights.

## Hybrid Vector Search

Enable hybrid search via config (per scope) and provide vectors for items and query:

1) Enable hybrid and set weights:
```json
{ "name": "project.config.set", "arguments": { "scope": "committed", "config": { "version": "1", "ranking": { "hybrid": { "enabled": true, "wBM25": 0.7, "wVec": 0.3, "model": "local-emb" } } } } }
```

2) Set an item vector:
```json
{ "name": "vectors.set", "arguments": { "scope": "local", "id": "01ABC...", "vector": [0.1, -0.2, 0.05, ...] } }
```

3) Query with a query embedding:
```json
{ "name": "memory.query", "arguments": { "q": "authentication flow", "scope": "project", "k": 20, "vector": [/* query embedding */], "filters": { "type": ["snippet", "pattern"] } } }
```

The server blends BM25 and cosine scores per configured weights, then applies boosts and phrase/title bonuses.

Bulk vector import (JSONL)
- Prepare a JSONL file where each line is: {"id":"01ABC...","vector":[0.1,-0.2,0.05,...]}
- Import with optional dimension override:
```json
{ "name": "vectors.importJsonl", "arguments": { "scope": "local", "path": "/abs/path/vectors.jsonl", "dim": 768 } }
```
Or pass items inline:
```json
{ "name": "vectors.importBulk", "arguments": { "scope": "local", "items": [{"id":"01A","vector":[0.1,0.2]},{"id":"01B","vector":[0.0,0.3]}] } }
```

## Context Packs

Build an IDE-ready pack of code snippets, facts, configs, and patterns, tuned for JS/TS:

- Tool: `memory.contextPack`
- Resource: `kb://context/pack`
- Useful args:
  - q, scope, k
  - filters (types/tags/language/files)
  - snippetWindow { before, after }
  - snippetLanguages: ["typescript","tsx","javascript"]
  - snippetFilePatterns: ["src/**/*.ts","src/**/*.tsx"]
  - tokenBudget (approx tokens; ~4 chars/token heuristic) or maxChars

Example:
```json
{ "name": "memory.contextPack", "arguments": { "q": "react hooks", "scope": "project", "k": 12, "tokenBudget": 2000, "snippetLanguages": ["typescript","tsx"], "snippetFilePatterns": ["src/**/*.ts","src/**/*.tsx"] } }
```

URI form:
```
kb://context/pack?q=react%20hooks&scope=project&k=12&tokenBudget=2000&snippetLanguages=typescript,tsx&snippetFilePatterns=src/**/*.ts,src/**/*.tsx
```

Per-scope order/caps are configurable in config.json under `contextPack`.

## Maintenance & Compaction

- Threshold-based compaction: set `maintenance.compactEvery` (default 500). Triggers compaction after N journal appends.
- Time-based compaction: set `maintenance.compactIntervalMs` (default 24h).
- Manual controls:
  - `maintenance.replay` — replay journal; optional compact
  - `maintenance.compact` — compact scope(s)
  - `maintenance.compact.now` — immediate compaction
  - `maintenance.compactSnapshot` — compaction + snapshot in one step
  - `maintenance.snapshot` — write snapshot meta (for fast tail replay)
  - `maintenance.verify` — recompute checksum and compare to snapshot/state-ok

State-ok markers
- After successful compaction and startup tail replay, the server writes `index/state-ok.json` containing the last verified checksum and timestamp.
- `maintenance.verify` reports whether current checksum matches both snapshot and state-ok markers.

## Secret Redaction

On upsert, common credential patterns are redacted from `text`/`code` and hashed into `security.secretHashRefs` to prevent leakage into committed memory.

## Development

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm run test:all         # end-to-end tool tests
pnpm run simulate:user    # simulated JS/TS flow
```

Manual test:
- `node test-memory-tools.js` — exercises memory.* tools via stdio

## Notes

- The previous kb.* tools were replaced by memory.* tools.
- Offline-first; no external services required.
- For teams, prefer committed scope and stricter committed config.

## Recipes (JS/TS Workflows)

- Save a reusable TypeScript pattern to committed scope
```json
{ "name": "memory.upsert", "arguments": {
  "type": "pattern",
  "scope": "committed",
  "title": "React Error Boundary",
  "language": "typescript",
  "text": "Wrap subtree with an error boundary component; log and render fallback UI.",
  "code": "class ErrorBoundary extends React.Component { /* ... */ }",
  "tags": ["react","error-handling","ts"],
  "files": ["src/components/ErrorBoundary.tsx"],
  "symbols": ["ErrorBoundary"]
} }
```

- Search by tag across project (local + committed)
```json
{ "name": "memory.query", "arguments": {
  "scope": "project",
  "k": 20,
  "filters": { "tags": ["react"] }
} }
```

- Build a context pack focused on src/utils and TS/TSX
```json
{ "name": "memory.contextPack", "arguments": {
  "q": "debounce util",
  "scope": "project",
  "k": 12,
  "tokenBudget": 1800,
  "snippetLanguages": ["typescript","tsx"],
  "snippetFilePatterns": ["src/utils/**/*.ts","src/utils/**/*.tsx"]
} }
```

- Pin a frequently used runbook
```json
{ "name": "memory.pin", "arguments": { "id": "01H..." } }
```

- Merge local → committed (team share) and check status
```json
{ "name": "project.sync.status", "arguments": {} }
```
```json
{ "name": "project.sync.merge", "arguments": {} }
```

- Guard committed scope by sensitivity (team only)
```json
{ "name": "project.config.set", "arguments": {
  "scope": "committed",
  "config": { "version": "1", "sharing": { "enabled": true, "sensitivity": "team" } }
} }
```

- Enable hybrid search and set vectors (example)
```json
{ "name": "project.config.set", "arguments": {
  "scope": "local",
  "config": { "version": "1", "ranking": { "hybrid": { "enabled": true, "wBM25": 0.7, "wVec": 0.3 } } }
} }
```
```json
{ "name": "vectors.set", "arguments": { "scope": "local", "id": "01ABC...", "vector": [0.1, -0.2, 0.05] } }
```
```json
{ "name": "memory.query", "arguments": { "q": "auth flow", "scope": "project", "k": 20, "vector": [0.08, -0.15, 0.02] } }
```

- Compact journals when needed
```json
{ "name": "maintenance.compact.now", "arguments": { "scope": "project" } }
```

- One-click compact + snapshot
```json
{ "name": "maintenance.compactSnapshot", "arguments": { "scope": "all" } }
```

- Verify on-disk state vs snapshot/state-ok
```json
{ "name": "maintenance.verify", "arguments": { "scope": "project" } }
```
