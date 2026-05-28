import { useEffect, useMemo, useState } from 'react';
import { api, type Dept, type MarkdownRecResponse, type MarkdownRec, type LocationSelector } from '../lib/api';

interface Props { onOpen: (pcId: number) => void; }

const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);

export function MarkdownsPage({ onOpen }: Props) {
  const [kind, setKind] = useState<'ALL' | 'DEPT'>('ALL');
  const [deptId, setDeptId] = useState<number | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [data, setData] = useState<MarkdownRecResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<'CHAIN' | 'STATE'>('CHAIN');
  const [state, setState] = useState('TX');

  useEffect(() => { api.listDepts().then(setDepts); }, []);

  async function refresh() {
    setLoading(true); setMsg(null);
    try { const r = await api.markdownRecs({ kind, deptId: kind === 'DEPT' ? deptId : null, limit: 200 }); setData(r); setSelected(new Set()); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  function toggle(sku: number) { const s = new Set(selected); s.has(sku) ? s.delete(sku) : s.add(sku); setSelected(s); }
  function toggleAll(visible: MarkdownRec[]) {
    if (visible.every((r) => selected.has(r.sku))) { const s = new Set(selected); visible.forEach((r) => s.delete(r.sku)); setSelected(s); }
    else { const s = new Set(selected); visible.forEach((r) => s.add(r.sku)); setSelected(s); }
  }

  async function generate() {
    if (selected.size === 0) { setMsg('Pick at least one SKU.'); return; }
    setGenerating(true); setMsg(null);
    try {
      let locSel: LocationSelector;
      if (scopeMode === 'CHAIN') {
        const ids = await api.searchStoreIds();
        locSel = { mode: 'STORES', storeIds: ids.storeIds, exceptStoreIds: [] };
      } else {
        const ids = await api.searchStoreIds(state);
        locSel = { mode: 'STORES', storeIds: ids.storeIds, exceptStoreIds: [] };
      }
      const out = await api.generateMarkdowns({ skus: [...selected], locationSelector: locSel, pcNameBase: `Markdown cadence ${new Date().toISOString().slice(0, 10)}` });
      setMsg(`Created ${out.priceChanges.length} linked price changes (${out.priceChanges[0]?.resolvedSkus.length ?? 0} SKUs × ${out.priceChanges[0]?.resolvedStoreIds.length ?? 0} stores). Open one to start the approval cycle.`);
      setSelected(new Set());
    } catch (e: any) { setMsg(`Error: ${e?.message ?? e}`); }
    finally { setGenerating(false); }
  }

  const visible = data?.recommendations ?? [];
  const anySelected = selected.size > 0;
  const allChecked = visible.length > 0 && visible.every((r) => selected.has(r.sku));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-8 py-5">
        <h2 className="text-xl font-semibold text-slate-900">Automated markdown cadence</h2>
        <p className="mt-0.5 text-sm text-slate-500">Slow movers detected from sell-through and weeks-on-hand. Generate a linked 25 → 50 → 75 markdown chain that enters the approval workflow.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="fd-seg">
            <button onClick={() => setKind('ALL')} className={`fd-seg-item ${kind === 'ALL' ? 'fd-seg-item-active' : ''}`}>All categories</button>
            <button onClick={() => setKind('DEPT')} className={`fd-seg-item ${kind === 'DEPT' ? 'fd-seg-item-active' : ''}`}>Department</button>
          </div>
          {kind === 'DEPT' && (
            <select className="fd-input w-72" value={deptId ?? ''} onChange={(e) => setDeptId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Pick a department…</option>
              {depts.map((d) => <option key={d.deptId} value={d.deptId}>{d.deptId} — {d.deptName}</option>)}
            </select>
          )}
          <button onClick={refresh} disabled={loading || (kind === 'DEPT' && deptId == null)} className="fd-btn fd-btn-ghost">{loading ? 'Loading…' : 'Refresh recommendations'}</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        {!data && <div className="text-sm text-slate-400">Loading…</div>}
        {data && (
          <div className="mx-auto max-w-6xl space-y-5">
            <div className="fd-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-800">{data.totalSlowMovers.toLocaleString()}</span> slow movers
                  <span className="text-slate-400"> · sell-through &lt; {data.thresholds.slowSellThroughPct}% AND weeks-on-hand &gt; {data.thresholds.slowWeeksOnHandMin}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Apply to:</span>
                  <div className="fd-seg">
                    <button onClick={() => setScopeMode('CHAIN')} className={`fd-seg-item ${scopeMode === 'CHAIN' ? 'fd-seg-item-active' : ''}`}>Chain-wide</button>
                    <button onClick={() => setScopeMode('STATE')} className={`fd-seg-item ${scopeMode === 'STATE' ? 'fd-seg-item-active' : ''}`}>State</button>
                  </div>
                  {scopeMode === 'STATE' && <input className="fd-input w-16 uppercase" value={state} maxLength={2} onChange={(e) => setState(e.target.value.toUpperCase())} />}
                  <button onClick={generate} disabled={!anySelected || generating} className="fd-btn fd-btn-primary">{generating ? 'Generating…' : `Generate ${selected.size || 'markdowns'} →`}</button>
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">{data.note}</p>
              {msg && <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{msg}</div>}
            </div>

            <div className="fd-card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2"><input type="checkbox" checked={allChecked} onChange={() => toggleAll(visible)} /></th>
                    <th className="px-3 py-2">SKU · Item</th>
                    <th className="px-3 py-2">Dept</th>
                    <th className="px-3 py-2 text-right">Current</th>
                    <th className="px-3 py-2 text-right">Sell-through</th>
                    <th className="px-3 py-2 text-right">WoH</th>
                    {data.schedule.map((s) => <th key={s.stepNo} className="px-3 py-2 text-right">{s.markdownPct}% off (+{s.afterDays}d)</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r) => (
                    <tr key={r.sku} className={`hover:bg-slate-50/60 ${selected.has(r.sku) ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(r.sku)} onChange={() => toggle(r.sku)} /></td>
                      <td className="px-3 py-2"><span className="block font-medium text-slate-700">{r.description}</span><span className="text-[11px] text-slate-400">{r.sku}</span></td>
                      <td className="px-3 py-2 text-slate-500">{r.deptName}</td>
                      <td className="px-3 py-2 text-right text-slate-700">{money(r.currentRetail)}</td>
                      <td className="px-3 py-2 text-right text-red-600">{r.sellThroughPct.toFixed(0)}%</td>
                      <td className="px-3 py-2 text-right text-amber-700">{r.weeksOnHand.toFixed(1)}w</td>
                      {r.steps.map((s) => <td key={s.stepNo} className="px-3 py-2 text-right text-slate-600">{money(s.newRetail)}</td>)}
                    </tr>
                  ))}
                  {visible.length === 0 && <tr><td colSpan={6 + data.schedule.length} className="px-3 py-4 text-center text-xs text-slate-400">No slow movers in this scope right now — good news.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
