import { useState } from 'react';
import { api, type ChangeType, type VectorStatus } from '../lib/api';
import { SimilarItems } from './SimilarItems';

interface Props {
  sku: number | null;
  onApplyDraft: (draft: {
    pcName?: string;
    sku?: number | null;
    changeType?: ChangeType;
    amount?: number;
    effectiveDate?: string | null;
    storeIds?: number[];
  }) => void;
}

export function AIAssistPanel({ sku, onApplyDraft }: Props) {
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
      {tab === 'suggest' && <SuggestPanel sku={sku} onApplyDraft={onApplyDraft} />}

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

function SuggestPanel({ sku, onApplyDraft }: { sku: number | null; onApplyDraft: Props['onApplyDraft'] }) {
  const [reasonCode, setReasonCode] = useState(9);
  const [sellThrough, setSellThrough] = useState(0.35);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ changeType: string; amount: number; rationale: string } | null>(null);
  async function go() {
    if (!sku) return;
    setBusy(true);
    try { setResult(await api.aiSuggestPrice({ sku, reasonCode, sellThrough })); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-2 text-sm">
      {!sku && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">Pick a single SKU first.</p>}
      <div className="grid grid-cols-2 gap-2">
        <div><label className="fd-label">Reason</label>
          <input type="number" value={reasonCode} onChange={(e) => setReasonCode(Number(e.target.value))} className="fd-input" /></div>
        <div><label className="fd-label">Sell-through</label>
          <input type="number" step={0.05} min={0} max={1} value={sellThrough} onChange={(e) => setSellThrough(Number(e.target.value))} className="fd-input" /></div>
      </div>
      <button onClick={go} disabled={!sku || busy} className="fd-btn fd-btn-primary w-full">{busy ? 'Thinking…' : 'Suggest a markdown'}</button>
      {result && (
        <div className="rounded-lg border border-slate-200 p-3 text-xs">
          <div className="font-semibold text-slate-800">{result.changeType} → {result.amount}</div>
          <p className="mt-1 text-slate-500">{result.rationale}</p>
          <button onClick={() => onApplyDraft({ changeType: result.changeType as any, amount: result.amount })}
            className="fd-btn fd-btn-primary mt-2 h-8 px-3 text-xs">Apply to form</button>
        </div>
      )}
    </div>
  );
}
