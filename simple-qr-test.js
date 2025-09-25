#!/usr/bin/env node

/**
 * Simple QRManager test to debug issues
 */

const { QRManager } = require('./dist/qr/QRManager.js');

async function simpleTest() {
  console.log('🧪 Simple QRManager test...');

  const qrManager = new QRManager();
  const testContent = 'Hello, QR world!';

  try {
    console.log('1. Testing estimation...');
    const estimate = qrManager.estimateEncoding(testContent);
    console.log('   Estimation result:', estimate);

    console.log('2. Testing encoding...');
    const result = await qrManager.encodeToQR(testContent);
    console.log('   Encoding result summary:');
    console.log('   - Frames:', result.frames.length);
    console.log('   - Original size:', result.metadata.originalSize);
    console.log('   - Encoded size:', result.metadata.encodedSize);
    console.log('   - Compressed:', result.metadata.isCompressed);

    console.log('3. Testing frame details...');
    if (result.frames.length > 0) {
      const frame = result.frames[0];
      console.log('   Frame 0:');
      console.log('   - Version:', frame.metadata.qrVersion);
      console.log('   - ECC:', frame.metadata.qrErrorCorrection);
      console.log('   - Image size:', frame.imageData.width, 'x', frame.imageData.height);
      console.log('   - Raw data length:', frame.rawData.length);
    }

    console.log('✅ Simple test passed!');
    return true;
  } catch (error) {
    console.error('❌ Simple test failed:', error.message);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

async function testCompression() {
  console.log('\n🧪 Testing compression...');

  const qrManager = new QRManager();
  const longContent = 'This is a long message that should be compressed. '.repeat(20);

  try {
    const result = await qrManager.encodeToQR(longContent);
    console.log('   Long content results:');
    console.log('   - Original size:', result.metadata.originalSize);
    console.log('   - Encoded size:', result.metadata.encodedSize);
    console.log('   - Compression ratio:', result.metadata.compressionRatio.toFixed(2) + 'x');
    console.log('   - Was compressed:', result.metadata.isCompressed);
    console.log('   - Frames:', result.frames.length);

    console.log('✅ Compression test passed!');
    return true;
  } catch (error) {
    console.error('❌ Compression test failed:', error.message);
    console.error('Stack trace:', error.stack);
    return false;
  }
}

// Run tests
async function runSimpleTests() {
  const test1 = await simpleTest();
  const test2 = await testCompression();

  if (test1 && test2) {
    console.log('\n🎉 All simple tests passed!');
    process.exit(0);
  } else {
    console.log('\n💥 Some tests failed');
    process.exit(1);
  }
}

runSimpleTests();