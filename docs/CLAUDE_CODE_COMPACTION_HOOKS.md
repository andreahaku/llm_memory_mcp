# Claude Code Compaction Hooks — Integration with LLM Memory MCP

## Overview

Claude Code has lifecycle hooks that fire before context compaction (when conversations get too long and earlier messages are compressed). This creates an opportunity to automatically save important session context to LLM Memory before it's lost, and re-inject critical knowledge after compaction.

This document outlines the integration design for future implementation.

---

## Available Hook Events

### PreCompact

Fires right before context is compressed.

**Matchers:**
- `auto` — auto-compaction triggers (context window full)
- `manual` — user runs `/compact`

**Input received (JSON on stdin):**
```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/Users/.../project",
  "permission_mode": "default",
  "hook_event_name": "PreCompact",
  "trigger": "auto",
  "custom_instructions": ""
}
```

**Key field:** `transcript_path` contains the full conversation history as JSONL — this is the raw data to extract context from before it's compressed.

### SessionStart (compact)

Fires after compaction completes and the session resumes.

**Matcher:** `compact`

**Use case:** Re-inject saved context back into Claude's awareness after compaction.

---

## Proposed Integration Architecture

### Phase 1: Pre-Compaction Context Capture

A hook script that runs on `PreCompact` and:

1. Reads the transcript from `transcript_path`
2. Extracts key session context:
   - Current task being worked on (from TodoWrite/TaskCreate calls)
   - Files recently modified (from Edit/Write tool calls)
   - Key decisions made (from user messages and Claude responses)
   - Unresolved issues or blockers
   - API contracts or patterns discovered during the session
3. Saves extracted context to LLM Memory MCP via tool calls:
   - `mem.upsert` with type `insight` or `note`
   - Tagged with `session-context`, `pre-compaction`
   - Scoped to the current project

**Hook config:**
```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/pre-compact-save.sh",
            "timeout": 30,
            "statusMessage": "Saving session context to memory..."
          }
        ]
      }
    ]
  }
}
```

### Phase 2: Post-Compaction Context Restoration

A hook that runs on `SessionStart` (compact) and:

1. Queries LLM Memory for recent session context entries
2. Outputs key reminders as text that gets injected into Claude's context:
   - What task was in progress
   - What files were being modified
   - Key decisions or constraints established
   - Any blockers or open questions

**Hook config:**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "/path/to/post-compact-restore.sh",
            "statusMessage": "Restoring session context from memory..."
          }
        ]
      }
    ]
  }
}
```

### Phase 3: Agent-Based Context Extraction (Advanced)

Instead of a simple shell script, use a `type: "agent"` hook that:

1. Has access to the full transcript
2. Uses an LLM to intelligently summarize the session state
3. Structures the summary into proper memory items with metadata
4. Handles deduplication with existing memories

```json
{
  "hooks": {
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [
          {
            "type": "agent",
            "command": "Analyze this conversation transcript and save the key context (current task, decisions, file changes, blockers) to the LLM Memory MCP. Focus on information that would be lost during compaction and would be needed to continue working effectively.",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

---

## Implementation Considerations

### What to Save

**High value (always save):**
- Current task description and progress
- Files being modified and why
- API contracts discovered (endpoints, field names, response shapes)
- Key architectural decisions made during the session
- Unresolved bugs or blockers with current diagnosis

**Medium value (save if space allows):**
- Patterns discovered in the codebase
- User preferences expressed during the session
- Alternative approaches considered and rejected (with reasons)

**Low value (skip):**
- Routine git operations
- File reads without insights
- Successful operations that don't carry forward

### Memory Item Structure

```typescript
// Suggested memory item for pre-compaction saves
{
  type: "insight",
  scope: "local",
  title: "Session context before compaction",
  text: "Working on: [task]\nFiles: [list]\nDecisions: [list]\nBlockers: [list]",
  facets: {
    tags: ["session-context", "pre-compaction", "auto-saved"],
    files: ["path/to/modified/files"]
  },
  context: {
    repoId: "project-name",
    branch: "current-branch"
  },
  quality: {
    confidence: 0.9  // High confidence, direct from session
  }
}
```

### Transcript Parsing

The `transcript_path` JSONL file contains conversation turns. Key fields to extract:

```jsonl
{"role": "user", "content": "..."}
{"role": "assistant", "content": "...", "tool_calls": [...]}
{"role": "tool", "tool_call_id": "...", "content": "..."}
```

Useful signals:
- `tool_calls` with `Edit`/`Write` → files being modified
- `tool_calls` with `TaskCreate`/`TodoWrite` → current tasks
- User messages with corrections → important constraints
- Assistant messages with analysis → decisions and insights

### Deduplication

When saving pre-compaction context:
- Query existing memories tagged `session-context` for the same project
- If a recent one exists (< 1 hour), update it instead of creating a new one
- Use `mem.upsert` with the existing ID to overwrite
- Automatically expire session-context memories after 24 hours (they're transient)

### Performance

- `PreCompact` hook must complete within timeout (suggest 30s)
- Transcript can be large — parse only the last N messages (e.g., last 50)
- Use async writes to memory if possible
- Don't block compaction if memory save fails (graceful degradation)

---

## Integration with Existing Auto-Learning

This feature complements the existing auto-learning system:

| Feature | Trigger | What it captures |
|---------|---------|-----------------|
| Auto-learning (git hooks) | Git commits | Code changes, commit knowledge |
| **Pre-compaction hooks** | Context window full | Session state, in-progress work |
| dev-memory-manager agent | Manual / proactive | Curated development knowledge |

The three systems together provide continuous knowledge capture:
1. **During development** → dev-memory-manager captures insights
2. **Before context loss** → PreCompact hook saves session state
3. **After commits** → Auto-learning captures code change knowledge

---

## MCP Server Changes Needed

### New Tool: `mem.session.save`

A convenience tool specifically for session context that:
- Accepts structured session data (task, files, decisions, blockers)
- Auto-tags with `session-context` and timestamp
- Handles deduplication automatically
- Sets auto-expiry (configurable, default 24h)

```typescript
{
  name: "mem.session.save",
  inputSchema: {
    type: "object",
    properties: {
      task: { type: "string", description: "Current task being worked on" },
      files: { type: "array", items: { type: "string" }, description: "Files being modified" },
      decisions: { type: "array", items: { type: "string" }, description: "Key decisions made" },
      blockers: { type: "array", items: { type: "string" }, description: "Unresolved issues" },
      notes: { type: "string", description: "Additional context" }
    }
  }
}
```

### New Tool: `mem.session.restore`

Retrieves the most recent session context for the current project:

```typescript
{
  name: "mem.session.restore",
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", default: 1, description: "Number of recent sessions to restore" }
    }
  }
}
```

---

## File Locations for Implementation

```
llm_memory_mcp/
├── src/
│   ├── tools/
│   │   └── sessionTools.ts          # mem.session.save / mem.session.restore
│   └── hooks/
│       ├── preCompactHandler.ts     # Transcript parsing + context extraction
│       └── postCompactHandler.ts    # Context restoration output
├── hooks/
│   ├── pre-compact-save.sh          # Shell hook for settings.json
│   └── post-compact-restore.sh      # Shell hook for SessionStart
└── docs/
    └── CLAUDE_CODE_COMPACTION_HOOKS.md  # This document
```
