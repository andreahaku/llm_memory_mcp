import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

function ffmpegCacheEntries() {
  const keys = Object.keys(require.cache || {});
  return keys.filter(k => k.includes('@ffmpeg/ffmpeg') || k.includes('@ffmpeg/util'));
}

async function testImport(label, spec) {
  const abs = path.isAbsolute(spec) ? spec : path.resolve(__dirname, '..', spec);
  const before = ffmpegCacheEntries();
  let ok = false;
  let errMsg = null;
  try {
    await import(abs);
    ok = true;
  } catch (err) {
    ok = false;
    errMsg = err && err.message ? err.message : String(err);
  }
  const after = ffmpegCacheEntries();
  const loaded = after.filter(k => !before.includes(k));
  return { label, ok, errMsg, ffmpegLoaded: loaded };
}

async function main() {
  const tests = [
    ['video/utils', 'dist/video/utils.js'],
    ['video/index (barrel)', 'dist/video/index.js'],
    ['video/WasmEncoder', 'dist/video/WasmEncoder.js'],
    ['video/NativeEncoder', 'dist/video/NativeEncoder.js'],
    ['storage/VideoStorageAdapter', 'dist/storage/VideoStorageAdapter.js'],
    ['migration/MigrationManager', 'dist/migration/MigrationManager.js'],
    ['server index', 'dist/index.js'],
  ];

  const results = [];
  for (const [label, spec] of tests) {
    // clear require cache between tests to avoid false positives
    for (const key of Object.keys(require.cache || {})) {
      if (key.includes('dist/video') || key.includes('dist/storage') || key.includes('dist/migration') || key.includes('@ffmpeg')) {
        delete require.cache[key];
      }
    }
    // run test
    /* eslint-disable no-await-in-loop */
    const res = await testImport(label, spec);
    results.push(res);
  }

  for (const r of results) {
    const status = r.ok ? 'OK' : 'ERR';
    const ff = r.ffmpegLoaded.length ? `ffmpeg deps: ${r.ffmpegLoaded.join(', ')}` : 'ffmpeg deps: none';
    const msg = r.errMsg ? ` | error: ${r.errMsg}` : '';
    console.log(`${status.padEnd(3)} ${r.label.padEnd(28)} | ${ff}${msg}`);
  }
}

main().catch(e => {
  console.error('import-smoke failed:', e);
  process.exit(1);
});

