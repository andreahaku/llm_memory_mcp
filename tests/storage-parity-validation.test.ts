import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { VideoStorageAdapter } from '../src/storage/VideoStorageAdapter.js';
import { FileStorageAdapter } from '../src/storage/FileStorageAdapter.js';
import type { MemoryItem, MemoryScope, MemoryItemSummary } from '../src/types/Memory.js';
import { ulid } from '../src/util/ulid.js';

/**
 * Comprehensive Feature Parity Validation Test Suite
 *
 * This test suite validates complete feature parity between VideoStorageAdapter
 * and FileStorageAdapter, ensuring identical behavior across all operations.
 */

interface TestContext {
  videoAdapter: VideoStorageAdapter;
  fileAdapter: FileStorageAdapter;
  videoDir: string;
  fileDir: string;
  testItems: MemoryItem[];
}

describe('Storage Adapter Feature Parity Validation', () => {
  let context: TestContext;

  beforeEach(async () => {
    // Setup test directories
    const baseDir = path.join(process.cwd(), 'test-temp', `parity-test-${Date.now()}`);
    const videoDir = path.join(baseDir, 'video');
    const fileDir = path.join(baseDir, 'file');

    await fs.ensureDir(videoDir);
    await fs.ensureDir(fileDir);

    // Initialize adapters
    const videoAdapter = new VideoStorageAdapter(videoDir, 'local' as MemoryScope);
    const fileAdapter = new FileStorageAdapter(fileDir);

    // Generate comprehensive test data
    const testItems = generateTestMemoryItems(50);

    context = {
      videoAdapter,
      fileAdapter,
      videoDir,
      fileDir,
      testItems
    };

    // Wait for video adapter initialization
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  afterEach(async () => {
    try {
      if (context?.videoDir && await fs.pathExists(context.videoDir)) {
        await fs.remove(path.dirname(context.videoDir));
      }
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  });

  describe('CRUD Operations Parity', () => {
    it('should write items identically to both adapters', async () => {
      const testItem = context.testItems[0];

      // Write to both adapters
      await context.videoAdapter.writeItem(testItem);
      await context.fileAdapter.writeItem(testItem);

      // Verify both adapters have the item
      const videoItem = await context.videoAdapter.readItem(testItem.id);
      const fileItem = await context.fileAdapter.readItem(testItem.id);

      expect(videoItem).toBeTruthy();
      expect(fileItem).toBeTruthy();
      expect(normalizeItem(videoItem!)).toEqual(normalizeItem(fileItem!));
    });

    it('should handle batch writes consistently', async () => {
      const batchItems = context.testItems.slice(0, 10);

      // Batch write to both adapters
      await context.videoAdapter.writeBatch(batchItems);
      await context.fileAdapter.writeBatch(batchItems);

      // Wait for video processing
      await waitForVideoProcessing(context.videoAdapter);

      // Verify all items in both adapters
      for (const item of batchItems) {
        const videoItem = await context.videoAdapter.readItem(item.id);
        const fileItem = await context.fileAdapter.readItem(item.id);

        expect(normalizeItem(videoItem!)).toEqual(normalizeItem(fileItem!));
      }
    });

    it('should read single items identically', async () => {
      const testItem = context.testItems[0];

      // Write to both adapters
      await context.videoAdapter.writeItem(testItem);
      await context.fileAdapter.writeItem(testItem);
      await waitForVideoProcessing(context.videoAdapter);

      // Read from both adapters
      const videoItem = await context.videoAdapter.readItem(testItem.id);
      const fileItem = await context.fileAdapter.readItem(testItem.id);

      expect(normalizeItem(videoItem!)).toEqual(normalizeItem(fileItem!));
    });

    it('should read multiple items consistently', async () => {
      const batchItems = context.testItems.slice(0, 5);
      const itemIds = batchItems.map(item => item.id);

      // Write to both adapters
      await context.videoAdapter.writeBatch(batchItems);
      await context.fileAdapter.writeBatch(batchItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Read from both adapters
      const videoItems = await context.videoAdapter.readItems(itemIds);
      const fileItems = await context.fileAdapter.readItems(itemIds);

      expect(videoItems.length).toBe(fileItems.length);

      // Sort items by ID for comparison
      const sortedVideoItems = videoItems.sort((a, b) => a.id.localeCompare(b.id));
      const sortedFileItems = fileItems.sort((a, b) => a.id.localeCompare(b.id));

      for (let i = 0; i < sortedVideoItems.length; i++) {
        expect(normalizeItem(sortedVideoItems[i])).toEqual(normalizeItem(sortedFileItems[i]));
      }
    });

    it('should delete items consistently', async () => {
      const testItem = context.testItems[0];

      // Write to both adapters
      await context.videoAdapter.writeItem(testItem);
      await context.fileAdapter.writeItem(testItem);
      await waitForVideoProcessing(context.videoAdapter);

      // Delete from both adapters
      const videoDeleted = await context.videoAdapter.deleteItem(testItem.id);
      const fileDeleted = await context.fileAdapter.deleteItem(testItem.id);

      expect(videoDeleted).toBe(fileDeleted);
      expect(videoDeleted).toBe(true);

      // Verify items are deleted
      const videoItem = await context.videoAdapter.readItem(testItem.id);
      const fileItem = await context.fileAdapter.readItem(testItem.id);

      expect(videoItem).toBeNull();
      expect(fileItem).toBeNull();
    });

    it('should handle batch deletes consistently', async () => {
      const batchItems = context.testItems.slice(0, 5);
      const itemIds = batchItems.map(item => item.id);

      // Write to both adapters
      await context.videoAdapter.writeBatch(batchItems);
      await context.fileAdapter.writeBatch(batchItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Delete from both adapters
      const videoResults = await context.videoAdapter.deleteBatch(itemIds);
      const fileResults = await context.fileAdapter.deleteBatch(itemIds);

      expect(videoResults).toEqual(fileResults);
      expect(videoResults.every(result => result)).toBe(true);

      // Verify all items are deleted
      for (const id of itemIds) {
        const videoItem = await context.videoAdapter.readItem(id);
        const fileItem = await context.fileAdapter.readItem(id);

        expect(videoItem).toBeNull();
        expect(fileItem).toBeNull();
      }
    });
  });

  describe('Catalog Operations Parity', () => {
    it('should maintain identical catalogs', async () => {
      const batchItems = context.testItems.slice(0, 10);

      // Write to both adapters
      await context.videoAdapter.writeBatch(batchItems);
      await context.fileAdapter.writeBatch(batchItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Get catalogs from both adapters
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      expect(Object.keys(videoCatalog).length).toBe(Object.keys(fileCatalog).length);

      // Compare each catalog entry (ignoring video-specific fields)
      for (const [id, videoSummary] of Object.entries(videoCatalog)) {
        const fileSummary = fileCatalog[id];
        expect(fileSummary).toBeTruthy();
        expect(normalizeSummary(videoSummary)).toEqual(normalizeSummary(fileSummary));
      }
    });

    it('should rebuild catalogs consistently', async () => {
      const batchItems = context.testItems.slice(0, 5);

      // Write to both adapters
      await context.videoAdapter.writeBatch(batchItems);
      await context.fileAdapter.writeBatch(batchItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Clear catalogs
      context.videoAdapter.setCatalog({});
      context.fileAdapter.setCatalog({});

      // Rebuild catalogs
      await context.videoAdapter.rebuildCatalog();
      await context.fileAdapter.rebuildCatalog();

      // Compare rebuilt catalogs
      const videoCatalog = context.videoAdapter.readCatalog();
      const fileCatalog = context.fileAdapter.readCatalog();

      expect(Object.keys(videoCatalog).length).toBe(Object.keys(fileCatalog).length);

      for (const [id, videoSummary] of Object.entries(videoCatalog)) {
        const fileSummary = fileCatalog[id];
        expect(normalizeSummary(videoSummary)).toEqual(normalizeSummary(fileSummary));
      }
    });
  });

  describe('Configuration Management Parity', () => {
    it('should handle config read/write consistently', async () => {
      const testConfig = {
        version: '1.0.0',
        storage: { backend: 'test' },
        features: { vectorSearch: true }
      };

      // Write config to both adapters
      context.videoAdapter.writeConfig(testConfig);
      context.fileAdapter.writeConfig(testConfig);

      // Read config from both adapters
      const videoConfig = context.videoAdapter.readConfig();
      const fileConfig = context.fileAdapter.readConfig();

      expect(videoConfig).toEqual(fileConfig);
      expect(videoConfig?.storage?.backend).toBeDefined();
    });
  });

  describe('Statistics and Maintenance Parity', () => {
    it('should provide consistent item counts in stats', async () => {
      const batchItems = context.testItems.slice(0, 10);

      // Write to both adapters
      await context.videoAdapter.writeBatch(batchItems);
      await context.fileAdapter.writeBatch(batchItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Get stats from both adapters
      const videoStats = await context.videoAdapter.getStats();
      const fileStats = await context.fileAdapter.getStats();

      expect(videoStats.items).toBe(fileStats.items);
      expect(videoStats.items).toBe(batchItems.length);
    });

    it('should handle cleanup operations', async () => {
      const batchItems = context.testItems.slice(0, 5);

      // Write to both adapters
      await context.videoAdapter.writeBatch(batchItems);
      await context.fileAdapter.writeBatch(batchItems);
      await waitForVideoProcessing(context.videoAdapter);

      // Perform cleanup
      const videoCleanupResult = await context.videoAdapter.cleanup();
      const fileCleanupResult = await context.fileAdapter.cleanup();

      // Both should complete without errors
      expect(typeof videoCleanupResult).toBe('number');
      expect(typeof fileCleanupResult).toBe('number');
    });
  });

  describe('Error Handling Parity', () => {
    it('should handle non-existent item reads consistently', async () => {
      const nonExistentId = ulid();

      const videoItem = await context.videoAdapter.readItem(nonExistentId);
      const fileItem = await context.fileAdapter.readItem(nonExistentId);

      expect(videoItem).toBeNull();
      expect(fileItem).toBeNull();
    });

    it('should handle deletes of non-existent items consistently', async () => {
      const nonExistentId = ulid();

      const videoResult = await context.videoAdapter.deleteItem(nonExistentId);
      const fileResult = await context.fileAdapter.deleteItem(nonExistentId);

      expect(videoResult).toBe(fileResult);
      expect(videoResult).toBe(false);
    });

    it('should handle empty batch operations consistently', async () => {
      await context.videoAdapter.writeBatch([]);
      await context.fileAdapter.writeBatch([]);

      const videoResults = await context.videoAdapter.deleteBatch([]);
      const fileResults = await context.fileAdapter.deleteBatch([]);

      expect(videoResults).toEqual(fileResults);
      expect(videoResults).toEqual([]);
    });
  });

  describe('Data Integrity Validation', () => {
    it('should preserve all item fields through write/read cycles', async () => {
      const complexItem = createComplexMemoryItem();

      // Write to both adapters
      await context.videoAdapter.writeItem(complexItem);
      await context.fileAdapter.writeItem(complexItem);
      await waitForVideoProcessing(context.videoAdapter);

      // Read from both adapters
      const videoItem = await context.videoAdapter.readItem(complexItem.id);
      const fileItem = await context.fileAdapter.readItem(complexItem.id);

      // Verify all fields are preserved
      expect(normalizeItem(videoItem!)).toEqual(normalizeItem(fileItem!));
      expect(normalizeItem(videoItem!)).toEqual(normalizeItem(complexItem));
    });

    it('should handle special characters and large content', async () => {
      const specialItem: MemoryItem = {
        id: ulid(),
        type: 'snippet',
        scope: 'local',
        title: 'Special Characters Test: 你好 🌟 <>&"\'',
        text: 'Large content: ' + 'A'.repeat(10000) + '\n\nSpecial: 🚀 💻 ⚡',
        code: 'function test() {\n  return "unicode: 你好世界";\n}',
        facets: {
          tags: ['unicode-test', 'large-content', '特殊字符'],
          files: ['test.js', 'unicode-file-名前.ts'],
          symbols: ['test()', 'unicode_var', '特殊_函数']
        },
        quality: {
          confidence: 0.95,
          pinned: true,
          reuseCount: 5
        },
        security: { sensitivity: 'public' },
        context: {
          specialChars: '!@#$%^&*()[]{}|;:,.<>?',
          unicode: '你好世界🌍'
        },
        links: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      };

      // Write to both adapters
      await context.videoAdapter.writeItem(specialItem);
      await context.fileAdapter.writeItem(specialItem);
      await waitForVideoProcessing(context.videoAdapter);

      // Read from both adapters
      const videoItem = await context.videoAdapter.readItem(specialItem.id);
      const fileItem = await context.fileAdapter.readItem(specialItem.id);

      expect(normalizeItem(videoItem!)).toEqual(normalizeItem(fileItem!));
      expect(videoItem!.text).toContain('特殊字符');
      expect(fileItem!.text).toContain('特殊字符');
    });

    it('should handle item updates consistently', async () => {
      const originalItem = context.testItems[0];

      // Write original to both adapters
      await context.videoAdapter.writeItem(originalItem);
      await context.fileAdapter.writeItem(originalItem);
      await waitForVideoProcessing(context.videoAdapter);

      // Create updated version
      const updatedItem: MemoryItem = {
        ...originalItem,
        title: 'Updated: ' + originalItem.title,
        text: 'Updated: ' + originalItem.text,
        quality: {
          ...originalItem.quality,
          reuseCount: (originalItem.quality?.reuseCount || 0) + 1
        },
        updatedAt: new Date().toISOString(),
        version: (originalItem.version || 1) + 1
      };

      // Write updates to both adapters
      await context.videoAdapter.writeItem(updatedItem);
      await context.fileAdapter.writeItem(updatedItem);
      await waitForVideoProcessing(context.videoAdapter);

      // Read updated items
      const videoItem = await context.videoAdapter.readItem(originalItem.id);
      const fileItem = await context.fileAdapter.readItem(originalItem.id);

      expect(normalizeItem(videoItem!)).toEqual(normalizeItem(fileItem!));
      expect(videoItem!.title).toContain('Updated:');
      expect(fileItem!.title).toContain('Updated:');
    });
  });
});

// Utility functions

function generateTestMemoryItems(count: number): MemoryItem[] {
  const items: MemoryItem[] = [];
  const types = ['snippet', 'pattern', 'insight', 'fact', 'note'] as const;

  for (let i = 0; i < count; i++) {
    const item: MemoryItem = {
      id: ulid(),
      type: types[i % types.length],
      scope: 'local',
      title: `Test Item ${i + 1}: Feature Parity Validation`,
      text: `This is test content for item ${i + 1}. ` +
            `It contains various patterns and information for testing storage adapter parity. ` +
            `Item index: ${i}, timestamp: ${Date.now()}`,
      code: i % 3 === 0 ? `function testItem${i}() {\n  return ${i};\n}` : undefined,
      facets: {
        tags: [`test-${i % 5}`, 'parity-validation', `group-${Math.floor(i / 10)}`],
        files: i % 4 === 0 ? [`test-${i}.js`, `utils-${i}.ts`] : [],
        symbols: i % 2 === 0 ? [`testItem${i}`, `constant_${i}`] : []
      },
      quality: {
        confidence: 0.5 + (i % 5) * 0.1,
        pinned: i % 7 === 0,
        reuseCount: i % 3,
        helpfulCount: i % 2,
        notHelpfulCount: 0
      },
      security: { sensitivity: i % 3 === 0 ? 'public' : 'private' },
      context: {
        testIndex: i,
        category: `category-${i % 5}`,
        metadata: { generated: true, purpose: 'parity-testing' }
      },
      links: [],
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      updatedAt: new Date(Date.now() - i * 500).toISOString(),
      version: 1
    };

    items.push(item);
  }

  return items;
}

function createComplexMemoryItem(): MemoryItem {
  return {
    id: ulid(),
    type: 'pattern',
    scope: 'local',
    title: 'Complex Pattern: Advanced Testing Scenario',
    text: 'This is a comprehensive test item with all possible fields populated.\n\n' +
          'It includes:\n' +
          '- Multiple paragraphs\n' +
          '- Special characters: !@#$%^&*()\n' +
          '- Unicode content: 你好世界 🌍\n' +
          '- Code references: processData(), handleRequest()\n' +
          '- Nested structures and complex data',
    code: 'interface ComplexInterface {\n' +
          '  id: string;\n' +
          '  data: {\n' +
          '    values: number[];\n' +
          '    metadata: Record<string, any>;\n' +
          '  };\n' +
          '  process(): Promise<void>;\n' +
          '}',
    facets: {
      tags: ['complex', 'interface', 'typescript', 'testing', 'comprehensive'],
      files: ['complex.ts', 'interfaces.d.ts', 'utils/helper.js'],
      symbols: ['ComplexInterface', 'processData', 'handleRequest', 'validateInput']
    },
    quality: {
      confidence: 0.85,
      pinned: true,
      reuseCount: 15,
      helpfulCount: 8,
      notHelpfulCount: 1,
      ttlDays: 30,
      lastAccessedAt: new Date().toISOString(),
      lastUsedAt: new Date(Date.now() - 86400000).toISOString()
    },
    security: {
      sensitivity: 'team',
      accessLevel: 'developer'
    },
    context: {
      project: 'parity-testing',
      module: 'storage-validation',
      complexity: 'high',
      nested: {
        deep: {
          value: 'test-value',
          array: [1, 2, 3, 'test'],
          boolean: true
        }
      }
    },
    links: [
      { type: 'relates', targetId: 'related-item-1' },
      { type: 'depends', targetId: 'dependency-item' }
    ],
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    version: 3
  };
}

async function waitForVideoProcessing(adapter: VideoStorageAdapter): Promise<void> {
  const startTime = Date.now();
  const timeout = 30000; // 30 seconds

  while (Date.now() - startTime < timeout) {
    try {
      const metrics = await (adapter as any).getVideoStorageMetrics();
      if (metrics.queueLength === 0 && !metrics.isEncoding) {
        // Additional wait to ensure processing is complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        return;
      }
    } catch (error) {
      // If metrics aren't available, just wait a bit longer
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.warn('Video processing did not complete within timeout');
}

function normalizeItem(item: MemoryItem): any {
  // Create a normalized version for comparison, excluding timestamp-sensitive fields
  const normalized = {
    ...item,
    // Normalize timestamps to avoid comparison issues
    createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : undefined,
    updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : undefined,
    // Ensure consistent structure
    facets: {
      tags: item.facets?.tags?.sort() || [],
      files: item.facets?.files?.sort() || [],
      symbols: item.facets?.symbols?.sort() || []
    },
    quality: {
      confidence: item.quality?.confidence ?? 0.5,
      pinned: item.quality?.pinned ?? false,
      reuseCount: item.quality?.reuseCount ?? 0,
      helpfulCount: item.quality?.helpfulCount ?? 0,
      notHelpfulCount: item.quality?.notHelpfulCount ?? 0,
      ...item.quality
    },
    security: item.security || { sensitivity: 'private' },
    context: item.context || {},
    links: item.links || []
  };

  return normalized;
}

function normalizeSummary(summary: MemoryItemSummary): any {
  // Create a normalized version for comparison, excluding video-specific fields
  const normalized = {
    id: summary.id,
    type: summary.type,
    scope: summary.scope,
    title: summary.title,
    tags: summary.tags?.sort() || [],
    files: summary.files?.sort() || [],
    symbols: summary.symbols?.sort() || [],
    confidence: summary.confidence,
    pinned: summary.pinned,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt
  };

  return normalized;
}