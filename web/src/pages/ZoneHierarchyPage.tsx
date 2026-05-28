import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { TreeNode, type NodeProps } from '../components/TreeNode';

export function ZoneHierarchyPage() {
  const [roots, setRoots] = useState<NodeProps[]>([]);
  useEffect(() => {
    api.listZoneGroups().then(async (groups) => {
      const nodes = await Promise.all(groups.map(async (g) => {
        const head = await api.searchZones(g.zoneGroupId, { pageSize: 1 }); // total zone count
        return {
          label: `${g.zoneGroupId} — ${g.zoneGroupName}`,
          sub: g.pricingLevel === 'S' ? 'store-level' : 'zone-level',
          count: head.total, countLabel: 'zones', depth: 0,
          loadChildren: async () => {
            const page = await api.searchZones(g.zoneGroupId, { pageSize: 500 });
            const rows: NodeProps[] = page.rows.map((z) => ({
              label: `Zone ${z.zoneId} — ${z.zoneName}`, count: z.storeCount, countLabel: 'stores', depth: 1, leaf: true,
            }));
            if (page.total > page.rows.length) rows.push({ label: `… ${(page.total - page.rows.length).toLocaleString()} more zones (refine in the price-change picker)`, depth: 1, leaf: true });
            return rows;
          },
        } as NodeProps;
      }));
      setRoots(nodes);
    });
  }, []);
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-8 py-5">
        <h2 className="text-xl font-semibold text-slate-900">Zone Hierarchy</h2>
        <p className="mt-0.5 text-sm text-slate-500">Zone Group → Zone → Stores — real RMS pricing zones with live store counts. Click a group to expand.</p>
      </header>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-3 shadow-card">
          {roots.length === 0 ? <div className="p-4 text-sm text-slate-400">Loading zones…</div> : roots.map((r, i) => <TreeNode key={i} {...r} />)}
        </div>
      </div>
    </div>
  );
}
