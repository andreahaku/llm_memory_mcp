/**
 * Optimized tool definitions for MCP server
 * Minimizes token usage while maintaining functionality
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  MEMORY_TYPES,
  SCOPES,
  SCOPE_FILTERS,
  SENSITIVITIES,
  LINK_RELS,
  BACKENDS,
  INJECTION_POLICIES,
  CONTEXT_OUTPUT_FORMATS,
  type ToolGroupConfig,
} from './toolConfig.js';

// Helper to create minimal schemas
const obj = (props: any, req?: string[]) => ({
  type: 'object' as const,
  properties: props,
  ...(req ? { required: req } : {}),
});

const arr = (items?: any) => ({
  type: 'array' as const,
  ...(items ? { items } : {}),
});

const str = () => ({ type: 'string' as const });
const num = () => ({ type: 'number' as const });
const bool = () => ({ type: 'boolean' as const });
const enm = (values: string[]) => ({ enum: values });

// Core memory operations (always enabled)
export const CORE_TOOLS: Tool[] = [
  {
    name: 'mem.upsert',
    description: 'Create/update memory',
    inputSchema: obj({
      id: str(),
      type: enm(MEMORY_TYPES),
      scope: enm(SCOPES),
      injection: enm(INJECTION_POLICIES), // 'always' or 'on-demand' (default)
      title: str(),
      text: str(),
      code: str(),
      language: str(),
      tags: arr(),
      files: arr(),
      symbols: arr(),
      conf: num(),
      pinned: bool(),
      sens: enm(SENSITIVITIES),
      ttl: num(),
    }, ['type', 'scope']),
  },
  {
    name: 'mem.patch',
    description: 'Apply incremental text replacements',
    inputSchema: obj({
      id: str(),
      scope: enm(SCOPES),
      operations: arr(obj({
        field: enm(['title', 'text', 'code']),
        old: str(),
        new: str(),
      }, ['field', 'old', 'new'])),
    }, ['id', 'operations']),
  },
  {
    name: 'mem.append',
    description: 'Append content to text/code field',
    inputSchema: obj({
      id: str(),
      scope: enm(SCOPES),
      field: enm(['text', 'code']),
      content: str(),
      separator: str(),
    }, ['id', 'field', 'content']),
  },
  {
    name: 'mem.merge',
    description: 'Merge multiple memories',
    inputSchema: obj({
      sourceIds: arr(str()),
      targetId: str(),
      scope: enm(SCOPES),
      strategy: enm(['concat', 'deduplicate', 'prioritize-first', 'prioritize-recent']),
      deleteSource: bool(),
    }, ['sourceIds', 'scope']),
  },
  {
    name: 'mem.get',
    description: 'Fetch memory by ID',
    inputSchema: obj({ id: str(), scope: enm(SCOPES) }, ['id']),
  },
  {
    name: 'mem.delete',
    description: 'Delete memory by ID',
    inputSchema: obj({ id: str(), scope: enm(SCOPES) }, ['id']),
  },
  {
    name: 'mem.list',
    description: 'List memory summaries',
    inputSchema: obj({ scope: enm(SCOPE_FILTERS), limit: num() }),
  },
  {
    name: 'mem.query',
    description: 'Search memory',
    inputSchema: { type: 'object' as const },
  },
  {
    name: 'mem.link',
    description: 'Link two memories',
    inputSchema: obj({
      from: str(),
      to: str(),
      rel: enm(LINK_RELS),
    }, ['from', 'to', 'rel']),
  },
  {
    name: 'mem.pin',
    description: 'Pin memory for priority',
    inputSchema: obj({ id: str() }, ['id']),
  },
  {
    name: 'mem.unpin',
    description: 'Unpin memory',
    inputSchema: obj({ id: str() }, ['id']),
  },
  {
    name: 'mem.tag',
    description: 'Add/remove tags',
    inputSchema: obj({ id: str(), add: arr(), remove: arr() }, ['id']),
  },
  {
    name: 'mem.contextPack',
    description: 'Build IDE-ready context pack',
    inputSchema: obj({
      q: str(),
      scope: enm(SCOPE_FILTERS),
      k: num(),
      filters: { type: 'object' as const },
      snippetWindow: obj({ before: num(), after: num() }),
      snippetLanguages: arr(),
      snippetFilePatterns: arr(),
      maxChars: num(),
      tokenBudget: num(),
    }),
  },
  {
    name: 'mem.feedback',
    description: 'Record feedback (helpful/not)',
    inputSchema: obj({
      id: str(),
      helpful: bool(),
      scope: enm(SCOPES),
    }, ['id', 'helpful']),
  },
  {
    name: 'mem.use',
    description: 'Record usage for confidence scoring',
    inputSchema: obj({ id: str(), scope: enm(SCOPES) }, ['id']),
  },
  {
    name: 'mem.renew',
    description: 'Extend TTL for active memories',
    inputSchema: obj({
      id: str(),
      scope: enm(SCOPES),
      ttl: num(),
    }, ['id']),
  },
  {
    name: 'mem.context',
    description: 'Get memories for prompt injection with token budget',
    inputSchema: obj({
      scope: enm(SCOPE_FILTERS),
      maxTokens: num(),              // Token budget (default: 4000)
      includeAlwaysInject: bool(),   // Include all 'always' memories (default: true)
      format: enm(CONTEXT_OUTPUT_FORMATS), // Output format: json, markdown (default: json)
      minConfidence: num(),          // Min confidence threshold (default: 0.5)
      types: arr(enm(MEMORY_TYPES)), // Filter by memory types
      tags: arr(),                   // Filter by tags
    }),
  },
  {
    name: 'mem.recent',
    description: 'Get recently accessed/modified memories',
    inputSchema: obj({
      scope: enm(SCOPE_FILTERS),
      limit: num(),                  // Max results (default: 10)
      types: arr(enm(MEMORY_TYPES)), // Filter by memory types
      tags: arr(),                   // Filter by tags
      sortBy: enm(['lastUsedAt', 'lastAccessedAt', 'updatedAt', 'createdAt']), // Sort field (default: lastAccessedAt)
      since: str(),                  // Only return items accessed/modified since this ISO date
    }),
  },
  {
    name: 'proj.info',
    description: 'Get project info',
    inputSchema: obj({}),
  },
  {
    name: 'proj.initCommitted',
    description: 'Initialize committed memory',
    inputSchema: obj({}),
  },
  {
    name: 'proj.config.get',
    description: 'Read memory config',
    inputSchema: obj({ scope: enm(SCOPES) }),
  },
  {
    name: 'proj.config.set',
    description: 'Write memory config',
    inputSchema: obj({ scope: enm(SCOPES), config: { type: 'object' as const } }, ['scope', 'config']),
  },
  {
    name: 'proj.sync.status',
    description: 'Show local/committed differences',
    inputSchema: obj({}),
  },
  {
    name: 'proj.sync.merge',
    description: 'Merge local -> committed',
    inputSchema: obj({ ids: arr() }),
  },
  {
    name: 'maint.rebuild',
    description: 'Rebuild catalog and index',
    inputSchema: obj({ scope: enm(SCOPE_FILTERS) }),
  },
  {
    name: 'maint.replay',
    description: 'Replay journal (optionally compact)',
    inputSchema: obj({ scope: enm(SCOPE_FILTERS), compact: bool() }),
  },
  {
    name: 'maint.compact',
    description: 'Compact journal',
    inputSchema: obj({ scope: enm(SCOPE_FILTERS) }),
  },
  {
    name: 'maint.prune',
    description: 'Remove expired memories',
    inputSchema: obj({
      scope: enm(SCOPE_FILTERS),
      dry: bool(),
    }),
  },
];

// Vector operations (optional)
export const VECTOR_TOOLS: Tool[] = [
  {
    name: 'vec.set',
    description: 'Set vector embedding',
    inputSchema: obj({
      id: str(),
      scope: enm(SCOPES),
      vector: arr(num()),
    }, ['id', 'scope', 'vector']),
  },
  {
    name: 'vec.importBulk',
    description: 'Bulk import vectors',
    inputSchema: obj({
      scope: enm(SCOPES),
      items: arr(obj({ id: str(), vector: arr(num()) }, ['id', 'vector'])),
      dim: num(),
    }, ['scope', 'items']),
  },
  {
    name: 'vec.importJsonl',
    description: 'Import vectors from JSONL',
    inputSchema: obj({
      scope: enm(SCOPES),
      path: str(),
      dim: num(),
    }, ['scope', 'path']),
  },
  {
    name: 'vec.remove',
    description: 'Remove vector embedding',
    inputSchema: obj({ id: str(), scope: enm(SCOPES) }, ['id', 'scope']),
  },
];

// Migration tools (optional)
export const MIGRATION_TOOLS: Tool[] = [
  {
    name: 'mig.storage_backend',
    description: 'Migrate storage backend',
    inputSchema: obj({
      srcBack: enm(BACKENDS),
      tgtBack: enm(BACKENDS),
      scope: enm(SCOPES),
      dry: bool(),
      validateAfter: bool(),
      backupBefore: bool(),
    }, ['srcBack', 'tgtBack', 'scope']),
  },
  {
    name: 'mig.scope',
    description: 'Migrate between scopes',
    inputSchema: obj({
      srcScope: enm(SCOPES),
      tgtScope: enm(SCOPES),
      contentFilter: obj({
        query: str(),
        tags: arr(),
        types: arr(enm(MEMORY_TYPES)),
        titlePatterns: arr(),
        contentPatterns: arr(),
        files: arr(),
        dateRange: obj({
          start: { type: 'string' as const, format: 'date-time' },
          end: { type: 'string' as const, format: 'date-time' },
        }, ['start', 'end']),
      }),
      storeBack: enm(BACKENDS),
      dry: bool(),
      validateAfter: bool(),
    }, ['srcScope', 'tgtScope']),
  },
  {
    name: 'mig.status',
    description: 'Get migration status',
    inputSchema: obj({
      scope: enm(SCOPES),
      backend: enm(BACKENDS),
    }, ['scope', 'backend']),
  },
  {
    name: 'mig.validate',
    description: 'Validate migration integrity',
    inputSchema: obj({
      scope: enm(SCOPES),
      backend: enm(BACKENDS),
      expectedItems: arr(),
    }, ['scope', 'backend']),
  },
];

// Journal management (optional)
export const JOURNAL_TOOLS: Tool[] = [
  {
    name: 'jour.stats',
    description: 'Get journal statistics',
    inputSchema: obj({ scope: enm(['global', 'local', 'committed', 'all']) }),
  },
  {
    name: 'jour.migrate',
    description: 'Migrate to optimized journal',
    inputSchema: obj({ scope: enm(['global', 'local', 'committed', 'all']) }, ['scope']),
  },
  {
    name: 'jour.verify',
    description: 'Verify journal integrity',
    inputSchema: obj({ scope: enm(['global', 'local', 'committed', 'all']) }, ['scope']),
  },
];

// Advanced maintenance (optional)
export const MAINTENANCE_TOOLS: Tool[] = [
  {
    name: 'maint.snapshot',
    description: 'Write snapshot marker',
    inputSchema: obj({ scope: enm(SCOPE_FILTERS) }),
  },
  {
    name: 'maint.verify',
    description: 'Verify consistency',
    inputSchema: obj({ scope: enm(SCOPE_FILTERS) }),
  },
  {
    name: 'maint.compactSnapshot',
    description: 'Compact + snapshot',
    inputSchema: obj({ scope: enm(SCOPE_FILTERS) }),
  },
];

// Auto-learning tools (optional)
export const AUTOLEARN_TOOLS: Tool[] = [
  {
    name: 'auto.status',
    description: 'Get auto-learning status',
    inputSchema: obj({}),
  },
  {
    name: 'auto.init',
    description: 'Initialize auto-learning',
    inputSchema: obj({ autoInst: bool() }),
  },
  {
    name: 'auto.processQ',
    description: 'Process learning queue',
    inputSchema: obj({}),
  },
  {
    name: 'auto.capture',
    description: 'Capture specific commit',
    inputSchema: obj({ hash: str() }),
  },
  {
    name: 'auto.installGlobal',
    description: 'Install hooks globally',
    inputSchema: obj({}),
  },
];

// Build tool list based on configuration
export function getEnabledTools(config: ToolGroupConfig): Tool[] {
  const tools: Tool[] = [...CORE_TOOLS];

  if (config.vectors) tools.push(...VECTOR_TOOLS);
  if (config.migration) tools.push(...MIGRATION_TOOLS);
  if (config.journal) tools.push(...JOURNAL_TOOLS);
  if (config.maintenance) tools.push(...MAINTENANCE_TOOLS);
  if (config.autolearn) tools.push(...AUTOLEARN_TOOLS);

  return tools;
}
