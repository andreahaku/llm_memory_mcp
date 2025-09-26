import type { StorageAdapter, StorageStats } from './StorageAdapter.js';
import type { MemoryItem, MemoryItemSummary, MemoryConfig, MemoryScope } from '../types/Memory.js';
import type { VideoEncoder, VideoEncodingOptions } from '../video/VideoEncoder.js';
import type { QRFrame } from '../qr/QRManager.js';

import { LRU } from '../utils/lru.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as fs from 'fs-extra';
import * as path from 'path';

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

    this.initializationPromise = this.initializeVideoComponents();
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
    if (this.pendingItems.has(id)) {
      return this.pendingItems.get(id)!.item;
    }

    const entry = this.index.items[id];
    if (!entry) {
      return null;
    }

    const buffer = await this.getSerializedPayload(entry);
    if (!buffer) {
      return null;
    }

    return this.deserializeItem(buffer.toString());
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

  async rebuildCatalog(): Promise<void> {
    const rebuilt: Record<string, ConsolidatedVideoMemoryItemSummary> = {};
    for (const [id, entry] of Object.entries(this.index.items)) {
      const buffer = await this.getSerializedPayload(entry);
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
        const buffer = await this.getSerializedPayload(entry);
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

  private async getSerializedPayload(entry: ItemIndexEntry): Promise<Buffer | null> {
    if (this.payloadCache.has(entry.contentHash)) {
      return this.payloadCache.get(entry.contentHash)!;
    }

    if (!await fs.pathExists(this.videoPath)) {
      return null;
    }

    await this.ensureVideoDecoder();

    const frameIndices: number[] = [];
    for (let frame = entry.frameStart; frame <= entry.frameEnd; frame++) {
      frameIndices.push(frame);
    }

    try {
      let decodedItem: MemoryItem | null = null;
      if (frameIndices.length <= 1) {
        const result = await this.videoDecoder.decodeFrame(this.videoPath, frameIndices[0], {
          extractionTimeoutMs: 15000,
          qrTimeoutMs: 10000,
          highQualityScaling: true
        });
        if (!result.success || !result.memoryItem) {
          return null;
        }
        decodedItem = result.memoryItem;
      } else {
        const result = await this.videoDecoder.decodeMultiFrame(this.videoPath, frameIndices, {
          extractionTimeoutMs: 30000,
          qrTimeoutMs: 15000
        });
        if (!result.success || result.results.length === 0 || !result.results[0].memoryItem) {
          return null;
        }
        decodedItem = result.results[0].memoryItem;
      }

      if (!decodedItem) {
        return null;
      }

      const normalized = this.normalizeItem(decodedItem);
      const serialized = this.serializeItem(normalized);
      const buffer = Buffer.from(serialized);
      this.payloadCache.set(entry.contentHash, buffer);
      return buffer;
    } catch (error) {
      console.error('Failed to decode video payload:', error);
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
}

export class VideoStorageAdapterFactory {
  readonly type = 'video';

  create(directory: string, scope: MemoryScope): StorageAdapter {
    return new VideoStorageAdapter(directory, scope);
  }
}
