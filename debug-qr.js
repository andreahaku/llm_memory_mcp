#!/usr/bin/env node

const { QRManager } = require('./dist/qr/QRManager.js');

async function debugQR() {
  console.log('🔍 Debugging QR issue...');

  const qrManager = new QRManager();
  const longContent = 'This is a long message that should be compressed. '.repeat(20);

  console.log('Original content length:', longContent.length);

  try {
    // Test compression first
    const originalData = new TextEncoder().encode(longContent);
    console.log('Original data bytes:', originalData.length);

    // Try compression manually
    const zlib = require('zlib');
    const compressed = zlib.gzipSync(originalData, { level: 6 });
    console.log('Compressed bytes:', compressed.length);
    console.log('Compression ratio:', (originalData.length / compressed.length).toFixed(2) + 'x');

    // Check what parameters would be selected
    const params = qrManager.SIZE_PARAMETERS;
    console.log('\nAvailable parameters:');
    for (const p of params) {
      console.log(`  Version ${p.version} (${p.errorCorrectionLevel}): max ${p.maxBytes} bytes - ${p.description}`);
    }

    // Check which would be selected for compressed data
    console.log(`\nFor ${compressed.length} bytes + 16 header = ${compressed.length + 16} total:`);
    for (const p of params) {
      if (compressed.length + 16 <= p.maxBytes) {
        console.log(`  ✅ Would select Version ${p.version} (${p.errorCorrectionLevel}): max ${p.maxBytes} bytes`);

        // Test capacity info
        const capacity = qrManager.getCapacityInfo(p.version, p.errorCorrectionLevel);
        console.log(`     Capacity info: ${capacity.maxBytes} bytes, ${capacity.moduleCount} modules`);
        break;
      } else {
        console.log(`  ❌ Version ${p.version} (${p.errorCorrectionLevel}) too small: max ${p.maxBytes} < ${compressed.length + 16}`);
      }
    }

  } catch (error) {
    console.error('Debug failed:', error.message);
    console.error(error.stack);
  }
}

debugQR();