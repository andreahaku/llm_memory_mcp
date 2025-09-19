import * as path from 'node:path';
import * as os from 'node:os';
import { ulid } from './util/ulid.js';
import { ScopeResolver } from './scope/ScopeResolver.js';
import { FileStore } from './storage/fileStore.js';
import { InvertedIndexer } from './storage/Indexer.js';
import { redactSecrets } from './utils/secretFilter.js';
import type {
  MemoryItem,
  MemoryItemSummary,
  MemoryQuery,
  MemorySearchResult,
  MemoryScope,
  ProjectInfo,
  MemoryConfig,
  MemoryLink,
} from './types/Memory.js';

type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export class MemoryManager {
  private resolver = new ScopeResolver();

  // Lazily created per-scope stores
  private stores: Partial<Record<MemoryScope, FileStore>> = {};
  private indexers: Partial<Record<MemoryScope, InvertedIndexer>> = {};

  private getStore(scope: MemoryScope, cwd?: string): FileStore {
    if (!this.stores[scope]) {
      const dir = this.resolver.getScopeDirectory(scope, cwd);
      this.stores[scope] = new FileStore(dir);
    }
    return this.stores[scope]!;
  }

  private getIndexer(scope: MemoryScope, cwd?: string): InvertedIndexer {
    if (!this.indexers[scope]) {
      const dir = this.resolver.getScopeDirectory(scope, cwd);
      this.indexers[scope] = new InvertedIndexer(path.join(dir, 'index'));
    }
    return this.indexers[scope]!;
  }

  getProjectInfo(cwd?: string): ProjectInfo {
    return this.resolver.detectProject(cwd);
  }

  initCommittedMemory(cwd?: string): string {
    return this.resolver.initCommittedMemory(cwd);
  }

  readConfig(scope: MemoryScope, cwd?: string): MemoryConfig | null {
    return this.getStore(scope, cwd).readConfig();
  }

  writeConfig(scope: MemoryScope, config: MemoryConfig, cwd?: string): void {
    this.getStore(scope, cwd).writeConfig(config);
  }

  async upsert(input: PartialBy<MemoryItem, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'facets' | 'context' | 'quality' | 'security' | 'type' | 'scope'> & { type: MemoryItem['type']; scope: MemoryScope }): Promise<string> {
    const now = new Date().toISOString();
    const id = input.id || ulid();

    const store = this.getStore(input.scope);
    const existing = await store.readItem(id);

    // Redact likely secrets from free text/code
    const redText = redactSecrets(input.text);
    const redCode = redactSecrets(input.code);

    const item: MemoryItem = {
      id,
      type: input.type,
      scope: input.scope,
      title: input.title,
      text: redText.text,
      code: redCode.text,
      language: input.language,
      facets: {
        tags: input.facets?.tags || (input as any).tags || [],
        files: input.facets?.files || (input as any).files || [],
        symbols: input.facets?.symbols || (input as any).symbols || [],
      },
      context: {
        repoId: input.context?.repoId,
        branch: input.context?.branch,
        commit: input.context?.commit,
        tool: input.context?.tool,
        source: input.context?.source,
        file: input.context?.file,
        range: input.context?.range,
        function: input.context?.function,
        package: input.context?.package,
        framework: input.context?.framework,
      },
      quality: {
        confidence: input.quality?.confidence ?? 0.75,
        reuseCount: existing?.quality.reuseCount ?? 0,
        pinned: input.quality?.pinned ?? false,
        ttlDays: input.quality?.ttlDays,
        expiresAt: input.quality?.expiresAt,
      },
      security: {
        sensitivity: input.security?.sensitivity || 'private',
        secretHashRefs: Array.from(new Set([...(input.security?.secretHashRefs || []), ...redText.refs, ...redCode.refs])),
      },
      vectors: input.vectors,
      links: input.links ?? existing?.links,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };

    await store.writeItem(item);
    // Update inverted index
    this.getIndexer(item.scope).updateItem(item);
    return item.id;
  }

  async get(id: string, scope?: MemoryScope, cwd?: string): Promise<MemoryItem | null> {
    if (scope) {
      return await this.getStore(scope, cwd).readItem(id);
    }
    // Search all scopes with project priority: committed -> local -> global
    const order: MemoryScope[] = ['committed', 'local', 'global'];
    for (const s of order) {
      const item = await this.getStore(s, cwd).readItem(id);
      if (item) return item;
    }
    return null;
  }

  async delete(id: string, scope?: MemoryScope, cwd?: string): Promise<boolean> {
    if (scope) {
      const ok = await this.getStore(scope, cwd).deleteItem(id);
      if (ok) this.getIndexer(scope, cwd).removeItem(id);
      return ok;
    }
    const order: MemoryScope[] = ['committed', 'local', 'global'];
    for (const s of order) {
      const ok = await this.getStore(s, cwd).deleteItem(id);
      if (ok) {
        this.getIndexer(s, cwd).removeItem(id);
        return true;
      }
    }
    return false;
  }

  async list(scope: MemoryScope | 'project' | 'all' = 'project', limit?: number, cwd?: string): Promise<MemoryItemSummary[]> {
    const catalogs: MemoryItemSummary[] = [];
    const addFrom = async (s: MemoryScope) => {
      const st = this.getStore(s, cwd);
      const cat = st.readCatalog();
      catalogs.push(...Object.values(cat));
    };

    if (scope === 'all') {
      await addFrom('committed');
      await addFrom('local');
      await addFrom('global');
    } else if (scope === 'project') {
      await addFrom('committed');
      await addFrom('local');
    } else {
      await addFrom(scope);
    }

    catalogs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return limit ? catalogs.slice(0, limit) : catalogs;
  }

  async query(q: MemoryQuery, cwd?: string): Promise<MemorySearchResult> {
    const scope = q.scope || 'project';
    const ids: Array<{ scope: MemoryScope; id: string; score?: number }> = [];
    const items: MemoryItem[] = [];

    const pushScope = async (s: MemoryScope) => {
      if (q.q) {
        // Use inverted index for term lookup
        const ranked = this.getIndexer(s, cwd).search(q.q, (id) => 0);
        for (const r of ranked) ids.push({ scope: s, id: r.id, score: r.score });
      } else {
        const st = this.getStore(s, cwd);
        const list = await st.listItems();
        for (const id of list) ids.push({ scope: s, id });
      }
    };

    if (scope === 'all') {
      await pushScope('committed');
      await pushScope('local');
      await pushScope('global');
    } else if (scope === 'project') {
      await pushScope('committed');
      await pushScope('local');
    } else {
      await pushScope(scope);
    }

    // Load and filter
    for (const entry of ids) {
      const s = entry.scope;
      const id = entry.id;
      const item = await this.getStore(s, cwd).readItem(id);
      if (!item) continue;
      if (!this.filterItem(item, q)) continue;
      items.push(item);
    }

    // Score and sort
    if (q.q) {
      const term = q.q.toLowerCase();
      items.sort((a, b) => this.score(b, term) - this.score(a, term));
    } else {
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    const k = q.k || 50;
    const chosen = items.slice(0, k);

    if (q.return === 'contextPack') {
      // Minimal context pack synthesis
      // Group snippets and facts/configs/patterns
      const pack = {
        title: q.q || 'Context Pack',
        hints: [],
        snippets: chosen
          .filter(x => !!x.code || !!x.text)
          .slice(0, 8)
          .map(x => ({
            language: x.language,
            file: x.context.file,
            range: x.context.range,
            code: x.code || x.text || '',
          })),
        facts: chosen.filter(x => x.type === 'fact').map(x => x.text || x.title || '').filter(Boolean) as string[],
        configs: chosen
          .filter(x => x.type === 'config')
          .map(x => ({ key: x.title || '', value: x.text || x.code || '', context: x.context.file })),
        patterns: chosen
          .filter(x => x.type === 'pattern')
          .map(x => ({ title: x.title || '', description: x.text || '', code: x.code })),
        links: chosen.flatMap(x => (x.links || []).map(l => ({ rel: l.rel, to: l.to, title: x.title }))),
        source: { scope, ids: chosen.map(x => x.id) },
      } as const;

      return { items: chosen, total: items.length, scope, query: q };
    }

    return { items: chosen, total: items.length, scope, query: q };
  }

  private filterItem(item: MemoryItem, q: MemoryQuery): boolean {
    const f = q.filters || {};
    if (f.type && f.type.length && !f.type.includes(item.type)) return false;
    if (f.tags && f.tags.length && !f.tags.some(t => item.facets.tags.includes(t))) return false;
    if (f.files && f.files.length && !f.files.some(f => item.facets.files.includes(f) || item.context.file === f)) return false;
    if (f.symbols && f.symbols.length && !f.symbols.some(s => item.facets.symbols.includes(s))) return false;
    if (f.language && f.language.length && (!item.language || !f.language.includes(item.language))) return false;
    if (typeof f.pinned === 'boolean' && (item.quality.pinned || false) !== f.pinned) return false;
    if (f.confidence && (f.confidence.min != null || f.confidence.max != null)) {
      const c = item.quality.confidence;
      if (f.confidence.min != null && c < f.confidence.min) return false;
      if (f.confidence.max != null && c > f.confidence.max) return false;
    }
    if (f.timeRange) {
      const start = f.timeRange.start;
      const end = f.timeRange.end;
      if (start && item.updatedAt < start) return false;
      if (end && item.updatedAt > end) return false;
    }
    if (q.q) {
      const term = q.q.toLowerCase();
      const hay = [item.title, item.text, item.code, ...item.facets.tags].filter(Boolean).join('\n').toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  }

  private score(item: MemoryItem, term: string): number {
    let s = 0;
    const t = item.title?.toLowerCase() || '';
    const text = (item.text || '').toLowerCase();
    const code = (item.code || '').toLowerCase();
    const tags = item.facets.tags.map(x => x.toLowerCase());
    if (t.includes(term)) s += 10;
    if (t === term) s += 20;
    if (tags.some(x => x === term)) s += 12;
    if (tags.some(x => x.includes(term))) s += 6;
    if (text.includes(term)) s += 5;
    if (code.includes(term)) s += 4;
    if (item.quality.pinned) s += 5;
    // Scope boost: committed > local > global
    if (item.scope === 'committed') s += 3;
    else if (item.scope === 'local') s += 2;
    else if (item.scope === 'global') s += 1;
    return s;
  }

  async link(fromId: string, rel: MemoryLink['rel'], toId: string, scope?: MemoryScope, cwd?: string): Promise<boolean> {
    const item = await this.get(fromId, scope, cwd);
    if (!item) return false;
    const store = this.getStore(item.scope, cwd);
    item.links = [...(item.links || []), { rel, to: toId }];
    item.updatedAt = new Date().toISOString();
    item.version += 1;
    await store.writeItem(item);
    return true;
  }

  async setPinned(id: string, pinned: boolean, scope?: MemoryScope, cwd?: string): Promise<boolean> {
    const item = await this.get(id, scope, cwd);
    if (!item) return false;
    const store = this.getStore(item.scope, cwd);
    item.quality.pinned = pinned;
    item.updatedAt = new Date().toISOString();
    item.version += 1;
    await store.writeItem(item);
    return true;
  }

  async tag(id: string, add?: string[], remove?: string[], scope?: MemoryScope, cwd?: string): Promise<boolean> {
    const item = await this.get(id, scope, cwd);
    if (!item) return false;
    const store = this.getStore(item.scope, cwd);
    const set = new Set(item.facets.tags);
    for (const t of add || []) set.add(t);
    for (const t of remove || []) set.delete(t);
    item.facets.tags = Array.from(set);
    item.updatedAt = new Date().toISOString();
    item.version += 1;
    await store.writeItem(item);
    return true;
  }

  async rebuildScope(scope: MemoryScope, cwd?: string): Promise<{ items: number }> {
    const store = this.getStore(scope, cwd);
    const ids = await store.listItems();
    const items: MemoryItem[] = [];
    for (const id of ids) {
      const it = await store.readItem(id);
      if (it) items.push(it);
    }
    await store.rebuildCatalog();
    const indexer = this.getIndexer(scope, cwd);
    indexer.rebuildFromItems(items);
    return { items: items.length };
  }

  async rebuildAll(cwd?: string): Promise<Record<MemoryScope, { items: number }>> {
    const scopes: MemoryScope[] = ['committed', 'local', 'global'];
    const out: Record<string, { items: number }> = {};
    for (const s of scopes) out[s] = await this.rebuildScope(s, cwd);
    return out as Record<MemoryScope, { items: number }>;
  }
}
