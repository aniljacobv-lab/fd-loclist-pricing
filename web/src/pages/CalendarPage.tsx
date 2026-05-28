import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, type CalendarActivity, type ActivityType, type FiscalCalendar, type FiscalWeek, type ZoneGroup, type Zone } from '../lib/api';

const TYPE_META: Record<ActivityType, { label: string; chip: string; dot: string }> = {
  SPARC_STRIP_CHANGE: { label: 'SPARC strip change', chip: 'bg-purple-50 text-purple-700 border-purple-100', dot: 'bg-purple-500' },
  PRICE_STRIP_PRINT:  { label: 'Print strips',       chip: 'bg-amber-50 text-amber-700 border-amber-100',   dot: 'bg-amber-500' },
  SEND:               { label: 'Send / extract',     chip: 'bg-blue-50 text-blue-700 border-blue-100',     dot: 'bg-blue-500' },
  EFFECTIVE:          { label: 'Effective',          chip: 'bg-green-50 text-green-700 border-green-100',  dot: 'bg-green-500' },
  BLACKOUT:           { label: 'Blackout',           chip: 'bg-red-50 text-red-700 border-red-100',        dot: 'bg-red-500' },
  CUSTOM:             { label: 'Custom',             chip: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' },
};

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function startOfMonthGrid(year: number, month: number): Date {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first); start.setUTCDate(first.getUTCDate() - first.getUTCDay());
  return start;
}

export function CalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth());
  const [activities, setActivities] = useState<CalendarActivity[]>([]);
  const [fiscal, setFiscal] = useState<FiscalCalendar | null>(null);
  // scope
  const [zoneGroups, setZoneGroups] = useState<ZoneGroup[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [scopeZg, setScopeZg] = useState<number | null>(null);
  const [scopeZid, setScopeZid] = useState<number | null>(null);
  // add modal
  const [showAdd, setShowAdd] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ActivityType>('SPARC_STRIP_CHANGE');
  const [notes, setNotes] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  useEffect(() => { api.getFiscalCalendar().then(setFiscal).catch(() => setFiscal(null)); api.listZoneGroups().then(setZoneGroups); }, []);
  useEffect(() => { if (scopeZg != null) api.searchZones(scopeZg, { pageSize: 100 }).then((p) => setZones(p.rows)); else setZones([]); }, [scopeZg]);

  function reload() {
    const from = ymd(startOfMonthGrid(year, month));
    const to = ymd(new Date(Date.UTC(year, month + 1, 7)));
    api.listActivities(from, to, { zoneGroupId: scopeZg, zoneId: scopeZid }).then(setActivities);
  }
  useEffect(reload, [year, month, scopeZg, scopeZid]);

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarActivity[]>();
    for (const a of activities) { if (!m.has(a.date)) m.set(a.date, []); m.get(a.date)!.push(a); }
    return m;
  }, [activities]);
  const fiscalByWeekStart = useMemo(() => {
    const m = new Map<string, FiscalWeek>();
    fiscal?.periods.forEach((p) => p.weeks.forEach((w) => m.set(w.startDate, w)));
    return m;
  }, [fiscal]);
  const holidayByDate = useMemo(() => {
    const m = new Map<string, string>();
    fiscal?.holidays.forEach((h) => m.set(h.date, h.name));
    return m;
  }, [fiscal]);

  const gridStart = startOfMonthGrid(year, month);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) { const row: Date[] = []; for (let i = 0; i < 7; i++) { const d = new Date(gridStart); d.setUTCDate(gridStart.getUTCDate() + w * 7 + i); row.push(d); } weeks.push(row); }

  function prevMonth() { const m = month - 1; if (m < 0) { setMonth(11); setYear(year - 1); } else setMonth(m); }
  function nextMonth() { const m = month + 1; if (m > 11) { setMonth(0); setYear(year + 1); } else setMonth(m); }
  async function addActivity() {
    if (!title || !selectedDate) return;
    await api.createActivity({ title, type, date: selectedDate, zoneGroupId: scopeZg, zoneId: scopeZid, notes: notes || null });
    setShowAdd(false); setTitle(''); setNotes(''); reload();
  }
  async function aiRefresh() {
    setAiBusy(true); setAiMsg(null);
    try {
      const from = ymd(startOfMonthGrid(year, month));
      const to = ymd(new Date(Date.UTC(year, month + 1, 7)));
      const r = await api.aiRefreshCalendar({ from, to, zoneGroupId: scopeZg, zoneId: scopeZid });
      setAiMsg(`${r.activities.length} AI suggestions${r.stub ? ' (stub — add API key)' : ''} for ${r.region}`);
      reload();
    } catch (e: any) { setAiMsg(e?.message ?? String(e)); }
    finally { setAiBusy(false); }
  }

  const monthName = new Date(Date.UTC(year, month, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const todayStr = ymd(today);
  const monthFiscal = fiscalByWeekStart.get(weeks[1]?.[0] ? ymd(weeks[1][0]!) : '') ?? null;
  const scopeLabel = scopeZg == null ? 'All zones (global)' : `${scopeZg}${scopeZid != null ? ` · Zone ${scopeZid}` : ''}`;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Activity Calendar</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {fiscal ? `FY${fiscal.fiscalYear} 4-5-4 retail calendar` : 'Retail calendar'} · {scopeLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {monthFiscal && <span className="fd-pill bg-fd-red/10 text-fd-red">Q{monthFiscal.quarter} · {monthFiscal.periodName}</span>}
          <button onClick={aiRefresh} disabled={aiBusy} className="fd-btn fd-btn-ghost">{aiBusy ? 'Refreshing…' : '✨ AI Refresh'}</button>
          <button onClick={prevMonth} className="fd-btn fd-btn-ghost h-9 w-9 px-0">‹</button>
          <span className="w-36 text-center text-sm font-semibold text-slate-800">{monthName} {year}</span>
          <button onClick={nextMonth} className="fd-btn fd-btn-ghost h-9 w-9 px-0">›</button>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-8 py-3 text-sm">
        <span className="fd-label mb-0">Scope</span>
        <select className="fd-input w-64" value={scopeZg ?? ''} onChange={(e) => { setScopeZg(e.target.value ? Number(e.target.value) : null); setScopeZid(null); }}>
          <option value="">All zones (global)</option>
          {zoneGroups.map((g) => <option key={g.zoneGroupId} value={g.zoneGroupId}>{g.zoneGroupId} — {g.zoneGroupName}</option>)}
        </select>
        {scopeZg != null && (
          <select className="fd-input w-64" value={scopeZid ?? ''} onChange={(e) => setScopeZid(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Whole group</option>
            {zones.map((z) => <option key={z.zoneId} value={z.zoneId}>Zone {z.zoneId} — {z.zoneName} ({z.storeCount})</option>)}
          </select>
        )}
        {aiMsg ? <span className="ml-auto text-xs text-slate-500">{aiMsg}</span> : <span className="ml-auto text-xs text-slate-400">Global view shows every zone's activities; a scope shows global + that zone's.</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mb-4 flex flex-wrap gap-4 text-xs">
          {Object.entries(TYPE_META).map(([k, m]) => (
            <span key={k} className="flex items-center gap-1.5 text-slate-500"><span className={`inline-block h-2.5 w-2.5 rounded-full ${m.dot}`} /> {m.label}</span>
          ))}
          <span className="flex items-center gap-1.5 text-slate-500"><span className="inline-block h-2.5 w-2.5 rounded-full bg-fd-red" /> Holiday</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
          <div className="grid border-b border-slate-200 bg-slate-50 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400" style={{ gridTemplateColumns: '5.5rem repeat(7, minmax(0,1fr))' }}>
            <div className="py-2 text-left pl-2 normal-case tracking-normal">Fiscal</div>
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid" style={{ gridTemplateColumns: '5.5rem repeat(7, minmax(0,1fr))' }}>
            {weeks.map((row, wi) => {
              const fw = fiscalByWeekStart.get(ymd(row[0]!));
              const lastRow = wi === 5;
              return (
                <Fragment key={`w${wi}`}>
                  <div className={`flex flex-col justify-center bg-slate-50/70 px-2 py-1 text-[10px] leading-tight text-slate-500 ${!lastRow ? 'border-b' : ''} border-r border-slate-100`}>
                    {fw ? (<><span className="font-semibold text-slate-700">P{fw.period} · W{fw.week}</span><span className="text-slate-400">Yr Wk {fw.yearWeek}</span></>) : <span className="text-slate-300">—</span>}
                  </div>
                  {row.map((d, di) => {
                    const ds = ymd(d);
                    const inMonth = d.getUTCMonth() === month;
                    const acts = byDate.get(ds) ?? [];
                    const holiday = holidayByDate.get(ds);
                    const lastCol = di === 6;
                    return (
                      <div key={ds}
                        className={`min-h-[104px] cursor-pointer p-1.5 transition hover:bg-slate-50 ${inMonth ? 'bg-white' : 'bg-slate-50/50'} ${!lastCol ? 'border-r' : ''} ${!lastRow ? 'border-b' : ''} border-slate-100`}
                        onClick={() => { setSelectedDate(ds); setShowAdd(true); }}>
                        <div className="mb-1 flex items-center justify-between">
                          {holiday ? <span className="truncate rounded bg-fd-red/10 px-1 text-[9px] font-medium text-fd-red" title={holiday}>{holiday}</span> : <span />}
                          <span className={`grid h-6 w-6 place-items-center rounded-full text-[11px] ${ds === todayStr ? 'bg-fd-red font-bold text-white' : inMonth ? 'text-slate-500' : 'text-slate-300'}`}>{d.getUTCDate()}</span>
                        </div>
                        <div className="space-y-0.5">
                          {acts.slice(0, 3).map((a) => (
                            <div key={a.activityId} className={`truncate rounded border px-1.5 py-0.5 text-[10px] ${TYPE_META[a.type].chip}`} title={`${TYPE_META[a.type].label}: ${a.title}${a.zoneId != null ? ` (zone ${a.zoneId})` : ''}${a.notes ? ` — ${a.notes}` : ''}`}>
                              {a.source === 'AI' && <span className="mr-0.5">✨</span>}{a.zoneId != null && <span className="mr-0.5 font-semibold">◆</span>}{a.title}
                            </div>
                          ))}
                          {acts.length > 3 && <div className="pl-1 text-[10px] text-slate-400">+{acts.length - 3} more</div>}
                        </div>
                      </div>
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      {showAdd && selectedDate && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/30 backdrop-blur-sm" onClick={() => setShowAdd(false)}>
          <div className="w-96 rounded-xl bg-white p-5 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Add activity · {selectedDate}</h3>
            <p className="mb-4 text-xs text-slate-400">Scope: {scopeLabel}</p>
            <label className="fd-label">Type</label>
            <select className="fd-input mb-3" value={type} onChange={(e) => setType(e.target.value as ActivityType)}>
              {Object.entries(TYPE_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <label className="fd-label">Title</label>
            <input className="fd-input mb-3" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SPARC strip change — Week 5" />
            <label className="fd-label">Notes</label>
            <textarea className="fd-input mb-4 h-auto py-2" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="fd-btn fd-btn-ghost">Cancel</button>
              <button onClick={addActivity} disabled={!title} className="fd-btn fd-btn-primary">Add activity</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
