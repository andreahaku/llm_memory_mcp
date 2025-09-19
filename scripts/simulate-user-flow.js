#!/usr/bin/env node
/*
 Simulates a typical JS/TS developer session using the MCP server with committed scope.
*/
import { spawn } from 'node:child_process';

const server = spawn('node', ['dist/index.js']);
server.stderr.setEncoding('utf8');
server.stdout.setEncoding('utf8');
let nextId = 1;
const pending = new Map();

server.stdout.on('data', (chunk) => {
  for (const line of chunk.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const msg = JSON.parse(s);
      if (msg.id && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        resolve(msg);
        pending.delete(msg.id);
      }
    } catch {}
  }
});
server.stderr.on('data', d => process.stderr.write(d));

function rpc(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
  server.stdin.write(JSON.stringify(payload) + '\n');
  return new Promise((resolve) => pending.set(id, { resolve }));
}

async function tool(name, args) {
  const res = await rpc('tools/call', { name, arguments: args || {} });
  return res.result;
}

function idFrom(res) {
  try { return res.content[0].text.split(':').pop().trim(); } catch { return ''; }
}

async function main() {
  console.log('Booting server...');
  await new Promise(r => setTimeout(r, 400));

  console.log('Init committed KB');
  await tool('project.initCommitted', {});

  console.log('Save snippets/patterns');
  const a = await tool('memory.upsert', { type:'snippet', scope:'committed', title:'Fetch util', language:'typescript', code:'export async function fetchJson(u){ /*...*/ }', tags:['http','util'] });
  const ida = idFrom(a);
  const b = await tool('memory.upsert', { type:'pattern', scope:'committed', title:'Debounce input', text:'Use debounce for input handlers', tags:['ui','react'] });
  const idb = idFrom(b);

  console.log('Link and pin');
  await tool('memory.link', { from: ida, to: idb, rel: 'relates' });
  await tool('memory.pin', { id: idb });

  console.log('Search and build context');
  const q = await tool('memory.query', { q:'debounce', scope:'project', k:10, filters:{ type:['pattern','snippet'] } });
  console.log(q.content[0].text);
  const pack = await tool('memory.contextPack', { q:'debounce', scope:'project', k:8, tokenBudget:2000, snippetLanguages:['typescript','tsx'] });
  console.log(pack.content[0].text.slice(0, 200) + '...');

  console.log('Maintenance: compact + snapshot');
  await tool('maintenance.compactSnapshot', { scope: 'project' });
  const verify = await tool('maintenance.verify', { scope: 'project' });
  console.log(verify.content[0].text);

  console.log('Done.');
  server.kill();
}

main().catch(err => { console.error(err); server.kill(); });

