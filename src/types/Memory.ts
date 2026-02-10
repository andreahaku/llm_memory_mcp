export type MemoryType = 'snippet' | 'pattern' | 'config' | 'insight' | 'runbook' | 'fact' | 'note';

export type MemoryScope = 'global' | 'local' | 'committed';
export type QueryScope = 'global' | 'local' | 'committed' | 'project' | 'all';

export type Sensitivity = 'public' | 'team' | 'private';

/**
 * Injection policy determines when a memory is included in context:
 * - 'always': Memory is always injected into prompts (high-value, stable facts)
 * - 'on-demand': Memory is only retrieved when explicitly searched for (default)
 */
export type InjectionPolicy = 'always' | 'on-demand';

export interface MemoryFacets {
  tags: string[];
  files: string[];
  symbols: string[];
}

export interface MemoryContext {
  repoId?: string;
  branch?: string;
  commit?: string;
  tool?: string;
  source?: string;
  file?: string;
  range?: { start: number; end: number };
  function?: string;
  package?: string;
  framework?: string;
}

export interface MemoryQuality {
  confidence: number; // 0..1
  reuseCount: number;
  pinned?: boolean;
  ttlDays?: number;
  expiresAt?: string;
  // Feedback signals
  helpfulCount?: number;
  notHelpfulCount?: number;
  // Usage/recency signals with exponential decay tracking
  decayedUsage?: number;
  decayUpdatedAt?: string;
  lastAccessedAt?: string;
  lastUsedAt?: string;
  lastFeedbackAt?: string;
  // Cache/housekeeping
  lastComputedConfidenceAt?: string;
}

export interface MemorySecurity {
  sensitivity: Sensitivity;
  secretHashRefs?: string[];
}

export interface MemoryVectors {
  model: string;
  embeddingRef?: string;
}

export interface MemoryLink {
  rel: 'refines' | 'duplicates' | 'depends' | 'fixes' | 'relates';
  to: string;
}

export interface MemoryItem {
  id: string; // ULID
  type: MemoryType;
  scope: MemoryScope;
  injection?: InjectionPolicy; // 'always' = always in context, 'on-demand' = search only (default)
  title?: string;
  text?: string;
  code?: string;
  language?: string;
  facets: MemoryFacets;
  context: MemoryContext;
  quality: MemoryQuality;
  security: MemorySecurity;
  vectors?: MemoryVectors;
  links?: MemoryLink[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface MemoryItemSummary {
  id: string;
  type: MemoryType;
  scope: MemoryScope;
  title?: string;
  tags: string[];
  files: string[];
  symbols: string[];
  confidence: number;
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JournalEntry {
  op: 'upsert' | 'link' | 'delete' | 'touch' | 'incrementReuse';
  item?: MemoryItem;
  id?: string;
  link?: { from: string; rel: string; to: string };
  ts: string;
  actor: string;
}

export interface OptimizedJournalEntry {
  op: 'upsert' | 'delete' | 'link' | 'touch' | 'incrementReuse';
  id: string;
  contentHash?: string;  // SHA-256 of normalized item content
  prevHash?: string;     // Previous content hash for integrity chain
  delta?: {              // For incremental updates
    fields: string[];    // Changed field paths
    checksum: string;    // Delta checksum
  };
  link?: { from: string; rel: string; to: string };
  ts: string;
  actor: string;
  meta?: {              // Optional metadata for recovery
    size: number;
    type: MemoryType;
    scope: MemoryScope;
    title?: string;
  };
}

export interface MemoryQuery {
  q?: string;
  filters?: {
    type?: MemoryType[];
    tags?: string[];
    files?: string[];
    symbols?: string[];
    language?: string[];
    timeRange?: { start: string; end: string };
    tool?: string[];
    confidence?: { min?: number; max?: number };
    // Optional advanced filters for quality metrics
    feedback?: {
      minHelpful?: number;
      minNotHelpful?: number;
      minHelpfulRatio?: number; // helpfulCount / (helpfulCount + notHelpfulCount)
    };
    usage?: {
      minReuse?: number;
      minDecayedUsage?: number;
    };
    recency?: {
      lastUsedAfter?: string;
      lastAccessedAfter?: string;
    };
    pinned?: boolean;
  };
  k?: number;
  hybrid?: boolean;
  scope?: QueryScope;
  return?: 'items' | 'contextPack';
  snippetWindow?: { before: number; after: number };
}

export interface MemorySearchResult {
  items: MemoryItem[];
  total: number;
  scope: QueryScope;
  query: MemoryQuery;
}

export interface MemoryContextPack {
  title: string;
  hints: string[];
  snippets: Array<{
    language?: string;
    file?: string;
    range?: { start: number; end: number };
    code: string;
  }>;
  facts: string[];
  configs: Array<{ key: string; value: string; context?: string }>;
  patterns: Array<{ title: string; description: string; code?: string }>;
  links: Array<{ rel: string; to: string; title?: string }>;
  source: { scope: QueryScope; ids: string[] };
}

export interface ProjectInfo {
  repoId: string;
  root: string;
  branch?: string;
  remote?: string;
  hasCommittedMemory: boolean;
}

export interface MemoryConfig {
  version: string;
  storage?: {
    backend?: 'file' | 'video' | 'markdown';
  };
  sharing?: {
    enabled: boolean;
    autoSync: boolean;
    sensitivity: Sensitivity;
  };
  filters?: {
    excludePaths: string[];
    excludeSecrets: boolean;
  };
  policies?: {
    autoLearn: boolean;
    ttlDays: number;
    maxItems: number;
  };
  confidence?: ConfidenceConfig;
  ranking?: {
    fieldWeights?: { title?: number; text?: number; code?: number; tag?: number };
    bm25?: { k1?: number; b?: number };
    scopeBonus?: { global?: number; local?: number; committed?: number };
    pinBonus?: number;
    recency?: { halfLifeDays?: number; scale?: number };
    phrase?: { bonus?: number; exactTitleBonus?: number };
    hybrid?: { enabled?: boolean; wBM25?: number; wVec?: number; model?: string };
  };
  contextPack?: {
    order?: Array<'snippets' | 'facts' | 'patterns' | 'configs'>;
    caps?: { snippets?: number; facts?: number; patterns?: number; configs?: number };
  };
  maintenance?: {
    compactEvery?: number; // compact journal after N appends (default: 500)
    compactIntervalMs?: number; // time-based compaction interval (default: 24h)
    indexFlush?: { maxOps?: number; maxMs?: number }; // index scheduler flush thresholds
    snapshotIntervalMs?: number; // periodic snapshot interval (default: 24h)
  };
  embeddings?: {
    enabled?: boolean; // Enable auto-embedding on memory upsert (default: false)
    model?: string; // Model key from LocalEmbedder (default: 'all-MiniLM-L6-v2')
    indexType?: 'linear' | 'hnsw'; // Vector index type (default: 'hnsw')
    autoGenerate?: boolean; // Generate embeddings for text+code on upsert (default: true when enabled)
    hnsw?: {
      maxElements?: number; // Max capacity (default: 10000)
      M?: number; // HNSW connectivity parameter (default: 16)
      efConstruction?: number; // Build quality (default: 200)
      efSearch?: number; // Search quality (default: 50)
    };
  };
}

// Tunable parameters for confidence scoring
export interface ConfidenceConfig {
  // Bayesian prior for helpfulness
  priorAlpha?: number; // default: 1
  priorBeta?: number; // default: 1
  basePrior?: number; // default: 0.5

  // Time-based decay
  usageHalfLifeDays?: number; // default: 14
  recencyHalfLifeDays?: number; // default: 7

  // Usage saturation
  usageSaturationK?: number; // default: 5

  // Weights for linear blend
  weights?: {
    feedback?: number; // default: 0.35
    usage?: number;    // default: 0.25
    recency?: number;  // default: 0.20
    context?: number;  // default: 0.15
    base?: number;     // default: 0.05
  };

  // Pinned behavior
  pin?: {
    floor?: number;       // default: 0.8
    multiplier?: number;  // default: 1.05
  };

  // Expiry handling
  expiry?: {
    enabled?: boolean; // default: true
    taper?: boolean;   // default: true
  };

  // Context relevance weighting used when deriving a per-query contextMatch
  contextWeights?: {
    repo?: number;       // default: 0.4
    file?: number;       // default: 0.4
    tool?: number;       // default: 0.2
    tagSymbol?: number;  // default: 0.3 (cap)
    neutral?: number;    // default: 0.5 when no context present
  };
}

/**
 * Output format for context injection
 */
export type ContextOutputFormat = 'json' | 'markdown';

/**
 * Query parameters for mem.context tool - retrieves memories for prompt injection
 */
export interface ContextInjectionQuery {
  scope?: QueryScope;
  maxTokens?: number;           // Token budget for output (default: 4000)
  includeAlwaysInject?: boolean; // Include all 'always' injection memories (default: true)
  format?: ContextOutputFormat;  // Output format (default: 'json')
  minConfidence?: number;       // Minimum confidence threshold (default: 0.5)
  types?: MemoryType[];         // Filter by memory types
  tags?: string[];              // Filter by tags
}

/**
 * Result from context injection query
 */
export interface ContextInjectionResult {
  memories: ContextInjectionMemory[];
  tokenCount: number;
  truncated: boolean;
  format: ContextOutputFormat;
  formatted: string;            // Pre-formatted output in requested format
}

/**
 * Simplified memory representation for context injection
 */
export interface ContextInjectionMemory {
  id: string;
  type: MemoryType;
  injection: InjectionPolicy;
  confidence: number;
  title?: string;
  content: string;              // Combined text/code content
  tags: string[];
}

/**
 * Sort field options for recency-based retrieval
 */
export type RecencySortField = 'lastUsedAt' | 'lastAccessedAt' | 'updatedAt' | 'createdAt';

/**
 * Query parameters for mem.recent tool - retrieves recently accessed/modified memories
 */
export interface RecencyQuery {
  scope?: QueryScope;
  limit?: number;               // Max results (default: 10)
  types?: MemoryType[];         // Filter by memory types
  tags?: string[];              // Filter by tags
  sortBy?: RecencySortField;    // Sort field (default: 'lastAccessedAt')
  since?: string;               // Only return items accessed/modified since this ISO date
}

/**
 * Result from recency-based retrieval
 */
export interface RecencyResult {
  items: MemoryItem[];
  total: number;
  scope: QueryScope;
  sortBy: RecencySortField;
}
