import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  api, type Store, type ZoneGroup, type Zone, type Dept,
  type StoreView, type StoreViewScope, type StoreViewEvent, type SellThroughMatrix,
} from '../lib/api';

type Kind = 'STORE' | 'REGION' | 'ZONE' | 'DEPT';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'STORE', label: 'Store' },
  { key: 'REGION', label: 'Region' },
  { key: 'ZONE', label: 'Zone' },
  { key: 'DEPT', label: 'Department' },
];
const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
const changeLabel = (e: StoreViewEvent) =>
  e.changeType === 'MARKDOWN_PCT' ? `${e.amount}% off` : e.changeType === 'MARKDOWN_AMT' ? `$${e.amount.toFixed(2)} off` : `Set $${e.amount.toFixed(2)}`;

// Heat color for a sell-through cell: red (slow) → amber → green (fast), 25–85%.
const stLabel = (n: number | null) => (n == null ? '—' : `${n.toFixed(0)}%`);
function heat(rate: number | null): CSSProperties {
  if (rate == null) return { background: '#f8fafc', color: '#cbd5e1' };
  const t = Math.max(0, Math.min(1, (rate - 25) / 60));
  const hue = t * 130; // 0 = red, 130 = green
  return { background: `hsl(${hue}, 70%, 90%)`, color: `hsl(${hue}, 45%, 27%)` };
}

function SellThroughMatrixTable({ title, hint, matrix }: { title: string; hint: string; matrix: SellThroughMatrix }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="fd-label">{title}</div>
        <div className="text-[11px] text-slate-400">{hint}</div>
      </div>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Department</th>
              {matrix.columns.map((c) => <th key={c} className="px-2 py-2 text-center font-medium">{c}</th>)}
              <th className="px-3 py-2 text-center font-medium">Avg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {matrix.rows.map((r) => (
              <tr key={r.deptId}>
                <td className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-slate-700">{r.deptName}</td>
                {r.cells.map((v, i) => (
                  <td key={i} className="px-2 py-1.5 text-center tabular-nums" style={heat(v)} title={`${matrix.columns[i]}: ${stLabel(v)}`}>{stLabel(v)}</td>
                ))}
                <td className="px-3 py-1.5 text-center font-semibold tabular-nums" style={heat(r.avg)}>{stLabel(r.avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function StoreViewPage() {
  const [kind, setKind] = useState<Kind>('STORE');
  const [scope, setScope] = useState<StoreViewScope | null>(null);
  const [data, setData] = useState<StoreView | null>(null);
  const [loading, setLoading] = useState(false);

  // pickers
  const [stores, setStores] = useState<Store[]>([]);
  const [storeQ, setStoreQ] = useState('');
  const [regions, setRegions] = useState<{ region: string; storeCount: number }[]>([]);
  const [zoneGroups, setZoneGroups] = useState<ZoneGroup[]>([]);
  const [zgId, setZgId] = useState<number | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneQ, setZoneQ] = useState('');
  const [depts, setDepts] = useState<Dept[]>([]);

  useEffect(() => { api.listRegions().then(setRegions); api.listZoneGroups().then(setZoneGroups); api.listDepts().then(setDepts); }, []);
  useEffect(() => { if (kind !== 'STORE') return; const t = setTimeout(() => api.searchStores({ search: storeQ || undefined, pageSize: 30 }).then((p) => setStores(p.rows)), 250); return () => clearTimeout(t); }, [kind, storeQ]);
  useEffect(() => { if (kind !== 'ZONE' || zgId == null) { setZones([]); return; } const t = setTimeout(() => api.searchZones(zgId, { search: zoneQ || undefined, pageSize: 40 }).then((p) => setZones(p.rows)), 250); return () => clearTimeout(t); }, [kind, zgId, zoneQ]);

  useEffect(() => {
    if (!scope) { setData(null); return; }
    setLoading(true);
    api.storeView(scope).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [JSON.stringify(scope)]);

  function reset() { setScope(null); setData(null); }

  const maxTop = useMemo(() => Math.max(1, ...(data?.topPricePoints ?? []).map((p) => p.count)), [data]);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-8 py-5">
        <h2 className="text-xl font-semibold text-slate-900">My View</h2>
        <p className="mt-0.5 text-sm text-slate-500">Current price points by category, plus promotions and clearances running — for a store, region, zone, or department.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="fd-seg">
            {KINDS.map((k) => <button key={k.key} onClick={() => { setKind(k.key); reset(); }} className={`fd-seg-item ${kind === k.key ? 'fd-seg-item-active' : ''}`}>{k.label}</button>)}
          </div>

          {kind === 'STORE' && (
            <div className="flex items-center gap-2">
              <input className="fd-input w-64" placeholder="Search store by name/city/id…" value={storeQ} onChange={(e) => setStoreQ(e.target.value)} />
              <select className="fd-input w-72" value={scope?.kind === 'STORE' ? scope.storeId : ''} onChange={(e) => e.target.value && setScope({ kind: 'STORE', storeId: Number(e.target.value) })}>
                <option value="">Pick a store…</option>
                {stores.map((s) => <option key={s.storeId} value={s.storeId}>{s.storeId} — {s.name}{s.city ? ` · ${s.city}, ${s.state}` : ''}</option>)}
              </select>
            </div>
          )}
          {kind === 'REGION' && (
            <select className="fd-input w-72" value={scope?.kind === 'REGION' ? scope.region : ''} onChange={(e) => e.target.value && setScope({ kind: 'REGION', region: e.target.value })}>
              <option value="">Pick a region…</option>
              {regions.map((r) => <option key={r.region} value={r.region}>{r.region} ({r.storeCount.toLocaleString()} stores)</option>)}
            </select>
          )}
          {kind === 'ZONE' && (
            <div className="flex items-center gap-2">
              <select className="fd-input w-60" value={zgId ?? ''} onChange={(e) => { setZgId(e.target.value ? Number(e.target.value) : null); setZoneQ(''); }}>
                <option value="">Zone group…</option>
                {zoneGroups.map((g) => <option key={g.zoneGroupId} value={g.zoneGroupId}>{g.zoneGroupId} — {g.zoneGroupName}</option>)}
              </select>
              {zgId != null && <input className="fd-input w-44" placeholder="Search zones…" value={zoneQ} onChange={(e) => setZoneQ(e.target.value)} />}
              {zgId != null && (
                <select className="fd-input w-56" value={scope?.kind === 'ZONE' ? scope.zoneId : ''} onChange={(e) => e.target.value && setScope({ kind: 'ZONE', zoneGroupId: zgId, zoneId: Number(e.target.value) })}>
                  <option value="">Pick a zone…</option>
                  {zones.map((z) => <option key={z.zoneId} value={z.zoneId}>Zone {z.zoneId} — {z.zoneName} ({z.storeCount})</option>)}
                </select>
              )}
            </div>
          )}
          {kind === 'DEPT' && (
            <select className="fd-input w-80" value={scope?.kind === 'DEPT' ? scope.deptId : ''} onChange={(e) => e.target.value && setScope({ kind: 'DEPT', deptId: Number(e.target.value) })}>
              <option value="">Pick a department…</option>
              {depts.map((d) => <option key={d.deptId} value={d.deptId}>{d.deptId} — {d.deptName} ({(d.itemCount ?? 0).toLocaleString()})</option>)}
            </select>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        {!scope && <div className="text-sm text-slate-400">Select a {kind.toLowerCase()} above to see its price points, promotions, and clearances.</div>}
        {scope && loading && <div className="text-sm text-slate-400">Loading…</div>}
        {scope && !loading && data && (
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="fd-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800">{data.scope.label}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {data.scope.storeCount.toLocaleString()} stores · {data.itemCount.toLocaleString()} items priced · {data.webPromotionsTotal.toLocaleString()} on weekly ad
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="fd-pill bg-amber-50 text-amber-700">{data.promotions.length} promotions</span>
                  <span className="fd-pill bg-red-50 text-fd-red">{data.clearances.length} clearances</span>
                </div>
              </div>
              {data.topPricePoints.length > 0 && (
                <div className="mt-4">
                  <div className="fd-label">Most common price points</div>
                  <div className="mt-2 flex items-end gap-2" style={{ height: 90 }}>
                    {data.topPricePoints.map((p) => (
                      <div key={p.price} className="flex flex-1 flex-col items-center justify-end" title={`${p.count.toLocaleString()} items at ${money(p.price)}`}>
                        <div className="w-full rounded-t bg-fd-red/80" style={{ height: `${Math.max(4, (p.count / maxTop) * 70)}px` }} />
                        <div className="mt-1 text-[10px] text-slate-500">{money(p.price)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {data.sellThrough && (
              <section className="fd-card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="fd-section-title">Sell-through matrix</h3>
                  {data.sellThrough.overallRate != null && (
                    <span className="text-xs text-slate-500">Scope average <span className="font-semibold text-slate-700">{data.sellThrough.overallRate.toFixed(0)}%</span></span>
                  )}
                </div>
                {data.sellThrough.simulated && <p className="mt-0.5 text-[11px] text-slate-400">{data.sellThrough.note}</p>}

                <div className="mt-4">
                  <div className="fd-label">Overall sell-through by week</div>
                  <div className="mt-2 flex items-end gap-2" style={{ height: 72 }}>
                    {data.sellThrough.overallByWeek.map((p) => {
                      const max = Math.max(1, ...data.sellThrough.overallByWeek.map((x) => x.rate ?? 0));
                      return (
                        <div key={p.week} className="flex flex-1 flex-col items-center justify-end" title={`Week ending ${p.week}: ${stLabel(p.rate)}`}>
                          <div className="text-[10px] font-medium text-slate-500">{stLabel(p.rate)}</div>
                          <div className="w-full rounded-t" style={{ height: `${Math.max(4, ((p.rate ?? 0) / max) * 48)}px`, ...heat(p.rate) }} />
                          <div className="mt-1 text-[10px] text-slate-400">{p.week}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-5 space-y-5">
                  <SellThroughMatrixTable title="By category × week" hint="Sell-through % over the last 6 weeks" matrix={data.sellThrough.byWeek} />
                  <SellThroughMatrixTable title="By category × price band" hint="Sell-through % by price point" matrix={data.sellThrough.byBand} />
                </div>
              </section>
            )}

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Price points by category</h3>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr><th className="px-3 py-2">Department</th><th className="px-3 py-2 text-right">Items</th><th className="px-3 py-2 text-right">Range</th><th className="px-3 py-2 text-right">Avg</th><th className="px-3 py-2">Top price points</th><th className="px-3 py-2 text-right">On ad</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.categories.map((c) => (
                      <tr key={c.deptId} className="hover:bg-slate-50/60">
                        <td className="px-3 py-2 font-medium text-slate-700">{c.deptName}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{c.itemCount.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{money(c.minRetail)}–{money(c.maxRetail)}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{money(c.avgRetail)}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1">
                            {c.pricePoints.slice(0, 5).map((p) => <span key={p.price} className="fd-pill bg-slate-100 text-slate-600">{money(p.price)} ×{p.count.toLocaleString()}</span>)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{c.promoCount > 0 ? <span className="fd-pill bg-amber-50 text-amber-700">{c.promoCount}</span> : <span className="text-slate-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Promotions running <span className="font-normal text-slate-400">({data.webPromotions.length} weekly-ad items{data.promotions.length ? ` · ${data.promotions.length} price events` : ''})</span></h3>
              {data.promotions.length > 0 && (
                <div className="mb-3 space-y-1">
                  {data.promotions.map((e) => (
                    <div key={e.pcId} className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2 text-xs">
                      <span className="font-medium text-slate-700">{e.pcName}</span>
                      <span className="text-slate-500">{changeLabel(e)}{e.fundedByVendor ? ' · vendor-funded' : ''} · {e.skuCount} SKUs × {e.storesInScope} stores · eff {e.effectiveDate}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.webPromotions.length === 0 && data.promotions.length === 0 && <p className="text-xs text-slate-400">No promotions running in this scope.</p>}
              {data.webPromotions.length > 0 && (
                <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-3 py-2">SKU</th><th className="px-3 py-2">Item</th><th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Reg.</th><th className="px-3 py-2 text-right">Promo</th><th className="px-3 py-2">Offer</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.webPromotions.map((p) => (
                        <tr key={p.sku} className="hover:bg-slate-50/60">
                          <td className="px-3 py-1.5 text-slate-500">{p.sku}</td>
                          <td className="px-3 py-1.5 text-slate-700">{p.description}</td>
                          <td className="px-3 py-1.5 text-slate-500">{p.deptName}</td>
                          <td className="px-3 py-1.5 text-right text-slate-400 line-through">{money(p.currentRetail)}</td>
                          <td className="px-3 py-1.5 text-right font-medium text-fd-red">{money(p.promoPrice)}</td>
                          <td className="px-3 py-1.5 text-slate-500">{p.promoLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Clearances running <span className="font-normal text-slate-400">({data.clearances.length})</span></h3>
              {data.clearances.length === 0 ? (
                <p className="text-xs text-slate-400">No clearance markdowns active in this scope.</p>
              ) : (
                <div className="space-y-1">
                  {data.clearances.map((e) => (
                    <div key={e.pcId} className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50/40 px-3 py-2 text-xs">
                      <span className="font-medium text-slate-700">{e.pcName}</span>
                      <span className="text-slate-500">{changeLabel(e)} · {e.skuCount} SKUs × {e.storesInScope} stores · eff {e.effectiveDate}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
