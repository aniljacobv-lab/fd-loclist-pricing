import { useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import {
  api, type LocationList, type Store, type Zone, type ZoneGroup,
  type LocationSelector as LocSel, type LocationMode,
} from '../lib/api';

interface Props { value: LocSel; onChange: (v: LocSel) => void; }

const MODES: { key: LocationMode; label: string }[] = [
  { key: 'LOCATION_LIST', label: 'Location Lists' },
  { key: 'ZONE', label: 'Zones' },
  { key: 'STORES', label: 'Stores' },
];

// normalize legacy single fields into the multi arrays
function selectedListIds(v: LocSel): number[] { return v.locListIds?.length ? v.locListIds : (v.locListId != null ? [v.locListId] : []); }
function selectedZoneIds(v: LocSel): number[] { return v.zoneIds?.length ? v.zoneIds : (v.zoneId != null ? [v.zoneId] : []); }

export function LocationSelector({ value, onChange }: Props) {
  const [lists, setLists] = useState<LocationList[]>([]);
  const [zoneGroups, setZoneGroups] = useState<ZoneGroup[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneTotal, setZoneTotal] = useState(0);
  const [zoneFilter, setZoneFilter] = useState('');
  const [storeRows, setStoreRows] = useState<Store[]>([]);
  const [storeTotal, setStoreTotal] = useState(0);
  const [storeQuery, setStoreQuery] = useState('');
  const [resolvedCount, setResolvedCount] = useState(0);
  const [pickedZoneNames, setPickedZoneNames] = useState<Map<number, string>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);

  useEffect(() => {
    api.listLocationLists().then(setLists);
    api.listZoneGroups().then(setZoneGroups);
  }, []);

  // server-side store search (paged) when in STORES mode
  useEffect(() => {
    if (value.mode !== 'STORES') return;
    const t = setTimeout(() => {
      api.searchStores({ search: storeQuery || undefined, pageSize: 200 }).then((p) => { setStoreRows(p.rows); setStoreTotal(p.total); });
    }, 250);
    return () => clearTimeout(t);
  }, [value.mode, storeQuery]);

  // server-side zone search (paged) scoped to the chosen group
  useEffect(() => {
    if (value.mode !== 'ZONE' || value.zoneGroupId == null) { setZones([]); setZoneTotal(0); return; }
    const t = setTimeout(() => {
      api.searchZones(value.zoneGroupId!, { search: zoneFilter || undefined, pageSize: 60 }).then((p) => {
        setZones(p.rows); setZoneTotal(p.total);
        setPickedZoneNames((prev) => { const m = new Map(prev); for (const z of p.rows) m.set(z.zoneId, z.zoneName); return m; });
      });
    }, 250);
    return () => clearTimeout(t);
  }, [value.mode, value.zoneGroupId, zoneFilter]);

  useEffect(() => { api.resolveStores(value).then((r) => setResolvedCount(r.count)).catch(() => setResolvedCount(0)); }, [JSON.stringify(value)]);

  const storeById = useMemo(() => new Map(storeRows.map((s) => [s.storeId, s])), [storeRows]);
  function set(patch: Partial<LocSel>) { onChange({ ...value, ...patch }); }
  function setMode(mode: LocationMode) { onChange({ mode, exceptStoreIds: value.exceptStoreIds ?? [] }); }

  // Merge the grid's page selection with any out-of-page picks (so toggling a row
  // on the visible page never wipes a prior "select all matching" of thousands).
  function mergeGridSelection(gridSelected: number[]) {
    const loaded = new Set(storeRows.map((s) => s.storeId));
    const kept = (value.storeIds ?? []).filter((id) => !loaded.has(id));
    set({ storeIds: [...new Set([...kept, ...gridSelected])] });
  }
  async function selectAllMatchingStores() {
    setSelectingAll(true);
    try { const { storeIds } = await api.searchStoreIds(storeQuery || undefined); set({ storeIds: [...new Set([...(value.storeIds ?? []), ...storeIds])] }); }
    finally { setSelectingAll(false); }
  }

  const listIds = selectedListIds(value);
  const zoneIds = selectedZoneIds(value);

  function toggleList(id: number) {
    const next = new Set(listIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ locListIds: [...next], locListId: null });
  }
  function toggleZone(id: number) {
    const next = new Set(zoneIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ zoneIds: [...next], zoneId: null });
  }

  const [baseSet, setBaseSet] = useState<number[]>([]);
  useEffect(() => { api.resolveStores({ ...value, exceptStoreIds: [] }).then((r) => setBaseSet(r.storeIds)).catch(() => setBaseSet([])); },
    [value.mode, JSON.stringify(value.locListIds), value.locListId, value.zoneGroupId, JSON.stringify(value.zoneIds), value.zoneId, JSON.stringify(value.storeIds)]);
  const excluded = new Set(value.exceptStoreIds ?? []);

  const cols: ColDef<Store>[] = useMemo(() => [
    { headerCheckboxSelection: true, checkboxSelection: true, width: 48, pinned: 'left' },
    { headerName: 'Store', field: 'storeId', width: 90 },
    { headerName: 'Name', field: 'name', flex: 1, minWidth: 150 },
    { headerName: 'City', field: 'city', width: 130 },
    { headerName: 'State', field: 'state', width: 70 },
    { headerName: 'Region', field: 'regionName', width: 120 },
    { headerName: 'Class', field: 'storeClass', width: 70 },
  ], []);

  return (
    <div className="space-y-3">
      <div className="fd-seg">
        {MODES.map((m) => <button key={m.key} onClick={() => setMode(m.key)} className={`fd-seg-item ${value.mode === m.key ? 'fd-seg-item-active' : ''}`}>{m.label}</button>)}
      </div>

      {value.mode === 'LOCATION_LIST' && (
        <div className="space-y-2">
          <p className="text-[11px] text-slate-400">Select one or more saved location lists — their stores are combined (union).</p>
          <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1">
            {lists.length === 0 && <div className="px-2 py-1 text-xs text-slate-400">No saved location lists.</div>}
            {lists.map((l) => (
              <label key={l.locListId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-50">
                <input type="checkbox" checked={listIds.includes(l.locListId)} onChange={() => toggleList(l.locListId)} />
                <span className="font-medium text-slate-700">{l.locListName}</span>
                <span className="text-slate-400">({l.storeIds.length.toLocaleString()})</span>
              </label>
            ))}
          </div>
          {listIds.length > 1 && <p className="text-[11px] text-slate-500">{listIds.length} lists combined</p>}
        </div>
      )}

      {value.mode === 'ZONE' && (
        <div className="space-y-2">
          <select className="fd-input" value={value.zoneGroupId ?? ''} onChange={(e) => { setZoneFilter(''); onChange({ mode: 'ZONE', zoneGroupId: e.target.value ? Number(e.target.value) : null, zoneIds: [], zoneId: null, exceptStoreIds: [] }); }}>
            <option value="">Pick a zone group…</option>
            {zoneGroups.map((g) => <option key={g.zoneGroupId} value={g.zoneGroupId}>{g.zoneGroupId} — {g.zoneGroupName}{g.pricingLevel === 'S' ? ' (store-level)' : ''}</option>)}
          </select>

          {value.zoneGroupId != null && (
            <>
              {zoneIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {zoneIds.map((zid) => (
                    <span key={zid} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-fd-red">
                      Zone {zid}{pickedZoneNames.get(zid) ? ` — ${pickedZoneNames.get(zid)}` : ''}
                      <button className="hover:text-red-800" onClick={() => toggleZone(zid)}>×</button>
                    </span>
                  ))}
                  <button className="text-[11px] text-slate-400 hover:underline" onClick={() => set({ zoneIds: [], zoneId: null })}>clear all</button>
                </div>
              )}
              <input className="fd-input" placeholder={`Search ${zoneTotal.toLocaleString()} zones by name or id…`} value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} />
              <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1">
                {zones.map((z) => (
                  <label key={z.zoneId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-50">
                    <input type="checkbox" checked={zoneIds.includes(z.zoneId)} onChange={() => toggleZone(z.zoneId)} />
                    <span className="font-medium text-slate-700">Zone {z.zoneId}</span> — {z.zoneName} <span className="text-slate-400">({z.storeCount})</span>
                  </label>
                ))}
                {zoneTotal > zones.length && <div className="px-2 py-1 text-[11px] text-slate-400">Showing {zones.length} of {zoneTotal.toLocaleString()} — refine search</div>}
              </div>
            </>
          )}
        </div>
      )}

      {value.mode === 'STORES' && (
        <div className="space-y-2">
          <input className="fd-input" placeholder="Search stores by name, city, state, or id…" value={storeQuery} onChange={(e) => setStoreQuery(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button onClick={selectAllMatchingStores} disabled={selectingAll} className="fd-btn fd-btn-ghost px-2 py-1 text-xs">
              {selectingAll ? 'Selecting…' : `Select all ${storeTotal.toLocaleString()} matching`}
            </button>
            {(value.storeIds?.length ?? 0) > 0 && <button onClick={() => set({ storeIds: [] })} className="text-fd-red hover:underline">Clear {(value.storeIds!.length).toLocaleString()} selected</button>}
          </div>
          <div className="ag-theme-quartz overflow-hidden rounded-lg border border-slate-200" style={{ height: 300 }}>
            <AgGridReact<Store>
              rowData={storeRows} columnDefs={cols} rowSelection="multiple" suppressRowClickSelection
              onGridReady={(e) => { const sel = new Set(value.storeIds ?? []); e.api.forEachNode((n) => { if (n.data && sel.has(n.data.storeId)) n.setSelected(true, false); }); }}
              onSelectionChanged={(e) => mergeGridSelection(e.api.getSelectedRows().map((r) => r.storeId))}
            />
          </div>
          <p className="text-[11px] text-slate-400">{(value.storeIds?.length ?? 0).toLocaleString()} selected · showing {storeRows.length.toLocaleString()} of {storeTotal.toLocaleString()} matching — use the header checkbox to select the page, or “Select all matching”.</p>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs">
        <span className="fd-pill bg-red-50 text-fd-red">{resolvedCount.toLocaleString()} stores</span>
        {excluded.size > 0 && <span className="text-slate-400">{excluded.size} excluded</span>}
        {resolvedCount === 0 && (
          <span className="text-amber-600">
            {value.mode === 'LOCATION_LIST' && 'Select at least one location list above.'}
            {value.mode === 'ZONE' && (value.zoneGroupId == null ? 'Pick a zone group, then check one or more zones.' : 'Check one or more zones above.')}
            {value.mode === 'STORES' && 'Select at least one store above.'}
          </span>
        )}
      </div>

      {(value.mode === 'LOCATION_LIST' || value.mode === 'ZONE') && baseSet.length > 1 && baseSet.length <= 500 && (
        <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-xs">
          <summary className="cursor-pointer select-none font-medium text-slate-600">Exceptions — exclude specific stores ({excluded.size})</summary>
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {baseSet.map((sid) => {
              const s = storeById.get(sid);
              return (
                <label key={sid} className="flex items-center gap-2">
                  <input type="checkbox" checked={excluded.has(sid)} onChange={(e) => { const n = new Set(value.exceptStoreIds ?? []); if (e.target.checked) n.add(sid); else n.delete(sid); set({ exceptStoreIds: [...n] }); }} />
                  <span className={excluded.has(sid) ? 'text-slate-400 line-through' : 'text-slate-600'}>{sid}{s ? ` — ${s.name}${s.city ? ` · ${s.city}, ${s.state}` : ''}` : ''}</span>
                </label>
              );
            })}
          </div>
        </details>
      )}
      {(value.mode === 'LOCATION_LIST' || value.mode === 'ZONE') && baseSet.length > 500 && (
        <p className="text-[11px] text-slate-400">{baseSet.length.toLocaleString()} stores — too many to list individual exceptions; use a smaller zone or location list.</p>
      )}
    </div>
  );
}
