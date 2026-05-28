import { useEffect, useState } from 'react';
import { api, type Dept, type GapReport, type ScrapeResponse, type CompetitorRival, type Item } from '../lib/api';

const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
const gapColor = (g: number) => g > 8 ? 'text-red-600' : g < -8 ? 'text-green-700' : 'text-slate-600';

export function CompetitorsPage() {
  const [kind, setKind] = useState<'ALL' | 'DEPT'>('DEPT');
  const [deptId, setDeptId] = useState<number | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [rivals, setRivals] = useState<CompetitorRival[]>([]);
  const [scope, setScope] = useState<Item[]>([]);
  const [gap, setGap] = useState<GapReport | null>(null);
  const [scrape, setScrape] = useState<ScrapeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>('');

  useEffect(() => { api.listDepts().then(setDepts); api.listRivals().then(setRivals); }, []);

  async function loadScope() {
    if (kind === 'DEPT' && deptId == null) return;
    // For the scope preview, fetch the first page of items matching the scope.
    // (The real gap report below works off whatever is cached in the API.)
    const sample = await api.listItems(); // capped to 500 by api client; good enough as a sample
    const filtered = kind === 'DEPT' ? sample.filter((i) => i.deptId === deptId) : sample;
    setScope(filtered.slice(0, 50));
    await refreshGap();
  }
  async function refreshGap() {
    const r = await api.gapReport({ kind, deptId: kind === 'DEPT' ? deptId : null, limit: 200 });
    setGap(r);
  }

  async function runScrape() {
    if (scope.length === 0) { setPhase('Pick a scope and load items first.'); return; }
    setBusy(true); setScrape(null); setPhase(`Scraping ${Math.min(25, scope.length)} SKUs × ${rivals.length} rivals — this can take 30–60s as we hit live sites…`);
    try {
      const out = await api.scrapeCompetitors({ skus: scope.slice(0, 25).map((i) => i.sku) });
      setScrape(out);
      const okCount = out.results.filter((r) => r.status === 'OK').length;
      const blockedNote = out.blockedRivals.length > 0 ? ` ${out.blockedRivals.join(', ')} blocked our crawler — try a different rival or query the real feed.` : '';
      setPhase(`Done: ${okCount} of ${out.results.length} requests returned a price.${blockedNote}`);
      await refreshGap();
    } catch (e: any) { setPhase(`Error: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-8 py-5">
        <h2 className="text-xl font-semibold text-slate-900">Competitor price intelligence</h2>
        <p className="mt-0.5 text-sm text-slate-500">Live scrape of {rivals.map((r) => r.name).join(', ') || 'configured rivals'} and gap-vs-FD report. Big-box retailers actively block crawlers, so coverage will be partial; the report shows whatever did come through.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="fd-seg">
            <button onClick={() => setKind('ALL')} className={`fd-seg-item ${kind === 'ALL' ? 'fd-seg-item-active' : ''}`}>All</button>
            <button onClick={() => setKind('DEPT')} className={`fd-seg-item ${kind === 'DEPT' ? 'fd-seg-item-active' : ''}`}>Department</button>
          </div>
          {kind === 'DEPT' && (
            <select className="fd-input w-72" value={deptId ?? ''} onChange={(e) => setDeptId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Pick a department…</option>
              {depts.map((d) => <option key={d.deptId} value={d.deptId}>{d.deptId} — {d.deptName}</option>)}
            </select>
          )}
          <button onClick={loadScope} disabled={kind === 'DEPT' && deptId == null} className="fd-btn fd-btn-ghost">Load scope</button>
          <button onClick={runScrape} disabled={busy || scope.length === 0} className="fd-btn fd-btn-primary">{busy ? 'Scraping…' : `Scrape competitor prices (${Math.min(25, scope.length)} SKUs)`}</button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-6xl space-y-5">
          {phase && <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{phase}</div>}

          {scrape && (
            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Most recent scrape</h3>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
                    <th className="px-3 py-2">SKU</th><th className="px-3 py-2">Rival</th><th className="px-3 py-2 text-right">Price</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Source</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {scrape.results.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/60">
                        <td className="px-3 py-1.5 text-slate-500">{r.sku}</td>
                        <td className="px-3 py-1.5 text-slate-700">{r.rivalName}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.price != null ? money(r.price) : <span className="text-slate-300">—</span>}</td>
                        <td className={`px-3 py-1.5 ${r.status === 'OK' ? 'text-green-700' : r.status === 'BLOCKED' ? 'text-red-700' : 'text-slate-500'}`}>{r.status}{r.message ? ` (${r.message})` : ''}</td>
                        <td className="px-3 py-1.5"><a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-fd-red">open ↗</a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {gap && (
            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">FD vs. competitor gap <span className="font-normal text-slate-400">({gap.totalCovered} items with data)</span></h3>
              {gap.lines.length === 0 ? (
                <p className="text-xs text-slate-400">No competitor prices cached for this scope yet. Run a scrape to populate it.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
                      <th className="px-3 py-2">Item</th><th className="px-3 py-2">Dept</th>
                      <th className="px-3 py-2 text-right">FD</th><th className="px-3 py-2 text-right">Avg competitor</th>
                      <th className="px-3 py-2 text-right">Gap</th><th className="px-3 py-2">Action</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {gap.lines.map((l) => (
                        <tr key={l.sku} className="hover:bg-slate-50/60">
                          <td className="px-3 py-1.5"><span className="block text-slate-700">{l.description}</span><span className="text-[11px] text-slate-400">{l.competitors.map((c) => `${c.rivalKey}: ${money(c.price)}`).join('  ·  ')}</span></td>
                          <td className="px-3 py-1.5 text-slate-500">{l.deptName}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(l.fdPrice)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{money(l.avgCompetitor)}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${gapColor(l.gapPct)}`}>{l.gapPct > 0 ? '+' : ''}{l.gapPct.toFixed(1)}%</td>
                          <td className={`px-3 py-1.5 ${gapColor(l.gapPct)}`}>{l.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
