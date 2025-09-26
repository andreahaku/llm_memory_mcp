#!/usr/bin/env node

/**
 * Debug script to trace QR chunking behavior and understand why large content
 * isn't creating multiple frames as expected.
 */

import { QRManager } from './dist/src/qr/QRManager.js';
import { createHash } from 'node:crypto';
import * as zlib from 'zlib';

// Create test content of different sizes
const testCases = [
  {
    name: 'Small content (500 bytes)',
    content: 'x'.repeat(500)
  },
  {
    name: 'Medium content (2000 bytes)',
    content: 'x'.repeat(2000)
  },
  {
    name: 'Large content (5000 bytes)',
    content: 'x'.repeat(5000)
  },
  {
    name: 'Very large content (16756 bytes - like your issue)',
    content: 'x'.repeat(16756)
  },
  {
    name: 'Complex JSON content (16756 bytes)',
    content: JSON.stringify({
      id: 'test-memory-item',
      type: 'snippet',
      title: 'Complex memory item with lots of content',
      text: 'x'.repeat(10000),
      code: 'function test() {\n' + '  // code content\n'.repeat(200) + '}',
      facets: {
        tags: ['test', 'debug', 'large-content'],
        files: ['test.js', 'debug.js'],
        symbols: ['test', 'debug', 'QRManager']
      },
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1
      }
    })
  }
];

async function debugQRChunking() {
  console.log('🔍 Debugging QR Chunking Behavior\n');
  console.log('Expected QR capacity per frame: ~2953 bytes (version 40, ECC-L)\n');

  const qrManager = new QRManager();

  for (const testCase of testCases) {
    console.log(`\n=== ${testCase.name} ===`);

    const originalData = new TextEncoder().encode(testCase.content);
    console.log(`📏 Original size: ${originalData.length} bytes`);

    // Step 1: Test compression behavior
    console.log('\n🗜️  Testing compression...');
    const compressed = zlib.gzipSync(originalData, { level: 6 });
    const compressedArray = new Uint8Array(compressed);
    const compressionRatio = originalData.length / compressedArray.length;
    const isCompressionWorthwhile = compressedArray.length < originalData.length * 0.9;

    console.log(`   Compressed size: ${compressedArray.length} bytes`);
    console.log(`   Compression ratio: ${compressionRatio.toFixed(2)}x (${((1 - compressedArray.length / originalData.length) * 100).toFixed(1)}% reduction)`);
    console.log(`   Will use compression: ${isCompressionWorthwhile}`);

    const finalData = isCompressionWorthwhile ? compressedArray : originalData;

    // Step 2: Test chunking logic
    console.log('\n✂️  Testing chunking...');
    const MAX_CHUNK_SIZE = 2953; // Max bytes for QR version 40 with ECC-L
    const chunkSize = Math.min(MAX_CHUNK_SIZE - 16, finalData.length); // 16-byte header
    const totalChunks = Math.ceil(finalData.length / chunkSize);

    console.log(`   Data to chunk: ${finalData.length} bytes`);
    console.log(`   Max chunk size: ${MAX_CHUNK_SIZE - 16} bytes (${MAX_CHUNK_SIZE} - 16 header)`);
    console.log(`   Calculated chunk size: ${chunkSize} bytes`);
    console.log(`   Total chunks needed: ${totalChunks}`);

    // Step 3: Test actual QR encoding
    console.log('\n🎯 Testing actual QR encoding...');
    try {
      const result = await qrManager.encodeToQR(testCase.content);

      console.log(`   Frames generated: ${result.frames.length}`);
      console.log(`   Original size: ${result.metadata.originalSize} bytes`);
      console.log(`   Encoded size: ${result.metadata.encodedSize} bytes`);
      console.log(`   Compression ratio: ${result.metadata.compressionRatio.toFixed(2)}x`);
      console.log(`   Is compressed: ${result.metadata.isCompressed}`);

      // Analyze each frame
      result.frames.forEach((frame, i) => {
        console.log(`   Frame ${i}: ${frame.rawData.length} bytes, chunk ${frame.metadata.chunkId}`);
      });

      // Check estimation vs reality
      const estimation = qrManager.estimateEncoding(testCase.content);
      console.log(`\n📊 Estimation vs Reality:`);
      console.log(`   Estimated frames: ${estimation.estimatedFrames}, Actual frames: ${result.frames.length}`);
      console.log(`   Estimated compressed size: ${estimation.estimatedCompressedSize}, Actual: ${result.metadata.encodedSize}`);

    } catch (error) {
      console.error(`   ❌ QR encoding failed: ${error.message}`);
    }

    console.log('\n' + '='.repeat(80));
  }

  // Additional analysis: Test chunk size logic directly
  console.log('\n\n🔬 Direct Chunk Size Analysis');

  for (let size of [1000, 2000, 3000, 5000, 10000, 16756]) {
    const data = new Uint8Array(size);
    const compressed = zlib.gzipSync(data, { level: 6 });
    const compressedArray = new Uint8Array(compressed);
    const finalSize = compressedArray.length < size * 0.9 ? compressedArray.length : size;

    const MAX_CHUNK_SIZE = 2953;
    const chunkSize = Math.min(MAX_CHUNK_SIZE - 16, finalSize);
    const totalChunks = Math.ceil(finalSize / chunkSize);

    console.log(`${size} bytes → ${finalSize} bytes final → ${totalChunks} chunks (chunk size: ${chunkSize})`);
  }
}

debugQRChunking().catch(console.error);