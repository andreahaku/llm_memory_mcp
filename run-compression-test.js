#!/usr/bin/env node

/**
 * JavaScript wrapper to run the compression validation test
 */

const { execSync } = require('child_process');
const path = require('path');

async function runTest() {
  try {
    console.log('🧪 Running Comprehensive Compression Validation Test...\n');

    // First ensure we have the build
    console.log('📦 Building TypeScript...');
    try {
      execSync('npx tsc --project tsconfig.json --outDir dist-test src/**/* test/**/*', {
        stdio: 'inherit',
        cwd: __dirname
      });
      console.log('✅ Build completed\n');
    } catch (buildError) {
      console.log('⚠️  Build had issues, continuing anyway...\n');
    }

    // Run the test using ts-node directly
    const testFile = path.join(__dirname, 'test', 'compression-validation.ts');
    console.log('🚀 Executing compression validation...\n');

    execSync(`npx ts-node ${testFile}`, {
      stdio: 'inherit',
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        TS_NODE_PROJECT: 'tsconfig.json'
      }
    });

  } catch (error) {
    console.error('💥 Test execution failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runTest();
}

module.exports = { runTest };