// Reporting Canvas — schema, types, and the enumerated metric catalog.
// Phase 1: data + types only. The editor + renderer build on top of these.

export type ReportKind = 'weekly' | 'monthly' | 'custom';

// =============================================================================
// Canvas schema — Canva-style grid layout.
//
// Width is expressed as a percentage of the canvas width (0-100), so layouts
// stay responsive when the canvas is rendered at different widths (preview,
// PDF, shared view). Y / H are expressed in pixels — that gives precise
// vertical placement while keeping horizontal layout fluid.
// =============================================================================

export interface BlockLayout {
  /** % of canvas width — left edge of the block (0-100). */
  x: number;
  /** Pixels from canvas top. */
  y: number;
  /** % of canvas width — width of the block (1-100). */
  w: number;
  /** Pixel height of the block. */
  h: number;
}

/** Visual / functional block types we ship in Phase 2. */
export type BlockType =
  // Layout / content
  | 'text'
  | 'heading'
  | 'divider'
  | 'image'
  | 'spacer'
  // Data
  | 'kpi'
  | 'table'
  | 'chart'
  | 'metric'
  // Container / advanced
  | 'container'
  | 'grid';

export interface CanvasBlock {
  id: string;
  type: BlockType;
  layout: BlockLayout;
  /**
   * Per-type configuration — text content, metric key, table columns, etc.
   * Schemas live in the editor; we keep this as `Record<string, unknown>` at
   * the persistence layer so adding new block kinds doesn't require a DB
   * migration.
   */
  props: Record<string, unknown>;
  /** For container blocks — nested grid of children. */
  children?: CanvasBlock[];
}

export interface CanvasSchema {
  version: 1;
  canvas: {
    width: number;          // logical canvas width in px (default 1200)
    background?: string;
    padding?: number;       // pixel padding around the page
  };
  blocks: CanvasBlock[];
}

export const EMPTY_SCHEMA: CanvasSchema = {
  version: 1,
  canvas: { width: 1200, background: '#ffffff', padding: 32 },
  blocks: [],
};

// =============================================================================
// Template — DB row shape.
// =============================================================================

export interface ReportTemplate {
  id: string;
  name: string;
  description: string | null;
  report_kind: ReportKind;
  is_global: boolean;
  schema_json: CanvasSchema;
  schema_version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportTemplateBrand {
  template_id: string;
  brand_id: string;
  assigned_at: string;
}

// =============================================================================
// Enumerated metric catalog.
//
// Every data-bound block references one of these keys. The renderer (Phase 3)
// is responsible for resolving the value from whatever source the report is
// being generated against. Comparison logic uses `comparable: true` to decide
// which metrics can show a prior-period delta.
// =============================================================================

export interface MetricDef {
  key: string;
  label: string;
  /** Display category — used to group metrics in the editor sidebar. */
  category: 'gmv' | 'revenue' | 'volume' | 'engagement' | 'custom';
  /** How the value should be rendered when no override is set. */
  format: 'currency' | 'integer' | 'decimal' | 'percent';
  /** Whether period-over-period comparison makes sense for this metric. */
  comparable: boolean;
  /** Free-text help string for the editor sidebar. */
  help?: string;
}

export const METRIC_CATALOG: MetricDef[] = [
  // GMV family
  { key: 'gmv',            label: 'GMV',            category: 'gmv',        format: 'currency', comparable: true,  help: 'Total GMV for the period.' },
  { key: 'affiliate_gmv',  label: 'Affiliate GMV',  category: 'gmv',        format: 'currency', comparable: true,  help: 'Affiliate-attributed GMV.' },
  { key: 'paid_gmv',       label: 'Paid Collab GMV',category: 'gmv',        format: 'currency', comparable: true,  help: 'GMV attributed to paid collabs.' },

  // Revenue
  { key: 'revenue',        label: 'Revenue',        category: 'revenue',    format: 'currency', comparable: true },
  { key: 'commission',     label: 'Commission',     category: 'revenue',    format: 'currency', comparable: true },

  // Volume
  { key: 'orders',         label: 'Orders',         category: 'volume',     format: 'integer',  comparable: true },
  { key: 'units_sold',     label: 'Units sold',     category: 'volume',     format: 'integer',  comparable: true,  help: 'Total units sold across all products.' },
  { key: 'affiliate_units',label: 'Affiliate units',category: 'volume',     format: 'integer',  comparable: true },
  { key: 'videos_live',    label: 'Videos live',    category: 'volume',     format: 'integer',  comparable: true },
  { key: 'videos_pipeline',label: 'Videos pipeline',category: 'volume',     format: 'integer',  comparable: false },
  { key: 'creators_active',label: 'Creators active',category: 'volume',     format: 'integer',  comparable: false },

  // Engagement
  { key: 'views',          label: 'Views',          category: 'engagement', format: 'integer',  comparable: true },
  { key: 'likes',          label: 'Likes',          category: 'engagement', format: 'integer',  comparable: true },
  { key: 'comments',       label: 'Comments',       category: 'engagement', format: 'integer',  comparable: true },
  { key: 'engagement_rate',label: 'Engagement rate',category: 'engagement', format: 'percent',  comparable: true },
];

export const METRIC_BY_KEY: ReadonlyMap<string, MetricDef> =
  new Map(METRIC_CATALOG.map(m => [m.key, m]));

// =============================================================================
// Helpers
// =============================================================================

/** Generate a stable-enough block id without pulling in `uuid`. */
export function newBlockId(): string {
  return `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Default size + props for a freshly-dropped block. Coordinates are filled
 *  in by the editor based on where the drop landed. */
export function defaultBlock(type: BlockType): Omit<CanvasBlock, 'id' | 'layout'> & { defaultSize: { w: number; h: number } } {
  switch (type) {
    case 'heading':
      return {
        type, props: { text: 'New heading', level: 2, align: 'left', color: '#111827' },
        defaultSize: { w: 80, h: 56 },
      };
    case 'text':
      return {
        type, props: { html: '<p>New text block — click to edit.</p>', align: 'left', color: '#374151', fontSize: 14 },
        defaultSize: { w: 80, h: 96 },
      };
    case 'divider':
      return {
        type, props: { color: '#e5e7eb', thickness: 1 },
        defaultSize: { w: 100, h: 16 },
      };
    case 'image':
      return {
        type, props: { src: '', alt: '', fit: 'cover' },
        defaultSize: { w: 40, h: 220 },
      };
    case 'spacer':
      return {
        type, props: {},
        defaultSize: { w: 100, h: 32 },
      };
    case 'kpi':
      return {
        type, props: {
          label: 'KPI label', value: '0', sub: '', metric_key: '',
          color: '#e8862e', bg: 'rgba(232,134,46,.08)',
        },
        defaultSize: { w: 30, h: 120 },
      };
    case 'metric':
      return {
        type, props: { metric_key: 'gmv', showLabel: true, align: 'left' },
        defaultSize: { w: 25, h: 80 },
      };
    case 'table':
      return {
        type, props: {
          columns: ['Column 1', 'Column 2', 'Column 3'],
          rows: [['', '', ''], ['', '', '']],
          headerBg: '#f3f4f6',
        },
        defaultSize: { w: 100, h: 240 },
      };
    case 'chart':
      return {
        type, props: { kind: 'bar', metric_key: 'gmv', title: 'Chart' },
        defaultSize: { w: 60, h: 280 },
      };
    case 'container':
    case 'grid':
      return {
        type, props: { bg: '#ffffff', border: '#e5e7eb', padding: 16 },
        defaultSize: { w: 100, h: 200 },
        children: [],
      } as any;
  }
}

/** Clamp a block's layout to valid canvas bounds. */
export function clampLayout(l: BlockLayout): BlockLayout {
  const w = Math.max(5, Math.min(100, l.w));
  const h = Math.max(16, l.h);
  const x = Math.max(0, Math.min(100 - w, l.x));
  const y = Math.max(0, l.y);
  return { x, y, w, h };
}

// =============================================================================
// Phase 3 — metric resolution.
//
// The renderer consumes a "metric bag" (plain key/value map) instead of
// reaching into report internals directly. The integration layer is
// responsible for building this bag from whatever data the report holds —
// e.g. a weekly report's `content` JSON or a monthly report's totals.
//
// This decouples canvas from the legacy report schema: any caller can supply
// values for the catalog keys without touching the canvas code.
// =============================================================================

export interface MetricBag {
  /** Current period values, keyed by metric.key */
  current: Record<string, number | null>;
  /** Previous period values for delta calculation, keyed by metric.key */
  previous?: Record<string, number | null>;
}

export const EMPTY_METRIC_BAG: MetricBag = { current: {}, previous: {} };

/**
 * Convert a weekly/monthly report's `content` JSON into a metric bag for the
 * canvas renderer. Unknown / missing values are left as null so the renderer
 * displays "—" without errors.
 *
 * Keep this additive — new metric keys can be added here as the catalog grows
 * without touching any block code.
 */
export function buildMetricBagFromReportContent(content: any): Record<string, number | null> {
  if (!content) return {};
  // v2 (14-section) shape — with graceful fallback to the legacy v1 `overall`.
  const snap = content.snapshot ?? {};
  const gmvPerf = content.gmv_performance ?? {};
  const activity = content.activity ?? {};
  const adOverall = content.ad_overall ?? {};
  const products = Array.isArray(content.product_analytics) ? content.product_analytics : [];
  // legacy fallbacks
  const overall = content.overall ?? {};
  const videoPerf = content.video_performance ?? {};
  const gmvMax = content.gmv_max ?? {};
  // v3 (12-section) shape: affiliate GMV and new-videos live under their own
  // sections, GMV Max is a per-product array, product units use `items_sold`.
  const affiliate = content.affiliate ?? {};
  const sampling = content.sampling ?? {};
  const gmvMaxRows = Array.isArray(content.gmv_max) ? content.gmv_max : [];

  const sum = (k: string) => products.reduce((s: number, p: any) => s + (Number(p?.[k]) || 0), 0);
  const sumRows = (rows: any[], k: string) => rows.reduce((s: number, r: any) => s + (Number(r?.[k]) || 0), 0);
  const pick = (...vals: any[]) => { for (const v of vals) { const n = num(v); if (n != null) return n; } return null; };

  return {
    gmv:            pick(snap.total_gmv, gmvPerf.total_gmv, overall.total_gmv),
    affiliate_gmv:  pick(snap.affiliate_gmv, gmvPerf.affiliate_gmv, overall.affiliate_gmv, affiliate.affiliate_gmv),
    paid_gmv:       pick(adOverall.gmv_generated, gmvMax.gmv, gmvMaxRows.length ? sumRows(gmvMaxRows, 'gross_revenue') : null),
    revenue:        null,
    commission:     null,
    orders:         pick(snap.orders, content.shop_analytics?.orders, overall.orders),
    units_sold:     (sum('items') || sum('items_sold')) || null,
    affiliate_units: null,
    videos_live:    pick(snap.new_videos_posted, activity.new_videos_posted, sampling.new_videos_posted, affiliate.new_videos_posted, videoPerf.total_videos_posted),
    videos_pipeline: null,
    creators_active: Array.isArray(content.top_creators) ? content.top_creators.length : null,
    views:          num(videoPerf.video_views),
    likes:          null,
    comments:       null,
    engagement_rate: null,
  };
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Format a metric value using its format hint. */
export function formatMetric(value: number | null | undefined, m?: MetricDef, currency = 'USD'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (!m) return String(value);
  switch (m.format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'decimal':
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
    case 'integer':
    default:
      return Math.round(value).toLocaleString();
  }
}

/** Compute the prior-period delta + percent change for a metric. */
export function metricDelta(curr: number | null | undefined, prev: number | null | undefined) {
  if (curr === null || curr === undefined || !Number.isFinite(curr)) return null;
  if (prev === null || prev === undefined || !Number.isFinite(prev)) return null;
  const diff = curr - prev;
  const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : null;
  return { diff, pct, isPositive: diff >= 0 };
}

// =============================================================================
// Phase 4 — preset section stacks.
//
// One-click "Insert section" presets — drop a whole curated block stack into
// the canvas instead of placing one block at a time. Layout coords are
// relative to the cursor: the editor offsets each block by the drop position.
// =============================================================================

export interface SectionPreset {
  key: string;
  label: string;
  icon: string;
  description: string;
  /** Total vertical space the preset needs (for stacking after drop). */
  height: number;
  /** Builder takes (xPct, y) and returns the stack of blocks for that anchor. */
  build: (xPct: number, y: number) => Omit<CanvasBlock, 'id'>[];
}

const presetHeader = (xPct: number, y: number) => [
  {
    type: 'heading' as BlockType,
    props: { text: 'Brand Weekly Report', level: 1, align: 'left', color: '#111827' },
    layout: { x: xPct, y, w: 80, h: 64 },
  },
  {
    type: 'text' as BlockType,
    props: { html: '<p>Period summary — replace with your brand voice.</p>', align: 'left', color: '#6b7280', fontSize: 14 },
    layout: { x: xPct, y: y + 70, w: 80, h: 40 },
  },
  {
    type: 'divider' as BlockType,
    props: { color: '#e5e7eb', thickness: 1 },
    layout: { x: xPct, y: y + 120, w: 100 - xPct, h: 16 },
  },
];

const presetKpiGrid = (xPct: number, y: number) => [
  {
    type: 'kpi' as BlockType,
    props: { label: 'Total GMV', value: '', metric_key: 'gmv', color: '#198754', bg: 'rgba(25,135,84,.08)' },
    layout: { x: xPct, y, w: 24, h: 110 },
  },
  {
    type: 'kpi' as BlockType,
    props: { label: 'Affiliate GMV', value: '', metric_key: 'affiliate_gmv', color: '#0d6efd', bg: 'rgba(13,110,253,.08)' },
    layout: { x: xPct + 25, y, w: 24, h: 110 },
  },
  {
    type: 'kpi' as BlockType,
    props: { label: 'Orders', value: '', metric_key: 'orders', color: '#e8862e', bg: 'rgba(232,134,46,.08)' },
    layout: { x: xPct + 50, y, w: 24, h: 110 },
  },
  {
    type: 'kpi' as BlockType,
    props: { label: 'Units sold', value: '', metric_key: 'units_sold', color: '#7e22ce', bg: 'rgba(126,34,206,.08)' },
    layout: { x: xPct + 75 > 100 - 24 ? 100 - 24 : xPct + 75, y, w: 24, h: 110 },
  },
];

const presetProductTable = (xPct: number, y: number) => [
  {
    type: 'heading' as BlockType,
    props: { text: 'Product highlights', level: 2, align: 'left', color: '#111827' },
    layout: { x: xPct, y, w: 80, h: 40 },
  },
  {
    type: 'table' as BlockType,
    props: {
      columns: ['Product', 'GMV', 'Orders', 'Units sold', 'Affiliate GMV'],
      rows: [['', '', '', '', ''], ['', '', '', '', '']],
      headerBg: '#fff7ed',
    },
    layout: { x: xPct, y: y + 50, w: 100 - xPct, h: 200 },
  },
];

const presetEngagement = (xPct: number, y: number) => [
  {
    type: 'heading' as BlockType,
    props: { text: 'Engagement', level: 2, align: 'left', color: '#111827' },
    layout: { x: xPct, y, w: 80, h: 40 },
  },
  {
    type: 'metric' as BlockType,
    props: { metric_key: 'views', showLabel: true, align: 'left' },
    layout: { x: xPct, y: y + 50, w: 24, h: 80 },
  },
  {
    type: 'metric' as BlockType,
    props: { metric_key: 'likes', showLabel: true, align: 'left' },
    layout: { x: xPct + 25, y: y + 50, w: 24, h: 80 },
  },
  {
    type: 'metric' as BlockType,
    props: { metric_key: 'comments', showLabel: true, align: 'left' },
    layout: { x: xPct + 50, y: y + 50, w: 24, h: 80 },
  },
  {
    type: 'metric' as BlockType,
    props: { metric_key: 'engagement_rate', showLabel: true, align: 'left' },
    layout: { x: xPct + 75 > 100 - 24 ? 100 - 24 : xPct + 75, y: y + 50, w: 24, h: 80 },
  },
];

export const SECTION_PRESETS: SectionPreset[] = [
  { key: 'header',         label: 'Report header', icon: 'bi-card-heading',  description: 'Title + period summary + divider', height: 140, build: presetHeader },
  { key: 'kpi-grid',       label: 'KPI grid',      icon: 'bi-grid-3x3-gap',  description: '4 KPI tiles wired to GMV / orders / units / affiliate GMV', height: 120, build: presetKpiGrid },
  { key: 'product-table',  label: 'Product table', icon: 'bi-table',         description: 'Heading + product highlights table', height: 260, build: presetProductTable },
  { key: 'engagement',     label: 'Engagement',    icon: 'bi-heart-fill',    description: 'Views / Likes / Comments / Engagement rate', height: 140, build: presetEngagement },
];

/** Parse a row from `report_templates` into a fully typed object — handles
 *  the case where the DB returned schema as a string or a missing schema. */
export function parseTemplateRow(row: any): ReportTemplate {
  let schema = row?.schema_json;
  if (typeof schema === 'string') {
    try { schema = JSON.parse(schema); } catch { schema = EMPTY_SCHEMA; }
  }
  if (!schema || typeof schema !== 'object') schema = EMPTY_SCHEMA;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    report_kind: row.report_kind ?? 'weekly',
    is_global: !!row.is_global,
    schema_json: schema as CanvasSchema,
    schema_version: row.schema_version ?? 1,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
