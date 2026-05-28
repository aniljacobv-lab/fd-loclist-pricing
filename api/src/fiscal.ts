import { config } from './config.js';

export interface FiscalWeek { period: number; periodName: string; quarter: number; week: number; yearWeek: number; startDate: string; endDate: string; }
export interface FiscalPeriod { period: number; name: string; quarter: number; startDate: string; endDate: string; weeks: FiscalWeek[]; }
export interface FiscalCalendar {
  fiscalYear: number; startDate: string; pattern: number[];
  periods: FiscalPeriod[];
  holidays: { date: string; name: string }[];
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

let cached: FiscalCalendar | null = null;

export function buildFiscalCalendar(): FiscalCalendar {
  if (cached) return cached;
  const f = config.app.fiscal;
  const periods: FiscalPeriod[] = [];
  let cursor = f.startDate;
  let yearWeek = 1;
  for (let i = 0; i < f.pattern.length; i++) {
    const weeksInPeriod = f.pattern[i]!;
    const name = f.periodNames[i] ?? `Period ${i + 1}`;
    const quarter = Math.floor(i / 3) + 1;
    const pStart = cursor;
    const weeks: FiscalWeek[] = [];
    for (let w = 1; w <= weeksInPeriod; w++) {
      const startDate = cursor;
      const endDate = addDays(cursor, 6);
      weeks.push({ period: i + 1, periodName: name, quarter, week: w, yearWeek, startDate, endDate });
      yearWeek++;
      cursor = addDays(cursor, 7);
    }
    periods.push({ period: i + 1, name, quarter, startDate: pStart, endDate: weeks[weeks.length - 1]!.endDate, weeks });
  }
  cached = { fiscalYear: f.fiscalYear, startDate: f.startDate, pattern: f.pattern, periods, holidays: f.holidays };
  return cached;
}

export function fiscalForDate(date: string): FiscalWeek | null {
  const cal = buildFiscalCalendar();
  for (const p of cal.periods) for (const w of p.weeks) if (date >= w.startDate && date <= w.endDate) return w;
  return null;
}
