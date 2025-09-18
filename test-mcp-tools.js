#!/usr/bin/env node

// Simple MCP tool testing simulation
import { spawn } from 'child_process';

async function testMCPTools() {
  console.log('🧪 Testing MCP Server Tools Interface\n');

  const server = spawn('node', ['dist/index.js'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let responseCount = 0;
  const responses = [];

  server.stdout.on('data', (data) => {
    try {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => {
        if (line.trim()) {
          try {
            const response = JSON.parse(line);
            responses.push(response);
            responseCount++;
          } catch (e) {
            // Not JSON, might be log output
          }
        }
      });
    } catch (error) {
      console.error('Error parsing response:', error);
    }
  });

  server.stderr.on('data', (data) => {
    const output = data.toString();
    if (output.includes('MCP server running')) {
      console.log('✅ MCP Server started successfully');
    }
  });

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 1: List tools
  console.log('1️⃣ Testing list tools...');
  const listToolsRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  };

  server.stdin.write(JSON.stringify(listToolsRequest) + '\n');

  // Test 2: Create a note using tool call
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('2️⃣ Testing kb.create tool...');

  const createNoteRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'kb.create',
      arguments: {
        type: 'note',
        title: 'MCP Test Note',
        content: 'This note was created via MCP tool call',
        scope: 'global',
        tags: ['mcp', 'test']
      }
    }
  };

  server.stdin.write(JSON.stringify(createNoteRequest) + '\n');

  // Test 3: List notes
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('3️⃣ Testing kb.list tool...');

  const listNotesRequest = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'kb.list',
      arguments: {
        scope: 'all'
      }
    }
  };

  server.stdin.write(JSON.stringify(listNotesRequest) + '\n');

  // Test 4: Search notes
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('4️⃣ Testing kb.search tool...');

  const searchRequest = {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'kb.search',
      arguments: {
        q: 'MCP',
        scope: 'all'
      }
    }
  };

  server.stdin.write(JSON.stringify(searchRequest) + '\n');

  // Test 5: Get project info
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('5️⃣ Testing project.info tool...');

  const projectInfoRequest = {
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: {
      name: 'project.info',
      arguments: {}
    }
  };

  server.stdin.write(JSON.stringify(projectInfoRequest) + '\n');

  // Wait for responses
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Analyze responses
  console.log(`\n📊 Received ${responses.length} responses:`);

  responses.forEach((response, index) => {
    if (response.result) {
      if (response.id === 1 && response.result.tools) {
        console.log(`✅ Test ${response.id}: Listed ${response.result.tools.length} tools`);
        const toolNames = response.result.tools.map(tool => tool.name);
        console.log(`   Available tools: ${toolNames.join(', ')}`);
      } else if (response.id === 2 && response.result.content) {
        console.log(`✅ Test ${response.id}: Created note successfully`);
        console.log(`   Result: ${response.result.content[0].text}`);
      } else if (response.id === 3 && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        console.log(`✅ Test ${response.id}: Listed ${content.total} notes`);
      } else if (response.id === 4 && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        console.log(`✅ Test ${response.id}: Search found ${content.notes.length} results`);
      } else if (response.id === 5 && response.result.content) {
        const content = JSON.parse(response.result.content[0].text);
        console.log(`✅ Test ${response.id}: Project info retrieved`);
        console.log(`   Project: ${content.name} (${content.id})`);
      }
    } else if (response.error) {
      console.log(`❌ Test ${response.id}: Error - ${response.error.message}`);
    }
  });

  // Cleanup
  server.kill();
  console.log('\n🎉 MCP Tools testing completed!');
}

testMCPTools().catch(console.error);