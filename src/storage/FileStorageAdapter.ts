import { FileStore } from './fileStore.js';
import type { StorageAdapter, WriteResult, GetResult, StorageStats, CompactionStats } from './StorageAdapter.js';
import type { MemoryItem, MemoryItemSummary, MemoryConfig, MemoryScope } from '../types/Memory.js';

/**
 * FileStorageAdapter wraps the existing FileStore to implement the StorageAdapter interface
 * Provides backward compatibility while enabling pluggable storage backends
 */
export class FileStorageAdapter implements StorageAdapter {
  private fileStore: FileStore;

  constructor(directory: string) {
    this.fileStore = new FileStore(directory);
  }

  // Core item operations
  async writeItem(item: MemoryItem): Promise<void> {
    return this.fileStore.writeItem(item);
  }

  async readItem(id: string): Promise<MemoryItem | null> {
    return this.fileStore.readItem(id);
  }

  async readItems(ids: string[]): Promise<MemoryItem[]> {
    return this.fileStore.readItems(ids);
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.fileStore.deleteItem(id);
  }

  // Batch operations for performance
  async writeBatch(items: MemoryItem[]): Promise<void> {
    // FileStore doesn't have native batch operations, so we'll do them serially
    // This could be optimized in the future
    for (const item of items) {
      await this.fileStore.writeItem(item);
    }
  }

  async deleteBatch(ids: string[]): Promise<boolean[]> {
    // FileStore doesn't have native batch operations, so we'll do them serially
    const results: boolean[] = [];
    for (const id of ids) {
      results.push(await this.fileStore.deleteItem(id));
    }
    return results;
  }

  // Catalog operations
  readCatalog(): Record<string, MemoryItemSummary> {
    return this.fileStore.readCatalog();
  }

  setCatalog(catalog: Record<string, MemoryItemSummary>): void {
    this.fileStore.setCatalog(catalog);
  }

  async rebuildCatalog(): Promise<void> {
    return this.fileStore.rebuildCatalog();
  }

  // Configuration management
  readConfig(): MemoryConfig | null {
    return this.fileStore.readConfig();
  }

  writeConfig(config: MemoryConfig): void {
    this.fileStore.writeConfig(config);
  }

  // Maintenance operations
  async getStats(): Promise<StorageStats> {
    const stats = await this.fileStore.getStats();
    return {
      items: stats.totalItems,
      sizeBytes: stats.totalSize,
      // lastCompaction not available in FileStore stats
      // journalSize not available in FileStore stats
    };
  }

  async cleanup(): Promise<number> {
    return this.fileStore.cleanup();
  }

  // Compaction and optimization
  setCompactionHook(callback: () => void, threshold?: number): void {
    this.fileStore.setCompactionHook(callback, threshold);
  }

  // Journaling operations
  async readJournal(limit?: number): Promise<any[]> {
    return this.fileStore.readJournal(limit);
  }

  async readJournalSince(sinceTs?: string): Promise<any[]> {
    return this.fileStore.readJournalSince(sinceTs);
  }

  replaceJournal(entries: any[]): void {
    this.fileStore.replaceJournal(entries);
  }

  // Snapshot support
  writeSnapshotMeta(meta: { lastTs: string; checksum?: string }): void {
    this.fileStore.writeSnapshotMeta(meta);
  }

  readSnapshotMeta(): { lastTs: string; checksum?: string } | null {
    const meta = this.fileStore.readSnapshotMeta();
    if (!meta || !meta.lastTs) return null;
    return { lastTs: meta.lastTs, checksum: meta.checksum };
  }

  writeStateOk(meta: { ts: string; checksum?: string }): void {
    this.fileStore.writeStateOk(meta);
  }

  readStateOk(): { ts: string; checksum?: string } | null {
    const state = this.fileStore.readStateOk();
    if (!state || !state.ts) return null;
    return { ts: state.ts, checksum: state.checksum };
  }

  // Content addressing - not implemented in FileStore yet
  async hasContent(hashes: string[]): Promise<Record<string, boolean>> {
    // FileStore doesn't implement content-hash addressing yet
    // Return all false for now - this will be implemented when needed
    const result: Record<string, boolean> = {};
    for (const hash of hashes) {
      result[hash] = false;
    }
    return result;
  }

  async getByHash(hashes: string[]): Promise<Record<string, any>> {
    // FileStore doesn't implement content-hash addressing yet
    // Return empty for now - this will be implemented when needed
    return {};
  }

  // Low-level file operations (for backward compatibility)
  async writeItemFileRaw(item: MemoryItem): Promise<void> {
    return this.fileStore.writeItemFileRaw(item);
  }

  removeItemFileRaw(id: string): void {
    this.fileStore.removeItemFileRaw(id);
  }

  async listItems(): Promise<string[]> {
    return this.fileStore.listItems();
  }

  // Migration and integrity support
  async migrateToOptimizedJournal(): Promise<any> {
    return this.fileStore.migrateToOptimizedJournal();
  }

  async verifyIntegrityFromOptimizedJournal(): Promise<any> {
    return this.fileStore.verifyIntegrityFromOptimizedJournal();
  }

  async getJournalStats(): Promise<any> {
    return this.fileStore.getJournalStats();
  }

  hasOptimizedJournal(): boolean {
    return this.fileStore.hasOptimizedJournal();
  }

  // Directory access
  getDirectory(): string {
    return (this.fileStore as any).directory;
  }

  // Lifecycle management
  async initialize(): Promise<void> {
    // FileStore initializes in constructor, so nothing needed here
  }

  async destroy(): Promise<void> {
    // FileStore doesn't have explicit cleanup, but we could add it
    // For now, just a no-op
  }
}

/**
 * Factory for creating FileStorageAdapter instances
 */
export class FileStorageAdapterFactory {
  readonly type = 'file';

  create(directory: string, scope: MemoryScope): StorageAdapter {
    return new FileStorageAdapter(directory);
  }
}