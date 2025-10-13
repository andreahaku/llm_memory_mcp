# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server that provides persistent memory storage for LLM tools. The system supports three storage backends (file, video, markdown), local embeddings with HNSW vector search, and features like automatic learning from git commits.

**Key Architecture Principle**: The system is designed to be storage-backend agnostic. All memory operations flow through the `MemoryManager`, which uses pluggable `StorageAdapter` implementations.

## Core Build & Development Commands

```bash
# Build TypeScript to dist/
pnpm run build

# Run in development mode with tsx (no build step)
pnpm run dev

# Type checking without emitting
pnpm run typecheck

# Linting
pnpm run lint

# Run all tests
pnpm test

# Run specific test suites
pnpm run test:parity          # Storage backend parity tests
pnpm run test:migration       # Migration validation tests
pnpm run test:search         # Search functionality tests
pnpm run test:performance    # Performance benchmarks
```

## Testing Strategy

- **Test files location**: `tests/` directory
- **Test configuration**: `jest.config.js` with ts-jest preset
- **Test timeout**: 30 seconds (for long-running operations)
- **Important**: Tests use `LLM_MEMORY_HOME_DIR` and `LLM_MEMORY_SKIP_STARTUP_REPLAY` environment variables to control behavior

### Running Single Tests

```bash
# Run a specific test file
pnpm test -- tests/storage-parity-validation.test.ts

# Run with watch mode
pnpm test -- --watch

# Run with coverage
pnpm test -- --coverage
```

## Architecture Overview

### Storage Layer Hierarchy

```
MemoryManager (src/MemoryManager.ts)
    ↓
StorageAdapter interface (src/storage/StorageAdapter.ts)
    ↓
FileStorageAdapter | VideoStorageAdapter | MarkdownStorageAdapter
    ↓
FileStore | VideoSegmentManager | FrontmatterParser
```

**Critical**: When adding features, they must work across ALL storage backends. The abstraction is maintained through the `StorageAdapter` interface.

### Storage Backends

1. **File Storage** (`src/storage/FileStorageAdapter.ts`)
   - JSON files in `items/` directory
   - Optimized journal with content-based SHA-256 hashing
   - Default fallback when FFmpeg unavailable

2. **Video Storage** (`src/storage/VideoStorageAdapter.ts`)
   - QR code encoding + H.264/H.265 compression
   - 50-100x compression ratio
   - Requires FFmpeg (native or WASM fallback)
   - Frame indexing for sub-100ms retrieval

3. **Markdown Storage** (`src/storage/MarkdownStorageAdapter.ts`)
   - Obsidian-compatible markdown files with YAML frontmatter
   - Project-based subfolders in `_LLM_memories/`
   - Human-readable and git-friendly

### Backend Detection Logic

The system auto-detects storage backends in this order:
1. Read `config.json` for explicit `storage.backend` setting
2. Check for markdown directory (`_LLM_memories/` with project subfolders)
3. Check for video segments (`segments/*.mp4` or `*.mvi` files)
4. Check environment variable `LLM_MEMORY_DEFAULT_BACKEND`
5. Auto-detect FFmpeg and default to video if available
6. Fallback to file storage

**Location**: `src/MemoryManager.ts:281` (`detectStorageBackend()`)

### Key Components

- **MemoryManager** (`src/MemoryManager.ts`): Central orchestrator for all memory operations
- **ScopeResolver** (`src/scope/ScopeResolver.ts`): Resolves scope directories (global/local/committed)
- **InvertedIndexer** (`src/storage/Indexer.ts`): BM25-based text search
- **VectorIndex/HNSWVectorIndex** (`src/storage/VectorIndex.ts`, `src/storage/HNSWVectorIndex.ts`): Semantic vector search
- **LocalEmbedder** (`src/embeddings/LocalEmbedder.ts`): Offline embedding generation with transformers.js
- **MigrationManager** (`src/migration/MigrationManager.ts`): Handles storage backend migrations

## MCP Server Entry Point

**Main server**: `src/index.ts`

Key setup:
- Uses `@modelcontextprotocol/sdk` for MCP protocol
- Stdio transport for communication
- Tool configuration via `src/toolConfig.ts` and `src/toolDefinitions.ts`
- Tool names are compressed for token efficiency (e.g., `mem.upsert`, `proj.info`, `mig.status`)

## Memory Item Schema

Defined in `src/types/Memory.ts`:

```typescript
interface MemoryItem {
  id: string;                    // ULID
  type: MemoryType;              // snippet | pattern | config | insight | runbook | fact | note
  scope: MemoryScope;            // global | local | committed
  title?: string;
  text?: string;
  code?: string;
  language?: string;
  facets: MemoryFacets;          // tags, files, symbols
  context: MemoryContext;        // repoId, branch, file, range, etc.
  quality: MemoryQuality;        // confidence scoring, usage tracking
  security: MemorySecurity;      // sensitivity level, secret filtering
  vectors?: MemoryVectors;       // embedding metadata
  links?: MemoryLink[];          // relationships between memories
  createdAt: string;
  updatedAt: string;
  version: number;
}
```

## Confidence Scoring System

**Location**: `src/MemoryManager.ts:71-235`

The system uses a sophisticated confidence scoring algorithm with:
- **Bayesian feedback**: User helpful/not helpful votes
- **Usage decay**: Exponential decay with 14-day half-life
- **Recency scoring**: 7-day half-life for last-used timestamp
- **Context matching**: Repo, file, and tool context alignment
- **Pinned boost**: Pinned items get floor of 0.8 and 1.05x multiplier

All parameters are configurable per-scope via `config.json` under the `confidence` section.

## Journal Optimization

**Location**: `src/storage/fileStore.ts` (methods: `migrateToOptimizedJournal`, `writeOptimizedJournalEntry`)

The system supports two journal formats:
- **Legacy**: Full item content in every journal entry (`jour.ndjson`)
- **Optimized**: SHA-256 content hashing with 81-95% size reduction (`journal-optimized.ndjson`)

Migration happens automatically on startup. The optimized format stores content hashes and only writes full content when it changes.

## Auto-Learning System

**Location**: `src/autolearn/`

Components:
- **AutoLearnManager**: Orchestrates the system
- **GitHooksManager**: Installs git hooks (commit-msg, post-commit)
- **ClaudeCodeHooks**: Integrates with Claude Code hooks system
- **ClaudeCodeAgents**: Provides dev-memory-manager agent

Workflow:
1. Git commit with `#kb` tag triggers hook
2. Event written to `.llm-memory/autolearn-queue.ndjson`
3. MCP tool `autolearn.processQueue` materializes events into memories
4. Classification by commit type (fix→insight, refactor→pattern, etc.)

## Migration Between Storage Backends

**Location**: `src/migration/MigrationManager.ts`

Supported migrations:
- file ↔ video
- file ↔ markdown
- video ↔ markdown

**Critical**: Migration tools depend on FFmpeg. The system gracefully handles FFmpeg unavailability by falling back to file storage.

### Migration Tools (MCP)

```json
{"name": "mig.status", "arguments": {"scope": "local", "backend": "video"}}
{"name": "mig.storage.backend", "arguments": {"sourceBackend": "file", "targetBackend": "video", "scope": "local"}}
{"name": "mig.validate", "arguments": {"scope": "local", "backend": "video"}}
```

## Search & Ranking

**Location**: `src/MemoryManager.ts:707-871` (`query()` method)

Search uses:
1. **BM25 keyword search** via InvertedIndexer
2. **Optional hybrid search** combining BM25 + vector similarity
3. **Ranking boosts**:
   - Scope bonus (committed > local > global)
   - Pin bonus
   - Recency decay
   - Confidence scoring
   - Phrase matching bonuses

All ranking parameters are tunable per-scope via `config.json` under `ranking` section.

## Local Embeddings

**Location**: `src/embeddings/LocalEmbedder.ts`

Three pre-configured models:
- `bge-small-en-v1.5` (384D, default) - Best for code
- `all-MiniLM-L6-v2` (384D) - Fast general text
- `all-mpnet-base-v2` (768D) - Higher quality

Models are cached in `~/.cache/transformers/` after first download.

**Important**: Vector index dimension must match the configured model. Dimension mismatches are logged with remediation instructions.

## Environment Variables

- `LLM_MEMORY_HOME_DIR`: Override default storage root
- `LLM_MEMORY_SKIP_STARTUP_REPLAY`: Skip journal replay on startup (testing)
- `LLM_MEMORY_STARTUP_REPLAY_MS`: Delay before startup replay (default: 1000ms)
- `LLM_MEMORY_DEFAULT_BACKEND`: Force specific backend (file|video|markdown)
- `LLM_MEMORY_TOOLS`: Enable optional tool groups (vectors,migration,journal,maintenance)

## Common Gotchas

1. **Startup replay conflicts**: When multiple processes start simultaneously, journal replay can conflict. Use `LLM_MEMORY_SKIP_STARTUP_REPLAY=1` for tests.

2. **Catalog rebuild race conditions**: The system handles lock conflicts gracefully by returning empty catalog and allowing background rebuild.

3. **FFmpeg dependency**: Video storage and migration tools require FFmpeg. The system detects availability and falls back gracefully, but tests may need to skip video-related features.

4. **Vector dimension mismatches**: Changing embedding models requires rebuilding vector indexes or re-embedding all memories. The system logs warnings but doesn't auto-fix.

5. **Scope sensitivity policies**: Committed scope enforces sensitivity restrictions (default: team). Attempting to commit private memories will fail.

## Development Workflow

1. **Add new memory types**: Update `MemoryType` in `src/types/Memory.ts`
2. **Add new MCP tools**:
   - Define in `src/toolDefinitions.ts`
   - Implement in `src/index.ts` CallToolRequestSchema handler
   - Update token-optimized names in `src/toolConfig.ts`
3. **Add new storage backends**:
   - Implement `StorageAdapter` interface
   - Add factory class
   - Update backend detection in `MemoryManager.detectStorageBackend()`
4. **Modify confidence scoring**: Update algorithm in `MemoryManager.computeConfidence()` and config schema in `src/types/Memory.ts`

## TypeScript Configuration

- **Module system**: ESM with NodeNext resolution
- **Target**: ES2022
- **Output**: `dist/` directory
- **Excluded**: Tests, benchmarks, CLI tools (for production build)

**Important**: The codebase uses `.js` extensions in imports (e.g., `import { foo } from './bar.js'`) even for TypeScript files. This is required for ESM.

## Project Structure Notes

- `/src` - Core TypeScript source
- `/dist` - Compiled output
- `/tests` - Jest test suites
- `/docs` - Extensive documentation
- `/scripts` - Utility scripts
- `/agents` - Claude Code agent definitions
- `/hooks` - Git hook templates
- `/.llm-memory` - Local memory storage (gitignored)
- `/benchmarks` - Performance benchmarking tools

## Integration Points

The system integrates with:
- **Claude Code**: Via MCP protocol and agents
- **Cursor**: Via MCP server configuration
- **Codex CLI**: Via MCP server configuration
- **Obsidian**: Via markdown storage backend with wikilinks
- **Git**: Via auto-learning hooks for commit knowledge capture
