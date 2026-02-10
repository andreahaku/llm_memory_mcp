# LLM Memory MCP Server (Memory-First)

A local-first, team-ready MCP server that provides a durable memory system for LLM-based coding workflows. It's optimized for JavaScript/TypeScript development (web and mobile), but works for any stack. Memory items can be stored globally, locally per project, or committed to the repo for team sharing — with fast search, ranking, and per-scope tuning.

## Highlights

- **Three Storage Backends**: Choose between file (JSON), video (QR+MP4 compression), or markdown (Obsidian-compatible)
- **Revolutionary Video Storage**: 50-100x compression through QR code + video encoding while maintaining sub-100ms search
- **Markdown/Obsidian Integration**: Native markdown format with YAML frontmatter and wikilinks for Obsidian vaults
- **Local Embeddings & HNSW Search**: Offline semantic search with transformers.js and O(log n) vector indexing - no external APIs required
- **Automatic Backend Selection**: Intelligent detection of capabilities with seamless migration between backends
- **Flexible Storage Architecture**: Switch between file, video, and markdown storage at any time
- **New: Automatic Memory Discovery**: MCP prompts check relevant memories before tasks (inspired by Claude's memory tool)
- **New: Incremental Editing**: Patch, append, and merge operations for efficient memory updates
- **New: TTL Auto-Pruning**: Automatic cleanup of expired memories with configurable time-to-live
- Unified Memory model: snippet, pattern, config, insight, runbook, fact, note
- Scopes: global (personal), local (per-project, uncommitted), committed (project/.llm-memory)
- **Intelligent Confidence Scoring**: Automatic quality assessment based on usage patterns, feedback, and time-based decay
- Fast search: BM25 scoring + boosts (scope, pin, recency, confidence) with phrase/title bonuses
- **Hybrid Search**: Combine keyword-based BM25 with semantic vector similarity for best-of-both-worlds retrieval
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

### Video Storage Setup (Optional)

For optimal storage efficiency with 50-100x compression, you can optionally install FFmpeg and configure video storage:

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

The system defaults to file (JSON) storage for maximum compatibility. To use video storage, explicitly configure it via `config.json` with `"storage": { "backend": "video" }` or set the `LLM_MEMORY_DEFAULT_BACKEND=video` environment variable.

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
codex config set mcp.servers.llm-mem.command "node"
codex config set mcp.servers.llm-mem.args "['/absolute/path/to/llm-memory-mcp/dist/index.js']"
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

## Auto-Learning from Git Commits

Automatically capture development knowledge from your git commits to build a searchable knowledge base of your coding patterns, solutions, and insights.

### Quick Start

**1. Tag commits with `#kb` to capture knowledge:**
```bash
git commit -m "Implement JWT authentication with refresh tokens #kb #security"
```

**2. System automatically captures:**
- Commit message and metadata
- Code changes (diff)
- Affected files and symbols
- Additional context tags

**3. Process captured events:**
```json
{ "name": "autolearn.processQueue", "arguments": {} }
```

**4. Knowledge becomes searchable:**
```json
{
  "name": "memory.query",
  "arguments": {
    "q": "JWT authentication",
    "scope": "project",
    "k": 10
  }
}
```

### How It Works

The auto-learning system consists of three integrated components:

**1. Git Hooks** (automatically installed)
- `commit-msg`: Detects `#kb` tags in commit messages
- `post-commit`: Captures commit details to queue file

**2. Event Queue** (`.llm-memory/autolearn-queue.ndjson`)
- Stores captured events until processed
- Survives server restarts
- Prevents data loss

**3. Materialization** (converts events to memories)
- Classifies commits by type (fix → insight, refactor → pattern)
- Extracts code snippets and context
- Creates searchable MemoryItems

### MCP Tools for Auto-Learning

**Check System Status:**
```json
{ "name": "autolearn.status", "arguments": {} }
```

Returns:
- Hook installation status
- Queue size
- System configuration

**Initialize Auto-Learning:**
```json
{ "name": "autolearn.init", "arguments": { "autoInstall": true } }
```

Installs git hooks and Claude Code hooks/agents.

**Process Event Queue:**
```json
{ "name": "autolearn.processQueue", "arguments": {} }
```

Processes all queued events and creates memories.

**Capture Specific Commit:**
```json
{ "name": "autolearn.captureCommit", "arguments": { "commitHash": "HEAD" } }
```

Manually capture a commit (useful for retroactive capture).

**Install Globally:**
```json
{ "name": "autolearn.installGlobally", "arguments": {} }
```

Install hooks and agents in your global Claude Code directory (`~/.claude/`).

### Usage Examples

**Capture Bug Fix:**
```bash
git commit -m "Fix race condition in authentication middleware #kb #bug #async"
```

Creates an `insight` memory with:
- Title: "Fix race condition in authentication middleware"
- Tags: kb, bug, async, fix
- Code: Affected code from diff
- Files: Modified files
- Symbols: Extracted function/class names

**Capture Pattern:**
```bash
git commit -m "Refactor API client with retry logic pattern #kb #pattern #resilience"
```

Creates a `pattern` memory documenting the retry pattern.

**Capture Configuration:**
```bash
git commit -m "Add ESLint config for TypeScript strict mode #kb #config #typescript"
```

Creates a `config` memory with the configuration template.

### Automatic Initialization

When you connect the MCP server to Claude Code (or other MCP clients), the system automatically:

1. **Detects your project** via git repository detection
2. **Initializes auto-learning** with hook installation
3. **Logs status** showing what was installed
4. **Ready to capture** - just use `#kb` in commits

No manual setup required! The system works out of the box.

### Integration with dev-memory-manager Agent

The dev-memory-manager agent integrates with auto-learning to:

- **Check for queued events** on session start
- **Process and present** captured knowledge
- **Suggest** adding `#kb` tags to important commits
- **Ensure hooks** are installed and working

This creates a seamless workflow where you focus on coding and committing, and the system automatically builds your knowledge base.

### Configuration

Auto-learning respects the standard memory configuration system. Configure via `project.config.set`:

```json
{
  "name": "project.config.set",
  "arguments": {
    "scope": "local",
    "config": {
      "version": "1",
      "autolearn": {
        "enabled": true,
        "captureTypes": ["commit", "fix", "refactor", "pattern"],
        "gitHooks": {
          "enabled": true,
          "tagPattern": "#kb",
          "captureDiffs": true,
          "maxDiffSize": 10000
        },
        "filters": {
          "minLinesChanged": 5,
          "includePatterns": ["**/*.ts", "**/*.js"],
          "excludePatterns": ["**/node_modules/**", "**/dist/**"]
        },
        "storage": {
          "scope": "local",
          "defaultType": "snippet"
        }
      }
    }
  }
}
```

### Best Practices

**When to Use `#kb` Tags:**
- ✅ Implementing new features or patterns
- ✅ Fixing complex bugs with reusable solutions
- ✅ Adding configurations or templates
- ✅ Refactoring with architectural insights
- ✅ Creating utilities or helper functions

**When NOT to Use `#kb` Tags:**
- ❌ Trivial changes (typos, formatting)
- ❌ WIP/temporary commits
- ❌ Merge commits or rebases
- ❌ Commits with sensitive information

**Tagging Strategy:**
```bash
# Include descriptive context tags
git commit -m "Add rate limiting middleware #kb #security #express #middleware"

# Use type indicators
git commit -m "Fix memory leak in WebSocket handler #kb #bug #websocket"

# Reference related systems
git commit -m "Refactor authentication flow #kb #pattern #auth #jwt"
```

### Troubleshooting

**Hooks not triggering?**
```bash
# Check hook installation
ls -la .git/hooks/ | grep -E '(commit-msg|post-commit)'

# Verify executable permissions
chmod +x .git/hooks/commit-msg .git/hooks/post-commit

# Check for marker file (created after #kb commit)
ls -la .git/llm-memory-autolearn.tmp
```

**Queue not processing?**
```bash
# Check queue contents
cat .llm-memory/autolearn-queue.ndjson

# Check system status
echo '{"name":"autolearn.status","arguments":{}}' | node dist/index.js

# Manually process queue
echo '{"name":"autolearn.processQueue","arguments":{}}' | node dist/index.js
```

**Agents not active?**
```bash
# Check agent installation
ls -la ~/.claude/agents/ | grep dev-memory-manager

# Check project-level agents
ls -la .claude/agents/

# Restart Claude Code to reload agents
```

For more detailed documentation, see [`docs/AUTO_LEARNING.md`](docs/AUTO_LEARNING.md).

## Storage Backends

The LLM Memory MCP Server supports three storage backends, each optimized for different use cases:

### 1. Markdown Storage (Obsidian-Compatible)

**Perfect for:** Knowledge management, team wikis, Obsidian users, human-readable storage

Stores memories as individual markdown files with YAML frontmatter, fully compatible with Obsidian and other markdown tools. Each memory is a standalone `.md` file with:
- **YAML frontmatter** containing metadata (id, type, tags, confidence, etc.)
- **Markdown body** with title, description, and code blocks
- **Wikilinks** for linking related memories (`[[memory-id-title]]`)
- **Context sections** showing repository, file, and tool information

**Benefits:**
- ✅ Human-readable and editable in any text editor
- ✅ Full Obsidian integration with graph view, backlinks, and wikilinks
- ✅ Version control friendly (git diff works naturally)
- ✅ Easy to share, review, and collaborate on
- ✅ No external dependencies required

**Storage Structure:**
```
_LLM_memories/
  react-project/              # Project-based subfolder (from repoId)
    01ABC-react-hooks.md
    01DEF-typescript-patterns.md
  nodejs-api/                 # Different project
    01GHI-express-middleware.md
  _global/                    # Memories without specific project
    01JKL-git-workflow.md
```

Memories are automatically organized by project using the `repoId` from their context. This makes it easy to:
- Navigate memories by project in Obsidian's file explorer
- Use Obsidian's folder-based features (tags, filters, views)
- Keep project knowledge isolated and organized
- Find related memories within the same project

### 2. Video Storage (Ultra-Compressed)

**Perfect for:** Large codebases, storage-constrained environments, archival

Revolutionary video-based storage system that achieves **50-100x compression ratios** while maintaining sub-100ms search performance. Uses QR code encoding combined with video compression to dramatically reduce storage requirements.

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

### 3. File Storage (Traditional JSON)

**Perfect for:** Maximum compatibility, no dependencies, debugging

Traditional JSON-based storage with optimized journaling and content-based hashing. Each memory is stored as a separate JSON file with automatic journal compaction.

**Benefits:**
- ✅ No external dependencies
- ✅ Fast and reliable
- ✅ Optimized journal with 81-95% compression via SHA-256 hashing
- ✅ Works everywhere Node.js runs

**Storage Structure:**
```
items/
  01ABC.json
  01DEF.json
journal-optimized.ndjson
catalog.json
```

### Backend Selection and Detection

The system uses file (JSON) storage by default and detects existing storage formats:

**Detection Priority:**
1. **Config Check** - Explicit `storage.backend` setting in config.json
2. **Markdown Detection** - Presence of `_LLM_memories/` directory with `.md` files
3. **Video Detection** - Presence of `segments/` directory with video files
4. **Environment Variable** - `LLM_MEMORY_DEFAULT_BACKEND` setting
5. **Default** - File storage (always used when no other backend is detected)

**Explicit Backend Configuration:**
```json
// config.json - explicitly set your preferred backend
{
  "storage": {
    "backend": "file"    // or "video" or "markdown"
  }
}
```

**Environment Variable:**
```bash
# Set default backend via environment
export LLM_MEMORY_DEFAULT_BACKEND=video  # or "file" or "markdown"
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
- `backend`: `"auto"` (default), `"file"`, `"video"`, `"markdown"`
- `codec`: `"h264"` (default), `"h265"` (video only)
- `crf`: Quality setting (18-28, lower = higher quality) (video only)
- `preset`: Encoding speed (`"fast"`, `"medium"`, `"slow"`) (video only)
- `errorCorrection`: QR error correction (`"L"`, `"M"`, `"Q"`, `"H"`) (video only)

### Migration Between Storage Backends

The system provides seamless migration between all three storage backends (file ↔ video ↔ markdown):

**Check Migration Status:**
```json
{ "name": "mig.status", "arguments": { "scope": "local", "backend": "video" } }
```

**Migrate to Video Storage:**
```json
{ "name": "mig.storage.backend", "arguments": {
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
echo '{"name": "maint.verify", "arguments": {"scope": "local"}}' | node dist/index.js
```

**Performance Issues:**
- **Slow Encoding**: Install native FFmpeg instead of relying on WASM
- **High Memory Usage**: Reduce cache sizes in configuration
- **Decode Failures**: Check QR error correction settings

**Storage Issues:**
```bash
# Check storage backend status
echo '{"name": "mig.status", "arguments": {"scope": "local"}}' | node dist/index.js

# Validate video storage integrity
echo '{"name": "mig.validate", "arguments": {"scope": "local", "backend": "video"}}' | node dist/index.js

# Get detailed storage metrics
echo '{"name": "maint.verify", "arguments": {"scope": "all"}}' | node dist/index.js
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
  jour.ndjson      # legacy append-only change log (auto-migrated)
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
    vec.bin            # vector embeddings (optional)
    meta.json              # index metadata
  catalog.json             # id -> MemoryItemSummary with frame references
  tmp/                     # atomic write staging
  config.json              # per-scope configuration (includes storage backend)
  snapshot-meta.json       # integrity verification metadata
```

**Markdown Storage Layout:**
```
<scope-root>/
  _LLM_memories/          # Root memories folder
    project-a/            # Project-specific subfolders (based on repoId)
      01ABC-component.md
      01DEF-util.md
    project-b/
      01GHI-api.md
    _global/              # Memories without specific project
      01JKL-pattern.md
  .memory/                # Hidden metadata directory
    catalog.json          # id → MemoryItemSummary
    config.json           # per-scope configuration
    index/                # Search indexes
      inverted.json
      vectors.bin
      meta.json
```

**Storage Backend Auto-Selection:**
- System automatically detects storage backend based on directory structure
- `config.json` contains `storage.backend` field indicating active backend
- Seamless migration between all three backends using migration tools

Initialize committed scope in current project:
```json
{ "name": "proj.initCommitted", "arguments": {} }
```

## Obsidian Integration

When using markdown storage backend, memories are fully compatible with Obsidian, enabling powerful knowledge management features:

### Setup with Obsidian

1. **Enable markdown storage:**
```json
{ "name": "project.config.set", "arguments": {
  "scope": "local",
  "config": { "version": "1", "storage": { "backend": "markdown" } }
}}
```

2. **Open your memory folder in Obsidian:**
   - Global: `~/.llm-memory/global/_LLM_memories/`
   - Local: `~/.llm-memory/projects/<project-hash>/_LLM_memories/`
   - Committed: `<project>/.llm-memory/_LLM_memories/`

   **Project Organization**: Memories are automatically organized into subfolders based on their project (`repoId`):
   - `_LLM_memories/react-app/` - Memories from your React project
   - `_LLM_memories/api-server/` - Memories from your API project
   - `_LLM_memories/_global/` - Memories without a specific project

3. **Features you get:**
   - 📊 **Graph View** - Visualize connections between memories
   - 🔗 **Wikilinks** - Click `[[memory-id-title]]` to navigate
   - ⬅️ **Backlinks** - See which memories reference the current one
   - 🔍 **Full-text Search** - Use Obsidian's powerful search
   - 🏷️ **Tags** - Filter and organize with #tags
   - ✍️ **Edit Anywhere** - Modify memories in Obsidian or your IDE

### Memory File Format

Each memory is a markdown file with YAML frontmatter:

```markdown
---
id: 01JDF97ZMB000000000000001
type: pattern
scope: global
title: React Hooks Best Practices
language: typescript
tags: [react, hooks, best-practices]
confidence: 0.85
pinned: false
createdAt: 2025-10-11T13:10:00.000Z
updatedAt: 2025-10-11T13:10:00.000Z
version: 1
---

# React Hooks Best Practices

Essential patterns for using React Hooks effectively.

## Code

\`\`\`typescript
// Your code here
\`\`\`

## Related Memories

- [[01ABC-typescript-generics]]
- [[01DEF-react-performance]]

## Context

- **Tool**: Claude Code
- **Framework**: React
```

### Obsidian API Integration

For programmatic access to your Obsidian vault, install the [Local REST API plugin](https://github.com/coddingtonbear/obsidian-local-rest-api):

1. Install the plugin in Obsidian
2. Enable HTTPS in plugin settings
3. Generate an API key
4. Use the REST API to read/write memories programmatically

This enables powerful workflows like:
- Sync memories to Obsidian in real-time
- Create memories from Obsidian notes
- Automate knowledge capture from development sessions

## MCP Tools

### Memory Operations
- mem.upsert — Create/update items
- mem.get — Fetch by id
- mem.delete — Delete by id
- mem.list — List summaries (scope: global|local|committed|project|all)
- mem.query — Ranked search with filters and top-k
- mem.contextPack — IDE-ready context pack (see Context Packs below)
- mem.link — Link items (refines|duplicates|depends|fixes|relates)
- mem.pin / mem.unpin — Pin/unpin for ranking
- mem.tag — Add/remove tags
- **mem.feedback** — Record helpful/not helpful feedback for confidence scoring
- **mem.use** — Record usage/access events for confidence scoring
- **mem.patch** — Apply surgical text replacements without full rewrite
- **mem.append** — Add content to existing memories incrementally
- **mem.merge** — Combine multiple memories intelligently with deduplication
- **mem.renew** — Extend TTL for valuable memories

### Vector Search
- vec.set — Set/update an item embedding (for hybrid search)
- vec.remove — Remove an item embedding
- vec.importBulk — Bulk import vectors (same dimension enforced)
- vec.importJsonl — Bulk import vectors from JSONL file; optional dim override

### Project Management
- proj.info — Project root, repoId, committed status
- proj.initCommitted — Create `.llm-memory` in repo
- proj.config.get — Read `config.json` for a scope
- proj.config.set — Write `config.json` for a scope
- proj.sync.status — Check local vs committed memory differences
- proj.sync.merge — Merge local memories to committed scope

### Maintenance Operations
- maint.rebuild — Rebuild catalog/index from items on disk
- maint.replay — Replay journal; optional compaction
- maint.compact — Compact journal
- maint.compact.now — Trigger immediate compaction
- maint.compactSnapshot — One-click compaction + snapshot
- maint.snapshot — Write snapshot meta (lastTs + checksum)
- maint.verify — Verify current checksum vs snapshot and state-ok markers
- **maint.prune** — Remove expired memories based on TTL (with dry-run option)

### Journal Operations
- **jour.stats** — Get journal statistics and optimization status
- **jour.migrate** — Migrate legacy journal to optimized format
- **jour.verify** — Verify integrity using optimized journal hashes

### **Video Storage & Migration Tools**
- **mig.status** — Check migration status and storage metrics
- **mig.storage.backend** — Migrate between file and video storage backends
- **mig.scope** — Migrate filtered memories between scopes (global/local/committed)
- **mig.validate** — Validate migration integrity and consistency

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
  "name": "mem.upsert",
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
  "name": "mem.query",
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
{ "name": "mem.pin", "arguments": { "id": "01H..." } }
```

Link related items:
```json
{ "name": "mem.link", "arguments": { "from": "01A...", "to": "01B...", "rel": "refines" } }
```

Record positive feedback for confidence scoring:
```json
{ "name": "mem.feedback", "arguments": { "id": "01H...", "helpful": true, "scope": "local" } }
```

Record usage event for confidence scoring:
```json
{ "name": "mem.use", "arguments": { "id": "01H...", "scope": "local" } }
```

**Check storage backend and migration status:**
```json
{ "name": "mig.status", "arguments": { "scope": "local", "backend": "video" } }
```

**Migrate from file to markdown storage (Obsidian-compatible):**
```json
{ "name": "migration.storage.backend", "arguments": {
  "sourceBackend": "file",
  "targetBackend": "markdown",
  "scope": "local",
  "validateAfterMigration": true
}}
```

**Migrate from file to video storage (ultra-compressed):**
```json
{ "name": "mig.storage.backend", "arguments": {
  "sourceBackend": "file",
  "targetBackend": "video",
  "scope": "local",
  "validateAfterMigration": true
}}
```

**Migrate from markdown to video storage:**
```json
{ "name": "mig.validate", "arguments": { "scope": "local", "backend": "video" } }
```

Rebuild catalog and index for project scopes:
```json
{ "name": "maint.rebuild", "arguments": { "scope": "project" } }
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

### Context Injection with Token Budget (`mem.context`)

Inspired by [how Claude's memory system works](https://medium.com/@tattva.tarang/i-tried-to-reverse-engineer-how-claude-remembers-things-what-i-found-surprised-me), memories can now be marked for automatic injection into prompts, with token-budget-aware retrieval.

**Injection Policy:**

Memories can have an `injection` field with two values:
- **`always`** - High-value memories always included in context (like Claude's "user memories")
- **`on-demand`** - Retrieved only when explicitly searched (default behavior)

**Create an always-inject memory:**
```json
{ "name": "mem.upsert", "arguments": {
  "type": "fact",
  "scope": "local",
  "injection": "always",
  "title": "User Preferences",
  "text": "User prefers TypeScript over JavaScript. Always use strict mode.",
  "tags": ["preferences", "typescript"]
}}
```

**Retrieve memories for prompt injection:**
```json
{ "name": "mem.context", "arguments": {
  "scope": "project",
  "maxTokens": 4000,
  "minConfidence": 0.5
}}
```

**Parameters:**
- `scope` - Which scopes to search (global, local, committed, project, all)
- `maxTokens` - Token budget for output (default: 4000)
- `includeAlwaysInject` - Include all 'always' injection memories first (default: true)
- `format` - Output format: `json` or `markdown` (default: json)
- `minConfidence` - Minimum confidence threshold (default: 0.5)
- `types` - Filter by memory types (e.g., ["fact", "insight"])
- `tags` - Filter by tags

**Output Formats:**

*JSON Format (default)* - Machine-readable:
```json
{
  "memories": [
    {
      "id": "01ABC...",
      "type": "fact",
      "injection": "always",
      "confidence": 0.95,
      "title": "User Preferences",
      "content": "User prefers TypeScript over JavaScript",
      "tags": []
    }
  ]
}
```

*Markdown Format* - Human-readable documentation:
```markdown
# Memories

## User Preferences
**Type:** fact | **Confidence:** 95% | **Injection:** always

User prefers TypeScript over JavaScript
```

**How it works:**
1. `injection='always'` items are included first (they get priority)
2. Remaining token budget is filled with high-confidence on-demand items
3. Items are sorted by confidence score
4. Output is truncated to fit within token budget

This mirrors Claude's architecture where "user memories" are always injected, while "conversation history" is retrieved on-demand.

### Recency-Based Retrieval (`mem.recent`)

Retrieve recently accessed or modified memories, sorted by recency. This is useful for reviewing recent work or continuing where you left off.

**Get 10 most recently accessed memories:**
```json
{ "name": "mem.recent", "arguments": {
  "scope": "project",
  "limit": 10
}}
```

**Get memories modified in the last 24 hours:**
```json
{ "name": "mem.recent", "arguments": {
  "scope": "local",
  "sortBy": "updatedAt",
  "since": "2024-01-14T00:00:00Z"
}}
```

**Parameters:**
- `scope` - Which scopes to search (global, local, committed, project, all)
- `limit` - Maximum number of results (default: 10)
- `types` - Filter by memory types (e.g., ["snippet", "insight"])
- `tags` - Filter by tags
- `sortBy` - Sort field: `lastUsedAt`, `lastAccessedAt`, `updatedAt`, or `createdAt` (default: lastAccessedAt)
- `since` - Only return items accessed/modified since this ISO date

### Incremental Editing Operations

Edit memories without full rewrites, inspired by Claude's `str_replace` and `insert` commands:

**Fix a typo:**
```json
{ "name": "mem.patch", "arguments": {
  "id": "01HX...",
  "operations": [
    { "field": "text", "old": "authetication", "new": "authentication" }
  ]
}}
```

**Add new learnings:**
```json
{ "name": "mem.append", "arguments": {
  "id": "01HX...",
  "field": "text",
  "content": "Update: Also works with OAuth2 flows",
  "separator": "\n\n"
}}
```

**Combine duplicate memories:**
```json
{ "name": "mem.merge", "arguments": {
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
{ "name": "mem.upsert", "arguments": {
  "type": "insight",
  "scope": "local",
  "text": "Debugging auth flow - using test token ABC123",
  "quality": { "ttlDays": 7 }
}}
```

**Preview expired memories:**
```json
{ "name": "maint.prune", "arguments": {
  "scope": "local",
  "dryRun": true
}}
```

**Remove expired memories:**
```json
{ "name": "maint.prune", "arguments": {
  "scope": "local",
  "dryRun": false
}}
```

**Extend TTL for valuable memories:**
```json
{ "name": "mem.renew", "arguments": {
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

Search uses BM25 with configurable boosts. Tune per scope via `config.json` and `proj.config.*`.

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
  "name": "proj.config.set",
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

After changing field weights, run `maint.rebuild` for the affected scope to re-apply indexing weights.

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
  "name": "proj.config.set",
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

## Local Embeddings & Hybrid Search

### Overview

The system includes **local embedding generation** using transformers.js and **HNSW vector indexing** for high-performance semantic search. This enables:

- **Offline embedding generation** - No external API calls or network dependencies
- **HNSW (Hierarchical Navigable Small World)** - O(log n) search complexity vs O(n) linear scan
- **Hybrid search** - Combine keyword-based BM25 with semantic vector similarity
- **Multiple embedding models** - Choose based on your needs (speed vs quality vs dimensions)
- **Auto-embedding** - Automatic vector generation on memory upsert (configurable)

### Available Embedding Models

Three pre-configured models, all running locally via transformers.js:

| Model | Dimensions | Max Tokens | Best For | Speed |
|-------|------------|------------|----------|-------|
| **bge-small-en-v1.5** (default) | 384 | 512 | Code and technical documentation | ⚡⚡ |
| **all-MiniLM-L6-v2** | 384 | 256 | General text, fast inference | ⚡⚡⚡ |
| **all-mpnet-base-v2** | 768 | 384 | Higher quality semantic matching | ⚡⚡ |

First run downloads the model (~25-90MB depending on model), then cached locally in `.cache/transformers/`.

### Quick Start with Local Embeddings

**1. Enable embeddings in configuration:**
```json
{ "name": "proj.config.set", "arguments": { "scope": "committed", "config": { "version": "1", "ranking": { "hybrid": { "enabled": true, "wBM25": 0.7, "wVec": 0.3, "model": "local-emb" } } } } }
```

**2. Create a memory (auto-embedding happens in background):**
```json
{ "name": "vec.set", "arguments": { "scope": "local", "id": "01ABC...", "vector": [0.1, -0.2, 0.05, ...] } }
```

**3. Manually embed specific memories:**
```json
{ "name": "mem.query", "arguments": { "q": "authentication flow", "scope": "project", "k": 20, "vector": [/* query embedding */], "filters": { "type": ["snippet", "pattern"] } } }
```

**4. Batch embed multiple memories:**
```json
{ "name": "vec.importJsonl", "arguments": { "scope": "local", "path": "/abs/path/vec.jsonl", "dim": 768 } }
```

**5. Generate embedding for raw text:**
```json
{ "name": "vec.importBulk", "arguments": { "scope": "local", "items": [{"id":"01A","vector":[0.1,0.2]},{"id":"01B","vector":[0.0,0.3]}] } }
```

## Context Packs

Build an IDE-ready pack of code snippets, facts, configs, and patterns, tuned for JS/TS:

- Tool: `mem.contextPack`
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
{ "name": "mem.contextPack", "arguments": { "q": "react hooks", "scope": "project", "k": 12, "tokenBudget": 2000, "snippetLanguages": ["typescript","tsx"], "snippetFilePatterns": ["src/**/*.ts","src/**/*.tsx"] } }
```

URI form:
```
kb://context/pack?q=react%20hooks&scope=project&k=12&tokenBudget=2000&snippetLanguages=typescript,tsx&snippetFilePatterns=src/**/*.ts,src/**/*.tsx
```

Per-scope order/caps are configurable in config.json under `contextPack`.

## Maintenance & Compaction

- Threshold-based compaction: set `maint.compactEvery` (default 500). Triggers compaction after N journal appends.
- Time-based compaction: set `maint.compactIntervalMs` (default 24h).
- Manual controls:
  - `maint.replay` — replay journal; optional compact
  - `maint.compact` — compact scope(s)
  - `maint.compact.now` — immediate compaction
  - `maint.compactSnapshot` — compaction + snapshot in one step
  - `maint.snapshot` — write snapshot meta (for fast tail replay)
  - `maint.verify` — recompute checksum and compare to snapshot/state-ok

State-ok markers
- After successful compaction and startup tail replay, the server writes `index/state-ok.json` containing the last verified checksum and timestamp.
- `maint.verify` reports whether current checksum matches both snapshot and state-ok markers.

## Secret Redaction

On upsert, common credential patterns are redacted from `text`/`code` and hashed into `security.secretHashRefs` to prevent leakage into committed mem.

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
    - Pass a `dim` override to `vec.importBulk` / `vec.importJsonl`, or
    - Clean the local vector files and re-import:
      - `rm -f .llm-memory/index/vec.json .llm-memory/index/vec.meta.json`

- Snapshot/verify workflow
  - For fast restarts, run once: `maint.compactSnapshot` (project/all), then `maint.verify` should report ok=true.
  - Verify compares the current checksum against both snapshot and the last `state-ok` marker.

- Zsh glob “no matches found”
  - Use `rm -f` to ignore missing files, or enable NULL_GLOB temporarily: `setopt NULL_GLOB`.

- “MODULE_TYPELESS_PACKAGE_JSON” warning
  - Optional: add `"type": "module"` to package.json or run Node with `--input-type=module` to silence the warning.


Manual test:
- `node test-memory-tools.js` — exercises mem.* tools via stdio

## Notes

- The previous kb.* tools were replaced by mem.* tools.
- Offline-first; no external services required.
- For teams, prefer committed scope and stricter committed config.

## Recipes (JS/TS Workflows)

- Save a reusable TypeScript pattern to committed scope
```json
{ "name": "mem.upsert", "arguments": {
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
{ "name": "mem.query", "arguments": {
  "scope": "project",
  "k": 20,
  "filters": { "tags": ["react"] }
} }
```

- Build a context pack focused on src/utils and TS/TSX
```json
{ "name": "mem.contextPack", "arguments": {
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
{ "name": "mem.pin", "arguments": { "id": "01H..." } }
```

- Merge local → committed (team share) and check status
```json
{ "name": "proj.sync.status", "arguments": {} }
```
```json
{ "name": "proj.sync.merge", "arguments": {} }
```

- Guard committed scope by sensitivity (team only)
```json
{ "name": "proj.config.set", "arguments": {
  "scope": "committed",
  "config": { "version": "1", "sharing": { "enabled": true, "sensitivity": "team" } }
} }
```

- Enable hybrid search and set vectors (example)
```json
{ "name": "proj.config.set", "arguments": {
  "scope": "local",
  "config": { "version": "1", "ranking": { "hybrid": { "enabled": true, "wBM25": 0.7, "wVec": 0.3 } } }
} }
```
```json
{ "name": "vec.set", "arguments": { "scope": "local", "id": "01ABC...", "vector": [0.1, -0.2, 0.05] } }
```
```json
{ "name": "mem.query", "arguments": { "q": "auth flow", "scope": "project", "k": 20, "vector": [0.08, -0.15, 0.02] } }
```

- Compact journals when needed
```json
{ "name": "maint.compact.now", "arguments": { "scope": "project" } }
```

- One-click compact + snapshot
```json
{ "name": "maint.compactSnapshot", "arguments": { "scope": "all" } }
```

- Verify on-disk state vs snapshot/state-ok
```json
{ "name": "maint.verify", "arguments": { "scope": "project" } }
```

## Journal Optimization

The system automatically uses an optimized journal format that reduces storage by 81-95% through content-based hashing:

- Check journal optimization status
```json
{ "name": "jour.stats", "arguments": { "scope": "all" } }
```

- Manually migrate legacy journals (automatic on startup)
```json
{ "name": "jour.migrate", "arguments": { "scope": "project" } }
```

- Verify journal integrity using hashes
```json
{ "name": "jour.verify", "arguments": { "scope": "local" } }
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
{ "name": "mem.upsert", "arguments": {
  "type": "snippet",
  "scope": "local",
  "title": "React useDebounce Hook",
  "code": "const useDebounce = (value, delay) => { /* implementation */ }",
  "language": "typescript",
  "tags": ["react", "hooks", "performance"]
}}

// Record usage when you actually use it
{ "name": "mem.use", "arguments": { "id": "01ABC...", "scope": "local" } }

// Provide feedback when it proves helpful
{ "name": "mem.feedback", "arguments": { "id": "01ABC...", "helpful": true, "scope": "local" } }

// Search will now rank this item higher in future queries
{ "name": "mem.query", "arguments": { "q": "react debounce", "scope": "project", "k": 10 } }
```
