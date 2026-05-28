import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../store/datastore.js';

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  storeIds: z.array(z.number().int()).default([]),
});

const UpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  storeIds: z.array(z.number().int()).optional(),
});

export async function locListRoutes(app: FastifyInstance, ds: DataStore) {
  app.get('/location-lists', async () => ({
    locationLists: await ds.listLocationLists(),
  }));

  app.get('/location-lists/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const l = await ds.getLocationList(id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    return l;
  });

  app.post('/location-lists', async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const createdBy = (req.headers['x-user'] as string) || 'anonymous';
    const out = await ds.createLocationList({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      storeIds: parsed.data.storeIds,
      createdBy,
    });
    return reply.code(201).send(out);
  });

  app.patch('/location-lists/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    }
    const out = await ds.updateLocationList(id, parsed.data);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  app.delete('/location-lists/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const ok = await ds.deleteLocationList(id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { deleted: true };
  });
}
