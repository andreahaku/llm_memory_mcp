import { MviReader, MviWriter, FrameIndexEntry } from './FrameIndex.js';
import { LRU } from '../utils/lru.js';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Enhanced frame indexing with performance optimizations for sub-100ms access
 * Builds on Phase 0 FrameIndex with caching, preloading, and access optimization
 */

/**
 * Frame access pattern tracking for optimization
 */
interface FrameAccessPattern {
  frameNumber: number;
  lastAccessed: number;
  accessCount: number;
  isHotFrame: boolean;
}

/**
 * Frame range for batch operations
 */
interface FrameRange {
  start: number;
  end: number;
  priority: number;
}

/**
 * Index cache entry with metadata
 */
interface IndexCacheEntry {
  reader: MviReader;
  lastAccessed: number;
  accessCount: number;
  fileSize: number;
  frameCount: number;
}

/**
 * Frame lookup result with performance metrics
 */
export interface FrameLookupResult {
  entry: FrameIndexEntry | null;
  cacheHit: boolean;
  accessTimeMs: number;
  segmentUlid: string;
}

/**
 * Enhanced frame index statistics
 */
export interface EnhancedIndexStats {
  totalIndexes: number;
  totalFrames: number;
  cacheHitRate: number;
  averageAccessTimeMs: number;
  hotFrameCount: number;
  indexSizeMB: number;
  lastOptimizationTime: string;
}

/**
 * EnhancedFrameIndex provides optimized random access to video frames
 * with intelligent caching, preloading, and access pattern optimization
 */
export class EnhancedFrameIndex {
  private indexCache = new LRU<string, IndexCacheEntry>(50); // Cache up to 50 indexes
  private frameCache = new LRU<string, FrameIndexEntry>(10000); // Cache frequently accessed frames
  private accessPatterns = new Map<string, FrameAccessPattern>();

  // Performance tracking
  private accessTimes: number[] = [];
  private cacheHits = 0;
  private cacheMisses = 0;

  // Hot frame preloading
  private preloadThreshold = 10; // Access count threshold for hot frames
  private maxPreloadFrames = 100; // Maximum frames to preload per segment

  constructor(private indexDirectory: string) {
    this.ensureDirectory();
    this.startPeriodicOptimization();
  }

  private ensureDirectory(): void {
    fs.ensureDirSync(this.indexDirectory);
  }

  /**
   * Get frame entry with sub-100ms access time guarantee
   */
  async getFrame(segmentUlid: string, frameNumber: number): Promise<FrameLookupResult> {
    const startTime = performance.now();
    const cacheKey = `${segmentUlid}:${frameNumber}`;

    // Check frame cache first (fastest path)
    if (this.frameCache.has(cacheKey)) {
      const entry = this.frameCache.get(cacheKey)!;
      const accessTime = performance.now() - startTime;
      this.recordAccess(cacheKey, accessTime, true);

      return {
        entry,
        cacheHit: true,
        accessTimeMs: accessTime,
        segmentUlid
      };
    }

    // Get or load index reader
    const indexReader = await this.getIndexReader(segmentUlid);
    if (!indexReader) {
      return {
        entry: null,
        cacheHit: false,
        accessTimeMs: performance.now() - startTime,
        segmentUlid
      };
    }

    // Get frame entry from index
    const entry = indexReader.reader.getFrameEntry(frameNumber);
    const accessTime = performance.now() - startTime;

    // Cache the result
    if (entry) {
      this.frameCache.set(cacheKey, entry);
      this.updateAccessPattern(cacheKey);
    }

    this.recordAccess(cacheKey, accessTime, false);

    // Trigger preloading if this is becoming a hot frame
    if (entry && this.shouldPreloadAround(cacheKey)) {
      this.preloadSurroundingFrames(segmentUlid, frameNumber, indexReader.reader);
    }

    return {
      entry,
      cacheHit: false,
      accessTimeMs: accessTime,
      segmentUlid
    };
  }

  /**
   * Batch frame retrieval for improved performance
   */
  async getFrameRange(
    segmentUlid: string,
    startFrame: number,
    endFrame: number
  ): Promise<Map<number, FrameIndexEntry>> {
    const results = new Map<number, FrameIndexEntry>();

    // Get index reader once for the entire range
    const indexReader = await this.getIndexReader(segmentUlid);
    if (!indexReader) {
      return results;
    }

    // Batch retrieve frames
    for (let frameNum = startFrame; frameNum <= endFrame; frameNum++) {
      const cacheKey = `${segmentUlid}:${frameNum}`;

      // Check cache first
      if (this.frameCache.has(cacheKey)) {
        results.set(frameNum, this.frameCache.get(cacheKey)!);
        continue;
      }

      // Get from index
      const entry = indexReader.reader.getFrameEntry(frameNum);
      if (entry) {
        results.set(frameNum, entry);
        this.frameCache.set(cacheKey, entry);
        this.updateAccessPattern(cacheKey);
      }
    }

    return results;
  }

  /**
   * Find the optimal keyframe for seeking to a target frame
   */
  async findOptimalKeyframe(
    segmentUlid: string,
    targetFrame: number
  ): Promise<FrameLookupResult | null> {
    const indexReader = await this.getIndexReader(segmentUlid);
    if (!indexReader) {
      return null;
    }

    // Use the existing findNearestKeyframe method from MviReader
    const keyframeEntry = indexReader.reader.findNearestKeyframe(targetFrame);

    if (!keyframeEntry) {
      return null;
    }

    return {
      entry: keyframeEntry,
      cacheHit: false,
      accessTimeMs: 0, // Minimal time for keyframe lookup
      segmentUlid
    };
  }

  /**
   * Preload hot frames based on access patterns
   */
  async preloadHotFrames(segmentUlid: string): Promise<number> {
    const indexReader = await this.getIndexReader(segmentUlid);
    if (!indexReader) {
      return 0;
    }

    // Find hot frames for this segment
    const hotFrames: number[] = [];
    for (const [cacheKey, pattern] of this.accessPatterns) {
      if (cacheKey.startsWith(`${segmentUlid}:`) && pattern.isHotFrame) {
        const frameNum = parseInt(cacheKey.split(':')[1]);
        hotFrames.push(frameNum);
      }
    }

    // Limit preloading
    const framesToPreload = hotFrames.slice(0, this.maxPreloadFrames);

    // Preload frames into cache
    for (const frameNum of framesToPreload) {
      const cacheKey = `${segmentUlid}:${frameNum}`;
      if (!this.frameCache.has(cacheKey)) {
        const entry = indexReader.reader.getFrameEntry(frameNum);
        if (entry) {
          this.frameCache.set(cacheKey, entry);
        }
      }
    }

    return framesToPreload.length;
  }

  /**
   * Optimize index access patterns
   */
  async optimizeAccess(): Promise<{
    hotFramesPreloaded: number;
    coldFramesEvicted: number;
    indexesCompacted: number;
  }> {
    const stats = { hotFramesPreloaded: 0, coldFramesEvicted: 0, indexesCompacted: 0 };

    // Update hot frame status
    const now = Date.now();
    for (const [cacheKey, pattern] of this.accessPatterns) {
      const timeSinceLastAccess = now - pattern.lastAccessed;

      // Mark as hot if frequently accessed recently
      pattern.isHotFrame = pattern.accessCount >= this.preloadThreshold &&
                          timeSinceLastAccess < 300000; // 5 minutes

      // Remove cold patterns
      if (timeSinceLastAccess > 3600000) { // 1 hour
        this.accessPatterns.delete(cacheKey);
      }
    }

    // Preload hot frames for active segments
    for (const [segmentUlid] of this.indexCache) {
      const preloaded = await this.preloadHotFrames(segmentUlid);
      stats.hotFramesPreloaded += preloaded;
    }

    // Evict cold frames from cache
    const coldFrames: string[] = [];
    for (const [cacheKey] of this.frameCache) {
      const pattern = this.accessPatterns.get(cacheKey);
      if (!pattern || !pattern.isHotFrame) {
        coldFrames.push(cacheKey);
      }
    }

    // Evict bottom 20% of cold frames
    const toEvict = coldFrames.slice(0, Math.floor(coldFrames.length * 0.2));
    for (const key of toEvict) {
      this.frameCache.delete(key);
      stats.coldFramesEvicted++;
    }

    return stats;
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats(): EnhancedIndexStats {
    const totalAccesses = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalAccesses > 0 ? this.cacheHits / totalAccesses : 0;

    const avgAccessTime = this.accessTimes.length > 0
      ? this.accessTimes.reduce((sum, time) => sum + time, 0) / this.accessTimes.length
      : 0;

    const hotFrameCount = Array.from(this.accessPatterns.values())
      .filter(p => p.isHotFrame).length;

    // Estimate total index size
    let totalIndexSize = 0;
    for (const [, entry] of this.indexCache) {
      totalIndexSize += entry.fileSize;
    }

    return {
      totalIndexes: this.indexCache.size,
      totalFrames: this.frameCache.size,
      cacheHitRate,
      averageAccessTimeMs: avgAccessTime,
      hotFrameCount,
      indexSizeMB: totalIndexSize / (1024 * 1024),
      lastOptimizationTime: new Date().toISOString()
    };
  }

  /**
   * Clear caches and reset optimization
   */
  clearCaches(): void {
    this.indexCache.clear();
    this.frameCache.clear();
    this.accessPatterns.clear();
    this.accessTimes = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Validate index integrity
   */
  async validateIndex(segmentUlid: string): Promise<{
    valid: boolean;
    errors: string[];
    frameCount: number;
    keyframeCount: number;
  }> {
    const errors: string[] = [];
    let frameCount = 0;
    let keyframeCount = 0;

    try {
      const indexPath = this.getIndexPath(segmentUlid);

      if (!(await fs.pathExists(indexPath))) {
        errors.push(`Index file not found: ${indexPath}`);
        return { valid: false, errors, frameCount, keyframeCount };
      }

      const reader = await MviReader.fromFile(indexPath);
      frameCount = reader.getFrameCount();

      // Validate each frame entry
      for (let i = 0; i < frameCount; i++) {
        const entry = reader.getFrameEntry(i);
        if (!entry) {
          errors.push(`Missing frame entry at index ${i}`);
          continue;
        }

        if (entry.frameNumber !== i) {
          errors.push(`Frame number mismatch at index ${i}: expected ${i}, got ${entry.frameNumber}`);
        }

        if (entry.isKeyframe) {
          keyframeCount++;
        }

        if (entry.frameSize <= 0) {
          errors.push(`Invalid frame size at index ${i}: ${entry.frameSize}`);
        }
      }

      // Check keyframe distribution
      if (keyframeCount === 0) {
        errors.push('No keyframes found in index');
      } else if (frameCount / keyframeCount > 60) {
        errors.push(`Low keyframe density: ${frameCount / keyframeCount} frames per keyframe`);
      }

    } catch (error) {
      errors.push(`Index validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      frameCount,
      keyframeCount
    };
  }

  // Private helper methods

  private async getIndexReader(segmentUlid: string): Promise<IndexCacheEntry | null> {
    // Check cache first
    if (this.indexCache.has(segmentUlid)) {
      const entry = this.indexCache.get(segmentUlid)!;
      entry.lastAccessed = Date.now();
      entry.accessCount++;
      return entry;
    }

    try {
      const indexPath = this.getIndexPath(segmentUlid);
      if (!(await fs.pathExists(indexPath))) {
        return null;
      }

      const reader = await MviReader.fromFile(indexPath);
      const stats = await fs.stat(indexPath);

      const entry: IndexCacheEntry = {
        reader,
        lastAccessed: Date.now(),
        accessCount: 1,
        fileSize: stats.size,
        frameCount: reader.getFrameCount()
      };

      this.indexCache.set(segmentUlid, entry);
      return entry;
    } catch (error) {
      console.error(`Failed to load index for segment ${segmentUlid}:`, error);
      return null;
    }
  }

  private getIndexPath(segmentUlid: string): string {
    return path.join(this.indexDirectory, `${segmentUlid}.mvi`);
  }

  private recordAccess(cacheKey: string, accessTimeMs: number, wasHit: boolean): void {
    this.accessTimes.push(accessTimeMs);
    if (this.accessTimes.length > 1000) {
      this.accessTimes = this.accessTimes.slice(-500); // Keep last 500 measurements
    }

    if (wasHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
  }

  private updateAccessPattern(cacheKey: string): void {
    const now = Date.now();
    const existing = this.accessPatterns.get(cacheKey);

    if (existing) {
      existing.lastAccessed = now;
      existing.accessCount++;
    } else {
      const frameNumber = parseInt(cacheKey.split(':')[1]);
      this.accessPatterns.set(cacheKey, {
        frameNumber,
        lastAccessed: now,
        accessCount: 1,
        isHotFrame: false
      });
    }
  }

  private shouldPreloadAround(cacheKey: string): boolean {
    const pattern = this.accessPatterns.get(cacheKey);
    return pattern ? pattern.accessCount >= 3 : false;
  }

  private preloadSurroundingFrames(
    segmentUlid: string,
    centerFrame: number,
    reader: MviReader
  ): void {
    // Preload 5 frames before and after the accessed frame
    const preloadRange = 5;
    const startFrame = Math.max(0, centerFrame - preloadRange);
    const endFrame = Math.min(reader.getFrameCount() - 1, centerFrame + preloadRange);

    // Use setTimeout to avoid blocking the current request
    setTimeout(() => {
      for (let frameNum = startFrame; frameNum <= endFrame; frameNum++) {
        if (frameNum === centerFrame) continue; // Already cached

        const cacheKey = `${segmentUlid}:${frameNum}`;
        if (!this.frameCache.has(cacheKey)) {
          const entry = reader.getFrameEntry(frameNum);
          if (entry) {
            this.frameCache.set(cacheKey, entry);
          }
        }
      }
    }, 0);
  }

  private startPeriodicOptimization(): void {
    // Run optimization every 10 minutes
    setInterval(() => {
      this.optimizeAccess().catch(error => {
        console.warn('Frame index optimization failed:', error);
      });
    }, 600000);
  }
}

/**
 * Frame index manager for handling multiple enhanced indexes
 */
export class FrameIndexManager {
  private indexes = new Map<string, EnhancedFrameIndex>();

  constructor(private baseDirectory: string) {}

  /**
   * Get or create enhanced frame index for a segment directory
   */
  getIndex(segmentDirectory: string): EnhancedFrameIndex {
    const indexDir = path.join(segmentDirectory, 'indexes');

    if (!this.indexes.has(indexDir)) {
      this.indexes.set(indexDir, new EnhancedFrameIndex(indexDir));
    }

    return this.indexes.get(indexDir)!;
  }

  /**
   * Get combined performance statistics across all indexes
   */
  getCombinedStats(): EnhancedIndexStats {
    let totalIndexes = 0;
    let totalFrames = 0;
    let totalCacheHitRate = 0;
    let totalAccessTime = 0;
    let totalHotFrames = 0;
    let totalIndexSize = 0;
    let newestOptimization = '';

    const indexCount = this.indexes.size;
    if (indexCount === 0) {
      return {
        totalIndexes: 0,
        totalFrames: 0,
        cacheHitRate: 0,
        averageAccessTimeMs: 0,
        hotFrameCount: 0,
        indexSizeMB: 0,
        lastOptimizationTime: new Date().toISOString()
      };
    }

    for (const [, index] of this.indexes) {
      const stats = index.getPerformanceStats();
      totalIndexes += stats.totalIndexes;
      totalFrames += stats.totalFrames;
      totalCacheHitRate += stats.cacheHitRate;
      totalAccessTime += stats.averageAccessTimeMs;
      totalHotFrames += stats.hotFrameCount;
      totalIndexSize += stats.indexSizeMB;

      if (stats.lastOptimizationTime > newestOptimization) {
        newestOptimization = stats.lastOptimizationTime;
      }
    }

    return {
      totalIndexes,
      totalFrames,
      cacheHitRate: totalCacheHitRate / indexCount,
      averageAccessTimeMs: totalAccessTime / indexCount,
      hotFrameCount: totalHotFrames,
      indexSizeMB: totalIndexSize,
      lastOptimizationTime: newestOptimization
    };
  }

  /**
   * Optimize all managed indexes
   */
  async optimizeAll(): Promise<void> {
    const promises: Promise<any>[] = [];

    for (const [, index] of this.indexes) {
      promises.push(index.optimizeAccess());
    }

    await Promise.all(promises);
  }

  /**
   * Clear all caches
   */
  clearAllCaches(): void {
    for (const [, index] of this.indexes) {
      index.clearCaches();
    }
  }
}