import { config } from '../config.js';

// ----------------------------------------------------------------------------
// Seasonal / weather / holiday context for AI pricing strategy.
//
// In a production system you'd wire this to a real weather feed and the FD
// fiscal calendar of vendor allowances. For the POC we derive it from the
// current date and the store regional mix, plus the holidays already in
// app.config.json. Output is a compact text block the AI prompt can quote.
// ----------------------------------------------------------------------------

export type Season = 'winter' | 'early-spring' | 'spring' | 'late-spring' | 'summer' | 'late-summer' | 'fall' | 'late-fall';

export interface RegionShare { region: string; pct: number; storeCount: number; }
export interface SeasonalContext {
  date: string;                  // YYYY-MM-DD
  season: Season;
  seasonalNotes: string[];       // bullet list of pricing-relevant cues
  weatherNotes: string[];        // region-specific climate cues for the next 8 weeks
  upcomingHolidays: { date: string; name: string; daysUntil: number }[];
  topRegions: RegionShare[];
}

// Month-driven season inference. Tilted late so May reads as "late-spring"
// (transition to summer) which is when most apparel resets happen.
export function seasonFromMonth(m: number /* 1-12 */): Season {
  if (m === 12 || m <= 1) return 'winter';
  if (m === 2) return 'early-spring';
  if (m === 3) return 'spring';
  if (m === 4 || m === 5) return 'late-spring';
  if (m === 6 || m === 7) return 'summer';
  if (m === 8) return 'late-summer';
  if (m === 9 || m === 10) return 'fall';
  return 'late-fall';
}

// Generic seasonal notes — same for every region. The AI uses these as
// "what's the merchandising backdrop right now" hints.
function notesForSeason(s: Season, m: number): string[] {
  switch (s) {
    case 'winter': return [
      'Post-holiday clearance window — heavy markdowns on Q4 seasonal SKUs',
      'Cold-weather essentials (heaters, gloves, salt) still moving in Northern regions',
      'Valentine\'s + Easter resets begin late-January',
    ];
    case 'early-spring': return [
      'Spring reset planograms hitting stores — replace winter endcaps',
      'Lawn & garden pre-season — early bird EDLP can drive trial',
      'Easter / spring break demand peak approaching',
    ];
    case 'spring': return [
      'Mother\'s Day demand window opens early May',
      'Outdoor / patio / hose / cleaning SKUs gain velocity',
      'Apparel pivot from heavier to lighter fabrics',
    ];
    case 'late-spring': return [
      'Pre-summer markdown opportunity on residual spring apparel',
      'Memorial Day + Father\'s Day promotional events ahead',
      'Lawn & garden at peak demand — defend EDLP on bestsellers',
      'Beverage / grilling categories ramping up',
    ];
    case 'summer': return [
      'Summer apparel and beach/outdoor at peak',
      '4th of July promo window — heavy promotional pressure from competitors',
      'Back-to-school reset begins mid-July',
      'Hot weather beverage + ice cream + frozen velocity peak',
    ];
    case 'late-summer': return [
      'Back-to-school is the dominant trade — pricing tested here against Walmart, Target',
      'Begin clearance on summer apparel, outdoor, lawn',
      'Halloween reset begins late August',
    ];
    case 'fall': return [
      'Halloween + harvest themed demand peak in October',
      'Back-to-school residuals → clearance',
      'Holiday SKUs begin shipping (toys, decor) — protect margin',
    ];
    case 'late-fall': return [
      'Holiday trade peak — Black Friday + Cyber Monday + December',
      'Vendor-funded promotions dominate; protect base price points',
      'Cold-weather essentials peak across all regions',
    ];
  }
  // unreachable
  return [`Month ${m}`];
}

// Region-specific climate notes for the next ~8 weeks of business.
// Source: the seasonal hazards FD pricing teams actually plan for.
function weatherNotesForRegions(top: RegionShare[], s: Season): string[] {
  const notes: string[] = [];
  const has = (r: string) => top.some((x) => x.region === r);
  if (has('Southeast')) {
    if (s === 'summer' || s === 'late-summer' || s === 'late-spring' || s === 'fall')
      notes.push('Southeast: hurricane season (Jun–Nov) — water, batteries, plywood, tarps gain demand spikes');
    if (s === 'winter' || s === 'early-spring')
      notes.push('Southeast: mild winter — apparel runs lighter than Northern regions');
  }
  if (has('Northeast') || has('Midwest')) {
    if (s === 'winter' || s === 'late-fall')
      notes.push('Northeast/Midwest: deep winter — ice melt, snow shovels, heaters at peak');
    if (s === 'summer')
      notes.push('Northeast/Midwest: heat-wave windows — fans, AC accessories, beverages');
  }
  if (has('South Central')) {
    if (s === 'summer' || s === 'late-summer')
      notes.push('South Central (TX/LA): extreme summer heat — extended hydration + cooling demand');
    if (s === 'spring' || s === 'late-spring')
      notes.push('South Central: severe-weather/tornado season — emergency supplies surge');
  }
  if (has('West')) {
    if (s === 'summer' || s === 'late-summer' || s === 'fall')
      notes.push('West: wildfire season — air filters, masks, batteries, water');
  }
  return notes;
}

// Build the full context block. Pass in the store region distribution from
// the location selector (or empty array for "all stores").
export function buildSeasonalContext(opts: { now?: Date; regions?: RegionShare[] } = {}): SeasonalContext {
  const now = opts.now ?? new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const m = now.getMonth() + 1;
  const season = seasonFromMonth(m);
  const topRegions = (opts.regions ?? []).slice(0, 5);

  // Holidays in the next 60 days from config.app.fiscal.holidays.
  const holidays = config.app.fiscal.holidays ?? [];
  const upcomingHolidays = holidays.map((h) => ({
    date: h.date, name: h.name,
    daysUntil: Math.round((new Date(h.date + 'T00:00:00Z').getTime() - new Date(dateStr + 'T00:00:00Z').getTime()) / 86_400_000),
  })).filter((h) => h.daysUntil >= 0 && h.daysUntil <= 60).sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 4);

  return {
    date: dateStr,
    season,
    seasonalNotes: notesForSeason(season, m),
    weatherNotes: weatherNotesForRegions(topRegions, season),
    upcomingHolidays,
    topRegions,
  };
}

// Compact, prompt-friendly rendering. Used by the AI strategy endpoint.
export function renderContextForPrompt(ctx: SeasonalContext): string {
  const lines: string[] = [];
  lines.push(`Date: ${ctx.date}  (season: ${ctx.season})`);
  if (ctx.topRegions.length) {
    lines.push(`Top regions in scope: ${ctx.topRegions.map((r) => `${r.region} ${Math.round(r.pct)}% (${r.storeCount.toLocaleString()} stores)`).join(', ')}`);
  }
  if (ctx.upcomingHolidays.length) {
    lines.push(`Upcoming holidays (next 60d): ${ctx.upcomingHolidays.map((h) => `${h.name} in ${h.daysUntil}d`).join(', ')}`);
  }
  if (ctx.seasonalNotes.length) {
    lines.push('Seasonal backdrop:');
    for (const n of ctx.seasonalNotes) lines.push(`  - ${n}`);
  }
  if (ctx.weatherNotes.length) {
    lines.push('Weather/region hazards (next ~8 weeks):');
    for (const n of ctx.weatherNotes) lines.push(`  - ${n}`);
  }
  return lines.join('\n');
}
