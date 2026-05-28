-- =============================================================================
-- Expansion: SKU lists, merch-hierarchy targeting, exclusions, send date,
-- rounding/price-ending, and the activity calendar.
-- Target: Oracle Database 12c (12.1+). Run AFTER 001_staging_schema.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SKU lists (reusable named baskets of SKUs) — analogous to LOC_LIST
-- ---------------------------------------------------------------------------
CREATE SEQUENCE SEQ_SKU_LIST START WITH 2000 INCREMENT BY 1 NOCACHE;

CREATE TABLE SKU_LIST (
  SKU_LIST_ID   NUMBER(10)     NOT NULL,
  SKU_LIST_NAME VARCHAR2(120)  NOT NULL,
  DESCRIPTION   VARCHAR2(500),
  CREATED_BY    VARCHAR2(60)   NOT NULL,
  CREATED_AT    TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT PK_SKU_LIST PRIMARY KEY (SKU_LIST_ID),
  CONSTRAINT UQ_SKU_LIST_NAME UNIQUE (SKU_LIST_NAME)
);

CREATE TABLE SKU_LIST_ITEM (
  SKU_LIST_ID NUMBER(10) NOT NULL,
  SKU         NUMBER(10) NOT NULL,
  CONSTRAINT PK_SKU_LIST_ITEM PRIMARY KEY (SKU_LIST_ID, SKU),
  CONSTRAINT FK_SLI_SL FOREIGN KEY (SKU_LIST_ID)
    REFERENCES SKU_LIST (SKU_LIST_ID) ON DELETE CASCADE
);
CREATE INDEX IX_SKU_LIST_ITEM_SKU ON SKU_LIST_ITEM (SKU);

-- ---------------------------------------------------------------------------
-- Price-change: new columns for the richer selector model.
--   The app stores the item/location selector as JSON (so any future selector
--   shape is captured) PLUS a resolved snapshot of SKUs and stores.
-- ---------------------------------------------------------------------------
ALTER TABLE LOC_LIST_PRICE_CHANGE ADD (
  ITEM_SELECTOR     CLOB,                         -- JSON ItemSelector
  LOCATION_SELECTOR CLOB,                         -- JSON LocationSelector
  ROUNDING_RULE     VARCHAR2(30) DEFAULT 'NONE',  -- NONE/ENDS_IN/PRICE_POINT/ROUND/...
  ENDS_IN           NUMBER(5,2),                  -- e.g. 0.99
  SEND_DATE         DATE                          -- extract/print date
);

-- Validate JSON if desired (12.1+ supports IS JSON check constraints):
ALTER TABLE LOC_LIST_PRICE_CHANGE ADD CONSTRAINT CK_LLPC_ISEL_JSON CHECK (ITEM_SELECTOR IS JSON);
ALTER TABLE LOC_LIST_PRICE_CHANGE ADD CONSTRAINT CK_LLPC_LSEL_JSON CHECK (LOCATION_SELECTOR IS JSON);

-- Resolved SKU snapshot for a price change (mirrors LOC_LIST_PC_STORE).
CREATE TABLE LOC_LIST_PC_SKU (
  PC_ID NUMBER(12) NOT NULL,
  SKU   NUMBER(10) NOT NULL,
  CONSTRAINT PK_LOC_LIST_PC_SKU PRIMARY KEY (PC_ID, SKU),
  CONSTRAINT FK_LLPCSKU_PC FOREIGN KEY (PC_ID)
    REFERENCES LOC_LIST_PRICE_CHANGE (PC_ID) ON DELETE CASCADE
);
CREATE INDEX IX_LOC_LIST_PC_SKU_SKU ON LOC_LIST_PC_SKU (SKU);

-- The SKU column on the original table is no longer the single source of truth;
-- it stays nullable for backward compatibility. New rows use LOC_LIST_PC_SKU.
-- (If SKU was NOT NULL in 001, relax it:)
-- ALTER TABLE LOC_LIST_PRICE_CHANGE MODIFY (SKU NULL);

-- ---------------------------------------------------------------------------
-- Activity calendar (SPARC strip changes, print lead times, send/effective
-- milestones, blackouts, custom).
-- ---------------------------------------------------------------------------
CREATE SEQUENCE SEQ_CALENDAR_ACTIVITY START WITH 5000 INCREMENT BY 1 NOCACHE;

CREATE TABLE CALENDAR_ACTIVITY (
  ACTIVITY_ID    NUMBER(12)    NOT NULL,
  TITLE          VARCHAR2(160) NOT NULL,
  ACTIVITY_TYPE  VARCHAR2(30)  NOT NULL,
  ACTIVITY_DATE  DATE          NOT NULL,
  LEAD_TIME_DAYS NUMBER(4),
  RELATED_PC_ID  NUMBER(12),
  NOTES          VARCHAR2(500),
  CONSTRAINT PK_CALENDAR_ACTIVITY PRIMARY KEY (ACTIVITY_ID),
  CONSTRAINT CK_CAL_TYPE CHECK (ACTIVITY_TYPE IN
    ('SPARC_STRIP_CHANGE','PRICE_STRIP_PRINT','SEND','EFFECTIVE','BLACKOUT','CUSTOM')),
  CONSTRAINT FK_CAL_PC FOREIGN KEY (RELATED_PC_ID)
    REFERENCES LOC_LIST_PRICE_CHANGE (PC_ID) ON DELETE SET NULL
);
CREATE INDEX IX_CAL_DATE ON CALENDAR_ACTIVITY (ACTIVITY_DATE);
CREATE INDEX IX_CAL_PC   ON CALENDAR_ACTIVITY (RELATED_PC_ID);

-- ---------------------------------------------------------------------------
-- Merch hierarchy is READ from RMS (DEPS / CLASS / SUBCLASS) — no new tables.
-- See api/src/store/oracleStore.ts listDepts/listClasses/listSubclasses.
-- ---------------------------------------------------------------------------
