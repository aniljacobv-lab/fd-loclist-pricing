import { useState } from 'react';
import { api, type ChangeType, type VectorStatus } from '../lib/api';
import { SimilarItems } from './SimilarItems';

import type { ItemSelector, LocationSelector, StrategyRecommendation, StrategyResponse } from '../lib/api';

interface Props {
  sku: number | null;
  itemSelector: ItemSelector;
  locationSelector: LocationSelector;
  onApplyDraft: (draft: {
    pcName?: string;
    sku?: number | null;
    changeType?: ChangeType;
    amount?: number;
    effectiveDate?: string | null;
    storeIds?: number[];
  }) => void;
}

export function AIAssistPanel({ sku, itemSelector, locationSelector, onApplyDraft }: Props) {
  const [tab, setTab] = useState<'nl' | 'group' | 'suggest' | 'find'>('nl');
  const [findQuery, setFindQuery] = useState('');
  const [vectorStatus, setVectorStatus] = useState<VectorStatus | null>(null);
  const [vectorBusy, setVectorBusy] = useState(false);
  async function refreshVectorStatus() {
    try { setVectorStatus(await api.vectorStatus()); } catch { setVectorStatus(null); }
  }
  async function rebuildItemIndex() {
    setVectorBusy(true);
    try { await api.indexItems(); await refreshVectorStatus(); }
    catch (e: any) { alert('Index build failed: ' + (e?.message ?? e)); }
    finally { setVectorBusy(false); }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-fd-red/10 text-fd-red">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.8H20l-4.7 3.4L17.2 18 12 14.5 6.8 18l1.9-5.8L4 8.8h6.1z"/></svg>
        </span>
        <h3 className="text-sm font-semibold text-slate-800">AI Assist</h3>
      </div>

      <div className="mb-3 fd-seg">
        {([['nl','Describe'],['group','Group'],['suggest','Suggest'],['find','Find']] as const).map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)} className={`fd-seg-item ${tab === k ? 'fd-seg-item-active' : ''}`}>{l}</button>
        ))}
      </div>

      {tab === 'nl' && <NLPanel onApplyDraft={onApplyDraft} />}
      {tab === 'group' && <GroupPanel onApplyDraft={onApplyDraft} />}
      {tab === 'suggest' && <SuggestPanel sku={sku} itemSelector={itemSelector} locationSelector={locationSelector} onApplyDraft={onApplyDraft} />}

      {tab === 'find' && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500">Semantic catalog search powered by the vector index. Works on item meaning, not just substring match.</p>
          <div>
            <input
              className="fd-input text-sm"
              placeholder="e.g. tortilla chips, baby wipes, dog food"
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
            />
          </div>
          {findQuery.trim().length >= 2 && (
            <SimilarItems query={findQuery} k={8} title="Top matches" />
          )}
          {sku != null && findQuery.trim().length < 2 && (
            <SimilarItems sku={sku} k={8} title={`Items similar to SKU ${sku}`} />
          )}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-medium text-slate-700">Vector index</span>
              <button onClick={refreshVectorStatus} className="text-slate-400 hover:text-slate-700">Refresh</button>
            </div>
            {vectorStatus ? (
              <div className="space-y-0.5 text-slate-500">
                <div>Provider: <span className="font-medium text-slate-700">{vectorStatus.activeProvider}</span> ({vectorStatus.providerDimensions}d)</div>
                <div>Items: {vectorStatus.items.rows.toLocaleString()} rows · dim {vectorStatus.items.dim}</div>
                <div>Price changes: {vectorStatus.priceChanges.rows.toLocaleString()} rows · dim {vectorStatus.priceChanges.dim}</div>
                {vectorStatus.items.lastUpdated && <div className="text-[10px] text-slate-400">last built {new Date(vectorStatus.items.lastUpdated).toLocaleString()}</div>}
              </div>
            ) : (
              <button onClick={refreshVectorStatus} className="text-fd-red hover:underline">Check status</button>
            )}
            <button onClick={rebuildItemIndex} disabled={vectorBusy} className="fd-btn fd-btn-ghost mt-2 h-7 text-[11px]">{vectorBusy ? 'Rebuilding…' : 'Rebuild item index'}</button>
          </div>
        </div>
      )}

    </div>
  );
}

function NLPanel({ onApplyDraft }: { onApplyDraft: Props['onApplyDraft'] }) {
  const [text, setText] = useState('Mark down citronella torches 20% at FL coastal stores starting next Monday');
  const [busy, setBusy] = useState(false);
  const [rationale, setRationale] = useState<string | null>(null);
  async function go() {
    setBusy(true); setRationale(null);
    try {
      const r = await api.aiParseIntent(text);
      onApplyDraft({ pcName: r.pcName, sku: r.sku, changeType: r.changeType, amount: r.amount, effectiveDate: r.effectiveDate });
      setRationale(r.rationale);
    } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-500">Describe the price change in plain English.</p>
      <textarea className="fd-input h-auto py-2" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      <button onClick={go} disabled={busy} className="fd-btn fd-btn-primary w-full">{busy ? 'Parsing…' : 'Parse → fill form'}</button>
      {rationale && <p className="text-xs text-slate-500">{rationale}</p>}
    </div>
  );
}

function GroupPanel({ onApplyDraft }: { onApplyDraft: Props['onApplyDraft'] }) {
  const [n, setN] = useState(4);
  const [hint, setHint] = useState('group by region and velocity');
  const [busy, setBusy] = useState(false);
  const [clusters, setClusters] = useState<Array<{ name: string; rationale: string; storeIds: number[] }>>([]);
  async function go() {
    setBusy(true); setClusters([]);
    try { setClusters((await api.aiGroupStores({ numClusters: n, hint })).clusters); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-slate-500">Cluster the store base into N candidate location lists.</p>
      <div className="flex items-center gap-2">
        <input type="number" min={2} max={12} value={n} onChange={(e) => setN(Number(e.target.value))} className="fd-input w-16" />
        <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="hint" className="fd-input flex-1" />
      </div>
      <button onClick={go} disabled={busy} className="fd-btn fd-btn-primary w-full">{busy ? 'Grouping…' : 'Propose clusters'}</button>
      <div className="space-y-1">
        {clusters.map((c, i) => (
          <button key={i} onClick={() => onApplyDraft({ storeIds: c.storeIds })} title={c.rationale}
            className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-xs hover:border-fd-red/40 hover:bg-red-50/40">
            <span className="font-medium text-slate-800">{c.name}</span>
            <span className="text-slate-400"> — {c.storeIds.length} stores</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SuggestPanel({ sku, itemSelector, locationSelector, onApplyDraft }: { sku: number | null; itemSelector: ItemSelector; locationSelector: LocationSelector; onApplyDraft: Props['onApplyDraft'] }) {
  const [strategy, setStrategy] = useState<'AUTO' | 'EDLP' | 'MARKDOWN'>('AUTO');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<StrategyResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setBusy(true); setErr(null);
    try { setData(await api.aiSuggestStrategy({ itemSelector, locationSelector, strategy })); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }

  const confTone = (c: string) => c === 'high' ? 'bg-green-50 text-green-700' : c === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';
  const formatAmount = (r: StrategyRecommendation) => r.changeType === 'MARKDOWN_PCT' ? `${r.amount}% off` : r.changeType === 'MARKDOWN_AMT' ? `$${r.amount.toFixed(2)} off` : `Set $${r.amount.toFixed(2)}`;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <label className="fd-label">Strategy</label>
        <div className="fd-seg w-full">
          {(['AUTO', 'EDLP', 'MARKDOWN'] as const).map((k) => (
            <button key={k} onClick={() => setStrategy(k)} className={`fd-seg-item ${strategy === k ? 'fd-seg-item-active' : ''}`}>{k === 'AUTO' ? 'Let AI decide' : k === 'EDLP' ? 'EDLP' : 'Markdown'}</button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-slate-400">Works for any scope — single SKU, hierarchy, SKU list, vendor, or all items. Pulls in season, weather, holidays, and your store regional mix.</p>
      </div>

      <button onClick={go} disabled={busy} className="fd-btn fd-btn-primary w-full">{busy ? 'Analyzing…' : sku != null ? 'Suggest strategy for this SKU' : 'Suggest strategy for current scope'}</button>

      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</div>}

      {data && (
        <>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            <div className="font-medium text-slate-700">Scope</div>
            <div className="mt-0.5">{data.scope.skuCount.toLocaleString()} SKUs × {data.scope.storeCount.toLocaleString()} stores · avg {data.scope.avgPrice != null ? `$${data.scope.avgPrice.toFixed(2)}` : '—'}</div>
            {data.scope.topDepts.length > 0 && <div className="mt-0.5 text-slate-500">Top: {data.scope.topDepts.slice(0, 3).map((d) => `${d.name} ${d.share}%`).join(' · ')}</div>}
            <div className="mt-1 font-medium text-slate-700">Context</div>
            <div className="mt-0.5 text-slate-500">{data.context.date} · {data.context.season}{data.context.upcomingHolidays[0] ? ` · ${data.context.upcomingHolidays[0].name} in ${data.context.upcomingHolidays[0].daysUntil}d` : ''}</div>
            {data.context.weatherNotes[0] && <div className="mt-0.5 italic text-slate-500">{data.context.weatherNotes[0]}</div>}
            <div className="mt-1"><span className={`fd-pill ${data.aiUsed ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{data.aiUsed ? 'AI-generated' : 'Heuristic (no AI key)'}</span></div>
          </div>

          {data.recommendations.length === 0 && <p className="text-xs text-slate-400">No recommendations returned for this scope.</p>}
          <div className="space-y-2">
            {data.recommendations.map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-slate-800">{r.kind} · {formatAmount(r)}</div>
                  <span className={`fd-pill ${confTone(r.confidence)}`}>{r.confidence}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{r.scopeNote} · effective {r.effectiveDate}</div>
                <p className="mt-1.5 leading-relaxed text-slate-600">{r.rationale}</p>
                <button onClick={() => onApplyDraft({ changeType: r.changeType, amount: r.amount, effectiveDate: r.effectiveDate })} className="fd-btn fd-btn-primary mt-2 h-8 px-3 text-xs">Apply to form</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
