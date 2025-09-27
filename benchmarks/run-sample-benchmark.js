#!/usr/bin/env node

/**
 * Quick sample benchmark runner for development and testing
 * Runs a minimal version of the comprehensive benchmark suite
 */

const { spawn } = require('child_process');
const path = require('path');

async function runSampleBenchmark() {
  console.log('🚀 Running Sample Video Storage Benchmark...\n');

  const benchmarkPath = path.join(__dirname, 'comprehensive-benchmark.ts');

  // Run with minimal settings for quick testing
  const args = [
    benchmarkPath,
    '--iterations', '2',
    '--single-encoder',
    '--no-memory-tests',
    '--output', './benchmark-results'
  ];

  return new Promise((resolve, reject) => {
    const process = spawn('tsx', args, {
      stdio: 'inherit',
      cwd: path.dirname(__dirname)
    });

    process.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ Sample benchmark completed successfully!');
        resolve(code);
      } else {
        console.error(`\n❌ Sample benchmark failed with code ${code}`);
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    process.on('error', (error) => {
      console.error('❌ Failed to start benchmark:', error.message);
      reject(error);
    });
  });
}

if (require.main === module) {
  runSampleBenchmark().catch((error) => {
    console.error('Sample benchmark failed:', error.message);
    process.exit(1);
  });
}

module.exports = { runSampleBenchmark };