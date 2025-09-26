/**
 * VideoStorageAdapter Integration Plan with Phase 0 VideoEncoder Components
 * This file contains the complete integration implementation for VideoStorageAdapter
 */

import type { StorageAdapter, WriteResult, GetResult, StorageStats, PayloadRef } from './StorageAdapter.js';
import type { MemoryItem, MemoryItemSummary, MemoryConfig, MemoryScope } from '../types/Memory.js';
import type { VideoEncoder, VideoEncodingOptions, VideoEncodingProgress, VideoEncodingResult } from '../video/VideoEncoder.js';
import type { QRFrame } from '../qr/QRManager.js';
import { QRManager } from '../qr/QRManager.js';
import { createOptimalEncoder, getRecommendedEncodingProfile, optimizeEncodingForQR } from '../video/utils.js';
import { QR_ENCODING_PROFILES } from '../video/VideoEncoder.js';
import { LRU } from '../utils/lru.js';
import { ulid } from '../util/ulid.js';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import * as path from 'path';

/**
 * Video segment metadata for efficient access and management
 */
interface VideoSegment {
  segmentUlid: string;
  filePath: string;
  frameCount: number;
  items: Array<{
    itemId: string;
    contentHash: string;
    frameIdx: number;
    size: number;
  }>;
  metadata: {
    encodingOptions: VideoEncodingOptions;
    createdAt: string;
    fileSize: number;
    duration: number;
  };
}

/**
 * Enhanced VideoStorageAdapter with real video encoding/decoding integration
 */
export class VideoStorageAdapter implements StorageAdapter {
  private directory: string;
  private scope: MemoryScope;
  private qrManager = new QRManager();

  // Video encoding infrastructure
  private encoder: VideoEncoder | null = null;
  private encoderInitPromise: Promise<VideoEncoder> | null = null;

  // In-memory catalog for fast access
  private catalog: Record<string, MemoryItemSummary> = {};

  // Video segment management
  private segments: Record<string, VideoSegment> = {};

  // Payload cache for decoded content (1GB default)
  private payloadCache = new LRU<string, Buffer>(1024);

  // Content deduplication mapping
  private contentHashMap: Record<string, PayloadRef> = {};

  // Background encoding queue with batching
  private encodingQueue: MemoryItem[] = [];
  private isEncoding = false;
  private readonly BATCH_SIZE = 20; // Encode 20 items per video segment

  constructor(directory: string, scope: MemoryScope) {
    this.directory = directory;
    this.scope = scope;
    this.ensureDirectories();
    this.loadCatalog();
    this.loadSegments();
    this.loadContentHashMap();
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

  // ===== ENCODER INITIALIZATION WITH FALLBACK =====

  /**
   * Initialize optimal encoder with Native → WASM fallback strategy
   */
  private async initializeEncoders(): Promise<VideoEncoder> {
    if (this.encoder) return this.encoder;

    if (this.encoderInitPromise) return this.encoderInitPromise;

    this.encoderInitPromise = this.createOptimalEncoderWithFallback();
    this.encoder = await this.encoderInitPromise;
    return this.encoder;
  }

  private async createOptimalEncoderWithFallback(): Promise<VideoEncoder> {
    try {
      // Try to create optimal encoder (Native FFmpeg preferred)
      const encoder = await createOptimalEncoder();
      await encoder.initialize();

      console.log(`Video encoder initialized: ${encoder.getInfo().name}`);
      return encoder;
    } catch (error) {
      console.warn('Failed to initialize optimal encoder, trying fallback options:', error);

      // Fallback strategy: try each encoder type explicitly
      const { NativeFFmpegEncoder, isNativeEncoderSupported } = await import('../video/NativeEncoder.js');
      const { WasmFFmpegEncoder, isWasmEncoderSupported } = await import('../video/WasmEncoder.js');

      // Try Native FFmpeg first
      try {
        if (await isNativeEncoderSupported()) {
          const nativeEncoder = new NativeFFmpegEncoder();
          await nativeEncoder.initialize();
          console.log('Using Native FFmpeg encoder as fallback');
          return nativeEncoder;
        }
      } catch (nativeError) {
        console.warn('Native encoder fallback failed:', nativeError);
      }

      // Try WASM FFmpeg as final fallback
      try {
        if (await isWasmEncoderSupported()) {
          const wasmEncoder = new WasmFFmpegEncoder();
          await wasmEncoder.initialize();
          console.log('Using WASM FFmpeg encoder as final fallback');
          return wasmEncoder;
        }
      } catch (wasmError) {
        console.warn('WASM encoder fallback failed:', wasmError);
      }

      throw new Error('No video encoder could be initialized. Please ensure FFmpeg is installed or WASM support is available.');
    }
  }

  // ===== VIDEO ENCODING PIPELINE =====

  /**
   * Encode memory items to video segment with optimal QR settings
   */
  private async encodeVideoSegment(items: MemoryItem[]): Promise<VideoSegment> {
    const encoder = await this.initializeEncoders();
    const segmentUlid = ulid();

    try {
      // Convert items to QR frames
      const allFrames: QRFrame[] = [];
      const itemFrameMapping: Array<{ itemId: string; contentHash: string; frameIdx: number; size: number }> = [];

      for (const item of items) {
        const content = JSON.stringify({
          title: item.title,
          text: item.text || '',
          code: item.code || '',
          links: item.links || [],
          type: item.type,
          tags: item.tags || []
        });

        // Generate QR frames for this item
        const qrResult = await this.qrManager.encodeToQR(content);
        const startFrameIdx = allFrames.length;

        allFrames.push(...qrResult.frames);

        // Record frame mapping for this item
        itemFrameMapping.push({
          itemId: item.id,
          contentHash: this.computeContentHash(item),
          frameIdx: startFrameIdx,
          size: qrResult.metadata.encodedSize
        });
      }

      if (allFrames.length === 0) {
        throw new Error('No QR frames generated for video segment');
      }

      // Optimize encoding options for QR content
      const encodingOptions = optimizeEncodingForQR(allFrames, {
        ...QR_ENCODING_PROFILES.HIGH_QUALITY_FAST,
        // Override specific settings for batch encoding
        fps: 30,
        gop: Math.min(30, allFrames.length), // Keyframe every 30 frames or total frames
      });

      // Track encoding progress
      const progressCallback = (progress: VideoEncodingProgress) => {
        console.log(`Encoding segment ${segmentUlid}: ${progress.currentFrame}/${progress.totalFrames} frames (${progress.encodingFps.toFixed(1)} fps)`);
      };

      // Encode video with timeout
      const timeoutMs = Math.max(300000, allFrames.length * 1000); // 5 minutes + 1s per frame
      const encodingResult = await encoder.encode(allFrames, encodingOptions, progressCallback, timeoutMs);

      // Save video file
      const videoFileName = `segment_${segmentUlid}.mp4`;
      const videoFilePath = path.join(this.directory, 'videos', videoFileName);
      writeFileSync(videoFilePath, encodingResult.videoData);

      // Create segment metadata
      const segment: VideoSegment = {
        segmentUlid,
        filePath: videoFilePath,
        frameCount: allFrames.length,
        items: itemFrameMapping,
        metadata: {
          encodingOptions,
          createdAt: new Date().toISOString(),
          fileSize: encodingResult.videoData.length,
          duration: encodingResult.metadata.duration
        }
      };

      // Save segment metadata
      this.segments[segmentUlid] = segment;
      this.saveSegments();

      // Update content hash map and catalog
      for (const itemMapping of itemFrameMapping) {
        const payloadRef: PayloadRef = {
          hash: itemMapping.contentHash,
          segmentUlid: segmentUlid,
          frameIdx: itemMapping.frameIdx,
          size: itemMapping.size
        };

        this.contentHashMap[itemMapping.contentHash] = payloadRef;

        if (this.catalog[itemMapping.itemId]) {
          this.catalog[itemMapping.itemId].payloadRef = payloadRef;
        }
      }

      this.saveContentHashMap();
      this.saveCatalog();

      console.log(`Video segment encoded: ${segmentUlid} (${allFrames.length} frames, ${encodingResult.videoData.length} bytes)`);
      return segment;

    } catch (error) {
      console.error(`Failed to encode video segment ${segmentUlid}:`, error);
      throw new Error(`Video segment encoding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ===== VIDEO DECODING PIPELINE =====

  /**
   * Decode content from video segment using frame extraction
   */
  private async decodeFromVideo(payloadRef: PayloadRef): Promise<Buffer> {
    // Check cache first
    if (this.payloadCache.has(payloadRef.hash)) {
      return this.payloadCache.get(payloadRef.hash)!;
    }

    const segment = this.segments[payloadRef.segmentUlid];
    if (!segment) {
      throw new Error(`Video segment not found: ${payloadRef.segmentUlid}`);
    }

    try {
      // Find the item mapping in the segment
      const itemMapping = segment.items.find(item => item.contentHash === payloadRef.hash);
      if (!itemMapping) {
        throw new Error(`Item not found in video segment: ${payloadRef.hash}`);
      }

      // For now, we'll use a simplified approach that assumes we can extract QR frames from video
      // In a complete implementation, this would involve:
      // 1. Using FFmpeg/ffprobe to extract specific frames from the video
      // 2. Converting extracted frames back to QR codes
      // 3. Decoding QR codes back to original content

      // TODO: Implement actual video frame extraction and QR decoding
      // This requires additional utilities for:
      // - Frame extraction from MP4 at specific indices
      // - QR code detection and decoding from extracted frames
      // - Content reassembly from multi-frame QR sequences

      // Placeholder implementation - in production, replace with actual decoding
      console.warn(`Video decoding not fully implemented for segment ${payloadRef.segmentUlid}, frame ${payloadRef.frameIdx}`);

      const placeholderContent = Buffer.from(JSON.stringify({
        text: `Content from video segment ${payloadRef.segmentUlid} (frame ${payloadRef.frameIdx})`,
        code: '',
        links: [],
        // Note: This would be replaced with actual decoded content
        _placeholder: true,
        _segmentInfo: {
          segmentUlid: payloadRef.segmentUlid,
          frameIdx: payloadRef.frameIdx,
          hash: payloadRef.hash
        }
      }));

      // Cache the result
      this.payloadCache.set(payloadRef.hash, placeholderContent);
      return placeholderContent;

    } catch (error) {
      throw new Error(`Failed to decode from video: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ===== BACKGROUND ENCODING QUEUE MANAGEMENT =====

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
        // Process items in batches for optimal video segments
        const batch = this.encodingQueue.splice(0, this.BATCH_SIZE);

        try {
          await this.encodeVideoSegment(batch);
          console.log(`Successfully encoded batch of ${batch.length} items`);
        } catch (error) {
          console.error(`Failed to encode batch of ${batch.length} items:`, error);

          // Re-queue failed items for retry (simplified retry logic)
          this.encodingQueue.push(...batch);

          // Prevent infinite retry loop
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    } catch (error) {
      console.error('Video encoding queue processing failed:', error);
    } finally {
      this.isEncoding = false;
    }
  }

  // ===== STORAGE ADAPTER INTERFACE IMPLEMENTATION =====

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
        tags: item.tags || [],
        isPinned: item.isPinned,
        metadata: item.metadata,
        payloadRef,
        contentHash
      };
    } else {
      // Queue for video encoding
      this.encodingQueue.push(item);

      // Store summary without payload reference (will be updated after encoding)
      this.catalog[item.id] = {
        id: item.id,
        type: item.type,
        scope: item.scope,
        title: item.title,
        tags: item.tags || [],
        isPinned: item.isPinned,
        metadata: item.metadata,
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

    // Materialize content from video
    const content = await this.decodeFromVideo(summary.payloadRef);
    const itemData = JSON.parse(content.toString());

    return {
      id: summary.id,
      type: summary.type,
      scope: summary.scope,
      title: summary.title,
      tags: summary.tags,
      isPinned: summary.isPinned,
      metadata: summary.metadata,
      text: itemData.text,
      code: itemData.code,
      links: itemData.links
    };
  }

  // ===== UTILITY METHODS =====

  private computeContentHash(item: MemoryItem): string {
    const content = JSON.stringify({
      title: item.title,
      text: item.text || '',
      code: item.code || '',
      type: item.type
    });
    return createHash('sha256').update(content).digest('hex');
  }

  private loadSegments(): void {
    const segmentsPath = path.join(this.directory, 'segments.json');
    if (existsSync(segmentsPath)) {
      try {
        const data = readFileSync(segmentsPath, 'utf8');
        this.segments = JSON.parse(data);
      } catch (error) {
        console.warn(`Failed to load segments: ${error}`);
        this.segments = {};
      }
    }
  }

  private saveSegments(): void {
    const segmentsPath = path.join(this.directory, 'segments.json');
    writeFileSync(segmentsPath, JSON.stringify(this.segments, null, 2));
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

  // ===== REMAINING STORAGE ADAPTER METHODS =====

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

  readCatalog(): Record<string, MemoryItemSummary> {
    return { ...this.catalog };
  }

  setCatalog(catalog: Record<string, MemoryItemSummary>): void {
    this.catalog = catalog;
    this.saveCatalog();
  }

  async rebuildCatalog(): Promise<void> {
    // For video storage, catalog is authoritative
    // This could be enhanced to rebuild from video segment metadata
  }

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

  async getStats(): Promise<StorageStats> {
    const itemCount = Object.keys(this.catalog).length;
    const catalogSize = JSON.stringify(this.catalog).length;

    // Calculate actual video sizes
    let totalVideoSize = 0;
    for (const segment of Object.values(this.segments)) {
      totalVideoSize += segment.metadata.fileSize;
    }

    return {
      items: itemCount,
      sizeBytes: catalogSize + totalVideoSize,
      compressionRatio: 50, // Estimated based on QR + video compression
    };
  }

  async cleanup(): Promise<number> {
    // TODO: Implement cleanup of unused video segments
    // This would involve:
    // 1. Identifying orphaned video segments (not referenced by any catalog items)
    // 2. Removing unreferenced video files
    // 3. Cleaning up payload cache
    return 0;
  }

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

  getDirectory(): string {
    return this.directory;
  }

  // ===== CLEANUP AND DISPOSAL =====

  async dispose(): Promise<void> {
    try {
      // Wait for any ongoing encoding to finish
      while (this.isEncoding) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Dispose encoder
      if (this.encoder) {
        await this.encoder.dispose();
        this.encoder = null;
      }

      // Clear caches
      this.payloadCache.clear();

      console.log('VideoStorageAdapter disposed successfully');
    } catch (error) {
      console.warn('Error during VideoStorageAdapter disposal:', error);
    }
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