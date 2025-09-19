import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryItem } from '../types/Memory.js';
import { tokenize } from '../utils/tokenize.js';

type Postings = Record<string, Record<string, number>>; // token -> id -> tf (weighted)

interface Meta {
  updatedAt: string;
  docCount: number;
}

export class InvertedIndexer {
  private dir: string;
  private idxPath: string;
  private metaPath: string;
  private lengthsPath: string;
  private loaded = false;
  private postings: Postings = {};
  private meta: Meta = { updatedAt: new Date().toISOString(), docCount: 0 };
  private lengths: Record<string, number> = {};

  constructor(indexDir: string) {
    this.dir = indexDir;
    this.idxPath = path.join(indexDir, 'inverted.json');
    this.metaPath = path.join(indexDir, 'meta.json');
    this.lengthsPath = path.join(indexDir, 'lengths.json');
  }

  private defaultWeights = { title: 5, text: 2, code: 1.5, tag: 3 } as const;

  private ensure(): void {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.idxPath, 'utf8');
      this.postings = JSON.parse(raw);
    } catch {
      this.postings = {};
    }
    try {
      const raw = fs.readFileSync(this.metaPath, 'utf8');
      this.meta = JSON.parse(raw);
    } catch {
      this.meta = { updatedAt: new Date().toISOString(), docCount: 0 };
    }
    try {
      const raw = fs.readFileSync(this.lengthsPath, 'utf8');
      this.lengths = JSON.parse(raw);
    } catch {
      this.lengths = {};
    }
    this.loaded = true;
  }

  private persist(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmpIdx = this.idxPath + '.tmp';
    const tmpMeta = this.metaPath + '.tmp';
    const tmpLen = this.lengthsPath + '.tmp';
    fs.writeFileSync(tmpIdx, JSON.stringify(this.postings));
    this.meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(tmpMeta, JSON.stringify(this.meta, null, 2));
    fs.writeFileSync(tmpLen, JSON.stringify(this.lengths));
    fs.renameSync(tmpIdx, this.idxPath);
    fs.renameSync(tmpMeta, this.metaPath);
    fs.renameSync(tmpLen, this.lengthsPath);
  }

  updateItem(item: MemoryItem, weights?: { title?: number; text?: number; code?: number; tag?: number }): void {
    this.ensure();
    // Remove prior entries for id
    for (const tok of Object.keys(this.postings)) {
      if (this.postings[tok][item.id]) delete this.postings[tok][item.id];
      if (Object.keys(this.postings[tok]).length === 0) delete this.postings[tok];
    }

    // Compute weighted term frequencies and document length
    let docLen = 0;
    const w = {
      title: weights?.title ?? this.defaultWeights.title,
      text: weights?.text ?? this.defaultWeights.text,
      code: weights?.code ?? this.defaultWeights.code,
      tag: weights?.tag ?? this.defaultWeights.tag,
    };

    const add = (text: string | undefined, weight: number) => {
      if (!text) return;
      const toks = tokenize(text);
      docLen += toks.length * weight;
      for (const t of toks) {
        if (!this.postings[t]) this.postings[t] = {};
        this.postings[t][item.id] = (this.postings[t][item.id] || 0) + weight;
      }
    };

    add(item.title, w.title);
    add(item.text, w.text);
    add(item.code, w.code);
    for (const tag of item.facets.tags) add(tag, w.tag);

    const existed = this.lengths[item.id] != null;
    this.lengths[item.id] = docLen || 1; // avoid zero length
    // Update docCount and avg via meta; keep avg implicit via lengths
    if (!existed) this.meta.docCount = Object.keys(this.lengths).length;
    this.persist();
  }

  removeItem(id: string): void {
    this.ensure();
    for (const tok of Object.keys(this.postings)) {
      if (this.postings[tok][id]) delete this.postings[tok][id];
      if (Object.keys(this.postings[tok]).length === 0) delete this.postings[tok];
    }
    if (this.lengths[id] != null) {
      delete this.lengths[id];
      this.meta.docCount = Object.keys(this.lengths).length;
    }
    this.persist();
  }

  clear(): void {
    this.loaded = true;
    this.postings = {};
    this.meta = { updatedAt: new Date().toISOString(), docCount: 0 };
    this.lengths = {};
    this.persist();
  }

  rebuildFromItems(items: MemoryItem[], weights?: { title?: number; text?: number; code?: number; tag?: number }): void {
    this.loaded = true;
    this.postings = {};
    this.lengths = {};
    this.meta = { updatedAt: new Date().toISOString(), docCount: 0 };
    for (const it of items) this.updateItem(it, weights);
  }

  search(term: string, opts?: { boost?: (id: string) => number; bm25?: { k1?: number; b?: number } }): Array<{ id: string; score: number }> {
    this.ensure();
    const tokens = tokenize(term.toLowerCase());
    const N = Math.max(1, this.meta.docCount || 1);
    const k1 = opts?.bm25?.k1 ?? 1.5;
    const b = opts?.bm25?.b ?? 0.75;
    const avgdl = this.averageDocLength();

    const scores: Record<string, number> = {};
    for (const tok of tokens) {
      const posting = this.postings[tok];
      if (!posting) continue;
      const df = Object.keys(posting).length || 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      for (const [id, tf] of Object.entries(posting)) {
        const dl = this.lengths[id] || avgdl || 1;
        const denom = tf + k1 * (1 - b + b * (dl / (avgdl || 1)));
        const score = idf * ((tf * (k1 + 1)) / (denom || 1));
        scores[id] = (scores[id] || 0) + score;
      }
    }
    const arr = Object.entries(scores).map(([id, score]) => ({ id, score: score + (opts?.boost ? opts.boost(id) : 0) }));
    arr.sort((a, b) => b.score - a.score);
    return arr;
  }

  private averageDocLength(): number {
    const values = Object.values(this.lengths);
    if (!values.length) return 1;
    const sum = values.reduce((a, b) => a + b, 0);
    return sum / values.length;
  }
}
