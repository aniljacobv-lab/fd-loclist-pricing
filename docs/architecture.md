# Architecture

## Goal

Give Family Dollar pricing analysts the ability to author a price change at
the **store / location-list** level (currently RMS only supports the zone
level), without modifying RMS itself.

## High-level shape

```
┌────────────────────────┐
│  React + Vite + AGGrid │  Pricing analyst UI
│  /web                  │
└────────────┬───────────┘
             │ HTTPS (JSON)
             ▼
┌────────────────────────┐    ┌──────────────────────┐
│  Node.js + Fastify     │───▶│  Anthropic Claude    │
│  /api                  │    │  store grouping,     │
│                        │    │  price suggest,      │
│  DataStore interface   │    │  NL → price-change   │
│   ├─ MemoryStore (POC) │    └──────────────────────┘
│   └─ OracleStore       │
└────────────┬───────────┘
             │ node-oracledb (Thin mode, no Instant Client)
             ▼
┌──────────────────────────────────────────────────────┐
│ Oracle 12c on-prem                                   │
│                                                      │
│  RMS schema (read-only):                             │
│    ITEM_MASTER, STORE, RPM_ZONE,                     │
│    RPM_ZONE_LOCATION, REASON_CODE_HEAD               │
│                                                      │
│  App schema (read/write — NEW):                      │
│    LOC_LIST, LOC_LIST_STORE,                         │
│    LOC_LIST_PRICE_CHANGE, LOC_LIST_PC_STORE          │
└────────────┬─────────────────────────────────────────┘
             │ (later) PL/SQL promotion job
             ▼
       RMS RPM_PRICE_CHANGE tables
```

## Why this shape

**1. Staging tables, not direct RMS writes.**
The RMS RPM tables have a lot of business rules: conflict checks, calc-impact,
GMM/SVP/Final approval gates, X-label flags, vendor-funded markdown joins.
Replicating those in our app on day one is a tar pit. Instead the app owns its
own tables; an integration job (a PL/SQL package, a RIB subscriber, or even a
nightly batch) is the single place where RMS business rules apply. That job
can be built incrementally — start with manual promotion, then automate.

**2. DataStore interface with two impls.**
The whole API is built against a `DataStore` interface
(`api/src/store/datastore.ts`). `MemoryStore` is for the POC and for local
dev outside the corporate network; `OracleStore` is the real one. Switching is
`DATASTORE=oracle` in `.env`. This means UX work can proceed even when nobody
on the team has a tunnel to the on-prem DB.

**3. React + AG Grid for the UI.**
The RMS screens (see `docs/screens-from-rms.md`) are dense data grids — zones
× SKUs with editable Type / Amount / Adjust / Multi-Unit / Multi-Retail cells.
AG Grid Community (MIT) handles this out of the box. Trying to do it in
Streamlit or Retool means fighting the grid for the rest of the project.

**4. node-oracledb in Thin mode.**
As of node-oracledb 6+, Thin mode is the default. No Oracle Instant Client
install on the server. Works against Oracle 12c (12.1+) — verified in the
node-oracledb release notes. Drops the ops cost significantly.

**5. Anthropic Claude for the AI features.**
Three v1 use cases the user picked:

| Feature                | Endpoint               | Pattern                                                                                              |
|------------------------|------------------------|------------------------------------------------------------------------------------------------------|
| Smart store grouping   | `POST /ai/group-stores`| Given a list of stores with attrs (region, climate, format, velocity), Claude returns N clusters     |
| Price recommendation   | `POST /ai/suggest-price`| Given an item (cost, current retail, sell-through, slow-seller flag), Claude returns a markdown plan |
| Natural-language entry | `POST /ai/parse-intent`| "Mark down citronella torches 20% at FL coastal stores" → structured `{sku, type, amount, store_ids}` |

Each endpoint is a thin wrapper over the Anthropic Messages API, with the
schema enforced by JSON parsing on the server. The AI never writes to the DB
directly — it only proposes; the user must hit Submit.

## Security / deployment notes

- The app sits **inside** Family Dollar's network (same VLAN as the Oracle
  host or reachable via a service account). No public exposure.
- Auth in v1: header-based `X-User` set by the corporate SSO proxy (Okta,
  Ping, whatever fronts internal apps). The POC reads it directly.
- Secrets: `.env` for dev, corporate secret manager (HashiCorp Vault / AWS
  Secrets Manager / Oracle Wallet) for prod.
- Anthropic calls **must** be reviewed for data sensitivity. The POC sends
  store IDs, item IDs, sell-through numbers — no PII. Document this for
  security review.

## What ships next (after POC)

1. PL/SQL promotion package: reads `LOC_LIST_PRICE_CHANGE` rows in
   `status='APPROVED'`, inserts into `RPM_PRICE_CHANGE` / `RPM_FUTURE_RETAIL`,
   updates status to `'PROMOTED'`.
2. Approval routing UI — GMM / SVP / Final, matching the existing RMS
   Options menu.
3. Conflict detection against existing zone-level changes.
4. Audit log table + diff view.
5. Real SSO integration.
