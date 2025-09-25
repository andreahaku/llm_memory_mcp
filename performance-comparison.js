#!/usr/bin/env node

/**
 * Performance comparison between WASM and Native FFmpeg encoders
 * Demonstrates the performance benefits of native FFmpeg execution
 */

import {
  NativeFFmpegEncoder,
  isNativeEncoderSupported
} from './dist/video/NativeEncoder.js';
import {
  WasmFFmpegEncoder,
  isWasmEncoderSupported
} from './dist/video/WasmEncoder.js';

// Create test frames for performance comparison
function createPerformanceTestFrames(count = 30, size = 128) {
  const frames = [];
  const width = size;
  const height = size;

  console.log(`📊 Creating ${count} test frames (${width}x${height})...`);

  for (let i = 0; i < count; i++) {
    // Create more complex patterns to simulate real QR codes
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const pixelIndex = (y * width + x) * 4;

        // Create a more complex pattern that varies by frame
        const pattern1 = Math.sin(x * 0.1 + i * 0.2) > 0;
        const pattern2 = Math.sin(y * 0.1 + i * 0.3) > 0;
        const pattern3 = ((x + y + i) % 8) < 4;

        // Combine patterns to create QR-like complexity
        const isBlack = (pattern1 && pattern2) || pattern3;
        const value = isBlack ? 0 : 255;

        data[pixelIndex] = value;     // R
        data[pixelIndex + 1] = value; // G
        data[pixelIndex + 2] = value; // B
        data[pixelIndex + 3] = 255;   // A (opaque)
      }
    }

    frames.push({
      imageData: {
        data,
        width,
        height
      },
      metadata: {
        frameIndex: i,
        totalFrames: count,
        contentHash: `perf-test-hash-${i}`,
        isCompressed: false,
        originalSize: data.length,
        encodedSize: data.length,
        qrVersion: 1,
        qrErrorCorrection: 'M',
        timestamp: new Date().toISOString(),
      },
      rawData: new Uint8Array(data.buffer),
    });
  }

  return frames;
}

async function benchmarkNativeEncoder(frames) {
  console.log('🚀 Benchmarking Native FFmpeg Encoder...');

  try {
    const encoder = new NativeFFmpegEncoder();
    await encoder.initialize();

    let progressUpdates = 0;
    let lastProgress = 0;
    const startTime = Date.now();

    const result = await encoder.encode(
      frames,
      {
        crf: 28,
        preset: 'veryfast',
        fps: 30,
      },
      (progress) => {
        progressUpdates++;
        if (progress.currentFrame > lastProgress + 5) { // Log every 5 frames
          console.log(`   📈 Progress: ${progress.currentFrame}/${progress.totalFrames} @ ${progress.encodingFps.toFixed(1)} fps`);
          lastProgress = progress.currentFrame;
        }
      },
      120000 // 2 minute timeout
    );

    const totalTime = Date.now() - startTime;
    await encoder.dispose();

    return {
      success: true,
      encodingTime: totalTime,
      outputSize: result.videoData.length,
      averageFps: result.metadata.encodingStats.averageFps,
      peakMemory: result.metadata.encodingStats.peakMemoryUsage,
      progressUpdates,
      bitrate: result.metadata.bitrate,
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

async function benchmarkWasmEncoder(frames) {
  console.log('🔧 Benchmarking WASM FFmpeg Encoder...');

  try {
    const encoder = new WasmFFmpegEncoder();
    await encoder.initialize();

    let progressUpdates = 0;
    let lastProgress = 0;
    const startTime = Date.now();

    const result = await encoder.encode(
      frames,
      {
        crf: 28,
        preset: 'veryfast',
        fps: 30,
      },
      (progress) => {
        progressUpdates++;
        if (progress.currentFrame > lastProgress + 5) { // Log every 5 frames
          console.log(`   📈 Progress: ${progress.currentFrame}/${progress.totalFrames} @ ${progress.encodingFps.toFixed(1)} fps`);
          lastProgress = progress.currentFrame;
        }
      },
      120000 // 2 minute timeout
    );

    const totalTime = Date.now() - startTime;
    await encoder.dispose();

    return {
      success: true,
      encodingTime: totalTime,
      outputSize: result.videoData.length,
      averageFps: result.metadata.encodingStats.averageFps,
      peakMemory: result.metadata.encodingStats.peakMemoryUsage,
      progressUpdates,
      bitrate: result.metadata.bitrate,
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

async function runPerformanceComparison() {
  console.log('🏁 Video Encoder Performance Comparison');
  console.log('========================================\n');

  // Check availability
  const nativeAvailable = await isNativeEncoderSupported();
  const wasmAvailable = await isWasmEncoderSupported();

  console.log(`📋 Encoder Availability:`);
  console.log(`   Native FFmpeg: ${nativeAvailable ? '✅ Available' : '❌ Not available'}`);
  console.log(`   WASM FFmpeg:   ${wasmAvailable ? '✅ Available' : '❌ Not available'}\n`);

  if (!nativeAvailable && !wasmAvailable) {
    console.log('💥 No encoders available for testing!');
    process.exit(1);
  }

  // Create test data
  const frames = createPerformanceTestFrames(50, 200); // 50 frames, 200x200 pixels
  const inputSize = frames.length * frames[0].imageData.data.length;
  console.log(`   Input size: ${formatBytes(inputSize)}\n`);

  const results = {};

  // Test Native encoder
  if (nativeAvailable) {
    console.log('🔥 Testing Native FFmpeg Encoder...');
    results.native = await benchmarkNativeEncoder(frames);
    console.log('');
  }

  // Test WASM encoder
  if (wasmAvailable) {
    console.log('🔧 Testing WASM FFmpeg Encoder...');
    results.wasm = await benchmarkWasmEncoder(frames);
    console.log('');
  }

  // Display results
  console.log('📊 Performance Comparison Results');
  console.log('=================================\n');

  if (results.native?.success) {
    console.log('🚀 Native FFmpeg Encoder:');
    console.log(`   ✅ Encoding Time:    ${formatTime(results.native.encodingTime)}`);
    console.log(`   📊 Average FPS:      ${results.native.averageFps.toFixed(1)}`);
    console.log(`   📦 Output Size:      ${formatBytes(results.native.outputSize)}`);
    console.log(`   💾 Peak Memory:      ${formatBytes(results.native.peakMemory)}`);
    console.log(`   📈 Bitrate:          ${Math.round(results.native.bitrate / 1000)} kbps`);
    console.log(`   🔄 Progress Updates: ${results.native.progressUpdates}\n`);
  } else if (results.native) {
    console.log('❌ Native FFmpeg Encoder failed:', results.native.error, '\n');
  }

  if (results.wasm?.success) {
    console.log('🔧 WASM FFmpeg Encoder:');
    console.log(`   ✅ Encoding Time:    ${formatTime(results.wasm.encodingTime)}`);
    console.log(`   📊 Average FPS:      ${results.wasm.averageFps.toFixed(1)}`);
    console.log(`   📦 Output Size:      ${formatBytes(results.wasm.outputSize)}`);
    console.log(`   💾 Peak Memory:      ${formatBytes(results.wasm.peakMemory)}`);
    console.log(`   📈 Bitrate:          ${Math.round(results.wasm.bitrate / 1000)} kbps`);
    console.log(`   🔄 Progress Updates: ${results.wasm.progressUpdates}\n`);
  } else if (results.wasm) {
    console.log('❌ WASM FFmpeg Encoder failed:', results.wasm.error, '\n');
  }

  // Performance comparison
  if (results.native?.success && results.wasm?.success) {
    console.log('🏆 Performance Comparison:');
    const speedup = results.wasm.encodingTime / results.native.encodingTime;
    const fpsRatio = results.native.averageFps / results.wasm.averageFps;
    const memoryRatio = results.wasm.peakMemory / results.native.peakMemory;

    console.log(`   🚀 Speed Improvement: ${speedup.toFixed(2)}x faster (Native vs WASM)`);
    console.log(`   📊 FPS Improvement:   ${fpsRatio.toFixed(2)}x higher throughput`);
    console.log(`   💾 Memory Usage:      ${memoryRatio.toFixed(2)}x (WASM vs Native)`);

    if (speedup > 5) {
      console.log('   🎉 Native encoder shows excellent performance gains!');
    } else if (speedup > 2) {
      console.log('   ✅ Native encoder shows significant performance improvement');
    } else {
      console.log('   📈 Native encoder shows moderate improvement');
    }
  } else if (nativeAvailable && wasmAvailable) {
    console.log('⚠️  Could not perform direct comparison due to encoder failures');
  } else if (nativeAvailable && !wasmAvailable) {
    console.log('📝 Only Native encoder available - install WASM encoder for comparison');
  } else if (!nativeAvailable && wasmAvailable) {
    console.log('📝 Only WASM encoder available - install FFmpeg for native comparison');
  }

  console.log('\n🏁 Performance testing complete!');
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('💥 Unhandled error:', error);
  process.exit(1);
});

// Run performance comparison
runPerformanceComparison().catch((error) => {
  console.error('💥 Performance test failed:', error);
  process.exit(1);
});