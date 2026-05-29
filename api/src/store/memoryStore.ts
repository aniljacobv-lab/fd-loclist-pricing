import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DataStore } from './datastore.js';
import { pcPriceForSku } from './datastore.js';
import type {
  Item, Store, ZoneGroup, Zone, Dept, MerchClass, Subclass, Vendor, Page, Division, Group,
  LocationList, SkuList, PriceChange, NewPriceChangeInput, PCStatus,
  ItemSelector, LocationSelector, CalendarActivity, NewCalendarActivity, CalendarScope, PcJob, JobType,
  RezoneInput, RezonePreview, RezonePreviewLine, Role,
} from '../types.js';
import { config } from '../config.js';

function endsInMatch(retail: number | null | undefined, cents: number): boolean {
  if (retail == null) return false;
  const frac = Math.round((retail - Math.floor(retail)) * 100) / 100;
  return Math.abs(frac - cents) < 0.005;
}
function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10);
}
function dataPath(file: string): string { return resolve(process.cwd(), config.dataDir, file); }
function loadJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(readFileSync(dataPath(file), 'utf8')) as T; } catch { return fallback; }
}
function paginate<T>(all: T[], page = 1, pageSize = config.app.pagination.defaultPageSize): Page<T> {
  const ps = Math.min(Math.max(1, pageSize), config.app.pagination.maxPageSize);
  const p = Math.max(1, page);
  return { rows: all.slice((p - 1) * ps, p * ps), total: all.length, page: p, pageSize: ps };
}

interface RawStore { storeId: number; name: string; city: string; state: string; district: number | null; storeClass: string | null; format: string | null; }
interface RawZone { zoneGroupId: number; zoneId: number; description: string; baseRetail: boolean; }
type CatalogGroup = { dept: number; deptName: string; cls: number; className: string; sub: number; subName: string; vendor: number; items: [string, number, number][]; };

export class MemoryStore implements DataStore {
  private items: Item[] = [];
  // ---- secondary indices (rebuilt after every items load) ----
  // O(1) sku lookup. Replaces the O(n) find used by getItem(), which is hit
  // hundreds of times per impact/markdown/penny request.
  private itemsBySku = new Map<number, Item>();
  // Dept/class/subclass/vendor → SKUs[]. resolveItems() starts from the
  // smallest matching base set so a filtered query only scans a few hundred
  // items instead of the whole 18k+ catalog.
  private itemsByDept = new Map<number, Item[]>();
  private itemsByClass = new Map<string, Item[]>();     // key: `${dept}:${classId}`
  private itemsBySubclass = new Map<string, Item[]>();  // key: `${dept}:${cls}:${sub}`
  private itemsByVendor = new Map<number, Item[]>();

  private stores: Store[] = [];
  private zoneGroups: ZoneGroup[] = [];
  private rawZones: RawZone[] = [];
  private zoneMembers = new Map<string, number[]>();
  private depts: Dept[] = [];
  private classes: MerchClass[] = [];
  private subclasses: Subclass[] = [];
  private vendors: Vendor[] = [];
  private divisions: Division[] = [];
  private groups: Group[] = [];
  private deptGroup = new Map<number, number>();
  private cntDept = new Map<number, number>();
  private cntClass = new Map<string, number>();
  private cntSub = new Map<string, number>();
  private cntGroup = new Map<number, number>();
  private cntDiv = new Map<number, number>();
  private locLists: LocationList[] = [];
  private skuLists: SkuList[] = [];
  private priceChanges: PriceChange[] = [];
  private activities: CalendarActivity[] = [];
  private nameToSku = new Map<string, number>();
  private jobs: PcJob[] = [];
  private jobSeq = 1;
  private locListSeq = 1000; private skuListSeq = 2000; private pcSeq = 1000; private activitySeq = 5000;

  async init(): Promise<void> { this.seed(); }
  async shutdown(): Promise<void> {}

  async listItems({ search }: { search?: string } = {}): Promise<Item[]> {
    if (!search) return [...this.items];
    const s = search.toLowerCase();
    return this.items.filter((i) => String(i.sku).includes(s) || i.description.toLowerCase().includes(s));
  }
  async getItem(sku: number): Promise<Item | null> { return this.itemsBySku.get(sku) ?? null; }

  async submitForApproval(id: number, actor: string, requiredTier: number): Promise<PriceChange | null> {
    const pc = this.priceChanges.find((p) => p.pcId === id); if (!pc) return null;
    pc.status = 'SUBMITTED'; pc.requiredTier = Math.max(1, Math.min(4, requiredTier));
    pc.approvalLog.push({ actor, role: 'BUYER', tier: 0, action: 'COMMENT', comment: 'Submitted for approval', at: new Date().toISOString() });
    return this.clonePc(pc);
  }
  async approvePc(id: number, actor: string, role: Role, tier: number, comment: string | null): Promise<PriceChange | null> {
    const pc = this.priceChanges.find((p) => p.pcId === id); if (!pc) return null;
    if (!pc.approvedTiers.includes(tier)) pc.approvedTiers.push(tier);
    pc.approvedTiers.sort((a, b) => a - b);
    pc.approvalLog.push({ actor, role, tier, action: 'APPROVED', comment, at: new Date().toISOString() });
    if (pc.approvedTiers.length >= pc.requiredTier && pc.status === 'SUBMITTED') pc.status = 'APPROVED';
    return this.clonePc(pc);
  }
  async rejectPc(id: number, actor: string, role: Role, comment: string | null): Promise<PriceChange | null> {
    const pc = this.priceChanges.find((p) => p.pcId === id); if (!pc) return null;
    pc.status = 'REJECTED';
    pc.approvalLog.push({ actor, role, tier: 0, action: 'REJECTED', comment, at: new Date().toISOString() });
    return this.clonePc(pc);
  }
  async commentOnPc(id: number, actor: string, role: Role, comment: string): Promise<PriceChange | null> {
    const pc = this.priceChanges.find((p) => p.pcId === id); if (!pc) return null;
    pc.approvalLog.push({ actor, role, tier: 0, action: 'COMMENT', comment, at: new Date().toISOString() });
    return this.clonePc(pc);
  }
  async listStores(): Promise<Store[]> { return [...this.stores]; }
  async getStore(storeId: number): Promise<Store | null> { return this.stores.find((s) => s.storeId === storeId) ?? null; }
  async listZoneGroups(): Promise<ZoneGroup[]> { return [...this.zoneGroups]; }
  async listZones(zoneGroupId?: number): Promise<Zone[]> {
    return this.rawZones.filter((z) => zoneGroupId === undefined || z.zoneGroupId === zoneGroupId)
      .map((z) => ({ zoneId: z.zoneId, zoneGroupId: z.zoneGroupId, zoneName: z.description, storeCount: (this.zoneMembers.get(`${z.zoneGroupId}:${z.zoneId}`) ?? []).length }));
  }
  async listVendors(): Promise<Vendor[]> { return [...this.vendors]; }
  async listDivisions(): Promise<Division[]> { return this.divisions.map((d) => ({ ...d, itemCount: this.cntDiv.get(d.division) ?? 0 })); }
  async listGroups(division?: number): Promise<Group[]> { return this.groups.filter((g) => division === undefined || g.division === division).map((g) => ({ ...g, itemCount: this.cntGroup.get(g.groupNo) ?? 0 })); }
  async listDepts(groupNo?: number): Promise<Dept[]> { return this.depts.filter((d) => groupNo === undefined || d.groupNo === groupNo).map((d) => ({ ...d, itemCount: this.cntDept.get(d.deptId) ?? 0 })); }
  async listClasses(deptId?: number): Promise<MerchClass[]> { return this.classes.filter((c) => deptId === undefined || c.deptId === deptId).map((c) => ({ ...c, itemCount: this.cntClass.get(`${c.deptId}:${c.classId}`) ?? 0 })); }
  async listSubclasses(deptId?: number, classId?: number): Promise<Subclass[]> { return this.subclasses.filter((s) => (deptId === undefined || s.deptId === deptId) && (classId === undefined || s.classId === classId)).map((s) => ({ ...s, itemCount: this.cntSub.get(`${s.deptId}:${s.classId}:${s.subclassId}`) ?? 0 })); }

  // -------- paged search (FD volume) --------
  async searchStores(q: { search?: string; page?: number; pageSize?: number }): Promise<Page<Store>> {
    const s = (q.search ?? '').trim().toLowerCase();
    const matched = s ? this.stores.filter((x) => String(x.storeId).includes(s) || x.name.toLowerCase().includes(s) || (x.city ?? '').toLowerCase().includes(s) || (x.state ?? '').toLowerCase().includes(s)) : this.stores;
    return paginate(matched, q.page, q.pageSize);
  }
  async searchItems(q: { search?: string; page?: number; pageSize?: number }): Promise<Page<Item>> {
    const s = (q.search ?? '').trim().toLowerCase();
    const matched = s ? this.items.filter((x) => String(x.sku).includes(s) || x.description.toLowerCase().includes(s) || (x.vendorName ?? '').toLowerCase().includes(s)) : this.items;
    return paginate(matched, q.page, q.pageSize);
  }
  async searchZones(q: { zoneGroupId: number; search?: string; page?: number; pageSize?: number }): Promise<Page<Zone>> {
    const s = (q.search ?? '').trim().toLowerCase();
    const inGroup = this.rawZones.filter((z) => z.zoneGroupId === q.zoneGroupId);
    const matched = (s ? inGroup.filter((z) => z.description.toLowerCase().includes(s) || String(z.zoneId).includes(s)) : inGroup)
      .map((z) => ({ zoneId: z.zoneId, zoneGroupId: z.zoneGroupId, zoneName: z.description, storeCount: (this.zoneMembers.get(`${z.zoneGroupId}:${z.zoneId}`) ?? []).length }));
    return paginate(matched, q.page, q.pageSize);
  }

  async resolveItems(sel: ItemSelector): Promise<number[]> {
    // 1) base candidate set
    let candidates: Item[];
    if (sel.mode === 'SINGLE_SKU') {
      candidates = sel.sku != null ? this.items.filter((i) => i.sku === sel.sku) : [];
    } else if (sel.mode === 'SKU_LIST') {
      let base: number[] = [];
      if (sel.skuListId != null) { const l = this.skuLists.find((x) => x.skuListId === sel.skuListId); base = l ? l.skus : []; }
      else if (sel.skus?.length) base = sel.skus;
      const set = new Set(base);
      candidates = this.items.filter((i) => set.has(i.sku));
    } else {
      // INDEXED FAST PATH: pick the smallest available base set so we don't
      // scan the whole catalog when a hierarchy/vendor filter is on.
      const dArr = sel.deptIds?.length ? sel.deptIds : (sel.deptId != null ? [sel.deptId] : []);
      const cArr = sel.classIds?.length ? sel.classIds : (sel.classId != null ? [sel.classId] : []);
      const sArr = sel.subclassIds?.length ? sel.subclassIds : (sel.subclassId != null ? [sel.subclassId] : []);
      const vArr = sel.vendorIds?.length ? sel.vendorIds : (sel.vendorId != null ? [sel.vendorId] : []);
      const bases: Item[][] = [];
      if (sArr.length && dArr.length && cArr.length) {
        for (const d of dArr) for (const c of cArr) for (const su of sArr) { const b = this.itemsBySubclass.get(`${d}:${c}:${su}`); if (b) bases.push(b); }
      } else if (cArr.length && dArr.length) {
        for (const d of dArr) for (const c of cArr) { const b = this.itemsByClass.get(`${d}:${c}`); if (b) bases.push(b); }
      } else if (dArr.length) {
        for (const d of dArr) { const b = this.itemsByDept.get(d); if (b) bases.push(b); }
      } else if (vArr.length) {
        for (const v of vArr) { const b = this.itemsByVendor.get(v); if (b) bases.push(b); }
      }
      candidates = bases.length ? ([] as Item[]).concat(...bases) : this.items;
    }
    // 2) predicate filters — ANDed across types; OR within a multi-value filter
    const pick = (arr?: number[], single?: number | null): Set<number> | null => {
      const a = arr?.length ? arr : (single != null ? [single] : []);
      return a.length ? new Set(a) : null;
    };
    const depSet = pick(sel.deptIds, sel.deptId);
    const clsSet = pick(sel.classIds, sel.classId);
    const subSet = pick(sel.subclassIds, sel.subclassId);
    const venSet = pick(sel.vendorIds, sel.vendorId);
    const pps = sel.pricePointEndsInList?.length ? sel.pricePointEndsInList : (sel.pricePointEndsIn != null ? [sel.pricePointEndsIn] : []);
    if (depSet) candidates = candidates.filter((i) => i.deptId != null && depSet.has(i.deptId));
    if (clsSet) candidates = candidates.filter((i) => i.classId != null && clsSet.has(i.classId));
    if (subSet) candidates = candidates.filter((i) => i.subclassId != null && subSet.has(i.subclassId));
    if (venSet) candidates = candidates.filter((i) => i.vendorId != null && venSet.has(i.vendorId));
    if (pps.length) candidates = candidates.filter((i) => pps.some((p) => endsInMatch(i.currentRetail, p)));
    const except = new Set(sel.exceptSkus ?? []);
    return candidates.map((i) => i.sku).filter((s) => !except.has(s));
  }
  async resolveStores(sel: LocationSelector): Promise<number[]> {
    const set = new Set<number>();
    switch (sel.mode) {
      case 'LOCATION_LIST': {
        const listIds = sel.locListIds?.length ? sel.locListIds : (sel.locListId != null ? [sel.locListId] : []);
        for (const lid of listIds) { const l = this.locLists.find((x) => x.locListId === lid); if (l) for (const s of l.storeIds) set.add(s); }
        break;
      }
      case 'ZONE': {
        const zoneIds = sel.zoneIds?.length ? sel.zoneIds : (sel.zoneId != null ? [sel.zoneId] : []);
        if (sel.zoneGroupId != null) for (const zid of zoneIds) for (const s of (this.zoneMembers.get(`${sel.zoneGroupId}:${zid}`) ?? [])) set.add(s);
        break;
      }
      case 'STORES': for (const s of (sel.storeIds ?? [])) set.add(s); break;
    }
    const except = new Set(sel.exceptStoreIds ?? []);
    return [...set].filter((s) => !except.has(s));
  }

  async listLocationLists(): Promise<LocationList[]> { return this.locLists.map((l) => ({ ...l, storeIds: [...l.storeIds] })); }
  async getLocationList(id: number): Promise<LocationList | null> { const l = this.locLists.find((x) => x.locListId === id); return l ? { ...l, storeIds: [...l.storeIds] } : null; }
  async createLocationList(input: { name: string; description?: string | null; storeIds: number[]; createdBy: string }): Promise<LocationList> {
    const ll: LocationList = { locListId: this.locListSeq++, locListName: input.name, description: input.description ?? null, createdBy: input.createdBy, createdAt: new Date().toISOString(), storeIds: [...input.storeIds] };
    this.locLists.push(ll); return { ...ll, storeIds: [...ll.storeIds] };
  }
  async updateLocationList(id: number, patch: { name?: string; description?: string | null; storeIds?: number[] }): Promise<LocationList | null> {
    const l = this.locLists.find((x) => x.locListId === id); if (!l) return null;
    if (patch.name !== undefined) l.locListName = patch.name; if (patch.description !== undefined) l.description = patch.description; if (patch.storeIds !== undefined) l.storeIds = [...patch.storeIds];
    return { ...l, storeIds: [...l.storeIds] };
  }
  async deleteLocationList(id: number): Promise<boolean> { const i = this.locLists.findIndex((x) => x.locListId === id); if (i < 0) return false; this.locLists.splice(i, 1); return true; }

  async listSkuLists(): Promise<SkuList[]> { return this.skuLists.map((l) => ({ ...l, skus: [...l.skus] })); }
  async getSkuList(id: number): Promise<SkuList | null> { const l = this.skuLists.find((x) => x.skuListId === id); return l ? { ...l, skus: [...l.skus] } : null; }
  async createSkuList(input: { name: string; description?: string | null; skus: number[]; createdBy: string }): Promise<SkuList> {
    const sl: SkuList = { skuListId: this.skuListSeq++, skuListName: input.name, description: input.description ?? null, createdBy: input.createdBy, createdAt: new Date().toISOString(), skus: [...input.skus] };
    this.skuLists.push(sl); return { ...sl, skus: [...sl.skus] };
  }
  async updateSkuList(id: number, patch: { name?: string; description?: string | null; skus?: number[] }): Promise<SkuList | null> {
    const l = this.skuLists.find((x) => x.skuListId === id); if (!l) return null;
    if (patch.name !== undefined) l.skuListName = patch.name; if (patch.description !== undefined) l.description = patch.description; if (patch.skus !== undefined) l.skus = [...patch.skus];
    return { ...l, skus: [...l.skus] };
  }
  async deleteSkuList(id: number): Promise<boolean> { const i = this.skuLists.findIndex((x) => x.skuListId === id); if (i < 0) return false; this.skuLists.splice(i, 1); return true; }

  async listPriceChanges(filter?: { status?: PCStatus }): Promise<PriceChange[]> {
    let xs = [...this.priceChanges]; if (filter?.status) xs = xs.filter((x) => x.status === filter.status); return xs.map((x) => this.clonePc(x));
  }
  async getPriceChange(id: number): Promise<PriceChange | null> { const x = this.priceChanges.find((p) => p.pcId === id); return x ? this.clonePc(x) : null; }
  async createPriceChange(input: NewPriceChangeInput): Promise<PriceChange> {
    const resolvedSkus = await this.resolveItems(input.itemSelector);
    const resolvedStoreIds = await this.resolveStores(input.locationSelector);
    const sendDate = input.sendDate ?? isoMinusDays(input.effectiveDate, config.app.leadTimes.SEND);
    const pc: PriceChange = {
      pcId: this.pcSeq++, pcName: input.pcName, itemSelector: input.itemSelector, locationSelector: input.locationSelector,
      resolvedSkus, resolvedStoreIds, changeType: input.changeType, amount: input.amount,
      roundingRule: input.roundingRule ?? 'NONE', endsIn: input.endsIn ?? null, multiUnits: input.multiUnits ?? null, multiRetail: input.multiRetail ?? null,
      fundedByVendor: input.fundedByVendor ?? false, dealId: input.dealId ?? null, fundingVendorId: input.fundingVendorId ?? null, fundingPct: input.fundingPct ?? null,
      sendDate, effectiveDate: input.effectiveDate, reasonCode: input.reasonCode, status: 'WORKSHEET',
      priceMap: input.priceMap ?? null, rezone: input.rezone ?? null,
      requiredTier: 1, approvedTiers: [], approvalLog: [],
      createdBy: input.createdBy, createdAt: new Date().toISOString(),
    };
    this.priceChanges.push(pc);
    const lz = input.locationSelector.mode === 'ZONE' ? { zoneGroupId: input.locationSelector.zoneGroupId ?? null, zoneId: input.locationSelector.zoneId ?? null } : { zoneGroupId: null, zoneId: null };
    this.activities.push({ activityId: this.activitySeq++, title: `Send: ${pc.pcName}`, type: 'SEND', date: sendDate, source: 'SEED', ...lz, relatedPcId: pc.pcId, notes: `${resolvedSkus.length} SKUs × ${resolvedStoreIds.length} stores` });
    this.activities.push({ activityId: this.activitySeq++, title: `Print strips: ${pc.pcName}`, type: 'PRICE_STRIP_PRINT', date: isoMinusDays(input.effectiveDate, config.app.leadTimes.PRICE_STRIP_PRINT), source: 'SEED', ...lz, relatedPcId: pc.pcId });
    this.activities.push({ activityId: this.activitySeq++, title: `Effective: ${pc.pcName}`, type: 'EFFECTIVE', date: input.effectiveDate, source: 'SEED', ...lz, relatedPcId: pc.pcId });
    return this.clonePc(pc);
  }
  async updatePriceChangeStatus(id: number, status: PCStatus): Promise<PriceChange | null> { const pc = this.priceChanges.find((p) => p.pcId === id); if (!pc) return null; pc.status = status; return this.clonePc(pc); }
  private clonePc(pc: PriceChange): PriceChange { return { ...pc, itemSelector: { ...pc.itemSelector }, locationSelector: { ...pc.locationSelector }, resolvedSkus: [...pc.resolvedSkus], resolvedStoreIds: [...pc.resolvedStoreIds], priceMap: pc.priceMap ? pc.priceMap.map((m) => ({ ...m })) : pc.priceMap, rezone: pc.rezone ? { ...pc.rezone } : pc.rezone, approvedTiers: [...pc.approvedTiers], approvalLog: pc.approvalLog.map((e) => ({ ...e })) }; }

  /** Rebuilds all secondary item indices. O(n). Call after this.items is replaced. */
  private rebuildItemIndices(): void {
    this.itemsBySku.clear();
    this.itemsByDept.clear();
    this.itemsByClass.clear();
    this.itemsBySubclass.clear();
    this.itemsByVendor.clear();
    for (const it of this.items) {
      this.itemsBySku.set(it.sku, it);
      if (it.deptId != null) {
        let bucket = this.itemsByDept.get(it.deptId); if (!bucket) { bucket = []; this.itemsByDept.set(it.deptId, bucket); }
        bucket.push(it);
        if (it.classId != null) {
          const k = `${it.deptId}:${it.classId}`;
          let cb = this.itemsByClass.get(k); if (!cb) { cb = []; this.itemsByClass.set(k, cb); }
          cb.push(it);
          if (it.subclassId != null) {
            const sk = `${it.deptId}:${it.classId}:${it.subclassId}`;
            let sb = this.itemsBySubclass.get(sk); if (!sb) { sb = []; this.itemsBySubclass.set(sk, sb); }
            sb.push(it);
          }
        }
      }
      if (it.vendorId != null) {
        let vb = this.itemsByVendor.get(it.vendorId); if (!vb) { vb = []; this.itemsByVendor.set(it.vendorId, vb); }
        vb.push(it);
      }
    }
  }

  async listCalendarActivities(range?: { from?: string; to?: string }, scope?: CalendarScope): Promise<CalendarActivity[]> {
    const zg = scope?.zoneGroupId ?? null; const zid = scope?.zoneId ?? null; const scoped = zg != null || zid != null;
    return this.activities
      .filter((a) => (!range?.from || a.date >= range.from) && (!range?.to || a.date <= range.to))
      .filter((a) => {
        if (!scoped) return true; // global view = everything
        const isGlobal = (a.zoneGroupId == null && a.zoneId == null);
        const matchZone = zg != null && a.zoneGroupId === zg && (zid == null || a.zoneId === zid);
        return isGlobal || matchZone;
      })
      .map((a) => ({ ...a })).sort((a, b) => a.date.localeCompare(b.date));
  }
  async createCalendarActivity(input: NewCalendarActivity): Promise<CalendarActivity> {
    const a: CalendarActivity = { activityId: this.activitySeq++, title: input.title, type: input.type, date: input.date, source: input.source ?? 'MANUAL', zoneGroupId: input.zoneGroupId ?? null, zoneId: input.zoneId ?? null, leadTimeDays: input.leadTimeDays ?? null, relatedPcId: input.relatedPcId ?? null, notes: input.notes ?? null };
    this.activities.push(a); return { ...a };
  }
  async deleteCalendarActivity(id: number): Promise<boolean> { const i = this.activities.findIndex((a) => a.activityId === id); if (i < 0) return false; this.activities.splice(i, 1); return true; }
  async replaceAiActivities(range: { from?: string; to?: string }, scope: CalendarScope, items: NewCalendarActivity[]): Promise<CalendarActivity[]> {
    const zg = scope?.zoneGroupId ?? null; const zid = scope?.zoneId ?? null;
    // remove ONLY prior AI activities in this window + exact scope (manual/seed untouched)
    this.activities = this.activities.filter((a) => !(a.source === 'AI'
      && (!range.from || a.date >= range.from) && (!range.to || a.date <= range.to)
      && (a.zoneGroupId ?? null) === zg && (a.zoneId ?? null) === zid));
    const created: CalendarActivity[] = items.map((it) => ({ activityId: this.activitySeq++, title: it.title, type: it.type, date: it.date, source: 'AI', zoneGroupId: zg, zoneId: zid, leadTimeDays: null, relatedPcId: null, notes: it.notes ?? null }));
    this.activities.push(...created);
    return created.map((a) => ({ ...a }));
  }

  // -------- execution: resolve / promote / async jobs --------
  async resolvePriceChange(pcId: number): Promise<{ skuCount: number; storeCount: number } | null> {
    const pc = this.priceChanges.find((p) => p.pcId === pcId); if (!pc) return null;
    pc.resolvedSkus = await this.resolveItems(pc.itemSelector);

    pc.resolvedStoreIds = await this.resolveStores(pc.locationSelector);
    return { skuCount: pc.resolvedSkus.length, storeCount: pc.resolvedStoreIds.length };
  }

  // -------- rezone: move store(s) into a zone and inherit that zone's prices --------
  private async resolveMovingStores(input: RezoneInput): Promise<number[]> {
    if (input.storeIds?.length) return [...new Set(input.storeIds)];
    if (input.locListId != null) { const l = this.locLists.find((x) => x.locListId === input.locListId); return l ? [...l.storeIds] : []; }
    if (input.fromZoneId != null) return [...(this.zoneMembers.get(`${input.toZoneGroupId}:${input.fromZoneId}`) ?? [])];
    return [];
  }
  // sku -> effective price for the given stores, from the latest PROMOTED price change covering them
  private overridesForStores(storeIds: number[]): Map<number, number> {
    const set = new Set(storeIds);
    const promoted = this.priceChanges
      .filter((p) => p.status === 'PROMOTED' && p.resolvedStoreIds.some((s) => set.has(s)))
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    const baseBySku = new Map(this.items.map((i) => [i.sku, i.currentRetail ?? null]));
    const out = new Map<number, number>();
    for (const pc of promoted) for (const sku of pc.resolvedSkus) {
      const price = pcPriceForSku(pc, sku, baseBySku.get(sku) ?? null);
      if (price != null) out.set(sku, price);
    }
    return out;
  }
  private async computeRezone(input: RezoneInput): Promise<{ movingStoreIds: number[]; toZoneName: string; lines: RezonePreviewLine[] }> {
    const movingStoreIds = await this.resolveMovingStores(input);
    const toZone = this.rawZones.find((z) => z.zoneGroupId === input.toZoneGroupId && z.zoneId === input.toZoneId);
    const toZoneName = toZone?.description ?? `Zone ${input.toZoneId}`;
    const targetStores = this.zoneMembers.get(`${input.toZoneGroupId}:${input.toZoneId}`) ?? [];
    const targetOverrides = this.overridesForStores(targetStores);
    const currentOverrides = this.overridesForStores(movingStoreIds);
    const baseBySku = new Map(this.items.map((i) => [i.sku, i.currentRetail ?? null]));
    const descBySku = new Map(this.items.map((i) => [i.sku, i.description]));
    const skus = new Set<number>([...targetOverrides.keys(), ...currentOverrides.keys()]);
    const lines: RezonePreviewLine[] = [];
    for (const sku of skus) {
      const base = baseBySku.get(sku) ?? null;
      const tp = targetOverrides.has(sku) ? targetOverrides.get(sku)! : base;
      const cp = currentOverrides.has(sku) ? currentOverrides.get(sku)! : base;
      if (tp != null && tp !== cp) lines.push({ sku, description: descBySku.get(sku) ?? '', currentRetail: cp, newRetail: tp });
    }
    lines.sort((a, b) => a.sku - b.sku);
    return { movingStoreIds, toZoneName, lines };
  }
  async previewRezone(input: RezoneInput): Promise<RezonePreview> {
    const r = await this.computeRezone(input);
    return { toZoneGroupId: input.toZoneGroupId, toZoneId: input.toZoneId, toZoneName: r.toZoneName, movingStoreIds: r.movingStoreIds, movingStoreCount: r.movingStoreIds.length, repriceCount: r.lines.length, sample: r.lines.slice(0, 200) };
  }
  async createRezone(input: RezoneInput): Promise<{ priceChange: PriceChange; preview: RezonePreview }> {
    const r = await this.computeRezone(input);
    const priceMap = r.lines.map((l) => ({ sku: l.sku, newRetail: l.newRetail }));
    const eff = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    const pc = await this.createPriceChange({
      pcName: `Rezone ${r.movingStoreIds.length} store(s) -> ${r.toZoneName}`,
      itemSelector: { mode: 'SKU_LIST', skus: priceMap.map((m) => m.sku) },
      locationSelector: { mode: 'STORES', storeIds: r.movingStoreIds },
      changeType: 'ZONE_INHERIT', amount: 0, roundingRule: 'NONE',
      effectiveDate: eff, reasonCode: null,
      priceMap, rezone: { toZoneGroupId: input.toZoneGroupId, toZoneId: input.toZoneId, fromZoneId: input.fromZoneId ?? null },
      createdBy: input.createdBy ?? 'rezone',
    });
    const preview: RezonePreview = { toZoneGroupId: input.toZoneGroupId, toZoneId: input.toZoneId, toZoneName: r.toZoneName, movingStoreIds: r.movingStoreIds, movingStoreCount: r.movingStoreIds.length, repriceCount: r.lines.length, sample: r.lines.slice(0, 200) };
    return { priceChange: pc, preview };
  }
  private applyRezoneMembership(pc: PriceChange): void {
    const rz = pc.rezone!; const movers = new Set(pc.resolvedStoreIds);
    for (const [k, ids] of this.zoneMembers.entries()) {
      const [zg] = k.split(':').map(Number);
      if (zg === rz.toZoneGroupId) { const filtered = ids.filter((sid) => !movers.has(sid)); if (filtered.length !== ids.length) this.zoneMembers.set(k, filtered); }
    }
    const tkey = `${rz.toZoneGroupId}:${rz.toZoneId}`;
    this.zoneMembers.set(tkey, [...new Set([...(this.zoneMembers.get(tkey) ?? []), ...pc.resolvedStoreIds])]);
  }
  async promotePriceChange(pcId: number): Promise<PriceChange | null> {
    const pc = this.priceChanges.find((p) => p.pcId === pcId); if (!pc) return null;
    if (pc.status !== 'APPROVED') throw new Error(`Price change ${pcId} is not APPROVED (status=${pc.status})`);
    pc.status = 'PROMOTED';
    if (pc.rezone) this.applyRezoneMembership(pc);
    return this.clonePc(pc);
  }
  async submitJob(pcId: number, jobType: JobType): Promise<PcJob> {
    const job: PcJob = { jobId: this.jobSeq++, pcId, jobType, status: 'QUEUED', skuCount: null, storeCount: null, message: null, createdAt: new Date().toISOString(), startedAt: null, finishedAt: null };
    this.jobs.push(job);
    // simulate async background execution (DBMS_SCHEDULER equivalent)
    setTimeout(async () => {
      job.status = 'RUNNING'; job.startedAt = new Date().toISOString();
      try {
        if (jobType === 'RESOLVE') { const r = await this.resolvePriceChange(pcId); job.skuCount = r?.skuCount ?? null; job.storeCount = r?.storeCount ?? null; }
        else { await this.promotePriceChange(pcId); }
        job.status = 'DONE';
      } catch (e: any) { job.status = 'FAILED'; job.message = String(e?.message ?? e); }
      job.finishedAt = new Date().toISOString();
    }, 40);
    return { ...job };
  }
  async getJob(jobId: number): Promise<PcJob | null> { const j = this.jobs.find((x) => x.jobId === jobId); return j ? { ...j } : null; }
  async listJobs(pcId?: number): Promise<PcJob[]> { return this.jobs.filter((j) => pcId === undefined || j.pcId === pcId).map((j) => ({ ...j })).reverse(); }

  private seed(): void {
    // ---- real merchandise hierarchy + item master from data files ----
    this.vendors = loadJson<Vendor[]>('vendors.json', []);
    const divs = loadJson<{ division: number; name: string }[]>('divisions.json', []);
    const grps = loadJson<{ groupNo: number; name: string; division: number }[]>('groups.json', []);
    const deps = loadJson<{ dept: number; name: string; groupNo: number | null }[]>('depts.json', []);
    const clss = loadJson<{ dept: number; cls: number; name: string }[]>('classes.json', []);
    const subs = loadJson<{ dept: number; cls: number; sub: number; name: string }[]>('subclasses.json', []);
    const its = loadJson<{ sku: number; desc: string; dept: number | null; cls: number | null; sub: number | null; retail: number | null; priceSource?: 'ITEM_MASTER'|'ESTIMATE'|'WEB'; promoPrice?: number | null; promoLabel?: string | null; promoMultiQty?: number | null; promoMultiPrice?: number | null }[]>('items.json', []);
    this.divisions = divs.map((d) => ({ division: d.division, name: d.name }));
    this.groups = grps.map((g) => ({ groupNo: g.groupNo, name: g.name, division: g.division }));
    for (const d of deps) this.deptGroup.set(d.dept, d.groupNo ?? -1);
    this.depts = deps.map((d) => ({ deptId: d.dept, deptName: d.name, groupNo: d.groupNo ?? null })).sort((a, b) => a.deptId - b.deptId);
    this.classes = clss.map((c) => ({ deptId: c.dept, classId: c.cls, className: c.name }));
    this.subclasses = subs.map((x) => ({ deptId: x.dept, classId: x.cls, subclassId: x.sub, subclassName: x.name }));
    const vlen = this.vendors.length || 1;
    this.items = its.map((it) => {
      const v = this.vendors[((it.sku % vlen) + vlen) % vlen];           // synth vendor — no supplier feed provided
      const retail = it.retail ?? null;
      const cost = retail != null ? Math.round(retail * 0.62 * 100) / 100 : null;  // est. cost from retail
      return { sku: it.sku, description: it.desc, deptId: it.dept, classId: it.cls, subclassId: it.sub, vendorId: v?.vendorId ?? null, vendorName: v?.vendorName ?? null, isDSD: v?.isDSD ?? false, cost, currentRetail: retail, priceSource: it.priceSource, promoPrice: it.promoPrice ?? null, promoLabel: it.promoLabel ?? null, promoMultiQty: it.promoMultiQty ?? null, promoMultiPrice: it.promoMultiPrice ?? null };
    });
    this.rebuildItemIndices();
    // item counts per node + roll-ups to group/division
    for (const it of this.items) {
      if (it.deptId == null) continue;
      this.cntDept.set(it.deptId, (this.cntDept.get(it.deptId) ?? 0) + 1);
      if (it.classId != null) this.cntClass.set(`${it.deptId}:${it.classId}`, (this.cntClass.get(`${it.deptId}:${it.classId}`) ?? 0) + 1);
      if (it.classId != null && it.subclassId != null) this.cntSub.set(`${it.deptId}:${it.classId}:${it.subclassId}`, (this.cntSub.get(`${it.deptId}:${it.classId}:${it.subclassId}`) ?? 0) + 1);
      const g = this.deptGroup.get(it.deptId);
      if (g != null && g !== -1) this.cntGroup.set(g, (this.cntGroup.get(g) ?? 0) + 1);
    }
    for (const g of this.groups) this.cntDiv.set(g.division, (this.cntDiv.get(g.division) ?? 0) + (this.cntGroup.get(g.groupNo) ?? 0));

    // real stores / zone groups / zones / membership from data files
    const rawStores = loadJson<RawStore[]>('stores.json', []);
    const region = config.app.regionByState; const fmt = config.app.formatNames;
    this.stores = rawStores.map((s) => ({
      storeId: s.storeId, name: s.name, city: s.city || null, state: s.state || null, storeClass: s.storeClass,
      districtId: s.district, districtName: s.district != null ? `District ${s.district}` : null,
      regionId: null, regionName: s.state ? (region[s.state] ?? 'Other') : null,
      formatId: s.format && /^\d+$/.test(s.format) ? Number(s.format) : null, formatName: s.format ? (fmt[s.format] ?? `Format ${s.format}`) : null,
      velocity: Math.round((0.2 + Math.random() * 0.8) * 100) / 100,
    }));
    const rawZg = loadJson<{ zoneGroupId: number; pricingLevel: string; description: string }[]>('zoneGroups.json', []);
    this.zoneGroups = rawZg.map((z) => ({ zoneGroupId: z.zoneGroupId, zoneGroupName: z.description, pricingLevel: z.pricingLevel }));
    this.rawZones = loadJson<RawZone[]>('zones.json', []);
    for (const [k, v] of Object.entries(loadJson<Record<string, number[]>>('zoneStores.json', {}))) this.zoneMembers.set(k, v);

    if (this.stores.length === 0) {
      for (let i = 0; i < 20; i++) this.stores.push({ storeId: 100 + i, name: `FAMILY DOLLAR #${i + 1}`, city: null, state: 'NC', storeClass: 'A', districtId: 1, districtName: 'District 1', regionId: null, regionName: 'Southeast', formatId: 30, formatName: 'Standard (30)', velocity: 0.5 });
    }

    // market location lists from config (no hardcoded definitions in source)
    const mkLL = (name: string, desc: string | undefined, ids: number[]) => { if (ids.length) this.locLists.push({ locListId: this.locListSeq++, locListName: name, description: desc ?? null, createdBy: 'config', createdAt: new Date().toISOString(), storeIds: ids }); };
    for (const m of config.app.marketLists) {
      let ids: number[] = [];
      if (m.type === 'state') ids = this.stores.filter((s) => s.state === m.code).map((s) => s.storeId);
      else if (m.type === 'metro') ids = this.stores.filter((s) => (s.city ?? '').toUpperCase() === (m.city ?? '').toUpperCase() && s.state === m.state).map((s) => s.storeId);
      else if (m.type === 'class') ids = this.stores.filter((s) => s.storeClass === m.code).map((s) => s.storeId);
      mkLL(m.name, m.description, ids);
    }

    const topDept = [...this.cntDept.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topDept != null) {
      const dn = this.depts.find((d) => d.deptId === topDept)?.deptName ?? `Dept ${topDept}`;
      this.skuLists.push({ skuListId: this.skuListSeq++, skuListName: `${dn} — sample`, description: `First 12 SKUs in dept ${topDept}`, createdBy: 'seed', createdAt: new Date().toISOString(), skus: this.items.filter((i) => i.deptId === topDept).slice(0, 12).map((i) => i.sku) });
    }
    const v1 = this.items.filter((i) => i.vendorId === 1).slice(0, 40).map((i) => i.sku);
    if (v1.length) this.skuLists.push({ skuListId: this.skuListSeq++, skuListName: 'Frito-Lay sample (40)', description: 'Sample of Frito-Lay-assigned SKUs', createdBy: 'seed', createdAt: new Date().toISOString(), skus: v1 });

    // ---- locality-relevant zone activities (read from the real zone -> store mapping) ----
    const calCfg = config.app.calendar;
    const storeRegionById = new Map(this.stores.map((st) => [st.storeId, st.regionName ?? 'Other']));
    // group every zone that actually has member stores, keyed by zone group
    const byGroup = new Map<number, { zoneId: number; members: number[] }[]>();
    for (const [k, v] of this.zoneMembers.entries()) {
      if (!v.length) continue;
      const [zg, zid] = k.split(':').map(Number);
      if (!byGroup.has(zg!)) byGroup.set(zg!, []);
      byGroup.get(zg!)!.push({ zoneId: zid!, members: v });
    }
    // choose a demo group: config preference if it has member zones (and is not per-store huge),
    // else the group with the most member-having zones in a sensible range, else any.
    let chosenGroup: number | null = null;
    const pref = byGroup.get(calCfg.demoZoneGroupId);
    if (pref && pref.length <= 60) chosenGroup = calCfg.demoZoneGroupId;
    if (chosenGroup == null) {
      let best = -1;
      for (const [zg, arr] of byGroup) { if (arr.length >= 2 && arr.length <= 60 && arr.length > best) { best = arr.length; chosenGroup = zg; } }
    }
    if (chosenGroup == null && byGroup.size) chosenGroup = [...byGroup.keys()][0]!;
    const chosenZones = (chosenGroup != null ? byGroup.get(chosenGroup) ?? [] : []).slice(0, calCfg.demoZoneCount);
    const zoneNameOf = (zid: number) => this.rawZones.find((z) => z.zoneGroupId === chosenGroup && z.zoneId === zid)?.description ?? `Zone ${zid}`;
    for (const { zoneId, members } of chosenZones) {
      const rc: Record<string, number> = {};
      for (const sid of members) { const r = storeRegionById.get(sid) ?? 'Other'; rc[r] = (rc[r] ?? 0) + 1; }
      const region = Object.entries(rc).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Other';
      const tpl = calCfg.regionSeasonal[region] ?? calCfg.regionSeasonal['Other'];
      if (!tpl) continue;
      this.activities.push({ activityId: this.activitySeq++, title: `${zoneNameOf(zoneId)}: ${tpl.title}`, type: tpl.type as CalendarActivity['type'], date: tpl.date, source: 'SEED', zoneGroupId: chosenGroup!, zoneId, relatedPcId: null, leadTimeDays: null, notes: `Locality: ${region} — derived from ${members.length.toLocaleString()} stores` });
    }

    const today = new Date(); const eff = new Date(today.getTime() + 14 * 86400_000).toISOString().slice(0, 10);
    const txList = this.locLists.find((l) => l.locListName.startsWith('TX'));
    void this.createPriceChange({
      pcName: 'Frito-Lay summer markdown — Texas (vendor-funded)',
      itemSelector: { mode: 'VENDOR', vendorId: 1 },
      locationSelector: txList ? { mode: 'LOCATION_LIST', locListId: txList.locListId } : { mode: 'STORES', storeIds: this.stores.slice(0, 10).map((x) => x.storeId) },
      changeType: 'MARKDOWN_PCT', amount: 15, roundingRule: 'ENDS_IN', endsIn: 0.99,
      fundedByVendor: true, dealId: 'FL-2026-0612', fundingVendorId: 1, fundingPct: 50, effectiveDate: eff, reasonCode: 9, createdBy: 'seed',
    });
    // demo: a promoted, zone-scoped base price so a target zone has distinct prices to inherit on rezone
    const zoneDemoSkus = this.items.filter((i) => i.deptId === 12).slice(0, 60).map((i) => i.sku);
    if (zoneDemoSkus.length && this.zoneMembers.has('8004:88')) {
      const past = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
      void this.createPriceChange({
        pcName: 'MILK 2.0 — Zone 88 base pricing',
        itemSelector: { mode: 'SKU_LIST', skus: zoneDemoSkus },
        locationSelector: { mode: 'ZONE', zoneGroupId: 8004, zoneId: 88 },
        changeType: 'SET_PRICE', amount: 1.5, roundingRule: 'NONE', effectiveDate: past, reasonCode: 1, createdBy: 'seed',
      }).then((pc) => this.updatePriceChangeStatus(pc.pcId, 'PROMOTED'));
    }
    const mk = (off: number, type: CalendarActivity['type'], title: string, notes?: string) => this.activities.push({ activityId: this.activitySeq++, title, type, source: 'SEED', date: new Date(today.getTime() + off * 86400_000).toISOString().slice(0, 10), notes: notes ?? null });
    mk(3, 'SPARC_STRIP_CHANGE', 'SPARC strip change — Week 1', 'Bi-weekly SPARC price strip refresh');
    mk(17, 'SPARC_STRIP_CHANGE', 'SPARC strip change — Week 3', 'Bi-weekly SPARC price strip refresh');
    mk(24, 'BLACKOUT', 'Memorial Day weekend — no price changes', 'High-traffic blackout window');
  }
}
