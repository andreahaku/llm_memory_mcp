export type MemoryType = 'snippet' | 'pattern' | 'config' | 'insight' | 'runbook' | 'fact' | 'note';

export type MemoryScope = 'global' | 'local' | 'committed';
export type QueryScope = 'global' | 'local' | 'committed' | 'project' | 'all';

export type Sensitivity = 'public' | 'team' | 'private';

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
