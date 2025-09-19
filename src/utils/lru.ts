export class LRU<K, V> {
  private max: number;
  private map: Map<K, V> = new Map();

  constructor(max: number = 100) {
    this.max = Math.max(1, max);
  }

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // refresh
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      // delete oldest
      const first = this.map.keys().next();
      if (!first.done) this.map.delete(first.value as K);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

