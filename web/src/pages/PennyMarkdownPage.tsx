import { useEffect, useState } from 'react';
import { api, type Dept, type PennyMarkdownResponse, type PennyCandidate, type PennyMarkdownGenerateResponse } from '../lib/api';

interface Props { onOpen: (pcId: number) => void; }

const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
const severityStyle = (s: number): string => s >= 5 ? 'bg-red-100 text-red-800' : s === 4 ? 'bg-red-50 text-red-700' : s === 3 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';

export function PennyMarkdownPage({ onOpen }: Props) {
  const [kind, setKind] = useState<'ALL' | 'DEPT'>('ALL');
  const [deptId, setDeptId] = useState<number | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [useAi, setUseAi] = useState(true);
  const [data, setData] = useState<PennyMarkdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notes, setNotes] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<PennyMarkdownGenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => { api.listDepts().then(setDepts); }, []);

  async function refresh() {
    setLoading(true); setError(null); setResult(null);
    try { const r = await api.pennyRecs({ kind, deptId: kind === 'DEPT' ? deptId : null, useAi, limit: 100 }); setData(r); setSelected(new Set()); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  function toggle(sku: number) { const s = new Set(selected); s.has(sku) ? s.delete(sku) : s.add(sku); setSelected(s); }
  function toggleAll(visible: PennyCandidate[]) {
    if (visible.every((r) => selected.has(r.sku))) { const s = new Set(selected); visible.forEach((r) => s.delete(r.sku)); setSelected(s); }
    else { const s = new Set(selected); visible.forEach((r) => s.add(r.sku)); setSelected(s); }
  }
  function selectBySeverity(min: number) {
    const visible = data?.recommendations ?? [];
    const s = new Set<number>(); visible.forEach((r) => { if (r.severity >= min) s.add(r.sku); });
    setSelected(s);
  }

  async function generate() {
    if (selected.size === 0) { setError('Pick at least one SKU.'); return; }
    if (!confirmed) { setError('Tick the destruction confirmation first.'); return; }
    setGenerating(true); setError(null);
    try {
      const out = await api.pennyGenerate({ skus: [...selected], notes: notes || null });
      setResult(out);
      setSelected(new Set()); setNotes(''); setConfirmed(false);
    } catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setGenerating(false); }
  }

  const visible = data?.recommendations ?? [];
  const allChecked = visible.length > 0 && visible.every((r) => selected.has(r.sku));
  const selectedTotal = visible.filter((r) => selected.has(r.sku));

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-8 py-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-red-600 text-white text-sm">¢</span>
              Penny markdown — destruction queue
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">Items repriced to $0.01 to flag at the register for shelf pull + destruction. Use AI suggestions or hand-pick SKUs, then generate a SkuList, LocationList, and the destruction price change in one shot. The change routes to VP approval automatically.</p>
          </div>
          {data && <span className="fd-pill bg-slate-100 text-slate-600">{data.totalCandidates.toLocaleString()} candidates</span>}
        </div>
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
          <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> AI ranking</label>
          <button onClick={refresh} disabled={loading || (kind === 'DEPT' && deptId == null)} className="fd-btn fd-btn-ghost">{loading ? 'Analyzing…' : 'Refresh'}</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-6xl space-y-5">
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

          {result && (
            <section className="fd-card border-l-4 border-l-red-600 p-5">
              <h3 className="fd-section-title mb-2">Destruction batch created</h3>
              <div className="space-y-1 text-sm text-slate-700">
                <div><span className="text-slate-400">SkuList:</span> <span className="font-medium">{result.skuList.skuListName}</span> ({result.skuList.skus.length} SKUs)</div>
                <div><span className="text-slate-400">LocationList:</span> <span className="font-medium">{result.locList.locListName}</span> ({result.locList.storeIds.length} stores)</div>
                <div><span className="text-slate-400">Price change:</span> <button onClick={() => onOpen(result.priceChange.pcId)} className="font-medium text-fd-red hover:underline">{result.priceChange.pcName}</button> · status {result.priceChange.status}</div>
              </div>
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{result.warning}</p>
              <button onClick={() => onOpen(result.priceChange.pcId)} className="fd-btn fd-btn-primary mt-3">Open price change for VP approval →</button>
            </section>
          )}

          {data && (
            <>
              <section className="fd-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-slate-600">
                    Showing <span className="font-semibold text-slate-800">{visible.length}</span> of {data.totalCandidates.toLocaleString()} candidates ·
                    sell-through &lt; {data.thresholds.extremeSellThroughPct}% AND weeks-on-hand &gt; {data.thresholds.extremeWeeksOnHandMin}
                    {data.aiUsed ? <span className="ml-2 fd-pill bg-blue-50 text-blue-700">AI-ranked</span> : <span className="ml-2 fd-pill bg-slate-100 text-slate-500">heuristic</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => selectBySeverity(5)} className="fd-btn fd-btn-ghost text-xs">Select severity 5</button>
                    <button onClick={() => selectBySeverity(4)} className="fd-btn fd-btn-ghost text-xs">Severity 4+</button>
                    <button onClick={() => setSelected(new Set())} className="fd-btn fd-btn-ghost text-xs">Clear</button>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{data.note}</p>
              </section>

              <section className="fd-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 w-8"><input type="checkbox" checked={allChecked} onChange={() => toggleAll(visible)} /></th>
                      <th className="px-3 py-2 w-16 text-center">Severity</th>
                      <th className="px-3 py-2">SKU · Item</th>
                      <th className="px-3 py-2">Dept</th>
                      <th className="px-3 py-2 text-right">Current</th>
                      <th className="px-3 py-2 text-right">Sell-through</th>
                      <th className="px-3 py-2 text-right">WoH</th>
                      <th className="px-3 py-2">Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visible.map((r) => (
                      <tr key={r.sku} className={`hover:bg-slate-50/60 ${selected.has(r.sku) ? 'bg-red-50/40' : ''}`}>
                        <td className="px-3 py-2"><input type="checkbox" checked={selected.has(r.sku)} onChange={() => toggle(r.sku)} /></td>
                        <td className="px-3 py-2 text-center"><span className={`fd-pill ${severityStyle(r.severity)}`}>{r.severity}</span></td>
                        <td className="px-3 py-2"><span className="block font-medium text-slate-700">{r.description}</span><span className="text-[11px] text-slate-400">{r.sku}</span></td>
                        <td className="px-3 py-2 text-slate-500">{r.deptName}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{money(r.currentRetail)}</td>
                        <td className="px-3 py-2 text-right text-red-600 tabular-nums">{r.sellThroughPct.toFixed(0)}%</td>
                        <td className="px-3 py-2 text-right text-amber-700 tabular-nums">{r.weeksOnHand.toFixed(0)}w</td>
                        <td className="px-3 py-2 text-slate-600 italic">{r.rationale}</td>
                      </tr>
                    ))}
                    {visible.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-slate-400">No extreme slow movers in this scope. (That's healthy.)</td></tr>}
                  </tbody>
                </table>
              </section>

              {selected.size > 0 && (
                <section className="fd-card border-2 border-red-200 p-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-red-700">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white text-xs">!</span>
                    Generate destruction batch
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    {selected.size} SKU{selected.size === 1 ? '' : 's'} selected. This will create a SkuList, a LocationList of stores carrying these items, and a SET_PRICE = ${data.thresholds.pennyPrice.toFixed(2)} price change. The change enters approval at WORKSHEET; the impact engine will route it to VP-tier sign-off automatically.
                  </p>
                  <div className="mt-3 max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs text-slate-600">
                    {selectedTotal.slice(0, 25).map((r) => <div key={r.sku}>· {r.description} <span className="text-slate-400">— {r.rationale}</span></div>)}
                    {selectedTotal.length > 25 && <div className="text-slate-400">…and {selectedTotal.length - 25} more</div>}
                  </div>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes for the audit trail (e.g. 'Q1 cleanup, vendor terminated 5/12')" className="fd-input mt-3 min-h-[52px] w-full text-sm" />
                  <label className="mt-3 flex items-start gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                    <span>I confirm these items should be flagged for shelf pull and destruction per FD policy. Items will be set to ${data.thresholds.pennyPrice.toFixed(2)} on approval.</span>
                  </label>
                  <button onClick={generate} disabled={generating || !confirmed} className="fd-btn fd-btn-primary mt-3 bg-red-600 hover:bg-red-700">{generating ? 'Creating…' : `Generate destruction batch (${selected.size} SKUs)`}</button>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
