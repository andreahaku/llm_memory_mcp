#!/usr/bin/env node
/*
 End-to-end test suite for MCP tools (committed scope only to avoid homedir sandbox).
*/
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const server = spawn('node', ['dist/index.js'], { env: { ...process.env, LLM_MEMORY_HOME_DIR: process.cwd(), LLM_MEMORY_SKIP_STARTUP_REPLAY: process.env.LLM_MEMORY_SKIP_STARTUP_REPLAY || '1' } });
server.stderr.setEncoding('utf8');
server.stdout.setEncoding('utf8');

const responses = new Map();
let nextId = 1;
let pass = 0, fail = 0;

server.stdout.on('data', (chunk) => {
  for (const line of chunk.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const msg = JSON.parse(s);
      if (msg.id && responses.has(msg.id)) {
        const { resolve } = responses.get(msg.id);
        resolve(msg);
        responses.delete(msg.id);
      } else {
        // ignore async notifications
      }
    } catch {}
  }
});

server.stderr.on('data', d => process.stderr.write(d));

function rpc(method, params) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) };
  server.stdin.write(JSON.stringify(payload) + '\n');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`timeout for ${method}`)); }, 20000);
    responses.set(id, { resolve: (msg) => { clearTimeout(timer); resolve(msg); } });
  });
}

async function callTool(name, args) {
  const res = await rpc('tools/call', { name, arguments: args || {} });
  if (res.error) throw new Error(`${name} error: ${res.error.message}`);
  return res.result;
}

async function listTools() {
  const res = await rpc('tools/list');
  if (res.error) throw new Error(`tools/list error: ${res.error.message}`);
  return res.result.tools.map(t => t.name);
}

async function readResource(uri) {
  const res = await rpc('resources/read', { uri });
  if (res.error) throw new Error(`resources/read error: ${res.error.message}`);
  return res.result.contents?.[0]?.text || res.result.contents?.[0]?.uri;
}

function assert(cond, msg) {
  if (cond) { pass++; console.log(`✅ ${msg}`); }
  else { fail++; console.log(`❌ ${msg}`); }
}

function parseIdFromResult(result) {
  try {
    const text = result?.content?.[0]?.text || '';
    const idx = text.lastIndexOf(':');
    if (idx >= 0) return text.slice(idx + 1).trim();
  } catch {}
  return null;
}

async function main() {
  // Give server more time to initialize in sandboxed environments
  await new Promise(r => setTimeout(r, 1500));
  // Redirect local scope home to project to avoid homedir permissions
  process.env.LLM_MEMORY_HOME_DIR = process.cwd();
  const tools = await listTools();
  assert(tools.includes('project.initCommitted'), 'tools include project.initCommitted');

  // Initialize committed KB in project
  await callTool('project.initCommitted', {});
  assert(true, 'project.initCommitted ran');

  // Upsert two items in committed scope
  const r1 = await callTool('memory.upsert', { type: 'snippet', scope: 'committed', title: 'Test Snippet', language: 'typescript', code: 'export const x = 1;', tags: ['test','ts'], sensitivity: 'team' });
  const id1 = parseIdFromResult(r1);
  assert(!!id1, 'memory.upsert returned id1');

  const r2 = await callTool('memory.upsert', { type: 'pattern', scope: 'committed', title: 'Pattern A', text: 'Use debounce for typing events', tags: ['pattern','ux'], sensitivity: 'team' });
  const id2 = parseIdFromResult(r2);
  assert(!!id2, 'memory.upsert returned id2');

  // Link items
  await callTool('memory.link', { from: id1, to: id2, rel: 'refines' });
  assert(true, 'memory.link ok');

  // Pin and unpin
  await callTool('memory.pin', { id: id1 });
  await callTool('memory.unpin', { id: id1 });
  assert(true, 'memory.pin/unpin ok');

  // List committed
  const list = await callTool('memory.list', { scope: 'committed' });
  const listObj = JSON.parse(list.content[0].text);
  assert(listObj.total >= 2, 'memory.list returned >=2');

  // Query
  const q = await callTool('memory.query', { q: 'debounce', scope: 'committed', k: 10 });
  const qObj = JSON.parse(q.content[0].text);
  assert(qObj.items && qObj.items.length >= 1, 'memory.query returned results');

  // Context pack
  const pack = await callTool('memory.contextPack', { q: 'debounce', scope: 'committed', k: 5, tokenBudget: 500 });
  const packObj = JSON.parse(pack.content[0].text);
  assert(Array.isArray(packObj.snippets), 'memory.contextPack returned snippets');

  // Vectors: bulk import first to establish dimension cleanly

  // Bulk vectors via items
  // Reset vector store to ensure clean dimension
  const idxDir = resolve(process.cwd(), '.llm-memory', 'index');
  const vecPath = resolve(idxDir, 'vectors.json');
  const vecMeta = resolve(idxDir, 'vectors.meta.json');
  try { if (existsSync(vecPath)) unlinkSync(vecPath); } catch {}
  try { if (existsSync(vecMeta)) unlinkSync(vecMeta); } catch {}
  const bulkRes = await callTool('vectors.importBulk', { scope: 'committed', dim: 2, items: [ { id: id1, vector: [0.1,0.2] }, { id: id2, vector: [0.2,0.1] } ] });
  const bulkObj = JSON.parse(bulkRes.content[0].text);
  assert(bulkObj.ok === 2, 'vectors.importBulk ok==2');

  // Bulk vectors via JSONL
  const jsonlPath = resolve(process.cwd(), '.llm-memory', 'vectors.jsonl');
  const jsonl = `{"id":"${id1}","vector":[0.1,0.2]}\n{"id":"${id2}","vector":[0.2,0.1]}\n`;
  writeFileSync(jsonlPath, jsonl, 'utf8');
  const impRes = await callTool('vectors.importJsonl', { scope: 'committed', path: jsonlPath, dim: 2 });
  const impObj = JSON.parse(impRes.content[0].text);
  assert(impObj.ok === 2, 'vectors.importJsonl ok==2');

  // Project info
  const pinfo = await callTool('project.info', {});
  assert(!!pinfo, 'project.info ok');

  // Maintenance: compact + verify
  await callTool('maintenance.compactSnapshot', { scope: 'project' });
  const verify = await callTool('maintenance.verify', { scope: 'project' });
  const verObj = JSON.parse(verify.content[0].text);
  assert(verObj.committed?.ok && verObj.local?.ok !== undefined, 'maintenance.verify reported statuses');

  // Resources: list and read
  const resList = await rpc('resources/list');
  assert(Array.isArray(resList.result.resources), 'resources/list ok');
  const projRes = await readResource('kb://project/info');
  assert(!!projRes, 'resources/read kb://project/info ok');
  const ctxRes = await readResource('kb://context/pack?q=debounce&scope=project&k=5');
  assert(!!ctxRes, 'resources/read kb://context/pack ok');

  console.log(`\nTests complete: ${pass} passed, ${fail} failed`);
  try { server.kill(); } catch {}
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); server.kill(); process.exit(1); });
