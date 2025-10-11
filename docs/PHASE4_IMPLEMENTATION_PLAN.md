# Phase 4 Implementation Plan

**Date:** 2025-10-11
**Status:** Planning
**Current Branch:** `refactor/phase4-concurrency-hardening`

## Executive Summary

This document outlines the implementation plan for Phase 4 improvements to the LLM Memory MCP server. It includes completed work, in-progress tasks, and a detailed roadmap for remaining features.

---

## Progress Overview

### ✅ Completed (1/6 tasks)

#### 1. Legacy Cleanup ✅ **MERGED** (PR #12)
- **Status:** Complete and merged to main
- **Branch:** `refactor/phase4-legacy-cleanup`
- **Lines Changed:** +69, -4 (5 files)
- **Achievements:**
  - Moved all legacy code to `src/legacy/` directory
  - Added comprehensive `@deprecated` notices
  - Created `src/legacy/README.md` with migration guide
  - Updated `.gitignore` to exclude test artifacts
  - Maintained backward compatibility
- **Impact:** Clear separation between modern (Memory) and legacy (Note) systems
- **Review Score:** 9/10 (approved with minor fixes)

### 🔄 In Progress (1/6 tasks)

#### 2. Concurrency Hardening ⚠️ **CRITICAL**
- **Status:** Analysis complete, implementation pending
- **Branch:** `refactor/phase4-concurrency-hardening` (created, clean)
- **Priority:** HIGH - Critical for production reliability

**Analysis Findings:**
```typescript
Current Issues Identified:
1. ❌ Lock file writes are NOT atomic (race condition possible)
   - Location: src/storage/fileStore.ts:82-84
   - Risk: Multiple processes could acquire same lock simultaneously

2. ❌ Hard-coded 30-second staleness timeout
   - Location: src/storage/fileStore.ts:66
   - Risk: May be too short for long operations, too long for crashed processes

3. ⚠️ Inconsistent try/finally usage
   - Some operations acquire locks without guaranteed release
   - Risk: Deadlocks if exceptions occur

4. ❌ Missing index locks for some operations
   - Index updates happen without locking
   - Risk: Corrupted index from concurrent writes

5. ❌ No PID validation or force-unlock capability
   - Stale locks from crashed processes require manual cleanup
```

**Planned Implementation:**

```typescript
// 1. Atomic Lock Acquisition with Exclusive Flags
import { open } from 'fs/promises';

private async acquireLockAtomic(name: string): Promise<void> {
  const lockPath = this.getLockPath(name);
  const now = Date.now();
  const config = this.getLockConfig();

  try {
    // Try to create lock file with exclusive flag (atomic)
    const fd = await open(lockPath, 'wx'); // 'w' = write, 'x' = exclusive

    const lockData = {
      pid: process.pid,
      acquired: now,
      hostname: os.hostname()
    };

    await fd.writeFile(JSON.stringify(lockData));
    await fd.close();

    this.locks.set(name, { path: lockPath, acquired: now });
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      // Lock file exists - check if stale
      await this.handleExistingLock(lockPath, name, config);
    } else {
      throw error;
    }
  }
}

// 2. Configurable Lock Policies
interface LockConfig {
  stalenessMs: number;      // default: 30000
  maxRetries: number;       // default: 3
  retryDelayMs: number;     // default: 100
  forceUnlockEnabled: boolean; // default: true
  validatePid: boolean;     // default: true
}

// 3. Comprehensive Try/Finally Audit
// BEFORE:
this.acquireLock('catalog');
const catalog = this.readCatalog();
this.writeCatalog(catalog);
this.releaseLock('catalog');

// AFTER:
await this.acquireLockAtomic('catalog');
try {
  const catalog = this.readCatalog();
  this.writeCatalog(catalog);
} finally {
  await this.releaseLockAtomic('catalog');
}
```

**Effort Estimate:** 4-6 hours
- 2 hours: Implement atomic locking with proper error handling
- 1 hour: Add configurable lock policies
- 1 hour: Audit and fix all lock acquisition sites
- 1-2 hours: Testing and validation

**Dependencies:** None

**Risks:**
- Breaking change if lock behavior changes significantly
- Need thorough testing for race conditions
- Performance impact of async locks

---

### ⏳ Pending (4/6 tasks)

#### 3. Async I/O Migration 🔧 **TECHNICAL DEBT**
- **Priority:** MEDIUM-HIGH
- **Effort:** 6-8 hours
- **Dependencies:** Should be done AFTER concurrency hardening

**Scope:**
```typescript
Current Sync Operations to Convert:
1. src/storage/fileStore.ts
   - readFileSync → readFile (promises)
   - writeFileSync → writeFile (promises)
   - appendFileSync → appendFile (promises)
   - unlinkSync → unlink (promises)
   - renameSync → rename (promises)
   - existsSync → access() or try/catch

2. src/legacy/KnowledgeStore.ts
   - Keep as-is (legacy code, minimal changes)

3. Potential places:
   - ScopeResolver (git operations)
   - Video/QR operations (may already be async)
```

**Benefits:**
- Non-blocking I/O (critical for server performance)
- Better error handling
- Proper async/await patterns
- Scalability improvements

**Approach:**
1. Create async wrappers for all sync operations
2. Update method signatures to async
3. Update callers with await
4. Add proper error handling
5. Test performance improvements

**Testing Strategy:**
- Benchmark before/after for common operations
- Concurrent operation stress tests
- Error recovery scenarios

---

#### 4. Auto-Learning Hooks 🚀 **HIGH VALUE**
- **Priority:** HIGH (biggest UX improvement)
- **Effort:** 12-16 hours (major feature)
- **Dependencies:** None (standalone feature)

**Feature Design:**

```typescript
// 1. IDE Assistant Event Interception
interface AutoLearnEvent {
  type: 'fix' | 'refactor' | 'test' | 'commit';
  context: {
    files: string[];
    symbols: string[];
    diff?: string;
    success: boolean;
    metadata?: Record<string, any>;
  };
}

// 2. Git Hooks Integration
// Install hooks on project.initCommitted
.llm-memory/hooks/
  commit-msg     # Parse #kb tags
  post-commit    # Capture commit diffs
  pre-push       # (optional) Sync memories

// 3. Memory Materialization
class AutoLearner {
  async captureSuccessfulFix(event: AutoLearnEvent): Promise<string> {
    // Create 'insight' or 'pattern' memory
    const memory = {
      type: 'insight',
      title: `Fixed: ${event.context.summary}`,
      text: this.generateInsight(event),
      code: event.context.diff,
      facets: {
        tags: ['auto-learned', 'fix', ...event.context.tags],
        files: event.context.files,
        symbols: event.context.symbols
      }
    };

    return await memoryManager.upsert(memory);
  }
}

// 4. Configuration
interface AutoLearnConfig {
  enabled: boolean;
  captureTypes: ('fix' | 'refactor' | 'test' | 'commit')[];
  gitHooks: {
    enabled: boolean;
    tagPattern: string;  // default: '#kb'
    captureCommitDiffs: boolean;
  };
  filters: {
    minLinesChanged: number;
    includePatterns: string[];
    excludePatterns: string[];
  };
  storage: {
    autoCommit: boolean;  // commit to .llm-memory/?
    scope: 'local' | 'committed';
  };
}
```

**Implementation Phases:**
1. **Phase 4a:** Git hooks integration (4 hours)
   - Create hook installer
   - Implement commit message parser
   - Add diff capture

2. **Phase 4b:** Event capture API (4 hours)
   - Design event schema
   - Create AutoLearner class
   - Add memory materialization logic

3. **Phase 4c:** IDE integration hooks (4 hours)
   - MCP prompt for "save successful fix"
   - LSP integration points (future)

4. **Phase 4d:** Testing & docs (2-4 hours)
   - Test git hooks
   - Example workflows
   - User documentation

**User Stories:**
```
As a developer,
When I fix a bug and commit with "#kb Fix auth timeout"
Then a memory is automatically created capturing the fix

As a developer,
When I successfully refactor code using Claude Code
Then I can save it as a pattern with one command

As a team member,
When I pull latest .llm-memory/
Then I see patterns from teammates' successful fixes
```

---

#### 5. Attachments & Symbols 🔍 **DEEP INTEGRATION**
- **Priority:** MEDIUM (powerful but complex)
- **Effort:** 16-20 hours (major feature)
- **Dependencies:** Requires LSP or tree-sitter integration

**Feature Design:**

```typescript
// 1. Symbol Attachment
interface SymbolReference {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable';
  file: string;
  range: { start: number; end: number };
  signature?: string;
  documentation?: string;
}

// 2. File Attachment
interface FileAttachment {
  uri: string;  // relative path or attachment://
  mimeType: string;
  size: number;
  hash: string;
  embedded: boolean;  // true = stored in attachments/, false = reference
}

// 3. Memory Schema Extension
interface MemoryItem {
  // ... existing fields
  attachments?: FileAttachment[];
  symbols?: SymbolReference[];
}

// 4. LSP Integration (if available)
class SymbolExtractor {
  async extractFromLSP(file: string): Promise<SymbolReference[]> {
    // Query LSP for symbols in file
    // Extract function signatures, classes, etc.
  }

  async extractFromTreeSitter(file: string, language: string): Promise<SymbolReference[]> {
    // Fallback: use tree-sitter for parsing
  }
}

// 5. Attachment Storage
<scope-root>/
  attachments/
    <hash>.bin      # Binary files
    <hash>.txt      # Text files
    <hash>.meta     # Metadata JSON
```

**Implementation Phases:**
1. **Phase 5a:** Schema & storage (4 hours)
   - Extend MemoryItem types
   - Add attachments directory
   - Implement file storage/retrieval

2. **Phase 5b:** Symbol extraction (6-8 hours)
   - Tree-sitter integration
   - Basic symbol parsing (TS/JS/Python)
   - Symbol reference resolution

3. **Phase 5c:** MCP tools (2-3 hours)
   - `memory.attachFile` tool
   - `memory.attachSymbol` tool
   - `memory.getAttachment` tool

4. **Phase 5d:** LSP integration (4-5 hours) - Optional
   - Connect to active LSP servers
   - Query for symbol definitions
   - Auto-populate symbol info

**Challenges:**
- LSP integration is environment-dependent
- Tree-sitter adds binary dependencies
- Large file attachments (need size limits)
- Cross-platform path handling

**Alternative Approach (Simpler):**
Start with manual symbol references (strings) and file paths, defer LSP integration:
```typescript
// Simpler initial version
interface MemoryItem {
  facets: {
    symbols: string[];  // just names, no full metadata
    files: string[];    // paths only
  }
}
```

---

#### 6. Import/Export 📦 **ESSENTIAL UTILITY**
- **Priority:** MEDIUM-HIGH (enables backup/portability)
- **Effort:** 6-8 hours
- **Dependencies:** None

**Feature Design:**

```typescript
// 1. Export Formats
type ExportFormat = 'ndjson' | 'json' | 'tarball' | 'markdown';

interface ExportOptions {
  format: ExportFormat;
  scope: 'global' | 'local' | 'committed' | 'all';
  filters?: {
    types?: MemoryType[];
    tags?: string[];
    dateRange?: { start: string; end: string };
  };
  includeIndex?: boolean;
  includeVectors?: boolean;
  includeAttachments?: boolean;
  compress?: boolean;
}

// 2. Import with Validation
interface ImportOptions {
  targetScope: MemoryScope;
  validateSchema?: boolean;
  skipExisting?: boolean;
  generateNewIds?: boolean;  // avoid ID conflicts
  onConflict?: 'skip' | 'overwrite' | 'rename';
}

// 3. MCP Tools
{
  name: 'memory.export',
  inputSchema: {
    format: 'ndjson' | 'json' | 'tarball' | 'markdown',
    outputPath: string,
    scope: 'global' | 'local' | 'committed' | 'all',
    filters: { ... },
    options: ExportOptions
  }
}

{
  name: 'memory.import',
  inputSchema: {
    inputPath: string,
    format: 'auto' | 'ndjson' | 'json' | 'tarball',
    targetScope: 'global' | 'local' | 'committed',
    options: ImportOptions
  }
}

// 4. Backup Scheduling (Future)
interface BackupConfig {
  enabled: boolean;
  schedule: string;  // cron expression
  destination: string;
  retention: {
    daily: number;
    weekly: number;
    monthly: number;
  };
}
```

**Implementation Phases:**
1. **Phase 6a:** NDJSON export/import (3 hours)
   - Read all items from scope
   - Write to NDJSON file
   - Import with validation

2. **Phase 6b:** Tarball format (2 hours)
   - Package items/ + catalog + index
   - Use tar/tar.gz
   - Preserve directory structure

3. **Phase 6c:** Markdown export (2 hours)
   - Convert to human-readable format
   - Use MarkdownConverter
   - One file per memory

4. **Phase 6d:** Validation & conflict handling (1-2 hours)
   - Schema validation
   - ID conflict resolution
   - Error reporting

**User Stories:**
```
As a developer,
When I run memory.export with scope='all'
Then I get a portable backup of all my memories

As a team lead,
When I export committed memories as markdown
Then I can review team knowledge in any editor

As a user,
When I switch machines
Then I can import my global memories and continue working
```

---

## Recommended Execution Order

### Sprint 1: Foundation (Week 1)
**Goal:** Harden core reliability

1. ✅ **Legacy Cleanup** (DONE - PR #12 merged)
2. 🔄 **Concurrency Hardening** (4-6 hours)
   - Atomic locks
   - Try/finally audit
   - Configurable policies
3. **Async I/O Migration** (6-8 hours)
   - Convert sync operations
   - Performance testing

**Deliverable:** Production-ready storage layer

### Sprint 2: Essential Features (Week 2)
**Goal:** Enable backup and portability

4. **Import/Export** (6-8 hours)
   - NDJSON format
   - Tarball support
   - Validation

**Deliverable:** Users can backup/restore memories

### Sprint 3: High-Value Features (Week 3-4)
**Goal:** Maximize developer productivity

5. **Auto-Learning Hooks** (12-16 hours)
   - Git hooks (Phase 4a)
   - Event capture (Phase 4b)
   - IDE integration (Phase 4c)
   - Testing (Phase 4d)

**Deliverable:** Automatic knowledge capture workflow

### Sprint 4: Advanced Features (Future)
**Goal:** Deep IDE integration

6. **Attachments & Symbols** (16-20 hours)
   - Start with simple version (manual references)
   - Tree-sitter integration
   - LSP integration (optional)

**Deliverable:** Rich code context in memories

---

## Priority Matrix

| Task | Impact | Effort | Priority | Rationale |
|------|--------|--------|----------|-----------|
| Concurrency Hardening | 🔴 High | Medium | **P0** | Critical for production reliability |
| Async I/O | 🟡 Medium | Medium | **P1** | Performance & scalability |
| Import/Export | 🟢 High | Medium | **P1** | Essential utility, enables backups |
| Auto-Learning | 🟢 High | High | **P2** | Biggest UX win, but complex |
| Attachments | 🟡 Medium | Very High | **P3** | Powerful but complex, defer |

---

## Risk Assessment

### High Risk Items

1. **Concurrency Hardening**
   - Risk: Breaking existing locking behavior
   - Mitigation: Comprehensive testing, gradual rollout
   - Test: Run concurrent write tests

2. **Async I/O Migration**
   - Risk: Performance regression
   - Mitigation: Benchmark before/after
   - Test: Stress test with large datasets

### Medium Risk Items

3. **Auto-Learning Hooks**
   - Risk: Git hooks interfere with workflow
   - Mitigation: Make fully optional, easy disable
   - Test: Test with real git workflows

4. **Import/Export**
   - Risk: Data loss during import
   - Mitigation: Validation, dry-run mode
   - Test: Export-import round-trip tests

### Dependencies & Blockers

- **Concurrency → Async I/O**: Locking must be fixed before making async
- **None → Import/Export**: Standalone feature
- **None → Auto-Learning**: Standalone feature
- **All → Attachments**: Benefits from stable foundation

---

## Success Metrics

### Sprint 1 (Foundation)
- ✅ All locks use try/finally
- ✅ Zero race condition test failures
- ✅ No performance regression
- ✅ 100% async I/O (no sync operations)

### Sprint 2 (Essential Features)
- ✅ Export/import round-trip test passes
- ✅ User can backup and restore memories
- ✅ Documentation updated

### Sprint 3 (High-Value Features)
- ✅ Git hooks capture commits with #kb tag
- ✅ Auto-learned memories stored correctly
- ✅ User testing: 3+ developers use successfully

### Sprint 4 (Advanced Features)
- ✅ Symbols extracted from 3+ languages
- ✅ File attachments work with size limits
- ✅ LSP integration (optional, nice-to-have)

---

## Open Questions

1. **Concurrency:**
   - Should we use advisory locks or exclusive file flags?
   - What should default staleness timeout be?

2. **Async I/O:**
   - Can we maintain backward compat during transition?
   - Should legacy code be converted or left as-is?

3. **Auto-Learning:**
   - Which git hooks to install by default?
   - Should auto-learned memories auto-commit to .llm-memory/?

4. **Attachments:**
   - Size limit for embedded files?
   - Tree-sitter vs LSP for symbol extraction?

5. **Import/Export:**
   - Should we support migrating between storage backends?
   - Compression level for tarball exports?

---

## Next Immediate Steps

### Option A: Continue Current Branch (Concurrency)
```bash
# Complete concurrency hardening on current branch
git checkout refactor/phase4-concurrency-hardening

# Implement:
1. Atomic lock acquisition
2. Try/finally audit
3. Configurable lock policies
4. Testing

# Estimate: 4-6 hours
```

### Option B: Switch to Import/Export (Easier Win)
```bash
# Create new branch for import/export
git checkout main
git pull
git checkout -b feature/phase4-import-export

# Implement:
1. NDJSON export
2. NDJSON import
3. Validation
4. MCP tools

# Estimate: 6-8 hours
```

### Option C: Switch to Auto-Learning (High Value)
```bash
# Create new branch for auto-learning
git checkout main
git pull
git checkout -b feature/phase4-auto-learning

# Implement:
1. Git hooks installer
2. Commit message parser
3. Memory materialization
4. Testing

# Estimate: 12-16 hours
```

---

## Recommendation

**Proposed Plan:**

1. **Complete Concurrency Hardening** (Current sprint)
   - Already started, analysis complete
   - Critical for production
   - 4-6 hours to finish

2. **Quick Win: Import/Export** (Next sprint)
   - High value, moderate effort
   - Enables backups immediately
   - Clean slate (new branch)

3. **Big Feature: Auto-Learning** (Sprint 3)
   - Biggest UX improvement
   - Requires focused effort
   - Can iterate based on feedback

4. **Defer: Attachments & Symbols** (Future)
   - Complex, high effort
   - Lower immediate priority
   - Revisit after gathering requirements

**Rationale:** Balance quick wins with critical reliability improvements.

---

## Conclusion

Phase 4 has strong momentum with 1/6 tasks complete. The foundation is solid, and the remaining work is well-scoped. By focusing on concurrency first, then import/export, then auto-learning, we can deliver production-ready reliability, essential utilities, and high-value features in a logical progression.

**Estimated Total Time:** 28-38 hours across all tasks
**Recommended Focus:** Complete concurrency (4-6 hours), then import/export (6-8 hours)

---

*Document maintained by: Claude Code*
*Last updated: 2025-10-11*
