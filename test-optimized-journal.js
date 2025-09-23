#!/usr/bin/env node

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';

// Test directory for isolated testing
const testDir = './test-journal-optimization';

// Simple MCP client to test optimized journal
function sendMCPRequest(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        LLM_MEMORY_HOME_DIR: testDir,
        LLM_MEMORY_SKIP_STARTUP_REPLAY: '1'
      }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Process exited with code ${code}\nstderr: ${stderr}`));
        return;
      }

      try {
        const lines = stdout.trim().split('\n').filter(line => line.trim());
        const responses = lines.map(line => JSON.parse(line));
        resolve(responses);
      } catch (err) {
        reject(new Error(`Failed to parse JSON response: ${err.message}\nstdout: ${stdout}`));
      }
    });

    // Send initialize and tool requests
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    };

    const toolRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: tool, arguments: args }
    };

    child.stdin.write(JSON.stringify(initRequest) + '\n');
    child.stdin.write(JSON.stringify(toolRequest) + '\n');
    child.stdin.end();
  });
}

// Helper to create legacy journal for testing migration
function createLegacyJournal(directory) {
  const journalPath = path.join(directory, 'journal.ndjson');
  const entries = [
    {
      op: 'upsert',
      item: {
        id: '01TEST1',
        type: 'snippet',
        scope: 'local',
        title: 'Test Legacy Item 1',
        text: 'This is a test item for migration',
        code: 'console.log("legacy test");',
        language: 'javascript',
        facets: { tags: ['test', 'legacy'], files: [], symbols: [] },
        context: {},
        quality: { confidence: 0.75, reuseCount: 0, pinned: false },
        security: { sensitivity: 'private' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        version: 1
      },
      ts: '2024-01-01T00:00:00.000Z',
      actor: 'test'
    },
    {
      op: 'upsert',
      item: {
        id: '01TEST2',
        type: 'pattern',
        scope: 'local',
        title: 'Test Legacy Item 2',
        text: 'Another test item',
        facets: { tags: ['pattern'], files: [], symbols: [] },
        context: {},
        quality: { confidence: 0.8, reuseCount: 5, pinned: true },
        security: { sensitivity: 'private' },
        createdAt: '2024-01-01T01:00:00.000Z',
        updatedAt: '2024-01-01T01:00:00.000Z',
        version: 1
      },
      ts: '2024-01-01T01:00:00.000Z',
      actor: 'test'
    },
    {
      op: 'delete',
      id: '01TEST2',
      ts: '2024-01-01T02:00:00.000Z',
      actor: 'test'
    }
  ];

  const content = entries.map(entry => JSON.stringify(entry)).join('\n') + '\n';
  writeFileSync(journalPath, content);
}

async function testOptimizedJournal() {
  console.log('🧪 Testing Optimized Journal System\n');

  try {
    // Clean up test directory
    if (existsSync(testDir)) {
      const { execSync } = await import('child_process');
      execSync(`rm -rf ${testDir}`);
    }

    // Test 1: Check journal stats before any operations
    console.log('1️⃣ Testing journal stats with no journals...');
    const emptyStatsResponse = await sendMCPRequest('journal.stats', { scope: 'all' });
    const emptyStats = JSON.parse(emptyStatsResponse[1].result.content[0].text);
    console.log('✅ Empty stats retrieved');
    console.log(`   • Migrations needed: ${emptyStats.summary.migrationsNeeded}`);

    // Test 2: Create a memory item using optimized journal
    console.log('\n2️⃣ Creating memory items with optimized journal...');
    const createResponse = await sendMCPRequest('memory.upsert', {
      type: 'snippet',
      scope: 'local',
      title: 'Optimized Test Item',
      text: 'This item was created with the optimized journal system',
      code: 'console.log("optimized!");',
      language: 'javascript',
      tags: ['test', 'optimized']
    });
    console.log('✅ Memory item created with optimized journal');

    // Test 3: Check journal stats after creation
    console.log('\n3️⃣ Checking journal stats after creation...');
    const statsResponse = await sendMCPRequest('journal.stats', { scope: 'local' });
    const stats = JSON.parse(statsResponse[1].result.content[0].text);
    console.log('✅ Journal stats retrieved');
    console.log(`   • Optimized entries: ${stats.optimized.entries}`);
    console.log(`   • Optimized size: ${stats.optimized.sizeBytes} bytes`);

    // Test 4: Verify integrity
    console.log('\n4️⃣ Verifying journal integrity...');
    const verifyResponse = await sendMCPRequest('journal.verify', { scope: 'local' });
    const verifyResult = JSON.parse(verifyResponse[1].result.content[0].text);
    console.log('✅ Integrity verification completed');
    console.log(`   • Valid: ${verifyResult.valid}`);
    console.log(`   • Integrity score: ${verifyResult.integrityScore.toFixed(3)}`);
    console.log(`   • Checked items: ${verifyResult.checkedCount}`);

    // Test 5: Create legacy journal and test migration
    console.log('\n5️⃣ Testing legacy journal migration...');

    // Create a separate test directory with legacy journal
    const legacyTestDir = `${testDir}/legacy-test`;
    const { execSync } = await import('child_process');
    execSync(`mkdir -p ${legacyTestDir}/items ${legacyTestDir}/index`);

    createLegacyJournal(legacyTestDir);
    console.log('   • Created legacy journal with 3 entries');

    // Test migration via MCP
    const migrateResponse = await sendMCPRequest('journal.migrate', { scope: 'local' });
    const migrateResult = JSON.parse(migrateResponse[1].result.content[0].text);
    console.log('✅ Migration completed');
    console.log(`   • Migrated entries: ${migrateResult.migrated}`);
    console.log(`   • Size reduction: ${migrateResult.sizeReduction.percentage.toFixed(1)}%`);
    console.log(`   • Before: ${migrateResult.sizeReduction.before} bytes`);
    console.log(`   • After: ${migrateResult.sizeReduction.after} bytes`);

    // Test 6: Final stats check
    console.log('\n6️⃣ Final journal statistics...');
    const finalStatsResponse = await sendMCPRequest('journal.stats', { scope: 'all' });
    const finalStats = JSON.parse(finalStatsResponse[1].result.content[0].text);
    console.log('✅ Final stats retrieved');
    console.log(`   • Total legacy size: ${finalStats.summary.totalLegacySize} bytes`);
    console.log(`   • Total optimized size: ${finalStats.summary.totalOptimizedSize} bytes`);
    console.log(`   • Overall reduction: ${finalStats.summary.totalReduction.toFixed(1)}%`);

    console.log('\n🎉 All optimized journal tests completed successfully!');

    return true;

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  } finally {
    // Clean up test directory
    if (existsSync(testDir)) {
      const { execSync } = await import('child_process');
      execSync(`rm -rf ${testDir}`);
    }
  }
}

// Run the test
testOptimizedJournal().then(success => {
  process.exit(success ? 0 : 1);
});