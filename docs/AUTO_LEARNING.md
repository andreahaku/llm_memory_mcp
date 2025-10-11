# Auto-Learning System

The Auto-Learning system automatically captures development knowledge from git commits and integrates it into the LLM Memory MCP server.

## Overview

When you tag commits with `#kb`, the system automatically:
1. Captures the commit message, diff, and metadata
2. Extracts code symbols and patterns
3. Materializes the knowledge into searchable memories
4. Makes it available through the MCP server

## Architecture

### Core Components

**AutoLearner** (`src/autolearn/AutoLearner.ts`)
- Captures and processes development events
- Materializes events into MemoryItems
- Applies filters and classification
- Detects patterns across multiple commits

**GitHooksManager** (`src/autolearn/GitHooksManager.ts`)
- Installs git hooks (`commit-msg`, `post-commit`)
- Parses commit messages for #kb tags
- Queues commits in `.llm-memory/autolearn-queue.ndjson`
- Extracts symbols and metadata from commits

**ClaudeCodeHooksManager** (`src/autolearn/ClaudeCodeHooks.ts`)
- Installs Claude Code hooks (session-start, post-commit, pre-response)
- Copies from project `/hooks/` directory
- Supports both project and global installation
- Auto-triggers dev-memory-manager agent

**ClaudeCodeAgentsManager** (`src/autolearn/ClaudeCodeAgents.ts`)
- Installs dev-memory-manager agent
- Copies from project `/agents/` directory
- Supports both project and global installation

**AutoLearnManager** (`src/autolearn/AutoLearnManager.ts`)
- Central coordinator for all auto-learning components
- Handles initialization and orchestration
- Provides unified interface for MCP tools

## Installation

### Automatic (Recommended)
When the MCP server connects to a project, it automatically installs hooks and agents at the project level.

### Manual Installation
```bash
# Install at project level
pnpm run install-hooks

# Install globally (applies to all projects)
pnpm run install-hooks:global
```

## Usage

### Basic Workflow

1. **Make a commit with #kb tag:**
   ```bash
   git commit -m "Implement JWT authentication #kb #security"
   ```

2. **Commit is queued:**
   The `post-commit` hook captures the commit and adds it to `.llm-memory/autolearn-queue.ndjson`

3. **Process the queue:**
   Use the dev-memory-manager agent or MCP tools to process queued events:
   ```typescript
   // Via MCP tool
   autolearn.processQueue()
   ```

4. **Knowledge is searchable:**
   The captured knowledge becomes part of your memory system and appears in search results.

### Advanced Usage

**Manual Event Capture:**
```typescript
// Capture a specific commit
autolearn.captureCommit('HEAD')

// Capture custom event
autolearn.captureEvent({
  type: 'fix',
  timestamp: new Date().toISOString(),
  context: {
    files: ['src/auth.ts'],
    symbols: ['verifyToken'],
    summary: 'Fixed JWT expiration check',
    tags: ['auth', 'security'],
    diff: '...'
  },
  success: true
})
```

**Check Status:**
```typescript
autolearn.getStatus()
```

**Install Globally:**
```typescript
autolearn.installGlobally()
```

## Configuration

Auto-learning can be configured via the `AutoLearnConfig`:

```typescript
{
  enabled: true,
  captureTypes: ['commit', 'fix', 'refactor', 'pattern'],
  gitHooks: {
    enabled: true,
    tagPattern: '#kb',
    captureDiffs: true,
    maxDiffSize: 10000
  },
  filters: {
    minLinesChanged: 5,
    includePatterns: ['**/*.ts', '**/*.js'],
    excludePatterns: ['**/node_modules/**', '**/dist/**']
  },
  storage: {
    autoCommit: false,
    scope: 'local',
    defaultType: 'snippet'
  },
  insights: {
    enabled: true,
    minOccurrences: 3
  }
}
```

## Project Structure

```
/hooks/                          # Claude Code hook markdown files
  session-start.md              # Session initialization hook
  post-commit.md                # Commit notification hook
  pre-response.md               # Knowledge retrieval hook

/agents/                         # Claude Code agent markdown files
  dev-memory-manager.md         # Enhanced agent with auto-learning

/src/autolearn/
  AutoLearner.ts                # Core event processing
  AutoLearnManager.ts           # Central coordinator
  GitHooksManager.ts            # Git hook installation
  ClaudeCodeHooks.ts            # Claude Code hook installation
  ClaudeCodeAgents.ts           # Agent installation

/src/types/
  AutoLearning.ts               # Type definitions

/.git/hooks/                     # Installed git hooks
  commit-msg                    # Detects #kb tags
  post-commit                   # Captures commits

/.claude/hooks/                  # Installed Claude Code hooks (project)
  session-start.md
  post-commit.md
  pre-response.md

/.claude/agents/                 # Installed agents (project)
  dev-memory-manager.md

~/.claude/hooks/                 # Global hooks (optional)
~/.claude/agents/                # Global agents (optional)
```

## Hook Files

Hook and agent markdown files in `/hooks/` and `/agents/` serve as:
- **Source of truth** for installations
- **Easy to edit** without recompiling
- **Version controlled** with your project
- **Shareable** across team members

When hooks/agents are installed, the system copies from these source files.

## Memory Types

Auto-learned events are classified into memory types:

- **snippet**: Code examples (tests, implementations)
- **insight**: Bug fixes and lessons learned
- **pattern**: Architectural patterns and refactorings
- **fact**: Project constraints and requirements
- **runbook**: Procedures and workflows

## Integration with dev-memory-manager Agent

The enhanced dev-memory-manager agent:
- Checks for queued events on session start
- Processes and presents captured knowledge
- Suggests adding #kb tags to important commits
- Ensures hooks and agents are installed
- Provides seamless auto-learning workflow

## Best Practices

1. **Tag Important Commits**: Use `#kb` on commits that contain reusable knowledge
2. **Add Context Tags**: Include additional hashtags for better categorization
   ```bash
   git commit -m "Add rate limiting middleware #kb #security #performance"
   ```
3. **Review Queue Regularly**: Process the queue to keep knowledge fresh
4. **Global Installation**: Install globally for consistent experience across projects
5. **Edit Source Files**: Modify `/hooks/` and `/agents/` files to customize behavior

## Troubleshooting

**Hooks not triggering?**
- Check hooks are installed: `ls -la .git/hooks/ | grep -E '(commit-msg|post-commit)'`
- Verify executable permissions: `chmod +x .git/hooks/commit-msg .git/hooks/post-commit`
- Check `.git/llm-memory-autolearn.tmp` is created after committing with #kb

**Queue not processing?**
- Verify queue file exists: `cat .llm-memory/autolearn-queue.ndjson`
- Check MCP server logs for errors
- Use `autolearn.getStatus()` to check system state

**Agents not active?**
- Check agent is installed: `ls -la .claude/agents/`
- Verify frontmatter has `enabled: true`
- Restart Claude Code to reload agents

## Future Enhancements

- [ ] IDE integration hooks (VS Code, Cursor)
- [ ] Pattern detection from multiple commits
- [ ] Smart tagging suggestions based on diff analysis
- [ ] Automatic documentation generation
- [ ] Team knowledge sharing workflows
- [ ] Integration with PR reviews

## Related Documentation

- [API Reference](./API_REFERENCE.md) - MCP tools documentation
- [Architecture](./ARCHITECTURE.md) - System design details
- [Memory Types](./CLAUDE.md) - Memory system overview
