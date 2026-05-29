// Thin fetch wrapper. Talks to the /api/* proxy defined in vite.config.ts.

export interface Item {
  sku: number; description: string;
  deptId?: number | null; deptName?: string | null; classId?: number | null; className?: string | null; subclassId?: number | null;
  vendorId?: number | null; vendorName?: string | null; isDSD?: boolean; cost?: number | null; currentRetail?: number | null;
  priceSource?: 'ITEM_MASTER' | 'ESTIMATE' | 'WEB';
  promoPrice?: number | null; promoLabel?: string | null; promoMultiQty?: number | null; promoMultiPrice?: number | null;
}
export interface Store {
  storeId: number; name: string; regionId?: number | null; regionName?: string | null;
  formatId?: number | null; formatName?: string | null; state?: string | null; city?: string | null; storeClass?: string | null; velocity?: number | null;
}
export interface Zone { zoneId: number; zoneGroupId: number; zoneName: string; storeCount: number; storeIds?: number[]; }
export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number; }
export interface AppClientConfig { pricing: { marginFloorPct: number; defaultRoundingRule: string; endsInOptions: number[]; pricePointOptions: number[] }; pagination: { defaultPageSize: number; maxPageSize: number }; leadTimes: Record<string, number>; }
export interface ZoneGroup { zoneGroupId: number; zoneGroupName: string; pricingLevel?: string; }
export interface Vendor { vendorId: number; vendorName: string; isDSD: boolean; }
export interface Division { division: number; name: string; itemCount?: number }
export interface Group { groupNo: number; name: string; division: number; itemCount?: number }
export interface Dept { deptId: number; deptName: string; groupNo?: number | null; itemCount?: number }
export interface MerchClass { deptId: number; classId: number; className: string; itemCount?: number }
export interface Subclass { deptId: number; classId: number; subclassId: number; subclassName: string; itemCount?: number }
export interface LocationList { locListId: number; locListName: string; description?: string | null; storeIds: number[]; createdBy: string; createdAt: string; }
export interface SkuList { skuListId: number; skuListName: string; description?: string | null; skus: number[]; createdBy: string; createdAt: string; }

export type ItemMode = 'ALL' | 'SINGLE_SKU' | 'SKU_LIST' | 'HIERARCHY' | 'PRICE_POINT' | 'VENDOR';
export interface ItemSelector {
  mode: ItemMode;
  sku?: number | null; skuListId?: number | null; skus?: number[];
  deptId?: number | null; deptIds?: number[];
  classId?: number | null; classIds?: number[];
  subclassId?: number | null; subclassIds?: number[];
  pricePointEndsIn?: number | null; pricePointEndsInList?: number[];
  vendorId?: number | null; vendorIds?: number[];
  exceptSkus?: number[];
}
export type LocationMode = 'LOCATION_LIST' | 'ZONE' | 'STORES';
export interface LocationSelector {
  mode: LocationMode;
  locListId?: number | null; locListIds?: number[];
  zoneGroupId?: number | null; zoneId?: number | null; zoneIds?: number[];
  storeIds?: number[]; exceptStoreIds?: number[];
}

export type ChangeType = 'SET_PRICE' | 'MARKDOWN_PCT' | 'MARKDOWN_AMT' | 'ZONE_INHERIT';
export type RoundingRule = 'NONE' | 'ENDS_IN' | 'PRICE_POINT' | 'ROUND' | 'CLEARANCE_ROUNDING_7S' | 'GOOD_ROUNDING_RULES';
export type PCStatus = 'WORKSHEET' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PROMOTED' | 'CANCELLED';

export interface PriceChange {
  pcId: number; pcName: string;
  itemSelector: ItemSelector; locationSelector: LocationSelector;
  resolvedSkus: number[]; resolvedStoreIds: number[];
  changeType: ChangeType; amount: number; roundingRule: RoundingRule; endsIn: number | null;
  multiUnits: number | null; multiRetail: number | null;
  fundedByVendor: boolean; dealId: string | null; fundingVendorId: number | null; fundingPct: number | null;
  sendDate: string; effectiveDate: string; reasonCode: number | null;
  status: PCStatus; createdBy: string; createdAt: string;
  requiredTier: number; approvedTiers: number[]; approvalLog: ApprovalEvent[];
}

export interface PricePreviewRow { sku: number; description: string; cost: number | null; currentRetail: number | null; newRetail: number | null; marginPct: number | null; belowFloor: boolean; }
export interface PricePreview { rows: PricePreviewRow[]; count: number; minMarginPct: number | null; belowFloorCount: number; marginFloorPct: number; }

export type ActivityType = 'SPARC_STRIP_CHANGE' | 'PRICE_STRIP_PRINT' | 'SEND' | 'EFFECTIVE' | 'BLACKOUT' | 'CUSTOM';
export type ActivitySource = 'MANUAL' | 'SEED' | 'AI';
export interface CalendarActivity { activityId: number; title: string; type: ActivityType; date: string; source?: ActivitySource; zoneGroupId?: number | null; zoneId?: number | null; leadTimeDays?: number | null; relatedPcId?: number | null; notes?: string | null; }

export type JobType = 'RESOLVE' | 'PROMOTE';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED';
export interface PcJob { jobId: number; pcId: number; jobType: JobType; status: JobStatus; skuCount: number | null; storeCount: number | null; message: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; }

export interface FiscalWeek { period: number; periodName: string; quarter: number; week: number; yearWeek: number; startDate: string; endDate: string; }
export interface FiscalPeriod { period: number; name: string; quarter: number; startDate: string; endDate: string; weeks: FiscalWeek[]; }
export interface FiscalCalendar { fiscalYear: number; startDate: string; pattern: number[]; periods: FiscalPeriod[]; holidays: { date: string; name: string }[]; }

export interface StoreViewPricePoint { price: number; count: number; }
export interface StoreViewCategory { deptId: number; deptName: string; itemCount: number; promoCount: number; avgRetail: number | null; minRetail: number | null; maxRetail: number | null; pricePoints: StoreViewPricePoint[]; }
export interface StoreViewPromoItem { sku: number; description: string; deptName: string; currentRetail: number | null; promoPrice: number | null; promoLabel: string | null; }
export interface StoreViewEvent { pcId: number; pcName: string; kind: 'VENDOR_PROMO' | 'REPRICE' | 'CLEARANCE'; changeType: ChangeType; amount: number; effectiveDate: string; fundedByVendor: boolean; skuCount: number; storesInScope: number; }
export interface SellThroughRow { deptId: number; deptName: string; cells: (number | null)[]; avg: number | null; }
export interface SellThroughMatrix { columns: string[]; rows: SellThroughRow[]; }
export interface SellThrough {
  simulated: boolean;
  note: string;
  overallRate: number | null;
  overallByWeek: { week: string; rate: number | null }[];
  byWeek: SellThroughMatrix;
  byBand: SellThroughMatrix;
}
export interface StoreView {
  scope: { kind: string; label: string; storeCount: number; deptId: number | null };
  itemCount: number; pricedCount: number;
  topPricePoints: StoreViewPricePoint[];
  categories: StoreViewCategory[];
  webPromotions: StoreViewPromoItem[]; webPromotionsTotal: number;
  promotions: StoreViewEvent[]; clearances: StoreViewEvent[];
  sellThrough: SellThrough;
}
export type StoreViewScope =
  | { kind: 'STORE'; storeId: number }
  | { kind: 'REGION'; region: string }
  | { kind: 'ZONE'; zoneGroupId: number; zoneId: number }
  | { kind: 'DEPT'; deptId: number };

export interface RezonePreviewLine { sku: number; description: string; currentRetail: number | null; newRetail: number; }
export interface RezonePreview { toZoneGroupId: number; toZoneId: number; toZoneName: string; movingStoreIds: number[]; movingStoreCount: number; repriceCount: number; sample: RezonePreviewLine[]; }
export interface RezoneInput { toZoneGroupId: number; toZoneId: number; storeIds?: number[]; locListId?: number | null; fromZoneId?: number | null; }

export interface PriceImpactLine { sku: number; description: string; currentRetail: number | null; newRetail: number | null; weeklyMarginDelta: number; }
export interface PriceImpact {
  simulated: boolean; note: string;
  scope: { skuCount: number; storeCount: number; itemLocations: number; sampledSkus: number; pricedInSample: number };
  assumedElasticity: number; avgPriceChangePct: number | null; marginFloorPct: number; belowFloorInSample: number;
  weekly: { revenueBefore: number; revenueAfter: number; revenueDelta: number; revenueDeltaPct: number | null; marginBefore: number; marginAfter: number; marginDelta: number; marginDeltaPct: number | null; unitsBefore: number; unitsAfter: number };
  annual: { weeks: number; revenueDelta: number; marginDelta: number };
  topImpact: PriceImpactLine[];
}
export interface DashboardPC { pcId: number; pcName: string; status: PCStatus; changeType: ChangeType; amount: number; effectiveDate: string; sendDate: string; createdBy: string; createdAt: string; skuCount: number; storeCount: number; fundedByVendor: boolean; daysUntil?: number; }
export interface Dashboard {
  totals: { stores: number; items: number; zones: number; zoneGroups: number; locationLists: number; skuLists: number; priceChanges: number; activePriceChanges: number };
  statusCounts: Record<PCStatus, number>;
  pendingApprovals: DashboardPC[];
  upcomingEffective: DashboardPC[];
  liveCounts: { promotions: number; clearances: number; reprices: number };
  recent: DashboardPC[];
  marginFloorPct: number;
  generatedAt: string;
}

// ----- approval workflow -----
export type Role = 'BUYER' | 'CATEGORY_MGR' | 'DIRECTOR' | 'VP';
export const ROLE_LABEL: Record<Role, string> = { BUYER: 'Buyer', CATEGORY_MGR: 'Category Manager', DIRECTOR: 'Director', VP: 'VP' };
// Single-source-of-truth for the user + role headers sent with every request.
// In production this would come from SSO; here we let the user pick from the
// sidebar (stored in localStorage so it survives reloads).
let currentUser = (typeof localStorage !== 'undefined' && localStorage.getItem('fd.user')) || 'anil@familydollar.com';
let currentRole: Role = ((typeof localStorage !== 'undefined' && localStorage.getItem('fd.role')) as Role) || 'BUYER';
export const auth = {
  user: () => currentUser,
  role: (): Role => currentRole,
  setUser: (u: string) => { currentUser = u; try { localStorage.setItem('fd.user', u); } catch {} },
  setRole: (r: Role) => { currentRole = r; try { localStorage.setItem('fd.role', r); } catch {} },
};

export interface ApprovalEvent { actor: string; role: Role; tier: number; action: 'APPROVED' | 'REJECTED' | 'COMMENT'; comment: string | null; at: string; }

// PriceChange augmented with approval state (matches API).
export interface PriceChangeApproval { requiredTier: number; approvedTiers: number[]; approvalLog: ApprovalEvent[]; }

// ----- markdown cadence -----
export interface MarkdownStep { stepNo: number; markdownPct: number; afterDays: number; effectiveDate?: string; newRetail?: number | null; }
export interface MarkdownRec {
  sku: number; description: string; deptName: string;
  currentRetail: number; cost: number | null;
  sellThroughPct: number; weeksOnHand: number; inventoryUnitsPerStore: number; weeklyUnitsPerStore: number;
  steps: MarkdownStep[];
}
export interface MarkdownRecResponse {
  simulated: boolean; note: string;
  scope: { kind: string; deptId: number | null; vendorId: number | null };
  thresholds: { slowSellThroughPct: number; slowWeeksOnHandMin: number };
  schedule: MarkdownStep[];
  totalSlowMovers: number; generatedAt: string;
  recommendations: MarkdownRec[];
}

// ----- competitors -----
export interface CompetitorPrice { sku: number; rivalKey: string; rivalName: string; price: number | null; status: 'OK' | 'BLOCKED' | 'NOT_FOUND' | 'ERROR' | 'TIMEOUT'; message: string | null; url: string; fetchedAt: string; }
export interface CompetitorRival { key: string; name: string; }
export interface ScrapeResponse { scraped: number; requested: number; capped: boolean; blockedRivals: string[]; results: CompetitorPrice[]; }
export interface GapLine { sku: number; description: string; deptName: string; fdPrice: number; competitors: { rivalKey: string; rivalName: string; price: number }[]; avgCompetitor: number; gapPct: number; action: string; }
export interface GapReport { totalCovered: number; lines: GapLine[]; }

// ----- penny markdown (destruction) -----
export interface PennyCandidate {
  sku: number; description: string; deptName: string;
  currentRetail: number; cost: number | null;
  sellThroughPct: number; weeksOnHand: number; inventoryUnitsPerStore: number;
  rationale: string; severity: number; source: 'AI' | 'HEURISTIC';
}
export interface PennyMarkdownResponse {
  simulated: boolean; note: string;
  scope: { kind: string; deptId: number | null };
  thresholds: { extremeSellThroughPct: number; extremeWeeksOnHandMin: number; pennyPrice: number };
  totalCandidates: number; aiUsed: boolean;
  recommendations: PennyCandidate[];
}
export interface PennyMarkdownGenerateResponse {
  pennyPrice: number;
  skuList: SkuList; locList: LocationList; priceChange: PriceChange;
  warning: string;
}

// ----- vector DB -----
export interface VectorStatus {
  activeProvider: string;
  providerDimensions: number;
  items: { rows: number; dim: number; provider: string; lastUpdated: string | null };
  priceChanges: { rows: number; dim: number; provider: string; lastUpdated: string | null };
}
export interface VectorItemHit { sku: number; similarity: number; description: string | null; deptName: string | null; vendorName: string | null; currentRetail: number | null; }
export interface VectorItemSearchResponse { provider: string; query?: string; seed?: { sku: number; item: Item | null }; hits: VectorItemHit[]; }
export interface VectorPcHit { pcId: number; similarity: number; pcName: string | null; status: PCStatus | null; changeType: ChangeType | null; amount: number | null; effectiveDate: string | null; skuCount: number; storeCount: number; }
export interface VectorPcSimilarResponse { provider: string; seed: { pcId: number; pcName: string | null }; hits: VectorPcHit[]; }

// ----- AI strategy -----
export interface StrategyRecommendation {
  kind: string;          // 'EDLP' | 'MARKDOWN_PCT' | 'MARKDOWN_AMT' | 'SET_PRICE'
  changeType: ChangeType;
  amount: number;
  effectiveDate: string;
  scopeNote: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
}
export interface StrategyContext {
  date: string;
  season: string;
  seasonalNotes: string[];
  weatherNotes: string[];
  upcomingHolidays: { date: string; name: string; daysUntil: number }[];
  topRegions: { region: string; pct: number; storeCount: number }[];
}
export interface StrategyScope {
  skuCount: number; storeCount: number; itemLocations: number;
  sampledItems: number;
  topDepts: { name: string; deptId: number | null; share: number; count: number }[];
  topRegions: { region: string; pct: number; storeCount: number }[];
  avgPrice: number | null; minPrice: number | null; maxPrice: number | null; avgCost: number | null;
}
export interface StrategyResponse {
  aiUsed: boolean;
  strategy: 'AUTO' | 'EDLP' | 'MARKDOWN';
  scope: StrategyScope;
  context: StrategyContext;
  recommendations: StrategyRecommendation[];
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when we're actually sending a body.
  // Otherwise Fastify rejects empty-body POSTs with FST_ERR_CTP_EMPTY_JSON_BODY
  // (affects the submit/approve/reject/resolve/promote endpoints).
  const headers: Record<string, string> = {
    'X-User': auth.user(),
    'X-Role': auth.role(),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (init?.body != null) headers['Content-Type'] = 'application/json';
  const r = await fetch(`/api${path}`, { ...init, headers });
  if (!r.ok) { const text = await r.text(); throw new Error(`${r.status} ${r.statusText}: ${text}`); }
  return r.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; datastore: string; anthropicConfigured: boolean }>('/health'),
  getConfig: () => req<AppClientConfig>('/config'),
  listItems: (search?: string) => req<Page<Item>>(`/items?pageSize=500${search ? `&search=${encodeURIComponent(search)}` : ''}`).then((r) => r.rows),
  searchStores: (p: { search?: string; page?: number; pageSize?: number } = {}) => { const q = new URLSearchParams(); if (p.search) q.set('search', p.search); if (p.page) q.set('page', String(p.page)); if (p.pageSize) q.set('pageSize', String(p.pageSize)); const s = q.toString(); return req<Page<Store>>(`/stores${s ? `?${s}` : ''}`); },
  getItem: (sku: number) => req<Item>(`/items/${sku}`),
  searchStoreIds: (search?: string) => req<{ storeIds: number[]; total: number }>(`/stores/ids${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  listVendors: () => req<{ vendors: Vendor[] }>('/vendors').then((r) => r.vendors),
  listZoneGroups: () => req<{ zoneGroups: ZoneGroup[] }>('/zone-groups').then((r) => r.zoneGroups),
  searchZones: (zoneGroupId: number, p: { search?: string; page?: number; pageSize?: number } = {}) => { const q = new URLSearchParams(); q.set('zoneGroupId', String(zoneGroupId)); if (p.search) q.set('search', p.search); if (p.page) q.set('page', String(p.page)); if (p.pageSize) q.set('pageSize', String(p.pageSize)); return req<Page<Zone>>(`/zones?${q.toString()}`); },
  listDivisions: () => req<{ divisions: Division[] }>('/hierarchy/divisions').then((r) => r.divisions),
  listGroups: (division?: number) => req<{ groups: Group[] }>(`/hierarchy/groups${division != null ? `?division=${division}` : ''}`).then((r) => r.groups),
  listDepts: (groupNo?: number) => req<{ depts: Dept[] }>(`/hierarchy/depts${groupNo != null ? `?groupNo=${groupNo}` : ''}`).then((r) => r.depts),
  listClasses: (deptId?: number) => req<{ classes: MerchClass[] }>(`/hierarchy/classes${deptId != null ? `?deptId=${deptId}` : ''}`).then((r) => r.classes),
  listSubclasses: (deptId?: number, classId?: number) => {
    const q = new URLSearchParams();
    if (deptId != null) q.set('deptId', String(deptId));
    if (classId != null) q.set('classId', String(classId));
    const s = q.toString();
    return req<{ subclasses: Subclass[] }>(`/hierarchy/subclasses${s ? `?${s}` : ''}`).then((r) => r.subclasses);
  },
  resolveItems: (sel: ItemSelector) => req<{ skus: number[]; count: number }>('/resolve/items', { method: 'POST', body: JSON.stringify(sel) }),
  resolveStores: (sel: LocationSelector) => req<{ storeIds: number[]; count: number }>('/resolve/stores', { method: 'POST', body: JSON.stringify(sel) }),
  pricePreview: (body: { itemSelector: ItemSelector; changeType: ChangeType; amount: number; endsIn?: number | null }) =>
    req<PricePreview>('/pricing/preview', { method: 'POST', body: JSON.stringify(body) }),
  pricingImpact: (body: { itemSelector: ItemSelector; locationSelector: LocationSelector; changeType: ChangeType; amount: number; endsIn?: number | null }) =>
    req<PriceImpact>('/pricing/impact', { method: 'POST', body: JSON.stringify(body) }),
  dashboard: () => req<Dashboard>('/dashboard'),

  listLocationLists: () => req<{ locationLists: LocationList[] }>('/location-lists').then((r) => r.locationLists),
  createLocationList: (body: { name: string; description?: string | null; storeIds: number[] }) => req<LocationList>('/location-lists', { method: 'POST', body: JSON.stringify(body) }),
  listSkuLists: () => req<{ skuLists: SkuList[] }>('/sku-lists').then((r) => r.skuLists),
  createSkuList: (body: { name: string; description?: string | null; skus: number[] }) => req<SkuList>('/sku-lists', { method: 'POST', body: JSON.stringify(body) }),

  listPriceChanges: () => req<{ priceChanges: PriceChange[] }>('/price-changes').then((r) => r.priceChanges),
  createPriceChange: (body: {
    pcName: string; itemSelector: ItemSelector; locationSelector: LocationSelector;
    changeType: ChangeType; amount: number; roundingRule?: RoundingRule; endsIn?: number | null;
    multiUnits?: number | null; multiRetail?: number | null;
    fundedByVendor?: boolean; dealId?: string | null; fundingVendorId?: number | null; fundingPct?: number | null;
    sendDate?: string | null; effectiveDate: string; reasonCode?: number | null;
  }) => req<PriceChange>('/price-changes', { method: 'POST', body: JSON.stringify(body) }),
  setStatus: (pcId: number, status: PCStatus) => req<PriceChange>(`/price-changes/${pcId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  resolvePc: (pcId: number) => req<{ skuCount: number; storeCount: number }>(`/price-changes/${pcId}/resolve`, { method: 'POST' }),
  promotePc: (pcId: number) => req<PriceChange>(`/price-changes/${pcId}/promote`, { method: 'POST' }),
  submitJob: (pcId: number, jobType: JobType) => req<PcJob>(`/price-changes/${pcId}/jobs`, { method: 'POST', body: JSON.stringify({ jobType }) }),
  getJob: (jobId: number) => req<PcJob>(`/jobs/${jobId}`),
  getFiscalCalendar: () => req<FiscalCalendar>('/fiscal/calendar'),
  listRegions: () => req<{ regions: { region: string; storeCount: number }[] }>('/store-view/regions').then((r) => r.regions),
  storeView: (scope: StoreViewScope) => {
    const q = new URLSearchParams(); q.set('kind', scope.kind);
    if (scope.kind === 'STORE') q.set('storeId', String(scope.storeId));
    if (scope.kind === 'REGION') q.set('region', scope.region);
    if (scope.kind === 'ZONE') { q.set('zoneGroupId', String(scope.zoneGroupId)); q.set('zoneId', String(scope.zoneId)); }
    if (scope.kind === 'DEPT') q.set('deptId', String(scope.deptId));
    return req<StoreView>(`/store-view?${q.toString()}`);
  },

  listActivities: (from?: string, to?: string, scope?: { zoneGroupId?: number | null; zoneId?: number | null }) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (scope?.zoneGroupId != null) q.set('zoneGroupId', String(scope.zoneGroupId));
    if (scope?.zoneId != null) q.set('zoneId', String(scope.zoneId));
    const s = q.toString();
    return req<{ activities: CalendarActivity[] }>(`/calendar/activities${s ? `?${s}` : ''}`).then((r) => r.activities);
  },
  createActivity: (body: Omit<CalendarActivity, 'activityId'>) => req<CalendarActivity>('/calendar/activities', { method: 'POST', body: JSON.stringify(body) }),
  deleteActivity: (id: number) => req<{ deleted: boolean }>(`/calendar/activities/${id}`, { method: 'DELETE' }),
  aiRefreshCalendar: (body: { from: string; to: string; zoneGroupId?: number | null; zoneId?: number | null }) =>
    req<{ activities: CalendarActivity[]; region: string; stub: boolean }>('/calendar/ai-refresh', { method: 'POST', body: JSON.stringify(body) }),

  previewRezone: (input: RezoneInput) => req<RezonePreview>('/rezone/preview', { method: 'POST', body: JSON.stringify(input) }),
  rezone: (input: RezoneInput) => req<{ priceChange: PriceChange; preview: RezonePreview }>('/rezone', { method: 'POST', body: JSON.stringify(input) }),
  // Approval workflow
  submitPc: (pcId: number) => req<{ priceChange: PriceChange; metrics: { skuCount: number; storeCount: number; itemLocations: number; belowFloor: number; weeklyMarginUsdAbs: number }; requiredTier: number }>(`/price-changes/${pcId}/submit`, { method: 'POST' }),
  approvePc: (pcId: number, comment?: string | null) => req<PriceChange>(`/price-changes/${pcId}/approve`, { method: 'POST', body: JSON.stringify({ comment: comment ?? null }) }),
  rejectPc: (pcId: number, comment?: string | null) => req<PriceChange>(`/price-changes/${pcId}/reject`, { method: 'POST', body: JSON.stringify({ comment: comment ?? null }) }),
  commentPc: (pcId: number, comment: string) => req<PriceChange>(`/price-changes/${pcId}/comment`, { method: 'POST', body: JSON.stringify({ comment }) }),

  // Markdown cadence
  markdownRecs: (params: { kind?: 'ALL' | 'DEPT' | 'VENDOR'; deptId?: number | null; vendorId?: number | null; limit?: number } = {}) => {
    const q = new URLSearchParams(); q.set('kind', params.kind ?? 'ALL');
    if (params.deptId != null) q.set('deptId', String(params.deptId));
    if (params.vendorId != null) q.set('vendorId', String(params.vendorId));
    if (params.limit != null) q.set('limit', String(params.limit));
    return req<MarkdownRecResponse>(`/markdown/recommendations?${q.toString()}`);
  },
  generateMarkdowns: (body: { skus: number[]; locationSelector: LocationSelector; scheduleSteps?: MarkdownStep[]; pcNameBase?: string }) =>
    req<{ skuList: SkuList; priceChanges: PriceChange[] }>('/markdown/generate', { method: 'POST', body: JSON.stringify(body) }),

  // Competitors
  listRivals: () => req<{ rivals: CompetitorRival[] }>('/competitors/rivals').then((r) => r.rivals),
  scrapeCompetitors: (body: { skus: number[]; rivals?: string[] }) =>
    req<ScrapeResponse>('/competitors/scrape', { method: 'POST', body: JSON.stringify(body) }),
  gapReport: (params: { kind?: 'ALL' | 'DEPT'; deptId?: number | null; limit?: number } = {}) => {
    const q = new URLSearchParams(); q.set('kind', params.kind ?? 'ALL');
    if (params.deptId != null) q.set('deptId', String(params.deptId));
    if (params.limit != null) q.set('limit', String(params.limit));
    return req<GapReport>(`/competitors/gap-report?${q.toString()}`);
  },

  // Penny markdown (destruction)
  pennyRecs: (params: { kind?: 'ALL' | 'DEPT'; deptId?: number | null; useAi?: boolean; limit?: number } = {}) => {
    const q = new URLSearchParams(); q.set('kind', params.kind ?? 'ALL');
    if (params.deptId != null) q.set('deptId', String(params.deptId));
    if (params.useAi != null) q.set('useAi', String(params.useAi));
    if (params.limit != null) q.set('limit', String(params.limit));
    return req<PennyMarkdownResponse>(`/penny-markdown/recommendations?${q.toString()}`);
  },
  pennyGenerate: (body: { skus: number[]; notes?: string | null; effectiveDate?: string | null }) =>
    req<PennyMarkdownGenerateResponse>('/penny-markdown/generate', { method: 'POST', body: JSON.stringify(body) }),

  // Vector DB (semantic search + similarity)
  vectorStatus: () => req<VectorStatus>('/vector/status'),
  indexItems: () => req<{ rows: number; provider: string; dim: number }>('/vector/items/index', { method: 'POST' }),
  indexPriceChanges: () => req<{ rows: number; provider: string; dim: number }>('/vector/price-changes/index', { method: 'POST' }),
  similarItems: (params: { sku: number; k?: number; deptId?: number | null; excludeSelf?: boolean }) => {
    const q = new URLSearchParams(); q.set('sku', String(params.sku));
    if (params.k != null) q.set('k', String(params.k));
    if (params.deptId != null) q.set('deptId', String(params.deptId));
    if (params.excludeSelf != null) q.set('excludeSelf', String(params.excludeSelf));
    return req<VectorItemSearchResponse>(`/vector/items/similar?${q.toString()}`);
  },
  searchItemsSemantic: (params: { q: string; k?: number; deptId?: number | null }) => {
    const qs = new URLSearchParams(); qs.set('q', params.q);
    if (params.k != null) qs.set('k', String(params.k));
    if (params.deptId != null) qs.set('deptId', String(params.deptId));
    return req<VectorItemSearchResponse>(`/vector/items/search?${qs.toString()}`);
  },
  similarPriceChanges: (params: { pcId: number; k?: number; excludeSelf?: boolean }) => {
    const q = new URLSearchParams(); q.set('pcId', String(params.pcId));
    if (params.k != null) q.set('k', String(params.k));
    if (params.excludeSelf != null) q.set('excludeSelf', String(params.excludeSelf));
    return req<VectorPcSimilarResponse>(`/vector/price-changes/similar?${q.toString()}`);
  },

  aiGroupStores: (body: { numClusters: number; hint?: string; storeIds?: number[] }) => req<{ clusters: Array<{ name: string; rationale: string; storeIds: number[] }>; stub?: boolean }>('/ai/group-stores', { method: 'POST', body: JSON.stringify(body) }),
  aiSuggestStrategy: (body: { itemSelector: ItemSelector; locationSelector?: LocationSelector | null; strategy?: 'AUTO' | 'EDLP' | 'MARKDOWN' }) =>
    req<StrategyResponse>('/ai/suggest-strategy', { method: 'POST', body: JSON.stringify(body) }),
  aiSuggestPrice: (body: { sku: number; reasonCode?: number | null; sellThrough?: number | null; weeksOnHand?: number | null }) => req<{ changeType: ChangeType; amount: number; rationale: string }>('/ai/suggest-price', { method: 'POST', body: JSON.stringify(body) }),
  aiParseIntent: (text: string) => req<{ pcName: string; sku: number | null; skuQuery: string | null; storeQuery: string | null; changeType: ChangeType; amount: number; effectiveDate: string | null; rationale: string }>('/ai/parse-intent', { method: 'POST', body: JSON.stringify({ text }) }),
};
