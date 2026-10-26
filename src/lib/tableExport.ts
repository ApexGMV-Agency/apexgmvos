/* ════════════════════════════════════════════════════════════
   Exporting a table the viewer chose the shape of: which columns, and
   whether the file is .xlsx or .csv.

   PURE except for `writeTable`, which touches `xlsx` / the DOM only at the
   very end — so the sheet a dialog is about to produce can be built and
   checked without a browser.

   ‼️ `lib/adCodeExport.ts` is an OLDER, ad-code-specific twin and is
   deliberately left alone. It carries a row-explosion model (one row per
   video vs one per entry) that a general table exporter has no business
   knowing about. New export work belongs here; do not fork this into a
   third one.
════════════════════════════════════════════════════════════ */

export type ExportFormat = 'xlsx' | 'csv';

/** One offerable column: how it is labelled, how wide, and how to read it. */
export interface ExportColumn<R> {
  key: string;
  label: string;
  /** Column width in characters (.xlsx only — CSV has no widths). */
  width?: number;
  /** One line under the checkbox, when the label alone is ambiguous. */
  hint?: string;
  value: (row: R) => string | number;
}

/* ── which columns a stored preference is allowed to switch off ──
   ‼️ Stores the EXCLUDED keys, not the included ones — the same rule as the
   Creators Database's own column picker (`sanitizeHiddenCols`). A column added
   to the registry later then defaults to PRESENT for everyone who already has
   a preference saved; storing the included set instead would make every future
   column silently missing from their exports. */
export function sanitizeExcluded(raw: unknown, keys: readonly string[]): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  const known = new Set(keys);
  const out = new Set(raw.filter((k): k is string => typeof k === 'string' && known.has(k)));
  // A stored "everything off" is refused: the dialog forbids that state, so a
  // value claiming it is stale or hand-edited, and honouring it would open the
  // dialog unable to export anything with nothing on screen explaining why.
  return out.size >= known.size ? new Set() : out;
}

/** The chosen columns, in registry order — the order they appear in the file. */
export function orderedColumns<R>(
  all: readonly ExportColumn<R>[],
  excluded: ReadonlySet<string>,
): ExportColumn<R>[] {
  return all.filter(c => !excluded.has(c.key));
}

/** Rows as plain records keyed by column LABEL, which is what a sheet wants. */
export function buildRecords<R>(
  rows: readonly R[],
  columns: readonly ExportColumn<R>[],
): Record<string, string | number>[] {
  return rows.map(row => {
    const rec: Record<string, string | number> = {};
    columns.forEach(c => { rec[c.label] = c.value(row); });
    return rec;
  });
}

/* ── CSV ──
   Hand-rolled rather than SheetJS's `sheet_to_csv`, and that is the point: a
   CSV export then costs no download of the ~430kB xlsx chunk, and the three
   rules below are ours to set rather than a library's. */

/** Excel executes a cell that opens with one of these when it opens a CSV.
    The names, notes and handles in these files are typed by people outside the
    company, so the leading quote is a real guard, not ceremony. A leading '-'
    is only escaped when the cell is not simply a negative number. */
function guardFormula(text: string): string {
  if (/^[=+@\t\r]/.test(text)) return `'${text}`;
  if (/^-/.test(text) && !Number.isFinite(Number(text))) return `'${text}`;
  return text;
}

function csvCell(v: string | number): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const guarded = guardFormula(String(v ?? ''));
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * The file's text. CRLF line endings and a UTF-8 BOM, both for Excel: without
 * the BOM it reads the file in the system codepage and mangles every accented
 * name and every emoji in a handle.
 */
export function toCsv<R>(rows: readonly R[], columns: readonly ExportColumn<R>[]): string {
  const head = columns.map(c => csvCell(c.label)).join(',');
  const body = rows.map(r => columns.map(c => csvCell(c.value(r))).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

/** `afflix-creators-database-2026-08-28.csv` — the house `afflix-*` naming. */
export function exportFilename(slug: string, format: ExportFormat, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${slug}-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.csv`;
}

/** Hand the browser a file. Split out so `writeTable` stays readable. */
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a later tick: Safari has been known to cancel a download whose
  // object URL is released in the same one.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Write the file, and return how many data rows it holds.
 *
 * Throws on an empty selection so the caller can say so inline rather than
 * the export failing silently — an export that produced nothing looks
 * identical to one that never ran.
 */
export async function writeTable<R>(
  rows: readonly R[],
  columns: readonly ExportColumn<R>[],
  opts: {
    format: ExportFormat; sheet: string; slug: string; now?: Date;
    /** .xlsx only: more sheets after the main one, each a grid of cells. */
    extraSheets?: { name: string; cells: (string | number)[][]; widths?: number[] }[];
  },
): Promise<number> {
  if (!columns.length) throw new Error('Pick at least one column to export.');
  if (!rows.length) throw new Error('There is nothing to export.');
  const filename = exportFilename(opts.slug, opts.format, opts.now);

  // CSV only: the xlsx library was removed from this app for its known CVEs.
  download(new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }), filename);
  return rows.length;
}
