#!/usr/bin/env node

/**
 * Test script for video encoding functionality
 * Demonstrates the FFmpeg.wasm encoder with QR frames
 */

import { QRManager } from './dist/qr/QRManager.js';
import { WasmFFmpegEncoder, createMviFile } from './dist/video/index.js';
import * as fs from 'fs-extra';
import * as path from 'path';

async function testVideoEncoding() {
  console.log('Testing Video Encoding with FFmpeg.wasm');
  console.log('======================================\n');

  try {
    // Create test directory
    const testDir = './test-output';
    await fs.ensureDir(testDir);

    // Step 1: Generate QR frames using QRManager
    console.log('1. Generating QR frames...');
    const qrManager = new QRManager();

    const testContent = 'Hello, this is test content for video encoding! '.repeat(10);
    const encodingResult = await qrManager.encodeToQR(testContent);

    console.log(`   Generated ${encodingResult.frames.length} QR frames`);
    console.log(`   Original size: ${encodingResult.metadata.originalSize} bytes`);
    console.log(`   Encoded size: ${encodingResult.metadata.encodedSize} bytes`);
    console.log(`   Compression ratio: ${encodingResult.metadata.compressionRatio.toFixed(2)}x\n`);

    // Step 2: Test encoder availability
    console.log('2. Testing encoder availability...');
    const encoder = new WasmFFmpegEncoder();

    const isAvailable = await encoder.isAvailable();
    console.log(`   FFmpeg.wasm available: ${isAvailable}`);

    if (!isAvailable) {
      console.log('   Encoder not available, initializing...');
      await encoder.initialize();
      console.log('   Encoder initialized successfully');
    }

    const info = encoder.getInfo();
    console.log(`   Encoder: ${info.name} v${info.version}`);
    console.log(`   Supported codecs: ${info.supportedCodecs.join(', ')}`);
    console.log(`   Max resolution: ${info.maxResolution.width}x${info.maxResolution.height}\n`);

    // Step 3: Encode video with progress tracking
    console.log('3. Encoding QR frames to video...');
    let lastProgress = 0;

    const videoResult = await encoder.encode(
      encodingResult.frames,
      {
        codec: 'h264',
        crf: 23,
        fps: 30,
        preset: 'fast', // Use fast preset for testing
      },
      (progress) => {
        const percent = Math.floor((progress.currentFrame / progress.totalFrames) * 100);
        if (percent >= lastProgress + 10) {
          console.log(`   Progress: ${percent}% (${progress.currentFrame}/${progress.totalFrames} frames, ${progress.encodingFps.toFixed(1)} fps)`);
          lastProgress = percent;
        }
      },
      60000 // 60 second timeout for testing
    );

    console.log(`   Encoding completed!`);
    console.log(`   Video size: ${(videoResult.videoData.length / 1024).toFixed(1)} KB`);
    console.log(`   Duration: ${videoResult.metadata.duration.toFixed(2)}s`);
    console.log(`   Frame count: ${videoResult.metadata.frameCount}`);
    console.log(`   Average encoding speed: ${videoResult.metadata.encodingStats.averageFps.toFixed(1)} fps`);
    console.log(`   Encoding time: ${(videoResult.metadata.encodingStats.encodingTime / 1000).toFixed(2)}s\n`);

    // Step 4: Save video and index files
    console.log('4. Saving output files...');
    const videoPath = path.join(testDir, 'test-qr-video.mp4');
    const indexPath = path.join(testDir, 'test-qr-video.mvi');

    await fs.writeFile(videoPath, videoResult.videoData);
    await createMviFile(videoResult.frameIndex, indexPath);

    console.log(`   Video saved to: ${videoPath}`);
    console.log(`   Frame index saved to: ${indexPath}`);
    console.log(`   Frame index entries: ${videoResult.frameIndex.length}\n`);

    // Step 5: Display statistics
    console.log('5. Statistics Summary');
    console.log('   =================');

    const originalSize = encodingResult.metadata.originalSize;
    const videoSize = videoResult.videoData.length;
    const compressionRatio = originalSize / videoSize;

    console.log(`   Original content: ${originalSize} bytes`);
    console.log(`   Video file: ${videoSize} bytes`);
    console.log(`   Overall compression: ${compressionRatio.toFixed(1)}x`);
    console.log(`   Storage efficiency: ${((1 - videoSize / originalSize) * 100).toFixed(1)}% space saved`);

    const keyframes = videoResult.frameIndex.filter(f => f.isKeyframe).length;
    console.log(`   Keyframes: ${keyframes}/${videoResult.frameIndex.length} (${((keyframes / videoResult.frameIndex.length) * 100).toFixed(1)}%)`);

    // Cleanup
    await encoder.dispose();

    console.log('\n✅ Video encoding test completed successfully!');
    console.log(`   Test files saved in: ${path.resolve(testDir)}`);

  } catch (error) {
    console.error('\n❌ Video encoding test failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Run the test
testVideoEncoding().catch(console.error);