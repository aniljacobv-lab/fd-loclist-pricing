-- =============================================================================
-- 03_partitioning.sql — production physical design for the high-volume tables.
-- Apply these CREATE TABLEs INSTEAD of the plain ones in db/schema.sql for prod
-- (the plain versions are fine for dev / small installs). Run after 00_gtt.sql.
--
-- VOLUME MATH (worst case, theoretical ceiling)
--   SKUs ~ 400,000 ; stores ~ 10,000 -> a single chain-wide change = 4,000,000,000
--   item-locations. Across all live price changes the resolved + staged footprint
--   trends toward ~3B rows. Two design moves keep this manageable:
--     1. Composite partitioning  — RANGE/INTERVAL by PC_ID (lifecycle: archive or
--        DROP a completed change as one partition) with HASH subpartitions on the
--        reverse-lookup key (SKU / STORE_ID) for partition-wise parallel scans.
--     2. Compression + parallel  — these are append-mostly, read-for-reporting
--        tables; ROW STORE COMPRESS ADVANCED + PARALLEL cut IO and storage hard.
-- =============================================================================
DEFINE P = FDPM_

-- Resolved SKU snapshot: interval by PC_ID, 16 hash subpartitions on SKU.
CREATE TABLE &P.LOC_LIST_PC_SKU (
  PC_ID NUMBER(12) NOT NULL,
  SKU   NUMBER(10) NOT NULL,
  CONSTRAINT &P.PK_LLPCSKU PRIMARY KEY (PC_ID, SKU) USING INDEX LOCAL,
  CONSTRAINT &P.FK_LLPCSKU FOREIGN KEY (PC_ID) REFERENCES &P.LOC_LIST_PRICE_CHANGE (PC_ID) ON DELETE CASCADE
)
ROW STORE COMPRESS ADVANCED PARALLEL
PARTITION BY RANGE (PC_ID) INTERVAL (1000)
  SUBPARTITION BY HASH (SKU) SUBPARTITIONS 16
  ( PARTITION p0 VALUES LESS THAN (1000) );
CREATE INDEX &P.IX_LLPCSKU_SKU ON &P.LOC_LIST_PC_SKU (SKU) LOCAL PARALLEL;

-- Resolved store snapshot: interval by PC_ID, 16 hash subpartitions on STORE_ID.
CREATE TABLE &P.LOC_LIST_PC_STORE (
  PC_ID    NUMBER(12) NOT NULL,
  STORE_ID NUMBER(10) NOT NULL,
  CONSTRAINT &P.PK_LLPCSTORE PRIMARY KEY (PC_ID, STORE_ID) USING INDEX LOCAL,
  CONSTRAINT &P.FK_LLPCSTORE FOREIGN KEY (PC_ID) REFERENCES &P.LOC_LIST_PRICE_CHANGE (PC_ID) ON DELETE CASCADE
)
ROW STORE COMPRESS ADVANCED PARALLEL
PARTITION BY RANGE (PC_ID) INTERVAL (1000)
  SUBPARTITION BY HASH (STORE_ID) SUBPARTITIONS 16
  ( PARTITION p0 VALUES LESS THAN (1000) );
CREATE INDEX &P.IX_LLPCSTORE_STORE ON &P.LOC_LIST_PC_STORE (STORE_ID) LOCAL PARALLEL;

-- RMS hand-off staging (the only billions-scale table): interval by month on
-- EFFECTIVE_DATE so consumed events drop a partition at a time; hash subpartition
-- on STORE_ID for parallel consume + even spread.
CREATE TABLE &P.RMS_PRICE_EVENT_STG (
  PC_ID          NUMBER(12)   NOT NULL,
  SKU            NUMBER(10)   NOT NULL,
  STORE_ID       NUMBER(10)   NOT NULL,
  CHANGE_TYPE    VARCHAR2(30) NOT NULL,
  AMOUNT         NUMBER(12,4) NOT NULL,
  EFFECTIVE_DATE DATE         NOT NULL,
  SEND_DATE      DATE,
  STATUS         VARCHAR2(12) DEFAULT 'PENDING' NOT NULL,
  LOADED_AT      TIMESTAMP    DEFAULT SYSTIMESTAMP NOT NULL
)
ROW STORE COMPRESS ADVANCED PARALLEL
PARTITION BY RANGE (EFFECTIVE_DATE) INTERVAL (NUMTOYMINTERVAL(1,'MONTH'))
  SUBPARTITION BY HASH (STORE_ID) SUBPARTITIONS 32
  ( PARTITION p_seed VALUES LESS THAN (DATE '2024-01-01') );
CREATE INDEX &P.IX_RMS_STG_PC  ON &P.RMS_PRICE_EVENT_STG (PC_ID) LOCAL PARALLEL;
CREATE INDEX &P.IX_RMS_STG_EFF ON &P.RMS_PRICE_EVENT_STG (EFFECTIVE_DATE, STATUS) LOCAL PARALLEL;

-- -----------------------------------------------------------------------------
-- Operational notes
--   * Bulk DML: ALTER SESSION ENABLE PARALLEL DML; INSERT /*+ APPEND PARALLEL */.
--     PKG_FDPM_PRICING does this for resolve; promote parallelizes per chunk.
--   * Stats: rely on incremental partition stats
--       DBMS_STATS.SET_TABLE_PREFS(USER,'FDPM_LOC_LIST_PC_SKU','INCREMENTAL','TRUE');
--     so only changed partitions are re-gathered.
--   * Archival: completed changes can be dropped as a partition:
--       ALTER TABLE FDPM_LOC_LIST_PC_SKU DROP PARTITION FOR (<pc_id>) UPDATE INDEXES;
--   * Consumed staging months:
--       ALTER TABLE FDPM_RMS_PRICE_EVENT_STG DROP PARTITION FOR (DATE '<month>');
--   * TEMP sizing: GTT scratch is bounded (<= SKU set + store set per session).
--     Promote keeps undo/TEMP small via per-chunk commits (PROMOTE_CHUNK setting).
-- -----------------------------------------------------------------------------
