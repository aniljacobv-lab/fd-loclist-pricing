import { useEffect, useRef, useState } from 'react';
import { THEMES, themeApi, type Theme, type ThemeOverrides } from '../lib/theme';

interface Props { onClose: () => void; }

// Small modal-style popover for picking the brand theme, company name,
// initials, and a custom brand color.
export function ThemePicker({ onClose }: Props) {
  const init = themeApi.get();
  const [baseId, setBaseId] = useState<string>(init.overrides.baseId ?? 'fd');
  const [companyName, setCompanyName] = useState(init.theme.companyName);
  const [initials, setInitials] = useState(init.theme.initials);
  const [tagline, setTagline] = useState(init.theme.tagline);
  const [primary, setPrimary] = useState<string>(init.theme.primary);
  const [logoUrl, setLogoUrl] = useState<string | undefined>(init.theme.logoUrl);
  const ref = useRef<HTMLDivElement | null>(null);

  // Outside-click close
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!ref.current) return;
      if (ref.current.contains(t)) return;
      if (t && t.closest && t.closest('[data-theme-toggle]')) return;
      onClose();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Preview-as-you-type: apply the current draft so the sidebar updates live.
  useEffect(() => { themeApi.set(draft()); /* eslint-disable-next-line */ }, [baseId, companyName, initials, tagline, primary, logoUrl]);

  function draft(): ThemeOverrides {
    return { baseId, companyName, initials: initials.slice(0, 3).toUpperCase(), tagline, primary, primaryHover: darker(primary, 0.14), logoUrl: logoUrl ?? null };
  }
  function pickBase(t: Theme) {
    setBaseId(t.id);
    // Reset overrides to the base theme's defaults so the swatch click feels clean.
    setCompanyName(t.companyName); setInitials(t.initials); setTagline(t.tagline); setPrimary(t.primary); setLogoUrl(t.logoUrl);
  }

  return (
    <div ref={ref} data-theme-picker className="absolute bottom-full left-0 z-50 mb-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-4 shadow-pop">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Brand & theme</h3>
        <button onClick={() => { themeApi.reset(); window.location.reload(); }} className="text-[11px] text-slate-400 hover:text-slate-700">Reset</button>
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Preset</div>
          <div className="grid grid-cols-3 gap-1.5">
            {THEMES.map((t) => (
              <button key={t.id} onClick={() => pickBase(t)}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition ${baseId === t.id ? 'border-slate-400 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <span className="inline-block h-4 w-4 shrink-0 rounded-sm" style={{ background: t.primary }} />
                <span className="truncate font-medium text-slate-700">{t.companyName}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Company</div>
            <input className="fd-input text-sm" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Initials</div>
            <input className="fd-input text-sm uppercase" maxLength={3} value={initials} onChange={(e) => setInitials(e.target.value.toUpperCase())} />
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tagline</div>
          <input className="fd-input text-sm" value={tagline} onChange={(e) => setTagline(e.target.value)} />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Logo image</span>
            {logoUrl && <button onClick={() => setLogoUrl(undefined)} className="text-[10px] text-slate-400 hover:text-red-600">Remove</button>}
          </div>
          <div className="flex items-center gap-2">
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              {logoUrl ? <img src={logoUrl} alt="logo" className="h-10 w-10 object-contain" /> : <span className="text-[10px] font-semibold text-slate-400">{initials || 'LOGO'}</span>}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <label className="fd-btn fd-btn-ghost h-8 cursor-pointer text-xs">
                Upload image
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => { if (typeof reader.result === 'string') setLogoUrl(reader.result); };
                    reader.readAsDataURL(f);
                    e.currentTarget.value = '';
                  }}
                />
              </label>
              <input
                className="fd-input h-8 text-[11px]"
                placeholder="…or paste image URL"
                value={logoUrl && !logoUrl.startsWith('data:') ? logoUrl : ''}
                onChange={(e) => setLogoUrl(e.target.value || undefined)}
              />
            </div>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">PNG/SVG/JPG. Uploaded files are stored locally in your browser (no upload to a server).</p>
        </div>

        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Brand color</div>
          <div className="flex items-center gap-2">
            <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-slate-200 bg-white" />
            <input className="fd-input flex-1 text-sm uppercase" value={primary} onChange={(e) => setPrimary(normalizeHex(e.target.value))} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="fd-btn fd-btn-ghost text-xs">Done</button>
        </div>
      </div>
    </div>
  );
}

// Cheap darkener for the hover state — multiplies channels by (1 - factor).
function darker(hex: string, factor: number): string {
  const m = normalizeHex(hex).replace('#', '');
  const r = Math.max(0, Math.floor(parseInt(m.slice(0, 2), 16) * (1 - factor)));
  const g = Math.max(0, Math.floor(parseInt(m.slice(2, 4), 16) * (1 - factor)));
  const b = Math.max(0, Math.floor(parseInt(m.slice(4, 6), 16) * (1 - factor)));
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}
function normalizeHex(s: string): string {
  const t = s.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(t)) return t.startsWith('#') ? t.toUpperCase() : '#' + t.toUpperCase();
  return '#D8232A';
}
