/* ════════════════════════════════════════════════════════════
   What the handler workspace's BRANDS table can put in an export file.

   PURE — no React, no Supabase, no `xlsx`. The workspace flattens a brand row
   into a `BrandMonthExportRow` (it is the only place holding the month label,
   the date formatter and the focus-product parser), and everything about which
   columns exist, what they are called and how wide they are lives here, where
   it can be checked without a browser.

   ‼️ A ROW IS A BRAND-MONTH, not a brand. The whole workspace is scoped to one
   month, so every figure below describes that month's program — which is why
   the Month column is on by default rather than being a nicety: a file of
   budgets with no month in it cannot be read six weeks later.

   ‼️ Like the Creators Database's registry, this is DELIBERATELY WIDER than
   the table on screen — the nine columns there against the twenty-one here.
   The table is for reading at a glance; an export is the record. The setup a
   handler keeps in the Edit-budget popup (onboarding date, commissions,
   whether the client approves videos first, the content guide, the focus
   products, the month's notes) is exactly the part that has nowhere to go on
   a nine-column row, and is the part somebody asks for in a spreadsheet.

   ‼️ MONEY IS A BARE NUMBER so a spreadsheet can total it — hence the Currency
   column, which is per BRAND (a region's own currency). Exporting several
   regions at once therefore produces a column that cannot be summed as one
   figure, and the currency beside it is what says so.

   ‼️ A blank is '' and never 0: "no budget recorded" and "a budget of zero"
   are different answers, and a spreadsheet averages them differently.
════════════════════════════════════════════════════════════ */

import type { ExportColumn } from './tableExport';

/** A brand's month flattened for export. Strings are already display-ready. */
export interface BrandMonthExportRow {
  brand: string;
  client: string;
  month: string;
  currency: string;
  onboardedOn: string;
  approval: string;
  budget: number | '';
  allocated: number;
  remaining: number | '';
  usage: number | '';
  paid: number;
  pendingPay: number;
  pendingCreators: number;
  creators: number;
  videos: number;
  delivered: number;
  costPerVideo: number | '';
  standardCommission: number | '';
  shopAdsCommission: number | '';
  contentGuide: string;
  focusProducts: string;
  notes: string;
}

export const BRAND_EXPORT_COLUMNS: ExportColumn<BrandMonthExportRow>[] = [
  { key: 'brand', label: 'Brand', width: 22, value: r => r.brand },
  { key: 'client', label: 'Client', width: 20, value: r => r.client },
  { key: 'month', label: 'Month', width: 16, value: r => r.month,
    hint: 'The program month every figure in this row describes' },
  { key: 'currency', label: 'Currency', width: 9, value: r => r.currency,
    hint: 'The brand’s own region currency — the money columns are bare numbers' },
  { key: 'onboardedOn', label: 'Onboarding date', width: 16, value: r => r.onboardedOn,
    hint: 'When this month’s arrangement started. Blank means nobody recorded it' },
  { key: 'approval', label: 'Client approval required', width: 22, value: r => r.approval,
    hint: 'Does the client approve a video before it is posted, this month' },
  { key: 'budget', label: 'Budget', width: 12, value: r => r.budget,
    hint: 'Blank means the month has no program set up yet, not a budget of zero' },
  { key: 'allocated', label: 'Allocated', width: 12, value: r => r.allocated,
    hint: 'Committed to creators. Cancelled and unconfirmed deals are excluded' },
  { key: 'remaining', label: 'Remaining', width: 12, value: r => r.remaining,
    hint: 'Budget minus allocated; negative means over budget' },
  { key: 'usage', label: 'Usage %', width: 10, value: r => r.usage,
    hint: 'Allocated as a share of budget. Blank when there is no budget to measure against' },
  { key: 'paid', label: 'Paid', width: 12, value: r => r.paid },
  { key: 'pendingPay', label: 'Pending payment', width: 15, value: r => r.pendingPay,
    hint: 'Owed right now — videos delivered, payout not sent' },
  { key: 'pendingCreators', label: 'Creators awaiting payout', width: 22, value: r => r.pendingCreators },
  { key: 'creators', label: 'Creators', width: 10, value: r => r.creators },
  { key: 'videos', label: 'Videos agreed', width: 13, value: r => r.videos },
  { key: 'delivered', label: 'Videos delivered', width: 15, value: r => r.delivered },
  { key: 'costPerVideo', label: 'Cost per video', width: 14, value: r => r.costPerVideo,
    hint: 'Allocated divided by videos agreed. Blank when no videos are agreed' },
  { key: 'standardCommission', label: 'Standard commission %', width: 20, value: r => r.standardCommission,
    hint: 'Quoted to creators this month. Blank means not stated, which is not the same as 0' },
  { key: 'shopAdsCommission', label: 'Shop ads commission %', width: 20, value: r => r.shopAdsCommission },
  { key: 'contentGuide', label: 'Content guide', width: 34, value: r => r.contentGuide },
  { key: 'focusProducts', label: 'Focus products', width: 40, value: r => r.focusProducts,
    hint: 'One per line — the product name where one is recorded, else its link' },
  { key: 'notes', label: 'Notes', width: 40, value: r => r.notes,
    hint: 'The month’s own note from the Edit-budget popup' },
];

export const BRAND_EXPORT_STORE = 'ac_pc_brands_export_cols';
export const BRAND_EXPORT_SHEET = 'Brands';
export const BRAND_EXPORT_SLUG = 'apexgmv-paid-collab-brands';
