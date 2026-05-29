import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../store/datastore.js';
import { askJson, getAnthropic, anthropicConfigured } from '../ai/client.js';
import { config } from '../config.js';
import { buildSeasonalContext, renderContextForPrompt, type RegionShare } from '../lib/seasonal.js';

// ---------------------------------------------------------------------------
// /ai/group-stores
//   Given a desired number of clusters, ask the model to group the catalogue
//   of stores by region/format/velocity. Returns N proposed location lists.
// ---------------------------------------------------------------------------
const GroupBody = z.object({
  numClusters: z.number().int().min(2).max(12).default(4),
  storeIds: z.array(z.number().int()).optional(),
  hint: z.string().max(500).optional(),
});

interface GroupResult {
  clusters: Array<{ name: string; rationale: string; storeIds: number[] }>;
}

// ---------------------------------------------------------------------------
// /ai/suggest-price
//   Given an item and (optional) sell-through context, propose a markdown.
// ---------------------------------------------------------------------------
const SuggestBody = z.object({
  sku: z.number().int(),
  reasonCode: z.number().int().nullable().optional(),
  sellThrough: z.number().min(0).max(1).nullable().optional(),
  weeksOnHand: z.number().min(0).nullable().optional(),
});

interface SuggestResult {
  changeType: 'SET_PRICE' | 'MARKDOWN_PCT' | 'MARKDOWN_AMT';
  amount: number;
  rationale: string;
}

// ---------------------------------------------------------------------------
// /ai/parse-intent
//   Natural-language → structured price-change draft.
// ---------------------------------------------------------------------------
const ParseBody = z.object({
  text: z.string().min(1).max(2000),
});

interface ParseResult {
  pcName: string;
  sku: number | null;
  skuQuery: string | null;
  storeQuery: string | null;
  changeType: 'SET_PRICE' | 'MARKDOWN_PCT' | 'MARKDOWN_AMT';
  amount: number;
  effectiveDate: string | null;
  rationale: string;
}

export async function aiRoutes(app: FastifyInstance, ds: DataStore) {
  app.get('/ai/status', async () => ({
    configured: Boolean(getAnthropic()),
  }));

  // ---------------------- group-stores -------------------------------------
  app.post('/ai/group-stores', async (req, reply) => {
    const parsed = GroupBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const allStores = await ds.listStores();
    const set = parsed.data.storeIds
      ? allStores.filter((s) => parsed.data.storeIds!.includes(s.storeId))
      : allStores;

    if (!getAnthropic()) {
      // Deterministic stub: bucket by region.
      const byRegion = new Map<string, number[]>();
      for (const s of set) {
        const key = s.regionName ?? 'Unknown';
        if (!byRegion.has(key)) byRegion.set(key, []);
        byRegion.get(key)!.push(s.storeId);
      }
      const clusters = [...byRegion.entries()]
        .slice(0, parsed.data.numClusters)
        .map(([name, ids]) => ({
          name: `${name} (stub)`,
          rationale: `Grouped by region. AI key not configured.`,
          storeIds: ids,
        }));
      return { clusters, stub: true } satisfies GroupResult & { stub: boolean };
    }

    const sample = set.slice(0, config.app.ai.groupSampleCap);
    const compact = sample.map((s) => ({
      id: s.storeId,
      region: s.regionName,
      state: s.state,
      format: s.formatName,
      velocity: s.velocity,
    }));

    const out = await askJson<GroupResult>({
      system:
        'You are a retail pricing analyst at Family Dollar. ' +
        'Group the given stores into coherent clusters suitable for a single ' +
        'price-change action (e.g. similar demand, region, format, velocity). ' +
        'Every storeId must appear in exactly ONE cluster. Cluster names should ' +
        'be short and human-readable (e.g. "Florida Coastal — Urban", "Midwest Rural Low-Velocity").',
      user:
        `Number of clusters: ${parsed.data.numClusters}\n` +
        (parsed.data.hint ? `User hint: ${parsed.data.hint}\n` : '') +
        `Stores: ${JSON.stringify(compact)}`,
      jsonShape:
        '{"clusters":[{"name":"string","rationale":"string","storeIds":[number,...]}]}',
      maxTokens: 2048,
    });

    if (!out) return reply.code(502).send({ error: 'ai_parse_failed' });
    return out;
  });

  // ---------------------- suggest-price ------------------------------------
  app.post('/ai/suggest-price', async (req, reply) => {
    const parsed = SuggestBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const item = await ds.getItem(parsed.data.sku);
    if (!item) return reply.code(404).send({ error: 'item_not_found' });

    if (!getAnthropic()) {
      // Heuristic fallback: slow seller -> 20% off, else 10% off.
      const pct = parsed.data.reasonCode === 9 ? 20 : 10;
      return {
        changeType: 'MARKDOWN_PCT',
        amount: pct,
        rationale: `Heuristic stub (no AI key). Reason ${parsed.data.reasonCode ?? 'n/a'} → ${pct}% off.`,
      } satisfies SuggestResult;
    }

    const out = await askJson<SuggestResult>({
      system:
        'You are a retail markdown analyst. Recommend ONE price change ' +
        'action for the given item context. Prefer MARKDOWN_PCT in 5% steps ' +
        'between 5% and 40%. Be conservative when sell-through is high.',
      user:
        `Item: ${JSON.stringify(item)}\n` +
        `Reason code: ${parsed.data.reasonCode ?? 'n/a'}\n` +
        `Sell-through (0..1): ${parsed.data.sellThrough ?? 'n/a'}\n` +
        `Weeks on hand: ${parsed.data.weeksOnHand ?? 'n/a'}`,
      jsonShape:
        '{"changeType":"MARKDOWN_PCT|MARKDOWN_AMT|SET_PRICE","amount":number,"rationale":"string"}',
      maxTokens: 400,
    });

    if (!out) return reply.code(502).send({ error: 'ai_parse_failed' });
    return out;
  });

  // ---------------------- parse-intent -------------------------------------
  app.post('/ai/parse-intent', async (req, reply) => {
    const parsed = ParseBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }

    if (!getAnthropic()) {
      // Stub: pull the first number as a markdown %, drop the rest as queries.
      const pctMatch = parsed.data.text.match(/(\d+)\s*%/);
      return {
        pcName: parsed.data.text.slice(0, 60),
        sku: null,
        skuQuery: null,
        storeQuery: parsed.data.text,
        changeType: 'MARKDOWN_PCT',
        amount: pctMatch ? Number(pctMatch[1]) : 10,
        effectiveDate: null,
        rationale: 'Heuristic stub (no AI key).',
      } satisfies ParseResult;
    }

    const out = await askJson<ParseResult>({
      system:
        'You parse a pricing analyst\'s plain-language request into a ' +
        'structured price-change draft. Be precise. If a SKU number appears, ' +
        'set sku; otherwise set skuQuery to the item description to search. ' +
        'If stores are named by region/state/format, set storeQuery to a short ' +
        'phrase the app can search by. Dates ISO YYYY-MM-DD or null.',
      user: parsed.data.text,
      jsonShape:
        '{"pcName":"string","sku":number|null,"skuQuery":"string|null",' +
        '"storeQuery":"string|null","changeType":"MARKDOWN_PCT|MARKDOWN_AMT|SET_PRICE",' +
        '"amount":number,"effectiveDate":"YYYY-MM-DD|null","rationale":"string"}',
      maxTokens: 500,
    });

    if (!out) return reply.code(502).send({ error: 'ai_parse_failed' });
    return out;
  });

  // ---------------------- suggest-strategy ---------------------------------
  // Higher-level strategy: takes an item selector (single SKU, SKU list,
  // hierarchy, vendor, or ALL) + optional location selector, factors in
  // season / weather / holiday context + regional store mix, and proposes
  // up to a few pricing moves — EDLP set-prices, markdowns, or both. AI
  // call when ANTHROPIC_API_KEY is live; a season-aware heuristic otherwise.
  app.post('/ai/suggest-strategy', async (req, reply) => {
    const body = (req.body as any) ?? {};
    const itemSel = body.itemSelector;
    const locSel = body.locationSelector ?? null;
    const strategy = (typeof body.strategy === 'string' ? body.strategy.toUpperCase() : 'AUTO') as 'AUTO' | 'EDLP' | 'MARKDOWN';
    if (!itemSel || typeof itemSel !== 'object') return reply.code(400).send({ error: 'bad_request', message: 'itemSelector is required' });

    // ---- 1) Resolve scope and build a compact summary -----------------
    let skus: number[] = [];
    try { skus = await ds.resolveItems(itemSel); } catch (e: any) { return reply.code(400).send({ error: 'resolve_failed', message: e?.message ?? String(e) }); }
    if (skus.length === 0) return reply.code(400).send({ error: 'empty_scope', message: 'Item selector resolved to 0 SKUs' });

    let storeIds: number[] = [];
    if (locSel) { try { storeIds = await ds.resolveStores(locSel); } catch { storeIds = []; } }
    if (storeIds.length === 0) { try { storeIds = (await ds.listStores()).map((s) => s.storeId); } catch { /* ignore */ } }

    // Sample for compactness — Claude doesn't need the whole catalog, just a feel.
    const SAMPLE_CAP = 60;
    const sample = skus.slice(0, SAMPLE_CAP);
    const sampleItems = await Promise.all(sample.map((sk) => ds.getItem(sk)));
    const priced = sampleItems.filter((i): i is NonNullable<typeof i> => !!i && i.currentRetail != null && i.currentRetail > 0);

    // Category mix
    const deptCount = new Map<string, { count: number; deptId: number | null }>();
    for (const it of sampleItems) {
      if (!it) continue; const k = it.deptName ?? '—';
      const cur = deptCount.get(k) ?? { count: 0, deptId: it.deptId ?? null };
      cur.count++; deptCount.set(k, cur);
    }
    const topDepts = [...deptCount.entries()].map(([name, v]) => ({ name, deptId: v.deptId, share: Math.round((v.count / sample.length) * 100), count: v.count })).sort((a, b) => b.count - a.count).slice(0, 5);

    // Price stats
    const prices = priced.map((i) => i.currentRetail as number);
    const avgPrice = prices.length ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) / 100 : null;
    const minPrice = prices.length ? Math.min(...prices) : null;
    const maxPrice = prices.length ? Math.max(...prices) : null;
    const avgCost = priced.length ? Math.round((priced.reduce((a, b) => a + (b.cost ?? 0), 0) / priced.length) * 100) / 100 : null;

    // Region mix
    const allStores = await ds.listStores();
    const inScope = new Set(storeIds);
    const regionMap = new Map<string, number>();
    for (const st of allStores) if (inScope.has(st.storeId)) {
      const r = st.regionName ?? 'Other';
      regionMap.set(r, (regionMap.get(r) ?? 0) + 1);
    }
    const totalStores = [...regionMap.values()].reduce((a, b) => a + b, 0);
    const topRegions: RegionShare[] = [...regionMap.entries()]
      .map(([region, storeCount]) => ({ region, storeCount, pct: totalStores ? (storeCount / totalStores) * 100 : 0 }))
      .sort((a, b) => b.storeCount - a.storeCount).slice(0, 5);

    const scope = {
      skuCount: skus.length, storeCount: storeIds.length, itemLocations: skus.length * storeIds.length,
      sampledItems: sample.length, topDepts, topRegions,
      avgPrice, minPrice, maxPrice, avgCost,
    };

    const ctx = buildSeasonalContext({ regions: topRegions });

    // ---- 2) Heuristic fallback (works without AI) ----------------------
    function heuristic(): any {
      const recs: any[] = [];
      const day7 = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      const ix = (s: string) => topDepts.some((d) => d.name.toLowerCase().includes(s));
      const wantMarkdown = strategy === 'MARKDOWN' || (strategy === 'AUTO' && (ctx.season === 'late-spring' || ctx.season === 'late-summer' || ctx.season === 'fall' || ctx.season === 'winter'));
      const wantEdlp = strategy === 'EDLP' || (strategy === 'AUTO' && (ctx.season === 'early-spring' || ctx.season === 'spring' || ctx.season === 'summer'));

      if (wantMarkdown) {
        if (ix('apparel') || ix('seasonal')) recs.push({ kind: 'MARKDOWN_PCT', changeType: 'MARKDOWN_PCT', amount: 20, effectiveDate: day7, scopeNote: 'Apparel/seasonal items in scope', rationale: 'Clearance pressure builds at the end of ' + ctx.season + '. A 20% markdown moves residuals before the next reset.', confidence: 'medium' });
        else recs.push({ kind: 'MARKDOWN_PCT', changeType: 'MARKDOWN_PCT', amount: 15, effectiveDate: day7, scopeNote: 'Scope-wide', rationale: 'Moderate 15% markdown to accelerate sell-through given seasonal transition.', confidence: 'low' });
      }
      if (wantEdlp && avgPrice != null) {
        const target = Math.max(0.99, Math.round((avgPrice * 0.92) * 4) / 4);  // round to nearest 0.25
        recs.push({ kind: 'EDLP', changeType: 'SET_PRICE', amount: target, effectiveDate: day7, scopeNote: 'Scope-wide EDLP', rationale: 'Set a competitive EDLP at $' + target.toFixed(2) + ' (~8% under current average) to drive traffic during ' + ctx.season + '.', confidence: 'medium' });
      }
      if (ctx.upcomingHolidays.length) {
        const h = ctx.upcomingHolidays[0]!;
        recs.push({ kind: 'MARKDOWN_PCT', changeType: 'MARKDOWN_PCT', amount: 25, effectiveDate: day7, scopeNote: `${h.name} promo window`, rationale: `${h.name} is ${h.daysUntil} days out — promote 25% off to capture event-driven trips.`, confidence: 'medium' });
      }
      return { recommendations: recs.slice(0, 4) };
    }

    let payload: any = heuristic();
    let aiUsed = false;

    // ---- 3) Real AI call when configured -------------------------------
    if (anthropicConfigured()) {
      const prompt = [
        'You are a Family Dollar pricing strategist. Recommend 1–4 concrete pricing moves for the scope below.',
        '',
        'SCOPE:',
        `- ${scope.skuCount.toLocaleString()} SKUs across ${scope.storeCount.toLocaleString()} stores (${scope.itemLocations.toLocaleString()} item-locations)`,
        scope.topDepts.length ? `- Top categories: ${scope.topDepts.map((d) => `${d.name} (${d.share}%)`).join(', ')}` : '',
        scope.avgPrice != null ? `- Price range $${scope.minPrice?.toFixed(2)}–$${scope.maxPrice?.toFixed(2)} (avg $${scope.avgPrice.toFixed(2)}, avg cost $${scope.avgCost?.toFixed(2) ?? '?'})` : '',
        '',
        'CONTEXT:',
        renderContextForPrompt(ctx),
        '',
        `STRATEGY MODE: ${strategy}`,
        'Output 1–4 recommendations. Each must include kind ("EDLP" | "MARKDOWN_PCT" | "MARKDOWN_AMT" | "SET_PRICE"), changeType, amount (number; for markdowns %, for set price $), effectiveDate (YYYY-MM-DD, ≥ today+5d typically), scopeNote (which slice of the scope this applies to in plain English), rationale (≤ 30 words, concrete and tied to the context above), and confidence ("high" | "medium" | "low").',
      ].filter(Boolean).join('\n');

      const out = await askJson<{ recommendations: any[] }>({
        system: 'You are an expert retail-pricing strategist for a discount retailer. Be decisive, concise, and tie every move to a real seasonal/competitive/inventory signal. Output JSON only.',
        user: prompt,
        jsonShape: '{ "recommendations": [{ "kind": string, "changeType": string, "amount": number, "effectiveDate": string, "scopeNote": string, "rationale": string, "confidence": string }] }',
        maxTokens: 1600,
      });
      if (out?.recommendations?.length) {
        payload = out;
        aiUsed = true;
      }
    }

    return {
      aiUsed,
      strategy,
      scope,
      context: ctx,
      recommendations: payload.recommendations ?? [],
    };
  });
}
