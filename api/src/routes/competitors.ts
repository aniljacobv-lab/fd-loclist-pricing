import type { FastifyInstance } from 'fastify';
import type { DataStore } from '../store/datastore.js';
import { config } from '../config.js';
import type { Item } from '../types.js';

// ----------------------------------------------------------------------------
// Competitor price intelligence — best-effort live web scraping.
//
// For each (sku, rival) pair the API fetches the rival's search-results page
// for the item's description, extracts the most plausible price, and caches
// the result in process. Several major retailers (Walmart in particular) block
// crawlers — when that happens we surface the failure transparently so the
// gap report can show 'no data' instead of misleading numbers. Rival sites
// and selectors live in app.config.json so they can be retuned without code.
// ----------------------------------------------------------------------------

export interface CompetitorPrice {
  sku: number;
  rivalKey: string;
  rivalName: string;
  price: number | null;
  status: 'OK' | 'BLOCKED' | 'NOT_FOUND' | 'ERROR' | 'TIMEOUT';
  message: string | null;
  url: string;
  fetchedAt: string;
}

type Cache = Map<string, CompetitorPrice>;
const cacheKey = (sku: number, rivalKey: string) => `${sku}|${rivalKey}`;
function getCache(): Cache {
  const g = globalThis as any;
  if (!g.__fdCompCache) g.__fdCompCache = new Map<string, CompetitorPrice>();
  return g.__fdCompCache as Cache;
}

// Extract a USD price from raw HTML. Strategy:
//   1) Strip scripts/styles/comments so we don't grab "minPrice":499 inside JSON-LD.
//   2) Look for $X.YZ near the first product card text — first match wins.
//   3) If no decimal pattern, fall back to "$\d+" (less reliable; e.g. "$5").
// Returns null on no plausible match.
function parsePrice(html: string): number | null {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  // Highest-confidence: $1.99, $12.49
  const m1 = cleaned.match(/\$\s?(\d{1,3}(?:[,]\d{3})*)\.(\d{2})/);
  if (m1) {
    const n = Number(m1[1]!.replace(/,/g, '') + '.' + m1[2]);
    if (Number.isFinite(n) && n > 0 && n < 1000) return n;
  }
  // Fallback: "$5" or "$15" without cents
  const m2 = cleaned.match(/\$\s?(\d{1,3})\b/);
  if (m2) {
    const n = Number(m2[1]);
    if (Number.isFinite(n) && n > 0 && n < 1000) return n;
  }
  return null;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{ ok: true; html: string } | { ok: false; reason: 'BLOCKED' | 'ERROR' | 'TIMEOUT'; message: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 FDPricingPOC/1.0',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(t);
    if (r.status === 403 || r.status === 429) return { ok: false, reason: 'BLOCKED', message: `HTTP ${r.status}` };
    if (!r.ok) return { ok: false, reason: 'ERROR', message: `HTTP ${r.status}` };
    const html = await r.text();
    if (/are you a robot|access denied|captcha|verify you are human/i.test(html)) {
      return { ok: false, reason: 'BLOCKED', message: 'bot-check / captcha page' };
    }
    return { ok: true, html };
  } catch (e: any) {
    clearTimeout(t);
    if (e?.name === 'AbortError') return { ok: false, reason: 'TIMEOUT', message: `>${timeoutMs}ms` };
    return { ok: false, reason: 'ERROR', message: e?.message ?? String(e) };
  }
}

async function scrapeOne(sku: number, item: Item, rival: { key: string; name: string; searchUrl: string }, timeoutMs: number): Promise<CompetitorPrice> {
  const q = encodeURIComponent(item.description);
  const url = rival.searchUrl.replace('{q}', q);
  const at = new Date().toISOString();
  const res = await fetchWithTimeout(url, timeoutMs);
  if (!res.ok) {
    return { sku, rivalKey: rival.key, rivalName: rival.name, price: null, status: res.reason, message: res.message, url, fetchedAt: at };
  }
  const price = parsePrice(res.html);
  if (price == null) return { sku, rivalKey: rival.key, rivalName: rival.name, price: null, status: 'NOT_FOUND', message: 'no price pattern found', url, fetchedAt: at };
  return { sku, rivalKey: rival.key, rivalName: rival.name, price, status: 'OK', message: null, url, fetchedAt: at };
}

export async function competitorRoutes(app: FastifyInstance, ds: DataStore) {
  app.get('/competitors/rivals', async () => ({ rivals: config.app.competitors.rivals.map((r) => ({ key: r.key, name: r.name })) }));

  // POST /competitors/scrape  { skus: number[], rivals?: string[] }
  // Runs live fetches against each configured rival site for each SKU. Heavily
  // capped to keep the API responsive; large batches should call repeatedly.
  app.post('/competitors/scrape', async (req, reply) => {
    const body = (req.body as any) ?? {};
    const skus: number[] = Array.isArray(body.skus) ? body.skus.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : [];
    if (skus.length === 0) return reply.code(400).send({ error: 'bad_request', message: 'skus is required' });
    const cap = config.app.competitors.scrapeBatchCap;
    const trimmed = skus.slice(0, cap);
    const rivalFilter: Set<string> | null = Array.isArray(body.rivals) && body.rivals.length > 0 ? new Set(body.rivals.map((s: any) => String(s).toUpperCase())) : null;
    const rivals = config.app.competitors.rivals.filter((r) => !rivalFilter || rivalFilter.has(r.key));
    const cache = getCache();
    const results: CompetitorPrice[] = [];
    const blockedRivals = new Set<string>();
    for (const sku of trimmed) {
      const item = await ds.getItem(sku);
      if (!item) continue;
      for (const r of rivals) {
        const res = await scrapeOne(sku, item, r, config.app.competitors.fetchTimeoutMs);
        cache.set(cacheKey(sku, r.key), res);
        results.push(res);
        if (res.status === 'BLOCKED') blockedRivals.add(r.key);
      }
    }
    return {
      scraped: trimmed.length, requested: skus.length, capped: skus.length > cap,
      blockedRivals: [...blockedRivals],
      results,
    };
  });

  // GET /competitors/prices?skus=1,2,3 — returns whatever is cached.
  app.get('/competitors/prices', async (req) => {
    const q = req.query as any;
    const skus: number[] = String(q?.skus ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const cache = getCache();
    const out: CompetitorPrice[] = [];
    for (const sku of skus) for (const r of config.app.competitors.rivals) {
      const v = cache.get(cacheKey(sku, r.key)); if (v) out.push(v);
    }
    return { prices: out };
  });

  // GET /competitors/gap-report?kind=ALL|DEPT&deptId=&limit=
  // For items in scope that have cached competitor data, report FD vs. competitor
  // and recommend an action.
  app.get('/competitors/gap-report', async (req) => {
    const q = req.query as any;
    const kind = String(q?.kind ?? 'ALL').toUpperCase();
    const deptId = q?.deptId != null ? Number(q.deptId) : null;
    const limit = Math.max(10, Math.min(500, Number(q?.limit ?? 100)));
    const all = await ds.listItems();
    const scoped = all.filter((i) => i.currentRetail != null && (kind !== 'DEPT' || deptId == null || i.deptId === deptId));
    const cache = getCache();
    const lines: any[] = [];
    for (const it of scoped) {
      const prices = config.app.competitors.rivals.map((r) => cache.get(cacheKey(it.sku, r.key))).filter((x): x is CompetitorPrice => !!x);
      const ok = prices.filter((p) => p.status === 'OK' && p.price != null) as (CompetitorPrice & { price: number })[];
      if (ok.length === 0) continue;
      const avg = ok.reduce((a, b) => a + b.price, 0) / ok.length;
      const fd = it.currentRetail as number;
      const gapPct = avg > 0 ? ((fd - avg) / avg) * 100 : 0;
      let action = 'in line';
      if (gapPct > 8) action = 'consider markdown / promo';
      else if (gapPct < -8) action = 'margin opportunity — consider raising';
      lines.push({
        sku: it.sku, description: it.description, deptName: it.deptName ?? '',
        fdPrice: fd,
        competitors: ok.map((p) => ({ rivalKey: p.rivalKey, rivalName: p.rivalName, price: p.price })),
        avgCompetitor: Math.round(avg * 100) / 100,
        gapPct: Math.round(gapPct * 10) / 10,
        action,
      });
    }
    lines.sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
    return { totalCovered: lines.length, lines: lines.slice(0, limit) };
  });
}
