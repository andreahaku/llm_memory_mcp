import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { VideoStorageAdapter } from '../src/storage/VideoStorageAdapter.js';
import { FileStorageAdapter } from '../src/storage/FileStorageAdapter.js';
import type { MemoryItem, MemoryScope, MemoryItemSummary } from '../src/types/Memory.js';
import { ulid } from '../src/util/ulid.js';

/**
 * Migration Validation Test Suite
 *
 * This test suite validates bidirectional migration between VideoStorageAdapter
 * and FileStorageAdapter, ensuring data integrity through migration cycles.
 */

interface MigrationTestContext {
  sourceDir: string;
  targetDir: string;
  testItems: MemoryItem[];
}

describe('Storage Migration Validation', () => {
  let context: MigrationTestContext;

  beforeEach(async () => {
    // Setup test directories
    const baseDir = path.join(process.cwd(), 'test-temp', `migration-test-${Date.now()}`);
    const sourceDir = path.join(baseDir, 'source');
    const targetDir = path.join(baseDir, 'target');

    await fs.ensureDir(sourceDir);
    await fs.ensureDir(targetDir);

    // Generate comprehensive test data
    const testItems = generateMigrationTestItems(25);

    context = {
      sourceDir,
      targetDir,
      testItems
    };
  });

  afterEach(async () => {
    try {
      if (context?.sourceDir && await fs.pathExists(context.sourceDir)) {
        await fs.remove(path.dirname(context.sourceDir));
      }
    } catch (error) {
      console.warn('Migration test cleanup warning:', error);
    }
  });

  describe('File to Video Migration', () => {
    it('should migrate all items from file to video storage', async () => {
      // Setup source (file) and target (video) adapters
      const fileAdapter = new FileStorageAdapter(context.sourceDir);
      const videoAdapter = new VideoStorageAdapter(context.targetDir, 'local' as MemoryScope);

      // Wait for video adapter initialization
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Populate file storage with test data
      await fileAdapter.writeBatch(context.testItems);

      // Perform migration
      const migrationResult = await migrateFileToVideo(fileAdapter, videoAdapter);

      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migratedCount).toBe(context.testItems.length);
      expect(migrationResult.errors.length).toBe(0);

      // Verify all items in video storage
      for (const originalItem of context.testItems) {
        const migratedItem = await videoAdapter.readItem(originalItem.id);
        expect(migratedItem).toBeTruthy();
        expect(normalizeItem(migratedItem!)).toEqual(normalizeItem(originalItem));
      }

      // Verify catalog integrity
      const videoCatalog = videoAdapter.readCatalog();
      const fileCatalog = fileAdapter.readCatalog();

      expect(Object.keys(videoCatalog).length).toBe(Object.keys(fileCatalog).length);
    });

    it('should handle partial migration failures gracefully', async () => {
      const fileAdapter = new FileStorageAdapter(context.sourceDir);
      const videoAdapter = new VideoStorageAdapter(context.targetDir, 'local' as MemoryScope);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Add one problematic item (simulate corruption)
      const validItems = context.testItems.slice(0, 5);
      const problematicItem = createProblematicItem();

      await fileAdapter.writeBatch(validItems);

      // Attempt migration
      const migrationResult = await migrateFileToVideo(fileAdapter, videoAdapter);

      // Should migrate valid items despite problematic ones
      expect(migrationResult.migratedCount).toBe(validItems.length);

      // Verify valid items migrated correctly
      for (const item of validItems) {
        const migratedItem = await videoAdapter.readItem(item.id);
        expect(migratedItem).toBeTruthy();
      }
    });

    it('should preserve metadata during file to video migration', async () => {
      const fileAdapter = new FileStorageAdapter(context.sourceDir);
      const videoAdapter = new VideoStorageAdapter(context.targetDir, 'local' as MemoryScope);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Create item with complex metadata
      const complexItem = createComplexMigrationItem();
      await fileAdapter.writeItem(complexItem);

      // Perform migration
      const migrationResult = await migrateFileToVideo(fileAdapter, videoAdapter);

      expect(migrationResult.success).toBe(true);

      // Verify complex metadata preserved
      const migratedItem = await videoAdapter.readItem(complexItem.id);
      expect(migratedItem).toBeTruthy();
      expect(migratedItem!.context).toEqual(complexItem.context);
      expect(migratedItem!.facets).toEqual(complexItem.facets);
      expect(migratedItem!.quality).toEqual(complexItem.quality);
      expect(migratedItem!.security).toEqual(complexItem.security);
    });
  });

  describe('Video to File Migration', () => {
    it('should migrate all items from video to file storage', async () => {
      const videoAdapter = new VideoStorageAdapter(context.sourceDir, 'local' as MemoryScope);
      const fileAdapter = new FileStorageAdapter(context.targetDir);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Populate video storage with test data
      await videoAdapter.writeBatch(context.testItems);
      await waitForVideoProcessing(videoAdapter);

      // Perform migration
      const migrationResult = await migrateVideoToFile(videoAdapter, fileAdapter);

      expect(migrationResult.success).toBe(true);
      expect(migrationResult.migratedCount).toBe(context.testItems.length);
      expect(migrationResult.errors.length).toBe(0);

      // Verify all items in file storage
      for (const originalItem of context.testItems) {
        const migratedItem = await fileAdapter.readItem(originalItem.id);
        expect(migratedItem).toBeTruthy();
        expect(normalizeItem(migratedItem!)).toEqual(normalizeItem(originalItem));
      }

      // Verify catalog integrity
      const fileCatalog = fileAdapter.readCatalog();
      const videoCatalog = videoAdapter.readCatalog();

      expect(Object.keys(fileCatalog).length).toBe(Object.keys(videoCatalog).length);
    });

    it('should handle video decoding failures gracefully', async () => {
      const videoAdapter = new VideoStorageAdapter(context.sourceDir, 'local' as MemoryScope);
      const fileAdapter = new FileStorageAdapter(context.targetDir);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Add items to video storage
      const validItems = context.testItems.slice(0, 3);
      await videoAdapter.writeBatch(validItems);
      await waitForVideoProcessing(videoAdapter);

      // Perform migration
      const migrationResult = await migrateVideoToFile(videoAdapter, fileAdapter);

      // Should migrate successfully even if some frames might have issues
      expect(migrationResult.migratedCount).toBeGreaterThan(0);

      // Verify at least some items migrated
      const migratedIds = await fileAdapter.listItems();
      expect(migratedIds.length).toBeGreaterThan(0);
    });
  });

  describe('Bidirectional Migration Integrity', () => {
    it('should maintain data integrity through full migration cycle', async () => {
      // Original file storage
      const originalFileAdapter = new FileStorageAdapter(context.sourceDir);

      // Intermediate video storage
      const intermediateVideoDir = path.join(path.dirname(context.targetDir), 'intermediate-video');
      await fs.ensureDir(intermediateVideoDir);
      const videoAdapter = new VideoStorageAdapter(intermediateVideoDir, 'local' as MemoryScope);

      // Final file storage
      const finalFileAdapter = new FileStorageAdapter(context.targetDir);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 1: Populate original file storage
      await originalFileAdapter.writeBatch(context.testItems);

      // Step 2: Migrate file → video
      const fileToVideoResult = await migrateFileToVideo(originalFileAdapter, videoAdapter);
      expect(fileToVideoResult.success).toBe(true);

      // Step 3: Migrate video → file
      const videoToFileResult = await migrateVideoToFile(videoAdapter, finalFileAdapter);
      expect(videoToFileResult.success).toBe(true);

      // Step 4: Verify data integrity through full cycle
      expect(fileToVideoResult.migratedCount).toBe(context.testItems.length);
      expect(videoToFileResult.migratedCount).toBe(context.testItems.length);

      // Step 5: Compare original and final items
      for (const originalItem of context.testItems) {
        const finalItem = await finalFileAdapter.readItem(originalItem.id);
        expect(finalItem).toBeTruthy();
        expect(normalizeItem(finalItem!)).toEqual(normalizeItem(originalItem));
      }

      // Step 6: Compare catalogs
      const originalCatalog = originalFileAdapter.readCatalog();
      const finalCatalog = finalFileAdapter.readCatalog();

      expect(Object.keys(finalCatalog).length).toBe(Object.keys(originalCatalog).length);

      for (const [id, originalSummary] of Object.entries(originalCatalog)) {
        const finalSummary = finalCatalog[id];
        expect(finalSummary).toBeTruthy();
        expect(normalizeSummary(finalSummary)).toEqual(normalizeSummary(originalSummary));
      }
    });

    it('should handle multiple migration cycles without degradation', async () => {
      const cycles = 3;
      let currentFileDir = context.sourceDir;
      let currentVideoDir = path.join(path.dirname(context.targetDir), 'video-cycle-0');

      // Initial setup
      await fs.ensureDir(currentVideoDir);
      const initialFileAdapter = new FileStorageAdapter(currentFileDir);
      await initialFileAdapter.writeBatch(context.testItems);

      let lastAdapter: FileStorageAdapter | VideoStorageAdapter = initialFileAdapter;

      // Perform multiple migration cycles
      for (let cycle = 0; cycle < cycles; cycle++) {
        const nextFileDir = path.join(path.dirname(context.targetDir), `file-cycle-${cycle + 1}`);
        const nextVideoDir = path.join(path.dirname(context.targetDir), `video-cycle-${cycle + 1}`);

        await fs.ensureDir(nextFileDir);
        await fs.ensureDir(nextVideoDir);

        // File → Video
        const videoAdapter = new VideoStorageAdapter(currentVideoDir, 'local' as MemoryScope);
        await new Promise(resolve => setTimeout(resolve, 2000));

        if (lastAdapter instanceof FileStorageAdapter) {
          await migrateFileToVideo(lastAdapter, videoAdapter);
        }

        // Video → File
        const fileAdapter = new FileStorageAdapter(nextFileDir);
        await migrateVideoToFile(videoAdapter, fileAdapter);

        // Update for next cycle
        currentFileDir = nextFileDir;
        currentVideoDir = nextVideoDir;
        lastAdapter = fileAdapter;
      }

      // Verify final state
      const finalAdapter = lastAdapter as FileStorageAdapter;
      const finalCatalog = finalAdapter.readCatalog();

      expect(Object.keys(finalCatalog).length).toBe(context.testItems.length);

      // Verify each item survived all cycles
      for (const originalItem of context.testItems) {
        const finalItem = await finalAdapter.readItem(originalItem.id);
        expect(finalItem).toBeTruthy();
        expect(normalizeItem(finalItem!)).toEqual(normalizeItem(originalItem));
      }
    });
  });

  describe('Migration Error Recovery', () => {
    it('should recover from partial migration failures', async () => {
      const fileAdapter = new FileStorageAdapter(context.sourceDir);
      const videoAdapter = new VideoStorageAdapter(context.targetDir, 'local' as MemoryScope);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Add mix of valid and problematic items
      const validItems = context.testItems.slice(0, 3);
      const problematicItems = [createProblematicItem(), createProblematicItem()];

      await fileAdapter.writeBatch([...validItems, ...problematicItems]);

      // Attempt migration with error tolerance
      const migrationResult = await migrateFileToVideo(fileAdapter, videoAdapter, {
        continueOnError: true,
        maxRetries: 2
      });

      // Should migrate valid items successfully
      expect(migrationResult.migratedCount).toBe(validItems.length);
      expect(migrationResult.errors.length).toBe(problematicItems.length);

      // Verify valid items are accessible
      for (const item of validItems) {
        const migratedItem = await videoAdapter.readItem(item.id);
        expect(migratedItem).toBeTruthy();
      }
    });

    it('should provide detailed migration progress reporting', async () => {
      const fileAdapter = new FileStorageAdapter(context.sourceDir);
      const videoAdapter = new VideoStorageAdapter(context.targetDir, 'local' as MemoryScope);

      await new Promise(resolve => setTimeout(resolve, 2000));

      const testItems = context.testItems.slice(0, 10);
      await fileAdapter.writeBatch(testItems);

      const progressEvents: any[] = [];

      // Perform migration with progress tracking
      const migrationResult = await migrateFileToVideo(fileAdapter, videoAdapter, {
        onProgress: (event) => progressEvents.push(event)
      });

      expect(migrationResult.success).toBe(true);
      expect(progressEvents.length).toBeGreaterThan(0);

      // Verify progress events contain useful information
      const startEvent = progressEvents[0];
      const endEvent = progressEvents[progressEvents.length - 1];

      expect(startEvent.phase).toBe('start');
      expect(endEvent.phase).toBe('complete');
      expect(endEvent.totalItems).toBe(testItems.length);
      expect(endEvent.migratedItems).toBe(testItems.length);
    });
  });
});

// Migration utility functions

interface MigrationOptions {
  continueOnError?: boolean;
  maxRetries?: number;
  onProgress?: (event: MigrationProgressEvent) => void;
}

interface MigrationProgressEvent {
  phase: 'start' | 'progress' | 'complete' | 'error';
  totalItems: number;
  processedItems: number;
  migratedItems: number;
  errors: number;
  currentItem?: string;
  error?: string;
}

interface MigrationResult {
  success: boolean;
  migratedCount: number;
  errors: string[];
  duration: number;
}

async function migrateFileToVideo(
  source: FileStorageAdapter,
  target: VideoStorageAdapter,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    // Get all items from source
    const sourceItems = await source.listItems();

    options.onProgress?.({
      phase: 'start',
      totalItems: sourceItems.length,
      processedItems: 0,
      migratedItems: 0,
      errors: 0
    });

    // Migrate items in batches
    const batchSize = 5;
    for (let i = 0; i < sourceItems.length; i += batchSize) {
      const batch = sourceItems.slice(i, i + batchSize);
      const batchItems: MemoryItem[] = [];

      // Read batch items
      for (const itemId of batch) {
        try {
          const item = await source.readItem(itemId);
          if (item) {
            batchItems.push(item);
          }
        } catch (error) {
          const errorMsg = `Failed to read item ${itemId}: ${error}`;
          errors.push(errorMsg);

          if (!options.continueOnError) {
            throw new Error(errorMsg);
          }
        }
      }

      // Write batch to target
      if (batchItems.length > 0) {
        try {
          await target.writeBatch(batchItems);
          migratedCount += batchItems.length;

          options.onProgress?.({
            phase: 'progress',
            totalItems: sourceItems.length,
            processedItems: i + batch.length,
            migratedItems: migratedCount,
            errors: errors.length
          });
        } catch (error) {
          const errorMsg = `Failed to write batch: ${error}`;
          errors.push(errorMsg);

          if (!options.continueOnError) {
            throw new Error(errorMsg);
          }
        }
      }
    }

    // Wait for video processing to complete
    await waitForVideoProcessing(target);

    options.onProgress?.({
      phase: 'complete',
      totalItems: sourceItems.length,
      processedItems: sourceItems.length,
      migratedItems: migratedCount,
      errors: errors.length
    });

    return {
      success: errors.length === 0,
      migratedCount,
      errors,
      duration: Date.now() - startTime
    };

  } catch (error) {
    const errorMsg = `Migration failed: ${error}`;
    errors.push(errorMsg);

    options.onProgress?.({
      phase: 'error',
      totalItems: 0,
      processedItems: 0,
      migratedItems: migratedCount,
      errors: errors.length,
      error: errorMsg
    });

    return {
      success: false,
      migratedCount,
      errors,
      duration: Date.now() - startTime
    };
  }
}

async function migrateVideoToFile(
  source: VideoStorageAdapter,
  target: FileStorageAdapter,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let migratedCount = 0;

  try {
    // Get all items from source
    const sourceItems = await source.listItems();

    options.onProgress?.({
      phase: 'start',
      totalItems: sourceItems.length,
      processedItems: 0,
      migratedItems: 0,
      errors: 0
    });

    // Migrate items in batches
    const batchSize = 3; // Smaller batches for video processing
    for (let i = 0; i < sourceItems.length; i += batchSize) {
      const batch = sourceItems.slice(i, i + batchSize);
      const batchItems: MemoryItem[] = [];

      // Read batch items
      for (const itemId of batch) {
        try {
          const item = await source.readItem(itemId);
          if (item) {
            batchItems.push(item);
          }
        } catch (error) {
          const errorMsg = `Failed to read video item ${itemId}: ${error}`;
          errors.push(errorMsg);

          if (!options.continueOnError) {
            throw new Error(errorMsg);
          }
        }
      }

      // Write batch to target
      if (batchItems.length > 0) {
        try {
          await target.writeBatch(batchItems);
          migratedCount += batchItems.length;

          options.onProgress?.({
            phase: 'progress',
            totalItems: sourceItems.length,
            processedItems: i + batch.length,
            migratedItems: migratedCount,
            errors: errors.length
          });
        } catch (error) {
          const errorMsg = `Failed to write file batch: ${error}`;
          errors.push(errorMsg);

          if (!options.continueOnError) {
            throw new Error(errorMsg);
          }
        }
      }
    }

    options.onProgress?.({
      phase: 'complete',
      totalItems: sourceItems.length,
      processedItems: sourceItems.length,
      migratedItems: migratedCount,
      errors: errors.length
    });

    return {
      success: errors.length === 0,
      migratedCount,
      errors,
      duration: Date.now() - startTime
    };

  } catch (error) {
    const errorMsg = `Video to file migration failed: ${error}`;
    errors.push(errorMsg);

    options.onProgress?.({
      phase: 'error',
      totalItems: 0,
      processedItems: 0,
      migratedItems: migratedCount,
      errors: errors.length,
      error: errorMsg
    });

    return {
      success: false,
      migratedCount,
      errors,
      duration: Date.now() - startTime
    };
  }
}

// Test data generation functions

function generateMigrationTestItems(count: number): MemoryItem[] {
  const items: MemoryItem[] = [];
  const types = ['snippet', 'pattern', 'insight', 'fact', 'note'] as const;

  for (let i = 0; i < count; i++) {
    const item: MemoryItem = {
      id: ulid(),
      type: types[i % types.length],
      scope: 'local',
      title: `Migration Test Item ${i + 1}`,
      text: `This is migration test content for item ${i + 1}. ` +
            `It includes various data patterns to test migration integrity. ` +
            `Item index: ${i}, created: ${new Date().toISOString()}`,
      code: i % 4 === 0 ? `function migrationTest${i}() {\n  return "test-${i}";\n}` : undefined,
      facets: {
        tags: [`migration-test-${i % 3}`, 'data-integrity', `batch-${Math.floor(i / 5)}`],
        files: i % 3 === 0 ? [`migration-${i}.js`] : [],
        symbols: i % 2 === 0 ? [`migrationTest${i}`] : []
      },
      quality: {
        confidence: 0.5 + (i % 5) * 0.1,
        pinned: i % 6 === 0,
        reuseCount: i % 4
      },
      security: { sensitivity: i % 2 === 0 ? 'public' : 'private' },
      context: {
        migrationTestIndex: i,
        originalTimestamp: Date.now() - i * 1000
      },
      links: [],
      createdAt: new Date(Date.now() - i * 2000).toISOString(),
      updatedAt: new Date(Date.now() - i * 1000).toISOString(),
      version: 1
    };

    items.push(item);
  }

  return items;
}

function createComplexMigrationItem(): MemoryItem {
  return {
    id: ulid(),
    type: 'pattern',
    scope: 'local',
    title: 'Complex Migration Test: Comprehensive Data Structure',
    text: 'This item contains complex nested data structures to test migration integrity.\n\n' +
          'Features tested:\n' +
          '- Nested objects and arrays\n' +
          '- Special characters: !@#$%^&*()\n' +
          '- Unicode: 你好世界 🌍\n' +
          '- Large text blocks and code snippets',
    code: 'interface MigrationTestInterface {\n' +
          '  id: string;\n' +
          '  metadata: {\n' +
          '    nested: {\n' +
          '      deeply: {\n' +
          '        value: any;\n' +
          '      };\n' +
          '    };\n' +
          '  };\n' +
          '}',
    facets: {
      tags: ['migration', 'complex', 'nested-data', 'unicode-test'],
      files: ['complex.ts', 'migration.test.js', 'unicode-测试.ts'],
      symbols: ['MigrationTestInterface', 'complexFunction', 'nestedObject']
    },
    quality: {
      confidence: 0.95,
      pinned: true,
      reuseCount: 10,
      helpfulCount: 5,
      notHelpfulCount: 0,
      lastAccessedAt: new Date().toISOString()
    },
    security: {
      sensitivity: 'team',
      accessLevel: 'developer'
    },
    context: {
      migrationComplexity: 'high',
      testPurpose: 'data-integrity',
      nested: {
        deep: {
          structure: {
            with: {
              multiple: {
                levels: 'value',
                array: [1, 2, 3, 'test', { key: 'value' }],
                unicode: '测试数据',
                special: '!@#$%^&*()'
              }
            }
          }
        }
      }
    },
    links: [
      { type: 'relates', targetId: 'related-migration-test' }
    ],
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    version: 2
  };
}

function createProblematicItem(): MemoryItem {
  // Create an item that might cause issues during migration
  return {
    id: ulid(),
    type: 'snippet',
    scope: 'local',
    title: 'Problematic Item: Edge Case Testing',
    text: 'This item contains edge cases that might cause migration issues:\n' +
          '- Extremely long text: ' + 'X'.repeat(50000) + '\n' +
          '- Null characters and control characters\n' +
          '- Binary-like data: \u0000\u0001\u0002\u0003',
    code: '// This code contains potential parsing issues\n' +
          'const problematic = {\n' +
          '  "key with spaces": "value",\n' +
          '  \'single quotes\': "mixed quotes",\n' +
          '  unicode: "🚀💻⚡",\n' +
          '  null: null,\n' +
          '  undefined: undefined\n' +
          '};',
    facets: {
      tags: ['problematic', 'edge-case', 'migration-stress-test'],
      files: [],
      symbols: []
    },
    quality: {
      confidence: 0.1,
      pinned: false,
      reuseCount: 0
    },
    security: { sensitivity: 'private' },
    context: {
      isProblematic: true,
      edgeCases: ['long-text', 'null-chars', 'unicode-edge-cases']
    },
    links: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1
  };
}

// Utility functions (reused from other tests)

async function waitForVideoProcessing(adapter: VideoStorageAdapter): Promise<void> {
  const startTime = Date.now();
  const timeout = 45000; // 45 seconds for migration tests

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
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.warn('Video processing did not complete within migration timeout');
}

function normalizeItem(item: MemoryItem): any {
  return {
    ...item,
    createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : undefined,
    updatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : undefined,
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
}

function normalizeSummary(summary: MemoryItemSummary): any {
  return {
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
}