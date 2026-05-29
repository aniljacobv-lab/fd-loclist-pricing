import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { DataStore } from '../store/datastore.js';
import { VectorStore } from '../lib/vectorStore.js';
import { pickEmbedder, type EmbeddingProvider } from '../lib/embeddings.js';
import { config } from '../config.js';

// ----------------------------------------------------------------------------
// Vector DB routes. One in-process index for items, one for past price
// changes. Vectors persist to api/data/vectors-*.json so a redeploy doesn't
// force a re-embed (a real concern if the embedder is Voyage/OpenAI — each
// rebuild costs $$). The index is also lazy: hitting /vector/items/similar
// without a prior /vector/items/index call will trigger an index build.
// ----------------------------------------------------------------------------

const itemIndex = new VectorStore();
const pcIndex = new VectorStore();
let embedder: EmbeddingProvider = pickEmbedder();

const ITEM_PATH = () => resolve(process.cwd(), config.dataDir, 'vectors-items.json');
const PC_PATH = () => resolve(process.cwd(), config.dataDir, 'vectors-pcs.json');

function itemText(it: { sku: number; description: string; deptName?: string | null; vendorName?: string | null; currentRetail?: number | null }): string {
  // Compact "embedding-friendly" text — brand + category + price all matter.
  return [it.description, it.deptName ?? '', it.vendorName ?? '', it.currentRetail != null ? `$${it.currentRetail.toFixed(2)}` : ''].filter(Boolean).join(' · ');
}
function pcText(pc: { pcName: string; changeType: string; amount: number; effectiveDate: string }): string {
  return `${pc.pcName} | ${pc.changeType} ${pc.amount} | ${pc.effectiveDate}`;
}

async function ensureItemIndex(ds: DataStore, log: (m: string) => void): Promise<void> {
  if (itemIndex.size() > 0) return;
  if (itemIndex.load(ITEM_PATH())) { log(`loaded item vectors from disk (${itemIndex.size()} rows)`); return; }
  await rebuildItemIndex(ds, log);
}
async function rebuildItemIndex(ds: DataStore, log: (m: string) => void): Promise<{ rows: number; provider: string; dim: number }> {
  embedder = pickEmbedder();
  itemIndex.clear();
  const items = await ds.listItems();
  log(`embedding ${items.length} items with ${embedder.name}…`);
  // Batch through the embedder — providers cap input size, we keep batches
  // moderate so we don't keep huge arrays alive at once.
  const BATCH = 256;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const texts = slice.map(itemText);
    const vecs = await embedder.embed(texts);
    for (let j = 0; j < slice.length; j++) itemIndex.add(slice[j]!.sku, vecs[j]!);
  }
  itemIndex.providerName = embedder.name;
  itemIndex.persist(ITEM_PATH());
  log(`item index built: ${itemIndex.size()} rows, dim ${itemIndex.dimensions}`);
  return { rows: itemIndex.size(), provider: embedder.name, dim: itemIndex.dimensions };
}

async function ensurePcIndex(ds: DataStore, log: (m: string) => void): Promise<void> {
  if (pcIndex.size() > 0) return;
  if (pcIndex.load(PC_PATH())) { log(`loaded PC vectors from disk (${pcIndex.size()} rows)`); return; }
  await rebuildPcIndex(ds, log);
}
async function rebuildPcIndex(ds: DataStore, log: (m: string) => void): Promise<{ rows: number; provider: string; dim: number }> {
  embedder = pickEmbedder();
  pcIndex.clear();
  const pcs = await ds.listPriceChanges();
  if (pcs.length === 0) { pcIndex.providerName = embedder.name; return { rows: 0, provider: embedder.name, dim: 0 }; }
  log(`embedding ${pcs.length} price changes with ${embedder.name}…`);
  const texts = pcs.map(pcText);
  const vecs = await embedder.embed(texts);
  for (let i = 0; i < pcs.length; i++) pcIndex.add(pcs[i]!.pcId, vecs[i]!);
  pcIndex.providerName = embedder.name;
  pcIndex.persist(PC_PATH());
  log(`pc index built: ${pcIndex.size()} rows, dim ${pcIndex.dimensions}`);
  return { rows: pcIndex.size(), provider: embedder.name, dim: pcIndex.dimensions };
}

export async function vectorRoutes(app: FastifyInstance, ds: DataStore) {
  // Try to load existing indices on startup (non-blocking; non-fatal).
  itemIndex.load(ITEM_PATH());
  pcIndex.load(PC_PATH());

  // GET /vector/status — what's loaded, dim, provider, last-built timestamp.
  app.get('/vector/status', async () => {
    embedder = pickEmbedder();
    return {
      activeProvider: embedder.name,
      providerDimensions: embedder.dimensions,
      items: { rows: itemIndex.size(), dim: itemIndex.dimensions, provider: itemIndex.providerName, lastUpdated: itemIndex.lastUpdated },
      priceChanges: { rows: pcIndex.size(), dim: pcIndex.dimensions, provider: pcIndex.providerName, lastUpdated: pcIndex.lastUpdated },
    };
  });

  // POST /vector/items/index — (re)build the item vector index now.
  app.post('/vector/items/index', async () => rebuildItemIndex(ds, (m) => app.log.info(m)));
  app.post('/vector/price-changes/index', async () => rebuildPcIndex(ds, (m) => app.log.info(m)));

  // GET /vector/items/similar?sku=&k=&excludeSelf=true&deptId=
  app.get('/vector/items/similar', async (req, reply) => {
    await ensureItemIndex(ds, (m) => app.log.info(m));
    const q = req.query as any;
    const sku = Number(q.sku);
    const k = Math.max(1, Math.min(50, Number(q.k ?? 10)));
    const deptId = q.deptId != null ? Number(q.deptId) : null;
    const excludeSelf = String(q.excludeSelf ?? 'true') !== 'false';

    const seed = itemIndex.get(sku);
    if (!seed) return reply.code(404).send({ error: 'not_indexed', message: `no vector for sku ${sku}; call POST /vector/items/index first` });

    const allItems = await ds.listItems();
    const byId = new Map(allItems.map((i) => [i.sku, i]));
    const hits = itemIndex.search(seed, k + (excludeSelf ? 1 : 0), (id) => {
      if (excludeSelf && id === sku) return false;
      if (deptId != null) { const it = byId.get(id); if (!it || it.deptId !== deptId) return false; }
      return true;
    }).slice(0, k);

    return {
      provider: itemIndex.providerName,
      seed: { sku, item: byId.get(sku) ?? null },
      hits: hits.map((h) => {
        const it = byId.get(h.id);
        return {
          sku: h.id, similarity: Math.round(h.score * 1000) / 1000,
          description: it?.description ?? null, deptName: it?.deptName ?? null,
          vendorName: it?.vendorName ?? null, currentRetail: it?.currentRetail ?? null,
        };
      }),
    };
  });

  // GET /vector/items/search?q=&k=&deptId=
  app.get('/vector/items/search', async (req, reply) => {
    await ensureItemIndex(ds, (m) => app.log.info(m));
    const q = req.query as any;
    const queryText = String(q.q ?? '').trim();
    if (!queryText) return reply.code(400).send({ error: 'bad_request', message: 'q is required' });
    const k = Math.max(1, Math.min(50, Number(q.k ?? 10)));
    const deptId = q.deptId != null ? Number(q.deptId) : null;

    const [qv] = await embedder.embed([queryText]);
    if (!qv) return reply.code(500).send({ error: 'embed_failed' });
    const allItems = await ds.listItems();
    const byId = new Map(allItems.map((i) => [i.sku, i]));
    const hits = itemIndex.search(qv, k, (id) => {
      if (deptId != null) { const it = byId.get(id); if (!it || it.deptId !== deptId) return false; }
      return true;
    });
    return {
      provider: itemIndex.providerName, query: queryText,
      hits: hits.map((h) => {
        const it = byId.get(h.id);
        return {
          sku: h.id, similarity: Math.round(h.score * 1000) / 1000,
          description: it?.description ?? null, deptName: it?.deptName ?? null,
          vendorName: it?.vendorName ?? null, currentRetail: it?.currentRetail ?? null,
        };
      }),
    };
  });

  // GET /vector/price-changes/similar?pcId=&k=&excludeSelf=true
  app.get('/vector/price-changes/similar', async (req, reply) => {
    await ensurePcIndex(ds, (m) => app.log.info(m));
    const q = req.query as any;
    const pcId = Number(q.pcId);
    const k = Math.max(1, Math.min(20, Number(q.k ?? 6)));
    const excludeSelf = String(q.excludeSelf ?? 'true') !== 'false';

    let seed = pcIndex.get(pcId);
    if (!seed) {
      // PC was created after last index build — embed it on the fly so the
      // user gets results without waiting for a full rebuild.
      const pc = await ds.getPriceChange(pcId);
      if (!pc) return reply.code(404).send({ error: 'not_found' });
      const [v] = await embedder.embed([pcText(pc)]);
      if (v) { pcIndex.add(pc.pcId, v); seed = v; }
      else return reply.code(500).send({ error: 'embed_failed' });
    }
    const all = await ds.listPriceChanges();
    const byId = new Map(all.map((p) => [p.pcId, p]));
    const hits = pcIndex.search(seed, k + (excludeSelf ? 1 : 0), (id) => !(excludeSelf && id === pcId)).slice(0, k);
    return {
      provider: pcIndex.providerName, seed: { pcId, pcName: byId.get(pcId)?.pcName ?? null },
      hits: hits.map((h) => {
        const p = byId.get(h.id);
        return {
          pcId: h.id, similarity: Math.round(h.score * 1000) / 1000,
          pcName: p?.pcName ?? null, status: p?.status ?? null, changeType: p?.changeType ?? null,
          amount: p?.amount ?? null, effectiveDate: p?.effectiveDate ?? null,
          skuCount: p?.resolvedSkus.length ?? 0, storeCount: p?.resolvedStoreIds.length ?? 0,
        };
      }),
    };
  });
}
