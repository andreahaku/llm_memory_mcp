import type { MemoryItem, MemoryItemSummary, MemoryConfig, MemoryScope } from '../types/Memory.js';

/**
 * Storage adapter interface for pluggable storage backends
 * Enables switching between FileStore, VideoStore, and other implementations
 */
export interface StorageAdapter {
  // Core item operations
  writeItem(item: MemoryItem): Promise<void>;
  readItem(id: string): Promise<MemoryItem | null>;
  readItems(ids: string[]): Promise<MemoryItem[]>;
  deleteItem(id: string): Promise<boolean>;

  // Catalog operations (for indexing and search)
  readCatalog(): Record<string, MemoryItemSummary>;
  setCatalog(catalog: Record<string, MemoryItemSummary>): void;
  rebuildCatalog(): Promise<void>;

  // Batch operations for performance
  writeBatch?(items: MemoryItem[]): Promise<void>;
  deleteBatch?(ids: string[]): Promise<boolean[]>;

  // Configuration management
  readConfig(): MemoryConfig | null;
  writeConfig(config: MemoryConfig): void;

  // Maintenance operations
  getStats(): Promise<{
    items: number;
    sizeBytes: number;
    lastCompaction?: string;
    journalSize?: number;
  }>;
  cleanup(): Promise<number>;

  // Compaction and optimization
  setCompactionHook?(callback: () => void, threshold?: number): void;

  // Journaling (optional - for stores that support it)
  readJournal?(limit?: number): Promise<any[]>;
  readJournalSince?(sinceTs?: string): Promise<any[]>;
  replaceJournal?(entries: any[]): void;

  // Snapshot support (optional)
  writeSnapshotMeta?(meta: { lastTs: string; checksum?: string }): void;
  readSnapshotMeta?(): { lastTs: string; checksum?: string } | null;
  writeStateOk?(meta: { ts: string; checksum?: string }): void;
  readStateOk?(): { ts: string; checksum?: string } | null;

  // Low-level file operations (for backward compatibility)
  writeItemFileRaw?(item: MemoryItem): Promise<void>;
  removeItemFileRaw?(id: string): void;
  listItems?(): Promise<string[]>;

  // Content addressing (for deduplication)
  hasContent?(hashes: string[]): Promise<Record<string, boolean>>;
  getByHash?(hashes: string[]): Promise<Record<string, any>>;

  // Directory/scope info
  getDirectory?(): string;

  // Migration and integrity support
  migrateToOptimizedJournal?(): Promise<any>;
  verifyIntegrityFromOptimizedJournal?(): Promise<any>;
  getJournalStats?(): Promise<any>;
  hasOptimizedJournal?(): boolean;

  // Lifecycle management
  initialize?(): Promise<void>;
  destroy?(): Promise<void>;
}

/**
 * Storage adapter factory interface
 */
export interface StorageAdapterFactory {
  create(directory: string, scope: MemoryScope): StorageAdapter;
  readonly type: string;
}

/**
 * Write operation result
 */
export interface WriteResult {
  id: string;
  contentHash?: string;
  deduplicated?: boolean;
  size?: number;
}

/**
 * Read operation result with optional body materialization
 */
export interface GetResult {
  item: MemoryItemSummary | null;
  body?: Buffer;
  cacheHit?: boolean;
}

/**
 * Transaction interface for atomic operations
 */
export interface StorageTransaction {
  writeItem(item: MemoryItem): Promise<WriteResult>;
  deleteItem(id: string): Promise<boolean>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Content-hash based payload reference
 */
export interface PayloadRef {
  hash: string;
  segmentUlid?: string;
  frameIdx?: number;
  size?: number;
  compressionRatio?: number;
}

/**
 * Compaction statistics
 */
export interface CompactionStats {
  itemsCompacted: number;
  bytesReclaimed: number;
  duration: number;
  timestamp: string;
}

/**
 * Storage statistics
 */
export interface StorageStats {
  items: number;
  sizeBytes: number;
  compressionRatio?: number;
  lastCompaction?: string;
  journalSize?: number;
  indexSize?: number;
  cacheHitRate?: number;
}