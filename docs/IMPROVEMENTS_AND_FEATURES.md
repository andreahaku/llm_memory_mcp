# LLM Memory MCP Server — Architecture, Improvements, and Feature Roadmap

This document proposes a comprehensive roadmap to turn this repository into the ultimate local and shared memory MCP server for LLM-based coding and development. It covers new features, technical improvements, and a migration path from the current “Note” model toward a richer “Memory” model that supports higher recall, better performance, and team workflows.

The proposals are designed to remain offline-first, performant, and MCP-compliant, while being practical to implement incrementally.

## Shipped To Date

- **Phase 1: Memory-First Architecture & Core Foundation** ✅ **COMPLETED**
  - Replaced legacy kb.* with memory.* tools (upsert/get/delete/list/query/link/pin/unpin/tag)
  - Added project.initCommitted, project.config.get/set, maintenance.rebuild
  - New resources: kb://project/info, kb://health, kb://context/pack
  - ULID consolidation and dead code removal (commit 084924e)

- **Phase 2: Storage, Indexing & Reliability** ✅ **COMPLETED**
  - Atomic writes for items and catalog via tmp+rename
  - Rebuildable catalog and inverted index from on-disk items
  - Inverted index with BM25 scoring (doc lengths, idf) and per-field weights
  - Secret redaction on ingestion (common API key patterns) with secretHashRefs
  - Journal-first writes; async/debounced catalog updates; startup journal replay
  - Compaction options:
    - Threshold-based (maintenance.compactEvery; default: 500)
    - Time-based (maintenance.compactIntervalMs; default: 24h)
    - Manual: maintenance.replay, maintenance.compact, maintenance.compact.now
  - Snapshots and verification:
    - Snapshot meta (lastTs + checksum) for fast tail replay
    - state-ok marker written after verified consistency
    - maintenance.snapshot to force snapshot; maintenance.verify to check snapshot/state-ok vs current
  - **Markdown Storage Backend** ✅ **COMPLETED** (PR #8, Merged 2025-10-11)
    - Human-readable markdown storage with YAML frontmatter
    - Project-based subfolder organization (_LLM_memories/<project>/)
    - Bidirectional migration support: file ↔ video ↔ markdown
    - Filename format: `<id>-<slug>.md` for stable references
    - Structured sections: frontmatter, title, description, code, context, related memories, backlinks
    - Full feature parity with file and video backends
    - Seamless Obsidian and markdown tool integration
    - Dependencies: js-yaml@^4.1.0, @types/js-yaml@^4.0.9

- **Ranking & Search Tuning** ✅ **COMPLETED**
  - Scope, pin, and recency boosts integrated into search ranking
  - Phrase bonuses and exact-title bonus layered atop BM25 for coding UX
  - Per-scope tuning via config.json: fieldWeights, bm25, scopeBonus, pinBonus, recency, phrase
  - Hybrid vector search (optional) with weighted blending:
    - ranking.hybrid { enabled, wBM25, wVec, model }
    - vectors.set / vectors.remove tools; vector store in index/vectors.hnsw
    - Bulk import vectors: vectors.importBulk and vectors.importJsonl (JSONL), with dimension enforcement
  - LRU query cache (100 entries); invalidation on writes/compaction
  - Intelligent confidence scoring with Bayesian feedback integration
  - Exponential time decay for usage and recency signals

- **Phase 3: Local Embeddings & HNSW Vector Search** ✅ **COMPLETED** (PR #9, Merged 2025-10-11)
  - Local embedding generation using transformers.js (offline, no external APIs)
  - Three embedding models with bge-small-en-v1.5 (384D) as default for code optimization
    - bge-small-en-v1.5: Code-optimized, 384D, 512 token context (DEFAULT)
    - all-MiniLM-L6-v2: Fast general text, 384D, 256 token context
    - all-mpnet-base-v2: High quality semantic, 768D, 384 token context
  - HNSW vector index with O(log n) search complexity (drop-in replacement for linear O(n) search)
  - Auto-embedding on memory upsert (configurable per scope)
  - New MCP tools:
    - embeddings.text - Generate embedding for raw text
    - embeddings.memory - Embed a single memory by ID
    - embeddings.memories - Batch embed multiple memories
    - embeddings.modelInfo - Get model information
  - Automatic index resizing when capacity exceeded
  - Proper resource management with embedder cleanup on dispose (prevents memory leaks)
  - Instance-based model management (not singleton) for better lifecycle control
  - True parallel batch embedding using Promise.all for performance
  - Hybrid search automatically enabled when embeddings configured
  - Configurable HNSW parameters: maxElements, M, efConstruction, efSearch
  - Dimension mismatch detection with actionable warnings
  - Enhanced error handling with corruption detection and clean state reset
  - **Critical Fixes** (commit 4ce6b96):
    - Fixed HNSW persistence directory creation (prevented ENOENT errors)
    - Added embedder cleanup to prevent 25-90MB memory leaks per model
    - Fixed model switching memory leak (async unload before switching)
    - Added dimension validation to prevent silent search failures
    - Implemented true parallel batch processing
    - Enhanced HNSW index loading with corruption detection

- **Context Packs for IDE Integration** ✅ **COMPLETED**
  - memory.contextPack tool and kb://context/pack resource
  - Optional snippet filters: snippetLanguages, snippetFilePatterns
  - Optional budgets: maxChars and tokenBudget (fast heuristic ~4 chars/token)
  - Symbol-aware cropping using function name or symbols when ranges unavailable
  - Windowed cropping when ranges are present
  - Per-scope section order and caps: contextPack { order, caps }
  - IDE-ready format: snippets, facts, patterns, configs, links

- **Team Workflows & Policy** ✅ **COMPLETED**
  - project.sync.status and project.sync.merge (local → committed)
  - Sensitivity gates for committed writes (public/team/private)
  - Merge-friendly committed storage with one-file-per-item
  - Append-only journal for CRDT-like conflict resolution

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

- `src/index.ts` — MCP server exposing memory.* tools, project.* tools, and resources.
- `src/MemoryManager.ts` — Orchestrates Memory storage/search/ranking, project detection, context packs.
- `src/storage/fileStore.ts` — File-based storage with journaling (append), catalog, locks, and atomic writes.
- `src/storage/Indexer.ts` — Inverted index with BM25 and document lengths; atomic persistence; rebuildable.
- `src/scope/ScopeResolver.ts` — Scope detection and directory layout.
- `src/types/Memory.ts` — Memory model, queries, context packs, config.
- Legacy note-based code remains present but is superseded by the memory-first path.
- Duplication outstanding: two ULID implementations (`src/utils/ULID.ts` and `src/util/ulid.ts`).

Observations:

- Inverted index and catalog are now rebuildable; list/search no longer scan items.
- Ranking is tunable and incorporates useful coding-centric boosts.
- Journaling, startup replay, and compaction (threshold/time-based/manual) are implemented.
- ULID duplication and some legacy types remain to be unified.

## Goals

- Rich, uniform Memory model across all scopes and tools.
- Fast, scalable reads and search with incremental indexing.
- Robust storage semantics (locking, atomicity, versioning, journaling, migrations).
- First-class team workflows via committed project memory and merge-friendly data structures.
- Superior LLM ergonomics: context packs, snippets with code ranges, links, and summarization.
- Privacy and safety: secret filtering, sensitivity classification, and optional encryption.

## Feature Improvements

### 1) Unified Memory Model ✅ **COMPLETED**
- ✅ Adopted `src/types/Memory.ts` model: `MemoryItem`, `MemoryFacets` (tags, files, symbols), `MemoryContext` (repoId, branch, file, ranges), `MemoryQuality` (confidence, reuse, pinned), `MemorySecurity` (sensitivity)
- ✅ Supports `links` between items (refines/duplicates/depends/fixes/relates) to form knowledge graphs
- ✅ Backward compatibility maintained for legacy Note tools

### 2) Hybrid Search (Full-Text + Vectors) ✅ **COMPLETED (Phase 3)**
- ✅ Pluggable search service combining BM25 full-text and vector similarity
- ✅ Local embedding generation using transformers.js (offline, no external APIs)
- ✅ HNSW vector index via `hnswlib-node` with O(log n) search complexity
- ✅ Three embedding models: bge-small-en-v1.5 (384D, default), all-MiniLM-L6-v2 (384D), all-mpnet-base-v2 (768D)
- ✅ Hybrid ranking: `score = wBM25 * bm25 + wVec * cosine + scopeBoost + recencyBoost + pinBoost + phraseBonus + titleBonus`
- ✅ Per-scope configuration in `config.json` with `embeddings` and `ranking.hybrid` sections
- ✅ Auto-embedding on memory upsert (configurable)
- ✅ New MCP tools: embeddings.text, embeddings.memory, embeddings.memories, embeddings.modelInfo
- ✅ Automatic index resizing and persistence locking for concurrent safety
- ✅ Dimension mismatch detection and warnings
- ✅ True parallel batch embedding with Promise.all

### 3) Context Packs for LLMs ✅ **COMPLETED**
- ✅ New resource/tool: `memory.contextPack` returns synthesis: snippets (with file and range), facts, configs, patterns, and relevant links
- ✅ Integrated `snippetWindow` for code cropping
- ✅ Token budget support (~4 chars/token heuristic)
- ✅ Symbol-aware cropping
- ⚠️ Optional summarization: model-friendly bullets for high-signal facts (PLANNED - Phase 4+)

### 4) Rich MCP Tools ✅ **COMPLETED**
- ✅ Query and Retrieval:
  - ✅ `memory.query` — hybrid query with filters (type/tags/files/symbols/language/time/pinned), returns items or context pack
  - ✅ `memory.get` — get item by id (superset of `kb.read`)
  - ✅ `memory.list` — fast listing via catalog with pagination and sorting
- ✅ Authoring and Curation:
  - ✅ `memory.upsert` — create or update by id
  - ✅ `memory.link` — create relation edges between items
  - ✅ `memory.pin`/`memory.unpin` — control pin state and priority
  - ✅ `memory.tag` — add/remove tags in bulk
  - ✅ `memory.delete` — delete by id with scope awareness
  - ⚠️ `memory.attach` — attach file/symbol references (PLANNED - Phase 4+)
- ✅ Project/Scope Tools:
  - ✅ `project.initCommitted` — create `.llm-memory/` with merge-friendly layout
  - ✅ `project.config.get/set` — read/write `config.json` policies
  - ✅ `project.sync.status` — show committed vs local divergence
  - ✅ `project.sync.merge` — merge local → committed with sensitivity gates
- ✅ Embedding Tools (Phase 3):
  - ✅ `embeddings.text` — generate embedding for raw text
  - ✅ `embeddings.memory` — embed single memory by ID
  - ✅ `embeddings.memories` — batch embed multiple memories
  - ✅ `embeddings.modelInfo` — get embedding model information
- ✅ Migration Tools:
  - ✅ `migration.storage_backend` — migrate between file/video/markdown backends
  - ✅ `migration.scope` — migrate between global/local/committed scopes
  - ✅ `migration.status` — check migration status and stats
  - ✅ `migration.validate` — validate migration integrity

### 5) Team Sharing & Merge Strategy ✅ **COMPLETED**
- ✅ Store committed items as one-file-per-item JSON in `items/` with flat `catalog.json` and append-only `journal.ndjson`
- ✅ CRDT-like semantics at journal level (append-only)
- ✅ Last-write-wins for fields like `updatedAt`; additive merges for `tags`, `links`
- ✅ `project.sync.merge` tool with deterministic merge for catalog and journal
- ✅ Sensitivity gates for committed scope (public/team/private)

### 6) Auto-Learning Hooks ⚠️ **PLANNED (Phase 4+)**
- ⚠️ Optional "auto-learn" policy: intercept IDE assistant events (successful fixes, accepted refactors)
- ⚠️ Materialize as `insight`/`pattern` memory items with context
- ⚠️ Git hooks integration: capture commit messages for "runbook"/"fact" items when tagged (e.g., `#kb`)

### 7) Privacy & Safety ✅ **PARTIALLY COMPLETED**
- ✅ Secret filtering on ingestion: redact common patterns (API keys, tokens)
- ✅ Store salted hashes in `secretHashRefs`
- ✅ Sensitivity tiers (`public | team | private`) gating committed scope writes
- ⚠️ Optional encryption-at-rest for global/local stores (PLANNED - Phase 4+)

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
- `vectors.set` / `vectors.remove` — Manage per-item embeddings for hybrid search.

New Resources:
- `kb://notes/recent` — Keep for compatibility.
- `kb://project/info` — Keep and expand with repoId/branch/config summary.
- `kb://health` — Status, index freshness, journal tail.
- `kb://context/pack?q=...` — Convenience URI to fetch a context pack.
  - Supports query args: scope, k, maxChars, tokenBudget, snippetLanguages, snippetFilePatterns.
  
Additional Tools:
- `vectors.importBulk` / `vectors.importJsonl` — Bulk vector import (dimension-checked)
- `maintenance.snapshot` / `maintenance.verify` — Snapshot and verify on-disk consistency
- `maintenance.compactSnapshot` — One-click compaction + snapshot

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
 - Snapshots store lastTs + checksum; state-ok records last verified checksum.

## Testing & Troubleshooting

- Local test setup
  - Prefer project-local storage and skip startup replay during tests:
    - `LLM_MEMORY_HOME_DIR="$(pwd)" LLM_MEMORY_SKIP_STARTUP_REPLAY=1 pnpm run test:all`
  - To reduce startup stalls but keep replay: `LLM_MEMORY_STARTUP_REPLAY_MS=2000`

- Vector dimension consistency
  - Bulk vector import enforces a single `dim`. If the store has a different dimension, either pass `dim` to import or clean vector files (e.g. `.llm-memory/index/vectors*.json`).

- Readiness
  - In CI or constrained environments, probe `resources/list` or `kb://health` before high-volume tool calls to ensure the server is responsive.

- Shell globs
  - Use `rm -f` or enable `NULL_GLOB` if your shell complains about missing vector/snapshot files during cleanup.

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

- Avoid scanning `items/` for list/search; rely on `catalog.json` for summaries and on `index/` for search. (Done)
- Batch journal replay and index rebuilds; persist index checkpoints. (Planned)
- Use async fs APIs and avoid blocking `execSync` in request paths; pre-detect project info at server start and refresh lazily. (Partially Done)
- Cache frequent queries (LRU) keyed by normalized query and scope. Invalidate on journal append. (Done)
- Debounced catalog and index updates to coalesce bursts of writes. (Done)

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

- Unify ULID implementation and types; remove dead/duplicate code. (Planned)
- Switch write paths to atomic temp-write + rename. (Done)
- Add a `catalog.json`-first listing path to eliminate repeated full scans. (Done)
- Add `kb://health` resource to improve troubleshooting. (Done)

## Stretch Ideas

- Learn-from-diffs: capture before/after code snippets and generate distilled insights automatically.
- On-device embedding quantization for small footprint ANN indices.
- Lightweight web UI that can be served locally from the MCP process on a random port for browsing memory.
- Language-aware tokenization for better BM25 scores (e.g., split on camelCase, snake_case, and symbols).
- Token-accurate budgeting adapters per model provider (optional, pluggable) for context packs.

## Closing

The repository already contains the building blocks for a robust Memory system (ScopeResolver, FileStore, Memory types). By wiring these into the MCP layer, adding hybrid search, and standardizing the on-disk layout with journaling and indexing, we can deliver best-in-class local and shared LLM memory that remains portable, private, and fast.
