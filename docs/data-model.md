# Data model

## New tables (app-owned, in our schema)

### `LOC_LIST`
A saved, reusable basket of stores.

| Column        | Type           | Notes                                        |
|---------------|----------------|----------------------------------------------|
| LOC_LIST_ID   | NUMBER(10) PK  | seq `SEQ_LOC_LIST`                           |
| LOC_LIST_NAME | VARCHAR2(120)  | "FL Coastal Stores", "Closing Q3 Test Panel" |
| DESCRIPTION   | VARCHAR2(500)  |                                              |
| CREATED_BY    | VARCHAR2(60)   |                                              |
| CREATED_AT    | TIMESTAMP      | default SYSTIMESTAMP                         |

### `LOC_LIST_STORE`
Membership.

| Column      | Type        | Notes                |
|-------------|-------------|----------------------|
| LOC_LIST_ID | NUMBER(10)  | FK → LOC_LIST        |
| STORE_ID    | NUMBER(10)  | RMS `STORE.STORE`    |

PK: (LOC_LIST_ID, STORE_ID).

### `LOC_LIST_PRICE_CHANGE`
The price-change record. Mirrors RMS `RPM_PRICE_CHANGE` enough to be promoted.

| Column              | Type           | Notes                                                          |
|---------------------|----------------|----------------------------------------------------------------|
| PC_ID               | NUMBER(12) PK  | seq `SEQ_LOC_LIST_PC`                                          |
| PC_NAME             | VARCHAR2(120)  |                                                                |
| SKU                 | NUMBER(10)     | RMS `ITEM_MASTER.ITEM`                                         |
| LOC_LIST_ID         | NUMBER(10)     | nullable; null when target is an ad-hoc store set              |
| CHANGE_TYPE         | VARCHAR2(30)   | `SET_PRICE` \| `MARKDOWN_PCT` \| `MARKDOWN_AMT`                |
| AMOUNT              | NUMBER(12,4)   |                                                                |
| EFFECTIVE_DATE      | DATE           |                                                                |
| REASON_CODE         | NUMBER(4)      | RMS reason code (e.g. 9 = Slow Seller)                         |
| STATUS              | VARCHAR2(20)   | `WORKSHEET`\|`SUBMITTED`\|`APPROVED`\|`REJECTED`\|`PROMOTED`   |
| CREATED_BY          | VARCHAR2(60)   |                                                                |
| CREATED_AT          | TIMESTAMP      | default SYSTIMESTAMP                                           |
| PROMOTED_AT         | TIMESTAMP      | set when promoted into RMS                                     |
| RMS_PRICE_CHANGE_ID | NUMBER(12)     | the RMS PC id assigned at promotion                            |

### `LOC_LIST_PC_STORE`
Per-PC explicit store list (used when LOC_LIST_ID is null, OR to snapshot
membership at submission time).

| Column   | Type        | Notes                       |
|----------|-------------|-----------------------------|
| PC_ID    | NUMBER(12)  | FK → LOC_LIST_PRICE_CHANGE  |
| STORE_ID | NUMBER(10)  |                             |

PK: (PC_ID, STORE_ID).

## RMS reference tables we read

Read-only. The app does not modify these.

| Table                | Used for                                                        |
|----------------------|-----------------------------------------------------------------|
| `ITEM_MASTER`        | SKU lookup, item description, base retail                       |
| `STORE`              | Store id, name, district, region, format                        |
| `RPM_ZONE_GROUP`     | Pricing zone group (e.g. `3000 FD Basic Pricing`)               |
| `RPM_ZONE`           | Zones within a group                                            |
| `RPM_ZONE_LOCATION`  | Store ↔ Zone membership                                         |
| `REASON_CODE_HEAD`   | Price-change reason codes                                       |

Exact column names vary by RMS version; the OracleStore implementation uses
the standard 13.x/14.x names and is documented inline. Adjust as needed.

## Promotion to RMS (out of scope for POC, designed for)

A PL/SQL package `PKG_LOC_LIST_PC_PROMOTE` will:

1. Select `LOC_LIST_PRICE_CHANGE` rows in `STATUS='APPROVED'`.
2. For each, expand the target stores (from `LOC_LIST_STORE` and/or
   `LOC_LIST_PC_STORE`).
3. Call existing RMS PL/SQL (`RPM_PRICE_CHANGE_SQL.NEW_PRICE_CHANGE` or
   equivalent) to create the RMS-side price change at the **Store** pricing
   level for each store in the set.
4. Update our row: `STATUS='PROMOTED'`, `RMS_PRICE_CHANGE_ID=...`,
   `PROMOTED_AT=SYSTIMESTAMP`.

This package is the only place RMS write semantics live. The app stays clean.
