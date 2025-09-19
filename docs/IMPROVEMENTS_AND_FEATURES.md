# LLM Memory MCP Server — Architecture, Improvements, and Feature Roadmap

This document proposes a comprehensive roadmap to turn this repository into the ultimate local and shared memory MCP server for LLM-based coding and development. It covers new features, technical improvements, and a migration path from the current “Note” model toward a richer “Memory” model that supports higher recall, better performance, and team workflows.

The proposals are designed to remain offline-first, performant, and MCP-compliant, while being practical to implement incrementally.

## Executive Summary

- Evolve from simple Notes to a typed Memory model with facets, context, links, versions, and vectors.
- Add hybrid search (BM25-style full-text + vector similarity), context packs for LLMs, and smarter ranking.
- Introduce a durable catalog and incremental inverted index to avoid O(N) scans on every query.
- Support three scopes consistently: global, local (uncommitted project), committed (shared in repo).
- Implement robust locking, atomic writes, versioned schemas, migrations, and journaling for reliability.
- Expand MCP surface: richer tools for query, linking, tagging, pinning, summary resources, and streaming.
- Add privacy and team features: secret filtering, sensitivity levels, encryption-at-rest (optional), and merge-friendly committed storage.
- Provide a clean migration path while keeping backward compatibility with existing Notes.

## Current State (Repo Review)

Key files and responsibilities:

- `src/index.ts` — MCP server exposing tools: `kb.create/read/update/delete/list/search/stats`, `project.info/init`. Uses a simple Note model with scopes: `global` | `project`.
- `src/KnowledgeManager.ts` — Orchestrates global and project stores, project detection via Git, and simple relevance scoring with title/content/tags.
- `src/storage/KnowledgeStore.ts` — File-based JSON storage for individual notes and `index.json` (summary). Uses synchronous fs APIs for writes and updates index by reading all notes each time.
- `src/types/KnowledgeBase.ts` — Simple Note schema with `note|snippet|pattern|config|fact|insight`.
- Parallel “advanced” structures not yet wired into server:
  - `src/types/Memory.ts`, `src/storage/fileStore.ts`, `src/scope/ScopeResolver.ts`, `src/paths.ts`, `src/storage/repo.ts` — A richer data model with facets, context, journaling, locks, committed/local/global scopes, and a more complete storage layout (`items/`, `index/`, `journal.ndjson`, `catalog.json`, `locks/`). These are promising building blocks but are not integrated into the running MCP server.
- Duplication to address:
  - Two ULID implementations exist: `src/utils/ULID.ts` and `src/util/ulid.ts`.
  - Two type systems: `KnowledgeBase` vs `Memory`. The server uses `KnowledgeBase`, while the advanced storage types use `Memory`.

Observations:

- Search and list operations depend on scanning many files or ad-hoc index regeneration, which will not scale for large corpora.
- Synchronous fs operations and `execSync` for Git can block the event loop.
- The “advanced” Memory layer is not connected to the MCP layer; unifying them unlocks richer features without re-inventing primitives.

## Goals

- Rich, uniform Memory model across all scopes and tools.
- Fast, scalable reads and search with incremental indexing.
- Robust storage semantics (locking, atomicity, versioning, journaling, migrations).
- First-class team workflows via committed project memory and merge-friendly data structures.
- Superior LLM ergonomics: context packs, snippets with code ranges, links, and summarization.
- Privacy and safety: secret filtering, sensitivity classification, and optional encryption.

## Feature Improvements

1) Unified Memory Model (replace/augment Notes)
- Adopt `src/types/Memory.ts` model: `MemoryItem`, `MemoryFacets` (tags, files, symbols), `MemoryContext` (repoId, branch, file, ranges), `MemoryQuality` (confidence, reuse, pinned), `MemorySecurity` (sensitivity).
- Support `links` between items (refines/duplicates/depends/fixes/relates) to form knowledge graphs.
- Keep `Note` tools operational but implement them atop MemoryItems for backward compatibility.

2) Hybrid Search (Full-Text + Vectors)
- Add a pluggable search service combining:
  - Full-text BM25-like index (e.g., lunr or a custom inverted index on `index/`).
  - Vector similarity via a local embedding provider (HNSW index via `hnswlib-node` or a pure-TS HNSW/Annoy variant). Store embeddings in `index/vectors.*` and reference by `id`.
- Hybrid ranking: `score = w_bm25 * bm25 + w_vec * cosine + scopeBoost + recencyBoost + pinBoost`.
- Provide settings in `config.json` per-scope to enable/disable vectors or tune weights.

3) Context Packs for LLMs
- New resource/tool: `memory.contextPack` that returns a synthesis: snippets (with file and range), facts, configs, patterns, and relevant links. Integrate `snippetWindow` to crop code appropriately.
- Optional summarization: produce short, model-friendly bullets for high-signal facts.

4) Rich MCP Tools
- Query and Retrieval:
  - `memory.query` — hybrid query with filters (type/tags/files/symbols/language/time/pinned), returns items or a context pack.
  - `memory.get` — get item by id (superset of `kb.read`).
  - `memory.list` — fast listing via catalog with pagination and sorting.
- Authoring and Curation:
  - `memory.upsert` — create or update by id.
  - `memory.link` — create relation edges between items.
  - `memory.pin`/`memory.unpin` — control pin state and priority.
  - `memory.tag` — add/remove tags in bulk.
  - `memory.attach` — attach file/symbol references (e.g., “src/foo.ts:42-60”).
  - `memory.delete` — delete by id with scope awareness.
- Project/Scope Tools:
  - `project.initCommitted` — create `.llm-memory/` with merge-friendly layout and standard `.gitignore`.
  - `project.config.get/set` — read/write `config.json` policies (autoLearn, sensitivity, filters, ttlDays).
  - `project.sync.status` — show committed vs local divergence for easy merges.

5) Team Sharing & Merge Strategy
- Store committed items as one-file-per-item JSON in `items/` with a flat `catalog.json` and append-only `journal.ndjson`.
- Favor CRDT-like semantics at the journal level (append-only). On merge conflicts, prefer last-write-wins for fields like `updatedAt` and additive merges for `tags`, `links`.
- Provide a simple `project.sync.merge` tool that applies a deterministic merge for catalog and journal.

6) Auto-Learning Hooks
- Optional “auto-learn” policy: intercept IDE assistant events (e.g., successful fixes, accepted refactors) and materialize them as `insight`/`pattern` memory items with context.
- Git hooks integration: capture commit messages for “runbook”/“fact” items when tagged (e.g., `#kb` in commit message).

7) Privacy & Safety
- Secret filtering on ingestion: redact/ignore lines matching common patterns (API keys, tokens) or via entropy heuristic; store salted hashes in `secretHashRefs` if needed.
- Sensitivity tiers (`public | team | private`) gating what can be written to committed scope.
- Optional encryption-at-rest for global/local stores (symmetric key in OS keychain).

8) Attachments and Symbols
- Allow items to reference code symbols and file ranges; populate via Language Server or tree-sitter where available.
- Permit binary attachments by storing files in `attachments/` and referencing them by relative URI; include MIME and size in metadata.

9) Import/Export & Backups
- Import/export NDJSON or tarball formats for portability.
- Scheduled local backups and prune by TTL or maxItems policy.

10) UI and CLI Enhancements
- Minimal TUI/CLI: `llm-mem list/search/show/pin/tag` and `llm-mem sync status/merge` for power users.
- Optional lightweight web viewer (read-only) for team browsing of committed memory.

## Technical Improvements

1) Storage and Indexing
- Integrate the richer `FileStore` + `ScopeResolver` + `paths` modules into the MCP server as the default backend.
- Maintain a durable `catalog.json` for summaries and a proper inverted index under `index/` for full-text search; avoid re-reading all items on queries.
- Implement atomic writes: write to `tmp/` then `rename()`; keep a short-lived lock during catalog/index updates.
- Journal-first updates: append to `journal.ndjson`, then update catalog/index asynchronously; recover by replaying journal on startup.

2) Concurrency and Locks
- Replace ad-hoc file locks with robust cross-process advisory locking. If staying file-based, ensure lock writes are atomic and include PID + timestamp with clear staleness policy, then always write-rename to avoid partial files.
- Ensure every write path acquires catalog/index locks, with try/finally release.

3) Async and Non-blocking IO
- Replace `execSync`, `readFileSync`, `writeFileSync` in the hot path with async equivalents (`fs.promises`) where feasible.
- Batch and debounce index updates to reduce churn during bursts.

4) Schema Versioning and Migrations
- Add `version` and `schema` fields to MemoryItem. Persist a repository-level `config.json` with `version`.
- Provide a small migration framework to upgrade from `Note` files to `MemoryItem` format in-place or on-the-fly. Keep `kb.*` tools delegating to Memory APIs.

5) Search Quality and Ranking
- Add boosts: scope (`committed > local > global` for project queries), recency decay, exact-match boosts for `title` and `tags`, and `pinned` bonus.
- Hybrid scoring with tunable weights in `config.json`.

6) Error Handling and Validation
- Centralize JSON schema definitions for all tools and validate inputs consistently.
- Map errors to MCP error codes uniformly; include remediation hints.

7) Observability and Debuggability
- Structured logs with levels and correlation IDs for requests.
- A `kb://health` resource exposing version, index status, and recent journal offsets.

8) Security Hardening
- Sanitize and canonicalize paths; never allow traversal writes.
- Strictly parse and validate all incoming JSON; reject unknown fields.

9) Packaging and Tooling
- Normalize to a single ULID implementation (choose the crypto-based monotonic variant) and remove duplicates.
- Consolidate `types` to the Memory model; move `KnowledgeBase` to a legacy adapter module.
- Enforce TypeScript strictness across the new modules; add `zod`/`ts-json-schema` for type-safe schemas if desired (no network dependency required).

## API Surface (MCP)

Backward-compatible group (implemented as thin wrappers over Memory APIs):
- `kb.create/read/update/delete/list/search/stats`

New Memory-first tools:
- `memory.upsert` — Create/update MemoryItem, including `type`, `facets`, `context`, `quality`, `security`.
- `memory.get` — Fetch by id.
- `memory.list` — List with pagination and sort (updatedAt, confidence, pinned).
- `memory.query` — Hybrid search with rich filters and `return: 'items' | 'contextPack'`.
- `memory.link` — Add relation edges.
- `memory.pin`/`memory.unpin` — Toggle pin state.
- `memory.tag` — Add/remove tags, bulk operations.
- `project.initCommitted` — Initialize committed memory structure (idempotent).
- `project.config.get` / `project.config.set` — Policy and weight tuning.
- `project.sync.status` / `project.sync.merge` — Team workflows.

New Resources:
- `kb://notes/recent` — Keep for compatibility.
- `kb://project/info` — Keep and expand with repoId/branch/config summary.
- `kb://health` — Status, index freshness, journal tail.
- `kb://context/pack?q=...` — Convenience URI to fetch a context pack.

## Storage Layout (Committed/Local/Global)

Proposed standard layout (already partially present in `ScopeResolver` and `FileStore`):

```
<scope-root>/
  items/              # one JSON per MemoryItem
  index/              # inverted index shards, vector index shards
  catalog.json        # id -> MemoryItemSummary
  journal.ndjson      # append-only change log
  locks/              # lock files (advisory)
  tmp/                # atomic write staging
  config.json         # policies and search weights
```

Notes:
- `catalog.json` enables O(1) summary listing and cheap filtering (type/scope/pinned) before reading full items.
- `index/` stores token -> posting lists (and optional vector ANN index). Rebuilds are possible by replaying `journal.ndjson`.

## Migration Plan

Phase 1: Prepare and Integrate Backend
- Adopt `ScopeResolver` and `FileStore` as the storage backend for new Memory APIs.
- Choose one ULID implementation and remove the duplicate.
- Add `catalog.json` population where missing and keep `KnowledgeStore` operational.

Phase 2: Dual-Write and Adapters
- Implement Memory APIs in parallel. Update `kb.*` handlers to dual-write: create MemoryItem plus a legacy Note file for compatibility, or store a shim/marker that points to MemoryItem.
- Provide an offline migration command to up-convert existing `Note` files to `MemoryItem` and update catalog/index.

Phase 3: Hybrid Search
- Introduce inverted index building and use it for `kb.search` without changing the tool contract.
- Add `memory.query` with hybrid ranking and optional vector similarity.

Phase 4: Team and Privacy Features
- Add `project.initCommitted`, `project.config.*`, and `project.sync.*` tools.
- Implement sensitivity gates and secret filtering, and enforce them during writes to committed scope.

Phase 5: Context Packs and Ergonomics
- Implement `memory.contextPack` (resource + tool) for LLMs; ship example prompts and client snippets.

Phase 6: Deprecate Legacy Surfaces
- After one or two releases, mark `KnowledgeBase` types as legacy; keep the tools but back them with Memory.

## Performance Considerations

- Avoid scanning `items/` for list/search; rely on `catalog.json` for summaries and on `index/` for search.
- Batch journal replay and index rebuilds; persist index checkpoints.
- Use async fs APIs and avoid blocking `execSync` in request paths; pre-detect project info at server start and refresh lazily.
- Cache frequent queries (LRU) keyed by normalized query and scope. Invalidate on journal append.

## Testing Strategy

- Keep existing test scripts; add focused unit tests for:
  - Catalog operations, journal append/replay, and lock contention.
  - Inverted index build and incremental updates; correctness of tokenization and filters.
  - Hybrid ranking math and weight application.
  - Migration of Note -> MemoryItem, including idempotency.
- Consider adding `vitest` for speed and TS friendliness; keep tests hermetic (no network).

## Risks and Mitigations

- Data corruption on crash: mitigate with atomic write-rename, journal-first updates, and index rebuild from journal.
- Merge conflicts on committed memory: mitigate with structured per-item JSON, append-only journals, and deterministic merge rules.
- Index bloat: shard `index/` and periodically compact by replaying journal.

## Quick Wins (Low Effort, High Impact)

- Unify ULID implementation and types; remove dead/duplicate code.
- Switch write paths to atomic temp-write + rename.
- Add a `catalog.json`-first listing path to eliminate repeated full scans.
- Add `kb://health` resource to improve troubleshooting.

## Stretch Ideas

- Learn-from-diffs: capture before/after code snippets and generate distilled insights automatically.
- On-device embedding quantization for small footprint ANN indices.
- Lightweight web UI that can be served locally from the MCP process on a random port for browsing memory.
- Language-aware tokenization for better BM25 scores (e.g., split on camelCase, snake_case, and symbols).

## Closing

The repository already contains the building blocks for a robust Memory system (ScopeResolver, FileStore, Memory types). By wiring these into the MCP layer, adding hybrid search, and standardizing the on-disk layout with journaling and indexing, we can deliver best-in-class local and shared LLM memory that remains portable, private, and fast.

