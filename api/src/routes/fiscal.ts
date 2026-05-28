import type { FastifyInstance } from 'fastify';
import { buildFiscalCalendar, fiscalForDate } from '../fiscal.js';

export async function fiscalRoutes(app: FastifyInstance) {
  app.get('/fiscal/calendar', async () => buildFiscalCalendar());
  app.get('/fiscal/for-date', async (req, reply) => {
    const date = (req.query as any)?.date as string | undefined;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'bad_request', message: 'date=YYYY-MM-DD required' });
    const w = fiscalForDate(date);
    if (!w) return reply.code(404).send({ error: 'out_of_range' });
    return w;
  });
}
