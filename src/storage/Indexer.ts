import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MemoryItem, MemoryItemSummary } from '../types/Memory.js';
import { tokenize } from '../utils/tokenize.js';

type Postings = Record<string, Record<string, number>>; // token -> id -> weight

interface Meta {
  updatedAt: string;
  docCount: number;
}

export class InvertedIndexer {
  private dir: string;
  private idxPath: string;
  private metaPath: string;
  private loaded = false;
  private postings: Postings = {};
  private meta: Meta = { updatedAt: new Date().toISOString(), docCount: 0 };

  constructor(indexDir: string) {
    this.dir = indexDir;
    this.idxPath = path.join(indexDir, 'inverted.json');
    this.metaPath = path.join(indexDir, 'meta.json');
  }

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
    this.loaded = true;
  }

  private persist(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.idxPath, JSON.stringify(this.postings));
    this.meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.metaPath, JSON.stringify(this.meta, null, 2));
  }

  updateItem(item: MemoryItem): void {
    this.ensure();
    // Remove prior entries for id
    for (const tok of Object.keys(this.postings)) {
      if (this.postings[tok][item.id]) delete this.postings[tok][item.id];
      if (Object.keys(this.postings[tok]).length === 0) delete this.postings[tok];
    }

    const add = (text: string, weight: number) => {
      for (const t of tokenize(text)) {
        if (!this.postings[t]) this.postings[t] = {};
        this.postings[t][item.id] = (this.postings[t][item.id] || 0) + weight;
      }
    };

    if (item.title) add(item.title, 5);
    if (item.text) add(item.text, 2);
    if (item.code) add(item.code, 1.5);
    for (const tag of item.facets.tags) add(tag, 3);

    this.meta.docCount += 0; // keep simple now
    this.persist();
  }

  removeItem(id: string): void {
    this.ensure();
    for (const tok of Object.keys(this.postings)) {
      if (this.postings[tok][id]) delete this.postings[tok][id];
      if (Object.keys(this.postings[tok]).length === 0) delete this.postings[tok];
    }
    this.persist();
  }

  search(term: string, boost?: (id: string) => number): Array<{ id: string; score: number }> {
    this.ensure();
    const t = term.toLowerCase();
    const scores: Record<string, number> = {};
    const tokens = tokenize(t);
    for (const tok of tokens) {
      const posting = this.postings[tok];
      if (!posting) continue;
      for (const [id, w] of Object.entries(posting)) {
        scores[id] = (scores[id] || 0) + w;
      }
    }
    const arr = Object.entries(scores).map(([id, score]) => ({ id, score: score + (boost ? boost(id) : 0) }));
    arr.sort((a, b) => b.score - a.score);
    return arr;
  }
}

