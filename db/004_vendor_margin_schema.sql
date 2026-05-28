-- =============================================================================
-- Expansion 2: vendor-funded markdown, multi-unit pricing.
-- Target: Oracle 12c. Run AFTER 003_expansion_schema.sql.
-- (DSD vendor + cost/margin are READ from RMS: SUPS, ITEM_SUPPLIER, ITEM_MASTER,
--  RPM future/current retail — no new tables needed for those.)
-- =============================================================================

ALTER TABLE LOC_LIST_PRICE_CHANGE ADD (
  MULTI_UNITS       NUMBER(4),       -- e.g. 2  (2 for $3)
  MULTI_RETAIL      NUMBER(12,2),    -- e.g. 3.00
  FUNDED_BY_VENDOR  CHAR(1) DEFAULT 'N',  -- 'Y'/'N'
  DEAL_ID           VARCHAR2(60),    -- vendor deal / billback id
  FUNDING_VENDOR_ID NUMBER(10),      -- SUPS.SUPPLIER
  FUNDING_PCT       NUMBER(5,2)      -- % of the markdown the vendor funds
);

ALTER TABLE LOC_LIST_PRICE_CHANGE ADD CONSTRAINT CK_LLPC_FUNDED CHECK (FUNDED_BY_VENDOR IN ('Y','N'));

-- Reference notes (read-only from RMS):
--   Vendor / DSD:        SUPS.SUPPLIER, SUPS.SUP_NAME, ITEM_SUPPLIER.PRIMARY_SUPP_IND
--                        (RMS has no native DSD flag; FD typically uses a UDA or a
--                         custom SUPS column — map it in OracleStore.listVendors.)
--   Unit cost:           ITEM_SUPP_COUNTRY.UNIT_COST  (or ITEM_SUPPLIER)
--   Current retail:      RPM_FUTURE_RETAIL / ITEM_LOC current selling retail
--   Margin:              (newRetail - unitCost) / newRetail  — computed in app
