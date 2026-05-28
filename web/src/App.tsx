import { useEffect, useState } from 'react';
import { api, auth, ROLE_LABEL, type Role } from './lib/api';
import { PriceChangeList } from './pages/PriceChangeList';
import { PriceChangeEditor } from './pages/PriceChangeEditor';
import { CalendarPage } from './pages/CalendarPage';
import { HierarchyPage } from './pages/HierarchyPage';
import { ZoneHierarchyPage } from './pages/ZoneHierarchyPage';
import { StoreViewPage } from './pages/StoreViewPage';
import { RezonePage } from './pages/RezonePage';
import { DashboardPage } from './pages/DashboardPage';
import { MarkdownsPage } from './pages/MarkdownsPage';
import { CompetitorsPage } from './pages/CompetitorsPage';

type View =
  | { kind: 'home' }
  | { kind: 'list' }
  | { kind: 'edit'; pcId?: number }
  | { kind: 'calendar' }
  | { kind: 'hierarchy' }
  | { kind: 'zones' }
  | { kind: 'storeview' }
  | { kind: 'rezone' }
  | { kind: 'markdowns' }
  | { kind: 'competitors' };

function NavItem({ active, onClick, label, icon }: { active: boolean; onClick: () => void; label: string; icon: JSX.Element }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-red-50 text-fd-red' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>
      <span className={active ? 'text-fd-red' : 'text-slate-400'}>{icon}</span>{label}
    </button>
  );
}
const TagIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>);
const CalIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>);
const ZoneIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>);
const MoveIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>);
const StoreIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></svg>);
const TreeIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="7" y1="12" x2="21" y2="12"/><line x1="11" y1="18" x2="21" y2="18"/></svg>);
const HomeIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>);
const MarkIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="14 7 21 7 21 14"/></svg>);
const CompIcon = (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>);

export default function App() {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [health, setHealth] = useState<{ datastore: string; anthropicConfigured: boolean } | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  const inPricing = view.kind === 'list' || view.kind === 'edit';

  return (
    <div className="flex h-full bg-[#f7f8fa]">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-fd-red text-sm font-bold text-white shadow-sm">FD</span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-800">Pricing Workbench</div>
            <div className="text-[11px] text-slate-400">Family Dollar</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          <NavItem active={view.kind === 'home'} onClick={() => setView({ kind: 'home' })} label="Home" icon={HomeIcon} />
          <NavItem active={inPricing} onClick={() => setView({ kind: 'list' })} label="Price Changes" icon={TagIcon} />
          <NavItem active={view.kind === 'hierarchy'} onClick={() => setView({ kind: 'hierarchy' })} label="Hierarchy" icon={TreeIcon} />
          <NavItem active={view.kind === 'zones'} onClick={() => setView({ kind: 'zones' })} label="Zones" icon={ZoneIcon} />
          <NavItem active={view.kind === 'storeview'} onClick={() => setView({ kind: 'storeview' })} label="My View" icon={StoreIcon} />
          <NavItem active={view.kind === 'rezone'} onClick={() => setView({ kind: 'rezone' })} label="Reprice / Rezone" icon={MoveIcon} />
          <NavItem active={view.kind === 'calendar'} onClick={() => setView({ kind: 'calendar' })} label="Calendar" icon={CalIcon} />
          <NavItem active={view.kind === 'markdowns'} onClick={() => setView({ kind: 'markdowns' })} label="Markdowns" icon={MarkIcon} />
          <NavItem active={view.kind === 'competitors'} onClick={() => setView({ kind: 'competitors' })} label="Competitors" icon={CompIcon} />
        </nav>
        <div className="space-y-2 border-t border-slate-100 p-4 text-xs">
          <div>
            <div className="mb-1 text-slate-400">Signed in as</div>
            <select className="fd-input text-xs" defaultValue={auth.role()} onChange={(e) => { auth.setRole(e.target.value as Role); location.reload(); }}>
              <option value="BUYER">{ROLE_LABEL.BUYER}</option>
              <option value="CATEGORY_MGR">{ROLE_LABEL.CATEGORY_MGR}</option>
              <option value="DIRECTOR">{ROLE_LABEL.DIRECTOR}</option>
              <option value="VP">{ROLE_LABEL.VP}</option>
            </select>
          </div>
          {health ? (
            <>
              <div className="flex items-center justify-between"><span className="text-slate-400">Data source</span><span className="fd-pill bg-slate-100 text-slate-600">{health.datastore}</span></div>
              <div className="flex items-center justify-between"><span className="text-slate-400">AI</span><span className={`fd-pill ${health.anthropicConfigured ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{health.anthropicConfigured ? 'live' : 'stub'}</span></div>
            </>
          ) : <span className="text-slate-300">connecting…</span>}
          <div className="pt-1 text-[10px] text-slate-300">POC · extends RMS zone pricing</div>
        </div>

      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-hidden">
          {view.kind === 'home' && <DashboardPage onOpen={(pcId) => setView({ kind: 'edit', pcId })} onNew={() => setView({ kind: 'edit' })} />}
          {view.kind === 'list' && <PriceChangeList onNew={() => setView({ kind: 'edit' })} onOpen={(pcId) => setView({ kind: 'edit', pcId })} />}
          {view.kind === 'edit' && <PriceChangeEditor pcId={view.pcId} onClose={() => setView({ kind: 'list' })} />}
          {view.kind === 'hierarchy' && <HierarchyPage />}
          {view.kind === 'zones' && <ZoneHierarchyPage />}
          {view.kind === 'storeview' && <StoreViewPage />}
          {view.kind === 'rezone' && <RezonePage onCreated={(pcId) => setView({ kind: 'edit', pcId })} />}
          {view.kind === 'calendar' && <CalendarPage />}
          {view.kind === 'markdowns' && <MarkdownsPage onOpen={(pcId) => setView({ kind: 'edit', pcId })} />}
          {view.kind === 'competitors' && <CompetitorsPage />}
        </main>
      </div>
    </div>
  );
}
