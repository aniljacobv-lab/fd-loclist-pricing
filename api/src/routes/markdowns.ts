import type { FastifyInstance } from 'fastify';
import type { DataStore } from '../store/datastore.js';
import { computeNewRetail } from '../store/datastore.js';
import { config } from '../config.js';
import type { PriceChange } from '../types.js';

// ----------------------------------------------------------------------------
// Markdown cadence — finds slow movers and proposes a stepped clearance
// schedule (25/50/75) over time. Generates a chain of linked price changes
// that enter the approval workflow.
//
// Slow-mover detection uses two simulated quantities (no POS feed in this POC):
//   - weekly unit velocity (deterministic per SKU)
//   - on-hand inventory  (deterministic per SKU)
// 'steady' sell-through (from the same family as My View) compares them. A SKU
// is a slow mover when both: (a) sell-through < slowSellThroughPct AND
// (b) weeks-on-hand > slowWeeksOnHandMin. Tunable in app.config.json.
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
// per-store weekly velocity — same shape as pricing.ts
const baseUnitsPerStoreWeek = (sku: number) => 1.5 + hash01(sku, 21) * 18.5;
// per-store on-hand inventory: 0..200 units, leaning heavy enough to surface real slow movers
const baseInventoryPerStore = (sku: number) => Math.floor(hash01(sku, 41) * 200);
// "steady" sell-through (week-agnostic propensity x price-elastic factor)
const propensity = (sku: number) => 0.45 + hash01(sku, 7) * 0.45;
const priceFactor = (p: number) => clamp(1.15 - p * 0.05, 0.55, 1.15);
const steadyRate = (sku: number, price: number) => clamp(propensity(sku) * priceFactor(price), 0.05, 0.985);

function isoPlusDays(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10);
}

export async function markdownRoutes(app: FastifyInstance, ds: DataStore) {
  // GET /markdown/recommendations?kind=ALL|DEPT|VENDOR&deptId=&vendorId=&limit=
  // Returns slow movers in scope, each with the recommended stepped schedule
  // applied to their current retail.
  app.get('/markdown/recommendations', async (req, reply) => {
    const q = req.query as any;
    const kind = String(q?.kind ?? 'ALL').toUpperCase();
    const deptId = q?.deptId != null ? Number(q.deptId) : null;
    const vendorId = q?.vendorId != null ? Number(q.vendorId) : null;
    const limit = Math.max(10, Math.min(500, Number(q?.limit ?? 100)));

    const all = await ds.listItems();
    const scoped = all.filter((i) => {
      if (kind === 'DEPT' && deptId != null && i.deptId !== deptId) return false;
      if (kind === 'VENDOR' && vendorId != null && i.vendorId !== vendorId) return false;
      return i.currentRetail != null && i.currentRetail > 0;
    });

    const cfg = config.app.markdowns;
    const schedule = cfg.schedule;
    const today = isoPlusDays(0);

    const recs = [] as any[];
    for (const it of scoped) {
      const cur = it.currentRetail as number;
      const rate = steadyRate(it.sku, cur);
      const weekly = baseUnitsPerStoreWeek(it.sku);
      const inv = baseInventoryPerStore(it.sku);
      const woh = weekly > 0 ? inv / (weekly * rate) : 999;   // weeks to sell through at current rate
      if (rate * 100 > cfg.slowSellThroughPct) continue;
      if (woh < cfg.slowWeeksOnHandMin) continue;
      const steps = schedule.map((s) => ({
        stepNo: s.stepNo, markdownPct: s.markdownPct, afterDays: s.afterDays,
        effectiveDate: isoPlusDays(s.afterDays),
        newRetail: computeNewRetail(cur, 'MARKDOWN_PCT', s.markdownPct, 0.99),
      }));
      recs.push({
        sku: it.sku, description: it.description, deptName: it.deptName ?? '',
        currentRetail: cur, cost: it.cost ?? null,
        sellThroughPct: Math.round(rate * 1000) / 10,
        weeksOnHand: Math.round(woh * 10) / 10,
        inventoryUnitsPerStore: inv,
        weeklyUnitsPerStore: Math.round(weekly * 10) / 10,
        steps,
      });
    }
    recs.sort((a, b) => b.weeksOnHand - a.weeksOnHand);
    return {
      simulated: true,
      note: 'Slow movers detected via SIMULATED velocity + on-hand inventory. Wire baseUnitsPerStoreWeek() and baseInventoryPerStore() to real POS + DC feeds in production.',
      scope: { kind, deptId, vendorId },
      thresholds: { slowSellThroughPct: cfg.slowSellThroughPct, slowWeeksOnHandMin: cfg.slowWeeksOnHandMin },
      schedule,
      totalSlowMovers: recs.length,
      generatedAt: today,
      recommendations: recs.slice(0, limit),
    };
  });

  // POST /markdown/generate
  // Body: { skus: number[], locationSelector, scheduleSteps?: MarkdownStep[], pcNameBase?: string }
  // Creates a SkuList from the SKUs, then a chain of MARKDOWN_PCT price changes
  // (one per step) referencing that list at progressive effective dates.
  app.post('/markdown/generate', async (req, reply) => {
    const body = (req.body as any) ?? {};
    const skus: number[] = Array.isArray(body.skus) ? body.skus.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : [];
    if (skus.length === 0) return reply.code(400).send({ error: 'bad_request', message: 'skus is required (non-empty)' });
    if (!body.locationSelector || typeof body.locationSelector !== 'object') {
      return reply.code(400).send({ error: 'bad_request', message: 'locationSelector is required' });
    }
    const steps = Array.isArray(body.scheduleSteps) && body.scheduleSteps.length > 0
      ? body.scheduleSteps : config.app.markdowns.schedule;
    const actor = (req.headers['x-user'] as string | undefined) ?? 'unknown';
    const base = (body.pcNameBase as string | undefined) ?? `Slow-mover markdown ${new Date().toISOString().slice(0, 10)}`;

    // 1) Stash the SKUs in a transient SkuList — keeps the audit trail tied to a list.
    const skuList = await ds.createSkuList({
      name: `${base} — SKUs`, description: `Auto-generated markdown chain (${skus.length} SKUs)`,
      skus, createdBy: actor,
    });

    // 2) Create one PC per step, all referencing that SkuList.
    const created: PriceChange[] = [];
    for (const s of steps) {
      const pc = await ds.createPriceChange({
        pcName: `${base} — step ${s.stepNo} (${s.markdownPct}% off)`,
        itemSelector: { mode: 'SKU_LIST', skuListId: skuList.skuListId, exceptSkus: [] },
        locationSelector: body.locationSelector,
        changeType: 'MARKDOWN_PCT', amount: s.markdownPct,
        roundingRule: 'ENDS_IN', endsIn: 0.99,
        multiUnits: null, multiRetail: null,
        fundedByVendor: false, dealId: null, fundingVendorId: null, fundingPct: null,
        sendDate: null, effectiveDate: isoPlusDays(s.afterDays), reasonCode: null,
        priceMap: null, rezone: null,
        createdBy: actor,
      });
      created.push(pc);
    }
    return reply.code(201).send({ skuList, priceChanges: created });
  });
}
