import { useEffect, useMemo, useState } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef } from 'ag-grid-community';
import { api, type PriceChange, type ItemSelector, type LocationSelector } from '../lib/api';

interface Props {
  onNew: () => void;
  onOpen: (pcId: number) => void;
}

function itemSummary(sel: ItemSelector, count: number): string {
  if (sel.mode === 'SINGLE_SKU') return `SKU ${sel.sku ?? '?'}`;
  const arr = (a?: number[], single?: number | null): number[] => (a?.length ? a : (single != null ? [single] : []));
  const parts: string[] = [];
  if (sel.mode === 'SKU_LIST') parts.push(sel.skus?.length ? `${sel.skus.length} SKUs` : 'SKU list');
  const depts = arr(sel.deptIds, sel.deptId);
  if (depts.length) {
    const cls = arr(sel.classIds, sel.classId), subs = arr(sel.subclassIds, sel.subclassId);
    const seg = [depts.length > 1 ? `${depts.length} depts` : `D${depts[0]}`, cls.length ? (cls.length > 1 ? `${cls.length} cls` : `C${cls[0]}`) : null, subs.length ? (subs.length > 1 ? `${subs.length} sub` : `S${subs[0]}`) : null].filter(Boolean).join('/');
    parts.push(seg);
  }
  const vens = arr(sel.vendorIds, sel.vendorId);
  if (vens.length) parts.push(vens.length > 1 ? `${vens.length} vendors` : `Vendor ${vens[0]}`);
  const pps = sel.pricePointEndsInList?.length ? sel.pricePointEndsInList : (sel.pricePointEndsIn != null ? [sel.pricePointEndsIn] : []);
  if (pps.length) parts.push(`ends ${pps.join('/')}`);
  const label = parts.length ? parts.join(' + ') : 'All items';
  return `${label} (${count})`;
}
function locSummary(sel: LocationSelector, count: number): string {
  const exc = (sel.exceptStoreIds?.length ?? 0) > 0 ? ` -${sel.exceptStoreIds!.length}` : '';
  switch (sel.mode) {
    case 'LOCATION_LIST': {
      const n = sel.locListIds?.length ? sel.locListIds.length : (sel.locListId != null ? 1 : 0);
      return `${n > 1 ? `${n} loc lists` : 'Loc list'} (${count}${exc})`;
    }
    case 'ZONE': {
      const zids = sel.zoneIds?.length ? sel.zoneIds : (sel.zoneId != null ? [sel.zoneId] : []);
      return `${zids.length > 1 ? `${zids.length} zones` : `Zone ${zids[0] ?? '?'}`} (${count}${exc})`;
    }
    case 'STORES': return `${count} stores`;
  }
}

const STATUS_STYLE: Record<string, string> = {
  WORKSHEET: 'bg-slate-100 text-slate-600',
  SUBMITTED: 'bg-blue-50 text-blue-700',
  APPROVED: 'bg-green-50 text-green-700',
  PROMOTED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-red-50 text-red-700',
};

export function PriceChangeList({ onNew, onOpen }: Props) {
  const [rows, setRows] = useState<PriceChange[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listPriceChanges().then(setRows).finally(() => setLoading(false));
  }, []);

  const cols: ColDef<PriceChange>[] = useMemo(
    () => [
      { headerName: 'PC #', field: 'pcId', width: 90 },
      { headerName: 'Name', field: 'pcName', flex: 1, minWidth: 220,
        cellClass: 'font-medium text-slate-800' },
      { headerName: 'Items', width: 190,
        valueGetter: (p) => p.data ? itemSummary(p.data.itemSelector, p.data.resolvedSkus.length) : '' },
      { headerName: 'Target', width: 170,
        valueGetter: (p) => p.data ? locSummary(p.data.locationSelector, p.data.resolvedStoreIds.length) : '' },
      { headerName: 'Change', width: 150,
        valueGetter: (p) => {
          if (!p.data) return '';
          const { changeType: t, amount: a, endsIn } = p.data;
          if (t === 'ZONE_INHERIT') return `Inherit zone prices (${p.data.resolvedSkus.length})`;
          const base = t === 'MARKDOWN_PCT' ? `${a}% off` : t === 'MARKDOWN_AMT' ? `$${a.toFixed(2)} off` : `Set $${a.toFixed(2)}`;
          return endsIn != null ? `${base} ->${endsIn}` : base;
        } },
      { headerName: 'Send', field: 'sendDate', width: 120 },
      { headerName: 'Effective', field: 'effectiveDate', width: 120 },
      { headerName: 'Status', field: 'status', width: 130,
        cellRenderer: (p: { value: string }) => (
          <span className={`fd-pill ${STATUS_STYLE[p.value] ?? 'bg-slate-100 text-slate-600'}`}>{p.value}</span>
        ) },
    ],
    []
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Price Changes</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Single SKU, SKU list, hierarchy, vendor, or price point — combinable, across location lists, zones, or stores, with exceptions.
          </p>
        </div>
        <button onClick={onNew} className="fd-btn fd-btn-primary">
          <span className="text-base leading-none">+</span> New price change
        </button>
      </header>

      <div className="flex-1 overflow-hidden p-8">
        <div className="ag-theme-quartz h-full overflow-hidden rounded-xl border border-slate-200 shadow-card">
          <AgGridReact<PriceChange>
            rowData={rows}
            columnDefs={cols}
            loading={loading}
            onRowClicked={(e) => e.data && onOpen(e.data.pcId)}
            rowSelection="single"
            rowStyle={{ cursor: 'pointer' }}
            animateRows
          />
        </div>
      </div>
    </div>
  );
}
