#!/usr/bin/env node

/**
 * Analyze the specific compression scenario to understand the 1,090 bytes result
 */

import { QRManager } from './dist/src/qr/QRManager.js';
import * as zlib from 'zlib';

function createMemoryItemLikeContent(targetOriginalSize) {
  // Create a realistic memory item structure that might compress to ~1090 bytes
  const memoryItem = {
    id: 'test-memory-item-' + Date.now(),
    type: 'snippet',
    scope: 'local',
    title: 'Large code snippet with documentation',
    text: `This is a comprehensive documentation for a complex system component. It includes detailed explanations, examples, and best practices. `.repeat(50),
    code: `
// Complex TypeScript class with multiple methods
export class VideoStorageAdapter implements StorageAdapter {
  private directory: string;
  private scope: MemoryScope;
  private catalog: Record<string, VideoMemoryItemSummary> = {};
  private payloadCache = new LRU<string, Buffer>(1024);
  private contentHashMap: Record<string, PayloadRef> = {};
  private encodingQueue: MemoryItem[] = [];
  private isEncoding = false;
  private readonly batchSize = 20;
  private readonly maxQueueSize = 1000;
  private encoderInitialized = false;

  constructor(directory: string, scope: MemoryScope) {
    this.directory = directory;
    this.scope = scope;
    this.ensureDirectories();
    this.loadCatalog();
    this.loadContentHashMap();
    this.initializeVideoComponents().catch(error => {
      console.warn('Video components initialization failed:', error);
      this.encoderInitialized = false;
    });
    this.startBackgroundOptimization();
  }

  private ensureDirectories(): void {
    const dirs = [
      this.directory,
      path.join(this.directory, 'items'),
      path.join(this.directory, 'videos'),
      path.join(this.directory, 'index'),
      path.join(this.directory, 'tmp')
    ];
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  async writeItem(item: MemoryItem): Promise<void> {
    if (!this.encoderInitialized) {
      console.log('VideoStorageAdapter not yet initialized, waiting...');
      await this.waitForInitialization();
    }
    const contentHash = this.computeContentHash(item);
    if (this.contentHashMap[contentHash]) {
      const payloadRef = this.contentHashMap[contentHash];
      this.catalog[item.id] = {
        id: item.id,
        type: item.type,
        scope: item.scope,
        title: item.title,
        tags: item.facets?.tags || [],
        files: item.facets?.files || [],
        symbols: item.facets?.symbols || [],
        confidence: item.quality?.confidence || 0.5,
        pinned: item.quality?.pinned || false,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        payloadRef,
        contentHash
      };
      this.saveCatalog();
      return;
    }
  }
}`.repeat(10),
    facets: {
      tags: ['typescript', 'storage', 'video', 'adapter', 'implementation', 'class', 'methods', 'async'],
      files: ['VideoStorageAdapter.ts', 'StorageAdapter.ts', 'MemoryItem.ts'],
      symbols: ['VideoStorageAdapter', 'writeItem', 'ensureDirectories', 'initializeVideoComponents']
    },
    quality: {
      confidence: 0.85,
      reuseCount: 3,
      pinned: false
    },
    security: {
      sensitivity: 'private'
    },
    context: {
      source: 'video-storage',
      tool: 'VideoStorageAdapter',
      environment: 'development'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    links: []
  };

  const jsonString = JSON.stringify(memoryItem);

  // Adjust content size to hit the target
  while (jsonString.length < targetOriginalSize) {
    memoryItem.text += " Additional content to reach target size.";
    memoryItem.code += "\n  // Additional code comment";
  }

  return JSON.stringify(memoryItem);
}

async function analyzeCompressionScenario() {
  console.log('🔍 Analyzing Compression Scenario to Match Your 1,090 bytes Result\n');

  const qrManager = new QRManager();

  // Try to create content that matches your scenario
  const targetSizes = [16756];
  const targetCompressedSize = 1090;

  for (const originalSize of targetSizes) {
    console.log(`=== Creating content that compresses to ~${targetCompressedSize} bytes ===`);

    const content = createMemoryItemLikeContent(originalSize);
    console.log(`📏 Generated content: ${content.length} bytes`);

    // Test compression directly
    console.log('\n🗜️  Direct compression test:');
    const originalData = new TextEncoder().encode(content);
    const compressed = zlib.gzipSync(originalData, { level: 6 });
    const compressedArray = new Uint8Array(compressed);

    console.log(`   Original: ${originalData.length} bytes`);
    console.log(`   Compressed: ${compressedArray.length} bytes`);
    console.log(`   Compression ratio: ${(originalData.length / compressedArray.length).toFixed(2)}x`);
    console.log(`   Compression %: ${((1 - compressedArray.length / originalData.length) * 100).toFixed(1)}%`);

    // Test QR encoding
    console.log('\n🎯 QR encoding test:');
    try {
      const result = await qrManager.encodeToQR(content);

      console.log(`   Frames generated: ${result.frames.length}`);
      console.log(`   Original size: ${result.metadata.originalSize} bytes`);
      console.log(`   Encoded size: ${result.metadata.encodedSize} bytes`);
      console.log(`   Compression ratio: ${result.metadata.compressionRatio.toFixed(2)}x`);
      console.log(`   Is compressed: ${result.metadata.isCompressed}`);

      if (result.frames.length > 1) {
        console.log('\n📄 Frame breakdown:');
        result.frames.forEach((frame, i) => {
          console.log(`   Frame ${i}: ${frame.rawData.length} bytes, QR v${frame.metadata.qrVersion}`);
        });
      }

      // Check if we're close to the target
      const difference = Math.abs(result.metadata.encodedSize - targetCompressedSize);
      console.log(`\n🎯 Target matching:`);
      console.log(`   Target compressed size: ${targetCompressedSize} bytes`);
      console.log(`   Actual compressed size: ${result.metadata.encodedSize} bytes`);
      console.log(`   Difference: ${difference} bytes`);
      console.log(`   Close match: ${difference < 200 ? '✅' : '❌'}`);

    } catch (error) {
      console.error(`   ❌ QR encoding failed: ${error.message}`);
    }
  }

  // Test theoretical scenario: what size content would compress to exactly 1090 bytes?
  console.log('\n\n🧮 Theoretical Analysis: What content size compresses to 1090 bytes?');

  // Test different original sizes to find what compresses to ~1090 bytes
  for (let testSize = 1000; testSize <= 50000; testSize += 1000) {
    const testContent = createMemoryItemLikeContent(testSize);
    const data = new TextEncoder().encode(testContent);
    const compressed = zlib.gzipSync(data, { level: 6 });

    if (compressed.length >= 1080 && compressed.length <= 1100) {
      console.log(`   📍 ${testSize} bytes → ${compressed.length} bytes (${(data.length / compressed.length).toFixed(2)}x compression)`);
    }
  }

  // Show chunking behavior for 1090 bytes
  console.log('\n📦 Chunking behavior for 1090 bytes:');
  const chunkSize = Math.min(2953 - 16, 1090);
  const totalChunks = Math.ceil(1090 / chunkSize);
  console.log(`   Data size: 1090 bytes`);
  console.log(`   Max chunk size: ${2953 - 16} bytes`);
  console.log(`   Calculated chunk size: ${chunkSize} bytes`);
  console.log(`   Total chunks needed: ${totalChunks}`);
  console.log(`   Result: ${totalChunks === 1 ? 'Single frame (as expected)' : 'Multiple frames'}`);
}

analyzeCompressionScenario().catch(console.error);