-- Read-only RMS reference queries used by the API's OracleStore.
-- Adjust schema prefix (RMS.) and column names to match the local install.

-- All stores with district / region / format
SELECT
  s.STORE                AS STORE_ID,
  s.STORE_NAME           AS NAME,
  s.DISTRICT             AS DISTRICT_ID,
  d.DISTRICT_NAME        AS DISTRICT_NAME,
  s.REGION               AS REGION_ID,
  r.REGION_NAME          AS REGION_NAME,
  s.STORE_FORMAT         AS FORMAT_ID,
  sf.STORE_FORMAT_NAME   AS FORMAT_NAME,
  s.STATE                AS STATE,
  s.STORE_CLOSE_DATE     AS CLOSE_DATE
FROM RMS.STORE s
LEFT JOIN RMS.DISTRICT d         ON d.DISTRICT       = s.DISTRICT
LEFT JOIN RMS.REGION   r         ON r.REGION         = s.REGION
LEFT JOIN RMS.STORE_FORMAT sf    ON sf.STORE_FORMAT  = s.STORE_FORMAT
WHERE s.STORE_CLOSE_DATE IS NULL
   OR s.STORE_CLOSE_DATE > SYSDATE
ORDER BY s.STORE;
