import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { TreeNode, type NodeProps } from '../components/TreeNode';

export function HierarchyPage() {
  const [roots, setRoots] = useState<NodeProps[]>([]);
  useEffect(() => {
    api.listDivisions().then((divs) => {
      setRoots(divs.map((d) => ({
        label: `Division ${d.division} — ${d.name}`, count: d.itemCount, depth: 0,
        loadChildren: async () => (await api.listGroups(d.division)).map((g) => ({
          label: `Group ${g.groupNo} — ${g.name}`, count: g.itemCount, depth: 1,
          loadChildren: async () => (await api.listDepts(g.groupNo)).map((dep) => ({
            label: `Dept ${dep.deptId} — ${dep.deptName}`, count: dep.itemCount, depth: 2,
            loadChildren: async () => (await api.listClasses(dep.deptId)).map((cl) => ({
              label: `Class ${cl.classId} — ${cl.className}`, count: cl.itemCount, depth: 3,
              loadChildren: async () => (await api.listSubclasses(dep.deptId, cl.classId)).map((sc) => ({
                label: `Subclass ${sc.subclassId} — ${sc.subclassName}`, count: sc.itemCount, depth: 4, leaf: true,
              })),
            })),
          })),
        })),
      })));
    });
  }, []);
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-slate-200 bg-white px-8 py-5">
        <h2 className="text-xl font-semibold text-slate-900">Merchandise Hierarchy</h2>
        <p className="mt-0.5 text-sm text-slate-500">Division → Group → Department → Class → Subclass → Item — real RMS hierarchy with live SKU counts. Click to expand.</p>
      </header>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-3 shadow-card">
          {roots.length === 0 ? <div className="p-4 text-sm text-slate-400">Loading hierarchy…</div> : roots.map((r, i) => <TreeNode key={i} {...r} />)}
        </div>
      </div>
    </div>
  );
}
