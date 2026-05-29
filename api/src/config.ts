import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ActivityType =
  | 'SPARC_STRIP_CHANGE' | 'PRICE_STRIP_PRINT' | 'SEND' | 'EFFECTIVE' | 'BLACKOUT' | 'CUSTOM';

export interface MarketListDef {
  type: 'state' | 'metro' | 'class';
  name: string;
  description?: string;
  code?: string;       // state or class code
  city?: string;       // metro
  state?: string;      // metro
}

export interface TierThreshold {
  tier: number;                 // 2..4 (tier 1 is implicit on every PC)
  weeklyMarginUsd?: number;     // any of these triggers escalation to this tier
  itemLocations?: number;
  skuCount?: number;
  storeCount?: number;
  belowFloor?: number;
}
export interface ApprovalsConfig {
  roleByTier: Record<string, string>;
  tierThresholds: TierThreshold[];
}
export interface MarkdownStep { stepNo: number; markdownPct: number; afterDays: number; }
export interface MarkdownConfig {
  slowSellThroughPct: number;
  slowWeeksOnHandMin: number;
  schedule: MarkdownStep[];
}
export interface CompetitorRival { key: string; name: string; searchUrl: string; }
export interface CompetitorsConfig { rivals: CompetitorRival[]; fetchTimeoutMs: number; scrapeBatchCap: number; }

export interface PennyMarkdownConfig {
  extremeSellThroughPct: number;
  extremeWeeksOnHandMin: number;
  pennyPrice: number;
  storeCoveragePct: number;
  aiSampleCap: number;
  rationaleTemplates: string[];
}

export interface AppConfig {
  pricing: { marginFloorPct: number; assumedElasticity: number; projectionWeeks: number; defaultRoundingRule: string; endsInOptions: number[]; pricePointOptions: number[] };
  approvals: ApprovalsConfig;
  markdowns: MarkdownConfig;
  pennyMarkdown: PennyMarkdownConfig;
  competitors: CompetitorsConfig;
  leadTimes: Record<ActivityType, number>;
  pagination: { defaultPageSize: number; maxPageSize: number };
  ai: { model: string; groupSampleCap: number; pricePreviewMaxRows: number; maxTokens: number };
  regionByState: Record<string, string>;
  formatNames: Record<string, string>;
  marketLists: MarketListDef[];
  fiscal: FiscalConfig;
  calendar: CalendarSeedConfig;
}

export interface CalendarSeedConfig {
  demoZoneGroupId: number;
  demoZoneCount: number;
  regionSeasonal: Record<string, { title: string; type: string; date: string }>;
}

export interface FiscalConfig {
  fiscalYear: number;
  startDate: string;
  weekStart: string;
  pattern: number[];
  periodNames: string[];
  holidays: { date: string; name: string }[];
}

const DEFAULTS: AppConfig = {
  pricing: { marginFloorPct: 15, assumedElasticity: -1.4, projectionWeeks: 52, defaultRoundingRule: 'ENDS_IN', endsInOptions: [0.99, 0.49, 0.0], pricePointOptions: [0.99, 0.49, 0.0] },
  approvals: {
    roleByTier: { '1': 'BUYER', '2': 'CATEGORY_MGR', '3': 'DIRECTOR', '4': 'VP' },
    tierThresholds: [
      { tier: 2, weeklyMarginUsd: 10000, itemLocations: 500000, skuCount: 100, storeCount: 500, belowFloor: 1 },
      { tier: 3, weeklyMarginUsd: 50000, itemLocations: 5000000, skuCount: 1000, storeCount: 2000, belowFloor: 10 },
      { tier: 4, weeklyMarginUsd: 250000, itemLocations: 50000000, skuCount: 5000, storeCount: 5000, belowFloor: 100 },
    ],
  },
  markdowns: { slowSellThroughPct: 50, slowWeeksOnHandMin: 20, schedule: [{ stepNo: 1, markdownPct: 25, afterDays: 0 }, { stepNo: 2, markdownPct: 50, afterDays: 14 }, { stepNo: 3, markdownPct: 75, afterDays: 28 }] },
  pennyMarkdown: {
    extremeSellThroughPct: 10, extremeWeeksOnHandMin: 52, pennyPrice: 0.01, storeCoveragePct: 25, aiSampleCap: 30,
    rationaleTemplates: [
      'Vendor discontinued — no replenishment',
      'Seasonal item held past season (12+ months)',
      'Test SKU failed velocity targets',
      'Display/damaged unit, unsellable',
      'Obsolete pack/variant, replaced by newer SKU',
      'Recall residual / hazmat — destruction required',
    ],
  },
  competitors: {
    rivals: [
      { key: 'DG', name: 'Dollar General', searchUrl: 'https://www.dollargeneral.com/search?q={q}' },
      { key: 'WMT', name: 'Walmart', searchUrl: 'https://www.walmart.com/search?q={q}' },
      { key: 'DT', name: 'Dollar Tree', searchUrl: 'https://www.dollartree.com/search?q={q}' },
    ], fetchTimeoutMs: 8000, scrapeBatchCap: 25,
  },
  leadTimes: { SPARC_STRIP_CHANGE: 10, PRICE_STRIP_PRINT: 7, SEND: 5, EFFECTIVE: 0, BLACKOUT: 0, CUSTOM: 0 },
  pagination: { defaultPageSize: 50, maxPageSize: 500 },
  ai: { model: 'claude-sonnet-4-6', groupSampleCap: 150, pricePreviewMaxRows: 1000, maxTokens: 1024 },
  regionByState: {}, formatNames: {}, marketLists: [],
  fiscal: { fiscalYear: 2026, startDate: '2026-02-01', weekStart: 'SUN', pattern: [4,5,4,4,5,4,4,5,4,4,5,4], periodNames: [], holidays: [] },
  calendar: { demoZoneGroupId: 3000, demoZoneCount: 6, regionSeasonal: {} },
};

function loadAppConfig(): AppConfig {
  try {
    const raw = JSON.parse(readFileSync(resolve(process.cwd(), 'config', 'app.config.json'), 'utf8'));
    return { ...DEFAULTS, ...raw,
      pricing: { ...DEFAULTS.pricing, ...raw.pricing },
      approvals: { ...DEFAULTS.approvals, ...(raw.approvals ?? {}) },
      markdowns: { ...DEFAULTS.markdowns, ...(raw.markdowns ?? {}) },
      pennyMarkdown: { ...DEFAULTS.pennyMarkdown, ...(raw.pennyMarkdown ?? {}) },
      competitors: { ...DEFAULTS.competitors, ...(raw.competitors ?? {}) },
      ai: { ...DEFAULTS.ai, ...raw.ai },
      pagination: { ...DEFAULTS.pagination, ...raw.pagination },
      leadTimes: { ...DEFAULTS.leadTimes, ...raw.leadTimes },
      fiscal: { ...DEFAULTS.fiscal, ...(raw.fiscal ?? {}) },
      calendar: { ...DEFAULTS.calendar, ...(raw.calendar ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

const app = loadAppConfig();
const numEnv = (k: string, d: number) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);

app.pricing.marginFloorPct = numEnv('MARGIN_FLOOR_PCT', app.pricing.marginFloorPct);
app.pricing.assumedElasticity = numEnv('ASSUMED_ELASTICITY', app.pricing.assumedElasticity);
app.pagination.defaultPageSize = numEnv('DEFAULT_PAGE_SIZE', app.pagination.defaultPageSize);
app.pagination.maxPageSize = numEnv('MAX_PAGE_SIZE', app.pagination.maxPageSize);
app.ai.groupSampleCap = numEnv('AI_GROUP_SAMPLE_CAP', app.ai.groupSampleCap);
app.ai.model = process.env.ANTHROPIC_MODEL ?? app.ai.model;

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '0.0.0.0',
  datastore: (process.env.DATASTORE ?? 'memory') as 'memory' | 'oracle',
  dataDir: process.env.DATA_DIR ?? 'data',
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY ?? '', model: app.ai.model },
  oracle: {
    user: process.env.ORACLE_USER ?? '',
    password: process.env.ORACLE_PASSWORD ?? '',
    connectString: process.env.ORACLE_CONNECT_STRING ?? '',
    poolMin: numEnv('ORACLE_POOL_MIN', 2),
    poolMax: numEnv('ORACLE_POOL_MAX', 10),
    rmsSchema: process.env.ORACLE_RMS_SCHEMA ?? 'RMS',
    appPrefix: process.env.ORACLE_APP_PREFIX ?? 'FDPM_',
  },
  app,
} as const;

export type Config = typeof config;
