import { useEffect, useMemo, useState } from 'react';
import {
  api, type Item, type SkuList, type Dept, type MerchClass, type Subclass, type Vendor,
  type ItemSelector as ItemSel, type ItemMode,
} from '../lib/api';
import { MultiSelect, type MSOption } from './MultiSelect';

interface Props { value: ItemSel; onChange: (v: ItemSel) => void; }

type BaseUI = 'ALL' | 'SKUS' | 'LIST';
const BASES: { key: BaseUI; label: string }[] = [
  { key: 'ALL', label: 'All items' },
  { key: 'SKUS', label: 'Specific items' },
  { key: 'LIST', label: 'SKU List' },
];
const arr = (a?: number[], single?: number | null): number[] => (a?.length ? a : (single != null ? [single] : []));

export function ItemSelector({ value, onChange }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [skuLists, setSkuLists] = useState<SkuList[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [classes, setClasses] = useState<MerchClass[]>([]);
  const [subclasses, setSubclasses] = useState<Subclass[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [resolved, setResolved] = useState<number[]>([]);

  useEffect(() => { api.listItems().then(setItems); api.listSkuLists().then(setSkuLists); api.listDepts().then(setDepts); api.listVendors().then(setVendors); }, []);

  const deptIds = arr(value.deptIds, value.deptId);
  const classIds = arr(value.classIds, value.classId);
  const subIds = arr(value.subclassIds, value.subclassId);
  const vendorIds = arr(value.vendorIds, value.vendorId);
  const pricePts = value.pricePointEndsInList?.length ? value.pricePointEndsInList : (value.pricePointEndsIn != null ? [value.pricePointEndsIn] : []);
  const skus = arr(value.skus, value.sku);

  // dependent option fetching (union across selected depts / classes)
  useEffect(() => {
    if (!deptIds.length) { setClasses([]); return; }
    Promise.all(deptIds.map((d) => api.listClasses(d))).then((arrs) => {
      const m = new Map<number, MerchClass>(); for (const a of arrs) for (const c of a) if (!m.has(c.classId)) m.set(c.classId, c); setClasses([...m.values()]);
    });
  }, [JSON.stringify(deptIds)]);
  useEffect(() => {
    if (!deptIds.length || !classIds.length) { setSubclasses([]); return; }
    const pairs: [number, number][] = []; for (const d of deptIds) for (const c of classIds) pairs.push([d, c]);
    Promise.all(pairs.map(([d, c]) => api.listSubclasses(d, c))).then((arrs) => {
      const m = new Map<number, Subclass>(); for (const a of arrs) for (const sc of a) if (!m.has(sc.subclassId)) m.set(sc.subclassId, sc); setSubclasses([...m.values()]);
    });
  }, [JSON.stringify(deptIds), JSON.stringify(classIds)]);

  useEffect(() => { api.resolveItems(value).then((r) => setResolved(r.skus)).catch(() => setResolved([])); }, [JSON.stringify(value)]);

  const itemBySku = useMemo(() => new Map(items.map((i) => [i.sku, i])), [items]);
  function set(patch: Partial<ItemSel>) { onChange({ ...value, ...patch }); }

  const base: BaseUI = value.mode === 'ALL' ? 'ALL'
    : (value.mode === 'SKU_LIST' && value.skuListId != null) ? 'LIST'
    : (value.mode === 'SKU_LIST' || value.mode === 'SINGLE_SKU') ? 'SKUS' : 'ALL';
  function setBase(b: BaseUI) {
    if (b === 'ALL') onChange({ ...value, mode: 'ALL', sku: null, skuListId: null, skus: undefined });
    else if (b === 'SKUS') onChange({ ...value, mode: 'SKU_LIST', sku: null, skuListId: null });
    else onChange({ ...value, mode: 'SKU_LIST', sku: null, skus: undefined });
  }

  const [baseSet, setBaseSet] = useState<number[]>([]);
  useEffect(() => { api.resolveItems({ ...value, exceptSkus: [] }).then((r) => setBaseSet(r.skus)).catch(() => setBaseSet([])); },
    [value.mode, JSON.stringify(value.skus), value.sku, value.skuListId, JSON.stringify(deptIds), JSON.stringify(classIds), JSON.stringify(subIds), JSON.stringify(pricePts), JSON.stringify(vendorIds)]);
  const excluded = new Set(value.exceptSkus ?? []);

  const activeFilters = [
    deptIds.length > 0 && 'hierarchy',
    vendorIds.length > 0 && 'vendor',
    pricePts.length > 0 && 'price point',
  ].filter(Boolean) as string[];

  const itemOpts: MSOption[] = items.map((i) => ({ value: i.sku, label: `${i.sku} — ${i.description}`, sub: i.currentRetail != null ? `$${i.currentRetail.toFixed(2)}` : undefined }));
  const deptOpts: MSOption[] = depts.map((d) => ({ value: d.deptId, label: `${d.deptId} ${d.deptName}`, sub: d.itemCount != null ? `${d.itemCount.toLocaleString()}` : undefined }));
  const classOpts: MSOption[] = classes.map((c) => ({ value: c.classId, label: `${c.classId} ${c.className}` }));
  const subOpts: MSOption[] = subclasses.map((s) => ({ value: s.subclassId, label: `${s.subclassId} ${s.subclassName}` }));
  const vendorOpts: MSOption[] = vendors.map((v) => ({ value: v.vendorId, label: v.vendorName, sub: v.isDSD ? 'DSD' : 'WHSE' }));
  const ppOpts: MSOption[] = [0.99, 0.49, 0.29, 0.0].map((p) => ({ value: p, label: `.${String(Math.round(p * 100)).padStart(2, '0')}` }));

  function searchItems(q: string) { api.listItems(q || undefined).then(setItems); }

  return (
    <div className="space-y-3">
      <div>
        <label className="fd-label">Base set</label>
        <div className="fd-seg">
          {BASES.map((m) => <button key={m.key} onClick={() => setBase(m.key)} className={`fd-seg-item ${base === m.key ? 'fd-seg-item-active' : ''}`}>{m.label}</button>)}
        </div>
      </div>

      {base === 'SKUS' && (
        <div>
          <label className="fd-label">Items — select one or more (searchable)</label>
          <MultiSelect options={itemOpts} selected={skus} onChange={(v) => set({ skus: v, sku: null })} onSearchChange={searchItems} placeholder="Search & pick items…" searchPlaceholder="Search by SKU or description…" />
        </div>
      )}
      {base === 'LIST' && (
        <select className="fd-input" value={value.skuListId ?? ''} onChange={(e) => set({ skuListId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Pick a saved SKU list…</option>
          {skuLists.map((l) => <option key={l.skuListId} value={l.skuListId}>{l.skuListName} ({l.skus.length})</option>)}
        </select>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">Refine — filters combine with AND (each filter allows multiple values)</span>
          {activeFilters.length > 0 && (
            <button className="text-[11px] text-slate-400 hover:underline"
              onClick={() => set({ deptIds: [], deptId: null, classIds: [], classId: null, subclassIds: [], subclassId: null, vendorIds: [], vendorId: null, pricePointEndsInList: [], pricePointEndsIn: null })}>clear filters</button>
          )}
        </div>

        <div>
          <label className="fd-label">Merchandise hierarchy</label>
          <div className="grid grid-cols-3 gap-2">
            <MultiSelect options={deptOpts} selected={deptIds} onChange={(v) => set({ deptIds: v, deptId: null, classIds: [], classId: null, subclassIds: [], subclassId: null })} placeholder="All depts" />
            <MultiSelect options={classOpts} selected={classIds} disabled={deptIds.length === 0} onChange={(v) => set({ classIds: v, classId: null, subclassIds: [], subclassId: null })} placeholder="All classes" />
            <MultiSelect options={subOpts} selected={subIds} disabled={classIds.length === 0} onChange={(v) => set({ subclassIds: v, subclassId: null })} placeholder="All subclasses" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="fd-label">Vendor</label>
            <MultiSelect options={vendorOpts} selected={vendorIds} onChange={(v) => set({ vendorIds: v, vendorId: null })} placeholder="Any vendor" searchPlaceholder="Search vendors…" />
          </div>
          <div>
            <label className="fd-label">Current price ends in</label>
            <MultiSelect options={ppOpts} selected={pricePts} onChange={(v) => set({ pricePointEndsInList: v, pricePointEndsIn: null })} placeholder="Any ending" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <span className="fd-pill bg-red-50 text-fd-red">{resolved.length.toLocaleString()} SKUs</span>
        {activeFilters.length > 0 && <span className="text-slate-400">filtered by {activeFilters.join(' + ')}</span>}
        {(value.exceptSkus?.length ?? 0) > 0 && <span className="text-slate-400">· {value.exceptSkus!.length} excluded</span>}
      </div>

      {baseSet.length > 1 && baseSet.length <= 500 && (
        <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
          <summary className="cursor-pointer select-none font-medium text-slate-600">Exceptions — exclude specific SKUs ({excluded.size})</summary>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {baseSet.map((sku) => {
              const it = itemBySku.get(sku);
              return (
                <label key={sku} className="flex items-center gap-2">
                  <input type="checkbox" checked={excluded.has(sku)} onChange={(e) => { const n = new Set(value.exceptSkus ?? []); if (e.target.checked) n.add(sku); else n.delete(sku); set({ exceptSkus: [...n] }); }} />
                  <span className={excluded.has(sku) ? 'text-slate-400 line-through' : 'text-slate-600'}>{sku} — {it?.description ?? '(unknown)'}</span>
                </label>
              );
            })}
          </div>
        </details>
      )}
      {baseSet.length > 500 && (
        <p className="text-[11px] text-slate-400">{baseSet.length.toLocaleString()} SKUs — too many to list individual exceptions; narrow with the filters above.</p>
      )}
    </div>
  );
}
