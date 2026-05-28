import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../store/datastore.js';

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  skus: z.array(z.number().int()).default([]),
});

const UpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  skus: z.array(z.number().int()).optional(),
});

export async function skuListRoutes(app: FastifyInstance, ds: DataStore) {
  app.get('/sku-lists', async () => ({ skuLists: await ds.listSkuLists() }));

  app.get('/sku-lists/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const l = await ds.getSkuList(id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    return l;
  });

  app.post('/sku-lists', async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const createdBy = (req.headers['x-user'] as string) || 'anonymous';
    const out = await ds.createSkuList({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      skus: parsed.data.skus,
      createdBy,
    });
    return reply.code(201).send(out);
  });

  app.patch('/sku-lists/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const out = await ds.updateSkuList(id, parsed.data);
    if (!out) return reply.code(404).send({ error: 'not_found' });
    return out;
  });

  app.delete('/sku-lists/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const ok = await ds.deleteSkuList(id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { deleted: true };
  });
}
