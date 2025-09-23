# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an LLM Memory MCP (Model Context Protocol) Server that provides persistent knowledge base functionality for AI coding tools. It's a local-first, team-ready memory system optimized for JavaScript/TypeScript development but works for any stack. The system provides fast search with BM25 scoring, memory scoping (global/local/committed), and advanced indexing capabilities.

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

# Test all tools comprehensively
pnpm run test:all

# Simulate user interaction flows
pnpm run simulate:user
```

## Architecture Overview

### Core Components

**Main Server (`src/index.ts`)**
- `LLMKnowledgeBaseServer`: Main MCP server class that handles tool registration and request routing
- Provides comprehensive MCP tools for memory operations, project management, and search
- Implements MCP resources for recent memories and project info
- Uses `MemoryManager` as the core backend (modern implementation)

**Memory Management (`src/MemoryManager.ts`)**
- `MemoryManager`: Modern memory system with advanced search and indexing
- Supports BM25 scoring, vector indexing, and configurable relevance boosting
- Handles atomic writes, journaling, and automatic index rebuilding
- Implements secret redaction and token estimation
- Manages memory scopes: global, local (per-project), and committed (team-shared)

**Legacy Knowledge Management (`src/KnowledgeManager.ts`)**
- `KnowledgeManager`: Original note-based system (being phased out)
- Still used for backward compatibility with existing note storage
- Project detection via git repository analysis

**Storage Layer**
- `FileStore` (`src/storage/fileStore.ts`): Modern file-based storage with journaling
- `KnowledgeStore` (`src/storage/KnowledgeStore.ts`): Legacy storage implementation
- `InvertedIndexer` (`src/storage/Indexer.ts`): BM25 search indexing
- `VectorIndex` (`src/storage/VectorIndex.ts`): Vector-based similarity search

**Scope Resolution (`src/scope/ScopeResolver.ts`)**
- Handles project detection and scope determination
- Manages transitions between global, local, and committed scopes

### Storage Architecture

**Global Storage**: `~/.llm-memory/global/`
- Personal memories available across all projects
- Initialized automatically on first use

**Project Storage**: Three modes
1. **Local Project Storage**: `~/.llm-memory/projects/<project-hash>/`
   - Personal project memories (not committed to git)
   - Used when project has no committed memory base
2. **Committed Project Storage**: `<project-root>/.llm-memory/`
   - Shared project knowledge (committed to git)
   - Created via `project.init` tool
3. **Automatic Scope Resolution**: System determines appropriate scope based on context

### Memory Types and Structure

**Memory Types**: `snippet`, `pattern`, `config`, `insight`, `runbook`, `fact`, `note`

**Memory Structure** (`src/types/Memory.ts`):
```typescript
interface MemoryItem {
  id: string;              // ULID identifier
  type: MemoryType;
  title: string;
  content: string;
  tags: string[];
  scope: MemoryScope;      // 'global' | 'local' | 'committed'
  links?: MemoryLink[];    // Cross-references to other memories
  isPinned?: boolean;      // Boost search ranking
  metadata: {
    language?: string;     // For code snippets
    file?: string;         // Related file path
    priority?: number;     // Search ranking boost
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
- **BM25 Scoring**: Advanced text search with TF-IDF and document length normalization
- **Relevance Boosting**: Configurable boosts for scope, pinned items, recency, and exact matches
- **Vector Indexing**: Semantic similarity search using vector embeddings
- **Phrase Detection**: Bonus scoring for quoted phrases and title matches
- **Cross-Scope Search**: Searches across global, local, and committed scopes with priority ranking
- **Configurable Tuning**: Per-scope `config.json` files for field weights and boost parameters

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
import { MemoryManager } from './MemoryManager.js';
import type { MemoryItem } from './types/Memory.js';
import { ulid } from './util/ulid.js'; // Note: newer ULID implementation
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
Use the newer ULID implementation for unique identifiers:
```typescript
import { ulid } from './util/ulid.js';
const id = ulid();
```

### Secret Redaction
The system automatically redacts common API key patterns:
```typescript
import { redactSecrets } from './utils/secretFilter.js';
const safeContent = redactSecrets(content);
```

### Token Estimation
For memory management and optimization:
```typescript
import { estimateTokens, allowedCharsForTokens } from './utils/tokenEstimate.js';
const tokenCount = estimateTokens(content);
const maxChars = allowedCharsForTokens(maxTokens);
```

## Development Guidelines

- **Use MemoryManager for new features**: The modern memory system with BM25 search and advanced indexing
- Follow the existing TypeScript patterns and ESM module structure
- Maintain backward compatibility for stored memory formats
- Always update both storage implementation and MCP tool schemas together
- Test with actual MCP clients (Claude Code, Cursor) for integration verification
- Use configurable search tuning via scope-specific `config.json` files
- Implement atomic writes and journaling for data consistency
- Apply secret redaction for any user-provided content

## Important Files

- `src/index.ts`: MCP server entry point and tool definitions
- `src/MemoryManager.ts`: Modern memory system with BM25 search and indexing
- `src/KnowledgeManager.ts`: Legacy knowledge management (backward compatibility)
- `src/scope/ScopeResolver.ts`: Project detection and scope management
- `src/storage/fileStore.ts`: Modern file storage with journaling
- `src/storage/Indexer.ts`: BM25 search indexing
- `src/storage/VectorIndex.ts`: Vector similarity search
- `src/types/Memory.ts`: Modern memory type definitions
- `src/types/KnowledgeBase.ts`: Legacy type definitions
- `src/utils/secretFilter.ts`: API key and secret redaction
- `src/utils/tokenEstimate.ts`: Token counting and estimation
- `test-*.js`: Manual testing scripts for development verification