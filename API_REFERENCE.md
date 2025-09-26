# API Reference

**LLM Memory MCP Server - Complete API Reference**

This document provides comprehensive documentation for all MCP (Model Context Protocol) tools available in the LLM Memory MCP Server. The server provides 32 tools organized into 8 functional categories for managing persistent memory, vector embeddings, project configuration, and system maintenance.

---

## Table of Contents

1. [Overview](#overview)
2. [Memory Operations](#memory-operations)
3. [Vector Operations](#vector-operations)
4. [Project Management](#project-management)
5. [Maintenance Operations](#maintenance-operations)
6. [Journal Operations](#journal-operations)
7. [Resources](#resources)
8. [Error Handling](#error-handling)
9. [Best Practices](#best-practices)
10. [Integration Examples](#integration-examples)

---

## Overview

### Server Information
- **Name**: `llm-memory-mcp`
- **Version**: `1.0.0`
- **Protocol**: MCP (Model Context Protocol) v1.0
- **Transport**: stdio (stdin/stdout)

### Connection Setup
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['/path/to/llm-memory-mcp/dist/index.js']
});

const client = new Client({
  name: 'my-llm-client',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {},
    resources: {}
  }
});

await client.connect(transport);
```

### Authentication
The LLM Memory MCP Server operates as a local service and does not require authentication. Access control is managed through file system permissions and process isolation.

### Response Format
All tools return responses in the standard MCP format:
```typescript
interface ToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
}
```

---

## Memory Operations

### memory.upsert

Creates or updates a memory item in the knowledge base.

**Parameters:**
```typescript
{
  id?: string;                    // Optional ID for updates (auto-generated if not provided)
  type: MemoryType;              // Required: 'snippet' | 'pattern' | 'config' | 'insight' | 'runbook' | 'fact' | 'note'
  scope: MemoryScope;            // Required: 'global' | 'local' | 'committed'
  title?: string;                // Optional title for the memory item
  text?: string;                 // Text content of the memory
  code?: string;                 // Code content (for snippets)
  language?: string;             // Programming language (for code snippets)
  tags?: string[];               // Array of tags for categorization
  files?: string[];              // Array of related file paths
  symbols?: string[];            // Array of related symbols/identifiers
  confidence?: number;           // Confidence score (0.0-1.0, default: 0.75)
  pinned?: boolean;              // Pin for priority ranking (default: false)
  sensitivity?: 'public' | 'team' | 'private';  // Security sensitivity level
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.upsert',
  arguments: {
    type: 'snippet',
    scope: 'local',
    title: 'React Hook for API Calls',
    text: 'Custom hook for handling API requests with loading states and error handling',
    code: `
import { useState, useEffect } from 'react';

export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetch(url)
      .then(response => response.json())
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [url]);

  return { data, loading, error };
}
    `,
    language: 'typescript',
    tags: ['react', 'hook', 'api', 'loading'],
    files: ['src/hooks/useApi.ts'],
    symbols: ['useApi'],
    confidence: 0.9,
    sensitivity: 'team'
  }
});

// Response: { content: [{ type: 'text', text: 'memory.upsert: 01HQZ2YX...' }] }
```

**Response:**
Returns the ID of the created or updated memory item.

---

### memory.get

Retrieves a specific memory item by its ID.

**Parameters:**
```typescript
{
  id: string;                    // Required: Memory item ID
  scope?: MemoryScope;           // Optional: Specific scope to search in
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.get',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S',
    scope: 'local'
  }
});

// Response contains the complete memory item as JSON
```

**Response:**
Returns the complete memory item including all metadata, or throws an error if not found.

---

### memory.delete

Deletes a memory item from the knowledge base.

**Parameters:**
```typescript
{
  id: string;                    // Required: Memory item ID
  scope?: MemoryScope;           // Optional: Specific scope to delete from
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.delete',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S'
  }
});

// Response: { content: [{ type: 'text', text: 'memory.delete: 01HQZ2YX...' }] }
```

**Response:**
Confirms successful deletion or throws an error if the item doesn't exist.

---

### memory.list

Lists memory items with optional filtering and pagination.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';  // Default: 'project'
  limit?: number;                // Optional: Maximum number of items to return
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.list',
  arguments: {
    scope: 'local',
    limit: 10
  }
});

// Returns list of memory summaries
```

**Response:**
Returns an object with `total` count and `items` array containing memory summaries.

---

### memory.query

Performs sophisticated search across the memory knowledge base using BM25 and vector search fusion.

**Parameters:**
```typescript
{
  q?: string;                    // Search query string
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';
  k?: number;                    // Number of results to return (default: 50)
  filters?: {
    type?: MemoryType | MemoryType[];
    tags?: string | string[];
    language?: string | string[];
    files?: string | string[];
    symbols?: string | string[];
    pinned?: boolean;
    dateRange?: {
      from?: string;             // ISO date string
      to?: string;               // ISO date string
    };
  };
  vector?: number[];             // Optional vector for semantic search
  vectorWeight?: number;         // Weight for vector vs text search (0.0-1.0)
  includeCode?: boolean;         // Include code content in results
  includeText?: boolean;         // Include text content in results
  minScore?: number;             // Minimum relevance score
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.query',
  arguments: {
    q: 'react hooks api error handling',
    scope: 'project',
    k: 20,
    filters: {
      type: ['snippet', 'pattern'],
      tags: ['react'],
      language: 'typescript'
    },
    includeCode: true,
    minScore: 0.1
  }
});

// Returns ranked search results with relevance scores
```

**Response:**
Returns a comprehensive search result object with items, scores, facets, and query metadata.

---

### memory.link

Creates a relationship link between two memory items.

**Parameters:**
```typescript
{
  from: string;                  // Source memory item ID
  to: string;                    // Target memory item ID
  rel: 'refines' | 'duplicates' | 'depends' | 'fixes' | 'relates';  // Relationship type
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.link',
  arguments: {
    from: '01HQZ2YX9K7M8N5P6Q3R4S',
    to: '01HQZ3ZY0L8N9M6P7Q4R5T',
    rel: 'refines'
  }
});
```

**Response:**
Confirms successful link creation.

---

### memory.pin

Pins a memory item for priority ranking in search results.

**Parameters:**
```typescript
{
  id: string;                    // Memory item ID to pin
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.pin',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S'
  }
});
```

**Response:**
Confirms successful pinning.

---

### memory.unpin

Removes pinned status from a memory item.

**Parameters:**
```typescript
{
  id: string;                    // Memory item ID to unpin
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.unpin',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S'
  }
});
```

**Response:**
Confirms successful unpinning.

---

### memory.tag

Adds or removes tags from a memory item.

**Parameters:**
```typescript
{
  id: string;                    // Memory item ID
  add?: string[];                // Tags to add
  remove?: string[];             // Tags to remove
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.tag',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S',
    add: ['optimization', 'performance'],
    remove: ['draft']
  }
});
```

**Response:**
Confirms successful tag modification.

---

### memory.contextPack

Creates an IDE-ready context pack from search results, optimized for LLM context windows.

**Parameters:**
```typescript
{
  q?: string;                    // Search query
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';
  k?: number;                    // Number of results to include
  filters?: object;              // Search filters (same as memory.query)
  snippetWindow?: {
    before?: number;             // Lines of context before code snippets
    after?: number;              // Lines of context after code snippets
  };
  snippetLanguages?: string[];   // Filter code snippets by language
  snippetFilePatterns?: string[]; // Filter snippets by file patterns
  maxChars?: number;             // Maximum character limit for the pack
  tokenBudget?: number;          // Token budget (approximately 4 chars per token)
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.contextPack',
  arguments: {
    q: 'database connection pooling',
    scope: 'project',
    k: 15,
    snippetLanguages: ['typescript', 'javascript'],
    maxChars: 10000,
    tokenBudget: 2500,
    snippetWindow: {
      before: 5,
      after: 5
    }
  }
});

// Returns optimized context pack ready for LLM consumption
```

**Response:**
Returns a comprehensive context pack with formatted code snippets, documentation, and metadata optimized for LLM context windows.

---

### memory.feedback

Records user feedback to improve relevance scoring and recommendation quality.

**Parameters:**
```typescript
{
  id: string;                    // Memory item ID
  helpful: boolean;              // Whether the item was helpful
  scope?: MemoryScope;           // Optional scope specification
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.feedback',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S',
    helpful: true,
    scope: 'local'
  }
});
```

**Response:**
Confirms feedback recording for confidence scoring improvements.

---

### memory.use

Records usage/access of a memory item for analytics and confidence scoring.

**Parameters:**
```typescript
{
  id: string;                    // Memory item ID
  scope?: MemoryScope;           // Optional scope specification
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'memory.use',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S',
    scope: 'local'
  }
});
```

**Response:**
Confirms usage recording for improved recommendations.

---

## Vector Operations

The LLM Memory MCP Server provides comprehensive vector embedding support for semantic search and similarity matching.

### vectors.set

Sets or updates a vector embedding for a specific memory item.

**Parameters:**
```typescript
{
  id: string;                    // Memory item ID
  scope: MemoryScope;            // Required: 'global' | 'local' | 'committed'
  vector: number[];              // Dense vector embedding (consistent dimensionality)
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'vectors.set',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S',
    scope: 'local',
    vector: [0.123, -0.456, 0.789, /* ... 384 dimensions */]
  }
});
```

**Response:**
Confirms successful vector storage.

---

### vectors.importBulk

Performs bulk import of vector embeddings with consistency validation.

**Parameters:**
```typescript
{
  scope: MemoryScope;            // Required: target scope
  items: Array<{
    id: string;                  // Memory item ID
    vector: number[];            // Vector embedding
  }>;
  dim?: number;                  // Optional: enforce specific dimensionality
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'vectors.importBulk',
  arguments: {
    scope: 'local',
    dim: 384,
    items: [
      {
        id: '01HQZ2YX9K7M8N5P6Q3R4S',
        vector: [0.1, 0.2, 0.3, /* ... 384 dimensions */]
      },
      {
        id: '01HQZ3ZY0L8N9M6P7Q4R5T',
        vector: [0.4, 0.5, 0.6, /* ... 384 dimensions */]
      }
    ]
  }
});
```

**Response:**
Returns import statistics including success count, validation errors, and dimension consistency check.

---

### vectors.importJsonl

Imports vector embeddings from a JSONL (JSON Lines) file.

**Parameters:**
```typescript
{
  scope: MemoryScope;            // Required: target scope
  path: string;                  // Required: path to JSONL file
  dim?: number;                  // Optional: enforce specific dimensionality
}
```

**JSONL File Format:**
```jsonl
{"id": "01HQZ2YX9K7M8N5P6Q3R4S", "vector": [0.1, 0.2, 0.3]}
{"id": "01HQZ3ZY0L8N9M6P7Q4R5T", "vector": [0.4, 0.5, 0.6]}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'vectors.importJsonl',
  arguments: {
    scope: 'local',
    path: '/path/to/embeddings.jsonl',
    dim: 384
  }
});
```

**Response:**
Returns detailed import report with success/failure counts and validation results.

---

### vectors.remove

Removes vector embedding for a specific memory item.

**Parameters:**
```typescript
{
  id: string;                    // Memory item ID
  scope: MemoryScope;            // Required: scope specification
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'vectors.remove',
  arguments: {
    id: '01HQZ2YX9K7M8N5P6Q3R4S',
    scope: 'local'
  }
});
```

**Response:**
Confirms successful vector removal.

---

## Project Management

Project management tools handle repository detection, committed memory initialization, configuration management, and synchronization between local and committed memories.

### project.info

Retrieves comprehensive information about the current project context.

**Parameters:**
```typescript
{
  // No parameters required
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'project.info',
  arguments: {}
});
```

**Response:**
```json
{
  "repoId": "sha256-hash-of-project",
  "root": "/path/to/project/root",
  "remote": "https://github.com/user/repo.git",
  "branch": "main",
  "hasCommittedMemory": true,
  "committedPath": "/path/to/project/.llm-memory",
  "localPath": "/home/user/.llm-memory/projects/project-hash",
  "scopes": {
    "global": "/home/user/.llm-memory/global",
    "local": "/home/user/.llm-memory/projects/project-hash",
    "committed": "/path/to/project/.llm-memory"
  },
  "stats": {
    "global": { "items": 145, "sizeBytes": 2048576 },
    "local": { "items": 23, "sizeBytes": 512000 },
    "committed": { "items": 67, "sizeBytes": 1024000 }
  }
}
```

---

### project.initCommitted

Initializes committed memory storage within the project repository (.llm-memory directory).

**Parameters:**
```typescript
{
  // No parameters required
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'project.initCommitted',
  arguments: {}
});

// Response: "Committed memory initialized at: /path/to/project/.llm-memory"
```

**Response:**
Returns the path where committed memory was initialized, creating necessary directory structure and configuration files.

---

### project.config.get

Retrieves configuration for a specific scope (defaults to committed if available, otherwise local).

**Parameters:**
```typescript
{
  scope?: MemoryScope;           // Optional: 'global' | 'local' | 'committed'
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'project.config.get',
  arguments: {
    scope: 'committed'
  }
});
```

**Response:**
Returns the complete configuration object for the specified scope, including search parameters, compression settings, and indexing configuration.

---

### project.config.set

Updates configuration for a specific scope.

**Parameters:**
```typescript
{
  scope: MemoryScope;            // Required: target scope
  config: {
    search?: {
      bm25?: {
        k1?: number;             // BM25 k1 parameter (default: 1.2)
        b?: number;              // BM25 b parameter (default: 0.75)
        boosts?: {
          title?: number;        // Title boost factor
          pinned?: number;       // Pinned item boost
          recent?: number;       // Recent item boost
          exact_match?: number;  // Exact match boost
        };
      };
      vector?: {
        enabled?: boolean;       // Enable vector search
        weight?: number;         // Vector search weight (0.0-1.0)
        threshold?: number;      // Minimum similarity threshold
      };
    };
    storage?: {
      compression?: {
        enabled?: boolean;
        codec?: 'h264' | 'h265';
        quality?: number;        // CRF value (18-28)
      };
      caching?: {
        payloadCacheMB?: number;
        frameCacheMB?: number;
      };
    };
    security?: {
      secretRedaction?: boolean;
      sensitivityDefault?: 'public' | 'team' | 'private';
    };
  };
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'project.config.set',
  arguments: {
    scope: 'committed',
    config: {
      search: {
        bm25: {
          k1: 1.5,
          b: 0.8,
          boosts: {
            title: 2.5,
            pinned: 2.0,
            recent: 1.3
          }
        },
        vector: {
          enabled: true,
          weight: 0.4,
          threshold: 0.7
        }
      },
      storage: {
        compression: {
          enabled: true,
          codec: 'h264',
          quality: 23
        }
      }
    }
  }
});
```

**Response:**
Confirms successful configuration update.

---

### project.sync.status

Shows differences between local and committed memory scopes for synchronization planning.

**Parameters:**
```typescript
{
  // No parameters required
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'project.sync.status',
  arguments: {}
});
```

**Response:**
```json
{
  "localOnly": [
    {
      "id": "01HQZ2YX9K7M8N5P6Q3R4S",
      "title": "Local API helper function",
      "type": "snippet",
      "sensitivity": "private"
    }
  ],
  "committedOnly": [
    {
      "id": "01HQZ3ZY0L8N9M6P7Q4R5T",
      "title": "Shared utility functions",
      "type": "pattern",
      "sensitivity": "team"
    }
  ],
  "conflicts": [],
  "summary": {
    "localItems": 23,
    "committedItems": 67,
    "syncCandidates": 5,
    "conflicts": 0
  }
}
```

---

### project.sync.merge

Merges selected items from local to committed memory with sensitivity enforcement.

**Parameters:**
```typescript
{
  ids?: string[];                // Optional: specific item IDs to merge (all eligible if not specified)
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'project.sync.merge',
  arguments: {
    ids: ['01HQZ2YX9K7M8N5P6Q3R4S', '01HQZ4AB1M9O0P7Q8R5S6U']
  }
});
```

**Response:**
Returns merge results with success/failure details and sensitivity validation outcomes.

---

## Maintenance Operations

Maintenance operations handle index rebuilding, journal replay, compaction, and system optimization tasks.

### maintenance.rebuild

Rebuilds catalog and inverted indexes from stored memory items.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';  // Default: 'project'
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'maintenance.rebuild',
  arguments: {
    scope: 'all'
  }
});
```

**Response:**
Returns detailed rebuild statistics including item counts, index sizes, and duration for each scope processed.

---

### maintenance.replay

Replays journal entries to rebuild system state with optional compaction.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';
  compact?: boolean;             // Optional: perform compaction during replay
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'maintenance.replay',
  arguments: {
    scope: 'project',
    compact: true
  }
});
```

**Response:**
Returns replay statistics including entries processed, errors encountered, and compaction results if enabled.

---

### maintenance.compact

Compacts journal by writing current state and truncating historical entries.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'maintenance.compact',
  arguments: {
    scope: 'local'
  }
});
```

**Response:**
Returns compaction statistics including space reclaimed and operation duration.

---

### maintenance.snapshot

Creates a snapshot marker recording the current timestamp for fast startup journal replay.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'maintenance.snapshot',
  arguments: {
    scope: 'all'
  }
});
```

**Response:**
Confirms successful snapshot creation with timestamp and scope information.

---

### maintenance.verify

Recomputes checksums and compares with snapshot state to report consistency.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'maintenance.verify',
  arguments: {
    scope: 'committed'
  }
});
```

**Response:**
Returns comprehensive verification report including checksum validation, consistency status, and any detected issues.

---

### maintenance.compact.now

Alias for `maintenance.compact` - triggers immediate compaction for specified scope.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'maintenance.compact.now',
  arguments: {
    scope: 'project'
  }
});
```

**Response:**
Identical to `maintenance.compact` - returns compaction statistics.

---

### maintenance.compactSnapshot

Performs one-click compaction followed by snapshot creation for optimized recovery.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'project' | 'all';
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'maintenance.compactSnapshot',
  arguments: {
    scope: 'all'
  }
});
```

**Response:**
Returns combined results from both compaction and snapshot operations.

---

## Journal Operations

Journal operations manage the optimized hash-based journal system that provides 81-95% storage reduction while maintaining data integrity.

### journal.stats

Retrieves journal statistics and optimization status for analysis and monitoring.

**Parameters:**
```typescript
{
  scope?: 'global' | 'local' | 'committed' | 'all';
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'journal.stats',
  arguments: {
    scope: 'all'
  }
});
```

**Response:**
```json
{
  "global": {
    "optimized": true,
    "entryCount": 1247,
    "sizeBytes": 45632,
    "legacySizeBytes": 892340,
    "compressionRatio": 0.051,
    "sizeReductionPercent": 94.9,
    "lastMigration": "2024-03-15T10:30:00Z",
    "integrityCheck": {
      "valid": true,
      "lastVerified": "2024-03-15T14:22:00Z"
    }
  },
  "local": {
    "optimized": true,
    "entryCount": 342,
    "sizeBytes": 12456,
    "legacySizeBytes": 156780,
    "compressionRatio": 0.079,
    "sizeReductionPercent": 92.1
  },
  "committed": {
    "optimized": false,
    "entryCount": 567,
    "sizeBytes": 234567,
    "migrationCandidate": true
  },
  "summary": {
    "totalSavings": 1084432,
    "avgCompressionRatio": 0.065,
    "totalOptimizedScopes": 2,
    "totalScopes": 3
  }
}
```

---

### journal.migrate

Migrates legacy journal format to optimized hash-based format with significant space savings.

**Parameters:**
```typescript
{
  scope: 'global' | 'local' | 'committed' | 'all';  // Required: scope to migrate
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'journal.migrate',
  arguments: {
    scope: 'committed'
  }
});
```

**Response:**
```json
{
  "scope": "committed",
  "migrated": true,
  "entriesProcessed": 567,
  "entriesMigrated": 567,
  "sizeReduction": {
    "beforeBytes": 234567,
    "afterBytes": 18765,
    "savedBytes": 215802,
    "percentage": 92.0
  },
  "duration": "1.24s",
  "integrityVerified": true,
  "backupCreated": "/var/lib/llm-memory/committed/journal.ndjson.backup",
  "timestamp": "2024-03-15T15:45:00Z"
}
```

For scope 'all':
```json
{
  "scopes": {
    "global": { /* individual scope result */ },
    "local": { /* individual scope result */ },
    "committed": { /* individual scope result */ }
  },
  "summary": {
    "totalMigrated": 1356,
    "totalSavings": 1027644,
    "avgReduction": 89.7,
    "duration": "3.12s"
  }
}
```

---

### journal.verify

Verifies integrity using optimized journal hashes with comprehensive validation.

**Parameters:**
```typescript
{
  scope: 'global' | 'local' | 'committed' | 'all';  // Required: scope to verify
}
```

**Example:**
```typescript
const result = await client.callTool({
  name: 'journal.verify',
  arguments: {
    scope: 'local'
  }
});
```

**Response:**
```json
{
  "scope": "local",
  "valid": true,
  "entriesChecked": 342,
  "corruptedItems": [],
  "integrityScore": 1.0,
  "hashValidation": {
    "passed": 342,
    "failed": 0,
    "skipped": 0
  },
  "performance": {
    "duration": "0.156s",
    "entriesPerSecond": 2192
  },
  "timestamp": "2024-03-15T16:30:00Z"
}
```

For corrupted data:
```json
{
  "scope": "committed",
  "valid": false,
  "entriesChecked": 567,
  "corruptedItems": [
    {
      "id": "01HQZ2YX9K7M8N5P6Q3R4S",
      "expectedHash": "sha256:abc123...",
      "actualHash": "sha256:def456...",
      "error": "Hash mismatch detected"
    }
  ],
  "integrityScore": 0.998,
  "recommendations": [
    "Run maintenance.rebuild to recover from corruption",
    "Consider restoring from backup if corruption is extensive"
  ]
}
```

For scope 'all':
```json
{
  "global": { /* individual scope result */ },
  "local": { /* individual scope result */ },
  "committed": { /* individual scope result */ },
  "overall": {
    "valid": true,
    "totalCorrupted": 0,
    "avgIntegrityScore": 1.0,
    "totalEntriesChecked": 1356
  }
}
```

---

## Resources

The LLM Memory MCP Server provides three resources for accessing system information and creating context packs.

### kb://project/info

Provides comprehensive project information including recent memories.

**URI:** `kb://project/info`

**Response:**
```json
{
  "project": {
    "repoId": "sha256-hash",
    "root": "/path/to/project",
    "hasCommittedMemory": true
  },
  "recent": [
    {
      "id": "01HQZ2YX9K7M8N5P6Q3R4S",
      "title": "Recent memory item",
      "type": "snippet",
      "scope": "local",
      "createdAt": "2024-03-15T14:20:00Z"
    }
  ]
}
```

---

### kb://context/pack

Creates context packs with query parameters for IDE integration.

**URI:** `kb://context/pack?q=search-query&scope=project&k=20&maxChars=8000`

**Query Parameters:**
- `q`: Search query string
- `scope`: Memory scope ('global', 'local', 'committed', 'project', 'all')
- `k`: Number of results
- `maxChars`: Maximum character limit
- `tokenBudget`: Token budget (approx 4 chars per token)
- `snippetLanguages`: Comma-separated language list
- `snippetFilePatterns`: Comma-separated file patterns

**Example:**
```
kb://context/pack?q=react+hooks&scope=project&k=15&maxChars=10000&snippetLanguages=typescript,javascript
```

**Response:**
Returns optimized context pack formatted for LLM consumption.

---

### kb://health

Provides basic server health and status information.

**URI:** `kb://health`

**Response:**
```json
{
  "name": "llm-memory-mcp",
  "version": "1.0.0",
  "recent": 5
}
```

---

## Error Handling

The LLM Memory MCP Server uses standard MCP error codes and provides detailed error messages for debugging and resolution.

### Error Codes

**Standard MCP Error Codes:**
- `InvalidRequest` (-32600): Malformed request or missing required parameters
- `MethodNotFound` (-32601): Unknown tool or resource requested
- `InvalidParams` (-32602): Invalid parameter values or types
- `InternalError` (-32603): Server-side processing error

### Error Response Format

```typescript
interface McpError {
  code: number;
  message: string;
  data?: any;
}
```

### Common Error Scenarios

**Memory Item Not Found:**
```json
{
  "code": -32600,
  "message": "Item 01HQZ2YX9K7M8N5P6Q3R4S not found"
}
```

**Invalid Scope:**
```json
{
  "code": -32602,
  "message": "Invalid scope: 'invalid_scope'. Must be one of: global, local, committed"
}
```

**Vector Dimension Mismatch:**
```json
{
  "code": -32602,
  "message": "Vector dimension mismatch: expected 384, got 512"
}
```

**Storage Error:**
```json
{
  "code": -32603,
  "message": "Storage operation failed: insufficient disk space"
}
```

**FFmpeg Not Available:**
```json
{
  "code": -32603,
  "message": "Video encoding unavailable: FFmpeg not found"
}
```

### Error Recovery Strategies

**For Client Applications:**
1. **Retry Logic**: Implement exponential backoff for transient errors
2. **Fallback Modes**: Provide degraded functionality when certain features fail
3. **Error Context**: Log full error context for debugging
4. **User Feedback**: Provide meaningful error messages to users

**Example Error Handling:**
```typescript
async function callToolWithRetry(toolName: string, args: any, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.callTool({ name: toolName, arguments: args });
    } catch (error) {
      if (error.code === -32603 && attempt < maxRetries) {
        // Retry internal errors with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        continue;
      }

      if (error.code === -32600) {
        // Don't retry invalid requests
        throw new Error(`Invalid request to ${toolName}: ${error.message}`);
      }

      throw error;
    }
  }
}
```

---

## Best Practices

### Memory Management

**Effective Tagging Strategy:**
```typescript
// Good: Specific, searchable tags
{
  type: 'snippet',
  title: 'React Error Boundary Pattern',
  tags: ['react', 'error-handling', 'component', 'typescript', 'pattern'],
  language: 'typescript'
}

// Avoid: Generic or redundant tags
{
  tags: ['code', 'programming', 'development']  // Too generic
}
```

**Memory Types Best Practices:**
- `snippet`: Complete, runnable code examples with context
- `pattern`: Reusable architectural or design patterns
- `config`: Configuration examples and environment setup
- `insight`: Lessons learned, gotchas, and best practices
- `runbook`: Step-by-step operational procedures
- `fact`: Factual information, API details, specifications
- `note`: General documentation and explanations

**Scope Selection Guidelines:**
- `global`: Personal utilities, general patterns, cross-project knowledge
- `local`: Project-specific, experimental, or private knowledge
- `committed`: Team-shared, stable, production-ready knowledge

### Search Optimization

**Query Construction:**
```typescript
// Effective search queries
"react hooks useState effect"           // Multiple related terms
"database connection pooling postgres"  // Specific technology stack
"error handling retry exponential"      // Behavioral patterns

// Use filters for precision
{
  q: "authentication",
  filters: {
    type: ['snippet', 'pattern'],
    language: 'typescript',
    tags: ['security']
  }
}
```

**Context Pack Optimization:**
```typescript
// Optimized for LLM context windows
{
  q: "api integration patterns",
  k: 12,                    // Moderate result count
  maxChars: 8000,          // Fit within context limits
  snippetWindow: {         // Include relevant context
    before: 3,
    after: 3
  },
  snippetLanguages: ['typescript', 'javascript']  // Focus on relevant languages
}
```

### Vector Embeddings

**Embedding Strategy:**
- Use consistent embedding models (same dimensionality)
- Generate embeddings for both code and text content
- Update embeddings when memory items are modified
- Use bulk import for initial setup, individual updates for maintenance

**Example Embedding Workflow:**
```typescript
// 1. Generate embeddings (using your preferred embedding service)
const embeddings = await generateEmbeddings(memoryItems);

// 2. Bulk import for efficiency
await client.callTool({
  name: 'vectors.importBulk',
  arguments: {
    scope: 'local',
    dim: 384,  // Enforce consistency
    items: embeddings.map(({ id, vector }) => ({ id, vector }))
  }
});
```

### Performance Optimization

**Efficient Querying:**
```typescript
// Use appropriate result limits
const quickSearch = await client.callTool({
  name: 'memory.query',
  arguments: {
    q: "search terms",
    k: 10,          // Smaller limit for quick results
    minScore: 0.3   // Filter low-relevance results
  }
});

// Use context packs for LLM integration
const contextPack = await client.callTool({
  name: 'memory.contextPack',
  arguments: {
    q: "search terms",
    k: 15,
    tokenBudget: 2000,  // Fit LLM context window
    maxChars: 8000
  }
});
```

**Maintenance Scheduling:**
```typescript
// Regular maintenance schedule
const performMaintenance = async () => {
  // Weekly: Verify integrity
  await client.callTool({
    name: 'journal.verify',
    arguments: { scope: 'all' }
  });

  // Monthly: Rebuild indexes
  await client.callTool({
    name: 'maintenance.rebuild',
    arguments: { scope: 'project' }
  });

  // Quarterly: Compact and snapshot
  await client.callTool({
    name: 'maintenance.compactSnapshot',
    arguments: { scope: 'all' }
  });
};
```

---

## Integration Examples

### IDE Integration

**Context-Aware Code Assistance:**
```typescript
class LLMMemoryProvider {
  constructor(private client: McpClient) {}

  async getRelevantContext(currentFile: string, cursorContext: string): Promise<string> {
    // Extract relevant terms from current context
    const searchTerms = this.extractSearchTerms(currentFile, cursorContext);

    // Get relevant memories
    const contextPack = await this.client.callTool({
      name: 'memory.contextPack',
      arguments: {
        q: searchTerms.join(' '),
        scope: 'project',
        k: 10,
        snippetFilePatterns: [this.getFilePattern(currentFile)],
        snippetWindow: { before: 5, after: 5 },
        maxChars: 6000
      }
    });

    return this.formatForLLM(contextPack);
  }

  async recordUsage(memoryId: string): Promise<void> {
    await this.client.callTool({
      name: 'memory.use',
      arguments: { id: memoryId }
    });
  }
}
```

**Code Snippet Capture:**
```typescript
async function captureCodeSnippet(
  code: string,
  language: string,
  filePath: string,
  description: string
): Promise<string> {

  const result = await client.callTool({
    name: 'memory.upsert',
    arguments: {
      type: 'snippet',
      scope: 'local',  // Start in local, promote to committed later
      title: description,
      code: code,
      language: language,
      files: [filePath],
      tags: [
        language,
        ...extractTagsFromCode(code),
        ...extractTagsFromPath(filePath)
      ],
      confidence: 0.8,
      sensitivity: 'team'
    }
  });

  return result.content[0].text.split(': ')[1]; // Extract ID
}
```

### LLM Application Integration

**Dynamic Context Retrieval:**
```typescript
class ContextualLLMAssistant {
  async generateResponse(userQuery: string, projectContext?: string): Promise<string> {
    // Get relevant memories based on query
    const relevantMemories = await this.client.callTool({
      name: 'memory.query',
      arguments: {
        q: userQuery,
        scope: projectContext ? 'project' : 'global',
        k: 20,
        includeCode: true,
        includeText: true,
        filters: {
          pinned: true  // Prioritize pinned content
        }
      }
    });

    // Create optimized context pack
    const contextPack = await this.client.callTool({
      name: 'memory.contextPack',
      arguments: {
        q: userQuery,
        scope: 'project',
        k: 12,
        tokenBudget: 3000,  // Reserve tokens for response
        snippetWindow: { before: 2, after: 2 }
      }
    });

    // Format context for LLM
    const systemContext = this.formatContextPack(contextPack);

    // Generate LLM response with context
    return await this.llm.generateResponse({
      system: systemContext,
      user: userQuery
    });
  }

  async recordFeedback(memoryId: string, wasHelpful: boolean): Promise<void> {
    await this.client.callTool({
      name: 'memory.feedback',
      arguments: {
        id: memoryId,
        helpful: wasHelpful
      }
    });
  }
}
```

### CI/CD Integration

**Automated Memory Management:**
```typescript
// GitHub Actions or CI/CD pipeline integration
async function syncMemoriesOnPush(): Promise<void> {
  // Get sync status
  const syncStatus = await client.callTool({
    name: 'project.sync.status',
    arguments: {}
  });

  // Identify items safe to commit (team/public sensitivity)
  const safeItems = syncStatus.localOnly.filter(item =>
    item.sensitivity === 'team' || item.sensitivity === 'public'
  );

  if (safeItems.length > 0) {
    // Merge safe items to committed memory
    await client.callTool({
      name: 'project.sync.merge',
      arguments: {
        ids: safeItems.map(item => item.id)
      }
    });

    console.log(`Synced ${safeItems.length} memories to committed storage`);
  }

  // Run maintenance
  await client.callTool({
    name: 'maintenance.verify',
    arguments: { scope: 'committed' }
  });
}
```

### Team Knowledge Sharing

**Knowledge Base Curation:**
```typescript
class TeamKnowledgeManager {
  async promoteToTeamKnowledge(localMemoryId: string): Promise<void> {
    // Get local memory
    const memory = await this.client.callTool({
      name: 'memory.get',
      arguments: { id: localMemoryId, scope: 'local' }
    });

    // Update sensitivity and promote to committed
    await this.client.callTool({
      name: 'memory.upsert',
      arguments: {
        ...JSON.parse(memory.content[0].text),
        scope: 'committed',
        sensitivity: 'team',
        confidence: 0.9  // High confidence for curated content
      }
    });

    // Pin important team knowledge
    await this.client.callTool({
      name: 'memory.pin',
      arguments: { id: localMemoryId }
    });
  }

  async generateTeamReport(): Promise<object> {
    const teamMemories = await this.client.callTool({
      name: 'memory.list',
      arguments: {
        scope: 'committed',
        limit: 100
      }
    });

    return {
      totalMemories: teamMemories.total,
      topTags: this.extractTopTags(teamMemories.items),
      recentAdditions: teamMemories.items
        .filter(item => this.isRecent(item.createdAt))
        .length,
      pinnedCount: teamMemories.items
        .filter(item => item.pinned)
        .length
    };
  }
}
```

---

This comprehensive API reference provides detailed documentation for all tools, parameters, responses, and integration patterns for the LLM Memory MCP Server. Use this reference to build sophisticated memory-enhanced applications and integrate the server into your development workflow.