import type { FastifyInstance } from 'fastify';
import type { DataStore } from '../store/datastore.js';
import { config } from '../config.js';
import type { Item } from '../types.js';
import { getAnthropic, anthropicConfigured } from '../ai/client.js';

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

// Build the actual fetch URL. When a scraping service is configured + the
// SCRAPING_API_KEY env is set, route through it so the residential proxy +
// JS renderer handle CAPTCHAs and IP-based blocks. Otherwise fetch direct.
function resolveFetchUrl(targetUrl: string): { url: string; viaService: string | null } {
  const svc = config.app.competitors.scrapingService;
  const key = process.env.SCRAPING_API_KEY ?? '';
  if (!svc || svc.provider === 'none' || !key || !svc.endpoint) return { url: targetUrl, viaService: null };
  const url = svc.endpoint.replace('{key}', encodeURIComponent(key)).replace('{url}', encodeURIComponent(targetUrl));
  return { url, viaService: svc.provider };
}

async function scrapeOne(sku: number, item: Item, rival: { key: string; name: string; searchUrl: string }, timeoutMs: number): Promise<CompetitorPrice> {
  const q = encodeURIComponent(item.description);
  const targetUrl = rival.searchUrl.replace('{q}', q);
  const { url, viaService } = resolveFetchUrl(targetUrl);
  const at = new Date().toISOString();
  const svc = config.app.competitors.scrapingService;
  const effectiveTimeout = viaService && svc?.timeoutMs ? svc.timeoutMs : timeoutMs;
  const res = await fetchWithTimeout(url, effectiveTimeout);

  if (!res.ok) {
    return { sku, rivalKey: rival.key, rivalName: rival.name, price: null, status: res.reason, message: res.message, url: targetUrl, fetchedAt: at };
  }
  // ScrapingBee surfaces failures as JSON in the response body. Catch them
  // so the gap report shows BLOCKED/ERROR instead of misleading NOT_FOUND.
  if (viaService && res.html.startsWith('{') && res.html.length < 2000) {
    try {
      const j = JSON.parse(res.html);
      if (j && (j.error || j.message)) {
        const msg = String(j.error ?? j.message ?? 'service error');
        const blocked = /block|captcha|ban|forbidden|quota|credits|insufficient/i.test(msg);
        return { sku, rivalKey: rival.key, rivalName: rival.name, price: null, status: blocked ? 'BLOCKED' : 'ERROR', message: `${viaService}: ${msg}`, url: targetUrl, fetchedAt: at };
      }
    } catch { /* fall through to parse */ }
  }
  const price = parsePrice(res.html);
  if (price == null) return { sku, rivalKey: rival.key, rivalName: rival.name, price: null, status: 'NOT_FOUND', message: viaService ? `${viaService}: no price pattern in rendered page` : 'no price pattern found', url: targetUrl, fetchedAt: at };

  return { sku, rivalKey: rival.key, rivalName: rival.name, price, status: 'OK', message: null, url: targetUrl, fetchedAt: at };
}

// ----- async scrape job manager ----------------------------------------
// Render (and most PaaS reverse proxies) close the HTTP connection after
// ~60s. ScrapingBee premium-proxy + JS-render is 10-30s per call, and
// many plans cap concurrency at 1, so a 25-SKU x 3-rival batch can take
// minutes. We fire-and-forget the work into a process-memory job and
// expose progress + results via polling.
type ScrapeJobStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
interface ScrapeJob {
  jobId: number;
  status: ScrapeJobStatus;
  startedAt: string;
  finishedAt: string | null;
  message: string | null;
  skus: number[];
  rivals: string[];               // rivalKey list
  total: number;                  // skus.length * rivals.length
  completed: number;
  blockedRivals: string[];
  results: CompetitorPrice[];     // appended as each (sku,rival) finishes
}
const scrapeJobs = new Map<number, ScrapeJob>();
let scrapeJobSeq = 1;
const SCRAPE_JOB_TTL_MS = 30 * 60 * 1000;

function gcScrapeJobs() {
  const now = Date.now();
  for (const [id, j] of scrapeJobs) {
    const finishedMs = j.finishedAt ? new Date(j.finishedAt).getTime() : 0;
    if (j.status !== 'RUNNING' && finishedMs && (now - finishedMs) > SCRAPE_JOB_TTL_MS) scrapeJobs.delete(id);
  }
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

  // GET /competitors/provider-status — reports the active fetch path so the
  // UI can tell users whether they're going direct or through a service.
  app.get('/competitors/provider-status', async () => {
    const svc = config.app.competitors.scrapingService;
    const key = process.env.SCRAPING_API_KEY ?? '';
    const active = (svc && svc.provider !== 'none' && key) ? svc.provider : 'direct';
    return { active, provider: svc?.provider ?? 'none', hasKey: Boolean(key) };
  });

  // POST /competitors/scrape-job  body: { skus: number[], rivals?: string[] }
  // Starts a background scrape and returns a jobId immediately. The actual
  // work runs after the HTTP response is sent so Render's 60s timeout
  // doesn't kill it. Results stream into the cache as each call completes;
  // poll GET /competitors/scrape-job/:id for progress + the running list.
  app.post('/competitors/scrape-job', async (req, reply) => {
    gcScrapeJobs();
    const body = (req.body as any) ?? {};
    const skus: number[] = Array.isArray(body.skus) ? body.skus.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : [];
    if (skus.length === 0) return reply.code(400).send({ error: 'bad_request', message: 'skus is required' });
    // ScrapingBee credit cost is significant — keep job size bounded even
    // when caller is enthusiastic.
    const JOB_MAX_SKUS = 200;
    if (skus.length > JOB_MAX_SKUS) return reply.code(400).send({ error: 'bad_request', message: `up to ${JOB_MAX_SKUS} SKUs per job` });
    const rivalFilter: Set<string> | null = Array.isArray(body.rivals) && body.rivals.length > 0 ? new Set(body.rivals.map((r: any) => String(r).toUpperCase())) : null;
    const rivals = config.app.competitors.rivals.filter((r) => !rivalFilter || rivalFilter.has(r.key));

    const job: ScrapeJob = {
      jobId: scrapeJobSeq++, status: 'RUNNING',
      startedAt: new Date().toISOString(), finishedAt: null, message: null,
      skus, rivals: rivals.map((r) => r.key),
      total: skus.length * rivals.length, completed: 0,
      blockedRivals: [], results: [],
    };
    scrapeJobs.set(job.jobId, job);

    // Background runner — runs after the response is flushed.
    setImmediate(async () => {
      const cache = getCache();
      const timeout = config.app.competitors.fetchTimeoutMs;
      try {
        for (const sku of skus) {
          const item = await ds.getItem(sku);
          if (!item) {
            // Skip this SKU's slots so completed still advances.
            for (const r of rivals) {
              const at = new Date().toISOString();
              const res: CompetitorPrice = { sku, rivalKey: r.key, rivalName: r.name, price: null, status: 'ERROR', message: 'sku not in catalog', url: 'unknown', fetchedAt: at };
              job.results.push(res); job.completed++;
            }
            continue;
          }
          // Run the three rivals for this SKU in parallel — ScrapingBee will
          // still serialize them if max_concurrency=1 on the account, but at
          // higher tiers this is a real speedup.
          const settled = await Promise.all(rivals.map((r) => scrapeOne(sku, item, r, timeout)));
          for (const rec of settled) {
            cache.set(cacheKey(rec.sku, rec.rivalKey), rec);
            job.results.push(rec);
            job.completed++;
            if (rec.status === 'BLOCKED' && !job.blockedRivals.includes(rec.rivalKey)) job.blockedRivals.push(rec.rivalKey);
          }
        }
        job.status = 'DONE';
      } catch (e: any) {
        job.status = 'FAILED';
        job.message = e?.message ?? String(e);
      } finally {
        job.finishedAt = new Date().toISOString();
      }
    });

    return reply.code(202).send({ jobId: job.jobId, total: job.total, skuCount: skus.length, rivalCount: rivals.length, status: job.status });
  });

  // GET /competitors/scrape-job/:id — progress poll.
  app.get('/competitors/scrape-job/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const job = scrapeJobs.get(id);
    if (!job) return reply.code(404).send({ error: 'not_found' });
    // Return a copy so client mutations don't affect the live job.
    return {
      jobId: job.jobId, status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt,
      message: job.message, total: job.total, completed: job.completed,
      blockedRivals: [...job.blockedRivals], results: [...job.results],
    };
  });

  // GET /competitors/usage — proxies ScrapingBee's /usage endpoint so the UI
  // can show monthly credits used / available. Works for any provider whose
  // config has a usageEndpoint template.
  app.get('/competitors/usage', async (_req, reply) => {
    const svc = config.app.competitors.scrapingService;
    const key = process.env.SCRAPING_API_KEY ?? '';
    if (!svc || svc.provider === 'none' || !svc.usageEndpoint || !key) {
      return { available: false, reason: 'no scraping service configured' };
    }
    const url = svc.usageEndpoint.replace('{key}', encodeURIComponent(key));
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return reply.code(502).send({ available: false, reason: `usage api ${r.status}` });
      const j = await r.json() as any;
      // ScrapingBee shape: { max_api_credit, used_api_credit, max_concurrency, ... }
      return {
        available: true, provider: svc.provider,
        creditsUsed: j.used_api_credit ?? j.creditsUsed ?? null,
        creditsMax: j.max_api_credit ?? j.creditsMax ?? null,
        creditsRemaining: (typeof j.max_api_credit === 'number' && typeof j.used_api_credit === 'number') ? j.max_api_credit - j.used_api_credit : null,
        maxConcurrency: j.max_concurrency ?? null,
        raw: j,
      };
    } catch (e: any) {
      return reply.code(502).send({ available: false, reason: e?.message ?? String(e) });
    }
  });


  // POST /competitors/upload-csv  body: { csv: string }
  // CSV header (case-insensitive): sku,rivalKey,price[,observedAt[,source]]
  // Always works — no scraping involved. Buyer pastes what they saw on a
  // store visit, vendor sent over, or a paid intelligence feed exported.
  app.post('/competitors/upload-csv', async (req, reply) => {
    const body = (req.body as any) ?? {};
    const csv = String(body.csv ?? '').trim();
    if (!csv) return reply.code(400).send({ error: 'bad_request', message: 'csv is required' });

    const rivalKeys = new Set(config.app.competitors.rivals.map((r) => r.key.toUpperCase()));
    const rivalNameByKey = new Map(config.app.competitors.rivals.map((r) => [r.key.toUpperCase(), r.name]));
    const cache = getCache();
    const errors: { row: number; line: string; reason: string }[] = [];
    let inserted = 0;

    const lines = csv.split(/\r?\n/);
    // Detect header
    const firstCols = lines[0]?.toLowerCase().split(',').map((c) => c.trim()) ?? [];
    const hasHeader = firstCols.includes('sku') && firstCols.some((c) => /rival|retailer/i.test(c)) && firstCols.some((c) => /price/i.test(c));
    let colSku = 0, colRival = 1, colPrice = 2, colObs = 3, colSrc = 4;
    let start = 0;
    if (hasHeader) {
      colSku = firstCols.findIndex((c) => c === 'sku');
      colRival = firstCols.findIndex((c) => /rival|retailer/i.test(c));
      colPrice = firstCols.findIndex((c) => /price/i.test(c));
      colObs = firstCols.findIndex((c) => /observ|date/i.test(c));
      colSrc = firstCols.findIndex((c) => /source|note/i.test(c));
      start = 1;
    }
    const at = new Date().toISOString();
    for (let i = start; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || !raw.trim()) continue;
      // crude CSV split — handles quoted commas reasonably
      const cells = raw.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').trim().replace(/^"|"$/g, '').replace(/""/g, '"')) ?? raw.split(',').map((c) => c.trim());
      const sku = Number(cells[colSku]);
      const rivalRaw = (cells[colRival] ?? '').toUpperCase().trim();
      const price = Number((cells[colPrice] ?? '').replace(/[$,\s]/g, ''));
      const obs = (cells[colObs] && cells[colObs]!.trim()) || at;
      const src = (cells[colSrc] ?? '').trim();
      if (!Number.isFinite(sku)) { errors.push({ row: i + 1, line: raw, reason: 'sku is not a number' }); continue; }
      if (!rivalKeys.has(rivalRaw)) { errors.push({ row: i + 1, line: raw, reason: `unknown rivalKey '${rivalRaw}' — use one of ${[...rivalKeys].join(', ')}` }); continue; }
      if (!Number.isFinite(price) || price <= 0 || price > 1000) { errors.push({ row: i + 1, line: raw, reason: 'price must be > 0 and < 1000' }); continue; }
      cache.set(cacheKey(sku, rivalRaw), {
        sku, rivalKey: rivalRaw, rivalName: rivalNameByKey.get(rivalRaw) ?? rivalRaw,
        price, status: 'OK', message: src ? `manual: ${src}` : 'manual upload',
        url: 'manual://upload', fetchedAt: obs,
      });
      inserted++;
    }
    return { inserted, errors, totalLines: lines.length - start };
  });

  // POST /competitors/ai-lookup  body: { sku }
  // Uses Anthropic's web_search tool to find current competitor prices for one
  // SKU. Writes hits into the same cache the scrape uses. Useful for one-off
  // lookups when you don't want to spin up a full batch scrape.
  app.post('/competitors/ai-lookup', async (req, reply) => {
    if (!anthropicConfigured()) return reply.code(400).send({ error: 'no_ai_key', message: 'Set ANTHROPIC_API_KEY in the API environment to use AI lookup.' });
    const sku = Number((req.body as any)?.sku);
    if (!Number.isFinite(sku)) return reply.code(400).send({ error: 'bad_request', message: 'sku is required' });
    const item = await ds.getItem(sku);
    if (!item) return reply.code(404).send({ error: 'not_found', message: `sku ${sku} not in catalog` });

    const rivals = config.app.competitors.rivals;
    const cache = getCache();
    const ant = getAnthropic();
    if (!ant) return reply.code(500).send({ error: 'ai_unavailable' });

    const at = new Date().toISOString();
    const results: CompetitorPrice[] = [];
    // One call with the web_search tool enabled — let Claude do the search itself.
    const prompt = `Find the current online retail price (in USD) of this Family Dollar item at each competitor listed. Use real product matches by brand/size/pack. Return JSON only.\n\nItem: ${item.description}\nDept: ${item.deptName ?? ''}\nVendor: ${item.vendorName ?? ''}\nCompetitors: ${rivals.map((r) => `${r.key}=${r.name}`).join(', ')}\n\nReturn JSON: { "prices": [ { "rivalKey": "DG"|"WMT"|"DT", "price": number|null, "note": string } ] }. Set price to null if you can't find a confident match.`;

    let aiText = '';
    try {
      const msg = await ant.messages.create({
        model: config.anthropic.model,
        max_tokens: 1024,
        system: 'You are a retail pricing analyst. Use web search to find current online retail prices at the listed competitors. Be conservative — only report a price you can verify in a search result; otherwise return null. Output JSON only.',
        // Anthropic's web search tool (May 2025 spec). Falls back to no-search if the model doesn't support it.
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: rivals.length + 1 } as any],
        messages: [{ role: 'user', content: prompt }],
      } as any);
      aiText = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    } catch (e: any) {
      return reply.code(502).send({ error: 'ai_lookup_failed', message: e?.message ?? String(e) });
    }
    const a0 = aiText.indexOf('{'), b0 = aiText.lastIndexOf('}');
    let parsed: { prices?: { rivalKey: string; price: number | null; note?: string }[] } = {};
    if (a0 >= 0 && b0 > a0) { try { parsed = JSON.parse(aiText.slice(a0, b0 + 1)); } catch { /* keep empty */ } }

    for (const r of rivals) {
      const hit = parsed.prices?.find((p) => String(p.rivalKey).toUpperCase() === r.key.toUpperCase());
      const rec: CompetitorPrice = hit && hit.price != null && Number.isFinite(hit.price)
        ? { sku, rivalKey: r.key, rivalName: r.name, price: Number(hit.price), status: 'OK', message: `ai-lookup: ${hit.note ?? ''}`.trim().replace(/:\s*$/, ''), url: 'ai://lookup', fetchedAt: at }
        : { sku, rivalKey: r.key, rivalName: r.name, price: null, status: 'NOT_FOUND', message: hit?.note ?? 'AI could not confidently match an item', url: 'ai://lookup', fetchedAt: at };
      cache.set(cacheKey(sku, r.key), rec);
      results.push(rec);
    }
    return { sku, item: { sku: item.sku, description: item.description }, results };
  });
}
