export type MemoryScope = 'global' | 'local' | 'committed';
export type QueryScope = MemoryScope | 'project' | 'all';

export interface MemoryItem {
  id: string; // ULID-like
  content: string;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  tags?: string[];
  metadata?: Record<string, unknown>;
  // Optional hints for ranking or origin
  origin?: {
    scope?: MemoryScope;
    repoId?: string;
    projectRoot?: string;
  };
}

export interface CatalogEntry {
  id: string;
  title?: string;
  tags?: string[];
  updatedAt: string;
}

export interface QueryParams {
  q: string;
  scope?: QueryScope; // default: 'project'
  limit?: number; // default: 20
}

export interface WriteParams {
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  scope?: Exclude<QueryScope, 'all' | 'project'>; // explicit, else default by commit
  commit?: boolean; // if true, write to committed project scope
}

export interface UpdateParams {
  id: string;
  patch: Partial<Pick<MemoryItem, 'content' | 'tags' | 'metadata'>>;
  scope?: QueryScope;
}

export interface ReadParams {
  id: string;
  scope?: QueryScope;
}

export interface ProjectConfig {
  version: '1.0';
  sharing: {
    enabled: boolean;
    autoSync: boolean;
    sensitivity: 'public' | 'team' | 'private';
  };
  filters: {
    excludePaths: string[];
    excludeSecrets: boolean;
  };
  policies: {
    autoLearn: boolean;
    ttlDays: number;
    maxItems: number;
  };
}

export interface RepoContext {
  projectRoot: string; // absolute
  repoId: string; // stable id for local project scope
}

