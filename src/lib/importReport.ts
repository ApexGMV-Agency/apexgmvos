// PDF importer for the Google Docs weekly-report format used by APCs.
// Reads a Google Doc PDF (text tables, no graphics) and maps cells into a
// partial WeeklyReportContent. All extraction is local — no API calls.
//
// Sections recognised (case-insensitive, optional trailing colon):
//   Overall Performance, Top Creators, Top Videos, Video Performance,
//   Overall GMV Max Performance, Product Highlights, Shop Health, Insights.
// "Discounts" and "Paid Collabs" are detected only as section boundaries
// (their content doesn't map to the schema and is skipped).

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  WeeklyReportContent, TopCreator, TopVideo, ProductRow, ListingQuality,
  emptyOverall, emptyVideoPerf, emptyGmvMax, emptyShopHealth,
} from './reportSchema';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface LinkAnno {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Cell {
  text: string;
  x: number;
  y: number;
  width: number;
  items: TextItem[];
}
interface Line {
  y: number;
  cells: Cell[];
  text: string;
}

export interface ImportedReportMeta {
  brand_name?: string;
  date_range_text?: string;
}

export interface ParsedReport {
  meta: ImportedReportMeta;
  content: Partial<WeeklyReportContent>;
  warnings: string[];
}

const Y_TOL = 3;
const X_CELL_GAP = 8;

const SECTION_HEADERS = [
  'Overall Performance',
  'Top Creators',
  'Top Videos',
  'Video Performance',
  'Overall GMV Max Performance',
  'Product Highlights',
  'Shop Health',
  'Insights',
  'Discounts',
  'Paid Collabs',
];

export async function parseReportPdf(file: File): Promise<ParsedReport> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const items: TextItem[] = [];
  const links: LinkAnno[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    // Stack pages vertically — cumulative Y so a single axis covers the doc.
    const yOffset = (pageNum - 1) * viewport.height * 1.1;

    const content = await page.getTextContent();
    for (const it of content.items as any[]) {
      const text = String(it.str ?? '');
      if (text.trim().length === 0) continue;
      const x = it.transform[4];
      const y = viewport.height - it.transform[5] + yOffset;
      items.push({
        str: text, x, y,
        width: it.width ?? 0,
        height: it.height ?? 12,
      });
    }

    const annos = await page.getAnnotations();
    for (const a of annos) {
      if (a.subtype === 'Link' && a.url && Array.isArray(a.rect)) {
        const [x1, y1, x2, y2] = a.rect;
        links.push({
          url: a.url,
          x: Math.min(x1, x2),
          y: viewport.height - Math.max(y1, y2) + yOffset,
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        });
      }
    }
  }

  const lines = groupLines(items);
  const warnings: string[] = [];
  const content: Partial<WeeklyReportContent> = {};
  const meta: ImportedReportMeta = {};

  parseTitle(lines, meta);

  const sections = sliceSections(lines);

  if (sections['Overall Performance']) {
    const o = parseOverallPerformance(sections['Overall Performance']);
    if (o) content.overall = o;
    else warnings.push('Could not read Overall Performance');
  } else warnings.push('"Overall Performance" section not found');

  if (sections['Top Creators']) {
    const cs = parseTopCreators(sections['Top Creators']);
    if (cs.length > 0) content.top_creators = cs;
  }

  if (sections['Top Videos']) {
    const vs = parseTopVideos(sections['Top Videos'], links);
    if (vs.length > 0) content.top_videos = vs;
  }

  if (sections['Video Performance']) {
    const vp = parseVideoPerformance(sections['Video Performance']);
    if (vp) content.video_performance = vp;
    else warnings.push('Could not read Video Performance');
  }

  if (sections['Overall GMV Max Performance']) {
    const gm = parseGmvMax(sections['Overall GMV Max Performance']);
    if (gm) content.gmv_max = gm;
    else warnings.push('Could not read GMV Max');
  }

  if (sections['Product Highlights']) {
    const ph = parseProductHighlights(sections['Product Highlights']);
    if (ph.length > 0) content.product_highlights = ph;
  }

  if (sections['Shop Health']) {
    content.shop_health = parseShopHealth(sections['Shop Health']);
  }

  if (sections['Insights']) {
    const html = parseInsights(sections['Insights']);
    if (html) content.insights = { summary: html };
  }

  return { meta, content, warnings };
}

// ---------------------------------------------------------------------------
// line / cell grouping

function groupLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rawLines: TextItem[][] = [];
  for (const it of sorted) {
    const last = rawLines[rawLines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= Y_TOL) last.push(it);
    else rawLines.push([it]);
  }
  return rawLines.map(lineItems => {
    lineItems.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of lineItems) {
      const last = cells[cells.length - 1];
      if (last && it.x - (last.x + last.width) <= X_CELL_GAP) {
        last.text += it.str;
        last.width = (it.x + it.width) - last.x;
        last.items.push(it);
      } else {
        cells.push({ text: it.str, x: it.x, y: it.y, width: it.width, items: [it] });
      }
    }
    cells.forEach(c => { c.text = c.text.replace(/\s+/g, ' ').trim(); });
    const cellsNonEmpty = cells.filter(c => c.text.length > 0);
    return {
      y: lineItems[0].y,
      cells: cellsNonEmpty,
      text: cellsNonEmpty.map(c => c.text).join(' '),
    };
  }).filter(l => l.cells.length > 0);
}

// ---------------------------------------------------------------------------
// title

function parseTitle(lines: Line[], meta: ImportedReportMeta) {
  // "WEEKLY REPORT - My Rosy - Apr 19 - Apr 25" or similar.
  const titleLine = lines.find(l => /weekly\s+report/i.test(l.text));
  if (!titleLine) return;
  const t = titleLine.text;
  // Brand: between "WEEKLY REPORT" and the first date-like token.
  const m = t.match(/weekly\s+report\s*[-–—:]?\s*(.+?)\s*[-–—]\s*([A-Z][a-z]{2,8}\s+\d.*)$/i);
  if (m) {
    meta.brand_name = m[1].trim();
    meta.date_range_text = m[2].trim();
  }
}

// ---------------------------------------------------------------------------
// section slicing

function matchSectionHeader(text: string): string | null {
  const cleaned = text.trim().replace(/[:\s]+$/, '').trim();
  for (const name of SECTION_HEADERS) {
    if (cleaned.toLowerCase() === name.toLowerCase()) return name;
  }
  return null;
}

function sliceSections(lines: Line[]): Record<string, Line[]> {
  const headerLines: { name: string; idx: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const name = matchSectionHeader(lines[i].text);
    if (name) headerLines.push({ name, idx: i });
  }
  const out: Record<string, Line[]> = {};
  for (let i = 0; i < headerLines.length; i++) {
    const { name, idx } = headerLines[i];
    const next = headerLines[i + 1];
    out[name] = lines.slice(idx + 1, next ? next.idx : lines.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Overall Performance — vertical-key table (Metric | This Week | Last Week | Notes)

function parseOverallPerformance(lines: Line[]): WeeklyReportContent['overall'] | null {
  const o = emptyOverall();
  // Match against the FULL line text — pdfjs sometimes splits multi-word
  // labels ("Total GMV") into separate cells with X-gaps wider than our
  // merge threshold, so we can't rely on cells[0] alone.
  const labelMap: { regex: RegExp; field: keyof typeof o }[] = [
    { regex: /^total\s+gmv\b/i,        field: 'total_gmv' },
    { regex: /^affiliate\s+gmv\b/i,    field: 'affiliate_gmv' },
    { regex: /^orders\b/i,             field: 'orders' },
    { regex: /^samples\s+approved\b/i, field: 'samples_approved' },
    { regex: /^ad\s+spend\b/i,         field: 'ad_spend' },
    { regex: /^pending\s+collabs\b/i,  field: 'pending_collabs' },
  ];

  let foundAny = false;
  for (const l of lines) {
    if (l.cells.length < 2) continue;
    const matched = labelMap.find(({ regex }) => regex.test(l.text));
    if (!matched) continue;

    // First cell that begins with $/digit/dash or "not" — treat as value.
    const valueCellIdx = l.cells.findIndex(c =>
      /^[\$\d-]/.test(c.text.trim()) || /^not\s/i.test(c.text.trim())
    );
    if (valueCellIdx < 0) continue;
    const valueCell = l.cells[valueCellIdx];

    if (matched.field === 'ad_spend' && /not\s*started/i.test(valueCell.text)) {
      o.ad_spend_not_started = true;
      o.ad_spend = 0;
      foundAny = true;
      continue;
    }
    const n = parseNum(valueCell.text);
    if (n != null) {
      if (matched.field === 'ad_spend') o.ad_spend_not_started = false;
      (o as any)[matched.field] = n;
      foundAny = true;
    }
    // Samples Approved notes — first letter-bearing cell after the Last Week value.
    if (matched.field === 'samples_approved') {
      const noteCell = l.cells.slice(valueCellIdx + 2).find(c => /[a-zA-Z]/.test(c.text));
      if (noteCell) o.samples_approved_note = noteCell.text.trim();
    }
  }
  return foundAny ? o : null;
}

// ---------------------------------------------------------------------------
// Top Creators — Creator Name | Videos Posted | Items Sold | GMV Generated | Notes

function parseTopCreators(lines: Line[]): TopCreator[] {
  // Detect column header line by required tokens
  const headerLine = lines.find(l =>
    /creator\s+name/i.test(l.text) &&
    /videos/i.test(l.text) &&
    /(items\s+sold|items)/i.test(l.text) &&
    /gmv/i.test(l.text)
  );

  const dataLines = headerLine
    ? lines.filter(l => l.y > headerLine.y + 6)
    : lines;

  // The header may span multiple visual rows in Google Docs (wrapped header text).
  // We skip leading lines whose first cell is not creator-name-like text.
  const out: TopCreator[] = [];
  for (const l of dataLines) {
    if (l.cells.length < 4) continue;
    const name = l.cells[0].text.trim();
    if (!name) continue;
    // Reject lines whose 2nd/3rd/4th cells aren't all numeric — they're wrapped
    // header text ("Posted", "(This", "week)", etc.) or non-data rows.
    const videos    = parseNum(l.cells[1]?.text);
    const itemsSold = parseNum(l.cells[2]?.text);
    const gmv       = parseNum(l.cells[3]?.text);
    if (videos == null || itemsSold == null || gmv == null) continue;
    // Reject creator names that are clearly header words
    if (/^(creator|videos?|posted|items?|gmv|generated|notes|this\s*week|last\s*week|name)$/i.test(name)) continue;
    const notes = (l.cells[4]?.text ?? '').trim();
    out.push({ name, videos, items_sold: itemsSold, gmv, notes });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top Videos — split table: This Week | Last Week. Each side: Creator | Items Sold | GMV.

function parseTopVideos(lines: Line[], links: LinkAnno[]): TopVideo[] {
  // Find the "this week / last week" header
  const thisWeekHeader = lines.find(l =>
    l.cells.some(c => /^this\s*week$/i.test(c.text)) &&
    l.cells.some(c => /^last\s*week$/i.test(c.text))
  );
  if (!thisWeekHeader) return [];

  // Boundary X between the two sub-tables = X of "Last Week" cell
  const lastWeekCell = thisWeekHeader.cells.find(c => /^last\s*week$/i.test(c.text));
  if (!lastWeekCell) return [];
  const splitX = lastWeekCell.x - 4;

  // Skip the column-headers (Creator Name, Items Sold, GMV Generated) below the split header
  const dataLines = lines.filter(l => l.y > thisWeekHeader.y + 6);
  // Drop wrapped header rows at the top by skipping while first cell is a header word
  const cleanData = dataLines.filter(l => {
    const t = l.cells[0]?.text.toLowerCase() ?? '';
    if (!t) return false;
    return !/^(creator|name|video|url|linked|items|sold|gmv|generated|posted)/.test(t);
  });

  const out: TopVideo[] = [];
  for (const l of cleanData) {
    const left = l.cells.filter(c => c.x < splitX);
    if (left.length === 0) continue;
    const name = left[0]?.text.trim() ?? '';
    if (!name) continue;
    if (left.length < 3) continue;
    if (/^(creator|name|video|url|linked|items?|sold|gmv|generated|posted)$/i.test(name)) continue;

    const itemsSold = parseNum(left[1].text);
    const gmv       = parseNum(left[2].text);
    if (itemsSold == null || gmv == null) continue;

    // Find a link annotation overlapping the creator cell
    let url = '';
    const creatorCell = left[0];
    const link = links.find(a =>
      Math.abs(a.y + a.height / 2 - l.y) < 18 &&
      a.x <= creatorCell.x + creatorCell.width + 6 &&
      a.x + a.width >= creatorCell.x - 6
    );
    if (link) url = link.url;

    out.push({ creator_name: name, video_url: url, items_sold: itemsSold, gmv });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Video Performance — vertical-key table (Metric | This Week | Last Week)

function parseVideoPerformance(lines: Line[]): WeeklyReportContent['video_performance'] | null {
  const vp = emptyVideoPerf();
  const labelMap: { regex: RegExp; field: keyof typeof vp }[] = [
    { regex: /^total\s+videos\s+posted\b/i, field: 'total_videos_posted' },
    { regex: /^video\s+views\b/i,           field: 'video_views' },
    { regex: /^ctr\b/i,                     field: 'ctr' },
    { regex: /^ctor\b/i,                    field: 'ctor' },
  ];
  let foundAny = false;
  for (const l of lines) {
    if (l.cells.length < 2) continue;
    const matched = labelMap.find(({ regex }) => regex.test(l.text));
    if (!matched) continue;
    const valueCell = l.cells.find(c => /^[\$\d-]/.test(c.text.trim()));
    if (!valueCell) continue;
    const n = parseNum(valueCell.text);
    if (n != null) {
      (vp as any)[matched.field] = n;
      foundAny = true;
    }
  }
  return foundAny ? vp : null;
}

// ---------------------------------------------------------------------------
// Overall GMV Max — transposed table. Row "This Week" → Ad Spend, ROI, Orders, CPO, GMV.

function parseGmvMax(lines: Line[]): WeeklyReportContent['gmv_max'] | null {
  const gm = emptyGmvMax();

  // "Not yet started" / "Not started" anywhere in the section → mark not started.
  if (lines.some(l => /not\s*(yet\s*)?started/i.test(l.text))) {
    gm.not_yet_started = true;
    return gm;
  }

  const headerLine = lines.find(l =>
    /ad\s+spend/i.test(l.text) && /roi/i.test(l.text) && /cpo/i.test(l.text) && /gmv/i.test(l.text)
  );
  if (!headerLine) return null;

  // Map header column X positions to fields. "Ad Spend" can be split into
  // ["Ad", "Spend"] cells, so we try each cell alone or combined with the next.
  const colSpec: { regex: RegExp; field: keyof typeof gm }[] = [
    { regex: /^ad\s+spend$/i, field: 'ad_spend' },
    { regex: /^roi$/i,        field: 'roi' },
    { regex: /^orders$/i,     field: 'orders' },
    { regex: /^cpo$/i,        field: 'cpo' },
    { regex: /^gmv$/i,        field: 'gmv' },
  ];
  const colXs: { field: keyof typeof gm; x: number }[] = [];
  for (const { regex, field } of colSpec) {
    const x = findLabelX(headerLine, regex);
    if (x != null) colXs.push({ field, x });
  }
  if (colXs.length === 0) return null;

  const thisRow = lines.find(l =>
    l.y > headerLine.y && /^this\s*week\b/i.test(l.text),
  );
  if (!thisRow) return null;

  let foundAny = false;
  for (const { field, x } of colXs) {
    const cell = thisRow.cells.find(c => Math.abs(c.x - x) < 30);
    if (!cell) continue;
    const n = parseNum(cell.text);
    if (n != null) {
      (gm as any)[field] = n;
      foundAny = true;
    }
  }
  if (foundAny) gm.not_yet_started = false;
  return foundAny ? gm : null;
}

// ---------------------------------------------------------------------------
// Product Highlights — multi-line product-name cell. Main row has a numeric
// "Total Units" column; continuation rows fill only the Product column.

function parseProductHighlights(lines: Line[]): ProductRow[] {
  const headerLine = lines.find(l =>
    /total\s+units/i.test(l.text) && /listing\s+quality/i.test(l.text),
  );
  if (!headerLine) return [];

  const cols: { name: string; match: RegExp }[] = [
    { name: 'product',    match: /^product\b/i },
    { name: 'total',      match: /^total\s+units\b/i },
    { name: 'affiliate',  match: /^affiliate\s+units\b/i },
    { name: 'totalGmv',   match: /^total\s+gmv\b/i },
    { name: 'videos',     match: /^videos\b/i },
    { name: 'quality',    match: /^listing\s+quality\b/i },
  ];
  const colXs: Record<string, number> = {};
  for (const { name, match } of cols) {
    const x = findLabelX(headerLine, match);
    if (x == null) return [];
    colXs[name] = x;
  }

  const dataLines = lines.filter(l => l.y > headerLine.y + 6);
  const products: ProductRow[] = [];
  let current: ProductRow | null = null;

  const cellAt = (line: Line, colName: string): Cell | null => {
    const targetX = colXs[colName];
    const orderedCols = cols.map(c => colXs[c.name]).sort((a, b) => a - b);
    const idx = orderedCols.indexOf(targetX);
    const nextX = orderedCols[idx + 1] ?? Infinity;
    return line.cells.find(c => c.x >= targetX - 30 && c.x < (nextX === Infinity ? Number.MAX_VALUE : nextX - 6)) ?? null;
  };

  for (const line of dataLines) {
    const totalCell = cellAt(line, 'total');
    const isMain = !!totalCell && /^\d/.test(totalCell.text.trim());

    if (isMain) {
      if (current) products.push(current);
      const productCell  = cellAt(line, 'product');
      const affCell      = cellAt(line, 'affiliate');
      const totalGmvCell = cellAt(line, 'totalGmv');
      const videosCell   = cellAt(line, 'videos');
      const qualityCell  = cellAt(line, 'quality');
      const productText  = productCell?.text.trim() ?? '';
      // First long-digit run is the product ID; the rest is part of the name.
      const idMatch = productText.match(/^(\d{8,})\s*(.*)$/);
      current = {
        product_id:           idMatch ? idMatch[1] : '',
        product_name:         idMatch ? idMatch[2] : productText,
        total_units_sold:     parseNum(totalCell.text) ?? 0,
        affiliate_units_sold: parseNum(affCell?.text) ?? 0,
        total_gmv:            parseNum(totalGmvCell?.text) ?? 0,
        affiliate_gmv:        0,
        videos_posted:        parseNum(videosCell?.text) ?? 0,
        listing_quality:      parseListingQuality(qualityCell?.text),
        notes: '',
      };
    } else if (current) {
      // Continuation: append text from the product column to the name
      const productCell = cellAt(line, 'product');
      if (productCell && productCell.text.trim().length > 0) {
        current.product_name = (current.product_name + ' ' + productCell.text.trim()).trim();
      }
    }
  }
  if (current) products.push(current);
  return products;
}

// Find the X coordinate of a header label within a header line. Tries the cell
// alone, then with up to two following cells joined, so split labels like
// ["Total", "Units", "Sold"] still match /^total\s+units\b/.
function findLabelX(line: Line, regex: RegExp): number | null {
  for (let i = 0; i < line.cells.length; i++) {
    const c = line.cells[i];
    const cn = line.cells[i + 1];
    const cnn = line.cells[i + 2];
    if (regex.test(c.text)) return c.x;
    if (cn && regex.test(`${c.text} ${cn.text}`)) return c.x;
    if (cnn && regex.test(`${c.text} ${cn.text} ${cnn.text}`)) return c.x;
  }
  return null;
}

function parseListingQuality(v: string | undefined): ListingQuality {
  if (!v) return '';
  const t = v.trim().toLowerCase();
  if (t.startsWith('excellent')) return 'excellent';
  if (t.startsWith('good'))      return 'good';
  if (t.startsWith('fair'))      return 'fair';
  if (t.startsWith('poor'))      return 'poor';
  return '';
}

// ---------------------------------------------------------------------------
// Shop Health — vertical-key table

function parseShopHealth(lines: Line[]): WeeklyReportContent['shop_health'] {
  const sh = emptyShopHealth();

  // Match against full line text since labels span multiple cells in Google Docs.
  // Pick the first cell whose text starts with a digit/dash/yes/no as the value.
  const findValue = (l: Line): string | null => {
    const c = l.cells.find(c => /^[\d-]/.test(c.text.trim()) || /^(yes|no)\b/i.test(c.text.trim()));
    return c ? c.text.trim() : null;
  };

  for (const l of lines) {
    if (l.cells.length < 2) continue;
    const t = l.text;
    if (/^shop\s+performance\s+score/i.test(t)) {
      const v = findValue(l); if (v) sh.shop_performance_score = parseRating(v);
    } else if (/^product\s+satisfaction/i.test(t)) {
      const v = findValue(l); if (v) sh.product_satisfaction_rating = parseRating(v);
    } else if (/^fulfillment/i.test(t)) {
      const v = findValue(l); if (v) sh.fulfillment_rating = parseRating(v);
    } else if (/^customer\s+service/i.test(t)) {
      const v = findValue(l); if (v) sh.customer_service_rating = parseRating(v);
    } else if (/dispatching/i.test(t)) {
      const v = findValue(l); if (v) sh.dispatching_on_time = parseYesNo(v);
    } else if (/replying/i.test(t)) {
      const v = findValue(l); if (v) sh.replying_within_24h = parseYesNo(v);
    } else if (/^warnings/i.test(t)) {
      const v = findValue(l);
      if (v) {
        const n = parseNum(v);
        sh.warnings_received = n != null && n > 0;
      }
    } else if (/^violations/i.test(t)) {
      const v = findValue(l);
      if (v) {
        const n = parseNum(v);
        sh.violations_received = n != null && n > 0;
      }
    }
  }
  return sh;
}
function parseRating(value: string): number | null {
  if (!value || value === '-' || value === '—') return null;
  const m = value.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
function parseYesNo(value: string): WeeklyReportContent['shop_health']['dispatching_on_time'] {
  const t = value.trim().toLowerCase();
  if (t === 'yes' || t === 'y' || t === 'true')  return 'yes';
  if (t === 'no'  || t === 'n' || t === 'false') return 'no';
  return 'not_rated';
}

// ---------------------------------------------------------------------------
// Insights — bulleted list → <ul><li>…</li></ul>

function parseInsights(lines: Line[]): string {
  // Build items: each starts with a bullet; subsequent non-bullet lines extend it.
  const items: { level: number; text: string }[] = [];
  let pendingText: string | null = null;
  let pendingLevel = 0;

  const flush = () => {
    if (pendingText && pendingText.trim()) items.push({ level: pendingLevel, text: pendingText.trim() });
    pendingText = null;
  };

  for (const l of lines) {
    const txt = l.text.trim();
    if (!txt) continue;
    // Top-level bullet
    if (/^[●•]\s*/.test(txt)) {
      flush();
      pendingLevel = 0;
      pendingText = txt.replace(/^[●•]\s*/, '');
      continue;
    }
    // Sub-bullet
    if (/^[○◦]\s*/.test(txt)) {
      flush();
      pendingLevel = 1;
      pendingText = txt.replace(/^[○◦]\s*/, '');
      continue;
    }
    // Letter/number sub-list (e.g. "a." "i." "1.") — treat as level-1 sub-item
    if (/^([a-z]|\d+|[ivx]+)\.\s+/i.test(txt)) {
      flush();
      pendingLevel = 1;
      pendingText = txt.replace(/^([a-z]|\d+|[ivx]+)\.\s+/i, '');
      continue;
    }
    // Continuation of previous item (visual line wrap)
    if (pendingText != null) pendingText += ' ' + txt;
    else { pendingLevel = 0; pendingText = txt; }
  }
  flush();
  if (items.length === 0) return '';

  // Build HTML with simple nested-list grouping
  let html = '';
  let i = 0;
  while (i < items.length) {
    if (items[i].level === 0) {
      html += `<li>${escapeHtml(items[i].text)}`;
      // Group following level-1 items under it
      const subs: string[] = [];
      let j = i + 1;
      while (j < items.length && items[j].level === 1) {
        subs.push(`<li>${escapeHtml(items[j].text)}</li>`);
        j++;
      }
      if (subs.length > 0) html += `<ul>${subs.join('')}</ul>`;
      html += '</li>';
      i = j;
    } else {
      // Stray level-1 item with no parent — render at top level
      html += `<li>${escapeHtml(items[i].text)}</li>`;
      i++;
    }
  }
  return `<ul>${html}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// numeric parsing — handle "$1,234.56", "9.65%", "26.33K", "—", "Not started"

function parseNum(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length === 0 || s === '—' || s === '-') return null;
  if (/^not\s*started$/i.test(s) || /^not\s*yet/i.test(s)) return null;
  const cleaned = s
    .replace(/[↑↗↙↓→←]/g, '')
    .replace(/[$,]/g, '')
    .replace(/%/g, '')
    .trim();
  if (cleaned.length === 0) return null;
  const m = cleaned.match(/-?(\d+(?:\.\d+)?)\s*([KkMmBb])?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2]?.toUpperCase();
  if (suffix === 'K') n *= 1_000;
  else if (suffix === 'M') n *= 1_000_000;
  else if (suffix === 'B') n *= 1_000_000_000;
  if (s.startsWith('-')) n = -Math.abs(n);
  return n;
}
