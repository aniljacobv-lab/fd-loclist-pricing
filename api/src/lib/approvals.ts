import { config } from '../config.js';
import { computeNewRetail } from '../store/datastore.js';
import type { DataStore } from '../store/datastore.js';
import type { PriceChange, Role } from '../types.js';
import { ROLE_TIER } from '../types.js';

// ----------------------------------------------------------------------------
// Approval routing — config-driven, risk-based tier escalation.
//
// Tier 1 (Buyer) is implicit on every PC. Higher tiers are added when the PC's
// projected impact crosses ANY of the configured thresholds for that tier —
// |weekly margin $ delta|, item-location count, SKU count, store count, or
// below-floor count. Thresholds live in app.config.json (approvals.tierThresholds)
// so they can be tuned without code changes.
// ----------------------------------------------------------------------------

export interface ImpactMetrics {
  skuCount: number;
  storeCount: number;
  itemLocations: number;
  belowFloor: number;
  weeklyMarginUsdAbs: number;   // |projected weekly margin delta|
}

function hash01(a: number, b: number): number {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ (a & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ ((a >>> 16) & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ (b & 0xffff), 16777619) >>> 0;
  h = Math.imul(h ^ ((b >>> 16) & 0xffff), 16777619) >>> 0;
  return (h >>> 0) / 4294967296;
}
const baseUnitsPerStoreWeek = (sku: number) => 1.5 + hash01(sku, 21) * 18.5;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Project weekly margin delta using the same model as /pricing/impact.
export async function computeImpactMetrics(ds: DataStore, pc: PriceChange): Promise<ImpactMetrics> {
  const skuCount = pc.resolvedSkus.length;
  const storeCount = pc.resolvedStoreIds.length;
  const itemLocations = skuCount * storeCount;
  const floor = config.app.pricing.marginFloorPct;
  const elasticity = config.app.pricing.assumedElasticity;
  const cap = Math.max(50, Math.min(skuCount, Math.floor(config.app.ai.pricePreviewMaxRows / 4)));
  const sampleSkus = pc.resolvedSkus.slice(0, cap);
  let gmDeltaSum = 0, priced = 0, belowFloor = 0;
  for (const sku of sampleSkus) {
    const item = await ds.getItem(sku);
    if (!item || item.currentRetail == null || item.currentRetail <= 0) continue;
    let next: number | null;
    if (pc.changeType === 'ZONE_INHERIT') {
      const m = pc.priceMap?.find((x) => x.sku === sku);
      next = m ? m.newRetail : item.currentRetail;
    } else {
      next = computeNewRetail(item.currentRetail, pc.changeType, pc.amount, pc.endsIn);
    }
    if (next == null) continue;
    priced++;
    const cost = item.cost;
    const base = baseUnitsPerStoreWeek(sku);
    const ratio = clamp(Math.pow(next / item.currentRetail, elasticity), 0.2, 5);
    if (cost != null) {
      const gmB = (item.currentRetail - cost) * base;
      const gmA = (next - cost) * base * ratio;
      gmDeltaSum += (gmA - gmB);
      if (next > 0 && ((next - cost) / next) * 100 < floor) belowFloor++;
    }
  }
  const scale = (priced > 0 ? skuCount / priced : 0) * storeCount;
  const weeklyMarginUsdAbs = Math.abs(gmDeltaSum * scale);
  const belowFloorScaled = Math.round((priced > 0 ? skuCount / priced : 0) * belowFloor);
  return { skuCount, storeCount, itemLocations, belowFloor: belowFloorScaled, weeklyMarginUsdAbs };
}

export function computeRequiredTier(metrics: ImpactMetrics): number {
  let required = 1;
  for (const t of config.app.approvals.tierThresholds) {
    const triggers =
      (t.weeklyMarginUsd != null && metrics.weeklyMarginUsdAbs >= t.weeklyMarginUsd) ||
      (t.itemLocations != null && metrics.itemLocations >= t.itemLocations) ||
      (t.skuCount != null && metrics.skuCount >= t.skuCount) ||
      (t.storeCount != null && metrics.storeCount >= t.storeCount) ||
      (t.belowFloor != null && metrics.belowFloor >= t.belowFloor);
    if (triggers && t.tier > required) required = t.tier;
  }
  return Math.min(4, Math.max(1, required));
}

export function parseRole(s: string | undefined | null): Role | null {
  if (!s) return null;
  const up = s.trim().toUpperCase();
  if (up === 'BUYER' || up === 'CATEGORY_MGR' || up === 'DIRECTOR' || up === 'VP') return up;
  return null;
}

export function nextExpectedTier(pc: PriceChange): number | null {
  for (let t = 1; t <= pc.requiredTier; t++) if (!pc.approvedTiers.includes(t)) return t;
  return null;
}

export function canApprove(role: Role, pc: PriceChange): { ok: true; tier: number } | { ok: false; reason: string } {
  const next = nextExpectedTier(pc);
  if (next == null) return { ok: false, reason: 'already fully approved' };
  const roleTier = ROLE_TIER[role];
  if (roleTier < next) return { ok: false, reason: `tier ${next} approval required, your role is tier ${roleTier}` };
  return { ok: true, tier: next };
}
