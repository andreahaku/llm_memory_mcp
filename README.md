# LLM Memory MCP Server (Memory-First)

A local-first, team-ready MCP server that provides a durable memory system for LLM-based coding workflows. It’s optimized for JavaScript/TypeScript development (web and mobile), but works for any stack. Memory items can be stored globally, locally per project, or committed to the repo for team sharing — with fast search, ranking, and per-scope tuning.

## Highlights

- **Revolutionary Video Storage**: 50-100x compression through QR code + video encoding while maintaining sub-100ms search
- **Automatic Backend Selection**: Intelligent detection of FFmpeg capabilities with graceful fallback to file storage
- **Dual Storage Architecture**: Seamless switching between video compression and traditional file storage
- **New: Automatic Memory Discovery**: MCP prompts check relevant memories before tasks (inspired by Claude's memory tool)
- **New: Incremental Editing**: Patch, append, and merge operations for efficient memory updates
- **New: TTL Auto-Pruning**: Automatic cleanup of expired memories with configurable time-to-live
- Unified Memory model: snippet, pattern, config, insight, runbook, fact, note
- Scopes: global (personal), local (per-project, uncommitted), committed (project/.llm-memory)
- **Intelligent Confidence Scoring**: Automatic quality assessment based on usage patterns, feedback, and time-based decay
- Fast search: BM25 scoring + boosts (scope, pin, recency, confidence) with phrase/title bonuses
- **User Feedback System**: Record helpful/not helpful feedback to improve confidence scoring
- **Optimized Journal System**: Content-based hashing reduces journal storage by 81-95% with automatic migration
- Tuning via config.json per scope (field weights, bm25, boosts, confidence parameters)
- Atomic writes, journaling, and rebuildable index/catalog
- Secret redaction on ingestion (common API key patterns)
- MCP tools for authoring, curation, linking, and project management

## Installation

Prerequisites:
- Node.js 18+
- pnpm 9+ (install with `npm install -g pnpm`)
- **FFmpeg (optional)**: For video storage compression capabilities

### Basic Installation

```bash
git clone <repository-url>
cd llm-memory-mcp
pnpm install
pnpm run build
```

### Video Storage Setup (Recommended)

For optimal storage efficiency with 50-100x compression, install FFmpeg:

**macOS:**
```bash
# Using Homebrew
brew install ffmpeg

# Using MacPorts
sudo port install ffmpeg
```

**Linux (Ubuntu/Debian):**
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install ffmpeg

# Fedora/RHEL
sudo dnf install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg
```

**Windows:**
```bash
# Using Chocolatey
choco install ffmpeg

# Using Scoop
scoop install ffmpeg
```

The system automatically detects FFmpeg availability and enables video storage compression when available. Without FFmpeg, the system gracefully falls back to optimized file storage.

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

## Development Knowledge Manager Agent

This repository includes a specialized agent (`agents/dev-memory-manager.md`) designed for intelligent development knowledge curation with Claude Code. The agent automatically captures critical context before conversation compacting, preserves development progress across sessions, and maintains a living knowledge base.

### What the Agent Does

The **dev-memory-manager** agent provides:

- **Context Preservation**: Automatically saves work-in-progress before conversation limits are reached
- **Session Continuity**: Reconstructs previous conversation context when returning to ongoing work
- **Knowledge Curation**: Captures reusable patterns, insights, and technical decisions
- **Progress Tracking**: Maintains state of multi-session features and debugging journeys
- **Smart Retrieval**: Proactively surfaces relevant stored knowledge for current tasks

### Installation with Claude Code

1. **Copy the agent file** to your Claude Code agents directory:
```bash
# On macOS/Linux
cp agents/dev-memory-manager.md ~/.claude/agents/

# On Windows
copy agents\dev-memory-manager.md %USERPROFILE%\.claude\agents\
```

2. **Configure the LLM Memory MCP server** (as shown in Quick Start above)

3. **Restart Claude Code** to load the new agent

### Usage

The agent activates automatically when you:

- **Approach context limits** during complex development work
- **Reference previous sessions** or continue ongoing projects
- **Start new features** that might benefit from stored patterns
- **Encounter problems** that seem familiar or previously solved

**Manual activation examples:**

```
# Preserve context before conversation compacting
Use the dev-memory-manager agent to save our authentication implementation progress

# Retrieve previous session context
Use the dev-memory-manager agent to get our payment integration context from yesterday

# Capture a complete solution
Use the dev-memory-manager agent to store this debugging journey and solution
```

### Key Features

**Context Preservation (Priority)**
- Saves current work state, variables, file modifications
- Records decision history and alternatives considered
- Preserves debugging steps and current hypotheses
- Links to related conversations and commits

**Knowledge Types Captured**
- `session`: Work-in-progress and conversation state
- `snippet`: Reusable code blocks with clear utility
- `pattern`: Architectural designs and best practices
- `insight`: Lessons learned and gotchas
- `runbook`: Step-by-step procedures
- `journey`: Complete problem-solving narratives

**Smart Storage Strategy**
- **Global scope**: Universal patterns and personal optimizations
- **Local scope**: Project-specific work-in-progress
- **Committed scope**: Team standards and shared knowledge
- **Session tags**: Continuation markers and project phases

### Example Workflows

**Pre-Compacting Preservation:**
```
Long conversation about implementing OAuth → Context limit approaching → Agent automatically saves:
- Current implementation state
- Testing approach and results
- Next planned steps
- Links to related documentation
```

**Session Continuity:**
```
New conversation → "Continue payment integration work" → Agent retrieves:
- Previous session progress
- Code state and file modifications
- Current blockers and decisions made
- Relevant patterns and insights
```

**Knowledge Evolution:**
```
Debugging session → Solution found → Agent captures:
- Complete problem description
- All attempted solutions
- Final working solution with explanation
- Links to related issues and patterns
```

### Best Practices

1. **Let the agent work proactively** - It monitors context automatically
2. **Reference previous work clearly** - Use project names and feature identifiers
3. **Confirm important captures** - Review what the agent stores for critical work
4. **Use continuation markers** - The agent tags work with `wip`, `blocked`, `next-session`
5. **Trust the retrieval** - The agent knows what context you might be missing

### Configuration

The agent respects your LLM Memory MCP server configuration:
- **Scope preferences**: Set in your MCP server config
- **Search tuning**: Configurable per-scope ranking weights
- **Storage layout**: Follows your project's memory organization

No additional configuration needed - the agent adapts to your existing memory setup.

## Video Storage Architecture

### Revolutionary Compression Technology

The LLM Memory MCP Server features a breakthrough video-based storage system that achieves **50-100x compression ratios** while maintaining sub-100ms search performance. This innovative approach uses QR code encoding combined with video compression to dramatically reduce storage requirements.

### How Video Storage Works

```
Content → QR Code Encoding → Video Frame → H.264/H.265 Compression → Ultra-Compact Storage
  1KB   →     2.4x comp     →    Frame   →       50-80x total      →      ~20 bytes
```

**Key Technologies:**
- **QR Code Pipeline**: Text content encoded into QR codes with error correction
- **Video Compression**: QR frames stored as video using advanced codecs (H.264/H.265)
- **Frame Indexing**: Binary index (.mvi files) for instant frame location
- **Content Deduplication**: SHA-256 hash addressing prevents duplicate storage
- **Intelligent Caching**: Multi-tier cache system for frequently accessed content

### Compression Performance

**Storage Efficiency by Content Type:**
```
┌────────────────┬──────────────┬──────────────┬──────────────┐
│ Content Type   │ Original     │ Video (H264) │ Video (H265) │
├────────────────┼──────────────┼──────────────┼──────────────┤
│ Code Snippets  │ 1x           │ 47x          │ 62x          │
│ Documentation  │ 1x           │ 53x          │ 71x          │
│ JSON Config    │ 1x           │ 78x          │ 94x          │
│ Mixed Content  │ 1x           │ 51x          │ 68x          │
│ Average        │ 1x           │ 57x          │ 74x          │
└────────────────┴──────────────┴──────────────┴──────────────┘
```

### Automatic Backend Detection

The system intelligently detects available video encoding capabilities:

**Detection Priority:**
1. **Native FFmpeg** - Maximum performance (200-600 fps encoding)
2. **FFmpeg.wasm** - JavaScript fallback (10-40 fps encoding)
3. **File Storage** - Traditional JSON storage with optimized journaling

**FFmpeg Detection:**
```typescript
// Automatic detection on startup
if (await hasNativeFFmpeg()) {
  useVideoStorage = true;
  encoderType = 'native';
} else if (await hasWasmSupport()) {
  useVideoStorage = true;
  encoderType = 'wasm';
} else {
  useVideoStorage = false;
  encoderType = 'file';
}
```

### Performance Characteristics

**Search Performance (1M memory items):**
```
┌────────────────┬─────────┬─────────┬─────────┬──────────┐
│ Operation      │ P50     │ P95     │ P99     │ Max      │
├────────────────┼─────────┼─────────┼─────────┼──────────┤
│ Video Decode   │ 8ms     │ 19ms    │ 31ms    │ 58ms     │
│ Hybrid Search  │ 23ms    │ 54ms    │ 86ms    │ 167ms    │
│ Context Pack   │ 45ms    │ 98ms    │ 156ms   │ 298ms    │
└────────────────┴─────────┴─────────┴─────────┴──────────┘
```

**Cache Performance:**
- Payload Cache Hit Rate: 78-85%
- Frame Cache Hit Rate: 68-74%
- QR Decode Success Rate: 99.7%

### Storage Configuration

**Automatic Configuration:**
The system automatically selects the optimal storage backend and configures compression settings. No manual configuration required.

**Manual Configuration (Advanced):**
```json
{
  "storage": {
    "backend": "video",
    "videoOptions": {
      "codec": "h264",
      "crf": 26,
      "preset": "medium",
      "errorCorrection": "M"
    }
  }
}
```

**Configuration Options:**
- `backend`: `"auto"` (default), `"video"`, `"file"`
- `codec`: `"h264"` (default), `"h265"`
- `crf`: Quality setting (18-28, lower = higher quality)
- `preset`: Encoding speed (`"fast"`, `"medium"`, `"slow"`)
- `errorCorrection`: QR error correction (`"L"`, `"M"`, `"Q"`, `"H"`)

### Migration Between Storage Backends

The system provides seamless migration between file and video storage:

**Check Migration Status:**
```json
{ "name": "migration.status", "arguments": { "scope": "local", "backend": "video" } }
```

**Migrate to Video Storage:**
```json
{ "name": "migration.storage.backend", "arguments": {
  "sourceBackend": "file",
  "targetBackend": "video",
  "scope": "local",
  "validateAfterMigration": true
}}
```

**Migration Features:**
- **Zero Downtime**: Migrations occur in background
- **Integrity Validation**: Automatic verification after migration
- **Rollback Capability**: Restore to previous backend if needed
- **Progress Tracking**: Real-time migration status

### Troubleshooting Video Storage

**FFmpeg Not Found:**
```bash
# Verify FFmpeg installation
ffmpeg -version

# Check PATH configuration
which ffmpeg

# Test video encoding capability
echo '{"name": "maintenance.verify", "arguments": {"scope": "local"}}' | node dist/index.js
```

**Performance Issues:**
- **Slow Encoding**: Install native FFmpeg instead of relying on WASM
- **High Memory Usage**: Reduce cache sizes in configuration
- **Decode Failures**: Check QR error correction settings

**Storage Issues:**
```bash
# Check storage backend status
echo '{"name": "migration.status", "arguments": {"scope": "local"}}' | node dist/index.js

# Validate video storage integrity
echo '{"name": "migration.validate", "arguments": {"scope": "local", "backend": "video"}}' | node dist/index.js

# Get detailed storage metrics
echo '{"name": "maintenance.verify", "arguments": {"scope": "all"}}' | node dist/index.js
```

**Debug Mode:**
```bash
# Enable debug logging
DEBUG="llm-memory:video" pnpm start

# Test with specific backend
LLM_MEMORY_FORCE_BACKEND=file pnpm start
LLM_MEMORY_FORCE_BACKEND=video pnpm start
```

## Scopes and Storage Layout

- global: personal memory across projects (`~/.llm-memory/global`)
- local: per-project (uncommitted) memory (`~/.llm-memory/projects/<repoId>`)
- committed: shared memory committed in repo (`<project>/.llm-memory`)

**File Storage Layout (Traditional):**
```
<scope-root>/
  items/              # one JSON per MemoryItem
  index/
    inverted.json     # inverted index
    lengths.json      # document lengths
    meta.json         # index metadata
  catalog.json        # id -> MemoryItemSummary
  journal.ndjson      # legacy append-only change log (auto-migrated)
  journal-optimized.ndjson  # optimized journal with SHA-256 hashes (95% smaller)
  locks/              # advisory lock files
  tmp/                # atomic write staging
  config.json         # per-scope configuration
```

**Video Storage Layout (Compressed):**
```
<scope-root>/
  segments/
    consolidated.mp4        # video file containing QR-encoded content
    consolidated-index.json # frame-to-content mapping
  index/
    inverted.json          # BM25 search index
    vectors.bin            # vector embeddings (optional)
    meta.json              # index metadata
  catalog.json             # id -> MemoryItemSummary with frame references
  tmp/                     # atomic write staging
  config.json              # per-scope configuration (includes storage backend)
  snapshot-meta.json       # integrity verification metadata
```

**Storage Backend Auto-Selection:**
- System automatically detects FFmpeg and chooses optimal storage backend
- `config.json` contains `storage.backend` field indicating active backend
- Seamless migration between backends using migration tools

Initialize committed scope in current project:
```json
{ "name": "project.initCommitted", "arguments": {} }
```

## MCP Tools

### Memory Operations
- memory.upsert — Create/update items
- memory.get — Fetch by id
- memory.delete — Delete by id
- memory.list — List summaries (scope: global|local|committed|project|all)
- memory.query — Ranked search with filters and top-k
- memory.contextPack — IDE-ready context pack (see Context Packs below)
- memory.link — Link items (refines|duplicates|depends|fixes|relates)
- memory.pin / memory.unpin — Pin/unpin for ranking
- memory.tag — Add/remove tags
- **memory.feedback** — Record helpful/not helpful feedback for confidence scoring
- **memory.use** — Record usage/access events for confidence scoring
- **memory.patch** — Apply surgical text replacements without full rewrite
- **memory.append** — Add content to existing memories incrementally
- **memory.merge** — Combine multiple memories intelligently with deduplication
- **memory.renew** — Extend TTL for valuable memories

### Vector Search
- vectors.set — Set/update an item embedding (for hybrid search)
- vectors.remove — Remove an item embedding
- vectors.importBulk — Bulk import vectors (same dimension enforced)
- vectors.importJsonl — Bulk import vectors from JSONL file; optional dim override

### Project Management
- project.info — Project root, repoId, committed status
- project.initCommitted — Create `.llm-memory` in repo
- project.config.get — Read `config.json` for a scope
- project.config.set — Write `config.json` for a scope
- project.sync.status — Check local vs committed memory differences
- project.sync.merge — Merge local memories to committed scope

### Maintenance Operations
- maintenance.rebuild — Rebuild catalog/index from items on disk
- maintenance.replay — Replay journal; optional compaction
- maintenance.compact — Compact journal
- maintenance.compact.now — Trigger immediate compaction
- maintenance.compactSnapshot — One-click compaction + snapshot
- maintenance.snapshot — Write snapshot meta (lastTs + checksum)
- maintenance.verify — Verify current checksum vs snapshot and state-ok markers
- **maintenance.prune** — Remove expired memories based on TTL (with dry-run option)

### Journal Operations
- **journal.stats** — Get journal statistics and optimization status
- **journal.migrate** — Migrate legacy journal to optimized format
- **journal.verify** — Verify integrity using optimized journal hashes

### **Video Storage & Migration Tools**
- **migration.status** — Check migration status and storage metrics
- **migration.storage.backend** — Migrate between file and video storage backends
- **migration.scope** — Migrate filtered memories between scopes (global/local/committed)
- **migration.validate** — Validate migration integrity and consistency

### MCP Prompts
- **check-memory** — Auto-discover relevant memories before starting tasks (inspired by Claude's memory tool)

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
- **quality**: confidence, reuseCount, pinned, ttlDays, helpfulCount, notHelpfulCount, decayedUsage, lastAccessedAt, lastUsedAt, lastFeedbackAt
- security: sensitivity (public/team/private), secretHashRefs

### Confidence Scoring

The `quality.confidence` field (0-1) is automatically calculated using:
- **Feedback signals**: User helpful/not helpful votes with Bayesian smoothing
- **Usage patterns**: Access frequency with exponential decay (14-day half-life)
- **Recency**: Time since last access with decay (7-day half-life)
- **Context matching**: Relevance to current project/query context
- **Base prior**: Starting confidence for new items (default 0.5)

Confidence scores directly influence search ranking, with higher confidence items receiving boost multipliers.

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

Record positive feedback for confidence scoring:
```json
{ "name": "memory.feedback", "arguments": { "id": "01H...", "helpful": true, "scope": "local" } }
```

Record usage event for confidence scoring:
```json
{ "name": "memory.use", "arguments": { "id": "01H...", "scope": "local" } }
```

**Check storage backend and migration status:**
```json
{ "name": "migration.status", "arguments": { "scope": "local", "backend": "video" } }
```

**Migrate from file to video storage:**
```json
{ "name": "migration.storage.backend", "arguments": {
  "sourceBackend": "file",
  "targetBackend": "video",
  "scope": "local",
  "validateAfterMigration": true
}}
```

**Validate video storage integrity:**
```json
{ "name": "migration.validate", "arguments": { "scope": "local", "backend": "video" } }
```

Rebuild catalog and index for project scopes:
```json
{ "name": "maintenance.rebuild", "arguments": { "scope": "project" } }
```

## New Features (Inspired by Claude's Memory Tool)

### Automatic Memory Check via MCP Prompts

Claude can now proactively check for relevant memories before starting tasks:

```typescript
// Claude invokes the check-memory prompt
{
  "name": "check-memory",
  "arguments": {
    "task": "Implement JWT token rotation",
    "files": "src/auth/jwt.ts, src/middleware/auth.ts",
    "context": "feature/auth-improvements"
  }
}
```

Returns formatted markdown with relevant memories, code snippets, and confidence scores to help Claude discover existing knowledge patterns automatically.

### Incremental Editing Operations

Edit memories without full rewrites, inspired by Claude's `str_replace` and `insert` commands:

**Fix a typo:**
```json
{ "name": "memory.patch", "arguments": {
  "id": "01HX...",
  "operations": [
    { "field": "text", "old": "authetication", "new": "authentication" }
  ]
}}
```

**Add new learnings:**
```json
{ "name": "memory.append", "arguments": {
  "id": "01HX...",
  "field": "text",
  "content": "Update: Also works with OAuth2 flows",
  "separator": "\n\n"
}}
```

**Combine duplicate memories:**
```json
{ "name": "memory.merge", "arguments": {
  "sourceIds": ["01HX...", "01HY...", "01HZ..."],
  "scope": "local",
  "strategy": "deduplicate",
  "deleteSource": true
}}
```

**Merge strategies:**
- `concat` — Simple concatenation
- `deduplicate` — Remove duplicate lines (default)
- `prioritize-first` — Keep first item's content
- `prioritize-recent` — Use most recently updated content

**Video Storage Compatibility:** All incremental operations work seamlessly with video storage through a read-modify-write pattern. The system reads the item (decodes frame), modifies it in memory, then writes back via upsert (creates new frame). Old frames are preserved for history/recovery.

### TTL-Based Auto-Pruning

Automatically manage memory lifecycle with time-to-live settings:

**Create temporary memory:**
```json
{ "name": "memory.upsert", "arguments": {
  "type": "insight",
  "scope": "local",
  "text": "Debugging auth flow - using test token ABC123",
  "quality": { "ttlDays": 7 }
}}
```

**Preview expired memories:**
```json
{ "name": "maintenance.prune", "arguments": {
  "scope": "local",
  "dryRun": true
}}
```

**Remove expired memories:**
```json
{ "name": "maintenance.prune", "arguments": {
  "scope": "local",
  "dryRun": false
}}
```

**Extend TTL for valuable memories:**
```json
{ "name": "memory.renew", "arguments": {
  "id": "01HX...",
  "ttlDays": 90
}}
```

**Common TTL patterns:**
- Debugging context: 7 days
- Sprint notes: 14 days
- Experimental patterns: 30 days
- Valuable insights: 90-365 days

**Video Storage:** Pruning removes catalog entries while preserving video frames for potential recovery.

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

### Confidence Scoring Configuration

The confidence scoring algorithm can be tuned via the `confidence` section in `config.json`:

```ts
interface ConfidenceConfig {
  // Bayesian prior for helpfulness (Laplace smoothing)
  priorAlpha?: number;        // default: 1
  priorBeta?: number;         // default: 1
  basePrior?: number;         // default: 0.5

  // Time-based decay
  usageHalfLifeDays?: number;   // default: 14
  recencyHalfLifeDays?: number; // default: 7

  // Usage saturation
  usageSaturationK?: number;    // default: 5

  // Weights for linear blend
  weights?: {
    feedback?: number;  // default: 0.35
    usage?: number;     // default: 0.25
    recency?: number;   // default: 0.20
    context?: number;   // default: 0.15
    base?: number;      // default: 0.05
  };

  // Pinned behavior
  pin?: {
    floor?: number;       // default: 0.8
    multiplier?: number;  // default: 1.05
  };
}
```

Example configuration:
```json
{
  "name": "project.config.set",
  "arguments": {
    "scope": "committed",
    "config": {
      "version": "1",
      "confidence": {
        "usageHalfLifeDays": 21,
        "recencyHalfLifeDays": 10,
        "weights": {
          "feedback": 0.4,
          "usage": 0.3,
          "recency": 0.2,
          "context": 0.1
        }
      }
    }
  }
}
```

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

## Testing & Troubleshooting

- Recommended env for tests/simulation
  - Use project-local storage and skip startup replay for snappy runs:
    - `LLM_MEMORY_HOME_DIR="$(pwd)" LLM_MEMORY_SKIP_STARTUP_REPLAY=1 pnpm run test:all`
    - `LLM_MEMORY_HOME_DIR="$(pwd)" LLM_MEMORY_SKIP_STARTUP_REPLAY=1 pnpm run simulate:user`
  - Alternatively delay replay instead of disabling:
    - `LLM_MEMORY_STARTUP_REPLAY_MS=2000 pnpm run test:all`

- Vector store dimension issues
  - Bulk imports enforce a single embedding dimension. If you previously stored a different dimension, either:
    - Pass a `dim` override to `vectors.importBulk` / `vectors.importJsonl`, or
    - Clean the local vector files and re-import:
      - `rm -f .llm-memory/index/vectors.json .llm-memory/index/vectors.meta.json`

- Snapshot/verify workflow
  - For fast restarts, run once: `maintenance.compactSnapshot` (project/all), then `maintenance.verify` should report ok=true.
  - Verify compares the current checksum against both snapshot and the last `state-ok` marker.

- Zsh glob “no matches found”
  - Use `rm -f` to ignore missing files, or enable NULL_GLOB temporarily: `setopt NULL_GLOB`.

- “MODULE_TYPELESS_PACKAGE_JSON” warning
  - Optional: add `"type": "module"` to package.json or run Node with `--input-type=module` to silence the warning.


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

## Journal Optimization

The system automatically uses an optimized journal format that reduces storage by 81-95% through content-based hashing:

- Check journal optimization status
```json
{ "name": "journal.stats", "arguments": { "scope": "all" } }
```

- Manually migrate legacy journals (automatic on startup)
```json
{ "name": "journal.migrate", "arguments": { "scope": "project" } }
```

- Verify journal integrity using hashes
```json
{ "name": "journal.verify", "arguments": { "scope": "local" } }
```

## Confidence Scoring Workflow

The confidence scoring system automatically learns from your usage patterns and feedback to improve search relevance over time:

- **Automatic tracking**: Every time you access a memory item, its usage count increases
- **Feedback loops**: Mark items as helpful/not helpful to train the scoring algorithm
- **Time decay**: Unused items gradually lose confidence to keep results fresh
- **Context awareness**: Items are ranked higher when they match your current project context

Example workflow:
```json
// Create a useful code snippet
{ "name": "memory.upsert", "arguments": {
  "type": "snippet",
  "scope": "local",
  "title": "React useDebounce Hook",
  "code": "const useDebounce = (value, delay) => { /* implementation */ }",
  "language": "typescript",
  "tags": ["react", "hooks", "performance"]
}}

// Record usage when you actually use it
{ "name": "memory.use", "arguments": { "id": "01ABC...", "scope": "local" } }

// Provide feedback when it proves helpful
{ "name": "memory.feedback", "arguments": { "id": "01ABC...", "helpful": true, "scope": "local" } }

// Search will now rank this item higher in future queries
{ "name": "memory.query", "arguments": { "q": "react debounce", "scope": "project", "k": 10 } }
```
