// Monthly report content schema — stored as JSONB on monthly_reports.content.
// Mirrors the Google-Doc layout: KPIs / GMV / creators / videos / video perf
// / creators perf / product analytics / customers / six rich-text narrative
// sections (each with optional image) / custom sections / approval.

import { CustomSection, StandardSectionId, ApprovalRequest, CustomField, CustomFieldType } from './reportSchema';

export interface ThisLast {
  this: number;
  last: number;
}

export interface TotalSales {
  month: number;                         // GMV / total sales for this month
  all_time: number;                      // cumulative since brand launch
  all_time_period_label: string;         // e.g. "April 1, 2025 – March 31, 2026"
  image_url: string;                     // optional screenshot (TikTok key metrics, etc.)
}

export interface MonthKPIs {
  samples_approved: ThisLast;
  new_affiliate_posts: ThisLast;
  completed_collabs: ThisLast;
  content_pending: ThisLast;
  total_orders: ThisLast;
}

export interface GMVBreakdownM {
  affiliate_gmv: ThisLast;
  organic_gmv: ThisLast;
  live_gmv: ThisLast;
  video_gmv: ThisLast;
  product_card_gmv: ThisLast;
}

export interface MonthlyTopCreator { username: string; gmv: number; }
export interface MonthlyTopVideo   { username: string; video_url: string; gmv: number; }

export interface VideoPerformanceM {
  product_impressions: ThisLast;
  product_clicks: ThisLast;
  video_views: ThisLast;
  ctr: ThisLast;                          // percent value (e.g. 2.79 means 2.79%)
  ctor: ThisLast;
  sku_orders: ThisLast;
  gmv: ThisLast;
  videos_1m_views: ThisLast;
  videos_100k_views: ThisLast;
  videos_10k_views: ThisLast;
  videos_1k_gmv: ThisLast;                // videos that generated >= $1000 GMV
  videos_100_gmv: ThisLast;               // videos that generated >= $100 GMV
  new_videos_posted: ThisLast;
}

export interface CreatorsPerformanceM {
  posted_1plus: ThisLast;                 // creators who posted >= 1 video
  posted_3plus: ThisLast;
  posted_10plus: ThisLast;
  generated_1k_plus: ThisLast;            // creators who generated >= $1k GMV
  generated_100_plus: ThisLast;           // creators who generated >= $100 GMV
}

export interface ProductAnalyticsRowM {
  product_id: string;
  product_name: string;
  units_sold: number;
  gmv: number;
  samples_approved: number;
  notes: string;
}

export interface CustomersM {
  aware_customers: ThisLast;
  new_customers: ThisLast;
  potential_new_customers: ThisLast;
  crm_messages_sent_this: string;         // e.g. "Not Yet Eligible" or numeric string
  crm_messages_sent_last: string;
  converted_customers: ThisLast;
}

export interface RichTextWithImage {
  body: string;                           // sanitized HTML
  image_url: string;                      // optional inline screenshot
}

export interface MonthlyReportContent {
  total_sales: TotalSales;
  kpis: MonthKPIs;
  gmv_breakdown: GMVBreakdownM;
  top_creators_this: MonthlyTopCreator[];
  top_creators_last: MonthlyTopCreator[];
  top_videos_this: MonthlyTopVideo[];
  top_videos_last: MonthlyTopVideo[];
  video_performance: VideoPerformanceM;
  creators_performance: CreatorsPerformanceM;
  product_analytics: ProductAnalyticsRowM[];
  customers: CustomersM;
  strategy_insights: RichTextWithImage;
  discounting: RichTextWithImage;
  gmv_max_ads: RichTextWithImage;
  paid_collabs: RichTextWithImage;
  ai_content: RichTextWithImage;
  strategy_moving_forward: RichTextWithImage;
  custom_sections: CustomSection[];
  approval: ApprovalRequest;
}

// Anchors used by custom_sections.insert_after — each map to a known monthly section.
export type MonthlyStandardSectionId =
  | 'start' | 'total_sales' | 'kpis' | 'gmv_breakdown'
  | 'top_creators' | 'top_videos' | 'video_performance' | 'creators_performance'
  | 'product_analytics' | 'customers' | 'strategy_insights' | 'discounting'
  | 'gmv_max_ads' | 'paid_collabs' | 'ai_content' | 'strategy_moving_forward';

const VALID_MONTHLY_POS: MonthlyStandardSectionId[] = [
  'start','total_sales','kpis','gmv_breakdown','top_creators','top_videos',
  'video_performance','creators_performance','product_analytics','customers',
  'strategy_insights','discounting','gmv_max_ads','paid_collabs','ai_content',
  'strategy_moving_forward',
];

// =========================================================
// constructors / defaults
// =========================================================

const tl = (): ThisLast => ({ this: 0, last: 0 });
const rti = (): RichTextWithImage => ({ body: '', image_url: '' });

export const emptyMonthlyContent = (): MonthlyReportContent => ({
  total_sales: { month: 0, all_time: 0, all_time_period_label: '', image_url: '' },
  kpis: {
    samples_approved: tl(), new_affiliate_posts: tl(), completed_collabs: tl(),
    content_pending: tl(), total_orders: tl(),
  },
  gmv_breakdown: {
    affiliate_gmv: tl(), organic_gmv: tl(), live_gmv: tl(),
    video_gmv: tl(), product_card_gmv: tl(),
  },
  top_creators_this: [],
  top_creators_last: [],
  top_videos_this: [],
  top_videos_last: [],
  video_performance: {
    product_impressions: tl(), product_clicks: tl(), video_views: tl(),
    ctr: tl(), ctor: tl(), sku_orders: tl(), gmv: tl(),
    videos_1m_views: tl(), videos_100k_views: tl(), videos_10k_views: tl(),
    videos_1k_gmv: tl(), videos_100_gmv: tl(), new_videos_posted: tl(),
  },
  creators_performance: {
    posted_1plus: tl(), posted_3plus: tl(), posted_10plus: tl(),
    generated_1k_plus: tl(), generated_100_plus: tl(),
  },
  product_analytics: [],
  customers: {
    aware_customers: tl(), new_customers: tl(), potential_new_customers: tl(),
    crm_messages_sent_this: '', crm_messages_sent_last: '',
    converted_customers: tl(),
  },
  strategy_insights: rti(),
  discounting: rti(),
  gmv_max_ads: rti(),
  paid_collabs: rti(),
  ai_content: rti(),
  strategy_moving_forward: rti(),
  custom_sections: [],
  approval: { enabled: false, content: '' },
});

export const emptyMonthlyTopCreator = (): MonthlyTopCreator => ({ username: '', gmv: 0 });
export const emptyMonthlyTopVideo   = (): MonthlyTopVideo   => ({ username: '', video_url: '', gmv: 0 });
export const emptyMonthlyProduct    = (): ProductAnalyticsRowM => ({
  product_id: '', product_name: '', units_sold: 0, gmv: 0, samples_approved: 0, notes: '',
});

// Backward-compat loader — fills missing fields from any partial content blob.
export function normalizeMonthlyContent(raw: any): MonthlyReportContent {
  const src = raw ?? {};
  const empty = emptyMonthlyContent();

  const ts = src.total_sales ?? {};
  const total_sales: TotalSales = {
    month: num(ts.month),
    all_time: num(ts.all_time),
    all_time_period_label: str(ts.all_time_period_label),
    image_url: str(ts.image_url),
  };

  const kpis                 = mergeThisLastObj(src.kpis,                 empty.kpis as unknown as Record<string, ThisLast>) as unknown as MonthKPIs;
  const gmv_breakdown        = mergeThisLastObj(src.gmv_breakdown,        empty.gmv_breakdown as unknown as Record<string, ThisLast>) as unknown as GMVBreakdownM;
  const video_performance    = mergeThisLastObj(src.video_performance,    empty.video_performance as unknown as Record<string, ThisLast>) as unknown as VideoPerformanceM;
  const creators_performance = mergeThisLastObj(src.creators_performance, empty.creators_performance as unknown as Record<string, ThisLast>) as unknown as CreatorsPerformanceM;

  const c = src.customers ?? {};
  const customers: CustomersM = {
    aware_customers: pickTL(c.aware_customers),
    new_customers: pickTL(c.new_customers),
    potential_new_customers: pickTL(c.potential_new_customers),
    crm_messages_sent_this: str(c.crm_messages_sent_this),
    crm_messages_sent_last: str(c.crm_messages_sent_last),
    converted_customers: pickTL(c.converted_customers),
  };

  const top_creators_this: MonthlyTopCreator[] = (Array.isArray(src.top_creators_this) ? src.top_creators_this : [])
    .map((r: any) => ({ username: str(r.username), gmv: num(r.gmv) }));
  const top_creators_last: MonthlyTopCreator[] = (Array.isArray(src.top_creators_last) ? src.top_creators_last : [])
    .map((r: any) => ({ username: str(r.username), gmv: num(r.gmv) }));
  const top_videos_this: MonthlyTopVideo[] = (Array.isArray(src.top_videos_this) ? src.top_videos_this : [])
    .map((r: any) => ({ username: str(r.username), video_url: str(r.video_url), gmv: num(r.gmv) }));
  const top_videos_last: MonthlyTopVideo[] = (Array.isArray(src.top_videos_last) ? src.top_videos_last : [])
    .map((r: any) => ({ username: str(r.username), video_url: str(r.video_url), gmv: num(r.gmv) }));

  const product_analytics: ProductAnalyticsRowM[] = (Array.isArray(src.product_analytics) ? src.product_analytics : [])
    .map((r: any) => ({
      product_id: str(r.product_id),
      product_name: str(r.product_name),
      units_sold: num(r.units_sold),
      gmv: num(r.gmv),
      samples_approved: num(r.samples_approved),
      notes: str(r.notes),
    }));

  const richSec = (k: keyof MonthlyReportContent): RichTextWithImage => {
    const v = (src as any)[k] ?? {};
    return { body: str(v.body), image_url: str(v.image_url) };
  };

  // Custom sections — same shape as weekly's, but anchors must be monthly ones.
  const custom_sections: CustomSection[] = Array.isArray(src.custom_sections)
    ? src.custom_sections.map((s: any) => ({
        id: str(s.id) || crypto.randomUUID(),
        name: str(s.name),
        description: str(s.description),
        is_repeater: !!s.is_repeater,
        body: str(s.body),
        fields: Array.isArray(s.fields) ? s.fields.map((f: any): CustomField => ({
          id: str(f.id) || crypto.randomUUID(),
          label: str(f.label),
          type: (['text','number','textarea','richtext','date','url','select'].includes(f.type) ? f.type : 'text') as CustomFieldType,
          options: Array.isArray(f.options) ? f.options.map(str) : undefined,
        })) : [],
        rows: Array.isArray(s.rows) ? s.rows : [],
        // insert_after for monthly uses MonthlyStandardSectionId values; we store as
        // StandardSectionId-typed string for compatibility with the shared CustomSection type.
        insert_after: (VALID_MONTHLY_POS.includes(s.insert_after as MonthlyStandardSectionId)
          ? s.insert_after
          : 'strategy_moving_forward') as unknown as StandardSectionId,
        compare_with_previous: !!s.compare_with_previous,
      }))
    : [];

  return {
    total_sales,
    kpis,
    gmv_breakdown,
    top_creators_this,
    top_creators_last,
    top_videos_this,
    top_videos_last,
    video_performance,
    creators_performance,
    product_analytics,
    customers,
    strategy_insights:        richSec('strategy_insights'),
    discounting:              richSec('discounting'),
    gmv_max_ads:              richSec('gmv_max_ads'),
    paid_collabs:             richSec('paid_collabs'),
    ai_content:               richSec('ai_content'),
    strategy_moving_forward:  richSec('strategy_moving_forward'),
    custom_sections,
    approval: {
      enabled: !!src.approval?.enabled,
      content: str(src.approval?.content),
      expires_at: src.approval?.expires_at ?? null,
    },
  };
}

// Pull "Last Month" KPI values from a previous-month report into the current one.
// Only overwrites the .last fields; current month values are preserved.
export function applyLastMonthFromPrev(
  current: MonthlyReportContent,
  prev: MonthlyReportContent,
): MonthlyReportContent {
  const c = { ...current };
  const setLast = (groupKey: keyof MonthlyReportContent, fields: string[]) => {
    const cg: any = { ...(c as any)[groupKey] };
    const pg: any = (prev as any)[groupKey] ?? {};
    for (const f of fields) {
      if (cg[f] && typeof cg[f] === 'object' && 'last' in cg[f]) {
        cg[f] = { ...cg[f], last: pg[f]?.this ?? 0 };
      }
    }
    (c as any)[groupKey] = cg;
  };
  setLast('kpis',                ['samples_approved','new_affiliate_posts','completed_collabs','content_pending','total_orders']);
  setLast('gmv_breakdown',       ['affiliate_gmv','organic_gmv','live_gmv','video_gmv','product_card_gmv']);
  setLast('video_performance',   ['product_impressions','product_clicks','video_views','ctr','ctor','sku_orders','gmv','videos_1m_views','videos_100k_views','videos_10k_views','videos_1k_gmv','videos_100_gmv','new_videos_posted']);
  setLast('creators_performance',['posted_1plus','posted_3plus','posted_10plus','generated_1k_plus','generated_100_plus']);
  // Customers has a few ThisLast fields plus two paired strings
  c.customers = {
    ...c.customers,
    aware_customers:         { ...c.customers.aware_customers,         last: prev.customers.aware_customers.this },
    new_customers:           { ...c.customers.new_customers,           last: prev.customers.new_customers.this },
    potential_new_customers: { ...c.customers.potential_new_customers, last: prev.customers.potential_new_customers.this },
    converted_customers:     { ...c.customers.converted_customers,     last: prev.customers.converted_customers.this },
    crm_messages_sent_last:  prev.customers.crm_messages_sent_this,
  };
  c.top_creators_last = [...prev.top_creators_this];
  c.top_videos_last   = [...prev.top_videos_this];
  return c;
}

// =========================================================
// helpers
// =========================================================

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function str(v: any): string { return v == null ? '' : String(v); }
function pickTL(v: any): ThisLast {
  return { this: num(v?.this), last: num(v?.last) };
}
function mergeThisLastObj<T extends Record<string, ThisLast>>(src: any, fallback: T): T {
  const out: any = { ...fallback };
  if (src && typeof src === 'object') {
    for (const k of Object.keys(out)) {
      out[k] = pickTL(src[k]);
    }
  }
  return out as T;
}
