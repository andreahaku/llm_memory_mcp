# Migration Tools Integration

This document describes the implementation of MCP tools that integrate the MigrationManager into the main LLM Memory MCP Server.

## Overview

Four new MCP tools have been added to `src/index.ts` to provide complete migration functionality:

1. **`migration.storage_backend`** - Migrate between file/video storage backends
2. **`migration.scope`** - Migrate filtered items between scopes
3. **`migration.status`** - Get migration status and statistics
4. **`migration.validate`** - Validate migration integrity

## Implementation Details

### 1. Dependencies Added

```typescript
import { MigrationManager } from './migration/MigrationManager.js';
import type { StorageBackend, StorageMigrationOptions, ScopeMigrationOptions } from './migration/MigrationManager.js';
```

### 2. Class Integration

```typescript
class LLMKnowledgeBaseServer {
  private migration: MigrationManager;

  constructor() {
    this.migration = new MigrationManager();
  }
}
```

### 3. Tool Definitions

#### migration.storage_backend
Migrates storage between file and video backends within the same scope.

**Parameters:**
- `sourceBackend`: 'file' | 'video' (required)
- `targetBackend`: 'file' | 'video' (required)
- `scope`: 'global' | 'local' | 'committed' (required)
- `dryRun`: boolean (optional) - Preview migration without executing
- `validateAfterMigration`: boolean (optional) - Validate migration integrity
- `backupBeforeMigration`: boolean (optional) - Create backup before migration

#### migration.scope
Migrates filtered items between memory scopes with intelligent content filtering.

**Parameters:**
- `sourceScope`: 'global' | 'local' | 'committed' (required)
- `targetScope`: 'global' | 'local' | 'committed' (required)
- `contentFilter`: Object (optional) with filtering options:
  - `query`: String search in title/text/code
  - `tags`: Array of tags to filter by
  - `types`: Array of memory types to include
  - `titlePatterns`: Array of regex patterns for title matching
  - `contentPatterns`: Array of regex patterns for content matching
  - `files`: Array of file paths to filter by
  - `dateRange`: Date range with start/end for filtering items
- `storageBackend`: 'file' | 'video' (optional) - Storage backend to use
- `dryRun`: boolean (optional) - Preview migration without executing
- `validateAfterMigration`: boolean (optional) - Validate migration integrity

#### migration.status
Gets migration status and storage statistics for a scope.

**Parameters:**
- `scope`: 'global' | 'local' | 'committed' (required)
- `backend`: 'file' | 'video' (required)

#### migration.validate
Validates migration integrity and consistency.

**Parameters:**
- `scope`: 'global' | 'local' | 'committed' (required)
- `backend`: 'file' | 'video' (required)
- `expectedItems`: Array of item IDs for validation (optional)

## Features Implemented

### Progress Reporting
All migration operations provide real-time progress reporting through:
- Phase tracking (initialization, reading_source, migrating_items, etc.)
- Items processed counter
- Current item being processed
- Error tracking
- Completion estimates

### Dry Run Support
Both storage backend and scope migrations support dry-run mode:
- Preview what would be migrated without making changes
- Validate filtering criteria
- Estimate migration impact

### Error Handling
Comprehensive error handling with MCP error codes:
- Parameter validation
- Migration progress logging
- Detailed error reporting
- Graceful failure handling

### Validation and Integrity
Built-in validation capabilities:
- Post-migration integrity checks
- Item count verification
- Storage size validation
- Corruption detection

## Usage Examples

### Migrate from file to video storage (dry run)
```json
{
  "name": "migration.storage_backend",
  "arguments": {
    "sourceBackend": "file",
    "targetBackend": "video",
    "scope": "local",
    "dryRun": true,
    "validateAfterMigration": true
  }
}
```

### Migrate code snippets from global to committed scope
```json
{
  "name": "migration.scope",
  "arguments": {
    "sourceScope": "global",
    "targetScope": "committed",
    "contentFilter": {
      "types": ["snippet"],
      "tags": ["important"]
    },
    "dryRun": false,
    "validateAfterMigration": true
  }
}
```

### Get migration status
```json
{
  "name": "migration.status",
  "arguments": {
    "scope": "local",
    "backend": "file"
  }
}
```

### Validate migration integrity
```json
{
  "name": "migration.validate",
  "arguments": {
    "scope": "committed",
    "backend": "video"
  }
}
```

## Integration Benefits

1. **Unified Interface**: All migration operations accessible through standard MCP tools
2. **Progress Tracking**: Real-time feedback during long-running migrations
3. **Safety Features**: Dry-run mode, backups, and validation
4. **Error Handling**: Proper MCP error reporting and logging
5. **Flexibility**: Support for both storage backend and scope migrations
6. **Content Filtering**: Intelligent filtering for selective migrations

## Files Modified

- `src/index.ts`: Added MigrationManager import and four new MCP tools with complete implementations
- Tool definitions include comprehensive parameter schemas
- Handler implementations with progress reporting and error handling
- Proper TypeScript type annotations throughout

## Dependencies

The implementation leverages:
- `MigrationManager` class for core migration logic
- Existing MCP server infrastructure
- TypeScript type system for parameter validation
- Logging system for progress tracking

All migration tools are now fully integrated into the LLM Memory MCP Server and ready for use.