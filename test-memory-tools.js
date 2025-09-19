#!/usr/bin/env node

// Minimal integration check for new memory.* tools via stdio
import { spawn } from 'node:child_process';

async function testMemoryTools() {
  console.log('🧪 Testing memory.* tools over MCP stdio');
  const server = spawn('node', ['dist/index.js']);
  const responses = [];
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (data) => {
    for (const line of data.trim().split('\n')) {
      try { responses.push(JSON.parse(line)); } catch {}
    }
  });
  server.stderr.on('data', d => process.stderr.write(d));

  function send(obj) { server.stdin.write(JSON.stringify(obj) + '\n'); }

  // 1) list tools
  send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  await new Promise(r => setTimeout(r, 300));

  // 2) upsert an item
  send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory.upsert', arguments: {
    type: 'note', scope: 'local', title: 'Test Note', text: 'Hello memory!', tags: ['test','example']
  }}});
  await new Promise(r => setTimeout(r, 300));

  // 3) list project items
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory.list', arguments: { scope: 'project' } } });
  await new Promise(r => setTimeout(r, 300));

  // 4) query items
  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'memory.query', arguments: { q: 'hello', scope: 'project', k: 5 } } });
  await new Promise(r => setTimeout(r, 500));

  console.log(`\n📊 Received ${responses.length} responses:`);
  for (const res of responses) {
    if (res.error) console.log('❌', res.error.message);
    else if (res.result?.tools) console.log('✅ tools/list ok:', res.result.tools.map(t => t.name).join(', '));
    else if (res.result?.content) console.log('✅', res.id, String(res.result.content[0].text).slice(0, 120));
  }

  server.kill();
}

testMemoryTools().catch(err => { console.error(err); process.exit(1); });

