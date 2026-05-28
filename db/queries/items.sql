-- Item lookup against RMS ITEM_MASTER

SELECT
  im.ITEM                AS SKU,
  im.ITEM_DESC           AS DESCRIPTION,
  im.DEPT                AS DEPT_ID,
  im.CLASS               AS CLASS_ID,
  im.SUBCLASS            AS SUBCLASS_ID,
  im.STANDARD_UOM        AS UOM,
  im.ITEM_NUMBER_TYPE    AS NUMBER_TYPE,
  im.STATUS              AS STATUS
FROM RMS.ITEM_MASTER im
WHERE im.STATUS = 'A'
  AND ( :p_sku  IS NULL OR im.ITEM       = :p_sku )
  AND ( :p_desc IS NULL OR UPPER(im.ITEM_DESC) LIKE '%' || UPPER(:p_desc) || '%' )
ORDER BY im.ITEM
FETCH FIRST 200 ROWS ONLY;
