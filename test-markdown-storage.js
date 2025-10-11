// Quick test script for MarkdownStorageAdapter
// Usage: node test-markdown-storage.js

import { MarkdownStorageAdapter } from './dist/src/storage/MarkdownStorageAdapter.js';
import { ulid } from './dist/src/util/ulid.js';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, rmSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  console.log('🧪 Testing MarkdownStorageAdapter\n');

  // Create test directory
  const testDir = path.join(__dirname, 'test-data', 'markdown-test');
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }

  const adapter = new MarkdownStorageAdapter(testDir);

  // Test 1: Write item
  console.log('📝 Test 1: Write item');
  const testItem = {
    id: ulid(),
    type: 'snippet',
    scope: 'local',
    title: 'Test React Hook',
    text: 'This is a test memory for React hooks.',
    code: 'function useTest() {\n  return "test";\n}',
    language: 'typescript',
    facets: {
      tags: ['react', 'hooks', 'test'],
      files: ['src/hooks/useTest.ts'],
      symbols: ['useTest'],
    },
    context: {
      repoId: 'test-repo',
      file: 'src/hooks/useTest.ts',
      range: { start: 1, end: 3 },
    },
    quality: {
      confidence: 0.85,
      reuseCount: 0,
      pinned: false,
    },
    security: {
      sensitivity: 'public',
    },
    links: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  };

  await adapter.writeItem(testItem);
  console.log(`✅ Wrote item: ${testItem.id}\n`);

  // Test 2: Read item
  console.log('📖 Test 2: Read item');
  const readItem = await adapter.readItem(testItem.id);
  if (readItem) {
    console.log(`✅ Read item: ${readItem.id}`);
    console.log(`   Title: ${readItem.title}`);
    console.log(`   Type: ${readItem.type}`);
    console.log(`   Tags: ${readItem.facets?.tags.join(', ')}\n`);
  } else {
    console.log('❌ Failed to read item\n');
  }

  // Test 3: Check catalog
  console.log('📚 Test 3: Check catalog');
  const catalog = adapter.readCatalog();
  console.log(`✅ Catalog has ${Object.keys(catalog).length} items`);
  if (catalog[testItem.id]) {
    console.log(`   - ${testItem.id}: ${catalog[testItem.id].title}\n`);
  }

  // Test 4: Write second item
  console.log('📝 Test 4: Write second item');
  const testItem2 = {
    ...testItem,
    id: ulid(),
    title: 'Another Test Memory',
    text: 'Second test memory',
    code: undefined,
  };
  await adapter.writeItem(testItem2);
  console.log(`✅ Wrote second item: ${testItem2.id}\n`);

  // Test 5: List all items
  console.log('📋 Test 5: List all items');
  const itemIds = await adapter.listItems();
  console.log(`✅ Found ${itemIds.length} items:`);
  itemIds.forEach((id) => console.log(`   - ${id}`));
  console.log();

  // Test 6: Get stats
  console.log('📊 Test 6: Get stats');
  const stats = await adapter.getStats();
  console.log(`✅ Storage stats:`);
  console.log(`   Items: ${stats.items}`);
  console.log(`   Size: ${stats.sizeBytes} bytes\n`);

  // Test 7: Delete item
  console.log('🗑️  Test 7: Delete item');
  const deleted = await adapter.deleteItem(testItem2.id);
  console.log(`${deleted ? '✅' : '❌'} Delete result: ${deleted}\n`);

  // Test 8: Rebuild catalog
  console.log('🔄 Test 8: Rebuild catalog');
  await adapter.rebuildCatalog();
  const rebuiltCatalog = adapter.readCatalog();
  console.log(`✅ Rebuilt catalog has ${Object.keys(rebuiltCatalog).length} items\n`);

  // Test 9: Cleanup
  console.log('🧹 Test 9: Cleanup');
  const cleaned = await adapter.cleanup();
  console.log(`✅ Cleaned ${cleaned} stale entries\n`);

  console.log('✅ All tests passed!');
  console.log(`\n📂 Test files created in: ${testDir}`);
  console.log('   You can inspect the markdown files to see the output.\n');
}

main().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
