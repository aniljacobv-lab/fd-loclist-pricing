// ----------------------------------------------------------------------------
// Brand theme — built-in presets + a small custom builder. Themes are pure
// CSS-variable bundles; switching is just `document.documentElement.style.
// setProperty()` calls + a localStorage write. The whole UI re-tints because
// every brand surface goes through these variables (see src/index.css).
// ----------------------------------------------------------------------------

export interface Theme {
  id: string;
  companyName: string;
  initials: string;            // 2-3 chars rendered in the sidebar logo block
  tagline: string;             // shown under the company name
  primary: string;             // brand color (buttons, focus, links)
  primaryHover: string;        // darker shade for :hover
  appBg: string;               // page background
  sidebarBg: string;           // sidebar background
  logoBg?: string;             // optional override; defaults to primary
  logoFg?: string;             // optional override; defaults to white
}

// Tinted utility — produces an rgba() with the requested alpha from a #RRGGBB.
function tint(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Six built-in themes covering common discount-retail brand systems plus a
// neutral "Pro" theme for white-labeling and a dark mode.
export const THEMES: Theme[] = [
  { id: 'fd', companyName: 'Family Dollar', initials: 'FD', tagline: 'Pricing Workbench',
    primary: '#D8232A', primaryHover: '#b51d23', appBg: '#f6f7f9', sidebarBg: '#ffffff' },
  { id: 'dg', companyName: 'Dollar General', initials: 'DG', tagline: 'Pricing Workbench',
    primary: '#FFCC00', primaryHover: '#e6b800', appBg: '#f7f6f1', sidebarBg: '#ffffff',
    logoBg: '#FFCC00', logoFg: '#222222' },
  { id: 'dt', companyName: 'Dollar Tree', initials: 'DT', tagline: 'Pricing Workbench',
    primary: '#007A33', primaryHover: '#00622a', appBg: '#f5f8f5', sidebarBg: '#ffffff' },
  { id: 'wmt', companyName: 'Walmart', initials: 'W', tagline: 'Pricing Workbench',
    primary: '#0071CE', primaryHover: '#005ba1', appBg: '#f4f7fb', sidebarBg: '#ffffff' },
  { id: 'tgt', companyName: 'Target', initials: 'T', tagline: 'Pricing Workbench',
    primary: '#CC0000', primaryHover: '#a30000', appBg: '#f6f7f9', sidebarBg: '#ffffff' },
  { id: 'pro', companyName: 'Pricing Workbench', initials: 'PW', tagline: 'White-label',
    primary: '#3B5BDB', primaryHover: '#2f48ad', appBg: '#f7f8fa', sidebarBg: '#ffffff' },
  { id: 'slate', companyName: 'Pricing Workbench', initials: 'PW', tagline: 'Dark sidebar',
    primary: '#22c55e', primaryHover: '#16a34a', appBg: '#f6f7f9', sidebarBg: '#0f172a' },
];
export const THEME_BY_ID: Record<string, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

// User overrides applied on top of a base theme (companyName, initials, custom
// primary, custom background). All optional.
export interface ThemeOverrides {
  baseId?: string;
  companyName?: string;
  initials?: string;
  tagline?: string;
  primary?: string;
  primaryHover?: string;
  appBg?: string;
  sidebarBg?: string;
}

const STORAGE_KEY = 'fd.theme';

function readStored(): ThemeOverrides {
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!s) return {};
    return JSON.parse(s) as ThemeOverrides;
  } catch { return {}; }
}
function writeStored(t: ThemeOverrides) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(t)); } catch { /* ignore */ }
}

export function resolveTheme(overrides: ThemeOverrides = readStored()): Theme {
  const base = THEME_BY_ID[overrides.baseId ?? 'fd'] ?? THEMES[0]!;
  return {
    ...base,
    companyName: overrides.companyName ?? base.companyName,
    initials: overrides.initials ?? base.initials,
    tagline: overrides.tagline ?? base.tagline,
    primary: overrides.primary ?? base.primary,
    primaryHover: overrides.primaryHover ?? base.primaryHover,
    appBg: overrides.appBg ?? base.appBg,
    sidebarBg: overrides.sidebarBg ?? base.sidebarBg,
  };
}

// Applies a theme by setting the CSS variables that index.css reads. Also
// sets a few derived values (sidebar foreground darkens for dark sidebars).
export function applyTheme(theme: Theme): void {
  const r = document.documentElement;
  r.style.setProperty('--brand-primary', theme.primary);
  r.style.setProperty('--brand-primary-hover', theme.primaryHover);
  r.style.setProperty('--brand-tint', tint(theme.primary, 0.10));
  r.style.setProperty('--brand-tint-soft', tint(theme.primary, 0.06));
  r.style.setProperty('--app-bg', theme.appBg);
  r.style.setProperty('--sidebar-bg', theme.sidebarBg);
  r.style.setProperty('--logo-bg', theme.logoBg ?? theme.primary);
  r.style.setProperty('--logo-fg', theme.logoFg ?? '#ffffff');
  // Dark sidebar → light foreground.
  const dark = isHexDark(theme.sidebarBg);
  r.style.setProperty('--sidebar-fg', dark ? '#e5e7eb' : '#344054');
  r.style.setProperty('--sidebar-fg-muted', dark ? '#94a3b8' : '#98a2b3');
  r.style.setProperty('--sidebar-active-bg', dark ? tint(theme.primary, 0.18) : tint(theme.primary, 0.10));
  r.style.setProperty('--sidebar-active-fg', dark ? '#ffffff' : theme.primary);
  // Tab title.
  if (typeof document !== 'undefined') document.title = `${theme.companyName} — ${theme.tagline}`;
}
function isHexDark(hex: string): boolean {
  if (!hex.startsWith('#')) return false;
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) < 110;   // perceived luminance
}

// Public API — used by the picker UI and the App shell on first mount.
export const themeApi = {
  get(): { theme: Theme; overrides: ThemeOverrides } {
    const overrides = readStored();
    return { theme: resolveTheme(overrides), overrides };
  },
  set(overrides: ThemeOverrides): Theme {
    writeStored(overrides);
    const t = resolveTheme(overrides);
    applyTheme(t);
    return t;
  },
  reset(): Theme {
    writeStored({});
    const t = resolveTheme({});
    applyTheme(t);
    return t;
  },
};
