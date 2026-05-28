import { useEffect, useState } from 'react';
import { api, type ItemSelector, type LocationSelector, type ChangeType, type PriceImpact } from '../lib/api';

interface Props { itemSelector: ItemSelector; locationSelector: LocationSelector; changeType: ChangeType; amount: number; endsIn: number | null; }

// Compact USD: $1.24M / $345.0K / $82
function usd(n: number): string {
  const s = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${s}$${(a / 1_000).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
const pct = (n: number | null) => (n == null ? '' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);
const num = (n: number) => n.toLocaleString();

export function ImpactPanel({ itemSelector, locationSelector, changeType, amount, endsIn }: Props) {
  const [data, setData] = useState<PriceImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const unsupported = changeType === 'ZONE_INHERIT';

  useEffect(() => {
    if (unsupported) { setData(null); return; }
    let cancelled = false;
    setBusy(true); setErr(false);
    api.pricingImpact({ itemSelector, locationSelector, changeType, amount, endsIn })
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) { setData(null); setErr(true); } })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [JSON.stringify(itemSelector), JSON.stringify(locationSelector), changeType, amount, endsIn, unsupported]);

  if (unsupported) return <p className="text-xs text-slate-400">Impact projection isn't available for zone-inherit changes (prices vary per item).</p>;
  if (err) return <p className="text-xs text-slate-400">Select items and stores to see projected impact.</p>;
  if (!data) return <p className="text-xs text-slate-400">{busy ? 'Projecting impact…' : 'Select items and stores to see projected impact.'}</p>;
  if (data.scope.skuCount === 0 || data.scope.storeCount === 0) return <p className="text-xs text-slate-400">Select items and stores to see projected impact.</p>;

  const w = data.weekly;
  const marginUp = w.marginDelta >= 0;
  const revUp = w.revenueDelta >= 0;

  const Stat = ({ label, before, after, delta, deltaPct, good }: { label: string; before: number; after: number; delta: number; deltaPct: number | null; good: boolean }) => (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="fd-label">{label} / wk</div>
      <div className="mt-1 flex items-baseline gap-1.5 text-sm">
        <span className="text-slate-400">{usd(before)}</span>
        <span className="text-slate-300">→</span>
        <span className="font-semibold text-slate-800">{usd(after)}</span>
      </div>
      <div className={`mt-0.5 text-xs font-medium ${good ? 'text-green-600' : 'text-red-600'}`}>{delta >= 0 ? '+' : ''}{usd(delta)} {pct(deltaPct) && <span className="text-slate-400">({pct(deltaPct)})</span>}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{num(data.scope.skuCount)} SKUs × {num(data.scope.storeCount)} stores = <span className="font-semibold text-slate-700">{num(data.scope.itemLocations)}</span> item-locations</span>
        <span>avg price change <span className="font-medium text-slate-700">{pct(data.avgPriceChangePct)}</span> · elasticity {data.assumedElasticity}{busy && ' · …'}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Revenue" before={w.revenueBefore} after={w.revenueAfter} delta={w.revenueDelta} deltaPct={w.revenueDeltaPct} good={revUp} />
        <Stat label="Gross margin" before={w.marginBefore} after={w.marginAfter} delta={w.marginDelta} deltaPct={w.marginDeltaPct} good={marginUp} />
      </div>

      <div className={`rounded-lg border p-3 ${marginUp ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600">Annualized margin impact ({data.annual.weeks} wks)</span>
          <span className={`text-lg font-bold ${marginUp ? 'text-green-700' : 'text-red-700'}`}>{data.annual.marginDelta >= 0 ? '+' : ''}{usd(data.annual.marginDelta)}</span>
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
          <span>Annual revenue {data.annual.revenueDelta >= 0 ? '+' : ''}{usd(data.annual.revenueDelta)}</span>
          <span>Units/wk {num(w.unitsBefore)} → {num(w.unitsAfter)}</span>
        </div>
      </div>

      {data.belowFloorInSample > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">⚠ {data.belowFloorInSample} sampled SKU(s) fall below the {data.marginFloorPct}% margin floor at the new price.</div>
      )}

      {data.topImpact.length > 0 && (
        <div>
          <div className="fd-label mb-1">Biggest movers (weekly margin Δ)</div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {data.topImpact.map((l) => (
                  <tr key={l.sku}>
                    <td className="px-3 py-1.5 text-slate-700">{l.description}</td>
                    <td className="px-3 py-1.5 text-right text-slate-400">{l.currentRetail != null ? `$${l.currentRetail.toFixed(2)}` : '—'} → {l.newRetail != null ? `$${l.newRetail.toFixed(2)}` : '—'}</td>
                    <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${l.weeklyMarginDelta >= 0 ? 'text-green-600' : 'text-red-600'}`}>{l.weeklyMarginDelta >= 0 ? '+' : ''}{usd(l.weeklyMarginDelta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">{data.note}</p>
    </div>
  );
}
