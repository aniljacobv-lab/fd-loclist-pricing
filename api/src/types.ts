// Shared domain types used across the API.

export interface Vendor {
  vendorId: number;
  vendorName: string;
  isDSD: boolean;        // Direct Store Delivery vendor
}

export interface Item {
  sku: number;
  description: string;
  deptId?: number | null;
  deptName?: string | null;
  classId?: number | null;
  className?: string | null;
  subclassId?: number | null;
  vendorId?: number | null;
  vendorName?: string | null;
  isDSD?: boolean;
  cost?: number | null;
  currentRetail?: number | null;
  priceSource?: 'ITEM_MASTER' | 'ESTIMATE' | 'WEB';
  promoPrice?: number | null;
  promoLabel?: string | null;
  promoMultiQty?: number | null;
  promoMultiPrice?: number | null;
}

export interface Store {
  storeId: number;
  name: string;
  districtId?: number | null;
  districtName?: string | null;
  regionId?: number | null;
  regionName?: string | null;
  formatId?: number | null;
  formatName?: string | null;
  state?: string | null;
  city?: string | null;
  storeClass?: string | null;
  velocity?: number | null;
}

export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number; }

export interface ZoneGroup { zoneGroupId: number; zoneGroupName: string; pricingLevel?: string; }
export interface Zone { zoneId: number; zoneGroupId: number; zoneName: string; storeCount: number; storeIds?: number[]; }

export interface Division { division: number; name: string; itemCount?: number; }
export interface Group { groupNo: number; name: string; division: number; itemCount?: number; }
export interface Dept { deptId: number; deptName: string; groupNo?: number | null; itemCount?: number; }
export interface MerchClass { deptId: number; classId: number; className: string; itemCount?: number; }
export interface Subclass { deptId: number; classId: number; subclassId: number; subclassName: string; itemCount?: number; }

export interface LocationList {
  locListId: number; locListName: string; description?: string | null;
  createdBy: string; createdAt: string; storeIds: number[];
}
export interface SkuList {
  skuListId: number; skuListName: string; description?: string | null;
  createdBy: string; createdAt: string; skus: number[];
}

export type ItemMode = 'ALL' | 'SINGLE_SKU' | 'SKU_LIST' | 'HIERARCHY' | 'PRICE_POINT' | 'VENDOR';

export interface ItemSelector {
  mode: ItemMode;
  sku?: number | null;
  skuListId?: number | null;
  skus?: number[];
  deptId?: number | null;
  deptIds?: number[];
  classId?: number | null;
  classIds?: number[];
  subclassId?: number | null;
  subclassIds?: number[];
  pricePointEndsIn?: number | null;
  pricePointEndsInList?: number[];
  vendorId?: number | null;
  vendorIds?: number[];
  exceptSkus?: number[];
}

export type LocationMode = 'LOCATION_LIST' | 'ZONE' | 'STORES';
export interface LocationSelector {
  mode: LocationMode;
  locListId?: number | null;
  locListIds?: number[];
  zoneGroupId?: number | null;
  zoneId?: number | null;
  zoneIds?: number[];
  storeIds?: number[];
  exceptStoreIds?: number[];
}

export type ChangeType = 'SET_PRICE' | 'MARKDOWN_PCT' | 'MARKDOWN_AMT' | 'ZONE_INHERIT';
export type RoundingRule =
  | 'NONE' | 'ENDS_IN' | 'PRICE_POINT' | 'ROUND' | 'CLEARANCE_ROUNDING_7S' | 'GOOD_ROUNDING_RULES';
export type PCStatus = 'WORKSHEET' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PROMOTED' | 'CANCELLED';

// Approvals (multi-tier, risk-routed)
export type Role = 'BUYER' | 'CATEGORY_MGR' | 'DIRECTOR' | 'VP';
export const ROLE_TIER: Record<Role, number> = { BUYER: 1, CATEGORY_MGR: 2, DIRECTOR: 3, VP: 4 };
export interface ApprovalEvent {
  actor: string;
  role: Role;
  tier: number;
  action: 'APPROVED' | 'REJECTED' | 'COMMENT';
  comment: string | null;
  at: string;
}

export interface PriceChange {
  pcId: number;
  pcName: string;
  itemSelector: ItemSelector;
  locationSelector: LocationSelector;
  resolvedSkus: number[];
  resolvedStoreIds: number[];
  changeType: ChangeType;
  amount: number;
  roundingRule: RoundingRule;
  endsIn: number | null;
  multiUnits: number | null;
  multiRetail: number | null;
  fundedByVendor: boolean;
  dealId: string | null;
  fundingVendorId: number | null;
  fundingPct: number | null;
  sendDate: string;
  effectiveDate: string;
  reasonCode: number | null;
  status: PCStatus;
  priceMap?: PriceMapEntry[] | null;
  rezone?: RezoneInfo | null;
  requiredTier: number;
  approvedTiers: number[];
  approvalLog: ApprovalEvent[];
  createdBy: string;
  createdAt: string;
}

export interface NewPriceChangeInput {
  pcName: string;
  itemSelector: ItemSelector;
  locationSelector: LocationSelector;
  changeType: ChangeType;
  amount: number;
  roundingRule?: RoundingRule;
  endsIn?: number | null;
  multiUnits?: number | null;
  multiRetail?: number | null;
  fundedByVendor?: boolean;
  dealId?: string | null;
  fundingVendorId?: number | null;
  fundingPct?: number | null;
  sendDate?: string | null;
  effectiveDate: string;
  reasonCode: number | null;
  priceMap?: PriceMapEntry[] | null;
  rezone?: RezoneInfo | null;
  createdBy: string;
}

// Rezone (store -> zone)
export interface PriceMapEntry { sku: number; newRetail: number; }
export interface RezoneInfo {
  fromZoneId?: number | null;
  toZoneGroupId: number;
  toZoneId: number;
}
export interface RezoneInput {
  toZoneGroupId: number;
  toZoneId: number;
  storeIds?: number[];
  locListId?: number | null;
  fromZoneId?: number | null;
  createdBy?: string;
}
export interface RezonePreviewLine { sku: number; description: string; currentRetail: number | null; newRetail: number; }
export interface RezonePreview {
  toZoneGroupId: number; toZoneId: number; toZoneName: string;
  movingStoreIds: number[]; movingStoreCount: number;
  repriceCount: number;
  sample: RezonePreviewLine[];
}

// Pricing preview
export interface PricePreviewRow {
  sku: number;
  description: string;
  cost: number | null;
  currentRetail: number | null;
  newRetail: number | null;
  marginPct: number | null;
  belowFloor: boolean;
}
export interface PricePreview {
  rows: PricePreviewRow[];
  count: number;
  minMarginPct: number | null;
  belowFloorCount: number;
  marginFloorPct: number;
}

// Execution jobs
export type JobType = 'RESOLVE' | 'PROMOTE';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
export interface PcJob {
  jobId: number; pcId: number; jobType: JobType; status: JobStatus;
  skuCount: number | null; storeCount: number | null; message: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}

// Calendar
export type ActivityType =
  | 'SPARC_STRIP_CHANGE' | 'PRICE_STRIP_PRINT' | 'SEND' | 'EFFECTIVE' | 'BLACKOUT' | 'CUSTOM';

export type ActivitySource = 'MANUAL' | 'SEED' | 'AI';
export interface CalendarActivity {
  activityId: number;
  title: string;
  type: ActivityType;
  date: string;
  source?: ActivitySource;
  zoneGroupId?: number | null;
  zoneId?: number | null;
  leadTimeDays?: number | null;
  relatedPcId?: number | null;
  notes?: string | null;
}
export interface NewCalendarActivity {
  title: string; type: ActivityType; date: string;
  source?: ActivitySource;
  zoneGroupId?: number | null; zoneId?: number | null;
  leadTimeDays?: number | null; relatedPcId?: number | null; notes?: string | null;
}

export interface CalendarScope { zoneGroupId?: number | null; zoneId?: number | null; }
