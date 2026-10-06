import { supabase } from '../../lib/supabase';
import { SCOPE_LABEL } from '../../lib/brandScope';

/* ════════════════════════════════════════════════════════════
   SOP document model.

   One row per brand in `brand_sops`; the document is `sections jsonb`, an
   ordered array of SopSection. Every SOP carries a FIXED SPINE (below) whose
   order, kinds and headings are owned by FIXED_SECTIONS alone —
   normalizeSections() re-imposes it on every read, so the stored jsonb only
   matters for the WRITTEN bodies and any extra sections appended after the
   spine.

   DERIVED sections store nothing: their content is read live (loadSopLive
   here, the `live` bag of the sop_shared RPC on the public page — keep the
   two in lockstep).
════════════════════════════════════════════════════════════ */

export type SopKind =
  | 'focus_products'  // derived — brand_products (+ this month's sample goal)
  | 'tasks'           // derived — brands.scope
  | 'resources'       // derived — brand resources
  | 'discounts'       // written — the current promotions, shown as a callout
  | 'rich';           // written — free Quill HTML

export interface SopSection {
  id: string;
  kind: SopKind;
  title: string;
  body?: string;  // Quill HTML; only on written kinds
}

interface FixedSection { id: string; kind: SopKind; title: string; icon: string; }

/** THE ONLY place the spine order lives. */
export const FIXED_SECTIONS: FixedSection[] = [
  { id: 'focus_products', kind: 'focus_products', title: 'Focus Products', icon: 'bi-tags' },
  { id: 'tasks',          kind: 'tasks',          title: 'Tasks',          icon: 'bi-check2-square' },
  { id: 'gmv_max',        kind: 'rich',           title: 'GMV Max',        icon: 'bi-graph-up-arrow' },
  // Written, not derived: this app has no promo tracker, so the editor types
  // the running discounts here directly.
  { id: 'discounts',      kind: 'discounts',      title: 'Discounts',      icon: 'bi-percent' },
  { id: 'resources',      kind: 'resources',      title: 'Resource Links', icon: 'bi-folder2' },
];

const FIXED_BY_ID = new Map(FIXED_SECTIONS.map(f => [f.id, f]));

export const isFixed = (s: SopSection) => FIXED_BY_ID.has(s.id);
export const isWritten = (kind: SopKind) => kind === 'rich' || kind === 'discounts';
export const sectionIcon = (s: SopSection) => FIXED_BY_ID.get(s.id)?.icon ?? 'bi-pencil-square';

export function defaultSections(): SopSection[] {
  return FIXED_SECTIONS.map(f => (
    isWritten(f.kind) ? { id: f.id, kind: f.kind, title: f.title, body: '' } : { id: f.id, kind: f.kind, title: f.title }
  ));
}

export function newExtraSection(): SopSection {
  const id = `x_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return { id, kind: 'rich', title: 'New section', body: '' };
}

/**
 * Re-impose the spine on any stored array: the fixed sections in
 * canonical order with canonical titles/kinds (keeping only their written
 * body), then every other entry as an extra 'rich' block, in stored order.
 */
export function normalizeSections(raw: unknown): SopSection[] {
  const stored = Array.isArray(raw) ? raw.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
  const byId = new Map<string, Record<string, unknown>>();
  stored.forEach(s => { if (typeof s.id === 'string') byId.set(s.id, s); });

  const spine: SopSection[] = FIXED_SECTIONS.map(f => {
    const prev = byId.get(f.id);
    if (!isWritten(f.kind)) return { id: f.id, kind: f.kind, title: f.title };
    return { id: f.id, kind: f.kind, title: f.title, body: typeof prev?.body === 'string' ? prev.body : '' };
  });

  const extras: SopSection[] = stored
    .filter(s => typeof s.id === 'string' && !FIXED_BY_ID.has(s.id as string))
    .map(s => ({
      id: s.id as string,
      kind: 'rich' as const,
      title: typeof s.title === 'string' && s.title.trim() ? s.title : 'Untitled section',
      body: typeof s.body === 'string' ? s.body : '',
    }));

  return [...spine, ...extras];
}

/** Quill's empty document is "<p><br></p>" — treat it (and whitespace) as empty. */
export function isBlankHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  if (/<(img|table|hr|iframe)\b/i.test(html)) return false;
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

export const sopHeading = (brandName: string) => `${brandName} — SOP`;

/* ── live data for the derived sections ───────────────────── */

export interface SopProduct {
  id: string;
  name: string;
  external_product_id: string | null;
  tiktok_link: string | null;
  standard_commission: number | null;
  /** null = "not set yet" (never rendered as 0%). */
  shop_ads_commission: number | null;
}
export interface SopSampleProduct {
  external_product_id: string | null;
  name: string;
  monthly_goals: Record<string, number> | null;
}
export interface SopResource { id: string; name: string; url: string; description: string | null; }

export interface SopLive {
  scope: string[];
  products: SopProduct[];
  samples: SopSampleProduct[];
  resources: SopResource[];
}

export const EMPTY_LIVE: SopLive = { scope: [], products: [], samples: [], resources: [] };

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Coerce rows from either source (PostgREST selects or the sop_shared bag). */
export function normalizeLive(raw: any): SopLive {
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  return {
    scope: arr(raw?.scope).filter((x): x is string => typeof x === 'string'),
    products: arr(raw?.products).map(p => ({
      id: String(p.id ?? p.name),
      name: String(p.name ?? ''),
      external_product_id: p.external_product_id || null,
      tiktok_link: p.tiktok_link || null,
      standard_commission: num(p.standard_commission),
      shop_ads_commission: p.shop_ads_commission_not_set ? null : num(p.shop_ads_commission),
    })),
    samples: arr(raw?.samples).map(s => ({
      external_product_id: s.external_product_id || null,
      name: String(s.name ?? ''),
      monthly_goals: s.monthly_goals && typeof s.monthly_goals === 'object' ? s.monthly_goals : null,
    })),
    resources: arr(raw?.resources).map(r => ({
      id: String(r.id ?? r.url),
      name: String(r.name ?? ''),
      url: String(r.url ?? ''),
      description: r.description || null,
    })),
  };
}

/** Parallel RLS-scoped selects; nothing is stored. Mirrors sop_shared's `live`. */
export async function loadSopLive(brandId: string): Promise<SopLive> {
  const [b, p, s, r] = await Promise.all([
    supabase.from('brands').select('scope').eq('id', brandId).maybeSingle(),
    supabase.from('brand_products')
      .select('id,name,external_product_id,tiktok_link,standard_commission,shop_ads_commission,shop_ads_commission_not_set')
      .eq('brand_id', brandId).order('name'),
    supabase.from('brand_samples_products')
      .select('external_product_id,name,monthly_goals')
      .eq('brand_id', brandId).order('sort_order').order('created_at'),
    supabase.from('resources')
      .select('id,name,url,description')
      .eq('scope', 'brand').eq('brand_id', brandId)
      .order('pinned', { ascending: false }).order('sort_order').order('name'),
  ]);
  return normalizeLive({
    scope: (b.data as any)?.scope ?? [],
    products: p.data ?? [],
    samples: s.data ?? [],
    resources: r.data ?? [],
  });
}

export const currentMonthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * This month's sample goal for a focus product: match the sample-seeding row
 * by external product ID first, then by (case-insensitive) name. Same rule as
 * productGoalFor() on the Sample Seeding tab — only positive goals count.
 */
export function sampleGoalFor(p: SopProduct, samples: SopSampleProduct[], month = currentMonthKey()): number | null {
  const ext = p.external_product_id?.trim();
  const byExt = ext ? samples.find(s => s.external_product_id?.trim() === ext) : undefined;
  const match = byExt ?? samples.find(s => s.name.trim().toLowerCase() === p.name.trim().toLowerCase());
  const v = match?.monthly_goals?.[month];
  return typeof v === 'number' && v > 0 ? v : null;
}

/** What we run for this brand, one line per scope tag. */
const SCOPE_TASKS: Record<string, string> = {
  affiliate: 'Run the affiliate programme — creator outreach, sample seeding and follow-ups',
  ads: 'Manage GMV Max campaigns — budget, ROI targets and creative refresh',
  shop: 'Monitor the shop — listings, stock, reviews and shop health',
};

export function scopeLines(scope: string[]): { key: string; label: string; line: string }[] {
  return scope.map(k => ({
    key: k,
    label: SCOPE_LABEL[k] ?? k,
    line: SCOPE_TASKS[k] ?? `Handle ${SCOPE_LABEL[k] ?? k}`,
  }));
}
