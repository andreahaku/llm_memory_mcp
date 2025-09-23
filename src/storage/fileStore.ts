import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync, renameSync } from 'fs';
import { readdir, writeFile, rename, appendFile } from 'fs/promises';
import * as path from 'path';
import type { MemoryItem, MemoryItemSummary, JournalEntry, OptimizedJournalEntry, MemoryConfig } from '../types/Memory.js';
import { createHash } from 'node:crypto';

interface FileLock {
  path: string;
  acquired: number;
}

export class FileStore {
  private directory: string;
  private locks: Map<string, FileLock> = new Map();
  // Debounced catalog update state
  private pendingUpserts: Map<string, MemoryItemSummary> = new Map();
  private pendingDeletes: Set<string> = new Set();
  private flushTimer: NodeJS.Timeout | null = null;
  private compactionHook?: () => void;
  private compactThreshold = 500;
  private hashCache = new Map<string, string>(); // Cache item hashes
  private integrityChain: string[] = []; // Chain of content hashes for integrity
  private useOptimizedJournal = true; // Flag to enable optimized journal
  private journalAppendCount = 0;

  constructor(directory: string) {
    this.directory = directory;
    this.ensureDirectories();

    // Automatically detect and migrate legacy journals
    this.autoMigrateLegacyJournal();
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
    // Compute content hash for integrity
    const contentHash = this.computeItemHash(item);
    const prevHash = this.hashCache.get(item.id);

    if (this.useOptimizedJournal) {
      // Use optimized journal with content hashes
      const optimizedEntry: OptimizedJournalEntry = {
        op: 'upsert',
        id: item.id,
        contentHash,
        prevHash,
        ts: new Date().toISOString(),
        actor: 'llm-memory-mcp@1.0.0',
        meta: {
          size: JSON.stringify(item).length,
          type: item.type,
          scope: item.scope,
          title: item.title
        }
      };
      this.appendOptimizedJournal(optimizedEntry);
    } else {
      // Fallback to legacy journal for backward compatibility
      const journalEntry: JournalEntry = {
        op: 'upsert',
        item,
        ts: new Date().toISOString(),
        actor: 'llm-memory-mcp@1.0.0'
      };
      this.appendJournal(journalEntry);
    }

    // Update hash cache
    this.hashCache.set(item.id, contentHash);

    // Atomic item write
    await this.writeItemFileRaw(item);

    // Async catalog update
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
    if (this.useOptimizedJournal) {
      const optimizedEntry: OptimizedJournalEntry = {
        op: 'delete',
        id,
        ts: new Date().toISOString(),
        actor: 'llm-memory-mcp@1.0.0'
      };
      this.appendOptimizedJournal(optimizedEntry);
    } else {
      const journalEntry: JournalEntry = {
        op: 'delete',
        id,
        ts: new Date().toISOString(),
        actor: 'llm-memory-mcp@1.0.0'
      };
      this.appendJournal(journalEntry);
    }

    // Remove from hash cache
    this.hashCache.delete(id);

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
    this.pendingDeletes.delete(item.id);
    this.pendingUpserts.set(item.id, summary);
    this.debounceFlushCatalog();
  }

  private scheduleCatalogDelete(id: string): void {
    this.pendingUpserts.delete(id);
    this.pendingDeletes.add(id);
    this.debounceFlushCatalog();
  }

  private debounceFlushCatalog(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.acquireLock('catalog');
      try {
        const catalog = this.readCatalog();
        // Apply deletes first
        for (const id of this.pendingDeletes) delete catalog[id];
        // Apply upserts
        for (const [id, sum] of this.pendingUpserts) catalog[id] = sum;
        this.pendingDeletes.clear();
        this.pendingUpserts.clear();
        this.writeCatalog(catalog);
      } finally {
        this.releaseLock('catalog');
      }
    }, 100);
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

  // Raw item delete without journaling or catalog change (used by tail replay)
  removeItemFileRaw(id: string): void {
    const itemPath = path.join(this.directory, 'items', `${id}.json`);
    if (existsSync(itemPath)) unlinkSync(itemPath);
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

  async readJournalSince(sinceTs?: string): Promise<JournalEntry[]> {
    const entries = await this.readJournal();
    if (!sinceTs) return entries;
    return entries.filter(e => !e.ts || e.ts > sinceTs);
  }

  // ========== OPTIMIZED JOURNAL METHODS ==========

  /**
   * Compute normalized content hash for a memory item
   * Excludes volatile fields that shouldn't affect integrity
   */
  private computeItemHash(item: MemoryItem): string {
    // Create normalized version excluding volatile fields
    const normalized = {
      ...item,
      // Remove fields that change frequently but don't affect core content
      quality: {
        ...item.quality,
        lastAccessedAt: undefined,
        lastUsedAt: undefined,
        lastFeedbackAt: undefined,
        lastComputedConfidenceAt: undefined,
        decayUpdatedAt: undefined,
      },
      // Keep version for backward compatibility checks but normalize format
      version: item.version || 1,
      updatedAt: item.updatedAt, // Keep this as it's important for content changes
    };

    // Sort keys recursively for deterministic hashing
    const sorted = this.sortKeysRecursively(normalized);
    return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  }

  /**
   * Recursively sort object keys for deterministic serialization
   */
  private sortKeysRecursively(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortKeysRecursively(item));
    }

    const sorted: any = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = this.sortKeysRecursively(obj[key]);
    }
    return sorted;
  }

  /**
   * Update integrity chain with new hash
   */
  private updateIntegrityChain(hash: string): void {
    this.integrityChain.push(hash);
    // Keep chain bounded to prevent memory growth
    if (this.integrityChain.length > 1000) {
      this.integrityChain = this.integrityChain.slice(-1000);
    }
  }

  /**
   * Append optimized journal entry with content hash
   */
  private appendOptimizedJournal(entry: OptimizedJournalEntry): void {
    const journalPath = path.join(this.directory, 'journal-optimized.ndjson');
    appendFileSync(journalPath, JSON.stringify(entry) + '\n');

    // Update integrity chain if it's an upsert with content hash
    if (entry.op === 'upsert' && entry.contentHash) {
      this.updateIntegrityChain(entry.contentHash);
    }

    // Count and possibly trigger compaction hook
    this.journalAppendCount++;
    if (this.journalAppendCount >= this.compactThreshold) {
      this.journalAppendCount = 0;
      if (this.compactionHook) setImmediate(this.compactionHook);
    }
  }

  /**
   * Read optimized journal entries
   */
  async readOptimizedJournal(limit?: number): Promise<OptimizedJournalEntry[]> {
    const journalPath = path.join(this.directory, 'journal-optimized.ndjson');

    if (!existsSync(journalPath)) {
      return [];
    }

    try {
      const data = readFileSync(journalPath, 'utf8');
      const lines = data.trim().split('\n').filter(line => line);
      const entries = lines.map(line => JSON.parse(line) as OptimizedJournalEntry);

      if (limit) {
        return entries.slice(-limit);
      }

      return entries;
    } catch (error) {
      console.error('Error reading optimized journal:', error);
      return [];
    }
  }

  /**
   * Verify integrity using hash-based journal
   */
  async verifyIntegrityFromOptimizedJournal(): Promise<{
    valid: boolean;
    corruptedItems: string[];
    integrityScore: number;
    checkedCount: number;
  }> {
    const entries = await this.readOptimizedJournal();
    const corruptedItems: string[] = [];
    let validCount = 0;
    let checkedCount = 0;

    for (const entry of entries) {
      if (entry.op === 'upsert' && entry.contentHash && entry.id) {
        checkedCount++;
        try {
          const item = await this.readItem(entry.id);
          if (item) {
            const currentHash = this.computeItemHash(item);
            if (currentHash === entry.contentHash) {
              validCount++;
            } else {
              corruptedItems.push(entry.id);
              console.warn(`Hash mismatch for item ${entry.id}: expected ${entry.contentHash}, got ${currentHash}`);
            }
          } else {
            corruptedItems.push(entry.id);
            console.warn(`Item ${entry.id} not found but exists in journal`);
          }
        } catch (error) {
          corruptedItems.push(entry.id);
          console.error(`Error verifying item ${entry.id}:`, error);
        }
      }
    }

    return {
      valid: corruptedItems.length === 0,
      corruptedItems,
      integrityScore: checkedCount > 0 ? validCount / checkedCount : 1,
      checkedCount
    };
  }

  /**
   * Replace optimized journal with new entries
   */
  replaceOptimizedJournal(entries: OptimizedJournalEntry[]): void {
    const journalPath = path.join(this.directory, 'journal-optimized.ndjson');
    const content = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
    writeFileSync(journalPath, content);
  }

  /**
   * Migrate legacy journal to optimized format
   */
  async migrateToOptimizedJournal(): Promise<{
    migrated: number;
    errors: string[];
    sizeReduction: { before: number; after: number; percentage: number };
  }> {
    const legacyEntries = await this.readJournal();
    const optimizedEntries: OptimizedJournalEntry[] = [];
    const errors: string[] = [];
    let migrated = 0;

    console.log(`Starting migration of ${legacyEntries.length} legacy journal entries...`);

    for (const entry of legacyEntries) {
      try {
        if (entry.op === 'upsert' && entry.item) {
          // Convert upsert entries with content hashes
          const contentHash = this.computeItemHash(entry.item);

          optimizedEntries.push({
            op: entry.op,
            id: entry.item.id,
            contentHash,
            ts: entry.ts,
            actor: entry.actor,
            meta: {
              size: JSON.stringify(entry.item).length,
              type: entry.item.type,
              scope: entry.item.scope,
              title: entry.item.title
            }
          });

          // Update hash cache
          this.hashCache.set(entry.item.id, contentHash);
          migrated++;
        } else if (entry.op === 'delete' && entry.id) {
          // Convert delete entries
          optimizedEntries.push({
            op: entry.op,
            id: entry.id,
            ts: entry.ts,
            actor: entry.actor
          });
          migrated++;
        } else if (entry.op === 'link' && entry.link) {
          // Convert link entries
          optimizedEntries.push({
            op: entry.op,
            id: entry.link.from, // Use 'from' as the primary ID
            link: entry.link,
            ts: entry.ts,
            actor: entry.actor
          });
          migrated++;
        } else {
          // Convert other operations as-is
          optimizedEntries.push({
            op: entry.op as any,
            id: entry.id || 'unknown',
            ts: entry.ts,
            actor: entry.actor
          });
          migrated++;
        }
      } catch (error) {
        const errorMsg = `Failed to migrate entry: ${error}`;
        errors.push(errorMsg);
        console.error(errorMsg, entry);
      }
    }

    // Calculate size reduction
    const beforeSize = JSON.stringify(legacyEntries).length;
    const afterSize = JSON.stringify(optimizedEntries).length;
    const sizeReduction = {
      before: beforeSize,
      after: afterSize,
      percentage: beforeSize > 0 ? ((beforeSize - afterSize) / beforeSize) * 100 : 0
    };

    // Backup original journal
    this.backupLegacyJournal();

    // Replace with optimized version
    this.replaceOptimizedJournal(optimizedEntries);

    console.log(`Migration completed: ${migrated} entries migrated, ${errors.length} errors`);
    console.log(`Size reduction: ${beforeSize} → ${afterSize} bytes (${sizeReduction.percentage.toFixed(1)}% smaller)`);

    return { migrated, errors, sizeReduction };
  }

  /**
   * Backup legacy journal before migration
   */
  private backupLegacyJournal(): void {
    const journalPath = path.join(this.directory, 'journal.ndjson');
    const backupPath = path.join(this.directory, 'journal.ndjson.backup');

    if (existsSync(journalPath)) {
      try {
        renameSync(journalPath, backupPath);
        console.log(`Legacy journal backed up to: ${backupPath}`);
      } catch (error) {
        console.error('Failed to backup legacy journal:', error);
      }
    }
  }

  /**
   * Check if optimized journal exists and should be used
   */
  hasOptimizedJournal(): boolean {
    const optimizedPath = path.join(this.directory, 'journal-optimized.ndjson');
    return existsSync(optimizedPath);
  }

  /**
   * Automatically migrate legacy journal if it exists and optimized doesn't
   */
  private autoMigrateLegacyJournal(): void {
    // Run migration asynchronously to avoid blocking construction
    setImmediate(async () => {
      try {
        const stats = await this.getJournalStats();

        if (stats.migrationNeeded) {
          console.log(`🔄 Detected legacy journal in ${this.directory}, starting automatic migration...`);

          const result = await this.migrateToOptimizedJournal();

          console.log(`✅ Auto-migration completed successfully:`);
          console.log(`   • Migrated ${result.migrated} entries`);
          console.log(`   • Size reduction: ${result.sizeReduction.before} → ${result.sizeReduction.after} bytes (${result.sizeReduction.percentage.toFixed(1)}% smaller)`);
          console.log(`   • Errors: ${result.errors.length}`);

          if (result.errors.length > 0) {
            console.warn(`⚠️  Migration had ${result.errors.length} errors:`, result.errors.slice(0, 3));
          }
        }
      } catch (error) {
        console.error(`❌ Auto-migration failed for ${this.directory}:`, error);
        // Don't throw - continue with fallback to legacy journal
        this.useOptimizedJournal = false;
      }
    });
  }

  /**
   * Get journal statistics for both legacy and optimized formats
   */
  async getJournalStats(): Promise<{
    legacy: { exists: boolean; entries: number; sizeBytes: number };
    optimized: { exists: boolean; entries: number; sizeBytes: number };
    migrationNeeded: boolean;
  }> {
    const legacyPath = path.join(this.directory, 'journal.ndjson');
    const optimizedPath = path.join(this.directory, 'journal-optimized.ndjson');

    const legacy = {
      exists: existsSync(legacyPath),
      entries: 0,
      sizeBytes: 0
    };

    const optimized = {
      exists: existsSync(optimizedPath),
      entries: 0,
      sizeBytes: 0
    };

    if (legacy.exists) {
      try {
        const data = readFileSync(legacyPath, 'utf8');
        legacy.sizeBytes = data.length;
        legacy.entries = data.trim().split('\n').filter(line => line).length;
      } catch (error) {
        console.error('Error reading legacy journal stats:', error);
      }
    }

    if (optimized.exists) {
      try {
        const data = readFileSync(optimizedPath, 'utf8');
        optimized.sizeBytes = data.length;
        optimized.entries = data.trim().split('\n').filter(line => line).length;
      } catch (error) {
        console.error('Error reading optimized journal stats:', error);
      }
    }

    return {
      legacy,
      optimized,
      migrationNeeded: legacy.exists && !optimized.exists
    };
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

  // Snapshot metadata: record the last applied journal timestamp
  readSnapshotMeta(): { lastTs?: string; checksum?: string } | null {
    const p = path.join(this.directory, 'index', 'snapshot.json');
    if (!existsSync(p)) return null;
    try {
      const data = readFileSync(p, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  writeSnapshotMeta(meta: { lastTs: string; checksum?: string }): void {
    const dir = path.join(this.directory, 'index');
    const p = path.join(dir, 'snapshot.json');
    const tmp = p + '.tmp';
    writeFileSync(tmp, JSON.stringify(meta, null, 2));
    renameSync(tmp, p);
  }

  writeStateOk(meta: { ts: string; checksum?: string }): void {
    const dir = path.join(this.directory, 'index');
    const p = path.join(dir, 'state-ok.json');
    const tmp = p + '.tmp';
    writeFileSync(tmp, JSON.stringify(meta, null, 2));
    renameSync(tmp, p);
  }

  readStateOk(): { ts?: string; checksum?: string } | null {
    const p = path.join(this.directory, 'index', 'state-ok.json');
    if (!existsSync(p)) return null;
    try {
      const data = readFileSync(p, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
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
