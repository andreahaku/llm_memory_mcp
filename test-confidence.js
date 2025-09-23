#!/usr/bin/env node

import { spawn } from 'child_process';
import { readFileSync } from 'fs';

// Simple MCP client to test confidence scoring
function sendMCPRequest(tool, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['dist/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe']
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

    // Send initialize request
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

    // Send tool request
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

async function testConfidenceScoring() {
  console.log('🧪 Testing Confidence Scoring Implementation\n');

  try {
    // Test 1: Create a memory item
    console.log('1️⃣ Creating a test memory item...');
    const createResponse = await sendMCPRequest('memory.upsert', {
      type: 'snippet',
      scope: 'local',
      title: 'Test React Component',
      text: 'A reusable button component for React applications',
      code: 'const Button = ({ children, onClick }) => <button onClick={onClick}>{children}</button>;',
      language: 'javascript',
      tags: ['react', 'component', 'ui'],
      files: ['src/components/Button.jsx'],
      symbols: ['Button']
    });
    console.log('✅ Memory item created');

    // Extract the ID from the response
    const createText = createResponse[1].result.content[0].text;
    const itemId = createText.split(': ')[1];
    console.log(`   ID: ${itemId}`);

    // Test 2: Record usage to increase confidence
    console.log('\n2️⃣ Recording usage events...');
    for (let i = 0; i < 3; i++) {
      await sendMCPRequest('memory.use', { id: itemId, scope: 'local' });
    }
    console.log('✅ Recorded 3 usage events');

    // Test 3: Add positive feedback
    console.log('\n3️⃣ Adding positive feedback...');
    await sendMCPRequest('memory.feedback', { id: itemId, helpful: true, scope: 'local' });
    console.log('✅ Added positive feedback');

    // Test 4: Search to see if confidence affects ranking
    console.log('\n4️⃣ Testing search ranking with confidence...');
    const searchResponse = await sendMCPRequest('memory.query', {
      q: 'react component',
      scope: 'local',
      k: 5
    });

    const searchResult = JSON.parse(searchResponse[1].result.content[0].text);
    console.log('✅ Search completed');
    console.log(`   Found ${searchResult.items.length} items`);

    if (searchResult.items.length > 0) {
      const item = searchResult.items[0];
      console.log(`   Top result confidence: ${item.quality.confidence.toFixed(3)}`);
      console.log(`   Usage count: ${item.quality.reuseCount}`);
      console.log(`   Helpful feedback: ${item.quality.helpfulCount || 0}`);
    }

    // Test 5: Create another item with no usage/feedback
    console.log('\n5️⃣ Creating a second item for comparison...');
    const create2Response = await sendMCPRequest('memory.upsert', {
      type: 'snippet',
      scope: 'local',
      title: 'Test Vue Component',
      text: 'A Vue component example',
      code: 'const Button = { template: "<button @click=\\"onClick\\"><slot></slot></button>" };',
      language: 'javascript',
      tags: ['vue', 'component'],
    });
    console.log('✅ Second memory item created');

    // Test 6: Search again to compare confidence scores
    console.log('\n6️⃣ Comparing confidence scores...');
    const searchResponse2 = await sendMCPRequest('memory.query', {
      q: 'component',
      scope: 'local',
      k: 10
    });

    const searchResult2 = JSON.parse(searchResponse2[1].result.content[0].text);
    console.log('✅ Comparison search completed');
    console.log(`   Found ${searchResult2.items.length} items`);

    if (searchResult2.items.length >= 2) {
      searchResult2.items.forEach((item, index) => {
        console.log(`   Item ${index + 1}: confidence=${item.quality.confidence.toFixed(3)}, ` +
                   `usage=${item.quality.reuseCount}, helpful=${item.quality.helpfulCount || 0}`);
      });
    }

    console.log('\n🎉 Confidence scoring test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }

  return true;
}

// Run the test
testConfidenceScoring().then(success => {
  process.exit(success ? 0 : 1);
});