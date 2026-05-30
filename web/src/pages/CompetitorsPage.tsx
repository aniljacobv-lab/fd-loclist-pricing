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

  // CSV upload state
  const [csvText, setCsvText] = useState('');
  const [uploadResult, setUploadResult] = useState<{ inserted: number; errors: { row: number; line: string; reason: string }[]; totalLines: number } | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  // AI lookup state
  const [lookupSku, setLookupSku] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  // Provider status
  const [provider, setProvider] = useState<{ active: string; provider: string; hasKey: boolean } | null>(null);

  useEffect(() => {
    api.listDepts().then(setDepts);
    api.listRivals().then(setRivals);
    api.competitorProviderStatus().then(setProvider).catch(() => setProvider(null));
  }, []);

  async function doUpload() {
    if (!csvText.trim()) return;
    setUploadBusy(true); setUploadResult(null);
    try { setUploadResult(await api.uploadCompetitorCsv(csvText.trim())); await refreshGap(); }
    catch (e: any) { setUploadResult({ inserted: 0, errors: [{ row: 0, line: '', reason: String(e?.message ?? e) }], totalLines: 0 }); }
    finally { setUploadBusy(false); }
  }
  async function doAiLookup() {
    const sku = Number(lookupSku);
    if (!Number.isFinite(sku)) { setLookupNote('Enter a valid SKU'); return; }
    setLookupBusy(true); setLookupNote(null);
    try {
      const out = await api.aiCompetitorLookup(sku);
      const ok = out.results.filter((r) => r.status === 'OK').length;
      setLookupNote(`${out.item.description} — ${ok} of ${out.results.length} rivals returned a price.`);
      await refreshGap();
    } catch (e: any) {
      setLookupNote(`Error: ${e?.message ?? e}`);
    } finally { setLookupBusy(false); }
  }


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
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold text-slate-900">Competitor price intelligence</h2>
          {provider && <span className={`fd-pill ${provider.active === 'direct' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'}`}>fetch: {provider.active}{provider.active !== 'direct' && provider.hasKey ? ' ✓' : ''}</span>}
        </div>

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
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-1">Upload competitor prices (CSV)</h3>
              <p className="text-[11px] text-slate-400">Always works — no scraping required. Useful for buyer store visits, vendor-shared comp data, or a paid intelligence export. Header: <code>sku,rivalKey,price,observedAt?,source?</code> · rivalKey ∈ DG, WMT, DT.</p>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={"sku,rivalKey,price,observedAt,source\n108007,DG,2.49,2026-05-28,store visit\n108007,WMT,2.18,2026-05-28,walmart.com"}
                className="fd-input mt-2 min-h-[100px] w-full font-mono text-[12px]"
              />
              <div className="mt-2 flex items-center gap-2">
                <input type="file" accept=".csv,text/csv,text/plain" className="hidden" id="csvFile"
                  onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { if (typeof r.result === 'string') setCsvText(r.result); }; r.readAsText(f); e.currentTarget.value = ''; }} />
                <label htmlFor="csvFile" className="fd-btn fd-btn-ghost cursor-pointer h-8 text-xs">Load file…</label>
                <button onClick={doUpload} disabled={uploadBusy || !csvText.trim()} className="fd-btn fd-btn-primary h-8 text-xs">{uploadBusy ? 'Uploading…' : 'Apply'}</button>
              </div>
              {uploadResult && (
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Inserted <span className="font-semibold">{uploadResult.inserted}</span> of {uploadResult.totalLines} rows.
                  {uploadResult.errors.length > 0 && (
                    <div className="mt-1 max-h-32 overflow-y-auto text-[11px] text-red-700">
                      {uploadResult.errors.slice(0, 10).map((e, i) => <div key={i}>row {e.row}: {e.reason}</div>)}
                      {uploadResult.errors.length > 10 && <div>…and {uploadResult.errors.length - 10} more</div>}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-1">AI lookup for one SKU</h3>
              <p className="text-[11px] text-slate-400">Uses Claude's web search to find current competitor prices for a single item. Best for ad-hoc lookups before a pricing decision. Requires <code>ANTHROPIC_API_KEY</code>.</p>
              <div className="mt-2 flex items-center gap-2">
                <input className="fd-input flex-1 text-sm" value={lookupSku} onChange={(e) => setLookupSku(e.target.value)} placeholder="SKU (e.g. 108007)" />
                <button onClick={doAiLookup} disabled={lookupBusy || !lookupSku.trim()} className="fd-btn fd-btn-primary h-9 text-xs">{lookupBusy ? 'Searching…' : 'AI lookup'}</button>
              </div>
              {lookupNote && <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">{lookupNote}</div>}
            </section>
          </div>

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
