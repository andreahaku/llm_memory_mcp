#!/usr/bin/env node
/**
 * Test script for video decoding implementation
 * Tests the complete pipeline from video storage to memory item reconstruction
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const TEST_CONFIG = {
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  timeout: 30000, // 30 second timeout
  cleanup: !process.argv.includes('--no-cleanup')
};

console.log('🧪 Video Decoding Pipeline Test');
console.log('================================\n');

let testsPassed = 0;
let testsTotal = 0;

function logStep(message, level = 'info') {
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  console.log(`${icons[level]} ${message}`);
}

function logVerbose(message) {
  if (TEST_CONFIG.verbose) {
    console.log(`   ${message}`);
  }
}

async function testFrameExtractionSupport() {
  testsTotal++;
  logStep('Testing frame extraction support...');

  try {
    const { isFrameExtractionSupported } = await import('./dist/src/video/FrameExtractor.js');
    const isSupported = await isFrameExtractionSupported();

    if (isSupported) {
      logStep('Frame extraction support: Available', 'success');
      testsPassed++;
      return true;
    } else {
      logStep('Frame extraction support: Not available (FFmpeg not found)', 'warning');
      logVerbose('FFmpeg is required for frame extraction. Install FFmpeg to enable video decoding.');
      return false;
    }
  } catch (error) {
    logStep(`Frame extraction support test failed: ${error.message}`, 'error');
    logVerbose(error.stack);
    return false;
  }
}

async function testVideoDecodingSupport() {
  testsTotal++;
  logStep('Testing video decoding support...');

  try {
    const { isVideoDecodingSupported } = await import('./dist/src/video/VideoDecoder.js');
    const isSupported = await isVideoDecodingSupported();

    if (isSupported) {
      logStep('Video decoding support: Available', 'success');
      testsPassed++;
      return true;
    } else {
      logStep('Video decoding support: Not available', 'warning');
      logVerbose('Video decoding requires both FFmpeg and ZXing WASM to be available.');
      return false;
    }
  } catch (error) {
    logStep(`Video decoding support test failed: ${error.message}`, 'error');
    logVerbose(error.stack);
    return false;
  }
}

async function testQRDecoderInitialization() {
  testsTotal++;
  logStep('Testing QR decoder initialization...');

  try {
    const { QRDecoder } = await import('./dist/src/qr/QRDecoder.js');
    const decoder = new QRDecoder();
    await decoder.initialize();

    const info = decoder.getDecoderInfo();
    if (info.initialized) {
      logStep('QR decoder initialization: Success', 'success');
      logVerbose(`ZXing version: ${info.zxingVersion}`);
      logVerbose(`Supported formats: ${info.supportedFormats.join(', ')}`);
      decoder.dispose();
      testsPassed++;
      return true;
    } else {
      logStep('QR decoder initialization: Failed', 'error');
      return false;
    }
  } catch (error) {
    logStep(`QR decoder initialization failed: ${error.message}`, 'error');
    logVerbose(error.stack);
    return false;
  }
}

async function testVideoSegmentManagerIntegration() {
  testsTotal++;
  logStep('Testing VideoSegmentManager integration...');

  try {
    const { VideoSegmentManagerFactory } = await import('./dist/src/video/VideoSegmentManager.js');
    const { createVideoDecoder } = await import('./dist/src/video/VideoDecoder.js');

    // Create a temporary directory for testing
    const tempDir = join(__dirname, 'tmp-video-test');

    try {
      // Try to create video decoder
      const videoDecoder = await createVideoDecoder();
      logVerbose('Video decoder created successfully');

      // Create VideoSegmentManager with decoder
      const manager = await VideoSegmentManagerFactory.createWithEncoderAndDecoder(tempDir);
      logVerbose('VideoSegmentManager created with decoder');

      // Test basic functionality (without actual video files)
      const segments = await manager.listSegments();
      logVerbose(`Found ${segments.length} segments in test directory`);

      await manager.dispose();
      await videoDecoder.dispose();

      logStep('VideoSegmentManager integration: Success', 'success');
      testsPassed++;
      return true;
    } finally {
      // Clean up temp directory if it was created and empty
      if (TEST_CONFIG.cleanup) {
        try {
          const fs = await import('fs-extra');
          const exists = await fs.pathExists(tempDir);
          if (exists) {
            const files = await fs.readdir(tempDir);
            if (files.length === 0) {
              await fs.remove(tempDir);
              logVerbose('Cleaned up temporary test directory');
            }
          }
        } catch (cleanupError) {
          logVerbose(`Cleanup warning: ${cleanupError.message}`);
        }
      }
    }
  } catch (error) {
    logStep(`VideoSegmentManager integration failed: ${error.message}`, 'error');
    logVerbose(error.stack);
    return false;
  }
}

async function testErrorHandlingAndFallbacks() {
  testsTotal++;
  logStep('Testing error handling and fallback strategies...');

  try {
    const { VideoDecoder } = await import('./dist/src/video/VideoDecoder.js');
    const { FrameExtractor } = await import('./dist/src/video/FrameExtractor.js');

    const decoder = new VideoDecoder();
    const extractor = new FrameExtractor();

    // Test initialization without crashing
    try {
      await decoder.initialize();
      logVerbose('Video decoder initialized successfully');
    } catch (initError) {
      logVerbose(`Video decoder initialization failed (expected): ${initError.message}`);
    }

    try {
      await extractor.initialize();
      logVerbose('Frame extractor initialized successfully');
    } catch (initError) {
      logVerbose(`Frame extractor initialization failed (expected): ${initError.message}`);
    }

    // Test error handling with invalid inputs
    const invalidVideoPath = '/non/existent/video.mp4';
    const result = await decoder.decodeFrame(invalidVideoPath, 0);

    if (!result.success && result.error) {
      logStep('Error handling and fallbacks: Success', 'success');
      logVerbose(`Expected error handled correctly: ${result.error}`);
      testsPassed++;
    } else {
      logStep('Error handling and fallbacks: Failed (should have returned error)', 'error');
    }

    await decoder.dispose();
    await extractor.dispose();
    return true;
  } catch (error) {
    logStep(`Error handling test failed: ${error.message}`, 'error');
    logVerbose(error.stack);
    return false;
  }
}

async function testPerformanceMetrics() {
  testsTotal++;
  logStep('Testing performance metrics collection...');

  try {
    const { VideoDecoder } = await import('./dist/src/video/VideoDecoder.js');
    const decoder = new VideoDecoder();

    // Test that decoder collects timing metrics
    const startTime = Date.now();
    const result = await decoder.decodeFrame('/non/existent/video.mp4', 0);
    const endTime = Date.now();

    if (result.metadata && typeof result.metadata.totalTimeMs === 'number') {
      const measuredTime = endTime - startTime;
      logStep('Performance metrics collection: Success', 'success');
      logVerbose(`Total time reported: ${result.metadata.totalTimeMs}ms`);
      logVerbose(`Measured time: ${measuredTime}ms`);

      // Verify timing is reasonable (within 10% of measured time or at least positive)
      if (result.metadata.totalTimeMs > 0 && result.metadata.totalTimeMs <= measuredTime * 1.1) {
        testsPassed++;
      } else {
        logStep('Performance metrics accuracy: Warning (timing seems off)', 'warning');
      }
    } else {
      logStep('Performance metrics collection: Failed (no metadata)', 'error');
    }

    await decoder.dispose();
    return true;
  } catch (error) {
    logStep(`Performance metrics test failed: ${error.message}`, 'error');
    logVerbose(error.stack);
    return false;
  }
}

// Main test runner
async function runTests() {
  const startTime = Date.now();

  try {
    // Test 1: Frame extraction support
    const frameExtractionSupported = await testFrameExtractionSupport();

    // Test 2: Video decoding support
    const videoDecodingSupported = await testVideoDecodingSupport();

    // Test 3: QR decoder initialization
    await testQRDecoderInitialization();

    // Test 4: VideoSegmentManager integration
    await testVideoSegmentManagerIntegration();

    // Test 5: Error handling and fallbacks
    await testErrorHandlingAndFallbacks();

    // Test 6: Performance metrics
    await testPerformanceMetrics();

    // Summary
    console.log('\n📊 Test Summary');
    console.log('================');
    console.log(`Tests passed: ${testsPassed}/${testsTotal}`);
    console.log(`Test duration: ${Date.now() - startTime}ms`);

    if (testsPassed === testsTotal) {
      console.log('\n🎉 All tests passed!');

      if (frameExtractionSupported && videoDecodingSupported) {
        console.log('✅ Video decoding pipeline is fully operational');
      } else {
        console.log('⚠️  Video decoding pipeline has limited functionality:');
        if (!frameExtractionSupported) {
          console.log('   - Frame extraction unavailable (install FFmpeg)');
        }
        if (!videoDecodingSupported) {
          console.log('   - QR decoding may be limited');
        }
      }
    } else {
      console.log(`\n❌ ${testsTotal - testsPassed} test(s) failed`);
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 Test runner crashed:');
    console.error(error);
    process.exit(1);
  }
}

// Handle timeout
const timeout = setTimeout(() => {
  console.error(`\n⏰ Tests timed out after ${TEST_CONFIG.timeout}ms`);
  process.exit(1);
}, TEST_CONFIG.timeout);

// Run tests and clean up
runTests().finally(() => {
  clearTimeout(timeout);
});