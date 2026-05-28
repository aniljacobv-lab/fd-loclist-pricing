import { useEffect, useState } from 'react';
import { api, type Dashboard, type DashboardPC, type PCStatus } from '../lib/api';

interface Props { onOpen: (pcId: number) => void; onNew: () => void; }

const STATUS_STYLE: Record<PCStatus, string> = {
  WORKSHEET: 'bg-slate-100 text-slate-600',
  SUBMITTED: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-blue-50 text-blue-700',
  REJECTED: 'bg-red-50 text-red-700',
  PROMOTED: 'bg-green-50 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
};
const changeLabel = (pc: DashboardPC) =>
  pc.changeType === 'MARKDOWN_PCT' ? `${pc.amount}% off`
  : pc.changeType === 'MARKDOWN_AMT' ? `$${pc.amount.toFixed(2)} off`
  : pc.changeType === 'ZONE_INHERIT' ? 'Inherit zone prices'
  : `Set $${pc.amount.toFixed(2)}`;
const num = (n: number) => n.toLocaleString();
const dayLabel = (d?: number) => (d == null ? '' : d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d}d`);

function PcRow({ pc, onOpen, showDays }: { pc: DashboardPC; onOpen: (id: number) => void; showDays?: boolean }) {
  return (
    <button onClick={() => onOpen(pc.pcId)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50">
      <span className="min-w-0">
        <span className="block truncate font-medium text-slate-700">{pc.pcName}</span>
        <span className="text-xs text-slate-400">{changeLabel(pc)} · {num(pc.skuCount)} SKUs × {num(pc.storeCount)} stores</span>
      </span>
      <span className="shrink-0 text-right">
        <span className={`fd-pill ${STATUS_STYLE[pc.status]}`}>{pc.status}</span>
        <span className="mt-0.5 block text-[11px] text-slate-400">{showDays ? `${pc.effectiveDate} · ${dayLabel(pc.daysUntil)}` : pc.effectiveDate}</span>
      </span>
    </button>
  );
}

function Kpi({ label, value, tone, onClick }: { label: string; value: number; tone: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className={`fd-card p-4 text-left transition ${onClick ? 'hover:shadow-md' : ''}`}>
      <div className={`text-2xl font-bold ${tone}`}>{num(value)}</div>
      <div className="mt-0.5 text-xs text-slate-500">{label}</div>
    </button>
  );
}

export function DashboardPage({ onOpen, onNew }: Props) {
  const [d, setD] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); api.dashboard().then(setD).catch(() => setD(null)).finally(() => setLoading(false)); }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Home</h2>
          <p className="mt-0.5 text-sm text-slate-500">Everything in flight across the pricing workbench.</p>
        </div>
        <button onClick={onNew} className="fd-btn fd-btn-primary">New price change</button>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        {loading && <div className="text-sm text-slate-400">Loading…</div>}
        {!loading && !d && <div className="text-sm text-slate-400">Couldn't load the dashboard. Is the API running?</div>}
        {!loading && d && (
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Kpi label="Pending my approval" value={d.statusCounts.SUBMITTED} tone="text-amber-600" />
              <Kpi label="Active price changes" value={d.totals.activePriceChanges} tone="text-slate-800" />
              <Kpi label="Live promotions" value={d.liveCounts.promotions} tone="text-green-600" />
              <Kpi label="Live clearances" value={d.liveCounts.clearances} tone="text-fd-red" />
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Kpi label="Stores" value={d.totals.stores} tone="text-slate-700" />
              <Kpi label="Items in catalog" value={d.totals.items} tone="text-slate-700" />
              <Kpi label="Zones" value={d.totals.zones} tone="text-slate-700" />
              <Kpi label="Location lists" value={d.totals.locationLists} tone="text-slate-700" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section className="fd-card p-5">
                <h3 className="fd-section-title mb-3">Awaiting approval <span className="font-normal text-slate-400">({d.pendingApprovals.length})</span></h3>
                {d.pendingApprovals.length === 0 ? (
                  <p className="text-xs text-slate-400">Nothing is waiting on you right now.</p>
                ) : (
                  <div className="space-y-2">{d.pendingApprovals.slice(0, 8).map((pc) => <PcRow key={pc.pcId} pc={pc} onOpen={onOpen} showDays />)}</div>
                )}
              </section>

              <section className="fd-card p-5">
                <h3 className="fd-section-title mb-3">Going live (next 30 days) <span className="font-normal text-slate-400">({d.upcomingEffective.length})</span></h3>
                {d.upcomingEffective.length === 0 ? (
                  <p className="text-xs text-slate-400">No price changes are scheduled to take effect in the next 30 days.</p>
                ) : (
                  <div className="space-y-2">{d.upcomingEffective.slice(0, 8).map((pc) => <PcRow key={pc.pcId} pc={pc} onOpen={onOpen} showDays />)}</div>
                )}
              </section>
            </div>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Pipeline</h3>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(d.statusCounts) as PCStatus[]).map((s) => (
                  <span key={s} className={`fd-pill ${STATUS_STYLE[s]}`}>{s} · {num(d.statusCounts[s])}</span>
                ))}
              </div>
            </section>

            <section className="fd-card p-5">
              <h3 className="fd-section-title mb-3">Recent activity</h3>
              {d.recent.length === 0 ? (
                <p className="text-xs text-slate-400">No price changes yet.</p>
              ) : (
                <div className="space-y-2">{d.recent.map((pc) => <PcRow key={pc.pcId} pc={pc} onOpen={onOpen} />)}</div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
