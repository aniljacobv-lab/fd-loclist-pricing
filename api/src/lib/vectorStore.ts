import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ----------------------------------------------------------------------------
// In-memory vector index. Vectors are L2-normalized on insert, so similarity
// is just a dot product. Stays in RAM; persisted to a JSON file (vectors are
// base64-encoded Float32 buffers — compact, lossless, portable across hosts).
//
// Designed for the catalog scale we target (≤ ~500k items × ≤ 1024 dims ≈
// 2 GB in memory; ≤ 50k items × 512 dims ≈ 100 MB — fits any host comfortably).
// For the production Oracle path, swap this for pgvector or Oracle 23ai
// vectors — only the four public methods (add/addBulk/search/persist) change.
// ----------------------------------------------------------------------------

export interface VectorSearchHit { id: number; score: number; }

export class VectorStore {
  private ids: number[] = [];
  private vectors: Float32Array[] = [];
  private byId = new Map<number, number>();   // id -> position
  public providerName = '';
  public dimensions = 0;
  public lastUpdated: string | null = null;

  size(): number { return this.ids.length; }

  add(id: number, vector: Float32Array): void {
    if (this.vectors.length === 0) this.dimensions = vector.length;
    else if (vector.length !== this.dimensions) {
      throw new Error(`vector dim ${vector.length} != index dim ${this.dimensions}`);
    }
    const at = this.byId.get(id);
    if (at != null) { this.vectors[at] = vector; return; }
    this.byId.set(id, this.ids.length);
    this.ids.push(id);
    this.vectors.push(vector);
  }

  addBulk(rows: { id: number; vector: Float32Array }[]): void { for (const r of rows) this.add(r.id, r.vector); }

  get(id: number): Float32Array | null {
    const at = this.byId.get(id);
    return at == null ? null : this.vectors[at]!;
  }

  // Top-k by cosine similarity. Optional filter() can drop ids before scoring
  // (useful for "find similar but exclude these dept/vendor" queries).
  search(query: Float32Array, k = 10, filter?: (id: number) => boolean): VectorSearchHit[] {
    if (query.length !== this.dimensions) {
      throw new Error(`query dim ${query.length} != index dim ${this.dimensions}`);
    }
    // Heap-style partial sort: walk all vectors and keep the best k.
    const heap: VectorSearchHit[] = [];
    let worst = -Infinity;
    for (let i = 0; i < this.vectors.length; i++) {
      const id = this.ids[i]!;
      if (filter && !filter(id)) continue;
      const v = this.vectors[i]!;
      let s = 0;
      for (let j = 0; j < v.length; j++) s += v[j]! * query[j]!;
      if (heap.length < k) {
        heap.push({ id, score: s });
        if (heap.length === k) { heap.sort((a, b) => a.score - b.score); worst = heap[0]!.score; }
      } else if (s > worst) {
        heap[0] = { id, score: s };
        // Re-bubble the new entry into place — k is small so a full sort is fine.
        heap.sort((a, b) => a.score - b.score);
        worst = heap[0]!.score;
      }
    }
    return heap.sort((a, b) => b.score - a.score);
  }

  clear(): void { this.ids = []; this.vectors = []; this.byId.clear(); this.dimensions = 0; this.lastUpdated = null; }

  // ---- Persistence (JSON with base64-encoded Float32 payloads) ------------
  persist(path: string): void {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const out = {
      providerName: this.providerName,
      dimensions: this.dimensions,
      lastUpdated: this.lastUpdated ?? new Date().toISOString(),
      ids: this.ids,
      // Concatenate every vector into one buffer, base64-encode once.
      vectors: encodeVectors(this.vectors, this.dimensions),
    };
    writeFileSync(path, JSON.stringify(out));
    this.lastUpdated = out.lastUpdated;
  }

  load(path: string): boolean {
    if (!existsSync(path)) return false;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { providerName: string; dimensions: number; lastUpdated: string; ids: number[]; vectors: string };
      const vectors = decodeVectors(raw.vectors, raw.ids.length, raw.dimensions);
      this.clear();
      this.providerName = raw.providerName;
      this.dimensions = raw.dimensions;
      this.lastUpdated = raw.lastUpdated;
      for (let i = 0; i < raw.ids.length; i++) {
        this.byId.set(raw.ids[i]!, i);
        this.ids.push(raw.ids[i]!);
        this.vectors.push(vectors[i]!);
      }
      return true;
    } catch (e) {
      // Corrupted index — caller should rebuild.
      console.warn(`vector index load failed: ${(e as Error).message}`);
      return false;
    }
  }
}

function encodeVectors(vectors: Float32Array[], dim: number): string {
  const buf = Buffer.alloc(vectors.length * dim * 4);
  for (let i = 0; i < vectors.length; i++) {
    const src = Buffer.from(vectors[i]!.buffer, vectors[i]!.byteOffset, vectors[i]!.byteLength);
    src.copy(buf, i * dim * 4);
  }
  return buf.toString('base64');
}
function decodeVectors(b64: string, count: number, dim: number): Float32Array[] {
  const buf = Buffer.from(b64, 'base64');
  const out: Float32Array[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = new Float32Array(buf.buffer.slice(buf.byteOffset + i * dim * 4, buf.byteOffset + (i + 1) * dim * 4));
  }
  return out;
}
