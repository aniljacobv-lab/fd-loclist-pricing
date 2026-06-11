// centauriEmitter.ts — mirrors price-change lifecycle into Centauri.
//
// Centauri (by Proxima360) is the bi-temporal, causal event store that
// gives this app memory beyond promotion: every create / submit /
// approve / reject / promote becomes a permanent, causally-linked event.
// Oracle/staging stays the transactional system of record; Centauri is
// the system of explanation.
//
// Design rules:
//   1. FIRE-AND-FORGET. Centauri being down must never block or fail a
//      price-change operation. Errors are logged and swallowed.
//   2. ZERO changes to MemoryStore / OracleStore. This is a decorator
//      around the DataStore interface; only five methods are wrapped.
//   3. Disabled unless CENTAURI_URL is set (e.g. http://localhost:7771).
//
// Event model:
//   - Workflow events live on subject `pc:{pcId}`, facet `workflow`.
//     Centauri's supersession chain on that subject IS the status history.
//   - Promotion fans out INTENT events on `item:{sku}/store:{storeId}`,
//     facet `source`, causally TRIGGERED by the promotion event, carrying
//     RMS_PRICE_CHANGE linkage via source_ref. DISTRIBUTED/ACTIVATED
//     events arrive later from pipeline taps (sendnow / PDT confirms).
//   - Fan-outs larger than CENTAURI_MAX_FANOUT (default 5000 item-store
//     pairs) emit a single summary event instead, to keep the POC honest
//     about volume until batching lands in v0.2.

import type { DataStore } from './datastore.js';
import type { PriceChange, NewPriceChangeInput, Role } from '../types.js';

const CENTAURI_URL = process.env.CENTAURI_URL ?? '';
const MAX_FANOUT = Number(process.env.CENTAURI_MAX_FANOUT ?? 5000);

interface CentauriEvent {
  event_id?: string;
  subject: string;
  facet: string;
  type: 'INTENT' | 'DISTRIBUTED' | 'ACTIVATED' | 'OBSERVED' | 'CORRECTION';
  value: Record<string, unknown>;
  effective_time: number; // UnixMicro
  provenance: 'SYSTEM_FEED' | 'SCAN_VERIFIED' | 'HUMAN_ENTRY' | 'AI_INFERRED';
  confidence: number;
  source_system: string;
  source_ref?: string;
}

interface CentauriLink {
  from: string;
  to: string;
  type: 'TRIGGERED' | 'DISTRIBUTED_AS' | 'ACTIVATED_BY' | 'SUPERSEDES' | 'CORRECTS' | 'ENRICHED_FROM';
}

const micro = (iso?: string) => (iso ? Date.parse(iso) : Date.now()) * 1000;
const newId = () =>
  `${(Date.now() * 1000).toString(16).padStart(16, '0')}-${Math.random().toString(16).slice(2, 18)}`;

// pcId -> last workflow event id, so each transition links to its cause.
const lastWorkflowEvent = new Map<number, string>();

async function emit(events: CentauriEvent[], links: CentauriLink[] = []): Promise<void> {
  if (!CENTAURI_URL || events.length === 0) return;
  try {
    const res = await fetch(`${CENTAURI_URL}/v1/append`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events, links }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(`[centauri] append rejected: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.warn(`[centauri] emit failed (non-blocking): ${(err as Error).message}`);
  }
}

function workflowEvent(
  pc: PriceChange,
  stage: string,
  actor: string,
  extra: Record<string, unknown> = {},
): { ev: CentauriEvent; links: CentauriLink[] } {
  const ev: CentauriEvent = {
    event_id: newId(),
    subject: `pc:${pc.pcId}`,
    facet: 'workflow',
    type: 'INTENT',
    value: {
      stage,
      pc_name: pc.pcName,
      change_type: pc.changeType,
      amount: pc.amount,
      effective_date: pc.effectiveDate,
      sku_count: pc.resolvedSkus?.length ?? 0,
      store_count: pc.resolvedStoreIds?.length ?? 0,
      required_tier: pc.requiredTier,
      ...extra,
    },
    effective_time: micro(),
    provenance: 'HUMAN_ENTRY',
    confidence: 1.0,
    source_system: 'FD_LOCLIST_PRICING',
    source_ref: `pc:${pc.pcId}`,
  };
  const links: CentauriLink[] = [];
  const prev = lastWorkflowEvent.get(pc.pcId);
  if (prev) links.push({ from: prev, to: ev.event_id!, type: 'TRIGGERED' });
  lastWorkflowEvent.set(pc.pcId, ev.event_id!);
  return { ev, links };
}

function promotionFanout(pc: PriceChange, promoEventId: string): { events: CentauriEvent[]; links: CentauriLink[] } {
  const skus = pc.resolvedSkus ?? [];
  const stores = pc.resolvedStoreIds ?? [];
  const pairs = skus.length * stores.length;
  const events: CentauriEvent[] = [];
  const links: CentauriLink[] = [];

  if (pairs === 0 || pairs > MAX_FANOUT) {
    // Summary-only: keep the causal record without flooding the POC store.
    const ev: CentauriEvent = {
      event_id: newId(),
      subject: `pc:${pc.pcId}`,
      facet: 'source',
      type: 'DISTRIBUTED',
      value: {
        stage: 'PROMOTED_SUMMARY',
        sku_count: skus.length,
        store_count: stores.length,
        item_store_pairs: pairs,
        note: pairs > MAX_FANOUT ? `fan-out capped (> ${MAX_FANOUT}); per-store events deferred to batch import` : 'no resolved pairs',
      },
      effective_time: micro(pc.effectiveDate),
      provenance: 'SYSTEM_FEED',
      confidence: 1.0,
      source_system: 'FD_LOCLIST_PRICING',
      source_ref: `pc:${pc.pcId}`,
    };
    return { events: [ev], links: [{ from: promoEventId, to: ev.event_id!, type: 'TRIGGERED' }] };
  }

  for (const sku of skus) {
    for (const storeId of stores) {
      const ev: CentauriEvent = {
        event_id: newId(),
        subject: `item:${sku}/store:${storeId}`,
        facet: 'source',
        type: 'INTENT',
        value: {
          change_type: pc.changeType,
          amount: pc.amount,
          pc_id: pc.pcId,
          pc_name: pc.pcName,
          reason_code: pc.reasonCode,
        },
        effective_time: micro(pc.effectiveDate),
        provenance: 'SYSTEM_FEED',
        confidence: 1.0,
        source_system: 'FD_LOCLIST_PRICING',
        source_ref: `pc:${pc.pcId}`,
      };
      events.push(ev);
      links.push({ from: promoEventId, to: ev.event_id!, type: 'TRIGGERED' });
    }
  }
  return { events, links };
}

/**
 * Wraps a DataStore so price-change lifecycle transitions mirror into
 * Centauri. Returns the store unchanged if CENTAURI_URL is not set.
 */
export function wrapWithCentauri(ds: DataStore): DataStore {
  if (!CENTAURI_URL) return ds;
  console.log(`[centauri] emitter active -> ${CENTAURI_URL}`);

  return new Proxy(ds, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function') return orig;

      switch (prop) {
        case 'createPriceChange':
          return async (input: NewPriceChangeInput) => {
            const pc: PriceChange = await orig.call(target, input);
            const { ev, links } = workflowEvent(pc, 'CREATED', pc.createdBy);
            void emit([ev], links);
            return pc;
          };

        case 'submitForApproval':
          return async (pcId: number, actor: string, requiredTier: number) => {
            const pc: PriceChange | null = await orig.call(target, pcId, actor, requiredTier);
            if (pc) {
              const { ev, links } = workflowEvent(pc, 'SUBMITTED', actor, { actor });
              void emit([ev], links);
            }
            return pc;
          };

        case 'approvePc':
          return async (pcId: number, actor: string, role: Role, tier: number, comment: string | null) => {
            const pc: PriceChange | null = await orig.call(target, pcId, actor, role, tier, comment);
            if (pc) {
              const { ev, links } = workflowEvent(pc, 'APPROVED', actor, { actor, role, tier, comment });
              void emit([ev], links);
            }
            return pc;
          };

        case 'rejectPc':
          return async (pcId: number, actor: string, role: Role, comment: string | null) => {
            const pc: PriceChange | null = await orig.call(target, pcId, actor, role, comment);
            if (pc) {
              const { ev, links } = workflowEvent(pc, 'REJECTED', actor, { actor, role, comment });
              void emit([ev], links);
            }
            return pc;
          };

        case 'promotePriceChange':
          return async (pcId: number) => {
            const pc: PriceChange | null = await orig.call(target, pcId);
            if (pc) {
              const { ev, links } = workflowEvent(pc, 'PROMOTED', pc.createdBy);
              const fan = promotionFanout(pc, ev.event_id!);
              void emit([ev, ...fan.events], [...links, ...fan.links]);
            }
            return pc;
          };

        default:
          return orig.bind(target);
      }
    },
  });
}
