-- =============================================================================
-- 00_gtt.sql — Bulk-processing scaffolding for FD volume.
--
-- Run order:  schema.sql  ->  00_gtt.sql  ->  01_jobs.sql  ->  02_pkg_fdpm_pricing.sql
-- (For production also apply 03_partitioning.sql in place of the plain snapshot
--  tables in schema.sql.)
--
-- WHY THIS FILE EXISTS
--   A single large price change can resolve to up to (SKUs x stores) item-locations.
--   At Family Dollar volume that is bounded by ~400K SKUs x ~10K stores, and across
--   all live price changes the system can hold on the order of ~3 billion
--   item-location rows. None of that volume is ever shipped through the Node tier:
--     * resolution is set-based INSERT ... SELECT inside Oracle;
--     * the SKU x STORE cross product handed to RMS is produced HERE, in chunks;
--     * intermediate working sets live in GLOBAL TEMPORARY TABLEs (TEMP tablespace),
--       which are session-private and generate minimal redo.
--
-- All identifiers use the configurable FDPM_ prefix (see ORACLE_APP_PREFIX).
-- =============================================================================
DEFINE P = FDPM_

-- -----------------------------------------------------------------------------
-- Externalized tuning (no hardcoded business constants in PL/SQL).
-- PKG_FDPM_PRICING reads these at run time; rows are optional (code has defaults).
--   PARALLEL_DEGREE  — DOP for direct-path INSERT/cross-product DML
--   PROMOTE_CHUNK    — # of SKUs per DBMS_PARALLEL_EXECUTE chunk on promote
--   COMMIT_BATCH     — row-batch size for any unavoidable bulk-bind loops
-- -----------------------------------------------------------------------------
CREATE TABLE &P.SETTING (
  SETTING_KEY   VARCHAR2(40)  NOT NULL,
  SETTING_VALUE VARCHAR2(200) NOT NULL,
  CONSTRAINT &P.PK_SETTING PRIMARY KEY (SETTING_KEY)
);
INSERT INTO &P.SETTING (SETTING_KEY, SETTING_VALUE) VALUES ('PARALLEL_DEGREE', '8');
INSERT INTO &P.SETTING (SETTING_KEY, SETTING_VALUE) VALUES ('PROMOTE_CHUNK',   '5000');
INSERT INTO &P.SETTING (SETTING_KEY, SETTING_VALUE) VALUES ('COMMIT_BATCH',    '50000');
COMMIT;

-- -----------------------------------------------------------------------------
-- Global temporary tables — per-session scratch used while resolving a price
-- change. ON COMMIT DELETE ROWS auto-clears them at the resolve transaction's
-- COMMIT, so concurrent resolutions in different sessions never see each other's
-- rows and nothing persists in TEMP after the call.
--
-- Sizing: TEMP usage per session is bounded by the larger of the SKU set
-- (<= ~400K rows) and the store set (<= ~10K rows) — a few MB. The big volume
-- (the cross product) is NEVER staged here; it streams to RMS in chunks.
-- -----------------------------------------------------------------------------
CREATE GLOBAL TEMPORARY TABLE &P.GTT_SKU (
  SKU NUMBER(10) NOT NULL
) ON COMMIT DELETE ROWS;

CREATE GLOBAL TEMPORARY TABLE &P.GTT_STORE (
  STORE_ID NUMBER(10) NOT NULL
) ON COMMIT DELETE ROWS;

-- Optional unique indexes help the anti-join (exclusions) and guarantee de-dup.
CREATE UNIQUE INDEX &P.UX_GTT_SKU   ON &P.GTT_SKU   (SKU);
CREATE UNIQUE INDEX &P.UX_GTT_STORE ON &P.GTT_STORE (STORE_ID);

-- -----------------------------------------------------------------------------
-- RMS hand-off staging — the bounded buffer that the existing RMS RPM price-event
-- batch consumes. promote_price_change() bulk-loads the resolved cross product
-- here (direct-path, parallel, chunked) instead of writing RMS tables directly.
-- This is the single integration seam with RMS.
--
-- Partition by EFFECTIVE_DATE so consumed/old events drop a partition at a time;
-- see 03_partitioning.sql for the production (sub)partitioned definition.
-- -----------------------------------------------------------------------------
CREATE TABLE &P.RMS_PRICE_EVENT_STG (
  PC_ID          NUMBER(12)   NOT NULL,
  SKU            NUMBER(10)   NOT NULL,
  STORE_ID       NUMBER(10)   NOT NULL,
  CHANGE_TYPE    VARCHAR2(30) NOT NULL,
  AMOUNT         NUMBER(12,4) NOT NULL,
  EFFECTIVE_DATE DATE         NOT NULL,
  SEND_DATE      DATE,
  STATUS         VARCHAR2(12) DEFAULT 'PENDING' NOT NULL,   -- PENDING | SENT
  LOADED_AT      TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL
);
CREATE INDEX &P.IX_RMS_STG_PC  ON &P.RMS_PRICE_EVENT_STG (PC_ID);
CREATE INDEX &P.IX_RMS_STG_EFF ON &P.RMS_PRICE_EVENT_STG (EFFECTIVE_DATE);

-- DML error-logging sink for the bulk cross-product insert. Rows that violate a
-- constraint (e.g. an item-location RMS won't accept) are diverted here instead
-- of failing the whole batch. Created via the supplied package.
BEGIN
  DBMS_ERRLOG.CREATE_ERROR_LOG(dml_table_name => 'FDPM_RMS_PRICE_EVENT_STG',
                               err_log_table_name => 'FDPM_ERR_RMS_PRICE_EVENT');
END;
/

-- Per-chunk audit of a promote run (observability + restartability). Mirrors the
-- chunk rows DBMS_PARALLEL_EXECUTE tracks in USER_PARALLEL_EXECUTE_CHUNKS.
CREATE TABLE &P.PROMOTE_CHUNK_LOG (
  PC_ID       NUMBER(12)   NOT NULL,
  TASK_NAME   VARCHAR2(128) NOT NULL,
  CHUNK_ID    NUMBER       NOT NULL,
  ROWS_LOADED NUMBER,
  STATUS      VARCHAR2(20),
  STARTED_AT  TIMESTAMP,
  FINISHED_AT TIMESTAMP,
  MESSAGE     VARCHAR2(2000),
  CONSTRAINT &P.PK_PROMOTE_CHUNK PRIMARY KEY (TASK_NAME, CHUNK_ID)
);
CREATE INDEX &P.IX_PROMOTE_CHUNK_PC ON &P.PROMOTE_CHUNK_LOG (PC_ID);
