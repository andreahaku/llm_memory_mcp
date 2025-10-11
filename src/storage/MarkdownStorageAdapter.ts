// Markdown Storage Adapter - stores memory items as markdown files with frontmatter
// Implements StorageAdapter interface for markdown-based storage backend

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs';
import * as path from 'path';
import type { StorageAdapter, StorageStats } from './StorageAdapter.js';
import type { MemoryItem, MemoryItemSummary, MemoryConfig, MemoryScope } from '../types/Memory.js';
import { itemToMarkdown, markdownToItem, generateFilename } from '../markdown/MarkdownConverter.js';

function log(message: string, ...args: any[]) {
  console.error(`[MarkdownStorageAdapter] ${new Date().toISOString()} ${message}`, ...args);
}

/**
 * MarkdownStorageAdapter implements the StorageAdapter interface using markdown files
 *
 * Directory structure:
 * <scope-root>/
 *   memories/            # Markdown files: <id>-<slug>.md
 *   .memory/
 *     catalog.json       # Fast lookup: id → MemoryItemSummary
 *     config.json        # Storage configuration
 *     index/             # Search indexes (Phase 2)
 *       inverted.json
 *       backlinks.json
 *       graph.json
 */
export class MarkdownStorageAdapter implements StorageAdapter {
  private directory: string;
  private memoriesDir: string;
  private metaDir: string;
  private catalogPath: string;
  private configPath: string;
  private catalog: Record<string, MemoryItemSummary> = {};

  constructor(directory: string) {
    this.directory = directory;
    this.memoriesDir = path.join(directory, 'memories');
    this.metaDir = path.join(directory, '.memory');
    this.catalogPath = path.join(this.metaDir, 'catalog.json');
    this.configPath = path.join(this.metaDir, 'config.json');

    // Initialize directory structure
    this.initializeDirectories();

    // Load catalog
    this.catalog = this.loadCatalog();
  }

  private initializeDirectories(): void {
    if (!existsSync(this.memoriesDir)) {
      mkdirSync(this.memoriesDir, { recursive: true });
    }
    if (!existsSync(this.metaDir)) {
      mkdirSync(this.metaDir, { recursive: true });
    }
    const indexDir = path.join(this.metaDir, 'index');
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }
  }

  private loadCatalog(): Record<string, MemoryItemSummary> {
    if (!existsSync(this.catalogPath)) {
      return {};
    }

    try {
      const content = readFileSync(this.catalogPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      log(`⚠️  Failed to load catalog: ${error}`);
      return {};
    }
  }

  private saveCatalog(): void {
    try {
      writeFileSync(this.catalogPath, JSON.stringify(this.catalog, null, 2), 'utf-8');
    } catch (error) {
      log(`❌ Failed to save catalog: ${error}`);
      throw error;
    }
  }

  private getFilePath(id: string): string | null {
    // Find file by ID prefix (files are named <id>-<slug>.md)
    try {
      const files = readdirSync(this.memoriesDir);
      const file = files.find((f) => f.startsWith(id + '-') && f.endsWith('.md'));
      return file ? path.join(this.memoriesDir, file) : null;
    } catch (error) {
      return null;
    }
  }

  private itemToSummary(item: MemoryItem): MemoryItemSummary {
    return {
      id: item.id,
      type: item.type,
      scope: item.scope,
      title: item.title,
      tags: item.facets?.tags || [],
      files: item.facets?.files || [],
      symbols: item.facets?.symbols || [],
      confidence: item.quality?.confidence || 0.5,
      pinned: item.quality?.pinned || false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  // Core item operations
  async writeItem(item: MemoryItem): Promise<void> {
    try {
      // Convert item to markdown
      const markdown = itemToMarkdown(item);

      // Generate filename
      const filename = generateFilename(item);
      const filePath = path.join(this.memoriesDir, filename);

      // Check if file already exists with different name (rename scenario)
      const existingPath = this.getFilePath(item.id);
      if (existingPath && existingPath !== filePath) {
        // Delete old file
        unlinkSync(existingPath);
        log(`🔄 Renamed memory file: ${path.basename(existingPath)} → ${filename}`);
      }

      // Write markdown file
      writeFileSync(filePath, markdown, 'utf-8');

      // Update catalog
      this.catalog[item.id] = this.itemToSummary(item);
      this.saveCatalog();

      log(`✅ Wrote memory: ${item.id} (${filename})`);
    } catch (error) {
      log(`❌ Failed to write item ${item.id}: ${error}`);
      throw error;
    }
  }

  async readItem(id: string): Promise<MemoryItem | null> {
    const filePath = this.getFilePath(id);
    if (!filePath || !existsSync(filePath)) {
      return null;
    }

    try {
      const markdown = readFileSync(filePath, 'utf-8');
      const item = markdownToItem(markdown, id);
      return item;
    } catch (error) {
      log(`❌ Failed to read item ${id}: ${error}`);
      return null;
    }
  }

  async readItems(ids: string[]): Promise<MemoryItem[]> {
    const items: MemoryItem[] = [];
    for (const id of ids) {
      const item = await this.readItem(id);
      if (item) {
        items.push(item);
      }
    }
    return items;
  }

  async deleteItem(id: string): Promise<boolean> {
    const filePath = this.getFilePath(id);
    if (!filePath || !existsSync(filePath)) {
      return false;
    }

    try {
      unlinkSync(filePath);
      delete this.catalog[id];
      this.saveCatalog();
      log(`🗑️  Deleted memory: ${id}`);
      return true;
    } catch (error) {
      log(`❌ Failed to delete item ${id}: ${error}`);
      return false;
    }
  }

  // Batch operations
  async writeBatch(items: MemoryItem[]): Promise<void> {
    for (const item of items) {
      await this.writeItem(item);
    }
  }

  async deleteBatch(ids: string[]): Promise<boolean[]> {
    const results: boolean[] = [];
    for (const id of ids) {
      results.push(await this.deleteItem(id));
    }
    return results;
  }

  // Catalog operations
  readCatalog(): Record<string, MemoryItemSummary> {
    // Check if catalog is empty but files exist
    if (Object.keys(this.catalog).length === 0 && existsSync(this.memoriesDir)) {
      const files = readdirSync(this.memoriesDir).filter((f) => f.endsWith('.md'));
      if (files.length > 0) {
        log(`🔧 Found ${files.length} markdown files without catalog, rebuilding...`);
        this.rebuildCatalog();
      }
    }
    return this.catalog;
  }

  setCatalog(catalog: Record<string, MemoryItemSummary>): void {
    this.catalog = catalog;
    this.saveCatalog();
  }

  async rebuildCatalog(): Promise<void> {
    log('🔄 Rebuilding catalog from markdown files...');

    try {
      const files = readdirSync(this.memoriesDir).filter((f) => f.endsWith('.md'));
      const newCatalog: Record<string, MemoryItemSummary> = {};

      for (const file of files) {
        try {
          const filePath = path.join(this.memoriesDir, file);
          const markdown = readFileSync(filePath, 'utf-8');

          // Extract ID from filename (format: <id>-<slug>.md)
          const idMatch = file.match(/^([0-9A-Z]{26})-/);
          const id = idMatch ? idMatch[1] : null;

          if (!id) {
            log(`⚠️  Skipping file with invalid name format: ${file}`);
            continue;
          }

          const item = markdownToItem(markdown, id);
          newCatalog[id] = this.itemToSummary(item);
        } catch (error) {
          log(`⚠️  Failed to parse ${file}: ${error}`);
        }
      }

      this.catalog = newCatalog;
      this.saveCatalog();

      log(`✅ Rebuilt catalog with ${Object.keys(newCatalog).length} items`);
    } catch (error) {
      log(`❌ Failed to rebuild catalog: ${error}`);
      throw error;
    }
  }

  // Configuration management
  readConfig(): MemoryConfig | null {
    if (!existsSync(this.configPath)) {
      return null;
    }

    try {
      const content = readFileSync(this.configPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      log(`⚠️  Failed to read config: ${error}`);
      return null;
    }
  }

  writeConfig(config: MemoryConfig): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      log(`❌ Failed to write config: ${error}`);
      throw error;
    }
  }

  // Maintenance operations
  async getStats(): Promise<StorageStats> {
    let totalSize = 0;
    let itemCount = 0;

    if (existsSync(this.memoriesDir)) {
      const files = readdirSync(this.memoriesDir).filter((f) => f.endsWith('.md'));
      itemCount = files.length;

      for (const file of files) {
        try {
          const filePath = path.join(this.memoriesDir, file);
          const stats = statSync(filePath);
          totalSize += stats.size;
        } catch (error) {
          // Skip files that can't be read
        }
      }
    }

    return {
      items: itemCount,
      sizeBytes: totalSize,
    };
  }

  async cleanup(): Promise<number> {
    // Markdown storage doesn't accumulate temp files like FileStore
    // Just verify catalog matches actual files
    let cleaned = 0;

    const catalogIds = new Set(Object.keys(this.catalog));
    const fileIds = new Set<string>();

    if (existsSync(this.memoriesDir)) {
      const files = readdirSync(this.memoriesDir).filter((f) => f.endsWith('.md'));
      for (const file of files) {
        const idMatch = file.match(/^([0-9A-Z]{26})-/);
        if (idMatch) {
          fileIds.add(idMatch[1]);
        }
      }
    }

    // Remove catalog entries for missing files
    for (const id of catalogIds) {
      if (!fileIds.has(id)) {
        delete this.catalog[id];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.saveCatalog();
      log(`🧹 Cleaned ${cleaned} stale catalog entries`);
    }

    return cleaned;
  }

  // Compaction hook (no-op for markdown storage)
  setCompactionHook(_callback: () => void, _threshold?: number): void {
    // Markdown storage doesn't use journaling/compaction
  }

  // Journaling operations (not applicable to markdown storage)
  async readJournal(_limit?: number): Promise<any[]> {
    return [];
  }

  async readJournalSince(_sinceTs?: string): Promise<any[]> {
    return [];
  }

  replaceJournal(_entries: any[]): void {
    // No-op for markdown storage
  }

  // Snapshot support (not applicable)
  writeSnapshotMeta(_meta: { lastTs: string; checksum?: string }): void {
    // No-op for markdown storage
  }

  readSnapshotMeta(): { lastTs: string; checksum?: string } | null {
    return null;
  }

  writeStateOk(_meta: { ts: string; checksum?: string }): void {
    // No-op for markdown storage
  }

  readStateOk(): { ts: string; checksum?: string } | null {
    return null;
  }

  // Content addressing (not implemented in Phase 1)
  async hasContent(_hashes: string[]): Promise<Record<string, boolean>> {
    return {};
  }

  async getByHash(_hashes: string[]): Promise<Record<string, any>> {
    return {};
  }

  // Low-level file operations
  async writeItemFileRaw(item: MemoryItem): Promise<void> {
    return this.writeItem(item);
  }

  removeItemFileRaw(id: string): void {
    const filePath = this.getFilePath(id);
    if (filePath && existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  async listItems(): Promise<string[]> {
    if (!existsSync(this.memoriesDir)) {
      return [];
    }

    const files = readdirSync(this.memoriesDir).filter((f) => f.endsWith('.md'));
    const ids: string[] = [];

    for (const file of files) {
      const idMatch = file.match(/^([0-9A-Z]{26})-/);
      if (idMatch) {
        ids.push(idMatch[1]);
      }
    }

    return ids;
  }

  // Migration and integrity support (not applicable)
  async migrateToOptimizedJournal(): Promise<any> {
    return { alreadyOptimized: true };
  }

  async verifyIntegrityFromOptimizedJournal(): Promise<any> {
    return { valid: true };
  }

  async getJournalStats(): Promise<any> {
    return { optimized: true, entries: 0 };
  }

  hasOptimizedJournal(): boolean {
    return true; // Markdown storage doesn't use journals
  }

  // Directory access
  getDirectory(): string {
    return this.directory;
  }

  // Lifecycle management
  async initialize(): Promise<void> {
    this.initializeDirectories();
  }

  async destroy(): Promise<void> {
    // Save catalog one last time
    this.saveCatalog();
  }
}

/**
 * Factory for creating MarkdownStorageAdapter instances
 */
export class MarkdownStorageAdapterFactory {
  readonly type = 'markdown';

  create(directory: string, _scope: MemoryScope): StorageAdapter {
    return new MarkdownStorageAdapter(directory);
  }
}
