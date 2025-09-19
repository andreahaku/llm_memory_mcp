import * as fs from 'node:fs';
import * as path from 'node:path';

type Vectors = Record<string, number[]>; // id -> embedding

export class VectorIndex {
  private dir: string;
  private path: string;
  private loaded = false;
  private vectors: Vectors = {};

  constructor(indexDir: string) {
    this.dir = indexDir;
    this.path = path.join(indexDir, 'vectors.json');
  }

  private ensure(): void {
    if (this.loaded) return;
    try {
      const raw = fs.readFileSync(this.path, 'utf8');
      this.vectors = JSON.parse(raw);
    } catch {
      this.vectors = {};
    }
    this.loaded = true;
  }

  private persist(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.path + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.vectors));
    fs.renameSync(tmp, this.path);
  }

  set(id: string, vec: number[]): void {
    this.ensure();
    this.vectors[id] = vec;
    this.persist();
  }

  remove(id: string): void {
    this.ensure();
    if (this.vectors[id]) delete this.vectors[id];
    this.persist();
  }

  search(query: number[], k: number = 100): Array<{ id: string; score: number }> {
    this.ensure();
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

