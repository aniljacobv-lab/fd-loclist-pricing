-- =============================================================================
-- Family Dollar Location-List Price Change — staging schema
-- Target: Oracle Database 12c (12.1+)
-- Run as the application schema (NOT inside RMS_OWNER).
-- =============================================================================

-- Drop in reverse-dependency order if re-running. Comment out the first time.
-- BEGIN EXECUTE IMMEDIATE 'DROP TABLE LOC_LIST_PC_STORE      CASCADE CONSTRAINTS PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;
-- /
-- BEGIN EXECUTE IMMEDIATE 'DROP TABLE LOC_LIST_PRICE_CHANGE  CASCADE CONSTRAINTS PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;
-- /
-- BEGIN EXECUTE IMMEDIATE 'DROP TABLE LOC_LIST_STORE         CASCADE CONSTRAINTS PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;
-- /
-- BEGIN EXECUTE IMMEDIATE 'DROP TABLE LOC_LIST               CASCADE CONSTRAINTS PURGE'; EXCEPTION WHEN OTHERS THEN NULL; END;
-- /
-- BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE SEQ_LOC_LIST';     EXCEPTION WHEN OTHERS THEN NULL; END;
-- /
-- BEGIN EXECUTE IMMEDIATE 'DROP SEQUENCE SEQ_LOC_LIST_PC';  EXCEPTION WHEN OTHERS THEN NULL; END;
-- /

-- -----------------------------------------------------------------------------
-- Sequences
-- -----------------------------------------------------------------------------
CREATE SEQUENCE SEQ_LOC_LIST    START WITH 1000 INCREMENT BY 1 NOCACHE;
CREATE SEQUENCE SEQ_LOC_LIST_PC START WITH 1000 INCREMENT BY 1 NOCACHE;

-- -----------------------------------------------------------------------------
-- LOC_LIST — a saved, reusable basket of stores
-- -----------------------------------------------------------------------------
CREATE TABLE LOC_LIST (
  LOC_LIST_ID    NUMBER(10)      NOT NULL,
  LOC_LIST_NAME  VARCHAR2(120)   NOT NULL,
  DESCRIPTION    VARCHAR2(500),
  CREATED_BY     VARCHAR2(60)    NOT NULL,
  CREATED_AT     TIMESTAMP       DEFAULT SYSTIMESTAMP NOT NULL,
  CONSTRAINT PK_LOC_LIST PRIMARY KEY (LOC_LIST_ID),
  CONSTRAINT UQ_LOC_LIST_NAME UNIQUE (LOC_LIST_NAME)
);

COMMENT ON TABLE  LOC_LIST                  IS 'Saved, reusable basket of stores. Targeted by a location-list-level price change.';
COMMENT ON COLUMN LOC_LIST.LOC_LIST_NAME    IS 'Human-readable label, e.g. "FL Coastal Stores"';

-- -----------------------------------------------------------------------------
-- LOC_LIST_STORE — membership
-- -----------------------------------------------------------------------------
CREATE TABLE LOC_LIST_STORE (
  LOC_LIST_ID  NUMBER(10)  NOT NULL,
  STORE_ID     NUMBER(10)  NOT NULL,
  CONSTRAINT PK_LOC_LIST_STORE PRIMARY KEY (LOC_LIST_ID, STORE_ID),
  CONSTRAINT FK_LLS_LL FOREIGN KEY (LOC_LIST_ID)
    REFERENCES LOC_LIST (LOC_LIST_ID) ON DELETE CASCADE
);

CREATE INDEX IX_LOC_LIST_STORE_STORE ON LOC_LIST_STORE (STORE_ID);

-- -----------------------------------------------------------------------------
-- LOC_LIST_PRICE_CHANGE — the price-change record, pre-promotion to RMS
-- -----------------------------------------------------------------------------
CREATE TABLE LOC_LIST_PRICE_CHANGE (
  PC_ID                NUMBER(12)     NOT NULL,
  PC_NAME              VARCHAR2(120)  NOT NULL,
  SKU                  NUMBER(10)     NOT NULL,
  LOC_LIST_ID          NUMBER(10),
  CHANGE_TYPE          VARCHAR2(30)   NOT NULL,
  AMOUNT               NUMBER(12,4)   NOT NULL,
  EFFECTIVE_DATE       DATE           NOT NULL,
  REASON_CODE          NUMBER(4),
  STATUS               VARCHAR2(20)   DEFAULT 'WORKSHEET' NOT NULL,
  CREATED_BY           VARCHAR2(60)   NOT NULL,
  CREATED_AT           TIMESTAMP      DEFAULT SYSTIMESTAMP NOT NULL,
  PROMOTED_AT          TIMESTAMP,
  RMS_PRICE_CHANGE_ID  NUMBER(12),
  CONSTRAINT PK_LOC_LIST_PC PRIMARY KEY (PC_ID),
  CONSTRAINT FK_LLPC_LL FOREIGN KEY (LOC_LIST_ID)
    REFERENCES LOC_LIST (LOC_LIST_ID),
  CONSTRAINT CK_LLPC_TYPE CHECK (CHANGE_TYPE IN ('SET_PRICE','MARKDOWN_PCT','MARKDOWN_AMT')),
  CONSTRAINT CK_LLPC_STATUS CHECK (STATUS IN ('WORKSHEET','SUBMITTED','APPROVED','REJECTED','PROMOTED','CANCELLED'))
);

CREATE INDEX IX_LLPC_STATUS         ON LOC_LIST_PRICE_CHANGE (STATUS);
CREATE INDEX IX_LLPC_EFFECTIVE_DATE ON LOC_LIST_PRICE_CHANGE (EFFECTIVE_DATE);
CREATE INDEX IX_LLPC_SKU            ON LOC_LIST_PRICE_CHANGE (SKU);

-- -----------------------------------------------------------------------------
-- LOC_LIST_PC_STORE — explicit per-PC store snapshot
--   Used when:
--     (a) LOC_LIST_ID is NULL  (ad-hoc store set, not a saved list)
--     (b) we want to snapshot list membership at submission time so later
--         membership edits don't change the in-flight price change.
-- -----------------------------------------------------------------------------
CREATE TABLE LOC_LIST_PC_STORE (
  PC_ID     NUMBER(12)  NOT NULL,
  STORE_ID  NUMBER(10)  NOT NULL,
  CONSTRAINT PK_LOC_LIST_PC_STORE PRIMARY KEY (PC_ID, STORE_ID),
  CONSTRAINT FK_LLPCS_PC FOREIGN KEY (PC_ID)
    REFERENCES LOC_LIST_PRICE_CHANGE (PC_ID) ON DELETE CASCADE
);

CREATE INDEX IX_LOC_LIST_PC_STORE_STORE ON LOC_LIST_PC_STORE (STORE_ID);

-- -----------------------------------------------------------------------------
-- Convenience view: a price change with its expanded store set
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW V_LOC_LIST_PC_EXPANDED AS
SELECT
  pc.PC_ID,
  pc.PC_NAME,
  pc.SKU,
  pc.CHANGE_TYPE,
  pc.AMOUNT,
  pc.EFFECTIVE_DATE,
  pc.REASON_CODE,
  pc.STATUS,
  pc.CREATED_BY,
  pc.CREATED_AT,
  COALESCE(s_explicit.STORE_ID, s_list.STORE_ID) AS STORE_ID
FROM LOC_LIST_PRICE_CHANGE pc
LEFT JOIN LOC_LIST_PC_STORE s_explicit
  ON s_explicit.PC_ID = pc.PC_ID
LEFT JOIN LOC_LIST_STORE s_list
  ON s_list.LOC_LIST_ID = pc.LOC_LIST_ID
WHERE COALESCE(s_explicit.STORE_ID, s_list.STORE_ID) IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Done.
-- -----------------------------------------------------------------------------
