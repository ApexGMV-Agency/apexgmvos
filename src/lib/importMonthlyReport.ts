// PDF importer for the Google-Docs monthly-report layout.
// Same approach as the weekly importer (importReport.ts) — pdfjs text +
// link-annotation extraction, Y-grouped lines, then per-section extractors.

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  MonthlyReportContent, MonthlyTopCreator, MonthlyTopVideo, ProductAnalyticsRowM,
  emptyMonthlyContent, ThisLast,
} from './monthlyReportSchema';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItem { str: string; x: number; y: number; width: number; height: number; }
interface LinkAnno { url: string; x: number; y: number; width: number; height: number; }
interface Cell { text: string; x: number; y: number; width: number; items: TextItem[]; }
interface Line { y: number; cells: Cell[]; text: string; }

export interface ImportedMonthlyMeta {
  brand_name?: string;
  month_label?: string;
}
export interface ParsedMonthlyReport {
  meta: ImportedMonthlyMeta;
  content: Partial<MonthlyReportContent>;
  warnings: string[];
}

const Y_TOL = 3;
const X_CELL_GAP = 8;

// Section header keywords (matched against full line text, case-insensitive,
// optional trailing colon). Extra words allowed before/after.
const SECTION_HEADERS: { name: string; regex: RegExp }[] = [
  { name: 'Total Sales',           regex: /^total\s+sales\b/i },
  { name: "KPI's",                 regex: /^kpi['']?s?\b/i },
  { name: 'GMV Breakdown',         regex: /^gmv\s+breakdown\b/i },
  { name: 'Top Creators',          regex: /^top\s+creators\b/i },
  { name: 'Top Videos',            regex: /^top\s+videos\b/i },
  { name: 'Video Performance',     regex: /^video\s+performance\b/i },
  { name: 'Creators Performance',  regex: /^creators\s+performance\b/i },
  { name: 'Product Analytics',     regex: /^product\s+analytics\b/i },
  { name: 'Customers',             regex: /^customers\b/i },
  { name: 'Strategy & Insights',   regex: /^strategy\s*&\s*insights\b/i },
  { name: 'Discounting',           regex: /^discounting\b/i },
  { name: 'GMV Max Ads',           regex: /^gmv\s+max\s+ads\b/i },
  { name: 'Paid Collabs',          regex: /^paid\s+collabs\b/i },
  { name: 'AI Content',            regex: /^ai\s+content\b/i },
  { name: 'Strategy Moving Forward', regex: /^strategy\s+moving\s+forward\b/i },
];

export async function parseMonthlyReportPdf(file: File): Promise<ParsedMonthlyReport> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const items: TextItem[] = [];
  const links: LinkAnno[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const yOffset = (pageNum - 1) * viewport.height * 1.1;
    const content = await page.getTextContent();
    for (const it of content.items as any[]) {
      const text = String(it.str ?? '');
      if (text.trim().length === 0) continue;
      items.push({
        str: text,
        x: it.transform[4],
        y: viewport.height - it.transform[5] + yOffset,
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
  const meta: ImportedMonthlyMeta = {};
  const warnings: string[] = [];
  const content: Partial<MonthlyReportContent> = {};

  parseTitle(lines, meta);
  const sections = sliceSections(lines);

  if (sections['Total Sales']) {
    const ts = parseTotalSales(sections['Total Sales']);
    if (ts) content.total_sales = { ...emptyMonthlyContent().total_sales, ...ts };
  }

  // Helper: parse a vertical-key table with This/Last columns into a ThisLast map
  const parseTLTable = (lines: Line[], rowMap: { regex: RegExp; field: string }[]): Record<string, ThisLast> => {
    const out: Record<string, ThisLast> = {};
    for (const l of lines) {
      const text = l.text;
      const matched = rowMap.find(r => r.regex.test(text));
      if (!matched) continue;
      // First two numeric cells after the label = This Month, Last Month
      const numerics: number[] = [];
      for (const c of l.cells) {
        const n = parseNum(c.text);
        if (n != null) numerics.push(n);
      }
      // Drop any leading numeric that is part of the label (rare)
      if (numerics.length >= 2) out[matched.field] = { this: numerics[0], last: numerics[1] };
      else if (numerics.length === 1) out[matched.field] = { this: numerics[0], last: 0 };
    }
    return out;
  };

  if (sections["KPI's"]) {
    const kp = parseTLTable(sections["KPI's"], [
      { regex: /samples\s+approved/i,       field: 'samples_approved' },
      { regex: /new\s+affiliate\s+posts/i,  field: 'new_affiliate_posts' },
      { regex: /completed\s+collabs/i,      field: 'completed_collabs' },
      { regex: /content\s+pending/i,        field: 'content_pending' },
      { regex: /total\s+orders/i,           field: 'total_orders' },
    ]);
    if (Object.keys(kp).length > 0) {
      content.kpis = { ...emptyMonthlyContent().kpis, ...kp } as any;
    }
  }

  if (sections['GMV Breakdown']) {
    const gb = parseTLTable(sections['GMV Breakdown'], [
      { regex: /affiliate\s+gmv/i,      field: 'affiliate_gmv' },
      { regex: /organic\s+gmv/i,        field: 'organic_gmv' },
      { regex: /live\s+gmv/i,           field: 'live_gmv' },
      { regex: /video\s+gmv/i,          field: 'video_gmv' },
      { regex: /product\s+card\s+gmv/i, field: 'product_card_gmv' },
    ]);
    if (Object.keys(gb).length > 0) {
      content.gmv_breakdown = { ...emptyMonthlyContent().gmv_breakdown, ...gb } as any;
    }
  }

  if (sections['Video Performance']) {
    const vp = parseTLTable(sections['Video Performance'], [
      { regex: /^product\s+impressions/i,    field: 'product_impressions' },
      { regex: /^product\s+clicks/i,         field: 'product_clicks' },
      { regex: /^video\s+v?iews/i,           field: 'video_views' },
      { regex: /^ctr\b/i,                    field: 'ctr' },
      { regex: /^ctor\b/i,                   field: 'ctor' },
      { regex: /^sku\s+orders/i,             field: 'sku_orders' },
      { regex: /^gmv\b/i,                    field: 'gmv' },
      { regex: /1m\s*\+\s*views/i,           field: 'videos_1m_views' },
      { regex: /100k\s*\+\s*views/i,         field: 'videos_100k_views' },
      { regex: /10k\s*\+\s*views/i,          field: 'videos_10k_views' },
      { regex: /\$\s*1000\s*\+\s*gmv/i,      field: 'videos_1k_gmv' },
      { regex: /\$\s*100\s*\+\s*gmv/i,       field: 'videos_100_gmv' },
      { regex: /new\s+videos\s+posted/i,     field: 'new_videos_posted' },
    ]);
    if (Object.keys(vp).length > 0) {
      content.video_performance = { ...emptyMonthlyContent().video_performance, ...vp } as any;
    }
  }

  if (sections['Creators Performance']) {
    const cp = parseTLTable(sections['Creators Performance'], [
      { regex: /posted\s+1\s*\+\s*videos/i,   field: 'posted_1plus' },
      { regex: /posted\s+3\s*\+\s*videos/i,   field: 'posted_3plus' },
      { regex: /posted\s+10\s*\+\s*videos/i,  field: 'posted_10plus' },
      { regex: /generated\s+\$\s*1k\s*\+/i,   field: 'generated_1k_plus' },
      { regex: /generated\s+\$\s*100\s*\+/i,  field: 'generated_100_plus' },
    ]);
    if (Object.keys(cp).length > 0) {
      content.creators_performance = { ...emptyMonthlyContent().creators_performance, ...cp } as any;
    }
  }

  if (sections['Top Creators']) {
    const tc = parseTopCreators(sections['Top Creators']);
    if (tc.this.length > 0) content.top_creators_this = tc.this;
    if (tc.last.length > 0) content.top_creators_last = tc.last;
  }

  if (sections['Top Videos']) {
    const tv = parseTopVideos(sections['Top Videos'], links);
    if (tv.this.length > 0) content.top_videos_this = tv.this;
    if (tv.last.length > 0) content.top_videos_last = tv.last;
  }

  if (sections['Product Analytics']) {
    const pa = parseProductAnalytics(sections['Product Analytics']);
    if (pa.length > 0) content.product_analytics = pa;
  }

  if (sections['Customers']) {
    const cu = parseCustomers(sections['Customers']);
    if (cu) content.customers = cu;
  }

  // Six rich-text narrative sections — convert any bullets/lines into paragraphs/<ul>.
  const richMap: { from: string; key: keyof MonthlyReportContent }[] = [
    { from: 'Strategy & Insights',   key: 'strategy_insights' },
    { from: 'Discounting',           key: 'discounting' },
    { from: 'GMV Max Ads',           key: 'gmv_max_ads' },
    { from: 'Paid Collabs',          key: 'paid_collabs' },
    { from: 'AI Content',            key: 'ai_content' },
    { from: 'Strategy Moving Forward', key: 'strategy_moving_forward' },
  ];
  for (const { from, key } of richMap) {
    if (!sections[from]) continue;
    const html = parseRichTextLines(sections[from]);
    if (html.length > 0) (content as any)[key] = { body: html, image_url: '' };
  }

  return { meta, content, warnings };
}

// ----------------------------------------------------------------------------
// shared line/cell grouping (mirrors importReport.ts)

function groupLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rawLines: TextItem[][] = [];
  for (const it of sorted) {
    const last = rawLines[rawLines.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= Y_TOL) last.push(it);
    else rawLines.push([it]);
  }
  return rawLines.map(line => {
    line.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of line) {
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
    return { y: line[0].y, cells: cellsNonEmpty, text: cellsNonEmpty.map(c => c.text).join(' ') };
  }).filter(l => l.cells.length > 0);
}

// ----------------------------------------------------------------------------
// title

function parseTitle(lines: Line[], meta: ImportedMonthlyMeta) {
  // "Haven Cases - TikTok Shop Report - March 2026" or similar
  const t = lines.find(l => /tiktok.*shop.*report|monthly\s+report/i.test(l.text));
  if (!t) return;
  const m = t.text.match(/^(.+?)\s*[-–—]\s*(?:tiktok\s+shop\s+report|monthly\s+report)\s*[-–—]\s*(.+)$/i);
  if (m) {
    meta.brand_name = m[1].trim();
    meta.month_label = m[2].trim();
  }
}

// ----------------------------------------------------------------------------
// section slicing

function matchSectionHeader(text: string): string | null {
  const cleaned = text.trim().replace(/[:\s]+$/, '').trim();
  for (const { name, regex } of SECTION_HEADERS) {
    if (regex.test(cleaned)) return name;
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

// ----------------------------------------------------------------------------
// per-section parsers

function parseTotalSales(lines: Line[]): Partial<MonthlyReportContent['total_sales']> | null {
  const out: Partial<MonthlyReportContent['total_sales']> = {};
  let foundAny = false;
  for (const l of lines) {
    const monthMatch = l.text.match(/MONTH\s*[:\-]\s*\$?\s*([\d,.]+)/i);
    if (monthMatch) { out.month = parseNum(monthMatch[1]) ?? 0; foundAny = true; continue; }
    const allMatch = l.text.match(/all\s+time\s*[:\-]\s*\$?\s*([\d,.]+)/i);
    if (allMatch) {
      out.all_time = parseNum(allMatch[1]) ?? 0;
      foundAny = true;
      // Period label after an arrow / dash
      const tail = l.text.replace(/^.*all\s+time\s*[:\-]\s*\$?\s*[\d,.]+\s*[-–—>]+\s*/i, '').trim();
      if (tail.length > 0) out.all_time_period_label = tail;
    }
  }
  return foundAny ? out : null;
}

function parseTopCreators(lines: Line[]): { this: MonthlyTopCreator[]; last: MonthlyTopCreator[] } {
  // Find "This Month" / "Last Month" header to determine X split
  const header = lines.find(l => /this\s+month/i.test(l.text) && /last\s+month/i.test(l.text));
  if (!header) return { this: [], last: [] };
  const lastCell = header.cells.find(c => /^last\s+month$/i.test(c.text));
  const splitX = (lastCell?.x ?? 1e6) - 4;

  const data = lines.filter(l => l.y > header.y + 6);
  // Drop sub-header rows ("Username", "GMV Generated")
  const isHeaderWord = (t: string) =>
    /^(username|gmv|generated|video\s+link|notes|posted|items|sold)$/i.test(t.trim());

  const thisRows: MonthlyTopCreator[] = [];
  const lastRows: MonthlyTopCreator[] = [];
  for (const l of data) {
    const left  = l.cells.filter(c => c.x < splitX);
    const right = l.cells.filter(c => c.x >= splitX);
    const pickPair = (cells: Cell[], dst: MonthlyTopCreator[]) => {
      if (cells.length < 2) return;
      const name = cells[0].text.trim();
      if (!name || isHeaderWord(name)) return;
      const gmv = parseNum(cells[1].text);
      if (gmv == null) return;
      dst.push({ username: name, gmv });
    };
    pickPair(left, thisRows);
    pickPair(right, lastRows);
  }
  return { this: thisRows, last: lastRows };
}

function parseTopVideos(lines: Line[], links: LinkAnno[]): { this: MonthlyTopVideo[]; last: MonthlyTopVideo[] } {
  const header = lines.find(l => /this\s+month/i.test(l.text) && /last\s+month/i.test(l.text));
  if (!header) return { this: [], last: [] };
  const lastCell = header.cells.find(c => /^last\s+month$/i.test(c.text));
  const splitX = (lastCell?.x ?? 1e6) - 4;

  const data = lines.filter(l => l.y > header.y + 6);
  const isHeaderWord = (t: string) =>
    /^(creator|name|video|link|gmv|generated|url|linked)$/i.test(t.trim());

  const findUrl = (creatorCell: Cell, line: Line): string => {
    const link = links.find(a =>
      Math.abs(a.y + a.height / 2 - line.y) < 18 &&
      a.x <= creatorCell.x + creatorCell.width + 6 &&
      a.x + a.width >= creatorCell.x - 6
    );
    return link?.url ?? '';
  };

  const thisRows: MonthlyTopVideo[] = [];
  const lastRows: MonthlyTopVideo[] = [];
  for (const l of data) {
    const left  = l.cells.filter(c => c.x < splitX);
    const right = l.cells.filter(c => c.x >= splitX);
    const pickPair = (cells: Cell[], dst: MonthlyTopVideo[]) => {
      if (cells.length < 2) return;
      const name = cells[0].text.trim();
      if (!name || isHeaderWord(name)) return;
      const gmv = parseNum(cells[1].text);
      if (gmv == null) return;
      dst.push({ username: name, video_url: findUrl(cells[0], l), gmv });
    };
    pickPair(left, thisRows);
    pickPair(right, lastRows);
  }
  return { this: thisRows, last: lastRows };
}

function parseProductAnalytics(lines: Line[]): ProductAnalyticsRowM[] {
  // Header has Units Sold + GMV + Samples Approved + Notes
  const header = lines.find(l =>
    /units\s+sold/i.test(l.text) && /samples\s+approved/i.test(l.text)
  );
  const data = header ? lines.filter(l => l.y > header.y + 6) : lines;

  // A "main row" has at least 3 numeric cells (units, gmv, samples) somewhere.
  const out: ProductAnalyticsRowM[] = [];
  let current: ProductAnalyticsRowM | null = null;

  for (const l of data) {
    const cells = l.cells;
    const numericIdx: number[] = [];
    cells.forEach((c, i) => { if (parseNum(c.text) != null) numericIdx.push(i); });
    const isMain = numericIdx.length >= 3;
    if (isMain) {
      if (current) out.push(current);
      // First cell: product (ID + name on subsequent rows). The ID is a long digit run.
      const productCell = cells[0];
      const ptext = productCell.text.trim();
      const idM = ptext.match(/^(\d{8,})\s*(.*)$/);
      const productId = idM ? idM[1] : '';
      const productName = idM ? idM[2] : ptext;
      // Map numeric cells: assume order [units_sold, gmv, samples_approved]
      const units   = parseNum(cells[numericIdx[0]].text) ?? 0;
      const gmv     = parseNum(cells[numericIdx[1]].text) ?? 0;
      const samples = parseNum(cells[numericIdx[2]].text) ?? 0;
      // Notes is the last non-numeric cell after the numerics, if present
      const tailIdx = numericIdx[numericIdx.length - 1] + 1;
      const notes = (cells[tailIdx]?.text ?? '').trim();
      current = {
        product_id: productId, product_name: productName,
        units_sold: units, gmv, samples_approved: samples, notes,
      };
    } else if (current) {
      // Continuation — append product-name text from the leftmost cell
      const t = (cells[0]?.text ?? '').trim();
      if (t.length > 0 && !/^(this|last)\s+month$/i.test(t)) {
        current.product_name = (current.product_name + ' ' + t).trim();
      }
    }
  }
  if (current) out.push(current);
  return out;
}

function parseCustomers(lines: Line[]): MonthlyReportContent['customers'] | null {
  const c = emptyMonthlyContent().customers;
  let found = false;
  for (const l of lines) {
    const t = l.text;
    const cells = l.cells;
    const grabPair = () => {
      const nums: number[] = [];
      for (const x of cells) { const n = parseNum(x.text); if (n != null) nums.push(n); }
      return { this: nums[0] ?? 0, last: nums[1] ?? 0 };
    };
    if (/^aware\s+customers/i.test(t)) {
      c.aware_customers = grabPair(); found = true;
    } else if (/^new\s+customers/i.test(t)) {
      c.new_customers = grabPair(); found = true;
    } else if (/^potential\s+new\s+customers/i.test(t)) {
      c.potential_new_customers = grabPair(); found = true;
    } else if (/^converted\s+customers/i.test(t)) {
      c.converted_customers = grabPair(); found = true;
    } else if (/^crm\s+messages\s+sent/i.test(t)) {
      // Two trailing string cells
      const tails = cells.slice(1).map(x => x.text.trim()).filter(Boolean);
      c.crm_messages_sent_this = tails[0] ?? '';
      c.crm_messages_sent_last = tails[1] ?? '';
      found = true;
    }
  }
  return found ? c : null;
}

// ----------------------------------------------------------------------------
// rich-text section → HTML

function parseRichTextLines(lines: Line[]): string {
  const items: { level: number; text: string }[] = [];
  let pending: string | null = null;
  let level = 0;
  const flush = () => {
    if (pending && pending.trim()) items.push({ level, text: pending.trim() });
    pending = null;
  };
  for (const l of lines) {
    const t = l.text.trim();
    if (!t) continue;
    if (/^[●•]\s*/.test(t))      { flush(); level = 0; pending = t.replace(/^[●•]\s*/, ''); continue; }
    if (/^[○◦]\s*/.test(t))      { flush(); level = 1; pending = t.replace(/^[○◦]\s*/, ''); continue; }
    if (/^([a-z]|\d+|[ivx]+)\.\s+/i.test(t)) {
      flush(); level = 1; pending = t.replace(/^([a-z]|\d+|[ivx]+)\.\s+/i, ''); continue;
    }
    if (pending != null) pending += ' ' + t;
    else { level = 0; pending = t; }
  }
  flush();
  if (items.length === 0) return '';
  // Build HTML — top-level <p> for non-bullets, <ul> if bullets present
  const hasBullets = items.length > 1 || items.some(i => i.level === 1);
  if (!hasBullets && items.length === 1) {
    return `<p>${escapeHtml(items[0].text)}</p>`;
  }
  let html = '';
  let i = 0;
  while (i < items.length) {
    if (items[i].level === 0) {
      html += `<li>${escapeHtml(items[i].text)}`;
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
      html += `<li>${escapeHtml(items[i].text)}</li>`;
      i++;
    }
  }
  return `<ul>${html}</ul>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseNum(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length === 0 || s === '—' || s === '-') return null;
  if (/^not\s*started$/i.test(s) || /^not\s*yet/i.test(s)) return null;
  if (/^not\s+yet\s+eligible$/i.test(s)) return null;
  const cleaned = s.replace(/[↑↗↙↓→←]/g, '').replace(/[$,]/g, '').replace(/%/g, '').trim();
  if (cleaned.length === 0) return null;
  const m = cleaned.match(/-?(\d+(?:\.\d+)?)\s*([KkMmBb])?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = m[2]?.toUpperCase();
  if (suf === 'K') n *= 1_000;
  else if (suf === 'M') n *= 1_000_000;
  else if (suf === 'B') n *= 1_000_000_000;
  if (s.startsWith('-')) n = -Math.abs(n);
  return n;
}
