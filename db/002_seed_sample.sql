-- =============================================================================
-- Sample data for the staging tables (POC / dev use only).
-- Safe to run after 001_staging_schema.sql.
-- =============================================================================

-- A few saved location lists
INSERT INTO LOC_LIST (LOC_LIST_ID, LOC_LIST_NAME, DESCRIPTION, CREATED_BY)
  VALUES (SEQ_LOC_LIST.NEXTVAL, 'FL Coastal Stores',     'Florida coastal stores for hurricane/seasonal markdowns', 'aniljacobv@gmail.com');
INSERT INTO LOC_LIST (LOC_LIST_ID, LOC_LIST_NAME, DESCRIPTION, CREATED_BY)
  VALUES (SEQ_LOC_LIST.NEXTVAL, 'Closing Q3 Test Panel', '47 stores in the Q3 closing test panel',                  'aniljacobv@gmail.com');
INSERT INTO LOC_LIST (LOC_LIST_ID, LOC_LIST_NAME, DESCRIPTION, CREATED_BY)
  VALUES (SEQ_LOC_LIST.NEXTVAL, 'Urban High-Velocity',   'Top 200 urban-format stores by velocity',                  'aniljacobv@gmail.com');

COMMIT;

-- Membership for "FL Coastal Stores" (example store ids)
INSERT INTO LOC_LIST_STORE (LOC_LIST_ID, STORE_ID)
SELECT LOC_LIST_ID, COLUMN_VALUE
FROM   LOC_LIST,
       TABLE(SYS.ODCINUMBERLIST(101,102,103,104,105,106,107,108))
WHERE  LOC_LIST_NAME = 'FL Coastal Stores';

INSERT INTO LOC_LIST_STORE (LOC_LIST_ID, STORE_ID)
SELECT LOC_LIST_ID, COLUMN_VALUE
FROM   LOC_LIST,
       TABLE(SYS.ODCINUMBERLIST(201,202,203,204,205,206,207,208,209,210))
WHERE  LOC_LIST_NAME = 'Closing Q3 Test Panel';

COMMIT;

-- Sample worksheet price change targeting "FL Coastal Stores"
INSERT INTO LOC_LIST_PRICE_CHANGE
  (PC_ID, PC_NAME, SKU, LOC_LIST_ID, CHANGE_TYPE, AMOUNT, EFFECTIVE_DATE, REASON_CODE, CREATED_BY)
SELECT
  SEQ_LOC_LIST_PC.NEXTVAL,
  'Citronella Torch — FL coastal markdown',
  3499080,
  LOC_LIST_ID,
  'MARKDOWN_PCT',
  20.0,
  TRUNC(SYSDATE) + 7,
  9,
  'aniljacobv@gmail.com'
FROM LOC_LIST WHERE LOC_LIST_NAME = 'FL Coastal Stores';

COMMIT;
