import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../store/datastore.js';

// Rezone: move one store / multiple stores / a location list into a target zone,
// inheriting that zone's prices. Creates a WORKSHEET price change that flows
// through the normal Submit -> Approve -> Promote cycle; on promote the store's
// zone membership moves and the per-SKU prices hand off to RMS.
const Body = z.object({
  toZoneGroupId: z.number().int(),
  toZoneId: z.number().int(),
  storeIds: z.array(z.number().int()).optional(),
  locListId: z.number().int().nullable().optional(),
  fromZoneId: z.number().int().nullable().optional(),
}).refine((b) => (b.storeIds?.length ?? 0) > 0 || b.locListId != null || b.fromZoneId != null, {
  message: 'Provide storeIds, locListId, or fromZoneId to choose which stores move.',
});

export async function rezoneRoutes(app: FastifyInstance, ds: DataStore) {
  app.post('/rezone/preview', async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const out = await ds.previewRezone(parsed.data);
    if (out.movingStoreCount === 0) return reply.code(400).send({ error: 'empty_selection', message: 'No stores selected to move.' });
    return out;
  });

  app.post('/rezone', async (req, reply) => {
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const createdBy = (req.headers['x-user'] as string) || 'anonymous';
    const preview = await ds.previewRezone(parsed.data);
    if (preview.movingStoreCount === 0) return reply.code(400).send({ error: 'empty_selection', message: 'No stores selected to move.' });
    const out = await ds.createRezone({ ...parsed.data, createdBy });
    return reply.code(201).send(out);
  });
}
