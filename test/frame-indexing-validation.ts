/**
 * Comprehensive validation for frame indexing and manifest creation functionality
 *
 * This test suite validates the Phase 0 requirements for sub-100ms search performance
 * and proper content management across memory scopes.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { createHash } from 'crypto';
import { ulid } from '../src/util/ulid.js';
import {
  MviWriter,
  MviReader,
  createMviFile,
  readMviFile,
  validateMviFile,
  summarizeFrameIndex,
  MviError,
  MVI_MAGIC,
  MVI_VERSION,
  MVI_HEADER_SIZE,
  MVI_ENTRY_SIZE,
  FrameTypeBinary,
  FrameFlags
} from '../src/video/FrameIndex.js';
import type { FrameIndexEntry } from '../src/video/VideoEncoder.js';
import { ScopeResolver } from '../src/scope/ScopeResolver.js';
import type { MemoryScope } from '../src/types/Memory.js';

// Test configuration
const TEST_CONFIG = {
  PERFORMANCE_TARGET_MS: 100,
  MIN_FRAME_COUNT: 100,
  MAX_FRAME_COUNT: 10000,
  CONCURRENT_SEEKS: 50,
  TEST_ITERATIONS: 100,
  SEGMENT_SIZE_MB: 10,
  CACHE_SIZE: 1000,
} as const;

// Test data generators
class TestDataGenerator {
  private static frameCounter = 0;

  /**
   * Generate realistic frame index entries for testing
   */
  static generateFrameEntries(count: number): FrameIndexEntry[] {
    const entries: FrameIndexEntry[] = [];
    let byteOffset = 0;
    let timestamp = 0;
    const frameRate = 30; // 30 fps
    const frameInterval = 1000 / frameRate; // ms per frame

    for (let i = 0; i < count; i++) {
      const isKeyframe = i % 30 === 0; // Keyframe every 30 frames (1 second at 30fps)
      const frameType: 'I' | 'P' | 'B' = isKeyframe ? 'I' : (i % 3 === 1 ? 'P' : 'B');

      // Realistic frame sizes based on type
      let frameSize: number;
      switch (frameType) {
        case 'I': frameSize = 50000 + Math.random() * 30000; break; // I-frames: 50-80KB
        case 'P': frameSize = 10000 + Math.random() * 15000; break; // P-frames: 10-25KB
        case 'B': frameSize = 5000 + Math.random() * 10000; break;  // B-frames: 5-15KB
      }
      frameSize = Math.floor(frameSize);

      entries.push({
        frameNumber: i,
        byteOffset,
        frameType,
        frameSize,
        timestamp: Math.max(0, Math.floor(timestamp)), // Ensure non-negative
        isKeyframe
      });

      byteOffset += frameSize;
      timestamp += frameInterval;
    }

    return entries;
  }

  /**
   * Generate test video segment metadata
   */
  static generateSegmentMetadata(segmentId: string, frameCount: number) {
    return {
      id: segmentId,
      chunkUlid: ulid(),
      frameCount,
      duration: (frameCount / 30) * 1000, // 30fps assumed
      size: this.generateFrameEntries(frameCount).reduce((sum, f) => sum + f.frameSize, 0),
      createdAt: new Date().toISOString(),
      contentHash: createHash('sha256').update(`segment-${segmentId}-${frameCount}`).digest('hex'),
      metadata: {
        width: 1920,
        height: 1080,
        codec: 'h264' as const,
        bitrate: 5000000,
      }
    };
  }

  /**
   * Generate manifest entries
   */
  static generateManifestEntries(segmentCount: number): ManifestEntry[] {
    const entries: ManifestEntry[] = [];
    for (let i = 0; i < segmentCount; i++) {
      const segmentId = `segment_${String(i).padStart(6, '0')}`;
      const frameCount = Math.floor(Math.random() * 1000) + 100;
      const metadata = this.generateSegmentMetadata(segmentId, frameCount);

      entries.push({
        chunkUlid: metadata.chunkUlid,
        segmentId,
        frameCount,
        startFrame: i * frameCount,
        endFrame: (i * frameCount) + frameCount - 1,
        contentHash: metadata.contentHash,
        size: metadata.size,
        createdAt: metadata.createdAt,
        metadata: metadata.metadata,
      });
    }
    return entries;
  }
}

// Manifest structure types
interface ManifestEntry {
  chunkUlid: string;
  segmentId: string;
  frameCount: number;
  startFrame: number;
  endFrame: number;
  contentHash: string;
  size: number;
  createdAt: string;
  metadata: {
    width: number;
    height: number;
    codec: 'h264' | 'hevc';
    bitrate: number;
  };
}

interface ManifestFile {
  version: string;
  scope: MemoryScope;
  totalFrames: number;
  totalSize: number;
  segmentCount: number;
  createdAt: string;
  updatedAt: string;
  entries: ManifestEntry[];
}

// Test utilities
class TestUtils {
  /**
   * Create temporary test directory
   */
  static async createTempDir(suffix: string = ''): Promise<string> {
    const tempBase = path.join(os.tmpdir(), 'frame-index-test');
    const tempDir = path.join(tempBase, ulid() + suffix);
    await fs.ensureDir(tempDir);
    return tempDir;
  }

  /**
   * Measure execution time
   */
  static async measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
    const start = performance.now();
    const result = await fn();
    const timeMs = performance.now() - start;
    return { result, timeMs };
  }

  /**
   * Generate statistics for time measurements
   */
  static calculateStats(times: number[]): {
    min: number;
    max: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
  } {
    const sorted = [...times].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      min: sorted[0],
      max: sorted[len - 1],
      mean: sorted.reduce((sum, t) => sum + t, 0) / len,
      median: sorted[Math.floor(len / 2)],
      p95: sorted[Math.floor(len * 0.95)],
      p99: sorted[Math.floor(len * 0.99)],
    };
  }

  /**
   * Create mock video data for testing
   */
  static createMockVideoData(frameEntries: FrameIndexEntry[]): Buffer {
    const totalSize = frameEntries.reduce((sum, entry) => sum + entry.frameSize, 0);
    const videoData = Buffer.alloc(totalSize);

    // Fill with predictable data for validation
    for (const entry of frameEntries) {
      const frameData = Buffer.alloc(entry.frameSize);
      frameData.fill(entry.frameNumber % 256); // Fill with frame number as byte value
      frameData.copy(videoData, entry.byteOffset);
    }

    return videoData;
  }
}

// Main validation class
export class FrameIndexingValidator {
  private tempDir!: string;
  private scopeResolver!: ScopeResolver;

  async setup(): Promise<void> {
    this.tempDir = await TestUtils.createTempDir('-frame-validation');
    this.scopeResolver = new ScopeResolver();
    console.log(`Test environment created at: ${this.tempDir}`);
  }

  async cleanup(): Promise<void> {
    if (this.tempDir && await fs.pathExists(this.tempDir)) {
      try {
        await fs.remove(this.tempDir);
      } catch (error) {
        console.warn(`Warning: Could not clean up temp directory: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * 1. Frame Index (.mvi) Validation
   */
  async validateFrameIndexGeneration(): Promise<ValidationResult> {
    console.log('\n=== Frame Index (.mvi) Validation ===');

    const results: TestResult[] = [];
    const frameCounts = [100, 1000, 5000, 10000];

    for (const frameCount of frameCounts) {
      console.log(`Testing with ${frameCount} frames...`);

      // Generate test data
      const frameEntries = TestDataGenerator.generateFrameEntries(frameCount);
      const mviPath = path.join(this.tempDir, `test_${frameCount}_frames.mvi`);

      // Test binary .mvi file generation
      const { timeMs: writeTime } = await TestUtils.measureTime(async () => {
        await createMviFile(frameEntries, mviPath);
      });

      // Validate file exists and has correct size
      const stats = await fs.stat(mviPath);
      const expectedSize = MVI_HEADER_SIZE + (frameCount * MVI_ENTRY_SIZE);

      results.push({
        test: `Binary MVI generation (${frameCount} frames)`,
        success: stats.size === expectedSize,
        timeMs: writeTime,
        details: `Expected: ${expectedSize}, Actual: ${stats.size}`,
      });

      // Test reading and validation
      const { result: readEntries, timeMs: readTime } = await TestUtils.measureTime(async () => {
        return await readMviFile(mviPath);
      });

      const readSuccess = readEntries.length === frameCount &&
        readEntries.every((entry, i) => entry.frameNumber === frameEntries[i].frameNumber);

      results.push({
        test: `MVI reading accuracy (${frameCount} frames)`,
        success: readSuccess,
        timeMs: readTime,
        details: `Read ${readEntries.length} entries, expected ${frameCount}`,
      });

      // Test integrity validation
      const validation = await validateMviFile(mviPath);
      results.push({
        test: `MVI integrity validation (${frameCount} frames)`,
        success: validation.valid,
        timeMs: 0,
        details: validation.error || 'Valid',
      });
    }

    return this.summarizeResults('Frame Index Generation', results);
  }

  /**
   * 2. Random Frame Seeking Performance
   */
  async validateRandomAccessPerformance(): Promise<ValidationResult> {
    console.log('\n=== Random Access Performance Validation ===');

    const frameCount = 5000;
    const frameEntries = TestDataGenerator.generateFrameEntries(frameCount);
    const mviPath = path.join(this.tempDir, 'performance_test.mvi');

    await createMviFile(frameEntries, mviPath);
    const reader = await MviReader.fromFile(mviPath);

    const results: TestResult[] = [];
    const seekTimes: number[] = [];

    // Test random seeking performance
    console.log('Testing random frame seeking...');
    for (let i = 0; i < TEST_CONFIG.TEST_ITERATIONS; i++) {
      const randomFrame = Math.floor(Math.random() * frameCount);

      const { result: entry, timeMs } = await TestUtils.measureTime(async () => {
        return reader.getFrameEntry(randomFrame);
      });

      seekTimes.push(timeMs);

      if (i === 0) {
        results.push({
          test: `Random frame seek accuracy`,
          success: entry !== null && entry.frameNumber === randomFrame,
          timeMs,
          details: entry ? `Found frame ${entry.frameNumber}` : 'Frame not found',
        });
      }
    }

    const seekStats = TestUtils.calculateStats(seekTimes);
    const performanceTarget = TEST_CONFIG.PERFORMANCE_TARGET_MS;

    results.push({
      test: `Seek performance - Mean`,
      success: seekStats.mean < performanceTarget,
      timeMs: seekStats.mean,
      details: `Target: <${performanceTarget}ms, Actual: ${seekStats.mean.toFixed(2)}ms`,
    });

    results.push({
      test: `Seek performance - P95`,
      success: seekStats.p95 < performanceTarget,
      timeMs: seekStats.p95,
      details: `Target: <${performanceTarget}ms, Actual: ${seekStats.p95.toFixed(2)}ms`,
    });

    results.push({
      test: `Seek performance - P99`,
      success: seekStats.p99 < performanceTarget * 2, // More lenient for P99
      timeMs: seekStats.p99,
      details: `Target: <${performanceTarget * 2}ms, Actual: ${seekStats.p99.toFixed(2)}ms`,
    });

    // Test concurrent access
    console.log('Testing concurrent access...');
    const concurrentSeeks = Array(TEST_CONFIG.CONCURRENT_SEEKS).fill(0).map(async () => {
      const randomFrame = Math.floor(Math.random() * frameCount);
      const start = performance.now();
      const entry = reader.getFrameEntry(randomFrame);
      const time = performance.now() - start;
      return { entry, time, frame: randomFrame };
    });

    const { result: concurrentResults, timeMs: concurrentTime } = await TestUtils.measureTime(async () => {
      return Promise.all(concurrentSeeks);
    });

    const concurrentSuccess = concurrentResults.every(r =>
      r.entry !== null && r.entry.frameNumber === r.frame
    );

    results.push({
      test: `Concurrent access (${TEST_CONFIG.CONCURRENT_SEEKS} seeks)`,
      success: concurrentSuccess,
      timeMs: concurrentTime,
      details: `${concurrentResults.filter(r => r.entry !== null).length}/${TEST_CONFIG.CONCURRENT_SEEKS} successful`,
    });

    // Test keyframe seeking
    console.log('Testing keyframe seeking...');
    const keyframeTimes: number[] = [];
    for (let i = 0; i < 50; i++) {
      const randomFrame = Math.floor(Math.random() * frameCount);

      const { result: keyframe, timeMs } = await TestUtils.measureTime(async () => {
        return reader.findNearestKeyframe(randomFrame);
      });

      keyframeTimes.push(timeMs);

      if (i === 0) {
        results.push({
          test: `Keyframe seeking accuracy`,
          success: keyframe !== null && keyframe.isKeyframe && keyframe.frameNumber <= randomFrame,
          timeMs,
          details: keyframe ? `Found keyframe at ${keyframe.frameNumber}` : 'No keyframe found',
        });
      }
    }

    const keyframeStats = TestUtils.calculateStats(keyframeTimes);
    results.push({
      test: `Keyframe seek performance`,
      success: keyframeStats.mean < performanceTarget,
      timeMs: keyframeStats.mean,
      details: `Mean: ${keyframeStats.mean.toFixed(2)}ms, P95: ${keyframeStats.p95.toFixed(2)}ms`,
    });

    return this.summarizeResults('Random Access Performance', results);
  }

  /**
   * 3. Manifest Creation and Management
   */
  async validateManifestManagement(): Promise<ValidationResult> {
    console.log('\n=== Manifest Creation and Management ===');

    const results: TestResult[] = [];
    const segmentCounts = [10, 50, 100];

    for (const segmentCount of segmentCounts) {
      console.log(`Testing manifest with ${segmentCount} segments...`);

      // Generate manifest data
      const manifestEntries = TestDataGenerator.generateManifestEntries(segmentCount);
      const manifestPath = path.join(this.tempDir, `manifest_${segmentCount}.jsonl`);

      // Test manifest creation
      const { timeMs: createTime } = await TestUtils.measureTime(async () => {
        const lines = manifestEntries.map(entry => JSON.stringify(entry));
        await fs.writeFile(manifestPath, lines.join('\n'));
      });

      results.push({
        test: `Manifest creation (${segmentCount} segments)`,
        success: await fs.pathExists(manifestPath),
        timeMs: createTime,
        details: `Created manifest with ${segmentCount} segments`,
      });

      // Test manifest reading and parsing
      const { result: readEntries, timeMs: readTime } = await TestUtils.measureTime(async () => {
        const content = await fs.readFile(manifestPath, 'utf8');
        return content.trim().split('\n').map(line => JSON.parse(line) as ManifestEntry);
      });

      results.push({
        test: `Manifest reading (${segmentCount} segments)`,
        success: readEntries.length === segmentCount,
        timeMs: readTime,
        details: `Read ${readEntries.length}/${segmentCount} entries`,
      });

      // Test chunk_ulid → frame mapping accuracy
      let mappingSuccess = true;
      let totalFrames = 0;

      for (const entry of readEntries) {
        const expectedFrameRange = entry.endFrame - entry.startFrame + 1;
        if (expectedFrameRange !== entry.frameCount) {
          mappingSuccess = false;
          break;
        }
        totalFrames += entry.frameCount;
      }

      results.push({
        test: `Frame mapping accuracy (${segmentCount} segments)`,
        success: mappingSuccess,
        timeMs: 0,
        details: `Total frames: ${totalFrames}, Segments: ${segmentCount}`,
      });

      // Test content hash tracking
      const uniqueHashes = new Set(readEntries.map(e => e.contentHash));
      results.push({
        test: `Content hash uniqueness (${segmentCount} segments)`,
        success: uniqueHashes.size === segmentCount,
        timeMs: 0,
        details: `${uniqueHashes.size}/${segmentCount} unique hashes`,
      });
    }

    // Test deduplication logic
    const duplicateEntries = TestDataGenerator.generateManifestEntries(10);
    // Create duplicate by reusing content hash
    duplicateEntries[5].contentHash = duplicateEntries[2].contentHash;

    const deduplicatedSet = new Set(duplicateEntries.map(e => e.contentHash));
    results.push({
      test: `Deduplication detection`,
      success: deduplicatedSet.size === 9, // One duplicate should be detected
      timeMs: 0,
      details: `${deduplicatedSet.size}/10 unique after deduplication`,
    });

    return this.summarizeResults('Manifest Management', results);
  }

  /**
   * 4. Video Segment Organization
   */
  async validateVideoSegmentOrganization(): Promise<ValidationResult> {
    console.log('\n=== Video Segment Organization ===');

    const results: TestResult[] = [];
    const scopes: MemoryScope[] = ['global', 'local', 'committed'];

    // Mock project setup for testing
    const mockProjectDir = path.join(this.tempDir, 'mock-project');
    await fs.ensureDir(mockProjectDir);
    process.chdir(mockProjectDir);

    // Initialize as git repo for testing
    try {
      await fs.writeFile(path.join(mockProjectDir, '.git'), 'gitdir: mock');
    } catch {
      // Ignore if can't create mock git
    }

    for (const scope of scopes) {
      console.log(`Testing ${scope} scope organization...`);

      try {
        // Get scope directory
        const scopeDir = this.scopeResolver.getScopeDirectory(scope, mockProjectDir);

        results.push({
          test: `Scope directory creation (${scope})`,
          success: await fs.pathExists(scopeDir),
          timeMs: 0,
          details: `Directory: ${scopeDir}`,
        });

        // Test segment creation in scope
        const segmentsDir = path.join(scopeDir, 'segments');
        await fs.ensureDir(segmentsDir);

        // Create test segments
        const segmentCount = 5;
        const segmentIds: string[] = [];

        for (let i = 0; i < segmentCount; i++) {
          const segmentId = `${scope}_segment_${ulid()}`;
          const segmentPath = path.join(segmentsDir, `${segmentId}.mp4`);
          const indexPath = path.join(segmentsDir, `${segmentId}.mvi`);

          // Create mock segment file
          await fs.writeFile(segmentPath, Buffer.alloc(1024 * 1024)); // 1MB mock

          // Create corresponding index
          const frameEntries = TestDataGenerator.generateFrameEntries(100);
          await createMviFile(frameEntries, indexPath);

          segmentIds.push(segmentId);
        }

        results.push({
          test: `Segment creation (${scope})`,
          success: segmentIds.length === segmentCount,
          timeMs: 0,
          details: `Created ${segmentIds.length} segments`,
        });

        // Test segment metadata consistency
        let metadataConsistent = true;
        for (const segmentId of segmentIds) {
          const segmentPath = path.join(segmentsDir, `${segmentId}.mp4`);
          const indexPath = path.join(segmentsDir, `${segmentId}.mvi`);

          const segmentExists = await fs.pathExists(segmentPath);
          const indexExists = await fs.pathExists(indexPath);

          if (!segmentExists || !indexExists) {
            metadataConsistent = false;
            break;
          }
        }

        results.push({
          test: `Metadata consistency (${scope})`,
          success: metadataConsistent,
          timeMs: 0,
          details: `${segmentIds.length} segments with consistent metadata`,
        });

      } catch (error) {
        results.push({
          test: `Scope organization error (${scope})`,
          success: false,
          timeMs: 0,
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return this.summarizeResults('Video Segment Organization', results);
  }

  /**
   * 5. Integration Testing
   */
  async validateFullPipeline(): Promise<ValidationResult> {
    console.log('\n=== Full Pipeline Integration ===');

    const results: TestResult[] = [];

    // Test full pipeline: content → segments → manifest → index → retrieval
    const contentSizes = [100, 500, 1000]; // Frame counts

    for (const frameCount of contentSizes) {
      console.log(`Testing pipeline with ${frameCount} frames...`);

      // Step 1: Generate content
      const { result: frameEntries, timeMs: generateTime } = await TestUtils.measureTime(async () => {
        return TestDataGenerator.generateFrameEntries(frameCount);
      });

      // Step 2: Create segments
      const segmentDir = path.join(this.tempDir, `pipeline_${frameCount}`);
      await fs.ensureDir(segmentDir);

      const segmentPath = path.join(segmentDir, 'segment.mp4');
      const mockVideoData = TestUtils.createMockVideoData(frameEntries);

      const { timeMs: segmentTime } = await TestUtils.measureTime(async () => {
        await fs.writeFile(segmentPath, mockVideoData);
      });

      // Step 3: Create manifest
      const manifestEntries: ManifestEntry[] = [{
        chunkUlid: ulid(),
        segmentId: 'test-segment',
        frameCount,
        startFrame: 0,
        endFrame: frameCount - 1,
        contentHash: createHash('sha256').update(mockVideoData).digest('hex'),
        size: mockVideoData.length,
        createdAt: new Date().toISOString(),
        metadata: {
          width: 1920,
          height: 1080,
          codec: 'h264',
          bitrate: 5000000,
        }
      }];

      const manifestPath = path.join(segmentDir, 'manifest.jsonl');
      const { timeMs: manifestTime } = await TestUtils.measureTime(async () => {
        const lines = manifestEntries.map(entry => JSON.stringify(entry));
        await fs.writeFile(manifestPath, lines.join('\n'));
      });

      // Step 4: Create index
      const indexPath = path.join(segmentDir, 'segment.mvi');
      const { timeMs: indexTime } = await TestUtils.measureTime(async () => {
        await createMviFile(frameEntries, indexPath);
      });

      // Step 5: Test retrieval
      const { result: retrievalSuccess, timeMs: retrievalTime } = await TestUtils.measureTime(async () => {
        try {
          const reader = await MviReader.fromFile(indexPath);
          const testFrame = Math.floor(frameCount / 2);
          const entry = reader.getFrameEntry(testFrame);
          return entry !== null && entry.frameNumber === testFrame;
        } catch {
          return false;
        }
      });

      const totalTime = generateTime + segmentTime + manifestTime + indexTime + retrievalTime;

      results.push({
        test: `Full pipeline (${frameCount} frames)`,
        success: retrievalSuccess,
        timeMs: totalTime,
        details: `Generate: ${generateTime.toFixed(2)}ms, Segment: ${segmentTime.toFixed(2)}ms, Manifest: ${manifestTime.toFixed(2)}ms, Index: ${indexTime.toFixed(2)}ms, Retrieval: ${retrievalTime.toFixed(2)}ms`,
      });

      // Test error recovery
      const corruptedIndexPath = path.join(segmentDir, 'corrupted.mvi');
      await fs.writeFile(corruptedIndexPath, Buffer.from('invalid data'));

      const { result: recoveryResult } = await TestUtils.measureTime(async () => {
        try {
          await MviReader.fromFile(corruptedIndexPath);
          return false; // Should have failed
        } catch (error) {
          return error instanceof MviError;
        }
      });

      results.push({
        test: `Error recovery (${frameCount} frames)`,
        success: recoveryResult,
        timeMs: 0,
        details: 'Properly handled corrupted index file',
      });
    }

    return this.summarizeResults('Full Pipeline Integration', results);
  }

  /**
   * 6. Scope Management Testing
   */
  async validateScopeManagement(): Promise<ValidationResult> {
    console.log('\n=== Scope Management Validation ===');

    const results: TestResult[] = [];
    const scopes: MemoryScope[] = ['global', 'local', 'committed'];

    // Test scope separation
    for (const scope of scopes) {
      try {
        const scopeDir = this.scopeResolver.getScopeDirectory(scope, this.tempDir);

        // Create scope-specific content
        const manifestPath = path.join(scopeDir, 'scope-manifest.jsonl');
        const indexPath = path.join(scopeDir, 'scope-index.mvi');

        await fs.ensureDir(scopeDir);

        const manifestEntries = TestDataGenerator.generateManifestEntries(10);
        const frameEntries = TestDataGenerator.generateFrameEntries(100);

        await fs.writeFile(manifestPath, manifestEntries.map(e => JSON.stringify(e)).join('\n'));
        await createMviFile(frameEntries, indexPath);

        results.push({
          test: `Scope isolation (${scope})`,
          success: await fs.pathExists(manifestPath) && await fs.pathExists(indexPath),
          timeMs: 0,
          details: `Scope directory: ${scopeDir}`,
        });

      } catch (error) {
        results.push({
          test: `Scope setup error (${scope})`,
          success: false,
          timeMs: 0,
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Test scope detection and resolution
    try {
      const projectInfo = this.scopeResolver.detectProject(this.tempDir);
      results.push({
        test: `Project detection`,
        success: projectInfo.repoId !== undefined && projectInfo.root !== undefined,
        timeMs: 0,
        details: `Repo ID: ${projectInfo.repoId}, Root: ${projectInfo.root}`,
      });

      const allDirs = this.scopeResolver.getAllScopeDirectories(this.tempDir);
      const allScopesResolved = scopes.every(scope => allDirs[scope] !== undefined);

      results.push({
        test: `All scope resolution`,
        success: allScopesResolved,
        timeMs: 0,
        details: `Resolved: ${Object.keys(allDirs).join(', ')}`,
      });

    } catch (error) {
      results.push({
        test: `Scope resolution error`,
        success: false,
        timeMs: 0,
        details: error instanceof Error ? error.message : String(error),
      });
    }

    return this.summarizeResults('Scope Management', results);
  }

  /**
   * Run all validation tests
   */
  async runAllValidations(): Promise<ValidationSummary> {
    const startTime = performance.now();

    console.log('🧪 Starting comprehensive frame indexing validation...\n');

    const validations = [
      this.validateFrameIndexGeneration(),
      this.validateRandomAccessPerformance(),
      this.validateManifestManagement(),
      this.validateVideoSegmentOrganization(),
      this.validateFullPipeline(),
      this.validateScopeManagement(),
    ];

    const results = await Promise.all(validations);
    const totalTime = performance.now() - startTime;

    const summary: ValidationSummary = {
      totalTests: results.reduce((sum, r) => sum + r.totalTests, 0),
      passedTests: results.reduce((sum, r) => sum + r.passedTests, 0),
      failedTests: results.reduce((sum, r) => sum + r.failedTests, 0),
      totalTimeMs: totalTime,
      categories: results.map(r => r.category),
      results,
      success: results.every(r => r.success),
    };

    this.printSummary(summary);
    return summary;
  }

  private summarizeResults(category: string, results: TestResult[]): ValidationResult {
    const passed = results.filter(r => r.success).length;
    const failed = results.length - passed;
    const totalTime = results.reduce((sum, r) => sum + r.timeMs, 0);

    return {
      category,
      totalTests: results.length,
      passedTests: passed,
      failedTests: failed,
      totalTimeMs: totalTime,
      success: failed === 0,
      results,
    };
  }

  private printSummary(summary: ValidationSummary): void {
    console.log('\n' + '='.repeat(60));
    console.log('📊 FRAME INDEXING VALIDATION SUMMARY');
    console.log('='.repeat(60));

    console.log(`Total Tests: ${summary.totalTests}`);
    console.log(`Passed: ${summary.passedTests} ✅`);
    console.log(`Failed: ${summary.failedTests} ${summary.failedTests > 0 ? '❌' : '✅'}`);
    console.log(`Total Time: ${summary.totalTimeMs.toFixed(2)}ms`);
    console.log(`Overall: ${summary.success ? 'SUCCESS ✅' : 'FAILURE ❌'}\n`);

    // Performance Analysis
    const performanceTests = summary.results.flatMap(r => r.results)
      .filter(t => t.test.includes('performance') || t.test.includes('Seek'));

    if (performanceTests.length > 0) {
      console.log('🚀 PERFORMANCE ANALYSIS');
      console.log('-'.repeat(40));

      const meetTarget = performanceTests.filter(t => t.timeMs < TEST_CONFIG.PERFORMANCE_TARGET_MS).length;
      console.log(`Performance Target (<${TEST_CONFIG.PERFORMANCE_TARGET_MS}ms): ${meetTarget}/${performanceTests.length} tests`);

      const avgTime = performanceTests.reduce((sum, t) => sum + t.timeMs, 0) / performanceTests.length;
      console.log(`Average Performance: ${avgTime.toFixed(2)}ms`);

      const criticalFail = performanceTests.some(t =>
        t.test.includes('P95') && t.timeMs >= TEST_CONFIG.PERFORMANCE_TARGET_MS
      );
      console.log(`Phase 0 Requirement: ${criticalFail ? 'FAILED ❌' : 'PASSED ✅'}`);
      console.log();
    }

    // Category Breakdown
    console.log('📋 CATEGORY BREAKDOWN');
    console.log('-'.repeat(40));
    for (const result of summary.results) {
      const status = result.success ? '✅' : '❌';
      console.log(`${result.category}: ${result.passedTests}/${result.totalTests} ${status}`);

      if (!result.success) {
        const failures = result.results.filter(r => !r.success);
        for (const failure of failures) {
          console.log(`  ❌ ${failure.test}: ${failure.details}`);
        }
      }
    }

    console.log('\n' + '='.repeat(60));
  }
}

// Type definitions for results
interface TestResult {
  test: string;
  success: boolean;
  timeMs: number;
  details: string;
}

interface ValidationResult {
  category: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalTimeMs: number;
  success: boolean;
  results: TestResult[];
}

interface ValidationSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalTimeMs: number;
  categories: string[];
  results: ValidationResult[];
  success: boolean;
}

// Main execution
async function main() {
  const validator = new FrameIndexingValidator();

  try {
    await validator.setup();
    await validator.runAllValidations();
  } catch (error) {
    console.error('❌ Validation failed with error:', error);
  } finally {
    await validator.cleanup();
  }
}

// Export for testing
export { TestUtils, TestDataGenerator };

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}