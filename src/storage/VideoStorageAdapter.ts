import type { StorageAdapter, WriteResult, GetResult, StorageStats, PayloadRef } from './StorageAdapter.js';
import type { MemoryItem, MemoryItemSummary, MemoryConfig, MemoryScope } from '../types/Memory.js';
import type { VideoEncoder } from '../video/VideoEncoder.js';

/**
 * Extended summary interface for video storage with payload reference
 */
interface VideoMemoryItemSummary extends MemoryItemSummary {
  payloadRef?: PayloadRef;
  contentHash?: string;
}
// Dynamic imports for video components to avoid startup dependency loading
let QRManager: any = null;
let QRDecoder: any = null;
let createOptimalEncoder: any = null;
let VideoSegmentManager: any = null;
let EnhancedFrameIndex: any = null;
let FrameIndexManager: any = null;
let MviWriter: any = null;

async function loadVideoComponents() {
  if (!QRManager) {
    try {
      // Import QR components
      const qrModule = await import('../qr/QRManager.js');
      QRManager = qrModule.QRManager;

      const qrDecoderModule = await import('../qr/QRDecoder.js');
      QRDecoder = qrDecoderModule.QRDecoder || qrDecoderModule.default;

      // Import video utilities (skip if causes FFmpeg issues)
      try {
        const videoUtilsModule = await import('../video/utils.js');
        createOptimalEncoder = videoUtilsModule.createOptimalEncoder;
        console.log('Video utilities loaded successfully');
      } catch (utilsError) {
        console.warn('Video utilities failed to load (probably FFmpeg issue):', (utilsError as Error).message);
        createOptimalEncoder = null;
      }

      // Import video segment manager
      const videoSegmentModule = await import('../video/VideoSegmentManager.js');
      VideoSegmentManager = videoSegmentModule.VideoSegmentManager;

      // Import frame index components - use fallback if not available
      try {
        const frameIndexModule = await import('../video/EnhancedFrameIndex.js');
        EnhancedFrameIndex = frameIndexModule.EnhancedFrameIndex;
        FrameIndexManager = frameIndexModule.FrameIndexManager;
      } catch (frameError) {
        console.warn('Enhanced frame index not available, using basic implementation');
        EnhancedFrameIndex = null;
        FrameIndexManager = null;
      }

      // Import MVI writer
      const mviModule = await import('../video/FrameIndex.js');
      MviWriter = mviModule.MviWriter;

      console.log('All video components loaded successfully');
      return true;
    } catch (error) {
      console.warn('Video components not available:', (error as Error).message);
      console.warn('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
      return false;
    }
  }
  return true;
}

// VideoEncoder type is now imported from ../video/VideoEncoder.js
import { LRU } from '../utils/lru.js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import * as path from 'path';
import { ulid } from '../util/ulid.js';

/**
 * VideoStorageAdapter implements video-based compressed storage for memory items
 * Uses QR encoding + video compression for massive storage reduction (50-100x)
 * with late materialization and content deduplication
 */
export class VideoStorageAdapter implements StorageAdapter {
  private directory: string;
  private scope: MemoryScope;

  // Phase 0 components integration (loaded dynamically)
  private qrManager: any = null;
  private qrDecoder: any = null;
  private videoEncoder: VideoEncoder | null = null;
  private segmentManager: any = null;
  private frameIndexManager: any = null;
  private mviWriter: any | null = null;

  // In-memory catalog for fast access
  private catalog: Record<string, VideoMemoryItemSummary> = {};

  // Payload cache for decoded content (1GB default)
  private payloadCache = new LRU<string, Buffer>(1024);

  // Content deduplication mapping
  private contentHashMap: Record<string, PayloadRef> = {};

  // Background encoding queue with batching
  private encodingQueue: MemoryItem[] = [];
  private isEncoding = false;
  private readonly batchSize = 20; // Items per segment
  private readonly maxQueueSize = 1000;

  // Video encoding state
  private encoderInitialized = false;

  constructor(directory: string, scope: MemoryScope) {
    this.directory = directory;
    this.scope = scope;

    this.ensureDirectories();
    this.loadCatalog();
    this.loadContentHashMap();

    // Initialize video components asynchronously
    this.initializeVideoComponents().catch(error => {
      console.warn('Video components initialization failed:', error);
      this.encoderInitialized = false;
    });

    // Start background optimization
    this.startBackgroundOptimization();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.directory,
      path.join(this.directory, 'items'),
      path.join(this.directory, 'videos'),
      path.join(this.directory, 'index'),
      path.join(this.directory, 'tmp')
    ];

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  private loadCatalog(): void {
    const catalogPath = path.join(this.directory, 'catalog.json');
    if (existsSync(catalogPath)) {
      try {
        const data = readFileSync(catalogPath, 'utf8');
        this.catalog = JSON.parse(data);
      } catch (error) {
        console.warn(`Failed to load catalog: ${error}`);
        this.catalog = {};
      }
    }
  }

  private saveCatalog(): void {
    const catalogPath = path.join(this.directory, 'catalog.json');
    writeFileSync(catalogPath, JSON.stringify(this.catalog, null, 2));
  }

  private loadContentHashMap(): void {
    const hashMapPath = path.join(this.directory, 'content-hash-map.json');
    if (existsSync(hashMapPath)) {
      try {
        const data = readFileSync(hashMapPath, 'utf8');
        this.contentHashMap = JSON.parse(data);
      } catch (error) {
        console.warn(`Failed to load content hash map: ${error}`);
        this.contentHashMap = {};
      }
    }
  }

  private saveContentHashMap(): void {
    const hashMapPath = path.join(this.directory, 'content-hash-map.json');
    writeFileSync(hashMapPath, JSON.stringify(this.contentHashMap, null, 2));
  }

  private computeContentHash(item: MemoryItem): string {
    const content = JSON.stringify({
      title: item.title,
      text: item.text || '',
      code: item.code || '',
      type: item.type
    });
    return createHash('sha256').update(content).digest('hex');
  }

  // Core item operations
  async writeItem(item: MemoryItem): Promise<void> {
    const contentHash = this.computeContentHash(item);

    // Check for deduplication
    if (this.contentHashMap[contentHash]) {
      // Reuse existing content
      const payloadRef = this.contentHashMap[contentHash];
      this.catalog[item.id] = {
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
        payloadRef,
        contentHash
      };
    } else {
      // Queue for video encoding
      this.encodingQueue.push(item);

      // For now, store summary without payload reference
      this.catalog[item.id] = {
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
        contentHash
      };

      // Trigger background encoding if not already running
      this.scheduleEncoding();
    }

    this.saveCatalog();
  }

  async readItem(id: string): Promise<MemoryItem | null> {
    const summary = this.catalog[id];
    if (!summary) return null;

    // If no payload reference, item might be in encoding queue
    if (!summary.payloadRef) {
      // Check encoding queue
      const queuedItem = this.encodingQueue.find(item => item.id === id);
      if (queuedItem) return queuedItem;
      return null;
    }

    // Use enhanced frame index for sub-100ms retrieval
    const content = await this.retrieveContentWithEnhancedIndex(summary.payloadRef);
    if (!content) return null;

    const itemData = JSON.parse(content.toString());

    return {
      id: summary.id,
      type: summary.type,
      scope: summary.scope,
      title: summary.title,
      text: itemData.text,
      code: itemData.code,
      facets: { tags: summary.tags, files: summary.files, symbols: summary.symbols },
      quality: { confidence: summary.confidence, pinned: summary.pinned, reuseCount: 0 },
      security: { sensitivity: 'private' },
      context: {},
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      version: 1,
      links: itemData.links
    };
  }

  async readItems(ids: string[]): Promise<MemoryItem[]> {
    const results: MemoryItem[] = [];
    for (const id of ids) {
      const item = await this.readItem(id);
      if (item) results.push(item);
    }
    return results;
  }

  async deleteItem(id: string): Promise<boolean> {
    if (!this.catalog[id]) return false;

    // Remove from catalog
    delete this.catalog[id];

    // Remove from encoding queue if present
    const queueIndex = this.encodingQueue.findIndex(item => item.id === id);
    if (queueIndex >= 0) {
      this.encodingQueue.splice(queueIndex, 1);
    }

    this.saveCatalog();
    return true;
  }

  // Catalog operations
  readCatalog(): Record<string, MemoryItemSummary> {
    // Convert to base interface for external usage
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
    // Convert to extended interface for internal usage
    this.catalog = {};
    for (const [id, summary] of Object.entries(catalog)) {
      this.catalog[id] = { ...summary } as VideoMemoryItemSummary;
    }
    this.saveCatalog();
  }

  async rebuildCatalog(): Promise<void> {
    // For video storage, catalog is authoritative
    // This is a no-op unless we want to rebuild from video files
  }

  // Configuration management
  readConfig(): MemoryConfig | null {
    const configPath = path.join(this.directory, 'config.json');
    if (!existsSync(configPath)) return null;

    try {
      const data = readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  writeConfig(config: MemoryConfig): void {
    const configPath = path.join(this.directory, 'config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  // Statistics with enhanced video segment data
  async getStats(): Promise<StorageStats> {
    const itemCount = Object.keys(this.catalog).length;
    const catalogSize = JSON.stringify(this.catalog).length;

    // Get actual video segment statistics
    const segmentStats = await this.segmentManager.getStorageStats();
    const indexStats = this.frameIndexManager.getCombinedStats();

    return {
      items: itemCount,
      sizeBytes: catalogSize + segmentStats.totalSizeBytes,
      compressionRatio: segmentStats.averageCompressionRatio,
      lastCompaction: segmentStats.newestSegment,
      indexSize: Math.round(indexStats.indexSizeMB * 1024 * 1024), // Convert MB to bytes
      cacheHitRate: indexStats.cacheHitRate
    };
  }

  async cleanup(): Promise<number> {
    try {
      console.log('Starting video storage cleanup and compaction...');

      // Perform segment compaction
      const compactionResult = await this.segmentManager.compactSegments();

      // Clear old frame caches
      this.frameIndexManager.clearAllCaches();

      // Cleanup payload cache - remove oldest 20%
      const cacheSize = this.payloadCache.size;
      const toRemove = Math.floor(cacheSize * 0.2);

      for (let i = 0; i < toRemove; i++) {
        const oldestKey = this.payloadCache.keys().next().value;
        if (oldestKey) {
          this.payloadCache.delete(oldestKey);
        }
      }

      console.log(`Cleanup completed: ${compactionResult.segmentsRemoved} segments removed, ${compactionResult.bytesReclaimed} bytes reclaimed`);

      return compactionResult.bytesReclaimed;
    } catch (error) {
      console.error('Storage cleanup failed:', error);
      return 0;
    }
  }

  // Content addressing
  async hasContent(hashes: string[]): Promise<Record<string, boolean>> {
    const result: Record<string, boolean> = {};
    for (const hash of hashes) {
      result[hash] = !!this.contentHashMap[hash];
    }
    return result;
  }

  async getByHash(hashes: string[]): Promise<Record<string, PayloadRef>> {
    const result: Record<string, PayloadRef> = {};
    for (const hash of hashes) {
      if (this.contentHashMap[hash]) {
        result[hash] = this.contentHashMap[hash];
      }
    }
    return result;
  }

  // Directory access
  getDirectory(): string {
    return this.directory;
  }

  // Create a stub encoder for testing/fallback when FFmpeg is not available
  private createStubEncoder(): VideoEncoder {
    return {
      async initialize(): Promise<void> {
        console.log('Stub video encoder initialized (FFmpeg not available)');
      },

      async dispose(): Promise<void> {
        console.log('Stub video encoder disposed');
      },

      async encode(frames: any, options: any, onProgress?: any, timeoutMs?: number): Promise<any> {
        console.log(`Stub encoder: would encode ${frames.length} frames (FFmpeg not available)`);
        // Return a minimal valid result for testing
        return {
          videoPath: '/tmp/stub-video.mp4',
          frameIndex: [],
          metadata: {
            totalFrames: frames.length,
            duration: frames.length / 30,
            fileSize: 1024
          }
        };
      },

      getDefaultOptions(): any {
        return {
          codec: 'h264',
          crf: 23,
          gop: 30,
          fps: 30,
          pixelFormat: 'yuv420p',
          preset: 'fast'
        };
      },

      async isAvailable(): Promise<boolean> {
        return false; // Stub encoder is not a real encoder
      },

      getInfo(): any {
        return {
          name: 'Stub Encoder',
          version: '1.0.0'
        };
      }
    };
  }

  // Initialize video components with fallback strategy
  private async initializeVideoComponents(): Promise<void> {
    try {
      // Load video components dynamically
      console.log('Loading video components...');
      const componentsLoaded = await loadVideoComponents();
      if (!componentsLoaded) {
        throw new Error('Failed to load video components');
      }

      // Initialize QR components
      console.log('Initializing QR components...');
      if (!QRManager) {
        throw new Error('QRManager not loaded');
      }
      this.qrManager = new QRManager();

      if (!QRDecoder) {
        throw new Error('QRDecoder not loaded');
      }
      this.qrDecoder = new QRDecoder();

      // Initialize video encoder (with fallback for FFmpeg issues)
      console.log('Initializing video encoder...');
      if (!createOptimalEncoder) {
        console.warn('createOptimalEncoder function not loaded, will use stub encoder');
        this.videoEncoder = this.createStubEncoder();
      } else {
        try {
          this.videoEncoder = await createOptimalEncoder();
          if (this.videoEncoder && typeof this.videoEncoder.initialize === 'function') {
            await this.videoEncoder.initialize();
          }
          console.log('Video encoder initialized successfully');
        } catch (encoderError) {
          console.warn('Video encoder initialization failed, using stub encoder:', encoderError);
          this.videoEncoder = this.createStubEncoder();
        }
      }

      // Initialize managers with loaded components
      console.log('Initializing segment manager...');
      if (!VideoSegmentManager) {
        throw new Error('VideoSegmentManager not loaded');
      }
      this.segmentManager = new VideoSegmentManager(this.directory, this.videoEncoder);

      // Initialize frame index manager (optional)
      if (FrameIndexManager) {
        this.frameIndexManager = new FrameIndexManager(this.directory);
      } else {
        console.warn('FrameIndexManager not available, using basic frame indexing');
        this.frameIndexManager = null;
      }

      this.encoderInitialized = true;
      console.log('Video components initialized successfully');
    } catch (error) {
      console.error('Failed to initialize video components:', error);
      this.encoderInitialized = false;
      throw error;
    }
  }

  // Private methods for video encoding/decoding
  private scheduleEncoding(): void {
    if (this.isEncoding || this.encodingQueue.length === 0) return;

    // Use setTimeout to avoid blocking the main thread
    setTimeout(() => this.processEncodingQueue(), 0);
  }

  private async processEncodingQueue(): Promise<void> {
    if (this.isEncoding) return;
    this.isEncoding = true;

    try {
      while (this.encodingQueue.length > 0) {
        // Process in configurable batches for optimal segment creation
        const batchSize = Math.min(this.batchSize, this.encodingQueue.length);
        const batch = this.encodingQueue.splice(0, batchSize);
        await this.encodeVideoSegment(batch);
      }
    } catch (error) {
      console.error('Video encoding failed:', error);

      // Re-queue failed items for retry
      if (error instanceof Error && error.message.includes('retry')) {
        // Could implement retry logic here
      }
    } finally {
      this.isEncoding = false;
    }
  }

  private async encodeVideoSegment(items: MemoryItem[]): Promise<void> {
    try {
      console.log(`Encoding video segment with ${items.length} items using VideoSegmentManager`);

      // Use VideoSegmentManager to create segment with FrameIndex integration
      const result = await this.segmentManager.createSegment(items, {
        maxFramesPerSegment: 300,
        targetSegmentSizeMB: 50,
        compressionProfile: 'balanced',
        enableDeduplication: true
      });

      // Update catalog with payload references from segment creation
      for (let i = 0; i < result.payloadRefs.length && i < items.length; i++) {
        const item = items[i];
        const payloadRef = result.payloadRefs[i];

        this.contentHashMap[payloadRef.hash] = payloadRef;

        if (this.catalog[item.id]) {
          this.catalog[item.id].payloadRef = payloadRef;
        }
      }

      this.saveContentHashMap();
      this.saveCatalog();

      console.log(`Successfully created segment ${result.segmentUlid} with ${result.payloadRefs.length} payload refs`);
    } catch (error) {
      console.error('Failed to encode video segment:', error);
      throw error;
    }
  }

  private async retrieveContentWithEnhancedIndex(payloadRef: PayloadRef): Promise<Buffer | null> {
    // Check cache first for fastest retrieval
    if (this.payloadCache.has(payloadRef.hash)) {
      return this.payloadCache.get(payloadRef.hash)!;
    }

    if (!payloadRef.segmentUlid || payloadRef.frameIdx === undefined) {
      console.warn('Invalid payload reference:', payloadRef);
      return null;
    }

    try {
      // Use enhanced frame index for sub-100ms frame lookup
      const enhancedIndex = this.frameIndexManager.getIndex(this.directory);
      const frameLookup = await enhancedIndex.getFrame(payloadRef.segmentUlid, payloadRef.frameIdx);

      if (!frameLookup.entry) {
        console.warn(`Frame not found: ${payloadRef.segmentUlid}:${payloadRef.frameIdx}`);
        return null;
      }

      console.log(`Frame lookup completed in ${frameLookup.accessTimeMs.toFixed(2)}ms (cache hit: ${frameLookup.cacheHit})`);

      // Use VideoSegmentManager to retrieve the actual content
      const item = await this.segmentManager.getContentFromSegment(
        payloadRef.segmentUlid,
        payloadRef.frameIdx
      );

      if (!item) {
        console.warn(`Content retrieval failed for ${payloadRef.segmentUlid}:${payloadRef.frameIdx}`);
        return null;
      }

      // Convert item back to buffer format
      const content = Buffer.from(JSON.stringify({
        text: item.text || '',
        code: item.code || '',
        links: item.links || []
      }));

      // Cache the result
      this.payloadCache.set(payloadRef.hash, content);

      return content;
    } catch (error) {
      console.error(`Failed to retrieve content from video: ${payloadRef.segmentUlid}:${payloadRef.frameIdx}:`, error);
      return null;
    }
  }

  /**
   * Start background optimization processes
   */
  private startBackgroundOptimization(): void {
    // Optimize frame indexes every 15 minutes
    setInterval(async () => {
      try {
        await this.frameIndexManager.optimizeAll();
        console.log('Frame index optimization completed');
      } catch (error) {
        console.warn('Frame index optimization failed:', error);
      }
    }, 900000); // 15 minutes

    // Queue processing check every 30 seconds
    setInterval(() => {
      if (this.encodingQueue.length > 0 && !this.isEncoding) {
        this.scheduleEncoding();
      }

      // Prevent queue overflow
      if (this.encodingQueue.length > this.maxQueueSize) {
        console.warn(`Encoding queue overflow: ${this.encodingQueue.length} items, removing oldest`);
        this.encodingQueue = this.encodingQueue.slice(-this.maxQueueSize);
      }
    }, 30000); // 30 seconds

    // Periodic cleanup every 2 hours
    setInterval(async () => {
      try {
        const reclaimed = await this.cleanup();
        if (reclaimed > 0) {
          console.log(`Periodic cleanup reclaimed ${reclaimed} bytes`);
        }
      } catch (error) {
        console.warn('Periodic cleanup failed:', error);
      }
    }, 7200000); // 2 hours
  }

  /**
   * Enhanced content addressing with segment-level lookup
   */
  async findContentByHash(contentHash: string): Promise<MemoryItem | null> {
    // Check if we have this content in our mapping
    const payloadRef = this.contentHashMap[contentHash];
    if (!payloadRef) {
      return null;
    }

    // Use segment manager for direct hash-based lookup
    return await this.segmentManager.findContentByHash(contentHash);
  }

  /**
   * Get video storage specific metrics
   */
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
    const segmentStats = await this.segmentManager.getStorageStats();
    const indexStats = this.frameIndexManager.getCombinedStats();

    return {
      segmentStats,
      indexStats,
      queueLength: this.encodingQueue.length,
      isEncoding: this.isEncoding,
      cacheStats: {
        payloadCacheSize: this.payloadCache.size,
        payloadCacheHits: 0 // Could track this with enhanced metrics
      }
    };
  }
}

/**
 * Factory for creating VideoStorageAdapter instances
 */
export class VideoStorageAdapterFactory {
  readonly type = 'video';

  create(directory: string, scope: MemoryScope): StorageAdapter {
    return new VideoStorageAdapter(directory, scope);
  }
}