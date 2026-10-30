/* ════════════════════════════════════════════════════════════
   "Download brand data" — every creator a brand has worked with, for one
   program month or for all of them, with their GMV history and the brand's
   budget alongside.

   No React and no Supabase: the drilldown hands in the creators and the
   brand-months the workspace already holds, and the TableExportModal does the
   writing.

   ‼️ ONE ROW PER CREATOR (user call, 2026-10-13). A person is matched within
   the brand by `creatorBrandKey` (handle, else name — the repo-wide rule), and
   all their deals in the chosen period fold into one line: amounts and video
   counts are summed, the months they were on are listed, and each VIDEO gets
   its own column (Video 1 / Ad code 1, Video 2 / Ad code 2 …) rather than a
   line break inside one cell, so a row never grows taller in Excel.

   ‼️ VIDEO COLUMNS ARE DYNAMIC. The picker offers ONE "Video links" and ONE
   "Ad codes" checkbox; `expandBrandDataColumns` turns them into as many
   numbered columns as the creator with the most videos needs.

   ‼️ MONTH SCOPE uses the program rule (`onProgram`): a deal is on a month's
   program when it was SIGNED that month OR still PRODUCED GMV in it, so
   carried-over creators are included and "On program as" says so.

   ‼️ GMV IN THE PERIOD comes from the month lens (`gmvByMonth`), never a deal's
   lifetime total — that is its own column.

   ‼️ BUDGET is the brand-month's (`handler_collab_brand_months.budget`); for
   "All months" it is the sum of every month's budget. Allocated follows the
   workspace rule: Awaiting Confirmation and Terminated deals are not counted,
   and a deal's fee belongs to the month it was SIGNED (a carried-over creator
   is not charged to this month's budget twice). The brand figures are the
   same on every row so any row can be read on its own.

   ‼️ "ALL BRANDS" means every brand THIS VIEWER can see. A handler reads only
   their own brands.

   Money is a bare number; blank is '' and never 0 where "no figure" and "zero"
   differ.
════════════════════════════════════════════════════════════ */

import type { ExportColumn } from '../../lib/tableExport';
import {
  gmvByMonth, adForMonth, adSum, onProgram, deliveredCount, dealCodes,
  creatorBrandKey, monthLabel, isInternalOnlyStatus,
} from '../paid-collab/handlerCollabReadonly';
import { creatorGlobalKey, dealMonth } from './store';
import { creatorPayouts } from '../../lib/creatorPayouts';

export const ALL_MONTHS = 'all';

type Num = number | '';
const monthKey = (d: any) => (d ? String(d).slice(0, 7) : '');
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: any): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export interface BrandDataRow {
  /** 1-based position after sorting (`sortBrandDataRows`). */
  rank: number;
  /** payment_status of the latest deal — for sorting by status. */
  statusKey: string;
  /** Newest month signed in, 'YYYY-MM' — for sorting by program. */
  latestMonth: string;
  months: string;
  programRole: string;
  brand: string;
  currency: string;
  creator: string;
  handles: string;
  phone: string;
  email: string;
  categories: string;
  status: string;
  onboardedOn: string;
  completedOn: string;
  deals: number;
  amount: Num;
  videosAgreed: Num;
  videosDelivered: number;
  payouts: string;
  periodGmv: number;
  periodAd: number;
  dealGmv: number;
  dealAd: number;
  brandPrograms: number;
  brandFirst: string;
  brandGmvBefore: Num;
  brandGmvTotal: number;
  allPrograms: number;
  allBrands: string;
  allGmvTotal: number;
  budget: Num;
  allocated: number;
  remaining: Num;
  budgetShare: Num;
  contract: string;
  videos: string[];
  adCodes: string[];
}

/** Every month the brand has a deal signed in, GMV recorded in or a budget
    set for, newest first. */
export function brandDataMonths(brandId: string, creators: any[], brandMonths: any[] = []): string[] {
  const s = new Set<string>();
  creators.forEach(c => {
    if (c.brand_id !== brandId) return;
    const m = dealMonth(c);
    if (m) s.add(m);
    Object.keys(gmvByMonth(c)).forEach(k => s.add(k));
  });
  brandMonths.forEach(b => { if (b.brand_id === brandId && b.month) s.add(b.month); });
  return [...s].sort().reverse();
}

/** One person's GMV across `deals`, counting only the months `keep` accepts. */
function gmvAcross(deals: any[], keep: (m: string) => boolean = () => true): number {
  let t = 0;
  deals.forEach(d => {
    Object.entries(gmvByMonth(d)).forEach(([m, n]) => { if (keep(m)) t += Number(n) || 0; });
  });
  return round2(t);
}

const firstFilled = (deals: any[], f: (d: any) => any) => {
  for (const d of deals) { const v = f(d); if (v != null && String(v).trim() !== '') return String(v); }
  return '';
};
const handlesOf = (raw: any) => String(raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

export function buildBrandDataRows(opts: {
  brand: { id: string; name: string; currency?: string | null };
  creators: any[];
  brandMonths?: any[];
  brandNameById: Record<string, string>;
  month: string;
  statusLabel: (c: any) => string;
}): BrandDataRow[] {
  const { brand, creators, brandNameById, month, statusLabel } = opts;
  const all = month === ALL_MONTHS;
  const inPeriod = (m: string) => (all ? true : m === month);

  // Brand-level budget figures — the same on every row.
  const bms = (opts.brandMonths || []).filter(b => b.brand_id === brand.id && (all || b.month === month));
  const budgets = bms.map(b => num(b.budget)).filter((n): n is number => n != null);
  const budget: Num = budgets.length ? round2(budgets.reduce((t, n) => t + n, 0)) : '';
  const allocated = round2(creators
    .filter(c => c.brand_id === brand.id && !isInternalOnlyStatus(c))
    .filter(c => { const m = dealMonth(c); return all ? true : m === month; })
    .reduce((t, c) => t + (num(c.amount) || 0), 0));
  const remaining: Num = budget === '' ? '' : round2(budget - allocated);

  // Person indexes.
  const byBrandKey = new Map<string, any[]>();
  const byGlobalKey = new Map<string, any[]>();
  creators.forEach(c => {
    const g = creatorGlobalKey(c);
    (byGlobalKey.get(g) || byGlobalKey.set(g, []).get(g)!).push(c);
    if (c.brand_id === brand.id) {
      const k = creatorBrandKey(c);
      (byBrandKey.get(k) || byBrandKey.set(k, []).get(k)!).push(c);
    }
  });

  // In-scope deals, grouped per person.
  const groups = new Map<string, any[]>();
  creators
    .filter(c => c.brand_id === brand.id && (all || onProgram(c, month)))
    .forEach(c => {
      const k = creatorBrandKey(c);
      (groups.get(k) || groups.set(k, []).get(k)!).push(c);
    });

  const rows: (BrandDataRow & { _sort: string })[] = [];
  groups.forEach((deals, key) => {
    // Newest deal first — contact details and status come from the latest.
    deals.sort((a, b) => String(b.onboarded_on || b.created_at || '').localeCompare(String(a.onboarded_on || a.created_at || '')));
    const latest = deals[0];
    const brandDeals = byBrandKey.get(key) || deals;
    const allDeals = byGlobalKey.get(creatorGlobalKey(latest)) || deals;

    const signedMonths = [...new Set(deals.map(d => dealMonth(d)).filter(Boolean))].sort();
    const brandMonthSet = new Set(brandDeals.map(d => dealMonth(d)).filter(Boolean));
    const firstBrandMonth = [...brandMonthSet].sort()[0] || '';

    let role = 'Signed';
    if (!all) {
      const signedHere = deals.some(d => dealMonth(d) === month);
      const carried = deals.filter(d => dealMonth(d) !== month);
      const from = [...new Set(carried.map(d => dealMonth(d)).filter(Boolean))].sort().map(monthLabel);
      const carriedText = carried.length ? `Carried over from ${from.join(', ') || 'an earlier month'}` : '';
      role = signedHere && carried.length ? `Signed this month + c${carriedText.slice(1)}`
        : signedHere ? 'Signed this month' : carriedText;
    }

    // A deal's own TERMS (fee, videos agreed/delivered) belong to the month it
    // was SIGNED — a carried-over deal's fee was July's, not August's again.
    const termDeals = all ? deals : deals.filter(d => dealMonth(d) === month);
    const amounts = termDeals.map(d => num(d.amount)).filter((n): n is number => n != null);
    const agreed = termDeals.map(d => num(d.videos_count)).filter((n): n is number => n != null);
    const amount: Num = amounts.length ? round2(amounts.reduce((t, n) => t + n, 0)) : '';

    // Videos oldest deal first, so Video 1 is the first one they posted for us.
    const codes = [...deals].reverse().flatMap(d => dealCodes(d.video_codes)).filter((v: any) => v?.video || v?.adCode);
    const payouts = new Map<string, string>();
    deals.forEach(d => creatorPayouts(d).forEach(p => {
      const k = `${p.label}|${p.value}`.toLowerCase();
      if (!payouts.has(k)) payouts.set(k, `${p.label}: ${p.value}`);
    }));
    const handles = [...new Set(deals.flatMap(d => handlesOf(d.tiktok_handle)).map(h => h))];
    const completed = deals.map(d => d.completed_on).filter(Boolean).sort().pop() || '';
    const onboarded = [...new Set(deals.map(d => d.onboarded_on).filter(Boolean))].sort();

    rows.push({
      months: all
        ? signedMonths.map(monthLabel).join(', ')
        : monthLabel(month),
      programRole: role,
      rank: 0,
      statusKey: latest.payment_status || '',
      latestMonth: signedMonths[signedMonths.length - 1] || '',
      brand: brand.name,
      currency: brand.currency || 'USD',
      creator: latest.name || '',
      handles: handles.join(', '),
      phone: firstFilled(deals, d => d.phone),
      email: firstFilled(deals, d => d.email),
      categories: firstFilled(deals, d => d.category),
      status: statusLabel(latest),
      onboardedOn: onboarded.join(', '),
      completedOn: completed,
      deals: deals.length,
      amount,
      videosAgreed: agreed.length ? agreed.reduce((t, n) => t + n, 0) : '',
      videosDelivered: termDeals.reduce((t, d) => t + deliveredCount(d), 0),
      payouts: [...payouts.values()].join('; '),
      periodGmv: gmvAcross(deals, inPeriod),
      periodAd: round2(deals.reduce((t, d) => t + (all ? adSum(d) : adForMonth(d, month)), 0)),
      dealGmv: gmvAcross(deals),
      dealAd: round2(deals.reduce((t, d) => t + adSum(d), 0)),
      brandPrograms: brandMonthSet.size || brandDeals.length,
      brandFirst: firstBrandMonth ? monthLabel(firstBrandMonth) : '',
      brandGmvBefore: all ? '' : gmvAcross(brandDeals, m => m < month),
      brandGmvTotal: gmvAcross(brandDeals),
      allPrograms: allDeals.length,
      allBrands: [...new Set(allDeals.map(d => brandNameById[d.brand_id] || '—'))].join(', '),
      allGmvTotal: gmvAcross(allDeals),
      budget,
      allocated,
      remaining,
      budgetShare: budget !== '' && budget > 0 && amount !== '' ? round2((amount / budget) * 100) : '',
      contract: firstFilled(deals, d => d.contract_url),
      videos: codes.map((v: any) => v?.video || ''),
      adCodes: codes.map((v: any) => v?.adCode || ''),
      _sort: String(latest.name || '').toLowerCase(),
    });
  });

  rows.sort((a, b) => a._sort.localeCompare(b._sort));
  return rows.map(({ _sort, ...r }, i) => ({ ...r, rank: i + 1 }));
}

/* ── sorting ──────────────────────────────────────────────────────────────
   Every sort falls back to the creator's name, so equal values keep a stable,
   readable order. The rank (#) column is renumbered after sorting. */
export type BrandDataSort = 'gmv' | 'brandGmv' | 'allGmv' | 'amount' | 'status' | 'month' | 'name';
export const BRAND_DATA_SORTS: { value: BrandDataSort; label: string }[] = [
  { value: 'gmv', label: 'GMV in selected period (highest first)' },
  { value: 'brandGmv', label: 'Total GMV for this brand (highest first)' },
  { value: 'allGmv', label: 'Total GMV across all brands (highest first)' },
  { value: 'amount', label: 'Deal amount (highest first)' },
  { value: 'status', label: 'Status (payment pending first)' },
  { value: 'month', label: 'Program month (newest first)' },
  { value: 'name', label: 'Creator name (A–Z)' },
];
export const BRAND_DATA_SORT_DEFAULT: BrandDataSort = 'gmv';
export const isBrandDataSort = (v: any): v is BrandDataSort => BRAND_DATA_SORTS.some(s => s.value === v);

/* Same order the drilldown groups creators in — who needs paying first. */
const STATUS_ORDER = ['pending', 'follow_up', 'videos_in_progress', 'paid', 'awaiting_confirmation', 'terminated'];
const statusRank = (k: string) => { const i = STATUS_ORDER.indexOf(k); return i < 0 ? 2 : i; };
const n0 = (v: Num) => (v === '' ? -Infinity : v);

export function sortBrandDataRows(rows: readonly BrandDataRow[], sort: BrandDataSort): BrandDataRow[] {
  const byName = (a: BrandDataRow, b: BrandDataRow) => a.creator.toLowerCase().localeCompare(b.creator.toLowerCase());
  const cmp: Record<BrandDataSort, (a: BrandDataRow, b: BrandDataRow) => number> = {
    gmv: (a, b) => b.periodGmv - a.periodGmv,
    brandGmv: (a, b) => b.brandGmvTotal - a.brandGmvTotal,
    allGmv: (a, b) => b.allGmvTotal - a.allGmvTotal,
    amount: (a, b) => n0(b.amount) - n0(a.amount),
    status: (a, b) => statusRank(a.statusKey) - statusRank(b.statusKey),
    month: (a, b) => b.latestMonth.localeCompare(a.latestMonth),
    name: () => 0,
  };
  return [...rows]
    .sort((a, b) => cmp[sort](a, b) || byName(a, b))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/* ── the brand summary (second sheet in an .xlsx) ───────────────────────── */
export function brandDataSummary(rows: readonly BrandDataRow[], brandName: string, periodLabel: string, currency: string): (string | number)[][] {
  const sum = (f: (r: BrandDataRow) => number) => Math.round(rows.reduce((t, r) => t + f(r), 0) * 100) / 100;
  const first = rows[0];
  const top = [...rows].sort((a, b) => b.periodGmv - a.periodGmv)[0];
  return [
    ['Brand', brandName],
    ['Period', periodLabel],
    ['Currency', currency],
    [],
    ['Brand budget', first ? first.budget : ''],
    ['Budget allocated', first ? first.allocated : ''],
    ['Budget remaining', first ? first.remaining : ''],
    [],
    ['Creators', rows.length],
    ['Deals', sum(r => r.deals)],
    ['Videos agreed', sum(r => (r.videosAgreed === '' ? 0 : r.videosAgreed))],
    ['Videos delivered', sum(r => r.videosDelivered)],
    ['GMV in period', sum(r => r.periodGmv)],
    ['Ad spend in period', sum(r => r.periodAd)],
    ['Top creator by GMV', top && top.periodGmv > 0 ? `${top.creator} (${top.periodGmv})` : ''],
  ];
}

/* The columns the dialog OFFERS, in the order they land in the file:
   who → the deal → GMV (this period, this brand, every brand) → contact and
   payment → the brand's budget → the videos. `videos` and `adCodes` are
   placeholders: at write time `expandBrandDataColumns` replaces them with
   numbered columns. */
export const BRAND_DATA_COLUMNS: ExportColumn<BrandDataRow>[] = [
  { key: 'rank', label: '#', width: 5, value: r => r.rank,
    hint: 'Position in the order you picked under “Sort by”' },
  // Who
  { key: 'creator', label: 'Creator', width: 22, value: r => r.creator },
  { key: 'handles', label: 'TikTok handle', width: 22, value: r => r.handles },
  { key: 'status', label: 'Status', width: 20, value: r => r.status,
    hint: 'Of their latest deal' },
  { key: 'months', label: 'Program month(s)', width: 22, value: r => r.months,
    hint: 'The month exported, or every month this creator was signed in' },
  { key: 'programRole', label: 'On program as', width: 26, value: r => r.programRole,
    hint: 'Signed that month, or carried over from an earlier deal still selling' },
  // The deal
  { key: 'deals', label: 'Deals', width: 7, value: r => r.deals,
    hint: 'How many deals of theirs are in this export' },
  { key: 'amount', label: 'Deal amount', width: 12, value: r => r.amount,
    hint: 'Deals signed in the period, added up. A carried-over deal’s fee stays with the month it was signed' },
  { key: 'videosAgreed', label: 'Videos agreed', width: 13, value: r => r.videosAgreed },
  { key: 'videosDelivered', label: 'Videos delivered', width: 15, value: r => r.videosDelivered },
  { key: 'budgetShare', label: 'Share of brand budget %', width: 20, value: r => r.budgetShare,
    hint: 'This creator’s deal amount as a share of the brand budget' },
  // GMV — this period
  { key: 'periodGmv', label: 'GMV in selected period', width: 20, value: r => r.periodGmv,
    hint: 'What they made for this brand in the chosen month (or all months)' },
  { key: 'periodAd', label: 'Ad spend in selected period', width: 22, value: r => r.periodAd },
  { key: 'dealGmv', label: 'GMV of these deals (all time)', width: 24, value: r => r.dealGmv,
    hint: 'Everything the deals in this row have made, every month' },
  { key: 'dealAd', label: 'Ad spend of these deals (all time)', width: 27, value: r => r.dealAd },
  // GMV — history with this brand
  { key: 'brandGmvBefore', label: 'GMV for brand before this month', width: 26, value: r => r.brandGmvBefore,
    hint: 'Their past collabs with this brand. Blank in an all-months export' },
  { key: 'brandGmvTotal', label: 'Total GMV for this brand', width: 22, value: r => r.brandGmvTotal,
    hint: 'Every collab with this brand, all months' },
  { key: 'brandPrograms', label: 'Programs with this brand', width: 21, value: r => r.brandPrograms },
  { key: 'brandFirst', label: 'First program with brand', width: 21, value: r => r.brandFirst },
  // GMV — every brand
  { key: 'allGmvTotal', label: 'Total GMV (all brands)', width: 20, value: r => r.allGmvTotal,
    hint: 'Every brand you can see. Different currencies are added as bare numbers' },
  { key: 'allPrograms', label: 'Total collabs (all brands)', width: 22, value: r => r.allPrograms,
    hint: 'Across every brand you can see in the workspace' },
  { key: 'allBrands', label: 'Brands worked with', width: 30, value: r => r.allBrands },
  // Contact + payment
  { key: 'phone', label: 'Phone', width: 16, value: r => r.phone },
  { key: 'email', label: 'Email', width: 26, value: r => r.email },
  { key: 'categories', label: 'Categories', width: 22, value: r => r.categories },
  { key: 'payouts', label: 'Payment methods', width: 30, value: r => r.payouts },
  { key: 'onboardedOn', label: 'Onboarded on', width: 16, value: r => r.onboardedOn },
  { key: 'completedOn', label: 'Completed on', width: 13, value: r => r.completedOn },
  { key: 'contract', label: 'Signed contract', width: 30, value: r => r.contract },
  // The brand
  { key: 'brand', label: 'Brand', width: 20, value: r => r.brand },
  { key: 'currency', label: 'Currency', width: 9, value: r => r.currency },
  { key: 'budget', label: 'Brand budget', width: 13, value: r => r.budget,
    hint: 'The brand’s budget for the month (all months: added up). Blank = no budget set' },
  { key: 'allocated', label: 'Budget allocated', width: 15, value: r => r.allocated,
    hint: 'Deal fees signed in the period; Awaiting Confirmation and Terminated left out' },
  { key: 'remaining', label: 'Budget remaining', width: 15, value: r => r.remaining },
  // Videos — expanded to Video 1 / Ad code 1 / Video 2 …
  { key: 'videos', label: 'Video links', width: 40, value: () => '',
    hint: 'One column per video: Video 1, Video 2 …' },
  { key: 'adCodes', label: 'Ad codes', width: 24, value: () => '',
    hint: 'One column per video, beside its link: Ad code 1, Ad code 2 …' },
];

/** Replace the two placeholder columns with numbered ones, as many as the row
    with the most videos needs. With both picked they interleave (Video 1,
    Ad code 1, Video 2 …) so each code sits beside its link. */
export function expandBrandDataColumns(
  chosen: readonly ExportColumn<BrandDataRow>[],
  rows: readonly BrandDataRow[],
): ExportColumn<BrandDataRow>[] {
  const wantVideos = chosen.some(c => c.key === 'videos');
  const wantCodes = chosen.some(c => c.key === 'adCodes');
  const out = chosen.filter(c => c.key !== 'videos' && c.key !== 'adCodes');
  const n = Math.max(0, ...rows.map(r => r.videos.length));
  for (let i = 0; i < n; i++) {
    if (wantVideos) out.push({ key: `video_${i + 1}`, label: `Video ${i + 1}`, width: 40, value: r => r.videos[i] || '' });
    if (wantCodes) out.push({ key: `adcode_${i + 1}`, label: `Ad code ${i + 1}`, width: 24, value: r => r.adCodes[i] || '' });
  }
  return out;
}

export const BRAND_DATA_STORE = 'ac_pc_brand_data_export_cols_v2';
export const BRAND_DATA_SORT_STORE = 'ac_pc_brand_data_export_sort';
