-- =============================================================================
-- Family Dollar Pricing Workbench — AUTHORITATIVE normalized schema
-- Target: Oracle Database 12c (12.1+).  Supersedes 001/003/004 (kept for history).
--
-- Conventions
--   * All app tables use a configurable prefix (default FDPM_) so they live
--     cleanly beside RMS without collision. The API reads the prefix from
--     ORACLE_APP_PREFIX (see api/src/config.ts -> oracle.appPrefix).
--     If you change the prefix, change it in both places.
--   * RMS tables (ITEM_MASTER, STORE, SUPS, ITEM_SUPPLIER, RPM_ZONE*, DEPS,
--     CLASS, SUBCLASS) are READ-ONLY references — never written here.
--   * Designed for FD volume: ~13k stores, ~38k zones, ~400k zone-store links,
--     and price changes that each resolve to up to (SKUs x stores) rows.
--     See docs/scalability.md for the volume + partitioning rationale.
-- =============================================================================

-- Substitution variable lets you re-prefix the whole script in SQL*Plus:
--   sqlplus> DEFINE P = FDPM_
DEFINE P = FDPM_

-- -----------------------------------------------------------------------------
-- Sequences
-- -----------------------------------------------------------------------------
CREATE SEQUENCE &P.SEQ_LOC_LIST          START WITH 1000 INCREMENT BY 1 CACHE 50;
CREATE SEQUENCE &P.SEQ_SKU_LIST          START WITH 2000 INCREMENT BY 1 CACHE 50;
CREATE SEQUENCE &P.SEQ_LOC_LIST_PC       START WITH 1000 INCREMENT BY 1 CACHE 50;
CREATE SEQUENCE &P.SEQ_CALENDAR_ACTIVITY START WITH 5000 INCREMENT BY 1 CACHE 50;

-- =============================================================================
-- REFERENCE / GROUPING ENTITIES
-- =============================================================================

-- Reusable basket of stores ("market", test panel, region, …)
CREATE TABLE &P.LOC_LIST (
  LOC_LIST_ID   NUMBER(10)    NOT NULL,
  LOC_LIST_NAME VARCHAR2(120) NOT NULL,
  DESCRIPTION   VARCHAR2(500),
  CREATED_BY    VARCHAR2(60)  NOT NULL,
  CREATED_AT    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT &P.PK_LOC_LIST PRIMARY KEY (LOC_LIST_ID),
  CONSTRAINT &P.UQ_LOC_LIST_NAME UNIQUE (LOC_LIST_NAME)
);

CREATE TABLE &P.LOC_LIST_STORE (
  LOC_LIST_ID NUMBER(10) NOT NULL,
  STORE_ID    NUMBER(10) NOT NULL,   -- FK-by-convention to RMS.STORE.STORE
  CONSTRAINT &P.PK_LOC_LIST_STORE PRIMARY KEY (LOC_LIST_ID, STORE_ID),
  CONSTRAINT &P.FK_LLS_LL FOREIGN KEY (LOC_LIST_ID) REFERENCES &P.LOC_LIST (LOC_LIST_ID) ON DELETE CASCADE
);
CREATE INDEX &P.IX_LLS_STORE ON &P.LOC_LIST_STORE (STORE_ID);

-- Reusable basket of SKUs
CREATE TABLE &P.SKU_LIST (
  SKU_LIST_ID   NUMBER(10)    NOT NULL,
  SKU_LIST_NAME VARCHAR2(120) NOT NULL,
  DESCRIPTION   VARCHAR2(500),
  CREATED_BY    VARCHAR2(60)  NOT NULL,
  CREATED_AT    TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT &P.PK_SKU_LIST PRIMARY KEY (SKU_LIST_ID),
  CONSTRAINT &P.UQ_SKU_LIST_NAME UNIQUE (SKU_LIST_NAME)
);
CREATE TABLE &P.SKU_LIST_ITEM (
  SKU_LIST_ID NUMBER(10) NOT NULL,
  SKU         NUMBER(10) NOT NULL,   -- FK-by-convention to RMS.ITEM_MASTER.ITEM
  CONSTRAINT &P.PK_SKU_LIST_ITEM PRIMARY KEY (SKU_LIST_ID, SKU),
  CONSTRAINT &P.FK_SLI_SL FOREIGN KEY (SKU_LIST_ID) REFERENCES &P.SKU_LIST (SKU_LIST_ID) ON DELETE CASCADE
);
CREATE INDEX &P.IX_SLI_SKU ON &P.SKU_LIST_ITEM (SKU);

-- =============================================================================
-- PRICE CHANGE (header + resolved snapshot)
--   The selector (single sku / sku list / hierarchy / price-point / vendor and
--   location list / zone / stores, with exclusions) is stored as JSON for
--   flexibility; the *resolved* SKUs and stores are snapshotted into child
--   tables so the set is immutable once authored and is cheap to promote/report.
-- =============================================================================
CREATE TABLE &P.LOC_LIST_PRICE_CHANGE (
  PC_ID             NUMBER(12)    NOT NULL,
  PC_NAME           VARCHAR2(120) NOT NULL,
  ITEM_SELECTOR     CLOB          NOT NULL,            -- JSON ItemSelector
  LOCATION_SELECTOR CLOB          NOT NULL,            -- JSON LocationSelector
  CHANGE_TYPE       VARCHAR2(30)  NOT NULL,            -- SET_PRICE | MARKDOWN_PCT | MARKDOWN_AMT
  AMOUNT            NUMBER(12,4)  NOT NULL,
  ROUNDING_RULE     VARCHAR2(30)  DEFAULT 'NONE' NOT NULL,
  ENDS_IN           NUMBER(5,2),
  MULTI_UNITS       NUMBER(4),
  MULTI_RETAIL      NUMBER(12,2),
  FUNDED_BY_VENDOR  CHAR(1)       DEFAULT 'N' NOT NULL,
  DEAL_ID           VARCHAR2(60),
  FUNDING_VENDOR_ID NUMBER(10),                        -- RMS.SUPS.SUPPLIER
  FUNDING_PCT       NUMBER(5,2),
  SEND_DATE         DATE          NOT NULL,
  EFFECTIVE_DATE    DATE          NOT NULL,
  REASON_CODE       NUMBER(4),
  STATUS            VARCHAR2(20)  DEFAULT 'WORKSHEET' NOT NULL,
  CREATED_BY        VARCHAR2(60)  NOT NULL,
  CREATED_AT        TIMESTAMP     DEFAULT SYSTIMESTAMP NOT NULL,
  PROMOTED_AT       TIMESTAMP,
  RMS_PRICE_CHANGE_ID NUMBER(12),
  CONSTRAINT &P.PK_LLPC PRIMARY KEY (PC_ID),
  CONSTRAINT &P.CK_LLPC_TYPE   CHECK (CHANGE_TYPE IN ('SET_PRICE','MARKDOWN_PCT','MARKDOWN_AMT')),
  CONSTRAINT &P.CK_LLPC_STATUS CHECK (STATUS IN ('WORKSHEET','SUBMITTED','APPROVED','REJECTED','PROMOTED','CANCELLED')),
  CONSTRAINT &P.CK_LLPC_FUNDED CHECK (FUNDED_BY_VENDOR IN ('Y','N')),
  CONSTRAINT &P.CK_LLPC_ISJSON_I CHECK (ITEM_SELECTOR IS JSON),
  CONSTRAINT &P.CK_LLPC_ISJSON_L CHECK (LOCATION_SELECTOR IS JSON)
);
CREATE INDEX &P.IX_LLPC_STATUS ON &P.LOC_LIST_PRICE_CHANGE (STATUS);
CREATE INDEX &P.IX_LLPC_EFF    ON &P.LOC_LIST_PRICE_CHANGE (EFFECTIVE_DATE);
CREATE INDEX &P.IX_LLPC_SEND   ON &P.LOC_LIST_PRICE_CHANGE (SEND_DATE);

-- Resolved snapshot — these are the high-volume children (PC x SKU, PC x STORE).
-- For FD volume consider RANGE-partitioning by PC_ID (or interval) so old price
-- changes can be archived/truncated by partition. See docs/scalability.md.
CREATE TABLE &P.LOC_LIST_PC_SKU (
  PC_ID NUMBER(12) NOT NULL,
  SKU   NUMBER(10) NOT NULL,
  CONSTRAINT &P.PK_LLPCSKU PRIMARY KEY (PC_ID, SKU),
  CONSTRAINT &P.FK_LLPCSKU FOREIGN KEY (PC_ID) REFERENCES &P.LOC_LIST_PRICE_CHANGE (PC_ID) ON DELETE CASCADE
);
CREATE INDEX &P.IX_LLPCSKU_SKU ON &P.LOC_LIST_PC_SKU (SKU);

CREATE TABLE &P.LOC_LIST_PC_STORE (
  PC_ID    NUMBER(12) NOT NULL,
  STORE_ID NUMBER(10) NOT NULL,
  CONSTRAINT &P.PK_LLPCSTORE PRIMARY KEY (PC_ID, STORE_ID),
  CONSTRAINT &P.FK_LLPCSTORE FOREIGN KEY (PC_ID) REFERENCES &P.LOC_LIST_PRICE_CHANGE (PC_ID) ON DELETE CASCADE
);
CREATE INDEX &P.IX_LLPCSTORE_STORE ON &P.LOC_LIST_PC_STORE (STORE_ID);

-- =============================================================================
-- ACTIVITY CALENDAR
-- =============================================================================
CREATE TABLE &P.CALENDAR_ACTIVITY (
  ACTIVITY_ID    NUMBER(12)    NOT NULL,
  TITLE          VARCHAR2(160) NOT NULL,
  ACTIVITY_TYPE  VARCHAR2(30)  NOT NULL,
  ACTIVITY_DATE  DATE          NOT NULL,
  SOURCE         VARCHAR2(10)  DEFAULT 'MANUAL' NOT NULL,  -- MANUAL | SEED | AI (AI refresh only replaces AI)
  ZONE_GROUP_ID  NUMBER(10),                -- null = global (all zones)
  ZONE_ID        NUMBER(10),
  LEAD_TIME_DAYS NUMBER(4),
  RELATED_PC_ID  NUMBER(12),
  NOTES          VARCHAR2(500),
  CONSTRAINT &P.PK_CAL PRIMARY KEY (ACTIVITY_ID),
  CONSTRAINT &P.CK_CAL_TYPE CHECK (ACTIVITY_TYPE IN ('SPARC_STRIP_CHANGE','PRICE_STRIP_PRINT','SEND','EFFECTIVE','BLACKOUT','CUSTOM')),
  CONSTRAINT &P.FK_CAL_PC FOREIGN KEY (RELATED_PC_ID) REFERENCES &P.LOC_LIST_PRICE_CHANGE (PC_ID) ON DELETE SET NULL
);
CREATE INDEX &P.IX_CAL_DATE ON &P.CALENDAR_ACTIVITY (ACTIVITY_DATE);
CREATE INDEX &P.IX_CAL_PC   ON &P.CALENDAR_ACTIVITY (RELATED_PC_ID);
CREATE INDEX &P.IX_CAL_ZONE ON &P.CALENDAR_ACTIVITY (ZONE_GROUP_ID, ZONE_ID);

-- =============================================================================
-- Optional: convenience view joining a PC to its expanded store x sku grid.
-- (Materialize per-promotion if you report over it heavily.)
-- =============================================================================
CREATE OR REPLACE VIEW &P.V_PC_GRID AS
SELECT pc.PC_ID, pc.PC_NAME, pc.STATUS, pc.EFFECTIVE_DATE, s.SKU, st.STORE_ID
FROM &P.LOC_LIST_PRICE_CHANGE pc
JOIN &P.LOC_LIST_PC_SKU   s  ON s.PC_ID = pc.PC_ID
JOIN &P.LOC_LIST_PC_STORE st ON st.PC_ID = pc.PC_ID;
