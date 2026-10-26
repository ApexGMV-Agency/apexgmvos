/* ════════════════════════════════════════════════════════════
   Reading a spreadsheet of creators into the Creators Database.

   PURE — no React, no Supabase, no `xlsx`. The caller hands this module a
   grid of strings (however it got one) and receives rows it can insert, each
   already carrying its verdict and any warnings. So the whole decision layer
   — which header means which field, what counts as a duplicate, which row is
   refused and why — can be checked without a browser.

   ‼️ THE COLUMN NAMES ARE THE EXPORT'S OWN (`lib/creatorDbExport`). A file
   exported from this table, edited, and imported back has to land in the same
   fields it came out of, or the round trip silently loses columns. The alias
   lists widen that to what people actually type; the canonical `label` is
   what the downloadable template writes.

   ‼️ IDENTITY IS NOT RE-IMPLEMENTED HERE. `parseCreatorSheet` takes a `keyOf`
   function and the caller passes `store.creatorGlobalKey` — the same body the
   database itself keys on (mirroring SQL `creator_identity_key()`). A second
   copy of that rule living here is exactly how an import would start calling
   two people one person, or one person two.

   ‼️ STRUCTURE REFUSES, VALUES WARN — the rule `lib/gmvMaxDaily` already
   follows. A file with no recognisable Name column is refused whole; a row
   with no name, or one naming somebody already read further up the same file,
   is refused on its own. But "120k followers" or "$150" only WARN and blank
   the field: a spreadsheet somebody typed by hand must not be able to lock
   them out of banking a creator whose phone number has a note beside it.
════════════════════════════════════════════════════════════ */

/** One database field a column can fill. */
export interface ImportField {
  /** The `creator_directory` payload key this writes. */
  key: string;
  /** Canonical header — what the template writes and what the export uses. */
  label: string;
  /** Other spellings, already normalised. `label` is matched automatically. */
  aliases: string[];
  /** How the cell is read, when the label alone does not say. */
  hint?: string;
  kind?: 'list' | 'number';
}

/* Only the fields `directoryPayload` in store.ts actually writes. Anything
   else in the export (GMV, deals, brands, level…) is DERIVED from deal rows
   and cannot be imported — a column of it is read as "ignored", never as a
   value we then have to decide whether to believe. */
export const IMPORT_FIELDS: ImportField[] = [
  { key: 'name', label: 'Name', aliases: ['creator', 'creatorname', 'fullname', 'displayname'] },
  {
    key: 'tiktok_handle', label: 'Usernames', kind: 'list',
    aliases: ['username', 'handle', 'handles', 'tiktok', 'tiktokhandle', 'tiktokhandles',
      'tiktokusername', 'tiktokaccount', 'account', 'accounts', 'tiktoklink', 'profile'],
    hint: 'One or more, separated by commas or new lines. A profile URL is read as a handle.',
  },
  { key: 'phone', label: 'Phone', aliases: ['number', 'phonenumber', 'mobile', 'contact', 'contactnumber', 'whatsapp'] },
  { key: 'email', label: 'Email', aliases: ['emailaddress', 'mail'] },
  {
    key: 'categories', label: 'Categories', kind: 'list',
    aliases: ['category', 'niche', 'niches', 'vertical'],
    hint: 'Comma-separated. New words are saved on the creator but do not join the shared picker.',
  },
  { key: 'region', label: 'Region', aliases: ['country', 'location', 'market', 'area'] },
  { key: 'followers', label: 'Followers', kind: 'number', aliases: ['followercount', 'followerscount', 'audience'] },
  {
    key: 'rate', label: 'Rate / Video', kind: 'number',
    aliases: ['rate', 'rateper video', 'ratepervideo', 'askingrate', 'price', 'pricepervideo', 'fee'],
    hint: 'Their asking price for one video.',
  },
  { key: 'paypal', label: 'PayPal', aliases: ['paypalemail', 'paypalaccount'] },
  { key: 'zelle', label: 'Zelle', aliases: ['zelleemail', 'zellephone'] },
  { key: 'tags', label: 'Tags', kind: 'list', aliases: ['tag', 'labels', 'label'] },
  { key: 'notes', label: 'Notes', aliases: ['note', 'comment', 'comments', 'remarks', 'description'] },
];

/** Header text reduced to something two spellings of one word share. */
export function normHeader(raw: unknown): string {
  return String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The field a header names, or null. */
export function fieldForHeader(header: string): ImportField | null {
  const n = normHeader(header);
  if (!n) return null;
  return IMPORT_FIELDS.find(f => normHeader(f.label) === n || f.aliases.some(a => normHeader(a) === n)) || null;
}

/* ── cell readers ───────────────────────────────────────── */

const cell = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Split a "several things in one cell" value. Space is NOT a separator —
    a category and a tag can both legitimately be two words. */
export function splitList(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[\n,;|]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** One handle, tidied. A URL becomes the @handle it points at, so a pasted
    profile link and the handle typed by hand are one creator, not two. */
export function tidyHandle(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.includes('/')) {
    const seg = s.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
    s = seg;
  }
  s = s.replace(/^@+/, '').trim();
  return s ? `@${s}` : '';
}

/** The handle cell as the newline-separated string the column stores. */
export function readHandles(raw: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  splitList(raw).forEach(part => {
    const h = tidyHandle(part);
    const k = h.toLowerCase();
    if (h && !seen.has(k)) { seen.add(k); out.push(h); }
  });
  return out;
}

/** A count or an amount, however it was typed. `bad` means it had digits we
    could not read — the caller warns and leaves the field blank. */
export function parseNumberCell(raw: unknown): { value: number | null; bad: boolean } {
  const s = cell(raw);
  if (!s) return { value: null, bad: false };
  // "120k" / "1.2M" — spreadsheets full of follower counts are written this way.
  const mult = /([km])\s*$/i.exec(s);
  const scale = mult ? (mult[1].toLowerCase() === 'k' ? 1e3 : 1e6) : 1;
  const cleaned = s
    .replace(/([km])\s*$/i, '')
    .replace(/[^0-9.\-]/g, '');          // drops $, €, commas, spaces, "per video"
  if (!cleaned || cleaned === '-' || cleaned === '.') return { value: null, bad: true };
  const n = Number(cleaned) * scale;
  if (!Number.isFinite(n) || n < 0) return { value: null, bad: true };
  return { value: Math.round(n * 100) / 100, bad: false };
}

/* ── the sheet ──────────────────────────────────────────── */

/** What one spreadsheet row became. */
export interface ParsedCreator {
  /** 1-based row number IN THE FILE, so a reported problem can be found. */
  line: number;
  key: string;
  /** Ready for `store.addDirectoryCreator` / `updateDirectoryCreator`. */
  data: {
    name: string; tiktok_handle: string; phone: string; email: string;
    categories: string[]; region: string; followers: string; rate: string;
    paypal: string; zelle: string; tags: string[]; notes: string;
  };
  /** new = insert · existing = already banked · duplicate = said twice in this
      file · refused = cannot be imported at all. */
  status: 'new' | 'existing' | 'duplicate' | 'refused';
  /** Why it is not a plain `new`. */
  reason?: string;
  /** Kept, but something in it was not what it claimed to be. */
  warnings: string[];
}

export interface ParseResult {
  ok: boolean;
  /** Set when the FILE is unusable; no rows are offered. */
  error?: string;
  /** The header row as read, for showing what was found. */
  headers: string[];
  matched: { field: ImportField; header: string }[];
  /** Headers carrying no field we can write — named, so a misspelt column is
      visible rather than quietly dropped. */
  ignored: string[];
  rows: ParsedCreator[];
  counts: { total: number; new: number; existing: number; duplicate: number; refused: number };
}

const EMPTY_COUNTS = { total: 0, new: 0, existing: 0, duplicate: 0, refused: 0 };

/** The first row that names at least one field we can write. Files routinely
    open with a title line or a blank one, so the header is found rather than
    assumed to be row 1. */
export function findHeaderRow(grid: unknown[][]): number {
  const limit = Math.min(grid.length, 20);
  for (let i = 0; i < limit; i++) {
    const row = grid[i] || [];
    if (row.some(c => fieldForHeader(cell(c)))) return i;
  }
  return -1;
}

/**
 * Turn a grid of cells into rows ready to insert.
 *
 * `keyOf` must be the app's own identity rule — see the header note.
 * `existingKeys` are the creators already on record (banked OR known from a
 * deal): both mean "this person is already in the database", and importing
 * over them would either fail on the unique index or silently overwrite
 * somebody's curated entry.
 */
export function parseCreatorSheet(
  grid: unknown[][],
  opts: {
    keyOf: (c: { name?: string | null; tiktok_handle?: string | null }) => string;
    existingKeys?: ReadonlySet<string>;
    knownKeys?: ReadonlySet<string>;
  },
): ParseResult {
  const existing = opts.existingKeys || new Set<string>();
  const known = opts.knownKeys || new Set<string>();
  const blank: ParseResult = { ok: false, headers: [], matched: [], ignored: [], rows: [], counts: { ...EMPTY_COUNTS } };

  if (!grid.length) return { ...blank, error: 'That file has no rows in it.' };

  const hIdx = findHeaderRow(grid);
  if (hIdx < 0) {
    return {
      ...blank,
      error: 'No column in this file matches one we can import. The first row should name the columns — “Name” at the very least.',
    };
  }

  const headers = (grid[hIdx] || []).map(c => cell(c));
  const matched: { field: ImportField; header: string }[] = [];
  const ignored: string[] = [];
  const colOf: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (!h) return;
    const f = fieldForHeader(h);
    // First column wins: a file with two "Notes" columns reads the left one
    // rather than silently preferring whichever came last.
    if (f && colOf[f.key] === undefined) { colOf[f.key] = i; matched.push({ field: f, header: h }); }
    else ignored.push(h);
  });

  if (colOf.name === undefined) {
    return {
      ...blank, headers, matched, ignored,
      error: `This file has no “Name” column, so there is nothing to file a creator under. Columns found: ${headers.filter(Boolean).join(', ') || '(none)'}.`,
    };
  }

  const at = (row: unknown[], key: string) => (colOf[key] === undefined ? '' : cell(row[colOf[key]]));
  const rows: ParsedCreator[] = [];
  const seen = new Map<string, number>();   // identity → the line that claimed it

  for (let i = hIdx + 1; i < grid.length; i++) {
    const row = grid[i] || [];
    if (!row.some(c => cell(c))) continue;          // a blank spacer row is not a refusal
    const line = i + 1;
    const warnings: string[] = [];

    const name = at(row, 'name');
    const handles = readHandles(colOf.tiktok_handle === undefined ? '' : row[colOf.tiktok_handle]);

    const num = (key: string) => {
      const r = parseNumberCell(colOf[key] === undefined ? '' : row[colOf[key]]);
      if (r.bad) warnings.push(`${IMPORT_FIELDS.find(f => f.key === key)?.label || key} could not be read as a number and was left blank`);
      return r.value == null ? '' : String(r.value);
    };

    const data = {
      name,
      tiktok_handle: handles.join('\n'),
      phone: at(row, 'phone'),
      email: at(row, 'email'),
      categories: splitList(colOf.categories === undefined ? '' : row[colOf.categories]),
      region: at(row, 'region'),
      followers: num('followers'),
      rate: num('rate'),
      paypal: at(row, 'paypal'),
      zelle: at(row, 'zelle'),
      tags: splitList(colOf.tags === undefined ? '' : row[colOf.tags]),
      // Notes keep their line breaks: they are prose, and a cell holding two
      // sentences on two lines means them on two lines.
      notes: String((colOf.notes === undefined ? '' : row[colOf.notes]) ?? '').trim(),
    };

    if (!name) {
      rows.push({ line, key: '', data, status: 'refused', reason: 'No name in this row', warnings });
      continue;
    }

    const key = opts.keyOf({ name, tiktok_handle: data.tiktok_handle });
    let status: ParsedCreator['status'] = 'new';
    let reason: string | undefined;

    const twin = seen.get(key);
    if (twin) { status = 'duplicate'; reason = `Same creator as row ${twin}`; }
    else if (existing.has(key)) { status = 'existing'; reason = 'Already in the database'; }
    if (!twin) seen.set(key, line);

    // A creator identified only by their NAME is a weaker match than one with
    // a handle — worth saying, because two different people can share a name.
    if (!handles.length) warnings.push('No TikTok handle, so this creator is identified by name alone');
    /* Derived-only: we have run deals with them but nobody has banked their
       credentials. That is still an INSERT — it is what the "+" on such a row
       does — so it stays `new`, and the warning is there so a list of
       strangers does not quietly include a colleague's existing creator. */
    if (status === 'new' && known.has(key)) warnings.push('Already worked with us — this banks their credentials');

    rows.push({ line, key, data, status, reason, warnings });
  }

  const counts = rows.reduce((c, r) => { c.total++; c[r.status]++; return c; }, { ...EMPTY_COUNTS });
  return { ok: true, headers, matched, ignored, rows, counts };
}

/** The rows an import would actually write, given whether the viewer asked
    for the creators already on record to be brought up to date. */
export function rowsToWrite(result: ParseResult, updateExisting: boolean): ParsedCreator[] {
  return result.rows.filter(r => r.status === 'new' || (updateExisting && r.status === 'existing'));
}

/** Header row for the downloadable template, in the order people fill it. */
export const TEMPLATE_HEADERS = IMPORT_FIELDS.map(f => f.label);

/** One filled-in row, so the template shows the shape of each cell rather
    than leaving "how do I write two handles" to be guessed. */
export const TEMPLATE_EXAMPLE = [
  'Jane Doe', '@janedoe, @janedoe.beauty', '+1 555 0100', 'jane@example.com',
  'Beauty, Skincare', 'US', '120000', '150', 'jane@example.com', '+1 555 0100',
  'high-converting, US-based', 'Found through the #skintok tag',
];
