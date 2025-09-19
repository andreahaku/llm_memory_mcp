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
  MemoryContextPack,
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

  private getRanking(scope: MemoryScope): {
    fieldWeights: { title: number; text: number; code: number; tag: number };
    bm25: { k1: number; b: number };
    scopeBonus: Record<MemoryScope, number>;
    pinBonus: number;
    recency: { halfLifeDays: number; scale: number };
    phrase: { bonus: number; exactTitleBonus: number };
  } {
    const cfg = this.readConfig(scope) || undefined;
    const r = cfg?.ranking || {};
    const fieldWeights = {
      title: r.fieldWeights?.title ?? 5,
      text: r.fieldWeights?.text ?? 2,
      code: r.fieldWeights?.code ?? 1.5,
      tag: r.fieldWeights?.tag ?? 3,
    };
    const bm25 = { k1: r.bm25?.k1 ?? 1.5, b: r.bm25?.b ?? 0.75 };
    const scopeBonus = {
      committed: r.scopeBonus?.committed ?? 1.5,
      local: r.scopeBonus?.local ?? 1.0,
      global: r.scopeBonus?.global ?? 0.5,
    } as Record<MemoryScope, number>;
    const pinBonus = r.pinBonus ?? 2;
    const recency = { halfLifeDays: r.recency?.halfLifeDays ?? 14, scale: r.recency?.scale ?? 2 };
    const phrase = { bonus: r.phrase?.bonus ?? 2.5, exactTitleBonus: r.phrase?.exactTitleBonus ?? 6 };
    return { fieldWeights, bm25, scopeBonus, pinBonus, recency, phrase };
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
    // Update inverted index with configurable field weights
    const rank = this.getRanking(item.scope);
    this.getIndexer(item.scope).updateItem(item, rank.fieldWeights as any);
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
        // Preload catalog for boosts (pin, recency)
        const st = this.getStore(s, cwd);
        const catalog = st.readCatalog();
        const rank = this.getRanking(s);
        const ranked = this.getIndexer(s, cwd).search(q.q, {
          bm25: rank.bm25,
          boost: (id) => {
            const entry = catalog[id];
            let b = rank.scopeBonus[s];
            if (!entry) return b;
            if (entry.pinned) b += rank.pinBonus;
            const updated = new Date(entry.updatedAt).getTime();
            const ageDays = Math.max(0, (Date.now() - updated) / (1000 * 60 * 60 * 24));
            const recency = rank.recency.scale * Math.exp(-ageDays / rank.recency.halfLifeDays);
            return b + recency;
          },
        });
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

    if (q.q) {
      // Apply phrase/exact-title bonuses and re-sort
      const term = q.q.toLowerCase();
      const rankById: Record<string, number> = {};
      for (const e of ids) if (e.score != null) rankById[e.id] = e.score!;
      const rank = this.getRanking('local'); // phrase weights are global; scope doesn't matter here
      const scored = items.map(it => {
        let score = rankById[it.id] || 0;
        const title = (it.title || '').toLowerCase();
        const text = (it.text || '').toLowerCase();
        const code = (it.code || '').toLowerCase();
        if (title === term) score += rank.phrase.exactTitleBonus;
        if (title.includes(term)) score += rank.phrase.bonus * 1.5;
        if (text.includes(term)) score += rank.phrase.bonus;
        if (code.includes(term)) score += rank.phrase.bonus * 0.75;
        return { it, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const k = q.k || 50;
      const chosen = scored.slice(0, k).map(s => s.it);
      return { items: chosen, total: scored.length, scope, query: q };
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
    const rank = this.getRanking(scope);
    indexer.rebuildFromItems(items, rank.fieldWeights as any);
    return { items: items.length };
  }

  async rebuildAll(cwd?: string): Promise<Record<MemoryScope, { items: number }>> {
    const scopes: MemoryScope[] = ['committed', 'local', 'global'];
    const out: Record<string, { items: number }> = {};
    for (const s of scopes) out[s] = await this.rebuildScope(s, cwd);
    return out as Record<MemoryScope, { items: number }>;
  }

  async contextPack(q: MemoryQuery, cwd?: string): Promise<MemoryContextPack> {
    const k = q.k ?? 12;
    const window = q.snippetWindow ?? { before: 6, after: 6 };
    const result = await this.query({ ...q, k });
    const items = result.items;

    const snippetLanguages = (q as any).snippetLanguages as string[] | undefined;
    const snippetFilePatterns = (q as any).snippetFilePatterns as string[] | undefined;
    const maxChars = (q as any).maxChars as number | undefined;

    const globs: RegExp[] | undefined = snippetFilePatterns?.map(p => {
      // Convert a simple glob (* and ?) to RegExp
      const esc = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
      return new RegExp('^' + esc + '$');
    });

    const fileMatches = (file?: string): boolean => {
      if (!globs || globs.length === 0) return true;
      if (!file) return false;
      return globs.some(rx => rx.test(file));
    };

    // Helpers for symbol-aware cropping
    const findSymbolWindow = (content: string, symbol?: string) => {
      if (!symbol) return null as { start: number; end: number } | null;
      const lines = content.split(/\r?\n/);
      const idx = lines.findIndex(l => l.includes(symbol));
      if (idx < 0) return null;
      const start = Math.max(0, idx - window.before);
      const end = Math.min(lines.length, idx + 1 + window.after);
      return { start, end };
    };

    // Build snippets under optional budget
    const snippets: MemoryContextPack['snippets'] = [];
    let remaining = maxChars ?? Number.POSITIVE_INFINITY;
    const pushWithBudget = (code: string, meta: { language?: string; file?: string; range?: { start: number; end: number } }) => {
      if (!Number.isFinite(remaining)) {
        snippets.push({ ...meta, code });
        return true;
      }
      const minChunk = 120; // minimal useful snippet
      if (code.length <= remaining) {
        snippets.push({ ...meta, code });
        remaining -= code.length;
        return true;
      } else if (remaining >= minChunk) {
        const sliced = code.slice(0, Math.max(minChunk, remaining - 3)) + '...';
        snippets.push({ ...meta, code: sliced });
        remaining -= sliced.length;
        return false; // budget likely exhausted
      }
      return false;
    };

    for (const it of items) {
      if (snippetLanguages && snippetLanguages.length) {
        if (!it.language || !snippetLanguages.includes(it.language)) continue;
      }
      if (!fileMatches(it.context?.file)) continue;
      const content = (it.code ?? it.text ?? '').trim();
      if (!content) continue;
      const lines = content.split(/\r?\n/);
      let code = content;
      if (it.context?.range && Number.isFinite(it.context.range.start) && Number.isFinite(it.context.range.end)) {
        const start = Math.max(0, it.context.range.start - 1 - window.before);
        const end = Math.min(lines.length, (it.context.range.end) + window.after);
        code = lines.slice(start, end).join('\n');
      } else {
        const sym = it.context?.function || it.facets.symbols?.[0];
        const win = findSymbolWindow(content, sym);
        if (win) code = lines.slice(win.start, win.end).join('\n');
      }
      const ok = pushWithBudget(code, { language: it.language, file: it.context?.file, range: it.context?.range });
      if (snippets.length >= Math.min(k, 12) || (Number.isFinite(remaining) && remaining <= 0)) break;
    }

    // Facts and configs
    const facts: string[] = [];
    const configs: MemoryContextPack['configs'] = [];
    const patterns: MemoryContextPack['patterns'] = [];
    const links: MemoryContextPack['links'] = [];

    for (const it of items) {
      if (it.type === 'fact') {
        const t = (it.text || it.title || '').trim();
        if (t) {
          const s = t.length;
          if (!Number.isFinite(remaining) || s <= remaining) {
            facts.push(t);
            if (Number.isFinite(remaining)) remaining -= s;
          } else if (remaining > 40) {
            facts.push(t.slice(0, remaining - 3) + '...');
            remaining = 0;
          }
        }
      } else if (it.type === 'config') {
        let val = (it.text || it.code || '').trim();
        if (Number.isFinite(remaining) && val.length > remaining) {
          if (remaining <= 40) continue;
          val = val.slice(0, remaining - 3) + '...';
          remaining = 0;
        } else if (Number.isFinite(remaining)) {
          remaining -= val.length;
        }
        configs.push({ key: it.title || '', value: val, context: it.context?.file });
      } else if (it.type === 'pattern') {
        let desc = (it.text || '').trim();
        if (Number.isFinite(remaining) && desc.length > remaining) {
          if (remaining > 40) {
            desc = desc.slice(0, remaining - 3) + '...';
            remaining = 0;
          } else continue;
        } else if (Number.isFinite(remaining)) {
          remaining -= desc.length;
        }
        patterns.push({ title: it.title || '', description: desc, code: it.code });
      }
      for (const l of it.links || []) {
        links.push({ rel: l.rel, to: l.to, title: it.title });
      }
    }

    // Hints: collect top tags and titles
    const tagCount = new Map<string, number>();
    for (const it of items) for (const t of it.facets.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    const hints: string[] = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => `tag:${t}`);
    for (const it of items.slice(0, 5)) if (it.title) hints.push(`title:${it.title}`);

    return {
      title: q.q || 'Context Pack',
      hints,
      snippets,
      facts,
      configs,
      patterns,
      links,
      source: { scope: result.scope, ids: items.map(i => i.id) },
    };
  }
}
