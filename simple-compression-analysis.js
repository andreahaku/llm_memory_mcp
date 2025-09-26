#!/usr/bin/env node

/**
 * Simple analysis to understand compression scenarios
 */

import * as zlib from 'zlib';

function analyzeCompressionRatios() {
  console.log('🔍 Understanding QR Chunking Issue\n');

  // Simulate different content types and their compression ratios
  const scenarios = [
    {
      name: 'Repeated characters (like test data)',
      generator: (size) => 'x'.repeat(size),
      originalSize: 16756
    },
    {
      name: 'JSON with repeated structures',
      generator: (size) => JSON.stringify({
        items: Array(Math.floor(size/100)).fill({
          id: 'item-id',
          type: 'snippet',
          title: 'Same title',
          content: 'Same content repeated'
        })
      }),
      originalSize: 16756
    },
    {
      name: 'Mixed realistic content',
      generator: (size) => {
        let content = '';
        for (let i = 0; i < size; i += 100) {
          content += `function fn${i}() { return "${Math.random().toString(36)}"; }\n`;
        }
        return content.substring(0, size);
      },
      originalSize: 16756
    }
  ];

  scenarios.forEach(scenario => {
    console.log(`=== ${scenario.name} ===`);

    const content = scenario.generator(scenario.originalSize);
    const data = new TextEncoder().encode(content);
    const compressed = zlib.gzipSync(data, { level: 6 });

    const compressionRatio = data.length / compressed.length;
    const compressionPercent = ((1 - compressed.length / data.length) * 100);

    console.log(`   Original: ${data.length} bytes`);
    console.log(`   Compressed: ${compressed.length} bytes`);
    console.log(`   Compression: ${compressionRatio.toFixed(2)}x (${compressionPercent.toFixed(1)}% reduction)`);

    // Check chunking
    const maxChunkSize = 2953 - 16; // QR capacity minus header
    const willCompress = compressed.length < data.length * 0.9;
    const finalSize = willCompress ? compressed.length : data.length;
    const chunksNeeded = Math.ceil(finalSize / maxChunkSize);

    console.log(`   Final data size: ${finalSize} bytes`);
    console.log(`   Chunks needed: ${chunksNeeded}`);
    console.log(`   Result: ${chunksNeeded === 1 ? 'Single QR frame' : `${chunksNeeded} QR frames`}`);
    console.log('');
  });

  // Show the specific case that matches your 1090 bytes
  console.log('🎯 Your Specific Case Analysis:');
  console.log('   Original: 16,756 bytes');
  console.log('   Compressed: 1,090 bytes');
  console.log(`   Compression: ${(16756/1090).toFixed(2)}x (${((1 - 1090/16756) * 100).toFixed(1)}% reduction)`);
  console.log('   QR chunking: 1,090 bytes < 2,937 bytes max → 1 chunk → 1 frame');
  console.log('');

  console.log('📋 Summary of the Issue:');
  console.log('1. QR chunking happens AFTER compression');
  console.log('2. Your content compressed very well (93.5% reduction)');
  console.log('3. 1,090 bytes fits in a single QR frame (max: 2,953 bytes)');
  console.log('4. Therefore: 1 chunk = 1 frame (working as designed)');
  console.log('');

  console.log('💡 To Force Multiple Frames:');
  console.log('1. Use less compressible content (mixed data, random bytes)');
  console.log('2. Chunk BEFORE compression (would require code changes)');
  console.log('3. Reduce max chunk size in QRManager (artificial limitation)');
  console.log('4. Disable compression for testing (set COMPRESSION_THRESHOLD = 0)');
}

analyzeCompressionRatios();