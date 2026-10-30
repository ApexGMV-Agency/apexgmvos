import { supabase } from '../../lib/supabase';
// The template row shape + its placeholder vocabulary live in the pure lib,
// so the tab, the fill panel and this layer all speak one definition.
import type { MessageTemplate } from '../../lib/messageTemplates';
export type { MessageTemplate };

/* ════════════════════════════════════════════════════════════
   Data-access layer for the Handler Collab workspace.
   Brands come from public.brands (paid-collab scope, assigned via
   paid_collab_handler_brands). Months/creators live in handler_collab_brand_months /
   handler_collab_creators, keyed by public.brands.id (RLS: handler/bob write,
   bob/apc/client/handler read via user_has_brand_access).
════════════════════════════════════════════════════════════ */

// follow_up = "in progress" with no new posted video for 1 week (new creators
// start in progress with a fresh 7-day window, even at zero videos; auto-managed
// by the handler_collab_creators_auto_status trigger + the
// handler_collab_apply_follow_ups() sweep — migrations 20260806090000 + 20260820090000).
// 'terminated' (cancelled deal) and 'awaiting_confirmation' (deal not confirmed
// yet) are manual, internal-only states: never auto-managed, stripped from every
// client-facing / read-only surface, and left out of budget maths.
export type PaymentStatus =
  'videos_in_progress' | 'follow_up' | 'pending' | 'paid' | 'terminated' | 'awaiting_confirmation';

export interface VideoCode {
  video: string;
  adCode: string;
  // When this LINK was first seen on the creator (UTC ISO). Written only by the
  // handler_collab_stamp_video_added trigger (migration 20260860090000) — never
  // send it: the DB ignores the payload value. Undefined on videos added before
  // that migration, which the UI shows as "—" rather than guessing a date.
  videoAt?: string;
  auth?: boolean;
  // Staff (Brand Detail → Paid Collab → Authorization) reported this ad code as
  // not working — the creator must generate a new one. Set via the
  // set_handler_creator_video_invalid RPC, which also notifies the brand's
  // handler(s); cleared when the handler edits the ad code (or unmarks it).
  invalid?: boolean;
  invalidAt?: string;
  invalidBy?: string;
  // Starred by the handler as one of the brand's best videos — the whole
  // Best Videos page is a query over this flag (migration 20260851090000).
  best?: boolean;
  bestAt?: string;
  bestBy?: string;
  // The CLIENT's score out of five for this video (migration 20260870090000).
  // Written ONLY by them — the share link's post-shared-paidcollab-rating edge
  // function or the signed-in portal's set_client_video_rating RPC, both of
  // which funnel into apply_video_rating. Staff surfaces render it read-only:
  // a score we entered ourselves and showed as the client's would be worse
  // than no score at all. Absent = not rated yet.
  rating?: number;
  ratedAt?: string;
  ratedBy?: string;
  /** A video the creator made BEYOND the deal — recorded only, never counted
   *  toward delivered / the contract (migration 20261008090000). */
  extra?: boolean;
  /** The Ads Manager has TESTED this ad code in the ad account (migration
   *  20261009090000). Written only by set_handler_creator_videos_tested; the
   *  handler workspace carries it through and drops it when the code changes. */
  tested?: boolean;
  testedAt?: string;
  testedBy?: string;
}

export interface Product {
  name: string;
  url: string;
}

export interface MonthlyEntry {
  gmv?: number;
  adSpent?: number;
  l30?: number;
}

export interface HandlerBrand {
  id: string;     // public.brands.id (brands are no longer a separate list)
  name: string;
  client: string;
  currency?: string | null;  // region currency (USD/GBP/EUR) — money symbol
  region?: string | null;
  logo_url?: string | null;  // brand picture; null = letter avatar
}

export interface HandlerBrandMonth {
  id: string;
  brand_id: string;
  month: string;
  budget: number;
  content_guide_url: string;
  focus_product_url: string;
  notes: string;
  /* Commission % quoted to creators on this brand's programs this month
     (migration 20260892090000). NULL = not stated, which is deliberately a
     different answer from 0 ("no commission") — hence nullable, unlike every
     other column here. Separate from brand_products' per-product rates. */
  standard_commission: number | null;
  shop_ads_commission: number | null;
  /* Does this brand want to approve a video before it goes up, this month?
     (migration 20260895090000). NOT nullable, unlike the two commissions above:
     a commission has a real "not stated" state, an on/off arrangement does not.
     ‼️ HANDLER-ONLY — never render it on a client-facing surface (the client
     portal, the public share link, report §13). See the migration. */
  approval_required: boolean;
  /* When this program was set up — the date the arrangement actually started
     (migration 20260899090000). Nullable like the commissions and for the same
     reason: NULL means nobody recorded it, which is a different answer from
     "the 1st". The month it is filed under is not this fact — a budget agreed
     on the 24th is still September. */
  onboarded_on: string | null;
}

export interface HandlerCreator {
  id: string;
  brand_id: string;
  name: string;
  tiktok_handle: string;
  amount: number;
  videos_count: number;
  /* Payout mirrors the DB derives from `payouts` (migration 20260872090000).
     Still written by the trigger and still read by the client portal, the
     share link and the creator_directory sync, so they stay on the type. */
  zelle: string;
  paypal: string;
  /* Every payment method on the deal, in the handler's own order. Read it
     through lib/creatorPayouts.creatorPayouts(), which falls back to the two
     mirrors for a row written before the migration. */
  payouts: { label: string; value: string }[];
  phone: string;
  email: string;
  category: string;
  payment_status: PaymentStatus;
  // When payment_status === 'pending', clients/Bob only see the "Payment Pending"
  // label once the handler flips this on (see handlerCollabReadonly.clientStatus).
  pending_visible_to_client: boolean;
  // Set when the share-link client marks this creator's payment as done (PayPal).
  // Soft flag only — the handler finalizes payment_status. Null = not confirmed.
  client_paid_confirmed_at?: string | null;
  client_paid_confirmed_name?: string | null;
  // The day the creator was onboarded — informational only, files nothing.
  onboarded_on: string | null;
  // 'YYYY-MM' — the program (brand-month) this deal belongs to. Read it
  // through dealMonth(), which covers rows loaded before the column existed.
  program_month: string;
  completed_on: string | null;
  // Link to the signed contract (e.g. Google Drive), pasted by the handler
  // after the creator returns the signed agreement PDF.
  contract_url?: string | null;
  // Contract §2: days to complete the deliverables after sample delivery.
  // Null = automatic (10 for <6 videos, 14 otherwise).
  deliverable_days?: number | null;
  // Last time the posted-video count increased (drives the 1-week follow-up rule).
  video_count_updated_at?: string | null;
  video_codes: VideoCode[];
  products: Product[];
  monthly: Record<string, MonthlyEntry>;
  created_at: string;
}

export async function getClients() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'paid_collab_client')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(d => ({
    id: d.id,
    name: d.full_name || 'Unknown Client',
    email: d.email || ''
  }));
}

// Server-side status sweep: stalled "Videos in Progress" creators (no new video
// for 1 week) → follow_up; all-videos-posted rows → pending. Best-effort — a
// failure (e.g. migration not applied yet) must never block the workspace.
export async function applyFollowUps(): Promise<void> {
  try { await supabase.rpc('handler_collab_apply_follow_ups'); } catch { /* ignore */ }
}

/* ── activity log (Logs tab) ──
   Brand-scoped audit rows written by the handler_collab_creators_log trigger
   (migration 20260821090000): payment-status changes (who + old → new, incl.
   the automatic sweep), client "marked payment as done", creator add/remove.
   RLS: Bob + every handler assigned to the brand + internal staff with brand
   access — so co-handlers of a shared brand see each other's changes. */
export type ActivityAction =
  | 'creator_added' | 'status_change'
  | 'client_paid_marked' | 'client_paid_unmarked' | 'creator_removed'
  // Staff reported an ad code as not working / took the report back
  // (set_handler_creator_video_invalid, migration 20260849090000).
  | 'video_code_invalid' | 'video_code_valid';
export interface ActivityLog {
  id: string;
  brand_id: string;
  creator_id: string | null;
  creator_name: string;
  month: string | null;          // creator's onboarded month at log time
  action: ActivityAction;
  old_status: string | null;
  new_status: string | null;
  auto: boolean;                 // true = automatic status sweep, not a person
  actor_id: string | null;
  actor_name: string;
  created_at: string;
}

export async function loadActivityLogs(brandIds: string[], limit = 500): Promise<ActivityLog[]> {
  if (!brandIds.length) return [];
  const { data, error } = await supabase
    .from('handler_collab_activity_log')
    .select('*')
    .in('brand_id', brandIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as ActivityLog[];
}

/* `sweep: false` skips the follow-up RPC — used by refreshes that happen right
   after a local mutation (save/delete), where the extra round trip only delays
   the UI; the load poll + the interval keep the statuses fresh anyway.

   `paidCollabScopeOnly` requires the brand to carry the "Paid Collabs" scope,
   filtered server-side so the other rows never travel. Bob passes it — he reads
   EVERY brand, so the scope is what keeps his workspace to paid-collab work.
   A handler never passes it: RLS already scopes them to the brands they were
   assigned, which is the narrower list. */
export async function loadAll(opts?: { sweep?: boolean; paidCollabScopeOnly?: boolean }) {
  // Apply the follow-up status rules before reading, so the lists show them fresh.
  if (opts?.sweep !== false) await applyFollowUps();
  const brands = await loadBrands(opts);
  const ids = brands.map(b => b.id);
  const { brandMonths, creators } = await loadBrandRows(ids);
  return { brands, brandMonths, creators };
}

/* The two halves of loadAll, so the workspace can start everything that only
   needs the brand ids the moment the brand list lands, instead of waiting for
   months + creators first (see reload() in HandlerCollabApp). */
export async function loadBrands(opts?: { paidCollabScopeOnly?: boolean }): Promise<HandlerBrand[]> {
  // Brands come from public.brands, RLS-scoped to those assigned to the handler
  // (via paid_collab_handler_brands).
  let bq = supabase.from('brands').select('id,name,client,currency,region,logo_url');
  // scope is text[]; contains() is the @> operator, so this matches a brand
  // whose scope array includes 'paid_creator' alongside its other scopes.
  if (opts?.paidCollabScopeOnly) bq = bq.contains('scope', ['paid_creator']);
  const { data, error } = await bq.order('name');
  if (error) throw error;
  return (data || []) as HandlerBrand[];
}

export async function loadBrandRows(ids: string[]) {
  if (ids.length === 0) return { brandMonths: [] as HandlerBrandMonth[], creators: [] as HandlerCreator[] };
  const [bm, c] = await Promise.all([
    supabase.from('handler_collab_brand_months').select('*').in('brand_id', ids),
    supabase.from('handler_collab_creators').select('*').in('brand_id', ids),
  ]);
  if (bm.error) throw bm.error;
  if (c.error) throw c.error;
  return {
    brandMonths: (bm.data || []) as HandlerBrandMonth[],
    creators: (c.data || []) as HandlerCreator[],
  };
}

// Brands are managed in public.brands by Bob (with the "Paid Collabs" scope) and
// assigned to handlers via paid_collab_handler_brands — handlers no longer create them.

/* ── brand weekly-report dates ──
   Weekly Performance columns are EXACTLY the weeks that exist in the brand's
   weekly_reports — each report's start/end date becomes one column. Read-only;
   RLS scopes this to the handler's assigned brands. Returns
   brand_id -> [{ start, end }] sorted ascending by start; brands with no weekly
   reports are omitted. */
export interface ReportWeek { start: string; end: string }
export async function loadBrandReportWeeks(brandIds: string[]): Promise<Record<string, ReportWeek[]>> {
  if (!brandIds.length) return {};
  // Through a definer RPC (paid_collab_report_weeks): a handler sees only the
  // weeks of their brands' reports, never the reports themselves.
  const { data, error } = await supabase.rpc('paid_collab_report_weeks', { p_brands: brandIds });
  if (error) throw error;
  const m: Record<string, ReportWeek[]> = {};
  (data || []).forEach((r: any) => {
    (m[r.brand_id] = m[r.brand_id] || []).push({ start: r.week_start, end: r.week_end });
  });
  return m;
}

// Per-brand weekly anchor (brand_report_settings.weekly_anchor) — week-1 start date
// that fixes the weekly cadence. Shared with the APC/Bob weekly-report flow.
export async function loadBrandReportAnchors(brandIds: string[]): Promise<Record<string, string>> {
  if (!brandIds.length) return {};
  const { data, error } = await supabase.rpc('paid_collab_report_anchors', { p_brands: brandIds });
  if (error) throw error;
  const m: Record<string, string> = {};
  (data || []).forEach((r: any) => { if (r.weekly_anchor) m[r.brand_id] = r.weekly_anchor; });
  return m;
}

export async function setBrandWeeklyAnchor(brandId: string, anchor: string) {
  const { error } = await supabase
    .from('brand_report_settings')
    .upsert({ brand_id: brandId, weekly_anchor: anchor }, { onConflict: 'brand_id' });
  if (error) throw error;
}

// Create a draft weekly report (same shape the APC/Bob flow inserts). The caller
// computes the next week_start/week_end/week_number from the brand's anchor +
// existing reports. Returns the inserted row's id + dates.
export async function createWeeklyReport(
  brandId: string, userId: string, weekStart: string, weekEnd: string, weekNumber: number,
): Promise<{ id: string; start: string; end: string }> {
  // In ApexGMVOS weekly reports are created by the brand's APC / Team Lead / Bob
  // from Reporting — the Paid Collab workspace only reads their weeks.
  throw new Error('Weekly reports are created from Reporting by the brand\'s APC or Bob. Once the next one exists, its week appears here.');
  const { data, error } = await supabase
    .from('weekly_reports')
    .insert({
      brand_id: brandId,
      created_by: userId,
      week_start: weekStart,
      week_end: weekEnd,
      week_number: weekNumber,
      status: 'draft',
      // Stamp the current 12-section template, exactly as the main "New Report"
      // button does. Without this the row has no format_version and is read as
      // the OLD format — which has no §13, so the handler would have nothing to
      // fill in Client Reports on a week they created here themselves.
      content: { format_version: 'v3' },
    })
    .select('id, week_start, week_end')
    .single();
  if (error) throw error;
  return { id: (data as any).id, start: (data as any).week_start, end: (data as any).week_end };
}

/* ── brand-month (budget + links) ── */
/* Blank / junk → null ("not stated"); a real 0 stays 0 ("zero percent"). */
function numOrNull(v: any): number | null {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function upsertBrandMonth(brandId: string, month: string, patch: Partial<HandlerBrandMonth>) {
  const fields: Record<string, any> = {
    budget: patch.budget != null ? Number(patch.budget) || 0 : undefined,
    content_guide_url: patch.content_guide_url,
    focus_product_url: patch.focus_product_url,
    notes: patch.notes,
    /* `null` is a value here, not an omission — it is how a rate is CLEARED —
       so these two are passed through as-is and only `undefined` (the caller
       not touching them at all) is stripped below. */
    standard_commission: patch.standard_commission === undefined ? undefined : numOrNull(patch.standard_commission),
    shop_ads_commission: patch.shop_ads_commission === undefined ? undefined : numOrNull(patch.shop_ads_commission),
    /* Coerced rather than passed through: the column is NOT NULL, so a caller
       that only meant "leave it alone" must send `undefined` (stripped below)
       and never a null, which the DB would refuse. */
    approval_required: patch.approval_required === undefined ? undefined : !!patch.approval_required,
    /* Like the two commissions, `null` is a value here and not an omission —
       it is how a recorded start date is CLEARED — so only `undefined` is
       stripped below. A blank string would be refused by a date column, so it
       is folded to null on the way past. */
    onboarded_on: patch.onboarded_on === undefined ? undefined : (patch.onboarded_on || null),
  };
  Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);
  const { data, error } = await supabase
    .from('handler_collab_brand_months')
    .upsert({ brand_id: brandId, month, ...fields }, { onConflict: 'brand_id,month' })
    .select()
    .single();
  if (error) throw error;
  return data as HandlerBrandMonth;
}

/* Every month recorded for ONE brand, newest first — the catalogue the contract
   modal offers when a handler picks which products the agreement features and
   which content brief it points at. Read here rather than threaded down from
   the workspace so the modal behaves identically wherever it is opened (the
   brand Drilldown has the month in scope, the Creators tab does not). */
export async function loadBrandMonthLinks(brandId: string): Promise<HandlerBrandMonth[]> {
  if (!brandId) return [];
  const { data, error } = await supabase
    .from('handler_collab_brand_months')
    .select('id,brand_id,month,content_guide_url,focus_product_url,standard_commission,shop_ads_commission')
    .eq('brand_id', brandId)
    .order('month', { ascending: false });
  if (error) throw error;
  return (data || []) as HandlerBrandMonth[];
}

/* The program month a deal is filed under. `program_month` is the source of
   truth; the fallbacks only cover a row shaped before that column existed. The
   onboarding date never moves a deal once program_month is set. */
export function dealMonth(c: { program_month?: string | null; onboarded_on?: string | null; created_at?: string | null } | null | undefined): string {
  if (!c) return '';
  return String(c.program_month || c.onboarded_on || c.created_at || '').slice(0, 7);
}

/* ── one creator per program ──
   A program is a brand-MONTH (`program_month`), so the same person
   may not hold two deals on one brand in one month. Identity is the TikTok
   username ONLY — two different people can share a name — and ANY shared
   handle counts, so a creator re-added with a second account listed is still
   caught. Every deal must carry at least one handle (addCreator enforces it). */
export function dealHandles(h: any): string[] {
  return String(h || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(x =>
    (x.startsWith('http') ? (x.replace(/\/+$/, '').split('/').pop() || '') : x).replace(/^@+/, '').toLowerCase().trim(),
  ).filter(Boolean);
}

export async function assertNotOnProgram(
  data: { brand_id?: string; name?: string; tiktok_handle?: string; program_month?: string | null; onboarded_on?: string | null },
  excludeId?: string,
) {
  const month = dealMonth(data);
  if (!data.brand_id || !month) return;
  const [y, m] = month.split('-').map(Number);
  const { data: rows, error } = await supabase
    .from('handler_collab_creators')
    .select('id,name,tiktok_handle')
    .eq('brand_id', data.brand_id)
    .eq('program_month', month);
  if (error) throw error;
  const mine = dealHandles(data.tiktok_handle);
  if (!mine.length) return;
  let shared = '';
  const hit = (rows || []).find(r => {
    if (excludeId && r.id === excludeId) return false;
    shared = dealHandles(r.tiktok_handle).find(h => mine.includes(h)) || '';
    return !!shared;
  });
  if (hit) {
    const label = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    throw new Error(`@${shared} is already present in this brand's ${label} program${hit.name ? ` (as ${hit.name})` : ''}.`);
  }
}

/* ── creators / deals ── */
export async function addCreator(data: Record<string, any>) {
  const payload = {
    brand_id: data.brand_id,
    name: (data.name || '').trim(),
    tiktok_handle: data.tiktok_handle || '',
    amount: Number(data.amount) || 0,
    videos_count: parseInt(data.videos_count, 10) || 0,
    /* The deal editor sends `payouts` only and the trigger derives these two.
       They stay in the payload for the legacy callers that still fill just the
       pair — the Creators Database's "Add to program" modal fills them from a
       banked creator, and the trigger turns that into the list. */
    zelle: data.zelle || '',
    paypal: data.paypal || '',
    payouts: Array.isArray(data.payouts) ? data.payouts : [],
    phone: data.phone || '',
    email: data.email || '',
    category: data.category || '',
    // A new deal isn't committed until the creator confirms, so it starts at
    // "Awaiting Confirmation" (internal-only — invisible to clients and out of
    // budget maths until the handler moves it to Videos in Progress, which is
    // also when the 7-day follow-up window starts ticking).
    payment_status: data.payment_status || 'awaiting_confirmation',
    onboarded_on: data.onboarded_on || null,
    // Blank = the trigger files it under the onboarding month.
    program_month: dealMonth(data) || null,
    contract_url: (data.contract_url || '').trim(),
    // Contract §2 completion window; null = automatic (see contractPdf.ts).
    deliverable_days: data.deliverable_days ? parseInt(data.deliverable_days, 10) || null : null,
    video_codes: Array.isArray(data.video_codes) ? data.video_codes : [],
    monthly: data.monthly && typeof data.monthly === 'object' ? data.monthly : {},
    products: Array.isArray(data.products) ? data.products : [],
  };
  if (!payload.name) throw new Error('Name required');
  if (!dealHandles(payload.tiktok_handle).length) throw new Error('TikTok username required');
  await assertNotOnProgram(payload);
  const { data: row, error } = await supabase.from('handler_collab_creators').insert(payload).select().single();
  if (error) throw error;
  return row as HandlerCreator;
}

export async function updateCreator(id: string, patch: Record<string, any>) {
  const { error } = await supabase.from('handler_collab_creators').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCreator(id: string) {
  const { error } = await supabase.from('handler_collab_creators').delete().eq('id', id);
  if (error) throw error;
}

/* ── creator contract signing links (migration 20260822090000) ──
   One shareable link per creator deal. The handler generates it from the
   Contract column; the creator opens /sign/<token>, reads the very PDF snapshot
   stored in `payload`, and signs once (frozen server-side afterwards). The
   handler can deactivate/reactivate the link and is notified on signature. */
export interface ContractSignLink {
  id: string;
  creator_id: string;
  brand_id: string;
  token: string;
  active: boolean;
  payload: Record<string, any>;
  created_at: string;
  signed_at: string | null;
  signer_name: string | null;
  signer_signature: string | null;
}

function newContractToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// All signing links for the given brands (RLS scopes to brands the caller can
// see). Signature blobs are skipped here — the list only needs the state.
export async function loadContractLinks(brandIds: string[]): Promise<ContractSignLink[]> {
  if (!brandIds.length) return [];
  const { data, error } = await supabase
    .from('handler_contract_signatures')
    .select('id, creator_id, brand_id, token, active, created_at, signed_at, signer_name')
    .in('brand_id', brandIds);
  if (error) throw error;
  return (data || []) as ContractSignLink[];
}

export async function getContractLink(creatorId: string): Promise<ContractSignLink | null> {
  const { data, error } = await supabase
    .from('handler_contract_signatures')
    .select('*')
    .eq('creator_id', creatorId)
    .maybeSingle();
  if (error) throw error;
  return (data as ContractSignLink) || null;
}

// Create the link (auto-generated token) or, when one already exists, refresh
// the snapshot the creator will sign. A SIGNED link is never touched — the
// signed copy must stay exactly what was signed.
export async function upsertContractLink(
  creatorId: string,
  brandId: string,
  payload: Record<string, any>,
): Promise<ContractSignLink> {
  const existing = await getContractLink(creatorId);
  if (existing) {
    if (existing.signed_at) return existing;
    const { data, error } = await supabase
      .from('handler_contract_signatures')
      .update({ payload })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as ContractSignLink;
  }
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('handler_contract_signatures')
    .insert({
      creator_id: creatorId,
      brand_id: brandId,
      token: newContractToken(),
      payload,
      created_by: u?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ContractSignLink;
}

// Revise a link's snapshot even after it was signed: this VOIDS the existing
// signature and reactivates the link, so the creator must sign the amended
// contract again (sign-creator-contract allows a new sign once signed_at is
// null + active). Used when the handler edits an already-signed contract.
export async function reviseSignedContractLink(
  id: string,
  payload: Record<string, any>,
): Promise<ContractSignLink> {
  const { data, error } = await supabase
    .from('handler_contract_signatures')
    .update({ payload, signed_at: null, signer_name: null, signer_signature: null, signer_user_agent: null, active: true })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as ContractSignLink;
}

export async function setContractLinkActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('handler_contract_signatures')
    .update({ active })
    .eq('id', id);
  if (error) throw error;
}

/* ── Creators Database (creator_directory, migration 20260837090000) ──
   The archive of creators we know: the "already working with us" half is
   derived live from handler_collab_creators (see creatorGlobalKey below), and
   THIS table holds the creators we've banked credentials for without a deal.
   Shared across every paid-collab handler + Bob; created_by records who added
   the row (only they — or Bob — can delete it). */
export interface DirectoryCreator {
  id: string;
  name: string;
  tiktok_handle: string;   // one per line, same convention as handler_collab_creators
  identity_key: string;    // filled server-side by the creator_directory_fill trigger
  phone: string;
  email: string;
  // Reusable multi-select tags (migration 20260840090000). `category` is kept as
  // the comma-joined mirror the DB trigger maintains, so legacy readers still work.
  categories: string[];
  category: string;
  paypal: string;
  zelle: string;
  region: string;
  followers: number | null;
  rate: number | null;
  notes: string;
  tags: string[];
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

/* The global creator identity: first TikTok handle, else the name. Mirrors the
   SQL creator_identity_key() so directory rows and deal rows collapse onto the
   same person — and creatorNoteKey above, minus the brand scope (this database
   is company-wide, one entry per human). */
export function creatorGlobalKey(c: { tiktok_handle?: string | null; name?: string | null }): string {
  const first = String(c.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  const handle = (first.startsWith('http') ? (first.replace(/\/+$/, '').split('/').pop() || '') : first)
    .replace(/^@+/, '').toLowerCase().trim();
  return handle ? `h:${handle}` : `n:${String(c.name || '').toLowerCase().trim()}`;
}

export async function loadDirectoryCreators(): Promise<DirectoryCreator[]> {
  const { data, error } = await supabase
    .from('creator_directory')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data || []) as DirectoryCreator[];
}

function directoryPayload(patch: Record<string, any>) {
  const num = (v: any) => (v === '' || v == null ? null : Number(v));
  return {
    name: (patch.name || '').trim(),
    tiktok_handle: patch.tiktok_handle || '',
    phone: patch.phone || '',
    email: patch.email || '',
    // The trigger mirrors this back into `category`, so it is not sent.
    categories: Array.isArray(patch.categories)
      ? patch.categories.map((c: any) => String(c).trim()).filter(Boolean)
      : [],
    paypal: patch.paypal || '',
    zelle: patch.zelle || '',
    region: patch.region || '',
    followers: Number.isFinite(num(patch.followers)) ? num(patch.followers) : null,
    rate: Number.isFinite(num(patch.rate)) ? num(patch.rate) : null,
    notes: patch.notes || '',
    tags: Array.isArray(patch.tags) ? patch.tags : [],
  };
}

export async function addDirectoryCreator(patch: Record<string, any>, authorName = ''): Promise<DirectoryCreator> {
  const payload = directoryPayload(patch);
  if (!payload.name) throw new Error('Name required');
  if (!dealHandles(payload.tiktok_handle).length) throw new Error('TikTok username required');
  const { data, error } = await supabase
    .from('creator_directory')
    .insert({ ...payload, created_by_name: authorName })
    .select()
    .single();
  // 23505 = another handler already banked this exact creator (unique identity_key).
  if (error) throw new Error(error.code === '23505'
    ? 'A creator with this TikTok username is already in the database.'
    : error.message);
  return data as DirectoryCreator;
}

/* Bank a whole spreadsheet of creators.
   ‼️ CHUNKED, and a failed chunk is RETRIED ROW BY ROW. A 200-row file sent
   one row at a time is 200 round-trips (~0.5s each on this stack), but one
   bad row in a multi-row insert aborts the entire statement — so the fast
   path runs in chunks and only the chunk that failed pays the per-row cost.
   The caller gets back what landed and what did not, per row, so an import
   can report itself honestly instead of just "something went wrong".
   `onProgress` counts rows ATTEMPTED, not inserted. */
export async function addDirectoryCreatorsBulk(
  patches: Record<string, any>[],
  authorName = '',
  onProgress?: (done: number, total: number) => void,
): Promise<{ inserted: DirectoryCreator[]; failed: { index: number; message: string }[] }> {
  const inserted: DirectoryCreator[] = [];
  const failed: { index: number; message: string }[] = [];
  const CHUNK = 100;
  let done = 0;

  for (let start = 0; start < patches.length; start += CHUNK) {
    const slice = patches.slice(start, start + CHUNK);
    const payloads = slice.map(p => ({ ...directoryPayload(p), created_by_name: authorName }));
    // A row without a TikTok username has no identity, so the chunk takes the
    // row-by-row path, where addDirectoryCreator rejects just that row.
    const allHaveHandles = payloads.every(p => dealHandles(p.tiktok_handle).length);
    const { data, error } = allHaveHandles
      ? await supabase.from('creator_directory').insert(payloads).select()
      : { data: null, error: { message: 'missing username' } };
    if (!error) {
      inserted.push(...((data || []) as DirectoryCreator[]));
    } else {
      // One row in this chunk is bad; find out which without losing the rest.
      for (let i = 0; i < slice.length; i++) {
        try {
          inserted.push(await addDirectoryCreator(slice[i], authorName));
        } catch (e: any) {
          failed.push({ index: start + i, message: e?.message || 'Could not save' });
        }
      }
    }
    done += slice.length;
    onProgress?.(done, patches.length);
  }
  return { inserted, failed };
}

export async function updateDirectoryCreator(id: string, patch: Record<string, any>): Promise<DirectoryCreator> {
  const payload = directoryPayload(patch);
  if (!payload.name) throw new Error('Name required');
  if (!dealHandles(payload.tiktok_handle).length) throw new Error('TikTok username required');
  const { data, error } = await supabase
    .from('creator_directory')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.code === '23505'
    ? 'Another entry already uses that TikTok handle.'
    : error.message);
  return data as DirectoryCreator;
}

export async function deleteDirectoryCreator(id: string): Promise<void> {
  const { error } = await supabase.from('creator_directory').delete().eq('id', id);
  if (error) throw error;
}

/* ── creator category catalogue (migration 20260840090000) ──
   The reusable tag vocabulary behind the multi-select category picker. Shared
   by every paid-collab handler + Bob, so one person's tagging is available to
   the next. Mirrors note_labels, except uniqueness is global rather than
   per-owner because the vocabulary itself is shared. */
export interface CreatorCategory { id: string; name: string; color: string | null; }

export async function loadCreatorCategories(): Promise<CreatorCategory[]> {
  const { data, error } = await supabase
    .from('creator_categories')
    .select('id, name, color')
    .order('name');
  if (error) throw error;
  return ((data as any[]) || []) as CreatorCategory[];
}

// Add a word to the shared vocabulary. Plain insert (the unique index is on
// lower(btrim(name))); 23505 just means someone already added it.
export async function upsertCreatorCategory(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { data: u } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('creator_categories')
    .insert({ name: trimmed, created_by: u?.user?.id ?? null });
  if (error && error.code !== '23505') throw error;
}

/* Managing the vocabulary (migration 20261117090000). All three are RPCs and
   keyed by NAME: a rename/delete rewrites every creator carrying the word, which
   a handler cannot do through RLS for brands that are not theirs. */
export async function renameCreatorCategory(oldName: string, newName: string): Promise<void> {
  const { error } = await supabase.rpc('rename_creator_category', { p_old: oldName, p_new: newName });
  if (error) throw error;
}
export async function deleteCreatorCategory(name: string): Promise<void> {
  const { error } = await supabase.rpc('delete_creator_category', { p_name: name });
  if (error) throw error;
}
export async function setCreatorCategoryColor(name: string, color: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_creator_category_color', { p_name: name, p_color: color });
  if (error) throw error;
}

/* ── contract template (signature block) settings — one row per handler ── */
export interface ContractTemplate {
  sectionEdits?: Record<string, { heading?: string; body?: string }>;
  extraSections?: { id: string; heading: string; body: string }[];
}
export interface ContractSettings {
  rep_name: string;
  signature_url: string;
  // The user's DEFAULT contract wording: section rewrites + extra sections that
  // every NEW contract starts from (may carry {placeholders}, see contractPdf).
  template?: ContractTemplate;
}

export async function getContractSettings(): Promise<ContractSettings | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('handler_contract_settings')
    .select('rep_name, signature_url, template')
    .eq('owner_id', uid)
    .maybeSingle();
  if (error) throw error;
  return (data as ContractSettings) || null;
}

export async function saveContractSettings(patch: ContractSettings) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase
    .from('handler_contract_settings')
    .upsert({ owner_id: uid, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ── persisted brand ordering (drag-and-drop in the workspace) ──
// Returns the caller's saved brand-id order (RLS scopes to their own rows).
export async function loadBrandOrder(): Promise<string[]> {
  const { data, error } = await supabase
    .from('handler_collab_brand_order')
    .select('brand_id, position')
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => r.brand_id);
}
// Replace the caller's order with `ids` (positions = array index). Reordering keeps
// every brand, so an upsert is enough; stale rows cascade-drop with the brand.
export async function saveBrandOrder(handlerId: string, ids: string[]) {
  if (!handlerId) return;
  const rows = ids.map((id, i) => ({ handler_id: handlerId, brand_id: id, position: i }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('handler_collab_brand_order')
    .upsert(rows, { onConflict: 'handler_id,brand_id' });
  if (error) throw error;
}

/* ── paid-collab comments (brand / program / week / creator / insights / kpi) ── */
export type CommentTargetType = 'brand' | 'program' | 'week' | 'creator' | 'insights' | 'kpi';
export interface PaidCollabComment {
  id: string;
  brand_id: string;
  target_type: CommentTargetType;
  target_key: string;
  author_type: 'client' | 'handler' | 'bob' | 'apc';
  author_id: string | null;
  author_name: string;
  body: string;
  parent_id: string | null;
  created_at: string;
}

// Load every comment for the given brands (RLS scopes to brands the caller can see).
export async function loadComments(brandIds: string[]): Promise<PaidCollabComment[]> {
  if (!brandIds.length) return [];
  const { data, error } = await supabase
    .from('paid_collab_comments')
    .select('*')
    .in('brand_id', brandIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as PaidCollabComment[];
}

// Add a comment as the signed-in handler/staff (RLS enforces brand access).
export async function addComment(input: {
  brandId: string; targetType: CommentTargetType; targetKey: string;
  authorId: string; authorType: 'handler' | 'bob' | 'apc'; authorName: string;
  body: string; parentId?: string | null;
}): Promise<PaidCollabComment> {
  const { data, error } = await supabase.from('paid_collab_comments').insert({
    brand_id: input.brandId,
    target_type: input.targetType,
    target_key: input.targetKey || '',
    author_type: input.authorType,
    author_id: input.authorId,
    author_name: input.authorName,
    body: input.body.trim().slice(0, 4000),
    parent_id: input.parentId || null,
  }).select().single();
  if (error) throw error;
  return data as PaidCollabComment;
}

// Signed-in CLIENT "mark payment as done" on a creator deal. Soft confirmation only
// (sets client_paid_confirmed_at, NOT payment_status) + notifies the brand's handler(s).
// Clients can't UPDATE handler_collab_creators via RLS, so this goes through a
// SECURITY DEFINER RPC. Mirrors the public share fn post-shared-paidcollab-paid.
export async function setClientPaid(creatorId: string, confirmed: boolean): Promise<HandlerCreator> {
  const { data, error } = await supabase.rpc('set_client_paidcollab_paid', {
    p_creator: creatorId,
    p_confirmed: confirmed,
  });
  if (error) throw error;
  return data as HandlerCreator;
}

// Signed-in CLIENT rates one of a creator's videos 1-5 (null clears it).
// Public share-link viewers have no session and go through the
// post-shared-paidcollab-rating edge function instead; both end up in the same
// apply_video_rating writer, so the two surfaces cannot drift. That writer also
// notifies the brand's paid-collab handler(s) (20260891090000) — which is why
// rating from HERE pings them too, not just from the share link.
export async function setClientVideoRating(
  creatorId: string, videoIndex: number, rating: number | null,
): Promise<HandlerCreator> {
  const { data, error } = await supabase.rpc('set_client_video_rating', {
    p_creator: creatorId, p_index: videoIndex, p_rating: rating,
  });
  if (error) throw error;
  return data as HandlerCreator;
}

// Add a comment as the signed-in paid-collab CLIENT. Clients can't insert into
// paid_collab_comments via RLS (only bob/handler/apc can), so this goes through a
// SECURITY DEFINER RPC that posts as author_type='client' and notifies the brand's
// handler(s). Mirrors the public share link's post-shared-paidcollab-comment fn.
export async function addClientComment(input: {
  brandId: string; targetType: CommentTargetType; targetKey: string;
  body: string; parentId?: string | null;
}): Promise<PaidCollabComment> {
  const { data, error } = await supabase.rpc('post_client_paidcollab_comment', {
    p_brand: input.brandId,
    p_tt: input.targetType,
    p_tk: input.targetKey || '',
    p_body: input.body,
    p_parent: input.parentId || null,
  });
  if (error) throw error;
  return data as PaidCollabComment;
}

// Toggle a single video's "Authorised" flag. Uses a SECURITY DEFINER RPC so APCs /
// team leads with brand access can flip it from the read-only views without broad
// write access to the creators table (bob / handler can also call it).
export async function setCreatorVideoAuth(creatorId: string, index: number, auth: boolean) {
  const { error } = await supabase.rpc('set_handler_creator_video_auth', {
    p_creator: creatorId, p_index: index, p_auth: auth,
  });
  if (error) throw error;
}

// Flag / unflag a video's ad code as INVALID (the opposite verdict to
// "Authorised"). Marking also clears auth, notifies the brand's paid-collab
// handler(s) with the message below, and writes an activity-log row — all inside
// the SECURITY DEFINER RPC (migration 20260849090000).
export async function setCreatorVideoInvalid(creatorId: string, index: number, invalid: boolean) {
  const { error } = await supabase.rpc('set_handler_creator_video_invalid', {
    p_creator: creatorId, p_index: index, p_invalid: invalid,
  });
  if (error) throw error;
}

// Mark / unmark some of ONE creator's videos as tested by the Ads Manager.
// A list of indexes so "Tested all" is one write (per-row calls on the same
// creator would each rewrite the video_codes jsonb and race). Rows without an
// ad code are skipped server-side. Returns the stored video_codes.
export async function setCreatorVideosTested(creatorId: string, indexes: number[], tested: boolean): Promise<VideoCode[]> {
  const { data, error } = await supabase.rpc('set_handler_creator_videos_tested', {
    p_creator: creatorId, p_indexes: indexes, p_tested: tested,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as VideoCode[];
}

// Star / unstar one of a creator's videos as a "best video". Same permission
// gate as the invalid verdict; the flag rides the video row itself, so the Best
// Videos page is a filter over handler_collab_creators rather than a copy of it.
export async function setCreatorVideoBest(creatorId: string, index: number, best: boolean) {
  const { error } = await supabase.rpc('set_handler_creator_video_best', {
    p_creator: creatorId, p_index: index, p_best: best,
  });
  if (error) throw error;
}

// Every best video the caller may see, newest first. Two sources, deliberately:
//   'deal'   — a starred video on a creator's deal (video_codes[i].best), the
//              original model from migration 20260851090000, and
//   'manual' — a hand-added entry from best_videos_manual (20260858090000),
//              for a video with no deal behind it.
// Neither query needs a role check: RLS scopes both per role (Bob everything,
// handler / APC / Team Lead / Ads Manager their brands; brand-less manual rows
// go to internal staff).
export interface BestVideo {
  /** Stable per row across both sources — use this as the React key. */
  key: string;
  source: 'deal' | 'manual';
  /** 'deal' only: which video of which creator the star sits on. */
  creatorId: string;
  index: number;
  /** 'manual' only: the best_videos_manual row, and who added it. */
  manualId: string;
  addedBy: string;
  /** Empty for a manual entry with no brand. */
  brandId: string;
  brandName: string;
  brandLogo: string | null;
  creator: string;
  handle: string;
  month: string;          // programme month (YYYY-MM)
  video: string;
  adCode: string;
  auth: boolean;
  starredAt: string;
  starredBy: string;
}

export interface ManualBestVideoInput {
  brandId: string | null;
  video: string;
  creatorName: string;
  handle: string;
  adCode: string;
  month: string;
}

export async function loadBestVideos(): Promise<BestVideo[]> {
  const [starred, manual] = await Promise.all([
    supabase
      .from('handler_collab_creators')
      .select('id, brand_id, name, tiktok_handle, onboarded_on, program_month, video_codes, brands(name, logo_url)')
      .filter('video_codes', 'cs', '[{"best": true}]'),
    supabase
      .from('best_videos_manual')
      .select('id, brand_id, video, creator_name, tiktok_handle, ad_code, month, created_by, created_by_name, created_at, brands(name, logo_url)'),
  ]);
  if (starred.error) throw starred.error;
  if (manual.error) throw manual.error;

  const brandOf = (row: any) => (Array.isArray(row.brands) ? row.brands[0] : row.brands);
  const out: BestVideo[] = [];

  (starred.data ?? []).forEach((c: any) => {
    const brand = brandOf(c);
    (Array.isArray(c.video_codes) ? c.video_codes : []).forEach((v: any, index: number) => {
      if (!v?.best) return;
      out.push({
        key: `deal:${c.id}:${index}`,
        source: 'deal',
        creatorId: c.id, index,
        manualId: '', addedBy: '',
        brandId: c.brand_id,
        brandName: brand?.name ?? '—',
        brandLogo: brand?.logo_url ?? null,
        creator: c.name || 'Unnamed creator',
        handle: String(c.tiktok_handle || '').split(/[\n,]/)[0].trim(),
        month: dealMonth(c),
        video: v.video || '',
        adCode: v.adCode || '',
        auth: !!v.auth,
        starredAt: v.bestAt || '',
        starredBy: v.bestBy || '',
      });
    });
  });

  (manual.data ?? []).forEach((m: any) => {
    const brand = brandOf(m);
    out.push({
      key: `manual:${m.id}`,
      source: 'manual',
      creatorId: '', index: -1,
      manualId: m.id,
      addedBy: m.created_by || '',
      brandId: m.brand_id || '',
      brandName: brand?.name ?? '',
      brandLogo: brand?.logo_url ?? null,
      creator: m.creator_name || 'Unnamed creator',
      handle: String(m.tiktok_handle || '').split(/[\n,]/)[0].trim(),
      month: m.month || '',
      video: m.video || '',
      adCode: m.ad_code || '',
      auth: false,
      starredAt: m.created_at || '',
      starredBy: m.created_by_name || '',
    });
  });

  return out.sort((a, b) => String(b.starredAt).localeCompare(String(a.starredAt)));
}

// created_by / created_by_name are stamped by the best_videos_manual_fill
// trigger, so they are deliberately not sent from here — the insert policy
// checks the stamped value.
export async function addManualBestVideo(input: ManualBestVideoInput) {
  const { error } = await supabase.from('best_videos_manual').insert({
    brand_id: input.brandId || null,
    video: input.video.trim(),
    creator_name: input.creatorName.trim(),
    tiktok_handle: input.handle.trim(),
    ad_code: input.adCode.trim(),
    month: input.month || '',
  });
  if (error) throw error;
}

export async function deleteManualBestVideo(id: string) {
  const { error } = await supabase.from('best_videos_manual').delete().eq('id', id);
  if (error) throw error;
}

// Brands the caller may pin a manual best video to. RLS scopes the list, so
// this is every brand they can see — Bob all, an APC / handler only theirs.
export async function loadBestVideoBrands(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase.from('brands').select('id, name').order('name');
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}

// The message the handler forwards to the creator. Kept in sync with the body
// built inside set_handler_creator_video_invalid (same migration) — the RPC
// writes it into the notification, this builds it for the copy buttons.
export function invalidCodeMessage(creatorName: string | null | undefined, videoUrl: string | null | undefined) {
  const first = String(creatorName ?? '').trim().split(/\s+/)[0] || 'there';
  const link = String(videoUrl ?? '').trim() || '(video link not added yet)';
  return `Hi ${first}! It looks like the ad code for one of your videos isn't working. `
    + `Could you please generate a new ad code for the video below and send it over?\n\n${link}`;
}

// Update a creator's `monthly` GMV / Ad Spent / L30 map (the Performance tab). Goes
// through a SECURITY DEFINER RPC so internal staff (apc / team_lead) with brand access
// — not only bob / the assigned handler — can edit performance numbers without broad
// write access to the creators table (bob / handlers are allowed too).
export async function setCreatorMonthly(creatorId: string, monthly: Record<string, any>) {
  const { error } = await supabase.rpc('set_handler_creator_monthly', {
    p_creator: creatorId, p_monthly: monthly,
  });
  if (error) throw error;
}

/* ── Notes board (Google Keep-style) ──
   Global notes for the handler workspace (handler_notes). Owner-scoped via RLS;
   a note can optionally link to a brand (brand-wise) and/or a month (program-wise),
   carry free-form labels, and a reminder that fires an in-app/push notification. */
export interface HandlerNote {
  id: string;
  owner_id: string;
  brand_id: string | null;
  creator_id: string | null;   // optional "creator-wise" link → handler_collab_creators
  month: string | null;
  title: string;
  body: string;
  color: string;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  reminder_at: string | null;
  reminder_done: boolean;
  reminder_sent_at: string | null;
  // Super Boss only: Ads Managers can read (not edit) this note (legacy — superseded
  // by handler_note_shares; the column is kept for back-compat).
  shared_with_ads: boolean;
  // Which Notes PAGE this note lives on (20260904090000). 'private' = the Keep
  // board (reminders, sharing, pinning, archive); 'update' = the brand-column
  // timeline, which is read-and-add only. Every note written before that
  // migration is 'private', by column default.
  stream?: NoteStream;
  created_at: string;
  updated_at: string;
  // Populated ONLY by list_visible_notes() (the board/fab read path) — the owner's
  // role/name drive role-based colouring + the "shared by" chip; is_owner gates edits.
  owner_role?: string;
  owner_is_superbob?: boolean;
  owner_name?: string;
  is_owner?: boolean;
  // For the caller's OWN notes: who it's shared with (empty otherwise).
  shares?: { kind: string; role?: string | null; team?: string | null; team_name?: string | null }[];
}

/* The two Notes pages. A note belongs to exactly one of them, decided where it
   is written and never afterwards — the timeline cannot edit a note at all, and
   the board never sees an update note. */
export type NoteStream = 'private' | 'update';

// A row with no stream is a private note: that is the column's own default, and
// it is what every note written before 20260904090000 is.
export function noteStream(n: { stream?: string | null }): NoteStream {
  return n.stream === 'update' ? 'update' : 'private';
}

export type NotePatch = Partial<Omit<HandlerNote, 'id' | 'owner_id' | 'created_at' | 'updated_at'>>;

/* ── Note sharing (cross-role) ──
   A note owned by internal staff can be shared with ROLE groups; Super Boss can
   also share with EVERYONE or a specific TEAM (a Team Lead + the APCs under them).
   Recipients get read-only access (resolved by note_shared_with_caller in RLS).

   'paid_collab_handler' (20260879090000) is the handlers' own circle and does
   NOT mix with the staff targets: only a handler may write it, they may write
   nothing else, and it resolves to the handlers on the OWNER's side of the
   internal/external line — internal to internal, external to external. There is
   one token rather than two because the side is read off the owner's profile,
   so no client can name the other circle. */
export type NoteShareRole =
  | 'super_boss' | 'bob' | 'team_lead' | 'apc' | 'ads_manager'
  | 'paid_collab_handler';
export type NoteShareTarget =
  | { kind: 'all' }
  | { kind: 'role'; role: NoteShareRole }
  | { kind: 'team'; team: string };

export interface NoteLabel { id: string; name: string; color: string | null; owner_id: string; }

/* A note's creator_id points at ONE handler_collab_creators row (a deal), but
   the UI groups creator notes by "the same creator" across months WITHIN a
   brand — the repo-wide identity convention (handle, else name; mirrors
   creatorIdentityKey in lib/paidCollabSchema). */
export function creatorNoteKey(c: { brand_id?: string | null; tiktok_handle?: string | null; name?: string | null }): string {
  const first = String(c.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  const handle = (first.startsWith('http') ? (first.replace(/\/+$/, '').split('/').pop() || '') : first)
    .replace(/^@+/, '').toLowerCase().trim();
  const ident = handle ? `h:${handle}` : `n:${String(c.name || '').toLowerCase().trim()}`;
  return `${c.brand_id || ''}|${ident}`;
}

// ownerId: restrict to one owner's notes — needed for Bob, whose read-all RLS
// would otherwise pull every user's notes onto his personal board.
export async function loadNotes(ownerId?: string): Promise<HandlerNote[]> {
  let q = supabase
    .from('handler_notes')
    .select('*')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (ownerId) q = q.eq('owner_id', ownerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as HandlerNote[];
}

export async function createNote(patch: NotePatch): Promise<HandlerNote> {
  const { data, error } = await supabase
    .from('handler_notes')
    .insert(patch)
    .select()
    .single();
  if (error) throw error;
  return data as HandlerNote;
}

export async function updateNote(id: string, patch: NotePatch): Promise<HandlerNote> {
  const { data, error } = await supabase
    .from('handler_notes')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as HandlerNote;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('handler_notes').delete().eq('id', id);
  if (error) throw error;
}

// Convert any reminders that are now due into notifications (in-app + realtime).
// Called from the front-end on load / interval so reminders surface even when
// pg_cron isn't enabled. Returns the number fired.
export async function fireDueNoteReminders(): Promise<number> {
  const { data, error } = await supabase.rpc('fire_due_note_reminders');
  if (error) throw error;
  return (data as number) || 0;
}

/* Board/fab read path: every note the caller OWNS or is SHARED, with owner
   metadata (role/name/is_owner) folded in for colouring + the shared-by chip.
   Replaces loadNotes() for the boards — also scopes Bob to own+shared (his
   read-all RLS would otherwise flood the board).

   ‼️ IT IS SCOPED TO ONE STREAM, AND 'private' IS THE DEFAULT ON PURPOSE. The
   RPC answers with every note the caller may see, and a note belongs to exactly
   one of the two Notes pages (20260904090000) — so a caller that forgets to say
   which page it is would otherwise render timeline notes on the Keep board,
   complete with edit and delete controls the timeline deliberately withholds.
   Every legacy call site IS the board, and an un-streamed row IS private, so
   the default is right in both directions. */
export async function loadVisibleNotes(stream: NoteStream = 'private'): Promise<HandlerNote[]> {
  const { data, error } = await supabase.rpc('list_visible_notes');
  if (error) throw error;
  const rows = ((data as any[]) || []) as HandlerNote[];
  return rows.filter(n => noteStream(n) === stream);
}

// Current share targets on a note (owner-only via RLS). Maps DB rows → tokens.
export async function loadNoteShares(noteId: string): Promise<NoteShareTarget[]> {
  const { data, error } = await supabase
    .from('handler_note_shares')
    .select('target_kind, target_role, target_team')
    .eq('note_id', noteId);
  if (error) throw error;
  return ((data as any[]) || []).map(r => {
    if (r.target_kind === 'all') return { kind: 'all' } as NoteShareTarget;
    if (r.target_kind === 'team') return { kind: 'team', team: r.target_team } as NoteShareTarget;
    return { kind: 'role', role: r.target_role } as NoteShareTarget;
  });
}

const shareKey = (t: NoteShareTarget) =>
  t.kind === 'all' ? 'all' : t.kind === 'team' ? `team:${t.team}` : `role:${t.role}`;

// Diff-replace a note's shares: delete rows no longer wanted, insert the new ones.
// RLS enforces owner + the Super-Boss-only gate on 'all'/'team'.
export async function setNoteShares(noteId: string, targets: NoteShareTarget[]): Promise<void> {
  const current = await loadNoteShares(noteId);
  const want = new Set(targets.map(shareKey));
  const have = new Set(current.map(shareKey));

  const toAdd = targets.filter(t => !have.has(shareKey(t)));
  const toRemove = current.filter(t => !want.has(shareKey(t)));

  for (const t of toRemove) {
    let q = supabase.from('handler_note_shares').delete()
      .eq('note_id', noteId).eq('target_kind', t.kind);
    if (t.kind === 'role') q = q.eq('target_role', t.role);
    if (t.kind === 'team') q = q.eq('target_team', t.team);
    const { error } = await q;
    if (error) throw error;
  }
  if (toAdd.length) {
    const rows = toAdd.map(t => ({
      note_id: noteId,
      target_kind: t.kind,
      target_role: t.kind === 'role' ? t.role : null,
      target_team: t.kind === 'team' ? t.team : null,
    }));
    // Plain insert (the unique index is on coalesce() expressions, so PostgREST
    // upsert can't target it); a concurrent duplicate (23505) is harmless.
    const { error } = await supabase.from('handler_note_shares').insert(rows);
    if (error && error.code !== '23505') throw error;
  }
}

// Saved label catalogue (reusable). Scope to one owner for the reuse picker.
export async function loadNoteLabels(ownerId?: string): Promise<NoteLabel[]> {
  let q = supabase.from('note_labels').select('id, name, color, owner_id').order('name');
  if (ownerId) q = q.eq('owner_id', ownerId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data as any[]) || []) as NoteLabel[];
}

// Save a label to the caller's catalogue. Plain insert (unique index is on
// lower(name)); a duplicate (23505) just means the label already exists.
export async function upsertNoteLabel(name: string, color?: string | null): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { error } = await supabase.from('note_labels').insert({ name: trimmed, color: color ?? null });
  if (error && error.code !== '23505') throw error;
}

/* ── Message templates (handler_message_templates, migration 20260910090000) ──
   The handler team's SHARED library of the messages they send over and over —
   creator nudges, ad-code asks, client month updates. Every paid-collab
   handler + Bob read, add and correct the same rows; only the author (or Bob)
   may delete one.

   Nothing here sends anything: the tab fills a template in and the handler
   copies it. Authorship (created_by / created_by_name / updated_by /
   updated_by_name) is stamped by the DB trigger and is deliberately NOT sent
   from here — see the migration. */
export async function loadMessageTemplates(): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from('handler_message_templates')
    .select('*')
    .order('name');
  if (error) throw error;
  return ((data as any[]) || []) as MessageTemplate[];
}

function templatePayload(patch: Record<string, any>) {
  return {
    name: String(patch.name || '').trim(),
    audience: patch.audience === 'brand' ? 'brand' : 'creator',
    category: String(patch.category || '').trim(),
    body: String(patch.body || '').trim(),
  };
}

// 23505 = the unique (audience, lower(name)) index — somebody already saved a
// template of that kind under that name. Reported as the sentence a person can
// act on rather than the constraint's own wording.
const TEMPLATE_DUP = 'A template with that name already exists for this audience.';

export async function addMessageTemplate(patch: Record<string, any>): Promise<MessageTemplate> {
  const payload = templatePayload(patch);
  if (!payload.name) throw new Error('A template needs a name');
  if (!payload.body) throw new Error('A template needs a message');
  const { data, error } = await supabase
    .from('handler_message_templates')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(error.code === '23505' ? TEMPLATE_DUP : error.message);
  return data as MessageTemplate;
}

export async function updateMessageTemplate(id: string, patch: Record<string, any>): Promise<MessageTemplate> {
  const payload = templatePayload(patch);
  if (!payload.name) throw new Error('A template needs a name');
  if (!payload.body) throw new Error('A template needs a message');
  const { data, error } = await supabase
    .from('handler_message_templates')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.code === '23505' ? TEMPLATE_DUP : error.message);
  return data as MessageTemplate;
}

/* RLS narrows this to the author (or Bob), so a refused delete matches zero
   rows rather than erroring — the caller checks the count and says so. */
export async function deleteMessageTemplate(id: string): Promise<number> {
  const { data, error } = await supabase
    .from('handler_message_templates')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  return (data || []).length;
}
