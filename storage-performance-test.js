#!/usr/bin/env node

/**
 * Storage Performance Comparison: Video vs File Storage
 * Tests read/write operations, search performance, and storage efficiency
 */

import { VideoStorageAdapter } from './dist/src/storage/VideoStorageAdapter.js';
import { FileStorageAdapter } from './dist/src/storage/FileStorageAdapter.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs-extra';

const TEST_DIR_VIDEO = '/tmp/video-perf-test';
const TEST_DIR_FILE = '/tmp/file-perf-test';
const ITEM_COUNTS = [10, 50, 100];

// Create test items of varying sizes
function createTestItems(count) {
  const items = [];
  const sizes = ['small', 'medium', 'large'];

  for (let i = 0; i < count; i++) {
    const size = sizes[i % 3];
    let text, code;

    switch (size) {
      case 'small':
        text = `Small test item ${i} with minimal content for performance testing.`;
        code = undefined;
        break;
      case 'medium':
        text = `Medium test item ${i} with more substantial content. ` +
               `This item contains multiple lines of text and represents ` +
               `a typical memory item size that might be stored in practice. ` +
               `Additional details: ${Math.random().toString(36).substring(2)}`;
        code = i % 2 === 0 ? `function test${i}() {\n  return "medium-${i}";\n}` : undefined;
        break;
      case 'large':
        text = `Large test item ${i} with extensive content. ` +
               `This represents a complex memory item that might contain ` +
               `detailed explanations, code examples, and comprehensive ` +
               `documentation. `.repeat(10) +
               `Random data: ${Math.random().toString(36).substring(2)}`;
        code = `class TestClass${i} {\n  constructor() {\n    this.data = "${Math.random().toString(36)}";\n  }\n\n  method${i}() {\n    return this.data + "-processed";\n  }\n}`;
        break;
    }

    items.push({
      id: randomUUID(),
      type: ['snippet', 'pattern', 'insight', 'fact'][i % 4],
      scope: 'local',
      title: `Performance Test Item ${i + 1} (${size})`,
      text,
      code,
      facets: {
        tags: [`test-tag-${i % 5}`, 'performance', size],
        files: [`test-file-${i}.js`],
        symbols: [`testSymbol${i}`]
      },
      quality: {
        confidence: 0.8,
        pinned: i % 10 === 0,
        reuseCount: Math.floor(Math.random() * 5)
      },
      security: { sensitivity: 'private' },
      context: { testIndex: i, size },
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    });
  }

  return items;
}

async function benchmarkStorage(adapter, name, items) {
  console.log(`\n📊 Benchmarking ${name} Storage (${items.length} items)`);

  const results = {
    name,
    itemCount: items.length,
    writeTime: 0,
    readTime: 0,
    searchTime: 0,
    storageSize: 0,
    compressionRatio: 1
  };

  // Initialize adapter
  await adapter.initialize?.();

  // Write performance
  console.log(`  📝 Writing ${items.length} items...`);
  const writeStart = Date.now();

  for (const item of items) {
    await adapter.writeItem(item);
  }

  // Wait for video encoding if needed
  if (name === 'Video') {
    console.log(`  ⏳ Waiting for video encoding...`);
    let attempts = 0;
    while (attempts < 60) { // Max 60 seconds
      const metrics = await adapter.getVideoStorageMetrics?.();
      if (metrics && metrics.queueLength === 0 && !metrics.isEncoding) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
  }

  results.writeTime = Date.now() - writeStart;
  console.log(`  ✅ Write completed in ${results.writeTime}ms`);

  // Read performance
  console.log(`  📖 Reading ${items.length} items...`);
  const readStart = Date.now();

  for (const item of items) {
    await adapter.readItem(item.id);
  }

  results.readTime = Date.now() - readStart;
  console.log(`  ✅ Read completed in ${results.readTime}ms`);

  // Search performance (basic catalog operation)
  console.log(`  🔍 Testing search operations...`);
  const searchStart = Date.now();

  const catalog = adapter.readCatalog();
  const catalogKeys = Object.keys(catalog);

  // Simulate search operations
  for (let i = 0; i < 10; i++) {
    const searchResults = catalogKeys.filter(id =>
      catalog[id].title?.includes('Performance') ||
      catalog[id].facets?.tags?.includes('performance')
    );
  }

  results.searchTime = Date.now() - searchStart;
  console.log(`  ✅ Search completed in ${results.searchTime}ms`);

  // Storage metrics
  const stats = await adapter.getStats();
  results.storageSize = stats.sizeBytes;

  if (name === 'Video') {
    const metrics = await adapter.getVideoStorageMetrics?.();
    if (metrics) {
      results.compressionRatio = metrics.segmentStats.averageCompressionRatio;
    }
  }

  console.log(`  📏 Storage size: ${(results.storageSize / 1024).toFixed(2)} KB`);
  console.log(`  📊 Compression ratio: ${results.compressionRatio.toFixed(2)}x`);

  await adapter.destroy?.();

  return results;
}

async function runPerformanceComparison() {
  console.log('🚀 Starting Storage Performance Comparison');
  console.log('=' * 60);

  const allResults = [];

  for (const count of ITEM_COUNTS) {
    console.log(`\n📋 Testing with ${count} items`);
    console.log('-' * 40);

    const items = createTestItems(count);

    // Clean up directories
    await fs.remove(TEST_DIR_VIDEO);
    await fs.remove(TEST_DIR_FILE);
    await fs.ensureDir(TEST_DIR_VIDEO);
    await fs.ensureDir(TEST_DIR_FILE);

    // Test Video Storage
    const videoAdapter = new VideoStorageAdapter(TEST_DIR_VIDEO, 'local');
    const videoResults = await benchmarkStorage(videoAdapter, 'Video', items);

    // Test File Storage
    const fileAdapter = new FileStorageAdapter(TEST_DIR_FILE, 'local');
    const fileResults = await benchmarkStorage(fileAdapter, 'File', items);

    allResults.push({ count, video: videoResults, file: fileResults });

    // Performance comparison
    console.log(`\n📈 Performance Comparison (${count} items):`);
    console.log(`  Write Time:    Video ${videoResults.writeTime}ms vs File ${fileResults.writeTime}ms`);
    console.log(`  Read Time:     Video ${videoResults.readTime}ms vs File ${fileResults.readTime}ms`);
    console.log(`  Search Time:   Video ${videoResults.searchTime}ms vs File ${fileResults.searchTime}ms`);
    console.log(`  Storage Size:  Video ${(videoResults.storageSize/1024).toFixed(2)} KB vs File ${(fileResults.storageSize/1024).toFixed(2)} KB`);
    console.log(`  Compression:   Video ${videoResults.compressionRatio.toFixed(2)}x vs File 1.00x`);
  }

  // Summary report
  console.log('\n' + '=' * 60);
  console.log('📊 PERFORMANCE SUMMARY REPORT');
  console.log('=' * 60);

  for (const result of allResults) {
    const { count, video, file } = result;
    console.log(`\n📋 ${count} Items:`);
    console.log(`  Write Performance:`);
    console.log(`    Video: ${video.writeTime}ms (${(video.writeTime/count).toFixed(2)}ms/item)`);
    console.log(`    File:  ${file.writeTime}ms (${(file.writeTime/count).toFixed(2)}ms/item)`);
    console.log(`    Winner: ${video.writeTime < file.writeTime ? 'Video' : 'File'} (${Math.abs(video.writeTime - file.writeTime)}ms faster)`);

    console.log(`  Read Performance:`);
    console.log(`    Video: ${video.readTime}ms (${(video.readTime/count).toFixed(2)}ms/item)`);
    console.log(`    File:  ${file.readTime}ms (${(file.readTime/count).toFixed(2)}ms/item)`);
    console.log(`    Winner: ${video.readTime < file.readTime ? 'Video' : 'File'} (${Math.abs(video.readTime - file.readTime)}ms faster)`);

    console.log(`  Storage Efficiency:`);
    console.log(`    Video: ${(video.storageSize/1024).toFixed(2)} KB (compression: ${video.compressionRatio.toFixed(2)}x)`);
    console.log(`    File:  ${(file.storageSize/1024).toFixed(2)} KB`);
    console.log(`    Space saved: ${(((file.storageSize - video.storageSize) / file.storageSize) * 100).toFixed(1)}%`);
  }

  // Production readiness assessment
  console.log('\n' + '=' * 60);
  console.log('🎯 PRODUCTION READINESS ASSESSMENT');
  console.log('=' * 60);

  const largestTest = allResults[allResults.length - 1];
  const avgVideoRead = largestTest.video.readTime / largestTest.count;
  const avgFileRead = largestTest.file.readTime / largestTest.count;

  console.log(`✅ Read Performance: ${avgVideoRead < 100 ? 'PASS' : 'FAIL'} (${avgVideoRead.toFixed(2)}ms/item, target: <100ms)`);
  console.log(`✅ Compression Ratio: ${largestTest.video.compressionRatio > 0.1 ? 'PASS' : 'FAIL'} (${largestTest.video.compressionRatio.toFixed(2)}x, target: >0.1x)`);
  console.log(`✅ Storage Savings: ${((largestTest.file.storageSize - largestTest.video.storageSize) / largestTest.file.storageSize) > 0.5 ? 'PASS' : 'FAIL'} (${(((largestTest.file.storageSize - largestTest.video.storageSize) / largestTest.file.storageSize) * 100).toFixed(1)}%, target: >50%)`);

  const overallScore = [
    avgVideoRead < 100,
    largestTest.video.compressionRatio > 0.1,
    ((largestTest.file.storageSize - largestTest.video.storageSize) / largestTest.file.storageSize) > 0.5
  ].filter(Boolean).length;

  console.log(`\n🏆 Overall Score: ${overallScore}/3 ${overallScore === 3 ? '(READY FOR PRODUCTION)' : '(NEEDS IMPROVEMENT)'}`);

  // Cleanup
  await fs.remove(TEST_DIR_VIDEO);
  await fs.remove(TEST_DIR_FILE);

  return allResults;
}

runPerformanceComparison().then(() => {
  console.log('\n✅ Performance comparison completed successfully!');
  process.exit(0);
}).catch(error => {
  console.error('❌ Performance comparison failed:', error);
  process.exit(1);
});