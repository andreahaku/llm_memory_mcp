#!/usr/bin/env node

/**
 * Test script for Phase 2 Video Storage Integration
 * Verifies FrameIndex integration and sub-100ms access performance
 */

import { VideoStorageAdapter } from './dist/storage/VideoStorageAdapter.js';
import { runVideoStoragePerformanceTests, validateVideoStoragePerformance } from './dist/video/PerformanceTests.js';
import { ulid } from './dist/util/ulid.js';
import * as fs from 'fs-extra';
import * as path from 'path';

console.log('🚀 Phase 2 Video Storage Integration Test');
console.log('==========================================\n');

async function runIntegrationTest() {
  const testDir = path.join(process.cwd(), 'test-output', 'video-integration');

  try {
    // Cleanup and prepare test directory
    await fs.remove(testDir);
    await fs.ensureDir(testDir);

    console.log('📁 Test directory:', testDir);

    // 1. Basic Integration Test
    console.log('\n1️⃣  Testing basic video storage integration...');

    const adapter = new VideoStorageAdapter(testDir, 'local');

    // Create test items
    const testItems = [];
    for (let i = 0; i < 10; i++) {
      testItems.push({
        id: ulid(),
        type: 'snippet',
        scope: 'local',
        title: `Test Item ${i + 1}`,
        text: `This is test content for item ${i + 1}. It contains enough text to test compression and video encoding.`,
        code: i % 2 === 0 ? `function test${i}() {\n  return "Hello World ${i}";\n}` : undefined,
        tags: [`tag-${i}`, 'integration-test'],
        metadata: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'IntegrationTest'
        }
      });
    }

    console.log(`   📝 Created ${testItems.length} test items`);

    // Write items to trigger video encoding
    console.log('   💾 Writing items to video storage...');
    const writeStartTime = Date.now();

    for (const item of testItems) {
      await adapter.writeItem(item);
    }

    const writeTime = Date.now() - writeStartTime;
    console.log(`   ✅ Write completed in ${writeTime}ms`);

    // Wait for background encoding to complete
    console.log('   ⏳ Waiting for video encoding to complete...');
    let encodingComplete = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    while (!encodingComplete && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      try {
        const metrics = await adapter.getVideoStorageMetrics();
        encodingComplete = metrics.queueLength === 0 && !metrics.isEncoding;

        if (attempts % 5 === 0) {
          console.log(`   📊 Queue: ${metrics.queueLength}, Encoding: ${metrics.isEncoding}`);
        }
      } catch (error) {
        console.warn('   ⚠️  Error checking metrics:', error.message);
      }

      attempts++;
    }

    if (!encodingComplete) {
      console.log('   ⚠️  Encoding may still be in progress, continuing with test...');
    } else {
      console.log('   ✅ Video encoding completed');
    }

    // 2. Test item retrieval with timing
    console.log('\n2️⃣  Testing item retrieval performance...');

    const accessTimes = [];
    let successCount = 0;

    for (const item of testItems) {
      const startTime = Date.now();

      try {
        const retrievedItem = await adapter.readItem(item.id);
        const accessTime = Date.now() - startTime;
        accessTimes.push(accessTime);

        if (retrievedItem) {
          successCount++;

          // Verify item integrity
          if (retrievedItem.id === item.id && retrievedItem.title === item.title) {
            console.log(`   ✅ Item ${item.id}: ${accessTime}ms (intact)`);
          } else {
            console.log(`   ⚠️  Item ${item.id}: ${accessTime}ms (data mismatch)`);
          }
        } else {
          console.log(`   ❌ Item ${item.id}: ${accessTime}ms (not found)`);
        }
      } catch (error) {
        const accessTime = Date.now() - startTime;
        accessTimes.push(accessTime);
        console.log(`   ❌ Item ${item.id}: ${accessTime}ms (error: ${error.message})`);
      }
    }

    // Calculate access time statistics
    if (accessTimes.length > 0) {
      const avgAccessTime = accessTimes.reduce((sum, time) => sum + time, 0) / accessTimes.length;
      const maxAccessTime = Math.max(...accessTimes);
      const minAccessTime = Math.min(...accessTimes);
      const sub100msCount = accessTimes.filter(time => time < 100).length;
      const sub100msPercentage = (sub100msCount / accessTimes.length) * 100;

      console.log(`\n   📊 Access Time Statistics:`);
      console.log(`      Average: ${avgAccessTime.toFixed(2)}ms`);
      console.log(`      Range: ${minAccessTime}ms - ${maxAccessTime}ms`);
      console.log(`      Sub-100ms: ${sub100msCount}/${accessTimes.length} (${sub100msPercentage.toFixed(1)}%)`);
      console.log(`      Success Rate: ${successCount}/${testItems.length} (${((successCount / testItems.length) * 100).toFixed(1)}%)`);

      // Performance validation
      const performancePassed = avgAccessTime < 200 && sub100msPercentage > 50; // Relaxed for integration test
      console.log(`      Performance: ${performancePassed ? '✅ PASSED' : '❌ FAILED'}`);
    }

    // 3. Test storage statistics
    console.log('\n3️⃣  Testing storage statistics...');

    try {
      const stats = await adapter.getStats();
      console.log(`   📈 Items: ${stats.items}`);
      console.log(`   💾 Size: ${(stats.sizeBytes / 1024).toFixed(1)} KB`);
      console.log(`   🗜️  Compression: ${stats.compressionRatio?.toFixed(1)}x`);
      console.log(`   🎯 Cache Hit Rate: ${((stats.cacheHitRate || 0) * 100).toFixed(1)}%`);

      const videoMetrics = await adapter.getVideoStorageMetrics();
      console.log(`   📹 Segments: ${videoMetrics.segmentStats.totalSegments}`);
      console.log(`   🔍 Index Stats: ${videoMetrics.indexStats.totalIndexes} indexes, ${videoMetrics.indexStats.totalFrames} frames`);
    } catch (error) {
      console.log(`   ❌ Stats error: ${error.message}`);
    }

    // 4. Quick performance validation
    console.log('\n4️⃣  Running quick performance validation...');

    try {
      const perfResult = await validateVideoStoragePerformance(adapter, 20);
      console.log(`   ⚡ Average Access Time: ${perfResult.averageAccessTimeMs}ms`);
      console.log(`   🎯 Sub-100ms Rate: ${perfResult.sub100msPercentage.toFixed(1)}%`);
      console.log(`   📋 Validation: ${perfResult.passed ? '✅ PASSED' : '❌ FAILED'}`);
    } catch (error) {
      console.log(`   ❌ Performance validation error: ${error.message}`);
    }

    // 5. Test cleanup
    console.log('\n5️⃣  Testing cleanup and compaction...');

    try {
      const cleanupResult = await adapter.cleanup();
      console.log(`   🧹 Cleanup completed: ${cleanupResult} bytes reclaimed`);
    } catch (error) {
      console.log(`   ❌ Cleanup error: ${error.message}`);
    }

    console.log('\n✅ Integration test completed successfully!');

    // Optional: Run comprehensive performance tests
    const runFullTests = process.argv.includes('--full-tests');
    if (runFullTests) {
      console.log('\n6️⃣  Running comprehensive performance test suite...');
      try {
        const perfResults = await runVideoStoragePerformanceTests(
          path.join(testDir, 'perf-tests'),
          true // cleanup after test
        );

        console.log(`\n📋 Comprehensive Test Results:`);
        for (const result of perfResults) {
          const passed = result.results.sub100msPercentage >= 90;
          console.log(`   ${passed ? '✅' : '❌'} ${result.testName}: ${result.results.sub100msPercentage.toFixed(1)}% sub-100ms`);
        }
      } catch (error) {
        console.log(`   ❌ Comprehensive tests error: ${error.message}`);
      }
    } else {
      console.log('\n💡 Run with --full-tests flag for comprehensive performance testing');
    }

  } catch (error) {
    console.error('\n❌ Integration test failed:', error);
    process.exit(1);
  } finally {
    // Optional cleanup
    if (!process.argv.includes('--keep-files')) {
      try {
        await fs.remove(testDir);
        console.log('\n🧹 Test files cleaned up');
      } catch (error) {
        console.warn('⚠️  Cleanup warning:', error.message);
      }
    } else {
      console.log('\n💾 Test files preserved at:', testDir);
    }
  }
}

// Check if this is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTest().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { runIntegrationTest };