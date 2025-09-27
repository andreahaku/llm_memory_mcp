import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { VideoStorageAdapter } from '../src/storage/VideoStorageAdapter.js';
import { FileStorageAdapter } from '../src/storage/FileStorageAdapter.js';
import type { MemoryItem, MemoryScope, StorageStats } from '../src/types/Memory.js';
import { ulid } from '../src/util/ulid.js';

/**
 * Performance Benchmarking Test Suite
 *
 * This test suite provides comprehensive performance benchmarks comparing
 * VideoStorageAdapter and FileStorageAdapter across various metrics.
 */

interface BenchmarkContext {
  videoAdapter: VideoStorageAdapter;
  fileAdapter: FileStorageAdapter;
  videoDir: string;
  fileDir: string;
}

interface PerformanceMetrics {
  writeTime: number;
  readTime: number;
  deleteTime: number;
  storageSize: number;
  compressionRatio?: number;
  operationsPerSecond: number;
  memoryUsage: number;
}

interface BenchmarkResult {
  testName: string;
  itemCount: number;
  video: PerformanceMetrics;
  file: PerformanceMetrics;
  comparison: {
    writeSpeedRatio: number;
    readSpeedRatio: number;
    storageEfficiencyRatio: number;
    overallScore: number;
  };
  reliability: {
    videoErrors: number;
    fileErrors: number;
    dataIntegrityPassed: boolean;
  };
}

describe('Storage Performance Benchmarking', () => {
  let context: BenchmarkContext;

  beforeEach(async () => {
    // Setup test directories
    const baseDir = path.join(process.cwd(), 'test-temp', `benchmark-${Date.now()}`);
    const videoDir = path.join(baseDir, 'video');
    const fileDir = path.join(baseDir, 'file');

    await fs.ensureDir(videoDir);
    await fs.ensureDir(fileDir);

    // Initialize adapters
    const videoAdapter = new VideoStorageAdapter(videoDir, 'local' as MemoryScope);
    const fileAdapter = new FileStorageAdapter(fileDir);

    context = {
      videoAdapter,
      fileAdapter,
      videoDir,
      fileDir
    };

    // Wait for video adapter initialization
    await new Promise(resolve => setTimeout(resolve, 3000));
  });

  afterEach(async () => {
    try {
      if (context?.videoDir && await fs.pathExists(context.videoDir)) {
        await fs.remove(path.dirname(context.videoDir));
      }
    } catch (error) {
      console.warn('Benchmark cleanup warning:', error);
    }
  });

  describe('Small Scale Performance (10-50 items)', () => {
    it('should benchmark small item sets', async () => {
      const itemCounts = [10, 25, 50];
      const results: BenchmarkResult[] = [];

      for (const count of itemCounts) {
        const result = await runPerformanceBenchmark(`Small Scale (${count} items)`, count);
        results.push(result);

        // Basic performance expectations for small scale
        expect(result.video.writeTime).toBeLessThan(30000); // 30 seconds
        expect(result.file.writeTime).toBeLessThan(10000); // 10 seconds
        expect(result.reliability.dataIntegrityPassed).toBe(true);
      }

      printBenchmarkSummary('Small Scale Results', results);
    });
  });

  describe('Medium Scale Performance (100-500 items)', () => {
    it('should benchmark medium item sets', async () => {
      const itemCounts = [100, 250, 500];
      const results: BenchmarkResult[] = [];

      for (const count of itemCounts) {
        const result = await runPerformanceBenchmark(`Medium Scale (${count} items)`, count);
        results.push(result);

        // Performance expectations for medium scale
        expect(result.video.writeTime).toBeLessThan(120000); // 2 minutes
        expect(result.file.writeTime).toBeLessThan(30000); // 30 seconds
        expect(result.comparison.storageEfficiencyRatio).toBeGreaterThan(1); // Video should be more efficient
      }

      printBenchmarkSummary('Medium Scale Results', results);
    });
  });

  describe('Large Scale Performance (1000+ items)', () => {
    it('should benchmark large item sets', async () => {
      const itemCounts = [1000];
      const results: BenchmarkResult[] = [];

      for (const count of itemCounts) {
        const result = await runPerformanceBenchmark(`Large Scale (${count} items)`, count);
        results.push(result);

        // Performance expectations for large scale
        expect(result.video.writeTime).toBeLessThan(300000); // 5 minutes
        expect(result.file.writeTime).toBeLessThan(60000); // 1 minute
        expect(result.video.compressionRatio).toBeGreaterThan(2); // Good compression
      }

      printBenchmarkSummary('Large Scale Results', results);
    });
  }, 600000); // 10 minute timeout for large scale tests

  describe('Read Performance Benchmarks', () => {
    it('should benchmark sequential read performance', async () => {
      const itemCount = 100;
      const testItems = generateBenchmarkItems(itemCount);

      // Setup data in both adapters
      await context.videoAdapter.writeBatch(testItems);
      await context.fileAdapter.writeBatch(testItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Benchmark sequential reads
      const videoSequentialTime = await benchmarkSequentialReads(context.videoAdapter, testItems);
      const fileSequentialTime = await benchmarkSequentialReads(context.fileAdapter, testItems);

      console.log(`Sequential read performance:
        Video: ${videoSequentialTime.toFixed(2)}ms (${(videoSequentialTime / itemCount).toFixed(2)}ms per item)
        File: ${fileSequentialTime.toFixed(2)}ms (${(fileSequentialTime / itemCount).toFixed(2)}ms per item)
        Ratio: ${(videoSequentialTime / fileSequentialTime).toFixed(2)}x`);

      expect(videoSequentialTime).toBeLessThan(60000); // Should complete within 1 minute
      expect(fileSequentialTime).toBeLessThan(30000); // File should be faster
    });

    it('should benchmark random read performance', async () => {
      const itemCount = 100;
      const testItems = generateBenchmarkItems(itemCount);

      // Setup data in both adapters
      await context.videoAdapter.writeBatch(testItems);
      await context.fileAdapter.writeBatch(testItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Benchmark random reads
      const videoRandomTime = await benchmarkRandomReads(context.videoAdapter, testItems, 50);
      const fileRandomTime = await benchmarkRandomReads(context.fileAdapter, testItems, 50);

      console.log(`Random read performance (50 reads):
        Video: ${videoRandomTime.toFixed(2)}ms (${(videoRandomTime / 50).toFixed(2)}ms per read)
        File: ${fileRandomTime.toFixed(2)}ms (${(fileRandomTime / 50).toFixed(2)}ms per read)
        Ratio: ${(videoRandomTime / fileRandomTime).toFixed(2)}x`);

      expect(videoRandomTime).toBeLessThan(30000); // Should complete within 30 seconds
      expect(fileRandomTime).toBeLessThan(10000); // File should be faster for random access
    });

    it('should benchmark batch read performance', async () => {
      const itemCount = 200;
      const testItems = generateBenchmarkItems(itemCount);

      // Setup data in both adapters
      await context.videoAdapter.writeBatch(testItems);
      await context.fileAdapter.writeBatch(testItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Benchmark batch reads
      const batchSizes = [10, 25, 50];

      for (const batchSize of batchSizes) {
        const videoBatchTime = await benchmarkBatchReads(context.videoAdapter, testItems, batchSize);
        const fileBatchTime = await benchmarkBatchReads(context.fileAdapter, testItems, batchSize);

        console.log(`Batch read performance (batch size ${batchSize}):
          Video: ${videoBatchTime.toFixed(2)}ms (${(videoBatchTime / batchSize).toFixed(2)}ms per item)
          File: ${fileBatchTime.toFixed(2)}ms (${(fileBatchTime / batchSize).toFixed(2)}ms per item)`);

        expect(videoBatchTime).toBeLessThan(30000);
        expect(fileBatchTime).toBeLessThan(15000);
      }
    });
  });

  describe('Write Performance Benchmarks', () => {
    it('should benchmark individual write performance', async () => {
      const testItems = generateBenchmarkItems(50);

      // Benchmark individual writes
      const videoWriteTime = await benchmarkIndividualWrites(context.videoAdapter, testItems);
      const fileWriteTime = await benchmarkIndividualWrites(context.fileAdapter, testItems);

      console.log(`Individual write performance (50 items):
        Video: ${videoWriteTime.toFixed(2)}ms (${(videoWriteTime / testItems.length).toFixed(2)}ms per item)
        File: ${fileWriteTime.toFixed(2)}ms (${(fileWriteTime / testItems.length).toFixed(2)}ms per item)
        Ratio: ${(videoWriteTime / fileWriteTime).toFixed(2)}x`);

      expect(videoWriteTime).toBeLessThan(120000); // 2 minutes for 50 items
      expect(fileWriteTime).toBeLessThan(30000); // 30 seconds for 50 items
    });

    it('should benchmark batch write performance', async () => {
      const batchSizes = [10, 25, 50, 100];

      for (const batchSize of batchSizes) {
        const testItems = generateBenchmarkItems(batchSize);

        const videoStartTime = performance.now();
        await context.videoAdapter.writeBatch(testItems);
        await waitForVideoProcessing(context.videoAdapter);
        const videoTime = performance.now() - videoStartTime;

        const fileStartTime = performance.now();
        await context.fileAdapter.writeBatch(testItems);
        const fileTime = performance.now() - fileStartTime;

        console.log(`Batch write performance (${batchSize} items):
          Video: ${videoTime.toFixed(2)}ms (${(videoTime / batchSize).toFixed(2)}ms per item)
          File: ${fileTime.toFixed(2)}ms (${(fileTime / batchSize).toFixed(2)}ms per item)
          Ratio: ${(videoTime / fileTime).toFixed(2)}x`);

        expect(videoTime).toBeLessThan(batchSize * 2000); // 2 seconds per item max
        expect(fileTime).toBeLessThan(batchSize * 500); // 500ms per item max
      }
    });
  });

  describe('Storage Efficiency Benchmarks', () => {
    it('should benchmark storage space efficiency', async () => {
      const itemCounts = [50, 100, 200];

      for (const count of itemCounts) {
        const testItems = generateVariedSizeItems(count);

        // Write to both adapters
        await context.videoAdapter.writeBatch(testItems);
        await context.fileAdapter.writeBatch(testItems);
        await waitForVideoProcessing(context.videoAdapter);

        // Get storage stats
        const videoStats = await context.videoAdapter.getStats();
        const fileStats = await context.fileAdapter.getStats();

        // Calculate original data size
        const originalSize = testItems.reduce((sum, item) => {
          return sum + JSON.stringify(item).length;
        }, 0);

        const videoCompressionRatio = originalSize / videoStats.sizeBytes;
        const fileCompressionRatio = originalSize / fileStats.sizeBytes;

        console.log(`Storage efficiency (${count} items):
          Original size: ${(originalSize / 1024).toFixed(2)} KB
          Video storage: ${(videoStats.sizeBytes / 1024).toFixed(2)} KB (${videoCompressionRatio.toFixed(2)}x compression)
          File storage: ${(fileStats.sizeBytes / 1024).toFixed(2)} KB (${fileCompressionRatio.toFixed(2)}x compression)
          Space savings: ${((1 - videoStats.sizeBytes / fileStats.sizeBytes) * 100).toFixed(1)}%`);

        expect(videoCompressionRatio).toBeGreaterThan(1); // Should achieve some compression
        expect(videoStats.sizeBytes).toBeLessThan(fileStats.sizeBytes); // Video should be more efficient
      }
    });

    it('should benchmark compression ratio vs content size', async () => {
      // Test different content patterns for compression efficiency
      const contentPatterns = [
        { name: 'Repetitive Code', generator: generateRepetitiveContent },
        { name: 'Diverse Text', generator: generateDiverseContent },
        { name: 'Mixed Content', generator: generateMixedContent },
        { name: 'Large Blocks', generator: generateLargeContent }
      ];

      for (const pattern of contentPatterns) {
        const testItems = Array.from({ length: 50 }, (_, i) => ({
          id: ulid(),
          type: 'snippet' as const,
          scope: 'local' as const,
          title: `${pattern.name} Test ${i}`,
          text: pattern.generator(i),
          code: pattern.generator(i + 100),
          facets: { tags: ['benchmark'], files: [], symbols: [] },
          quality: { confidence: 0.8, pinned: false, reuseCount: 0 },
          security: { sensitivity: 'private' as const },
          context: {},
          links: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1
        }));

        // Fresh adapters for each pattern
        const videoTestDir = path.join(context.videoDir, pattern.name.replace(/\s+/g, '_'));
        const fileTestDir = path.join(context.fileDir, pattern.name.replace(/\s+/g, '_'));

        await fs.ensureDir(videoTestDir);
        await fs.ensureDir(fileTestDir);

        const videoAdapter = new VideoStorageAdapter(videoTestDir, 'local' as MemoryScope);
        const fileAdapter = new FileStorageAdapter(fileTestDir);

        await new Promise(resolve => setTimeout(resolve, 2000));

        await videoAdapter.writeBatch(testItems);
        await fileAdapter.writeBatch(testItems);
        await waitForVideoProcessing(videoAdapter);

        const videoStats = await videoAdapter.getStats();
        const fileStats = await fileAdapter.getStats();

        const originalSize = testItems.reduce((sum, item) => {
          return sum + JSON.stringify(item).length;
        }, 0);

        console.log(`Compression analysis for ${pattern.name}:
          Original: ${(originalSize / 1024).toFixed(2)} KB
          Video: ${(videoStats.sizeBytes / 1024).toFixed(2)} KB (${(originalSize / videoStats.sizeBytes).toFixed(2)}x)
          File: ${(fileStats.sizeBytes / 1024).toFixed(2)} KB (${(originalSize / fileStats.sizeBytes).toFixed(2)}x)
          Video efficiency: ${((1 - videoStats.sizeBytes / fileStats.sizeBytes) * 100).toFixed(1)}% smaller`);
      }
    });
  });

  describe('Reliability and Error Handling', () => {
    it('should benchmark error recovery performance', async () => {
      const testItems = generateBenchmarkItems(20);

      // Test video adapter error recovery
      await context.videoAdapter.writeBatch(testItems);
      await waitForVideoProcessing(context.videoAdapter);

      const videoRecoveryTime = await benchmarkErrorRecovery(context.videoAdapter, testItems);

      // Test file adapter error recovery
      await context.fileAdapter.writeBatch(testItems);
      const fileRecoveryTime = await benchmarkErrorRecovery(context.fileAdapter, testItems);

      console.log(`Error recovery performance:
        Video: ${videoRecoveryTime.toFixed(2)}ms
        File: ${fileRecoveryTime.toFixed(2)}ms`);

      expect(videoRecoveryTime).toBeLessThan(10000); // Should recover within 10 seconds
      expect(fileRecoveryTime).toBeLessThan(5000); // File should recover faster
    });

    it('should test concurrent access performance', async () => {
      const testItems = generateBenchmarkItems(50);

      // Setup data
      await context.videoAdapter.writeBatch(testItems);
      await context.fileAdapter.writeBatch(testItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Test concurrent reads
      const videoConcurrentTime = await benchmarkConcurrentReads(context.videoAdapter, testItems, 10);
      const fileConcurrentTime = await benchmarkConcurrentReads(context.fileAdapter, testItems, 10);

      console.log(`Concurrent read performance (10 parallel reads):
        Video: ${videoConcurrentTime.toFixed(2)}ms
        File: ${fileConcurrentTime.toFixed(2)}ms`);

      expect(videoConcurrentTime).toBeLessThan(30000);
      expect(fileConcurrentTime).toBeLessThan(15000);
    });
  });

  // Helper function to run comprehensive performance benchmark
  async function runPerformanceBenchmark(testName: string, itemCount: number): Promise<BenchmarkResult> {
    const testItems = generateBenchmarkItems(itemCount);

    // Benchmark video adapter
    const videoMetrics = await benchmarkAdapter(context.videoAdapter, testItems, true);

    // Benchmark file adapter
    const fileMetrics = await benchmarkAdapter(context.fileAdapter, testItems, false);

    // Calculate comparison metrics
    const comparison = {
      writeSpeedRatio: videoMetrics.writeTime / fileMetrics.writeTime,
      readSpeedRatio: videoMetrics.readTime / fileMetrics.readTime,
      storageEfficiencyRatio: fileMetrics.storageSize / videoMetrics.storageSize,
      overallScore: calculateOverallScore(videoMetrics, fileMetrics)
    };

    // Test data integrity
    const dataIntegrityPassed = await verifyDataIntegrity(
      context.videoAdapter,
      context.fileAdapter,
      testItems
    );

    return {
      testName,
      itemCount,
      video: videoMetrics,
      file: fileMetrics,
      comparison,
      reliability: {
        videoErrors: 0, // Would be populated by error tracking in real implementation
        fileErrors: 0,
        dataIntegrityPassed
      }
    };
  }

  // Helper function to benchmark a single adapter
  async function benchmarkAdapter(
    adapter: VideoStorageAdapter | FileStorageAdapter,
    testItems: MemoryItem[],
    isVideo: boolean
  ): Promise<PerformanceMetrics> {
    const startMemory = process.memoryUsage().heapUsed;

    // Benchmark write performance
    const writeStartTime = performance.now();
    await adapter.writeBatch(testItems);
    if (isVideo) {
      await waitForVideoProcessing(adapter as VideoStorageAdapter);
    }
    const writeTime = performance.now() - writeStartTime;

    // Benchmark read performance
    const readStartTime = performance.now();
    await adapter.readItems(testItems.map(item => item.id));
    const readTime = performance.now() - readStartTime;

    // Benchmark delete performance
    const deleteStartTime = performance.now();
    await adapter.deleteBatch(testItems.slice(0, 5).map(item => item.id)); // Delete first 5 items
    const deleteTime = performance.now() - deleteStartTime;

    // Get storage stats
    const stats = await adapter.getStats();

    const endMemory = process.memoryUsage().heapUsed;

    return {
      writeTime,
      readTime,
      deleteTime,
      storageSize: stats.sizeBytes,
      compressionRatio: stats.compressionRatio,
      operationsPerSecond: (testItems.length * 2) / ((writeTime + readTime) / 1000), // writes + reads per second
      memoryUsage: endMemory - startMemory
    };
  }

  function calculateOverallScore(videoMetrics: PerformanceMetrics, fileMetrics: PerformanceMetrics): number {
    // Weighted score considering speed and efficiency
    const speedScore = (fileMetrics.writeTime + fileMetrics.readTime) / (videoMetrics.writeTime + videoMetrics.readTime);
    const efficiencyScore = fileMetrics.storageSize / videoMetrics.storageSize;
    const compressionBonus = videoMetrics.compressionRatio ? Math.min(videoMetrics.compressionRatio / 5, 1) : 0;

    return (speedScore * 0.4) + (efficiencyScore * 0.4) + (compressionBonus * 0.2);
  }

  function printBenchmarkSummary(title: string, results: BenchmarkResult[]): void {
    console.log(`\n📊 ${title}`);
    console.log('='.repeat(60));

    for (const result of results) {
      console.log(`\n${result.testName}:`);
      console.log(`  Write Performance: Video ${result.video.writeTime.toFixed(0)}ms vs File ${result.file.writeTime.toFixed(0)}ms (${result.comparison.writeSpeedRatio.toFixed(2)}x)`);
      console.log(`  Read Performance: Video ${result.video.readTime.toFixed(0)}ms vs File ${result.file.readTime.toFixed(0)}ms (${result.comparison.readSpeedRatio.toFixed(2)}x)`);
      console.log(`  Storage Efficiency: ${result.comparison.storageEfficiencyRatio.toFixed(2)}x space savings`);
      console.log(`  Overall Score: ${result.comparison.overallScore.toFixed(2)}`);
      console.log(`  Data Integrity: ${result.reliability.dataIntegrityPassed ? '✅ PASSED' : '❌ FAILED'}`);
    }

    // Calculate averages
    const avgWriteRatio = results.reduce((sum, r) => sum + r.comparison.writeSpeedRatio, 0) / results.length;
    const avgStorageRatio = results.reduce((sum, r) => sum + r.comparison.storageEfficiencyRatio, 0) / results.length;
    const avgOverallScore = results.reduce((sum, r) => sum + r.comparison.overallScore, 0) / results.length;

    console.log(`\n📈 Summary Averages:`);
    console.log(`  Average Write Speed Ratio: ${avgWriteRatio.toFixed(2)}x`);
    console.log(`  Average Storage Efficiency: ${avgStorageRatio.toFixed(2)}x`);
    console.log(`  Average Overall Score: ${avgOverallScore.toFixed(2)}`);
  }
});

// Benchmark utility functions

function generateBenchmarkItems(count: number): MemoryItem[] {
  const items: MemoryItem[] = [];

  for (let i = 0; i < count; i++) {
    items.push({
      id: ulid(),
      type: ['snippet', 'pattern', 'insight', 'fact'][i % 4] as any,
      scope: 'local',
      title: `Benchmark Item ${i + 1}: Performance Testing`,
      text: `This is benchmark content for item ${i + 1}. ` +
            `It contains standard testing data with moderate complexity. ` +
            `Timestamp: ${Date.now()}, Index: ${i}`,
      code: i % 3 === 0 ? `function benchmarkItem${i}() {\n  return ${i} * Math.random();\n}` : undefined,
      facets: {
        tags: [`benchmark-${i % 5}`, 'performance-test'],
        files: i % 4 === 0 ? [`bench-${i}.js`] : [],
        symbols: i % 2 === 0 ? [`benchmarkItem${i}`] : []
      },
      quality: {
        confidence: 0.5 + (i % 5) * 0.1,
        pinned: i % 10 === 0,
        reuseCount: i % 3
      },
      security: { sensitivity: 'private' },
      context: { benchmarkIndex: i },
      links: [],
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      updatedAt: new Date(Date.now() - i * 500).toISOString(),
      version: 1
    });
  }

  return items;
}

function generateVariedSizeItems(count: number): MemoryItem[] {
  const items: MemoryItem[] = [];

  for (let i = 0; i < count; i++) {
    const sizeMultiplier = Math.floor(i / 10) + 1; // Increase size every 10 items

    items.push({
      id: ulid(),
      type: 'snippet',
      scope: 'local',
      title: `Varied Size Item ${i + 1}`,
      text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(sizeMultiplier * 10),
      code: `// Large code block ${i}\n${'// Comment line\n'.repeat(sizeMultiplier * 5)}function test() { return ${i}; }`,
      facets: {
        tags: Array.from({ length: sizeMultiplier }, (_, j) => `tag-${i}-${j}`),
        files: Array.from({ length: Math.min(sizeMultiplier, 5) }, (_, j) => `file-${i}-${j}.js`),
        symbols: Array.from({ length: Math.min(sizeMultiplier, 3) }, (_, j) => `symbol_${i}_${j}`)
      },
      quality: {
        confidence: 0.8,
        pinned: false,
        reuseCount: 0
      },
      security: { sensitivity: 'private' },
      context: {
        sizeCategory: sizeMultiplier,
        generatedContent: 'A'.repeat(sizeMultiplier * 100)
      },
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    });
  }

  return items;
}

function generateRepetitiveContent(index: number): string {
  return 'const value = 42;\nfunction getValue() { return value; }\n'.repeat(index % 10 + 1);
}

function generateDiverseContent(index: number): string {
  const patterns = [
    'Algorithm implementation with optimization',
    'Database query with complex joins',
    'API endpoint with authentication',
    'Frontend component with state management',
    'Backend service with error handling'
  ];
  return patterns[index % patterns.length] + ` - unique content ${index} - ${Math.random().toString(36)}`;
}

function generateMixedContent(index: number): string {
  return `${generateRepetitiveContent(index)}\n\n${generateDiverseContent(index)}`;
}

function generateLargeContent(index: number): string {
  return 'Large content block with varied patterns. '.repeat(100) + `Unique: ${index}`;
}

async function benchmarkSequentialReads(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  items: MemoryItem[]
): Promise<number> {
  const startTime = performance.now();

  for (const item of items) {
    await adapter.readItem(item.id);
  }

  return performance.now() - startTime;
}

async function benchmarkRandomReads(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  items: MemoryItem[],
  readCount: number
): Promise<number> {
  const startTime = performance.now();

  for (let i = 0; i < readCount; i++) {
    const randomItem = items[Math.floor(Math.random() * items.length)];
    await adapter.readItem(randomItem.id);
  }

  return performance.now() - startTime;
}

async function benchmarkBatchReads(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  items: MemoryItem[],
  batchSize: number
): Promise<number> {
  const startTime = performance.now();

  const batch = items.slice(0, batchSize);
  await adapter.readItems(batch.map(item => item.id));

  return performance.now() - startTime;
}

async function benchmarkIndividualWrites(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  items: MemoryItem[]
): Promise<number> {
  const startTime = performance.now();

  for (const item of items) {
    await adapter.writeItem(item);
  }

  if (adapter instanceof VideoStorageAdapter) {
    await waitForVideoProcessing(adapter);
  }

  return performance.now() - startTime;
}

async function benchmarkErrorRecovery(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  items: MemoryItem[]
): Promise<number> {
  const startTime = performance.now();

  // Simulate error scenarios by attempting to read non-existent items
  const nonExistentIds = Array.from({ length: 10 }, () => ulid());

  for (const id of nonExistentIds) {
    try {
      await adapter.readItem(id);
    } catch (error) {
      // Expected to fail
    }
  }

  // Then read actual items to test recovery
  for (const item of items.slice(0, 5)) {
    await adapter.readItem(item.id);
  }

  return performance.now() - startTime;
}

async function benchmarkConcurrentReads(
  adapter: VideoStorageAdapter | FileStorageAdapter,
  items: MemoryItem[],
  concurrency: number
): Promise<number> {
  const startTime = performance.now();

  const promises = Array.from({ length: concurrency }, async () => {
    const randomItem = items[Math.floor(Math.random() * items.length)];
    return adapter.readItem(randomItem.id);
  });

  await Promise.all(promises);

  return performance.now() - startTime;
}

async function verifyDataIntegrity(
  videoAdapter: VideoStorageAdapter,
  fileAdapter: FileStorageAdapter,
  originalItems: MemoryItem[]
): Promise<boolean> {
  try {
    // Read first 10 items from both adapters and compare
    const testItems = originalItems.slice(0, 10);

    for (const originalItem of testItems) {
      const videoItem = await videoAdapter.readItem(originalItem.id);
      const fileItem = await fileAdapter.readItem(originalItem.id);

      if (!videoItem || !fileItem) {
        return false;
      }

      // Compare essential fields
      if (videoItem.title !== fileItem.title ||
          videoItem.text !== fileItem.text ||
          videoItem.type !== fileItem.type) {
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Data integrity verification failed:', error);
    return false;
  }
}

async function waitForVideoProcessing(adapter: VideoStorageAdapter): Promise<void> {
  const startTime = Date.now();
  const timeout = 120000; // 2 minutes for benchmark tests

  while (Date.now() - startTime < timeout) {
    try {
      const metrics = await (adapter as any).getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return;
      }
    } catch (error) {
      // If metrics aren't available, wait longer
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.warn('Video processing did not complete within benchmark timeout');
}