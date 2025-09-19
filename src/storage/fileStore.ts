import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, renameSync } from 'fs';
import { readdir, writeFile, rename, appendFile } from 'fs/promises';
import * as path from 'path';
import type { MemoryItem, MemoryItemSummary, JournalEntry, MemoryConfig } from '../types/Memory.js';

interface FileLock {
  path: string;
  acquired: number;
}

export class FileStore {
  private directory: string;
  private locks: Map<string, FileLock> = new Map();
  private pendingTimers: Set<NodeJS.Immediate> = new Set();
  private compactionHook?: () => void;
  private compactThreshold = 500;
  private journalAppendCount = 0;

  constructor(directory: string) {
    this.directory = directory;
    this.ensureDirectories();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.directory,
      path.join(this.directory, 'items'),
      path.join(this.directory, 'index'),
      path.join(this.directory, 'locks'),
      path.join(this.directory, 'tmp')
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private getLockPath(name: string): string {
    return path.join(this.directory, 'locks', `${name}.lock`);
  }

  private acquireLock(name: string): void {
    const lockPath = this.getLockPath(name);
    const now = Date.now();

    // Check if lock file exists and is stale (older than 30 seconds)
    if (existsSync(lockPath)) {
      try {
        const lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
        if (now - lockData.acquired < 30000) {
          throw new Error(`Lock ${name} is held by another process`);
        }
        // Stale lock, remove it
        unlinkSync(lockPath);
      } catch (error) {
        if (error instanceof SyntaxError) {
          // Corrupted lock file, remove it
          unlinkSync(lockPath);
        } else {
          throw error;
        }
      }
    }

    // Acquire lock
    const lockData = { pid: process.pid, acquired: now };
    writeFileSync(lockPath, JSON.stringify(lockData));
    this.locks.set(name, { path: lockPath, acquired: now });
  }

  private releaseLock(name: string): void {
    const lock = this.locks.get(name);
    if (lock && existsSync(lock.path)) {
      unlinkSync(lock.path);
      this.locks.delete(name);
    }
  }

  async writeItem(item: MemoryItem): Promise<void> {
    // 1) Journal-first
    const journalEntry: JournalEntry = {
      op: 'upsert',
      item,
      ts: new Date().toISOString(),
      actor: `llm-memory-mcp@1.0.0`
    };
    this.appendJournal(journalEntry);

    // 2) Atomic item write
    await this.writeItemFileRaw(item);

    // 3) Async catalog update
    this.scheduleCatalogUpsert(item);
  }

  async readItem(id: string): Promise<MemoryItem | null> {
    const itemPath = path.join(this.directory, 'items', `${id}.json`);

    if (!existsSync(itemPath)) {
      return null;
    }

    try {
      const data = readFileSync(itemPath, 'utf8');
      return JSON.parse(data) as MemoryItem;
    } catch (error) {
      console.error(`Error reading item ${id}:`, error);
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
    const itemPath = path.join(this.directory, 'items', `${id}.json`);

    if (!existsSync(itemPath)) {
      return false;
    }

    // Journal-first
    const journalEntry: JournalEntry = {
      op: 'delete',
      id,
      ts: new Date().toISOString(),
      actor: `llm-memory-mcp@1.0.0`
    };
    this.appendJournal(journalEntry);

    // Delete file
    unlinkSync(itemPath);

    // Async catalog update
    this.scheduleCatalogDelete(id);

    return true;
  }

  readCatalog(): Record<string, MemoryItemSummary> {
    const catalogPath = path.join(this.directory, 'catalog.json');

    if (!existsSync(catalogPath)) {
      return {};
    }

    try {
      const data = readFileSync(catalogPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading catalog:', error);
      return {};
    }
  }

  private writeCatalog(catalog: Record<string, MemoryItemSummary>): void {
    const catalogPath = path.join(this.directory, 'catalog.json');
    const tmpPath = path.join(this.directory, 'tmp', 'catalog.json.tmp');
    writeFileSync(tmpPath, JSON.stringify(catalog, null, 2));
    renameSync(tmpPath, catalogPath);
  }

  private scheduleCatalogUpsert(item: MemoryItem): void {
    const t = setImmediate(() => {
      this.acquireLock('catalog');
      try {
        const catalog = this.readCatalog();
        const summary: MemoryItemSummary = {
          id: item.id,
          type: item.type,
          scope: item.scope,
          title: item.title,
          tags: item.facets.tags,
          files: item.facets.files,
          symbols: item.facets.symbols,
          confidence: item.quality.confidence,
          pinned: item.quality.pinned,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        };
        catalog[item.id] = summary;
        this.writeCatalog(catalog);
      } finally {
        this.releaseLock('catalog');
        this.pendingTimers.delete(t);
      }
    });
    this.pendingTimers.add(t);
  }

  private scheduleCatalogDelete(id: string): void {
    const t = setImmediate(() => {
      this.acquireLock('catalog');
      try {
        const catalog = this.readCatalog();
        delete catalog[id];
        this.writeCatalog(catalog);
      } finally {
        this.releaseLock('catalog');
        this.pendingTimers.delete(t);
      }
    });
    this.pendingTimers.add(t);
  }

  // Raw item write without journaling or catalog change (used by journal replay)
  async writeItemFileRaw(item: MemoryItem): Promise<void> {
    const itemsDir = path.join(this.directory, 'items');
    const tmpDir = path.join(this.directory, 'tmp');
    const itemPath = path.join(itemsDir, `${item.id}.json`);
    const tmpPath = path.join(tmpDir, `${item.id}.json.tmp`);
    await writeFile(tmpPath, JSON.stringify(item, null, 2));
    await rename(tmpPath, itemPath);
  }

  // Overwrite catalog in one go (used by journal replay)
  setCatalog(catalog: Record<string, MemoryItemSummary>): void {
    this.acquireLock('catalog');
    try {
      this.writeCatalog(catalog);
    } finally {
      this.releaseLock('catalog');
    }
  }

  replaceJournal(entries: JournalEntry[]): void {
    const journalPath = path.join(this.directory, 'journal.ndjson');
    const tmp = path.join(this.directory, 'tmp', 'journal.ndjson.tmp');
    const content = entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : '');
    writeFileSync(tmp, content);
    renameSync(tmp, journalPath);
  }

  async rebuildCatalog(): Promise<void> {
    this.acquireLock('catalog');
    try {
      const catalog: Record<string, MemoryItemSummary> = {};
      const ids = await this.listItems();
      for (const id of ids) {
        const item = await this.readItem(id);
        if (!item) continue;
        catalog[id] = {
          id: item.id,
          type: item.type,
          scope: item.scope,
          title: item.title,
          tags: item.facets.tags,
          files: item.facets.files,
          symbols: item.facets.symbols,
          confidence: item.quality.confidence,
          pinned: item.quality.pinned,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }
      this.writeCatalog(catalog);
    } finally {
      this.releaseLock('catalog');
    }
  }

  private appendJournal(entry: JournalEntry): void {
    const journalPath = path.join(this.directory, 'journal.ndjson');
    appendFileSync(journalPath, JSON.stringify(entry) + '\n');
    // Count and possibly trigger compaction hook
    this.journalAppendCount++;
    if (this.journalAppendCount >= this.compactThreshold) {
      this.journalAppendCount = 0;
      if (this.compactionHook) setImmediate(this.compactionHook);
    }
  }

  async readJournal(limit?: number): Promise<JournalEntry[]> {
    const journalPath = path.join(this.directory, 'journal.ndjson');

    if (!existsSync(journalPath)) {
      return [];
    }

    try {
      const data = readFileSync(journalPath, 'utf8');
      const lines = data.trim().split('\n').filter(line => line);
      const entries = lines.map(line => JSON.parse(line) as JournalEntry);

      if (limit) {
        return entries.slice(-limit);
      }

      return entries;
    } catch (error) {
      console.error('Error reading journal:', error);
      return [];
    }
  }

  async listItems(): Promise<string[]> {
    const itemsDir = path.join(this.directory, 'items');

    if (!existsSync(itemsDir)) {
      return [];
    }

    try {
      const files = await readdir(itemsDir);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      console.error('Error listing items:', error);
      return [];
    }
  }

  readConfig(): MemoryConfig | null {
    const configPath = path.join(this.directory, 'config.json');

    if (!existsSync(configPath)) {
      return null;
    }

    try {
      const data = readFileSync(configPath, 'utf8');
      return JSON.parse(data) as MemoryConfig;
    } catch (error) {
      console.error('Error reading config:', error);
      return null;
    }
  }

  writeConfig(config: MemoryConfig): void {
    const configPath = path.join(this.directory, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  async getStats(): Promise<{
    totalItems: number;
    totalSize: number;
    lastModified: string;
  }> {
    const catalog = this.readCatalog();
    const itemCount = Object.keys(catalog).length;

    const catalogSize = JSON.stringify(catalog).length;
    const avgItemSize = 1024;
    const totalSize = catalogSize + (itemCount * avgItemSize);

    const entries = Object.values(catalog);
    const lastModified = entries.length > 0
      ? entries.reduce((latest, item) =>
          item.updatedAt > latest ? item.updatedAt : latest, entries[0].updatedAt)
      : new Date().toISOString();

    return {
      totalItems: itemCount,
      totalSize,
      lastModified
    };
  }

  async cleanup(): Promise<number> {
    const catalog = this.readCatalog();
    const now = new Date();
    let deletedCount = 0;

    for (const [id, summary] of Object.entries(catalog)) {
      if (summary.pinned) continue;

      const updatedAt = new Date(summary.updatedAt);
      const daysSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceUpdate > 30) {
        await this.deleteItem(id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  setCompactionHook(hook: () => void, threshold?: number): void {
    this.compactionHook = hook;
    if (threshold && threshold > 0) this.compactThreshold = threshold;
  }
}
