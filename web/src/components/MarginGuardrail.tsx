import { useEffect, useState } from 'react';
import { api, type ItemSelector, type ChangeType, type PricePreview } from '../lib/api';

interface Props { itemSelector: ItemSelector; changeType: ChangeType; amount: number; endsIn: number | null; }

export function MarginGuardrail({ itemSelector, changeType, amount, endsIn }: Props) {
  const [preview, setPreview] = useState<PricePreview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    api.pricePreview({ itemSelector, changeType, amount, endsIn })
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch(() => { if (!cancelled) setPreview(null); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [JSON.stringify(itemSelector), changeType, amount, endsIn]);

  if (!preview || preview.count === 0) return null;
  const worst = preview.rows[0];
  const danger = preview.belowFloorCount > 0;

  return (
    <div className={`rounded-lg border p-3 text-xs ${danger ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${danger ? 'text-red-700' : 'text-green-700'}`}>
          {danger ? `⚠ ${preview.belowFloorCount} SKU(s) below ${preview.marginFloorPct}% margin floor` : `Margins OK (floor ${preview.marginFloorPct}%)`}
        </span>
        {busy && <span className="text-slate-400">…</span>}
      </div>
      <div className="mt-1 text-slate-600">
        Lowest new margin: <span className="font-medium">{preview.minMarginPct != null ? `${preview.minMarginPct}%` : 'n/a'}</span>
        {worst && worst.newRetail != null && (
          <> · {worst.description} → ${worst.newRetail.toFixed(2)}{worst.cost != null && ` (cost $${worst.cost.toFixed(2)})`}</>
        )}
      </div>
    </div>
  );
}
