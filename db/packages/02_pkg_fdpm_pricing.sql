-- =============================================================================
-- PKG_FDPM_PRICING — production set-based resolution, promotion, and async exec.
--
-- DESIGN PRINCIPLES (FD volume: ~400K SKUs x ~10K stores; ~3B item-locations live)
--   1. The app tier NEVER ships SKU/store id sets. The Node API persists only the
--      JSON *selector*; this package expands it with INSERT ... SELECT in Oracle.
--   2. Resolution stages its working sets in GLOBAL TEMPORARY TABLEs (TEMP space,
--      minimal redo, session-private), applies multi-value filters and exclusions
--      by anti-join, then DIRECT-PATH (/*+ APPEND PARALLEL */) loads the immutable
--      snapshot tables FDPM_LOC_LIST_PC_SKU / _PC_STORE.
--   3. Promotion produces the (SKU x STORE) cross product — up to billions of rows
--      for a chain-wide change — in CHUNKS via DBMS_PARALLEL_EXECUTE: each chunk is
--      its own transaction (bounded undo/TEMP), runs in parallel, is restartable,
--      and diverts bad rows with LOG ERRORS. The cross product is streamed to the
--      RMS hand-off staging table, never materialized in one statement and never
--      pulled into the app.
--   4. Tunables (parallel degree, chunk size, commit batch) live in FDPM_SETTING,
--      not in code.
--
-- Selector shape mirrors api/src/types.ts (ItemSelector / LocationSelector),
-- including the multi-value arrays (deptIds/classIds/subclassIds/vendorIds/
-- pricePointEndsInList, locListIds/zoneIds) with the singular fields honored too.
--
-- Prefix FDPM_ (ORACLE_APP_PREFIX). RMS read-only refs: ITEM_MASTER, ITEM_SUPPLIER,
-- RPM_ZONE_LOCATION, RPM_FUTURE_RETAIL — adjust the RMS. schema to your install.
-- =============================================================================

CREATE OR REPLACE PACKAGE PKG_FDPM_PRICING AS
  -- Expand the JSON selector for one price change into the snapshot tables.
  PROCEDURE resolve_price_change(p_pc_id IN NUMBER, p_sku_count OUT NUMBER, p_store_count OUT NUMBER);
  -- Promote an APPROVED price change: bulk-load the resolved grid into RMS staging.
  PROCEDURE promote_price_change(p_pc_id IN NUMBER);
  -- Run a queued job row (called inline or by the scheduler).
  PROCEDURE run_job(p_job_id IN NUMBER);
  -- Create a job row and schedule it in the background. Returns JOB_ID.
  FUNCTION submit_async(p_pc_id IN NUMBER, p_job_type IN VARCHAR2) RETURN NUMBER;
END PKG_FDPM_PRICING;
/

CREATE OR REPLACE PACKAGE BODY PKG_FDPM_PRICING AS

  -- ---- externalized settings (FDPM_SETTING), with safe defaults ----
  FUNCTION setting_num(p_key IN VARCHAR2, p_default IN NUMBER) RETURN NUMBER IS
    l_val VARCHAR2(200);
  BEGIN
    SELECT SETTING_VALUE INTO l_val FROM FDPM_SETTING WHERE SETTING_KEY = p_key;
    RETURN TO_NUMBER(l_val);
  EXCEPTION WHEN NO_DATA_FOUND THEN RETURN p_default;
  END setting_num;

  -- ===========================================================================
  -- RESOLVE — selector JSON -> GTT working sets -> direct-path snapshot load
  -- ===========================================================================
  PROCEDURE resolve_price_change(p_pc_id IN NUMBER, p_sku_count OUT NUMBER, p_store_count OUT NUMBER) IS
    l_isel CLOB; l_lsel CLOB;
    l_imode VARCHAR2(30); l_lmode VARCHAR2(30);
    l_dop  NUMBER := setting_num('PARALLEL_DEGREE', 8);
  BEGIN
    -- Direct-path + parallel DML for the snapshot loads below.
    EXECUTE IMMEDIATE 'ALTER SESSION ENABLE PARALLEL DML';

    SELECT ITEM_SELECTOR, LOCATION_SELECTOR INTO l_isel, l_lsel
      FROM FDPM_LOC_LIST_PRICE_CHANGE WHERE PC_ID = p_pc_id;
    l_imode := JSON_VALUE(l_isel, '$.mode');
    l_lmode := JSON_VALUE(l_lsel, '$.mode');

    -- idempotent re-resolve: clear prior snapshot + scratch (GTTs are empty per
    -- session, but DELETE defends against a re-run inside the same session/txn).
    DELETE FROM FDPM_LOC_LIST_PC_SKU   WHERE PC_ID = p_pc_id;
    DELETE FROM FDPM_LOC_LIST_PC_STORE WHERE PC_ID = p_pc_id;
    DELETE FROM FDPM_GTT_SKU;
    DELETE FROM FDPM_GTT_STORE;

    ------------------------------------------------------------------ ITEMS
    -- (a) base candidate set into GTT_SKU
    IF l_imode = 'SINGLE_SKU' THEN
      INSERT INTO FDPM_GTT_SKU (SKU)
      SELECT TO_NUMBER(JSON_VALUE(l_isel, '$.sku')) FROM dual
       WHERE JSON_VALUE(l_isel, '$.sku') IS NOT NULL;

    ELSIF l_imode = 'SKU_LIST' THEN
      IF JSON_VALUE(l_isel, '$.skuListId') IS NOT NULL THEN
        INSERT INTO FDPM_GTT_SKU (SKU)
        SELECT li.SKU FROM FDPM_SKU_LIST_ITEM li
         WHERE li.SKU_LIST_ID = TO_NUMBER(JSON_VALUE(l_isel, '$.skuListId'));
      ELSE
        INSERT INTO FDPM_GTT_SKU (SKU)
        SELECT DISTINCT jt.SKU FROM JSON_TABLE(l_isel, '$.skus[*]' COLUMNS (SKU NUMBER PATH '$')) jt;
      END IF;

    ELSE
      -- ALL / HIERARCHY / VENDOR / PRICE_POINT -> start from the whole active
      -- catalog; the predicate filters below narrow it (composable, ANDed).
      -- Conventional path (no APPEND/COMMIT): the GTT is ON COMMIT DELETE ROWS and
      -- must remain readable for the filters + snapshot load in THIS transaction.
      INSERT INTO FDPM_GTT_SKU (SKU)
      SELECT im.ITEM FROM RMS.ITEM_MASTER im WHERE im.STATUS = 'A';
    END IF;

    -- (b) predicate filters — OR within a filter (IN-list from singular ∪ array),
    --     AND across filters. Each keeps only matching SKUs (anti-join delete).
    IF JSON_VALUE(l_isel,'$.deptId') IS NOT NULL OR JSON_EXISTS(l_isel,'$.deptIds[0]') THEN
      DELETE FROM FDPM_GTT_SKU g WHERE NOT EXISTS (
        SELECT 1 FROM RMS.ITEM_MASTER im WHERE im.ITEM = g.SKU AND im.DEPT IN (
          SELECT TO_NUMBER(JSON_VALUE(l_isel,'$.deptId')) FROM dual WHERE JSON_VALUE(l_isel,'$.deptId') IS NOT NULL
          UNION ALL SELECT jt.V FROM JSON_TABLE(l_isel,'$.deptIds[*]' COLUMNS (V NUMBER PATH '$')) jt));
    END IF;
    IF JSON_VALUE(l_isel,'$.classId') IS NOT NULL OR JSON_EXISTS(l_isel,'$.classIds[0]') THEN
      DELETE FROM FDPM_GTT_SKU g WHERE NOT EXISTS (
        SELECT 1 FROM RMS.ITEM_MASTER im WHERE im.ITEM = g.SKU AND im.CLASS IN (
          SELECT TO_NUMBER(JSON_VALUE(l_isel,'$.classId')) FROM dual WHERE JSON_VALUE(l_isel,'$.classId') IS NOT NULL
          UNION ALL SELECT jt.V FROM JSON_TABLE(l_isel,'$.classIds[*]' COLUMNS (V NUMBER PATH '$')) jt));
    END IF;
    IF JSON_VALUE(l_isel,'$.subclassId') IS NOT NULL OR JSON_EXISTS(l_isel,'$.subclassIds[0]') THEN
      DELETE FROM FDPM_GTT_SKU g WHERE NOT EXISTS (
        SELECT 1 FROM RMS.ITEM_MASTER im WHERE im.ITEM = g.SKU AND im.SUBCLASS IN (
          SELECT TO_NUMBER(JSON_VALUE(l_isel,'$.subclassId')) FROM dual WHERE JSON_VALUE(l_isel,'$.subclassId') IS NOT NULL
          UNION ALL SELECT jt.V FROM JSON_TABLE(l_isel,'$.subclassIds[*]' COLUMNS (V NUMBER PATH '$')) jt));
    END IF;
    IF JSON_VALUE(l_isel,'$.vendorId') IS NOT NULL OR JSON_EXISTS(l_isel,'$.vendorIds[0]') THEN
      DELETE FROM FDPM_GTT_SKU g WHERE NOT EXISTS (
        SELECT 1 FROM RMS.ITEM_SUPPLIER isup WHERE isup.ITEM = g.SKU AND isup.SUPPLIER IN (
          SELECT TO_NUMBER(JSON_VALUE(l_isel,'$.vendorId')) FROM dual WHERE JSON_VALUE(l_isel,'$.vendorId') IS NOT NULL
          UNION ALL SELECT jt.V FROM JSON_TABLE(l_isel,'$.vendorIds[*]' COLUMNS (V NUMBER PATH '$')) jt));
    END IF;
    IF JSON_VALUE(l_isel,'$.pricePointEndsIn') IS NOT NULL OR JSON_EXISTS(l_isel,'$.pricePointEndsInList[0]') THEN
      DELETE FROM FDPM_GTT_SKU g WHERE NOT EXISTS (
        SELECT 1 FROM RMS.RPM_FUTURE_RETAIL fr WHERE fr.ITEM = g.SKU
           AND MOD(ROUND(fr.SELLING_RETAIL * 100), 100) IN (
             SELECT ROUND(TO_NUMBER(JSON_VALUE(l_isel,'$.pricePointEndsIn')) * 100) FROM dual WHERE JSON_VALUE(l_isel,'$.pricePointEndsIn') IS NOT NULL
             UNION ALL SELECT ROUND(jt.V * 100) FROM JSON_TABLE(l_isel,'$.pricePointEndsInList[*]' COLUMNS (V NUMBER PATH '$')) jt));
    END IF;

    -- (c) item exclusions
    DELETE FROM FDPM_GTT_SKU g
     WHERE g.SKU IN (SELECT jt.SKU FROM JSON_TABLE(l_isel, '$.exceptSkus[*]' COLUMNS (SKU NUMBER PATH '$')) jt);

    ------------------------------------------------------------------ STORES
    IF l_lmode = 'LOCATION_LIST' THEN
      INSERT INTO FDPM_GTT_STORE (STORE_ID)
      SELECT DISTINCT ls.STORE_ID FROM FDPM_LOC_LIST_STORE ls
       WHERE ls.LOC_LIST_ID IN (
         SELECT TO_NUMBER(JSON_VALUE(l_lsel,'$.locListId')) FROM dual WHERE JSON_VALUE(l_lsel,'$.locListId') IS NOT NULL
         UNION ALL SELECT jt.V FROM JSON_TABLE(l_lsel,'$.locListIds[*]' COLUMNS (V NUMBER PATH '$')) jt);

    ELSIF l_lmode = 'ZONE' THEN
      INSERT INTO FDPM_GTT_STORE (STORE_ID)
      SELECT DISTINCT zl.LOCATION FROM RMS.RPM_ZONE_LOCATION zl
       WHERE zl.ZONE_ID IN (
         SELECT TO_NUMBER(JSON_VALUE(l_lsel,'$.zoneId')) FROM dual WHERE JSON_VALUE(l_lsel,'$.zoneId') IS NOT NULL
         UNION ALL SELECT jt.V FROM JSON_TABLE(l_lsel,'$.zoneIds[*]' COLUMNS (V NUMBER PATH '$')) jt);

    ELSIF l_lmode = 'STORES' THEN
      INSERT INTO FDPM_GTT_STORE (STORE_ID)
      SELECT DISTINCT jt.STORE_ID FROM JSON_TABLE(l_lsel, '$.storeIds[*]' COLUMNS (STORE_ID NUMBER PATH '$')) jt;
    END IF;

    -- store exclusions
    DELETE FROM FDPM_GTT_STORE g
     WHERE g.STORE_ID IN (SELECT jt.STORE_ID FROM JSON_TABLE(l_lsel, '$.exceptStoreIds[*]' COLUMNS (STORE_ID NUMBER PATH '$')) jt);

    ------------------------------------------------------------------ COUNTS
    -- Count from the GTTs BEFORE the direct-path load (a direct-path inserted
    -- segment cannot be read again in the same transaction — ORA-12838).
    SELECT COUNT(*) INTO p_sku_count   FROM FDPM_GTT_SKU;
    SELECT COUNT(*) INTO p_store_count FROM FDPM_GTT_STORE;

    ------------------------------------------------------------------ SNAPSHOT
    -- Direct-path, parallel load of the immutable resolved sets (degree from FDPM_SETTING).
    EXECUTE IMMEDIATE
      'INSERT /*+ APPEND PARALLEL(' || l_dop || ') */ INTO FDPM_LOC_LIST_PC_SKU (PC_ID, SKU) ' ||
      'SELECT ' || p_pc_id || ', SKU FROM FDPM_GTT_SKU';
    EXECUTE IMMEDIATE
      'INSERT /*+ APPEND PARALLEL(' || l_dop || ') */ INTO FDPM_LOC_LIST_PC_STORE (PC_ID, STORE_ID) ' ||
      'SELECT ' || p_pc_id || ', STORE_ID FROM FDPM_GTT_STORE';

    COMMIT;  -- also clears the ON COMMIT DELETE ROWS GTTs
  END resolve_price_change;

  -- ===========================================================================
  -- PROMOTE — chunked, parallel, restartable bulk hand-off to RMS staging.
  -- ===========================================================================
  PROCEDURE promote_price_change(p_pc_id IN NUMBER) IS
    l_status     VARCHAR2(20);
    l_sku_count  NUMBER;
    l_dop        NUMBER := setting_num('PARALLEL_DEGREE', 8);
    l_chunk      NUMBER := setting_num('PROMOTE_CHUNK', 5000);
    l_nchunks    NUMBER;
    l_task       VARCHAR2(128) := 'FDPM_PROMOTE_' || p_pc_id;
    l_chunk_sql  CLOB;
    l_run_sql    CLOB;
    l_try        PLS_INTEGER := 0;
    l_status_code NUMBER;
  BEGIN
    SELECT STATUS INTO l_status FROM FDPM_LOC_LIST_PRICE_CHANGE WHERE PC_ID = p_pc_id FOR UPDATE;
    IF l_status <> 'APPROVED' THEN
      RAISE_APPLICATION_ERROR(-20001, 'Price change ' || p_pc_id || ' is not APPROVED (status=' || l_status || ')');
    END IF;

    SELECT COUNT(*) INTO l_sku_count FROM FDPM_LOC_LIST_PC_SKU WHERE PC_ID = p_pc_id;
    l_nchunks := GREATEST(1, CEIL(l_sku_count / l_chunk));

    -- Drop a stale task of the same name (e.g. a prior failed run), then recreate.
    BEGIN DBMS_PARALLEL_EXECUTE.DROP_TASK(l_task); EXCEPTION WHEN OTHERS THEN NULL; END;
    DBMS_PARALLEL_EXECUTE.CREATE_TASK(l_task);

    -- Chunk by SKU ranges for THIS price change (NTILE buckets -> [start,end] SKU).
    -- Each chunk therefore covers (chunk's SKUs) x (all stores for the PC).
    l_chunk_sql :=
      'SELECT MIN(SKU) start_id, MAX(SKU) end_id FROM (' ||
      '  SELECT SKU, NTILE(' || l_nchunks || ') OVER (ORDER BY SKU) g ' ||
      '  FROM FDPM_LOC_LIST_PC_SKU WHERE PC_ID = ' || p_pc_id || ') GROUP BY g';
    DBMS_PARALLEL_EXECUTE.CREATE_CHUNKS_BY_SQL(task_name => l_task, sql_stmt => l_chunk_sql, by_rowid => FALSE);

    -- Per-chunk DML: produce the (SKU x STORE) cross product for the chunk's SKU
    -- range and load it into the RMS staging buffer. :start_id/:end_id are bound
    -- by the framework; the (validated NUMBER) PC id is inlined. LOG ERRORS keeps
    -- one bad item-location from failing an entire chunk. Each chunk commits in
    -- its own transaction, so undo/TEMP stay bounded and the run is restartable.
    l_run_sql :=
      'INSERT INTO FDPM_RMS_PRICE_EVENT_STG (PC_ID, SKU, STORE_ID, CHANGE_TYPE, AMOUNT, EFFECTIVE_DATE, SEND_DATE) ' ||
      'SELECT ' || p_pc_id || ', s.SKU, st.STORE_ID, pc.CHANGE_TYPE, pc.AMOUNT, pc.EFFECTIVE_DATE, pc.SEND_DATE ' ||
      'FROM FDPM_LOC_LIST_PRICE_CHANGE pc ' ||
      'JOIN FDPM_LOC_LIST_PC_SKU   s  ON s.PC_ID  = pc.PC_ID ' ||
      'JOIN FDPM_LOC_LIST_PC_STORE st ON st.PC_ID = pc.PC_ID ' ||
      'WHERE pc.PC_ID = ' || p_pc_id || ' AND s.SKU BETWEEN :start_id AND :end_id ' ||
      'LOG ERRORS INTO FDPM_ERR_RMS_PRICE_EVENT (''promote ' || p_pc_id || ''') REJECT LIMIT UNLIMITED';

    -- Run chunks concurrently. parallel_level = inter-chunk parallelism; combine
    -- with PARALLEL hint inside the SQL for intra-chunk parallelism if desired.
    DBMS_PARALLEL_EXECUTE.RUN_TASK(task_name => l_task, sql_stmt => l_run_sql,
      language_flag => DBMS_SQL.NATIVE, parallel_level => l_dop);

    -- Auto-retry any failed chunks a couple of times before giving up.
    l_status_code := DBMS_PARALLEL_EXECUTE.TASK_STATUS(l_task);
    WHILE l_status_code = DBMS_PARALLEL_EXECUTE.FINISHED_WITH_ERROR AND l_try < 2 LOOP
      l_try := l_try + 1;
      DBMS_PARALLEL_EXECUTE.RESUME_TASK(l_task);
      l_status_code := DBMS_PARALLEL_EXECUTE.TASK_STATUS(l_task);
    END LOOP;

    -- Audit the chunk outcomes for observability.
    INSERT INTO FDPM_PROMOTE_CHUNK_LOG (PC_ID, TASK_NAME, CHUNK_ID, STATUS, STARTED_AT, FINISHED_AT)
    SELECT p_pc_id, TASK_NAME, CHUNK_ID, STATUS, START_TS, END_TS
      FROM USER_PARALLEL_EXECUTE_CHUNKS WHERE TASK_NAME = l_task;

    IF l_status_code <> DBMS_PARALLEL_EXECUTE.FINISHED THEN
      RAISE_APPLICATION_ERROR(-20002, 'Promote ' || p_pc_id || ' finished with chunk errors; see FDPM_PROMOTE_CHUNK_LOG / FDPM_ERR_RMS_PRICE_EVENT.');
    END IF;
    DBMS_PARALLEL_EXECUTE.DROP_TASK(l_task);

    -- Hand-off complete -> the RMS RPM price-event batch consumes
    -- FDPM_RMS_PRICE_EVENT_STG (WHERE STATUS='PENDING') and flips rows to SENT.
    -- That batch is the single place RMS price-change business rules apply.
    UPDATE FDPM_LOC_LIST_PRICE_CHANGE SET STATUS = 'PROMOTED', PROMOTED_AT = SYSTIMESTAMP WHERE PC_ID = p_pc_id;
    COMMIT;
  END promote_price_change;

  PROCEDURE run_job(p_job_id IN NUMBER) IS
    l_pc_id NUMBER; l_type VARCHAR2(20); l_sku NUMBER; l_store NUMBER;
  BEGIN
    UPDATE FDPM_PC_JOB SET STATUS='RUNNING', STARTED_AT=SYSTIMESTAMP WHERE JOB_ID=p_job_id
      RETURNING PC_ID, JOB_TYPE INTO l_pc_id, l_type;
    COMMIT;
    IF l_type = 'RESOLVE' THEN
      resolve_price_change(l_pc_id, l_sku, l_store);
      UPDATE FDPM_PC_JOB SET STATUS='DONE', SKU_COUNT=l_sku, STORE_COUNT=l_store, FINISHED_AT=SYSTIMESTAMP WHERE JOB_ID=p_job_id;
    ELSIF l_type = 'PROMOTE' THEN
      promote_price_change(l_pc_id);
      UPDATE FDPM_PC_JOB SET STATUS='DONE', FINISHED_AT=SYSTIMESTAMP WHERE JOB_ID=p_job_id;
    END IF;
    COMMIT;
  EXCEPTION WHEN OTHERS THEN
    UPDATE FDPM_PC_JOB SET STATUS='FAILED', MESSAGE=SUBSTR(SQLERRM,1,2000), FINISHED_AT=SYSTIMESTAMP WHERE JOB_ID=p_job_id;
    COMMIT;
  END run_job;

  FUNCTION submit_async(p_pc_id IN NUMBER, p_job_type IN VARCHAR2) RETURN NUMBER IS
    l_job_id NUMBER;
  BEGIN
    l_job_id := FDPM_SEQ_PC_JOB.NEXTVAL;
    INSERT INTO FDPM_PC_JOB (JOB_ID, PC_ID, JOB_TYPE, STATUS) VALUES (l_job_id, p_pc_id, p_job_type, 'QUEUED');
    COMMIT;
    -- Fire-and-forget. DBMS_SCHEDULER scales better than the app tier for long,
    -- parallelizable DML and survives client timeouts; run_job updates job state.
    DBMS_SCHEDULER.CREATE_JOB(
      job_name   => 'FDPM_JOB_' || l_job_id,
      job_type   => 'PLSQL_BLOCK',
      job_action => 'BEGIN PKG_FDPM_PRICING.run_job(' || l_job_id || '); END;',
      enabled    => TRUE, auto_drop => TRUE);
    RETURN l_job_id;
  END submit_async;

END PKG_FDPM_PRICING;
/
