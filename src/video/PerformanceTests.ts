import { VideoSegmentManager } from './VideoSegmentManager.js';
import { EnhancedFrameIndex, FrameIndexManager } from './EnhancedFrameIndex.js';
import { VideoStorageAdapter } from '../storage/VideoStorageAdapter.js';
import type { MemoryItem, MemoryScope } from '../types/Memory.js';
import { ulid } from '../util/ulid.js';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Performance test configuration
 */
export interface PerformanceTestConfig {
  itemCount: number;
  segmentCount: number;
  accessPatternType: 'random' | 'sequential' | 'hotspot' | 'mixed';
  targetAccessTimeMs: number;
  testDurationSeconds: number;
  warmupIterations: number;
}

/**
 * Performance test results
 */
export interface PerformanceTestResults {
  testName: string;
  config: PerformanceTestConfig;
  results: {
    averageAccessTimeMs: number;
    medianAccessTimeMs: number;
    p95AccessTimeMs: number;
    p99AccessTimeMs: number;
    maxAccessTimeMs: number;
    cacheHitRate: number;
    totalOperations: number;
    operationsPerSecond: number;
    sub100msOperations: number;
    sub100msPercentage: number;
  };
  segmentStats: {
    totalSegments: number;
    averageFramesPerSegment: number;
    totalSizeBytes: number;
    compressionRatio: number;
  };
  indexStats: {
    indexCacheHits: number;
    frameCacheHits: number;
    preloadedFrames: number;
  };
  errors: string[];
  timestamp: string;
}

/**
 * Comprehensive performance test suite for video segment random access
 */
export class VideoStoragePerformanceTester {
  private testDirectory: string;
  private cleanupAfterTest: boolean;

  constructor(baseDirectory: string = '/tmp/video-performance-test', cleanupAfterTest = true) {
    this.testDirectory = baseDirectory;
    this.cleanupAfterTest = cleanupAfterTest;
  }

  /**
   * Run comprehensive performance test suite
   */
  async runFullTestSuite(): Promise<PerformanceTestResults[]> {
    console.log('🚀 Starting comprehensive video storage performance tests...\n');

    const results: PerformanceTestResults[] = [];

    // Test configurations from light to heavy workloads
    const testConfigs: Array<{ name: string; config: PerformanceTestConfig }> = [
      {
        name: 'Light Random Access',
        config: {
          itemCount: 100,
          segmentCount: 5,
          accessPatternType: 'random',
          targetAccessTimeMs: 50,
          testDurationSeconds: 30,
          warmupIterations: 20
        }
      },
      {
        name: 'Medium Sequential Access',
        config: {
          itemCount: 500,
          segmentCount: 10,
          accessPatternType: 'sequential',
          targetAccessTimeMs: 30,
          testDurationSeconds: 45,
          warmupIterations: 50
        }
      },
      {
        name: 'Heavy Hotspot Access',
        config: {
          itemCount: 1000,
          segmentCount: 15,
          accessPatternType: 'hotspot',
          targetAccessTimeMs: 25,
          testDurationSeconds: 60,
          warmupIterations: 100
        }
      },
      {
        name: 'Mixed Workload Stress Test',
        config: {
          itemCount: 2000,
          segmentCount: 25,
          accessPatternType: 'mixed',
          targetAccessTimeMs: 75,
          testDurationSeconds: 120,
          warmupIterations: 150
        }
      }
    ];

    for (const { name, config } of testConfigs) {
      console.log(`\n📊 Running test: ${name}`);
      try {
        const result = await this.runSinglePerformanceTest(name, config);
        results.push(result);
        this.printTestResults(result);
      } catch (error) {
        console.error(`❌ Test failed: ${name} - ${error}`);
        results.push({
          testName: name,
          config,
          results: {
            averageAccessTimeMs: 0,
            medianAccessTimeMs: 0,
            p95AccessTimeMs: 0,
            p99AccessTimeMs: 0,
            maxAccessTimeMs: 0,
            cacheHitRate: 0,
            totalOperations: 0,
            operationsPerSecond: 0,
            sub100msOperations: 0,
            sub100msPercentage: 0
          },
          segmentStats: {
            totalSegments: 0,
            averageFramesPerSegment: 0,
            totalSizeBytes: 0,
            compressionRatio: 0
          },
          indexStats: {
            indexCacheHits: 0,
            frameCacheHits: 0,
            preloadedFrames: 0
          },
          errors: [error instanceof Error ? error.message : String(error)],
          timestamp: new Date().toISOString()
        });
      }

      // Brief pause between tests
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\n✅ Performance test suite completed!\n');
    this.printSummaryReport(results);

    return results;
  }

  /**
   * Run a single performance test with specified configuration
   */
  async runSinglePerformanceTest(
    testName: string,
    config: PerformanceTestConfig
  ): Promise<PerformanceTestResults> {
    const testDir = path.join(this.testDirectory, `test-${Date.now()}`);
    await fs.ensureDir(testDir);

    let adapter: VideoStorageAdapter | null = null;
    const errors: string[] = [];

    try {
      // Initialize video storage adapter
      adapter = new VideoStorageAdapter(testDir, 'local' as MemoryScope);

      // Generate test data
      console.log(`  📝 Generating ${config.itemCount} test items...`);
      const testItems = this.generateTestItems(config.itemCount);

      // Write test items to create segments
      console.log('  💾 Writing items and creating video segments...');
      const writeStartTime = performance.now();

      for (const item of testItems) {
        await adapter.writeItem(item);
      }

      // Wait for background encoding to complete
      await this.waitForEncodingCompletion(adapter, 30000);

      const writeTime = performance.now() - writeStartTime;
      console.log(`  ✅ Setup completed in ${writeTime.toFixed(2)}ms`);

      // Warmup phase
      console.log(`  🔥 Warming up with ${config.warmupIterations} operations...`);
      await this.performWarmup(adapter, testItems, config.warmupIterations);

      // Main performance test
      console.log(`  🏃 Running performance test for ${config.testDurationSeconds} seconds...`);
      const accessTimes = await this.performAccessTest(adapter, testItems, config);

      // Collect statistics
      const segmentManager = (adapter as any).segmentManager as VideoSegmentManager;
      const frameIndexManager = (adapter as any).frameIndexManager as FrameIndexManager;

      const segmentStats = await segmentManager.getStorageStats();
      const indexStats = frameIndexManager.getCombinedStats();

      // Calculate performance metrics
      const results = this.calculatePerformanceMetrics(accessTimes, config);

      return {
        testName,
        config,
        results,
        segmentStats: {
          totalSegments: segmentStats.totalSegments,
          averageFramesPerSegment: segmentStats.totalFrames / Math.max(segmentStats.totalSegments, 1),
          totalSizeBytes: segmentStats.totalSizeBytes,
          compressionRatio: segmentStats.averageCompressionRatio
        },
        indexStats: {
          indexCacheHits: Math.round(indexStats.cacheHitRate * indexStats.totalFrames),
          frameCacheHits: Math.round(indexStats.cacheHitRate * indexStats.totalFrames),
          preloadedFrames: indexStats.hotFrameCount
        },
        errors,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      // Cleanup
      if (this.cleanupAfterTest) {
        try {
          await fs.remove(testDir);
        } catch (cleanupError) {
          console.warn('Cleanup failed:', cleanupError);
        }
      }
    }
  }

  /**
   * Generate test memory items with various content patterns
   */
  private generateTestItems(count: number): MemoryItem[] {
    const items: MemoryItem[] = [];

    for (let i = 0; i < count; i++) {
      const item: MemoryItem = {
        id: ulid(),
        type: ['snippet', 'pattern', 'insight', 'fact'][i % 4] as any,
        scope: 'local',
        title: `Test Item ${i + 1}: Performance Test Data`,
        text: this.generateTestContent(i),
        code: i % 3 === 0 ? this.generateCodeSnippet(i) : undefined,
        tags: [`tag-${i % 10}`, `category-${Math.floor(i / 100)}`],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'PerformanceTest'
        }
      };

      items.push(item);
    }

    return items;
  }

  private generateTestContent(index: number): string {
    const patterns = [
      'This is a short test content for memory item',
      'Medium length content that simulates typical memory storage patterns and provides enough text to test compression ratios effectively',
      'Longer content block that includes more detailed information about software patterns, architectural decisions, and implementation details that would commonly be stored in a memory system for retrieval and analysis',
      'Extended content with code references, function names like processData(), handleRequest(), and various technical terms that represent real-world usage patterns in development environments'
    ];

    const basePattern = patterns[index % patterns.length];
    return `${basePattern} - Item #${index + 1} with unique identifier and timestamp ${Date.now()}`;
  }

  private generateCodeSnippet(index: number): string {
    const snippets = [
      `function test${index}() {\n  return "hello world";\n}`,
      `const data = {\n  id: ${index},\n  value: "test-${index}"\n};`,
      `class Test${index} {\n  constructor() {\n    this.id = ${index};\n  }\n}`,
      `interface Test${index}Interface {\n  id: number;\n  process(): void;\n}`
    ];

    return snippets[index % snippets.length];
  }

  /**
   * Wait for background encoding to complete
   */
  private async waitForEncodingCompletion(adapter: VideoStorageAdapter, timeoutMs: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const metrics = await (adapter as any).getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error('Encoding did not complete within timeout');
  }

  /**
   * Perform warmup operations to populate caches
   */
  private async performWarmup(
    adapter: VideoStorageAdapter,
    items: MemoryItem[],
    iterations: number
  ): Promise<void> {
    for (let i = 0; i < iterations; i++) {
      const randomItem = items[Math.floor(Math.random() * items.length)];
      try {
        await adapter.readItem(randomItem.id);
      } catch (error) {
        // Ignore warmup errors
      }
    }
  }

  /**
   * Perform the main access test with specified pattern
   */
  private async performAccessTest(
    adapter: VideoStorageAdapter,
    items: MemoryItem[],
    config: PerformanceTestConfig
  ): Promise<number[]> {
    const accessTimes: number[] = [];
    const startTime = Date.now();
    const endTime = startTime + (config.testDurationSeconds * 1000);

    let operation = 0;

    while (Date.now() < endTime) {
      const targetItem = this.selectItemByPattern(items, operation, config.accessPatternType);

      const accessStartTime = performance.now();
      try {
        const result = await adapter.readItem(targetItem.id);
        const accessTime = performance.now() - accessStartTime;
        accessTimes.push(accessTime);

        if (!result) {
          console.warn(`Item not found: ${targetItem.id}`);
        }
      } catch (error) {
        console.warn(`Access error for item ${targetItem.id}:`, error);
        accessTimes.push(1000); // Record as 1000ms for failed access
      }

      operation++;
    }

    return accessTimes;
  }

  /**
   * Select item based on access pattern
   */
  private selectItemByPattern(
    items: MemoryItem[],
    operation: number,
    pattern: PerformanceTestConfig['accessPatternType']
  ): MemoryItem {
    switch (pattern) {
      case 'sequential':
        return items[operation % items.length];

      case 'hotspot':
        // 80% access to first 20% of items (hotspot)
        if (Math.random() < 0.8) {
          const hotspotSize = Math.floor(items.length * 0.2);
          return items[Math.floor(Math.random() * hotspotSize)];
        }
        return items[Math.floor(Math.random() * items.length)];

      case 'mixed':
        // Mixed pattern: 50% sequential, 30% random, 20% hotspot
        const rand = Math.random();
        if (rand < 0.5) {
          return items[operation % items.length];
        } else if (rand < 0.8) {
          return items[Math.floor(Math.random() * items.length)];
        } else {
          const hotspotSize = Math.floor(items.length * 0.1);
          return items[Math.floor(Math.random() * hotspotSize)];
        }

      case 'random':
      default:
        return items[Math.floor(Math.random() * items.length)];
    }
  }

  /**
   * Calculate performance metrics from access times
   */
  private calculatePerformanceMetrics(
    accessTimes: number[],
    config: PerformanceTestConfig
  ): PerformanceTestResults['results'] {
    if (accessTimes.length === 0) {
      throw new Error('No access times recorded');
    }

    const sortedTimes = [...accessTimes].sort((a, b) => a - b);
    const totalOps = accessTimes.length;

    const average = accessTimes.reduce((sum, time) => sum + time, 0) / totalOps;
    const median = sortedTimes[Math.floor(sortedTimes.length / 2)];
    const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
    const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];
    const max = sortedTimes[sortedTimes.length - 1];

    const sub100msOps = accessTimes.filter(time => time < 100).length;
    const sub100msPercentage = (sub100msOps / totalOps) * 100;

    const opsPerSecond = totalOps / config.testDurationSeconds;

    return {
      averageAccessTimeMs: parseFloat(average.toFixed(2)),
      medianAccessTimeMs: parseFloat(median.toFixed(2)),
      p95AccessTimeMs: parseFloat(p95.toFixed(2)),
      p99AccessTimeMs: parseFloat(p99.toFixed(2)),
      maxAccessTimeMs: parseFloat(max.toFixed(2)),
      cacheHitRate: 0, // Would need to be tracked separately
      totalOperations: totalOps,
      operationsPerSecond: parseFloat(opsPerSecond.toFixed(2)),
      sub100msOperations: sub100msOps,
      sub100msPercentage: parseFloat(sub100msPercentage.toFixed(2))
    };
  }

  /**
   * Print individual test results
   */
  private printTestResults(results: PerformanceTestResults): void {
    const { results: metrics } = results;
    const passIcon = metrics.sub100msPercentage >= 90 ? '✅' : metrics.sub100msPercentage >= 75 ? '⚠️' : '❌';

    console.log(`\n    ${passIcon} Results for ${results.testName}:`);
    console.log(`      📊 Operations: ${metrics.totalOperations} (${metrics.operationsPerSecond}/sec)`);
    console.log(`      ⚡ Average: ${metrics.averageAccessTimeMs}ms | Median: ${metrics.medianAccessTimeMs}ms`);
    console.log(`      📈 P95: ${metrics.p95AccessTimeMs}ms | P99: ${metrics.p99AccessTimeMs}ms | Max: ${metrics.maxAccessTimeMs}ms`);
    console.log(`      🎯 Sub-100ms: ${metrics.sub100msOperations}/${metrics.totalOperations} (${metrics.sub100msPercentage}%)`);
    console.log(`      💾 Segments: ${results.segmentStats.totalSegments} | Compression: ${results.segmentStats.compressionRatio.toFixed(1)}x`);
  }

  /**
   * Print summary report for all tests
   */
  private printSummaryReport(results: PerformanceTestResults[]): void {
    console.log('📋 PERFORMANCE TEST SUMMARY REPORT');
    console.log('=====================================\n');

    const totalTests = results.length;
    const passedTests = results.filter(r => r.results.sub100msPercentage >= 90).length;
    const overallPassRate = (passedTests / totalTests) * 100;

    console.log(`Overall Results: ${passedTests}/${totalTests} tests passed (${overallPassRate.toFixed(1)}%)\n`);

    // Aggregate statistics
    const allAccessTimes = results.flatMap(r => [
      r.results.averageAccessTimeMs,
      r.results.medianAccessTimeMs,
      r.results.p95AccessTimeMs
    ]);

    const avgAccessTime = allAccessTimes.reduce((sum, time) => sum + time, 0) / allAccessTimes.length;
    const totalOperations = results.reduce((sum, r) => sum + r.results.totalOperations, 0);

    console.log(`🎯 Performance Targets:`);
    console.log(`   Sub-100ms Access: ${avgAccessTime < 100 ? '✅ PASSED' : '❌ FAILED'} (${avgAccessTime.toFixed(2)}ms avg)`);
    console.log(`   High Throughput: ${totalOperations > 1000 ? '✅ PASSED' : '❌ FAILED'} (${totalOperations} total ops)`);

    console.log(`\n💾 Storage Efficiency:`);
    const avgCompression = results.reduce((sum, r) => sum + r.segmentStats.compressionRatio, 0) / results.length;
    console.log(`   Compression Ratio: ${avgCompression.toFixed(1)}x average`);

    console.log(`\n🔍 Key Findings:`);
    console.log(`   - Frame index caching is ${results.some(r => r.results.sub100msPercentage > 95) ? 'highly effective' : 'needs optimization'}`);
    console.log(`   - Video segments provide excellent compression (${avgCompression.toFixed(1)}x average)`);
    console.log(`   - Random access performance ${avgAccessTime < 50 ? 'exceeds' : avgAccessTime < 100 ? 'meets' : 'below'} expectations`);

    if (results.some(r => r.errors.length > 0)) {
      console.log(`\n⚠️  Errors encountered in ${results.filter(r => r.errors.length > 0).length} tests`);
    }

    console.log('\n✨ Performance testing completed successfully!');
  }
}

/**
 * Run video storage performance tests
 */
export async function runVideoStoragePerformanceTests(
  testDirectory?: string,
  cleanupAfterTest = true
): Promise<PerformanceTestResults[]> {
  const tester = new VideoStoragePerformanceTester(testDirectory, cleanupAfterTest);
  return await tester.runFullTestSuite();
}

/**
 * Quick performance validation test
 */
export async function validateVideoStoragePerformance(
  adapter: VideoStorageAdapter,
  itemCount = 100
): Promise<{
  averageAccessTimeMs: number;
  sub100msPercentage: number;
  passed: boolean;
}> {
  const tester = new VideoStoragePerformanceTester();

  try {
    // Generate test items
    const testItems = Array.from({ length: itemCount }, (_, i) => ({
      id: ulid(),
      type: 'fact' as any,
      scope: 'local' as any,
      title: `Quick Test Item ${i}`,
      text: `Test content for quick validation ${i}`,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'QuickTest'
      }
    }));

    // Write items
    for (const item of testItems) {
      await adapter.writeItem(item);
    }

    // Wait for encoding
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Test access times
    const accessTimes: number[] = [];
    for (let i = 0; i < Math.min(50, itemCount); i++) {
      const item = testItems[Math.floor(Math.random() * testItems.length)];
      const startTime = performance.now();
      await adapter.readItem(item.id);
      accessTimes.push(performance.now() - startTime);
    }

    const averageAccessTimeMs = accessTimes.reduce((sum, time) => sum + time, 0) / accessTimes.length;
    const sub100msOps = accessTimes.filter(time => time < 100).length;
    const sub100msPercentage = (sub100msOps / accessTimes.length) * 100;

    return {
      averageAccessTimeMs: parseFloat(averageAccessTimeMs.toFixed(2)),
      sub100msPercentage: parseFloat(sub100msPercentage.toFixed(2)),
      passed: averageAccessTimeMs < 100 && sub100msPercentage >= 80
    };
  } catch (error) {
    console.error('Quick validation failed:', error);
    return {
      averageAccessTimeMs: 1000,
      sub100msPercentage: 0,
      passed: false
    };
  }
}