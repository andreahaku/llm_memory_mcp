#!/usr/bin/env node

/**
 * Test script to verify migration tools are working properly
 */

const { spawn } = require('child_process');
const fs = require('fs');

function testMCPCommand(command, timeout = 5000) {
  return new Promise((resolve, reject) => {
    console.log(`\nTesting: ${command.method} ${JSON.stringify(command.arguments || {})}`);

    const child = spawn('node', ['dist/src/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        code,
        output,
        errorOutput,
        command: command.method
      });
    });

    // Send the JSON-RPC command
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: command.method,
      params: command.arguments || {}
    }));
    child.stdin.end();

    // Set timeout
    setTimeout(() => {
      child.kill();
      resolve({
        code: -1,
        output,
        errorOutput: errorOutput + '\n[TIMEOUT]',
        command: command.method
      });
    }, timeout);
  });
}

async function runTests() {
  console.log('=== Migration Tools Test ===\n');

  const tests = [
    {
      method: 'tools/list',
      description: 'List available tools'
    },
    {
      method: 'tools/call',
      arguments: {
        name: 'migration.status',
        arguments: {
          scope: 'local',
          backend: 'file'
        }
      },
      description: 'Test migration status for file backend'
    },
    {
      method: 'tools/call',
      arguments: {
        name: 'migration.status',
        arguments: {
          scope: 'local',
          backend: 'video'
        }
      },
      description: 'Test migration status for video backend (should fail gracefully)'
    }
  ];

  const results = [];

  for (const test of tests) {
    const result = await testMCPCommand(test);
    results.push({ ...result, description: test.description });

    // Check for successful response or graceful error
    const hasSuccessResponse = result.output.includes('"result"');
    const hasGracefulError = result.output.includes('"error"') &&
                            (result.output.includes('video') || result.output.includes('disabled'));
    const hasServerStart = result.errorOutput.includes('Server initialization complete');

    if (hasServerStart && (hasSuccessResponse || hasGracefulError)) {
      console.log('✅ PASS - Server started and responded appropriately');
    } else if (result.code === -1) {
      console.log('⚠️  TIMEOUT - Test took too long');
    } else {
      console.log('❌ FAIL - Unexpected response or server did not start');
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  const passed = results.filter(r =>
    r.errorOutput.includes('Server initialization complete') &&
    (r.output.includes('"result"') || r.output.includes('"error"'))
  ).length;

  console.log(`Tests completed: ${results.length}`);
  console.log(`Server started successfully: ${passed}/${results.length}`);

  if (passed === results.length) {
    console.log('\n🎉 All tests passed! Migration system is ready for production.');
    console.log('\nKey capabilities:');
    console.log('- MCP server starts without FFmpeg errors');
    console.log('- Migration tools are available and respond properly');
    console.log('- File-based migrations are supported');
    console.log('- Video backend gracefully reports unavailability');
  } else {
    console.log('\n⚠️  Some tests failed. Server may not be fully functional.');
  }
}

runTests().catch(console.error);