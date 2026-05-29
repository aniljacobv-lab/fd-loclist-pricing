import type { FastifyInstance } from 'fastify';
import type { DataStore } from '../store/datastore.js';
import { config } from '../config.js';
import { askJson, anthropicConfigured } from '../ai/client.js';

// ----------------------------------------------------------------------------
// Penny markdown ($0.01) — the destruction signal.
//
// At Family Dollar (and most discount retailers), a penny markdown is the
// terminal step for dead inventory: items are repriced to $0.01 so the system
// flags them at the register, store associates pull them from the shelf, and
// they're destroyed (or returned to vendor where the contract allows). This
// route surfaces extreme slow movers — sell-through under 10% with more than
// a year of on-hand inventory — and lets the user generate the three things
// needed for a destruction batch in one click:
//   1. a SkuList of the items
//   2. a LocationList of stores actually carrying any of them
//   3. a SET_PRICE = $0.01 price change linking those two lists
//
// The price change enters the standard approval workflow and naturally lands
// in VP tier because every line is below the margin floor (cost > $0.01).
// ----------------------------------------------------------------------------

function hash01(a: number, b: number): number {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ (a & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ ((a >>> 16) & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ (b & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ ((b >>> 16) & 0xffff), 16777619) >>> 0;
  return (h >>> 0) / 4294967296;
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const baseUnitsPerStoreWeek = (sku: number) => 1.5 + hash01(sku, 21) * 18.5;
const baseInventoryPerStore = (sku: number) => Math.floor(hash01(sku, 41) * 200) + (isDeadInventory(sku) ? 400 : 0);  // dead items have extra stockpile
// Real catalogs have a small tail of effectively-dead SKUs — discontinued, failed test products, recall residue. Mark ~2% deterministically.
const isDeadInventory = (sku: number) => hash01(sku, 73) < 0.02;
const propensity = (sku: number) => isDeadInventory(sku) ? 0.02 + hash01(sku, 7) * 0.06 : 0.45 + hash01(sku, 7) * 0.45;
const priceFactor = (p: number) => clamp(1.15 - p * 0.05, 0.55, 1.15);
const steadyRate = (sku: number, price: number) => clamp(propensity(sku) * priceFactor(price), 0.05, 0.985);

function deterministicRationale(sku: number): string {
  const t = config.app.pennyMarkdown.rationaleTemplates;
  if (t.length === 0) return 'Extreme slow mover — recommend destruction';
  const idx = Math.floor(hash01(sku, 99) * t.length) % t.length;
  return t[idx] ?? t[0]!;
}

function storesCarryingSku(sku: number, allStoreIds: number[], coveragePct: number): number[] {
  const threshold = coveragePct / 100;
  return allStoreIds.filter((sid) => hash01(sku, sid) < threshold);
}

interface PennyCandidate {
  sku: number; description: string; deptName: string;
  currentRetail: number; cost: number | null;
  sellThroughPct: number; weeksOnHand: number; inventoryUnitsPerStore: number;
  rationale?: string; severity?: number; source?: 'AI' | 'HEURISTIC';
}

export async function pennyMarkdownRoutes(app: FastifyInstance, ds: DataStore) {
  // GET /penny-markdown/recommendations?kind=ALL|DEPT&deptId=&useAi=true&limit=50
  app.get('/penny-markdown/recommendations', async (req) => {
    const q = (req.query as any) ?? {};
    const kind = String(q.kind ?? 'ALL').toUpperCase();
    const deptId = q.deptId != null ? Number(q.deptId) : null;
    const useAi = String(q.useAi ?? 'true') !== 'false';
    const limit = Math.max(10, Math.min(200, Number(q.limit ?? 50)));
    const cfg = config.app.pennyMarkdown;

    const all = await ds.listItems();
    const scoped = all.filter((i) => {
      if (kind === 'DEPT' && deptId != null && i.deptId !== deptId) return false;
      return i.currentRetail != null && i.currentRetail > 0;
    });

    const candidates: PennyCandidate[] = [];
    for (const it of scoped) {
      const cur = it.currentRetail as number;
      const rate = steadyRate(it.sku, cur);
      const weekly = baseUnitsPerStoreWeek(it.sku);
      const inv = baseInventoryPerStore(it.sku);
      const woh = weekly > 0 ? inv / (weekly * rate) : 999;
      if (rate * 100 > cfg.extremeSellThroughPct) continue;
      if (woh < cfg.extremeWeeksOnHandMin) continue;
      candidates.push({
        sku: it.sku, description: it.description, deptName: it.deptName ?? '',
        currentRetail: cur, cost: it.cost ?? null,
        sellThroughPct: Math.round(rate * 1000) / 10,
        weeksOnHand: Math.round(woh * 10) / 10,
        inventoryUnitsPerStore: inv,
      });
    }
    candidates.sort((a, b) => b.weeksOnHand - a.weeksOnHand);

    let recommendations: PennyCandidate[] = candidates.slice(0, limit);
    let aiUsed = false;

    if (useAi && anthropicConfigured() && recommendations.length > 0) {
      const sample = recommendations.slice(0, cfg.aiSampleCap);
      const prompt = 'These items have failed to sell at any meaningful rate and have far more on-hand inventory than they will ever sell. For each, give a brief (≤12 words) rationale for destruction and a severity 1-5 (5 = certain destroy candidate).\n\n' +
        JSON.stringify(sample.map((c) => ({ sku: c.sku, description: c.description, deptName: c.deptName, currentRetail: c.currentRetail, sellThroughPct: c.sellThroughPct, weeksOnHand: c.weeksOnHand })));
      const aiResult = await askJson<{ items: { sku: number; rationale: string; severity: number }[] }>({
        system: 'You are a Family Dollar pricing/merchandising analyst reviewing items for PENNY MARKDOWN ($0.01) — destruction-bound dead inventory. Be terse, concrete, and realistic about discount-retail reasons (vendor discontinued, seasonal expired, test SKU failure, display/damaged unit, obsolete pack/variant, recall residual).',
        user: prompt,
        jsonShape: '{ "items": [{ "sku": number, "rationale": string, "severity": number }] }',
        maxTokens: 2048,
      });
      if (aiResult?.items?.length) {
        const byId = new Map(aiResult.items.map((x) => [x.sku, x]));
        recommendations = recommendations.map((r) => {
          const ai = byId.get(r.sku);
          if (ai) return { ...r, rationale: ai.rationale, severity: clamp(Math.round(ai.severity), 1, 5), source: 'AI' };
          return { ...r, rationale: deterministicRationale(r.sku), severity: 3, source: 'HEURISTIC' };
        });
        recommendations.sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
        aiUsed = true;
      }
    }
    if (!aiUsed) {
      recommendations = recommendations.map((r) => ({ ...r, rationale: deterministicRationale(r.sku), severity: 3, source: 'HEURISTIC' }));
    }

    return {
      simulated: true,
      note: 'SIMULATED weekly velocity + on-hand inventory (deterministic). ' + (aiUsed ? 'Rationale + severity ranked by Claude.' : 'Heuristic rationale — set ANTHROPIC_API_KEY for AI ranking.'),
      scope: { kind, deptId },
      thresholds: { extremeSellThroughPct: cfg.extremeSellThroughPct, extremeWeeksOnHandMin: cfg.extremeWeeksOnHandMin, pennyPrice: cfg.pennyPrice },
      totalCandidates: candidates.length,
      aiUsed,
      recommendations,
    };
  });

  // POST /penny-markdown/generate  { skus: number[], notes?: string, effectiveDate?: string }
  // Atomically creates SkuList -> LocationList (stores carrying ≥1 SKU) -> PC.
  app.post('/penny-markdown/generate', async (req, reply) => {
    const body = (req.body as any) ?? {};
    const skus: number[] = Array.isArray(body.skus) ? body.skus.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : [];
    if (skus.length === 0) return reply.code(400).send({ error: 'bad_request', message: 'skus is required (non-empty)' });
    const actor = (req.headers['x-user'] as string | undefined) ?? 'unknown';
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    const cfg = config.app.pennyMarkdown;
    const stamp = new Date().toISOString().slice(0, 10);
    const effectiveDate: string = typeof body.effectiveDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate) ? body.effectiveDate : stamp;

    // 1) SkuList
    const skuList = await ds.createSkuList({
      name: `PENNY MARKDOWN ${stamp}`,
      description: `Destruction-bound SKUs (${skus.length}). Items repriced to $${cfg.pennyPrice.toFixed(2)} for shelf pull + destroy per FD policy.${notes ? ' Notes: ' + notes : ''}`,
      skus, createdBy: actor,
    });

    // 2) LocationList = union of stores carrying any of these SKUs.
    const allStores = await ds.listStores();
    const allStoreIds = allStores.map((s) => s.storeId);
    const storeSet = new Set<number>();
    for (const sku of skus) for (const sid of storesCarryingSku(sku, allStoreIds, cfg.storeCoveragePct)) storeSet.add(sid);
    const storeIds = [...storeSet].sort((a, b) => a - b);
    const locList = await ds.createLocationList({
      name: `PENNY MARKDOWN ${stamp} — stores`,
      description: `Stores carrying any of the ${skus.length} destruction SKUs (simulated ${cfg.storeCoveragePct}% per-SKU coverage; covers ${storeIds.length} of ${allStoreIds.length} stores).`,
      storeIds, createdBy: actor,
    });

    // 3) Price change — SET_PRICE to penny.
    const pc = await ds.createPriceChange({
      pcName: `PENNY MARKDOWN ${stamp} — destruction batch (${skus.length} SKUs × ${storeIds.length} stores)`,
      itemSelector: { mode: 'SKU_LIST', skuListId: skuList.skuListId, exceptSkus: [] },
      locationSelector: { mode: 'LOCATION_LIST', locListId: locList.locListId, exceptStoreIds: [] },
      changeType: 'SET_PRICE', amount: cfg.pennyPrice,
      roundingRule: 'NONE', endsIn: null,
      multiUnits: null, multiRetail: null,
      fundedByVendor: false, dealId: null, fundingVendorId: null, fundingPct: null,
      sendDate: null, effectiveDate, reasonCode: 99,
      priceMap: null, rezone: null,
      createdBy: actor,
    });

    return reply.code(201).send({
      pennyPrice: cfg.pennyPrice,
      skuList, locList, priceChange: pc,
      warning: `This price change sets ${skus.length} SKUs to $${cfg.pennyPrice.toFixed(2)} across ${storeIds.length} stores. On promotion these items should be physically pulled and destroyed per FD policy. The approval engine will route this to VP-tier sign-off automatically (every line is below the margin floor).`,
    });
  });
}
