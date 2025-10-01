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

// Import MigrationManager conditionally to avoid FFmpeg dependency issues
let MigrationManagerClass: any = null;
async function loadMigrationManager() {
  if (MigrationManagerClass === null) {
    try {
      const migrationModule = await import('./migration/MigrationManager.js');
      MigrationManagerClass = migrationModule.MigrationManager;
    } catch (error) {
      console.warn('Migration tools not available - FFmpeg dependency issues:', (error as Error).message);
      MigrationManagerClass = false; // Mark as failed
    }
  }
  return MigrationManagerClass || null;
}

function log(message: string, ...args: any[]) {
  console.error(`[LLM-Memory] ${new Date().toISOString()} ${message}`, ...args);
}

class LLMKnowledgeBaseServer {
  private server: Server;
  private memory: MemoryManager;
  private migration: any;
  private isShuttingDown = false;

  constructor() {
    this.server = new Server(
      {
        name: 'llm-memory-mcp',
        version: '1.0.0'
      }
    );

    log('Initializing LLM Memory MCP server');
    this.memory = new MemoryManager();
    this.migration = null; // Will be initialized on first use if available
    this.setupServerEventLogging();
    this.setupGracefulShutdown();
    this.setupHandlers();

    // Check video capabilities in background (don't block startup)
    this.checkVideoCapabilities();

    log('Server initialization complete');
  }

  private setupServerEventLogging(): void {
    // Hook into the server's request handling to log connections and requests
    const originalConnect = this.server.connect.bind(this.server);
    this.server.connect = async (transport: any) => {
      log('🔗 MCP client connecting...');
      const result = await originalConnect(transport);
      log('✅ MCP client connected successfully');
      return result;
    };

    // Log when server closes
    this.server.onclose = () => {
      log('❌ MCP client disconnected');
    };

    // Log server errors
    this.server.onerror = (error: Error) => {
      log(`🚨 MCP server error: ${error.message}`);
    };
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      log(`🛑 Received ${signal}, starting graceful shutdown...`);

      try {
        // Cleanup MemoryManager resources
        if (this.memory && typeof this.memory.dispose === 'function') {
          await this.memory.dispose();
        }

        // Cleanup migration manager if initialized
        if (this.migration && typeof this.migration.dispose === 'function') {
          await this.migration.dispose();
        }

        log('✅ Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        log(`❌ Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // For nodemon

    // Handle uncaught exceptions and promise rejections
    process.on('uncaughtException', (error) => {
      log(`💥 Uncaught exception: ${error.message}`);
      log('Stack trace:', error.stack);
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      log(`💥 Unhandled rejection at:`, promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
  }

  private async checkVideoCapabilities(): Promise<void> {
    try {
      log('🎬 Checking video storage capabilities...');

      // Check native FFmpeg
      let hasNativeFFmpeg = false;
      try {
        const { hasNativeFFmpeg: nativeCheck } = await import('./video/utils.js');
        hasNativeFFmpeg = await nativeCheck();
      } catch (nativeError) {
        log('   Native FFmpeg check failed:', (nativeError as Error).message);
      }

      // Check WASM FFmpeg components
      let hasWasmFFmpeg = false;
      try {
        const wasmModule = await import('./video/WasmEncoder.js');
        hasWasmFFmpeg = await wasmModule.isWasmEncoderSupported();
      } catch (wasmError) {
        log('   WASM FFmpeg check failed:', (wasmError as Error).message);
      }

      // Check video utils loading
      let videoUtilsLoaded = false;
      try {
        const utilsModule = await import('./video/utils.js');
        videoUtilsLoaded = !!utilsModule.createOptimalEncoder;
      } catch (utilsError) {
        log('   Video utils loading failed:', (utilsError as Error).message);
      }

      // Report capabilities
      if (hasNativeFFmpeg || hasWasmFFmpeg) {
        log('✅ Video storage available:');
        if (hasNativeFFmpeg) log('   - Native FFmpeg: ✅');
        if (hasWasmFFmpeg) log('   - WASM FFmpeg: ✅');
        log('   🎯 Video migration tools are ready to use');
      } else {
        log('⚠️  Video storage not available:');
        log('   - Native FFmpeg: ❌');
        log('   - WASM FFmpeg: ❌');
        log('   - Video utils loaded: ' + (videoUtilsLoaded ? '✅' : '❌'));
        log('   📋 Video migration will use fallback mode');
        log('   💡 Install FFmpeg to enable full video storage capabilities');
      }
    } catch (error) {
      log('⚠️  Could not check video capabilities:', (error as Error).message);
      log('   📋 Video migration will use fallback mode if available');
    }
  }

  private async initializeMigrationManager(): Promise<any> {
    if (this.migration === null) {
      const MigrationManagerClass = await loadMigrationManager();
      if (MigrationManagerClass) {
        this.migration = new MigrationManagerClass();
        log('🎬 Migration tools initialized - video and file backends available');
      }
    }
    return this.migration;
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
        {
          name: 'memory.feedback',
          description: 'Record user feedback (helpful/not helpful) for a memory item',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              helpful: { type: 'boolean' },
              scope: { type: 'string', enum: ['global','local','committed'] },
            },
            required: ['id', 'helpful'],
            additionalProperties: false,
          },
        },
        {
          name: 'memory.use',
          description: 'Record usage/access of a memory item for confidence scoring',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              scope: { type: 'string', enum: ['global','local','committed'] },
            },
            required: ['id'],
            additionalProperties: false,
          },
        },
        {
          name: 'journal.stats',
          description: 'Get journal statistics and optimization status',
          inputSchema: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['global','local','committed','all'] },
            },
            additionalProperties: false,
          },
        },
        {
          name: 'journal.migrate',
          description: 'Migrate legacy journal to optimized hash-based format',
          inputSchema: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['global','local','committed','all'] },
            },
            required: ['scope'],
            additionalProperties: false,
          },
        },
        {
          name: 'journal.verify',
          description: 'Verify integrity using optimized journal hashes',
          inputSchema: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['global','local','committed','all'] },
            },
            required: ['scope'],
            additionalProperties: false,
          },
        },
        {
          name: 'migration.storage_backend',
          description: 'Migrate storage between file and video backends within same scope',
          inputSchema: {
            type: 'object',
            properties: {
              sourceBackend: { type: 'string', enum: ['file', 'video'] },
              targetBackend: { type: 'string', enum: ['file', 'video'] },
              scope: { type: 'string', enum: ['global', 'local', 'committed'] },
              dryRun: { type: 'boolean', description: 'Preview migration without executing' },
              validateAfterMigration: { type: 'boolean', description: 'Validate migration integrity' },
              backupBeforeMigration: { type: 'boolean', description: 'Create backup before migration' },
            },
            required: ['sourceBackend', 'targetBackend', 'scope'],
            additionalProperties: false,
          },
        },
        {
          name: 'migration.scope',
          description: 'Migrate filtered items between memory scopes (global/local/committed)',
          inputSchema: {
            type: 'object',
            properties: {
              sourceScope: { type: 'string', enum: ['global', 'local', 'committed'] },
              targetScope: { type: 'string', enum: ['global', 'local', 'committed'] },
              contentFilter: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: 'Search query to match in title/text/code' },
                  tags: { type: 'array', items: { type: 'string' }, description: 'Tags to filter by' },
                  types: { type: 'array', items: { type: 'string', enum: ['snippet','pattern','config','insight','runbook','fact','note'] }, description: 'Memory types to include' },
                  titlePatterns: { type: 'array', items: { type: 'string' }, description: 'Regex patterns for title matching' },
                  contentPatterns: { type: 'array', items: { type: 'string' }, description: 'Regex patterns for content matching' },
                  files: { type: 'array', items: { type: 'string' }, description: 'File paths to filter by' },
                  dateRange: {
                    type: 'object',
                    properties: {
                      start: { type: 'string', format: 'date-time' },
                      end: { type: 'string', format: 'date-time' }
                    },
                    required: ['start', 'end'],
                    description: 'Date range for filtering items'
                  }
                },
                additionalProperties: false
              },
              storageBackend: { type: 'string', enum: ['file', 'video'], description: 'Storage backend to use' },
              dryRun: { type: 'boolean', description: 'Preview migration without executing' },
              validateAfterMigration: { type: 'boolean', description: 'Validate migration integrity' },
            },
            required: ['sourceScope', 'targetScope'],
            additionalProperties: false,
          },
        },
        {
          name: 'migration.status',
          description: 'Get migration status and storage statistics for a scope',
          inputSchema: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['global', 'local', 'committed'] },
              backend: { type: 'string', enum: ['file', 'video'] },
            },
            required: ['scope', 'backend'],
            additionalProperties: false,
          },
        },
        {
          name: 'migration.validate',
          description: 'Validate migration integrity and consistency',
          inputSchema: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['global', 'local', 'committed'] },
              backend: { type: 'string', enum: ['file', 'video'] },
              expectedItems: { type: 'array', items: { type: 'string' }, description: 'Expected item IDs for validation' },
            },
            required: ['scope', 'backend'],
            additionalProperties: false,
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const startTime = Date.now();

      log(`🔧 Tool called: ${name}`);
      if (args && Object.keys(args).length > 0) {
        const argSummary = Object.keys(args).slice(0, 3).join(', ');
        const hasMore = Object.keys(args).length > 3;
        log(`   Arguments: ${argSummary}${hasMore ? '...' : ''}`);
      }

      if (!args) {
        log(`❌ Tool failed: ${name} - Missing arguments`);
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
            const config = args.config as any;

            // If setting storage backend, also update the default backend preference
            if (config?.storage?.backend) {
              const backend = config.storage.backend;
              if (backend === 'video' || backend === 'file') {
                log(`Setting default backend preference to: ${backend}`);
                this.memory.setDefaultBackend(backend);
              }
            }

            this.memory.writeConfig(scope, config);
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

          case 'memory.feedback': {
            const id = args.id as string;
            const helpful = args.helpful as boolean;
            const scope = args.scope as MemoryScope | undefined;

            log(`Recording feedback: id=${id}, helpful=${helpful}${scope ? `, scope=${scope}` : ''}`);

            const item = await this.memory.get(id, scope);
            if (!item) {
              throw new McpError(ErrorCode.InvalidRequest, `Item ${id} not found`);
            }

            this.memory.addFeedback(item, helpful, new Date());
            await this.memory.upsert(item); // Save the updated item

            log(`Feedback recorded successfully: id=${id}`);
            return { content: [{ type: 'text', text: 'memory.feedback: ok' }] };
          }

          case 'memory.use': {
            const id = args.id as string;
            const scope = args.scope as MemoryScope | undefined;

            log(`Recording usage: id=${id}${scope ? `, scope=${scope}` : ''}`);

            const item = await this.memory.get(id, scope);
            if (!item) {
              throw new McpError(ErrorCode.InvalidRequest, `Item ${id} not found`);
            }

            this.memory.recordAccess(item, 'use', new Date());
            await this.memory.upsert(item); // Save the updated item

            log(`Usage recorded successfully: id=${id}`);
            return { content: [{ type: 'text', text: 'memory.use: ok' }] };
          }

          case 'journal.stats': {
            const scope = args.scope as string || 'all';

            log(`Getting journal stats: scope=${scope}`);

            if (scope === 'all') {
              const stats = await this.memory.getAllJournalStats();
              return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
            } else {
              const stats = await this.memory.getJournalStats(scope as MemoryScope);
              return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
            }
          }

          case 'journal.migrate': {
            const scope = args.scope as string;

            log(`Migrating journal to optimized format: scope=${scope}`);

            if (scope === 'all') {
              const result = await this.memory.migrateAllJournalsToOptimized();
              log(`Migration completed: ${result.summary.totalMigrated} entries, ${result.summary.totalReduction.toFixed(1)}% size reduction`);
              return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            } else {
              const result = await this.memory.migrateJournalToOptimized(scope as MemoryScope);
              log(`Migration completed: ${result.migrated} entries migrated, ${result.sizeReduction.percentage.toFixed(1)}% size reduction`);
              return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
          }

          case 'journal.verify': {
            const scope = args.scope as string;

            log(`Verifying journal integrity: scope=${scope}`);

            if (scope === 'all') {
              // Verify all scopes
              const [global, local, committed] = await Promise.all([
                this.memory.verifyIntegrityFromOptimizedJournal('global'),
                this.memory.verifyIntegrityFromOptimizedJournal('local'),
                this.memory.verifyIntegrityFromOptimizedJournal('committed')
              ]);

              const summary = {
                global,
                local,
                committed,
                overall: {
                  valid: global.valid && local.valid && committed.valid,
                  totalCorrupted: global.corruptedItems.length + local.corruptedItems.length + committed.corruptedItems.length,
                  avgIntegrityScore: (global.integrityScore + local.integrityScore + committed.integrityScore) / 3
                }
              };

              return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
            } else {
              const result = await this.memory.verifyIntegrityFromOptimizedJournal(scope as MemoryScope);
              log(`Integrity verification: ${result.valid ? 'PASSED' : 'FAILED'}, score: ${result.integrityScore.toFixed(3)}`);
              return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
          }

          case 'migration.storage_backend': {
            const mgr = await this.initializeMigrationManager();
            if (!mgr) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                'Migration tools are unavailable in this environment (FFmpeg not installed or failed to load)'
              );
            }
            const sourceBackend = args.sourceBackend as 'file' | 'video';
            const targetBackend = args.targetBackend as 'file' | 'video';
            const scope = args.scope as MemoryScope;
            const dryRun = args.dryRun as boolean || false;
            const validateAfterMigration = args.validateAfterMigration as boolean ?? true;
            const backupBeforeMigration = args.backupBeforeMigration as boolean ?? true;

            log(`Starting storage migration: ${sourceBackend} → ${targetBackend} for ${scope} scope${dryRun ? ' (DRY RUN)' : ''}`);

            const progressLog: string[] = [];
            const options: any = {
              sourceBackend,
              targetBackend,
              scope,
              dryRun,
              validateAfterMigration,
              backupBeforeMigration,
              onProgress: (progress: any) => {
                const msg = `[${progress.phase}] ${progress.itemsProcessed}/${progress.totalItems} items${progress.currentItem ? ` (${progress.currentItem})` : ''} - ${progress.errors.length} errors`;
                progressLog.push(msg);
                log(`Migration progress: ${msg}`);
              }
            };

            const result = await mgr.migrateStorageBackend(options);

            // Refresh MemoryManager's storage adapter after successful migration
            if (result.success && !dryRun) {
              log(`Refreshing MemoryManager storage adapter for ${scope} scope after migration`);
              this.memory.refreshStorageAdapter(scope);
            }

            const summary = {
              migration: 'storage_backend',
              sourceBackend,
              targetBackend,
              scope,
              dryRun,
              result,
              progressLog: progressLog.slice(-10) // Last 10 progress messages
            };

            log(`Storage migration completed: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.targetItems}/${result.sourceItems} items`);
            return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
          }

          case 'migration.scope': {
            const mgr = await this.initializeMigrationManager();
            if (!mgr) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                'Migration tools are unavailable in this environment (FFmpeg not installed or failed to load)'
              );
            }
            const sourceScope = args.sourceScope as MemoryScope;
            const targetScope = args.targetScope as MemoryScope;
            const contentFilter = args.contentFilter as any;
            const storageBackend = (args.storageBackend as 'file' | 'video') || 'file';
            const dryRun = args.dryRun as boolean || false;
            const validateAfterMigration = args.validateAfterMigration as boolean ?? true;

            log(`Starting scope migration: ${sourceScope} → ${targetScope}${dryRun ? ' (DRY RUN)' : ''}`);

            if (contentFilter) {
              const filterSummary = {
                query: contentFilter.query || 'none',
                tags: contentFilter.tags?.length || 0,
                types: contentFilter.types?.length || 0,
                patterns: (contentFilter.titlePatterns?.length || 0) + (contentFilter.contentPatterns?.length || 0),
                files: contentFilter.files?.length || 0,
                dateRange: contentFilter.dateRange ? 'specified' : 'none'
              };
              log(`Content filter applied: ${JSON.stringify(filterSummary)}`);
            }

            const progressLog: string[] = [];
            const options: any = {
              sourceScope,
              targetScope,
              contentFilter,
              storageBackend,
              dryRun,
              validateAfterMigration,
              onProgress: (progress: any) => {
                const msg = `[${progress.phase}] ${progress.itemsProcessed}/${progress.totalItems} items${progress.currentItem ? ` (${progress.currentItem})` : ''} - ${progress.errors.length} errors`;
                progressLog.push(msg);
                log(`Migration progress: ${msg}`);
              }
            };

            const result = await mgr.migrateBetweenScopes(options);

            const summary = {
              migration: 'scope',
              sourceScope,
              targetScope,
              storageBackend,
              dryRun,
              contentFilter,
              result,
              progressLog: progressLog.slice(-10) // Last 10 progress messages
            };

            log(`Scope migration completed: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.targetItems}/${result.sourceItems} items`);
            return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
          }

          case 'migration.status': {
            const mgr = await this.initializeMigrationManager();
            if (!mgr) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                'Migration tools are unavailable in this environment (FFmpeg not installed or failed to load)'
              );
            }
            const scope = args.scope as MemoryScope;
            const backend = args.backend as 'file' | 'video';

            log(`Getting migration status: scope=${scope}, backend=${backend}`);

            const status = await mgr.getMigrationStatus(scope, backend);

            log(`Migration status retrieved: ${status.itemCount} items, ${(status.storageSize / 1024).toFixed(1)}KB`);
            return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
          }

          case 'migration.validate': {
            const mgr = await this.initializeMigrationManager();
            if (!mgr) {
              throw new McpError(
                ErrorCode.InvalidRequest,
                'Migration tools are unavailable in this environment (FFmpeg not installed or failed to load)'
              );
            }
            const scope = args.scope as MemoryScope;
            const backend = args.backend as 'file' | 'video';
            const expectedItems = args.expectedItems as string[] || [];

            log(`Validating migration: scope=${scope}, backend=${backend}${expectedItems.length > 0 ? `, checking ${expectedItems.length} items` : ''}`);

            // Use a simple validation by getting the current status
            const status = await mgr.getMigrationStatus(scope, backend);

            // Create a basic validation result
            const validation = {
              success: true,
              scope,
              backend,
              foundItems: status.itemCount,
              expectedItems: expectedItems.length,
              storageSize: status.storageSize,
              issues: [] as string[]
            };

            // Basic validation checks
            if (expectedItems.length > 0 && status.itemCount !== expectedItems.length) {
              validation.success = false;
              validation.issues.push(`Item count mismatch: expected ${expectedItems.length}, found ${status.itemCount}`);
            }

            if (status.storageSize === 0 && status.itemCount > 0) {
              validation.success = false;
              validation.issues.push('Storage size is 0 but items are present - potential corruption');
            }

            log(`Migration validation: ${validation.success ? 'PASSED' : 'FAILED'} - ${validation.issues.length} issues`);
            return { content: [{ type: 'text', text: JSON.stringify(validation, null, 2) }] };
          }

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        if (error instanceof McpError) {
          log(`❌ Tool error (${name}) after ${duration}ms: ${error.message}`);
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`💥 Tool execution failed (${name}) after ${duration}ms: ${errorMessage}`);
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
        { uri: 'kb://context/auto', name: 'Auto Context', description: 'Automatically generated context based on current project and files', mimeType: 'text/markdown' },
        { uri: 'kb://health', name: 'Server Health', description: 'Status and metrics', mimeType: 'application/json' },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      const startTime = Date.now();

      log(`📋 Resource requested: ${uri}`);
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

        if (uri === 'kb://context/auto') {
          // Automatically generate relevant context based on project
          const projectInfo = this.memory.getProjectInfo();

          // Query for relevant memories based on current project
          const query: MemoryQuery = {
            scope: 'project',
            k: 10,
            filters: {
              confidence: { min: 0.5 }
            }
          };

          const results = await this.memory.query(query);

          // Format as markdown for easy reading
          let markdown = `# Auto-Generated Memory Context\n\n`;
          markdown += `**Project**: ${projectInfo.repoId || 'Unknown'}\n`;
          markdown += `**Branch**: ${projectInfo.branch || 'Unknown'}\n`;
          markdown += `**Memory Count**: ${results.total}\n\n`;

          if (results.items.length === 0) {
            markdown += `*No relevant memories found for this project.*\n`;
          } else {
            markdown += `## Relevant Memories\n\n`;

            for (const item of results.items) {
              markdown += `### ${item.title || item.type}\n`;
              if (item.path) {
                markdown += `**Path**: \`${item.path}\`\n`;
              }
              markdown += `**Type**: ${item.type} | **Confidence**: ${(item.quality.confidence * 100).toFixed(0)}%`;
              if (item.quality.pinned) {
                markdown += ` 📌`;
              }
              markdown += `\n`;

              if (item.facets.tags.length > 0) {
                markdown += `**Tags**: ${item.facets.tags.join(', ')}\n`;
              }

              if (item.text) {
                markdown += `\n${item.text.substring(0, 200)}${item.text.length > 200 ? '...' : ''}\n`;
              }

              if (item.code) {
                const lang = item.language || '';
                markdown += `\n\`\`\`${lang}\n${item.code.substring(0, 300)}${item.code.length > 300 ? '\n...' : ''}\n\`\`\`\n`;
              }

              markdown += `\n---\n\n`;
            }
          }

          return {
            contents: [
              { uri, mimeType: 'text/markdown', text: markdown }
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
        const duration = Date.now() - startTime;
        if (error instanceof McpError) {
          log(`❌ Resource error (${uri}) after ${duration}ms: ${error.message}`);
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`💥 Resource access failed (${uri}) after ${duration}ms: ${errorMessage}`);
        throw new McpError(
          ErrorCode.InternalError,
          `Resource access failed: ${errorMessage}`
        );
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    log('🚀 Starting LLM Memory MCP server...');
    log('📡 Connecting to MCP transport (stdio)...');

    try {
      await this.server.connect(transport);
      log('✅ LLM Memory MCP server is running and ready for connections');
      log('📊 Server Info: Tools available, resources accessible, waiting for client requests...');
    } catch (error) {
      log(`💥 Failed to start MCP server: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

const server = new LLMKnowledgeBaseServer();
server.run().catch(console.error);
