import type { FastifyInstance } from 'fastify';
import type { DataStore } from '../store/datastore.js';
import type { ItemSelector, LocationSelector } from '../types.js';
import { config } from '../config.js';

function pageArgs(query: any) {
  return {
    search: query?.search as string | undefined,
    page: query?.page ? Number(query.page) : undefined,
    pageSize: query?.pageSize ? Number(query.pageSize) : undefined,
  };
}

export async function referenceRoutes(app: FastifyInstance, ds: DataStore) {
  // Client-facing config (tunables come from config/app.config.json, no hardcoding)
  app.get('/config', async () => ({
    pricing: config.app.pricing,
    pagination: config.app.pagination,
    leadTimes: config.app.leadTimes,
  }));

  // Paged + searchable list endpoints (FD volume)
  app.get('/stores', async (req) => ds.searchStores(pageArgs(req.query)));
  // All matching store IDs (id-only) — powers "Select all matching" in the UI so a
  // user can pick thousands of stores without paging. Bounded by the store count
  // (~9k); a production Oracle build would use an id-only SQL projection.
  app.get('/stores/ids', async (req) => {
    const term = ((req.query as any)?.search as string | undefined ?? '').trim().toLowerCase();
    const all = await ds.listStores();
    const matched = term
      ? all.filter((x) => String(x.storeId).includes(term) || x.name.toLowerCase().includes(term) || (x.city ?? '').toLowerCase().includes(term) || (x.state ?? '').toLowerCase().includes(term))
      : all;
    return { storeIds: matched.map((x) => x.storeId), total: matched.length };
  });
  app.get('/items', async (req) => ds.searchItems(pageArgs(req.query)));
  app.get('/items/:sku', async (req, reply) => {
    const item = await ds.getItem(Number((req.params as any).sku));
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return item;
  });
  app.get('/zones', async (req, reply) => {
    const zgid = (req.query as any)?.zoneGroupId;
    if (!zgid) return reply.code(400).send({ error: 'bad_request', message: 'zoneGroupId is required' });
    return ds.searchZones({ zoneGroupId: Number(zgid), ...pageArgs(req.query) });
  });

  app.get('/vendors', async () => ({ vendors: await ds.listVendors() }));
  app.get('/zone-groups', async () => ({ zoneGroups: await ds.listZoneGroups() }));

  app.get('/hierarchy/divisions', async () => ({ divisions: await ds.listDivisions() }));
  app.get('/hierarchy/groups', async (req) => {
    const div = (req.query as any)?.division;
    return { groups: await ds.listGroups(div ? Number(div) : undefined) };
  });
  app.get('/hierarchy/depts', async (req) => {
    const g = (req.query as any)?.groupNo;
    return { depts: await ds.listDepts(g ? Number(g) : undefined) };
  });
  app.get('/hierarchy/classes', async (req) => {
    const dept = (req.query as any)?.deptId;
    return { classes: await ds.listClasses(dept ? Number(dept) : undefined) };
  });
  app.get('/hierarchy/subclasses', async (req) => {
    const dept = (req.query as any)?.deptId, cls = (req.query as any)?.classId;
    return { subclasses: await ds.listSubclasses(dept ? Number(dept) : undefined, cls ? Number(cls) : undefined) };
  });

  app.post('/resolve/items', async (req) => { const skus = await ds.resolveItems(req.body as ItemSelector); return { skus, count: skus.length }; });
  app.post('/resolve/stores', async (req) => { const storeIds = await ds.resolveStores(req.body as LocationSelector); return { storeIds, count: storeIds.length }; });
}
