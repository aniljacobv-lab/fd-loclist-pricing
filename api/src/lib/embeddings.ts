import { LRU } from './lru.js';

// ----------------------------------------------------------------------------
// Embedding providers. The vector store doesn't care which one is active —
// it just receives Float32Arrays of a consistent dimension. The active
// provider is chosen at runtime based on which env keys are set:
//
//   VOYAGE_API_KEY  → VoyageEmbedder    (Anthropic-recommended)
//   OPENAI_API_KEY  → OpenAIEmbedder
//   neither         → LocalHashEmbedder (deterministic, no network, demo-grade)
//
// LRU-caches per-text so repeated indexing doesn't re-hit the network.
// ----------------------------------------------------------------------------

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

const EMB_CACHE = new LRU<string, Float32Array>(20_000);
const cacheKey = (name: string, dim: number, text: string) => `${name}|${dim}|${text}`;

// ─── Local hash embedder ────────────────────────────────────────────────────
// Bag-of-character-trigrams hashed into a fixed-dimension float vector. Not
// semantic, but groups items with shared substrings (brand names, pack sizes,
// flavors) — enough to make "find similar SKUs" non-trivial without an API key.
// Deterministic so vector indexing is reproducible across restarts.
export class LocalHashEmbedder implements EmbeddingProvider {
  readonly name = 'local-hash';
  constructor(public readonly dimensions = 256) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): Float32Array {
    const cached = EMB_CACHE.get(cacheKey(this.name, this.dimensions, text));
    if (cached) return cached;
    const v = new Float32Array(this.dimensions);
    const s = ' ' + text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ') + ' ';
    // Character trigrams — capture brand/flavor/size cues.
    for (let i = 0; i + 3 <= s.length; i++) {
      const gram = s.slice(i, i + 3);
      const h = fnv1a(gram) % this.dimensions;
      v[h]! += 1;
    }
    // Whole-word hashes — boost brand-token matches.
    for (const w of s.trim().split(' ')) {
      if (w.length < 2) continue;
      const h = fnv1a('w:' + w) % this.dimensions;
      v[h]! += 2;
    }
    l2Normalize(v);
    EMB_CACHE.set(cacheKey(this.name, this.dimensions, text), v);
    return v;
  }
}

// ─── Voyage AI embedder ────────────────────────────────────────────────────
// Anthropic recommends Voyage for embeddings. Uses voyage-3-lite by default
// (cheap, 512d). https://docs.voyageai.com/reference/embeddings-api
export class VoyageEmbedder implements EmbeddingProvider {
  readonly name = 'voyage';
  constructor(
    private readonly apiKey: string,
    public readonly model: string = 'voyage-3-lite',
    public readonly dimensions: number = 512,
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = new Array(texts.length);
    // Reuse cached vectors; only send misses.
    const misses: number[] = [];
    const missTexts: string[] = [];
    texts.forEach((t, i) => {
      const c = EMB_CACHE.get(cacheKey(this.name, this.dimensions, t));
      if (c) out[i] = c;
      else { misses.push(i); missTexts.push(t); }
    });
    if (missTexts.length === 0) return out;

    // Voyage caps input batch at 128 texts.
    for (let start = 0; start < missTexts.length; start += 128) {
      const batch = missTexts.slice(start, start + 128);
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: batch, model: this.model, input_type: 'document' }),
      });
      if (!res.ok) throw new Error(`voyage embed ${res.status} ${await res.text().catch(() => '')}`);
      const json = await res.json() as { data: { embedding: number[]; index: number }[] };
      for (const row of json.data) {
        const v = new Float32Array(row.embedding);
        l2Normalize(v);
        const globalIdx = misses[start + row.index]!;
        out[globalIdx] = v;
        EMB_CACHE.set(cacheKey(this.name, this.dimensions, texts[globalIdx]!), v);
      }
    }
    return out;
  }
}

// ─── OpenAI embedder (fallback / alternative) ──────────────────────────────
// text-embedding-3-small returns 1536-d but supports the `dimensions` param
// to downsize. We use 512 to match Voyage so the vector store dims line up.
export class OpenAIEmbedder implements EmbeddingProvider {
  readonly name = 'openai';
  constructor(
    private readonly apiKey: string,
    public readonly model: string = 'text-embedding-3-small',
    public readonly dimensions: number = 512,
  ) {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = new Array(texts.length);
    const misses: number[] = [];
    const missTexts: string[] = [];
    texts.forEach((t, i) => {
      const c = EMB_CACHE.get(cacheKey(this.name, this.dimensions, t));
      if (c) out[i] = c;
      else { misses.push(i); missTexts.push(t); }
    });
    if (missTexts.length === 0) return out;

    for (let start = 0; start < missTexts.length; start += 256) {
      const batch = missTexts.slice(start, start + 256);
      const res = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: batch, model: this.model, dimensions: this.dimensions }),
      });
      if (!res.ok) throw new Error(`openai embed ${res.status} ${await res.text().catch(() => '')}`);
      const json = await res.json() as { data: { embedding: number[]; index: number }[] };
      for (const row of json.data) {
        const v = new Float32Array(row.embedding);
        l2Normalize(v);
        const globalIdx = misses[start + row.index]!;
        out[globalIdx] = v;
        EMB_CACHE.set(cacheKey(this.name, this.dimensions, texts[globalIdx]!), v);
      }
    }
    return out;
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────
// Selects the best provider available. Reads env each time so a hot .env
// reload (server.ts watches for it) can flip the active embedder.
export function pickEmbedder(): EmbeddingProvider {
  const v = process.env.VOYAGE_API_KEY;
  if (v) return new VoyageEmbedder(v);
  const o = process.env.OPENAI_API_KEY;
  if (o) return new OpenAIEmbedder(o);
  return new LocalHashEmbedder();
}

// ─── Math helpers ──────────────────────────────────────────────────────────
function fnv1a(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function l2Normalize(v: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i]! * v[i]!;
  const n = Math.sqrt(sum);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] = v[i]! / n;
}
