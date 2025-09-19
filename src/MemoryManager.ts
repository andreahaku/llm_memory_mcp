import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { ulid } from './util/ulid.js';
import { ScopeResolver } from './scope/ScopeResolver.js';
import { FileStore } from './storage/fileStore.js';
import { InvertedIndexer } from './storage/Indexer.js';
import { VectorIndex } from './storage/VectorIndex.js';
import { redactSecrets } from './utils/secretFilter.js';
import { estimateTokens, allowedCharsForTokens } from './utils/tokenEstimate.js';
import { LRU } from './utils/lru.js';
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
  private vectorIdx: Partial<Record<MemoryScope, VectorIndex>> = {};
  private queryCache = new LRU<string, MemorySearchResult>(100);
  private indexUpserts: Partial<Record<MemoryScope, Map<string, MemoryItem>>> = {};
  private indexDeletes: Partial<Record<MemoryScope, Set<string>>> = {};
  private indexTimers: Partial<Record<MemoryScope, NodeJS.Timeout>> = {};
  private compactionIntervals: Partial<Record<MemoryScope, NodeJS.Timeout>> = {};
  private configWatchers: Partial<Record<MemoryScope, fs.FSWatcher>> = {};
  private configDebounce: Partial<Record<MemoryScope, NodeJS.Timeout>> = {};
  private snapshotIntervals: Partial<Record<MemoryScope, NodeJS.Timeout>> = {};

  constructor() {
    // Background journal replay across scopes for fast consistency on startup
    setImmediate(() => {
      this.startupFastRecover().catch(() => {});
    });
  }

  private getStore(scope: MemoryScope, cwd?: string): FileStore {
    if (!this.stores[scope]) {
      const dir = this.resolver.getScopeDirectory(scope, cwd);
      const store = new FileStore(dir);
      // Set compaction hook based on scope config
      const cfg = this.readConfig(scope, cwd) || undefined;
      const thr = cfg?.maintenance?.compactEvery || 500;
      store.setCompactionHook(() => {
        // Compact by replaying and truncating journal for this scope
        this.replayJournal(scope, cwd, true).catch(() => {});
        this.queryCache.clear();
      }, thr);
      // Time-based compaction (default daily)
      const intervalMs = cfg?.maintenance?.compactIntervalMs ?? 24 * 60 * 60 * 1000;
      if (intervalMs > 0 && !this.compactionIntervals[scope]) {
        this.compactionIntervals[scope] = setInterval(() => {
          this.replayJournal(scope, cwd, true).catch(() => {});
          this.queryCache.clear();
        }, intervalMs);
      }
      // Time-based snapshot (default daily)
      const snapMs = cfg?.maintenance?.snapshotIntervalMs ?? 24 * 60 * 60 * 1000;
      if (snapMs > 0 && !this.snapshotIntervals[scope]) {
        this.snapshotIntervals[scope] = setInterval(() => {
          const ts = new Date().toISOString();
          const checksum = this.computeScopeChecksum(scope);
          this.getStore(scope).writeSnapshotMeta({ lastTs: ts, checksum });
        }, snapMs);
      }
      // Config hot-reload watcher
      const configPath = path.join(dir, 'config.json');
      if (!this.configWatchers[scope]) {
        try {
          this.configWatchers[scope] = fs.watch(configPath, { persistent: false }, () => {
            if (this.configDebounce[scope]) clearTimeout(this.configDebounce[scope]!);
            this.configDebounce[scope] = setTimeout(() => this.applyConfig(scope, cwd), 200);
          });
        } catch {}
      }
      this.stores[scope] = store;
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

  private getVectorIndex(scope: MemoryScope, cwd?: string): VectorIndex {
    if (!this.vectorIdx[scope]) {
      const dir = this.resolver.getScopeDirectory(scope, cwd);
      this.vectorIdx[scope] = new VectorIndex(path.join(dir, 'index'));
    }
    return this.vectorIdx[scope]!;
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

    // Enforce sensitivity policy for committed scope
    if (item.scope === 'committed') {
      const cfg = this.readConfig('committed');
      const allowed = cfg?.sharing?.sensitivity || 'team'; // default: team
      const rank = (s: string) => (s === 'public' ? 0 : s === 'team' ? 1 : 2);
      if (rank(item.security.sensitivity) > rank(allowed)) {
        throw new Error(`Sensitivity '${item.security.sensitivity}' not allowed in committed scope (max: ${allowed})`);
      }
    }

    await store.writeItem(item);
    this.queryCache.clear();
    this.scheduleIndexUpsert(item.scope, item);
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
      if (ok) { this.scheduleIndexDelete(scope, id); this.getVectorIndex(scope, cwd).remove(id); }
      return ok;
    }
    const order: MemoryScope[] = ['committed', 'local', 'global'];
    for (const s of order) {
      const ok = await this.getStore(s, cwd).deleteItem(id);
      if (ok) { this.scheduleIndexDelete(s, id); this.getVectorIndex(s, cwd).remove(id); return true; }
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
    const key = JSON.stringify({
      q: q.q || '',
      scope: q.scope || 'project',
      type: q.filters?.type || [],
      tags: q.filters?.tags || [],
      files: q.filters?.files || [],
      symbols: q.filters?.symbols || [],
      language: q.filters?.language || [],
      k: q.k || 50,
    });
    const cached = this.queryCache.get(key);
    if (cached) return cached;
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
        const scoreMap: Record<string, number> = {};
        for (const r of ranked) { scoreMap[r.id] = r.score; ids.push({ scope: s, id: r.id, score: r.score }); }
        // Optional hybrid vector search
        const cfg = this.readConfig(s) || undefined;
        const h = cfg?.ranking?.hybrid;
        if (h?.enabled && (q as any).vector && Array.isArray((q as any).vector)) {
          const vec = (q as any).vector as number[];
          const topV = this.getVectorIndex(s, cwd).search(vec, q.k || 100);
          const wBM25 = h.wBM25 ?? 0.7;
          const wVec = h.wVec ?? 0.3;
          for (const v of topV) {
            const combined = (scoreMap[v.id] || 0) * wBM25 + v.score * wVec;
            scoreMap[v.id] = combined;
            // ensure present in ids list (will be rescored later)
            if (!ids.find(e => e.id === v.id && e.scope === s)) ids.push({ scope: s, id: v.id, score: combined });
          }
          // Update ids scores
          for (const e of ids) if (e.scope === s && scoreMap[e.id] != null) e.score = scoreMap[e.id];
        }
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
      const result = { items: chosen, total: scored.length, scope, query: q };
      this.queryCache.set(key, result);
      return result;
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

      const result = { items: chosen, total: items.length, scope, query: q };
      this.queryCache.set(key, result);
      return result;
    }

    const result = { items: chosen, total: items.length, scope, query: q };
    this.queryCache.set(key, result);
    return result;
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

  async replayJournal(scope: MemoryScope, cwd?: string, compact?: boolean): Promise<{ items: number; deleted: number }> {
    const store = this.getStore(scope, cwd);
    const entries = await store.readJournal();
    const final = new Map<string, MemoryItem | null>();
    let deleted = 0;
    for (const e of entries) {
      if (e.op === 'upsert' && e.item) {
        final.set(e.item.id, e.item as MemoryItem);
      } else if (e.op === 'delete' && e.id) {
        final.set(e.id, null);
        deleted++;
      }
    }
    // Build catalog and index from final state
    const items: MemoryItem[] = [];
    const catalog: Record<string, MemoryItemSummary> = {} as any;
    for (const [id, item] of final.entries()) {
      if (!item) continue;
      items.push(item);
      catalog[id] = {
        id: item.id,
        type: item.type,
        scope: item.scope,
        title: item.title,
        tags: item.facets.tags,
        files: item.facets.files,
        symbols: item.facets.symbols,
        confidence: item.quality.confidence,
        pinned: item.quality.pinned,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };
      // Ensure item file exists
      try { store.writeItemFileRaw(item); } catch {}
    }
    store.setCatalog(catalog);
    const indexer = this.getIndexer(scope, cwd);
    const rank = this.getRanking(scope);
    indexer.rebuildFromItems(items, rank.fieldWeights as any);
    if (compact) {
      const now = new Date().toISOString();
      const compacted = items.map(it => ({ op: 'upsert', item: it, ts: now, actor: 'compact' } as any));
      store.replaceJournal(compacted);
      const checksum = this.computeScopeChecksum(scope);
      store.writeSnapshotMeta({ lastTs: now, checksum });
      store.writeStateOk({ ts: now, checksum });
    }
    return { items: items.length, deleted };
  }

  async replayAllFromJournal(compact?: boolean, cwd?: string): Promise<Record<MemoryScope, { items: number; deleted: number }>> {
    const scopes: MemoryScope[] = ['committed', 'local', 'global'];
    const out: any = {};
    for (const s of scopes) out[s] = await this.replayJournal(s, cwd, compact);
    return out;
  }

  snapshotScope(scope: MemoryScope, ts?: string, cwd?: string): void {
    const store = this.getStore(scope, cwd);
    const when = ts || new Date().toISOString();
    store.writeSnapshotMeta({ lastTs: when });
  }

  snapshotProject(cwd?: string): void {
    const ts = new Date().toISOString();
    this.snapshotScope('committed', ts, cwd);
    this.snapshotScope('local', ts, cwd);
  }

  snapshotAll(cwd?: string): void {
    const ts = new Date().toISOString();
    for (const s of ['committed','local','global'] as MemoryScope[]) this.snapshotScope(s, ts, cwd);
  }

  verifyScope(scope: MemoryScope, cwd?: string): { ok: boolean; checksum?: string; snapshotChecksum?: string; lastTs?: string } {
    const store = this.getStore(scope, cwd);
    const snap = store.readSnapshotMeta();
    const state = store.readStateOk();
    const checksum = this.computeScopeChecksum(scope, cwd);
    const snapshotChecksum = snap?.checksum;
    const stateChecksum = state?.checksum;
    const ok = !!checksum && !!snapshotChecksum && checksum === snapshotChecksum;
    const okState = !!checksum && !!stateChecksum && checksum === stateChecksum;
    return { ok, checksum, snapshotChecksum, lastTs: snap?.lastTs, okState } as any;
  }

  verifyAll(cwd?: string): Record<MemoryScope, { ok: boolean; checksum?: string; snapshotChecksum?: string; lastTs?: string }> {
    const out: any = {};
    for (const s of ['committed','local','global'] as MemoryScope[]) out[s] = this.verifyScope(s, cwd);
    return out;
  }

  private async startupFastRecover(): Promise<void> {
    const scopes: MemoryScope[] = ['committed', 'local', 'global'];
    for (const s of scopes) {
      try {
        const store = this.getStore(s);
        const snap = store.readSnapshotMeta();
        if (!snap || !snap.lastTs) {
          // Fallback: full replay (no compact)
          await this.replayJournal(s, undefined, false);
          continue;
        }
        // Validate snapshot checksum if present
        if (snap.checksum) {
          const current = this.computeScopeChecksum(s);
          if (current && current !== snap.checksum) {
            await this.replayJournal(s, undefined, false);
            continue;
          }
        }
        const tail = await store.readJournalSince(snap.lastTs);
        if (!tail.length) continue;
        // Apply tail incrementally to catalog and index
        const catalog = store.readCatalog();
        const indexer = this.getIndexer(s);
        const weights = this.getRanking(s).fieldWeights as any;
        let last = snap.lastTs;
        for (const e of tail) {
          if (e.op === 'upsert' && e.item) {
            const it = e.item as MemoryItem;
            await store.writeItemFileRaw(it);
            catalog[it.id] = {
              id: it.id, type: it.type, scope: it.scope, title: it.title,
              tags: it.facets.tags, files: it.facets.files, symbols: it.facets.symbols,
              confidence: it.quality.confidence, pinned: it.quality.pinned,
              createdAt: it.createdAt, updatedAt: it.updatedAt,
            };
            indexer.updateItem(it, weights);
          } else if (e.op === 'delete' && e.id) {
            store.removeItemFileRaw(e.id);
            delete (catalog as any)[e.id];
            indexer.removeItem(e.id);
            // prune vector if present
            try { this.getVectorIndex(s).remove(e.id); } catch {}
          }
          if (e.ts && (!last || e.ts > last)) last = e.ts;
        }
        store.setCatalog(catalog);
        if (last) {
          const checksum = this.computeScopeChecksum(s);
          store.writeSnapshotMeta({ lastTs: last, checksum });
          store.writeStateOk({ ts: new Date().toISOString(), checksum });
        }
      } catch {
        // ignore per-scope failures at startup
      }
    }
  }

  // Index update scheduler
  private scheduleIndexUpsert(scope: MemoryScope, item: MemoryItem): void {
    if (!this.indexUpserts[scope]) this.indexUpserts[scope] = new Map();
    if (!this.indexDeletes[scope]) this.indexDeletes[scope] = new Set();
    this.indexDeletes[scope]!.delete(item.id);
    this.indexUpserts[scope]!.set(item.id, item);
    this.ensureIndexTimer(scope);
  }

  private scheduleIndexDelete(scope: MemoryScope, id: string): void {
    if (!this.indexUpserts[scope]) this.indexUpserts[scope] = new Map();
    if (!this.indexDeletes[scope]) this.indexDeletes[scope] = new Set();
    this.indexUpserts[scope]!.delete(id);
    this.indexDeletes[scope]!.add(id);
    this.ensureIndexTimer(scope);
  }

  private ensureIndexTimer(scope: MemoryScope): void {
    if (this.indexTimers[scope]) return;
    const maxMs = this.getIndexFlushConfig(scope).maxMs;
    this.indexTimers[scope] = setTimeout(() => {
      delete this.indexTimers[scope];
      const upserts = this.indexUpserts[scope] || new Map();
      const deletes = this.indexDeletes[scope] || new Set();
      this.indexUpserts[scope] = new Map();
      this.indexDeletes[scope] = new Set();
      const indexer = this.getIndexer(scope);
      const weights = this.getRanking(scope).fieldWeights as any;
      for (const item of upserts.values()) indexer.updateItem(item, weights);
      for (const id of deletes.values()) indexer.removeItem(id);
    }, Math.max(1, maxMs));
  }

  private getIndexFlushConfig(scope: MemoryScope): { maxOps: number; maxMs: number } {
    const cfg = this.readConfig(scope) || undefined;
    const maxOps = cfg?.maintenance?.indexFlush?.maxOps ?? 200;
    const maxMs = cfg?.maintenance?.indexFlush?.maxMs ?? 500;
    return { maxOps, maxMs };
  }

  private maybeFlushIndexSoon(scope: MemoryScope): void {
    const { maxOps } = this.getIndexFlushConfig(scope);
    const up = this.indexUpserts[scope]?.size ?? 0;
    const del = this.indexDeletes[scope]?.size ?? 0;
    if (up + del >= maxOps) {
      if (this.indexTimers[scope]) { clearTimeout(this.indexTimers[scope]!); delete this.indexTimers[scope]; }
      // Immediate flush
      const upserts = this.indexUpserts[scope] || new Map();
      const deletes = this.indexDeletes[scope] || new Set();
      this.indexUpserts[scope] = new Map();
      this.indexDeletes[scope] = new Set();
      const indexer = this.getIndexer(scope);
      const weights = this.getRanking(scope).fieldWeights as any;
      for (const item of upserts.values()) indexer.updateItem(item, weights);
      for (const id of deletes.values()) indexer.removeItem(id);
    }
  }

  private applyConfig(scope: MemoryScope, cwd?: string): void {
    try {
      const store = this.getStore(scope, cwd);
      const cfg = store.readConfig();
      // Update compaction threshold
      const thr = cfg?.maintenance?.compactEvery || 500;
      store.setCompactionHook(() => {
        this.replayJournal(scope, cwd, true).catch(() => {});
        this.queryCache.clear();
      }, thr);
      // Update time-based compaction interval
      const intervalMs = cfg?.maintenance?.compactIntervalMs ?? 24 * 60 * 60 * 1000;
      if (this.compactionIntervals[scope]) { clearInterval(this.compactionIntervals[scope]!); delete this.compactionIntervals[scope]; }
      if (intervalMs > 0) {
        this.compactionIntervals[scope] = setInterval(() => {
          this.replayJournal(scope, cwd, true).catch(() => {});
          this.queryCache.clear();
        }, intervalMs);
      }
      // Update snapshot interval timer
      const snapMs = cfg?.maintenance?.snapshotIntervalMs ?? 24 * 60 * 60 * 1000;
      if (this.snapshotIntervals[scope]) { clearInterval(this.snapshotIntervals[scope]!); delete this.snapshotIntervals[scope]; }
      if (snapMs > 0) {
        this.snapshotIntervals[scope] = setInterval(() => {
          const ts = new Date().toISOString();
          const checksum = this.computeScopeChecksum(scope);
          this.getStore(scope).writeSnapshotMeta({ lastTs: ts, checksum });
        }, snapMs);
      }
    } catch {}
  }

  private computeScopeChecksum(scope: MemoryScope, cwd?: string): string | undefined {
    const crypto = require('node:crypto');
    const fsmod = require('node:fs');
    const p = require('node:path');
    try {
      const dir = this.resolver.getScopeDirectory(scope, cwd);
      const h = crypto.createHash('sha1');
      const files = [
        p.join(dir, 'catalog.json'),
        p.join(dir, 'index', 'inverted.json'),
        p.join(dir, 'index', 'lengths.json'),
        p.join(dir, 'index', 'vectors.json')
      ];
      for (const f of files) {
        if (fsmod.existsSync(f)) {
          const data = fsmod.readFileSync(f);
          h.update(data);
        }
      }
      return h.digest('hex');
    } catch {
      return undefined;
    }
  }

  async syncStatus(cwd?: string): Promise<{ onlyLocal: MemoryItemSummary[]; onlyCommitted: MemoryItemSummary[]; localNewer: MemoryItemSummary[]; committedNewer: MemoryItemSummary[] }> {
    const localCat = this.getStore('local', cwd).readCatalog();
    const comCat = this.getStore('committed', cwd).readCatalog();
    const onlyLocal: MemoryItemSummary[] = [];
    const onlyCommitted: MemoryItemSummary[] = [];
    const localNewer: MemoryItemSummary[] = [];
    const committedNewer: MemoryItemSummary[] = [];
    const byIdCommitted = comCat;
    for (const l of Object.values(localCat)) {
      const r = byIdCommitted[l.id];
      if (!r) { onlyLocal.push(l); continue; }
      if (l.updatedAt > r.updatedAt) localNewer.push(l);
      else if (r.updatedAt > l.updatedAt) committedNewer.push(r);
    }
    for (const r of Object.values(comCat)) if (!localCat[r.id]) onlyCommitted.push(r);
    return { onlyLocal, onlyCommitted, localNewer, committedNewer };
  }

  async syncMerge(ids?: string[], cwd?: string): Promise<{ merged: string[]; skipped: Array<{ id: string; reason: string }> }> {
    const merged: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const localStore = this.getStore('local', cwd);
    const commitStore = this.getStore('committed', cwd);
    const cfg = this.readConfig('committed');
    const allowed = cfg?.sharing?.sensitivity || 'team';
    const rank = (s: string) => (s === 'public' ? 0 : s === 'team' ? 1 : 2);
    const list = ids && ids.length ? ids : await localStore.listItems();
    for (const id of list) {
      const item = await localStore.readItem(id);
      if (!item) continue;
      if (rank(item.security.sensitivity) > rank(allowed)) { skipped.push({ id, reason: `sensitivity ${item.security.sensitivity} exceeds ${allowed}` }); continue; }
      try {
        await commitStore.writeItem(item);
        // Debounced index update
        this.scheduleIndexUpsert('committed', item);
        merged.push(id);
      } catch (e: any) {
        skipped.push({ id, reason: e?.message || 'write failed' });
      }
    }
    // Invalidate caches
    this.queryCache.clear();
    return { merged, skipped };
  }

  // Vectors API
  async setVector(scope: MemoryScope, id: string, vector: number[], cwd?: string): Promise<void> {
    this.getVectorIndex(scope, cwd).set(id, vector);
  }

  removeVector(scope: MemoryScope, id: string, cwd?: string): void {
    this.getVectorIndex(scope, cwd).remove(id);
  }

  importVectorsBulk(scope: MemoryScope, items: Array<{ id: string; vector: number[] }>, cwd?: string): { ok: number; skipped: Array<{ id: string; reason: string }> } {
    return this.getVectorIndex(scope, cwd).setBulk(items);
  }

  importVectorsFromJsonl(scope: MemoryScope, filePath: string, dimOverride?: number, cwd?: string): { ok: number; skipped: Array<{ id: string; reason: string }> } {
    const fsmod = require('node:fs');
    try {
      const data = fsmod.readFileSync(filePath, 'utf8');
      const lines = data.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
      const items: Array<{ id: string; vector: number[] }> = [];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj && typeof obj.id === 'string' && Array.isArray(obj.vector)) {
            items.push({ id: obj.id, vector: obj.vector as number[] });
          }
        } catch {}
      }
      const res = this.getVectorIndex(scope, cwd).setBulk(items, dimOverride);
      return res;
    } catch (e: any) {
      return { ok: 0, skipped: [{ id: 'ALL', reason: e?.message || 'read failed' }] };
    }
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
    const tokenBudget = (q as any).tokenBudget as number | undefined;

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

    // Build sections under optional budget and with caps/order from config
    const getPackPrefs = () => {
      // Use project preference: prefer committed, then local, else global
      const prefScope: MemoryScope = (q.scope === 'global') ? 'global' : (q.scope === 'committed') ? 'committed' : 'local';
      const cfg = this.readConfig(prefScope) || undefined;
      const order = cfg?.contextPack?.order || ['snippets','facts','patterns','configs'];
      const caps = cfg?.contextPack?.caps || { snippets: 12, facts: 8, patterns: 6, configs: 6 };
      return { order, caps };
    };
    const prefs = getPackPrefs();

    const snippets: MemoryContextPack['snippets'] = [];
    let remainingChars = maxChars ?? Number.POSITIVE_INFINITY;
    let remainingTokens = tokenBudget ?? Number.POSITIVE_INFINITY;
    const minChunk = 120; // minimal useful snippet (chars)
    const pushWithBudget = (code: string, meta: { language?: string; file?: string; range?: { start: number; end: number } }) => {
      // Prefer token budget when provided; fall back to char budget
      if (isFinite(remainingTokens)) {
        const allowed = allowedCharsForTokens(remainingTokens);
        if (code.length <= allowed) {
          snippets.push({ ...meta, code });
          remainingTokens = Math.max(0, remainingTokens - estimateTokens(code));
          return true;
        } else if (allowed >= minChunk) {
          const sliced = code.slice(0, Math.max(minChunk, allowed - 3)) + '...';
          snippets.push({ ...meta, code: sliced });
          remainingTokens = 0;
          return false;
        }
        return false;
      }
      if (isFinite(remainingChars)) {
        if (code.length <= remainingChars) {
          snippets.push({ ...meta, code });
          remainingChars -= code.length;
          return true;
        } else if (remainingChars >= minChunk) {
          const sliced = code.slice(0, Math.max(minChunk, remainingChars - 3)) + '...';
          snippets.push({ ...meta, code: sliced });
          remainingChars = 0;
          return false;
        }
        return false;
      }
      snippets.push({ ...meta, code });
      return true;
    };

    // Prepare section collectors
    const facts: string[] = [];
    const configs: MemoryContextPack['configs'] = [];
    const patterns: MemoryContextPack['patterns'] = [];

    // Assemble each section in sequence based on order, consuming budget
    const sections = {
      snippets: () => {
        let count = 0;
        for (const it of items) {
          if (count >= (prefs.caps.snippets ?? 12)) break;
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
          if (!ok && (isFinite(remainingTokens) && remainingTokens <= 0) || (isFinite(remainingChars) && remainingChars <= 0)) break;
          count++;
        }
      },
      facts: () => {
        let count = 0;
        for (const it of items) {
          if (count >= (prefs.caps.facts ?? 8)) break;
          if (it.type !== 'fact') continue;
          const t = (it.text || it.title || '').trim();
          if (!t) continue;
          if (isFinite(remainingTokens)) {
            const allowed = allowedCharsForTokens(remainingTokens);
            if (t.length <= allowed) {
              facts.push(t); remainingTokens = Math.max(0, remainingTokens - estimateTokens(t));
            } else if (allowed > 40) { facts.push(t.slice(0, allowed - 3) + '...'); remainingTokens = 0; }
            else break;
          } else if (isFinite(remainingChars)) {
            if (t.length <= remainingChars) { facts.push(t); remainingChars -= t.length; }
            else if (remainingChars > 40) { facts.push(t.slice(0, remainingChars - 3) + '...'); remainingChars = 0; }
            else break;
          } else { facts.push(t); }
          count++;
        }
      },
      patterns: () => {
        let count = 0;
        for (const it of items) {
          if (count >= (prefs.caps.patterns ?? 6)) break;
          if (it.type !== 'pattern') continue;
          let desc = (it.text || '').trim();
          if (isFinite(remainingTokens)) {
            const allowed = allowedCharsForTokens(remainingTokens);
            if (desc.length > allowed) { if (allowed <= 40) break; desc = desc.slice(0, allowed - 3) + '...'; remainingTokens = 0; }
            else { remainingTokens = Math.max(0, remainingTokens - estimateTokens(desc)); }
          } else if (isFinite(remainingChars)) {
            if (desc.length > remainingChars) { if (remainingChars <= 40) break; desc = desc.slice(0, remainingChars - 3) + '...'; remainingChars = 0; }
            else { remainingChars -= desc.length; }
          }
          patterns.push({ title: it.title || '', description: desc, code: it.code });
          count++;
        }
      },
      configs: () => {
        let count = 0;
        for (const it of items) {
          if (count >= (prefs.caps.configs ?? 6)) break;
          if (it.type !== 'config') continue;
          let val = (it.text || it.code || '').trim();
          if (isFinite(remainingTokens)) {
            const allowed = allowedCharsForTokens(remainingTokens);
            if (val.length > allowed) { if (allowed <= 40) break; val = val.slice(0, allowed - 3) + '...'; remainingTokens = 0; }
            else { remainingTokens = Math.max(0, remainingTokens - estimateTokens(val)); }
          } else if (isFinite(remainingChars)) {
            if (val.length > remainingChars) { if (remainingChars <= 40) break; val = val.slice(0, remainingChars - 3) + '...'; remainingChars = 0; }
            else { remainingChars -= val.length; }
          }
          configs.push({ key: it.title || '', value: val, context: it.context?.file });
          count++;
        }
      }
    } as const;

    for (const section of prefs.order) {
      sections[section]();
      const budgetEmpty = (isFinite(remainingTokens) && remainingTokens <= 0) || (isFinite(remainingChars) && remainingChars <= 0);
      if (budgetEmpty) break;
    }
    
    const links: MemoryContextPack['links'] = [];
    for (const it of items) for (const l of it.links || []) links.push({ rel: l.rel, to: l.to, title: it.title });

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
