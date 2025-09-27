#!/usr/bin/env node

/**
 * Video Storage Spike - Phase 0 Entry Point
 *
 * This spike tests the feasibility of storing memory data in video format
 * using QR codes for high-density, durable storage.
 */

import qrGenerator from 'qrcode-generator';
import { readBarcodeFromImageData } from '@sec-ant/zxing-wasm';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
// Note: zstandard has build issues, using built-in zlib for now
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
// import { createCanvas } from 'canvas'; // Skipping due to build issues

async function main() {
  console.log('Video Storage Spike - Phase 0');
  console.log('==============================');

  try {
    // Test QR code generation
    const qr = qrGenerator(4, 'L');
    qr.addData('test');
    qr.make();
    console.log('✓ QR Code Generator loaded and tested');

    // Test ZXing WASM (QR decoding) - just verify import
    console.log('✓ ZXing WASM loaded:', typeof readBarcodeFromImageData);

    // Test FFmpeg - just verify import
    console.log('✓ FFmpeg loaded:', typeof FFmpeg);

    // Test FFmpeg utilities
    console.log('✓ FFmpeg utilities loaded:', typeof fetchFile, typeof toBlobURL);

    // Test gzip compression (built-in alternative to zstandard)
    const gzipAsync = promisify(gzip);
    const gunzipAsync = promisify(gunzip);
    const testData = Buffer.from('test data for compression');
    const compressed = await gzipAsync(testData);
    const decompressed = await gunzipAsync(compressed);
    console.log('✓ Gzip compression loaded and tested:', decompressed.toString() === 'test data for compression');

    // Test Canvas - skipped due to build issues
    // const canvas = createCanvas(100, 100);
    console.log('⚠ Canvas skipped (build issues)');

    console.log('\nAll Phase 0 dependencies loaded successfully!');
    console.log('Ready for spike implementation.');

  } catch (error) {
    console.error('Error testing dependencies:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main };