#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode
} from '@modelcontextprotocol/sdk/types.js';

import { MemoryManager } from './MemoryManager.js';
import type { MemoryScope, MemoryQuery, MemoryType } from './types/Memory.js';

function log(message: string, ...args: any[]) {
  console.error(`[LLM-Memory] ${new Date().toISOString()} ${message}`, ...args);
}

class LLMKnowledgeBaseServer {
  private server: Server;
  private memory: MemoryManager;

  constructor() {
    this.server = new Server(
      {
        name: 'llm-memory-mcp',
        version: '1.0.0'
      }
    );

    log('Initializing LLM Memory MCP server');
    this.memory = new MemoryManager();
    this.setupHandlers();
    log('Server initialization complete');
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'memory.upsert',
          description: 'Create or update a memory item',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: ['snippet','pattern','config','insight','runbook','fact','note'] },
              scope: { type: 'string', enum: ['global','local','committed'] },
              title: { type: 'string' },
              text: { type: 'string' },
              code: { type: 'string' },
              language: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              files: { type: 'array', items: { type: 'string' } },
              symbols: { type: 'array', items: { type: 'string' } },
              confidence: { type: 'number' },
              pinned: { type: 'boolean' },
              sensitivity: { type: 'string', enum: ['public','team','private'] },
            },
            required: ['type','scope'],
            additionalProperties: true,
          },
        },
        {
          name: 'vectors.set',
          description: 'Set or update a vector embedding for an item',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              scope: { type: 'string', enum: ['global','local','committed'] },
              vector: { type: 'array', items: { type: 'number' } }
            },
            required: ['id','scope','vector'],
            additionalProperties: false
          },
        },
        {
          name: 'vectors.importBulk',
          description: 'Bulk import vectors for items (enforces consistent dimension)',
          inputSchema: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['global','local','committed'] },
              items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, vector: { type: 'array', items: { type: 'number' } } }, required: ['id','vector'] } },
              dim: { type: 'number' }
            },
            required: ['scope','items'],
            additionalProperties: false
          },
        },
        {
          name: 'vectors.importJsonl',
          description: 'Bulk import vectors from JSONL file; optional dimension override',
          inputSchema: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['global','local','committed'] },
              path: { type: 'string' },
              dim: { type: 'number' }
            },
            required: ['scope','path'],
            additionalProperties: false
          },
        },
        {
          name: 'vectors.remove',
          description: 'Remove a vector embedding for an item',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              scope: { type: 'string', enum: ['global','local','committed'] }
            },
            required: ['id','scope'],
            additionalProperties: false
          },
        },
        {
          name: 'memory.get',
          description: 'Fetch a memory item by id',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, scope: { type: 'string', enum: ['global','local','committed'] } },
            required: ['id'],
            additionalProperties: false,
          },
        },
        {
          name: 'memory.delete',
          description: 'Delete a memory item by id',
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string' }, scope: { type: 'string', enum: ['global','local','committed'] } },
            required: ['id'],
            additionalProperties: false,
          },
        },
        {
          name: 'memory.list',
          description: 'List memory summaries',
          inputSchema: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['global','local','committed','project','all'] },
              limit: { type: 'number' },
            },
            additionalProperties: false,
          },
        },
        {
          name: 'memory.query',
          description: 'Search memory with filters and ranking',
          inputSchema: { type: 'object' },
        },
        {
          name: 'memory.link',
          description: 'Link two memory items',
          inputSchema: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              rel: { type: 'string', enum: ['refines','duplicates','depends','fixes','relates'] },
            },
            required: ['from','to','rel'],
            additionalProperties: false,
          },
        },
        {
          name: 'memory.pin',
          description: 'Pin a memory item for priority ranking',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
        {
          name: 'memory.unpin',
          description: 'Unpin a memory item',
          inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        },
        {
          name: 'memory.tag',
          description: 'Add or remove tags from a memory item',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              add: { type: 'array', items: { type: 'string' } },
              remove: { type: 'array', items: { type: 'string' } },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
        {
          name: 'memory.contextPack',
          description: 'Build an IDE-ready context pack from top-k results',
          inputSchema: {
            type: 'object',
            properties: {
              q: { type: 'string' },
              scope: { type: 'string', enum: ['global','local','committed','project','all'] },
              k: { type: 'number' },
              filters: { type: 'object' },
              snippetWindow: { type: 'object', properties: { before: { type: 'number' }, after: { type: 'number' } } },
              snippetLanguages: { type: 'array', items: { type: 'string' } },
              snippetFilePatterns: { type: 'array', items: { type: 'string' } },
              maxChars: { type: 'number', description: 'Optional content-length budget for the pack' }
              , tokenBudget: { type: 'number', description: 'Optional token budget (~4 chars per token heuristic)' }
            },
            additionalProperties: true,
          },
        },
        {
          name: 'project.info',
          description: 'Get current project information',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'project.initCommitted',
          description: 'Initialize committed memory under .llm-memory/',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'project.config.get',
          description: 'Read memory config (scope default: committed if available else local)',
          inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['global','local','committed'] } }, additionalProperties: false },
        },
        {
          name: 'project.config.set',
          description: 'Write memory config to scope',
          inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['global','local','committed'] }, config: { type: 'object' } }, required: ['scope','config'] },
        },
        {
          name: 'project.sync.status',
          description: 'Show differences between local and committed memories',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'project.sync.merge',
          description: 'Merge from local -> committed with sensitivity enforcement',
          inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
        },
        {
          name: 'maintenance.rebuild',
          description: 'Rebuild catalog and inverted index from on-disk items',
          inputSchema: {
            type: 'object',
            properties: { scope: { type: 'string', enum: ['global','local','committed','project','all'] } },
            additionalProperties: false,
          },
        },
        {
          name: 'maintenance.replay',
          description: 'Replay journal to rebuild catalog/index (optionally compact)',
          inputSchema: {
            type: 'object',
            properties: { scope: { type: 'string', enum: ['global','local','committed','project','all'] }, compact: { type: 'boolean' } },
            additionalProperties: false,
          },
        },
        {
          name: 'maintenance.compact',
          description: 'Compact journal by writing current state and truncating journal',
          inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['global','local','committed','project','all'] } }, additionalProperties: false },
        },
        {
          name: 'maintenance.snapshot',
          description: 'Write a snapshot marker (record lastTs) for fast startup replay',
          inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['global','local','committed','project','all'] } }, additionalProperties: false },
        },
        {
          name: 'maintenance.verify',
          description: 'Recompute checksum and compare with snapshot state; report consistency',
          inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['global','local','committed','project','all'] } }, additionalProperties: false },
        },
        {
          name: 'maintenance.compact.now',
          description: 'Trigger immediate compaction for a scope (alias of maintenance.compact)',
          inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['global','local','committed','project','all'] } }, additionalProperties: false },
        },
        {
          name: 'maintenance.compactSnapshot',
          description: 'One-click compaction + snapshot for fast recovery',
          inputSchema: { type: 'object', properties: { scope: { type: 'string', enum: ['global','local','committed','project','all'] } }, additionalProperties: false },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      log(`Tool called: ${name}`);

      if (!args) {
        throw new McpError(ErrorCode.InvalidRequest, 'Missing arguments');
      }

      try {
        switch (name) {
          case 'memory.upsert': {
            const scope = args.scope as MemoryScope;
            const type = args.type as MemoryType;
            const title = args.title as string || '(no title)';
            log(`Creating memory: type=${type}, scope=${scope}, title="${title}"`);

            const id = await this.memory.upsert({
              id: args.id as string | undefined,
              type: args.type as MemoryType,
              scope: args.scope as MemoryScope,
              title: args.title as string | undefined,
              text: args.text as string | undefined,
              code: args.code as string | undefined,
              language: args.language as string | undefined,
              facets: { tags: (args.tags as string[]) || [], files: (args.files as string[]) || [], symbols: (args.symbols as string[]) || [] },
              quality: { confidence: (args.confidence as number) ?? 0.75, reuseCount: 0, pinned: (args.pinned as boolean) ?? false },
              security: { sensitivity: (args.sensitivity as any) || 'private' },
            } as any);

            log(`Memory upserted successfully: id=${id}, scope=${scope}`);
            return { content: [{ type: 'text', text: `memory.upsert: ${id}` }] };
          }

          case 'memory.get': {
            const scope = args.scope ? ` scope=${args.scope}` : ' (any scope)';
            log(`Reading memory: id=${args.id}${scope}`);

            const item = await this.memory.get(args.id as string, args.scope as MemoryScope);
            if (!item) {
              log(`Memory not found: id=${args.id}`);
              throw new McpError(ErrorCode.InvalidRequest, `Item ${args.id} not found`);
            }

            log(`Memory found: id=${args.id}, scope=${item.scope}, type=${item.type}`);
            return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] };
          }

          case 'memory.delete': {
            const scope = args.scope ? ` scope=${args.scope}` : ' (any scope)';
            log(`Deleting memory: id=${args.id}${scope}`);

            const ok = await this.memory.delete(args.id as string, args.scope as MemoryScope);
            if (!ok) {
              log(`Memory deletion failed: id=${args.id} not found`);
              throw new McpError(ErrorCode.InvalidRequest, `Item ${args.id} not found`);
            }

            log(`Memory deleted successfully: id=${args.id}`);
            return { content: [{ type: 'text', text: `memory.delete: ${args.id}` }] };
          }

          case 'memory.list': {
            const scope = args.scope || 'project';
            const limit = args.limit || 'all';
            log(`Listing memories: scope=${scope}, limit=${limit}`);

            const list = await this.memory.list((args.scope as any) || 'project', args.limit as number | undefined);

            log(`Found ${list.length} memories in scope=${scope}`);
            return { content: [{ type: 'text', text: JSON.stringify({ total: list.length, items: list }, null, 2) }] };
          }

          case 'memory.query': {
            const query = args as MemoryQuery;
            const scope = query.scope || 'project';
            const searchTerm = query.q || '(no query)';
            const k = query.k || 50;
            log(`Searching memories: query="${searchTerm}", scope=${scope}, k=${k}`);

            const result = await this.memory.query(args as MemoryQuery);

            log(`Search completed: found ${result.items.length} results`);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          case 'memory.link': {
            const ok = await this.memory.link(args.from as string, args.rel as any, args.to as string);
            if (!ok) throw new McpError(ErrorCode.InvalidRequest, `memory.link failed for ${args.from} -> ${args.to}`);
            return { content: [{ type: 'text', text: 'memory.link: ok' }] };
          }

          case 'memory.pin': {
            const ok = await this.memory.setPinned(args.id as string, true);
            if (!ok) throw new McpError(ErrorCode.InvalidRequest, `memory.pin failed for ${args.id}`);
            return { content: [{ type: 'text', text: 'memory.pin: ok' }] };
          }

          case 'memory.unpin': {
            const ok = await this.memory.setPinned(args.id as string, false);
            if (!ok) throw new McpError(ErrorCode.InvalidRequest, `memory.unpin failed for ${args.id}`);
            return { content: [{ type: 'text', text: 'memory.unpin: ok' }] };
          }

          case 'memory.tag': {
            const ok = await this.memory.tag(args.id as string, args.add as string[] | undefined, args.remove as string[] | undefined);
            if (!ok) throw new McpError(ErrorCode.InvalidRequest, `memory.tag failed for ${args.id}`);
            return { content: [{ type: 'text', text: 'memory.tag: ok' }] };
          }

          case 'vectors.set': {
            const scope = args.scope as MemoryScope;
            await this.memory.setVector(scope, args.id as string, args.vector as number[]);
            return { content: [{ type: 'text', text: 'vectors.set: ok' }] };
          }

          case 'vectors.remove': {
            const scope = args.scope as MemoryScope;
            this.memory.removeVector(scope, args.id as string);
            return { content: [{ type: 'text', text: 'vectors.remove: ok' }] };
          }

          case 'vectors.importBulk': {
            const scope = args.scope as MemoryScope;
            const dim = args.dim as number | undefined;
            const res = this.memory.importVectorsBulk(scope, args.items as Array<{ id: string; vector: number[] }>, dim);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          }

          case 'vectors.importJsonl': {
            const scope = args.scope as MemoryScope;
            const dim = args.dim as number | undefined;
            const res = this.memory.importVectorsFromJsonl(scope, args.path as string, dim);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          }

          case 'memory.contextPack': {
            const pack = await this.memory.contextPack(args as any);
            return { content: [{ type: 'text', text: JSON.stringify(pack, null, 2) }] };
          }

          case 'project.info': {
            log('Getting project information');
            const info = this.memory.getProjectInfo();

            if (info) {
              log(`Project info: repoId="${info.repoId}", root="${info.root}", hasCommitted=${info.hasCommittedMemory}`);
            } else {
              log('No project detected');
            }
            return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
          }

          case 'project.initCommitted': {
            log('Initializing committed memory');
            const dir = this.memory.initCommittedMemory();

            log(`Committed memory initialized at: ${dir}`);
            return { content: [{ type: 'text', text: `Committed memory initialized at: ${dir}` }] };
          }

          case 'project.config.get': {
            const defaultScope: MemoryScope = 'committed';
            const scope = (args.scope as MemoryScope) || defaultScope;
            const cfg = this.memory.readConfig(scope);
            return { content: [{ type: 'text', text: JSON.stringify(cfg, null, 2) }] };
          }

          case 'project.config.set': {
            const scope = args.scope as MemoryScope;
            this.memory.writeConfig(scope, args.config as any);
            return { content: [{ type: 'text', text: 'project.config.set: ok' }] };
          }

          case 'project.sync.status': {
            const status = await this.memory.syncStatus();
            return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
          }

          case 'project.sync.merge': {
            const res = await this.memory.syncMerge(args.ids as string[] | undefined);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          }

          case 'maintenance.rebuild': {
            const scope = (args.scope as string) || 'project';
            if (scope === 'all') {
              const res = await this.memory.rebuildAll();
              return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
            }
            if (scope === 'project') {
              const committed = await this.memory.rebuildScope('committed');
              const local = await this.memory.rebuildScope('local');
              return { content: [{ type: 'text', text: JSON.stringify({ committed, local }, null, 2) }] };
            }
            const res = await this.memory.rebuildScope(scope as MemoryScope);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          }

          case 'maintenance.replay': {
            const scope = (args.scope as string) || 'project';
            const compact = !!args.compact;
            if (scope === 'all') {
              const res = await this.memory.replayAllFromJournal(compact);
              return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
            }
            if (scope === 'project') {
              const committed = await this.memory.replayJournal('committed', undefined, compact);
              const local = await this.memory.replayJournal('local', undefined, compact);
              return { content: [{ type: 'text', text: JSON.stringify({ committed, local }, null, 2) }] };
            }
            const res = await this.memory.replayJournal(scope as MemoryScope, undefined, compact);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          }

          case 'maintenance.compact': {
            const scope = (args.scope as string) || 'project';
            if (scope === 'all') {
              const res = await this.memory.replayAllFromJournal(true);
              return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
            }
            if (scope === 'project') {
              const committed = await this.memory.replayJournal('committed', undefined, true);
              const local = await this.memory.replayJournal('local', undefined, true);
              return { content: [{ type: 'text', text: JSON.stringify({ committed, local }, null, 2) }] };
            }
            const res = await this.memory.replayJournal(scope as MemoryScope, undefined, true);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          }

          case 'maintenance.compact.now': {
            const scope = (args.scope as string) || 'project';
            if (scope === 'all') {
              const res = await this.memory.replayAllFromJournal(true);
              return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
            }
            if (scope === 'project') {
              const committed = await this.memory.replayJournal('committed', undefined, true);
              const local = await this.memory.replayJournal('local', undefined, true);
              return { content: [{ type: 'text', text: JSON.stringify({ committed, local }, null, 2) }] };
            }
            const res = await this.memory.replayJournal(scope as MemoryScope, undefined, true);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          }

          case 'maintenance.snapshot': {
            const scope = (args.scope as string) || 'project';
            if (scope === 'all') { this.memory.snapshotAll(); return { content: [{ type: 'text', text: JSON.stringify({ ok: true, scopes: ['committed','local','global'] }, null, 2) }] }; }
            if (scope === 'project') { this.memory.snapshotProject(); return { content: [{ type: 'text', text: JSON.stringify({ ok: true, scopes: ['committed','local'] }, null, 2) }] }; }
            this.memory.snapshotScope(scope as MemoryScope);
            return { content: [{ type: 'text', text: JSON.stringify({ ok: true, scope }, null, 2) }] };
          }

          case 'maintenance.verify': {
            const scope = (args.scope as string) || 'project';
            if (scope === 'all') {
              const res = this.memory.verifyAll();
              return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
            }
            if (scope === 'project') {
              const committed = this.memory.verifyScope('committed');
              const local = this.memory.verifyScope('local');
              return { content: [{ type: 'text', text: JSON.stringify({ committed, local }, null, 2) }] };
            }
            const res = this.memory.verifyScope(scope as MemoryScope);
            return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
          }

          case 'maintenance.compactSnapshot': {
            const scope = (args.scope as string) || 'project';
            if (scope === 'all') {
              const res = await this.memory.replayAllFromJournal(true);
              this.memory.snapshotAll();
              return { content: [{ type: 'text', text: JSON.stringify({ compacted: res, snapshotted: true }, null, 2) }] };
            }
            if (scope === 'project') {
              const res = await this.memory.replayAllFromJournal(true);
              this.memory.snapshotProject();
              return { content: [{ type: 'text', text: JSON.stringify({ compacted: res, snapshotted: true }, null, 2) }] };
            }
            const res = await this.memory.replayJournal(scope as MemoryScope, undefined, true);
            this.memory.snapshotScope(scope as MemoryScope);
            return { content: [{ type: 'text', text: JSON.stringify({ compacted: res, snapshotted: true }, null, 2) }] };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          log(`Tool error (${name}): ${error.message}`);
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Tool execution failed (${name}): ${errorMessage}`);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${errorMessage}`
        );
      }
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        { uri: 'kb://project/info', name: 'Project Info', description: 'Project memory context', mimeType: 'application/json' },
        { uri: 'kb://context/pack', name: 'Context Pack', description: 'Context pack; pass query params in URI', mimeType: 'application/json' },
        { uri: 'kb://health', name: 'Server Health', description: 'Status and metrics', mimeType: 'application/json' },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      log(`Resource requested: ${uri}`);
      try {
        if (uri === 'kb://project/info') {
          const projectInfo = this.memory.getProjectInfo();
          const summaries = await this.memory.list('project', 10);
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ project: projectInfo, recent: summaries }, null, 2)
              }
            ]
          };
        }

        if (uri.startsWith('kb://context/pack')) {
          // Parse query params manually: kb://context/pack?q=...&scope=project&k=12&maxChars=8000
          const idx = uri.indexOf('?');
          const params: Record<string, string> = {};
          if (idx >= 0) {
            const qs = uri.slice(idx + 1);
            for (const part of qs.split('&')) {
              const [k, v] = part.split('=');
              if (!k) continue;
              params[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
            }
          }
          const scope = (params.scope as any) || 'project';
          const k = params.k ? Number(params.k) : undefined;
          const maxChars = params.maxChars ? Number(params.maxChars) : undefined;
          const snippetLanguages = params.snippetLanguages ? params.snippetLanguages.split(',') : undefined;
          const snippetFilePatterns = params.snippetFilePatterns ? params.snippetFilePatterns.split(',') : undefined;
          const pack = await this.memory.contextPack({
            q: params.q,
            scope,
            k,
            filters: undefined,
            snippetWindow: undefined,
            // extras carried through via any-cast inside contextPack
            ...(maxChars != null ? { maxChars } : {}),
            ...(params.tokenBudget ? { tokenBudget: Number(params.tokenBudget) } : {}),
            ...(snippetLanguages ? { snippetLanguages } as any : {}),
            ...(snippetFilePatterns ? { snippetFilePatterns } as any : {}),
          } as any);
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(pack, null, 2) }
            ]
          };
        }

        if (uri === 'kb://health') {
          // Minimal health: version and top counts
          const recent = await this.memory.list('all', 5);
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify({ name: 'llm-memory-mcp', version: '1.0.0', recent: recent.length }, null, 2) }
            ]
          };
        }

        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }

        throw new McpError(
          ErrorCode.InternalError,
          `Resource access failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    log('Connecting to MCP transport...');
    await this.server.connect(transport);
    log('LLM Memory MCP server connected and running on stdio');
  }
}

const server = new LLMKnowledgeBaseServer();
server.run().catch(console.error);
