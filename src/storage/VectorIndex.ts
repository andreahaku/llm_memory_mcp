import * as fs from 'node:fs';
import * as path from 'node:path';

type Vectors = Record<string, number[]>; // id -> embedding
interface VectorMeta { dim?: number; updatedAt?: string }

export class VectorIndex {
  private dir: string;
  private path: string;
  private metaPath: string;
  private loaded = false;
  private vectors: Vectors = {};
  private meta: VectorMeta = {};

  constructor(indexDir: string) {
    this.dir = indexDir;
    this.path = path.join(indexDir, 'vectors.json');
    this.metaPath = path.join(indexDir, 'vectors.meta.json');
  }

  private ensure(): void {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.path, 'utf8');
      this.vectors = JSON.parse(raw);
    } catch {
      this.vectors = {};
    }
    try {
      const raw = fs.readFileSync(this.metaPath, 'utf8');
      this.meta = JSON.parse(raw);
    } catch {
      this.meta = {};
    }
    this.loaded = true;
  }

  private persist(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.path + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.vectors));
    fs.renameSync(tmp, this.path);
    const tmpm = this.metaPath + '.tmp';
    this.meta.updatedAt = new Date().toISOString();
    fs.writeFileSync(tmpm, JSON.stringify(this.meta));
    fs.renameSync(tmpm, this.metaPath);
  }

  set(id: string, vec: number[]): void {
    this.ensure();
    if (!Array.isArray(vec) || vec.length === 0) throw new Error('vector must be non-empty numeric array');
    const dim = vec.length;
    if (!this.meta.dim) this.meta.dim = dim;
    if (this.meta.dim !== dim) throw new Error(`vector dimension mismatch: expected ${this.meta.dim}, got ${dim}`);
    this.vectors[id] = vec;
    this.persist();
  }

  remove(id: string): void {
    this.ensure();
    if (this.vectors[id]) delete this.vectors[id];
    this.persist();
  }

  setBulk(items: Array<{ id: string; vector: number[] }>): { ok: number; skipped: Array<{ id: string; reason: string }> } {
    this.ensure();
    const skipped: Array<{ id: string; reason: string }> = [];
    let ok = 0;
    for (const it of items) {
      try { this.set(it.id, it.vector); ok++; } catch (e: any) { skipped.push({ id: it.id, reason: e?.message || 'invalid' }); }
    }
    return { ok, skipped };
  }

  search(query: number[], k: number = 100): Array<{ id: string; score: number }> {
    this.ensure();
    if (this.meta.dim && query.length !== this.meta.dim) return [];
    const out: Array<{ id: string; score: number }> = [];
    const qn = norm(query);
    if (qn === 0) return out;
    for (const [id, v] of Object.entries(this.vectors)) {
      if (!v || v.length !== query.length) continue;
      const s = cosine(query, v);
      if (s > 0) out.push({ id, score: s });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, k);
  }
}

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) { dot += a[i] * b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
