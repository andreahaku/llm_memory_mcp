# Video Storage Search Integration

This document details the comprehensive search integration fixes implemented for the video storage system to ensure complete parity with file storage search functionality.

## Overview

The video storage search integration system ensures that search functionality works seamlessly across both file and video storage backends. This includes:

- **Unified search interface** across storage types
- **Real-time index updates** when video content changes
- **Scope-aware search** functionality
- **Search result accuracy** matching between storage backends

## Key Components

### 1. VideoStorageAdapter Search Integration

#### Missing Methods Implemented
- **`listItems()`**: Returns all item IDs from both committed and pending items
- **`registerIndexUpdateCallback()`**: Allows MemoryManager to register for search index updates
- **Index validation and recovery methods**: Ensure data integrity

#### Search Index Synchronization
```typescript
// Automatic index updates when items are modified
private notifyIndexUpdaters(items: MemoryItem[], deletedIds: string[]): void {
  for (const callback of this.indexUpdateCallbacks) {
    try {
      callback(items, deletedIds);
    } catch (error) {
      console.warn('Index update callback failed:', error);
    }
  }
}
```

### 2. MemoryManager Integration

#### Callback Registration
The MemoryManager automatically detects video storage and registers search index update callbacks:

```typescript
// Set up search index integration for video storage
if (storageBackend === 'video' && 'registerIndexUpdateCallback' in store) {
  log(`Setting up video storage search index integration for ${scope} scope`);
  const videoStore = store as any;
  videoStore.registerIndexUpdateCallback((items: MemoryItem[], deletedIds: string[]) => {
    const indexer = this.getIndexer(scope, cwd);
    const weights = this.getRanking(scope).fieldWeights as any;

    // Update search index for modified items
    for (const item of items) {
      indexer.updateItem(item, weights);
    }

    // Remove deleted items from search index
    for (const id of deletedIds) {
      indexer.removeItem(id);
      try { this.getVectorIndex(scope, cwd).remove(id); } catch {}
    }
  });
}
```

#### Dual Update Strategy
- **Video storage**: Uses callback-based index updates
- **File storage**: Uses traditional scheduled index updates
- **Scope rebuilding**: Works for both storage types

### 3. Search Query Resolution

#### Empty Query Handling
```typescript
if (q.q) {
  // Use search index for queries with terms
  const ranked = this.getIndexer(s, cwd).search(q.q, options);
} else {
  // Use listItems for queries without search terms
  const list = st.listItems ? await st.listItems() : [];
  for (const id of list) ids.push({ scope: s, id });
}
```

#### Unified Result Processing
Both storage types produce the same result format and undergo identical filtering and ranking.

## Fixed Issues

### 1. Missing `listItems()` Implementation
**Problem**: VideoStorageAdapter didn't implement the optional `listItems()` method, causing empty query failures.

**Solution**: Implemented `listItems()` that returns IDs from both:
- Committed items in the video index
- Pending items awaiting consolidation
- Excludes items marked for deletion

### 2. Search Index Synchronization
**Problem**: Search index wasn't updated when video storage items were modified.

**Solution**: Implemented callback-based index updates that trigger immediately after video consolidation operations.

### 3. Query Resolution for Video Content
**Problem**: Queries returned empty results even when video storage contained items.

**Solution**: Fixed the query pipeline to properly handle both search and list operations for video storage.

### 4. Scope-Aware Search
**Problem**: Search didn't properly isolate results by scope for video storage.

**Solution**: Enhanced scope detection and ensured search operations respect scope boundaries.

## Architecture Improvements

### 1. Callback-Based Updates
Video storage uses event-driven index updates instead of polling:
```typescript
// Immediate notification after consolidation
this.notifyIndexUpdaters(allItems, []);

// Immediate notification after deletion
this.notifyIndexUpdaters([], [id]);
```

### 2. Robust Error Handling
- Index validation before video decoding
- Graceful fallback for corrupted entries
- Comprehensive logging for debugging

### 3. Performance Optimizations
- Payload caching for frequently accessed items
- Batch operations for multiple items
- Efficient frame range validation

## Testing and Validation

### Validation Script
Use the comprehensive validation script to test search integration:

```bash
node scripts/validate-search-integration.js
```

### Test Coverage
- ✅ Video storage basic operations (CRUD + search)
- ✅ File storage basic operations (comparison baseline)
- ✅ Scope-aware search functionality
- ✅ Search index rebuilding
- ✅ Complex filtering (tags, types, combined queries)

### Expected Results
All tests should pass, demonstrating:
- Search parity between file and video storage
- Correct index updates after operations
- Accurate query resolution
- Proper scope isolation

## Usage Examples

### Basic Search Operations
```typescript
const memoryManager = new MemoryManager();

// Works with both file and video storage
const results = await memoryManager.query({
  q: 'javascript',
  scope: 'local'
});

// List all items (uses listItems internally)
const allItems = await memoryManager.query({
  scope: 'local'
});

// Tag-based filtering
const filtered = await memoryManager.query({
  scope: 'local',
  filters: { tags: ['frontend'] }
});
```

### Storage Backend Detection
The system automatically detects and configures the appropriate storage backend:

```typescript
// Detects video storage from config.json or directory contents
const backend = this.detectStorageBackend(dir);
if (backend === 'video') {
  // Set up video storage with search integration
  const videoStore = new VideoStorageAdapter(dir, scope);
  this.setupVideoSearchIntegration(videoStore);
}
```

## Monitoring and Debugging

### Log Messages
Search integration operations are logged with specific prefixes:
- `[MemoryManager]`: General memory operations
- `Video storage index update callback`: Index synchronization
- `Updating search index for item`: Individual item updates
- `Removing item from search index`: Deletion operations

### Performance Metrics
Monitor search performance using the storage metrics:
```typescript
const metrics = await videoStore.getVideoStorageMetrics();
console.log('Cache hit rate:', metrics.cacheStats.payloadCacheHits);
console.log('Queue length:', metrics.queueLength);
```

## Best Practices

### 1. Index Consistency
- Always rebuild indexes after major operations
- Validate index integrity periodically
- Monitor callback execution for errors

### 2. Performance Optimization
- Use appropriate query scopes to limit search domains
- Leverage caching for frequently accessed items
- Batch operations when possible

### 3. Error Recovery
- Implement graceful fallbacks for video decoding failures
- Use index validation and recovery mechanisms
- Monitor and log search accuracy metrics

## Future Enhancements

### Potential Improvements
1. **Hybrid search optimization**: Better balance between text and vector search
2. **Advanced caching strategies**: Predictive caching for common queries
3. **Search result ranking**: Enhanced relevance scoring for video content
4. **Real-time search**: Live updates as video processing completes

### Compatibility
The search integration is designed to be:
- **Backward compatible** with existing file storage
- **Forward compatible** with future storage backends
- **Extensible** for additional search features

This comprehensive search integration ensures that video storage provides the same powerful search capabilities as file storage while maintaining optimal performance and reliability.