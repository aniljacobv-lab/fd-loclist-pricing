import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DataStore } from '../store/datastore.js';
import { config } from '../config.js';
import { askJson } from '../ai/client.js';

const CreateBody = z.object({
  title: z.string().min(1).max(160),
  type: z.enum([
    'SPARC_STRIP_CHANGE',
    'PRICE_STRIP_PRINT',
    'SEND',
    'EFFECTIVE',
    'BLACKOUT',
    'CUSTOM',
  ]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  zoneGroupId: z.number().int().nullable().optional(),
  zoneId: z.number().int().nullable().optional(),
  leadTimeDays: z.number().int().nullable().optional(),
  relatedPcId: z.number().int().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export async function calendarRoutes(app: FastifyInstance, ds: DataStore) {
  app.get('/calendar/lead-times', async () => ({ leadTimes: config.app.leadTimes }));

  app.get('/calendar/activities', async (req) => {
    const q = req.query as any;
    const from = q?.from as string | undefined;
    const to = q?.to as string | undefined;
    const zoneGroupId = q?.zoneGroupId ? Number(q.zoneGroupId) : null;
    const zoneId = q?.zoneId ? Number(q.zoneId) : null;
    return { activities: await ds.listCalendarActivities({ from, to }, { zoneGroupId, zoneId }) };
  });

  app.post('/calendar/activities', async (req, reply) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad_request', issues: parsed.error.issues });
    const out = await ds.createCalendarActivity(parsed.data);
    return reply.code(201).send(out);
  });

  app.delete('/calendar/activities/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const ok = await ds.deleteCalendarActivity(id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return { deleted: true };
  });

  // AI refresh: layer in region/season-relevant suggestions for the visible window+scope.
  // Replaces only prior AI entries — never manual or FD/seed content.
  app.post('/calendar/ai-refresh', async (req, reply) => {
    const b = req.body as any;
    const from = b?.from as string | undefined;
    const to = b?.to as string | undefined;
    const zoneGroupId = b?.zoneGroupId ?? null;
    const zoneId = b?.zoneId ?? null;

    let region = 'all U.S. regions (national)';
    if (zoneGroupId != null && zoneId != null) {
      const ids = await ds.resolveStores({ mode: 'ZONE', zoneGroupId, zoneId });
      if (ids.length) {
        const byId = new Map((await ds.listStores()).map((s) => [s.storeId, s.regionName ?? 'Other']));
        const rc: Record<string, number> = {};
        for (const id of ids) { const r = byId.get(id) ?? 'Other'; rc[r] = (rc[r] ?? 0) + 1; }
        region = Object.entries(rc).sort((a, b) => b[1] - a[1])[0]?.[0] ?? region;
      }
    }

    const out = await askJson<{ activities: { title: string; type: string; date: string; notes?: string }[] }>({
      system: 'You are a retail planning assistant for Family Dollar, a U.S. discount retailer. Suggest calendar activities a pricing/merchandising planner should be aware of for the given month window and region: seasonal weather risk (hurricanes, extreme heat, winter storms), major shopping/demand events, and notable holidays that drive a dollar-store. Keep titles short and actionable. These are advisory context, not price changes.',
      user: `Window: ${from} to ${to}. Region: ${region}. Return 4-6 items, each with a date strictly within the window (YYYY-MM-DD).`,
      jsonShape: '{"activities":[{"title":"string","type":"SPARC_STRIP_CHANGE|PRICE_STRIP_PRINT|BLACKOUT|CUSTOM","date":"YYYY-MM-DD","notes":"string"}]}',
      maxTokens: 700,
    });

    const valid = new Set(['SPARC_STRIP_CHANGE', 'PRICE_STRIP_PRINT', 'SEND', 'EFFECTIVE', 'BLACKOUT', 'CUSTOM']);
    const within = (d: string) => (!from || d >= from) && (!to || d <= to);
    let items = (out?.activities ?? [])
      .filter((a) => a?.date && within(a.date))
      .map((a) => ({ title: a.title, type: (valid.has(a.type) ? a.type : 'CUSTOM') as any, date: a.date, notes: a.notes ?? null }));

    if (items.length === 0) {
      const mid = from ?? to ?? new Date().toISOString().slice(0, 10);
      items = [{ title: 'Seasonal demand watch', type: 'CUSTOM' as any, date: mid, notes: `AI stub — set ANTHROPIC_API_KEY for live suggestions (${region})` }];
    }
    const created = await ds.replaceAiActivities({ from, to }, { zoneGroupId, zoneId }, items);
    return reply.send({ activities: created, region, stub: !out });
  });
}
