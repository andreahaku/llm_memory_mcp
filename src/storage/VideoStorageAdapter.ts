import type { StorageAdapter, StorageStats } from './StorageAdapter.js';
import type { MemoryItem, MemoryItemSummary, MemoryConfig, MemoryScope } from '../types/Memory.js';
import type { VideoEncoder, VideoEncodingOptions } from '../video/VideoEncoder.js';
import type { QRFrame } from '../qr/QRManager.js';

import { LRU } from '../utils/lru.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as fs from 'fs-extra';
import * as path from 'path';

function log(message: string, ...args: any[]) {
  console.error(`[VideoStorageAdapter] ${new Date().toISOString()} ${message}`, ...args);
}

let QRManager: any = null;
let createOptimalEncoder: any = null;
let createVideoDecoderFactory: (() => Promise<any>) | null = null;

async function loadVideoComponents(): Promise<boolean> {
  try {
    if (!QRManager) {
      const qrModule = await import('../qr/QRManager.js');
      QRManager = qrModule.QRManager;
    }

    if (!createOptimalEncoder) {
      try {
        const videoUtilsModule = await import('../video/utils.js');
        createOptimalEncoder = videoUtilsModule.createOptimalEncoder;
      } catch (error) {
        console.warn('Video utilities unavailable for optimal encoder:', error);
        createOptimalEncoder = null;
      }
    }

    if (!createVideoDecoderFactory) {
      try {
        const decoderModule = await import('../video/VideoDecoder.js');
        createVideoDecoderFactory = decoderModule.createVideoDecoder;
      } catch (error) {
        console.warn('Video decoder factory unavailable:', error);
        createVideoDecoderFactory = null;
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to load video components:', error);
    return false;
  }
}

interface FrameRange {
  start: number;
  end: number;
}

interface FrameManifestEntry {
  frameIndex: number;
  chunkIndex: number;
  byteOffset: number;
}

interface ItemIndexEntry {
  frameStart: number;
  frameEnd: number;
  chunkCount: number;
  contentHash: string;
  manifest: FrameManifestEntry[];
  originalSize: number;
  encodedSize: number;
  isCompressed: boolean;
}

interface ConsolidatedVideoIndex {
  version: string;
  totalFrames: number;
  totalItems: number;
  createdAt: string;
  updatedAt: string;
  items: Record<string, ItemIndexEntry>;
  contentHashes: Record<string, { itemId: string; frameStart: number; frameEnd: number }>;
}

interface ConsolidatedVideoMemoryItemSummary extends MemoryItemSummary {
  frameRange: FrameRange;
  contentHash: string;
}

interface PendingItemRecord {
  item: MemoryItem;
  serialized: string;
  contentHash: string;
}

export class VideoStorageAdapter implements StorageAdapter {
  private readonly directory: string;
  private readonly scope: MemoryScope;

  private readonly videoPath: string;
  private readonly indexPath: string;
  private readonly catalogPath: string;

  private qrManager: any = null;
  private videoEncoder: VideoEncoder | null = null;
  private videoDecoder: any = null;

  private catalog: Record<string, ConsolidatedVideoMemoryItemSummary> = {};
  private index: ConsolidatedVideoIndex;

  private payloadCache = new LRU<string, Buffer>(256);
  private pendingItems = new Map<string, PendingItemRecord>();
  private pendingDeletes = new Set<string>();

  private isConsolidating = false;
  private encoderInitialized = false;
  private initializationPromise: Promise<void>;
  private flushPromise: Promise<void> | null = null;

  // Index update callbacks for search integration
  private indexUpdateCallbacks: Array<(items: MemoryItem[], deletedIds: string[]) => void> = [];
  private compactionHook: (() => void) | null = null;
  private compactionThreshold = 500;
  private compactionCounter = 0;

  constructor(directory: string, scope: MemoryScope) {
    this.directory = directory;
    this.scope = scope;

    this.videoPath = path.join(this.directory, 'segments', 'consolidated.mp4');
    this.indexPath = path.join(this.directory, 'segments', 'consolidated-index.json');
    this.catalogPath = path.join(this.directory, 'catalog.json');

    this.ensureDirectories();
    this.index = this.loadIndexFromDisk();
    this.catalog = this.loadCatalogFromDisk();
    this.ensureStorageBackendMarker();

    // Auto-rebuild catalog if index has items but catalog is empty
    // This handles cases where catalog.json was deleted or corrupted
    const hasIndexedItems = Object.keys(this.index.items).length > 0;
    const hasCatalogEntries = Object.keys(this.catalog).length > 0;

    if (hasIndexedItems && !hasCatalogEntries) {
      console.warn(`[VideoStorageAdapter] Video index has ${Object.keys(this.index.items).length} items but catalog is empty - rebuilding catalog`);
      this.initializationPromise = this.initializeVideoComponents().then(async () => {
        await this.rebuildCatalog();
        console.warn(`[VideoStorageAdapter] Catalog rebuilt: ${Object.keys(this.catalog).length} items restored`);
      });
    } else {
      this.initializationPromise = this.initializeVideoComponents();
    }
  }

  private ensureDirectories(): void {
    const dirs = [
      this.directory,
      path.join(this.directory, 'segments'),
      path.join(this.directory, 'tmp')
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private loadIndexFromDisk(): ConsolidatedVideoIndex {
    if (existsSync(this.indexPath)) {
      try {
        const data = readFileSync(this.indexPath, 'utf8');
        const parsed = JSON.parse(data) as ConsolidatedVideoIndex;
        parsed.version = parsed.version || '1.0.0';
        parsed.contentHashes = parsed.contentHashes || {};
        return parsed;
      } catch (error) {
        console.warn('Failed to load consolidated index, recreating:', error);
      }
    }
    return this.createEmptyIndex();
  }

  private loadCatalogFromDisk(): Record<string, ConsolidatedVideoMemoryItemSummary> {
    if (existsSync(this.catalogPath)) {
      try {
        const data = readFileSync(this.catalogPath, 'utf8');
        return JSON.parse(data) as Record<string, ConsolidatedVideoMemoryItemSummary>;
      } catch (error) {
        console.warn('Failed to load video catalog, recreating:', error);
      }
    }
    return {};
  }

  private ensureStorageBackendMarker(): void {
    try {
      const configPath = path.join(this.directory, 'config.json');
      let config: MemoryConfig;

      if (existsSync(configPath)) {
        try {
          config = JSON.parse(readFileSync(configPath, 'utf8')) as MemoryConfig;
        } catch (error) {
          console.warn('Failed to parse existing config while setting storage backend marker:', error);
          config = { version: '1.0.0' };
        }
      } else {
        config = { version: '1.0.0' };
      }

      const currentBackend = config.storage?.backend;
      if (currentBackend === 'video') {
        return;
      }

      config.storage = { ...(config.storage || {}), backend: 'video' };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      console.warn('Failed to ensure storage backend marker for video adapter:', error);
    }
  }

  private createEmptyIndex(): ConsolidatedVideoIndex {
    const now = new Date().toISOString();
    return {
      version: '1.0.0',
      totalFrames: 0,
      totalItems: 0,
      createdAt: now,
      updatedAt: now,
      items: {},
      contentHashes: {}
    };
  }

  private async initializeVideoComponents(): Promise<void> {
    try {
      const componentsLoaded = await loadVideoComponents();
      if (!componentsLoaded) {
        throw new Error('Video components unavailable');
      }

      this.qrManager = new QRManager();

      if (createOptimalEncoder) {
        try {
          this.videoEncoder = await createOptimalEncoder();
          if (this.videoEncoder && typeof this.videoEncoder.initialize === 'function') {
            await this.videoEncoder.initialize();
          }
        } catch (encoderError) {
          console.warn('Optimal video encoder initialization failed, using stub encoder:', encoderError);
          this.videoEncoder = this.createStubEncoder();
        }
      } else {
        this.videoEncoder = this.createStubEncoder();
      }

      if (createVideoDecoderFactory) {
        try {
          this.videoDecoder = await createVideoDecoderFactory();
        } catch (decoderError) {
          console.warn('Video decoder initialization failed:', decoderError);
          this.videoDecoder = null;
        }
      }

      this.encoderInitialized = true;
    } catch (error) {
      console.error('Failed to initialize consolidated video components:', error);
      this.encoderInitialized = false;
      throw error;
    }
  }

  private createStubEncoder(): VideoEncoder {
    return {
      async initialize(): Promise<void> {
        console.warn('Using stub video encoder - FFmpeg not available');
      },
      async dispose(): Promise<void> {
        // no-op
      },
      async encode(frames: QRFrame[]): Promise<any> {
        const frameIndex = frames.map((_, idx) => ({
          frameNumber: idx,
          timestamp: idx / 30,
          byteOffset: idx * 1024,
          frameType: 'I',
          frameSize: 1024,
          isKeyframe: true
        }));

        return {
          videoData: Buffer.alloc(Math.max(1, frames.length) * 1024),
          frameIndex,
          metadata: {
            totalFrames: frames.length,
            duration: frames.length / 30,
            fileSize: Math.max(1, frames.length) * 1024,
            encodingOptions: {},
            encodingStats: {
              encodingTime: 0,
              averageFps: 30,
              peakMemoryUsage: 0
            }
          }
        };
      },
      getDefaultOptions(): VideoEncodingOptions {
        return {
          codec: 'h264',
          crf: 26,
          gop: 30,
          fps: 30,
          pixelFormat: 'yuv420p',
          preset: 'fast'
        };
      },
      async isAvailable(): Promise<boolean> {
        return false;
      },
      getInfo(): any {
        return { name: 'stub', version: '1.0.0' };
      }
    };
  }

  private async waitForInitialization(): Promise<void> {
    try {
      await this.initializationPromise;
    } catch {
      // Initialization failure is logged elsewhere
    }

    if (!this.encoderInitialized) {
      throw new Error('Video components unavailable');
    }
  }

  private async ensureVideoDecoder(): Promise<void> {
    if (this.videoDecoder) {
      return;
    }

    if (!createVideoDecoderFactory) {
      await loadVideoComponents();
    }

    if (!createVideoDecoderFactory) {
      throw new Error('Video decoder factory not available');
    }

    this.videoDecoder = await createVideoDecoderFactory();
  }

  private serializeItem(item: MemoryItem): string {
    const payload = {
      id: item.id,
      type: item.type,
      scope: item.scope,
      title: item.title,
      text: item.text || '',
      code: item.code || '',
      facets: {
        tags: item.facets?.tags || [],
        files: item.facets?.files || [],
        symbols: item.facets?.symbols || []
      },
      quality: {
        confidence: item.quality?.confidence ?? 0.5,
        pinned: item.quality?.pinned ?? false,
        reuseCount: item.quality?.reuseCount ?? 0,
        helpfulCount: item.quality?.helpfulCount ?? 0,
        notHelpfulCount: item.quality?.notHelpfulCount ?? 0,
        ttlDays: item.quality?.ttlDays,
        expiresAt: item.quality?.expiresAt,
        decayedUsage: item.quality?.decayedUsage,
        decayUpdatedAt: item.quality?.decayUpdatedAt,
        lastAccessedAt: item.quality?.lastAccessedAt,
        lastUsedAt: item.quality?.lastUsedAt,
        lastFeedbackAt: item.quality?.lastFeedbackAt,
        lastComputedConfidenceAt: item.quality?.lastComputedConfidenceAt
      },
      security: item.security ?? { sensitivity: 'private' },
      context: item.context ?? {},
      links: item.links ?? [],
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      version: item.version ?? 1
    };

    return JSON.stringify(payload);
  }

  private deserializeItem(serialized: string): MemoryItem {
    try {
      const data = JSON.parse(serialized);
      const facets = data.facets ?? {
        tags: data.tags ?? [],
        files: data.files ?? [],
        symbols: data.symbols ?? []
      };

      return this.normalizeItem({
        id: data.id,
        type: data.type,
        scope: data.scope ?? this.scope,
        title: data.title,
        text: data.text ?? '',
        code: data.code ?? '',
        facets,
        quality: data.quality ?? { confidence: 0.5, pinned: false, reuseCount: 0 },
        security: data.security ?? { sensitivity: 'private' },
        context: data.context ?? {},
        links: data.links ?? [],
        createdAt: data.createdAt ?? new Date().toISOString(),
        updatedAt: data.updatedAt ?? data.createdAt ?? new Date().toISOString(),
        version: data.version ?? 1
      });
    } catch (error) {
      throw new Error(`Failed to parse serialized memory item: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private normalizeItem(item: MemoryItem): MemoryItem {
    return {
      ...item,
      scope: item.scope ?? this.scope,
      text: item.text ?? '',
      code: item.code ?? '',
      facets: {
        tags: item.facets?.tags || [],
        files: item.facets?.files || [],
        symbols: item.facets?.symbols || []
      },
      quality: {
        confidence: item.quality?.confidence ?? 0.5,
        pinned: item.quality?.pinned ?? false,
        reuseCount: item.quality?.reuseCount ?? 0,
        helpfulCount: item.quality?.helpfulCount ?? 0,
        notHelpfulCount: item.quality?.notHelpfulCount ?? 0,
        ttlDays: item.quality?.ttlDays,
        expiresAt: item.quality?.expiresAt,
        decayedUsage: item.quality?.decayedUsage,
        decayUpdatedAt: item.quality?.decayUpdatedAt,
        lastAccessedAt: item.quality?.lastAccessedAt,
        lastUsedAt: item.quality?.lastUsedAt,
        lastFeedbackAt: item.quality?.lastFeedbackAt,
        lastComputedConfidenceAt: item.quality?.lastComputedConfidenceAt
      },
      security: item.security ?? { sensitivity: 'private' },
      context: item.context ?? {},
      links: item.links ?? [],
      createdAt: item.createdAt ?? new Date().toISOString(),
      updatedAt: item.updatedAt ?? item.createdAt ?? new Date().toISOString(),
      version: item.version ?? 1
    };
  }

  private computeContentHash(serialized: string): string {
    return createHash('sha256').update(serialized).digest('hex');
  }

  private buildSummary(item: MemoryItem, entry: ItemIndexEntry): ConsolidatedVideoMemoryItemSummary {
    return {
      id: item.id,
      type: item.type,
      scope: item.scope,
      title: item.title,
      tags: item.facets?.tags || [],
      files: item.facets?.files || [],
      symbols: item.facets?.symbols || [],
      confidence: item.quality?.confidence ?? 0.5,
      pinned: item.quality?.pinned ?? false,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      frameRange: {
        start: entry.frameStart,
        end: entry.frameEnd
      },
      contentHash: entry.contentHash
    };
  }

  private saveIndex(): void {
    const indexDir = path.dirname(this.indexPath);
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }
    writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  private saveCatalog(): void {
    writeFileSync(this.catalogPath, JSON.stringify(this.catalog, null, 2));
  }

  async writeItem(item: MemoryItem): Promise<void> {
    await this.waitForInitialization();

    const normalized = this.normalizeItem(item);
    const serialized = this.serializeItem(normalized);
    const contentHash = this.computeContentHash(serialized);

    const existingEntry = this.index.items[normalized.id];
    if (existingEntry && existingEntry.contentHash === contentHash && !this.pendingDeletes.has(normalized.id)) {
      this.catalog[normalized.id] = this.buildSummary(normalized, existingEntry);
      this.saveCatalog();
      // Notify index updaters even for existing items to ensure search index is current
      log(`Notifying index updaters about existing item ${normalized.id}`);
      this.notifyIndexUpdaters([normalized], []);
      return;
    }

    this.pendingItems.set(normalized.id, { item: normalized, serialized, contentHash });
    this.pendingDeletes.delete(normalized.id);

    await this.flushPendingChanges();
  }

  async writeBatch(items: MemoryItem[]): Promise<void> {
    if (!items || items.length === 0) {
      return;
    }

    await this.waitForInitialization();
    let updatedExisting = false;

    for (const item of items) {
      const normalized = this.normalizeItem(item);
      const serialized = this.serializeItem(normalized);
      const contentHash = this.computeContentHash(serialized);

      const existingEntry = this.index.items[normalized.id];
      if (existingEntry && existingEntry.contentHash === contentHash && !this.pendingDeletes.has(normalized.id)) {
        this.catalog[normalized.id] = this.buildSummary(normalized, existingEntry);
        updatedExisting = true;
        continue;
      }

      this.pendingItems.set(normalized.id, { item: normalized, serialized, contentHash });
      this.pendingDeletes.delete(normalized.id);
    }

    if (updatedExisting) {
      this.saveCatalog();
    }

    await this.flushPendingChanges();
  }

  async readItem(id: string): Promise<MemoryItem | null> {
    // First check pending items (not yet flushed to video)
    if (this.pendingItems.has(id)) {
      return this.pendingItems.get(id)!.item;
    }

    // Check if item was marked for deletion
    if (this.pendingDeletes.has(id)) {
      return null;
    }

    // Look up item in the consolidated index
    const entry = this.index.items[id];
    if (!entry) {
      console.warn(`VideoStorageAdapter.readItem: Item ${id} not found in index`);
      return null;
    }

    // Validate entry integrity before attempting decode
    if (!this.validateIndexEntry(entry, id)) {
      console.error(`VideoStorageAdapter.readItem: Invalid index entry for ${id}`);
      // Try to rebuild the entry from video if possible
      const rebuiltItem = await this.attemptItemRecovery(id);
      if (rebuiltItem) {
        return rebuiltItem;
      }
      return null;
    }

    // Get the serialized payload from video storage
    const buffer = await this.getSerializedPayload(entry, id);
    if (!buffer) {
      console.error(`VideoStorageAdapter.readItem: Failed to decode payload for ${id}`);
      // Try recovery as last resort
      const rebuiltItem = await this.attemptItemRecovery(id);
      return rebuiltItem || null;
    }

    try {
      const item = this.deserializeItem(buffer.toString());

      // Validate that we got the correct item
      if (item && item.id !== id) {
        console.error(`VideoStorageAdapter.readItem: ID mismatch! Requested ${id}, got ${item.id}`);
        // This indicates serious index corruption - attempt recovery
        return await this.attemptItemRecovery(id) || null;
      }

      return item;
    } catch (error) {
      console.error(`VideoStorageAdapter.readItem: Failed to deserialize item ${id}:`, error);
      return await this.attemptItemRecovery(id) || null;
    }
  }

  async readItems(ids: string[]): Promise<MemoryItem[]> {
    const results: MemoryItem[] = [];
    for (const id of ids) {
      const item = await this.readItem(id);
      if (item) {
        results.push(item);
      }
    }
    return results;
  }

  async deleteItem(id: string): Promise<boolean> {
    const exists = !!this.index.items[id] || this.pendingItems.has(id);
    if (!exists) {
      return false;
    }

    this.pendingItems.delete(id);
    this.pendingDeletes.add(id);
    delete this.catalog[id];

    await this.flushPendingChanges();

    // Notify index updaters about the deletion after consolidation
    log(`Notifying index updaters about deletion of ${id}`);
    this.notifyIndexUpdaters([], [id]);

    return true;
  }

  async deleteBatch(ids: string[]): Promise<boolean[]> {
    const results: boolean[] = [];
    let needsFlush = false;

    for (const id of ids) {
      const exists = !!this.index.items[id] || this.pendingItems.has(id);
      if (exists) {
        this.pendingItems.delete(id);
        this.pendingDeletes.add(id);
        delete this.catalog[id];
        results.push(true);
        needsFlush = true;
      } else {
        results.push(false);
      }
    }

    if (needsFlush) {
      await this.flushPendingChanges();
    }

    return results;
  }

  async listItems(): Promise<string[]> {
    // Return IDs from both committed items and pending items
    const committedIds = Object.keys(this.index.items)
      .filter(id => !this.pendingDeletes.has(id));
    const pendingIds = Array.from(this.pendingItems.keys())
      .filter(id => !this.pendingDeletes.has(id));

    // Merge and deduplicate
    const allIds = new Set([...committedIds, ...pendingIds]);
    return Array.from(allIds);
  }

  readCatalog(): Record<string, MemoryItemSummary> {
    const result: Record<string, MemoryItemSummary> = {};
    for (const [id, summary] of Object.entries(this.catalog)) {
      result[id] = {
        id: summary.id,
        type: summary.type,
        scope: summary.scope,
        title: summary.title,
        tags: summary.tags,
        files: summary.files,
        symbols: summary.symbols,
        confidence: summary.confidence,
        pinned: summary.pinned,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt
      };
    }
    return result;
  }

  setCatalog(catalog: Record<string, MemoryItemSummary>): void {
    this.catalog = {};
    for (const [id, summary] of Object.entries(catalog)) {
      const entry = this.index.items[id];
      this.catalog[id] = {
        ...summary,
        frameRange: entry ? { start: entry.frameStart, end: entry.frameEnd } : { start: 0, end: 0 },
        contentHash: entry ? entry.contentHash : ''
      } as ConsolidatedVideoMemoryItemSummary;
    }
    this.saveCatalog();
  }

  setCompactionHook(callback: () => void, threshold?: number): void {
    this.compactionHook = callback;
    if (threshold !== undefined) {
      this.compactionThreshold = threshold;
    }
  }

  registerIndexUpdateCallback(callback: (items: MemoryItem[], deletedIds: string[]) => void): void {
    this.indexUpdateCallbacks.push(callback);
  }

  private notifyIndexUpdaters(items: MemoryItem[], deletedIds: string[]): void {
    for (const callback of this.indexUpdateCallbacks) {
      try {
        callback(items, deletedIds);
      } catch (error) {
        console.warn('Index update callback failed:', error);
      }
    }
  }

  private checkCompactionThreshold(): void {
    this.compactionCounter++;
    if (this.compactionHook && this.compactionCounter >= this.compactionThreshold) {
      this.compactionCounter = 0;
      try {
        this.compactionHook();
      } catch (error) {
        console.warn('Compaction hook failed:', error);
      }
    }
  }

  async rebuildCatalog(): Promise<void> {
    const rebuilt: Record<string, ConsolidatedVideoMemoryItemSummary> = {};
    for (const [id, entry] of Object.entries(this.index.items)) {
      const buffer = await this.getSerializedPayload(entry, id);
      if (!buffer) {
        continue;
      }
      const item = this.deserializeItem(buffer.toString());
      rebuilt[id] = this.buildSummary(item, entry);
    }
    this.catalog = rebuilt;
    this.saveCatalog();
  }

  readConfig(): MemoryConfig | null {
    const configPath = path.join(this.directory, 'config.json');
    if (!existsSync(configPath)) {
      return null;
    }
    try {
      const data = readFileSync(configPath, 'utf8');
      return JSON.parse(data) as MemoryConfig;
    } catch {
      return null;
    }
  }

  writeConfig(config: MemoryConfig): void {
    const configPath = path.join(this.directory, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  async getStats(): Promise<StorageStats> {
    const videoExists = await fs.pathExists(this.videoPath);
    const videoSize = videoExists ? (await fs.stat(this.videoPath)).size : 0;
    const indexExists = await fs.pathExists(this.indexPath);
    const indexSize = indexExists ? (await fs.stat(this.indexPath)).size : 0;

    return {
      items: Object.keys(this.index.items).length,
      sizeBytes: videoSize + indexSize,
      lastCompaction: this.index.updatedAt,
      journalSize: 0,
      indexSize,
      compressionRatio: this.computeCompressionRatio(videoSize),
      cacheHitRate: 0
    };
  }

  private computeCompressionRatio(videoSizeBytes: number): number | undefined {
    if (!videoSizeBytes) {
      return undefined;
    }

    const originalBytes = Object.values(this.index.items).reduce((sum, entry) => sum + entry.originalSize, 0);
    if (originalBytes === 0) {
      return undefined;
    }

    return originalBytes / videoSizeBytes;
  }

  async cleanup(): Promise<number> {
    this.payloadCache.clear();
    return 0;
  }

  getDirectory(): string {
    return this.directory;
  }

  // Optional StorageAdapter methods for compatibility

  async initialize(): Promise<void> {
    // Already handled in constructor
    await this.waitForInitialization();
  }

  async destroy(): Promise<void> {
    try {
      if (this.videoEncoder) {
        await this.videoEncoder.dispose();
      }
      if (this.videoDecoder) {
        await this.videoDecoder.dispose();
      }
      this.payloadCache.clear();
      this.pendingItems.clear();
      this.pendingDeletes.clear();
      this.indexUpdateCallbacks.length = 0;
    } catch (error) {
      console.warn('Error during VideoStorageAdapter destruction:', error);
    }
  }

  // Journal operations (not directly applicable to video storage)
  async readJournal(_limit?: number): Promise<any[]> {
    // Video storage doesn't use a traditional journal
    // Return empty array for compatibility
    return [];
  }

  async readJournalSince(_sinceTs?: string): Promise<any[]> {
    // Video storage doesn't use a traditional journal
    return [];
  }

  replaceJournal(_entries: any[]): void {
    // Video storage doesn't use a traditional journal
    // No-op for compatibility
  }

  // Snapshot operations
  writeSnapshotMeta(meta: { lastTs: string; checksum?: string }): void {
    try {
      const snapshotPath = path.join(this.directory, 'snapshot-meta.json');
      writeFileSync(snapshotPath, JSON.stringify(meta, null, 2));
    } catch (error) {
      console.warn('Failed to write snapshot meta:', error);
    }
  }

  readSnapshotMeta(): { lastTs: string; checksum?: string } | null {
    try {
      const snapshotPath = path.join(this.directory, 'snapshot-meta.json');
      if (existsSync(snapshotPath)) {
        const data = readFileSync(snapshotPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to read snapshot meta:', error);
    }
    return null;
  }

  writeStateOk(meta: { ts: string; checksum?: string }): void {
    try {
      const statePath = path.join(this.directory, 'state-ok.json');
      writeFileSync(statePath, JSON.stringify(meta, null, 2));
    } catch (error) {
      console.warn('Failed to write state ok:', error);
    }
  }

  readStateOk(): { ts: string; checksum?: string } | null {
    try {
      const statePath = path.join(this.directory, 'state-ok.json');
      if (existsSync(statePath)) {
        const data = readFileSync(statePath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('Failed to read state ok:', error);
    }
    return null;
  }

  // Content addressing for deduplication
  async hasContent(hashes: string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const hash of hashes) {
      result[hash] = !!this.index.contentHashes[hash];
    }
    return result;
  }

  async getByHash(hashes: string[]): Promise<Record<string, any>> {
    const result: Record<string, any> = {};
    for (const hash of hashes) {
      const mapping = this.index.contentHashes[hash];
      if (mapping) {
        const item = await this.readItem(mapping.itemId);
        if (item) {
          result[hash] = item;
        }
      }
    }
    return result;
  }

  // File operations for compatibility
  async writeItemFileRaw(item: MemoryItem): Promise<void> {
    // Delegate to standard writeItem
    await this.writeItem(item);
  }

  removeItemFileRaw(id: string): void {
    // Delegate to standard deleteItem (async operation)
    this.deleteItem(id).catch(error => {
      console.warn(`Failed to remove item ${id}:`, error);
    });
  }

  // Migration and integrity methods
  async migrateToOptimizedJournal(): Promise<any> {
    // Video storage doesn't use traditional journaling
    return {
      success: true,
      message: 'Video storage does not require journal migration'
    };
  }

  async verifyIntegrityFromOptimizedJournal(): Promise<any> {
    // Use our built-in index validation instead
    const validation = await this.validateIndex();
    return {
      success: validation.valid,
      errors: validation.errors,
      message: validation.valid ? 'Index integrity verified' : 'Index integrity issues found'
    };
  }

  async validateAndRepairIndex(): Promise<{ valid: boolean; errors: string[]; repaired?: boolean }> {
    const validation = await this.validateIndex();

    if (validation.valid) {
      return { valid: true, errors: [] };
    }

    // Attempt repairs for known issues
    let repaired = false;
    const remainingErrors: string[] = [];

    for (const error of validation.errors) {
      if (error === 'Index file does not exist' && this.index.totalItems === 0) {
        // Recreate empty index if it's missing but should be empty
        this.saveIndex();
        repaired = true;
      } else if (error.startsWith('Invalid index entry for item')) {
        // Remove invalid entries
        const itemId = error.match(/item (.+)$/)?.[1];
        if (itemId && this.index.items[itemId]) {
          delete this.index.items[itemId];
          delete this.catalog[itemId];
          repaired = true;
        } else {
          remainingErrors.push(error);
        }
      } else {
        remainingErrors.push(error);
      }
    }

    if (repaired) {
      this.saveIndex();
      this.saveCatalog();
      // Re-validate after repairs
      const finalValidation = await this.validateIndex();
      return {
        valid: finalValidation.valid,
        errors: finalValidation.errors,
        repaired: true
      };
    }

    return { valid: false, errors: remainingErrors };
  }

  private async validateIndex(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Check if index file exists
    if (!existsSync(this.indexPath)) {
      errors.push('Index file does not exist');
      return { valid: false, errors };
    }

    // Check if video file exists for non-empty index
    if (this.index.totalItems > 0 && !await fs.pathExists(this.videoPath)) {
      errors.push('Video file missing for non-empty index');
    }

    // Validate each index entry
    for (const [id, entry] of Object.entries(this.index.items)) {
      if (!this.validateIndexEntry(entry, id)) {
        errors.push(`Invalid index entry for item ${id}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async getJournalStats(): Promise<any> {
    // Return video-specific stats instead
    const metrics = await this.getVideoStorageMetrics();
    return {
      totalEntries: this.index.totalItems,
      sizeBytes: metrics.segmentStats.totalSizeBytes,
      optimized: true,
      compressionRatio: metrics.segmentStats.averageCompressionRatio
    };
  }

  hasOptimizedJournal(): boolean {
    // Video storage is inherently optimized
    return true;
  }

  async findContentByHash(contentHash: string): Promise<MemoryItem | null> {
    const mapping = this.index.contentHashes[contentHash];
    if (!mapping) {
      return null;
    }
    return await this.readItem(mapping.itemId);
  }

  async getVideoStorageMetrics(): Promise<{
    segmentStats: any;
    indexStats: any;
    queueLength: number;
    isEncoding: boolean;
    cacheStats: {
      payloadCacheSize: number;
      payloadCacheHits: number;
    };
  }> {
    const videoExists = await fs.pathExists(this.videoPath);
    const videoSize = videoExists ? (await fs.stat(this.videoPath)).size : 0;
    const indexExists = await fs.pathExists(this.indexPath);
    const indexSize = indexExists ? (await fs.stat(this.indexPath)).size : 0;

    return {
      segmentStats: {
        totalSegments: videoExists ? 1 : 0,
        totalFrames: this.index.totalFrames,
        totalSizeBytes: videoSize,
        averageCompressionRatio: this.computeCompressionRatio(videoSize) ?? 1,
        oldestSegment: videoExists ? 'consolidated' : '',
        newestSegment: videoExists ? 'consolidated' : '',
        fragmentationRatio: 0
      },
      indexStats: {
        totalIndexes: indexExists ? 1 : 0,
        totalSizeBytes: indexSize
      },
      queueLength: this.pendingItems.size,
      isEncoding: this.isConsolidating,
      cacheStats: {
        payloadCacheSize: this.payloadCache.size,
        payloadCacheHits: 0
      }
    };
  }

  private async flushPendingChanges(): Promise<void> {
    if (this.pendingItems.size === 0 && this.pendingDeletes.size === 0) {
      return;
    }

    if (this.flushPromise) {
      await this.flushPromise;
      return;
    }

    this.flushPromise = this.performConsolidation();
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
    }
  }

  private async performConsolidation(): Promise<void> {
    if (this.isConsolidating) {
      return;
    }

    this.isConsolidating = true;
    const replacements = new Map(this.pendingItems);
    const deletions = new Set(this.pendingDeletes);
    this.pendingItems.clear();
    this.pendingDeletes.clear();

    try {
      const records: PendingItemRecord[] = [];
      const existingIds = Object.keys(this.index.items);

      for (const id of existingIds) {
        if (deletions.has(id)) {
          continue;
        }

        const replacement = replacements.get(id);
        if (replacement) {
          records.push(replacement);
          replacements.delete(id);
          continue;
        }

        const entry = this.index.items[id];
        const buffer = await this.getSerializedPayload(entry, id);
        if (!buffer) {
          console.warn(`Skipping ${id} during consolidation - unable to decode existing payload`);
          continue;
        }
        const serialized = buffer.toString();
        const restored = this.deserializeItem(serialized);
        records.push({ item: restored, serialized, contentHash: entry.contentHash });
      }

      for (const [id, record] of replacements) {
        if (deletions.has(id)) {
          continue;
        }
        records.push(record);
      }

      await this.reencodeArchive(records);
    } catch (error) {
      for (const [id, record] of replacements) {
        this.pendingItems.set(id, record);
      }
      for (const id of deletions) {
        this.pendingDeletes.add(id);
      }
      throw error;
    } finally {
      this.isConsolidating = false;
    }
  }

  private async getSerializedPayload(entry: ItemIndexEntry, expectedItemId?: string): Promise<Buffer | null> {
    // Check cache first
    if (this.payloadCache.has(entry.contentHash)) {
      const cached = this.payloadCache.get(entry.contentHash)!;
      // Validate cached content if we have an expected ID
      if (expectedItemId) {
        try {
          const parsed = JSON.parse(cached.toString());
          if (parsed.id !== expectedItemId) {
            console.warn(`Cache contains wrong item for ${expectedItemId}, removing from cache`);
            this.payloadCache.delete(entry.contentHash);
          } else {
            return cached;
          }
        } catch (error) {
          console.warn('Failed to validate cached content, removing from cache:', error);
          this.payloadCache.delete(entry.contentHash);
        }
      } else {
        return cached;
      }
    }

    // Check if video file exists
    if (!await fs.pathExists(this.videoPath)) {
      console.error(`getSerializedPayload: Video file does not exist: ${this.videoPath}`);
      return null;
    }

    // Ensure video decoder is ready
    try {
      await this.ensureVideoDecoder();
    } catch (error) {
      console.error('getSerializedPayload: Failed to initialize video decoder:', error);
      return null;
    }

    // Validate frame range
    if (entry.frameStart < 0 || entry.frameEnd < entry.frameStart) {
      console.error(`getSerializedPayload: Invalid frame range [${entry.frameStart}, ${entry.frameEnd}]`);
      return null;
    }

    // Build frame indices array
    const frameIndices: number[] = [];
    for (let frame = entry.frameStart; frame <= entry.frameEnd; frame++) {
      frameIndices.push(frame);
    }

    if (frameIndices.length === 0) {
      console.error(`getSerializedPayload: No frames to decode for entry`);
      return null;
    }

    log(`getSerializedPayload: Decoding ${frameIndices.length} frames [${entry.frameStart}-${entry.frameEnd}] for item ${expectedItemId || 'unknown'}`);

    try {
      let serializedContent: string | null = null;

      if (frameIndices.length === 1) {
        // Single frame decoding
        const result = await this.videoDecoder.decodeFrame(this.videoPath, frameIndices[0], {
          extractionTimeoutMs: 20000,
          qrTimeoutMs: 15000,
          highQualityScaling: true
        });

        if (!result.success) {
          console.error(`getSerializedPayload: Single frame decode failed:`, result.error);
          return null;
        }

        if (!result.memoryItem) {
          console.error(`getSerializedPayload: Single frame decode returned no memory item`);
          return null;
        }

        // Validate the decoded item if we have an expected ID
        if (expectedItemId && result.memoryItem.id !== expectedItemId) {
          console.error(`getSerializedPayload: Single frame decode returned wrong item! Expected ${expectedItemId}, got ${result.memoryItem.id}`);
          return null;
        }

        const normalized = this.normalizeItem(result.memoryItem);
        serializedContent = this.serializeItem(normalized);
      } else {
        // Multi-frame decoding
        const result = await this.videoDecoder.decodeMultiFrame(this.videoPath, frameIndices, {
          extractionTimeoutMs: 45000,
          qrTimeoutMs: 20000,
          skipInvalidFrames: false // Don't skip frames for multi-frame content
        });

        if (!result.success) {
          console.error(`getSerializedPayload: Multi-frame decode failed:`, result.error);
          return null;
        }

        if (!result.results || result.results.length === 0) {
          console.error(`getSerializedPayload: Multi-frame decode returned no results`);
          return null;
        }

        const firstResult = result.results[0];
        if (!firstResult.memoryItem) {
          console.error(`getSerializedPayload: Multi-frame decode returned no memory item`);
          return null;
        }

        // Validate the decoded item if we have an expected ID
        if (expectedItemId && firstResult.memoryItem.id !== expectedItemId) {
          console.error(`getSerializedPayload: Multi-frame decode returned wrong item! Expected ${expectedItemId}, got ${firstResult.memoryItem.id}`);
          return null;
        }

        const normalized = this.normalizeItem(firstResult.memoryItem);
        serializedContent = this.serializeItem(normalized);
      }

      if (!serializedContent) {
        console.error(`getSerializedPayload: No serialized content produced`);
        return null;
      }

      // Verify content hash matches expected
      const actualHash = this.computeContentHash(serializedContent);
      if (actualHash !== entry.contentHash) {
        console.error(`getSerializedPayload: Content hash mismatch! Expected ${entry.contentHash}, got ${actualHash}`);
        // Still return the content but log the discrepancy
      }

      const buffer = Buffer.from(serializedContent);
      this.payloadCache.set(entry.contentHash, buffer);

      log(`getSerializedPayload: Successfully decoded and cached ${buffer.length} bytes for ${expectedItemId || 'unknown'}`);
      return buffer;

    } catch (error) {
      console.error(`getSerializedPayload: Failed to decode video payload for ${expectedItemId || 'unknown'}:`, error);
      return null;
    }
  }

  private async reencodeArchive(records: PendingItemRecord[]): Promise<void> {
    if (!this.qrManager) {
      this.qrManager = new QRManager();
    }

    this.payloadCache.clear();

    if (records.length === 0) {
      if (await fs.pathExists(this.videoPath)) {
        await fs.remove(this.videoPath);
      }
      this.index = this.createEmptyIndex();
      this.catalog = {};
      this.saveIndex();
      this.saveCatalog();
      return;
    }

    const frames: QRFrame[] = [];
    const newIndexItems: Record<string, ItemIndexEntry> = {};
    const newCatalog: Record<string, ConsolidatedVideoMemoryItemSummary> = {};
    const contentHashes: ConsolidatedVideoIndex['contentHashes'] = {};
    let frameCursor = 0;

    for (const record of records) {
      const qrResult = await this.qrManager.encodeToQR(record.serialized);
      const frameStart = frameCursor;
      for (const frame of qrResult.frames) {
        frames.push(frame);
      }
      const frameEnd = frameCursor + qrResult.frames.length - 1;
      const entry: ItemIndexEntry = {
        frameStart,
        frameEnd,
        chunkCount: qrResult.frames.length,
        contentHash: record.contentHash,
        manifest: qrResult.manifest.map((manifestEntry: { chunkId: string; frameIndex: number; byteOffset: number }) => ({
          frameIndex: frameStart + manifestEntry.frameIndex,
          chunkIndex: manifestEntry.frameIndex,
          byteOffset: manifestEntry.byteOffset
        })),
        originalSize: qrResult.metadata.originalSize,
        encodedSize: qrResult.metadata.encodedSize,
        isCompressed: qrResult.metadata.isCompressed
      };

      newIndexItems[record.item.id] = entry;
      newCatalog[record.item.id] = this.buildSummary(record.item, entry);
      contentHashes[record.contentHash] = {
        itemId: record.item.id,
        frameStart,
        frameEnd
      };
      this.payloadCache.set(record.contentHash, Buffer.from(record.serialized));
      frameCursor += qrResult.frames.length;
    }

    if (!this.videoEncoder) {
      throw new Error('Video encoder not initialized');
    }

    const fallbackOptions: Partial<VideoEncodingOptions> = {
      codec: 'h264',
      crf: 26,
      gop: 30,
      fps: 30,
      pixelFormat: 'yuv420p',
      preset: 'fast'
    };

    const encodingOptions: Partial<VideoEncodingOptions> = this.videoEncoder.getDefaultOptions
      ? this.videoEncoder.getDefaultOptions()
      : fallbackOptions;

    const normalizedFrames = this.normalizeFrameDimensions(frames);

    const encodingResult = await this.videoEncoder.encode(normalizedFrames, encodingOptions);
    await fs.ensureDir(path.dirname(this.videoPath));
    const tmpPath = path.join(this.directory, 'tmp', `consolidated-${Date.now()}.mp4`);
    await fs.writeFile(tmpPath, encodingResult.videoData);
    await fs.move(tmpPath, this.videoPath, { overwrite: true });

    const now = new Date().toISOString();
    const previousCreatedAt = this.index.totalItems > 0 ? this.index.createdAt : now;

    this.index = {
      version: '1.0.0',
      totalFrames: frameCursor,
      totalItems: Object.keys(newIndexItems).length,
      createdAt: previousCreatedAt,
      updatedAt: now,
      items: newIndexItems,
      contentHashes
    };

    this.catalog = newCatalog;

    this.saveIndex();
    this.saveCatalog();

    // Notify index updaters about all the items that were processed
    const allItems = records.map(r => r.item);
    log(`Notifying index updaters about ${allItems.length} items`);
    this.notifyIndexUpdaters(allItems, []);

    // Check if compaction should be triggered
    this.checkCompactionThreshold();
  }

  private normalizeFrameDimensions(frames: QRFrame[]): QRFrame[] {
    let maxWidth = 0;
    let maxHeight = 0;

    for (const frame of frames) {
      const { width, height } = frame.imageData;
      if (width > maxWidth) maxWidth = width;
      if (height > maxHeight) maxHeight = height;
    }

    if (maxWidth === 0 || maxHeight === 0) {
      return frames;
    }

    const needsNormalization = frames.some(
      frame => frame.imageData.width !== maxWidth || frame.imageData.height !== maxHeight
    );

    if (!needsNormalization) {
      return frames;
    }

    return frames.map(frame => {
      const { width, height, data } = frame.imageData;
      if (width === maxWidth && height === maxHeight) {
        return frame;
      }

      const normalizedData = new Uint8ClampedArray(maxWidth * maxHeight * 4);
      normalizedData.fill(255);

      const xOffset = Math.floor((maxWidth - width) / 2);
      const yOffset = Math.floor((maxHeight - height) / 2);

      for (let y = 0; y < height; y++) {
        const targetRow = y + yOffset;
        const sourceRowStart = y * width * 4;
        const targetRowStart = (targetRow * maxWidth + xOffset) * 4;
        normalizedData.set(
          data.subarray(sourceRowStart, sourceRowStart + width * 4),
          targetRowStart
        );
      }

      return {
        ...frame,
        imageData: {
          data: normalizedData,
          width: maxWidth,
          height: maxHeight
        }
      };
    });
  }

  private validateIndexEntry(entry: ItemIndexEntry, itemId: string): boolean {
    if (!entry) {
      console.warn(`validateIndexEntry: No entry provided for ${itemId}`);
      return false;
    }

    if (entry.frameStart < 0 || entry.frameEnd < entry.frameStart) {
      console.warn(`validateIndexEntry: Invalid frame range [${entry.frameStart}, ${entry.frameEnd}] for ${itemId}`);
      return false;
    }

    if (!entry.contentHash || entry.contentHash.length < 32) {
      console.warn(`validateIndexEntry: Invalid content hash for ${itemId}`);
      return false;
    }

    if (entry.chunkCount <= 0) {
      console.warn(`validateIndexEntry: Invalid chunk count ${entry.chunkCount} for ${itemId}`);
      return false;
    }

    return true;
  }

  private async attemptItemRecovery(itemId: string): Promise<MemoryItem | null> {
    log(`attemptItemRecovery: Attempting to recover item ${itemId}`);

    try {
      // Check if item exists in pending items
      if (this.pendingItems.has(itemId)) {
        log(`attemptItemRecovery: Found ${itemId} in pending items`);
        return this.pendingItems.get(itemId)!.item;
      }

      // Check if we can find the item by scanning all frame ranges
      const entry = this.index.items[itemId];
      if (!entry) {
        log(`attemptItemRecovery: No index entry found for ${itemId}`);
        return null;
      }

      // Try to decode with more lenient options
      if (await fs.pathExists(this.videoPath)) {
        await this.ensureVideoDecoder();

        const frameIndices: number[] = [];
        for (let frame = entry.frameStart; frame <= entry.frameEnd; frame++) {
          frameIndices.push(frame);
        }

        if (frameIndices.length === 1) {
          const result = await this.videoDecoder.decodeFrame(this.videoPath, frameIndices[0], {
            extractionTimeoutMs: 30000,
            qrTimeoutMs: 20000,
            highQualityScaling: false, // Try lower quality first
            skipInvalidFrames: true
          });

          if (result.success && result.memoryItem) {
            log(`attemptItemRecovery: Successfully recovered ${itemId} with lenient decoding`);
            return this.normalizeItem(result.memoryItem);
          }
        } else {
          const result = await this.videoDecoder.decodeMultiFrame(this.videoPath, frameIndices, {
            extractionTimeoutMs: 60000,
            qrTimeoutMs: 30000,
            skipInvalidFrames: true
          });

          if (result.success && result.results && result.results.length > 0 && result.results[0].memoryItem) {
            log(`attemptItemRecovery: Successfully recovered ${itemId} with lenient multi-frame decoding`);
            return this.normalizeItem(result.results[0].memoryItem);
          }
        }
      }

      log(`attemptItemRecovery: Failed to recover item ${itemId}`);
      return null;
    } catch (error) {
      console.error(`attemptItemRecovery: Error during recovery of ${itemId}:`, error);
      return null;
    }
  }
}

export class VideoStorageAdapterFactory {
  readonly type = 'video';

  create(directory: string, scope: MemoryScope): StorageAdapter {
    return new VideoStorageAdapter(directory, scope);
  }
}
