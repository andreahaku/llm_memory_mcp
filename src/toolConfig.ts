/**
 * Tool configuration for MCP server
 * Controls which tool groups are enabled to reduce token usage
 */

export interface ToolGroupConfig {
  core: boolean;           // Essential memory operations (always true)
  vectors: boolean;        // Vector embedding operations
  migration: boolean;      // Storage backend migration tools
  journal: boolean;        // Journal management and optimization
  maintenance: boolean;    // Advanced maintenance operations
  autolearn: boolean;      // Auto-learning from git commits
}

// Default configuration - only core tools enabled
export const DEFAULT_TOOL_CONFIG: ToolGroupConfig = {
  core: true,
  vectors: false,
  migration: false,
  journal: false,
  maintenance: false,
  autolearn: false,
};

// Environment variable overrides
// Example: LLM_MEMORY_TOOLS=vectors,migration pnpm start
export function getToolConfig(): ToolGroupConfig {
  const config = { ...DEFAULT_TOOL_CONFIG };

  const envTools = process.env.LLM_MEMORY_TOOLS;
  if (envTools) {
    const enabled = envTools.split(',').map(s => s.trim().toLowerCase());

    if (enabled.includes('all')) {
      return {
        core: true,
        vectors: true,
        migration: true,
        journal: true,
        maintenance: true,
        autolearn: true,
      };
    }

    if (enabled.includes('vectors')) config.vectors = true;
    if (enabled.includes('migration')) config.migration = true;
    if (enabled.includes('journal')) config.journal = true;
    if (enabled.includes('maintenance')) config.maintenance = true;
    if (enabled.includes('autolearn')) config.autolearn = true;
  }

  return config;
}

// Shared constants for schema definitions
export const MEMORY_TYPES = ['snippet', 'pattern', 'config', 'insight', 'runbook', 'fact', 'note'];
export const SCOPES = ['global', 'local', 'committed'];
export const SCOPE_FILTERS = ['global', 'local', 'committed', 'project', 'all'];
export const SENSITIVITIES = ['public', 'team', 'private'];
export const LINK_RELS = ['refines', 'duplicates', 'depends', 'fixes', 'relates'];
export const BACKENDS = ['file', 'video'];
export const INJECTION_POLICIES = ['always', 'on-demand'];
export const CONTEXT_OUTPUT_FORMATS = ['json', 'markdown'];
