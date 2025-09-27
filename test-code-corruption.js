#!/usr/bin/env node

/**
 * Test script to diagnose code field corruption in video storage
 */

import { VideoStorageAdapter } from './dist/src/storage/VideoStorageAdapter.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs-extra';

const TEST_DIR = '/tmp/code-corruption-test';

async function testCodeCorruption() {
  console.log('🔍 Testing code field corruption...');

  // Clean up any existing test directory
  if (await fs.pathExists(TEST_DIR)) {
    await fs.remove(TEST_DIR);
  }
  await fs.ensureDir(TEST_DIR);

  const adapter = new VideoStorageAdapter(TEST_DIR, 'local');
  await adapter.initialize();

  // Create test items with different code scenarios
  const testItems = [
    {
      id: randomUUID(),
      type: 'snippet',
      scope: 'local',
      title: 'Test Item 1: With Code',
      text: 'This is test item 1 with code',
      code: 'function test1() {\n  return "validation-1";\n}',
      facets: { tags: ['test'], files: [], symbols: [] },
      quality: { confidence: 0.8, pinned: false, reuseCount: 0 },
      security: { sensitivity: 'private' },
      context: {},
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    },
    {
      id: randomUUID(),
      type: 'snippet',
      scope: 'local',
      title: 'Test Item 2: Without Code',
      text: 'This is test item 2 without code',
      // Intentionally omit code field
      facets: { tags: ['test'], files: [], symbols: [] },
      quality: { confidence: 0.8, pinned: false, reuseCount: 0 },
      security: { sensitivity: 'private' },
      context: {},
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    },
    {
      id: randomUUID(),
      type: 'snippet',
      scope: 'local',
      title: 'Test Item 3: Empty Code String',
      text: 'This is test item 3 with empty code string',
      code: '', // Explicitly empty string
      facets: { tags: ['test'], files: [], symbols: [] },
      quality: { confidence: 0.8, pinned: false, reuseCount: 0 },
      security: { sensitivity: 'private' },
      context: {},
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1
    }
  ];

  console.log('\n📝 Writing test items...');
  for (const item of testItems) {
    console.log(`Writing item ${item.id} with code: ${item.code === undefined ? 'undefined' : `"${item.code}"`}`);
    await adapter.writeItem(item);
  }

  // Wait for encoding to complete
  console.log('\n⏳ Waiting for video encoding...');
  let attempts = 0;
  while (attempts < 30) {
    const metrics = await adapter.getVideoStorageMetrics();
    if (metrics.queueLength === 0 && !metrics.isEncoding) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }

  console.log('\n📖 Reading items back and comparing...');
  let corruptions = 0;

  for (const originalItem of testItems) {
    const readItem = await adapter.readItem(originalItem.id);
    if (!readItem) {
      console.log(`❌ Failed to read item ${originalItem.id}`);
      corruptions++;
      continue;
    }

    const originalCode = originalItem.code;
    const readCode = readItem.code;

    console.log(`\nItem ${originalItem.id}:`);
    console.log(`  Original code: ${originalCode === undefined ? 'undefined' : `"${originalCode}"`}`);
    console.log(`  Read code:     ${readCode === undefined ? 'undefined' : `"${readCode}"`}`);

    // Check for corruption
    let isCorrupted = false;

    if (originalCode === undefined) {
      // Undefined should become empty string after normalization
      if (readCode !== '') {
        console.log(`  ❌ CORRUPTION: undefined became "${readCode}"`);
        isCorrupted = true;
      } else {
        console.log(`  ✅ OK: undefined correctly normalized to empty string`);
      }
    } else if (originalCode !== readCode) {
      console.log(`  ❌ CORRUPTION: "${originalCode}" became "${readCode}"`);
      isCorrupted = true;
    } else {
      console.log(`  ✅ OK: code field preserved correctly`);
    }

    if (isCorrupted) {
      corruptions++;
    }
  }

  await adapter.destroy();

  if (corruptions === 0) {
    console.log('\n✅ All code fields preserved correctly!');
  } else {
    console.log(`\n❌ ${corruptions} code field corruptions detected!`);
  }

  // Cleanup
  await fs.remove(TEST_DIR);

  return corruptions === 0;
}

testCodeCorruption().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});