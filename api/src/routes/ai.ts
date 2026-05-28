import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../store/datastore.js';
import { askJson, getAnthropic } from '../ai/client.js';
import { config } from '../config.js';

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
}
