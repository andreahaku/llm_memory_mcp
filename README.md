# LLM Memory MCP Server

A persistent knowledge base MCP server that allows LLM tools to store, retrieve, and manage information across sessions. Perfect for sharing knowledge between different AI coding tools like Claude Code, Cursor, Codex CLI, and more.

## Features

- **Dual Scope Storage**: Global (personal) and project-specific knowledge bases
- **Committed Project Memory**: Option to store project knowledge in `.llm-memory/` directory that can be committed to git
- **Rich Note Types**: Support for notes, code snippets, patterns, configurations, facts, and insights
- **Search & Filter**: Full-text search with filtering by type, tags, and scope
- **Cross-tool Compatibility**: Works with any MCP-compatible AI tool

## Installation

### Prerequisites
- Node.js 18+
- pnpm 9+ (install with `npm install -g pnpm`)

```bash
git clone <repository-url>
cd llm-memory-mcp
pnpm install
pnpm run build
```

## Quick Start

### 1. Start the Server

```bash
pnpm start
```

### 2. Configure in Your MCP Client

#### Claude Code

1. Open Claude Code
2. Go to Settings (Cmd/Ctrl + ,)
3. Navigate to "Extensions" → "MCP Servers"
4. Add a new server with these settings:
   - **Name**: `llm-memory`
   - **Command**: `node`
   - **Args**: `["/absolute/path/to/llm-memory-mcp/dist/index.js"]`
   - **Working Directory**: `/absolute/path/to/llm-memory-mcp`

Or add directly to your Claude Code settings file:
```json
{
  "mcpServers": {
    "llm-memory": {
      "command": "node",
      "args": ["/absolute/path/to/llm-memory-mcp/dist/index.js"]
    }
  }
}
```

#### Cursor

1. Open Cursor
2. Open Settings (Cmd/Ctrl + ,)
3. Search for "MCP" or go to Extensions → MCP
4. Add a new MCP server:
   - **Server Name**: `llm-memory`
   - **Command**: `node`
   - **Arguments**: `/absolute/path/to/llm-memory-mcp/dist/index.js`

Or add to your Cursor configuration file (`~/.cursor/mcp_servers.json`):
```json
{
  "llm-memory": {
    "command": "node",
    "args": ["/absolute/path/to/llm-memory-mcp/dist/index.js"],
    "env": {}
  }
}
```

#### Codex CLI

1. Install Codex CLI if you haven't already:
   ```bash
   pnpm add -g @codex-ai/cli
   ```

2. Configure the MCP server in your Codex configuration:
   ```bash
   codex config set mcp.servers.llm-memory.command "node"
   codex config set mcp.servers.llm-memory.args "['/absolute/path/to/llm-memory-mcp/dist/index.js']"
   ```

   Or edit your Codex config file (`~/.codex/config.json`):
   ```json
   {
     "mcp": {
       "servers": {
         "llm-memory": {
           "command": "node",
           "args": ["/absolute/path/to/llm-memory-mcp/dist/index.js"],
           "env": {}
         }
       }
     }
   }
   ```

3. Restart Codex CLI to load the new server:
   ```bash
   codex restart
   ```

#### Other MCP Clients

For other MCP-compatible tools, use this general configuration:
```json
{
  "servers": {
    "llm-memory": {
      "command": "node",
      "args": ["/absolute/path/to/llm-memory-mcp/dist/index.js"],
      "env": {}
    }
  }
}
```

**Important Notes:**
- Replace `/absolute/path/to/llm-memory-mcp` with the actual absolute path to your installation
- Ensure the server is built (`pnpm run build`) before configuring
- Restart your MCP client after adding the configuration

### 3. Use the Tools

The server provides 9 tools for knowledge base management. Once configured, these tools will be available in your AI coding tool:

## Available Tools Overview

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `kb.create` | Create new notes | `type`, `title`, `content`, `scope`, `tags` |
| `kb.read` | Read note by ID | `id`, `scope` |
| `kb.update` | Update existing note | `id`, updates, `scope` |
| `kb.delete` | Delete note | `id`, `scope` |
| `kb.list` | List all notes | `scope` |
| `kb.search` | Search notes | `q`, `type`, `tags`, `scope`, `limit` |
| `kb.stats` | Get statistics | None |
| `project.info` | Get project info | None |
| `project.init` | Initialize project KB | None |

## Tool Details

### Core Knowledge Base Operations

#### `kb.create`
Create a new note in the knowledge base.

**Parameters:**
- `type` (required): Type of note (`note`, `snippet`, `pattern`, `config`, `fact`, `insight`)
- `title` (required): Title of the note
- `content` (required): Content of the note
- `scope`: Storage scope (`global` or `project`, default: `project`)
- `tags`: Array of tags for categorization
- `language`: Programming language (for code snippets)
- `file`: Related file path

**Example:**
```json
{
  "type": "snippet",
  "title": "React useState Hook",
  "content": "const [state, setState] = useState(initialValue);",
  "tags": ["react", "hooks"],
  "language": "javascript"
}
```

#### `kb.read`
Read a note by ID.

**Parameters:**
- `id` (required): Note ID
- `scope`: Scope to search in (`global`, `project`, or search both if not specified)

#### `kb.update`
Update an existing note.

**Parameters:**
- `id` (required): Note ID
- `title`: New title
- `content`: New content
- `tags`: New tags array
- `type`: New type
- `scope`: Scope to search in

#### `kb.delete`
Delete a note.

**Parameters:**
- `id` (required): Note ID
- `scope`: Scope to search in

#### `kb.list`
List all notes.

**Parameters:**
- `scope`: Scope to list from (`global`, `project`, `all`, default: `all`)

#### `kb.search`
Search through notes.

**Parameters:**
- `q`: Search query string
- `type`: Array of note types to filter by
- `tags`: Array of tags to filter by
- `scope`: Scope to search in (`global`, `project`, `all`, default: `all`)
- `limit`: Maximum number of results (default: 50)

#### `kb.stats`
Get knowledge base statistics.

### Project Management

#### `project.info`
Get current project information including whether it has a committed knowledge base.

#### `project.init`
Initialize a committed project knowledge base (creates `.llm-memory/` directory in project root).

## Storage Architecture

### Global Storage
- **Location**: `~/.llm-memory/global/`
- **Purpose**: Personal notes available across all projects
- **Examples**: General coding patterns, personal preferences, frequently used snippets

### Project Storage
- **Local Project Storage**: `~/.llm-memory/projects/<project-hash>/`
  - Personal project notes (not committed)
  - Specific to your local development
- **Committed Project Storage**: `<project-root>/.llm-memory/`
  - Shared project knowledge (committed to git)
  - Team-accessible patterns, configurations, project-specific insights

## Note Types

- **`note`**: General text notes and documentation
- **`snippet`**: Code snippets with language support
- **`pattern`**: Coding patterns and best practices
- **`config`**: Configuration files and settings
- **`fact`**: Important facts and key information
- **`insight`**: Insights and lessons learned

## Practical Usage in Different Tools

### Using in Claude Code

Once configured, you can use the knowledge base tools directly in your conversations:

```
User: "Store this React error boundary pattern for future use"

Claude: I'll store this React error boundary pattern in your knowledge base.

*Uses kb.create tool*
{
  "type": "pattern",
  "title": "React Error Boundary",
  "content": "class ErrorBoundary extends React.Component {\n  constructor(props) {\n    super(props);\n    this.state = { hasError: false };\n  }\n\n  static getDerivedStateFromError(error) {\n    return { hasError: true };\n  }\n\n  componentDidCatch(error, errorInfo) {\n    console.log('Error caught:', error, errorInfo);\n  }\n\n  render() {\n    if (this.state.hasError) {\n      return <h1>Something went wrong.</h1>;\n    }\n    return this.props.children;\n  }\n}",
  "tags": ["react", "error-handling", "component"],
  "language": "javascript",
  "scope": "project"
}

✅ Stored React Error Boundary pattern with ID: 01K5EC123...

User: "Search for React patterns I've saved"

Claude: Let me search your knowledge base for React patterns.

*Uses kb.search tool*
{
  "q": "react",
  "type": ["pattern", "snippet"],
  "scope": "all"
}

Found 3 React patterns:
1. React Error Boundary - Error handling component
2. React Hook Pattern - Custom hooks template
3. React Context Pattern - State management
```

### Using in Cursor

In Cursor, the tools integrate seamlessly with the AI assistant:

```
// You can ask Cursor to store code you're working on
"Save this utility function to my knowledge base"

// Cursor will use kb.create to store it
// Later, you can ask:
"What utility functions do I have saved?"

// Cursor will use kb.search to find relevant functions
```

### Using in Codex CLI

From the command line, Codex CLI can access your knowledge base:

```bash
# Ask Codex to find a specific pattern
codex ask "Show me my saved authentication patterns"

# Codex will use kb.search to find auth-related notes

# Store a new configuration
codex ask "Save this Docker configuration for future projects"

# Codex will use kb.create to store it in global scope
```

## Usage Examples

### Store a Code Pattern
```javascript
// Through MCP client
kb.create({
  type: "pattern",
  title: "Error Handling in Async Functions",
  content: `
try {
  const result = await asyncOperation();
  return result;
} catch (error) {
  console.error('Operation failed:', error);
  throw new Error('Custom error message');
}
  `,
  tags: ["javascript", "async", "error-handling"],
  language: "javascript"
})
```

### Search for React Patterns
```javascript
kb.search({
  q: "react hooks",
  type: ["pattern", "snippet"],
  tags: ["react"]
})
```

### Store Project Configuration
```javascript
kb.create({
  type: "config",
  title: "TypeScript Config for Node.js",
  content: JSON.stringify({
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext"
    }
  }, null, 2),
  scope: "project",
  tags: ["typescript", "nodejs", "config"]
})
```

## Commands Reference

### Quick Command Guide

#### Create Operations
```bash
# Create a code snippet
kb.create({
  type: "snippet",
  title: "JWT Token Validation",
  content: "const jwt = require('jsonwebtoken');\nconst token = jwt.verify(token, secret);",
  tags: ["auth", "jwt", "validation"],
  language: "javascript",
  scope: "global"
})

# Create a project-specific configuration
kb.create({
  type: "config",
  title: "ESLint Config",
  content: "{\n  \"extends\": [\"@company/eslint-config\"]\n}",
  tags: ["eslint", "config"],
  scope: "project"
})

# Create a development insight
kb.create({
  type: "insight",
  title: "Performance Optimization Notes",
  content: "Use React.memo for expensive components. Consider useMemo for complex calculations.",
  tags: ["react", "performance", "optimization"]
})
```

#### Search Operations
```bash
# Search by text
kb.search({ q: "authentication" })

# Search by tags
kb.search({ tags: ["react", "hooks"] })

# Search by type
kb.search({ type: ["snippet", "pattern"] })

# Advanced search
kb.search({
  q: "database",
  type: ["config", "pattern"],
  tags: ["sql"],
  scope: "project",
  limit: 10
})
```

#### Management Operations
```bash
# List all notes
kb.list({ scope: "all" })

# List only global notes
kb.list({ scope: "global" })

# Get specific note
kb.read({ id: "01K5EC123..." })

# Update note
kb.update({
  id: "01K5EC123...",
  title: "Updated Title",
  tags: ["new", "tags"]
})

# Delete note
kb.delete({ id: "01K5EC123..." })
```

#### Project Operations
```bash
# Get current project info
project.info()

# Initialize project knowledge base
project.init()

# Get statistics
kb.stats()
```

### Common Use Cases

#### 1. Storing Code Snippets
```javascript
// Store a reusable utility function
kb.create({
  type: "snippet",
  title: "Deep Clone Object",
  content: "function deepClone(obj) {\n  return JSON.parse(JSON.stringify(obj));\n}",
  tags: ["javascript", "utility", "clone"],
  language: "javascript"
})
```

#### 2. Documenting Patterns
```javascript
// Store a design pattern
kb.create({
  type: "pattern",
  title: "Repository Pattern",
  content: "class UserRepository {\n  async findById(id) {\n    return await db.users.findOne({ id });\n  }\n}",
  tags: ["design-pattern", "repository", "database"],
  language: "javascript"
})
```

#### 3. Saving Configurations
```javascript
// Store project configuration
kb.create({
  type: "config",
  title: "Webpack Production Config",
  content: "module.exports = {\n  mode: 'production',\n  optimization: {\n    minimize: true\n  }\n}",
  tags: ["webpack", "config", "production"],
  scope: "project"
})
```

#### 4. Recording Facts and Insights
```javascript
// Store important facts
kb.create({
  type: "fact",
  title: "API Rate Limits",
  content: "GitHub API: 5000 requests/hour for authenticated users, 60 for unauthenticated",
  tags: ["github", "api", "limits"]
})

// Store insights from debugging
kb.create({
  type: "insight",
  title: "Memory Leak Fix",
  content: "Event listeners in React components must be cleaned up in useEffect return function",
  tags: ["react", "memory", "cleanup", "useeffect"]
})
```

#### 5. Cross-Project Knowledge Sharing
```javascript
// Global patterns available everywhere
kb.create({
  type: "pattern",
  title: "Error Handling Middleware",
  content: "const errorHandler = (err, req, res, next) => {\n  console.error(err.stack);\n  res.status(500).send('Something broke!');\n};",
  tags: ["express", "middleware", "error-handling"],
  scope: "global"
})

// Project-specific committed knowledge
kb.create({
  type: "config",
  title: "Team Code Standards",
  content: "Always use TypeScript strict mode, ESLint, and Prettier",
  tags: ["standards", "team", "typescript"],
  scope: "project" // Will be stored in .llm-memory/ if project.init() was called
})
```

## Integration with Development Tools

### Claude Code
The knowledge base integrates seamlessly with Claude Code, allowing you to store and retrieve code patterns, project insights, and development notes during coding sessions. Simply ask Claude to "save this pattern" or "find my authentication examples."

### Cursor
Works with Cursor's MCP support to provide persistent memory across AI-assisted coding sessions. Cursor can automatically suggest relevant patterns and snippets from your knowledge base.

### Codex CLI
Compatible with Codex CLI for command-line AI development workflows. Use natural language commands like "show me my Docker configs" or "save this script for later."

## File Structure

```
~/.llm-memory/
├── global/                 # Global notes
│   ├── <note-id>.json     # Individual notes
│   └── index.json         # Search index
└── projects/
    └── <project-hash>/    # Local project notes
        ├── <note-id>.json
        └── index.json

<project-root>/.llm-memory/  # Committed project knowledge
├── .gitignore
├── <note-id>.json         # Individual notes
└── index.json             # Search index
```

## Development

```bash
# Install dependencies
pnpm install

# Development mode
pnpm run dev

# Build
pnpm run build

# Type checking
pnpm run typecheck

# Linting
pnpm run lint

# Test functionality
node test-functionality.js

# Test MCP tools
node test-mcp-tools.js
```

## Testing

The project includes comprehensive tests to verify functionality:

```bash
# Test CRUD operations
node test-functionality.js

# Test MCP server interface
node test-mcp-tools.js
```

### Test Results Summary
✅ **All CRUD operations** (Create, Read, Update, Delete)
✅ **Search and filtering** by text, tags, and types
✅ **Multi-scope storage** (global, project, committed)
✅ **Project detection** and initialization
✅ **MCP server interface** with 9 available tools
✅ **Data persistence** with proper file structure
✅ **Statistics and metadata** tracking

## API Schema

### Note Structure
```typescript
interface Note {
  id: string;              // ULID identifier
  type: NoteType;          // note|snippet|pattern|config|fact|insight
  title: string;
  content: string;
  tags: string[];
  scope: Scope;            // global|project
  metadata: {
    language?: string;     // For code snippets
    file?: string;         // Related file path
    createdAt: string;
    updatedAt: string;
    createdBy: string;
  };
}
```

### Search Query
```typescript
interface SearchQuery {
  q?: string;              // Text search
  type?: NoteType[];       // Filter by types
  tags?: string[];         // Filter by tags
  scope?: Scope | 'all';   // Search scope
  limit?: number;          // Result limit (default: 50)
}
```

### Project Info
```typescript
interface ProjectInfo {
  id: string;              // Project hash
  name: string;            // Project name
  path: string;            // Project root path
  hasKnowledgeBase: boolean; // Has .llm-memory directory
}
```

## Resources

The server also provides MCP resources:

- `kb://notes/recent` - Recently updated notes
- `kb://project/info` - Current project knowledge base information

## Troubleshooting

### Common Issues

1. **Server won't start**: Ensure Node.js 18+ is installed and dependencies are built
2. **Permission errors**: Check write permissions to `~/.llm-memory/` directory
3. **Project not detected**: Ensure you're in a git repository or the server will use directory-based fallback
4. **MCP client can't connect**: Verify the correct path to `dist/index.js` in your MCP configuration

### Debug Mode

Enable debug logging by setting the `DEBUG` environment variable:
```bash
DEBUG=llm-memory* npm start
```

## License

MIT

## Contributing

Contributions welcome! This tool is designed to be a flexible foundation for persistent AI memory across development tools.

### Development Guidelines

1. Follow TypeScript best practices
2. Add tests for new functionality
3. Update documentation for API changes
4. Ensure backward compatibility
5. Use semantic versioning for releases

## Roadmap

Future enhancements may include:
- Vector similarity search
- Import/export functionality
- Team synchronization features
- Advanced conflict resolution
- Integration with more development tools
- Web interface for knowledge base management