# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an LLM Memory MCP (Model Context Protocol) Server that provides persistent knowledge base functionality for AI coding tools. It allows Claude Code, Cursor, Codex CLI, and other MCP-compatible tools to store, retrieve, and manage information across sessions with dual-scope storage (global personal notes and project-specific knowledge).

## Development Commands

### Core Development Workflow
```bash
# Install dependencies (uses pnpm - enforced by preinstall hook)
pnpm install

# Development mode with hot reload
pnpm run dev

# Build the project
pnpm run build

# Start the built server
pnpm start

# Type checking (required before commits)
pnpm run typecheck

# Linting (required before commits)
pnpm run lint

# Run tests
pnpm test
```

### Testing Commands
```bash
# Test core CRUD functionality
node test-functionality.js

# Test MCP server interface and tools
node test-mcp-tools.js
```

## Architecture Overview

### Core Components

**Main Server (`src/index.ts`)**
- `LLMKnowledgeBaseServer`: Main MCP server class that handles tool registration and request routing
- Provides 9 MCP tools: `kb.create`, `kb.read`, `kb.update`, `kb.delete`, `kb.list`, `kb.search`, `kb.stats`, `project.info`, `project.init`
- Implements MCP resources for recent notes and project info

**Knowledge Management (`src/KnowledgeManager.ts`)**
- `KnowledgeManager`: Central orchestrator that manages multiple knowledge stores
- Handles project detection via git repository analysis
- Manages dual storage scopes (global vs project)
- Implements search relevance scoring and cross-scope operations

**Storage Layer (`src/storage/KnowledgeStore.ts`)**
- `KnowledgeStore`: File-based storage implementation for individual scopes
- Handles CRUD operations on JSON note files
- Maintains search indexes and statistics
- Uses ULID for unique note identifiers

### Storage Architecture

**Global Storage**: `~/.llm-memory/global/`
- Personal notes available across all projects
- Initialized automatically on first use

**Project Storage**: Two modes
1. **Local Project Storage**: `~/.llm-memory/projects/<project-hash>/`
   - Personal project notes (not committed to git)
   - Used when project has no committed knowledge base
2. **Committed Project Storage**: `<project-root>/.llm-memory/`
   - Shared project knowledge (committed to git)
   - Created via `project.init` tool

### Note Types and Structure

**Note Types**: `note`, `snippet`, `pattern`, `config`, `fact`, `insight`

**Note Structure** (`src/types/KnowledgeBase.ts`):
```typescript
interface Note {
  id: string;              // ULID identifier
  type: NoteType;          
  title: string;
  content: string;
  tags: string[];
  scope: Scope;            // 'global' | 'project'
  metadata: {
    language?: string;     // For code snippets
    file?: string;         // Related file path
    createdAt: string;
    updatedAt: string;
    createdBy: string;
  };
}
```

## Key Implementation Details

### Project Detection
The system detects projects using git repository information:
- Uses `git rev-parse --show-toplevel` to find project root
- Generates stable project IDs using git root path + remote URL hash
- Falls back to directory-based hashing for non-git projects

### Search Implementation
- Text search across title, content, and tags with relevance scoring
- Support for filtering by type, tags, and scope
- Cross-scope search capabilities with project notes prioritized
- Simple but effective scoring algorithm in `KnowledgeManager.calculateRelevanceScore()`

### MCP Integration
- Fully compliant MCP server implementation
- Uses stdin/stdout transport for communication
- Provides both tools (for actions) and resources (for data access)
- Error handling with proper MCP error codes

## Configuration

### TypeScript Configuration
- Target: ES2022 with NodeNext module resolution
- Strict mode enabled with full type checking
- Output to `dist/` directory with source maps and declarations

### Package Management
- **MUST use pnpm** (enforced by preinstall hook)
- Node.js 18+ and pnpm 9+ required
- ESM modules with `.js` imports (TypeScript compilation requirement)

## Testing Strategy

The project includes comprehensive manual testing scripts:
- `test-functionality.js`: Tests core CRUD operations, search, and file system operations
- `test-mcp-tools.js`: Tests MCP server interface and tool schemas

Always run both test scripts after making changes to verify functionality.

## Common Development Patterns

### File Imports
Use `.js` extensions in imports (TypeScript ESM requirement):
```typescript
import { KnowledgeManager } from './KnowledgeManager.js';
import type { Note } from './types/KnowledgeBase.js';
```

### Error Handling
Wrap operations in try-catch and use MCP error codes:
```typescript
try {
  // operation
} catch (error) {
  throw new McpError(ErrorCode.InternalError, `Operation failed: ${error.message}`);
}
```

### ULID Generation
Use the custom ULID implementation for unique identifiers:
```typescript
import { ulid } from './utils/ULID.js';
const id = ulid();
```

## Development Guidelines

- Follow the existing TypeScript patterns and ESM module structure
- Maintain backward compatibility for stored note formats
- Always update both storage implementation and MCP tool schemas together
- Test with actual MCP clients (Claude Code, Cursor) for integration verification
- Use the existing relevance scoring approach for search features

## Important Files

- `src/index.ts`: MCP server entry point and tool definitions
- `src/KnowledgeManager.ts`: Core business logic and orchestration
- `src/storage/KnowledgeStore.ts`: Storage implementation
- `src/types/KnowledgeBase.ts`: Type definitions for the knowledge base system
- `src/types.ts`: Legacy types (being migrated)
- `test-*.js`: Manual testing scripts for development verification