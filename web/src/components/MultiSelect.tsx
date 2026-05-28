import { useEffect, useMemo, useRef, useState } from 'react';

export interface MSOption { value: number; label: string; sub?: string }
interface Props {
  options: MSOption[];
  selected: number[];
  onChange: (vals: number[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  onSearchChange?: (q: string) => void;  // provide for server-side search (options refreshed by parent)
  emptyText?: string;
  disabled?: boolean;
  single?: boolean;                       // single-select mode (still searchable)
}

// A lightweight searchable multi-select: a chip control that opens a popover
// with a search box and a checkbox list. No external dependencies.
export function MultiSelect({ options, selected, onChange, placeholder = 'Select…', searchPlaceholder = 'Search…', onSearchChange, emptyText = 'No matches', disabled, single }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const labelCache = useRef<Map<number, string>>(new Map());

  useEffect(() => { for (const o of options) labelCache.current.set(o.value, o.label); }, [options]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  // de-dupe options by value (defensive — e.g. class ids repeated across depts)
  const opts = useMemo(() => { const m = new Map<number, MSOption>(); for (const o of options) if (!m.has(o.value)) m.set(o.value, o); return [...m.values()]; }, [options]);
  const filtered = useMemo(() => {
    if (onSearchChange) return opts; // parent already filtered server-side
    const s = q.trim().toLowerCase();
    return s ? opts.filter((o) => o.label.toLowerCase().includes(s) || String(o.value).includes(s) || (o.sub ?? '').toLowerCase().includes(s)) : opts;
  }, [opts, q, onSearchChange]);

  const selSet = new Set(selected);
  function toggle(v: number) {
    if (single) { onChange([v]); setOpen(false); return; }
    const s = new Set(selected); s.has(v) ? s.delete(v) : s.add(v); onChange([...s]);
  }
  function labelOf(v: number) { return labelCache.current.get(v) ?? String(v); }

  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => !disabled && setOpen((o) => !o)}
        className={`fd-input flex min-h-[38px] w-full flex-wrap items-center gap-1 text-left ${disabled ? 'opacity-50' : ''}`}>
        {selected.length === 0 && <span className="text-slate-400">{placeholder}</span>}
        {selected.slice(0, 6).map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-fd-red">
            {labelOf(v)}
            <span role="button" tabIndex={0} className="cursor-pointer hover:text-red-800" onClick={(e) => { e.stopPropagation(); toggle(v); }}>×</span>
          </span>
        ))}
        {selected.length > 6 && <span className="text-[11px] text-slate-500">+{selected.length - 6} more</span>}
        <span className="ml-auto text-slate-400">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input autoFocus className="fd-input" placeholder={searchPlaceholder} value={q}
              onChange={(e) => { setQ(e.target.value); onSearchChange?.(e.target.value); }} />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 && <div className="px-2 py-2 text-xs text-slate-400">{emptyText}</div>}
            {filtered.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-50">
                <input type={single ? 'radio' : 'checkbox'} checked={selSet.has(o.value)} onChange={() => toggle(o.value)} />
                <span className="text-slate-700">{o.label}</span>
                {o.sub && <span className="ml-auto text-slate-400">{o.sub}</span>}
              </label>
            ))}
          </div>
          {!single && selected.length > 0 && (
            <div className="flex justify-between border-t border-slate-100 px-2 py-1.5 text-[11px]">
              <span className="text-slate-400">{selected.length} selected</span>
              <button className="text-fd-red hover:underline" onClick={() => onChange([])}>clear</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
