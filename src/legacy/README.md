# Legacy Code - Deprecated

This directory contains legacy code that is maintained for backward compatibility only.

## Files

- **types.ts** - Legacy `Note`, `NoteType`, `Scope` types
- **KnowledgeManager.ts** - Legacy knowledge management system
- **KnowledgeStore.ts** - Legacy file-based storage

## Migration Guide

All new code should use the modern Memory system instead:

| Legacy | Modern |
|--------|--------|
| `Note` | `MemoryItem` |
| `NoteType` | `MemoryType` |
| `Scope` ('global'\|'project') | `MemoryScope` ('global'\|'local'\|'committed') |
| `SearchQuery` | `MemoryQuery` |
| `SearchResult` | `MemorySearchResult` |
| `KnowledgeManager` | `MemoryManager` |
| `KnowledgeStore` | `FileStorageAdapter` / `VideoStorageAdapter` / `MarkdownStorageAdapter` |

## Why Keep This Code?

These files are retained to:
1. Provide a reference for the legacy system architecture
2. Support potential backward compatibility scenarios
3. Serve as documentation of the evolution from Note-based to Memory-based system

## Status

- ✅ **Fully deprecated** - No active code uses these classes or types
- ✅ **Isolated** - Only references are internal to this directory
- ⚠️ **Do not extend** - Any new features should use the modern Memory system

## Removal Plan

These files may be removed in a future major version once the migration period is complete.
