// Tiny LRU cache — Map-based so insertion order = recency order. Used by the
// AI client to memoize identical prompts (cheap & deterministic), and by the
// vector embedder for short-string lookups.

export class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      // Re-insert to mark as most recently used.
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const first = this.map.keys().next().value as K | undefined;
      if (first !== undefined) this.map.delete(first);
    }
  }

  has(key: K): boolean { return this.map.has(key); }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}
