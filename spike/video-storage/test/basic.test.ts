import { describe, it, expect } from 'vitest';
import qrGenerator from 'qrcode-generator';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';

describe('Basic Dependencies', () => {
  it('should generate QR codes', () => {
    const qr = qrGenerator(4, 'L');
    qr.addData('test data');
    qr.make();

    expect(qr.getModuleCount()).toBeGreaterThan(0);
  });

  it('should compress and decompress data', async () => {
    const gzipAsync = promisify(gzip);
    const gunzipAsync = promisify(gunzip);

    const originalData = 'test data for compression';
    const testBuffer = Buffer.from(originalData);

    const compressed = await gzipAsync(testBuffer);
    expect(compressed.length).toBeGreaterThan(0);

    const decompressed = await gunzipAsync(compressed);
    expect(decompressed.toString()).toBe(originalData);
  });
});