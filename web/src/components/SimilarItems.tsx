import { useEffect, useState } from 'react';
import { api, type VectorItemHit } from '../lib/api';

interface Props {
  /** Either anchor by SKU (similar to this SKU) or by search text (semantic search). */
  sku?: number | null;
  query?: string;
  k?: number;
  deptId?: number | null;
  /** If set, renders a check column and reports selection upward. */
  onPick?: (skus: number[]) => void;
  /** Title override for the section header. */
  title?: string;
}

const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);

export function SimilarItems({ sku, query, k = 10, deptId, onPick, title }: Props) {
  const [hits, setHits] = useState<VectorItemHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const heading = title ?? (sku != null ? 'Similar items' : 'Semantic search');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setBusy(true); setError(null);
      try {
        let res;
        if (sku != null) res = await api.similarItems({ sku, k, deptId: deptId ?? null });
        else if (query && query.trim()) res = await api.searchItemsSemantic({ q: query.trim(), k, deptId: deptId ?? null });
        else { setHits([]); return; }
        if (!cancelled) setHits(res.hits);
      } catch (e: any) {
        if (cancelled) return;
        const msg = String(e?.message ?? e);
        if (/not_indexed/i.test(msg)) setError('Item vector index not built yet. Trigger an index build from the AI assist panel.');
        else setError(msg);
      } finally { if (!cancelled) setBusy(false); }
    }
    run();
    return () => { cancelled = true; };
  }, [sku, query, k, deptId]);

  function toggle(s: number) {
    const n = new Set(selected); n.has(s) ? n.delete(s) : n.add(s);
    setSelected(n); onPick?.([...n]);
  }

  return (
    <div className="fd-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="fd-section-title">{heading}</h3>
        {hits && <span className="text-[11px] text-slate-400">{hits.length} match{hits.length === 1 ? '' : 'es'}</span>}
      </div>
      {busy && <p className="text-xs text-slate-400">Searching…</p>}
      {error && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{error}</p>}
      {!busy && hits && hits.length === 0 && <p className="text-xs text-slate-400">No matches.</p>}
      {hits && hits.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                {onPick && <th className="w-8 px-2 py-1.5"></th>}
                <th className="px-3 py-1.5">Item</th>
                <th className="px-3 py-1.5">Dept</th>
                <th className="px-3 py-1.5 text-right">Price</th>
                <th className="px-3 py-1.5 text-right">Match</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hits.map((h) => (
                <tr key={h.sku} className={`hover:bg-slate-50/60 ${selected.has(h.sku) ? 'bg-amber-50/40' : ''}`}>
                  {onPick && <td className="px-2 py-1.5"><input type="checkbox" checked={selected.has(h.sku)} onChange={() => toggle(h.sku)} /></td>}
                  <td className="px-3 py-1.5"><span className="block text-slate-700">{h.description ?? `SKU ${h.sku}`}</span><span className="text-[10px] text-slate-400">{h.sku} {h.vendorName ? `· ${h.vendorName}` : ''}</span></td>
                  <td className="px-3 py-1.5 text-slate-500">{h.deptName}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{money(h.currentRetail)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium" style={{ color: h.similarity > 0.5 ? '#15803d' : h.similarity > 0.3 ? '#b45309' : '#6b7280' }}>{Math.round(h.similarity * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
