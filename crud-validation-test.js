#!/usr/bin/env node

/**
 * CRUD Operations Validation Across All Memory Scopes
 * Tests Create, Read, Update, Delete operations for global, local, committed, and project scopes
 */

import { VideoStorageAdapter } from './dist/src/storage/VideoStorageAdapter.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs-extra';

const TEST_BASE_DIR = '/tmp/crud-validation';
const SCOPES = ['global', 'local', 'committed', 'project'];

function createTestItem(scope, index) {
  return {
    id: randomUUID(),
    type: ['snippet', 'pattern', 'insight', 'fact'][index % 4],
    scope,
    title: `${scope.toUpperCase()} Test Item ${index + 1}`,
    text: `This is a test memory item for ${scope} scope validation. Item ${index + 1}.`,
    code: index % 2 === 0 ? `function ${scope}Test${index}() {\n  return "${scope}-${index}";\n}` : undefined,
    facets: {
      tags: [`${scope}-tag`, 'crud-test'],
      files: [`${scope}-file-${index}.js`],
      symbols: [`${scope}Symbol${index}`]
    },
    quality: {
      confidence: 0.8,
      pinned: index % 5 === 0,
      reuseCount: 0
    },
    security: { sensitivity: 'private' },
    context: { scope, testIndex: index },
    links: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  };
}

async function testCRUDOperations(scope) {
  console.log(`\n🔧 Testing CRUD Operations for ${scope.toUpperCase()} scope`);
  console.log('=' * 50);

  const testDir = `${TEST_BASE_DIR}/${scope}`;
  await fs.remove(testDir);
  await fs.ensureDir(testDir);

  const adapter = new VideoStorageAdapter(testDir, scope);
  await adapter.initialize();

  const results = {
    scope,
    create: { success: false, time: 0, error: null },
    read: { success: false, time: 0, error: null },
    update: { success: false, time: 0, error: null },
    delete: { success: false, time: 0, error: null },
    batch: { success: false, time: 0, error: null }
  };

  try {
    // CREATE Test
    console.log(`  📝 Testing CREATE operations...`);
    const createStart = Date.now();

    const testItems = [];
    for (let i = 0; i < 3; i++) {
      const item = createTestItem(scope, i);
      testItems.push(item);
      await adapter.writeItem(item);
    }

    // Wait for encoding
    let attempts = 0;
    while (attempts < 30) {
      const metrics = await adapter.getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    results.create.time = Date.now() - createStart;
    results.create.success = true;
    console.log(`    ✅ Created 3 items in ${results.create.time}ms`);

    // READ Test
    console.log(`  📖 Testing READ operations...`);
    const readStart = Date.now();

    for (const item of testItems) {
      const readItem = await adapter.readItem(item.id);
      if (!readItem || readItem.id !== item.id) {
        throw new Error(`Failed to read item ${item.id}`);
      }
    }

    results.read.time = Date.now() - readStart;
    results.read.success = true;
    console.log(`    ✅ Read 3 items in ${results.read.time}ms`);

    // UPDATE Test
    console.log(`  🔄 Testing UPDATE operations...`);
    const updateStart = Date.now();

    const itemToUpdate = testItems[0];
    const updatedItem = {
      ...itemToUpdate,
      title: `UPDATED: ${itemToUpdate.title}`,
      text: `UPDATED: ${itemToUpdate.text}`,
      updatedAt: new Date().toISOString(),
      version: (itemToUpdate.version || 1) + 1
    };

    await adapter.writeItem(updatedItem);

    // Wait for encoding
    attempts = 0;
    while (attempts < 30) {
      const metrics = await adapter.getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    // Verify update
    const readUpdatedItem = await adapter.readItem(itemToUpdate.id);
    if (!readUpdatedItem.title.includes('UPDATED:')) {
      throw new Error('Update verification failed');
    }

    results.update.time = Date.now() - updateStart;
    results.update.success = true;
    console.log(`    ✅ Updated item in ${results.update.time}ms`);

    // DELETE Test
    console.log(`  🗑️  Testing DELETE operations...`);
    const deleteStart = Date.now();

    const itemToDelete = testItems[1];
    const deleteResult = await adapter.deleteItem(itemToDelete.id);
    if (!deleteResult) {
      throw new Error('Delete operation returned false');
    }

    // Verify deletion
    const deletedItem = await adapter.readItem(itemToDelete.id);
    if (deletedItem !== null) {
      throw new Error('Item still exists after deletion');
    }

    results.delete.time = Date.now() - deleteStart;
    results.delete.success = true;
    console.log(`    ✅ Deleted item in ${results.delete.time}ms`);

    // BATCH Test
    console.log(`  📦 Testing BATCH operations...`);
    const batchStart = Date.now();

    const batchItems = [];
    for (let i = 10; i < 13; i++) {
      batchItems.push(createTestItem(scope, i));
    }

    await adapter.writeBatch(batchItems);

    // Wait for encoding
    attempts = 0;
    while (attempts < 30) {
      const metrics = await adapter.getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    // Verify batch
    const readBatchItems = await adapter.readItems(batchItems.map(item => item.id));
    if (readBatchItems.length !== batchItems.length) {
      throw new Error(`Batch verification failed: expected ${batchItems.length}, got ${readBatchItems.length}`);
    }

    results.batch.time = Date.now() - batchStart;
    results.batch.success = true;
    console.log(`    ✅ Batch operations completed in ${results.batch.time}ms`);

  } catch (error) {
    console.log(`    ❌ CRUD test failed: ${error.message}`);

    // Determine which operation failed
    if (!results.create.success) {
      results.create.error = error.message;
    } else if (!results.read.success) {
      results.read.error = error.message;
    } else if (!results.update.success) {
      results.update.error = error.message;
    } else if (!results.delete.success) {
      results.delete.error = error.message;
    } else {
      results.batch.error = error.message;
    }
  }

  await adapter.destroy();

  // Test statistics
  console.log(`\n  📊 ${scope.toUpperCase()} Scope Results:`);
  console.log(`    CREATE: ${results.create.success ? '✅' : '❌'} (${results.create.time}ms)`);
  console.log(`    READ:   ${results.read.success ? '✅' : '❌'} (${results.read.time}ms)`);
  console.log(`    UPDATE: ${results.update.success ? '✅' : '❌'} (${results.update.time}ms)`);
  console.log(`    DELETE: ${results.delete.success ? '✅' : '❌'} (${results.delete.time}ms)`);
  console.log(`    BATCH:  ${results.batch.success ? '✅' : '❌'} (${results.batch.time}ms)`);

  return results;
}

async function runCRUDValidation() {
  console.log('🚀 Starting CRUD Validation Across All Memory Scopes');
  console.log('=' * 60);

  const allResults = [];

  for (const scope of SCOPES) {
    const results = await testCRUDOperations(scope);
    allResults.push(results);
  }

  // Summary Report
  console.log('\n' + '=' * 60);
  console.log('📊 CRUD VALIDATION SUMMARY REPORT');
  console.log('=' * 60);

  const operationTypes = ['create', 'read', 'update', 'delete', 'batch'];

  for (const operation of operationTypes) {
    console.log(`\n${operation.toUpperCase()} Operations:`);
    let totalSuccess = 0;
    let totalTime = 0;

    for (const result of allResults) {
      const op = result[operation];
      const status = op.success ? '✅' : '❌';
      const time = op.time;
      const error = op.error ? ` (${op.error})` : '';

      console.log(`  ${result.scope.padEnd(10)}: ${status} ${time.toString().padStart(4)}ms${error}`);

      if (op.success) {
        totalSuccess++;
        totalTime += time;
      }
    }

    const successRate = ((totalSuccess / SCOPES.length) * 100).toFixed(1);
    const avgTime = totalSuccess > 0 ? (totalTime / totalSuccess).toFixed(1) : 'N/A';
    console.log(`  Summary: ${totalSuccess}/${SCOPES.length} success (${successRate}%), avg: ${avgTime}ms`);
  }

  // Overall Assessment
  console.log('\n' + '=' * 60);
  console.log('🎯 PRODUCTION READINESS ASSESSMENT');
  console.log('=' * 60);

  let totalOperations = 0;
  let successfulOperations = 0;

  for (const result of allResults) {
    for (const operation of operationTypes) {
      totalOperations++;
      if (result[operation].success) {
        successfulOperations++;
      }
    }
  }

  const overallSuccessRate = ((successfulOperations / totalOperations) * 100).toFixed(1);
  console.log(`✅ Overall Success Rate: ${overallSuccessRate}% (${successfulOperations}/${totalOperations} operations)`);

  // Check if all core operations work across all scopes
  const criticalSuccess = allResults.every(result =>
    result.create.success && result.read.success && result.update.success && result.delete.success
  );

  console.log(`✅ Core CRUD Operations: ${criticalSuccess ? 'PASS' : 'FAIL'} (Create, Read, Update, Delete must work across all scopes)`);

  const batchSuccess = allResults.every(result => result.batch.success);
  console.log(`✅ Batch Operations: ${batchSuccess ? 'PASS' : 'FAIL'} (Batch writes must work across all scopes)`);

  const readPerformance = allResults.every(result => (result.read.time / 3) < 100); // 3 items, <100ms per item
  console.log(`✅ Read Performance: ${readPerformance ? 'PASS' : 'FAIL'} (Average read time < 100ms per item)`);

  const overallScore = [criticalSuccess, batchSuccess, readPerformance, overallSuccessRate >= 95].filter(Boolean).length;
  console.log(`\n🏆 Overall Score: ${overallScore}/4 ${overallScore >= 3 ? '(READY FOR PRODUCTION)' : '(NEEDS IMPROVEMENT)'}`);

  // Cleanup
  await fs.remove(TEST_BASE_DIR);

  return allResults;
}

runCRUDValidation().then(() => {
  console.log('\n✅ CRUD validation completed successfully!');
  process.exit(0);
}).catch(error => {
  console.error('❌ CRUD validation failed:', error);
  process.exit(1);
});