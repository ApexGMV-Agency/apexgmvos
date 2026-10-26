/* ════════════════════════════════════════════════════════════
   What the Creators Database can put in an export file.

   PURE — no React, no Supabase, no `xlsx`. The workspace flattens a database
   entry into a `CdbExportRow` (it is the only place that holds the Reacher stats
   and the month-label formatter), and everything about which columns exist,
   what they are called and how wide they are lives here, where it can be
   checked without a browser.

   ‼️ This registry is DELIBERATELY WIDER than the table on screen — 26 columns
   against the table's 13. Hiding a column is about reading the table; an
   export is the record itself, and the two have always differed (region,
   followers, notes and tags have never been columns). The export dialog is
   what reconciles them: everything is offered, everything is on by default,
   and the viewer switches off what they do not want.
════════════════════════════════════════════════════════════ */

import type { ExportColumn } from './tableExport';

/** A database entry flattened for export. Strings are already display-ready;
    a number stays a number so a spreadsheet can total it, and a blank is ''
    rather than 0 — "we do not know" and "zero" are different answers. */
export interface CdbExportRow {
  name: string;
  usernames: string;
  level: string;
  ttGmv: number | '';
  avgViews: number | '';
  firstOn: string;
  lastOn: string;
  addedOn: string;
  categories: string;
  region: string;
  phone: string;
  email: string;
  paypal: string;
  zelle: string;
  followers: number | '';
  rate: number | '';
  status: string;
  workingOn: string;
  brands: string;
  brandCount: number;
  programs: number;
  deals: number;
  totalGmv: number | '';
  totalValue: number | '';
  videos: string;
  tags: string;
  notes: string;
}

export const CDB_EXPORT_COLUMNS: ExportColumn<CdbExportRow>[] = [
  { key: 'name', label: 'Name', width: 20, value: r => r.name },
  { key: 'usernames', label: 'Usernames', width: 24, value: r => r.usernames,
    hint: 'Every TikTok handle on record, comma-separated, without the @' },
  { key: 'level', label: 'Level', width: 7, value: r => r.level,
    hint: 'Reacher L0–L7, graded on the creator’s platform-wide TikTok Shop GMV' },
  { key: 'avgViews', label: 'Avg views', width: 11, value: r => r.avgViews,
    hint: 'Average views per video (Reacher)' },
  { key: 'ttGmv', label: 'TT GMV', width: 13, value: r => r.ttGmv,
    hint: 'Total TikTok Shop GMV across every brand (Reacher). Blank means Reacher could not find the handle, not zero' },
  { key: 'firstOn', label: 'First onboarded', width: 14, value: r => r.firstOn },
  { key: 'lastOn', label: 'Last onboarded', width: 14, value: r => r.lastOn },
  { key: 'addedOn', label: 'Added to database', width: 16, value: r => r.addedOn },
  { key: 'categories', label: 'Categories', width: 24, value: r => r.categories },
  { key: 'region', label: 'Region', width: 12, value: r => r.region },
  { key: 'phone', label: 'Phone', width: 16, value: r => r.phone },
  { key: 'email', label: 'Email', width: 26, value: r => r.email },
  { key: 'paypal', label: 'PayPal', width: 26, value: r => r.paypal },
  { key: 'zelle', label: 'Zelle', width: 20, value: r => r.zelle },
  { key: 'followers', label: 'Followers', width: 11, value: r => r.followers },
  { key: 'rate', label: 'Rate / Video', width: 12, value: r => r.rate },
  { key: 'status', label: 'Status', width: 14, value: r => r.status },
  { key: 'workingOn', label: 'Working on', width: 26, value: r => r.workingOn,
    hint: 'The live program, when there is one — brand and month' },
  { key: 'brands', label: 'Brands', width: 26, value: r => r.brands },
  { key: 'brandCount', label: 'Brand count', width: 11, value: r => r.brandCount },
  { key: 'programs', label: 'Programs', width: 10, value: r => r.programs },
  { key: 'deals', label: 'Deals', width: 8, value: r => r.deals },
  { key: 'totalGmv', label: 'Total GMV', width: 13, value: r => r.totalGmv },
  { key: 'totalValue', label: 'Total Value', width: 13, value: r => r.totalValue,
    hint: 'What we have agreed to pay them across every deal' },
  { key: 'videos', label: 'Videos (delivered/agreed)', width: 20, value: r => r.videos },
  { key: 'tags', label: 'Tags', width: 20, value: r => r.tags },
  { key: 'notes', label: 'Notes', width: 40, value: r => r.notes },
];

/** Per-browser column preference for THIS table's export. Separate from
    `ac_pc_cdb_cols`, the table's own show/hide: what you want to read on
    screen and what you want in a file are different questions. */
export const CDB_EXPORT_STORE = 'ac_pc_cdb_export_cols';
export const CDB_EXPORT_SHEET = 'Creators Database';
export const CDB_EXPORT_SLUG = 'apexgmv-creators-database';
