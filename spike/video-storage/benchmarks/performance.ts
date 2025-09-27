#!/usr/bin/env node

/**
 * Performance benchmarks for video storage spike
 */

import { performance } from 'node:perf_hooks';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import qrGenerator from 'qrcode-generator';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

async function benchmarkCompression() {
  console.log('\n=== Compression Benchmarks ===');

  const testSizes = [100, 1000, 10000, 100000]; // bytes

  for (const size of testSizes) {
    const testData = Buffer.alloc(size, 'A');

    const start = performance.now();
    const compressed = await gzipAsync(testData);
    const compressionTime = performance.now() - start;

    const decompressStart = performance.now();
    const decompressed = await gunzipAsync(compressed);
    const decompressionTime = performance.now() - decompressStart;

    const ratio = ((testData.length - compressed.length) / testData.length * 100).toFixed(1);

    console.log(`${size.toLocaleString()} bytes:`);
    console.log(`  Compression: ${compressionTime.toFixed(2)}ms (${ratio}% reduction)`);
    console.log(`  Decompression: ${decompressionTime.toFixed(2)}ms`);
    console.log(`  Compressed size: ${compressed.length.toLocaleString()} bytes`);
  }
}

async function benchmarkQRGeneration() {
  console.log('\n=== QR Code Generation Benchmarks ===');

  const testData = ['small', 'medium sized test data'];

  for (const data of testData) {
    try {
      const start = performance.now();

      const qr = qrGenerator(4, 'L');
      qr.addData(data);
      qr.make();

      const generationTime = performance.now() - start;

      console.log(`Data length ${data.length}: ${generationTime.toFixed(2)}ms (${qr.getModuleCount()}x${qr.getModuleCount()} modules)`);
    } catch (error) {
      console.log(`Data length ${data.length}: Failed (${error.message})`);
    }
  }

  // Test different error correction levels
  console.log('\nTesting different QR error correction levels:');
  const testString = 'test data';
  const levels = ['L', 'M', 'Q', 'H'];

  for (const level of levels) {
    try {
      const start = performance.now();

      const qr = qrGenerator(4, level as any);
      qr.addData(testString);
      qr.make();

      const generationTime = performance.now() - start;

      console.log(`Level ${level}: ${generationTime.toFixed(2)}ms (${qr.getModuleCount()}x${qr.getModuleCount()} modules)`);
    } catch (error) {
      console.log(`Level ${level}: Failed (${error.message})`);
    }
  }
}

async function main() {
  console.log('Video Storage Spike - Performance Benchmarks');
  console.log('=============================================');

  try {
    await benchmarkCompression();
    await benchmarkQRGeneration();

    console.log('\nBenchmarks completed successfully!');
  } catch (error) {
    console.error('Benchmark failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}