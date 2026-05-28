import { readFileSync, watch, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { createDataStore } from './store/index.js';
import { referenceRoutes } from './routes/reference.js';
import { locListRoutes } from './routes/locLists.js';
import { skuListRoutes } from './routes/skuLists.js';
import { priceChangeRoutes } from './routes/priceChanges.js';
import { pricingRoutes } from './routes/pricing.js';
import { calendarRoutes } from './routes/calendar.js';
import { aiRoutes } from './routes/ai.js';
import { fiscalRoutes } from './routes/fiscal.js';
import { storeViewRoutes } from './routes/storeView.js';
import { rezoneRoutes } from './routes/rezone.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { markdownRoutes } from './routes/markdowns.js';
import { competitorRoutes } from './routes/competitors.js';
import { anthropicConfigured, resetAnthropic } from './ai/client.js';

// Re-parse .env into process.env without a restart, then reset the AI client.
function reloadEnv(log: (m: string) => void) {
  try {
    const path = resolve(process.cwd(), '.env');
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2]!.trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      process.env[key] = val;
    }
    resetAnthropic();
    log(`reloaded .env (AI ${anthropicConfigured() ? 'live' : 'stub'})`);
  } catch { /* .env may not exist; ignore */ }
}

// Locate the built React app. In production (Render/Docker) the API runs from
// /app/api and the web bundle ends up at /app/web/dist. We probe a couple of
// plausible spots so the same binary works locally, in Docker, and on Render.
function findWebDist(): string | null {
  const here = fileURLToPath(new URL('.', import.meta.url));         // .../api/dist
  const candidates = [
    resolve(here, '../../web/dist'),                                  // repo layout
    resolve(process.cwd(), '../web/dist'),                            // cwd=api/
    resolve(process.cwd(), 'web/dist'),                               // cwd=repo root
    resolve(process.cwd(), 'public'),                                 // optional copy
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c;
  }
  return null;
}

async function main() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const ds = await createDataStore();
  app.log.info(`datastore=${config.datastore}`);

  // /health is intentionally OUTSIDE the /api prefix so platforms like Render
  // can use it as a healthcheck URL without knowing the prefix.
  app.get('/health', async () => ({ ok: true, datastore: config.datastore, anthropicConfigured: anthropicConfigured() }));

  // All app endpoints live under /api so this single Fastify process can ALSO
  // serve the built React app from /. The Vite dev proxy is configured to
  // forward /api/* untouched, so dev and production behave identically.
  await app.register(async (api) => {
    await referenceRoutes(api, ds);
    await locListRoutes(api, ds);
    await skuListRoutes(api, ds);
    await priceChangeRoutes(api, ds);
    await pricingRoutes(api, ds);
    await calendarRoutes(api, ds);
    await aiRoutes(api, ds);
    await fiscalRoutes(api);
    await storeViewRoutes(api, ds);
    await rezoneRoutes(api, ds);
    await dashboardRoutes(api, ds);
    await markdownRoutes(api, ds);
    await competitorRoutes(api, ds);
    // /api/health convenience mirror for clients that prefix everything.
    api.get('/health', async () => ({ ok: true, datastore: config.datastore, anthropicConfigured: anthropicConfigured() }));
  }, { prefix: '/api' });

  // Static + SPA fallback. Only when the web bundle exists (i.e. in a built
  // deployment). In `npm run dev` we skip this and let Vite serve the UI.
  const webDist = findWebDist();
  if (webDist) {
    app.log.info(`serving static SPA from ${webDist}`);
    await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
    // Any GET that isn't /api/* and isn't a real static asset returns the
    // SPA shell so React Router (or hash-routing) can take over.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/health')) {
        return reply.type('text/html').send(readFileSync(join(webDist, 'index.html'), 'utf8'));
      }
      return reply.code(404).send({ error: 'not_found', message: `route ${req.method} ${req.url} not found` });
    });
  } else {
    app.log.info('no web bundle found; running API-only (Vite serves the UI in dev)');
  }

  // Watch .env so editing the API key applies live (no manual restart).
  try {
    const envPath = resolve(process.cwd(), '.env');
    let t: NodeJS.Timeout | null = null;
    watch(envPath, () => { if (t) clearTimeout(t); t = setTimeout(() => reloadEnv((m) => app.log.info(m)), 200); });
    app.log.info('watching .env for changes');
  } catch { /* ignore if unwatchable */ }

  const close = async () => { app.log.info('shutting down…'); await ds.shutdown(); await app.close(); process.exit(0); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  await app.listen({ port: config.port, host: config.host });
}
main().catch((err) => { console.error(err); process.exit(1); });
