#!/usr/bin/env node

/**
 * Test script for QRManager functionality
 * Validates QR encoding with various content sizes and compression scenarios
 */

const { QRManager } = require('./dist/qr/QRManager.js');

async function testQRManager() {
  console.log('🧪 Testing QRManager functionality...\n');

  const qrManager = new QRManager();

  // Test cases with different content sizes
  const testCases = [
    {
      name: 'Small text (< 120 bytes)',
      content: 'Hello, QR world! This is a small test message.',
      expectedFrames: 1,
      expectedVersion: 6
    },
    {
      name: 'Medium text (120-350 bytes)',
      content: 'This is a longer test message that should trigger version 10 parameters with medium error correction. '.repeat(2),
      expectedFrames: 1,
      expectedVersion: 10
    },
    {
      name: 'Large text (350-750 bytes)',
      content: 'This is an even longer message that will test the larger QR code parameters and potentially trigger compression. Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(4),
      expectedFrames: 1,
      expectedVersion: 15
    },
    {
      name: 'Very large text (multi-frame)',
      content: 'This is a very large message that should definitely get split into multiple QR frames. '.repeat(50),
      expectedFrames: 'multiple',
      expectedVersion: 40
    }
  ];

  let passed = 0;
  let total = testCases.length;

  for (const testCase of testCases) {
    console.log(`\n📋 Test: ${testCase.name}`);
    console.log(`   Content size: ${testCase.content.length} bytes`);

    try {
      // Test estimation first
      const estimate = qrManager.estimateEncoding(testCase.content);
      console.log(`   📊 Estimation:`);
      console.log(`      - Original size: ${estimate.originalSize} bytes`);
      console.log(`      - Estimated frames: ${estimate.estimatedFrames}`);
      console.log(`      - Recommended version: ${estimate.recommendedParameters.version}`);
      console.log(`      - Error correction: ${estimate.recommendedParameters.errorCorrectionLevel}`);

      // Test actual encoding
      const startTime = Date.now();
      const result = await qrManager.encodeToQR(testCase.content);
      const encodeTime = Date.now() - startTime;

      console.log(`   ✅ Encoding successful in ${encodeTime}ms`);
      console.log(`   📸 Results:`);
      console.log(`      - Frames generated: ${result.frames.length}`);
      console.log(`      - Original size: ${result.metadata.originalSize} bytes`);
      console.log(`      - Encoded size: ${result.metadata.encodedSize} bytes`);
      console.log(`      - Compression ratio: ${result.metadata.compressionRatio.toFixed(2)}x`);
      console.log(`      - Was compressed: ${result.metadata.isCompressed}`);
      console.log(`      - Content hash: ${result.metadata.contentHash}`);

      // Validate frames
      let allFramesValid = true;
      for (let i = 0; i < result.frames.length; i++) {
        const frame = result.frames[i];
        console.log(`   🖼️  Frame ${i + 1}:`);
        console.log(`      - QR Version: ${frame.metadata.qrVersion}`);
        console.log(`      - Error correction: ${frame.metadata.qrErrorCorrection}`);
        console.log(`      - Image size: ${frame.imageData.width}x${frame.imageData.height}`);
        console.log(`      - Raw data size: ${frame.rawData.length} bytes`);
        console.log(`      - Chunk ID: ${frame.metadata.chunkId || 'N/A'}`);

        // Validate frame structure
        if (!frame.imageData.data || frame.imageData.width <= 0 || frame.imageData.height <= 0) {
          console.log(`      ❌ Invalid image data structure`);
          allFramesValid = false;
        }

        if (frame.rawData.length === 0) {
          console.log(`      ❌ Empty raw data`);
          allFramesValid = false;
        }
      }

      // Test capacity info
      const capacityInfo = qrManager.getCapacityInfo(
        result.frames[0].metadata.qrVersion,
        result.frames[0].metadata.qrErrorCorrection
      );
      console.log(`   📐 Capacity info:`);
      console.log(`      - Max bytes: ${capacityInfo.maxBytes}`);
      console.log(`      - Module count: ${capacityInfo.moduleCount}`);

      // Validation checks
      const checks = [];

      // Frame count check
      if (testCase.expectedFrames === 'multiple') {
        checks.push({
          name: 'Multiple frames generated',
          passed: result.frames.length > 1,
          actual: result.frames.length,
          expected: '> 1'
        });
      } else {
        checks.push({
          name: 'Frame count',
          passed: result.frames.length === testCase.expectedFrames,
          actual: result.frames.length,
          expected: testCase.expectedFrames
        });
      }

      // Version check (at least the expected version or higher)
      checks.push({
        name: 'QR version (>= expected)',
        passed: result.frames[0].metadata.qrVersion >= testCase.expectedVersion,
        actual: result.frames[0].metadata.qrVersion,
        expected: `>= ${testCase.expectedVersion}`
      });

      // Data integrity check
      checks.push({
        name: 'All frames valid',
        passed: allFramesValid,
        actual: allFramesValid ? 'valid' : 'invalid',
        expected: 'valid'
      });

      // Compression check (large content should be compressed)
      if (testCase.content.length > 500) {
        checks.push({
          name: 'Large content compressed',
          passed: result.metadata.isCompressed,
          actual: result.metadata.isCompressed,
          expected: true
        });
      }

      // Print validation results
      console.log(`   🔍 Validation:`);
      let testPassed = true;
      for (const check of checks) {
        const status = check.passed ? '✅' : '❌';
        console.log(`      ${status} ${check.name}: ${check.actual} (expected: ${check.expected})`);
        if (!check.passed) testPassed = false;
      }

      if (testPassed) {
        console.log(`   🎉 Test PASSED`);
        passed++;
      } else {
        console.log(`   💥 Test FAILED`);
      }

    } catch (error) {
      console.log(`   💥 Test FAILED with error: ${error.message}`);
      console.log(`      Stack: ${error.stack}`);
    }
  }

  // Summary
  console.log(`\n📊 Test Summary:`);
  console.log(`   ✅ Passed: ${passed}/${total}`);
  console.log(`   ❌ Failed: ${total - passed}/${total}`);

  if (passed === total) {
    console.log(`\n🎉 All tests passed! QRManager is working correctly.`);
    process.exit(0);
  } else {
    console.log(`\n💥 Some tests failed. Please review the implementation.`);
    process.exit(1);
  }
}

// Additional test for binary data
async function testBinaryData() {
  console.log('\n🔬 Testing binary data encoding...');

  const qrManager = new QRManager();

  // Create test binary data
  const binaryData = new Uint8Array(1000);
  for (let i = 0; i < binaryData.length; i++) {
    binaryData[i] = i % 256;
  }

  try {
    const result = await qrManager.encodeToQR(binaryData);
    console.log(`✅ Binary data encoded successfully`);
    console.log(`   - Frames: ${result.frames.length}`);
    console.log(`   - Original size: ${result.metadata.originalSize} bytes`);
    console.log(`   - Encoded size: ${result.metadata.encodedSize} bytes`);
    console.log(`   - Compressed: ${result.metadata.isCompressed}`);

    return true;
  } catch (error) {
    console.log(`❌ Binary data test failed: ${error.message}`);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  try {
    await testQRManager();
    const binaryPassed = await testBinaryData();

    if (!binaryPassed) {
      console.log('\n💥 Binary data test failed');
      process.exit(1);
    }

    console.log('\n🎊 All QRManager tests completed successfully!');
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = { testQRManager, testBinaryData, runAllTests };