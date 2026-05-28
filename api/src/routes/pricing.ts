import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../store/datastore.js';
import { computeNewRetail, marginPct } from '../store/datastore.js';
import type { PricePreview, PricePreviewRow } from '../types.js';
import { config } from '../config.js';

const Body = z.object({
  itemSelector: z.any(),
  changeType: z.enum(['SET_PRICE', 'MARKDOWN_PCT', 'MARKDOWN_AMT']),
  amount: z.number(),
  endsIn: z.number().nullable().optional(),
});

const ImpactBody = z.object({
  itemSelector: z.any(),
  locationSelector: z.any(),
  changeType: z.enum(['SET_PRICE', 'MARKDOWN_PCT', 'MARKDOWN_AMT']),
  amount: z.number(),
  endsIn: z.number().nullable().optional(),
});

// --- deterministic weekly velocity (SIMULATED) ---------------------------
// Same idea as the My View sell-through model: there is no POS feed in the
// POC, so we synthesize a stable per-SKU weekly unit velocity (per store)
// seeded from the SKU. Swap baseUnitsPerStoreWeek() for the real demand feed
// in production; the elasticity projection around it stays unchanged.
function hash01(a: number, b: number): number {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ (a & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ ((a >>> 16) & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ (b & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ ((b >>> 16) & 0xffff), 16777619) >>> 0;
  return (h >>> 0) / 4294967296;
}
const baseUnitsPerStoreWeek = (sku: number) => 1.5 + hash01(sku, 21) * 18.5; // ~1.5–20 units/store/week
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function pricingRoutes(app: FastifyInstance, ds: DataStore) {
  // Per-item new retail + margin, with a margin-floor guardrail summary.
  app.post('/pricing/preview', async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });

    const skus = await ds.resolveItems(parsed.data.itemSelector);
    const rows: PricePreviewRow[] = [];
    const floor = config.app.pricing.marginFloorPct;
    for (const sku of skus.slice(0, config.app.ai.pricePreviewMaxRows)) {
      const item = await ds.getItem(sku);
      if (!item) continue;
      const newRetail = computeNewRetail(item.currentRetail, parsed.data.changeType, parsed.data.amount, parsed.data.endsIn ?? null);
      const m = marginPct(newRetail, item.cost);
      rows.push({
        sku, description: item.description, cost: item.cost ?? null, currentRetail: item.currentRetail ?? null,
        newRetail, marginPct: m, belowFloor: m != null && m < floor,
      });
    }
    const margins = rows.map((r) => r.marginPct).filter((x): x is number => x != null);
    const out: PricePreview = {
      rows: rows.sort((a, b) => (a.marginPct ?? 999) - (b.marginPct ?? 999)),
      count: skus.length,
      minMarginPct: margins.length ? Math.min(...margins) : null,
      belowFloorCount: rows.filter((r) => r.belowFloor).length,
      marginFloorPct: floor,
    };
    return out;
  });

  // Projected financial impact of a price change across the resolved scope.
  // Combines real cost/retail with a SIMULATED weekly velocity and a
  // configurable price elasticity so the user sees the revenue/margin trade-off
  // (a markdown lifts units but cuts unit margin) before submitting.
  app.post('/pricing/impact', async (req, reply) => {
    const parsed = ImpactBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const { itemSelector, locationSelector, changeType, amount, endsIn } = parsed.data;

    const [allSkus, storeIds] = await Promise.all([
      ds.resolveItems(itemSelector),
      ds.resolveStores(locationSelector).catch(() => [] as number[]),
    ]);
    const storeCount = storeIds.length;
    const elasticity = config.app.pricing.assumedElasticity;
    const weeks = config.app.pricing.projectionWeeks;
    const floor = config.app.pricing.marginFloorPct;

    // Compute economics on a capped sample, then scale to the full SKU count.
    const cap = config.app.ai.pricePreviewMaxRows;
    const sample = allSkus.slice(0, cap);
    let unitsBefore = 0, unitsAfter = 0, revBefore = 0, revAfter = 0, gmBefore = 0, gmAfter = 0;
    let priced = 0, belowFloor = 0, sumPriceChangePct = 0;
    const lines: { sku: number; description: string; currentRetail: number | null; newRetail: number | null; weeklyMarginDelta: number }[] = [];

    for (const sku of sample) {
      const item = await ds.getItem(sku);
      if (!item) continue;
      const cur = item.currentRetail ?? null;
      const next = computeNewRetail(cur, changeType, amount, endsIn ?? null);
      if (cur == null || next == null || cur <= 0) continue;
      priced++;
      const cost = item.cost ?? null;
      const base = baseUnitsPerStoreWeek(sku);
      // elasticity: units move as (newPrice/oldPrice)^elasticity, dampened to a sane band
      const ratio = clamp(Math.pow(next / cur, elasticity), 0.2, 5);
      const uB = base, uA = base * ratio;
      const rB = cur * uB, rA = next * uA;
      const mB = cost != null ? (cur - cost) * uB : 0;
      const mA = cost != null ? (next - cost) * uA : 0;
      unitsBefore += uB; unitsAfter += uA; revBefore += rB; revAfter += rA; gmBefore += mB; gmAfter += mA;
      sumPriceChangePct += (next - cur) / cur;
      if (cost != null && next > 0 && ((next - cost) / next) * 100 < floor) belowFloor++;
      const weeklyMarginDelta = (mA - mB) * storeCount;
      lines.push({ sku, description: item.description, currentRetail: cur, newRetail: next, weeklyMarginDelta });
    }

    // scale sample -> full population, then per-store -> all stores
    const scale = (priced > 0 ? allSkus.length / priced : 0) * storeCount;
    const wRevBefore = revBefore * scale, wRevAfter = revAfter * scale;
    const wGmBefore = gmBefore * scale, wGmAfter = gmAfter * scale;
    const wUnitsBefore = unitsBefore * scale, wUnitsAfter = unitsAfter * scale;
    const revDelta = wRevAfter - wRevBefore, gmDelta = wGmAfter - wGmBefore;
    const pctOf = (delta: number, base: number) => (base > 0 ? round2((delta / base) * 100) : null);

    return {
      simulated: true,
      note: 'Projected with real cost/retail but SIMULATED weekly unit velocity and an assumed price elasticity. Replace the velocity seed with the POS demand feed in production.',
      scope: { skuCount: allSkus.length, storeCount, itemLocations: allSkus.length * storeCount, sampledSkus: sample.length, pricedInSample: priced },
      assumedElasticity: elasticity,
      avgPriceChangePct: priced > 0 ? round2((sumPriceChangePct / priced) * 100) : null,
      marginFloorPct: floor,
      belowFloorInSample: belowFloor,
      weekly: {
        revenueBefore: round2(wRevBefore), revenueAfter: round2(wRevAfter), revenueDelta: round2(revDelta), revenueDeltaPct: pctOf(revDelta, wRevBefore),
        marginBefore: round2(wGmBefore), marginAfter: round2(wGmAfter), marginDelta: round2(gmDelta), marginDeltaPct: pctOf(gmDelta, wGmBefore),
        unitsBefore: Math.round(wUnitsBefore), unitsAfter: Math.round(wUnitsAfter),
      },
      annual: { weeks, revenueDelta: round2(revDelta * weeks), marginDelta: round2(gmDelta * weeks) },
      topImpact: lines.sort((a, b) => Math.abs(b.weeklyMarginDelta) - Math.abs(a.weeklyMarginDelta)).slice(0, 6).map((l) => ({ ...l, weeklyMarginDelta: round2(l.weeklyMarginDelta) })),
    };
  });
}
