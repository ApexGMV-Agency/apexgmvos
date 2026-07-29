export type ListingQuality = '' | 'excellent' | 'good' | 'fair' | 'poor';
export type YesNoNA = 'yes' | 'no' | 'not_rated';

export interface OverallPerformance {
  total_gmv: number;
  affiliate_gmv: number;
  orders: number;
  samples_approved: number;
  samples_approved_note: string;       // e.g. "MTD Approved: 38"
  ad_spend_not_started: boolean;       // true => display "Not yet started"
  ad_spend: number;
  ad_spend_target: string;             // e.g. "Target: $5,000"
  pending_collabs: number;
}

export interface TopCreator { name: string; videos: number; items_sold: number; gmv: number; notes: string; }
export interface TopVideo   { creator_name: string; video_url: string; items_sold: number; gmv: number; }

export interface VideoPerformance {
  total_videos_posted: number;
  video_views: number;
  ctr: number;   // percentage value, e.g. 0.09
  ctor: number;
}

export interface GmvMax {
  not_yet_started: boolean;
  ad_spend: number;
  roi: number;
  orders: number;
  cpo: number;
  gmv: number;
  notes: string;
}

export interface ProductRow {
  product_id: string;
  product_name: string;
  total_units_sold: number;
  affiliate_units_sold: number;
  total_gmv: number;
  affiliate_gmv: number;
  videos_posted: number;
  listing_quality: ListingQuality;
  notes: string;
}

export interface ShopHealth {
  shop_performance_score: number | null;
  product_satisfaction_rating: number | null;
  fulfillment_rating: number | null;
  customer_service_rating: number | null;
  dispatching_on_time: YesNoNA;
  replying_within_24h: YesNoNA;
  warnings_received: boolean;
  violations_received: boolean;
}

export interface Insights { summary: string; }  // summary is now HTML (rich text)

export interface ApprovalRequest {
  enabled: boolean;
  content: string;  // rich text HTML — what is being requested for approval
  /** Optional ISO timestamp. After this time the auto-popup stops appearing
   *  for clients, but the section is still viewable and decisions / comments
   *  can still be posted from the inline Approval Needed card. */
  expires_at?: string | null;
}

export type CustomFieldType = 'text' | 'number' | 'textarea' | 'richtext' | 'date' | 'url' | 'select';

export interface CustomField {
  id: string;                 // uuid per field
  label: string;
  type: CustomFieldType;
  options?: string[];         // for type 'select'
}

export type StandardSectionId = 'start' | 'overall' | 'top_creators' | 'top_videos' | 'video_performance' | 'gmv_max' | 'product_highlights' | 'shop_health' | 'insights';

export interface CustomSection {
  id: string;                 // uuid per section
  name: string;
  description?: string;
  is_repeater: boolean;       // true => table mode (fields/rows); false => text mode (body)
  body: string;               // text-mode HTML body (sanitized on render)
  fields: CustomField[];      // table-mode columns
  rows: Record<string, any>[]; // table-mode rows
  insert_after: string; // anchor section id (classic or v2) to inject after
  /** When true, the dashboard renders a comparison of numeric columns vs the
   *  previous week/month report's matching section (by id). */
  compare_with_previous?: boolean;
}

export interface WeeklyReportContent {
  overall: OverallPerformance;
  top_creators: TopCreator[];
  top_videos: TopVideo[];
  video_performance: VideoPerformance;
  gmv_max: GmvMax;
  product_highlights: ProductRow[];
  shop_health: ShopHealth;
  insights: Insights;
  custom_sections: CustomSection[];
  approval: ApprovalRequest;
}

export const emptyOverall = (): OverallPerformance => ({
  total_gmv: 0, affiliate_gmv: 0, orders: 0,
  samples_approved: 0, samples_approved_note: '',
  ad_spend_not_started: true, ad_spend: 0, ad_spend_target: '',
  pending_collabs: 0,
});

export const emptyVideoPerf = (): VideoPerformance => ({
  total_videos_posted: 0, video_views: 0, ctr: 0, ctor: 0,
});

export const emptyGmvMax = (): GmvMax => ({
  not_yet_started: true, ad_spend: 0, roi: 0, orders: 0, cpo: 0, gmv: 0, notes: '',
});

export const emptyShopHealth = (): ShopHealth => ({
  shop_performance_score: null,
  product_satisfaction_rating: null,
  fulfillment_rating: null,
  customer_service_rating: null,
  dispatching_on_time: 'not_rated',
  replying_within_24h: 'not_rated',
  warnings_received: false,
  violations_received: false,
});

export const emptyContent = (): WeeklyReportContent => ({
  overall: emptyOverall(),
  top_creators: [],
  top_videos: [],
  video_performance: emptyVideoPerf(),
  gmv_max: emptyGmvMax(),
  product_highlights: [],
  shop_health: emptyShopHealth(),
  insights: { summary: '' },
  custom_sections: [],
  approval: { enabled: false, content: '' },
});

export const emptyTopCreator = (): TopCreator => ({ name: '', videos: 0, items_sold: 0, gmv: 0, notes: '' });
export const emptyTopVideo   = (): TopVideo   => ({ creator_name: '', video_url: '', items_sold: 0, gmv: 0 });
export const emptyProduct    = (): ProductRow => ({
  product_id: '', product_name: '', total_units_sold: 0, affiliate_units_sold: 0,
  total_gmv: 0, affiliate_gmv: 0, videos_posted: 0, listing_quality: '', notes: '',
});

// Backward-compat loader: map old report shapes onto the new one gracefully.
export function normalizeContent(raw: any): WeeklyReportContent {
  const src = raw ?? {};
  const o = src.overall ?? {};
  const overall: OverallPerformance = {
    total_gmv: num(o.total_gmv ?? o.gmv),
    affiliate_gmv: num(o.affiliate_gmv),
    orders: num(o.orders),
    samples_approved: num(o.samples_approved),
    samples_approved_note: str(o.samples_approved_note),
    ad_spend_not_started: o.ad_spend_not_started ?? true,
    ad_spend: num(o.ad_spend),
    ad_spend_target: str(o.ad_spend_target),
    pending_collabs: num(o.pending_collabs),
  };
  const vp: VideoPerformance = {
    total_videos_posted: num(src.video_performance?.total_videos_posted ?? o.videos_posted),
    video_views: num(src.video_performance?.video_views),
    ctr: num(src.video_performance?.ctr),
    ctor: num(src.video_performance?.ctor),
  };
  const gm = Array.isArray(src.gmv_max) ? (src.gmv_max[0] ?? {}) : (src.gmv_max ?? {});
  const gmv_max: GmvMax = {
    not_yet_started: gm.not_yet_started ?? (!gm.ad_spend && !gm.gmv),
    ad_spend: num(gm.ad_spend ?? gm.spend),
    roi: num(gm.roi),
    orders: num(gm.orders),
    cpo: num(gm.cpo),
    gmv: num(gm.gmv),
    notes: str(gm.notes),
  };
  const product_highlights: ProductRow[] = Array.isArray(src.product_highlights)
    ? src.product_highlights.map((p: any) => ({
        product_id: str(p.product_id),
        product_name: str(p.product_name),
        total_units_sold: num(p.total_units_sold ?? p.units_sold),
        affiliate_units_sold: num(p.affiliate_units_sold),
        total_gmv: num(p.total_gmv ?? p.gmv),
        affiliate_gmv: num(p.affiliate_gmv),
        videos_posted: num(p.videos_posted ?? p.new_videos),
        listing_quality: (p.listing_quality ?? '') as ListingQuality,
        notes: str(p.notes),
      })) : [];
  const sh = src.shop_health ?? {};
  const shop_health: ShopHealth = {
    shop_performance_score: sh.shop_performance_score ?? (typeof o.sps === 'number' && o.sps > 0 ? o.sps : null),
    product_satisfaction_rating: sh.product_satisfaction_rating ?? null,
    fulfillment_rating: sh.fulfillment_rating ?? null,
    customer_service_rating: sh.customer_service_rating ?? null,
    dispatching_on_time: sh.dispatching_on_time ?? 'not_rated',
    replying_within_24h: sh.replying_within_24h ?? 'not_rated',
    warnings_received: !!sh.warnings_received,
    violations_received: !!sh.violations_received,
  };
  const top_creators: TopCreator[] = Array.isArray(src.top_creators)
    ? src.top_creators.map((r: any) => ({
        name: str(r.name), videos: num(r.videos), items_sold: num(r.items_sold),
        gmv: num(r.gmv), notes: str(r.notes),
      })) : [];
  const top_videos: TopVideo[] = Array.isArray(src.top_videos)
    ? src.top_videos.map((r: any) => ({
        creator_name: str(r.creator_name),
        video_url: str(r.video_url),
        items_sold: num(r.items_sold),
        gmv: num(r.gmv),
      })) : [];
  const VALID_POS: StandardSectionId[] = ['start','overall','top_creators','top_videos','video_performance','gmv_max','product_highlights','shop_health','insights'];
  const custom_sections: CustomSection[] = Array.isArray(src.custom_sections)
    ? src.custom_sections.map((s: any) => {
        const fields: CustomField[] = Array.isArray(s.fields) ? s.fields.map((f: any) => ({
          id: str(f.id) || crypto.randomUUID(),
          label: str(f.label),
          type: (['text','number','textarea','richtext','date','url','select'].includes(f.type) ? f.type : 'text') as CustomFieldType,
          options: Array.isArray(f.options) ? f.options.map(str) : undefined,
        })) : [];
        const rows: Record<string, any>[] = Array.isArray(s.rows) ? s.rows : [];
        const isRepeater = !!s.is_repeater;
        let body = str(s.body);
        // Migrate legacy single-entry sections (fields + one row) into a body HTML blob
        // so the new text-mode renderer keeps their content visible.
        if (!isRepeater && !body && fields.length > 0 && rows[0]) {
          body = fields.map(f => {
            const v = rows[0][f.id];
            if (v == null || v === '') return '';
            if (f.type === 'richtext' || f.type === 'textarea') return `<h5>${escapeHtml(f.label)}</h5>${String(v)}`;
            if (f.type === 'url')      return `<p><strong>${escapeHtml(f.label)}:</strong> <a href="${escapeAttr(String(v))}">${escapeHtml(String(v))}</a></p>`;
            return `<p><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(String(v))}</p>`;
          }).filter(Boolean).join('');
        }
        return {
          id: str(s.id) || crypto.randomUUID(),
          name: str(s.name),
          description: str(s.description),
          is_repeater: isRepeater,
          body,
          fields,
          rows,
          insert_after: (VALID_POS as string[]).includes(s.insert_after) ? s.insert_after : 'insights',
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
    overall,
    top_creators,
    top_videos,
    video_performance: vp,
    gmv_max,
    product_highlights,
    shop_health,
    insights: { summary: str(src.insights?.summary) },
    custom_sections,
    approval,
  };
}

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function str(v: any): string { return v == null ? '' : String(v); }
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
