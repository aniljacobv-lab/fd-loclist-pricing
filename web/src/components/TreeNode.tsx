import { useState } from 'react';

export interface NodeProps {
  label: string;
  sub?: string;
  count?: number;
  countLabel?: string;   // e.g. 'SKUs' | 'stores' | 'zones'
  depth: number;
  leaf?: boolean;
  loadChildren?: () => Promise<NodeProps[]>;
}

export function TreeNode(props: NodeProps) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<NodeProps[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (props.leaf || !props.loadChildren) return;
    const next = !open; setOpen(next);
    if (next && children == null) {
      setLoading(true);
      try { setChildren(await props.loadChildren()); } finally { setLoading(false); }
    }
  }

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50 ${props.leaf ? '' : 'cursor-pointer'}`}
        style={{ paddingLeft: `${props.depth * 18 + 8}px` }}
        onClick={toggle}
      >
        {!props.leaf ? <span className={`inline-block w-3 text-slate-400 transition ${open ? 'rotate-90' : ''}`}>▸</span> : <span className="inline-block w-3 text-slate-300">•</span>}
        <span className="font-medium text-slate-700">{props.label}</span>
        {props.sub && <span className="text-xs text-slate-400">{props.sub}</span>}
        {props.count != null && <span className="ml-auto fd-pill bg-slate-100 text-slate-500">{props.count.toLocaleString()} {props.countLabel ?? 'SKUs'}</span>}
        {loading && <span className="ml-2 text-xs text-slate-400">…</span>}
      </div>
      {open && children && children.map((c, i) => <TreeNode key={i} {...c} />)}
      {open && children && children.length === 0 && (
        <div className="text-xs text-slate-400" style={{ paddingLeft: `${(props.depth + 1) * 18 + 20}px` }}>none</div>
      )}
    </div>
  );
}
