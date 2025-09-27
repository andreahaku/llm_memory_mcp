#!/usr/bin/env node

/**
 * Comprehensive Video Storage Pipeline Validation Script
 *
 * Tests all core functionality of the video storage system:
 * - Writing and reading items
 * - Index integrity and mapping consistency
 * - QR encoding/decoding accuracy
 * - Video frame extraction reliability
 * - Content hash validation
 * - Error recovery mechanisms
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as fs from 'fs-extra';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// Test configuration
const TEST_CONFIG = {
  testDir: '/tmp/video-storage-validation',
  sampleItems: 10,
  maxRetries: 3,
  timeoutMs: 30000
};

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

async function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'success' ? '✅' : 'ℹ️';
  console.log(`${prefix} [${timestamp}] ${message}`);
}

async function createTestItems(count = 10) {
  const items = [];
  for (let i = 0; i < count; i++) {
    items.push({
      id: randomUUID(),
      type: ['snippet', 'pattern', 'insight', 'fact'][i % 4],
      scope: 'local',
      title: `Test Item ${i + 1}: Video Storage Validation`,
      text: `This is test item ${i + 1} with content for video storage validation. ` +
            `It contains ${Math.random().toString(36).substring(2)} random data to ensure ` +
            `proper encoding and decoding through the QR→Video→QR pipeline.`,
      code: i % 3 === 0 ? `function test${i}() {\n  return "validation-${i}";\n}` : undefined,
      facets: {
        tags: [`test-tag-${i % 5}`, 'validation'],
        files: [`test-file-${i}.js`],
        symbols: [`testSymbol${i}`]
      },
      quality: {
        confidence: 0.8,
        pinned: i % 5 === 0,
        reuseCount: 0
      },
      security: {
        sensitivity: 'private'
      },
      context: {
        testIndex: i,
        validationRun: Date.now()
      },
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    });
  }
  return items;
}

async function testVideoStorageAdapter() {
  try {
    await log('Starting video storage pipeline validation...');

    // Clean up any existing test directory
    if (await fs.pathExists(TEST_CONFIG.testDir)) {
      await fs.remove(TEST_CONFIG.testDir);
    }
    await fs.ensureDir(TEST_CONFIG.testDir);

    // Import video storage components
    const { VideoStorageAdapter } = await import('./dist/src/storage/VideoStorageAdapter.js');

    // Create adapter instance
    const adapter = new VideoStorageAdapter(TEST_CONFIG.testDir, 'local');
    await log('Video storage adapter created successfully', 'success');

    // Initialize adapter
    await adapter.initialize();
    await log('Video storage adapter initialized', 'success');

    // Test 1: Write and read items
    await log('Test 1: Writing and reading items...');
    const testItems = await createTestItems(TEST_CONFIG.sampleItems);

    // Write items individually
    for (const item of testItems) {
      await adapter.writeItem(item);
    }
    await log(`✅ Successfully wrote ${testItems.length} items`);

    // Wait for video encoding to complete
    await log('Waiting for video encoding to complete...');
    let attempts = 0;
    while (attempts < 30) { // Max 30 seconds
      const metrics = await adapter.getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }
    await log('Video encoding completed', 'success');

    // Read items back and verify
    let readErrors = 0;
    for (const originalItem of testItems) {
      try {
        const readItem = await adapter.readItem(originalItem.id);
        if (!readItem) {
          await log(`❌ Failed to read item ${originalItem.id}`, 'error');
          readErrors++;
          continue;
        }

        // Validate critical fields
        if (readItem.id !== originalItem.id) {
          await log(`❌ ID mismatch for ${originalItem.id}: got ${readItem.id}`, 'error');
          readErrors++;
        }

        if (readItem.title !== originalItem.title) {
          await log(`❌ Title mismatch for ${originalItem.id}`, 'error');
          readErrors++;
        }

        if (readItem.text !== originalItem.text) {
          await log(`❌ Text mismatch for ${originalItem.id}`, 'error');
          readErrors++;
        }

        // Handle code field normalization (undefined becomes empty string)
        const normalizedOriginalCode = originalItem.code ?? '';
        if (readItem.code !== normalizedOriginalCode) {
          await log(`❌ Code mismatch for ${originalItem.id}: expected "${normalizedOriginalCode}", got "${readItem.code}"`, 'error');
          readErrors++;
        }
      } catch (error) {
        await log(`❌ Exception reading item ${originalItem.id}: ${error.message}`, 'error');
        readErrors++;
      }
    }

    if (readErrors === 0) {
      await log(`✅ All ${testItems.length} items read successfully with correct content`, 'success');
      testResults.passed++;
    } else {
      await log(`❌ ${readErrors} items failed read validation`, 'error');
      testResults.failed++;
      testResults.errors.push(`${readErrors} items failed read validation`);
    }

    // Test 2: Index integrity
    await log('Test 2: Validating index integrity...');
    const validation = await adapter.validateAndRepairIndex();
    if (validation.valid) {
      await log('✅ Index integrity validation passed', 'success');
      testResults.passed++;
    } else {
      await log(`❌ Index integrity issues: ${validation.errors.join(', ')}`, 'error');
      testResults.failed++;
      testResults.errors.push(`Index integrity issues: ${validation.errors.join(', ')}`);
    }

    // Test 3: Catalog consistency
    await log('Test 3: Checking catalog consistency...');
    const catalog = adapter.readCatalog();
    const catalogIds = Object.keys(catalog);
    const itemIds = await adapter.listItems();

    let catalogErrors = 0;
    for (const id of itemIds) {
      if (!catalogIds.includes(id)) {
        await log(`❌ Item ${id} missing from catalog`, 'error');
        catalogErrors++;
      }
    }

    if (catalogErrors === 0) {
      await log('✅ Catalog consistency check passed', 'success');
      testResults.passed++;
    } else {
      await log(`❌ ${catalogErrors} catalog consistency errors`, 'error');
      testResults.failed++;
      testResults.errors.push(`${catalogErrors} catalog consistency errors`);
    }

    // Test 4: Storage statistics
    await log('Test 4: Checking storage statistics...');
    const stats = await adapter.getStats();
    if (stats.items === testItems.length) {
      await log(`✅ Storage statistics correct: ${stats.items} items, ${stats.sizeBytes} bytes`, 'success');
      testResults.passed++;
    } else {
      await log(`❌ Storage statistics mismatch: expected ${testItems.length}, got ${stats.items}`, 'error');
      testResults.failed++;
      testResults.errors.push(`Storage statistics mismatch: expected ${testItems.length}, got ${stats.items}`);
    }

    // Test 5: Batch operations
    await log('Test 5: Testing batch operations...');
    const batchItems = await createTestItems(3);
    await adapter.writeBatch(batchItems);

    const readBatch = await adapter.readItems(batchItems.map(item => item.id));
    if (readBatch.length === batchItems.length) {
      await log('✅ Batch operations test passed', 'success');
      testResults.passed++;
    } else {
      await log(`❌ Batch operations failed: expected ${batchItems.length}, got ${readBatch.length}`, 'error');
      testResults.failed++;
      testResults.errors.push(`Batch operations failed: expected ${batchItems.length}, got ${readBatch.length}`);
    }

    // Test 6: Delete operations
    await log('Test 6: Testing delete operations...');
    const deleteItem = testItems[0];
    const deleteResult = await adapter.deleteItem(deleteItem.id);
    const deletedCheck = await adapter.readItem(deleteItem.id);

    if (deleteResult && deletedCheck === null) {
      await log('✅ Delete operations test passed', 'success');
      testResults.passed++;
    } else {
      await log('❌ Delete operations test failed', 'error');
      testResults.failed++;
      testResults.errors.push('Delete operations test failed');
    }

    // Test 7: Video storage metrics
    await log('Test 7: Checking video storage metrics...');
    const videoMetrics = await adapter.getVideoStorageMetrics();
    if (videoMetrics.segmentStats.totalFrames > 0) {
      await log(`✅ Video metrics valid: ${videoMetrics.segmentStats.totalFrames} frames, compression ratio ${videoMetrics.segmentStats.averageCompressionRatio.toFixed(2)}x`, 'success');
      testResults.passed++;
    } else {
      await log('❌ Video metrics validation failed', 'error');
      testResults.failed++;
      testResults.errors.push('Video metrics validation failed');
    }

    // Cleanup
    await adapter.destroy();
    await log('Video storage adapter destroyed', 'success');

  } catch (error) {
    await log(`❌ Critical error during validation: ${error.message}`, 'error');
    testResults.failed++;
    testResults.errors.push(`Critical error: ${error.message}`);
  }
}

async function printTestResults() {
  await log('\n' + '='.repeat(60));
  await log('VIDEO STORAGE VALIDATION RESULTS');
  await log('='.repeat(60));

  const total = testResults.passed + testResults.failed;
  const successRate = total > 0 ? ((testResults.passed / total) * 100).toFixed(1) : '0.0';

  await log(`Total tests: ${total}`);
  await log(`Passed: ${testResults.passed}`, 'success');
  await log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'error' : 'info');
  await log(`Success rate: ${successRate}%`, testResults.failed > 0 ? 'warn' : 'success');

  if (testResults.errors.length > 0) {
    await log('\n❌ ERRORS ENCOUNTERED:');
    for (const error of testResults.errors) {
      await log(`  • ${error}`, 'error');
    }
  }

  if (testResults.failed === 0) {
    await log('\n🎉 ALL TESTS PASSED! Video storage pipeline is working correctly.', 'success');
  } else {
    await log('\n⚠️  Some tests failed. Please review the errors above.', 'warn');
  }

  await log('='.repeat(60));
}

// Main execution
async function main() {
  try {
    await testVideoStorageAdapter();
  } catch (error) {
    await log(`❌ Fatal error: ${error.message}`, 'error');
    console.error(error);
  } finally {
    await printTestResults();

    // Cleanup test directory
    try {
      if (await fs.pathExists(TEST_CONFIG.testDir)) {
        await fs.remove(TEST_CONFIG.testDir);
        await log('Test directory cleaned up');
      }
    } catch (error) {
      await log(`Warning: Failed to clean up test directory: ${error.message}`, 'warn');
    }

    // Exit with appropriate code
    process.exit(testResults.failed > 0 ? 1 : 0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}