import { useEffect, useState } from 'react';
import {
  api, type Store, type ZoneGroup, type Zone, type LocationList,
  type RezonePreview, type RezoneInput, type RezonePreviewLine,
} from '../lib/api';

type Source = 'STORES' | 'LIST' | 'ZONE';
const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);

interface Props { onCreated: (pcId: number) => void; }

export function RezonePage({ onCreated }: Props) {
  const [zoneGroups, setZoneGroups] = useState<ZoneGroup[]>([]);
  const [lists, setLists] = useState<LocationList[]>([]);
  const [zgId, setZgId] = useState<number | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneQ, setZoneQ] = useState('');
  const [toZoneId, setToZoneId] = useState<number | null>(null);

  const [source, setSource] = useState<Source>('STORES');
  const [stores, setStores] = useState<Store[]>([]);
  const [storeQ, setStoreQ] = useState('');
  const [storeTotal, setStoreTotal] = useState(0);
  // Track moving stores as a Set of IDs (+ a label cache) so bulk "select all"
  // can add thousands without rendering every row.
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  const [labels, setLabels] = useState<Map<number, string>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const [locListId, setLocListId] = useState<number | null>(null);
  const [fromZoneId, setFromZoneId] = useState<number | null>(null);

  const [preview, setPreview] = useState<RezonePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.listZoneGroups().then(setZoneGroups); api.listLocationLists().then(setLists); }, []);
  useEffect(() => { if (zgId == null) { setZones([]); return; } const t = setTimeout(() => api.searchZones(zgId, { search: zoneQ || undefined, pageSize: 60 }).then((p) => setZones(p.rows)), 250); return () => clearTimeout(t); }, [zgId, zoneQ]);
  useEffect(() => {
    if (source !== 'STORES') return;
    const t = setTimeout(() => api.searchStores({ search: storeQ || undefined, pageSize: 100 }).then((p) => {
      setStores(p.rows); setStoreTotal(p.total);
      setLabels((prev) => { const m = new Map(prev); for (const s of p.rows) m.set(s.storeId, `${s.storeId} — ${s.name}${s.city ? ` · ${s.city}, ${s.state}` : ''}`); return m; });
    }), 250);
    return () => clearTimeout(t);
  }, [source, storeQ]);

  useEffect(() => {
    if (!buildInput()) { setPreview(null); return; }
    setLoading(true);
    api.previewRezone(buildInput()!).then(setPreview).catch(() => setPreview(null)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(buildInput())]);

  function buildInput(): RezoneInput | null {
    if (zgId == null || toZoneId == null) return null;
    const base = { toZoneGroupId: zgId, toZoneId };
    if (source === 'STORES') return pickedIds.length ? { ...base, storeIds: pickedIds } : null;
    if (source === 'LIST') return locListId != null ? { ...base, locListId } : null;
    if (source === 'ZONE') return fromZoneId != null ? { ...base, fromZoneId } : null;
    return null;
  }

  async function commit() {
    const input = buildInput(); if (!input) return;
    setBusy(true); setError(null);
    try { const { priceChange } = await api.rezone(input); onCreated(priceChange.pcId); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  function toggle(id: number) { setPickedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); }
  function addShown() { setPickedIds((p) => [...new Set([...p, ...stores.map((s) => s.storeId)])]); }
  async function selectAllMatching() {
    setSelectingAll(true);
    try {
      const { storeIds } = await api.searchStoreIds(storeQ || undefined);
      setPickedIds((p) => [...new Set([...p, ...storeIds])]);
    } finally { setSelectingAll(false); }
  }

  const ready = buildInput() != null;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-8 py-5">
        <h2 className="text-xl font-semibold text-slate-900">Reprice / Rezone a store</h2>
        <p className="mt-0.5 text-sm text-slate-500">Move one store, several stores, or a location list into a different zone. The stores inherit the new zone's prices via a price change that goes through approval.</p>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl space-y-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          <section className="fd-card p-5">
            <h3 className="fd-section-title mb-3">1 · Target zone (prices to inherit)</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select className="fd-input w-64" value={zgId ?? ''} onChange={(e) => { setZgId(e.target.value ? Number(e.target.value) : null); setToZoneId(null); setFromZoneId(null); setZoneQ(''); }}>
                <option value="">Zone group…</option>
                {zoneGroups.map((g) => <option key={g.zoneGroupId} value={g.zoneGroupId}>{g.zoneGroupId} — {g.zoneGroupName}</option>)}
              </select>
              {zgId != null && <input className="fd-input w-44" placeholder="Search zones…" value={zoneQ} onChange={(e) => setZoneQ(e.target.value)} />}
              {zgId != null && (
                <select className="fd-input w-60" value={toZoneId ?? ''} onChange={(e) => setToZoneId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Pick target zone…</option>
                  {zones.map((z) => <option key={z.zoneId} value={z.zoneId}>Zone {z.zoneId} — {z.zoneName} ({z.storeCount})</option>)}
                </select>
              )}
            </div>
          </section>

          <section className="fd-card p-5">
            <h3 className="fd-section-title mb-3">2 · Stores to move</h3>
            <div className="fd-seg mb-3 w-fit">
              {(['STORES', 'LIST', 'ZONE'] as Source[]).map((k) => (
                <button key={k} onClick={() => setSource(k)} className={`fd-seg-item ${source === k ? 'fd-seg-item-active' : ''}`}>{k === 'STORES' ? 'Stores' : k === 'LIST' ? 'Location list' : 'From a zone'}</button>
              ))}
            </div>

            {source === 'STORES' && (
              <div className="space-y-2">
                <input className="fd-input" placeholder="Search stores by name/city/id…" value={storeQ} onChange={(e) => setStoreQ(e.target.value)} />
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <button onClick={selectAllMatching} disabled={selectingAll} className="fd-btn fd-btn-ghost px-2 py-1 text-xs">
                    {selectingAll ? 'Selecting…' : `Select all ${storeTotal.toLocaleString()} matching`}
                  </button>
                  <button onClick={addShown} className="fd-btn fd-btn-ghost px-2 py-1 text-xs">Add {stores.length} shown</button>
                  {pickedIds.length > 0 && <button onClick={() => setPickedIds([])} className="text-fd-red hover:underline">Clear {pickedIds.length.toLocaleString()} selected</button>}
                </div>
                <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1">
                  {stores.map((s) => {
                    const on = pickedIds.includes(s.storeId);
                    return (
                      <button key={s.storeId} onClick={() => toggle(s.storeId)} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-50 ${on ? 'bg-red-50' : ''}`}>
                        <input type="checkbox" readOnly checked={on} />
                        <span className="font-medium text-slate-700">{s.storeId}</span> — {s.name}{s.city ? ` · ${s.city}, ${s.state}` : ''}
                      </button>
                    );
                  })}
                  {storeTotal > stores.length && <div className="px-2 py-1 text-[11px] text-slate-400">Showing {stores.length} of {storeTotal.toLocaleString()} — refine search or use “Select all matching”.</div>}
                </div>
                {pickedIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {pickedIds.slice(0, 25).map((id) => (
                      <span key={id} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-fd-red">
                        {labels.get(id) ? `${id}` : id}<button className="hover:text-red-800" onClick={() => toggle(id)}>×</button>
                      </span>
                    ))}
                    {pickedIds.length > 25 && <span className="text-[11px] text-slate-500">+{(pickedIds.length - 25).toLocaleString()} more</span>}
                  </div>
                )}
              </div>
            )}
            {source === 'LIST' && (
              <select className="fd-input" value={locListId ?? ''} onChange={(e) => setLocListId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Pick a saved location list…</option>
                {lists.map((l) => <option key={l.locListId} value={l.locListId}>{l.locListName} ({l.storeIds.length.toLocaleString()})</option>)}
              </select>
            )}
            {source === 'ZONE' && (
              <div>
                <p className="mb-1 text-[11px] text-slate-400">Move every store currently in this zone of the target group into the target zone.</p>
                <select className="fd-input" value={fromZoneId ?? ''} disabled={zgId == null} onChange={(e) => setFromZoneId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Pick a source zone…</option>
                  {zones.map((z) => <option key={z.zoneId} value={z.zoneId}>Zone {z.zoneId} — {z.zoneName} ({z.storeCount})</option>)}
                </select>
              </div>
            )}
          </section>

          <button onClick={commit} disabled={!ready || busy} className="fd-btn fd-btn-primary">{busy ? 'Creating…' : 'Move stores & create price change'}</button>

          {loading && <p className="text-sm text-slate-400">Previewing…</p>}
          {preview && (
            <section className="fd-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="fd-section-title">Preview</h3>
                <div className="flex gap-2 text-xs">
                  <span className="fd-pill bg-slate-100 text-slate-600">{preview.movingStoreCount.toLocaleString()} stores → {preview.toZoneName}</span>
                  <span className="fd-pill bg-red-50 text-fd-red">{preview.repriceCount.toLocaleString()} SKUs reprice</span>
                </div>
              </div>
              {preview.repriceCount === 0 ? (
                <p className="mt-3 text-xs text-slate-500">The target zone currently matches these stores' pricing, so no SKUs would change. Moving still updates zone membership (a price change with 0 lines is created for the move and approval trail).</p>
              ) : (
                <div className="mt-3 max-h-80 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Current</th><th className="px-3 py-2 text-right">New (zone)</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.sample.map((l: RezonePreviewLine) => (
                        <tr key={l.sku} className="hover:bg-slate-50/60">
                          <td className="px-3 py-1.5 text-slate-500">{l.sku}</td>
                          <td className="px-3 py-1.5 text-slate-700">{l.description}</td>
                          <td className="px-3 py-1.5 text-right text-slate-400 line-through">{money(l.currentRetail)}</td>
                          <td className="px-3 py-1.5 text-right font-medium text-fd-red">{money(l.newRetail)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.repriceCount > preview.sample.length && <div className="px-3 py-1.5 text-[11px] text-slate-400">Showing {preview.sample.length} of {preview.repriceCount.toLocaleString()} repriced SKUs.</div>}
                </div>
              )}
              <p className="mt-3 text-[11px] text-slate-400">Creating moves the stores and opens a price change in WORKSHEET status — it then goes through Submit → Approve → Promote. The membership move applies on promotion.</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
