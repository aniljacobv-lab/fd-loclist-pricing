# Scalability & configuration

How the workbench is structured to handle Family Dollar volume, and where every
tunable lives (nothing business-related is hardcoded in source).

## Volume profile (from the real exports)

| Entity                | Count       | Notes                                            |
|-----------------------|-------------|--------------------------------------------------|
| Stores (open)         | ~8,800      | ~13,800 incl. closed                             |
| Zone groups           | 30          | FRITO LAY, Tobacco, Milk/Eggs, Apparel, …        |
| Zones                 | ~37,900     | Store-Pricing group alone has ~13,800            |
| Zone ↔ store links    | ~260k–400k  | every group maps every store                     |
| Resolved PC rows      | up to SKUs × stores per price change | the high-volume child tables |

## Configuration — no hardcoding

All tunables live in **`api/config/app.config.json`** and are overridable by
environment variables (loaded in `api/src/config.ts`).

| Concern                | Config path                         | Env override            |
|------------------------|-------------------------------------|-------------------------|
| Margin floor (%)       | `pricing.marginFloorPct`            | `MARGIN_FLOOR_PCT`      |
| Price-ending options   | `pricing.endsInOptions`             | —                       |
| Lead times (per type)  | `leadTimes.*`                       | —                       |
| Page sizes             | `pagination.defaultPageSize/maxPageSize` | `DEFAULT_PAGE_SIZE` / `MAX_PAGE_SIZE` |
| AI model / sample cap  | `ai.model`, `ai.groupSampleCap`     | `ANTHROPIC_MODEL` / `AI_GROUP_SAMPLE_CAP` |
| State → region map     | `regionByState`                     | —                       |
| Store format names     | `formatNames`                       | —                       |
| Market location lists  | `marketLists[]` (state/metro/class) | —                       |
| DB / port / keys       | —                                   | `.env` (`ORACLE_*`, `PORT`, `ANTHROPIC_API_KEY`, `DATA_DIR`, `ORACLE_APP_PREFIX`) |

Seed/reference data is externalized too: **`api/data/`** holds `vendors.json`,
`catalog.json`, and the real FD `stores.json` / `zoneGroups.json` / `zones.json`
/ `zoneStores.json`. Editing those changes the demo data with no code change.
The client reads display tunables from **`GET /config`**.

## API — built for volume

- **Server-side pagination + search** on the heavy lists: `GET /stores`,
  `GET /items`, `GET /zones?zoneGroupId=` all return
  `{ rows, total, page, pageSize }` and accept `?search=&page=&pageSize=`.
  The browser never pulls 8.8k stores or 38k zones at once.
- The **Oracle** adapter pushes pagination to SQL (`OFFSET … FETCH NEXT`) with a
  `COUNT(*)` for totals, and resolves zones/vendors by indexed key — it does not
  materialize whole tables in Node.
- **Selector resolution** (`/resolve/*`) returns id arrays; the resolved set is
  snapshotted into `LOC_LIST_PC_SKU` / `LOC_LIST_PC_STORE` at create time so the
  authored set is immutable and cheap to promote and report on.
- AI store-grouping samples at most `ai.groupSampleCap` stores so a request never
  blows the token budget regardless of selection size.

## Database — logical, normalized, indexed

See `db/schema.sql` (authoritative). Highlights:

- **Configurable prefix** (`FDPM_`, via `ORACLE_APP_PREFIX`) keeps app tables
  cleanly separated from RMS; RMS tables are read-only references.
- Normalized: reusable `LOC_LIST` / `SKU_LIST` with membership children;
  price-change **header** + **resolved-snapshot** children.
- Indexed for the real access paths: status, effective/send date, and the
  membership/snapshot foreign keys (store and sku reverse indexes).
- **Selector stored as JSON** (`IS JSON` check) for flexibility; resolved sets
  stored relationally for volume + reporting.

### Partitioning (for the high-volume children)

`LOC_LIST_PC_SKU` and `LOC_LIST_PC_STORE` grow as `Σ (SKUs × stores)` per price
change. At FD volume, RANGE/interval-partition them by `PC_ID` (or by
`EFFECTIVE_DATE` on the header) so completed/old price changes can be archived or
dropped by partition, and reporting prunes to recent partitions. Keep the local
indexes on `STORE_ID` / `SKU` for reverse lookups.

### Promotion to RMS (out of scope for POC, designed for)

A PL/SQL package reads `LOC_LIST_PRICE_CHANGE` rows in `STATUS='APPROVED'`,
expands the snapshot children, and calls the existing RMS RPM price-change APIs
per store — the single place RMS business rules apply. The app never writes RMS
tables directly.

## Front end

React + Vite + AG Grid. Heavy pickers (stores, zones) use debounced server
search against the paged endpoints rather than loading full datasets; the
exception checklist only renders for selections under a configurable threshold.

## Bulk processing at FD volume (GTT · parallel · chunked batches)

> Worst-case ceiling: ~400K SKUs × ~10K stores = **~4B item-locations** for a
> single chain-wide change; **~3B** resolved/staged rows live across the system.
> None of that volume ever transits the Node tier.

**Where the volume is handled — the database, set-based.** The Node API persists
only the JSON *selector*; `PKG_FDPM_PRICING` (see `db/packages/02_pkg_fdpm_pricing.sql`)
expands it inside Oracle.

1. **Resolve → Global Temporary Tables.** `FDPM_GTT_SKU` / `FDPM_GTT_STORE`
   (`db/packages/00_gtt.sql`, `ON COMMIT DELETE ROWS`) hold the working sets in
   **TEMP tablespace** — session-private, minimal redo. Multi-value predicate
   filters (deptIds/classIds/subclassIds/vendorIds/pricePointEndsInList) and
   exclusions are applied by anti-join, then the immutable snapshot is loaded
   **direct-path + parallel**: `INSERT /*+ APPEND PARALLEL(n) */`. TEMP per resolve
   is bounded by the SKU set (≤ ~400K) + store set (≤ ~10K) — a few MB.

2. **Promote → chunked batches.** The (SKU × STORE) cross product is produced in
   **`DBMS_PARALLEL_EXECUTE`** chunks (`CREATE_CHUNKS_BY_SQL` over NTILE'd SKU
   ranges, `PROMOTE_CHUNK` SKUs each). Every chunk is its own transaction, so
   **undo/TEMP stay bounded and the run is restartable** (`RESUME_TASK` retries
   failed chunks); chunks run concurrently at `parallel_level`. Bad item-locations
   are diverted with **`LOG ERRORS`** instead of failing the batch. Output streams
   to `FDPM_RMS_PRICE_EVENT_STG`, the single RMS hand-off seam.

3. **Async.** Large resolve/promote runs are submitted as `DBMS_SCHEDULER` jobs
   (`submit_async`) so they survive client timeouts; `FDPM_PC_JOB` tracks state and
   `FDPM_PROMOTE_CHUNK_LOG` records per-chunk outcomes.

**Physical design (`db/packages/03_partitioning.sql`).** Snapshot tables are
RANGE/INTERVAL-partitioned by `PC_ID` with **HASH subpartitions** on the reverse
key (SKU / STORE_ID) and `ROW STORE COMPRESS ADVANCED PARALLEL`; the staging table
is INTERVAL-partitioned by month on `EFFECTIVE_DATE`. Completed changes and
consumed months are archived by **dropping a partition**, and reporting prunes to
recent partitions. Stats use `INCREMENTAL` so only changed partitions re-gather.

**Tunables (no hardcoding).** `FDPM_SETTING` holds `PARALLEL_DEGREE`,
`PROMOTE_CHUNK`, and `COMMIT_BATCH`; the package reads them at run time with safe
defaults. App-tier tunables remain in `api/config/app.config.json`.

**Run order.** `schema.sql` → `00_gtt.sql` → `01_jobs.sql` → `02_pkg_fdpm_pricing.sql`,
applying `03_partitioning.sql` in place of the plain snapshot tables for production.
