// ============================================================================
//  Weekly Report schema (v3) — TikTok-Shop 12-section format
// ----------------------------------------------------------------------------
//  Same registry-driven design as v2 (reportSchemaV2.ts): ONE declarative
//  registry (WEEKLY_SECTIONS_V3) drives the schema types, the empty()/normalize
//  loaders, the edit form and the read-only dashboard. Adding or changing a
//  section happens in exactly one place.
//
//  v3 is a self-contained format that COEXISTS with classic (v1) and v2 — each
//  report is routed by `content.format_version`. This file deliberately keeps
//  its own copies of the generic types + helpers so v1/v2 stay frozen.
//
//  Core rule for comparison: every metric is `number | null`.
//    • null  = never entered  -> dashboard shows "—", no delta.
//    • 0     = a real entered zero -> compares normally.
//
//  Field-source notes (from the published input sheet):
//    §1 Sampling & Videos   -> AUTO from the brand's Sample-Seeding page
//    §3 Product Analytics   -> product name/id AUTO from the brand's products
//    §12 GMV Max            -> ALL AUTO from the brand's GMV Max page
//    §2 Shop Score/Ranking  -> no brand source today; entered manually
// ============================================================================

import { CustomSection, CustomField, CustomFieldType, ApprovalRequest, Insights } from './reportSchema';
import { formatMoney } from './currency';
export type { CustomSection, CustomField, CustomFieldType, ApprovalRequest, Insights };

/** Anchors a custom section relative to a v3 standard section. */
export type StandardSectionIdV3 =
  | 'start'
  | 'sampling' | 'overall' | 'product_analytics' | 'product_traffic'
  | 'traffic_analysis' | 'channel_analytics' | 'offsite' | 'affiliate'
  | 'top_creators' | 'top_videos' | 'top_lives' | 'gmv_max'
  | 'insights';

// ============================================================================
//  Section registry types
// ============================================================================

export type FieldFormat =
  | 'currency' | 'number' | 'percent' | 'ratio' | 'score' | 'decimal'
  | 'text' | 'url' | 'bool';

export interface SectionField {
  key: string;
  label: string;
  format: FieldFormat;
  /** Auto (read-only) field computed from the section's other values. */
  auto?: (vals: Record<string, any>) => number | null;
  /** Short formula hint shown next to auto fields. */
  formula?: string;
  /** Show a week-over-week delta for this field on the dashboard. */
  comparable?: boolean;
  /** Lower is better (CPO, rank, violations) — delta color inverts. */
  lowerIsBetter?: boolean;
  /** Bootstrap grid width for the editor (scalar sections). Default 3. */
  col?: number;
  placeholder?: string;
}

export type SectionKind = 'scalar' | 'table' | 'fixed';

export interface SectionDefV3 {
  id: Exclude<StandardSectionIdV3, 'start' | 'insights'>;
  num: string;
  title: string;
  blurb?: string;
  kind: SectionKind;
  /** scalar: object fields. table/fixed: row columns. */
  fields: SectionField[];
  chart?: 'line' | 'mix' | 'funnel' | 'bars';
  /** fixed-table only: the locked first-column values (e.g. channel names). */
  fixedRows?: string[];
  /** fixed-table only: the row key that holds the locked label. */
  labelKey?: string;
  /**
   * Editor/dashboard behaviour flag for AUTO-fetched sections:
   *   'sampling'        -> pull samples-approved / new-videos from Sample Seeding
   *   'shop_score'      -> pull Shop Performance Score (weekly avg SPS) from Sample Seeding
   *   'product_catalog' -> load the brand's product list into the rows
   *   'gmv_max_product' -> pull per-product ad spend from GMV Max
   *   'video_paste'     -> paste-and-parse TikTok Shop video rows
   */
  special?: 'sampling' | 'shop_score' | 'product_catalog' | 'gmv_max_product' | 'video_paste' | 'live_sessions';
}

// ---- tiny formula helpers --------------------------------------------------
const div = (a: any, b: any): number | null => {
  const x = toN(a), y = toN(b);
  if (x == null || y == null || y === 0) return null;
  return x / y;
};
const pct = (a: any, b: any): number | null => {
  const r = div(a, b);
  return r == null ? null : r * 100;
};
function toN(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const WEEKLY_SECTIONS_V3: SectionDefV3[] = [
  // 1 ──────────────────────────────────────────────────────────────────────
  {
    id: 'sampling', num: '1', title: 'Sampling & Videos', kind: 'scalar',
    special: 'sampling',
    blurb: 'Seeding output for the week — auto-filled from the brand’s Sample-Seeding page.',
    fields: [
      { key: 'samples_approved', label: 'Samples Approved This Week', format: 'number', comparable: true, col: 6 },
      { key: 'new_videos_posted', label: 'New Videos Posted This Week', format: 'number', comparable: true, col: 6 },
    ],
  },
  // 2 ──────────────────────────────────────────────────────────────────────
  {
    id: 'overall', num: '2', title: 'Overall Performance', kind: 'scalar',
    chart: 'bars', special: 'shop_score',
    blurb: 'The headline shop numbers for the week. Shop Performance Score can be auto-pulled from Sample Seeding; the rest are entered manually.',
    fields: [
      { key: 'total_gmv', label: 'Total GMV', format: 'currency', comparable: true },
      { key: 'orders', label: 'Orders', format: 'number', comparable: true },
      { key: 'live_gmv', label: 'Live Attributed GMV', format: 'currency', comparable: true },
      { key: 'video_gmv', label: 'Video Attributed GMV', format: 'currency', comparable: true },
      { key: 'product_card_gmv', label: 'Product Card Attributed GMV', format: 'currency', comparable: true },
      { key: 'total_impressions', label: 'Total Product Impressions', format: 'number', comparable: true },
      { key: 'total_clicks', label: 'Total Product Clicks', format: 'number', comparable: true },
      { key: 'shop_performance_score', label: 'Shop Performance Score', format: 'score', comparable: true },
      { key: 'shop_ranking', label: 'Shop Ranking', format: 'number', comparable: true, lowerIsBetter: true },
    ],
  },
  // 3 ──────────────────────────────────────────────────────────────────────
  {
    id: 'product_analytics', num: '3', title: 'Product Analytics', kind: 'table',
    special: 'product_catalog',
    blurb: 'Per-product breakdown. Load your products, then fill each row’s metrics.',
    fields: [
      { key: 'product', label: 'Product Name', format: 'text' },
      { key: 'product_id', label: 'Product ID', format: 'text' },
      { key: 'total_gmv', label: 'Total GMV', format: 'currency' },
      { key: 'items_sold', label: 'Items Sold', format: 'number' },
      { key: 'atc_count', label: 'Add-to-Cart Count', format: 'number' },
      { key: 'impressions', label: 'Product Impressions', format: 'number' },
      { key: 'clicks', label: 'Product Clicks', format: 'number' },
      { key: 'ctr', label: 'CTR', format: 'percent', auto: v => pct(v.clicks, v.impressions), formula: 'Clicks ÷ Impr' },
      { key: 'creator_gmv', label: 'Creator Attributed GMV', format: 'currency' },
    ],
  },
  // 4 ──────────────────────────────────────────────────────────────────────
  {
    id: 'product_traffic', num: '4', title: 'Product Traffic', kind: 'scalar',
    blurb: 'Where the product’s GMV and traffic came from this week.',
    fields: [
      { key: 'gmv', label: 'GMV', format: 'currency', comparable: true },
      { key: 'seller_live_gmv', label: 'Seller LIVE Attributed GMV', format: 'currency', comparable: true },
      { key: 'seller_video_gmv', label: 'Seller Video Attributed GMV', format: 'currency', comparable: true },
      { key: 'creator_gmv', label: 'Creator Attributed GMV', format: 'currency', comparable: true },
      { key: 'impressions', label: 'Product Impressions', format: 'number', comparable: true },
      { key: 'clicks', label: 'Product Clicks', format: 'number', comparable: true },
      { key: 'atc_count', label: 'Add-to-Cart Count', format: 'number', comparable: true },
      { key: 'ctr', label: 'CTR', format: 'percent', auto: v => pct(v.clicks, v.impressions), formula: 'Clicks ÷ Impr' },
    ],
  },
  // 5 ──────────────────────────────────────────────────────────────────────
  {
    id: 'traffic_analysis', num: '5', title: 'Traffic Analysis', kind: 'scalar',
    blurb: 'Top-of-funnel counts for the shop.',
    fields: [
      { key: 'impressions', label: 'Product Impressions', format: 'number', comparable: true, col: 4 },
      { key: 'clicks', label: 'Product Clicks', format: 'number', comparable: true, col: 4 },
      { key: 'sku_orders', label: 'SKU Orders', format: 'number', comparable: true, col: 4 },
    ],
  },
  // 6 ──────────────────────────────────────────────────────────────────────
  {
    id: 'channel_analytics', num: '6', title: 'Channel Analytics — Video vs LIVE', kind: 'fixed',
    labelKey: 'channel', fixedRows: ['Video', 'LIVE'],
    blurb: 'Views → product viewers → CTR → attributed GMV, per channel.',
    fields: [
      { key: 'channel', label: 'Channel', format: 'text' },
      { key: 'views', label: 'Views', format: 'number' },
      { key: 'product_viewers', label: 'Product Viewers', format: 'number' },
      { key: 'ctr', label: 'CTR', format: 'percent' },
      { key: 'attributed_gmv', label: 'Attributed GMV', format: 'currency' },
    ],
  },
  // 7 ──────────────────────────────────────────────────────────────────────
  {
    id: 'offsite', num: '7', title: 'Offsite Performance', kind: 'scalar',
    blurb: 'GMV driven from outside TikTok Shop, and its lift.',
    fields: [
      { key: 'offsite_gmv', label: 'Offsite GMV', format: 'currency', comparable: true, col: 4 },
      { key: 'tiktok_shop_gmv', label: 'TikTok Shop GMV', format: 'currency', comparable: true, col: 4 },
      { key: 'offsite_effect', label: 'Offsite Effect', format: 'percent', comparable: true, col: 4 },
    ],
  },
  // 8 ──────────────────────────────────────────────────────────────────────
  {
    id: 'affiliate', num: '8', title: 'Affiliate Performance', kind: 'scalar', special: 'live_sessions',
    blurb: 'Seeding output plus creator collaboration activity and its GMV.',
    fields: [
      // "New Videos Posted" intentionally omitted here — videos are covered by §1
      // (Sampling & Videos); keeping it in §8 duplicated the metric.
      { key: 'collabs_in_progress', label: 'Collabs in Progress', format: 'number', comparable: true },
      { key: 'affiliate_gmv', label: 'Affiliate GMV', format: 'currency', comparable: true },
      { key: 'live_sessions', label: 'LIVE Sessions', format: 'number', comparable: true },
      { key: 'contacted_creators', label: 'No. of Contacted Creators', format: 'number', comparable: true },
    ],
  },
  // 9 ──────────────────────────────────────────────────────────────────────
  {
    id: 'top_creators', num: '9', title: 'Top Creators', kind: 'table',
    blurb: 'The creators who drove the most this week.',
    fields: [
      { key: 'username', label: 'Username', format: 'text' },
      { key: 'items_sold', label: 'Items Sold', format: 'number' },
      { key: 'gmv_generated', label: 'GMV Generated', format: 'currency' },
    ],
  },
  // 10 ─────────────────────────────────────────────────────────────────────
  {
    id: 'top_videos', num: '10', title: 'Top Videos', kind: 'table',
    special: 'video_paste',
    blurb: 'The best-performing videos this week. Paste the copied TikTok Shop rows to auto-fill, or add rows manually.',
    fields: [
      { key: 'video_link', label: 'Video Link', format: 'url' },
      { key: 'product_promoted', label: 'Product Promoted', format: 'text' },
      { key: 'gmv', label: 'GMV', format: 'currency' },
      { key: 'items_sold', label: 'Items Sold', format: 'number' },
    ],
  },
  // 11 ─────────────────────────────────────────────────────────────────────
  {
    id: 'top_lives', num: '11', title: 'Top Live Sessions', kind: 'table',
    blurb: 'The standout LIVE sessions this week.',
    fields: [
      { key: 'live_id', label: 'LIVE ID', format: 'text' },
      { key: 'live_duration', label: 'LIVE Duration', format: 'text' },
      { key: 'creator', label: 'Creator', format: 'text' },
      { key: 'product_sold', label: 'Product Sold', format: 'text' },
      { key: 'gmv', label: 'GMV', format: 'currency' },
    ],
  },
  // 12 ─────────────────────────────────────────────────────────────────────
  {
    id: 'gmv_max', num: '12', title: 'GMV Max — Product-Level Ad Spend & Overall', kind: 'table',
    special: 'gmv_max_product',
    blurb: 'Auto-pulled from the brand’s GMV Max page — per-product cost, orders and revenue.',
    fields: [
      { key: 'product', label: 'Product', format: 'text' },
      { key: 'product_id', label: 'Product ID', format: 'text' },
      { key: 'cost', label: 'Cost', format: 'currency' },
      { key: 'sku_orders', label: 'SKU Orders', format: 'number' },
      { key: 'cpo', label: 'CPO', format: 'currency', lowerIsBetter: true, auto: v => div(v.cost, v.sku_orders), formula: 'Cost ÷ Orders' },
      { key: 'gross_revenue', label: 'Gross Revenue', format: 'currency' },
      { key: 'roas', label: 'ROAS', format: 'ratio', auto: v => div(v.gross_revenue, v.cost), formula: 'Revenue ÷ Cost' },
    ],
  },
];

export const SECTION_BY_ID_V3: Record<string, SectionDefV3> =
  Object.fromEntries(WEEKLY_SECTIONS_V3.map(s => [s.id, s]));

/** Full render order incl. the 'start' and 'insights' anchors used by custom sections. */
export const WEEKLY_SECTION_ORDER_V3: StandardSectionIdV3[] = [
  'start',
  ...WEEKLY_SECTIONS_V3.map(s => s.id),
  'insights',
];

export const SECTION_LABELS_V3: Record<string, string> = {
  start: 'Top of report',
  ...Object.fromEntries(WEEKLY_SECTIONS_V3.map(s => [s.id, `${s.num}. ${s.title}`])),
  insights: 'Insights',
  approval: 'Approval Needed / Action Items',
};

// ============================================================================
//  Content type — derived shape, one key per section
// ============================================================================

export type ScalarData = Record<string, number | null | boolean>;
export type RowData = Record<string, number | null | string>;

export interface WeeklyReportContentV3 {
  /** Marks this report as the v3 (12-section) format. Always 'v3'. */
  format_version: 'v3';
  sampling: ScalarData;
  overall: ScalarData;
  product_analytics: RowData[];
  product_traffic: ScalarData;
  traffic_analysis: ScalarData;
  channel_analytics: RowData[];   // fixed Video / LIVE rows
  offsite: ScalarData;
  affiliate: ScalarData;
  top_creators: RowData[];
  top_videos: RowData[];
  top_lives: RowData[];
  gmv_max: RowData[];
  insights: Insights;
  custom_sections: CustomSection[];
  approval: ApprovalRequest;
}

// ---- value helpers ---------------------------------------------------------
export function numOrNull(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function str(v: any): string { return v == null ? '' : String(v); }

/** Compute an auto field (or read a manual field) from a value bag. */
export function fieldValue(field: SectionField, vals: Record<string, any>): number | null {
  if (field.auto) return field.auto(vals);
  return numOrNull(vals?.[field.key]);
}

// ---- empty factories -------------------------------------------------------
function emptyScalar(def: SectionDefV3): ScalarData {
  const o: ScalarData = {};
  for (const f of def.fields) {
    if (f.auto) continue;
    o[f.key] = f.format === 'bool' ? false : null;
  }
  return o;
}
export function emptyRow(def: SectionDefV3): RowData {
  const o: RowData = {};
  for (const f of def.fields) {
    if (f.auto) continue;
    o[f.key] = (f.format === 'text' || f.format === 'url') ? '' : null;
  }
  return o;
}
function fixedRows(def: SectionDefV3): RowData[] {
  return (def.fixedRows ?? []).map(label => ({ ...emptyRow(def), [def.labelKey ?? 'channel']: label }));
}

export const emptyContentV3 = (): WeeklyReportContentV3 => ({
  format_version: 'v3',
  sampling: emptyScalar(SECTION_BY_ID_V3.sampling),
  overall: emptyScalar(SECTION_BY_ID_V3.overall),
  product_analytics: [],
  product_traffic: emptyScalar(SECTION_BY_ID_V3.product_traffic),
  traffic_analysis: emptyScalar(SECTION_BY_ID_V3.traffic_analysis),
  channel_analytics: fixedRows(SECTION_BY_ID_V3.channel_analytics),
  offsite: emptyScalar(SECTION_BY_ID_V3.offsite),
  affiliate: emptyScalar(SECTION_BY_ID_V3.affiliate),
  top_creators: [],
  top_videos: [],
  top_lives: [],
  gmv_max: [],
  insights: { summary: '' },
  custom_sections: [],
  approval: { enabled: false, content: '' },
});

// ============================================================================
//  normalizeContentV3 — load a stored v3 report onto the v3 shape. Missing
//  values stay null so the dashboard dashes them. (v3 is a new format, so there
//  are no legacy fallbacks — this only rehydrates + fills gaps defensively.)
// ============================================================================

const VALID_ANCHORS_V3 = new Set<string>(WEEKLY_SECTION_ORDER_V3);

export function normalizeContentV3(raw: any): WeeklyReportContentV3 {
  const src = raw ?? {};

  const scalar = (def: SectionDefV3): ScalarData => {
    const newObj = src[def.id] ?? {};
    const out: ScalarData = {};
    for (const f of def.fields) {
      if (f.auto) continue;
      if (f.format === 'bool') { out[f.key] = !!newObj[f.key]; continue; }
      out[f.key] = numOrNull(newObj[f.key]);
    }
    return out;
  };

  const table = (def: SectionDefV3): RowData[] => {
    const arr = src[def.id];
    if (!Array.isArray(arr)) return [];
    return arr.map((r: any) => {
      const out: RowData = {};
      for (const f of def.fields) {
        if (f.auto) continue;
        out[f.key] = (f.format === 'text' || f.format === 'url') ? str(r[f.key]) : numOrNull(r[f.key]);
      }
      return out;
    });
  };

  const fixedTable = (def: SectionDefV3): RowData[] => {
    const labelKey = def.labelKey ?? 'channel';
    const stored: any[] = Array.isArray(src[def.id]) ? src[def.id] : [];
    return (def.fixedRows ?? []).map(label => {
      const row = stored.find(r => str(r[labelKey]) === label) ?? {};
      const out: RowData = { [labelKey]: label };
      for (const f of def.fields) {
        if (f.auto || f.key === labelKey) continue;
        out[f.key] = (f.format === 'text' || f.format === 'url') ? str(row[f.key]) : numOrNull(row[f.key]);
      }
      return out;
    });
  };

  const custom_sections: CustomSection[] = Array.isArray(src.custom_sections)
    ? src.custom_sections.map((s: any) => {
        const fields: CustomField[] = Array.isArray(s.fields) ? s.fields.map((f: any) => ({
          id: str(f.id) || crypto.randomUUID(),
          label: str(f.label),
          type: (['text', 'number', 'textarea', 'richtext', 'date', 'url', 'select'].includes(f.type) ? f.type : 'text') as CustomFieldType,
          options: Array.isArray(f.options) ? f.options.map(str) : undefined,
        })) : [];
        const rows: Record<string, any>[] = Array.isArray(s.rows) ? s.rows : [];
        const rawAnchor = str(s.insert_after);
        const anchor: StandardSectionIdV3 = VALID_ANCHORS_V3.has(rawAnchor)
          ? (rawAnchor as StandardSectionIdV3)
          : 'insights';
        return {
          id: str(s.id) || crypto.randomUUID(),
          name: str(s.name),
          description: str(s.description),
          is_repeater: !!s.is_repeater,
          body: str(s.body),
          fields,
          rows,
          insert_after: anchor,
          compare_with_previous: !!s.compare_with_previous,
        };
      })
    : [];

  const approval: ApprovalRequest = {
    enabled: !!src.approval?.enabled,
    content: str(src.approval?.content),
    expires_at: src.approval?.expires_at ?? null,
  };

  return {
    format_version: 'v3',
    sampling: scalar(SECTION_BY_ID_V3.sampling),
    overall: scalar(SECTION_BY_ID_V3.overall),
    product_analytics: table(SECTION_BY_ID_V3.product_analytics),
    product_traffic: scalar(SECTION_BY_ID_V3.product_traffic),
    traffic_analysis: scalar(SECTION_BY_ID_V3.traffic_analysis),
    channel_analytics: fixedTable(SECTION_BY_ID_V3.channel_analytics),
    offsite: scalar(SECTION_BY_ID_V3.offsite),
    affiliate: scalar(SECTION_BY_ID_V3.affiliate),
    top_creators: table(SECTION_BY_ID_V3.top_creators),
    top_videos: table(SECTION_BY_ID_V3.top_videos),
    top_lives: table(SECTION_BY_ID_V3.top_lives),
    gmv_max: table(SECTION_BY_ID_V3.gmv_max),
    insights: { summary: str(src.insights?.summary) },
    custom_sections,
    approval,
  };
}

// ---- formatting (shared by editor preview + dashboard) ---------------------
export function formatValue(format: FieldFormat, v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  switch (format) {
    case 'currency': return formatMoney(n, { compact: opts?.compact });
    case 'percent': return `${n.toFixed(2).replace(/\.00$/, '')}%`;
    case 'ratio': return `${n.toFixed(2)}x`;
    case 'score': return n.toFixed(1);
    case 'decimal': return n.toFixed(2);
    case 'number': return n.toLocaleString();
    default: return String(v);
  }
}
