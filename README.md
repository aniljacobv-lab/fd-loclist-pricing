# Family Dollar — Location-List Price Change (POC)

Adds **store / location-list level** pricing to the existing Oracle Retek RMS
workflow, which today only supports **zone-level** price changes.

## Why

In RMS today (see `docs/screens-from-rms.md`), a price change is bound to a
Pricing Zone Group (e.g. `3000 FD Basic Pricing`). The user can pick zones, but
not arbitrary baskets of stores. Penny-mark and clearance events often need to
target a specific list of stores (a region, a closing-store group, a test
panel) — not a whole zone.

This POC adds that level **without modifying RMS code or tables**. The app
writes to its own staging tables; an integration batch later promotes approved
entries into RMS RPM price-change tables.

## What's in this repo

```
fd-loclist-pricing/
├── README.md                  this file
├── docs/
│   ├── architecture.md        system overview, integration pattern
│   ├── data-model.md          staging tables + RMS reference tables used
│   └── screens-from-rms.md    notes from the source RMS screenshots
├── db/
│   ├── 001_staging_schema.sql Oracle 12c DDL for new tables
│   ├── 002_seed_sample.sql    sample stores, items, location lists
│   └── queries/               read-only SQL against RMS reference tables
├── api/                       Node.js + Fastify + node-oracledb
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/
│   │   ├── store/             DataStore interface + Memory + Oracle impls
│   │   └── ai/                Anthropic client wrappers
│   └── package.json
└── web/                       React + Vite + AG Grid + Tailwind
    ├── src/
    │   ├── App.tsx
    │   ├── pages/
    │   └── components/
    └── package.json
```

## Quick start (mock mode — no Oracle needed)

```bash
# API
cd api
cp .env.example .env          # set ANTHROPIC_API_KEY; leave DATASTORE=memory
npm install
npm run dev                   # http://localhost:3001

# Web (new shell)
cd web
npm install
npm run dev                   # http://localhost:5173
```

Open http://localhost:5173 — you'll see a working price-change editor with
sample items / stores / zones.

## Running against Oracle 12c

1. Apply `db/001_staging_schema.sql` to your RMS schema (or a side schema).
2. In `api/.env`, set:
   ```
   DATASTORE=oracle
   ORACLE_USER=...
   ORACLE_PASSWORD=...
   ORACLE_CONNECT_STRING=host:1521/SERVICE_NAME
   ```
3. `node-oracledb` runs in **Thin mode** by default — no Oracle Instant Client
   install needed. Works against 12c (12.1+).
4. Restart the API; same routes, real data.

## What's intentionally NOT in v1

- No write-back into RMS price-change tables. The staging tables are the
  contract; an integration job (RIB / staged batch / custom PL/SQL) promotes
  approved rows. Keeps us out of RMS validation hell on day one.
- No approval workflow UI — `status` field is there, button wires it, but
  GMM/SVP approval routing is out of scope.
- No SSO. The "created_by" field reads from a header for the POC.

## Stack rationale

See `docs/architecture.md`. Short version:

- **React + Vite + AG Grid** for the editor — the RMS screens are grid-heavy
  (multi-zone, multi-row, Excel-style); AG Grid community handles that out of
  the box.
- **Node.js + Fastify + node-oracledb** for the API — single language with the
  frontend, official Oracle driver, thin-mode means no Instant Client.
- **Anthropic Claude** for the three AI features (smart store grouping, price
  suggestion, NL entry).
