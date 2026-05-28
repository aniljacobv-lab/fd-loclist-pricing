import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../store/datastore.js';
import { computeImpactMetrics, computeRequiredTier, parseRole, canApprove } from '../lib/approvals.js';
import type { PCStatus } from '../types.js';

const ItemSelectorSchema = z.object({
  mode: z.enum(['ALL', 'SINGLE_SKU', 'SKU_LIST', 'HIERARCHY', 'PRICE_POINT', 'VENDOR']),
  sku: z.number().int().nullable().optional(),
  skuListId: z.number().int().nullable().optional(),
  skus: z.array(z.number().int()).optional(),
  deptId: z.number().int().nullable().optional(),
  deptIds: z.array(z.number().int()).optional(),
  classId: z.number().int().nullable().optional(),
  classIds: z.array(z.number().int()).optional(),
  subclassId: z.number().int().nullable().optional(),
  subclassIds: z.array(z.number().int()).optional(),
  pricePointEndsIn: z.number().nullable().optional(),
  pricePointEndsInList: z.array(z.number()).optional(),
  vendorId: z.number().int().nullable().optional(),
  vendorIds: z.array(z.number().int()).optional(),
  exceptSkus: z.array(z.number().int()).optional(),
});
const LocationSelectorSchema = z.object({
  mode: z.enum(['LOCATION_LIST', 'ZONE', 'STORES']),
  locListId: z.number().int().nullable().optional(),
  locListIds: z.array(z.number().int()).optional(),
  zoneGroupId: z.number().int().nullable().optional(),
  zoneId: z.number().int().nullable().optional(),
  zoneIds: z.array(z.number().int()).optional(),
  storeIds: z.array(z.number().int()).optional(),
  exceptStoreIds: z.array(z.number().int()).optional(),
});
const CreateBody = z.object({
  pcName: z.string().min(1).max(120),
  itemSelector: ItemSelectorSchema,
  locationSelector: LocationSelectorSchema,
  changeType: z.enum(['SET_PRICE', 'MARKDOWN_PCT', 'MARKDOWN_AMT', 'ZONE_INHERIT']),
  amount: z.number().nonnegative(),
  roundingRule: z.enum(['NONE', 'ENDS_IN', 'PRICE_POINT', 'ROUND', 'CLEARANCE_ROUNDING_7S', 'GOOD_ROUNDING_RULES']).optional(),
  endsIn: z.number().nullable().optional(),
  multiUnits: z.number().int().nullable().optional(),
  multiRetail: z.number().nullable().optional(),
  fundedByVendor: z.boolean().optional(),
  dealId: z.string().max(60).nullable().optional(),
  fundingVendorId: z.number().int().nullable().optional(),
  fundingPct: z.number().min(0).max(100).nullable().optional(),
  sendDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonCode: z.number().int().nullable().optional(),
});
const StatusBody = z.object({ status: z.enum(['WORKSHEET', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PROMOTED', 'CANCELLED']) });

export async function priceChangeRoutes(app: FastifyInstance, ds: DataStore) {
  app.get('/price-changes', async (req) => ({ priceChanges: await ds.listPriceChanges({ status: (req.query as any)?.status as PCStatus | undefined }) }));
  app.get('/price-changes/:id', async (req, reply) => {
    const pc = await ds.getPriceChange(Number((req.params as any).id));
    if (!pc) return reply.code(404).send({ error: 'not_found' });
    return pc;
  });
  app.post('/price-changes', async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const createdBy = (req.headers['x-user'] as string) || 'anonymous';
    const out = await ds.createPriceChange({
      pcName: parsed.data.pcName, itemSelector: parsed.data.itemSelector, locationSelector: parsed.data.locationSelector,
      changeType: parsed.data.changeType, amount: parsed.data.amount, roundingRule: parsed.data.roundingRule,
      endsIn: parsed.data.endsIn ?? null, multiUnits: parsed.data.multiUnits ?? null, multiRetail: parsed.data.multiRetail ?? null,
      fundedByVendor: parsed.data.fundedByVendor ?? false, dealId: parsed.data.dealId ?? null,
      fundingVendorId: parsed.data.fundingVendorId ?? null, fundingPct: parsed.data.fundingPct ?? null,
      sendDate: parsed.data.sendDate ?? null, effectiveDate: parsed.data.effectiveDate, reasonCode: parsed.data.reasonCode ?? null, createdBy,
    });
    if (out.resolvedSkus.length === 0) return reply.code(400).send({ error: 'empty_selection', message: 'Item selector resolved to 0 SKUs.' });
    if (out.resolvedStoreIds.length === 0) return reply.code(400).send({ error: 'empty_selection', message: 'Location selector resolved to 0 stores.' });
    return reply.code(201).send(out);
  });
  app.patch('/price-changes/:id/status', async (req, reply) => {
    const parsed = StatusBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const out = await ds.updatePriceChangeStatus(Number((req.params as any).id), parsed.data.status);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });


  // ---- approval workflow (multi-tier, risk-routed) ----
  // POST /price-changes/:id/submit  — computes impact, derives required tier,
  //                                    sets status to SUBMITTED.
  app.post('/price-changes/:id/submit', async (req, reply) => {
    const pc = await ds.getPriceChange(Number((req.params as any).id));
    if (!pc) return reply.code(404).send({ error: 'not_found' });
    if (pc.status !== 'WORKSHEET' && pc.status !== 'REJECTED') {
      return reply.code(400).send({ error: 'bad_state', message: `cannot submit from status ${pc.status}` });
    }
    const metrics = await computeImpactMetrics(ds, pc);
    const requiredTier = computeRequiredTier(metrics);
    const actor = (req.headers['x-user'] as string | undefined) ?? 'unknown';
    const out = await ds.submitForApproval(pc.pcId, actor, requiredTier);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return { priceChange: out, metrics, requiredTier };
  });

  // POST /price-changes/:id/approve — caller's role (X-Role) must be >= the
  // next expected tier on this PC.
  app.post('/price-changes/:id/approve', async (req, reply) => {
    const role = parseRole(req.headers['x-role'] as string | undefined);
    if (!role) return reply.code(400).send({ error: 'bad_request', message: 'X-Role header required (BUYER|CATEGORY_MGR|DIRECTOR|VP)' });
    const pc = await ds.getPriceChange(Number((req.params as any).id));
    if (!pc) return reply.code(404).send({ error: 'not_found' });
    if (pc.status !== 'SUBMITTED') return reply.code(400).send({ error: 'bad_state', message: `cannot approve in status ${pc.status}` });
    const check = canApprove(role, pc);
    if (!check.ok) return reply.code(403).send({ error: 'forbidden', message: check.reason });
    const actor = (req.headers['x-user'] as string | undefined) ?? 'unknown';
    const comment = ((req.body as any)?.comment ?? null) as string | null;
    const out = await ds.approvePc(pc.pcId, actor, role, check.tier, comment);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  // POST /price-changes/:id/reject — any tier role can reject; ends the cycle.
  app.post('/price-changes/:id/reject', async (req, reply) => {
    const role = parseRole(req.headers['x-role'] as string | undefined);
    if (!role) return reply.code(400).send({ error: 'bad_request', message: 'X-Role header required' });
    const pc = await ds.getPriceChange(Number((req.params as any).id));
    if (!pc) return reply.code(404).send({ error: 'not_found' });
    if (pc.status !== 'SUBMITTED') return reply.code(400).send({ error: 'bad_state', message: `cannot reject in status ${pc.status}` });
    const actor = (req.headers['x-user'] as string | undefined) ?? 'unknown';
    const comment = ((req.body as any)?.comment ?? null) as string | null;
    const out = await ds.rejectPc(pc.pcId, actor, role, comment);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  // POST /price-changes/:id/comment — append a comment without changing status.
  app.post('/price-changes/:id/comment', async (req, reply) => {
    const role = parseRole(req.headers['x-role'] as string | undefined) ?? 'BUYER';
    const body = (req.body as any) ?? {};
    if (typeof body.comment !== 'string' || !body.comment.trim()) {
      return reply.code(400).send({ error: 'bad_request', message: 'comment is required' });
    }
    const actor = (req.headers['x-user'] as string | undefined) ?? 'unknown';
    const out = await ds.commentOnPc(Number((req.params as any).id), actor, role, body.comment.trim());
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  // ---- execution: resolve / promote / async jobs ----
  app.post('/price-changes/:id/resolve', async (req, reply) => {
    const out = await ds.resolvePriceChange(Number((req.params as any).id));
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });
  app.post('/price-changes/:id/promote', async (req, reply) => {
    try {
      const out = await ds.promotePriceChange(Number((req.params as any).id));
      if (!out) return reply.code(404).send({ error: 'not_found' });
      return out;
    } catch (e: any) { return reply.code(400).send({ error: 'cannot_promote', message: e?.message ?? String(e) }); }
  });
  app.post('/price-changes/:id/jobs', async (req, reply) => {
    const jobType = (req.body as any)?.jobType;
    if (jobType !== 'RESOLVE' && jobType !== 'PROMOTE') return reply.code(400).send({ error: 'bad_request', message: 'jobType must be RESOLVE or PROMOTE' });
    return reply.code(202).send(await ds.submitJob(Number((req.params as any).id), jobType));
  });
  app.get('/price-changes/:id/jobs', async (req) => ({ jobs: await ds.listJobs(Number((req.params as any).id)) }));
  app.get('/jobs/:jobId', async (req, reply) => {
    const j = await ds.getJob(Number((req.params as any).jobId));
    if (!j) return reply.code(404).send({ error: 'not_found' });
    return j;
  });
}
