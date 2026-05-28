import type { FastifyInstance } from 'fastify';
import type { DataStore } from '../store/datastore.js';
import type { PriceChange, PCStatus } from '../types.js';
import { config } from '../config.js';

// Home dashboard: a single roll-up of the price-change lifecycle so the app
// has a real front door — what's pending my approval, what goes live soon,
// what's running now, and the overall catalog/scope footprint.

type LiveKind = 'PROMOTION' | 'CLEARANCE' | 'REPRICE';
function classify(pc: PriceChange): LiveKind {
  if (pc.fundedByVendor) return 'PROMOTION';
  if (pc.changeType === 'MARKDOWN_PCT' || pc.changeType === 'MARKDOWN_AMT') return 'CLEARANCE';
  return 'REPRICE';
}
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (fromISO: string, toISO: string) =>
  Math.round((new Date(toISO + 'T00:00:00Z').getTime() - new Date(fromISO + 'T00:00:00Z').getTime()) / 86400000);

export async function dashboardRoutes(app: FastifyInstance, ds: DataStore) {
  app.get('/dashboard', async () => {
    const [pcs, stores, items, zones, zoneGroups, locLists, skuLists] = await Promise.all([
      ds.listPriceChanges(), ds.listStores(), ds.listItems(), ds.listZones(),
      ds.listZoneGroups(), ds.listLocationLists(), ds.listSkuLists(),
    ]);

    const STATUSES: PCStatus[] = ['WORKSHEET', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PROMOTED', 'CANCELLED'];
    const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<PCStatus, number>;
    for (const pc of pcs) statusCounts[pc.status] = (statusCounts[pc.status] ?? 0) + 1;

    const slim = (pc: PriceChange) => ({
      pcId: pc.pcId, pcName: pc.pcName, status: pc.status, changeType: pc.changeType, amount: pc.amount,
      effectiveDate: pc.effectiveDate, sendDate: pc.sendDate, createdBy: pc.createdBy, createdAt: pc.createdAt,
      skuCount: pc.resolvedSkus.length, storeCount: pc.resolvedStoreIds.length, fundedByVendor: pc.fundedByVendor,
    });

    // Awaiting my approval (SUBMITTED), soonest effective first.
    const pendingApprovals = pcs
      .filter((pc) => pc.status === 'SUBMITTED')
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
      .map(slim);

    // Goes live in the next 30 days (not rejected/cancelled), soonest first.
    const today = todayISO();
    const upcomingEffective = pcs
      .filter((pc) => pc.status !== 'REJECTED' && pc.status !== 'CANCELLED')
      .map((pc) => ({ pc, d: daysBetween(today, pc.effectiveDate) }))
      .filter((x) => x.d >= 0 && x.d <= 30)
      .sort((a, b) => a.d - b.d)
      .map((x) => ({ ...slim(x.pc), daysUntil: x.d }));

    // What's running now (PROMOTED), bucketed.
    const live = pcs.filter((pc) => pc.status === 'PROMOTED');
    const liveCounts = { promotions: 0, clearances: 0, reprices: 0 };
    for (const pc of live) {
      const k = classify(pc);
      if (k === 'PROMOTION') liveCounts.promotions++;
      else if (k === 'CLEARANCE') liveCounts.clearances++;
      else liveCounts.reprices++;
    }

    const recent = [...pcs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map(slim);

    return {
      totals: {
        stores: stores.length, items: items.length, zones: zones.length, zoneGroups: zoneGroups.length,
        locationLists: locLists.length, skuLists: skuLists.length, priceChanges: pcs.length,
        activePriceChanges: pcs.filter((pc) => pc.status !== 'CANCELLED' && pc.status !== 'REJECTED').length,
      },
      statusCounts,
      pendingApprovals,
      upcomingEffective,
      liveCounts,
      recent,
      marginFloorPct: config.app.pricing.marginFloorPct,
      generatedAt: new Date().toISOString(),
    };
  });
}
