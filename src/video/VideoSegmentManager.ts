import * as fs from 'fs-extra';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { ulid } from '../util/ulid.js';
import { MviWriter, MviReader, FrameIndexEntry } from './FrameIndex.js';
import type { QRFrame, QREncodingResult } from '../qr/QRManager.js';
import type { VideoEncodingResult, VideoEncoder, VideoEncodingOptions } from './VideoEncoder.js';
import type { MemoryItem } from '../types/Memory.js';
import type { PayloadRef } from '../storage/StorageAdapter.js';
import { LRU } from '../utils/lru.js';
import { VideoDecoder, VideoDecodingOptions, createVideoDecoder } from './VideoDecoder.js';

/**
 * Video segment metadata for storage management
 */
export interface VideoSegmentMetadata {
  segmentUlid: string;
  createdAt: string;
  updatedAt: string;
  frameCount: number;
  duration: number;
  fileSize: number;
  compressionRatio: number;
  contentHashes: string[];
  frameMappings: FrameContentMapping[];
}

/**
 * Mapping between frame indices and content items
 */
export interface FrameContentMapping {
  frameIndex: number;
  contentHash: string;
  itemId: string;
  byteOffset: number;
  decodedSize: number;
  chunkIndex?: number;        // Which chunk of the item this frame represents
  totalChunks?: number;       // Total chunks for the item
  originalItemHash?: string;  // Hash of the complete original item
}

/**
 * Segment storage statistics
 */
export interface SegmentStats {
  totalSegments: number;
  totalFrames: number;
  totalSizeBytes: number;
  averageCompressionRatio: number;
  oldestSegment: string;
  newestSegment: string;
  fragmentationRatio: number;
}

/**
 * Options for segment creation
 */
export interface SegmentCreationOptions {
  maxFramesPerSegment?: number;
  targetSegmentSizeMB?: number;
  compressionProfile?: 'ultra_high' | 'high_fast' | 'balanced' | 'compact';
  enableDeduplication?: boolean;
}

/**
 * VideoSegmentManager handles the lifecycle of video segments for memory storage
 * Provides efficient storage, retrieval, and management of video-encoded memory items
 */
export class VideoSegmentManager {
  private segmentsDir: string;
  private indexDir: string;
  private metadataCache = new LRU<string, VideoSegmentMetadata>(100);
  private frameIndexCache = new LRU<string, MviReader>(20);
  private videoEncoder: VideoEncoder | null = null;
  private videoDecoder: VideoDecoder | null = null;

  // Content deduplication tracking
  private contentHashToSegment = new Map<string, { segmentUlid: string; frameIndex: number }>();

  // Default segment creation options
  private readonly defaultOptions: Required<SegmentCreationOptions> = {
    maxFramesPerSegment: 300,      // ~10 seconds at 30fps
    targetSegmentSizeMB: 50,       // Target 50MB segments
    compressionProfile: 'balanced',
    enableDeduplication: true
  };

  constructor(storageDirectory: string, videoEncoder?: VideoEncoder, videoDecoder?: VideoDecoder) {
    this.segmentsDir = path.join(storageDirectory, 'segments');
    this.indexDir = path.join(storageDirectory, 'indexes');
    this.videoEncoder = videoEncoder || null;
    this.videoDecoder = videoDecoder || null;
    this.ensureDirectories();
    this.loadContentHashMap();
    this.initializeVideoDecoder();
  }

  private ensureDirectories(): void {
    fs.ensureDirSync(this.segmentsDir);
    fs.ensureDirSync(this.indexDir);
  }

  private async initializeVideoDecoder(): Promise<void> {
    if (!this.videoDecoder) {
      try {
        this.videoDecoder = await createVideoDecoder();
      } catch (error) {
        console.warn('Failed to initialize video decoder:', error);
        this.videoDecoder = null;
      }
    }
  }

  private async loadContentHashMap(): Promise<void> {
    try {
      const segments = await this.listSegments();
      for (const segmentUlid of segments) {
        const metadata = await this.getSegmentMetadata(segmentUlid);
        if (metadata) {
          for (const mapping of metadata.frameMappings) {
            this.contentHashToSegment.set(mapping.contentHash, {
              segmentUlid,
              frameIndex: mapping.frameIndex
            });
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load content hash map:', error);
    }
  }

  /**
   * Create a new video segment from memory items
   */
  async createSegment(
    items: MemoryItem[],
    options: Partial<SegmentCreationOptions> = {}
  ): Promise<{ segmentUlid: string; payloadRefs: PayloadRef[] }> {
    if (items.length === 0) {
      throw new Error('Cannot create segment from empty items array');
    }

    if (!this.videoEncoder) {
      throw new Error('Video encoder not initialized');
    }

    const opts = { ...this.defaultOptions, ...options };
    const segmentUlid = ulid();

    // Check for deduplication opportunities
    const uniqueItems = opts.enableDeduplication
      ? this.deduplicateItems(items)
      : items;

    // Convert items to QR frames using QRManager - STREAMING APPROACH
    console.log(`🎬 Creating QR stream for ${uniqueItems.length} items with unique frames`);
    const qrManager = await import('../qr/QRManager.js').then(m => new m.QRManager());
    const allFrames: QRFrame[] = [];
    const frameMappings: FrameContentMapping[] = [];

    let currentFrameIndex = 0;
    for (const item of uniqueItems) {
      const contentText = JSON.stringify({
        id: item.id,
        type: item.type,
        title: item.title,
        text: item.text || '',
        code: item.code || '',
        tags: item.facets.tags,
        facets: item.facets,
        context: item.context,
        quality: item.quality,
        security: item.security,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        version: item.version
      });

      console.log(`📝 Processing item ${item.id}: ${contentText.length} chars`);

      // Encode the item - this creates multiple QR frames if content is large
      const qrResult = await qrManager.encodeToQR(contentText);
      const contentHash = createHash('sha256').update(contentText).digest('hex');

      console.log(`🎯 Generated ${qrResult.frames.length} unique QR frames for item ${item.id}`);

      // Map each individual QR frame to the content - this creates true streaming
      for (let i = 0; i < qrResult.frames.length; i++) {
        const frame = qrResult.frames[i];

        // Create frame mapping for each unique QR frame
        frameMappings.push({
          frameIndex: currentFrameIndex + i,
          contentHash: contentHash + '_chunk_' + i, // Unique hash per chunk
          itemId: item.id,
          byteOffset: (currentFrameIndex + i) * 24,
          decodedSize: frame.rawData.length || 0,
          chunkIndex: i,
          totalChunks: qrResult.frames.length,
          originalItemHash: contentHash
        });

        allFrames.push(frame);
        console.log(`📄 Frame ${currentFrameIndex + i}: ${frame.rawData.length} bytes, chunk ${i+1}/${qrResult.frames.length}`);
      }

      currentFrameIndex += qrResult.frames.length;

      // Update content hash mapping to point to the first frame of this item
      this.contentHashToSegment.set(contentHash, {
        segmentUlid,
        frameIndex: frameMappings.findIndex(m => m.originalItemHash === contentHash)
      });
    }

    console.log(`✨ Created QR stream: ${allFrames.length} unique frames, ${currentFrameIndex} total frames`);
    console.log(`🎞️  Each frame contains different QR data - true streaming approach!`);

    // Get encoding options and fix type issues
    const encodingOptions = this.getEncodingOptionsForProfile(opts.compressionProfile);

    // Encode frames to video
    const encodingResult = await this.videoEncoder.encode(
      allFrames,
      encodingOptions
    );

    // Save video file
    const videoPath = this.getSegmentPath(segmentUlid, 'mp4');
    await fs.writeFile(videoPath, encodingResult.videoData);

    // Save frame index (.mvi file)
    const indexPath = this.getSegmentPath(segmentUlid, 'mvi');
    const mviWriter = new MviWriter(encodingResult.frameIndex.length);
    mviWriter.writeFrameEntries(encodingResult.frameIndex);
    await mviWriter.writeToFile(indexPath);

    // Create and save segment metadata
    const metadata: VideoSegmentMetadata = {
      segmentUlid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      frameCount: allFrames.length,
      duration: encodingResult.metadata.duration,
      fileSize: encodingResult.metadata.fileSize,
      compressionRatio: this.calculateCompressionRatio(uniqueItems, encodingResult.metadata.fileSize),
      contentHashes: frameMappings.map(m => m.contentHash),
      frameMappings
    };

    await this.saveSegmentMetadata(segmentUlid, metadata);

    // Generate payload references for each item
    const payloadRefs: PayloadRef[] = frameMappings.map(mapping => ({
      hash: mapping.contentHash,
      segmentUlid,
      frameIdx: mapping.frameIndex,
      size: mapping.decodedSize,
      compressionRatio: metadata.compressionRatio
    }));

    return { segmentUlid, payloadRefs };
  }

  /**
   * Retrieve content from a specific frame in a segment using video decoding
   */
  async getContentFromSegment(
    segmentUlid: string,
    frameIndex: number,
    options: VideoDecodingOptions = {}
  ): Promise<MemoryItem | null> {
    const startTime = Date.now();

    try {
      // Ensure video decoder is initialized
      if (!this.videoDecoder) {
        await this.initializeVideoDecoder();
        if (!this.videoDecoder) {
          throw new Error('Video decoder not available');
        }
      }

      // Get segment metadata to validate request
      const metadata = await this.getSegmentMetadata(segmentUlid);
      if (!metadata) {
        throw new Error(`Segment metadata not found: ${segmentUlid}`);
      }

      // Check if the requested frame index exists in this segment
      const mapping = metadata.frameMappings.find(m => m.frameIndex === frameIndex);
      if (!mapping) {
        throw new Error(`Frame mapping not found for index ${frameIndex} in segment ${segmentUlid}`);
      }

      // Get paths to segment files
      const videoPath = this.getSegmentPath(segmentUlid, 'mp4');
      if (!(await fs.pathExists(videoPath))) {
        throw new Error(`Segment video file not found: ${videoPath}`);
      }

      // Check if this is a multi-frame sequence (QR spanning multiple frames)
      const isMultiFrame = await this.isMultiFrameContent(segmentUlid, mapping);

      let decodingResult;
      const decodingStartTime = Date.now();

      if (isMultiFrame) {
        // Handle multi-frame QR sequence
        const sequenceFrames = await this.getFrameSequenceIndices(segmentUlid, mapping);
        decodingResult = await this.videoDecoder.decodeMultiFrame(videoPath, sequenceFrames, {
          ...options,
          progressCallback: options.progressCallback ?
            (current, total) => options.progressCallback!(current, total) : undefined
        });

        if (decodingResult.success && decodingResult.results.length > 0) {
          const memoryItem = decodingResult.results[0].memoryItem!;

          // Add segment-specific context
          memoryItem.context = {
            ...memoryItem.context,
            source: 'video-decoding-multiframe',
            tool: 'VideoSegmentManager'
          };

          return memoryItem;
        } else {
          throw new Error(`Multi-frame decoding failed: ${decodingResult.error}`);
        }
      } else {
        // Handle single-frame content
        decodingResult = await this.videoDecoder.decodeFrame(videoPath, frameIndex, options);

        if (decodingResult.success && decodingResult.memoryItem) {
          const memoryItem = decodingResult.memoryItem;

          // Add segment-specific context
          memoryItem.context = {
            ...memoryItem.context,
            source: 'video-decoding-single',
            tool: 'VideoSegmentManager'
          };

          return memoryItem;
        } else {
          throw new Error(`Frame decoding failed: ${decodingResult.error}`);
        }
      }

    } catch (error) {
      console.error(`Failed to get content from segment ${segmentUlid}:${frameIndex}:`, error);

      // Return fallback item with error information for debugging
      const fallbackItem: MemoryItem = {
        id: `error-${segmentUlid}-${frameIndex}`,
        type: 'note',
        scope: 'local',
        title: `Video Decoding Error`,
        text: `Failed to decode content from segment ${segmentUlid}, frame ${frameIndex}.\nError: ${error instanceof Error ? error.message : String(error)}`,
        facets: {
          tags: ['error', 'video-decoding'],
          files: [],
          symbols: []
        },
        context: {
          tool: 'VideoSegmentManager',
          source: 'video-decoding'
        },
        quality: {
          confidence: 0.1,
          reuseCount: 0,
          pinned: false
        },
        security: {
          sensitivity: 'private'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };

      return fallbackItem;
    }
  }

  /**
   * Find content by hash with sub-100ms access time
   */
  async findContentByHash(contentHash: string): Promise<MemoryItem | null> {
    const location = this.contentHashToSegment.get(contentHash);
    if (!location) {
      return null;
    }

    return this.getContentFromSegment(location.segmentUlid, location.frameIndex);
  }

  /**
   * List all segments
   */
  async listSegments(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.segmentsDir);
      return files
        .filter(f => f.endsWith('.mp4'))
        .map(f => path.basename(f, '.mp4'));
    } catch (error) {
      console.warn('Failed to list segments:', error);
      return [];
    }
  }

  /**
   * Get segment metadata with caching
   */
  async getSegmentMetadata(segmentUlid: string): Promise<VideoSegmentMetadata | null> {
    // Check cache first
    if (this.metadataCache.has(segmentUlid)) {
      return this.metadataCache.get(segmentUlid)!;
    }

    try {
      const metadataPath = this.getSegmentPath(segmentUlid, 'json');
      if (!(await fs.pathExists(metadataPath))) {
        return null;
      }

      const metadata: VideoSegmentMetadata = await fs.readJson(metadataPath);
      this.metadataCache.set(segmentUlid, metadata);
      return metadata;
    } catch (error) {
      console.warn(`Failed to load metadata for segment ${segmentUlid}:`, error);
      return null;
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStats(): Promise<SegmentStats> {
    const segments = await this.listSegments();
    let totalFrames = 0;
    let totalSizeBytes = 0;
    let totalCompressionRatio = 0;
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;
    let fragmentedFrames = 0;

    for (const segmentUlid of segments) {
      const metadata = await this.getSegmentMetadata(segmentUlid);
      if (metadata) {
        totalFrames += metadata.frameCount;
        totalSizeBytes += metadata.fileSize;
        totalCompressionRatio += metadata.compressionRatio;

        const createdTime = new Date(metadata.createdAt).getTime();
        oldestTimestamp = Math.min(oldestTimestamp, createdTime);
        newestTimestamp = Math.max(newestTimestamp, createdTime);

        // Simple fragmentation heuristic: segments with few frames relative to capacity
        if (metadata.frameCount < this.defaultOptions.maxFramesPerSegment * 0.3) {
          fragmentedFrames += metadata.frameCount;
        }
      }
    }

    const averageCompressionRatio = segments.length > 0
      ? totalCompressionRatio / segments.length
      : 0;

    const fragmentationRatio = totalFrames > 0
      ? fragmentedFrames / totalFrames
      : 0;

    return {
      totalSegments: segments.length,
      totalFrames,
      totalSizeBytes,
      averageCompressionRatio,
      oldestSegment: new Date(oldestTimestamp).toISOString(),
      newestSegment: new Date(newestTimestamp).toISOString(),
      fragmentationRatio
    };
  }

  /**
   * Cleanup and compact segments
   */
  async compactSegments(): Promise<{
    segmentsRemoved: number;
    bytesReclaimed: number;
    newSegments: string[];
  }> {
    const stats = await this.getStorageStats();

    // Find fragmented segments (less than 30% capacity)
    const segments = await this.listSegments();
    const fragmentedSegments: string[] = [];

    for (const segmentUlid of segments) {
      const metadata = await this.getSegmentMetadata(segmentUlid);
      if (metadata && metadata.frameCount < this.defaultOptions.maxFramesPerSegment * 0.3) {
        fragmentedSegments.push(segmentUlid);
      }
    }

    if (fragmentedSegments.length < 2) {
      return { segmentsRemoved: 0, bytesReclaimed: 0, newSegments: [] };
    }

    // Collect items from fragmented segments
    const itemsToRepack: MemoryItem[] = [];
    let bytesReclaimed = 0;

    for (const segmentUlid of fragmentedSegments) {
      const metadata = await this.getSegmentMetadata(segmentUlid);
      if (!metadata) continue;

      // Extract items (simplified - would need full video decoding)
      for (const mapping of metadata.frameMappings) {
        const item = await this.getContentFromSegment(segmentUlid, mapping.frameIndex);
        if (item) {
          itemsToRepack.push(item);
        }
      }

      bytesReclaimed += metadata.fileSize;
    }

    // Create new compacted segments
    const newSegments: string[] = [];
    while (itemsToRepack.length > 0) {
      const batch = itemsToRepack.splice(0, this.defaultOptions.maxFramesPerSegment);
      const result = await this.createSegment(batch);
      newSegments.push(result.segmentUlid);
    }

    // Remove old fragmented segments
    for (const segmentUlid of fragmentedSegments) {
      await this.deleteSegment(segmentUlid);
    }

    return {
      segmentsRemoved: fragmentedSegments.length,
      bytesReclaimed,
      newSegments
    };
  }

  /**
   * Delete a segment and its associated files
   */
  async deleteSegment(segmentUlid: string): Promise<boolean> {
    try {
      // Remove from caches
      this.metadataCache.delete(segmentUlid);
      this.frameIndexCache.delete(segmentUlid);

      // Remove content hash mappings
      const metadata = await this.getSegmentMetadata(segmentUlid);
      if (metadata) {
        for (const mapping of metadata.frameMappings) {
          this.contentHashToSegment.delete(mapping.contentHash);
        }
      }

      // Delete files
      const videoPath = this.getSegmentPath(segmentUlid, 'mp4');
      const indexPath = this.getSegmentPath(segmentUlid, 'mvi');
      const metadataPath = this.getSegmentPath(segmentUlid, 'json');

      await Promise.all([
        fs.remove(videoPath).catch(() => {}),
        fs.remove(indexPath).catch(() => {}),
        fs.remove(metadataPath).catch(() => {})
      ]);

      return true;
    } catch (error) {
      console.error(`Failed to delete segment ${segmentUlid}:`, error);
      return false;
    }
  }

  /**
   * Dispose of resources and clean up
   */
  async dispose(): Promise<void> {
    try {
      // Clean up video decoder
      if (this.videoDecoder) {
        await this.videoDecoder.dispose();
        this.videoDecoder = null;
      }

      // Clear caches
      this.metadataCache.clear();
      this.frameIndexCache.clear();
      this.contentHashToSegment.clear();
    } catch (error) {
      console.warn('Error during VideoSegmentManager disposal:', error);
    }
  }

  // Private helper methods

  /**
   * Check if content spans multiple frames (for multi-frame QR sequences)
   */
  private async isMultiFrameContent(segmentUlid: string, mapping: FrameContentMapping): Promise<boolean> {
    try {
      // For now, assume single-frame content unless we detect otherwise
      // This could be enhanced by analyzing the QRManager encoding metadata
      // or by checking if the content was split across multiple QR codes
      return false; // Start with single-frame assumption
    } catch (error) {
      console.warn('Failed to determine if content is multi-frame:', error);
      return false;
    }
  }

  /**
   * Get frame sequence indices for multi-frame content
   */
  private async getFrameSequenceIndices(segmentUlid: string, mapping: FrameContentMapping): Promise<number[]> {
    try {
      // For multi-frame content, we would need to determine which frames belong to the same content
      // This would involve checking the QR chunk metadata to find related frames
      // For now, return single frame
      return [mapping.frameIndex];
    } catch (error) {
      console.warn('Failed to get frame sequence indices:', error);
      return [mapping.frameIndex];
    }
  }

  private getSegmentPath(segmentUlid: string, extension: string): string {
    const dir = extension === 'mvi' ? this.indexDir : this.segmentsDir;
    return path.join(dir, `${segmentUlid}.${extension}`);
  }

  private async getMviReader(segmentUlid: string): Promise<MviReader> {
    if (this.frameIndexCache.has(segmentUlid)) {
      return this.frameIndexCache.get(segmentUlid)!;
    }

    const indexPath = this.getSegmentPath(segmentUlid, 'mvi');
    const reader = await MviReader.fromFile(indexPath);
    this.frameIndexCache.set(segmentUlid, reader);
    return reader;
  }

  private async saveSegmentMetadata(segmentUlid: string, metadata: VideoSegmentMetadata): Promise<void> {
    const metadataPath = this.getSegmentPath(segmentUlid, 'json');
    await fs.writeJson(metadataPath, metadata, { spaces: 2 });
    this.metadataCache.set(segmentUlid, metadata);
  }

  private deduplicateItems(items: MemoryItem[]): MemoryItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
      const contentHash = this.computeItemContentHash(item);
      if (seen.has(contentHash)) {
        return false;
      }
      seen.add(contentHash);
      return true;
    });
  }

  private computeItemContentHash(item: MemoryItem): string {
    const content = JSON.stringify({
      type: item.type,
      title: item.title,
      text: item.text || '',
      code: item.code || ''
    });
    return createHash('sha256').update(content).digest('hex');
  }

  private calculateCompressionRatio(items: MemoryItem[], compressedSize: number): number {
    const originalSize = items.reduce((total, item) => {
      return total + JSON.stringify(item).length;
    }, 0);
    return originalSize / compressedSize;
  }

  private getEncodingOptionsForProfile(profile: string): Partial<VideoEncodingOptions> {
    // Map profile to video encoding options
    const profiles: Record<string, Partial<VideoEncodingOptions>> = {
      'ultra_high': { crf: 20, preset: 'slower' },
      'high_fast': { crf: 23, preset: 'fast' },
      'balanced': { crf: 26, preset: 'medium' },
      'compact': { crf: 28, preset: 'fast', gop: 60 }
    };

    return profiles[profile] || profiles.balanced;
  }
}

/**
 * Factory for creating VideoSegmentManager instances
 */
export class VideoSegmentManagerFactory {
  static create(
    storageDirectory: string,
    videoEncoder?: VideoEncoder,
    videoDecoder?: VideoDecoder
  ): VideoSegmentManager {
    return new VideoSegmentManager(storageDirectory, videoEncoder, videoDecoder);
  }

  /**
   * Initialize with automatic encoder and decoder detection
   */
  static async createWithEncoderAndDecoder(storageDirectory: string): Promise<VideoSegmentManager> {
    try {
      // Initialize decoder automatically
      const videoDecoder = await createVideoDecoder();
      return new VideoSegmentManager(storageDirectory, undefined, videoDecoder);
    } catch (error) {
      console.warn('Failed to initialize video decoder in factory:', error);
      // Return without decoder - will be initialized on-demand
      return new VideoSegmentManager(storageDirectory);
    }
  }

  /**
   * Initialize with automatic encoder detection (legacy method)
   */
  static async createWithEncoder(storageDirectory: string): Promise<VideoSegmentManager> {
    // Call the new method for backward compatibility
    return this.createWithEncoderAndDecoder(storageDirectory);
  }
}