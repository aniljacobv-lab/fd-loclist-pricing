# Centauri integration — fd-loclist-pricing

Mirrors the price-change lifecycle (create / submit / approve / reject /
promote) into Centauri as bi-temporal, causally-linked events. Oracle/staging
remains the transactional system of record; Centauri is the system of
explanation — who caused what, when, and what happened downstream.

## Files
- `api/src/store/centauriEmitter.ts`  (new) — fire-and-forget DataStore decorator
- `api/src/store/index.ts`            (modified) — one-line wrap in the factory
- `api/.env.example`                  (modified) — documents CENTAURI_URL

## Install
1. Copy the two files into the repo at the same paths (index.ts replaces yours —
   the only change is the wrapWithCentauri import + wrap).
2. Add to `api/.env`:
       CENTAURI_URL=http://localhost:7771
3. Run Centauri:   centauri.exe serve -data fdlp.log
4. Run the API:    npm run dev
   You should see:  [centauri] emitter active -> http://localhost:7771

## What lands in Centauri
- subject `pc:{id}`, facet `workflow`: CREATED → SUBMITTED → APPROVED(actor,
  role, tier, comment) → PROMOTED, each TRIGGERED by its predecessor,
  provenance HUMAN_ENTRY.
- On promote: one INTENT per `item:{sku}/store:{id}` (facet `source`),
  TRIGGERED by the promotion. Fan-outs > CENTAURI_MAX_FANOUT emit a summary
  event instead (per-store batching arrives with Centauri v0.2).

## Proof queries (verified end-to-end)
    curl 'localhost:7771/v1/history?subject=pc:1002'
    curl 'localhost:7771/v1/trace?event_id=<store intent id>&direction=cause'
Trace result from the live test:
    PRICE_INTENT item:108007/store:1
      <- PROMOTED  pc:1002
      <- APPROVED  pc:1002  actor=jeff (tier 1)
      <- SUBMITTED pc:1002  actor=anil
      <- CREATED   pc:1002
Every store's price, walked back to the human who approved it.

## Guarantees
- Centauri down / unset URL: app behaves exactly as before. Emits are
  non-blocking with a 3s timeout; failures log a warning and are swallowed.
- Zero changes to MemoryStore, OracleStore, routes, or the promote path.
