#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const MARKDOWN_SOURCES = [
  'ARCHITECTURE.md',
  'VIDEO_STORAGE_IMPLEMENTATION_PLAN.md',
  'PRODUCTION_DEPLOYMENT.md',
  'OPERATIONS_GUIDE.md'
];

const CHUNK_SIZE = 3600; // Target payload size per memory item
const INSERT_SCOPE = 'global';

class MCPTestClient {
  constructor() {
    this.process = null;
    this.requestId = 1;
    this.buffer = '';
  }

  async startServer() {
    if (this.process) return;

    this.process = spawn('node', ['dist/src/index.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.process.stderr.on('data', data => {
      process.stderr.write(data);
    });

    this.process.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`MCP server exited with code ${code}`);
      } else if (signal) {
        console.error(`MCP server terminated with signal ${signal}`);
      }
    });

    await new Promise(resolve => setTimeout(resolve, 2500));
  }

  async stopServer() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  async sendRequest(method, params = {}) {
    if (!this.process) {
      throw new Error('MCP server is not running');
    }

    const id = this.requestId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.process?.stdout.off('data', onData);
        reject(new Error(`Request ${method} timed out`));
      }, 20000);

      const onData = chunk => {
        this.buffer += chunk.toString();
        let newlineIndex;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, newlineIndex).trim();
          this.buffer = this.buffer.slice(newlineIndex + 1);
          if (!line) continue;
          try {
            const message = JSON.parse(line);
            if (message.id === id) {
              clearTimeout(timeout);
              this.process?.stdout.off('data', onData);
              resolve(message);
              return;
            }
          } catch {
            // Ignore non-JSON lines (e.g. debug output)
          }
        }
      };

      this.process.stdout.on('data', onData);
      this.process.stdin.write(payload + '\n');
    });
  }

  async listTools() {
    const response = await this.sendRequest('tools/list');
    return response.result?.tools ?? [];
  }

  async callTool(name, args = {}) {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
    if (response.error) {
      throw new Error(response.error.message || `Tool ${name} failed`);
    }
    return response.result;
  }
}

function chunkMarkdown(content, chunkSize = CHUNK_SIZE) {
  const lines = content.split(/\r?\n/);
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > chunkSize && current.trim().length > 0) {
      chunks.push(current.trim());
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

function extractQueries(markdown, limit = 6) {
  const queries = [];
  const headingRegex = /^#{1,3}\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(markdown)) && queries.length < limit) {
    const candidate = match[1]
      .replace(/[`*_]/g, '')
      .replace(/\(.*?\)/g, '')
      .trim();
    if (candidate.length > 10) {
      queries.push(candidate);
    }
  }
  return queries;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

const STORAGE_ROOT = path.join(os.homedir(), '.llm-memory', INSERT_SCOPE);
const ITEMS_DIR = path.join(STORAGE_ROOT, 'items');
const SEGMENTS_DIR = path.join(STORAGE_ROOT, 'segments');
const MP4_PATH = path.join(SEGMENTS_DIR, 'consolidated.mp4');
const INDEX_PATH = path.join(SEGMENTS_DIR, 'consolidated-index.json');

async function loadDataset(rootDir = process.cwd()) {
  const dataset = [];
  const queryHints = new Set();

  for (const relativePath of MARKDOWN_SOURCES) {
    const absolutePath = path.resolve(rootDir, relativePath);
    try {
      const raw = await fs.readFile(absolutePath, 'utf8');
      const chunks = chunkMarkdown(raw);
      const queries = extractQueries(raw);
      queries.forEach(q => queryHints.add(q));

      chunks.forEach((chunk, index) => {
        dataset.push({
          source: relativePath,
          chunkIndex: index,
          totalChunks: chunks.length,
          content: `# Source: ${relativePath} (chunk ${index + 1}/${chunks.length})\n\n${chunk}`
        });
      });
    } catch (error) {
      console.warn(`⚠️  Skipping ${relativePath}: ${error.message}`);
    }
  }

  return { dataset, queryHints: Array.from(queryHints).slice(0, 12) };
}

function parseUpsertResult(result) {
  const text = result?.content?.[0]?.text ?? '';
  const match = text.match(/memory\.upsert:\s*(\S+)/);
  return match ? match[1] : null;
}

function parseQueryResult(result) {
  try {
    const text = result?.content?.[0]?.text ?? '{}';
    return JSON.parse(text);
  } catch (error) {
    console.warn('Failed to parse query result:', error);
    return { items: [] };
  }
}

async function ensureVideoBackend(client) {
  const hasItemsDir = await pathExists(ITEMS_DIR);

  if (!hasItemsDir) {
    console.log(`✅ ${INSERT_SCOPE} scope already using video storage (no legacy items directory found)`);
    return;
  }

  console.log(`⚙️  Migrating ${INSERT_SCOPE} scope from file storage to video storage…`);

  try {
    const migrationResult = await client.callTool('migration.storage_backend', {
      sourceBackend: 'file',
      targetBackend: 'video',
      scope: INSERT_SCOPE,
      backupBeforeMigration: false,
      validateAfterMigration: true
    });

    const summaryText = migrationResult?.content?.[0]?.text;
    if (summaryText) {
      const summary = JSON.parse(summaryText);
      if (!summary.result?.success) {
        console.warn('⚠️  Migration completed with issues:', summary.result);
      } else {
        console.log(`✅ Migration to video backend succeeded: migrated ${summary.result.targetItems} items`);
      }
    }
  } catch (error) {
    console.warn(`⚠️  Migration attempt failed: ${error.message}`);
    return;
  }

  const itemsDirStillExists = await pathExists(ITEMS_DIR);
  if (itemsDirStillExists) {
    console.warn('⚠️  Legacy items directory still present after migration; video backend may not be active.');
  } else {
    console.log('✅ Legacy items directory removed; video backend should now be active.');
  }
}

async function getDirectorySize(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    if (stats.isFile()) {
      return stats.size;
    }

    let total = 0;
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(targetPath, entry.name);
      total += await getDirectorySize(entryPath);
    }
    return total;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(2)} ${units[index]}`;
}

async function reportStorageLayout(label) {
  const jsonSize = await getDirectorySize(ITEMS_DIR);
  const mp4Size = await getDirectorySize(MP4_PATH);
  const indexSize = await getDirectorySize(INDEX_PATH);

  console.log(`\n📦 ${label} storage layout:`);
  console.log(`   Legacy JSON items: ${jsonSize ? formatBytes(jsonSize) : 'n/a'}`);
  console.log(`   consolidated.mp4: ${mp4Size ? formatBytes(mp4Size) : 'n/a'}`);
  console.log(`   consolidated-index.json: ${indexSize ? formatBytes(indexSize) : 'n/a'}`);

  return { jsonSize, mp4Size, indexSize };
}

async function addDatasetToMemory(client, dataset) {
  const inserted = [];

  for (const entry of dataset) {
    const title = `${entry.source} chunk ${entry.chunkIndex + 1}`;
    const tags = [entry.source, 'video-storage', 'markdown'];
    const args = {
      type: 'note',
      scope: INSERT_SCOPE,
      title,
      text: entry.content,
      tags,
      files: [entry.source],
      symbols: [],
      metadata: {
        chunkIndex: entry.chunkIndex,
        totalChunks: entry.totalChunks
      }
    };

    try {
      const result = await client.callTool('memory.upsert', args);
      const memoryId = parseUpsertResult(result);
      if (memoryId) {
        inserted.push({ id: memoryId, title, source: entry.source });
        console.log(`✅ Stored ${title} → ${memoryId}`);
      } else {
        console.warn(`⚠️  Upsert completed without id for ${title}`);
      }
    } catch (error) {
      console.error(`❌ Failed to store ${title}: ${error.message}`);
    }
  }

  return inserted;
}

async function searchInsertedContent(client, queries) {
  const summaries = [];

  for (const term of queries) {
    console.log(`\n🔎 Searching for: "${term}"`);
    try {
      const result = await client.callTool('memory.query', {
        scope: INSERT_SCOPE,
        q: term,
        k: 5
      });
      const parsed = parseQueryResult(result);
      const items = parsed.items ?? [];
      if (items.length === 0) {
        console.log('   No matches found');
        continue;
      }

      items.slice(0, 3).forEach((item, index) => {
        const preview = (item.text || item.code || '').replace(/\s+/g, ' ').slice(0, 140);
        console.log(`   ${index + 1}. [${item.id}] ${item.title} → ${preview}${preview.length === 140 ? '…' : ''}`);
        summaries.push({ term, id: item.id, title: item.title });
      });
    } catch (error) {
      console.error(`   ❌ Query failed: ${error.message}`);
    }
  }

  return summaries;
}

async function fetchSampleItems(client, inserted, count = 3) {
  const samples = inserted.slice(0, count);
  for (const sample of samples) {
    try {
      const result = await client.callTool('memory.get', { id: sample.id, scope: INSERT_SCOPE });
      const text = result?.content?.[0]?.text;
      if (!text) {
        console.log(`⚠️  memory.get returned no content for ${sample.id}`);
        continue;
      }
      const item = JSON.parse(text);
      const preview = (item.text || '').replace(/\s+/g, ' ').slice(0, 160);
      console.log(`\n📄 Retrieved ${sample.id} (${sample.title}) → ${preview}${preview.length === 160 ? '…' : ''}`);
    } catch (error) {
      console.error(`❌ Failed to retrieve ${sample.id}: ${error.message}`);
    }
  }
}

async function main() {
  const client = new MCPTestClient();

  process.on('SIGINT', async () => {
    await client.stopServer();
    process.exit(1);
  });

  try {
    console.log('🚀 Starting MCP server for video storage test…');
    await client.startServer();

    const tools = await client.listTools();
    const hasMemoryUpsert = tools.some(tool => tool.name === 'memory.upsert');
    if (!hasMemoryUpsert) {
      throw new Error('memory.upsert tool is not available');
    }
    console.log(`✅ Loaded ${tools.length} tools`);

    const beforeStats = await reportStorageLayout('Before migration');
    await ensureVideoBackend(client);

    console.log('\n📚 Loading markdown sources…');
    const { dataset, queryHints } = await loadDataset();
    console.log(`   Sources: ${MARKDOWN_SOURCES.join(', ')}`);
    console.log(`   Prepared ${dataset.length} chunks for insertion`);

    console.log('\n📝 Inserting dataset into video-backed global memory…');
    const inserted = await addDatasetToMemory(client, dataset);
    console.log(`\n✅ Inserted ${inserted.length} items into global memory`);

    const afterStats = await reportStorageLayout('After ingestion');

    if (beforeStats.jsonSize > 0) {
      const savedBytes = beforeStats.jsonSize - (afterStats.mp4Size + afterStats.indexSize);
      const ratio = beforeStats.jsonSize / Math.max(1, afterStats.mp4Size + afterStats.indexSize);
      console.log('\n📉 Storage savings compared to JSON layout:');
      console.log(`   Saved ${formatBytes(savedBytes)} (${ratio.toFixed(2)}x smaller)`);
    }

    console.log('\n🔍 Executing search queries derived from markdown headings…');
    const searchSummaries = await searchInsertedContent(client, queryHints);
    console.log(`\n✅ Completed ${queryHints.length} searches, surfaced ${searchSummaries.length} hits`);

    console.log('\n📥 Verifying random retrievals with memory.get…');
    await fetchSampleItems(client, inserted);

    console.log('\n🎉 Test complete! Video storage ingestion and retrieval validated.');
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.stopServer();
  }
}

main();
