# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LLM Memory MCP Server is a production-ready, local-first memory system for AI coding tools with revolutionary video-based storage compression. Achieves 50-100x compression ratios through QR code encoding + video compression (H.264/H.265) while maintaining sub-100ms search performance. Features dual storage architecture (file/video) with automatic backend detection, intelligent confidence scoring, and optimized BM25 search with vector similarity support.

**Key Innovation**: Video storage uses QR code frames compressed into MP4 files with binary frame indexing (.mvi), enabling 95% storage reduction while preserving instant search capabilities.

## Development Commands

### Essential Commands
```bash
# Install (pnpm enforced by preinstall hook)
pnpm install

# Development with hot reload
pnpm run dev

# Build TypeScript to dist/
pnpm run build

# Type checking (pre-commit requirement)
pnpm run typecheck

# Linting (pre-commit requirement)
pnpm run lint

# Run test suite
pnpm test
```

### Testing & Validation
```bash
# Comprehensive tool testing
pnpm run test:all

# Storage parity validation (file vs video)
pnpm run test:parity

# Performance benchmarks
pnpm run test:performance

# Search parity validation
pnpm run test:search

# Migration validation
pnpm run test:migration

# User flow simulation
pnpm run simulate:user

# Frame indexing validation
pnpm run test:frame-indexing

# Full validation suite
pnpm run validate:parity
```

### Storage Migration Commands
```bash
# Migrate between file and video storage
pnpm run migrate:storage

# Migrate between scopes (global/local/committed)
pnpm run migrate:scope

# Check migration status
pnpm run migrate:status

# Validate migration integrity
pnpm run migrate:validate
```

### Performance Testing
```bash
# Full performance benchmark (20 iterations)
pnpm run benchmark:full

# Fast benchmark (3 iterations, single encoder)
pnpm run benchmark:fast

# Standard benchmark
pnpm run benchmark
```

## Architecture Overview

### Dual Storage Architecture

**File Storage Adapter** (`src/storage/FileStorageAdapter.ts`)
- Traditional JSON file storage with optimized journaling
- 81-95% journal compression via SHA-256 content hashing
- Atomic writes with staging directory (`tmp/`)
- Automatic migration from legacy journals

**Video Storage Adapter** (`src/storage/VideoStorageAdapter.ts`)
- Revolutionary QR code + video compression pipeline
- Content → QR encoding → Video frames → H.264/H.265 compression
- Binary frame index (.mvi) for O(1) frame lookup
- Multi-tier caching: payload cache (78-85% hit rate), frame cache (68-74% hit rate)
- SHA-256 content deduplication
- 50-100x compression ratios (code: 47-62x, docs: 53-71x, JSON: 78-94x)

**Storage Adapter Interface** (`src/storage/StorageAdapter.ts`)
- Unified interface for pluggable storage backends
- Enables seamless switching between file and video storage
- Transaction support for atomic operations
- Content-addressed payload references

### Core Components

**MCP Server** (`src/index.ts`)
- `LLMKnowledgeBaseServer`: Main MCP server with 40+ tools
- Memory operations: upsert, query, delete, link, pin, tag, feedback
- Project management: init, config, sync
- Maintenance: rebuild, compact, snapshot, verify
- Migration: storage backend switching, scope migration, validation
- Video capabilities checking on startup with FFmpeg detection

**Memory Manager** (`src/MemoryManager.ts`)
- Central orchestrator for memory operations across all scopes
- BM25 search with configurable field weights and boosts
- Intelligent confidence scoring with time decay and feedback loops
- Vector similarity search (hybrid mode)
- Context pack generation for IDE integration
- Lazy storage adapter initialization per scope
- Query caching (LRU, 100 entries)
- Automatic index scheduling (flush thresholds: ops/time-based)
- Compaction intervals per scope with configurable thresholds

**Migration Manager** (`src/migration/MigrationManager.ts`)
- Storage backend migration (file ↔ video) with zero downtime
- Scope migration (global/local/committed) with content filtering
- Integrity validation and automatic rollback on failure
- Progress callbacks and dry-run support
- Backup creation before migration

**Scope Resolver** (`src/scope/ScopeResolver.ts`)
- Git repository detection (`git rev-parse --show-toplevel`)
- Stable project ID generation (git root + remote URL hash)
- Automatic scope determination (global/local/committed)

### Storage Layout

**File Backend Structure**:
```
<scope-root>/
  items/              # one JSON file per MemoryItem
  index/
    inverted.json     # BM25 inverted index
    vectors.bin       # vector embeddings (optional)
    meta.json         # index metadata
    state-ok.json     # integrity verification marker
  catalog.json        # id → MemoryItemSummary lookup
  journal-optimized.ndjson  # optimized journal (SHA-256 hashes)
  journal.ndjson.backup     # legacy journal backup
  locks/              # advisory file locks
  tmp/                # atomic write staging
  config.json         # per-scope configuration
  snapshot-meta.json  # compaction checkpoint
```

**Video Backend Structure**:
```
<scope-root>/
  segments/
    consolidated.mp4        # QR-encoded content as video
    consolidated.mvi        # binary frame index
    consolidated-index.json # frame metadata
  index/
    inverted.json          # BM25 search index
    vectors.bin            # vector embeddings (optional)
    meta.json              # index metadata
  catalog.json             # id → summary with frame references
  tmp/                     # atomic write staging
  config.json              # storage backend config
  snapshot-meta.json       # integrity metadata
```

### Video Storage Pipeline

**QR Encoding** (`src/qr/QRManager.ts`)
- Text → QR code matrix with error correction (L/M/Q/H levels)
- Uses `qrcode-generator` library for encoding
- Configurable error correction based on content importance

**QR Decoding** (`src/qr/QRDecoder.ts`)
- PNG frame → QR code detection and decoding
- Uses `zxing-wasm` for high-performance WASM-based decoding
- 99.7% decode success rate in benchmarks

**Video Encoding**:
- **Native Encoder** (`src/video/NativeEncoder.ts`): FFmpeg native (200-600 fps)
- **WASM Encoder** (`src/video/WasmEncoder.ts`): FFmpeg.wasm fallback (10-40 fps)
- Automatic encoder selection based on availability
- Configurable CRF (18-28), preset (fast/medium/slow), codec (h264/h265)

**Frame Management**:
- **Frame Index** (`src/video/FrameIndex.ts`): Basic frame mapping
- **Enhanced Frame Index** (`src/video/EnhancedFrameIndex.ts`): Performance-optimized with caching
- **Frame Extractor** (`src/video/FrameExtractor.ts`): FFmpeg frame extraction
- **Video Segment Manager** (`src/video/VideoSegmentManager.ts`): Segment lifecycle management

**Video Utilities** (`src/video/utils.ts`)
- FFmpeg capability detection (native vs WASM)
- Optimal encoder selection based on environment
- Video validation and integrity checking

### Search Architecture

**BM25 Indexer** (`src/storage/Indexer.ts`)
- Inverted index with TF-IDF scoring
- Document length normalization (b parameter)
- Configurable field weights (title, text, code, tags)
- Phrase detection and exact match bonuses
- Automatic index rebuilding on schema changes

**Vector Index** (`src/storage/VectorIndex.ts`)
- Cosine similarity search for semantic matching
- Dimension consistency enforcement
- Bulk import from JSONL
- Hybrid search: weighted blend of BM25 + vector scores

**Confidence Scoring**:
- Bayesian feedback integration (helpful/not helpful votes)
- Exponential time decay (14-day usage half-life, 7-day recency half-life)
- Context matching (repo, file, tool, tags/symbols)
- Pin priority (floor boost + multiplier)
- Configurable weights per scope

### Memory Types and Structure

**Types**: `snippet` (code), `pattern` (design), `config` (template), `insight` (learning), `runbook` (procedure), `fact` (knowledge), `note` (general)

**Scopes**: `global` (personal, `~/.llm-memory/global/`), `local` (per-project uncommitted, `~/.llm-memory/projects/<hash>/`), `committed` (team-shared, `<project>/.llm-memory/`)

**MemoryItem Structure** (`src/types/Memory.ts`):
```typescript
interface MemoryItem {
  id: string;                    // ULID
  type: MemoryType;
  scope: MemoryScope;
  title?: string;
  text?: string;                 // description/documentation
  code?: string;                 // code content
  language?: string;             // e.g., 'typescript', 'javascript'
  facets: {
    tags: string[];              // categorical labels
    files: string[];             // related file paths
    symbols: string[];           // function/class names
  };
  context: {
    repoId?: string;             // project identifier
    branch?: string;
    commit?: string;
    tool?: string;               // originating tool
    file?: string;               // primary file
    range?: { start: number; end: number };
  };
  quality: {
    confidence: number;          // 0..1, computed from feedback/usage
    reuseCount: number;
    pinned?: boolean;            // priority boost
    ttlDays?: number;            // auto-expiry
    helpfulCount?: number;       // positive feedback
    notHelpfulCount?: number;    // negative feedback
    decayedUsage?: number;       // exponentially decayed usage
    lastAccessedAt?: string;
    lastUsedAt?: string;
    lastFeedbackAt?: string;
  };
  security: {
    sensitivity: 'public' | 'team' | 'private';
    secretHashRefs?: string[];   // redacted secret hashes
  };
  links?: MemoryLink[];          // cross-references
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

## Key Implementation Details

### FFmpeg Auto-Detection

On startup, the server checks for FFmpeg capabilities:
1. **Native FFmpeg**: Check system PATH with `ffmpeg -version`
2. **WASM FFmpeg**: Check `@ffmpeg/ffmpeg` module availability
3. **Fallback**: Use file storage if neither available

Status logged at startup with emoji indicators (✅/❌).

### Storage Backend Selection

Automatic backend selection priority:
1. Check `config.json` `storage.backend` setting
2. Detect FFmpeg capabilities (native > WASM)
3. Fall back to file storage

Manual override via `project.config.set` tool with `storage.backend: 'video'` or `'file'`.

### Migration Process

**Storage Backend Migration**:
1. Read all items from source backend
2. Initialize target backend storage
3. Write items to target with integrity validation
4. Optional backup before migration
5. Atomic switch to target backend
6. Refresh MemoryManager's storage adapter

**Scope Migration**:
1. Query source scope with optional content filters
2. Transform items for target scope (update repoId, sensitivity)
3. Write to target storage (file or video)
4. Validate item counts and content integrity
5. Optional dry-run preview

### Confidence Scoring Algorithm

```typescript
confidence = Σ(weight_i × score_i) for i in [feedback, usage, recency, context, base]

feedback_score = (helpfulCount + priorAlpha) / (totalFeedback + priorAlpha + priorBeta)
usage_score = 1 - exp(-decayedUsage / usageSaturationK)
recency_score = exp(-daysSinceAccess / recencyHalfLifeDays)
context_score = weighted_match(repoId, file, tool, tags)
base_score = basePrior (default 0.5)

if (pinned) confidence = max(confidence, pin.floor) × pin.multiplier
```

Time decay applied exponentially with configurable half-lives.

### Optimized Journal System

**Hash-Based Integrity**:
- Store SHA-256(JSON.stringify(item)) instead of full item
- 81-95% storage reduction
- Backward compatible with legacy journals
- Automatic migration on startup
- Integrity verification via `journal.verify` tool

**Journal Operations**:
- `journal.stats`: Get optimization status and size reduction
- `journal.migrate`: Convert legacy → optimized format
- `journal.verify`: Validate integrity using hashes

### Search Query Flow

1. Parse query text and extract phrases (quoted strings)
2. Compute BM25 scores across configured fields (title, text, code, tags)
3. Apply field weights from config (e.g., title=5, text=2, code=1.5, tag=3)
4. Compute vector similarity (if hybrid mode enabled)
5. Blend BM25 + vector scores: `wBM25 × bm25_score + wVec × vec_score`
6. Apply relevance boosts:
   - Scope bonus (committed > local > global)
   - Pin bonus (pinned items)
   - Recency bonus (exponential decay)
   - Phrase bonus (exact phrase matches)
   - Title match bonus (query in title)
7. Sort by final score descending
8. Return top-k results with metadata

### Context Pack Generation

IDE-ready memory packs with configurable ordering and caps:
- Snippets: code blocks with syntax highlighting hints
- Facts: distilled knowledge
- Patterns: architectural designs
- Configs: configuration templates

Supports token budgets (~4 chars/token heuristic) or max character limits.

## Configuration

### TypeScript Configuration
- Target: ES2022 with NodeNext module resolution
- Strict mode enabled with full type checking
- Output to `dist/` with source maps and declarations
- Exclude: node_modules, dist, test files, CLI tools

### Package Requirements
- **MUST use pnpm** (enforced by preinstall hook)
- Node.js 18+ required
- pnpm 9+ required
- ESM modules with `.js` imports in TypeScript

### Per-Scope Configuration (`config.json`)

```typescript
interface MemoryConfig {
  version: string;
  ranking?: {
    fieldWeights?: {
      title?: number;    // default: 5
      text?: number;     // default: 2
      code?: number;     // default: 1.5
      tag?: number;      // default: 3
    };
    bm25?: {
      k1?: number;       // default: 1.5 (term frequency saturation)
      b?: number;        // default: 0.75 (length normalization)
    };
    scopeBonus?: {
      global?: number;   // default: 0.5
      local?: number;    // default: 1.0
      committed?: number; // default: 1.5
    };
    pinBonus?: number;   // default: 2
    recency?: {
      halfLifeDays?: number;  // default: 14
      scale?: number;         // default: 2
    };
    phrase?: {
      bonus?: number;           // default: 2.5
      exactTitleBonus?: number; // default: 6
    };
    hybrid?: {
      enabled?: boolean;  // default: false
      wBM25?: number;     // default: 0.7
      wVec?: number;      // default: 0.3
      model?: string;     // embedding model identifier
    };
  };
  confidence?: {
    priorAlpha?: number;        // default: 1
    priorBeta?: number;         // default: 1
    basePrior?: number;         // default: 0.5
    usageHalfLifeDays?: number; // default: 14
    recencyHalfLifeDays?: number; // default: 7
    usageSaturationK?: number;  // default: 5
    weights?: {
      feedback?: number;  // default: 0.35
      usage?: number;     // default: 0.25
      recency?: number;   // default: 0.20
      context?: number;   // default: 0.15
      base?: number;      // default: 0.05
    };
    pin?: {
      floor?: number;      // default: 0.8
      multiplier?: number; // default: 1.05
    };
  };
  storage?: {
    backend?: 'auto' | 'file' | 'video';  // default: 'auto'
    videoOptions?: {
      codec?: 'h264' | 'h265';  // default: 'h264'
      crf?: number;             // 18-28, default: 26
      preset?: 'fast' | 'medium' | 'slow';  // default: 'medium'
      errorCorrection?: 'L' | 'M' | 'Q' | 'H';  // default: 'M'
    };
  };
  maintenance?: {
    compactEvery?: number;       // default: 500 journal entries
    compactIntervalMs?: number;  // default: 86400000 (24h)
    snapshotIntervalMs?: number; // default: 86400000 (24h)
    indexFlush?: {
      maxOps?: number;  // default: 100
      maxMs?: number;   // default: 5000
    };
  };
}
```

## Development Guidelines

### Import Patterns
Always use `.js` extensions (TypeScript ESM requirement):
```typescript
import { MemoryManager } from './MemoryManager.js';
import type { MemoryItem } from './types/Memory.js';
import { ulid } from './util/ulid.js';
```

### Storage Adapter Usage
When adding features that interact with storage:
```typescript
// Get adapter for scope (lazy initialization)
const adapter = await this.getStorageAdapter(scope);

// Write item with atomic staging
await adapter.writeItem(item);

// Batch operations when available
if (adapter.writeBatch) {
  await adapter.writeBatch(items);
}

// Check backend capabilities
const supportsVideo = adapter.hasContent !== undefined;
```

### Error Handling
Use MCP error codes for client-facing errors:
```typescript
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

try {
  // operation
} catch (error) {
  throw new McpError(
    ErrorCode.InternalError,
    `Operation failed: ${error.message}`
  );
}
```

### Migration Tool Integration
For features requiring backend switching:
```typescript
// Check if migration manager is available
const mgr = await this.initializeMigrationManager();
if (!mgr) {
  throw new McpError(
    ErrorCode.InvalidRequest,
    'Migration tools unavailable (FFmpeg not installed)'
  );
}

// Perform migration with progress callbacks
const result = await mgr.migrateStorageBackend({
  sourceBackend: 'file',
  targetBackend: 'video',
  scope: 'local',
  onProgress: (progress) => log(`Progress: ${progress.itemsProcessed}/${progress.totalItems}`)
});

// Refresh storage adapter after successful migration
if (result.success) {
  this.memory.refreshStorageAdapter(scope);
}
```

### Testing Storage Backends
Run parity tests to ensure file and video storage produce identical results:
```bash
pnpm run test:parity        # CRUD operations
pnpm run test:search        # Search parity
pnpm run test:migration     # Migration integrity
pnpm run test:performance   # Benchmark both backends
```

### Video Storage Best Practices
- Install native FFmpeg for optimal performance (200-600 fps vs 10-40 fps WASM)
- Use H.265 for 30% better compression vs H.264 (at cost of encoding speed)
- Configure error correction based on content importance (L=7%, M=15%, Q=25%, H=30%)
- Monitor cache hit rates via `migration.status` tool
- Run `migration.validate` after backend switches
- Keep QR decode success rate >99% (check logs)

### Secret Redaction
Always redact user content before storage:
```typescript
import { redactSecrets } from './utils/secretFilter.js';
const safeText = redactSecrets(item.text || '');
const safeCode = redactSecrets(item.code || '');
```

### Confidence Scoring Integration
Update confidence after user interactions:
```typescript
// Record positive feedback
this.memory.addFeedback(item, helpful=true, new Date());

// Record usage event
this.memory.recordAccess(item, 'use', new Date());

// Confidence automatically recomputed on next query
```

### Performance Considerations
- Use query cache for repeated searches (LRU cache, 100 entries)
- Batch index updates with scheduled flush (default: 100 ops or 5s)
- Enable hybrid search only when vector embeddings available
- Set compaction thresholds based on write volume (default: 500 entries or 24h)
- Profile with `pnpm run benchmark` to measure impact of changes

## Common Development Tasks

### Adding a New Memory Tool
1. Add tool schema to `ListToolsRequestSchema` handler in `src/index.ts`
2. Implement tool logic in `CallToolRequestSchema` handler
3. Add corresponding method to `MemoryManager` if needed
4. Update `src/types/Memory.ts` if adding new types/fields
5. Test with `pnpm run test:all`

### Adding a New Storage Backend
1. Implement `StorageAdapter` interface in `src/storage/`
2. Create `StorageAdapterFactory` implementation
3. Add backend detection logic
4. Add migration support in `MigrationManager`
5. Run parity validation tests
6. Update configuration schema

### Modifying Search Ranking
1. Update `MemoryConfig` interface in `src/types/Memory.ts`
2. Modify scoring logic in `MemoryManager.query()`
3. Add config getters with defaults
4. Update `docs/CLAUDE.md` configuration section
5. Test with various queries and compare results

### Debugging Video Storage Issues
```bash
# Enable debug logging
DEBUG="llm-memory:video" pnpm start

# Force specific backend
LLM_MEMORY_FORCE_BACKEND=file pnpm start
LLM_MEMORY_FORCE_BACKEND=video pnpm start

# Skip startup journal replay (faster dev iteration)
LLM_MEMORY_SKIP_STARTUP_REPLAY=1 pnpm start

# Delay startup replay (in milliseconds)
LLM_MEMORY_STARTUP_REPLAY_MS=5000 pnpm start

# Use custom home directory for isolated testing
LLM_MEMORY_HOME_DIR="$(pwd)/test-data" pnpm start

# Validate video storage
echo '{"name":"migration.validate","arguments":{"scope":"local","backend":"video"}}' | node dist/src/index.js

# Check FFmpeg installation
ffmpeg -version
which ffmpeg

# Get storage statistics
echo '{"name":"migration.status","arguments":{"scope":"local","backend":"video"}}' | node dist/src/index.js
```

### Known Issues and Fixes

#### Frame Extraction Off-By-One Bug (FIXED in v1.0.1)
**Symptoms**: Video storage shows correct frame count but items cannot be decoded, or wrong items are returned when querying specific IDs.

**Root Cause**: In `src/video/FrameExtractor.ts:371-389`, the fast seek mode used both `-ss` (timestamp seek) and `select` filter with the original frame index. After `-ss` positions at frame N, the input stream numbering resets, so `select='eq(n,frameIndex)'` would select the wrong frame.

**Fix**: Changed frame selection after `-ss` seek to use `frameIndex=0` instead of the original frame index:
```typescript
// After -ss seek, frame numbering resets, so select frame 0
'-vf', this.buildVideoFilters(0, scale, highQuality, false)
```

**Recovery**: If you have corrupted video storage:
1. Backup: `cp -r .llm-memory .llm-memory-backup`
2. Switch to file storage: Edit `.llm-memory/config.json` to `{"storage": {"backend": "file"}}`
3. Extract recoverable items manually if needed
4. Rebuild from file storage after upgrading to fixed version

**Important Note**: Videos encoded with the buggy code before v1.0.1 cannot be fully recovered because the frames were written to incorrect positions during encoding. The fix prevents future corruption but cannot retroactively repair already-encoded videos. Only items that happen to be at their correct frame positions (typically frame 0) can be recovered.

#### Empty Catalog on Startup (FIXED in v1.0.1)
**Symptoms**: `catalog.json` resets to `{}` when MCP server starts, losing all item metadata.

**Root Cause**: `VideoStorageAdapter` constructor loaded the catalog from disk but didn't rebuild it when the index had items but catalog was empty.

**Fix**: Added auto-rebuild logic in `src/storage/VideoStorageAdapter.ts:140-153`:
```typescript
if (hasIndexedItems && !hasCatalogEntries) {
  console.warn(`[VideoStorageAdapter] Video index has ${Object.keys(this.index.items).length} items but catalog is empty - rebuilding catalog`);
  this.initializationPromise = this.initializeVideoComponents().then(async () => {
    await this.rebuildCatalog();
  });
}
```

**Prevention**: The fix ensures catalog is automatically rebuilt from the video index if it gets corrupted or deleted.

## Important Files Reference

**Core Server**:
- `src/index.ts`: MCP server entry point, tool registration (1292 lines)
- `src/MemoryManager.ts`: Central memory orchestration (extensive, 100+ lines preview)

**Storage Layer**:
- `src/storage/StorageAdapter.ts`: Unified storage interface (142 lines)
- `src/storage/FileStorageAdapter.ts`: File backend implementation (7.4KB)
- `src/storage/VideoStorageAdapter.ts`: Video backend implementation (48KB)
- `src/storage/fileStore.ts`: Low-level file operations (26KB)
- `src/storage/Indexer.ts`: BM25 search indexing (5.9KB)
- `src/storage/VectorIndex.ts`: Vector similarity search (4.4KB)

**Video Storage**:
- `src/video/VideoEncoder.ts`: Video encoding abstraction
- `src/video/NativeEncoder.ts`: FFmpeg native encoder
- `src/video/WasmEncoder.ts`: FFmpeg WASM fallback
- `src/video/FrameIndex.ts`: Frame indexing system
- `src/video/EnhancedFrameIndex.ts`: Performance-optimized indexing
- `src/video/FrameExtractor.ts`: Frame extraction from video
- `src/video/VideoSegmentManager.ts`: Segment lifecycle management
- `src/video/VideoDecoder.ts`: Video decoding pipeline
- `src/video/utils.ts`: FFmpeg detection and utilities

**QR Code**:
- `src/qr/QRManager.ts`: QR encoding
- `src/qr/QRDecoder.ts`: QR decoding with zxing-wasm

**Migration**:
- `src/migration/MigrationManager.ts`: Storage and scope migration (50+ lines preview)

**Utilities**:
- `src/scope/ScopeResolver.ts`: Project detection and scope resolution
- `src/utils/secretFilter.ts`: Secret redaction
- `src/utils/tokenEstimate.ts`: Token counting
- `src/utils/lru.ts`: LRU cache implementation
- `src/util/ulid.ts`: ULID generation

**Type Definitions**:
- `src/types/Memory.ts`: Memory types and interfaces (100+ lines)
- `src/types.ts`: Additional shared types

**Documentation**:
- `docs/ARCHITECTURE.md`: Comprehensive architecture documentation (45KB)
- `docs/API_REFERENCE.md`: Complete API documentation (40KB)
- `docs/VIDEO_STORAGE_IMPLEMENTATION_PLAN.md`: Video storage design (48KB)
- `docs/OPERATIONS_GUIDE.md`: Production operations guide (42KB)
- `docs/PRODUCTION_DEPLOYMENT.md`: Deployment guide (28KB)
- `docs/CLI_MIGRATION_GUIDE.md`: Migration tool usage (19KB)

**Testing**:
- `tests/storage-parity-validation.test.ts`: File vs video CRUD parity
- `tests/search-parity-validation.test.ts`: Search result parity
- `tests/migration-validation.test.ts`: Migration integrity
- `tests/performance-benchmarks.test.ts`: Performance comparison
- `tests/feature-parity-report.test.ts`: Comprehensive feature report
