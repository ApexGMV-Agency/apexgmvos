// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef, useDeferredValue, useTransition } from 'react';
import { createPortal } from 'react-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, PieChart, Pie, Cell, LabelList,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { fnError } from '../../lib/functionError';
import { uploadSignature, svgToPngDataUrl } from '../../lib/imageUpload';
import { useSignaturePad } from '../../lib/signaturePad';
import { currencySymbol, setReportCurrency } from '../../lib/currency';
import * as store from './store';
import { useAuth } from '../../auth/AuthContext';
import { normalizeDrafts, latestDraft, canAddDraft, slotDraftState, pendingDraftCount, draftLabel, draftRejectMessage, draftApproveMessage, DRAFT_STATUS_META } from './videoDrafts';
import { PayoutChipsRO, PayoutDetail, BrandAva, CreatorPanelShell, isInternalOnlyStatus, videoAddedLabel, videoAddedTitle, gmvSum, gmvByMonth, dealCodes, extraCodes, deliveredCount, extraVideoCount } from '../paid-collab/handlerCollabReadonly';
import { creatorPayouts, payoutKindOf, PAYOUT_SUGGESTIONS } from '../../lib/creatorPayouts';
import TableExportModal from '../../components/export/TableExportModal';
import {
  CDB_EXPORT_COLUMNS, CDB_EXPORT_SHEET, CDB_EXPORT_SLUG, CDB_EXPORT_STORE,
} from '../../lib/creatorDbExport';
import {
  BRAND_EXPORT_COLUMNS, BRAND_EXPORT_SHEET, BRAND_EXPORT_SLUG, BRAND_EXPORT_STORE,
} from '../../lib/brandMonthExport';
import { CREATOR_SORTS, CREATOR_SORT_DEFAULT, isCreatorSort, creatorSortCmp } from './creatorSort';
import { showToast as toast } from '../../lib/copyToast';
import BrandResourcesMenu from './BrandResourcesMenu';
import { ALL_MONTHS, BRAND_DATA_COLUMNS, BRAND_DATA_STORE, brandDataMonths, buildBrandDataRows, expandBrandDataColumns, sortBrandDataRows, brandDataSummary, BRAND_DATA_SORTS, BRAND_DATA_SORT_DEFAULT, BRAND_DATA_SORT_STORE, isBrandDataSort } from './brandDataExport';
import BestVideosBoard from '../../components/BestVideosBoard';
import CreatorImportModal from './CreatorImportModal';
import CreatorDbShareModal from './CreatorDbShareModal';
import MessageTemplates from './MessageTemplates';
// Product identity used to match a focus product across months (paused state).
const stockKey = (name, url) => String((name || '').trim() || (url || '').trim()).toLowerCase();
import PaidCollabComments from '../../components/paidcollab/PaidCollabComments';
import SearchSelect from './SearchSelect';
import NotesBoard, { BrandNotesDrawer, CreatorNotesDrawer, AllNotesDrawer, NoteEditor } from './NotesBoard';
import ContractDoc from './ContractDoc';
import { buildContractModel, blocksToText, CONTRACT_TOKENS } from './contractPdf';
import { useDraggableFab } from '../../components/useDraggableFab';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './handlerCollab.css';
import { downloadCsv } from '../../lib/csv';
import { DateField, MonthField } from '../../components/ThemedPicker';

const storeMode = 'supabase';

/* Workspace tabs. Module-level so the array identity is stable and the labels
   are readable from the loading panel ("Opening Creators Database…") without
   duplicating the wording at the call site. The SOLO pages below are not tabs.

   ‼️ Content Brief is NOT here. It was a tab until 2026-09-01 and is now a
   SIDEBAR link to /content-brief — the same <ContentBriefView> the rest of the
   team already used, so a handler and an APC now open one page rather than two
   surfaces onto one document. It needs nothing this shell holds (the page
   fetches its own RLS-scoped brands), which is why it became a standalone
   route rather than a solo tab the way Notes did. */
const TAB_DEFS = [
  { id: 'brands', label: 'Brands' },
  // 'Active Creators' — the deals being worked, as against the whole archive
  // in Creators Database. The id stays 'creators': it keys state, not copy.
  { id: 'creators', label: 'Active Creators' },
  { id: 'database', label: 'Creators Database' },
  { id: 'performance', label: 'Performance' },
  { id: 'discussions', label: 'Discussions' },
  { id: 'logs', label: 'Logs' },
  { id: 'best', label: 'Best Videos' },
  // The shared library of messages the team sends over and over. Last in the
  // strip because it is reference material you go and fetch, not a surface the
  // day's work happens on.
  { id: 'templates', label: 'Templates' },
];
/* The SOLO pages are not in TAB_DEFS: each is a sidebar route of its own rather
   than a workspace tab (see soloTab). They still ride the same `tab` state, so
   they inherit the deferred switch + skeleton — the Dashboard is chart-heavy
   and Client Reports loads every report of every brand. Their labels live here
   so the skeleton can still name what it is opening, on the first load as well
   as on a tab switch. */
const SOLO_TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  // Notes was a workspace tab until 2026-08-30; it is a sidebar page now. Kept
  // on the workspace shell rather than made a standalone page (as /my-notes is)
  // because the board wants `creators` for creator-linked notes, which is data
  // this shell already holds — a standalone copy would have to re-fetch it.
  { id: 'notes', label: 'Notes' },
];
const TAB_LABELS = Object.fromEntries([...SOLO_TABS, ...TAB_DEFS].map(t => [t.id, t.label]));

/* ── MEMOISED TAB BODIES ──
   Every tab body in this file (BrandLevel, Drilldown, CreatorsView,
   CreatorDatabaseView, PerformanceView, ReportingView, DiscussionsView,
   LogsView) is wrapped in React.memo. They render hundreds of rows, and without
   it every unrelated state change in Dashboard — opening or closing the creator
   modal, the undo toast, the 22-second background refresh — re-rendered the
   whole table underneath, which is what made those actions feel slow.
   ‼️ That only holds while their props keep their identity: the callbacks are
   useCallback'd and the lists useMemo'd in Dashboard (see "Stable handlers for
   the memoised tab bodies"), and `keepIfSame` stops an unchanged refresh from
   handing them fresh arrays. An inline arrow prop at any of those call sites
   silently switches the memo off again. */

/* Shown while a tab's body is still being built (and on the first workspace
   load). A skeleton rather than a bare spinner: the page keeps its height, so
   the switch doesn't collapse the layout and bounce the scroll position. */
function TabLoading({ label = 'Loading…', rows = 6 }) {
  return (
    <div className="pc-tabload" role="status" aria-live="polite">
      <div className="pc-tabload-head">
        <span className="pc-tabload-spin" aria-hidden="true" />
        <span className="pc-tabload-label">{label}</span>
      </div>
      <div className="pc-tabload-rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => <div className="pc-tabload-row" key={i} />)}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   PAID COLLABORATIONS — standalone CRUD dashboard (/collabs)
   Its OWN project: own Supabase (or localStorage), own tables.
   Fully isolated from the creatorsxbrands app.
════════════════════════════════════════════════════════════ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)',
  'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)',
  'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
];

/* ── helpers ── */
// Whole-number money in the active currency. Single-brand views set the symbol
// once per render via setReportCurrency(brand.currency); multi-brand views set
// the "uniform" currency (or pass an explicit `code`). See lib/currency.ts.
// Negative money reads "-$40", never "$-40" (the sign belongs outside the symbol).
function fmt$(n, code) {
  const v = Math.round(n || 0);
  return `${v < 0 ? '-' : ''}${currencySymbol(code)}${Math.abs(v).toLocaleString()}`;
}
function fmtNum(n) { return Math.round(n || 0).toLocaleString(); }
// The shared currency for a set of brands: their common one if uniform, else USD
// (mixing region currencies in one total is meaningless, so fall back to $).
function uniformCurrency(brands) {
  const codes = new Set((brands || []).map(b => (b && b.currency) || 'USD'));
  return codes.size === 1 ? [...codes][0] : 'USD';
}
function getGradient(name) {
  if (!name) return AVATAR_GRADIENTS[0];
  return AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length];
}
function initial(name) { const s = (name || '').trim(); return s ? s[0].toUpperCase() : '?'; }
function tiktokHandle(raw) {
  if (!raw) return '';
  const t = String(raw).trim().replace(/\/$/, '');
  if (t.startsWith('http')) { const last = t.split('/').pop() || ''; return last.startsWith('@') ? last : `@${last}`; }
  return t.startsWith('@') ? t : `@${t}`;
}
function tiktokUrl(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (t.startsWith('http')) return t;
  return `https://www.tiktok.com/${tiktokHandle(t)}`;
}
// Turn a PayPal payout value into an openable link when it's a link/paypal.me
// (a full URL, a www./paypal.me/ form). Plain emails stay as text (return null).
function paypalUrl(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.|paypal\.me\/|paypal\.com\/)/i.test(t)) return `https://${t.replace(/^\/+/, '')}`;
  return null;
}
function monthKey(dateStr) { return dateStr ? String(dateStr).slice(0, 7) : ''; }
function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  return `${MONTHS[parseInt(m, 10) - 1] || '?'} ${y}`;
}
function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function addMonth(key, delta) {
  let [y, m] = key.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function monthRange(start, end) {
  if (!start) return [];
  if (!end || start > end) return [start];
  const out = []; let m = start, g = 0;
  while (m <= end && g++ < 240) { out.push(m); m = addMonth(m, 1); }
  return out;
}
function monthShort(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  return `${MONTHS[parseInt(m, 10) - 1] || '?'} '${String(y).slice(2)}`;
}

/* ── week date helpers (all YYYY-MM-DD strings, local-time) ── */
function isoDate(x) {
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function addDaysISO(key, n) { const d = new Date(key + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
// Compact range for a header: "Jun 9–15" (same month) or "Jun 29 – Jul 5".
function rangeShort(startISO, endISO) {
  const s = new Date(startISO + 'T00:00:00'), e = new Date(endISO + 'T00:00:00');
  const sMon = s.toLocaleDateString('en-US', { month: 'short' });
  const eMon = e.toLocaleDateString('en-US', { month: 'short' });
  return sMon === eMon ? `${sMon} ${s.getDate()}–${e.getDate()}` : `${sMon} ${s.getDate()} – ${eMon} ${e.getDate()}`;
}
// Full range for the tooltip: "Jun 9 – Jun 15".
function rangeLong(startISO, endISO) {
  const f = (k) => new Date(k + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(startISO)} – ${f(endISO)}`;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function defaultDateForMonth(mKey) {
  return mKey === thisMonthKey() ? todayISO() : `${mKey}-15`;
}
/* A 'YYYY-MM-DD' column is a calendar date, so parse it by PARTS: new Date on
   that string is read as UTC and renders as the day before east of it. fmtDate
   above carries that trap and is left alone — it is fed timestamps as well. */
function fmtDayLocal(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}
/* The same calendar-date parse WITHOUT the year, for the brand row's sub-line:
   there the date is context beside a creator count, and the month it is filed
   under is already on screen, so the year only lengthens the line. The chip on
   the drilldown keeps the full date — it is a statement on its own. */
function fmtDayShortLocal(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return String(iso || '');
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}
// Status flow: starts at "Follow-up Required" (zero posted videos) → auto "Videos in
// Progress" when the first video lands → back to "Follow-up Required" if no new video
// for 1 week (server sweep) → auto "Payment Pending" once all videos are added →
// user marks "Paid" from the inline dropdown after sending payment. The zero-video /
// first-video / stall rules live in the DB (trigger + handler_collab_apply_follow_ups).
// "Awaiting Confirmation" (deal not confirmed yet) and "Terminated" (cancelled
// deal) are manual, INTERNAL-ONLY states: never auto-touched, only the handler
// sets them here, hidden from every client-facing / read-only surface (client
// portal, Brand Detail view mode, share link), and excluded from budget maths
// — see INTERNAL_ONLY_STATUSES in handlerCollabReadonly.
// Dropdown order — "Awaiting Confirmation" leads because that is where every
// new deal starts (see store.addCreator), so it is the state handlers move OUT
// of most often.
const STATUS_OPTIONS = [
  { value: 'awaiting_confirmation', label: 'Awaiting Confirmation', cls: 'awaiting' },
  { value: 'videos_in_progress', label: 'Videos in Progress', cls: 'progress' },
  { value: 'follow_up', label: 'Follow-up Required', cls: 'followup' },
  { value: 'pending', label: 'Payment Pending', cls: 'pending' },
  { value: 'paid', label: 'Payment Sent', cls: 'sent' },
  { value: 'terminated', label: 'Terminated', cls: 'terminated' },
];
const DEFAULT_STATUS = 'videos_in_progress';
// Fallback is pinned to DEFAULT_STATUS, not STATUS_OPTIONS[0] — reordering the
// dropdown must not change how a row with an unknown/blank status renders.
const DEFAULT_STATUS_OPTION = STATUS_OPTIONS.find(s => s.value === DEFAULT_STATUS);
function deriveStatus(c) {
  return STATUS_OPTIONS.find(s => s.value === c.payment_status) || DEFAULT_STATUS_OPTION;
}
// Drilldown groups creators by payment status in this top→bottom order.
const STATUS_GROUP_ORDER = ['pending', 'follow_up', 'videos_in_progress', 'paid', 'awaiting_confirmation', 'terminated'];

/* Creator ordering lives in ./creatorSort (pure, unit-checked). The picker only
   orders creators INSIDE the groups these lists already show — status groups in
   the drilldown, month blocks in the Creators tab. */
/* Remembered per list, so a handler picks their order once rather than on every
   brand they open. An unknown stored value falls back to the default. */
function useCreatorSort(storageKey) {
  const [sort, setSort] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return isCreatorSort(v) ? v : CREATOR_SORT_DEFAULT;
    } catch { return CREATOR_SORT_DEFAULT; }
  });
  const set = useCallback((v) => {
    setSort(v);
    try { localStorage.setItem(storageKey, v); } catch { /* private mode — the sort just won't persist */ }
  }, [storageKey]);
  return [sort, set];
}
function CreatorSortMenu({ value, onChange, title = 'Sort creators' }) {
  // Show the ACTIVE option, not the word "Sort" — otherwise the only way to
  // know how a list is ordered is to open the menu.
  const active = CREATOR_SORTS.find(s => s.value === value) || CREATOR_SORTS[0];
  return (
    <label className="pc-sortmenu" title={title}>
      <i className="bi bi-sort-down" aria-hidden="true" />
      <span className="pc-sortmenu-label">{active.label}</span>
      <select className="pc-sortmenu-sel" value={value} onChange={e => onChange(e.target.value)} aria-label={title}>
        {CREATOR_SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <i className="bi bi-chevron-down pc-sortmenu-caret" aria-hidden="true" />
    </label>
  );
}
function focusProductList(bm) {
  const raw = bm?.focus_product_url || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    // `paused` (handler's per-product pause, set from the drilldown chip menu)
    // rides along only when set, so an untouched list round-trips unchanged.
    if (Array.isArray(parsed)) return parsed.map(p => (typeof p === 'string' ? { name: '', url: p } : { name: p.name || '', url: p.url || '', ...(p.paused ? { paused: true } : {}) })).filter(p => p.url || p.name);
  } catch { }
  // legacy: newline-separated URLs (before product names were added)
  return raw.split(/\n+/).map(s => s.trim()).filter(Boolean).map(url => ({ name: '', url }));
}
/* A commission box's raw text → the number to store. Blank is null ("not
   stated"), which is deliberately NOT the same as a typed 0 ("zero percent");
   anything unparseable comes back NaN so the form can refuse to save rather
   than quietly storing a rate nobody typed. */
function pctValue(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
const badPct = v => v !== null && !(Number.isFinite(v) && v >= 0 && v <= 100);
/* 20 → "20%", 12.5 → "12.5%" — no trailing ".0" on the whole numbers most rates are. */
function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${Number(n.toFixed(2))}%`;
}

function creatorProducts(c) {
  let raw = c?.products;
  if (!raw) return [];
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return raw.trim() ? [{ name: raw.trim(), url: '' }] : []; } }
  if (!Array.isArray(raw)) return [];
  return raw.map(p => (typeof p === 'string' ? { name: p, url: '' } : { name: p.name || '', url: p.url || '' })).filter(p => p.name || p.url);
}
const prodKey = p => (p.name || p.url || '').toLowerCase().trim();
function tiktokAccounts(raw) {
  if (!raw) return [];
  return String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(h => ({ handle: tiktokHandle(h), url: tiktokUrl(h) }));
}
const isValidUrl = s => !!s && (s.startsWith('http://') || s.startsWith('https://'));
const isValidAdCode = s => !s || (s.startsWith('#') && s.endsWith('='));

/* ── Video link / ad code uniqueness ──
   The same post or ad code must never sit on two rows, or on two creators.
   A video URL is normalised first (case, tracking query, trailing slash) so the
   same TikTok post pasted from different places is still caught; ad codes are
   compared verbatim apart from surrounding whitespace (they are case-sensitive). */
function normVideoKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
}
function normAdKey(raw) { return String(raw || '').trim(); }
// One message per field per row ('' = fine). `findOwner(kind, key, selfId)` looks
// the value up across the other creators and returns a label, or null.
function videoDupMessages(rows, selfId, findOwner) {
  const out = rows.map(() => ({ video: '', adCode: '' }));
  const seenV = new Map();
  const seenA = new Map();
  rows.forEach((row, i) => {
    const v = normVideoKey(row.video);
    if (v) {
      if (seenV.has(v)) {
        const first = seenV.get(v);
        out[i].video = `Same video link as row ${first + 1}`;
        if (!out[first].video) out[first].video = `Same video link as row ${i + 1}`;
      } else seenV.set(v, i);
    }
    const a = normAdKey(row.adCode);
    if (a) {
      if (seenA.has(a)) {
        const first = seenA.get(a);
        out[i].adCode = `Same ad code as row ${first + 1}`;
        if (!out[first].adCode) out[first].adCode = `Same ad code as row ${i + 1}`;
      } else seenA.set(a, i);
    }
  });
  if (findOwner) {
    rows.forEach((row, i) => {
      if (!out[i].video) {
        const o = findOwner('video', normVideoKey(row.video), selfId);
        if (o) out[i].video = `This video link is already on ${o}`;
      }
      if (!out[i].adCode) {
        const o = findOwner('ad', normAdKey(row.adCode), selfId);
        if (o) out[i].adCode = `This ad code is already on ${o}`;
      }
    });
  }
  return out;
}
const hasVideoDup = msgs => msgs.some(m => m.video || m.adCode);

/* ── View-only mode ──
   EVERY Bob (Super Boss included) sees this workspace read-only: the paid-collab
   data belongs to the handlers, Bob is here to oversee it. Oversight surfaces
   stay fully usable — Notes, Discussions, Logs, the Dashboard, AI Content
   Brief — as does every read action (contract PDFs, exports, copy
   buttons, the Resources dropdown). Only the affordances that WRITE paid-collab
   data are withdrawn.

   Front-end only, deliberately: Bob keeps his DB grants (writes_paid_collab_brand
   includes is_bob()), which the Brand Detail → Paid Collab tab still relies on
   for the Performance matrix and the video Authorise / Invalid verdicts. */
/* ‼️ EXPORTED for the PUBLIC Creators Database page (SharedCreatorDb), which
   provides it as `true`. Every write control in the database table and its
   detail popup is already gated on `!ro`, so the provider is what makes the
   shared page read-only — rather than a second set of `publicView &&` tests
   that a new button could be added without. */
export const ReadOnlyCtx = React.createContext(false);
const useRO = () => React.useContext(ReadOnlyCtx);

/* Starring a video happens deep in the creator rows; the Best Videos tab lives
   at the top. This lets the star say "I changed something" without threading a
   callback through Drilldown → CreatorRow → CreatorExpand. */
const BestBumpCtx = React.createContext(() => {});
const useBestBump = () => React.useContext(BestBumpCtx);

function scrollTop() { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { } }

/* A refresh hands back brand-new arrays every time, so `setState(fresh)` changed
   the identity of every list on every poll — which recomputed every memo and
   re-rendered every table roughly three times a minute, whether or not a single
   byte had changed. Compare first and KEEP the existing object when the payload
   is identical: a stringify of a few hundred rows is far cheaper than the render
   it avoids. Used as `setX(prev => keepIfSame(prev, next))`, so it never fires a
   render at all when React sees the same reference back. */
/* Workspace refresh scopes (see reload() in the Dashboard). A load request is
   { core, extras, notes, sweep }; two requests merge by OR, which is what lets
   a burst of refreshes collapse into one. */
const SWEEP_EVERY_MS = 5 * 60 * 1000; // follow-up sweep: the rule is a week, a few minutes is plenty
const POLL_MS = 22000;                // poll when realtime is NOT connected
const POLL_LIVE_MS = 90000;           // poll for what realtime does not carry
// After a local save: only the rows a save can change, and never the sweep.
const AFTER_SAVE = { core: true, extras: false, notes: false, sweep: false };
function loadParts(opts) {
  if (opts === 'core') return { core: true, extras: false, notes: false, sweep: true };
  if (opts === 'notes') return { core: false, extras: false, notes: true, sweep: false };
  if (opts && typeof opts === 'object' && 'core' in opts) return opts;
  const sweep = !(opts && typeof opts === 'object' && opts.sweep === false);
  return { core: true, extras: true, notes: true, sweep };
}
function mergeLoadParts(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { core: a.core || b.core, extras: a.extras || b.extras, notes: a.notes || b.notes, sweep: a.sweep || b.sweep };
}

function keepIfSame(prev, next) {
  if (prev === next) return prev;
  if (next == null) return prev;
  try { return JSON.stringify(prev) === JSON.stringify(next) ? prev : next; }
  catch { return next; }   // circular / unserialisable — take the fresh copy
}
function copyText(t) {
  try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t); return; } } catch { }
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch { }
}

/* ════════════════════════════════════════════════════════════
   Root + optional passcode gate
════════════════════════════════════════════════════════════ */
// initialBrandId / initialMonth deep-link the workspace straight into a program's
// (brand + month) editable drilldown — used by the handler's Programs → program route.
// soloTab renders the SAME shell with the tab strip withdrawn and ONE tab as the
// body — that is how a workspace tab also becomes a sidebar page ('dashboard' →
// the Dashboard, 'clientreports' → Client Reports). A mode of this component
// rather than a page of its own, so those pages read the very same brands /
// creators / comments the workspace does, loaded by the same code.
export default function HandlerCollabApp({ initialBrandId = null, initialMonth = null, soloTab = null }: { initialBrandId?: string | null; initialMonth?: string | null; soloTab?: string | null } = {}) {
  useEffect(() => {
    document.title = 'Paid Collaborations';
    // Lock to light mode regardless of OS dark setting.
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    const prevBsTheme = root.getAttribute('data-bs-theme');
    const prevScheme = root.style.colorScheme;
    const prevBg = document.body.style.background;
    root.style.colorScheme = 'light';
    root.removeAttribute('data-theme');
    root.setAttribute('data-bs-theme', 'light');
    try { document.body.style.background = '#FAFAFA'; } catch { }
    // Leaving the workspace hands the rest of the app its own theme back.
    return () => {
      root.style.colorScheme = prevScheme;
      if (prevTheme) root.setAttribute('data-theme', prevTheme);
      if (prevBsTheme) root.setAttribute('data-bs-theme', prevBsTheme); else root.removeAttribute('data-bs-theme');
      try { document.body.style.background = prevBg; } catch { }
    };
  }, []);

  return <Dashboard initialBrandId={initialBrandId} initialMonth={initialMonth} soloTab={soloTab} />;
}

function PasscodeGate({ onUnlock }) {
  const [pw, setPw] = useState('');
  const [shake, setShake] = useState(false);
  function submit(e) {
    e.preventDefault();
    if (pw === COLLABS_PASSCODE) { onUnlock(); return; }
    setShake(true); setTimeout(() => setShake(false), 500);
  }
  return (
    <div className="pc-app">
      <div className="pc-login">
        <form className={`pc-login-card ${shake ? 'pc-shake' : ''}`} onSubmit={submit}>
          <div className="pc-login-logo">◎</div>
          <h2>Paid Collaborations</h2>
          <p>Enter passcode to continue</p>
          <input className="pc-input" type="password" placeholder="Passcode" value={pw}
            onChange={e => setPw(e.target.value)} autoFocus />
          <button className="pc-btn pc-btn-primary" type="submit">Unlock</button>
        </form>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Dashboard
════════════════════════════════════════════════════════════ */
function Dashboard({ initialBrandId = null, initialMonth = null, soloTab = null }) {
  const [brands, setBrands] = useState([]);
  const [brandMonths, setBrandMonths] = useState([]);
  const [creators, setCreators] = useState([]);
  const [clients, setClients] = useState([]);
  // Lightweight notes list (own Keep-style notes) — only used for the Notes tab's
  // due-reminder badge; the full board manages its own copy in NotesBoard.
  const [notes, setNotes] = useState([]);
  // Contract signing links (one per creator deal) — drives the Contract column's
  // signing-link button state (none / active / deactivated / signed).
  const [contractLinks, setContractLinks] = useState([]);
  // Creators Database — manually banked creator credentials (creator_directory),
  // shared across every handler + Bob. Merged with the deal-derived creators in
  // the "Creators Database" tab; see buildCreatorDatabase().
  const [directory, setDirectory] = useState([]);
  const [dirEditor, setDirEditor] = useState(null);  // { mode:'add'|'edit', entry? }
  const [importOpen, setImportOpen] = useState(false);
  const [dirDelete, setDirDelete] = useState(null);   // the entry a typed confirm is open for
  const [programAdd, setProgramAdd] = useState(null); // merged database entry being onboarded
  /* The "?" on a creator row — in the Active Creators tab AND in a brand's
     program drilldown — opens that person's FULL record, the same popup the
     Creators Database uses. Held as an identity KEY rather than the entry
     itself so a background refresh re-reads the live merge instead of leaving
     a stale snapshot on screen; the deal row a click came from is only ever
     one month of the person the popup describes. */
  const [infoKey, setInfoKey] = useState(null);
  /* Public links to the Creators Database. Open to everyone who may use the
     database (a handler copies a link that exists); the CONTROLS inside are
     Bob's, which is also what RLS says. */
  const [shareOpen, setShareOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const { user, profile } = useAuth();
  // Bob oversees paid collab, he doesn't run it — every Bob (Super Boss included)
  // gets this workspace read-only (see ReadOnlyCtx). Handlers are unaffected.
  const readOnly = profile?.role === 'bob';
  // Client Reports (§13 of the weekly/monthly reports) belongs to whoever ran
  // the program, so EVERY paid-collab handler gets it — internal or external.
  // set_report_paid_collab(), the monthly read/insert policies and the
  // originals read all pivot on paid_collab_handler_has_brand (migration
  // 20260874090000), which asks only "assigned to this brand".
  // Bob sees it read-only, like the rest of his workspace.

  const [month, setMonth] = useState(initialMonth || thisMonthKey());
  const [tab, setTab] = useState(soloTab || 'brands'); // dashboard | brands | creators | …
  /* ‼️ Both solo routes render THIS component, so React Router reconciles them
     as one element and only the prop changes — no remount, and the line above
     runs once. Without this, walking from Dashboard to Client Reports changed
     the URL and left the old page on screen. Deliberately a sync rather than a
     `key` on the routes: a remount would re-run the whole workspace load
     (loadAll plus nine queries) every time you switch between two pages that
     read the very same data. */
  useEffect(() => { if (soloTab) setTab(soloTab); }, [soloTab]);
  // Client Reporting is themed and headed differently from the rest of the
  // workspace - see the .pc-app-brand block in handlerCollab.css.
  // Notes as a sidebar page — no workspace header (see the render below).
  const notesPage = soloTab === 'notes';
  /* Tab switching used to feel frozen: the click set `tab`, React then rendered
     the incoming tab's whole table synchronously, and only THEN painted — so the
     tab you pressed stayed unhighlighted for as long as the render took.
     `tab` is urgent (the highlight + the loading panel paint immediately) while
     the heavy body renders from the DEFERRED copy, which React builds in an
     interruptible background pass. While the two disagree we are mid-switch. */
  const deferredTab = useDeferredValue(tab);
  const tabSwitching = tab !== deferredTab;
  const openTab = useCallback((id) => { setTab(id); setDrillId(null); }, []);
  // Per-brand weekly-report weeks (brand_id -> [{ start, end }]). The weekly
  // Performance view shows exactly these weeks as columns.
  const [reportWeeks, setReportWeeks] = useState({});
  // Per-brand weekly anchor (brand_id -> week-1 start date) for the "create next
  // weekly report" flow.
  const [reportAnchors, setReportAnchors] = useState({});
  // Paid-collab comments + the discussion drawer ({brandId, tt, tk, highlight}|null).
  const [comments, setComments] = useState([]);
  const [commentDrawer, setCommentDrawer] = useState(null);
  // Activity log (Logs tab) — brand-scoped audit rows (status changes, payments,
  // client confirmations, creator add/remove) shared by every handler of the brand.
  const [logs, setLogs] = useState([]);

  // Custom brand ordering (drag-and-drop), persisted per handler in the database
  // (handler_collab_brand_order) so it follows the account across devices. It's a saved
  // sequence of brand ids; the brand list sorts by it (unordered fall to the bottom in the
  // default order). Reordering merges the moved subset back, keeping brands not currently
  // visible in their existing slots. Loaded in reload().
  const [brandOrder, setBrandOrder] = useState([]);
  const reorderBrands = useCallback((newVisibleIds) => {
    setBrandOrder(prev => {
      const visible = new Set(newVisibleIds);
      const base = prev.slice();
      newVisibleIds.forEach(id => { if (!base.includes(id)) base.push(id); });
      let i = 0;
      const merged = base.map(id => (visible.has(id) ? newVisibleIds[i++] : id));
      if (user?.id) store.saveBrandOrder(user.id, merged).catch(e => console.warn('Save brand order failed', e));
      return merged;
    });
  }, [user]);
  const [drillId, setDrillId] = useState(initialBrandId || null);
  const [search, setSearch] = useState('');
  const [brandEditor, setBrandEditor] = useState(null);   // { mode:'add'|'edit', brand? }
  const [creatorEditor, setCreatorEditor] = useState(null); // { mode, brandId, creator? }
  const [notesBrand, setNotesBrand] = useState(null);     // { id, name } — quick month note drawer
  const [keepBrand, setKeepBrand] = useState(null);       // { id, name } — Keep-notes list drawer
  const [keepCreator, setKeepCreator] = useState(null);   // { id, key, name, handle, brandId, brandName } — creator Keep-notes drawer
  const [allNotesOpen, setAllNotesOpen] = useState(false); // global notes drawer (floating button)
  const notesFabDrag = useDraggableFab('ac_fab_pos_notes'); // drag-to-place the floating notes button
  const [openNote, setOpenNote] = useState(null);          // a single note opened directly (deep link)
  const [pendingNoteId, setPendingNoteId] = useState(null); // ?note=<id> waiting for notes to load
  const [confirmDel, setConfirmDel] = useState(null);     // { message, onYes }
  const [undo, setUndo] = useState(null);                 // { label, restore, commit }
  const undoRef = useRef(null);
  const undoTimer = useRef(null);

  // auto-heal: fill missing shared info (phone/email/category/etc.) across same-named creators
  const reconcileShared = useCallback(async (list) => {
    if (readOnly) return;   // view-only: merely opening the workspace must write nothing
    const FIELDS = ['phone', 'email', 'category', 'paypal', 'zelle', 'tiktok_handle'];
    const byName = {};
    list.forEach(c => { const k = (c.name || '').trim().toLowerCase(); if (!k) return; (byName[k] = byName[k] || []).push(c); });
    const updates = [];
    Object.values(byName).forEach(group => {
      if (group.length < 2) return;
      const merged = {};
      FIELDS.forEach(f => { const v = group.map(c => c[f]).find(x => x && String(x).trim()); if (v) merged[f] = v; });
      group.forEach(c => {
        const patch = {};
        FIELDS.forEach(f => { if (merged[f] && !(c[f] && String(c[f]).trim())) patch[f] = merged[f]; });
        if (Object.keys(patch).length) updates.push({ id: c.id, patch });
      });
    });
    if (!updates.length) return;
    setCreators(prev => prev.map(c => { const u = updates.find(x => x.id === c.id); return u ? { ...c, ...u.patch } : c; }));
    // In parallel — these are independent single-row updates, and running them
    // one after another used to add a round trip per duplicated creator.
    await Promise.all(updates.map(u => store.updateCreator(u.id, u.patch).catch(() => { })));
  }, [readOnly]);

  /* ── Workspace refresh ──
     A full refresh used to be ~13 requests (the follow-up sweep RPC, brands,
     months + creators, then nine more) in four waves, and FOUR things fired it:
     the 22s poll, every realtime event, every save, and the note-reminder tick.
     A save produced two back-to-back bursts (its own reload + the realtime echo
     of the same write 350ms later), nothing stopped bursts overlapping, and an
     older response could land after a newer one. Now:
     · reload(scope) asks for a PART of the data — 'core' (brands, months,
       creators, activity log), 'notes', or everything ('all', the default);
     · calls are SINGLE-FLIGHT: while one load runs, further requests MERGE
       into one queued load, so a burst of pings costs one extra round, never N,
       and responses can never land out of order;
     · the sweep RPC (a write, whose threshold is a WEEK) runs at most every
       SWEEP_EVERY_MS instead of on every refresh;
     · requests that do not need the brand ids start immediately, and the rest
       start the moment the brand list lands. */
  // writeGen: bumped by every local creator write (patchCreatorLocal). A load
  // whose fetch straddled a write is holding rows from BEFORE it, so its creators
  // are discarded and re-fetched — applying them put the old video links back
  // and the video editor re-synced to them, i.e. a just-typed link went blank.
  const loadRef = useRef({ running: null, queued: null, lastSweep: 0, lastFull: 0, writeGen: 0 });
  const doLoad = useCallback(async (p) => {
    const s = loadRef.current;
    const isBob = profile?.role === 'bob';
    const sweep = p.sweep && Date.now() - s.lastSweep > SWEEP_EVERY_MS;
    const gen = s.writeGen;
    try {
      // Independent of the brand list — start at once.
      const idFree = Promise.all([
        p.extras ? store.getClients().catch(() => null) : null,
        // Saved drag order (per handler, cross-device). Keep current order on a fetch error.
        p.extras ? store.loadBrandOrder().catch(() => null) : null,
        // Creators Database — not brand-scoped (company-wide list). Best-effort so
        // an unapplied migration can't take the whole workspace down.
        p.extras ? store.loadDirectoryCreators().catch(() => null) : null,
        // loadVisibleNotes (own + shared), not loadNotes — the unfiltered read
        // would hand Bob every user's notes and inflate the reminder badge.
        p.notes ? store.loadVisibleNotes().catch(() => null) : null,
      ]);
      let byIds = null;
      if (p.core || p.extras) {
        // Apply the follow-up status rules before reading creators.
        if (sweep) { s.lastSweep = Date.now(); await store.applyFollowUps(); }
        // Bob opens the same workspace with company-wide brand access, so his list
        // is narrowed to the brands carrying the "Paid Collabs" scope. A handler's
        // own list is already RLS-scoped to their assignments.
        const brandList = await store.loadBrands({ paidCollabScopeOnly: isBob });
        const ids = brandList.map(b => b.id);
        const [rows, lg, rw, an, cm, cl] = await Promise.all([
          p.core ? store.loadBrandRows(ids) : null,
          p.core ? store.loadActivityLogs(ids).catch(() => null) : null,
          // Per-brand weekly-report weeks + anchors (weekly Performance view). Best-effort.
          p.extras ? store.loadBrandReportWeeks(ids).catch(() => null) : null,
          p.extras ? store.loadBrandReportAnchors(ids).catch(() => null) : null,
          p.extras ? store.loadComments(ids).catch(() => null) : null,
          p.extras ? store.loadContractLinks(ids).catch(() => null) : null,
        ]);
        byIds = { brandList, rows, lg, rw, an, cm, cl };
      }
      const [allClients, order, dir, nts] = await idFree;
      // keepIfSame: an unchanged refresh must not re-render the workspace.
      if (byIds) {
        const { brandList, rows, lg, rw, an, cm, cl } = byIds;
        setBrands(prev => keepIfSame(prev, brandList));
        if (rows && s.writeGen !== gen) {
          // A creator was written while this fetch was out — its rows are stale.
          s.queued = mergeLoadParts(s.queued, loadParts(AFTER_SAVE));
        } else if (rows) {
          setBrandMonths(prev => keepIfSame(prev, rows.brandMonths));
          setCreators(prev => keepIfSame(prev, rows.creators));
          reconcileShared(rows.creators);
        }
        if (lg) setLogs(prev => keepIfSame(prev, lg));
        if (rw) setReportWeeks(prev => keepIfSame(prev, rw));
        if (an) setReportAnchors(prev => keepIfSame(prev, an));
        if (cm) setComments(prev => keepIfSame(prev, cm));
        if (cl) setContractLinks(prev => keepIfSame(prev, cl));
        setErr('');
      }
      if (allClients) setClients(prev => keepIfSame(prev, allClients));
      if (order) setBrandOrder(prev => keepIfSame(prev, order));
      if (dir) setDirectory(prev => keepIfSame(prev, dir));
      if (nts) setNotes(prev => keepIfSame(prev, nts));
      if (p.core && p.extras && p.notes) s.lastFull = Date.now();
    } catch (e) {
      setErr(e.message || 'Failed to load');
    }
  }, [reconcileShared, profile?.role]);

  // reload(): everything. reload('core' | 'notes'): that part only.
  // reload({ sweep: false }): everything, never the sweep RPC.
  const reload = useCallback((opts) => {
    const s = loadRef.current;
    s.queued = mergeLoadParts(s.queued, loadParts(opts));
    if (!s.running) {
      s.running = (async () => {
        try {
          while (s.queued) { const q = s.queued; s.queued = null; await doLoad(q); }
        } finally { s.running = null; }
      })();
    }
    return s.running;
  }, [doLoad]);
  const reloadNotes = useCallback(() => reload('notes'), [reload]);

  useEffect(() => { (async () => { setLoading(true); await reload(); setLoading(false); })(); }, [reload]);

  // Fire due note reminders workspace-wide (any tab): converts due reminders into
  // notifications (in-app + browser via NotificationsContext). Runs on load + every
  // minute (not while the tab is hidden); only the notes are re-read when something fired.
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      store.fireDueNoteReminders().then(c => { if (c > 0) reload('notes'); }).catch(() => { });
    };
    tick();
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, [reload]);

  /* lookups */
  const brandById = useMemo(() => { const m = {}; brands.forEach(b => { m[b.id] = b; }); return m; }, [brands]);
  const brandNameById = useMemo(() => { const m = {}; brands.forEach(b => { m[b.id] = b.name; }); return m; }, [brands]);
  const bmByKey = useMemo(() => { const m = {}; brandMonths.forEach(x => { m[`${x.brand_id}|${x.month}`] = x; }); return m; }, [brandMonths]);
  /* The brand's most recent EARLIER month that actually carries a setup, for the
     budget popup's "pull from last month" button. Deliberately the latest month
     with data rather than strictly month-1: a brand paused for a month still has
     a real previous setup, and offering an empty one would be a button that does
     nothing. `brandMonths` is loaded unfiltered by month, so this needs no fetch. */
  const prevSetupFor = useCallback((brandId) => {
    if (!brandId) return null;
    let best = null;
    for (const x of brandMonths) {
      if (x.brand_id !== brandId || !x.month || x.month >= month) continue;
      const has = Number(x.budget) > 0 || (x.content_guide_url || '').trim() || focusProductList(x).length > 0
        // `onboarded_on` is deliberately NOT counted: the pull does not copy it
        // (it says when THAT month began), so a month carrying only a date
        // would offer a button with nothing to fill in.
        || x.standard_commission != null || x.shop_ads_commission != null || x.approval_required;
      if (!has) continue;
      if (!best || x.month > best.month) best = x;
    }
    return best;
  }, [brandMonths, month]);
  // Due reminders (overdue, not dismissed/archived) → Notes tab badge.
  const dueReminderCount = useMemo(() => {
    const now = Date.now();
    return notes.filter(n => n.reminder_at && !n.reminder_done && !n.archived && new Date(n.reminder_at).getTime() <= now).length;
  }, [notes]);
  // Per-brand Keep-note counts (for the brand-row notes indicator).
  const noteCountByBrand = useMemo(() => {
    const m = {};
    notes.forEach(n => { if (n.brand_id && !n.archived) m[n.brand_id] = (m[n.brand_id] || 0) + 1; });
    return m;
  }, [notes]);
  // Per-creator Keep-note counts (for the journal icon next to a creator's name).
  // A note links ONE deal row, but the icon aggregates by creator identity within
  // the brand (store.creatorNoteKey), so notes follow the creator across months.
  const creatorNoteKeyById = useMemo(() => {
    const m = {};
    creators.forEach(c => { m[c.id] = store.creatorNoteKey(c); });
    return m;
  }, [creators]);
  const noteCountByCreatorKey = useMemo(() => {
    const m = {};
    notes.forEach(n => {
      if (n.archived || !n.creator_id) return;
      const k = creatorNoteKeyById[n.creator_id];
      if (k) m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [notes, creatorNoteKeyById]);
  const creatorNoteCount = useCallback(
    (c) => noteCountByCreatorKey[creatorNoteKeyById[c.id]] || 0,
    [noteCountByCreatorKey, creatorNoteKeyById]);
  const openCreatorNotes = useCallback((c) => setKeepCreator({
    id: c.id, key: creatorNoteKeyById[c.id] || store.creatorNoteKey(c),
    name: c.name, handle: tiktokAccounts(c.tiktok_handle)[0]?.handle || '',
    brandId: c.brand_id, brandName: brandById[c.brand_id]?.name || '',
  }), [creatorNoteKeyById, brandById]);

  // ── keep in sync with the database (teammates / other devices) ──
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = !!(brandEditor || creatorEditor || confirmDel); }, [brandEditor, creatorEditor, confirmDel]);
  // Realtime pushes creators / months / notes, so while the channel is live the
  // poll only has to catch what realtime does not carry (comments, contract
  // signatures, report weeks…) and runs far less often. A hidden tab polls
  // nothing and catches up the moment it is shown again.
  const liveRef = useRef(false);
  const hiddenQueueRef = useRef(null);
  useEffect(() => {
    if (storeMode !== 'supabase') return;
    const idle = () => !busyRef.current && !undoRef.current;
    const tick = () => {
      if (document.hidden || !idle()) return;
      const every = liveRef.current ? POLL_LIVE_MS : POLL_MS;
      if (Date.now() - loadRef.current.lastFull >= every) reload();
    };
    const iv = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.hidden || !idle()) return;
      const q = hiddenQueueRef.current; hiddenQueueRef.current = null;
      if (Date.now() - loadRef.current.lastFull >= POLL_MS) reload();
      else if (q) reload(q);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); };
  }, [reload]);

  // instant two-way sync via Supabase Realtime (external API edits, teammates, other
  // devices reflect here immediately). Each table refreshes only the part it can
  // change; pings are debounced, merged, and held while editing or hidden.
  useEffect(() => {
    if (storeMode !== 'supabase' || !supabase) return;
    let t = null;
    let pending = null;
    const ping = (scope) => () => {
      pending = mergeLoadParts(pending, loadParts(scope));
      clearTimeout(t);
      t = setTimeout(() => {
        const q = pending; pending = null;
        if (document.hidden) { hiddenQueueRef.current = mergeLoadParts(hiddenQueueRef.current, q); return; }
        if (busyRef.current || undoRef.current) return;
        reload(q);
      }, 350);
    };
    const ch = supabase
      .channel('pc-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_collab_creators' }, ping('core'))
      // A new assignment brings a new brand, which needs its weeks/comments too.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'paid_collab_handler_brands' }, ping('all'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_collab_brand_months' }, ping('core'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_notes' }, ping('notes'))
      .subscribe((status) => { liveRef.current = status === 'SUBSCRIBED'; });
    return () => { clearTimeout(t); liveRef.current = false; try { supabase.removeChannel(ch); } catch { } };
  }, [reload]);

  /* Every brand active in the selected month, in the handler's own order and
     BEFORE the search box narrows it. Kept separate so the export dialog can
     offer "everything" against "what the search left on screen" — and so a
     keystroke no longer re-runs the aggregation over every creator. */
  const brandRowsAll = useMemo(() => {
    const agg = {}; // brand_id -> metrics
    creators.forEach(c => {
      if (monthKey(c.onboarded_on) !== month) return;
      if (!agg[c.brand_id]) agg[c.brand_id] = { creators: 0, allocated: 0, paid: 0, pendingPay: 0, pendingCreators: 0, videos: 0, delivered: 0, present: 0, toReview: 0 };
      const a = agg[c.brand_id];
      // `present` counts every creator this month (incl. the internal-only
      // states) so a brand whose only activity was a cancelled or unconfirmed
      // deal still shows in past months.
      a.present += 1;
      // Draft videos waiting for the handler's decision — counted on every deal
      // the brand drilldown lists, internal-only states included.
      a.toReview += pendingDraftCount(c.video_codes);
      // Terminated (cancelled) and awaiting-confirmation (not committed yet)
      // deals are excluded from all budget/activity math — allocated, paid,
      // videos, delivered, creator count — while still listed below.
      if (isInternalOnlyStatus(c)) return;
      a.creators += 1;
      a.allocated += Number(c.amount) || 0;
      a.videos += parseInt(c.videos_count, 10) || 0;
      if (c.payment_status === 'paid') a.paid += Number(c.amount) || 0;
      // Money we owe RIGHT NOW: the app's own "Payment Pending" state — videos
      // delivered, payout not sent. Deliberately not allocated-minus-paid,
      // which would fold in deals still being filmed and nobody is waiting on.
      if (c.payment_status === 'pending') { a.pendingPay += Number(c.amount) || 0; a.pendingCreators += 1; }
      a.delivered += dealCodes(c.video_codes).filter(v => v?.video).length;
    });

    let rows = brands.map(b => {
      const a = agg[b.id] || { creators: 0, allocated: 0, paid: 0, pendingPay: 0, pendingCreators: 0, videos: 0, delivered: 0, present: 0, toReview: 0 };
      const bmRow = bmByKey[`${b.id}|${month}`];
      const bm = bmRow || {};
      const budget = Number(bm.budget) || 0;
      return {
        id: b.id, brand: b.name, logo: b.logo_url || null,
        // Neither is on screen; both are in the export, where a bare money
        // column needs its currency named and a brand needs its client.
        client: b.client || '', currency: b.currency || 'USD',
        ...a, bm, budget,
        // Every brand shows in every month. One with no budget for the month
        // goes into the table's collapsed "Hidden — no budget" group and moves
        // up into the list as soon as a budget is saved for it.
        show: true,
        remaining: budget - a.allocated,
        usage: budget > 0 ? (a.allocated / budget) * 100 : 0,
        costPerVideo: a.videos > 0 ? a.allocated / a.videos : 0,
      };
    }).filter(r => r.show);

    // Custom drag order first (brands present in brandOrder, in that sequence); the rest
    // fall to the bottom in the default allocated-desc order.
    const oIdx = (id) => { const i = brandOrder.indexOf(id); return i === -1 ? Infinity : i; };
    rows.sort((x, y) => {
      const ox = oIdx(x.id), oy = oIdx(y.id);
      if (ox !== oy) return ox - oy;
      return y.allocated - x.allocated || x.brand.localeCompare(y.brand);
    });
    return rows;
  }, [brands, creators, bmByKey, month, brandOrder]);

  /* What the table actually shows. Filtering after the sort is the same list
     in the same order — the order comes from brandOrder, not from neighbours. */
  const brandRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? brandRowsAll.filter(r => r.brand.toLowerCase().includes(q)) : brandRowsAll;
  }, [brandRowsAll, search]);

  const totals = useMemo(() => brandRows.reduce((t, r) => ({
    budget: t.budget + r.budget, allocated: t.allocated + r.allocated, paid: t.paid + r.paid,
    pendingPay: t.pendingPay + r.pendingPay, pendingCreators: t.pendingCreators + r.pendingCreators,
    remaining: t.remaining + r.remaining, videos: t.videos + r.videos, creators: t.creators + r.creators,
    delivered: t.delivered + r.delivered, toReview: t.toReview + (r.toReview || 0),
  }), { budget: 0, allocated: 0, paid: 0, pendingPay: 0, pendingCreators: 0, remaining: 0, videos: 0, creators: 0, delivered: 0, toReview: 0 }), [brandRows]);

  // Assigned brands (public.brands, paid-collab scope) not yet active in this month —
  // the handler "adds" one of these to the month rather than creating a new brand.
  const assignableBrands = useMemo(() => {
    // Every brand is in the month now; "adding" one means giving a brand that
    // has no budget yet its budget, which lifts it out of the hidden group.
    const noBudget = new Set(brandRowsAll.filter(r => !(r.budget > 0)).map(r => r.id));
    return brands.filter(b => noBudget.has(b.id));
  }, [brands, brandRowsAll]);

  // directory of known creators (across all brands/months) for auto-fill when re-adding
  const creatorDirectory = useMemo(() => {
    const map = {};
    creators.forEach(c => {
      const key = (c.name || '').trim().toLowerCase();
      if (!key) return;
      const score = (c.tiktok_handle ? 1 : 0) + (c.paypal ? 1 : 0) + (c.zelle ? 1 : 0) + (c.phone ? 1 : 0) + (c.email ? 1 : 0);
      const prev = map[key];
      const prevScore = prev ? prev._score : -1;
      if (!prev || score > prevScore) map[key] = { name: c.name, tiktok_handle: c.tiktok_handle || '', paypal: c.paypal || '', zelle: c.zelle || '', phone: c.phone || '', email: c.email || '', category: c.category || '', _score: score };
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [creators]);

  // every category WORD in use on a deal (values are comma-joined), for the pickers
  const categories = useMemo(
    () => [...new Set(creators.flatMap(c => splitCats(c.category)))].sort((a, b) => a.localeCompare(b)),
    [creators]);

  // products already on the creator-editor's brand (aggregated across all its months, deduped)
  const creatorEditorProducts = useMemo(() => {
    if (!creatorEditor) return [];
    const seen = new Set(), out = [];
    brandMonths.filter(m => m.brand_id === creatorEditor.brandId).forEach(m => focusProductList(m).forEach(p => {
      const k = prodKey(p);
      if (k && !seen.has(k)) { seen.add(k); out.push(p); }
    }));
    return out;
  }, [creatorEditor, brandMonths]);

  // Creators tab — EVERY creator (per brand, every month), each tagged with its month
  const allCreatorsList = useMemo(() => creators
    /* `_bm` is the deal's OWN brand-month, not the month the workspace happens
       to be showing — this tab lists every month at once, so a contract opened
       here must quote the rates of the month the deal belongs to. */
    .map(c => ({ ...c, _brandName: brandById[c.brand_id]?.name || '—', _brandCurrency: brandById[c.brand_id]?.currency || 'USD', _monthKey: monthKey(c.onboarded_on), _bm: bmByKey[`${c.brand_id}|${monthKey(c.onboarded_on)}`] || null }))
    // month groups newest-first; within a month, most-recently-onboarded on top (then newest record), not alphabetical
    .sort((a, b) => String(b._monthKey).localeCompare(String(a._monthKey))
      || String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || ''))
      || String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [creators, brandById, bmByKey]);

  /* Creators Database — one row per PERSON: every creator we already work with
     (derived from their deals) merged with the manually banked creator_directory
     entries. See buildCreatorDatabase() for the merge rules. */
  const creatorDatabase = useMemo(
    () => buildCreatorDatabase(allCreatorsList, directory),
    [allCreatorsList, directory]);
  /* A creator row's "?" resolves through the SAME merge the database tab
     reads, so the two popups can never describe one person differently.
     Looked up by key at render time (not captured on click) so an edit or a
     refresh lands in the open popup. */
  const infoEntry = useMemo(
    () => (infoKey ? creatorDatabase.find(e => e.key === infoKey) || null : null),
    [infoKey, creatorDatabase]);
  const openCreatorInfo = useCallback((c) => setInfoKey(store.creatorGlobalKey(c)), []);
  const closeCreatorInfo = useCallback(() => setInfoKey(null), []);

  /* The shared category catalogue (names + colours) and its manager. A
     rename/delete rewrites creators server-side, so the workspace re-reads. */
  const [catCatalogue, setCatCatalogue] = useState([]);
  const reloadCatalogue = useCallback(
    () => store.loadCreatorCategories().then(d => setCatCatalogue(prev => keepIfSame(prev, d))).catch(() => { }), []);
  useEffect(() => { reloadCatalogue(); }, [reloadCatalogue]);
  const catColors = useMemo(() => {
    const m = {};
    catCatalogue.forEach(c => { if (c.color && c.name) m[c.name.trim().toLowerCase()] = c.color; });
    return m;
  }, [catCatalogue]);
  const [catManagerOpen, setCatManagerOpen] = useState(false);
  const openCatManager = useCallback(() => setCatManagerOpen(true), []);
  /* The last rename/delete, so an open creator editor can update the chips it
     already holds — otherwise saving it would write the old word back. */
  const [catEdit, setCatEdit] = useState(null);
  const notifyCatEdit = useCallback((ev) => setCatEdit({ ...ev, at: Date.now() }), []);
  const catUsage = useMemo(() => countCategories(creatorDatabase.map(e => e.categories)), [creatorDatabase]);
  const catCtx = useMemo(() => ({ catalogue: catCatalogue, reload: reloadCatalogue, lastEdit: catEdit, openManager: readOnly ? null : openCatManager }),
    [catCatalogue, reloadCatalogue, catEdit, readOnly, openCatManager]);
  const closeCatManager = useCallback(() => setCatManagerOpen(false), []);
  // the dialog waits for the catalogue only; the creators re-read behind it
  const onCategoriesChanged = useCallback(async () => {
    await reloadCatalogue();
    reload({ sweep: false });
  }, [reloadCatalogue, reload]);

  // every category in use across the database, for the filter + the picker
  const dbCategories = useMemo(
    () => [...new Set(creatorDatabase.flatMap(e => e.categories).map(c => c.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [creatorDatabase]);

  /* Reacher creator level + TT GMV + average views for the Database tab
     (replaced Euka 2026-09-23). The figures live in `creator_reacher_stats`,
     refreshed by a DAILY JOB at 5 AM Pakistan time (scripts/reacher-daily.sh,
     root crontab on the VPS). Opening the tab only READS that table — it never
     calls Reacher, so a reload costs nothing. "Fetch now" is the manual
     exception, for creators added since the morning run. */
  const [reacher, setReacher] = useState({
    stats: {}, loading: false, syncing: false, err: '', loaded: false,
    count: 0, remaining: 0, rateLimited: false, updatedAt: null,
  });
  const reacherRun = useRef(false);
  const reacherAlive = useRef(true);
  useEffect(() => { reacherAlive.current = true; return () => { reacherAlive.current = false; }; }, []);
  const readReacherCache = useCallback(async () => {
    const stats = {};
    let updatedAt = null;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('creator_reacher_stats')
        .select('handle, found, tt_gmv, level, followers, avg_views, fetched_at').range(from, from + 999);
      if (error) throw error;
      (data || []).forEach(r => {
        if (r.found) stats[r.handle] = reacherStat(r);
        if (r.fetched_at && (!updatedAt || r.fetched_at > updatedAt)) updatedAt = r.fetched_at;
      });
      if (!data || data.length < 1000) break;
    }
    return { stats, updatedAt };
  }, []);
  const loadReacher = useCallback(async () => {
    setReacher(p => ({ ...p, loading: true, err: '' }));
    try {
      const { stats, updatedAt } = await readReacherCache();
      if (reacherAlive.current) setReacher(p => ({ ...p, stats, updatedAt, loading: false, loaded: true, count: Object.keys(stats).length }));
    } catch (e) {
      if (reacherAlive.current) setReacher(p => ({ ...p, loading: false, loaded: true, err: e.message || String(e) }));
    }
  }, [readReacherCache]);
  /* Manual: look up whatever the morning run has not covered (new creators, or
     anything more than 20h old). Each pass is ~20s / ~16 handles. A pass the
     runtime cuts short has still saved what it fetched, so one failure is
     retried; two in a row is a real error. */
  const fetchReacherNow = useCallback(async () => {
    if (reacherRun.current) return;
    reacherRun.current = true;
    setReacher(p => ({ ...p, syncing: true, err: '', rateLimited: false }));
    try {
      let fails = 0;
      for (let pass = 0; pass < 80 && reacherAlive.current; pass++) {
        const { data, error } = await supabase.functions.invoke('reacher-creator-stats', { body: {} });
        if (error) {
          if (++fails >= 2) throw await fnError(error);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        fails = 0;
        if (!reacherAlive.current) return;
        setReacher(p => {
          const next = { ...p.stats };
          (data?.rows || []).forEach(r => { if (r.found) next[r.handle] = reacherStat(r); else delete next[r.handle]; });
          const last = (data?.rows || []).reduce((m, r) => (r.fetched_at > m ? r.fetched_at : m), p.updatedAt || '');
          return { ...p, stats: next, count: Object.keys(next).length, updatedAt: last || p.updatedAt,
            remaining: data?.remaining || 0, rateLimited: !!data?.rateLimited };
        });
        // A pass that refreshed nothing (or hit the rate limit) would only spin.
        if (!data?.remaining || data?.rateLimited || !data?.refreshed) break;
      }
      if (reacherAlive.current) setReacher(p => ({ ...p, syncing: false }));
    } catch (e) {
      if (reacherAlive.current) setReacher(p => ({ ...p, syncing: false, err: e.message || String(e) }));
    } finally {
      reacherRun.current = false;
    }
  }, []);
  /* Read on first NEED, not on workspace load: the database tab, or the "?"
     popup on a creator row, which shows the same facts. */
  useEffect(() => {
    if ((tab === 'database' || infoKey) && !reacher.loaded && !reacher.loading) loadReacher();
  }, [tab, infoKey, reacher.loaded, reacher.loading, loadReacher]);

  // brandRowsAll, not brandRows: a drilldown opened before somebody typed in
  // the brands search box must not empty itself because its brand is filtered out.
  const drillRow = brandRowsAll.find(r => r.id === drillId) || null;
  const drillBrand = brandById[drillId] || null;
  // Money symbol for this render: the drilled-in brand's currency, else the
  // handler's uniform currency (multi-brand overview/aggregate tabs). Sub-views
  // that pick their own brand internally (BrandMatrix, ReportingView, PerfBrandList)
  // re-set this at their own render.
  setReportCurrency(drillId && drillBrand ? drillBrand.currency : uniformCurrency(brands));
  const drillCreators = useMemo(() => {
    if (!drillId) return [];
    return creators
      .filter(c => c.brand_id === drillId && monthKey(c.onboarded_on) === month)
      .sort((a, b) => String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || '')));
  }, [creators, drillId, month]);

  // Video links + ad codes are indexed across EVERY deal in the workspace, so the
  // row editor can name the creator a pasted value already belongs to. Keyed on the
  // normalised value → the creators holding it (a key can legitimately repeat while
  // a duplicate is being fixed, so keep the list rather than the first hit).
  const codeOwners = useMemo(() => {
    const videos = new Map();
    const ads = new Map();
    const push = (map, key, c) => { if (!key) return; const arr = map.get(key); if (arr) arr.push(c); else map.set(key, [c]); };
    creators.forEach(c => {
      (Array.isArray(c.video_codes) ? c.video_codes : []).forEach(r => {
        push(videos, normVideoKey(r?.video), c);
        push(ads, normAdKey(r?.adCode), c);
      });
    });
    return { videos, ads };
  }, [creators]);
  const findCodeOwner = useCallback((kind, key, selfId) => {
    if (!key) return null;
    const hit = (kind === 'video' ? codeOwners.videos : codeOwners.ads).get(key);
    const other = hit && hit.find(c => c.id !== selfId);
    if (!other) return null;
    const brand = brandById[other.brand_id]?.name || '';
    const m = monthKey(other.onboarded_on);
    return `${other.name || 'another creator'}${brand ? ` · ${brand}` : ''}${m ? ` · ${monthShort(m)}` : ''}`;
  }, [codeOwners, brandById]);

  /* ── mutations ── */
  async function saveBrandBudget(mode, brandRef, patch) {
    try {
      // Brands come from public.brands now: in "add" mode the handler picks one of
      // their assigned brands (patch.brand_id); in "edit" mode it's the existing brand.
      const brandId = mode === 'add' ? patch.brand_id : brandRef.id;
      if (!brandId) throw new Error('Pick a brand');
      const row = await store.upsertBrandMonth(brandId, month, patch);
      // Apply the saved row locally and close — the refresh runs behind it.
      if (row) setBrandMonths(prev => (prev.some(x => x.id === row.id)
        ? prev.map(x => (x.id === row.id ? { ...x, ...row } : x))
        : [...prev, row]));
      setBrandEditor(null);
      reload(AFTER_SAVE);
    } catch (e) { alert(`Couldn't save brand: ${e.message}`); }
  }
  // Pause / resume / dismiss a focus product from the drilldown chips —
  // optimistic, then the same month upsert the Edit-budget popup uses.
  const saveDrillFocusProducts = useCallback((list) => {
    if (!drillId) return;
    const json = list.length ? JSON.stringify(list) : '';
    setBrandMonths(prev => {
      const i = prev.findIndex(x => x.brand_id === drillId && x.month === month);
      if (i < 0) return prev;
      const next = [...prev]; next[i] = { ...next[i], focus_product_url: json }; return next;
    });
    store.upsertBrandMonth(drillId, month, { focus_product_url: json })
      .catch(e => { alert(`Couldn't save the product: ${e.message}`); reload(); });
  }, [drillId, month, reload]);
  // ── deferred delete with Undo (commits to DB only after the undo window) ──
  const scheduleUndo = useCallback((payload) => {
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; }
    if (undoRef.current) undoRef.current.commit();   // commit the previous pending one
    undoRef.current = payload;
    setUndo(payload);
    undoTimer.current = setTimeout(() => { payload.commit(); undoRef.current = null; setUndo(null); undoTimer.current = null; }, 6000);
  }, []);
  function doUndo() {
    if (!undoRef.current) return;
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; }
    undoRef.current.restore();
    undoRef.current = null;
    setUndo(null);
  }
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && undoRef.current) { e.preventDefault(); doUndo(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ‼️ Declared HERE, above saveCreator, and not further down beside the other
     creator helpers: saveCreator names it in a useCallback dependency array,
     which is evaluated at that line. A `const` below it is still in the temporal
     dead zone there, and the whole workspace crashes on mount with "Cannot
     access 'patchCreatorLocal' before initialization". (It survived as a hoisted
     `function` for years, which is why moving one to a const surfaced it.) */
  const patchCreatorLocal = useCallback((id, patch) => {
    loadRef.current.writeGen += 1;
    setCreators(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  // shared identity (same person across brands/months) — propagate to siblings.
  // Fired in parallel: a creator working with several brands used to cost one
  // round trip per sibling before the editor could close.
  // `cleared` = fields this save deliberately emptied (had a value before the
  // edit, blank now). Those DO propagate: reconcileShared() refills a blank from
  // any same-name sibling on the next load, so a clear kept local to one deal
  // came straight back and a number or email could be replaced but never removed.
  async function propagateShared(name, shared, exceptId, cleared = new Set()) {
    const key = (name || '').trim().toLowerCase();
    if (!key) return;
    const sibs = creators.filter(c => (c.name || '').trim().toLowerCase() === key && c.id !== exceptId);
    const jobs = [];
    for (const s of sibs) {
      const patch = {};
      Object.entries(shared).forEach(([k, v]) => {
        // Blank never propagates — clearing a field on one deal has always been
        // a local edit, not an instruction to wipe it on every sibling. An empty
        // ARRAY is truthy, so it needs saying explicitly.
        const blank = !v || (Array.isArray(v) && !v.length);
        if (blank && !cleared.has(k)) return;
        if (blank) {
          const had = Array.isArray(s[k]) ? s[k].length : (s[k] && String(s[k]).trim());
          if (had) patch[k] = Array.isArray(v) ? [] : '';
          return;
        }
        // `payouts` is an array, so a plain !== is always true by identity and
        // would push an update to every sibling on every save. Compare content.
        const same = Array.isArray(v) ? JSON.stringify(s[k] || []) === JSON.stringify(v) : s[k] === v;
        if (!same) patch[k] = v;
      });
      if (Object.keys(patch).length) jobs.push(store.updateCreator(s.id, patch).catch(() => { }));
    }
    if (jobs.length) await Promise.all(jobs);
  }
  /* Resolves only once the deal is persisted, and REJECTS on failure — the
     editor keeps its "Saving…" button up for the whole round trip and shows the
     error inline instead of the popup vanishing behind an alert(). */
  const saveCreator = useCallback(async (mode, data) => {
    let savedId = data.id;
    const cleared = new Set();
    if (mode !== 'add') {
      const before = creators.find(x => x.id === data.id);
      const filled = (v) => Array.isArray(v) ? v.length > 0 : !!(v && String(v).trim());
      if (before) {
        ['tiktok_handle', 'phone', 'email', 'category'].forEach(k => { if (filled(before[k]) && !filled(data[k])) cleared.add(k); });
        if (filled(creatorPayouts(before)) && !filled(data.payouts)) cleared.add('payouts');
      }
    }
    if (mode === 'add') {
      const row = await store.addCreator(data);
      savedId = row?.id;
      // Show the new deal straight away instead of waiting for the refresh.
      if (row) setCreators(prev => (prev.some(c => c.id === row.id) ? prev : [...prev, row]));
    } else {
      const newCount = parseInt(data.videos_count, 10) || 0;
      const patch = {
        name: data.name, tiktok_handle: data.tiktok_handle, amount: Number(data.amount) || 0,
        videos_count: newCount,
        // Payment methods ride the list alone; the DB trigger derives the
        // paypal/zelle mirrors from it (migration 20260872090000). Sending the
        // two columns here as well would be a second source of truth in one
        // write — and NOT sending the list at all, which this patch used to do,
        // is how a payment edit silently failed to save.
        payouts: Array.isArray(data.payouts) ? data.payouts : [],
        phone: data.phone, email: data.email, category: data.category,
        onboarded_on: data.onboarded_on,
        // contract_url is legacy (manually pasted links, pre e-signing) — the
        // editor no longer touches it, so it is deliberately left untouched here.
        // blank = automatic deadline rule in the contract PDF
        deliverable_days: data.deliverable_days ? parseInt(data.deliverable_days, 10) || null : null,
        products: Array.isArray(data.products) ? data.products : [],
      };
      // lowering the video count drops the extra video-link / ad-code rows
      const existing = creators.find(x => x.id === data.id);
      // ‼️ EXTRA videos are not part of the deal, so they survive a lower count.
      const existingDeal = existing ? dealCodes(existing.video_codes) : [];
      if (existing && newCount < existingDeal.length) {
        patch.video_codes = [...existingDeal.slice(0, newCount), ...extraCodes(existing.video_codes)];
      }
      // Moving a deal onto a program the same creator is already on is the
      // same duplicate as adding it twice.
      const prev = creators.find(x => x.id === data.id);
      await store.assertNotOnProgram({ ...patch, brand_id: prev?.brand_id ?? data.brand_id }, data.id);
      await store.updateCreator(data.id, patch);
      /* The optimistic local patch DOES carry the mirrors, unlike the write:
         the row on screen must not keep a paypal/zelle the handler just cleared
         while the reload lands, and creatorPayouts() falls back to those two
         columns whenever the list is empty. Same rule as the SQL trigger. */
      patchCreatorLocal(data.id, {
        ...patch,
        paypal: patch.payouts.find(p => payoutKindOf(p.label) === 'paypal')?.value || '',
        zelle: patch.payouts.find(p => payoutKindOf(p.label) === 'zelle')?.value || '',
      });
    }
    // Keep the same creator's contact/identity in sync everywhere they appear.
    // Awaited on purpose — closing the popup first would let a closed tab leave a
    // sibling deal stale. It now fires its updates in parallel, so it costs one
    // round trip, not one per sibling.
    await propagateShared(data.name, {
      // How this person is paid follows them across brands and months, which is
      // what the two mirrored columns did before the list existed.
      tiktok_handle: data.tiktok_handle, payouts: data.payouts,
      phone: data.phone, email: data.email, category: data.category,
    }, savedId, cleared);
    // Everything is persisted and the row already shows it, so close now and let
    // the refresh — the bulk of the round trips — land behind it.
    setCreatorEditor(null);
    reload(AFTER_SAVE);
    // A deal write can bank/update the creator in the directory (trigger).
    store.loadDirectoryCreators().then(d => setDirectory(prev => keepIfSame(prev, d))).catch(() => { });
  }, [creators, patchCreatorLocal, reload]);
  const removeCreator = useCallback((id) => {
    const c = creators.find(x => x.id === id);
    if (!c) return;
    setConfirmDel({
      // Deleting the DEAL never loses the person: a DB trigger archives them into
      // the Creators Database when this was their last deal (migration 20260838090000).
      message: `Delete creator “${c.name}” from this program? They stay in the Creators Database.`,
      onYes: () => {
        setConfirmDel(null);
        setCreators(prev => prev.filter(x => x.id !== id));
        scheduleUndo({
          label: `Deleted “${c.name}”`,
          restore: () => setCreators(prev => (prev.some(x => x.id === c.id) ? prev : [...prev, c])),
          // On success pull the directory back in so the archived entry shows
          // straight away (a full reload only happens on failure).
          commit: () => store.deleteCreator(id)
            .then(() => store.loadDirectoryCreators().then(setDirectory).catch(() => { }))
            .catch(() => reload()),
        });
      },
    });
  }, [creators, scheduleUndo, reload]);
  // optimistic — used by the inline video/ad-code editor
  // Contract signing links, keyed by creator, + a local patch so the row button
  // updates the moment the modal creates / toggles / records a signature.
  const contractLinkByCreator = useMemo(() => {
    const m = {};
    contractLinks.forEach(l => { m[l.creator_id] = l; });
    return m;
  }, [contractLinks]);
  const contractLinkFor = useCallback((c) => contractLinkByCreator[c.id] || null, [contractLinkByCreator]);
  const onContractLinkChange = useCallback((row) => {
    if (!row) return;
    setContractLinks(prev => (prev.some(l => l.id === row.id)
      ? prev.map(l => (l.id === row.id ? { ...l, ...row } : l))
      : [...prev, row]));
  }, []);

  // per-creator monthly GMV / Ad Spent (Performance tab) — optimistic + persist
  const saveCreatorMonthly = useCallback((id, monthly) => {
    patchCreatorLocal(id, { monthly });
    store.updateCreator(id, { monthly }).catch(() => reload());
  }, [patchCreatorLocal, reload]);

  // Create the next weekly report for a brand (mirrors the APC/Bob flow). The next
  // week auto-continues from the brand's anchor + existing reports; on the very
  // first report `firstAnchor` (a date) seeds the brand's weekly anchor. After
  // creating, jump the workspace to that week's month so the new column shows.
  const createWeeklyReport = useCallback(async (brandId, firstAnchor) => {
    if (!user?.id) return;
    const existingArr = (reportWeeks[brandId] || []).map(w => w.start);
    const existing = new Set(existingArr);
    let anchor = reportAnchors[brandId]
      || (existingArr.length ? existingArr.slice().sort()[0] : null)
      || firstAnchor || null;
    if (!anchor) { alert('Pick an anchor (week-1 start) date first.'); return; }
    // First report ever → persist the anchor so the brand's weekly reports use it too.
    if (firstAnchor && !reportAnchors[brandId] && existingArr.length === 0) {
      try { await store.setBrandWeeklyAnchor(brandId, firstAnchor); }
      catch (e) { alert(`Couldn't set anchor: ${e.message}`); return; }
      setReportAnchors(prev => ({ ...prev, [brandId]: firstAnchor }));
      anchor = firstAnchor;
    }
    // Walk from the anchor to the first un-created week (fills gaps), like AfflixCore.
    let start = anchor, wn = 1;
    while (existing.has(start)) { start = addDaysISO(start, 7); wn++; }
    const end = addDaysISO(start, 6);
    try { await store.createWeeklyReport(brandId, user.id, start, end, wn); }
    catch (e) { alert(`Couldn't create weekly report: ${e.message}`); return; }
    await reload();
    setMonth(start.slice(0, 7));
  }, [reportWeeks, reportAnchors, user, reload]);

  // Post a comment as the signed-in handler (optimistic).
  const handlerName = profile?.full_name || profile?.email || user?.email || 'Handler';

  /* ── Creators Database mutations ──
     The list is shared, so anyone in the group can correct an entry; only the
     person who banked it (or Bob) may delete it — matching the RLS policies. */
  const openDirEditor = useCallback((entry) => {
    if (!entry) { setDirEditor({ mode: 'add' }); return; }
    if (entry.dir) { setDirEditor({ mode: 'edit', entry: entry.dir }); return; }
    // Derived-only creator (known from deals, never banked): pre-fill the form
    // from the aggregate so saving their credentials is a two-click job.
    setDirEditor({
      mode: 'add',
      entry: {
        name: entry.name,
        tiktok_handle: entry.handles.map(h => h.handle).join('\n'),
        phone: entry.phone, email: entry.email, category: entry.category,
        paypal: entry.paypal, zelle: entry.zelle,
      },
    });
  }, []);

  const saveDirectoryCreator = useCallback(async (patch) => {
    const editing = dirEditor?.mode === 'edit' ? dirEditor.entry?.id : null;
    if (editing) {
      const row = await store.updateDirectoryCreator(editing, patch);
      setDirectory(prev => prev.map(d => (d.id === row.id ? row : d)));
    } else {
      const row = await store.addDirectoryCreator(patch, handlerName);
      setDirectory(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)));
    }
    setDirEditor(null);
  }, [dirEditor, handlerName]);

  /* ‼️ NOT the shared ConfirmModal any more. The database is company-wide and a
     removal is not undoable, so this one asks for the creator's username to be
     TYPED — see CreatorDeleteModal. A yes/no dialog is dismissed by reflex; a
     dialog that cannot be answered without reading it is the point. */
  const removeDirectoryCreator = useCallback((entry) => {
    if (entry?.dir?.id) setDirDelete(entry);
  }, []);

  const confirmRemoveDirectory = useCallback(async (entry) => {
    await store.deleteDirectoryCreator(entry.dir.id);
    setDirectory(prev => prev.filter(d => d.id !== entry.dir.id));
    setDirDelete(null);
    setInfoKey(null);          // the detail popup may be open on the row just removed
  }, []);

  // Onboard a database creator onto a brand's program: creates a normal deal row
  // with their banked credentials, then jumps to that program's drilldown so the
  // handler can finish it off (products, video links).
  const addCreatorToProgram = useCallback(async (payload) => {
    const row = await store.addCreator(payload);
    // Land the deal locally and navigate immediately; the refresh follows.
    setCreators(prev => (prev.some(c => c.id === row.id) ? prev : [...prev, row]));
    reload(AFTER_SAVE);
    // A deal write can bank/update the creator in the directory (trigger).
    store.loadDirectoryCreators().then(d => setDirectory(prev => keepIfSame(prev, d))).catch(() => { });
    setProgramAdd(null);
    setTab('brands');
    setMonth(monthKey(row.onboarded_on) || monthKey(payload.onboarded_on) || thisMonthKey());
    setDrillId(payload.brand_id);
    scrollTop();
  }, [reload]);

  /* Bound to who is asking; the rule itself is directoryDeleteRule, below. */
  const directoryDeleteGate = useCallback(
    (entry) => directoryDeleteRule(entry, profile?.role === 'bob', user?.id),
    [profile, user]);

  /* What the spreadsheet import needs in order to tell a stranger from
     somebody already on record.
     ‼️ BANKED is the narrow set — those are the rows a re-import would collide
     with on creator_directory's unique identity index, and the only ones an
     "update existing" pass has a row id for. Somebody known only from DEALS is
     still an INSERT (it banks their credentials, exactly as the "+" on such a
     row does), so they are handed over separately, as a warning rather than as
     a duplicate.
     ‼️ The key comes from `identity_key` where the row has one — that is the
     DATABASE's own answer, filled by creator_directory_fill, so matching on it
     cannot drift from what the unique index will actually say. */
  const dirKeyOf = (d) => d.identity_key || store.creatorGlobalKey(d);
  const bankedKeys = useMemo(() => new Set(directory.map(dirKeyOf)), [directory]);
  const dirIdByKey = useMemo(() => Object.fromEntries(directory.map(d => [dirKeyOf(d), d.id])), [directory]);
  const knownKeys = useMemo(
    () => new Set(creatorDatabase.filter(e => !e.dir).map(e => e.key)),
    [creatorDatabase]);

  /* Re-read the whole list rather than patching it in: an import writes dozens
     of rows whose server-filled identity_key and stamps we do not hold, and one
     query is cheaper than reasoning about which of them landed. */
  const reloadDirectory = useCallback(async () => {
    try { setDirectory(await store.loadDirectoryCreators()); } catch { /* the import reports what it wrote */ }
  }, []);
  // Stable, like every other prop the memoised tab bodies take.
  const openImport = useCallback(() => setImportOpen(true), []);
  const openShare = useCallback(() => setShareOpen(true), []);

  const addPaidComment = useCallback(async (brandId, tt, tk, body, authorName, parentId) => {
    if (readOnly) return;   // view-only workspace: discussions are read, not joined
    if (!user?.id) throw new Error('Not signed in');
    const row = await store.addComment({
      brandId, targetType: tt, targetKey: tk || '', authorId: user.id,
      authorType: profile?.role === 'bob' ? 'bob' : profile?.role === 'apc' ? 'apc' : 'handler',
      authorName: authorName || handlerName, body, parentId: parentId || null,
    });
    setComments(prev => [...prev, row]);
  }, [readOnly, user, profile, handlerName]);
  const openComments = useCallback((brandId, tt = 'brand', tk = '', highlight = null) =>
    setCommentDrawer({ brandId, tt, tk, highlight }), []);
  // Threads whose latest message is from the client → the handler still owes a reply.
  const needsReplyCount = useMemo(() => {
    const last = {};
    comments.forEach(c => { const k = `${c.brand_id}|${c.target_type}|${c.target_key}`; if (!last[k] || c.created_at > last[k].created_at) last[k] = c; });
    return Object.values(last).filter((c) => c.author_type === 'client').length;
  }, [comments]);

  // Notification click-through:
  //  • /paid-collab?brand=&pay=1[&month=]  → open the brand's workspace drilldown
  //    (client "marked paid" — handler cross-checks + updates status here)
  //  • /paid-collab?brand=&code=1[&month=] → same drilldown for an "invalid ad
  //    code" report (the flagged row shows in the creator's expand)
  //  • /paid-collab?brand=&rate=1[&month=] → same drilldown for a client's star
  //    rating (20260891090000); the score shows in the creator's expand too
  //  • /paid-collab?brand=&tt=&tk=&pcc=    → open the discussion thread drawer
  const deepLinked = useRef(false);
  useEffect(() => {
    if (loading || deepLinked.current) return;
    deepLinked.current = true;
    const sp = new URLSearchParams(window.location.search);
    const noteId = sp.get('note');
    if (noteId) setPendingNoteId(noteId); // opened once the notes list is in state
    const b = sp.get('brand');
    if (!b) return;
    if (sp.get('pay') === '1' || sp.get('code') === '1' || sp.get('rate') === '1') {
      const m = sp.get('month');
      if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
      setTab('brands');
      setDrillId(b);
      scrollTop();
    } else {
      setCommentDrawer({ brandId: b, tt: sp.get('tt') || 'brand', tk: sp.get('tk') || '', highlight: sp.get('pcc') || null });
    }
  }, [loading]);

  // Open the note from a ?note=<id> deep link (e.g. a reminder notification) once
  // the notes list has loaded; if it's missing locally, fetch it directly.
  useEffect(() => {
    if (!pendingNoteId) return;
    const local = notes.find(n => n.id === pendingNoteId);
    if (local) { setOpenNote(local); setPendingNoteId(null); return; }
    let cancelled = false;
    store.loadVisibleNotes()
      .then(list => { if (cancelled) return; const n = (list || []).find(x => x.id === pendingNoteId); if (n) setOpenNote(n); })
      .finally(() => { if (!cancelled) setPendingNoteId(null); });
    return () => { cancelled = true; };
  }, [pendingNoteId, notes]);

  // Persist / delete for a directly-opened note (deep link), kept in sync with the workspace.
  const persistOpenNote = useCallback(async (payload) => {
    const { id, ...rest } = payload;
    if (id) { try { await store.updateNote(id, rest); } catch (e) { setErr(e.message || 'Save failed'); } reloadNotes(); return id; }
    try { const row = await store.createNote(rest); reloadNotes(); return row.id; }
    catch (e) { setErr(e.message || 'Save failed'); return null; }
  }, [reloadNotes]);
  const deleteOpenNote = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    try { await store.deleteNote(n.id); } catch { }
    setOpenNote(null); reloadNotes();
  }, [reloadNotes]);
  // notes (per brand, per month) — optimistic + persist
  const saveNotes = useCallback((brandId, notesText) => {
    setBrandMonths(prev => {
      const i = prev.findIndex(x => x.brand_id === brandId && x.month === month);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], notes: notesText }; return next; }
      return [...prev, { id: 'tmp-' + brandId, brand_id: brandId, month, notes: notesText, budget: 0, content_guide_url: '', focus_product_url: '', standard_commission: null, shop_ads_commission: null, approval_required: false, onboarded_on: null }];
    });
    store.upsertBrandMonth(brandId, month, { notes: notesText }).catch(() => reload());
  }, [month, reload]);
  // inline status dropdown
  const setCreatorStatus = useCallback(async (id, payment_status) => {
    patchCreatorLocal(id, { payment_status });
    try { await store.updateCreator(id, { payment_status }); }
    catch (e) { alert(`Couldn't update status: ${e.message}`); reload(); }
  }, [patchCreatorLocal, reload]);
  // Toggle whether a "Payment Pending" creator's status is visible to the client.
  const setCreatorPendingVisible = useCallback(async (id, visible) => {
    patchCreatorLocal(id, { pending_visible_to_client: visible });
    try { await store.updateCreator(id, { pending_visible_to_client: visible }); }
    catch (e) { alert(`Couldn't update visibility: ${e.message}`); reload(); }
  }, [patchCreatorLocal, reload]);
  // Contract template modal (representative name + signature for the PDFs)
  const [contractTplOpen, setContractTplOpen] = useState(false);
  // Bumped whenever a video is starred/unstarred, so the Best Videos tab
  // re-reads instead of showing what it loaded on mount.
  const [bestKey, setBestKey] = useState(0);
  const bumpBest = useCallback(() => setBestKey(k => k + 1), []);

  /* ── Stable handlers for the memoised tab bodies ──
     These used to be inline arrows in the JSX, so every parent render handed the
     tables a brand-new function and React.memo could never hold. Opening the
     creator modal (a parent state change) therefore re-rendered the entire
     creator table underneath it, which is what made the popup feel slow to open
     and slower to close. */
  const openBrand = useCallback((id) => { setDrillId(id); scrollTop(); }, []);
  const closeDrill = useCallback(() => { setDrillId(null); scrollTop(); }, []);
  const editCreator = useCallback((c) => setCreatorEditor({ mode: 'edit', brandId: c.brand_id, creator: c }), []);
  const addCreatorHere = useCallback(() => setCreatorEditor({ mode: 'add', brandId: drillId }), [drillId]);
  const editDrillBudget = useCallback(() => setBrandEditor({
    mode: 'edit', brand: { id: drillId, name: drillBrand?.name },
  }), [drillId, drillBrand?.name]);
  const openDrillComments = useCallback(() => openComments(drillId, 'brand', ''), [openComments, drillId]);
  const drillCommentCount = useMemo(
    () => comments.filter(c => c.brand_id === drillId).length, [comments, drillId]);
  const editBrandBudget = useCallback((r) => setBrandEditor({
    mode: 'edit', brand: brands.find(b => b.id === r.id) || { id: r.id, name: r.brand },
  }), [brands]);
  const addBrand = useCallback(() => setBrandEditor({ mode: 'add', brand: { id: null, name: '' } }), []);
  const openBrandMonthNotes = useCallback((r) => setNotesBrand({ id: r.id, name: r.brand, logo_url: r.logo }), []);
  const openBrandKeepNotes = useCallback((r) => setKeepBrand({ id: r.id, name: r.brand }), []);

  return (
    <ReadOnlyCtx.Provider value={readOnly}>
    <CatColorsCtx.Provider value={catColors}>
    <CatCatalogueCtx.Provider value={catCtx}>
    <BestBumpCtx.Provider value={bumpBest}>
    <div className="pc-app">
      <div className="pc-shell">
        {/* Notes drops the workspace header: the board is not
            scoped to a month (a note carries its own), so a month picker over
            it would steer nothing, and the logo lockup is chrome the page
            does not need. It keeps the plain heading so the page is titled. */}
        {notesPage ? (
          <div className="ac-page-header pc-solohead">
            <h2 className="mb-0">Notes</h2>
          </div>
        ) : (
        <header className="pc-header">
          <div className="pc-brand">
            <span className="pc-brand-logo"><img src="/apex_logo_dark.svg" alt="ApexGMV" /></span>
            <span className="pc-brand-tagline">Paid Collaborations</span>
          </div>
          <div className="pc-monthnav">
            {/* Signing settings belong to whoever issues the contracts — not a
                view-only Bob (the PDFs themselves stay downloadable). */}
            {!readOnly && (
              <button className="pc-mn-arrow pc-tpl-btn" title="Contract template — your default contract wording, representative name & signature"
                aria-label="Contract template settings" onClick={() => setContractTplOpen(true)}>
                <i className="bi bi-vector-pen" />
              </button>
            )}
            <button className="pc-mn-arrow" aria-label="Previous month" onClick={() => { setMonth(addMonth(month, -1)); setDrillId(null); }}>‹</button>
            <label className="pc-monthpicker" title="Pick a month">
              <MonthField value={month} onChange={v => { if (v) { setMonth(v); setDrillId(null); } }} />
            </label>
            <button className="pc-mn-arrow" aria-label="Next month" onClick={() => { setMonth(addMonth(month, 1)); setDrillId(null); }}>›</button>
          </div>
        </header>
        )}

        {storeMode === 'local' && (
          <div className="pc-banner">
            <span>💾</span>
            <span>Running in <b>local mode</b> — data is saved only in this browser. To share with your team, connect a new Supabase project in <code>src/collabs/config.js</code> (run <code>collabs-schema.sql</code> first).</span>
          </div>
        )}
        {err && <div className="pc-banner" style={{ background: 'var(--pc-error-bg)', color: 'var(--pc-error-fg)' }}><span>⚠️</span><span>{err}</span></div>}

        {/* A solo page (Dashboard, Client Reports) is one tab on its own, reached
            from the sidebar — no strip to switch away with. */}
        {!soloTab && <div className="pc-tabs">
          {TAB_DEFS.map(t => (
            <button key={t.id} className={`pc-tab ${tab === t.id ? 'active' : ''}`} onClick={() => openTab(t.id)}>
              {t.label}
              {t.id === 'discussions' && needsReplyCount > 0 && <span className="pc-tab-badge">{needsReplyCount}</span>}
            </button>
          ))}
        </div>}

        {/* Name what is actually opening. In solo mode this shell IS one page
            reached from the sidebar (Dashboard / Client Reports / Notes), so
            "your workspace" described something the reader never asked for. */}
        {loading ? <TabLoading label={soloTab ? `Loading ${TAB_LABELS[soloTab] || 'page'}…` : 'Loading your workspace…'} /> : tabSwitching ? (
          /* The incoming tab is being built in the background. Showing its
             skeleton rather than the outgoing tab's table is deliberate: the
             press has to look like it landed somewhere. */
          <TabLoading label={`Opening ${TAB_LABELS[tab] || 'tab'}…`} />
        ) : (
          deferredTab === 'dashboard' ? (

            // The Dashboard route: internal reporting, reached from the sidebar
            // rather than from the workspace tab strip.
            <ReportingView brands={brands} brandById={brandById} creators={creators} month={month} comments={comments} onOpenComments={openComments} />
          ) : deferredTab === 'creators' ? (
            <CreatorsView rows={allCreatorsList}
              onEdit={editCreator} onDelete={removeCreator}
              patchCreatorLocal={patchCreatorLocal} findCodeOwner={findCodeOwner}
              onSetStatus={setCreatorStatus} onToggleVisible={setCreatorPendingVisible}
              contractLinkFor={contractLinkFor} onContractLinkChange={onContractLinkChange}
              creatorNoteCount={creatorNoteCount} onCreatorNotes={openCreatorNotes}
              onCreatorInfo={openCreatorInfo} onManageCategories={readOnly ? null : openCatManager} />
          ) : deferredTab === 'database' ? (
            <CreatorDatabaseView entries={creatorDatabase} categories={dbCategories}
              onAdd={openDirEditor} onEdit={openDirEditor} onDelete={removeDirectoryCreator}
              onAddToProgram={setProgramAdd} deleteGate={directoryDeleteGate}
              onImport={openImport} onShare={openShare} month={month}
              reacher={reacher} onManageCategories={openCatManager} />
          ) : deferredTab === 'performance' ? (
            <PerformanceView brands={brands} creators={creators} brandById={brandById} month={month} reportWeeks={reportWeeks} reportAnchors={reportAnchors} onCreateWeek={createWeeklyReport} onSaveMonthly={saveCreatorMonthly} />
          ) : deferredTab === 'discussions' ? (
            <DiscussionsView comments={comments} brandById={brandById} creators={creators} onOpen={openComments} />
          ) : deferredTab === 'logs' ? (
            <LogsView logs={logs} brandById={brandById} />
          ) : deferredTab === 'notes' ? (
            <NotesBoard brands={brands} brandById={brandById} creators={creators} month={month} />
          ) : deferredTab === 'templates' ? (
            // Fetches its own rows (see the note at the top of that file), so
            // it takes only the workspace data the fill panel needs. Bob's
            // read-only session browses the library; writing is a handler's.
            <MessageTemplates
              brandRows={brandRowsAll} brands={brands} creators={creators} month={month}
              canEdit={!readOnly} myId={profile?.id || ''}
              myName={profile?.full_name || profile?.email || ''}
              isBob={profile?.role === 'bob'}
              contractLinkFor={contractLinkFor}
            />
          ) : deferredTab === 'best' ? (
            // Starred videos across this workspace's brands. Bob's read-only
            // session can browse them but not unstar — handlers curate.
            <BestVideosBoard canEdit={!readOnly} canAdd={!readOnly} reloadKey={bestKey} />
          ) : (
            drillId && drillBrand
              ? <Drilldown
                brand={drillBrand} row={drillRow} month={month} creators={drillCreators}
                allCreators={creators} allBrandMonths={brandMonths} brandNameById={brandNameById}
                onBack={closeDrill}
                onAddCreator={addCreatorHere}
                onEditCreator={editCreator}
                onDeleteCreator={removeCreator}
                onEditBudget={editDrillBudget}
                onFocusProductsChange={readOnly ? null : saveDrillFocusProducts}
                patchCreatorLocal={patchCreatorLocal}
                onSetStatus={setCreatorStatus}
                onToggleVisible={setCreatorPendingVisible}
                contractLinkFor={contractLinkFor} onContractLinkChange={onContractLinkChange}
                commentCount={drillCommentCount}
                onComments={openDrillComments}
                creatorNoteCount={creatorNoteCount} onCreatorNotes={openCreatorNotes}
                onCreatorInfo={openCreatorInfo}
                findCodeOwner={findCodeOwner}
              />
              : <BrandLevel
                rows={brandRows} allRows={brandRowsAll} totals={totals} month={month}
                search={search} setSearch={setSearch}
                onOpen={openBrand}
                onEditBudget={editBrandBudget}
                onAddBrand={addBrand}
                onNotes={openBrandMonthNotes}
                noteCounts={noteCountByBrand}
                onBrandNotes={openBrandKeepNotes}
                onReorder={reorderBrands}
              />
          )
        )}
      </div>

      {brandEditor && (
        <BrandEditor
          editor={brandEditor} month={month} bm={brandEditor.brand?.id ? (bmByKey[`${brandEditor.brand.id}|${month}`] || {}) : {}}
          assignableBrands={assignableBrands} prevSetupFor={prevSetupFor}
          onClose={() => setBrandEditor(null)}
          onSave={(patch) => saveBrandBudget(brandEditor.mode, brandEditor.brand, patch)}
        />
      )}
      {creatorEditor && (
        <CreatorEditor
          editor={creatorEditor} month={month} directory={creatorDirectory} categories={categories}
          brandProducts={creatorEditorProducts}
          onClose={() => setCreatorEditor(null)}
          onSave={(data) => saveCreator(creatorEditor.mode, data)}
        />
      )}
      {dirEditor && (
        <DirectoryCreatorEditor editor={dirEditor} categories={dbCategories}
          onClose={() => setDirEditor(null)} onSave={saveDirectoryCreator} />
      )}
      {dirDelete && (
        <CreatorDeleteModal entry={dirDelete}
          onClose={() => setDirDelete(null)} onConfirm={confirmRemoveDirectory} />
      )}
      {importOpen && (
        <CreatorImportModal
          bankedKeys={bankedKeys} knownKeys={knownKeys} dirIdByKey={dirIdByKey}
          handlerName={handlerName}
          onClose={() => setImportOpen(false)} onImported={reloadDirectory} />
      )}
      {/* Mounted only while open, so it re-reads the links every time rather
          than showing a list another tab has already changed. `canManage` is
          the front-end mirror of the Bob-only write policies. */}
      {shareOpen && (
        <CreatorDbShareModal canManage={profile?.role === 'bob'}
          onClose={() => setShareOpen(false)} />
      )}
      {/* The "?" on a creator row — the Creators Database's own detail popup,
          mounted here rather than inside CreatorsView / Drilldown so BOTH of
          them drive one piece of state, and so each memoised body keeps to a
          single extra (stable) prop. Its actions are the database tab's,
          verbatim: one popup, one set of things you can do from it. */}
      {infoEntry && (
        <CreatorDbDetailModal
          e={infoEntry} reacher={reacherFor(infoEntry, reacher.stats)} reacherLoading={reacher.loading}
          onClose={closeCreatorInfo}
          onEdit={() => { setInfoKey(null); openDirEditor(infoEntry); }}
          onDelete={() => { setInfoKey(null); removeDirectoryCreator(infoEntry); }}
          onAddToProgram={() => { setInfoKey(null); setProgramAdd(infoEntry); }}
          deleteGate={directoryDeleteGate(infoEntry)} />
      )}
      {programAdd && (
        <AddToProgramModal entry={programAdd} brands={brands} brandMonths={brandMonths}
          creators={creators} month={month}
          onClose={() => setProgramAdd(null)} onSave={addCreatorToProgram} />
      )}
      {notesBrand && (
        <NotesDrawer brand={notesBrand.name} brandLogo={notesBrand.logo_url} month={month}
          notes={(bmByKey[`${notesBrand.id}|${month}`] || {}).notes || ''}
          onClose={() => setNotesBrand(null)}
          onSave={(text) => saveNotes(notesBrand.id, text)} />
      )}
      {keepBrand && (
        <BrandNotesDrawer brandId={keepBrand.id} brandName={keepBrand.name}
          brands={brands} brandById={brandById} creators={creators} month={month}
          notes={notes.filter(n => n.brand_id === keepBrand.id)}
          onClose={() => setKeepBrand(null)} onChanged={reloadNotes} />
      )}
      {keepCreator && (
        <CreatorNotesDrawer creator={keepCreator}
          brands={brands} brandById={brandById} creators={creators} month={month}
          notes={notes.filter(n => n.creator_id && creatorNoteKeyById[n.creator_id] === keepCreator.key)}
          // same identity rule as the filter above, so a note re-pointed at
          // another creator drops out of the drawer instead of lingering
          belongs={n => !!n.creator_id && creatorNoteKeyById[n.creator_id] === keepCreator.key}
          onClose={() => setKeepCreator(null)} onChanged={reloadNotes} />
      )}
      {/* global notes — reachable from anywhere in the workspace EXCEPT the
          Notes page, where a floating button opening a notes drawer over the
          notes board is just a second door into the room you are standing in. */}
      {!notesPage && (
        <button className="pc-notesfab" style={notesFabDrag.style} {...notesFabDrag.handlers}
          onClick={() => setAllNotesOpen(true)} title="Notes" aria-label="Open notes">
          <i className="bi bi-journal-text" />
          {dueReminderCount > 0 && <span className="pc-notesfab-badge">{dueReminderCount}</span>}
        </button>
      )}
      {allNotesOpen && (
        <AllNotesDrawer notes={notes} brands={brands} brandById={brandById} creators={creators} month={month}
          viewerRole={profile?.role} viewerIsSuperbob={!!profile?.is_superbob}
          onClose={() => setAllNotesOpen(false)} onChanged={reloadNotes} />
      )}
      {openNote && (
        <NoteEditor editor={{ mode: 'edit', note: openNote }} brands={brands} brandById={brandById} creators={creators} month={month}
          overlayClass="pc-overlay-top"
          readOnly={!(openNote.is_owner ?? (openNote.owner_id === user?.id))}
          onClose={() => setOpenNote(null)} onPersist={persistOpenNote}
          onDelete={() => deleteOpenNote(openNote)} />
      )}
      {contractTplOpen && <ContractTemplateModal onClose={() => setContractTplOpen(false)} />}
      {confirmDel && <ConfirmModal message={confirmDel.message} onYes={confirmDel.onYes} undoable={confirmDel.undoable !== false} onCancel={() => setConfirmDel(null)} />}
      {undo && <UndoToast label={undo.label} onUndo={doUndo} />}
      {commentDrawer && brandById[commentDrawer.brandId] && (
        <CommentsDrawer
          brand={{ id: commentDrawer.brandId, name: brandById[commentDrawer.brandId].name }}
          comments={comments} creators={creators} brandMonths={brandMonths}
          currentName={handlerName} initial={commentDrawer}
          onAdd={addPaidComment} onClose={() => setCommentDrawer(null)}
        />
      )}
      {/* last, so it stacks over a creator editor it was opened from */}
      {catManagerOpen && !readOnly && (
        <CategoryManagerModal catalogue={catCatalogue}
          usage={catUsage}
          onClose={closeCatManager} onChanged={onCategoriesChanged} onEdit={notifyCatEdit} />
      )}
    </div>
    </BestBumpCtx.Provider>
    </CatCatalogueCtx.Provider>
    </CatColorsCtx.Provider>
    </ReadOnlyCtx.Provider>
  );
}

/* ════════════════════════════════════════════════════════════
   Logs tab — brand-scoped activity feed (handler_collab_activity_log):
   who changed a creator's payment status (incl. payments sent + the
   automatic sweep), client "marked payment as done", creator add/remove.
   Every handler assigned to the brand sees the same rows.
════════════════════════════════════════════════════════════ */
const LOG_KINDS = [
  { id: 'all', label: 'All' },
  { id: 'payments', label: 'Payments' },
  { id: 'status', label: 'Status changes' },
  { id: 'client', label: 'Client confirmations' },
  { id: 'codes', label: 'Ad codes' },
  { id: 'roster', label: 'Added / removed' },
];
function logKind(l) {
  if (l.action === 'status_change') return l.new_status === 'paid' ? 'payments' : 'status';
  if (l.action === 'client_paid_marked' || l.action === 'client_paid_unmarked') return 'client';
  if (l.action === 'video_code_invalid' || l.action === 'video_code_valid') return 'codes';
  return 'roster';
}
const LOG_ICON = {
  payments: { icon: 'bi-cash-coin', cls: 'pay' },
  status: { icon: 'bi-arrow-repeat', cls: 'status' },
  client: { icon: 'bi-patch-check', cls: 'client' },
  codes: { icon: 'bi-hash', cls: 'status' },
  roster: { icon: 'bi-person-plus', cls: 'roster' },
};
const logStatusOpt = (v) => STATUS_OPTIONS.find(s => s.value === v) || null;

function LogStatusPill({ value }) {
  const opt = logStatusOpt(value);
  return <span className={`pc-log-st ${opt ? opt.cls : ''}`}>{opt ? opt.label : (value || '—')}</span>;
}

function logDayKey(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function logDayLabel(key) {
  const today = logDayKey(new Date().toISOString());
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  if (key === today) return 'Today';
  if (key === logDayKey(yd.toISOString())) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
const logTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// One log row → a readable sentence. Bold = people/creators; status pills for transitions.
function LogText({ l }) {
  const actor = l.actor_name || 'Someone';
  const creator = <b>{l.creator_name || 'a creator'}</b>;
  if (l.action === 'status_change') {
    const arrow = <span className="pc-log-arrow"><LogStatusPill value={l.old_status} /><i className="bi bi-arrow-right" /><LogStatusPill value={l.new_status} /></span>;
    if (l.auto) return <>Automatic status update — {creator} {arrow}</>;
    if (l.new_status === 'paid') return <><b>{actor}</b> marked {creator}&apos;s payment as sent {arrow}</>;
    return <><b>{actor}</b> changed {creator}&apos;s status {arrow}</>;
  }
  if (l.action === 'client_paid_marked') return <><b>{actor}</b> (client) marked {creator}&apos;s payment as done</>;
  if (l.action === 'client_paid_unmarked') return <><b>{actor}</b> removed the &quot;payment done&quot; mark on {creator}</>;
  if (l.action === 'creator_added') {
    return <><b>{actor}</b> added creator {creator} {l.new_status ? <LogStatusPill value={l.new_status} /> : null}</>;
  }
  if (l.action === 'creator_removed') return <><b>{actor}</b> removed creator {creator}</>;
  if (l.action === 'video_code_invalid') return <><b>{actor}</b> reported an ad code on {creator} as invalid — a new one is needed</>;
  if (l.action === 'video_code_valid') return <><b>{actor}</b> removed the invalid-ad-code report on {creator}</>;
  return <>{creator}</>;
}

/* Memoised — see MEMOISED TAB BODIES at the top of this file. */
const LogsView = React.memo(function LogsViewBody({ logs, brandById }) {
  const [brandFilter, setBrandFilter] = useState('all');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');

  const brandOptions = useMemo(() => {
    const ids = [...new Set(logs.map(l => l.brand_id))];
    return ids
      .map(id => ({ id, name: brandById[id]?.name || 'Unknown brand' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [logs, brandById]);

  const filtered = useMemo(() => logs.filter(l => {
    if (brandFilter !== 'all' && l.brand_id !== brandFilter) return false;
    if (kind !== 'all' && logKind(l) !== kind) return false;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      const hay = `${l.creator_name} ${l.actor_name} ${brandById[l.brand_id]?.name || ''}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [logs, brandFilter, kind, q, brandById]);

  // rows arrive newest-first from the store; group them by (local) day
  const groups = useMemo(() => {
    const m = new Map();
    filtered.forEach(l => {
      const k = logDayKey(l.created_at);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    });
    return [...m.entries()];
  }, [filtered]);

  if (!logs.length) {
    return (
      <div className="pc-card">
        <div className="pc-empty pc-empty-lg">
          <div className="pc-empty-icon">🕘</div>
          <h3>No activity yet</h3>
          <p>Payment-status changes, payments sent, client payment confirmations and creator add/removals across your brands will show up here — including changes made by other handlers of the same brand.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pc-logs-toolbar">
        <div className="pc-logs-kind">
          {LOG_KINDS.map(k => (
            <button key={k.id} className={`pc-logs-kbtn ${kind === k.id ? 'active' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>
          ))}
        </div>
        <select className="pc-input pc-logs-brand" value={brandFilter} onChange={e => setBrandFilter(e.target.value)} aria-label="Filter by brand">
          <option value="all">All brands</option>
          {brandOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="pc-search pc-logs-search" placeholder="Search creator, person or brand…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">🔍</div><h3>Nothing matches</h3><p>No log entries match the current filters.</p></div></div>
      ) : groups.map(([day, rows]) => (
        <div className="pc-card pc-log-day" key={day}>
          <div className="pc-log-day-head">{logDayLabel(day)}<span className="pc-log-day-count">{rows.length}</span></div>
          {rows.map(l => {
            const k = logKind(l);
            const ic = l.action === 'creator_removed' ? { icon: 'bi-person-dash', cls: 'roster' } : LOG_ICON[k];
            return (
              <div className="pc-log-row" key={l.id}>
                <span className={`pc-log-ico ${ic.cls}`}><i className={`bi ${ic.icon}`} /></span>
                <div className="pc-log-body">
                  <div className="pc-log-text"><LogText l={l} /></div>
                  <div className="pc-log-meta">
                    <span className="pc-log-brand">{brandById[l.brand_id]?.name || 'Unknown brand'}</span>
                    {l.month && <span className="pc-log-month">{l.month}</span>}
                    <span className="pc-log-time">{logTime(l.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
});

/* ════════════════════════════════════════════════════════════
   Discussions tab — every comment thread across all brands, grouped by level,
   with a "reply needed" flag (latest message is from the client). Click a thread
   to open its discussion drawer (latest comment highlighted).
════════════════════════════════════════════════════════════ */
const DV_LEVELS = [
  { id: 'all', label: 'All' }, { id: 'brand', label: 'Brand' }, { id: 'program', label: 'Program' },
  { id: 'week', label: 'Week' }, { id: 'creator', label: 'Creator' }, { id: 'insights', label: 'Insights' }, { id: 'kpi', label: 'KPI' },
];
function dvShortDate(iso) {
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
/* Memoised — see MEMOISED TAB BODIES at the top of this file. */
const DiscussionsView = React.memo(function DiscussionsViewBody({ comments, brandById, creators, onOpen }) {
  const [lvl, setLvl] = useState('all');
  const threads = useMemo(() => {
    const map = new Map();
    comments.forEach(c => {
      const k = `${c.brand_id}|${c.target_type}|${c.target_key}`;
      let t = map.get(k);
      if (!t) { t = { key: k, brand_id: c.brand_id, tt: c.target_type, tk: c.target_key, items: [] }; map.set(k, t); }
      t.items.push(c);
    });
    return [...map.values()].map(t => {
      const sorted = t.items.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const last = sorted[sorted.length - 1];
      return { ...t, count: t.items.length, last, needsReply: last.author_type === 'client' };
    }).sort((a, b) => (Number(b.needsReply) - Number(a.needsReply)) || String(b.last.created_at).localeCompare(String(a.last.created_at)));
  }, [comments]);
  const counts = useMemo(() => { const c = { all: threads.length }; threads.forEach(t => { c[t.tt] = (c[t.tt] || 0) + 1; }); return c; }, [threads]);
  const shown = lvl === 'all' ? threads : threads.filter(t => t.tt === lvl);

  const targetLabel = (t) => t.tt === 'brand' ? 'Whole brand' : t.tt === 'insights' ? 'Insights'
    : t.tt === 'kpi' ? `KPI · ${CD_KPIS.find(k => k.id === t.tk)?.label ?? t.tk}`
      : t.tt === 'program' ? `Program · ${monthLabel(t.tk)}`
        : t.tt === 'week' ? `Week · ${rangeShort(t.tk, addDaysISO(t.tk, 6))}`
          : `Creator · ${creators.find(c => c.id === t.tk)?.name ?? t.tk}`;

  if (threads.length === 0) {
    return <div className="pc-card"><div className="pc-empty pc-empty-lg"><div className="pc-empty-icon">💬</div><h3>No discussions yet</h3><p>Comments from clients and your replies show up here, grouped by level. You'll get a notification when a client comments.</p></div></div>;
  }
  return (
    <div>
      <div className="pc-rd-weeks" style={{ marginBottom: 14 }}>
        {DV_LEVELS.filter(l => l.id === 'all' || counts[l.id]).map(l => (
          <button key={l.id} className={`pc-rd-week ${lvl === l.id ? 'active' : ''}`} onClick={() => setLvl(l.id)}>
            {l.label}{counts[l.id] ? <span className="pc-rd-week-n" style={{ marginLeft: 5 }}>{counts[l.id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="pc-card" style={{ padding: 6 }}>
        {shown.map(t => {
          const name = brandById[t.brand_id]?.name || 'Brand';
          return (
            <button key={t.key} className="pc-disc-row" onClick={() => onOpen(t.brand_id, t.tt, t.tk, t.last.id)}>
              <BrandAva name={name} logo={brandById[t.brand_id]?.logo_url}
                style={{ width: 34, height: 34, fontSize: 14, borderRadius: 10, flex: '0 0 auto' }} />
              <div className="pc-disc-main">
                <div className="pc-disc-top">
                  <span className="pc-disc-brand">{name}</span>
                  <span className="pc-disc-tag">{targetLabel(t)}</span>
                </div>
                <div className="pc-disc-prev"><b>{t.last.author_name}:</b> {t.last.body}</div>
              </div>
              <div className="pc-disc-right">
                {t.needsReply && <span className="pc-rd-pill pend">Reply needed</span>}
                <span className="pcc-count">{t.count}</span>
                <span className="pc-disc-time">{dvShortDate(t.last.created_at)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* ════════════════════════════════════════════════════════════
   Discussion drawer — handler-side comment threads for one brand at any level
   (brand / insights / kpi / program / week / creator). Opened from a brand's
   "Discussion" button or a notification click-through (pre-scoped + highlight).
════════════════════════════════════════════════════════════ */
const CD_KPIS = [
  { id: 'active_creators', label: 'Active creators' }, { id: 'videos_posted', label: 'Videos posted' },
  { id: 'pipeline', label: 'In pipeline' }, { id: 'pending_payments', label: 'Pending payments' }, { id: 'gmv', label: 'GMV generated' },
];
const CD_TYPES = [
  { id: 'brand', label: 'Brand' }, { id: 'insights', label: 'Insights' }, { id: 'kpi', label: 'KPI' },
  { id: 'program', label: 'Program' }, { id: 'week', label: 'Week' }, { id: 'creator', label: 'Creator' },
];
function CommentsDrawer({ brand, comments, creators, brandMonths, currentName, initial, onAdd, onClose }) {
  const ro = useRO();   // Bob reads the threads; posting and replying are withdrawn
  const [tt, setTt] = useState(initial.tt || 'brand');
  const [tk, setTk] = useState(initial.tk || '');
  const bComments = useMemo(() => comments.filter(c => c.brand_id === brand.id), [comments, brand.id]);
  const brandCreators = useMemo(() => creators.filter(c => c.brand_id === brand.id), [creators, brand.id]);
  const months = useMemo(() => {
    const set = new Set();
    brandMonths.filter(m => m.brand_id === brand.id).forEach(m => set.add(m.month));
    brandCreators.forEach(c => { const k = monthKey(c.onboarded_on); if (k) set.add(k); });
    return [...set].sort().reverse();
  }, [brandMonths, brandCreators, brand.id]);
  const weeks = useMemo(() => {
    const set = new Set();
    brandCreators.forEach(c => Object.keys((c.monthly || {}).weeks || {}).forEach(k => set.add(k)));
    return [...set].sort();
  }, [brandCreators]);

  const needsKey = tt === 'kpi' || tt === 'program' || tt === 'week' || tt === 'creator';
  const keyOptions = tt === 'kpi' ? CD_KPIS.map(k => ({ value: k.id, label: k.label }))
    : tt === 'program' ? months.map(m => ({ value: m, label: monthLabel(m) }))
      : tt === 'week' ? weeks.map(w => ({ value: w, label: rangeShort(w, addDaysISO(w, 6)) }))
        : tt === 'creator' ? brandCreators.map(c => ({ value: c.id, label: c.name })) : [];

  function pickType(nt) {
    setTt(nt);
    if (nt === 'brand' || nt === 'insights') { setTk(''); return; }
    const opts = nt === 'kpi' ? CD_KPIS.map(k => k.id)
      : nt === 'program' ? months : nt === 'week' ? weeks : brandCreators.map(c => c.id);
    setTk(opts[0] || '');
  }

  const title = tt === 'brand' ? `Whole brand · ${brand.name}`
    : tt === 'insights' ? 'Insights'
      : tt === 'kpi' ? `KPI · ${CD_KPIS.find(k => k.id === tk)?.label ?? ''}`
        : tt === 'program' ? `Program · ${tk ? monthLabel(tk) : ''}`
          : tt === 'week' ? `Week · ${tk ? rangeShort(tk, addDaysISO(tk, 6)) : ''}`
            : `Creator · ${brandCreators.find(c => c.id === tk)?.name ?? ''}`;

  // Existing threads (grouped) for quick navigation.
  const threads = useMemo(() => {
    const m = new Map();
    bComments.forEach(c => { const k = `${c.target_type}|${c.target_key}`; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([k, n]) => { const [t, key] = k.split('|'); return { t, key, n }; });
  }, [bComments]);
  const threadLabel = (t, key) => t === 'brand' ? 'Brand' : t === 'insights' ? 'Insights'
    : t === 'kpi' ? `KPI · ${CD_KPIS.find(x => x.id === key)?.label ?? key}`
      : t === 'program' ? `Program · ${monthLabel(key)}`
        : t === 'week' ? `Week · ${rangeShort(key, addDaysISO(key, 6))}`
          : `Creator · ${brandCreators.find(c => c.id === key)?.name ?? key}`;

  return (
    <div className="pc-drawer-overlay" onClick={onClose}>
      <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="pc-drawer-head">
          <div className="pc-drawer-head-l">
            <BrandAva name={brand.name} logo={brand.logo_url}
              style={{ width: 40, height: 40, fontSize: 18, borderRadius: 12 }} />
            <div>
              <div className="pc-drawer-title">{brand.name}</div>
              <div className="pc-drawer-sub">Discussion{ro ? ' · view only' : ''}</div>
            </div>
          </div>
          <button className="pc-iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pc-drawer-body">
          <div className="pc-rd-weeks" style={{ marginBottom: 10 }}>
            {CD_TYPES.map(t => (
              <button key={t.id} className={`pc-rd-week ${tt === t.id ? 'active' : ''}`} onClick={() => pickType(t.id)}>{t.label}</button>
            ))}
          </div>
          {needsKey && (
            <select className="pcc-input" style={{ marginBottom: 10 }} value={tk} onChange={e => setTk(e.target.value)}>
              <option value="">Select…</option>
              {keyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {(!needsKey || tk) ? (
            <PaidCollabComments
              comments={bComments} targetType={tt} targetKey={tk} title={title}
              mode="authed" currentAuthorName={currentName} readOnly={ro}
              onAdd={(body, name, parentId) => onAdd(brand.id, tt, tk, body, name, parentId)}
              highlightCommentId={initial.highlight} defaultOpen
            />
          ) : <div className="pcc-empty" style={{ padding: 12 }}>Pick a {tt} to view its discussion.</div>}

          {threads.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)', marginBottom: 8 }}>All threads</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {threads.map(th => (
                  <button key={`${th.t}|${th.key}`} className="pc-cd-thread" onClick={() => { setTt(th.t); setTk(th.key); }}>
                    <span>{threadLabel(th.t, th.key)}</span><span className="pcc-count">{th.n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function NotesDrawer({ brand, brandLogo, month, notes, onClose, onSave }) {
  const ro = useRO();
  const [text, setText] = useState(notes || '');
  const [saveState, setSaveState] = useState('idle');
  const debounce = useRef(null);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);
  function change(v) {
    if (ro) return;
    setText(v);
    setSaveState('saving');
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      onSave(v); setSaveState('saved');
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600);
    }, 600);
  }
  return (
    <div className="pc-drawer-overlay" onClick={onClose}>
      <aside className="pc-drawer" onClick={e => e.stopPropagation()}>
        <div className="pc-drawer-head">
          <div className="pc-drawer-head-l">
            <BrandAva name={brand} logo={brandLogo}
              style={{ width: 40, height: 40, fontSize: 18, borderRadius: 12 }} />
            <div>
              <div className="pc-drawer-title">{brand}</div>
              <div className="pc-drawer-sub">Notes · {monthLabel(month)}</div>
            </div>
          </div>
          <button className="pc-iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pc-drawer-body">
          <textarea className="pc-notes-area" autoFocus={!ro} value={text} readOnly={ro} onChange={e => change(e.target.value)}
            placeholder={ro ? 'No notes for this brand & month.' : "Write notes about this brand & month…&#10;&#10;• Deliverables / scope&#10;• Follow-ups & reminders&#10;• Issues, shipping, approvals"} />
        </div>
        <div className="pc-drawer-foot">
          <span className="pc-drawer-hint">{ro ? 'View only' : 'Saves automatically'}</span>
          <span className={`pc-savestate ${saveState === 'saved' ? 'saved' : ''}`}>{saveState === 'saving' ? '⟳ Saving…' : saveState === 'saved' ? '✓ Saved' : ''}</span>
        </div>
      </aside>
    </div>
  );
}

// undoable=false for deletes that commit immediately (no scheduleUndo window).
function ConfirmModal({ message, onYes, onCancel, undoable = true }) {
  return (
    <div className="pc-overlay" onClick={onCancel}>
      <div className="pc-modal pc-modal-confirm" onClick={e => e.stopPropagation()}>
        <div className="pc-confirm-ico">🗑️</div>
        <h3>Delete?</h3>
        <div className="pc-modal-sub">{message}{undoable && <><br />You'll be able to undo for a few seconds.</>}</div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="pc-btn pc-btn-danger" onClick={onYes}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// Asks before a draft is approved or rejected. Portalled to <body> because the
// video panel can sit inside a Bootstrap modal (z 1055) and an animated
// .pc-modal (a transform — a fixed overlay inside it would size to the modal).
function DraftDecisionConfirm({ action, label, url, reason, creator, onYes, onCancel }) {
  const approve = action === 'approved';
  return createPortal(
    <div className="pc-overlay pc-overlay-top" onClick={e => { e.stopPropagation(); onCancel(); }}>
      <div className="pc-modal pc-modal-confirm pc-draftconfirm" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className={`pc-draftconfirm-ico ${approve ? 'ok' : 'no'}`}>
          <i className={`bi ${approve ? 'bi-check-lg' : 'bi-x-lg'}`} />
        </div>
        <h3>{approve ? `Approve draft ${label}?` : `Reject draft ${label}?`}</h3>
        <div className="pc-modal-sub">
          {approve
            ? <>{creator ? <b>{creator}</b> : 'The creator'} can go ahead and post this video.</>
            : <>{creator ? <b>{creator}</b> : 'The creator'} will need to send a new draft for this video.</>}
        </div>
        {url && (
          <a className="pc-draftconfirm-link" href={url} target="_blank" rel="noopener noreferrer" title={url}>
            <span>{url}</span><i className="bi bi-box-arrow-up-right" />
          </a>
        )}
        {!approve && reason && (
          <div className="pc-draftconfirm-reason"><i className="bi bi-chat-left-quote" /><span>{reason}</span></div>
        )}
        <div className="pc-modal-actions">
          <button type="button" className="pc-btn pc-btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className={`pc-btn ${approve ? 'pc-btn-primary pc-draftconfirm-ok' : 'pc-btn-danger'}`} onClick={onYes} autoFocus>
            {approve ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function UndoToast({ label, onUndo }) {
  return (
    <div className="pc-undo">
      <span className="pc-undo-label">{label}</span>
      <button className="pc-undo-btn" onClick={onUndo}>↩ Undo</button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Brand-level table
════════════════════════════════════════════════════════════ */
/* Memoised — see MEMOISED TAB BODIES at the top of this file. */
/* ════════════════════════════════════════════════════════════
   COLUMN SORTING — shared by the Brands table, the Creators tab and the
   Creators Database.

   A column opts in by carrying an `id` (the sort key), `dir` (its NATURAL
   direction — names read A→Z, money and dates biggest-first) and a `get`
   reader. Clicking the active column reverses it; clicking once more CLEARS
   it, which is what hands the Brands table back to its drag order and the
   Creators tab back to the order its sort menu picked. The Database has no
   underlying order to return to, so it keeps its own two-state toggle.
   ‼️ Blanks always sink, in BOTH directions: "no completion date" is not
   earlier than every date, it is unknown, and flipping the arrow should not
   parade the empty rows at the top.
════════════════════════════════════════════════════════════ */
function nextSort(prev, col) {
  const nat = col.dir || 'asc';
  if (!prev || prev.by !== col.id) return { by: col.id, dir: nat };
  if (prev.dir === nat) return { by: col.id, dir: nat === 'asc' ? 'desc' : 'asc' };
  return null;
}
const sortAria = (sort, col) =>
  (sort && sort.by === col.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
const isBlankSortValue = (v) =>
  v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v));
/* cols + {by,dir} + the list's own tiebreak → a comparator, or null when the
   sort names a column this table no longer shows. */
function columnCmp(cols, sort, tie) {
  const col = sort && cols.find(c => c.id === sort.by);
  if (!col || !col.get) return null;
  const sgn = sort.dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const va = col.get(a), vb = col.get(b);
    const ba = isBlankSortValue(va), bb = isBlankSortValue(vb);
    if (ba || bb) return ba && bb ? tie(a, b) : (ba ? 1 : -1);
    const d = col.num ? (Number(va) || 0) - (Number(vb) || 0) : String(va).localeCompare(String(vb));
    return d * sgn || tie(a, b);
  };
}
function SortBtn({ col, sort, onToggle, children = null }) {
  const active = !!sort && sort.by === col.id;
  return (
    <button type="button" onClick={() => onToggle(col)}
      className={`pc-sortbtn ${col.num ? 'pc-num' : ''} ${active ? 'active' : ''}`}
      title={col.title || `Sort by ${col.label}`} aria-label={`Sort by ${col.label}`}>
      {children ?? col.label}
      <i className={`bi ${active ? (sort.dir === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down') : 'bi-arrow-down-up'}`} />
    </button>
  );
}
/* One brand's month flattened for the export file. Lives here rather than in
   lib/brandMonthExport because this is where the month label, the local-date
   formatter and the focus-product parser are; the registry stays pure.
   ‼️ A blank is '' and never 0 — see the header of that file. */
export function brandExportRow(r, month) {
  const bm = r.bm || {};
  const products = focusProductList(bm).map(p => (p.name || p.url || '').trim()).filter(Boolean);
  return {
    brand: r.brand || '',
    client: r.client || '',
    month: monthLabel(month),
    currency: r.currency || 'USD',
    onboardedOn: bm.onboarded_on ? fmtDayLocal(bm.onboarded_on) : '',
    // The column is a fact about an arrangement, so it answers in words. The
    // value is NOT NULL in the database, so there is no third state to carry.
    approval: bm.approval_required ? 'Yes' : 'No',
    // No brand-month row at all means nobody has set this month up — which is
    // not the same as a budget of zero, and the table's own "$0" cannot say so.
    budget: bm.id ? r.budget : '',
    allocated: r.allocated,
    remaining: bm.id ? r.remaining : '',
    usage: r.budget > 0 ? Number(r.usage.toFixed(1)) : '',
    paid: r.paid,
    pendingPay: r.pendingPay,
    pendingCreators: r.pendingCreators,
    creators: r.creators,
    videos: r.videos,
    delivered: r.delivered,
    costPerVideo: r.videos > 0 ? Number(r.costPerVideo.toFixed(2)) : '',
    standardCommission: bm.standard_commission == null ? '' : Number(bm.standard_commission),
    shopAdsCommission: bm.shop_ads_commission == null ? '' : Number(bm.shop_ads_commission),
    contentGuide: (bm.content_guide_url || '').trim(),
    focusProducts: products.join('\n'),
    notes: (bm.notes || '').trim(),
  };
}

/* Brands table columns. `get` reads the row shape built by brandRowsAll(). */
const BT_COLS = [
  { id: 'brand', label: 'Brand', dir: 'asc', get: r => r.brand || '' },
  { id: 'budget', label: 'Budget', dir: 'desc', num: true, get: r => r.budget },
  { id: 'allocated', label: 'Allocated', dir: 'desc', num: true, get: r => r.allocated },
  { id: 'paid', label: 'Paid', dir: 'desc', num: true, get: r => r.paid },
  { id: 'remaining', label: 'Remaining', dir: 'desc', num: true, get: r => r.remaining },
  { id: 'usage', label: 'Usage', dir: 'desc', num: true, get: r => r.usage },
  { id: 'videos', label: 'Videos', dir: 'desc', num: true, get: r => r.videos },
  { id: 'creators', label: 'Creators', dir: 'desc', num: true, get: r => r.creators },
  { id: 'costPerVideo', label: 'Cost/Vid', dir: 'desc', num: true, get: r => r.costPerVideo },
];

export const BrandLevel = React.memo(function BrandLevelBody({ rows, allRows = rows, totals, month, search, setSearch, onOpen, onEditBudget, onAddBrand, onNotes, noteCounts = {}, onBrandNotes, onReorder }) {
  const ro = useRO();
  const [exportOpen, setExportOpen] = useState(false);
  const collected = totals.allocated > 0 ? Math.round((totals.paid / totals.allocated) * 100) : 0;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  /* null = the handler's own drag order, which is what this table has always
     shown and what gets saved per user. A column sort is a VIEW on top of it:
     it never writes an order, and while one is on, dragging is switched off —
     rearranging a list you are not looking at in its saved order would save
     something nobody meant. */
  const [sort, setSort] = useState(null);
  const sortCol = sort && BT_COLS.find(c => c.id === sort.by);
  // "Videos to review": only the brands with draft videos waiting for a
  // decision, most first. Turns itself off once nothing is left to review.
  const [reviewOnly, setReviewOnly] = useState(false);
  const reviewTotal = totals.toReview || 0;
  const reviewOn = reviewOnly && reviewTotal > 0;
  const view = useMemo(() => {
    const cmp = columnCmp(BT_COLS, sort, (a, b) => String(a.brand || '').localeCompare(String(b.brand || '')));
    const base = cmp ? rows.slice().sort(cmp) : rows;
    if (!reviewOn) return base;
    return base.filter(r => r.toReview > 0).sort((a, b) => b.toReview - a.toReview);
  }, [rows, sort, reviewOn]);
  const toggleSort = (col) => setSort(prev => nextSort(prev, col));
  /* Brands with no budget for the month sit in a collapsed group at the
     bottom (the "Hidden" row). Saving a budget moves the row up into the list.
     A search opens the group, so a brand typed into the box is never hidden. */
  const budgeted = useMemo(() => view.filter(r => r.budget > 0), [view]);
  const unbudgeted = useMemo(() => view.filter(r => !(r.budget > 0)), [view]);
  const [hiddenOpen, setHiddenOpen] = useState(() => { try { return localStorage.getItem('ac_pc_nobudget_open') === '1'; } catch { return false; } });
  const toggleHidden = () => setHiddenOpen(v => { const n = !v; try { localStorage.setItem('ac_pc_nobudget_open', n ? '1' : '0'); } catch { } return n; });
  const showHidden = hiddenOpen || !!search.trim() || reviewOn;
  /* Built only while the dialog is open — flattening every brand's month on
     each render of the table would be work for a file nobody has asked for.
     The FILTERED list is `view`, the sorted one, so the file comes out in the
     order the table is showing rather than in the saved drag order. */
  const exportFiltered = useMemo(
    () => (exportOpen ? view.map(r => brandExportRow(r, month)) : []), [exportOpen, view, month]);
  const exportAll = useMemo(
    () => (exportOpen ? allRows.map(r => brandExportRow(r, month)) : []), [exportOpen, allRows, month]);
  function handleDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = budgeted.map(r => r.id);
    const oldI = ids.indexOf(active.id), newI = ids.indexOf(over.id);
    if (oldI < 0 || newI < 0) return;
    onReorder && onReorder(arrayMove(ids, oldI, newI));
  }
  return (
    <>
      <div className="pc-kpis pc-kpis-5">
        <Kpi label="Total Budget" color="#1259C3" value={fmt$(totals.budget)} sub={`${rows.length} brand${rows.length === 1 ? '' : 's'} · ${monthLabel(month)}`} />
        {/* Allocated and what is left of the budget read as one thought — how
            much of the month is committed — so they share a card. The label
            names the halves in order; the slash is what keeps them apart. */}
        <Kpi label="Allocated / Remaining" color="#8B5CF6" pair sub={`${totals.creators} creators · ${totals.remaining < 0 ? 'over budget' : 'budget left'}`}
          // The spaces are load-bearing: a money string has none of its own, so
          // without them the two figures are ONE unbreakable run that spills out
          // of the card between about 1150 and 1300px (measured). With them it
          // wraps at the slash instead, and only when it has to.
          value={<>{fmt$(totals.allocated)}{' '}<span className="pc-kpi-slash">/</span>{' '}<span className={totals.remaining < 0 ? 'pc-kpi-neg' : undefined}>{fmt$(totals.remaining)}</span></>} />
        <Kpi label="Paid" color="#2E7D32" value={fmt$(totals.paid)} sub={`${collected}% paid out`} />
        {/* The slot Remaining used to hold now answers the question a handler
            actually opens this page with: who am I about to owe money to. */}
        <Kpi label="Pending Payment" color={totals.pendingPay > 0 ? '#E65100' : '#7A7A8C'} value={fmt$(totals.pendingPay)}
          sub={totals.pendingCreators > 0
            ? `${totals.pendingCreators} creator${totals.pendingCreators === 1 ? '' : 's'} awaiting payout`
            : 'nothing due'} />
        <Kpi label="Videos" color="#0EA5E9" value={`${totals.delivered}/${totals.videos}`} sub={`${totals.videos > 0 ? Math.round((totals.delivered / totals.videos) * 100) : 0}% completed`} />
      </div>

      <div className="pc-toolbar">
        <input className="pc-search" placeholder="Search brands…" value={search} onChange={e => setSearch(e.target.value)} />
        {sortCol && (
          // Also the explanation for why the drag grips are inert right now.
          <button className="pc-sortchip" onClick={() => setSort(null)}
            title="Back to your own order (and drag to rearrange again)">
            <i className={`bi ${sort.dir === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down'}`} />
            Sorted by {sortCol.label}
            <span className="pc-sortchip-x">✕</span>
          </button>
        )}
        <button type="button" className={`pc-reviewtab ${reviewOn ? 'on' : ''} ${reviewTotal ? 'has' : ''}`}
          aria-pressed={reviewOn} disabled={!reviewTotal}
          title={reviewTotal
            ? (reviewOn ? 'Show every brand again' : 'Show only the brands with draft videos to review')
            : 'No draft videos waiting for review'}
          onClick={() => setReviewOnly(v => !v)}>
          <i className="bi bi-camera-reels" />Videos to review
          <span className="pc-reviewtab-n">{reviewTotal}</span>
        </button>
        {/* Offered under read-only too: taking the figures away is reading,
            not editing — the same call the Creators Database's export makes. */}
        <button className="pc-btn pc-btn-ghost" onClick={() => setExportOpen(true)} disabled={!rows.length}
          title="Export these brands — pick the columns and the file type">
          <i className="bi bi-download" style={{ marginRight: 6 }} />Export
        </button>
        {!ro && <button className="pc-btn pc-btn-primary" onClick={onAddBrand}>+ Brand</button>}
      </div>

      {rows.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">🗂️</div>
          <h3>No collaborations in {monthLabel(month)}</h3>
          <p>{ro ? 'Nothing has been set up for this month yet — pick another month.' : 'Add a brand with its budget to get started, or pick another month.'}</p>
          {!ro && <button className="pc-btn pc-btn-primary" style={{ marginTop: 16 }} onClick={onAddBrand}>+ Add brand</button>}
        </div></div>
      ) : (
        <div className="pc-card pc-list">
          <div className="pc-bt-head">
            {BT_COLS.map(col => (
              <div key={col.id} className={col.num ? 'pc-num' : ''} aria-sort={sortAria(sort, col)}>
                <SortBtn col={col} sort={sort} onToggle={toggleSort} />
              </div>
            ))}
            <div />
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={budgeted.map(r => r.id)} strategy={verticalListSortingStrategy}>
              {budgeted.map(r => <BrandRow key={r.id} r={r} dragDisabled={!!sort || reviewOn} onOpen={() => onOpen(r.id)} onEditBudget={() => onEditBudget(r)} onNotes={() => onNotes(r)} noteCount={noteCounts[r.id] || 0} onBrandNotes={() => onBrandNotes && onBrandNotes(r)} />)}
            </SortableContext>
            {unbudgeted.length > 0 && (
              <button type="button" className={`pc-bt-hiddenrow${showHidden ? ' open' : ''}`} onClick={toggleHidden} aria-expanded={showHidden}>
                <i className={`bi ${showHidden ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                <i className="bi bi-eye-slash" />
                <span>Hidden — no budget in {monthLabel(month)}</span>
                <span className="pc-bt-hiddencount">{unbudgeted.length}</span>
                <span className="pc-bt-hiddenhint">{showHidden ? 'Click to hide' : 'Click to show · add a budget to move a brand up'}</span>
              </button>
            )}
            {showHidden && unbudgeted.length > 0 && (
              <SortableContext items={unbudgeted.map(r => r.id)} strategy={verticalListSortingStrategy}>
                {unbudgeted.map(r => <div key={r.id} className="pc-bt-hidden"><BrandRow r={r} dragDisabled onOpen={() => onOpen(r.id)} onEditBudget={() => onEditBudget(r)} onNotes={() => onNotes(r)} noteCount={noteCounts[r.id] || 0} onBrandNotes={() => onBrandNotes && onBrandNotes(r)} /></div>)}
              </SortableContext>
            )}
          </DndContext>
          <div className="pc-bt-row is-total">
            <div className="pc-brandcell"><span style={{ marginLeft: 4 }}>Totals</span></div>
            <div className="pc-cell pc-num" data-label="Budget">{fmt$(totals.budget)}</div>
            <div className="pc-cell pc-num" data-label="Allocated">{fmt$(totals.allocated)}</div>
            <div className="pc-cell pc-num" data-label="Paid">{fmt$(totals.paid)}</div>
            <div className="pc-cell pc-num" data-label="Remaining" style={totals.remaining < 0 ? { color: 'var(--pc-error-fg)' } : null}>{fmt$(totals.remaining)}</div>
            <div className="pc-cell pc-num" data-label="Usage">{totals.budget > 0 ? Math.round((totals.allocated / totals.budget) * 100) + '%' : '—'}</div>
            <div className="pc-cell pc-num" data-label="Videos">{totals.videos}</div>
            <div className="pc-cell pc-num" data-label="Creators">{totals.creators}</div>
            <div className="pc-cell pc-num pc-cell-hide-mobile" data-label="Cost/Vid">—</div>
            <div className="pc-cell-hide-mobile" />
          </div>
        </div>
      )}
      {/* Mounted only while open, like the Creators Database's: the dialog
          reads its column preference on mount, so keeping it alive would make
          a preference saved in another tab invisible until this one reloads. */}
      {exportOpen && (
        <TableExportModal
          show onHide={() => setExportOpen(false)}
          title={`Export brands — ${monthLabel(month)}`}
          columns={BRAND_EXPORT_COLUMNS} storeKey={BRAND_EXPORT_STORE}
          filtered={exportFiltered} all={exportAll}
          filterLabel={search.trim() ? `Matching “${search.trim()}”` : 'On screen'}
          entryWord="brand" sheet={BRAND_EXPORT_SHEET} slug={BRAND_EXPORT_SLUG} />
      )}
    </>
  );
});

// `pair` = two figures in one value (e.g. allocated / remaining). They need a
// smaller size to survive a five-up grid on a laptop; see .pc-kpi-pair.
function Kpi({ label, value, sub, color, pair = false }) {
  return (
    <div className="pc-kpi">
      <div className="pc-kpi-label"><span className="pc-kpi-dot" style={{ background: color }} />{label}</div>
      <div className={`pc-kpi-value${pair ? ' pc-kpi-pair' : ''}`}>{value}</div>
      <div className="pc-kpi-sub">{sub}</div>
    </div>
  );
}

const DragGrip = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" /></svg>
);

function BrandRow({ r, onOpen, onEditBudget, onNotes, noteCount = 0, onBrandNotes, dragDisabled = false }) {
  const ro = useRO();
  // Usage bar color: below 80% red, 80%+ green.
  const usageColor = r.usage >= 80 ? 'var(--pc-success-fg)' : 'var(--pc-error-fg)';
  function edit(e) { e.stopPropagation(); onEditBudget(); }
  function keepNotes(e) { e.stopPropagation(); onBrandNotes && onBrandNotes(); }
  const keepBtn = (
    <button className={`pc-keepnote-btn ${noteCount > 0 ? 'has' : ''}`} onClick={keepNotes}
      title={noteCount > 0 ? `${noteCount} brand note${noteCount === 1 ? '' : 's'}` : 'Brand notes'} aria-label="Brand notes">
      <i className="bi bi-journal-text" />
      {noteCount > 0 && <span className="pc-keepnote-count">{noteCount}</span>}
    </button>
  );
  /* "This brand approves videos before they go up" (migration 20260895090000).
     A dot beside the name, shown ONLY when the month has it on, so a handler
     scanning the brand list can see which brands have the extra step without
     opening each one. Read straight off the row's own brand-month, which
     brandRows already carries as `bm`.
     ‼️ WORKSPACE-ONLY. This row component is not shared with the client
     portal or the share link (those have their own read-only rows in
     handlerCollabReadonly), so nothing here can reach a client. */
  /* The program's own start date, appended to the row's sub-line rather than
     given a column: it is context for the row, not a figure anyone sorts or
     totals. Only when recorded. Built ONCE — the desktop row and the mobile
     card print the same string, and two copies would be free to drift. */
  const subline = `${r.creators} creator${r.creators === 1 ? '' : 's'} · ${r.delivered}/${r.videos} delivered`
    + (r.bm?.onboarded_on ? ` · ${fmtDayShortLocal(r.bm.onboarded_on)}` : '');
  const apprDot = r.bm?.approval_required ? (
    <span className="pc-appr-dot" title="Client approval required before posting (internal)" aria-label="Client approval required" />
  ) : null;
  const reviewChip = r.toReview > 0 ? (
    <span className="pc-review-chip" title={`${r.toReview} draft video${r.toReview === 1 ? '' : 's'} waiting for review`}>
      <i className="bi bi-camera-reels" />{r.toReview}<span className="pc-review-chip-txt"> to review</span>
    </span>
  ) : null;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.id, disabled: dragDisabled });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, position: isDragging ? 'relative' : undefined };
  const handle = (
    <button type="button" className={`pc-drag ${dragDisabled ? 'is-off' : ''}`} {...attributes} {...listeners}
      onClick={e => e.stopPropagation()}
      title={dragDisabled ? 'Clear the column sort to rearrange brands' : 'Drag to reorder'}
      aria-label="Drag to reorder">{DragGrip}</button>
  );
  return (
    <div ref={setNodeRef} style={style} className={`pc-bt-row ${isDragging ? 'is-dragging' : ''}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <div className="pc-brandcell">
        {handle}
        <BrandAva name={r.brand} logo={r.logo} />
        <div style={{ minWidth: 0 }}>
          <div className="pc-brandname-row"><span className="pc-brandname">{r.brand}{apprDot}</span>{reviewChip}</div>
          <div className="pc-brandsub">{subline}</div>
        </div>
        {keepBtn}
      </div>
      <div className="pc-cell pc-budget-cell" data-label="Budget">
        {ro
          ? <span className="pc-money">{r.budget ? fmt$(r.budget) : '—'}</span>
          : <button className={`pc-budget-btn ${r.budget ? '' : 'empty'}`} onClick={edit} title="Edit budget">{r.budget ? fmt$(r.budget) : '+ set'}</button>}
      </div>
      <div className="pc-cell pc-num" data-label="Allocated"><span className="pc-money">{fmt$(r.allocated)}</span></div>
      <div className="pc-cell pc-num" data-label="Paid"><span className="pc-money">{fmt$(r.paid)}</span></div>
      <div className="pc-cell pc-num" data-label="Remaining"><span className={`pc-money ${r.budget && r.remaining < 0 ? 'neg' : (r.budget ? '' : 'muted')}`}>{r.budget ? fmt$(r.remaining) : '—'}</span></div>
      <div className="pc-cell pc-num" data-label="Usage">
        {r.budget ? (
          <div className="pc-usage">
            <span className="pc-usage-pct" style={{ color: usageColor }}>{Math.round(r.usage)}%</span>
            <div className="pc-usage-track"><div className="pc-usage-fill" style={{ width: Math.min(r.usage, 100) + '%', background: usageColor }} /></div>
          </div>
        ) : <span className="pc-money muted">—</span>}
      </div>
      <div className="pc-cell pc-num" data-label="Videos">{r.videos}</div>
      <div className="pc-cell pc-num" data-label="Creators">{r.creators}</div>
      <div className="pc-cell pc-num" data-label="Cost/Vid"><span className={`pc-money ${r.costPerVideo ? 'pc-cost' : 'muted'}`}>{r.costPerVideo ? fmt$(r.costPerVideo) : '—'}</span></div>
      <div className="pc-chev pc-cell-hide-mobile">›</div>

      {/* ── purpose-built mobile card ── */}
      <div className="pc-mc">
        <div className="pc-mc-head">
          {handle}
          <BrandAva name={r.brand} logo={r.logo} />
          <div className="pc-mc-idblock">
            <div className="pc-mc-name">{r.brand}{apprDot}{reviewChip}</div>
            <div className="pc-mc-subline">{subline}</div>
          </div>
          {keepBtn}
        </div>
        {r.budget ? (
          <div className="pc-mc-usage">
            <div className="pc-usage-track"><div className="pc-usage-fill" style={{ width: Math.min(r.usage, 100) + '%', background: usageColor }} /></div>
            <span className="pc-mc-usage-pct" style={{ color: usageColor }}>{Math.round(r.usage)}% used</span>
          </div>
        ) : null}
        <div className="pc-mc-stats pc-mc-stats-3">
          {ro
            ? <div className="pc-mc-stat"><b>{r.budget ? fmt$(r.budget) : '—'}</b><span>Budget</span></div>
            : <button className="pc-mc-stat pc-mc-stat-btn" onClick={edit}><b>{r.budget ? fmt$(r.budget) : '+ set'}</b><span>Budget</span></button>}
          <div className="pc-mc-stat"><b>{fmt$(r.allocated)}</b><span>Allocated</span></div>
          <div className="pc-mc-stat"><b className={r.budget && r.remaining < 0 ? 'pc-red' : ''}>{r.budget ? fmt$(r.remaining) : '—'}</b><span>Remaining</span></div>
          <div className="pc-mc-stat"><b>{fmt$(r.paid)}</b><span>Paid</span></div>
          <div className="pc-mc-stat"><b>{r.videos}</b><span>Videos</span></div>
          <div className="pc-mc-stat"><b className={r.costPerVideo ? 'pc-red' : ''}>{r.costPerVideo ? fmt$(r.costPerVideo) : '—'}</b><span>Cost / Vid</span></div>
        </div>
      </div>
    </div>
  );
}

// Contract column: one button — the creator's signing link. Everything the old
// PDF / paste-link icons did now lives in its modal (download the PDF, copy the
// link, activate/deactivate, see who signed), and the signed copy is served from
// /sign/<token> instead of a manually pasted Drive URL.
function ContractActions({ c, buildPayload = null, link = null, onLinkChange = null }) {
  const ro = useRO();
  const [shareOpen, setShareOpen] = useState(false);
  const signState = link?.signed_at ? 'signed' : link ? (link.active ? 'sent' : 'off') : '';
  if (!buildPayload) return null;
  if (ro) {
    // Opening ContractShareModal re-issues the signing link (a write), so it is
    // out of reach here. A signed contract is still readable at /sign/<token>.
    if (link?.signed_at) return (
      <span className="pc-contract-actions">
        <a className={`pc-contract-btn pc-signlink ${signState}`} href={`/sign/${link.token}`}
          target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
          title={`Signed by ${link.signer_name || 'the creator'} — open the signed copy`}
          aria-label="Open the signed contract">
          <i className="bi bi-patch-check-fill" />
        </a>
      </span>
    );
    return (
      <span className="pc-contract-actions">
        <span className={`pc-contract-btn pc-signlink ${signState} pc-signlink-ro`}
          title={link ? (link.active ? 'Signing link sent — not signed yet' : 'Signing link deactivated') : 'No contract link yet'}>
          <i className="bi bi-vector-pen" />
        </span>
      </span>
    );
  }
  return (
    <span className="pc-contract-actions">
      <button type="button" className={`pc-contract-btn pc-signlink ${signState}`}
        title={link?.signed_at ? `Signed by ${link.signer_name || 'the creator'}` : link ? 'Contract & signing link' : 'Create the contract signing link'}
        aria-label="Contract signing link"
        onClick={e => { e.stopPropagation(); setShareOpen(true); }}>
        <i className={`bi ${link?.signed_at ? 'bi-patch-check-fill' : 'bi-vector-pen'}`} />
      </button>
      {shareOpen && (
        <ContractShareModal c={c} buildPayload={buildPayload} initialLink={link}
          onChange={onLinkChange} onClose={() => setShareOpen(false)} />
      )}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════
   Contract signing link — auto-generated per creator deal.
   The handler shares /sign/<token> with the creator, who reads the exact
   contract snapshot and signs once (name + drawn/uploaded signature). The
   signature freezes server-side; the handler gets a notification and can
   deactivate / reactivate the link at any time.
════════════════════════════════════════════════════════════ */
function ContractShareModal({ c, buildPayload, initialLink, onChange, onClose }) {
  const [link, setLink] = useState(initialLink && initialLink.token ? initialLink : null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  // §2 deliverable window (days after sample delivery). Blank = automatic rule.
  // Editable here so the handler can set it while generating the contract; saved
  // on the deal and re-snapshotted into the link the creator signs.
  const [days, setDays] = useState(c.deliverable_days != null ? String(c.deliverable_days) : '');
  const autoDays = (parseInt(c.videos_count, 10) || 0) < 6 ? 10 : 14;
  // Per-section editing state (heading + body of the section being edited).
  const [editingId, setEditingId] = useState(null);
  const [draftHeading, setDraftHeading] = useState('');
  const [draftBody, setDraftBody] = useState('');
  // Featured products + content brief, held as a DRAFT: null means "whatever the
  // saved snapshot says". Keeping them out of the payload until Save is what
  // stops a stray chip click from voiding a creator's signature, and stops a
  // deadline save made in between from writing half a pick.
  const [feat, setFeat] = useState(null);
  const [prodName, setProdName] = useState('');
  const [prodUrl, setProdUrl] = useState('');
  /* Commission draft, same shape as `feat`: null until touched, so until then
     the panel simply follows the snapshot. */
  const [comm, setComm] = useState(null);
  // The brand's own months — the catalogue behind the quick picks.
  const [months, setMonths] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Refresh the snapshot the creator will sign from the current deal —
        // unless it is already signed, in which case nothing may change.
        // The handler's own choices — the sections they rewrote, the products
        // and content brief they picked — are NOT deal-derived, so they have to
        // survive the fresh rebuild.
        const existing = await store.getContractLink(c.id);
        const fresh = await buildPayload();
        const payload = carryOverContractChoices(fresh, existing?.payload);
        const row = await store.upsertContractLink(c.id, c.brand_id, payload);
        if (!alive) return;
        setLink(row);
        onChange?.(row);
      } catch (e) {
        if (alive) setErr(e.message || 'Could not create the signing link');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  // Every focus product and content guide recorded for this brand, so the
  // handler can point the contract at one without retyping it. Best-effort —
  // the picker still takes a typed product and a pasted link if this fails.
  useEffect(() => {
    let alive = true;
    store.loadBrandMonthLinks(c.brand_id)
      .then(rows => { if (alive) setMonths(rows); })
      .catch(() => { /* quick picks are a convenience, not a requirement */ });
    return () => { alive = false; };
  }, [c.brand_id]);

  const url = link ? `${window.location.origin}/sign/${link.token}` : '';

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { }
  }

  async function toggleActive() {
    if (!link) return;
    setBusy(true); setErr('');
    try {
      await store.setContractLinkActive(link.id, !link.active);
      const row = { ...link, active: !link.active };
      setLink(row); onChange?.(row);
    } catch (e) { setErr(e.message || 'Could not update the link'); }
    setBusy(false);
  }

  // Editing an ALREADY-SIGNED contract voids the signature — warn once, and let
  // the handler back out. Unsigned links just save normally.
  function confirmRevise() {
    if (!link?.signed_at) return true;
    return window.confirm(
      `This contract is already signed by ${link.signer_name || 'the creator'}. Saving this change will remove that signature and reactivate the link, and ${link.signer_name || 'they'} will need to sign the updated contract again.\n\nContinue?`,
    );
  }

  // Write the new snapshot: a signed link is re-issued (signature voided,
  // reactivated) so the creator re-signs; an unsigned link is a plain upsert.
  async function commitPayload(payload) {
    if (link?.signed_at) return await store.reviseSignedContractLink(link.id, payload);
    return await store.upsertContractLink(c.id, c.brand_id, payload);
  }

  // Save the deadline on the deal and rebuild the snapshot the creator signs.
  async function saveDays() {
    const val = days.trim() ? parseInt(days, 10) || null : null;
    if (!confirmRevise()) return;
    setBusy(true); setErr('');
    try {
      await store.updateCreator(c.id, { deliverable_days: val });
      c.deliverable_days = val; // keep the open row in sync until the next reload
      const payload = { ...carryOverContractChoices(await buildPayload(), link?.payload), deliverableDays: val };
      const row = await commitPayload(payload);
      setLink(row); onChange?.(row);
    } catch (e) { setErr(e.message || 'Could not save the deadline'); }
    setBusy(false);
  }

  // Merge a patch into the signing link's snapshot — the single write path for
  // every customization made here (section wording, featured products, the
  // content brief, the product conjunction), so they all share one confirm
  // prompt, one busy flag and one signature-voiding rule.
  async function persistPayload(patch, what = 'change') {
    if (!confirmRevise()) return false;
    setBusy(true); setErr('');
    try {
      const row = await commitPayload({ ...link.payload, ...patch });
      setLink(row); onChange?.(row);
      return true;
    } catch (e) { setErr(e.message || `Could not save the ${what}`); return false; }
    finally { setBusy(false); }
  }
  const persistSections = (sectionEdits, extraSections) =>
    persistPayload({ sectionEdits, extraSections }, 'section');

  // Open the editor for a section (pre-fill from its current heading + body).
  function startEdit(section) {
    setEditingId(section.id);
    setDraftHeading(section.heading);
    setDraftBody(blocksToText(section.blocks));
  }

  async function saveEdit() {
    const id = editingId;
    if (!id) return;
    const heading = draftHeading.trim();
    const sectionEdits = { ...(link.payload?.sectionEdits || {}) };
    let extraSections = [...(link.payload?.extraSections || [])];
    if (String(id).startsWith('x_')) {
      extraSections = extraSections.map(s => s.id === id ? { ...s, heading, body: draftBody } : s);
    } else {
      sectionEdits[id] = { heading, body: draftBody };
    }
    if (await persistSections(sectionEdits, extraSections)) setEditingId(null);
  }

  async function addSection() {
    const count = link?.payload ? buildContractModel(link.payload).sections.length : 8;
    const id = `x_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const heading = `${count + 1}. New section`;
    const body = 'Describe this section.';
    const extraSections = [...(link.payload?.extraSections || []), { id, heading, body }];
    if (await persistSections(link.payload?.sectionEdits || {}, extraSections)) {
      setEditingId(id); setDraftHeading(heading); setDraftBody(body);
    }
  }

  async function removeSection(id) {
    const extraSections = (link.payload?.extraSections || []).filter(s => s.id !== id);
    if (await persistSections(link.payload?.sectionEdits || {}, extraSections) && editingId === id) setEditingId(null);
  }

  async function resetSection(id) {
    const sectionEdits = { ...(link.payload?.sectionEdits || {}) };
    delete sectionEdits[id];
    if (await persistSections(sectionEdits, link.payload?.extraSections || []) && editingId === id) setEditingId(null);
  }

  /* ── featured products + content brief ──
     §1's "featuring …" line reads the NAMES, §1's reference block and §2's
     "content brief (guide)" link read the URLs. Saving marks them pinned so the
     next rebuild keeps them instead of re-reading the deal. */
  // Every edit goes through the updater form: the draft starts as null ("follow
  // the snapshot"), so a handler firing two chip clicks in one tick must build
  // the second on the first, not on the render closure's copy.
  function setFeatPatch(p) { setFeat(cur => ({ ...(cur || featSaved), ...p })); }
  const editProds = (fn) => setFeat(cur => {
    const base = cur || featSaved;
    return { ...base, prods: fn(base.prods) };
  });
  const addProd = (p) => {
    const k = prodKey(p);
    if (!k) return;
    // A product is one row, however it was reached — the quick picks already
    // hide what is featured, but a typed name can still collide with one.
    editProds(list => list.some(x => prodKey(x) === k) ? list : [...list, { name: p.name || '', url: p.url || '' }]);
  };
  const dropProd = (i) => editProds(list => list.filter((_, j) => j !== i));
  function addTypedProd() {
    const name = prodName.trim(), url = prodUrl.trim();
    if (!name && !url) return;
    // Only http(s) links reach the contract's reference list, so a typed
    // "shop.example/x" would silently vanish along with the box it was typed
    // in. Refuse it instead.
    if (url && !isValidUrl(url)) { setErr('A product link has to start with http:// or https://'); return; }
    setErr('');
    addProd({ name, url });
    setProdName(''); setProdUrl('');
  }

  async function saveFeatured() {
    const guide = featNow.guide.trim();
    const patch = {
      productNames: featNow.prods.map(r => (r.name || '').trim()).filter(Boolean),
      productLinks: featNow.prods.filter(r => isValidUrl(r.url)).map(r => ({ name: (r.name || '').trim(), url: r.url.trim() })),
      productJoin: featNow.join,
      contentGuideUrl: isValidUrl(guide) ? guide : null,
      productsPinned: true,
      guidePinned: true,
    };
    if (await persistPayload(patch, 'products')) setFeat(null);
  }

  // Back to whatever the deal and the brand's month say, and let future
  // rebuilds track them again.
  async function resetFeatured() {
    let fresh;
    try { fresh = await buildPayload(); }
    catch (e) { setErr(e.message || 'Could not read the deal'); return; }
    const patch = {
      productNames: fresh.productNames || [],
      productLinks: fresh.productLinks || [],
      contentGuideUrl: fresh.contentGuideUrl || null,
      productJoin: 'or',
      productsPinned: false,
      guidePinned: false,
    };
    if (await persistPayload(patch, 'products')) setFeat(null);
  }

  /* Commission rates. They reach the contract through the brand's month, but a
     month with none set would leave §3 and §5 silent — so they can be stated
     here as well, which pins them onto this contract's snapshot exactly the way
     a hand-picked product does. */
  async function saveCommission() {
    const std = pctValue(commNow.std), ads = pctValue(commNow.ads);
    if (badPct(std) || badPct(ads)) { setErr('A commission is a percentage between 0 and 100.'); return; }
    setErr('');
    if (await persistPayload({ standardCommission: std, shopAdsCommission: ads, commissionPinned: true }, 'commission')) setComm(null);
  }
  // Back to whatever the deal's month says, and let future rebuilds track it.
  async function resetCommission() {
    let fresh;
    try { fresh = await buildPayload(); }
    catch (e) { setErr(e.message || 'Could not read the deal'); return; }
    const patch = {
      standardCommission: fresh.standardCommission ?? null,
      shopAdsCommission: fresh.shopAdsCommission ?? null,
      commissionPinned: false,
    };
    if (await persistPayload(patch, 'commission')) setComm(null);
  }

  // Download the agreement — the executed copy once signed (the list query omits
  // the signature blob, so refetch the full row), otherwise the blank one.
  async function download() {
    setBusy(true); setErr('');
    try {
      const { downloadCreatorContract } = await import('./contractPdf');
      if (link?.signed_at) {
        const full = await store.getContractLink(c.id);
        await downloadCreatorContract({
          ...(full?.payload || {}),
          creatorSignatureDataUrl: full?.signer_signature || null,
          creatorSignedName: full?.signer_name || '',
          creatorSignedAt: full?.signed_at || null,
        });
      } else {
        await downloadCreatorContract(link?.payload || await buildPayload());
      }
    } catch (e) { setErr(e.message || 'Could not build the PDF'); }
    setBusy(false);
  }

  // The exact input the creator sees — the stored snapshot plus any signature.
  const previewInput = link?.payload
    ? { ...link.payload, creatorSignatureDataUrl: link.signer_signature || null, creatorSignedName: link.signer_name || '', creatorSignedAt: link.signed_at || null }
    : null;
  // Deal variables shown on the left, resolved the same way the contract fills them.
  const vars = previewInput ? contractVariables(previewInput, autoDays) : [];
  // Section list for the sidebar + the editing API handed to ContractDoc.
  const signed = !!link?.signed_at;
  const sectionList = previewInput ? buildContractModel(previewInput).sections : [];
  const brandName = previewInput?.brandName || 'the brand';
  // Saved vs draft. `feat` stays null until the handler touches the picker, so
  // until then the panel simply follows the snapshot.
  const featSaved = {
    prods: payloadProducts(link?.payload),
    join: link?.payload?.productJoin === 'or' ? 'or' : 'and',
    guide: link?.payload?.contentGuideUrl || '',
  };
  const featNow = feat || featSaved;
  const featDirty = !!feat && JSON.stringify(feat) !== JSON.stringify(featSaved);
  const featPinned = !!(link?.payload?.productsPinned || link?.payload?.guidePinned);
  // Quick picks: this deal's own products first, then everything the brand has
  // on record, each minus what is already featured.
  const featKeys = new Set(featNow.prods.map(prodKey));
  const dealPicks = creatorProducts(c).filter(p => prodKey(p) && !featKeys.has(prodKey(p)));
  const pickSeen = new Set([...featKeys, ...dealPicks.map(prodKey)]);
  const brandPicks = [];
  months.forEach(m => focusProductList(m).forEach(p => {
    const k = prodKey(p);
    if (k && !pickSeen.has(k)) { pickSeen.add(k); brandPicks.push(p); }
  }));
  // A product's state for the colour: paused on its NEWEST month (rows come
  // newest first) wins, else the latest stock answer. null = nothing known.
  const pausedKeys = new Set();
  const stateSeen = new Set();
  months.forEach(m => focusProductList(m).forEach(p => {
    const k = stockKey(p.name, p.url);
    if (!k || stateSeen.has(k)) return;
    stateSeen.add(k);
    if (p.paused) pausedKeys.add(k);
  }));
  const prodTone = (p) => (pausedKeys.has(stockKey(p.name, p.url)) ? 'paused' : '');
  const toneTip = (p) => (prodTone(p) === 'paused' ? 'Paused by the handler' : '');
  const hasTones = [...featNow.prods, ...dealPicks, ...brandPicks].some(p => prodTone(p));
  const guideSeen = new Set();
  const guidePicks = [];
  months.forEach(m => {
    const u = (m.content_guide_url || '').trim();
    if (isValidUrl(u) && !guideSeen.has(u)) { guideSeen.add(u); guidePicks.push({ month: m.month, url: u }); }
  });
  const commSaved = {
    std: link?.payload?.standardCommission != null ? String(link.payload.standardCommission) : '',
    ads: link?.payload?.shopAdsCommission != null ? String(link.payload.shopAdsCommission) : '',
  };
  const commNow = comm || commSaved;
  const commDirty = !!comm && JSON.stringify(comm) !== JSON.stringify(commSaved);
  const commPinned = !!link?.payload?.commissionPinned;
  const commStated = commSaved.std !== '' || commSaved.ads !== '';
  const commBad = badPct(pctValue(commNow.std)) || badPct(pctValue(commNow.ads));
  const setCommPatch = (p) => setComm(cur => ({ ...(cur || commSaved), ...p }));
  /* Quick picks: the brand's own months that state a rate, newest first —
     the same "Recorded for <brand>" idea as the product and guide pickers. */
  const commPicks = months
    .filter(m => m.standard_commission != null || m.shop_ads_commission != null)
    .slice(0, 4);
  // §3 and §5 are where these land, and rewriting a section freezes its wording.
  const frozenComm = sectionList.filter(s => s.edited && (s.id === 'compensation' || s.id === 'brand_resp')).map(s => s.heading);
  // §1 and §2 are where these values land, and rewriting a section freezes its
  // wording — so after that, changing a product here would appear to do nothing.
  const frozenHeads = sectionList.filter(s => s.edited && (s.id === 'purpose' || s.id === 'deliverables')).map(s => s.heading);
  const editApi = {
    editingId, draftHeading, draftBody,
    onHeading: setDraftHeading, onBody: setDraftBody,
    start: startEdit, save: saveEdit, cancel: () => setEditingId(null),
    add: addSection, remove: removeSection, reset: resetSection,
    busy, locked: false, // a signed contract is still editable — saving voids the signature
  };

  /* ‼️ A REACT PORTAL STILL BUBBLES THROUGH THE REACT TREE, and this modal is
     rendered from inside a creator ROW — `.pc-ct-row` in the drilldown and
     `tr.pc-cv-row` in the Creators tab, both of which are `role="button"` with
     their own Enter handler. So pressing Enter in any field here (a product
     name, a commission, the deadline) reached the row and opened the creator's
     video/ad-code panel — or the deal editor — underneath the open contract.
     The same path let a backdrop click toggle the row on its way out.
     Every event this modal does not itself consume stops at its root. */
  const stop = (e) => e.stopPropagation();
  return createPortal(
    <div className="pc-overlay" onClick={e => { e.stopPropagation(); onClose(); }}
      onKeyDown={stop} onKeyUp={stop}>
      <div className="pc-modal pc-cdoc-modal" onClick={e => e.stopPropagation()}>
        <div className="pc-cdoc-modal-head">
          <div>
            <h3>Contract signing link</h3>
            <div className="pc-modal-sub">{c.name} — the creator signs online, no account needed</div>
          </div>
          <button className="pc-cdoc-close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>

        {loading ? <div className="pc-cdoc-loading"><div className="pc-spinner" /></div> : (
          <div className="pc-cdoc-modal-grid">
            {/* LEFT — variables & controls */}
            <div className="pc-cdoc-side">
              {link?.signed_at ? (
                <div className="pc-signed-box">
                  <i className="bi bi-patch-check-fill" />
                  <div>
                    <b>Signed by {link.signer_name || 'the creator'}</b>
                    <div className="pc-signed-sub">{new Date(link.signed_at).toLocaleString()}</div>
                  </div>
                </div>
              ) : (
                <div className={`pc-signstate ${link?.active ? 'on' : 'off'}`}>
                  <i className={`bi ${link?.active ? 'bi-broadcast' : 'bi-slash-circle'}`} />
                  {link?.active ? 'Link is active — waiting for the creator to sign' : 'Link is deactivated — the creator can no longer open it'}
                </div>
              )}

              {signed && (
                <div className="pc-cdoc-warn">
                  <i className="bi bi-exclamation-triangle-fill" />
                  <div>Editing any section or the deadline removes this signature and reactivates the link. {link.signer_name || 'The creator'} will need to sign the updated contract again.</div>
                </div>
              )}

              <div className="pc-cdoc-side-sec">
                <div className="pc-cdoc-side-h">Contract variables</div>
                <div className="pc-cdoc-vars">
                  {vars.map(v => (
                    <div className="pc-cdoc-var" key={v.label}>
                      <span className="pc-cdoc-var-l">{v.label}</span>
                      {v.href
                        ? <a className="pc-cdoc-var-v" href={v.href} target="_blank" rel="noreferrer">{v.value}</a>
                        : <span className={`pc-cdoc-var-v${v.muted ? ' muted' : ''}`}>{v.value}</span>}
                    </div>
                  ))}
                </div>
                <div className="pc-sig-hint">These come from the creator's deal. Edit them on the creator card; the contract on the right updates to match.</div>
              </div>

              {/* Featured products + the content brief they follow. Both feed
                  §1 and §2, so they are chosen here rather than only inherited
                  from the deal. Gated on the snapshot: every action writes
                  through link.payload. */}
              {previewInput && (
              <div className="pc-cdoc-side-sec">
                <div className="pc-cdoc-side-h">
                  Products &amp; content brief
                  {featPinned && <span className="pc-cdoc-side-hint">chosen here</span>}
                </div>

                <div className="pc-prodbox">
                  {featNow.prods.length > 0 ? (
                    <div className="pc-prodchips">
                      {featNow.prods.map((p, i) => (
                        <span className={`pc-prodchip sel ${prodTone(p) ? `tone-${prodTone(p)}` : ''}`} key={`${prodKey(p)}-${i}`} title={`${p.url || p.name} — ${toneTip(p)}`}>
                          <span className="pc-prodchip-dot" />
                          <span className="pc-prodchip-name">{p.name || p.url}</span>
                          {p.url && <i className="bi bi-link-45deg pc-prodchip-link" title={p.url} />}
                          <button type="button" className="pc-prodchip-x" onClick={() => dropProd(i)} title="Remove">×</button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="pc-sig-hint">No product named — §1 will read “{brandName} products”.</div>
                  )}

                  {dealPicks.length > 0 && (
                    <div className="pc-prodpick">
                      <span className="pc-prodpick-l">On this deal</span>
                      <div className="pc-prodchips">
                        {dealPicks.map((p, i) => (
                          <button type="button" className={`pc-prodchip add ${prodTone(p) ? `tone-${prodTone(p)}` : ''}`} key={i} onClick={() => addProd(p)}
                            title={`${p.url || p.name} — ${toneTip(p)}`}>+ {p.name || p.url}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasTones && (
                    <div className="pc-prodtone-legend">
                      <span><i className="tone-paused" />Paused</span>
                    </div>
                  )}
                  {brandPicks.length > 0 && (
                    <div className="pc-prodpick">
                      <span className="pc-prodpick-l">Recorded for {brandName}</span>
                      <div className="pc-prodchips">
                        {brandPicks.map((p, i) => (
                          <button type="button" className={`pc-prodchip add ${prodTone(p) ? `tone-${prodTone(p)}` : ''}`} key={i} onClick={() => addProd(p)}
                            title={`${p.url || p.name} — ${toneTip(p)}`}>+ {p.name || p.url}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pc-cdoc-prodnew">
                    <input className="pc-input" placeholder="Product name" value={prodName}
                      onChange={e => setProdName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTypedProd(); } }} />
                    <div className="pc-multirow">
                      <input className="pc-input" placeholder="https://… product page (optional)" value={prodUrl}
                        onChange={e => setProdUrl(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTypedProd(); } }} />
                      <button type="button" className="pc-prodadd" onClick={addTypedProd} title="Add this product"
                        disabled={!prodName.trim() && !prodUrl.trim()}>+</button>
                    </div>
                  </div>

                  {featNow.prods.length > 1 && (
                    <div className="pc-cdoc-join">
                      <span className="pc-prodpick-l">Join the last two with</span>
                      <div className="pc-cdoc-joinseg">
                        {['and', 'or'].map(w => (
                          <button type="button" key={w} className={`pc-cdoc-joinbtn${featNow.join === w ? ' active' : ''}`}
                            onClick={() => setFeatPatch({ join: w })}>{w}</button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <label className="pc-cdoc-flabel">Content brief (guide) link</label>
                <input className="pc-cdoc-finput" placeholder="https://…" value={featNow.guide}
                  onChange={e => setFeatPatch({ guide: e.target.value })} />
                {guidePicks.length > 0 && (
                  <div className="pc-prodchips pc-cdoc-guidepicks">
                    {guidePicks.map(g => (
                      <button type="button" className={`pc-prodchip add${featNow.guide.trim() === g.url ? ' on' : ''}`}
                        key={g.url} onClick={() => setFeatPatch({ guide: g.url })} title={g.url}>
                        {featNow.guide.trim() === g.url ? '✓' : '+'} {monthLabel(g.month)}
                      </button>
                    ))}
                  </div>
                )}

                <div className="pc-cdoc-editactions">
                  {featPinned && <button type="button" className="pc-cdoc-textbtn" onClick={resetFeatured} disabled={busy}>Reset to the deal</button>}
                  {feat && <button type="button" className="pc-cdoc-textbtn" onClick={() => setFeat(null)} disabled={busy}>Cancel</button>}
                  <button type="button" className="pc-btn pc-btn-primary pc-btn-sm" onClick={saveFeatured} disabled={busy || !featDirty}>
                    {busy ? 'Saving…' : featDirty ? 'Save' : 'Saved'}
                  </button>
                </div>
                <div className="pc-sig-hint">
                  Names fill §1's “featuring …” line. Links become §1's reference list, and the brief link is what §2 points at.
                </div>
                {frozenHeads.length > 0 && (
                  <div className="pc-cdoc-warn">
                    <i className="bi bi-exclamation-triangle-fill" />
                    <div>
                      {frozenHeads.join(' and ')} {frozenHeads.length > 1 ? 'were' : 'was'} rewritten by hand and {frozenHeads.length > 1 ? 'keep' : 'keeps'} that wording,
                      so changes here will not show up there. Reset {frozenHeads.length > 1 ? 'them' : 'it'} under Sections to pick these values up again.
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* Commission rates — §3 quotes them, §5 promises them. Shown even
                  when the month states none, because "not stated" is exactly the
                  case a handler needs to be able to fix from here. */}
              {previewInput && (
              <div className="pc-cdoc-side-sec">
                <div className="pc-cdoc-side-h">
                  Commission rates
                  {commPinned && <span className="pc-cdoc-side-hint">chosen here</span>}
                </div>

                {!commStated && !comm && (
                  <div className="pc-cdoc-note">
                    <i className="bi bi-info-circle" />
                    <div>No commission is recorded for this deal's month, so §3 and §5 say nothing about it. Add the rates below to put them in this contract.</div>
                  </div>
                )}

                <div className="pc-cdoc-comm2">
                  <div>
                    <label className="pc-cdoc-flabel">Standard %</label>
                    <input className="pc-cdoc-finput" type="number" inputMode="decimal" min="0" max="100" step="0.1"
                      placeholder="not stated" value={commNow.std} onChange={e => setCommPatch({ std: e.target.value })} />
                  </div>
                  <div>
                    <label className="pc-cdoc-flabel">Shop ads %</label>
                    <input className="pc-cdoc-finput" type="number" inputMode="decimal" min="0" max="100" step="0.1"
                      placeholder="not stated" value={commNow.ads} onChange={e => setCommPatch({ ads: e.target.value })} />
                  </div>
                </div>

                {commPicks.length > 0 && (
                  <div className="pc-prodpick">
                    <span className="pc-prodpick-l">Recorded for {brandName}</span>
                    <div className="pc-prodchips">
                      {commPicks.map(m => {
                        const std = m.standard_commission != null ? String(m.standard_commission) : '';
                        const ads = m.shop_ads_commission != null ? String(m.shop_ads_commission) : '';
                        const on = commNow.std === std && commNow.ads === ads;
                        return (
                          <button type="button" key={m.month} className={`pc-prodchip add${on ? ' on' : ''}`}
                            onClick={() => setCommPatch({ std, ads })}
                            title={`${std ? `Standard ${std}%` : 'no standard rate'} · ${ads ? `Shop ads ${ads}%` : 'no shop ads rate'}`}>
                            {on ? '✓' : '+'} {monthShort(m.month)} · {[std && `${std}%`, ads && `${ads}%`].filter(Boolean).join(' / ')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {commBad && <div className="pc-formerr">A commission is a percentage between 0 and 100. Leave a box empty to say nothing about it.</div>}

                <div className="pc-cdoc-editactions">
                  {commPinned && <button type="button" className="pc-cdoc-textbtn" onClick={resetCommission} disabled={busy}>Reset to the month</button>}
                  {comm && <button type="button" className="pc-cdoc-textbtn" onClick={() => setComm(null)} disabled={busy}>Cancel</button>}
                  <button type="button" className="pc-btn pc-btn-primary pc-btn-sm" onClick={saveCommission} disabled={busy || !commDirty || commBad}>
                    {busy ? 'Saving…' : commDirty ? 'Save' : 'Saved'}
                  </button>
                </div>
                <div className="pc-sig-hint">
                  §3 quotes these as what the Creator earns on sales; §5 is the Brand's undertaking to keep them active. An empty box is left out of both — it is not a 0%.
                </div>
                {frozenComm.length > 0 && (
                  <div className="pc-cdoc-warn">
                    <i className="bi bi-exclamation-triangle-fill" />
                    <div>
                      {frozenComm.join(' and ')} {frozenComm.length > 1 ? 'were' : 'was'} rewritten by hand and {frozenComm.length > 1 ? 'keep' : 'keeps'} that wording,
                      so changes here will not show up there. Reset {frozenComm.length > 1 ? 'them' : 'it'} under Sections to pick these values up again.
                    </div>
                  </div>
                )}
              </div>
              )}

              {sectionList.length > 0 && (
                <div className="pc-cdoc-side-sec">
                  <div className="pc-cdoc-side-h">
                    Sections
                    <span className="pc-cdoc-side-hint">tap to edit</span>
                  </div>
                  <div className="pc-cdoc-seclist">
                    {sectionList.map(s => (
                      <button type="button" key={s.id}
                        className={`pc-cdoc-secrow${editingId === s.id ? ' active' : ''}`}
                        disabled={busy}
                        onClick={() => startEdit(s)}>
                        <span className="pc-cdoc-secrow-t">{s.heading}</span>
                        {s.custom
                          ? <span className="pc-cdoc-tag custom">Custom</span>
                          : s.edited ? <span className="pc-cdoc-tag edited">Edited</span> : null}
                        <i className="bi bi-pencil pc-cdoc-secrow-ico" />
                      </button>
                    ))}
                  </div>
                  <button type="button" className="pc-cdoc-addbtn" onClick={addSection} disabled={busy}>
                    <i className="bi bi-plus-lg" /> Add a section
                  </button>
                </div>
              )}

              <div className="pc-field">
                <label>Deliverable deadline (days after sample delivery)</label>
                <div className="pc-linkrow">
                  <input className="pc-input" type="number" min="1" inputMode="numeric"
                    placeholder={`auto — ${autoDays} days`} value={days} onChange={e => setDays(e.target.value)} />
                  <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={saveDays} disabled={busy}>Save</button>
                </div>
                <div className="pc-sig-hint">Contract §2. Leave blank for the automatic rule ({autoDays} days for this deal).</div>
              </div>

              <div className="pc-field">
                <label>Shareable link</label>
                <div className="pc-linkrow">
                  <input className="pc-input" readOnly value={url} onFocus={e => e.target.select()} />
                  <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
                  <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => window.open(url, '_blank')}>Open</button>
                </div>
                <div className="pc-sig-hint">Send this to {c.name || 'the creator'}. They read the agreement, sign once and download their copy — the signature can never be changed afterwards.</div>
              </div>

              {err && <div className="pc-formerr">{err}</div>}
            </div>

            {/* RIGHT — full contract, section by section (editable) */}
            <div className="pc-cdoc-preview">
              {previewInput
                ? <ContractDoc input={previewInput} edit={editApi} />
                : <div className="pc-cdoc-empty">Preparing the contract…</div>}
            </div>
          </div>
        )}

        <div className="pc-modal-actions">
          {link && (
            <button className="pc-btn pc-btn-ghost" onClick={toggleActive} disabled={busy}>
              {link.active ? 'Deactivate link' : 'Activate link'}
            </button>
          )}
          <button className="pc-btn pc-btn-ghost" onClick={download} disabled={busy || loading}>
            {link?.signed_at ? 'Download signed PDF' : 'Download PDF'}
          </button>
          <button className="pc-btn pc-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* Re-snapshotting the contract re-reads the DEAL, but a handler's own choices —
   the sections they rewrote, the products they picked, the content brief they
   pointed at, the "and"/"or" between product names — are not deal-derived. Every
   rebuild has to carry them across or opening the modal (or saving the deadline)
   would quietly revert them. One helper, so no rebuild path can forget one. */
function carryOverContractChoices(fresh, keep) {
  if (!keep) return fresh;
  return {
    ...fresh,
    sectionEdits: keep.sectionEdits,
    extraSections: keep.extraSections,
    productJoin: keep.productJoin,
    ...(keep.productsPinned
      ? { productsPinned: true, productNames: keep.productNames || [], productLinks: keep.productLinks || [] }
      : {}),
    ...(keep.guidePinned ? { guidePinned: true, contentGuideUrl: keep.contentGuideUrl ?? null } : {}),
    ...(keep.commissionPinned
      ? { commissionPinned: true, standardCommission: keep.standardCommission ?? null, shopAdsCommission: keep.shopAdsCommission ?? null }
      : {}),
  };
}

/* The payload keeps featured products as two parallel lists — names (which §1's
   "featuring …" line reads) and links (which §1's reference block reads) — so
   the picker has to rebuild one row per product out of them. A lone nameless
   link beside a lone unlinked name is the shape `buildContractModel` already
   treats as ONE product, so pair them here too rather than showing two rows. */
function payloadProducts(p) {
  const names = (p?.productNames || []).filter(Boolean).map(String);
  const links = (p?.productLinks || []).filter(x => x && x.url);
  const byName = new Map(links.filter(x => x.name).map(x => [String(x.name).trim().toLowerCase(), x.url]));
  const rows = names.map(n => ({ name: n, url: byName.get(n.trim().toLowerCase()) || '' }));
  if (rows.length === 1 && !rows[0].url && links.length === 1 && !links[0].name) rows[0].url = links[0].url;
  const used = new Set(rows.map(r => r.url).filter(Boolean));
  links.forEach(l => { if (!used.has(l.url)) rows.push({ name: l.name || '', url: l.url }); });
  return rows;
}

// Flatten a contract payload into the labelled variable rows shown on the left
// of the signing-link modal — the same values the agreement substitutes.
function contractVariables(input, autoDays) {
  const f = buildContractModel(input).facts;
  const rows = [
    { label: 'Brand', value: f.brand },
    { label: 'Creator', value: input.creatorName || '—', muted: !input.creatorName },
    { label: 'TikTok', value: f.username ? `@${f.username}` : '—', muted: !f.username },
    { label: 'Deal amount', value: f.amountTxt },
    { label: 'Videos', value: f.count > 0 ? String(f.count) : 'Not set', muted: !(f.count > 0) },
    { label: 'Effective date', value: f.dateTxt },
    { label: 'Deadline', value: f.deadlineDays != null ? `${f.deadlineDays} days` : `Auto (${autoDays} days)`, muted: f.deadlineDays == null },
    { label: 'Payment method', value: f.method },
    { label: 'Brand rep', value: f.repName || 'Not set', muted: !f.repName },
  ];
  return rows;
}

// Handler's contract-template settings (rep name + signature) for the PDF.
// Fetched fresh per download — always current, no plumbing through row props.
// Failures degrade to an unsigned contract rather than blocking the download.
async function contractTemplatePayload() {
  try {
    const s = await store.getContractSettings();
    if (!s) return {};
    let signatureDataUrl = null;
    if (s.signature_url) {
      try {
        const blob = await (await fetch(s.signature_url)).blob();
        signatureDataUrl = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(null);
          fr.readAsDataURL(blob);
        });
      } catch { }
    }
    // The user's default wording seeds every NEW contract; an existing link
    // keeps its own edits (carryOverContractChoices).
    const t = s.template || {};
    const hasEdits = t.sectionEdits && Object.keys(t.sectionEdits).length > 0;
    const hasExtra = Array.isArray(t.extraSections) && t.extraSections.length > 0;
    return {
      repName: s.rep_name || '', signatureDataUrl,
      ...(hasEdits ? { sectionEdits: t.sectionEdits } : {}),
      ...(hasExtra ? { extraSections: t.extraSections } : {}),
    };
  } catch { return {}; }
}

// Contract column — fill the standard agreement template from the deal row.
// Featured products: the creator's own list, else the month's focus products
// (passed by the Drilldown; the Creators tab has no brand-month in scope).
// Product page links + the month's content guide ride along as clickable
// reference links when set.
async function contractPayloadFor(c, brandName, opts = {}) {
  const own = creatorProducts(c);
  // A product the handler PAUSED on the month is not offered to a new contract
  // by default; it can still be picked by hand in the contract sidebar.
  const focus = (opts.focusProducts || []).filter(p => !p.paused);
  const prodNames = own.map(p => p.name).filter(Boolean);
  // Links follow the same priority as the names; fall back to the month's
  // focus-product links when the chosen list carries none.
  let productLinks = (own.length ? own : focus).filter(p => isValidUrl(p.url));
  if (!productLinks.length) productLinks = focus.filter(p => isValidUrl(p.url));
  const accounts = tiktokAccounts(c.tiktok_handle);
  return {
    ...(await contractTemplatePayload()),
    brandName: brandName || 'Brand',
    creatorName: c.name || '',
    username: accounts[0] ? accounts[0].handle.replace(/^@/, '') : (c.name || ''),
    amount: Number(c.amount) || 0,
    currency: opts.currency || 'USD',
    videosCount: parseInt(c.videos_count, 10) || 0,
    deliverableDays: c.deliverable_days || null,
    // §2's pre-approval / originality / posting-schedule clauses (version 2). A flag on the snapshot, not
    // unconditional wording, so a contract already signed (whose payload is
    // frozen) keeps reading exactly what the creator agreed to.
    contentRules: 2,
    effectiveDate: c.onboarded_on || null,
    productNames: prodNames.length ? prodNames : focus.map(p => p.name).filter(Boolean),
    productLinks,
    // A new contract features its products as alternatives ("A or B"). Stamped
    // on the snapshot rather than changed in contractPdf's fallback, because
    // older snapshots carry no productJoin and were signed reading "and".
    productJoin: 'or',
    contentGuideUrl: isValidUrl(opts.contentGuideUrl) ? opts.contentGuideUrl : null,
    /* The month's commission rates (migration 20260892090000). Undefined stays
       undefined — "not stated" — and the agreement then says nothing about
       commission at all; the handler can state them in the contract modal. */
    standardCommission: opts.standardCommission ?? null,
    shopAdsCommission: opts.shopAdsCommission ?? null,
  };
}

/* The ⋮ on a focus-product chip in the drilldown: Pause / Resume and Dismiss
   (remove from this month's list). Writes go through the month's
   focus_product_url, the same field the Edit-budget popup saves. */
function FocusChipMenu({ paused, label, onTogglePause, onDismiss }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <span className="pc-fchip-menu" ref={ref}>
      <button type="button" className="pc-fchip-more" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Options for ${label}`} title="Options"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}>
        <i className="bi bi-three-dots-vertical" />
      </button>
      {open && (
        <span className="pc-fchip-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onTogglePause(); }}>
            <i className={`bi ${paused ? 'bi-play-circle' : 'bi-pause-circle'}`} /> {paused ? 'Resume' : 'Pause'}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onDismiss(); }}>
            <i className="bi bi-x-circle" /> Dismiss
          </button>
        </span>
      )}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════
   Drilldown
════════════════════════════════════════════════════════════ */
/* Memoised — see MEMOISED TAB BODIES at the top of this file. */
const Drilldown = React.memo(function DrilldownBody({ brand, row, month, creators, allCreators = null, allBrandMonths = null, brandNameById = null, onBack, onAddCreator, onEditCreator, onDeleteCreator, onEditBudget, onFocusProductsChange = null, onDeleteBrand, patchCreatorLocal, onSetStatus, onToggleVisible, contractLinkFor, onContractLinkChange, commentCount, onComments, creatorNoteCount, onCreatorNotes, onCreatorInfo, findCodeOwner = null }) {
  setReportCurrency(brand && brand.currency); // single brand → its money symbol
  const ro = useRO();
  const [openId, setOpenId] = useState(null);
  const bm = row?.bm || {};
  const products = focusProductList(bm);
  const [sort, setSort] = useCreatorSort('ac_pc_sort_drill');
  // "To review": draft videos waiting for the handler's decision, across this
  // brand-month. Switched on, those creators are lifted into their own group
  // at the top (out of their status group, so nobody is listed twice).
  const [reviewFirst, setReviewFirst] = useState(false);
  const reviewTotal = useMemo(
    () => creators.reduce((n, c) => n + pendingDraftCount(c.video_codes), 0),
    [creators],
  );
  const reviewOn = reviewFirst && reviewTotal > 0;
  // group creators by payment status — Payment Pending → Follow-up Required → Videos in Progress → Payment Sent,
  // each introduced by a labelled divider. The # index runs continuously top-to-bottom.
  // The sort picker orders creators WITHIN each group; the groups themselves are
  // fixed (a handler reads this screen by "who needs paying" first).
  const statusGroups = useMemo(() => {
    let n = 0;
    const cmp = creatorSortCmp(sort);
    const lifted = reviewOn ? creators.filter(c => pendingDraftCount(c.video_codes) > 0) : [];
    const rest = reviewOn ? creators.filter(c => pendingDraftCount(c.video_codes) === 0) : creators;
    const reviewGroup = lifted.length ? [{
      opt: { value: '__review', label: 'Videos to review', cls: 'review' },
      items: [...lifted]
        .sort((a, b) => (pendingDraftCount(b.video_codes) - pendingDraftCount(a.video_codes)) || cmp(a, b))
        .map(c => ({ c, idx: ++n })),
    }] : [];
    return reviewGroup.concat(STATUS_GROUP_ORDER
      .map(val => {
        const opt = STATUS_OPTIONS.find(s => s.value === val);
        const items = rest.filter(c => deriveStatus(c).value === val)
          .sort(cmp)
          .map(c => ({ c, idx: ++n }));
        return { opt, items };
      })
      .filter(g => g.items.length > 0));
  }, [creators, sort, reviewOn]);
  return (
    <>
      <button className="pc-back" onClick={onBack}>‹ All brands</button>
      <div className="pc-dd-head">
        <BrandAva name={brand.name} logo={brand.logo_url} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* The approval chip rides the brand NAME rather than the links row
              below it: it is a fact about this brand-month, not a link, and in
              a row of "Content guide ↗ / Focus product ↗" it read as a third
              thing to click. Beside the title it is the first thing seen, which
              is the point of a gate on posting. Small on purpose — at the links
              row's 32px/12.5px next to a 27px heading it read as a second
              title.
              Only when ON: a chip reading "no approval needed" on every other
              brand would be a standing notice about the ordinary case, and the
              thing worth catching an eye is the exception.
              ‼️ Workspace-only — the client portal and the share link render
              their own header, not this one. */}
          <div className="pc-dd-titlerow">
            <h2 className="pc-dd-title">{brand.name}</h2>
            {bm.approval_required && (
              <span className="pc-link-chip pc-chip-appr pc-chip-sm" title="This brand approves videos before they are posted. Internal — the client is not shown this.">
                <i className="bi bi-shield-check" aria-hidden="true" /> Approval required
              </span>
            )}
          </div>
          {/* The month, then the facts that describe the ARRANGEMENT for it:
              when the program was set up and the two commission rates. They
              were chips in the links row below until 2026-09-17; on one line
              under the brand name they read as a single sentence about this
              brand-month, and the row below goes back to being only links.
              Each part is drawn only when RECORDED — "Standard —" would be a
              rate we never agreed, and a missing onboarding date is not a fact. */}
          <div className="pc-dd-sub">
            {[
              monthLabel(month),
              bm.onboarded_on ? `Onboarded ${fmtDayLocal(bm.onboarded_on)}` : null,
              bm.standard_commission != null ? `Standard ${fmtPct(bm.standard_commission)}` : null,
              bm.shop_ads_commission != null ? `Shop ads ${fmtPct(bm.shop_ads_commission)}` : null,
            ].filter(Boolean).join(' · ')}
          </div>
          <div className="pc-dd-links">
            {bm.content_guide_url
              ? <a className="pc-link-chip set" href={bm.content_guide_url} target="_blank" rel="noopener noreferrer">Content guide ↗</a>
              : !ro && <button className="pc-link-chip" onClick={onEditBudget}>+ Content guide</button>}
            {products.length > 0
              ? products.map((p, i) => {
                  // ORANGE means paused (taken off the program for now) and nothing else.
                  const cls = p.paused ? 'pc-chip-paused' : '';
                  const tip = p.paused ? 'Paused — not offered on new contracts.' : (p.url || '');
                  const label = p.name || `Focus product ${i + 1}`;
                  return (
                    <span key={i} className={`pc-link-chip pc-fchip ${cls}`} title={tip}>
                      <a className="pc-fchip-a" href={p.url || undefined} target="_blank" rel="noopener noreferrer">
                        {p.paused && <i className="bi bi-pause-circle-fill" aria-label="Paused" />}
                        {label} ↗
                      </a>
                      {!ro && onFocusProductsChange && (
                        <FocusChipMenu paused={!!p.paused} label={label}
                          onTogglePause={() => onFocusProductsChange(products.map((x, j) => {
                            if (j !== i) return x;
                            const { paused, ...rest } = x;
                            return paused ? rest : { ...rest, paused: true };
                          }))}
                          onDismiss={() => {
                            if (!window.confirm(`Remove “${label}” from ${monthLabel(month)}'s focus products?`)) return;
                            onFocusProductsChange(products.filter((_, j) => j !== i));
                          }} />
                      )}
                    </span>
                  );
                })
              : !ro && <button className="pc-link-chip" onClick={onEditBudget}>+ Focus product</button>}
          </div>
        </div>
        <div className="pc-dd-actions">
          <BrandResourcesMenu brandId={brand.id} brandName={brand.name} />
          {allCreators && <BrandDataExportButton brand={brand} month={month} creators={allCreators} brandMonths={allBrandMonths || []} brandNameById={brandNameById || {}} />}
          {onComments && (
            <button className="pc-disc-btn" style={{ height: 34 }} onClick={onComments} title="Open discussion for this brand">
              <i className="bi bi-chat-left-text" />Discussion
              {commentCount > 0 && <span className="pc-disc-badge">{commentCount}</span>}
            </button>
          )}
          {!ro && <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={onEditBudget}>Edit budget</button>}
          {!ro && <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={onAddCreator}>+ Creator</button>}
        </div>
      </div>

      {row && (
        <div className="pc-kpis pc-kpis-5">
          <Kpi label="Budget" color="#1259C3" value={row.budget ? fmt$(row.budget) : '—'} sub={row.budget ? `${Math.round(row.usage)}% used` : 'not set'} />
          <Kpi label="Allocated" color="#8B5CF6" value={fmt$(row.allocated)} sub={`${row.creators} creator${row.creators === 1 ? '' : 's'}`} />
          <Kpi label="Paid" color="#2E7D32" value={fmt$(row.paid)} sub={`${row.allocated > 0 ? Math.round((row.paid / row.allocated) * 100) : 0}% paid out`} />
          <Kpi label="Videos" color="#0EA5E9" value={`${row.delivered}/${row.videos}`} sub={`${row.videos > 0 ? Math.round((row.delivered / row.videos) * 100) : 0}% completed`} />
          <Kpi label="Cost / Video" color="#E65100" value={row.costPerVideo ? fmt$(row.costPerVideo) : '—'} sub="per delivered video" />
        </div>
      )}

      {creators.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">👤</div><h3>No creators in {monthLabel(month)}</h3>
          <p>{ro ? 'No creators have been onboarded for this brand & month.' : 'Onboard a creator for this brand & month.'}</p>
          {!ro && <button className="pc-btn pc-btn-primary" style={{ marginTop: 16 }} onClick={onAddCreator}>+ Add creator</button>}
        </div></div>
      ) : (
        <>
        <div className="pc-listbar">
          <span className="pc-listbar-count">
            {creators.length} creator{creators.length === 1 ? '' : 's'} · {monthLabel(month)}
          </span>
          <span className="pc-listbar-tools">
            <button type="button" className={`pc-reviewtab ${reviewOn ? 'on' : ''} ${reviewTotal ? 'has' : ''}`}
              aria-pressed={reviewOn} disabled={!reviewTotal}
              title={reviewTotal
                ? (reviewOn ? 'Back to the normal order' : 'Show creators with draft videos to review at the top')
                : 'No draft videos waiting for review'}
              onClick={() => setReviewFirst(v => !v)}>
              <i className="bi bi-camera-reels" />Videos to review
              <span className="pc-reviewtab-n">{reviewTotal}</span>
            </button>
            <CreatorSortMenu value={sort} onChange={setSort} title="Sort creators within each status group" />
          </span>
        </div>
        <div className="pc-card pc-list">
          <div className="pc-ct-head">
            <div className="pc-num">#</div><div>Completed on</div><div>Name</div><div>TikTok</div><div className="pc-num">Amount</div>
            <div className="pc-num">Videos</div><div>Payout</div><div>Status</div><div>Contract</div><div className="pc-num">Content</div>
          </div>
          {statusGroups.map(g => (
            <React.Fragment key={g.opt.value}>
              <div className={`pc-ct-group ${g.opt.cls}`}>
                <span className="pc-ct-group-label">
                  <span className={`pc-statusdot ${g.opt.cls}`} />{g.opt.label}
                  <span className="pc-ct-group-count">{g.items.length}</span>
                </span>
              </div>
              {g.items.map(({ c, idx }) => (
                <CreatorRow key={c.id} c={c} idx={idx} open={openId === c.id}
                  onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                  onClose={() => setOpenId(null)}
                  onEdit={() => onEditCreator(c)} onDelete={() => onDeleteCreator(c.id)}
                  patchCreatorLocal={patchCreatorLocal} onSetStatus={onSetStatus} onToggleVisible={onToggleVisible}
                  noteCount={creatorNoteCount ? creatorNoteCount(c) : 0}
                  onNotes={onCreatorNotes ? () => onCreatorNotes(c) : null}
                  onInfo={onCreatorInfo ? () => onCreatorInfo(c) : null}
                  buildContractPayload={() => contractPayloadFor(c, brand.name, { focusProducts: products, contentGuideUrl: bm.content_guide_url, currency: brand.currency, standardCommission: bm.standard_commission, shopAdsCommission: bm.shop_ads_commission })}
                  contractLink={contractLinkFor ? contractLinkFor(c) : null}
                  onContractLinkChange={onContractLinkChange}
                  findCodeOwner={findCodeOwner} />
              ))}
            </React.Fragment>
          ))}
        </div>
        </>
      )}
    </>
  );
});

/* "Download brand data" — every creator this brand has worked with, for one
   program month or all of them, with their GMV history (this brand and every
   brand) on each row. Rows + columns live in ./brandDataExport; the dialog is
   the shared TableExportModal with a month picker in its top slot. Offered in
   read-only too: taking the figures away is reading, not editing. */
function BrandDataExportButton({ brand, month, creators, brandMonths, brandNameById }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState(month);
  const months = useMemo(() => (open ? brandDataMonths(brand.id, creators, brandMonths) : []), [open, brand.id, creators, brandMonths]);
  useEffect(() => { if (open) setScope(month); }, [open, month]);
  const [sort, setSortState] = useState(() => {
    try { const v = localStorage.getItem(BRAND_DATA_SORT_STORE); return isBrandDataSort(v) ? v : BRAND_DATA_SORT_DEFAULT; }
    catch { return BRAND_DATA_SORT_DEFAULT; }
  });
  const setSort = (v) => { setSortState(v); try { localStorage.setItem(BRAND_DATA_SORT_STORE, v); } catch { /* private mode */ } };
  const rows = useMemo(() => (open ? sortBrandDataRows(buildBrandDataRows({
    brand, creators, brandMonths, brandNameById, month: scope, statusLabel: c => deriveStatus(c).label,
  }), sort) : []), [open, brand, creators, brandMonths, brandNameById, scope, sort]);
  const periodLabel = scope === ALL_MONTHS ? 'All months' : monthLabel(scope);
  const summarySheets = useCallback((rs) => [{
    name: 'Brand summary', widths: [24, 40],
    cells: brandDataSummary(rs, brand.name, periodLabel, brand.currency || 'USD'),
  }], [brand.name, brand.currency, periodLabel]);
  const options = months.includes(month) || !month ? months : [month, ...months];
  const slugMonth = scope === ALL_MONTHS ? 'all-months' : scope;
  const slugBrand = String(brand.name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (
    <>
      <button className="pc-btn pc-btn-ghost pc-btn-sm" style={{ height: 34 }} onClick={() => setOpen(true)}
        title="Download every creator of this brand, with their GMV history, as Excel or CSV">
        <i className="bi bi-download" style={{ marginRight: 6 }} />Download data
      </button>
      {open && (
        <TableExportModal
          show={open} onHide={() => setOpen(false)}
          title={`${brand.name} — creators & GMV`}
          columns={BRAND_DATA_COLUMNS} storeKey={BRAND_DATA_STORE}
          filtered={rows} all={rows} filterLabel="" entryWord="creator" expandColumns={expandBrandDataColumns} extraSheets={summarySheets}
          sheet="Creators" slug={`${slugBrand}-creators-${slugMonth}`}
          topSlot={(
            <section className="ac-acx-sec">
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <h6 className="ac-acx-head">Program month</h6>
                  <select className="form-select" value={scope} onChange={e => setScope(e.target.value)}>
                    <option value={ALL_MONTHS}>All months</option>
                    {options.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
                  </select>
                </div>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <h6 className="ac-acx-head">Sort by</h6>
                  <select className="form-select" value={sort} onChange={e => setSort(e.target.value)}>
                    {BRAND_DATA_SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <p className="ac-acx-note">
                {scope === ALL_MONTHS
                  ? 'One row per creator across every program this brand has run. Budget columns add up every month.'
                  : `One row per creator: signed in ${monthLabel(scope)}, or an earlier deal still selling that month. Budget columns show this month’s budget.`}
                {' '}Columns run: creator → deal → GMV → contact &amp; payment → brand budget → videos. An Excel file also gets a “Brand summary” sheet.
              </p>
            </section>
          )}
        />
      )}
    </>
  );
}

// Clicking a creator opens their videos & ad codes in a POPUP, not an accordion
// — the same shell the share link uses (CreatorPanelShell). The panel runs long
// (a row per contracted video, plus warnings), so opening it in place pushed the
// rest of the month's list down the page and lost the reader's spot in it.
// `onClose` is separate from `onToggle` because the dialog closes from three
// places the row never sees: the ✕, Escape and a backdrop click.
function CreatorRow({ c, idx, open, onToggle, onClose, onEdit, onDelete, patchCreatorLocal, onSetStatus, onToggleVisible, noteCount = 0, onNotes = null, onInfo = null, buildContractPayload = null, contractLink = null, onContractLinkChange = null, findCodeOwner = null }) {
  const accounts = tiktokAccounts(c.tiktok_handle);
  const payouts = creatorPayouts(c);
  const filled = dealCodes(c.video_codes).filter(v => v?.video).length;
  const extras = extraVideoCount(c);
  const toReview = pendingDraftCount(c.video_codes);
  const draftTag = toReview > 0
    ? <span className="pc-draft-tag" title={`${toReview} draft${toReview > 1 ? 's' : ''} waiting for your review`}><i className="bi bi-hourglass-split" />{toReview} to review</span>
    : null;
  const contractBtn = <ContractActions c={c} buildPayload={buildContractPayload} link={contractLink} onLinkChange={onContractLinkChange} />;
  const keepBtn = onNotes ? (
    <button className={`pc-keepnote-btn pc-keepnote-mini ${noteCount > 0 ? 'has' : ''}`}
      onClick={e => { e.stopPropagation(); onNotes(); }}
      title={noteCount > 0 ? `${noteCount} creator note${noteCount === 1 ? '' : 's'}` : 'Creator notes'} aria-label="Creator notes">
      <i className="bi bi-journal-text" />
      {noteCount > 0 && <span className="pc-keepnote-count">{noteCount}</span>}
    </button>
  ) : null;
  /* The same "?" the Active Creators tab carries: this row is one deal in one
     program, the popup is the PERSON — every handle, contact and payout on
     file, their TikTok Shop standing, and every other program they have run for us.
     It stops the click reaching the row, which opens the video panel. */
  const infoBtn = onInfo ? (
    <button className="pc-keepnote-btn pc-keepnote-mini pc-cinfo-btn"
      onClick={e => { e.stopPropagation(); onInfo(); }}
      title={`Full record for ${c.name || 'this creator'}`} aria-label="Creator details">
      <i className="bi bi-question-lg" />
    </button>
  ) : null;
  // Edit and Delete both open a .pc-overlay dialog, which sits BELOW a Bootstrap
  // modal — so the popup has to step aside first or the editor opens invisibly
  // behind it. Closing first is the right flow anyway: the editor supersedes it.
  const editAndClose = () => { onClose(); onEdit(); };
  const deleteAndClose = () => { onClose(); onDelete(); };
  return (
    <>
      <div className={`pc-ct-row ${open ? 'open' : ''}`} onClick={onToggle} role="button" tabIndex={0}
        aria-label={`Open ${c.name || 'creator'} — videos and ad codes`}
        onKeyDown={e => { if (e.key === 'Enter') onToggle(); }}>
        <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{idx}</span></div>
        <div className="pc-cell" data-label="Completed on">{c.completed_on ? fmtDate(c.completed_on) : <span className="pc-handle">—</span>}</div>
        <div className="pc-cell" data-label="Name"><span className="pc-cname">{c.name}</span>{keepBtn}{infoBtn}</div>
        <div className="pc-cell" data-label="TikTok">
          {accounts.length > 0
            ? <span className="pc-tiktok"><a className="pc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>{accounts.length > 1 && <span className="pc-more" title={accounts.slice(1).map(a => a.handle).join(', ')}>+{accounts.length - 1}</span>}</span>
            : <span className="pc-handle">—</span>}
        </div>
        <div className="pc-cell pc-num" data-label="Amount"><span className="pc-money">{fmt$(c.amount)}</span></div>
        <div className="pc-cell pc-num" data-label="Videos">
          {/* Deal videos added / agreed — "0/5" until the first link lands. Extra
              videos (outside the deal) never count; they ride as a "+N" tag. */}
          <span className={`pc-vidprog ${(parseInt(c.videos_count, 10) || 0) > 0 && filled >= (parseInt(c.videos_count, 10) || 0) ? 'done' : ''}`}>{filled}/{(parseInt(c.videos_count, 10) || 0)}</span>
          {extras > 0 ? <span className="pc-extra-tag" title={`${extras} extra video${extras > 1 ? 's' : ''} — recorded only, not part of the deal`}>+{extras}</span> : ''}
          {draftTag}
        </div>
        <div className="pc-cell" data-label="Payout"><PayoutChipsRO payouts={payouts} /></div>
        <div className="pc-cell" data-label="Status">
          <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
          <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} />
          <ClientPaidBadge c={c} />
        </div>
        <div className="pc-cell pc-contract-cell" data-label="Contract">{contractBtn}</div>
        {/* A chevron says "this expands". This opens a popup, so it gets the
            framed expand glyph the share link's rows already use. */}
        <div className="pc-cell pc-num" data-label="Content"><span className="pc-content-cell"><span className="pc-openbtn" aria-hidden><i className="bi bi-arrows-angle-expand" /></span></span></div>

        {/* ── purpose-built mobile card ── */}
        <div className="pc-mc">
          <div className="pc-mc-head">
            <div className="pc-mc-idblock">
              <div className="pc-mc-name">{c.name}{keepBtn}{infoBtn}</div>
              <div className="pc-mc-subline">
                {accounts[0]
                  ? <a className="pc-mc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>
                  : <span className="pc-mc-muted">no TikTok</span>}
                {accounts.length > 1 && <span className="pc-more">+{accounts.length - 1}</span>}
              </div>
            </div>
            <span className="pc-openbtn" aria-hidden><i className="bi bi-arrows-angle-expand" /></span>
          </div>
          <div className="pc-mc-stats pc-mc-stats-3">
            <div className="pc-mc-stat"><b>{fmt$(c.amount)}</b><span>Deal</span></div>
            <div className="pc-mc-stat"><b>{c.videos_count || '—'}</b><span>Videos</span></div>
            <div className="pc-mc-stat"><b className={filled ? 'pc-green' : ''}>{filled}/{c.videos_count || filled || 0}</b><span>Delivered{extras > 0 ? ` · +${extras} extra` : ''}</span>{draftTag}</div>
          </div>
          <div className="pc-mc-foot">
            <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
            <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} />
            <ClientPaidBadge c={c} />
            {contractBtn}
            {payouts.length > 0 && <span className="pc-mc-footmeta"><PayoutChipsRO payouts={payouts} /></span>}
          </div>
        </div>
      </div>
      {/* NOTE the panel is a SIBLING of the row, never a child — the dialog is
          portalled to <body> but still bubbles up the REACT tree, so nested
          inside the row every click in it would re-fire the row's toggle. */}
      {open && (
        <CreatorPanelShell asModal name={c.name} handle={accounts[0]?.handle} onClose={onClose}>
          <CreatorExpand c={c} idx={idx} onEdit={editAndClose} onDelete={deleteAndClose} patchCreatorLocal={patchCreatorLocal} findCodeOwner={findCodeOwner} />
        </CreatorPanelShell>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   Creators tab — every creator (per brand) for the month
════════════════════════════════════════════════════════════ */
/* Which columns this table can show, in render order. Same shape and the same
   show/hide machinery as the Creators Database (useCdbColumns / CdbColumnsMenu
   take the list as a parameter) — `th` carries the header cell's class, so the
   header and the menu are generated from ONE list and cannot drift.

   The selection checkbox and the # index sit outside this list, so they are
   never offered; Name is locked, because a row nobody can name is not a row.

   Unlike the Database, this table has no clickable column-header sorts — order
   comes from the sort pill, which always names the active option on screen, so
   hiding a column can never leave the order driven by something invisible. */
/* `id`/`dir`/`get` opt a column into header sorting (see COLUMN SORTING above).
   Contract has none on purpose: it is a pair of buttons, not a value.
   ‼️ Whatever is picked here orders creators INSIDE their month — the month
   blocks are built from consecutive rows, so a sort across months would shatter
   them into one block per creator. Same rule the sort menu follows. */
const CV_COLS = [
  { key: 'name', id: 'name', label: 'Name', dir: 'asc', get: c => c.name || '' },
  { key: 'username', id: 'username', label: 'Username', dir: 'asc',
    get: c => (tiktokAccounts(c.tiktok_handle)[0]?.handle || '').replace(/^@/, '') },
  { key: 'phone', id: 'phone', label: 'Phone', dir: 'asc', get: c => c.phone || '' },
  { key: 'email', id: 'email', label: 'Email', dir: 'asc', get: c => c.email || '' },
  { key: 'category', id: 'category', label: 'Category', dir: 'asc', get: c => c.category || '' },
  { key: 'brand', id: 'brand', label: 'Brand', dir: 'asc', get: c => c._brandName || '' },
  { key: 'onboarded', id: 'onboarded', label: 'Onboarded', dir: 'desc', th: 'pc-cv-datecell', get: c => c.onboarded_on || '' },
  { key: 'completed', id: 'completed', label: 'Completed', dir: 'desc', th: 'pc-cv-datecell', get: c => c.completed_on || '' },
  { key: 'deal', id: 'deal', label: 'Deal', dir: 'desc', th: 'pc-num', num: true, get: c => Number(c.amount) || 0 },
  { key: 'rate', id: 'rate', label: 'Rate/Vid', dir: 'desc', th: 'pc-num', num: true,
    get: c => { const v = parseInt(c.videos_count, 10) || 0; return v > 0 ? (Number(c.amount) || 0) / v : null; } },
  /* Payment addresses. Sorted by the FIRST method's label so a creator paid the
     same way lands together — the value itself is an email or a link, which
     sorts by nothing anyone is looking for. */
  { key: 'payout', id: 'payout', label: 'Payout', dir: 'asc', th: 'pc-cv-payoutcell',
    get: c => creatorPayouts(c)[0]?.label || '' },
  { key: 'status', id: 'status', label: 'Status', dir: 'asc', get: c => deriveStatus(c).label },
  { key: 'contract', label: 'Contract', th: 'pc-cv-contractcell' },
];
/* The Status column's own filter: the header cell carries a dropdown that
   narrows the table to one payment status.

   ‼️ It reads the status through `deriveStatus`, the same body the row's own
   pill renders from — so an unknown or blank `payment_status` filters as the
   state it is DRAWN as (Videos in Progress), rather than falling into a
   category nothing on screen names.

   ‼️ THE POPUP IS `position:fixed`, and it has to be. `.pc-dt-scroll` is
   `overflow-x:auto`, which computes overflow-y to `auto` as well, so an
   absolutely-positioned menu hanging off a sticky <th> is CLIPPED by the
   table's own scroller. Fixed escapes it — at the cost of not moving with the
   page, hence the re-placement on scroll (capture:true, so the table's
   sideways scroll counts) and on resize.

   A status nothing currently matches is offered DISABLED: picking it could
   only ever produce an empty table. The counts are over what the search box
   has already left, so they answer "how many are here", not "how many exist". */
function StatusFilterMenu({ value, counts, total, onChange }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const w = 248;
    setPos({
      top: Math.round(r.bottom + 6),
      left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 12))),
    });
  }, []);
  useEffect(() => {
    if (!open) return;
    place();
    const away = e => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (popRef.current && popRef.current.contains(e.target)) return;
      setOpen(false);
    };
    // stopPropagation so dismissing the menu can't also close a surrounding modal
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);
  const picked = STATUS_OPTIONS.find(o => o.value === value) || null;
  const row = (key, cls, label, n, disabled) => (
    <button type="button" key={key} disabled={disabled}
      className={`pc-thfilter-row ${value === key ? 'on' : ''}`}
      title={disabled ? 'No creators with this status right now' : undefined}
      onClick={() => { onChange(key); setOpen(false); }}>
      {cls ? <span className={`pc-statusdot ${cls}`} /> : <span className="pc-thfilter-any" />}
      <span className="pc-thfilter-label">{label}</span>
      <span className="pc-thfilter-n">{n}</span>
    </button>
  );
  return (
    <span className="pc-thfilter">
      <button type="button" ref={btnRef}
        className={`pc-thfilter-btn ${picked ? 'on' : ''}`}
        onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="true"
        title={picked ? `Showing ${picked.label} only — click to change` : 'Filter by status'}
        aria-label={picked ? `Status filter: ${picked.label}` : 'Filter by status'}>
        {picked ? <span className={`pc-statusdot ${picked.cls}`} /> : <i className="bi bi-funnel" />}
        <i className="bi bi-caret-down-fill pc-thfilter-caret" />
      </button>
      {open && pos && (
        <div className="pc-thfilter-pop" ref={popRef} style={{ top: pos.top, left: pos.left }}>
          <div className="pc-colmenu-head"><span>Filter by status</span></div>
          <div className="pc-colmenu-list">
            {row('all', null, 'All statuses', total, false)}
            {STATUS_OPTIONS.map(o => row(o.value, o.cls, o.label, counts[o.value] || 0, !counts[o.value] && value !== o.value))}
          </div>
        </div>
      )}
    </span>
  );
}
const CV_LOCKED_COL = 'name';
const CV_COLS_STORE = 'ac_pc_cv_cols';
/* Memoised — see MEMOISED TAB BODIES at the top of this file.
   Exported for the mount harness, the way CreatorDatabaseView already is. */
export const CreatorsView = React.memo(function CreatorsViewBody({ rows, onEdit, onDelete, patchCreatorLocal, onSetStatus, onToggleVisible, contractLinkFor, onContractLinkChange, creatorNoteCount, onCreatorNotes, onCreatorInfo, findCodeOwner = null, onManageCategories = null }) {
  const [q, setQ] = useState('');
  /* Clicking a row opens that deal's VIDEOS & AD CODES — the same popup the
     brand drilldown opens, because it is the same question being asked of the
     same row ("what has this creator delivered, and what are the codes"). It
     used to open the deal EDITOR, which put the rarer act (rewriting the
     arrangement) on the whole-row click and left the everyday one with no
     affordance at all on this tab. Edit and Delete live inside the popup, as
     they do in the drilldown. One id, so only one panel is ever open. */
  const [openId, setOpenId] = useState(null);
  /* The input keeps `q`; the table filters on the deferred copy, so typing is
     never blocked by a re-render of every row. */
  const dq = useDeferredValue(q);
  const [sel, setSel] = useState(() => new Set());
  const [copied, setCopied] = useState('');
  const [sort, setSort] = useCreatorSort('ac_pc_sort_creators');
  /* A clicked column takes over from the sort menu until it is cleared (a third
     click on the same header), and picking from the menu clears it — two
     controls silently fighting over one list is the thing to avoid here. */
  const [colSort, setColSort] = useState(null);
  /* The Status column's dropdown filter. 'all' = no filter; every other value is
     a STATUS_OPTIONS value. Deliberately NOT persisted: a filter that survives a
     reload is one somebody forgets they set and then reads as missing rows. */
  const [statusFilter, setStatusFilter] = useState('all');
  const toggleColSort = (col) => setColSort(prev => nextSort(prev, col));
  const pickMenuSort = (v) => { setSort(v); setColSort(null); };
  const cols = useCdbColumns(CV_COLS, CV_COLS_STORE, CV_LOCKED_COL);
  const shownCols = CV_COLS.filter(c => cols.isVisible(c.key));
  /* the two leading cells (selection + index) sit outside CV_COLS, so every
     full-width row spans the shown columns plus those two */
  const span = shownCols.length + 2;
  const searched = useMemo(() => {
    const needle = dq.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(c => `${c.name} ${c._brandName} ${c.category} ${c.tiktok_handle} ${c.email} ${c.phone}`.toLowerCase().includes(needle));
  }, [rows, dq]);
  /* Counted over what the SEARCH has already left, so the menu answers "how
     many are here" rather than "how many exist" — and so the numbers do not
     collapse to one non-zero row the moment a status is picked. */
  const statusCounts = useMemo(() => {
    const m = {};
    searched.forEach(c => { const v = deriveStatus(c).value; m[v] = (m[v] || 0) + 1; });
    return m;
  }, [searched]);
  // "Videos to review": only creators with draft videos waiting for a
  // decision. Counted over what the search left, like the status menu.
  // PERFORMANCE: each row's draft count is worked out ONCE per data change
  // (reviewById) and handed to the row, instead of every filter, total and row
  // re-reading every video of every deal on every render.
  const [reviewOnly, setReviewOnly] = useState(false);
  // Filters run as a transition: the button answers at once and the table
  // follows, so a click never freezes the page while ~500 rows re-render.
  const [filterPending, startFilter] = useTransition();
  const reviewById = useMemo(() => {
    const m = new Map();
    for (const c of rows) { const n = pendingDraftCount(c.video_codes); if (n) m.set(c.id, n); }
    return m;
  }, [rows]);
  const reviewTotal = useMemo(() => {
    let n = 0;
    for (const c of searched) n += reviewById.get(c.id) || 0;
    return n;
  }, [searched, reviewById]);
  const reviewOn = reviewOnly && reviewTotal > 0;
  /* Several categories at once; 'any' = carries at least one, 'all' = every one.
     Not persisted, for the status filter's reason. */
  const [catSel, setCatSel] = useState([]);
  const [catMode, setCatMode] = useState('any');
  const catOptions = useMemo(() => countCategories(searched.map(c => splitCats(c.category))), [searched]);
  const scoped = useMemo(() => {
    let out = statusFilter === 'all' ? searched : searched.filter(c => deriveStatus(c).value === statusFilter);
    if (reviewOn) out = out.filter(c => reviewById.has(c.id));
    if (catSel.length) out = out.filter(c => matchesCategories(splitCats(c.category), catSel, catMode));
    return out;
  }, [searched, statusFilter, reviewOn, reviewById, catSel, catMode]);
  /* Month stays the PRIMARY key (newest month first) — the blocks below are
     built from consecutive rows, so re-sorting across months would shatter them
     into one block per creator. The picker is the secondary key, i.e. it orders
     creators inside their own month. */
  const filtered = useMemo(() => {
    const menuCmp = creatorSortCmp(sort);
    // a hidden column can still be the one sorted by, so fall back to the menu
    const cmp = columnCmp(CV_COLS, colSort, menuCmp) || menuCmp;
    return scoped.slice().sort((a, b) => String(b._monthKey ?? '').localeCompare(String(a._monthKey ?? '')) || cmp(a, b));
  }, [scoped, sort, colSort]);
  /* Rows are DRAWN in pages (CV_PAGE at a time, "Show more" adds the next):
     every row carries two status pickers, two contract controls and a mobile
     card, so mounting all ~500 at once is what made a filter click hang. The
     filters, counts, select-all, copy and export still use the whole list. */
  const [limit, setLimit] = useState(CV_PAGE);
  useEffect(() => { setLimit(CV_PAGE); }, [dq, statusFilter, reviewOn, sort, colSort]);
  const { groups, monthCounts } = useMemo(() => {
    const counts = {};
    for (const c of filtered) counts[c._monthKey] = (counts[c._monthKey] || 0) + 1;
    const out = [];
    let i = 0;
    for (const c of filtered) {
      if (i++ >= limit) break;
      const last = out[out.length - 1];
      if (last && last.key === c._monthKey) last.items.push(c);
      else out.push({ key: c._monthKey, items: [c] });
    }
    return { groups: out, monthCounts: counts };
  }, [filtered, limit]);
  // Stable handlers, so the memoised rows only re-render when THEIR data moves.
  const toggleOpen = useCallback((id) => setOpenId(o => (o === id ? null : id)), []);
  const closeOpen = useCallback(() => setOpenId(null), []);
  const toggleSelect = useCallback((id) => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const hiddenKey = [...cols.hidden].sort().join(',');
  const isVisible = useCallback((key) => cols.isVisible(key), [hiddenKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const allSelected = filtered.length > 0 && filtered.every(c => sel.has(c.id));
  function toggleAll() { setSel(prev => { const n = new Set(prev); if (allSelected) filtered.forEach(c => n.delete(c.id)); else filtered.forEach(c => n.add(c.id)); return n; }); }
  function flash(k) { setCopied(k); setTimeout(() => setCopied(x => (x === k ? '' : x)), 1800); }
  // Memoised: it walks every row, and it was being recomputed on each render just
  // to print a count in the toolbar.
  const selectedUsernameList = useMemo(() => {
    const seen = new Set(), out = [];
    rows.filter(c => sel.has(c.id)).forEach(c => tiktokAccounts(c.tiktok_handle).forEach(a => {
      const u = a.handle.replace(/^@/, '').trim(); const k = u.toLowerCase();
      if (u && !seen.has(k)) { seen.add(k); out.push(u); }
    }));
    return out;
  }, [rows, sel]);
  const selectedUsernames = () => selectedUsernameList;
  function copyUsernames() { const u = selectedUsernames(); if (u.length) { copyText(u.join('\n')); flash('u'); } }
  async function exportXlsx() {
    const data = rows.filter(c => sel.has(c.id)).map(c => {
      const amount = Number(c.amount) || 0; const videos = parseInt(c.videos_count, 10) || 0;
      return {
        Name: c.name || '',
        Usernames: tiktokAccounts(c.tiktok_handle).map(a => a.handle.replace(/^@/, '')).join(', '),
        Phone: c.phone || '', Email: c.email || '',
        /* every method, not the two mirrored columns — the sheet is the record,
           and the row's chips are capped at two for height reasons only */
        Payout: creatorPayouts(c).map(p => `${p.label}: ${p.value}`).join('; '),
        Category: c.category || '', Brand: c._brandName || '',
        'Deal ($)': amount, Videos: videos, 'Rate / Video ($)': videos > 0 ? Math.round(amount / videos) : '',
        Status: deriveStatus(c).label, Onboarded: c.onboarded_on || '', Completed: c.completed_on || '',
      };
    });
    if (!data.length) return;
    try {
      const head = Object.keys(data[0]);
      downloadCsv('apexgmv-creators.csv', [head, ...data.map(r => head.map(k => r[k]))]);
      flash('x');
    } catch (e) { alert('Export failed: ' + e.message); }
  }
  const unameCount = selectedUsernameList.length;
  const uniqueCreators = useMemo(
    () => new Set(rows.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean)).size, [rows]);
  const totalDeals = rows.length;
  return (
    <>
      {rows.length > 0 && (
        <div className="pc-mini-pills">
          <div className="pc-mini-pill"><span className="pc-mini-pill-l">Unique Creators</span><span className="pc-mini-pill-v">{uniqueCreators}</span></div>
          <div className="pc-mini-pill"><span className="pc-mini-pill-l">Total Deals</span><span className="pc-mini-pill-v">{totalDeals}</span></div>
        </div>
      )}
      <div className="pc-toolbar">
        <input className="pc-search" placeholder="Search creators, brands, categories…" value={q} onChange={e => setQ(e.target.value)} />
        <CreatorSortMenu value={sort} onChange={pickMenuSort} title="Sort creators within each month" />
        <CategoryFilter options={catOptions} value={catSel} onChange={v => startFilter(() => setCatSel(v))}
          mode={catMode} onMode={setCatMode} onManage={onManageCategories} />
        <button type="button" className={`pc-reviewtab ${reviewOn ? 'on' : ''} ${reviewTotal ? 'has' : ''}`}
          aria-pressed={reviewOn} disabled={!reviewTotal}
          title={reviewTotal
            ? (reviewOn ? 'Show every creator again' : 'Show only creators with draft videos to review')
            : 'No draft videos waiting for review'}
          onClick={() => startFilter(() => setReviewOnly(v => !v))}>
          {filterPending ? <span className="pc-reviewtab-spin" aria-hidden="true" /> : <i className="bi bi-camera-reels" />}Videos to review
          <span className="pc-reviewtab-n">{reviewTotal}</span>
        </button>
        {/* The Status column can be switched off in the columns menu, which would
            leave the filter narrowing the table with nothing on screen saying
            so — the same reason the column sort carries a chip. */}
        {statusFilter !== 'all' && (
          <button className="pc-sortchip" onClick={() => setStatusFilter('all')}
            title="Show every status again">
            <span className={`pc-statusdot ${(STATUS_OPTIONS.find(o => o.value === statusFilter) || {}).cls || ''}`} />
            {(STATUS_OPTIONS.find(o => o.value === statusFilter) || {}).label || statusFilter}
            <span className="pc-sortchip-x">✕</span>
          </button>
        )}
        {colSort && (
          <button className="pc-sortchip" onClick={() => setColSort(null)}
            title="Back to the order the sort menu picked">
            <i className={`bi ${colSort.dir === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down'}`} />
            Sorted by {(CV_COLS.find(c => c.id === colSort.by) || {}).label}
            <span className="pc-sortchip-x">✕</span>
          </button>
        )}
        {/* viewing preference only — Copy and Export still carry the full record,
            since hiding a column is about reading the table, not about what the
            creator's row contains */}
        <CdbColumnsMenu columns={CV_COLS} locked={CV_LOCKED_COL}
          hidden={cols.hidden} onToggle={cols.toggle} onShowAll={cols.showAll} />
        <span className="pc-count-pill">{filtered.length} creator{filtered.length === 1 ? '' : 's'} · all months</span>
      </div>
      {filtered.length === 0 ? (
        /* "Nothing is here" and "nothing matches what you asked for" are
           different answers, and only one of them has a way out. */
        rows.length > 0 ? (
          <div className="pc-card"><div className="pc-empty">
            <div className="pc-empty-icon">🔍</div><h3>No creators match</h3>
            <p>Nothing here fits the search, status and categories you picked.</p>
            <button className="pc-btn pc-btn-ghost pc-btn-sm"
              onClick={() => { setQ(''); setStatusFilter('all'); setReviewOnly(false); setCatSel([]); }}>Clear filters</button>
          </div></div>
        ) : (
          <div className="pc-card"><div className="pc-empty">
            <div className="pc-empty-icon">👥</div><h3>No creators yet</h3>
            <p>Creators you onboard inside brands show up here automatically.</p>
          </div></div>
        )
      ) : (
        <div className="pc-dt-card pc-cv-card" style={{ marginBottom: sel.size ? 8 : 0 }}>
          <div className="pc-dt-scroll pc-cv-scroll">
            <table className="pc-dtable pc-cv-table">
              <thead>
                <tr>
                  <th className="pc-cv-checkcell">
                    <input type="checkbox" className="pc-check" checked={allSelected} onChange={toggleAll} title="Select all" />
                  </th>
                  <th className="pc-dt-idx">#</th>
                  {shownCols.map(c => (
                    <th key={c.key} className={c.th} aria-sort={c.id ? sortAria(colSort, c) : undefined}>
                      {/* Status carries the sort AND its own dropdown filter; the
                          label still sorts, so nothing was traded for it. */}
                      {c.key === 'status' ? (
                        <span className="pc-th-filtered">
                          <SortBtn col={c} sort={colSort} onToggle={toggleColSort} />
                          <StatusFilterMenu value={statusFilter} counts={statusCounts}
                            total={searched.length} onChange={v => startFilter(() => setStatusFilter(v))} />
                        </span>
                      ) : c.id ? <SortBtn col={c} sort={colSort} onToggle={toggleColSort} /> : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {/* one <tbody> per month: the group's divider row and its deals travel
                  together, which is what keeps the month blocks intact */}
              {groups.map(g => (
                <tbody className="pc-cv-group" key={g.key}>
                  <tr className="pc-cv-monthrow">
                    <td colSpan={span}>
                      <div className="pc-cv-monthhead"><span>{monthLabel(g.key)}</span><span className="pc-cv-monthcount">{monthCounts[g.key] || g.items.length}</span></div>
                    </td>
                  </tr>
                  {g.items.map((c, i) => <CreatorGlobalRowItem key={c.id} c={c} idx={i + 1} show={isVisible} span={span}
                    open={openId === c.id} onToggleOpen={toggleOpen} onCloseOpen={closeOpen}
                    onEditC={onEdit} onDeleteId={onDelete || null}
                    patchCreatorLocal={patchCreatorLocal} findCodeOwner={findCodeOwner}
                    onSetStatus={onSetStatus} onToggleVisible={onToggleVisible}
                    selected={sel.has(c.id)} onToggleSelectId={toggleSelect}
                    noteCount={creatorNoteCount ? creatorNoteCount(c) : 0}
                    onNotesC={onCreatorNotes || null} onInfoC={onCreatorInfo || null}
                    contractLink={contractLinkFor ? contractLinkFor(c) : null}
                    onContractLinkChange={onContractLinkChange}
                    toReview={reviewById.get(c.id) || 0} />)}
                </tbody>
              ))}
            </table>
          </div>
          {filtered.length > limit && (
            <button type="button" className="pc-cv-more" onClick={() => startFilter(() => setLimit(l => l + CV_PAGE))}>
              Show {Math.min(CV_PAGE, filtered.length - limit)} more
              <span className="pc-cv-more-sub">{limit} of {filtered.length} shown</span>
            </button>
          )}
        </div>
      )}
      {sel.size > 0 && (
        <div className="pc-bulkbar">
          <span className="pc-bulk-count">{sel.size} selected</span>
          <button className="pc-bulk-btn primary" onClick={copyUsernames}>{copied === 'u' ? 'Copied!' : `Copy username${unameCount === 1 ? '' : 's'}`}</button>
          <button className="pc-bulk-btn" onClick={exportXlsx}>{copied === 'x' ? 'Exported!' : 'Export'}</button>
          <button className="pc-bulk-x" onClick={() => setSel(new Set())} title="Clear selection">✕</button>
        </div>
      )}
    </>
  );
});

/* `show(key)` and `span` come from the tab's column picker (CV_COLS): every
   optional cell is gated on it, and the full-width phone-card row spans
   whatever is currently shown. Defaults keep the row usable on its own. */
const CV_PAGE = 100;

/* Memoised wrapper: its props are plain values and STABLE handlers, so a row
   re-renders only when its own deal, selection, open state or counts change —
   not on every keystroke, selection or filter click elsewhere in the table. */
const CreatorGlobalRowItem = React.memo(function CreatorGlobalRowItem({ c, onToggleOpen, onCloseOpen, onEditC, onDeleteId, onToggleSelectId, onNotesC, onInfoC, ...rest }) {
  return (
    <CreatorGlobalRow c={c} {...rest}
      onToggle={() => onToggleOpen(c.id)}
      onClose={onCloseOpen}
      onEdit={() => onEditC(c)}
      onDelete={onDeleteId ? () => onDeleteId(c.id) : null}
      onToggleSelect={() => onToggleSelectId(c.id)}
      onNotes={onNotesC ? () => onNotesC(c) : null}
      onInfo={onInfoC ? () => onInfoC(c) : null}
      buildContractPayload={() => contractPayloadFor(c, c._brandName, { currency: c._brandCurrency, focusProducts: focusProductList(c._bm || {}), contentGuideUrl: c._bm?.content_guide_url, standardCommission: c._bm?.standard_commission, shopAdsCommission: c._bm?.shop_ads_commission })} />
  );
});

function CreatorGlobalRow({ toReview: toReviewProp = null, c, idx, open = false, onToggle = null, onClose = null, onEdit, onDelete = null, patchCreatorLocal = null, findCodeOwner = null, onSetStatus, onToggleVisible, selected, onToggleSelect, noteCount = 0, onNotes = null, onInfo = null, buildContractPayload = null, contractLink = null, onContractLinkChange = null, show = () => true, span = CV_COLS.length + 2 }) {
  const accounts = tiktokAccounts(c.tiktok_handle);
  const contractBtn = <ContractActions c={c} buildPayload={buildContractPayload} link={contractLink} onLinkChange={onContractLinkChange} />;
  const keepBtn = onNotes ? (
    <button className={`pc-keepnote-btn pc-keepnote-mini ${noteCount > 0 ? 'has' : ''}`}
      onClick={e => { e.stopPropagation(); onNotes(); }}
      title={noteCount > 0 ? `${noteCount} creator note${noteCount === 1 ? '' : 's'}` : 'Creator notes'} aria-label="Creator notes">
      <i className="bi bi-journal-text" />
      {noteCount > 0 && <span className="pc-keepnote-count">{noteCount}</span>}
    </button>
  ) : null;
  /* A row here is ONE DEAL — one brand, one month. The "?" opens the PERSON
     behind it: every handle, contact and payout on file, their TikTok Shop standing,
     and every other program they have run for us. It wears the notes button's
     mini shell so the pair reads as one control group beside the name, and
     stops the click from reaching the row (which opens the deal editor).
     The drilldown's CreatorRow carries the same button. */
  const infoBtn = onInfo ? (
    <button className="pc-keepnote-btn pc-keepnote-mini pc-cinfo-btn"
      onClick={e => { e.stopPropagation(); onInfo(); }}
      title={`Full record for ${c.name || 'this creator'}`} aria-label="Creator details">
      <i className="bi bi-question-lg" />
    </button>
  ) : null;
  const amount = Number(c.amount) || 0;
  const videos = parseInt(c.videos_count, 10) || 0;
  const delivered = deliveredCount(c);
  const toReview = toReviewProp != null ? toReviewProp : pendingDraftCount(c.video_codes);
  const avg = videos > 0 ? amount / videos : 0;
  const contact = c.phone || c.email || '';
  const cats = splitCats(c.category);
  const payouts = creatorPayouts(c);
  return (
    <>
      {/* The video panel is a READ as much as an edit, so it opens for a
          read-only viewer too — the drilldown's row has always behaved that
          way, and CreatorExpand withholds its own controls under `ro`. */}
      <tr className={`pc-cv-row ${selected ? 'sel' : ''} ${open ? 'open' : ''}`}
        onClick={onToggle || undefined} role={onToggle ? 'button' : undefined} tabIndex={onToggle ? 0 : undefined}
        aria-label={onToggle ? `Open ${c.name || 'creator'} — videos and ad codes` : undefined}
        style={onToggle ? undefined : { cursor: 'default' }}
        onKeyDown={onToggle ? (e => { if (e.key === 'Enter') onToggle(); }) : undefined}>
        <td className="pc-cv-checkcell" onClick={e => e.stopPropagation()}>
          <input type="checkbox" className="pc-check" checked={selected} onChange={onToggleSelect} />
        </td>
        <td className="pc-dt-idx">{idx}</td>
        <td className="pc-cv-namecell" data-label="Name">
          <span className="pc-dt-who">
            <span className="pc-dt-ava" style={{ background: getGradient(c.name) }}>{cdbInitials(c.name)}</span>
            <span className="pc-dt-name" title={c.name}>{c.name}</span>
            {keepBtn}
            {infoBtn}
          </span>
        </td>
        {show('username') && <td className="pc-cv-usercell" data-label="Username">
          {accounts.length > 0 ? (
            <>
              <a className="pc-dt-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>
              {accounts.length > 1 && <span className="pc-more" title={accounts.slice(1).map(a => a.handle).join(', ')}>+{accounts.length - 1}</span>}
            </>
          ) : <span className="pc-dt-dash">—</span>}
        </td>}
        {show('phone') && <td className="pc-dt-trunc pc-dt-muted" data-label="Phone">
          {c.phone ? <span title={c.phone}>{c.phone}</span> : <span className="pc-dt-dash">—</span>}
        </td>}
        {show('email') && <td className="pc-dt-trunc pc-dt-muted" data-label="Email">
          {c.email ? <span title={c.email}>{c.email}</span> : <span className="pc-dt-dash">—</span>}
        </td>}
        {show('category') && <td data-label="Category">
          {cats.length ? (
            <span className="pc-dt-chips">
              {cats.slice(0, 1).map(x => <CatChip key={x} name={x} title={cats.join(', ')} />)}
              {cats.length > 1 && <span className="pc-more" title={cats.slice(1).join(', ')}>+{cats.length - 1}</span>}
            </span>
          ) : <span className="pc-dt-dash">—</span>}
        </td>}
        {show('brand') && <td className="pc-cv-brandcell" data-label="Brand">
          <span className="pc-brandtag">{c._brandName}</span>
        </td>}
        {/* the two deal dates get their own columns — they used to ride under the
            brand name, where a date read as part of the brand */}
        {show('onboarded') && <td className="pc-cv-datecell pc-dt-muted" data-label="Onboarded">
          {c.onboarded_on ? <span title={fmtDate(c.onboarded_on)}>{cdbDate(c.onboarded_on)}</span> : <span className="pc-dt-dash">—</span>}
        </td>}
        {show('completed') && <td className="pc-cv-datecell pc-dt-muted" data-label="Completed">
          {c.completed_on ? <span title={fmtDate(c.completed_on)}>{cdbDate(c.completed_on)}</span> : <span className="pc-dt-dash">—</span>}
        </td>}
        {show('deal') && <td className="pc-num pc-cv-dealcell" data-label="Deal">
          <span className="pc-money">{fmt$(amount)}</span>
          {videos > 0 && <span className="pc-dt-sub" title={`${delivered} of ${videos} video${videos === 1 ? '' : 's'} delivered`}>{delivered}/{videos}</span>}
          {toReview > 0 && <span className="pc-draft-tag" title={`${toReview} draft${toReview > 1 ? 's' : ''} waiting for your review`}><i className="bi bi-hourglass-split" />{toReview} to review</span>}
        </td>}
        {show('rate') && <td className="pc-num" data-label="Rate/Vid">
          {avg ? <span className="pc-money">{fmt$(avg)}</span> : <span className="pc-dt-dash">—</span>}
        </td>}
        {/* stopPropagation: the chips copy / open a link, the row opens the
            video panel — a click has to mean one of the two, not both */}
        {show('payout') && <td className="pc-cv-payoutcell" data-label="Payout" onClick={e => e.stopPropagation()}>
          <PayoutChipsRO payouts={payouts} />
        </td>}
        {show('status') && <td className="pc-cv-statuscell" data-label="Status" onClick={e => e.stopPropagation()}>
          <span className="pc-cv-statuswrap">
            <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
            {/* iconOnly: the label lives in the tooltip, so the eye sits beside the
                status pill instead of wrapping onto a second line */}
            <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} iconOnly />
          </span>
        </td>}
        {show('contract') && <td className="pc-cv-contractcell" data-label="Contract" onClick={e => e.stopPropagation()}>{contractBtn}</td>}
      </tr>

      {/* ── purpose-built mobile card: its own full-width row, so the phone gets a
           real card instead of twelve stacked cells (the ≤900px block swaps
           which of the two rows is shown) ── */}
      <tr className={`pc-cv-mrow ${selected ? 'sel' : ''}`}
        onClick={onToggle || undefined}
        style={onToggle ? undefined : { cursor: 'default' }}>
        <td colSpan={span}>
          <div className="pc-mc">
            <div className="pc-mc-head">
              <div className="pc-mc-idblock">
                <div className="pc-mc-name">{c.name}{keepBtn}{infoBtn}</div>
                <div className="pc-mc-subline">
                  {accounts[0]
                    ? <a className="pc-mc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>
                    : <span className="pc-mc-muted">no TikTok</span>}
                  {accounts.length > 1 && <span className="pc-more">+{accounts.length - 1}</span>}
                  <span className="pc-mc-dot">·</span>
                  <span className="pc-mc-brand">{c._brandName}</span>
                </div>
              </div>
              <label className="pc-mc-checkwrap" onClick={e => e.stopPropagation()}>
                <input type="checkbox" className="pc-check" checked={selected} onChange={onToggleSelect} />
              </label>
            </div>
            <div className="pc-mc-stats pc-mc-stats-3">
              <div className="pc-mc-stat"><b>{fmt$(amount)}</b><span>Deal</span></div>
              <div className="pc-mc-stat"><b>{videos || '—'}</b><span>Videos</span></div>
              <div className="pc-mc-stat"><b>{avg ? fmt$(avg) : '—'}</b><span>Rate / Vid</span></div>
            </div>
            <div className="pc-mc-foot">
              <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
              <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} />
              {contractBtn}
              {payouts.length > 0 && <span className="pc-mc-footmeta" onClick={e => e.stopPropagation()}><PayoutChipsRO payouts={payouts} /></span>}
              <div className="pc-mc-footmeta">
                {splitCats(c.category).slice(0, 2).map(x => <CatChip key={x} name={x} />)}
                {c.onboarded_on && <span className="pc-mc-muted">Onboarded {cdbDate(c.onboarded_on)}</span>}
                {c.completed_on && <span className="pc-mc-muted">Completed {cdbDate(c.completed_on)}</span>}
              </div>
            </div>
            {contact && <div className="pc-mc-contact">{contact}</div>}
          </div>
        </td>
      </tr>

      {/* Videos & ad codes for this deal — the drilldown's popup, verbatim.
          ‼️ A SIBLING of the two rows, never a child: react-bootstrap portals
          the dialog to <body>, but clicks still bubble up the REACT tree, so
          nested inside a row every click inside the panel would re-fire that
          row's toggle. It renders nothing in the <tbody> for the same reason. */}
      {open && onClose && (
        <CreatorPanelShell asModal name={c.name} handle={accounts[0]?.handle} onClose={onClose}>
          <CreatorExpand c={c} idx={idx}
            onEdit={() => { onClose(); onEdit(); }}
            onDelete={onDelete ? () => { onClose(); onDelete(); } : undefined}
            patchCreatorLocal={patchCreatorLocal} findCodeOwner={findCodeOwner} />
        </CreatorPanelShell>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   CREATORS DATABASE — the archive of every creator we know, one row
   per PERSON (not per deal).

   Two sources, merged live on the global identity key (first TikTok
   handle, else name — store.creatorGlobalKey, mirrored by the SQL
   creator_identity_key()):
     · WORKING WITH US — derived from the deal rows (handler_collab_creators),
       so brands / deal counts / totals can never drift out of sync.
     · IN THE DATABASE — creator_directory rows: credentials banked for
       creators we haven't (yet) onboarded, shared across all handlers + Bob.
   A directory entry that later signs a deal simply gains its deal stats here;
   its curated credentials win over whatever a deal row happens to carry.
════════════════════════════════════════════════════════════ */
/* Total GMV for one deal. ONE BODY, shared with the client portal and the public
   share link: the rule (both lenses, each month counted once) lives in
   handlerCollabReadonly's gmvSum, which this used to duplicate. Kept as a named
   wrapper because every call site here passes `c.monthly`, not the creator. */
function creatorGmvTotal(monthly) { return gmvSum({ monthly }); }

/* One person's deals -> the PROGRAMS (brand-months) they worked, newest first.

   ‼️ THIS IS WHY THE POPUP'S GMV COLUMN USED TO LIE. It listed one row per DEAL
   and printed that deal's LIFETIME GMV against the month it was signed in — so
   a creator signed into Dreamiere's July program who kept selling through
   August had all $502 of her August money printed on the JULY row, while the
   August row beside it read "—". Verified on the live data before the change.

   A program row is a BRAND-MONTH, and its GMV is the sum of what EVERY deal of
   theirs with that brand recorded in that month (`gmvMonths`). So money always
   lands on the month it was earned in, and the rows still add up to Total GMV
   exactly — nothing is created and nothing is lost.

   A row can therefore exist with no deal of its own (`deal: null`): they were
   selling in that month on a contract signed earlier. `fromMonths` names where
   that money came from, because Deal / Videos / Status describe a deal and
   there simply is not one to describe. Deal terms are never carried across —
   a fee is committed once, in the month it was signed. */
function buildPrograms(deals) {
  const rows = new Map();
  const row = (d, month) => {
    const k = `${d.brandId}|${month}`;
    let r = rows.get(k);
    if (!r) { r = { key: k, brandId: d.brandId, brand: d.brand, month, gmv: 0, currency: d.currency, deal: null, fromMonths: [] }; rows.set(k, r); }
    return r;
  };
  // The deal's own program first, so a month that has one is never mistaken for
  // a carried-over row just because the GMV was bucketed before it.
  deals.forEach(d => { const r = row(d, d.month || ''); if (!r.deal) r.deal = d; });
  deals.forEach(d => Object.entries(d.gmvMonths || {}).forEach(([m, v]) => {
    const r = row(d, m);
    r.gmv += Number(v) || 0;
    if (d.month && d.month !== m && !r.fromMonths.includes(d.month)) r.fromMonths.push(d.month);
  }));
  return [...rows.values()]
    .map(r => ({ ...r, fromMonths: r.fromMonths.sort().reverse() }))
    .sort((a, b) => String(b.month).localeCompare(String(a.month)) || a.brand.localeCompare(b.brand));
}

/* ‼️ EXPORTED: the public page builds its rows through this SAME merge, so a
   creator cannot read one way in the workspace and another on a shared link. */
export function buildCreatorDatabase(deals, directory) {
  const map = new Map();
  const blank = key => ({
    key, name: '', handles: [], phone: '', email: '', category: '', categories: [],
    paypal: '', zelle: '', region: '', followers: null, rate: null, notes: '', tags: [],
    brands: [], deals: [], dealCount: 0, totalValue: 0, totalGmv: 0,
    agreedVideos: 0, deliveredVideos: 0,
    firstOn: '', lastOn: '', currency: 'USD', dir: null,
    // filled after the merge — see the derive pass at the bottom
    brandCount: 0, programCount: 0, programs: [], activeDeals: [], working: false, current: null,
  });
  const addHandles = (e, raw) => {
    tiktokAccounts(raw).forEach(a => {
      const k = a.handle.replace(/^@/, '').toLowerCase();
      if (k && !e.handles.some(h => h.handle.replace(/^@/, '').toLowerCase() === k)) e.handles.push(a);
    });
  };
  // Deals arrive newest-first, so "first non-empty wins" = most recent value.
  const fill = (e, f, v) => { if (!e[f] && v && String(v).trim()) e[f] = String(v).trim(); };

  deals.forEach(c => {
    const key = store.creatorGlobalKey(c);
    if (!key || key === 'n:') return;
    const e = map.get(key) || blank(key);
    fill(e, 'name', c.name);
    addHandles(e, c.tiktok_handle);
    ['phone', 'email', 'category', 'paypal', 'zelle'].forEach(f => fill(e, f, c[f]));
    const brand = c._brandName || '—';
    if (brand !== '—' && !e.brands.includes(brand)) e.brands.push(brand);
    /* ‼️ A DEAL IS NOT A PROGRAM. A deal is signed into one month; the money it
       earns can land in several, and often does. `gmvMonths` is that breakdown,
       and `buildPrograms` below is what turns a person's deals into the
       brand-MONTHS they actually worked. */
    const gmvMonths = gmvByMonth(c);
    const gmv = creatorGmvTotal(c.monthly);
    /* ‼️ The public payload carries `videos_delivered` (a COUNT) INSTEAD of
       `video_codes`, because that array holds our ad codes and has no business
       on a shared page. Same number, one field earlier. */
    const delivered = Array.isArray(c.video_codes)
      ? deliveredCount(c)
      : Number(c.videos_delivered) || 0;
    e.deals.push({
      id: c.id, brandId: c.brand_id, brand, month: c._monthKey || '',
      status: c.payment_status || DEFAULT_STATUS,
      amount: Number(c.amount) || 0, gmv, gmvMonths,
      videos: parseInt(c.videos_count, 10) || 0, delivered,
      onboarded: c.onboarded_on || '', currency: c._brandCurrency || 'USD',
    });
    e.dealCount += 1;
    e.totalValue += Number(c.amount) || 0;
    e.totalGmv += gmv;
    e.agreedVideos += parseInt(c.videos_count, 10) || 0;
    e.deliveredVideos += delivered;
    if (c._brandCurrency) e.currency = c._brandCurrency;
    const on = c.onboarded_on || '';
    if (on) {
      if (!e.lastOn || on > e.lastOn) e.lastOn = on;
      if (!e.firstOn || on < e.firstOn) e.firstOn = on;
    }
    map.set(key, e);
  });

  directory.forEach(d => {
    const key = d.identity_key || store.creatorGlobalKey(d);
    if (!key || key === 'n:') return;
    const e = map.get(key) || blank(key);
    e.dir = d;
    // Curated record wins over whatever a deal row carried.
    if (d.name) e.name = d.name;
    addHandles(e, d.tiktok_handle);
    ['phone', 'email', 'category', 'paypal', 'zelle'].forEach(f => { if (d[f]) e[f] = d[f]; });
    if (Array.isArray(d.categories) && d.categories.length) e.categories = d.categories.slice();
    e.region = d.region || '';
    e.followers = d.followers != null ? Number(d.followers) : null;
    e.rate = d.rate != null ? Number(d.rate) : null;
    e.notes = d.notes || '';
    e.tags = Array.isArray(d.tags) ? d.tags : [];
    map.set(key, e);
  });

  /* Derive the "where have they worked / are they working now" facts. Deals were
     pushed newest-first (allCreatorsList is sorted that way), so [0] is always
     the most recent. "Working now" = a deal still in progress or awaiting a
     follow-up; pending/paid/terminated are finished engagements. */
  return [...map.values()].filter(e => e.name || e.handles.length).map(e => {
    e.brandCount = new Set(e.deals.map(d => d.brandId)).size;
    // ‼️ Counted off the PROGRAMS, not the deals — a month they sold in on an
    // earlier contract is a program they worked, and it is a row in the popup.
    e.programs = buildPrograms(e.deals);
    e.programCount = e.programs.length;
    e.activeDeals = e.deals.filter(d => d.status === 'videos_in_progress' || d.status === 'follow_up');
    e.working = e.activeDeals.length > 0;
    e.current = e.activeDeals[0] || null;   // what they're on right now
    e.lastDeal = e.deals[0] || null;        // else the most recent thing they did
    // "On our books since": their first onboarding, or the day they were banked
    // when they have never had a deal. Drives the Onboarded column + its sort.
    e.addedOn = e.dir?.created_at ? String(e.dir.created_at).slice(0, 10) : '';
    e.sinceOn = e.firstOn || e.addedOn || '';
    // Creators still carrying the old comma-crammed single field ("Lifestyle,
    // fitness") read as proper tags without waiting for someone to re-save them.
    if (!e.categories.length && e.category) {
      e.categories = String(e.category).split(',').map(s => s.trim()).filter(Boolean);
    }
    return e;
  });
}

/* Sortable columns. `dir` is the direction a first click applies — names read
   A→Z, everything numeric or date-like reads biggest/newest first, which is
   what you actually want on the first click.

   Every column also carries a stable `key`, which is what the show/hide
   preference is stored against. It is deliberately SEPARATE from the sort `id`
   (Programs sorts by 'reach') so that renaming or re-pointing a sort can never
   silently reshuffle someone's saved column layout. */
/* FOUR columns, deliberately — the table answers “who is this, what do they
   cover, how good are they, what have they earned us” and hands everything
   else to the detail popup. The username rides UNDER the name rather than in a
   column of its own: it identifies the same person, so splitting it across two
   columns spent width saying one thing twice.

   ‼️ The EXPORT registry (CDB_EXPORT_COLUMNS) is separate and still carries
   all 26 fields. Narrowing what is read on screen must not narrow the record
   people take away. */
const CDB_COLS = [
  { key: 'name', id: 'name', label: 'Name', dir: 'asc' },
  { key: 'categories', label: 'Categories' },
  // First onboarding (latest underneath when they have come back); a creator
  // with no deal shows the day they were banked instead, marked as such.
  { key: 'onboarded', id: 'onboarded', label: 'Onboarded', dir: 'desc', cls: 'pc-cdb-oncol',
    title: 'Date first onboarded onto one of our programs (the day they were added to the database if they have no deal yet).' },
  // Reacher (external): the creator's standing on TikTok Shop overall, which is
  // a different thing from the "GMV" column (what they earned on OUR programs,
  // entered on the Performance tab). Level is graded on TT GMV.
  { key: 'level', id: 'level', label: 'Level', dir: 'desc', num: true, cls: 'pc-cdb-levelcol',
    title: 'Reacher L0–L7 tier, graded on the creator’s platform-wide TikTok Shop GMV (the TT GMV column).' },
  { key: 'avgviews', id: 'avgviews', label: 'Avg views', dir: 'desc', num: true, cls: 'pc-cdb-avgviewscol',
    title: 'Average views per video (Reacher).' },
  { key: 'ttgmv', id: 'ttgmv', label: 'TT GMV', dir: 'desc', num: true, cls: 'pc-cdb-ttgmvcol',
    title: 'The creator’s total TikTok Shop GMV across every brand they sell for (Reacher). Not what they earned for us — that is the GMV column.' },
  { key: 'gmv', id: 'gmv', label: 'GMV', dir: 'desc', num: true, cls: 'pc-cdb-gmvcol',
    title: 'GMV this creator generated on our programs, as entered on the Performance tab.' },
];
/* Identity is not hideable — a row nobody can name is not a row. The index and
   the action buttons sit outside CDB_COLS entirely, so they are never offered. */
const CDB_LOCKED_COL = 'name';
/* The gap between two chips, and the room kept back for the "+N" counter.
   Both mirror handlerCollab.css (.pc-dt-chips gap, .pc-dtable .pc-more) — keep
   them in step, or the fit is measured against a width the browser does not
   actually have. */
const CHIP_GAP = 6;
const CHIP_MORE_W = 32;

/* How many chips a row shows before collapsing the rest into a +N.

   ‼️ MEASURED, not a constant. It used to be a flat "show 3", which printed a
   "+6" with most of the column still empty — the count belongs to the WIDTH of
   the cell, not to a number picked once.
   ‼️ Chip widths are INTRINSIC (nothing here shrinks while the row fits), so
   they are read ONCE off the first paint — which is why that paint renders
   every chip — and every later fit is arithmetic against the container width.
   A hidden chip measures 0, so re-measuring after a collapse would answer with
   zeros and the row would keep shrinking.
   ‼️ At least one chip always shows, ellipsed if it alone is too wide: a cell
   reading nothing but "+4" names none of the categories it is counting.
   ‼️ They must never WRAP — a second line doubles that one row's height and
   breaks the list's rhythm. */
export function FitChips({ items }) {
  const ref = useRef(null);
  const widths = useRef(null);
  const measuredFor = useRef(null);
  const [fit, setFit] = useState(items.length);

  /* ‼️ `fit` is in the deps on purpose. A hidden chip measures 0, so when a
     creator's categories change while the row is collapsed there is nothing to
     measure yet — this shows every chip again and the re-run does the reading.
     ResizeObserver's own initial callback happens to cover that case as well,
     but leaning on it would make a correct row depend on an implementation
     detail of an API being used here for something else. */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => {
      if (measuredFor.current !== items) {
        const chips = Array.from(el.querySelectorAll('.pc-cat'));
        if (chips.length !== items.length) return;
        if (chips.some(c => c.hasAttribute('hidden'))) { setFit(items.length); return; }
        widths.current = chips.map(c => c.getBoundingClientRect().width);
        measuredFor.current = items;
      }
      const w = widths.current;
      const avail = el.clientWidth;
      let used = 0, n = 0;
      for (let i = 0; i < w.length; i++) {
        const need = w[i] + (i ? CHIP_GAP : 0);
        if (used + need > avail) break;
        used += need; n++;
      }
      /* the counter needs room of its own, so give some back until it fits */
      while (n > 1 && n < w.length && used + CHIP_GAP + CHIP_MORE_W > avail) {
        n--; used -= w[n] + CHIP_GAP;
      }
      setFit(Math.max(1, n));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [items, fit]);

  const hidden = items.slice(fit);
  return (
    <span className="pc-dt-chips" ref={ref}>
      {items.map((c, i) => (
        <CatChip key={c} name={c} hidden={i >= fit} title={items.join(', ')} />
      ))}
      {hidden.length > 0 && <span className="pc-more" title={hidden.join(', ')}>+{hidden.length}</span>}
    </span>
  );
}
/* ‼️ exported for the mount harness only — CreatorDbRow is its one caller. */
const CDB_COLS_STORE = 'ac_pc_cdb_cols';

/* Which columns this user has switched off.

   ‼️ Stores the HIDDEN keys, not the visible ones. A column added to CDB_COLS
   later then defaults to VISIBLE for everyone who already has a preference
   saved; storing the visible set instead would make every future column
   invisible to existing users, with nothing to indicate why. */
/* Pure: what a stored preference is allowed to mean. Anything unknown (a column
   since renamed or removed) and the locked column are dropped, so a stale
   localStorage value can never hide a column that no longer exists — nor the
   name column, if that rule is ever relaxed and then tightened again. */
export function sanitizeHiddenCols(raw, keys = CDB_COLS.map(c => c.key), locked = CDB_LOCKED_COL) {
  if (!Array.isArray(raw)) return new Set();
  const known = new Set(keys);
  return new Set(raw.filter(k => typeof k === 'string' && known.has(k) && k !== locked));
}

/* The hook and the picker below are SHARED by the Creators Database and the
   Creators tab — each passes its own column list, storage key and locked
   column. Two dense tables with the same control must not grow two copies of
   it; that is how they start disagreeing about what "Show all" means. */
function useCdbColumns(columns = CDB_COLS, storeKey = CDB_COLS_STORE, locked = CDB_LOCKED_COL) {
  const keys = useMemo(() => columns.map(c => c.key), [columns]);
  const [hidden, setHidden] = useState(() => {
    try {
      return sanitizeHiddenCols(JSON.parse(localStorage.getItem(storeKey) || '[]'), keys, locked);
    } catch { return new Set(); }
  });
  const persist = (next) => {
    setHidden(next);
    try { localStorage.setItem(storeKey, JSON.stringify([...next])); } catch { /* private mode: session-only is fine */ }
  };
  return {
    hidden,
    isVisible: (key) => !hidden.has(key),
    toggle: (key) => {
      if (key === locked) return;
      const next = new Set(hidden);
      next.has(key) ? next.delete(key) : next.add(key);
      persist(next);
    },
    showAll: () => persist(new Set()),
  };
}

/* The show/hide picker. A plain checkbox list — a dozen-odd columns is small
   enough that grouping or searching would be more machinery than the job needs. */
function CdbColumnsMenu({ hidden, onToggle, onShowAll, columns = CDB_COLS, locked = CDB_LOCKED_COL }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    // stopPropagation so dismissing the menu can't also close a surrounding modal
    const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  const n = hidden.size;
  return (
    <div className="pc-colmenu" ref={ref}>
      <button type="button" className={`pc-btn pc-btn-ghost pc-btn-sm pc-colmenu-btn ${n ? 'on' : ''}`}
        onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="true"
        title="Choose which columns to show">
        <i className="bi bi-layout-three-columns" />
        Columns
        {n > 0 && <span className="pc-colmenu-count">{n}</span>}
      </button>
      {open && (
        <div className="pc-colmenu-pop">
          <div className="pc-colmenu-head">
            <span>Show columns</span>
            <button type="button" className="pc-linkbtn" onClick={onShowAll} disabled={!n}>Show all</button>
          </div>
          <div className="pc-colmenu-list">
            {columns.map(c => {
              const isLocked = c.key === locked;
              return (
                <label key={c.key} className={`pc-colmenu-row ${isLocked ? 'locked' : ''}`}
                  title={isLocked ? 'The name column is always shown' : undefined}>
                  <input type="checkbox" className="pc-check" checked={!hidden.has(c.key)}
                    disabled={isLocked} onChange={() => onToggle(c.key)} />
                  <span>{c.label}</span>
                  {isLocked && <i className="bi bi-lock-fill" />}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
// "Working now" vs "worked before" vs "never had a deal".
const CDB_SOURCES = [
  { id: 'all', label: 'All' },
  { id: 'working', label: 'Working now' },
  { id: 'past', label: 'Worked before' },
  { id: 'db', label: 'No deal yet' },
];
/* The same table read for ONE month (the header's month picker). Every ID here
   is distinct from CDB_SOURCES so a stale filter can never carry across a
   scope switch and silently mean something else. */
const CDB_MONTH_SOURCES = [
  { id: 'm_all', label: 'Active this month' },
  { id: 'm_onboarded', label: 'Onboarded' },
  { id: 'm_new', label: 'New to us' },
  { id: 'm_carried', label: 'Still selling' },
];
const CDB_SCOPE_STORE = 'ac_pc_cdb_scope';
/* One person's month, read off what buildCreatorDatabase already derived.
   ‼️ The two halves of a program use different rules, the programStats rule:
   GMV is what they EARNED in the month (any deal, `programs`), while onboarding
   and deal value belong only to the deals SIGNED into that month (`deals`,
   whose `month` is the onboarding month) — so a fee is counted once, in the
   month it was committed, however long the creator keeps selling. */
export function cdbMonthStats(e, m) {
  const progs = (e.programs || []).filter(p => p.month === m);
  const signed = (e.deals || []).filter(d => d.month === m);
  const firstMonth = (e.deals || []).map(d => d.month).filter(Boolean).sort()[0] || '';
  const onboarded = signed.length > 0;
  return {
    active: progs.length > 0,
    onboarded,
    isNew: onboarded && firstMonth === m,
    carried: progs.length > 0 && !onboarded,
    gmv: progs.reduce((t, p) => t + (Number(p.gmv) || 0), 0),
    value: signed.reduce((t, d) => t + (Number(d.amount) || 0), 0),
    brandIds: [...new Set(progs.map(p => p.brandId))],
  };
}
/* Reacher is looked up by TikTok handle. A creator can have several handles on
   file, so try each and take the first Reacher knows — the person is the same
   either way. Returns null when Reacher has never seen them (shown as "—", never
   as a zero, which would read as "sold nothing"). */
function reacherFor(entry, stats) {
  if (!stats) return null;
  for (const h of entry.handles || []) {
    const k = reacherKey(h.handle);
    if (k && stats[k]) return stats[k];
  }
  return null;
}
/* Same normalisation as handlesOf() in the reacher-creator-stats edge function,
   which is what keyed the cache: a profile URL's last segment, no query string,
   no @, lower case. Keep the two in step. */
function reacherKey(raw) {
  let t = String(raw || '').trim().replace(/\/+$/, '');
  if (/^https?:/i.test(t)) t = t.split('/').pop() || '';
  return t.replace(/[?#].*$/, '').replace(/^@+/, '').trim().toLowerCase();
}
// One cached row -> what the table reads. `ttGmv` stays a number (a real $0 is
// a found creator who has sold nothing); a handle Reacher never matched has no
// entry at all, which renders "—".
// "3h ago" / "just now" for the Reacher status chip.
function cdbAgo(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!(m >= 1)) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
export function reacherStat(r) {
  const g = r.tt_gmv == null ? null : Number(r.tt_gmv);
  return { level: r.level || null, ttGmv: Number.isFinite(g) ? g : null,
    followers: r.followers == null ? null : Number(r.followers),
    avgViews: r.avg_views == null ? null : Number(r.avg_views), fetchedAt: r.fetched_at || null };
}
// "L5" -> 5, so the Level column sorts by magnitude rather than alphabetically
// (where L10 would fall between L1 and L2).
const levelRank = (lvl) => {
  if (!lvl) return -1;
  const m = String(lvl).match(/(\d+)/);
  return m ? Number(m[1]) : -1;
};

/* Two-letter monogram for the row avatar: first letters of the first two words,
   so "Anna Lawrence" reads AL and a single-name creator keeps one letter. */
function cdbInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const s = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  return s.toUpperCase() || '?';
}

// Compact "12 Mar 25" — the table shows dozens of dates at once, so the long
// form the rest of the workspace uses would dominate the row.
function cdbDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return String(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
// "3y 2m" / "7m" / "12d" since a date — how long they have been on our books.
function cdbSince(iso) {
  if (!iso) return '';
  const then = new Date(String(iso).length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(then.getTime())) return '';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days < 0) return '';
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12), rem = months % 12;
  return rem ? `${years}y ${rem}m` : `${years}y`;
}

/* Memoised — see MEMOISED TAB BODIES at the top of this file. */
/* ‼️ `publicView` is the SHARED-LINK reading of this table, and it is a separate
   flag from `ro` on purpose. `ro` is Bob's read-only workspace, which KEEPS its
   exports (the 2026-08-14 call) — a public link does not, and that is the whole
   of what this flag withdraws beyond the write controls: Import, Export, the
   column picker, and the two Reacher columns. See SharedCreatorDb.tsx. */
export const CreatorDatabaseView = React.memo(function CreatorDatabaseViewBody({ entries, onAdd, onEdit, onDelete, onAddToProgram, onImport, deleteGate, categories = [],
  reacher = { stats: {}, loading: false, syncing: false, err: '', count: 0, total: 0, remaining: 0, rateLimited: false, loaded: false }, onReloadReacher = null,
  publicView = false, onShare = null, hideContact = false, month = null, onManageCategories = null }) {
  const ro = useRO();
  /* All time (the archive) or the header's month. Remembered per browser, and
     only offered where a month is in scope — the public link has none. */
  const [scopePref, setScopePref] = useState(() => {
    try { return localStorage.getItem(CDB_SCOPE_STORE) === 'month' ? 'month' : 'all'; } catch { return 'all'; }
  });
  const scope = month ? scopePref : 'all';
  const byMonth = scope === 'month';
  const [q, setQ] = useState('');
  /* The input keeps `q` (so what you type appears at once) while the TABLE reads
     the deferred copy — rebuilding hundreds of rows on every keystroke is what
     made this search feel like it was fighting you. */
  const dq = useDeferredValue(q);
  const [source, setSource] = useState('all');   // all | working | past | db, or the m_* month set
  const pickScope = (next) => {
    setScopePref(next);
    setSource(next === 'month' ? 'm_all' : 'all');
    try { localStorage.setItem(CDB_SCOPE_STORE, next); } catch { /* private mode */ }
  };
  // A scope remembered from last visit has to start on its own filter set.
  const src = byMonth ? (source.startsWith('m_') ? source : 'm_all') : (source.startsWith('m_') ? 'all' : source);
  const monthOf = useMemo(() => {
    if (!byMonth) return null;
    const out = new Map();
    entries.forEach(e => out.set(e.key, cdbMonthStats(e, month)));
    return out;
  }, [entries, byMonth, month]);
  // In month scope the table is the people who worked THAT month — onboarded
  // into it, or still selling in it on an earlier deal.
  const scoped = useMemo(() => (byMonth ? entries.filter(e => monthOf.get(e.key).active) : entries), [entries, byMonth, monthOf]);
  const gmvOf = useCallback((e) => (byMonth ? monthOf.get(e.key)?.gmv || 0 : e.totalGmv), [byMonth, monthOf]);
  /* Several categories at once — 'any' keeps a creator carrying at least one of
     them, 'all' only those carrying every one. */
  const [cats, setCats] = useState([]);
  const [catMode, setCatMode] = useState('any');
  // counted over the scope (before the category filter), so each option says
  // how many creators picking it would show
  const catOptions = useMemo(() => {
    const opts = countCategories(scoped.map(e => e.categories));
    const seen = new Set(opts.map(o => o.name.toLowerCase()));
    categories.forEach(c => { if (!seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); opts.push({ name: c, count: 0 }); } });
    return opts;
  }, [scoped, categories]);
  const [sort, setSort] = useState({ by: 'name', dir: 'asc' });
  const [openKey, setOpenKey] = useState(null);
  const [copied, setCopied] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const cols = useCdbColumns();
  /* The Reacher columns (Level / Avg views / TT GMV) show on a public link too
     since 2026-09-23: creator_db_shared() carries the cached figures, so the
     page has real values rather than a column of dashes. */
  const visibleCol = useCallback((key) => cols.isVisible(key), [cols]);
  const shownCols = CDB_COLS.filter(c => visibleCol(c.key));

  // Click a header to sort by it; click the active one again to reverse.
  const toggleSort = (col) => setSort(prev => prev.by === col.id
    ? { by: col.id, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
    : { by: col.id, dir: col.dir });

  /* Hiding the column the list is sorted BY would leave the order driven by
     something no longer on screen, with no arrow to explain it — so that case
     falls back to the default name sort. */
  const toggleCol = (key) => {
    const col = CDB_COLS.find(c => c.key === key);
    if (col && col.id && col.id === sort.by && cols.isVisible(key)) setSort({ by: 'name', dir: 'asc' });
    cols.toggle(key);
  };

  const workingCount = entries.filter(e => e.working).length;
  const pastCount = entries.filter(e => !e.working && e.dealCount > 0).length;
  const dbOnlyCount = entries.filter(e => e.dealCount === 0).length;
  const brandsCovered = new Set(entries.flatMap(e => e.brands)).size;
  const totalGmv = entries.reduce((s, e) => s + (e.totalGmv || 0), 0);
  const mStats = useMemo(() => {
    if (!byMonth) return null;
    const ms = scoped.map(e => monthOf.get(e.key));
    return {
      active: ms.length,
      onboarded: ms.filter(x => x.onboarded).length,
      isNew: ms.filter(x => x.isNew).length,
      carried: ms.filter(x => x.carried).length,
      brands: new Set(ms.flatMap(x => x.brandIds)).size,
      gmv: ms.reduce((t, x) => t + x.gmv, 0),
      value: ms.reduce((t, x) => t + x.value, 0),
    };
  }, [byMonth, scoped, monthOf]);

  const filtered = useMemo(() => {
    const s = dq.trim().toLowerCase();
    let out = scoped.filter(e => {
      if (src === 'working' && !e.working) return false;
      if (src === 'past' && (e.working || e.dealCount === 0)) return false;
      if (src === 'db' && e.dealCount > 0) return false;
      if (src === 'm_onboarded' && !monthOf.get(e.key).onboarded) return false;
      if (src === 'm_new' && !monthOf.get(e.key).isNew) return false;
      if (src === 'm_carried' && !monthOf.get(e.key).carried) return false;
      if (cats.length && !matchesCategories(e.categories, cats, catMode)) return false;
      if (!s) return true;
      const hay = [e.name, e.categories.join(' '), e.region, e.phone, e.email, e.paypal, e.zelle,
        e.notes, e.tags.join(' '), e.brands.join(' '), e.handles.map(h => h.handle).join(' ')]
        .join(' ').toLowerCase();
      return hay.includes(s);
    });
    // Rank by the active column, then always fall back to name so the order is
    // stable when values tie (dozens of creators share 0 GMV).
    const rank = (e) => {
      switch (sort.by) {
        case 'onboarded': return e.sinceOn || '';          // ISO strings compare correctly
        case 'reach': return e.programCount;
        case 'level': return levelRank(reacherFor(e, reacher.stats)?.level);
        case 'ttgmv': return reacherFor(e, reacher.stats)?.ttGmv ?? -1;
        case 'avgviews': return reacherFor(e, reacher.stats)?.avgViews ?? -1;
        case 'gmv': return gmvOf(e);
        case 'value': return e.totalValue;
        case 'working': return e.working ? 2 : e.dealCount > 0 ? 1 : 0;
        default: return (e.name || '').toLowerCase();
      }
    };
    const flip = sort.dir === 'asc' ? 1 : -1;
    out = out.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      let cmp = typeof ra === 'string' ? ra.localeCompare(rb) : (ra - rb);
      // Undated creators sink to the bottom whichever way the date sorts.
      if (sort.by === 'onboarded') {
        if (!a.sinceOn && b.sinceOn) return 1;
        if (a.sinceOn && !b.sinceOn) return -1;
      }
      cmp *= flip;
      return cmp || (a.name || '').localeCompare(b.name || '');
    });
    return out;
  }, [scoped, dq, src, cats, catMode, sort, reacher.stats, monthOf, gmvOf]);

  function flash(k) { setCopied(k); setTimeout(() => setCopied(x => (x === k ? '' : x)), 1800); }
  function copyHandles() {
    const seen = new Set(), out = [];
    filtered.forEach(e => e.handles.forEach(h => {
      const u = h.handle.replace(/^@/, '').trim(), k = u.toLowerCase();
      if (u && !seen.has(k)) { seen.add(k); out.push(u); }
    }));
    if (out.length) { copyText(out.join('\n')); flash('u'); }
  }
  /* One database entry, flattened for the export dialog. Lives here rather
     than in lib/creatorDbExport because it is the only place holding the Reacher
     stats and the month formatter; everything downstream of this row is pure.
     A blank stays '' rather than 0 — "we do not know" and "zero" are different
     answers, and a spreadsheet totals them differently. */
  const toExportRow = useCallback((e) => {
    const rs = reacherFor(e, reacher.stats);
    return {
      name: e.name,
      usernames: e.handles.map(h => h.handle.replace(/^@/, '')).join(', '),
      level: rs?.level || '',
      ttGmv: rs?.ttGmv ?? '',
      avgViews: rs?.avgViews ?? '',
      firstOn: e.firstOn || '',
      lastOn: e.lastOn || '',
      addedOn: e.addedOn || '',
      categories: e.categories.join(', '),
      region: e.region || '',
      phone: e.phone || '',
      email: e.email || '',
      paypal: e.paypal || '',
      zelle: e.zelle || '',
      followers: e.followers ?? '',
      rate: e.rate ?? '',
      status: e.working ? 'Working now' : e.dealCount > 0 ? 'Worked before' : 'No deal yet',
      workingOn: e.current ? `${e.current.brand} · ${monthLabel(e.current.month)}` : '',
      brands: e.brands.join(', '),
      brandCount: e.brandCount,
      programs: e.programCount,
      deals: e.dealCount,
      totalGmv: e.totalGmv || '',
      totalValue: e.totalValue || '',
      videos: e.agreedVideos ? `${e.deliveredVideos}/${e.agreedVideos}` : '',
      tags: e.tags.join(', '),
      notes: e.notes || '',
    };
  }, [reacher.stats]);
  const openEntry = useMemo(() => (openKey ? entries.find(x => x.key === openKey) || null : null), [entries, openKey]);
  const exportFiltered = useMemo(() => filtered.map(toExportRow), [filtered, toExportRow]);
  const exportAll = useMemo(() => entries.map(toExportRow), [entries, toExportRow]);
  /* Names the filtered half in the dialog's row choice. The dialog only offers
     that choice when the two counts differ, so this never has to describe
     "everything" as though it were a filter. */
  const filterLabel = useMemo(() => {
    const bits = [];
    if (byMonth) bits.push(monthLabel(month));
    if (src !== 'all' && src !== 'm_all') bits.push(([...CDB_SOURCES, ...CDB_MONTH_SOURCES].find(s => s.id === src)?.label || src).toLowerCase());
    if (cats.length) bits.push(cats.join(catMode === 'all' ? ' + ' : ' / '));
    if (dq.trim()) bits.push(`“${dq.trim()}”`);
    return bits.length ? `Matching ${bits.join(' · ')}` : 'On screen';
  }, [src, cats, catMode, dq, byMonth, month]);

  return (
    <>
      {/* Six blocks across the full width. Each one's tint matches the thing it
          counts elsewhere in the table (green "working now" chips, accent brand
          chips, green GMV), and the four that mirror a filter are clickable, so
          the summary doubles as the filter row rather than decorating it. */}
      {month && !publicView && (
        <div className="pc-cdb-scope" role="group" aria-label="Period">
          <span className="pc-cdb-scope-lbl">Showing</span>
          <button type="button" className={`pc-cdb-scope-btn ${!byMonth ? 'on' : ''}`} aria-pressed={!byMonth} onClick={() => pickScope('all')}>
            <i className="bi bi-archive" /> All time
          </button>
          <button type="button" className={`pc-cdb-scope-btn ${byMonth ? 'on' : ''}`} aria-pressed={byMonth} onClick={() => pickScope('month')}>
            <i className="bi bi-calendar3" /> {monthLabel(month)}
          </button>
          {byMonth && <span className="pc-cdb-scope-note">Follows the month picker above. GMV is what was earned that month; onboarded and deal value count deals signed into it.</span>}
        </div>
      )}
      <div className="pc-cdb-stats">
        {(byMonth ? [
          { id: 'm_all', tone: 'lead', icon: 'bi-people-fill', value: mStats.active, label: 'active this month' },
          { id: 'm_onboarded', tone: 'live', icon: 'bi-person-plus', value: mStats.onboarded, label: `onboarded · ${fmt$(mStats.value)} in deals` },
          { id: 'm_new', tone: 'brand', icon: 'bi-stars', value: mStats.isNew, label: 'new to us' },
          { id: 'm_carried', tone: 'past', icon: 'bi-arrow-repeat', value: mStats.carried, label: 'still selling from earlier' },
          { tone: 'idle', icon: 'bi-shop', value: mStats.brands, label: 'brands this month' },
          { tone: 'money', icon: 'bi-graph-up-arrow', value: fmt$(mStats.gmv), label: `GMV in ${monthLabel(month)}` },
        ] : [
          { id: 'all', tone: 'lead', icon: 'bi-people-fill', value: entries.length, label: 'creators on record' },
          { id: 'working', tone: 'live', icon: 'bi-broadcast', value: workingCount, label: 'working now' },
          { id: 'past', tone: 'past', icon: 'bi-clock-history', value: pastCount, label: 'worked before' },
          { id: 'db', tone: 'idle', icon: 'bi-bookmark-star', value: dbOnlyCount, label: 'no deal yet' },
          { tone: 'brand', icon: 'bi-shop', value: brandsCovered, label: 'brands covered' },
          { tone: 'money', icon: 'bi-graph-up-arrow', value: fmt$(totalGmv), label: 'total GMV' },
        ]).map((s, i) => {
          const Tag = s.id ? 'button' : 'div';
          const active = s.id && src === s.id;
          return (
            <Tag key={i} className={`pc-cdb-stat ${s.tone} ${s.id ? 'act' : ''} ${active ? 'on' : ''}`}
              {...(s.id ? {
                type: 'button', onClick: () => setSource(s.id), 'aria-pressed': !!active,
                title: `Show ${s.id === 'm_onboarded' ? 'creators onboarded this month' : s.label}`,
              } : {})}>
              <span className="pc-cdb-stat-ico"><i className={`bi ${s.icon}`} /></span>
              <span className="pc-cdb-stat-txt">
                <b>{s.value}</b>
                <span>{s.label}</span>
              </span>
            </Tag>
          );
        })}
      </div>

      <div className="pc-cdb-toolbar">
        <div className="pc-cdb-kind">
          {(byMonth ? CDB_MONTH_SOURCES : CDB_SOURCES).map(k => (
            <button key={k.id} className={`pc-logs-kbtn ${src === k.id ? 'active' : ''}`} onClick={() => setSource(k.id)}>{k.label}</button>
          ))}
        </div>
        {/* Pick several categories; the list is long and free text, so it is searchable. */}
        <CategoryFilter options={catOptions} value={cats} onChange={setCats}
          mode={catMode} onMode={setCatMode} onManage={ro || publicView ? null : onManageCategories} />
        <input className="pc-search pc-cdb-search" placeholder="Search name, handle, contact, brand, tag…" value={q} onChange={e => setQ(e.target.value)} />
        {/* Both ways in, side by side: one creator typed out, or a spreadsheet
            of them. Add leads because it is the everyday one; Import is the
            quieter button because it is the occasional bulk job. */}
        {!ro && (
          <div className="pc-cdb-adds">
            {onImport && (
              <button className="pc-btn pc-btn-ghost pc-cdb-imp" onClick={onImport}>
                <i className="bi bi-upload" style={{ marginRight: 6 }} />Import
              </button>
            )}
            <button className="pc-btn pc-btn-primary pc-cdb-add" onClick={() => onAdd()}>+ Add creator</button>
          </div>
        )}
      </div>

      <div className="pc-cdb-bar">
        <span className="pc-count-pill">{filtered.length} creator{filtered.length === 1 ? '' : 's'}</span>
        <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={copyHandles} disabled={!filtered.length}>{copied === 'u' ? 'Copied!' : 'Copy handles'}</button>
        {/* Opens the dialog rather than downloading straight away: the export
            carries 26 columns against the table's 13, so which of them to keep
            — and whether the file is .xlsx or .csv — is worth being asked. */}
        {!publicView && (
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setExportOpen(true)} disabled={!filtered.length}>
            <i className="bi bi-download" style={{ marginRight: 6 }} />Export
          </button>
        )}
        {/* Outside the `!ro` gate that hides Add and Import, deliberately: `ro`
            is Bob's read-only workspace, and Bob is the ONLY person who can
            make one of these links. A handler sees the dialog read-only. */}
        {!publicView && onShare && (
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={onShare}
            title="Public read-only links to this database">
            <i className="bi bi-link-45deg" style={{ marginRight: 6 }} />Share
          </button>
        )}
        {/* viewing preference only — this menu is about reading the TABLE.
            Copy still carries the full record, and the export has its own
            column choice inside the dialog. */}
        {!publicView && <CdbColumnsMenu hidden={cols.hidden} onToggle={toggleCol} onShowAll={cols.showAll} />}
        {/* Reacher is an external source: say plainly whether the Level / Avg
            views / TT GMV columns are current, still filling in, or failed — a silent column of
            dashes is indistinguishable from "these creators sold nothing". */}
        {!publicView && <span className={`pc-cdb-reacher ${reacher.err ? 'bad' : reacher.rateLimited ? 'warn' : ''}`}
          title={reacher.err || [
            `Reacher has figures for ${reacher.count} handle${reacher.count === 1 ? '' : 's'} on this list, matched by TikTok handle.`,
            'TT GMV = the creator’s total TikTok Shop GMV across every brand, not what they earned for us.',
            'Level = Reacher’s L0–L7 tier, graded on that TT GMV.',
            'Avg views = their average views per video.',
            'Refreshed automatically every day at 5 AM (Pakistan time). “Fetch now” looks up creators added since then.',
            reacher.updatedAt ? `Last updated ${new Date(reacher.updatedAt).toLocaleString()}.` : 'Nothing fetched yet.',
            reacher.rateLimited ? 'Reacher’s rate limit was reached — press Fetch now in a minute to continue.' : '',
          ].filter(Boolean).join('\n')}>
          <i className={`bi ${reacher.loading || reacher.syncing ? 'bi-arrow-repeat' : reacher.err ? 'bi-exclamation-triangle' : 'bi-broadcast-pin'}`} />
          {reacher.loading ? 'Loading Reacher…'
            : reacher.err ? 'Reacher unavailable'
              : reacher.syncing && reacher.remaining ? `Reacher · updating, ${reacher.remaining} to go`
                : reacher.syncing ? 'Reacher · checking…'
                  : reacher.rateLimited ? `Reacher · paused, ${reacher.remaining} to go`
                    : `Reacher · ${reacher.count} matched${reacher.updatedAt ? ` · updated ${cdbAgo(reacher.updatedAt)}` : ''}`}
        </span>}
        {!publicView && onReloadReacher && !reacher.loading && !reacher.syncing && (
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={onReloadReacher} title="Look up creators added since the 5 AM refresh (Reacher allows 60 lookups a minute, so a long list takes a few minutes)">Fetch now</button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="pc-card"><div className="pc-empty pc-empty-lg">
          <div className="pc-empty-icon">🗂️</div>
          <h3>{byMonth && !scoped.length ? `Nobody worked in ${monthLabel(month)}` : entries.length ? 'Nothing matches' : 'The database is empty'}</h3>
          <p>{byMonth && !scoped.length ? 'No creator was onboarded or recorded GMV in this month. Pick another month above, or switch to All time.' : entries.length
            ? 'No creator matches the current filters.'
            : publicView
              ? 'There are no creators on this list yet.'
              : 'Creators you onboard on any brand appear here automatically. Use “Add creator” to bank the credentials of someone you haven’t worked with yet, or “Import” to bank a whole spreadsheet of them.'}</p>
        </div></div>
      ) : (
        <div className="pc-dt-card pc-cdb-card">
          <div className="pc-dt-scroll">
            <table className="pc-dtable pc-cdb-table">
              <thead>
                <tr>
                  <th className="pc-dt-idx">#</th>
                  {shownCols.map((col, i) => (col.id ? (
                    <th key={col.id} className={`${col.num ? 'pc-num' : ''} ${col.cls || ''}`.trim()} aria-sort={sortAria(sort, col)}>
                      {/* the same button the Brands and Creators heads use; this
                          table keeps its own two-state toggle, having no
                          underlying order to clear back to */}
                      <SortBtn col={byMonth && col.key === 'gmv' ? { ...col, label: `GMV (${monthLabel(month)})` } : col} sort={sort} onToggle={toggleSort} />
                    </th>
                  ) : (
                    <th key={col.key} className={`${col.num ? 'pc-num' : ''} ${col.cls || ''}`.trim()}>{col.label}</th>
                  )))}
                  <th className="pc-cdb-acthead" aria-label="Actions" />
                </tr>
              </thead>
              {filtered.map((e, i) => (
                <CreatorDbRow key={e.key} e={e} idx={i + 1}
                  open={openKey === e.key} onToggle={() => setOpenKey(k => (k === e.key ? null : e.key))}
                  onEdit={() => onEdit(e)} onDelete={() => onDelete(e)}
                  onAddToProgram={() => onAddToProgram(e)}
                  gate={deleteGate(e)} show={visibleCol}
                  reacher={reacherFor(e, reacher.stats)} reacherLoading={reacher.loading}
                  gmv={gmvOf(e)} />
              ))}
            </table>
          </div>
        </div>
      )}
      {/* The clicked row's full record. Mounted only while open, and looked up
          in `entries` rather than `filtered` so changing a filter with the
          popup up cannot pull the person out from under it. */}
      {openEntry && (
        <CreatorDbDetailModal
          e={openEntry} reacher={reacherFor(openEntry, reacher.stats)} reacherLoading={reacher.loading}
          onClose={() => setOpenKey(null)} hideContact={hideContact}
          onEdit={() => { setOpenKey(null); onEdit(openEntry); }}
          onDelete={() => { setOpenKey(null); onDelete(openEntry); }}
          onAddToProgram={() => { setOpenKey(null); onAddToProgram(openEntry); }}
          deleteGate={deleteGate(openEntry)} />
      )}
      {/* Mounted only while open: the dialog reads its column preference on
          mount, so keeping it alive would make a preference saved in another
          tab invisible until this one reloads. */}
      {exportOpen && (
        <TableExportModal
          show onHide={() => setExportOpen(false)}
          title="Export the Creators Database"
          columns={CDB_EXPORT_COLUMNS} storeKey={CDB_EXPORT_STORE}
          filtered={exportFiltered} all={exportAll} filterLabel={filterLabel}
          entryWord="creator" sheet={CDB_EXPORT_SHEET} slug={CDB_EXPORT_SLUG} />
      )}
    </>
  );
});

/* Who may remove a creator from the database — the front-end mirror of the
   "creator_directory delete" policy (`is_bob() or created_by = auth.uid()`),
   which is deliberately NARROWER than read / insert / update, all three of
   which every paid-collab handler shares.

   ‼️ IT RETURNS THE REASON, NOT JUST A VERDICT, and the button it drives is
   DISABLED rather than hidden. On live data a handler owns 44 of 153 banked
   creators, and 61 more are the 20260839090000 backfill, which has no author at
   all and so is a Boss's to remove — so hiding the control left most rows with
   nothing on screen to explain the gap, which reads as a broken feature rather
   than as a rule. `who` and `why` come out of one body so the tooltip, the
   detail popup's fact line and the confirm dialog cannot drift apart.

   ‼️ It is the UI's mirror, never the enforcement. RLS refuses the write
   regardless; CreatorDeleteModal shows what comes back if the two disagree. */
export function directoryDeleteRule(entry, isBob, userId) {
  if (!entry || !entry.dir) {
    return { can: false, who: '—',
      why: 'Known from their deals only — there is nothing banked in the database to remove.' };
  }
  if (isBob || (userId && entry.dir.created_by === userId)) {
    return { can: true, who: 'You, or any Boss', why: 'Remove from the database' };
  }
  if (!entry.dir.created_by) {
    return { can: false, who: 'A Boss only',
      why: 'Only a Boss can remove this one — it came from the creators we already had deals with, so it has no author.' };
  }
  const author = entry.dir.created_by_name || 'the handler who added it';
  return { can: false, who: `${author}, or any Boss`, why: `Only ${author} or a Boss can remove this creator.` };
}

function CreatorDbRow({ e, idx, open, onToggle, onEdit, onDelete, onAddToProgram, gate = { can: false, why: '' },
  show = () => true, reacher = null, reacherLoading = false, gmv = e.totalGmv }) {
  const ro = useRO();
  const contact = [e.phone, e.email].filter(Boolean);
  const banked = !!e.dir;
  return (
    <tbody className={`pc-cdb-item ${open ? 'open' : ''}`}>
      <tr className="pc-cdb-row" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onToggle(); } }}>
        <td className="pc-dt-idx" data-label="#">{idx}</td>
        {show('name') && (
          <td className="pc-cdb-namecell" data-label="Name">
            {/* identity carries the colour; the engagement state rides a dot on the
                avatar so the name itself stays plain text. The @handle sits
                UNDER the name — same person, one cell. */}
            <span className="pc-dt-who">
              <span className="pc-dt-ava" style={{ background: getGradient(e.name) }}
                title={e.working
                  ? `Working now, ${e.activeDeals.length} live program${e.activeDeals.length === 1 ? '' : 's'}`
                  : e.dealCount > 0
                    ? `Worked before, ${e.dealCount} finished deal${e.dealCount === 1 ? '' : 's'}`
                    : 'No deal yet. Credentials only.'}>
                {cdbInitials(e.name)}
                <span className={`pc-cdb-adot ${e.working ? 'live' : e.dealCount > 0 ? 'past' : ''}`} />
              </span>
              <span className="pc-cdb-idcell">
                <span className="pc-dt-name" title={e.name}>{e.name || '—'}</span>
                <span className="pc-cdb-userline">
                  {e.handles.length > 0 ? (
                    <>
                      {/* stopPropagation: the row opens the detail popup, and a
                          click meant for the profile must not do both */}
                      <a className="pc-dt-handle" href={e.handles[0].url} target="_blank" rel="noopener noreferrer"
                        title={e.handles.map(h => h.handle).join(', ')}
                        onClick={ev => ev.stopPropagation()}>{e.handles[0].handle}</a>
                      {e.handles.length > 1 && <span className="pc-more" title={e.handles.slice(1).map(h => h.handle).join(', ')}>+{e.handles.length - 1}</span>}
                    </>
                  ) : <span className="pc-dt-dash">—</span>}
                </span>
              </span>
            </span>
          </td>
        )}
        {show('categories') && (
          <td className="pc-cdb-catcell" data-label="Categories">
            {e.categories.length ? (
              <FitChips items={e.categories} />
            ) : <span className="pc-dt-dash">—</span>}
          </td>
        )}
        {show('onboarded') && (
          <td className="pc-cdb-oncol" data-label="Onboarded"
            title={e.firstOn
              ? `First onboarded ${cdbDate(e.firstOn)}${e.lastOn && e.lastOn !== e.firstOn ? ` · latest ${cdbDate(e.lastOn)}` : ''}`
              : e.addedOn ? `No deal yet — added to the database ${cdbDate(e.addedOn)}` : ''}>
            {e.firstOn ? (
              <>
                <span className="pc-cdb-ondate">{cdbDate(e.firstOn)}</span>
                {e.lastOn && e.lastOn !== e.firstOn && <span className="pc-dt-sub">latest {cdbDate(e.lastOn)}</span>}
              </>
            ) : e.addedOn ? (
              <>
                <span className="pc-cdb-ondate muted">{cdbDate(e.addedOn)}</span>
                <span className="pc-dt-sub">added, no deal</span>
              </>
            ) : <span className="pc-dt-dash">—</span>}
          </td>
        )}
        {/* ── Reacher: the creator's standing on TikTok Shop as a whole ── */}
        {show('level') && (
          <td className="pc-num pc-cdb-levelcol" data-label="Level"
            title={reacher?.level
              ? `Reacher tier ${reacher.level} — graded on the creator's PLATFORM-WIDE TikTok Shop GMV (all brands), a different basis from the GMV column (what they earned on our programs).`
              : 'Reacher has no level on file for this creator'}>
            {reacherLoading && !reacher ? <span className="pc-cdb-skel" />
              : reacher?.level ? <span className={`pc-cdb-level ${levelRank(reacher.level) >= 5 ? 'hi' : levelRank(reacher.level) >= 3 ? 'mid' : ''}`}>{reacher.level}</span>
                : <span className="pc-dt-dash">—</span>}
          </td>
        )}
        {show('avgviews') && (
          <td className="pc-num pc-cdb-avgviewscol" data-label="Avg views" title="Average views per video (Reacher)">
            {reacherLoading && !reacher ? <span className="pc-cdb-skel" />
              : reacher?.avgViews != null ? <span className="pc-cdb-views">{fmtNum(reacher.avgViews)}</span>
                : <span className="pc-dt-dash">—</span>}
          </td>
        )}
        {show('ttgmv') && (
          <td className="pc-num pc-cdb-ttgmvcol" data-label="TT GMV"
            title="Total TikTok Shop GMV across every brand (Reacher)">
            {reacherLoading && !reacher ? <span className="pc-cdb-skel" />
              : reacher?.ttGmv != null
                ? <span className={`pc-money pc-cdb-ttgmv ${reacher.ttGmv > 0 ? 'up' : ''}`}>{fmt$(reacher.ttGmv, 'USD')}</span>
                : <span className="pc-dt-dash">—</span>}
          </td>
        )}
        {show('gmv') && (
          <td className="pc-num pc-cdb-gmvcol" data-label="GMV">
            {/* GMV is the number people scan for, so earned value carries colour */}
            {gmv
              ? <span className={`pc-money pc-cdb-gmv ${gmv > 0 ? 'up' : 'down'}`}>{fmt$(gmv, e.currency)}</span>
              : <span className="pc-dt-dash">—</span>}
          </td>
        )}
        <td className="pc-cdb-actions" onClick={ev => ev.stopPropagation()}>
          <span className="pc-cdb-acts">
            {!ro && <button className="pc-cdb-abtn go" onClick={onAddToProgram}
              title="Add this creator to a brand's program" aria-label="Add to a program">
              <i className="bi bi-person-plus" />
            </button>}
            {!ro && <button className={`pc-cdb-abtn ${banked ? 'has' : ''}`} onClick={onEdit}
              title={banked ? 'Edit credentials' : 'Add credentials to the database'}
              aria-label={banked ? 'Edit credentials' : 'Add credentials'}>
              <i className={`bi ${banked ? 'bi-pencil' : 'bi-plus-lg'}`} />
            </button>}
            {/* Always drawn, disabled where the database would refuse, with
                the reason on the tooltip. Hiding it made a rule look like a
                missing feature — see directoryDeleteGate. */}
            {!ro && (
              <button className="pc-cdb-abtn danger" onClick={onDelete} disabled={!gate.can}
                title={gate.why} aria-label={gate.can ? 'Remove from the database' : gate.why}>
                <i className="bi bi-trash" />
              </button>
            )}
          </span>
          {/* the row opens a popup, so this is a "look at this one" affordance,
              not an expander — hence an eye and no aria-expanded */}
          <button className={`pc-cdb-chev ${open ? 'open' : ''}`} onClick={onToggle}
            title="View full details" aria-label="View full details">
            <i className="bi bi-eye" />
          </button>
        </td>
      </tr>

    </tbody>
  );
}

/* The row's full record, in a POPUP rather than an accordion drawer.

   The table shows four columns; everything else about a creator lives here —
   contact, payout, categories, region, followers, rate, the Reacher figures and
   every program they have worked. A popup rather than an expanding row because
   this is a lot of content to push the rest of the list off the screen, and
   because the reader is looking at ONE person by the time they open it. */
/* ‼️ `hideContact` DROPS the four contact rows rather than printing them empty.
   On a public link that withholds them the server sends '', which this popup
   would render as '—' — and '—' already means "nothing on file" everywhere else
   in this table. Two different facts must not look alike, so the withheld case
   shows no row at all. */
function CreatorDbDetailModal({ e, reacher = null, reacherLoading = false, onClose, onEdit, onDelete, onAddToProgram, deleteGate = { can: false, who: '—', why: '' }, hideContact = false }) {
  const ro = useRO();
  const banked = !!e.dir;
  /* stopPropagation so closing this popup cannot also close something behind
     it — the same rule the columns menu follows. */
  useEffect(() => {
    const esc = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal pc-modal-scroll pc-cdb-modal" onClick={ev => ev.stopPropagation()} role="dialog" aria-modal="true">
        <div className="pc-cdb-mhead">
          <span className="pc-dt-ava pc-cdb-mava" style={{ background: getGradient(e.name) }}>
            {cdbInitials(e.name)}
            <span className={`pc-cdb-adot ${e.working ? 'live' : e.dealCount > 0 ? 'past' : ''}`} />
          </span>
          <div className="pc-cdb-mhead-txt">
            <h3>{e.name || 'Unnamed creator'}</h3>
            <div className="pc-modal-sub">
              {e.handles.length ? e.handles.map(h => h.handle).join(' · ') : 'No TikTok handle on file'}
              {' · '}
              {e.working ? 'Working now' : e.dealCount > 0 ? 'Worked before' : 'No deal yet'}
            </div>
          </div>
          <button className="pc-cdb-mclose" onClick={onClose} title="Close" aria-label="Close">
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="pc-modal-body">
          <div className="pc-cdb-facts">
            <div className="pc-cdb-fact"><span>TikTok</span><b>
              {e.handles.length ? e.handles.map((h, i) => (
                <React.Fragment key={h.handle}>{i > 0 && ' · '}
                  <a href={h.url} target="_blank" rel="noopener noreferrer">{h.handle}</a>
                </React.Fragment>
              )) : '—'}
            </b></div>
            {!hideContact && <>
              <div className="pc-cdb-fact"><span>Phone</span><b>{e.phone || '—'}</b></div>
              <div className="pc-cdb-fact"><span>Email</span><b>{e.email || '—'}</b></div>
              <div className="pc-cdb-fact"><span>PayPal</span><b>{e.paypal || '—'}</b></div>
              <div className="pc-cdb-fact"><span>Zelle</span><b>{e.zelle || '—'}</b></div>
            </>}
            <div className="pc-cdb-fact"><span>Categories</span><b>{e.categories.length ? e.categories.join(', ') : '—'}</b></div>
            <div className="pc-cdb-fact"><span>Region</span><b>{e.region || '—'}</b></div>
            {/* Banked followers win; Reacher's count fills in when none was typed. */}
            <div className="pc-cdb-fact"><span>Followers</span><b>{e.followers != null ? fmtNum(e.followers)
              : reacher?.followers != null ? <span title="From Reacher">{fmtNum(reacher.followers)}</span> : '—'}</b></div>
            <div className="pc-cdb-fact"><span>Asking rate</span><b>{e.rate != null ? fmt$(e.rate, e.currency) : '—'}</b></div>
            <div className="pc-cdb-fact"><span>Videos</span><b>{e.agreedVideos ? `${e.deliveredVideos}/${e.agreedVideos}` : '—'}</b></div>
            <div className="pc-cdb-fact"><span>Total GMV</span><b>{e.totalGmv ? fmt$(e.totalGmv, e.currency) : '—'}</b></div>
            {/* Reacher's two figures — a different basis from Total GMV above
                (platform-wide, every brand), so both are spelled out. */}
            <div className="pc-cdb-fact"><span>Level</span><b>
              {reacher?.level
                ? <span className={`pc-cdb-level ${levelRank(reacher.level) >= 5 ? 'hi' : levelRank(reacher.level) >= 3 ? 'mid' : ''}`}>{reacher.level}</span>
                : reacherLoading ? <span className="pc-cdb-skel" /> : '—'}
            </b></div>
            <div className="pc-cdb-fact"><span>Avg views</span><b>
              {reacher?.avgViews != null ? fmtNum(reacher.avgViews) : reacherLoading ? <span className="pc-cdb-skel" /> : '—'}
            </b></div>
            <div className="pc-cdb-fact" title="Total TikTok Shop GMV across every brand this creator sells for (Reacher). A blank means Reacher could not find the handle, which is not the same as zero.">
              <span>TT GMV</span><b>
                {reacher?.ttGmv != null
                  ? <span className={`pc-money pc-cdb-ttgmv ${reacher.ttGmv > 0 ? 'up' : ''}`}>{fmt$(reacher.ttGmv, 'USD')}</span>
                  : reacherLoading ? <span className="pc-cdb-skel" /> : '—'}
              </b></div>
            <div className="pc-cdb-fact"><span>Programs</span><b>{e.programCount || '—'}{e.brandCount ? ` · ${e.brandCount} brand${e.brandCount === 1 ? '' : 's'}` : ''}</b></div>
            <div className="pc-cdb-fact"><span>First onboarded</span><b>{e.firstOn ? fmtDate(e.firstOn) : '—'}</b></div>
            <div className="pc-cdb-fact"><span>Last onboarded</span><b>{e.lastOn ? fmtDate(e.lastOn) : '—'}</b></div>
            <div className="pc-cdb-fact"><span>Added to database</span><b>{e.addedOn ? fmtDate(e.addedOn) : '—'}</b></div>
            <div className="pc-cdb-fact"><span>On our books</span><b>{e.sinceOn ? (cdbSince(e.sinceOn) || 'starts soon') : '—'}</b></div>
            <div className="pc-cdb-fact"><span>Added by</span><b>{e.dir ? (e.dir.created_by_name || '—') : 'Auto (from deals)'}</b></div>
            {/* The one place that states the delete rule outright, rather than
                leaving it on a tooltip nobody hovers. */}
            {!ro && <div className="pc-cdb-fact" title={deleteGate.why}>
              <span>Can be removed by</span><b>{deleteGate.who}</b>
            </div>}
          </div>
          {e.programs.length > 0 && (
            <div className="pc-cdb-sec">
              <div className="pc-cdb-sec-l">
                Programs worked · {e.programCount} across {e.brandCount} brand{e.brandCount === 1 ? '' : 's'}
              </div>
              <div className="pc-cdb-deals">
                <div className="pc-cdb-dhead">
                  <div>Brand</div><div>Program</div><div>Status</div>
                  <div className="pc-num">Deal</div><div className="pc-num">GMV</div><div className="pc-num">Videos</div>
                </div>
                {e.programs.map(p => {
                  const d = p.deal;
                  const st = d ? deriveStatus({ payment_status: d.status }) : null;
                  const live = !!d && (d.status === 'videos_in_progress' || d.status === 'follow_up');
                  return (
                    <div className={`pc-cdb-deal ${live ? 'live' : ''}`} key={p.key}>
                      <div data-label="Brand"><span className="pc-brandtag">{p.brand}</span></div>
                      <div data-label="Program">
                        {monthLabel(p.month)}
                        {/* Either they were signed into this month, or they were
                            still selling in it on an earlier contract — and the
                            three cells after this one only mean something in the
                            first case. Say which. */}
                        {d?.onboarded
                          ? <span className="pc-cdb-dsub">onboarded {cdbDate(d.onboarded)}</span>
                          : p.fromMonths.length > 0
                            ? <span className="pc-cdb-dsub">still selling · from {p.fromMonths.map(monthLabel).join(', ')}</span>
                            : null}
                      </div>
                      <div data-label="Status">{st
                        ? <span className={`pc-badge ${st.cls}`}><span className="dot" />{st.label}</span>
                        : <span className="pc-cdb-dash">—</span>}</div>
                      <div className="pc-num" data-label="Deal"><span className="pc-money">{d?.amount ? fmt$(d.amount, p.currency) : '—'}</span></div>
                      <div className="pc-num" data-label="GMV"><span className="pc-money">{p.gmv ? fmt$(p.gmv, p.currency) : '—'}</span></div>
                      <div className="pc-num" data-label="Videos">{d?.videos ? `${d.delivered}/${d.videos}` : '—'}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {e.tags.length > 0 && (
            <div className="pc-cdb-sec">
              <div className="pc-cdb-sec-l">Tags</div>
              <div className="pc-cdb-chips">{e.tags.map(t => <span className="pc-cat" key={t}>{t}</span>)}</div>
            </div>
          )}
          {e.notes && !hideContact && (
            <div className="pc-cdb-sec">
              <div className="pc-cdb-sec-l">Notes</div>
              <div className="pc-cdb-notes">{e.notes}</div>
            </div>
          )}
          {!banked && (
            <div className="pc-cdb-hint pc-cdb-mhint">
              On record from their deals only.{!ro && <> <button className="pc-linkbtn" onClick={onEdit}>Add their credentials</button> to keep contact, payout, rate and notes here.</>}
            </div>
          )}
        </div>
        <div className="pc-modal-actions">
          {!ro && (
            <button className="pc-btn pc-btn-primary" onClick={onAddToProgram}>
              <i className="bi bi-person-plus" /> Add to a program
            </button>
          )}
          {!ro && (
            <button className="pc-btn pc-btn-ghost" onClick={onEdit}>
              <i className={`bi ${banked ? 'bi-pencil' : 'bi-plus-lg'}`} /> {banked ? 'Edit credentials' : 'Add credentials'}
            </button>
          )}
          {!ro && (
            <button className="pc-btn pc-btn-ghost pc-btn-danger" onClick={onDelete}
              disabled={!deleteGate.can} title={deleteGate.why}>
              <i className="bi bi-trash" /> Remove
            </button>
          )}
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* Onboard a creator FROM the database onto any brand's program (brand + month),
   without retyping their details — the deal is created with their banked
   credentials. A program is one brand-month, so picking the month is picking
   the program; `onboarded_on` decides which one the deal lands in. */
function AddToProgramModal({ entry, brands = [], brandMonths = [], creators = [], month, onClose, onSave }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [f, setF] = useState({
    brand_id: brands.length === 1 ? brands[0].id : '',
    month: month || thisMonthKey(),
    amount: entry.rate != null ? String(entry.rate) : '',
    videos_count: '',
    onboarded_on: defaultDateForMonth(month || thisMonthKey()),
    deliverable_days: '',
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  // products the creator will promote on this deal
  const [prods, setProds] = useState([]);
  const [prodInput, setProdInput] = useState('');
  // Changing the program month re-dates the onboarding into that month (the
  // date is what files the deal under a program), unless it already fits.
  function setProgramMonth(m) {
    if (!m) return;
    setF(prev => ({
      ...prev, month: m,
      onboarded_on: monthKey(prev.onboarded_on) === m ? prev.onboarded_on : defaultDateForMonth(m),
    }));
  }

  const brandName = brands.find(b => b.id === f.brand_id)?.name || '';
  const programMonth = monthKey(f.onboarded_on) || f.month;
  // Does this brand-month already exist as a program (budget/links set)?
  const programExists = brandMonths.some(m => m.brand_id === f.brand_id && m.month === programMonth);
  // Already on this exact program? (same person, same brand + month)
  const duplicate = f.brand_id && creators.some(c =>
    c.brand_id === f.brand_id
    && monthKey(c.onboarded_on) === programMonth
    && store.creatorGlobalKey(c) === entry.key);

  /* The brand's product catalogue, read where the workspace keeps it: each
     brand-month's focus_product_url JSON. Products of the program being joined
     come first; the brand's other months follow, so a catalogue built up in
     earlier programs is still one tap away. */
  const { monthProducts, otherProducts } = useMemo(() => {
    if (!f.brand_id) return { monthProducts: [], otherProducts: [] };
    const rows = brandMonths.filter(m => m.brand_id === f.brand_id);
    const take = (list) => {
      const seen = new Set(), out = [];
      list.forEach(p => {
        const k = prodKey(p);
        if (k && !seen.has(k)) { seen.add(k); out.push(p); }
      });
      return out;
    };
    const inMonth = take(rows.filter(m => m.month === programMonth).flatMap(focusProductList));
    const inMonthKeys = new Set(inMonth.map(prodKey));
    const rest = take(rows.filter(m => m.month !== programMonth).flatMap(focusProductList))
      .filter(p => !inMonthKeys.has(prodKey(p)));
    return { monthProducts: inMonth, otherProducts: rest };
  }, [brandMonths, f.brand_id, programMonth]);

  // Switching brand invalidates the picks (products belong to a brand). A brand
  // whose program lists exactly one product pre-selects it, like the deal editor.
  // starts as null, never a brand id, so the one-brand-handler case (whose brand
  // is pre-picked on mount) still gets its pre-selection
  const brandRef = useRef(null);
  useEffect(() => {
    if (brandRef.current === f.brand_id) return;
    brandRef.current = f.brand_id;
    setProds(monthProducts.length === 1 ? [{ ...monthProducts[0] }] : []);
  }, [f.brand_id, monthProducts]);

  const hasProd = p => prods.some(x => prodKey(x) === prodKey(p));
  const toggleProd = p => setProds(prev => prev.some(x => prodKey(x) === prodKey(p))
    ? prev.filter(x => prodKey(x) !== prodKey(p))
    : [...prev, { name: p.name || '', url: p.url || '' }]);
  const removeProd = i => setProds(prev => prev.filter((_, j) => j !== i));
  function addCustomProd() {
    const name = prodInput.trim();
    if (!name) return;
    if (!prods.some(x => (x.name || '').toLowerCase().trim() === name.toLowerCase())) {
      const match = [...monthProducts, ...otherProducts]
        .find(bp => (bp.name || '').toLowerCase().trim() === name.toLowerCase());
      setProds(prev => [...prev, { name, url: match?.url || '' }]);
    }
    setProdInput('');
  }
  const pickMonth = monthProducts.filter(p => !hasProd(p));
  const pickOther = otherProducts.filter(p => !hasProd(p));

  async function save() {
    if (!f.brand_id || saving) return;
    setSaving(true); setErr('');
    try {
      await onSave({
        brand_id: f.brand_id,
        name: entry.name,
        tiktok_handle: entry.handles.map(h => h.handle).join('\n'),
        phone: entry.phone, email: entry.email, category: entry.category,
        paypal: entry.paypal, zelle: entry.zelle,
        amount: f.amount, videos_count: f.videos_count,
        onboarded_on: f.onboarded_on,
        deliverable_days: f.deliverable_days,
        products: prods
          .map(p => ({ name: (p.name || '').trim(), url: (p.url || '').trim() }))
          .filter(p => p.name || p.url),
      });
    } catch (e) {
      setErr(e.message || 'Could not add');
      setSaving(false);
    }
  }

  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal pc-modal-scroll" onClick={e => e.stopPropagation()}>
        <h3>Add to a program</h3>
        <div className="pc-modal-sub">
          {entry.name}{entry.handles[0] ? ` · ${entry.handles[0].handle}` : ''}
        </div>
        <div className="pc-modal-body">
          {err && <div className="pc-inline-err">{err}</div>}
          {brands.length === 0 && (
            <div className="pc-inline-err">You have no brands assigned yet — ask your manager to assign one.</div>
          )}
          <div className="pc-field">
            <label>Brand</label>
            <select className="pc-input" value={f.brand_id} onChange={e => set('brand_id', e.target.value)} autoFocus>
              <option value="">Pick a brand…</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="pc-field2">
            <div className="pc-field">
              <label>Program (month)</label>
              <MonthField variant="field" className="w-100" value={f.month} onChange={v => setProgramMonth(v)} />
              {f.brand_id && (
                <div className="pc-sig-hint">
                  {programExists
                    ? `${brandName} · ${monthLabel(programMonth)} — existing program.`
                    : `${brandName} · ${monthLabel(programMonth)} — a new program starts with this creator.`}
                </div>
              )}
            </div>
            <div className="pc-field">
              <label>Onboarded on</label>
              <DateField className="w-100" value={f.onboarded_on}
                onChange={v => set('onboarded_on', v)} />
              <div className="pc-sig-hint">Files the deal under {monthLabel(programMonth)}.</div>
            </div>
          </div>
          <div className="pc-field2">
            <div className="pc-field"><label>Amount ($)</label>
              <input className="pc-input" type="number" inputMode="numeric"
                placeholder={entry.rate != null ? String(entry.rate) : '200'}
                value={f.amount} onChange={e => set('amount', e.target.value)} />
              {entry.rate != null && <div className="pc-sig-hint">Their asking rate: {fmt$(entry.rate)} / video.</div>}
            </div>
            <div className="pc-field"><label>Videos</label>
              <input className="pc-input" type="number" inputMode="numeric" placeholder="5"
                value={f.videos_count} onChange={e => set('videos_count', e.target.value)} />
            </div>
          </div>
          {f.brand_id && (
            <div className="pc-field">
              <label>Promoting product{prods.length === 1 ? '' : '(s)'}</label>
              <div className="pc-prodbox">
                {prods.length > 0 && (
                  <div className="pc-prodchips">
                    {prods.map((p, i) => (
                      <span className="pc-prodchip sel" key={i} title={p.url || p.name}>
                        <span className="pc-prodchip-dot" />
                        <span className="pc-prodchip-name">{p.name || p.url}</span>
                        <button type="button" className="pc-prodchip-x" onClick={() => removeProd(i)} title="Remove">×</button>
                      </span>
                    ))}
                  </div>
                )}
                {pickMonth.length > 0 && (
                  <div className="pc-prodpick">
                    <span className="pc-prodpick-l">In {monthLabel(programMonth)}</span>
                    <div className="pc-prodchips">
                      {pickMonth.map((p, i) => (
                        <button type="button" className="pc-prodchip add" key={i} onClick={() => toggleProd(p)} title={p.url || p.name}>+ {p.name || p.url}</button>
                      ))}
                    </div>
                  </div>
                )}
                {pickOther.length > 0 && (
                  <div className="pc-prodpick">
                    <span className="pc-prodpick-l">Other months of {brandName}</span>
                    <div className="pc-prodchips">
                      {pickOther.map((p, i) => (
                        <button type="button" className="pc-prodchip add" key={i} onClick={() => toggleProd(p)} title={p.url || p.name}>+ {p.name || p.url}</button>
                      ))}
                    </div>
                  </div>
                )}
                {monthProducts.length === 0 && otherProducts.length === 0 && (
                  <div className="pc-sig-hint">
                    No products recorded for {brandName} yet. Type one below, or set the brand's focus products from its month card.
                  </div>
                )}
                <div className="pc-multirow">
                  <input className="pc-input" placeholder="Product name" value={prodInput}
                    onChange={e => setProdInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomProd(); } }} />
                  <button type="button" className="pc-prodadd" onClick={addCustomProd} title="Add product" disabled={!prodInput.trim()}>+</button>
                </div>
              </div>
            </div>
          )}
          <div className="pc-field">
            <label>Deliverable deadline (days)</label>
            <input className="pc-input" type="number" inputMode="numeric" min="1"
              placeholder={`auto — ${(parseInt(f.videos_count, 10) || 0) < 6 ? 10 : 14} days`}
              value={f.deliverable_days} onChange={e => set('deliverable_days', e.target.value)} />
            <div className="pc-sig-hint">Contract §2: days after the sample is delivered. Blank uses the automatic rule.</div>
          </div>
          {duplicate && (
            <div className="pc-inline-err">
              {entry.name} is already present in {brandName} · {monthLabel(programMonth)}. Pick another month or brand.
            </div>
          )}
          <div className="pc-sig-hint">
            Their name, TikTok account(s) and contact / payout details come straight from the database. Edit
            the deal afterwards to add video links and ad codes.
          </div>
        </div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={!f.brand_id || saving || duplicate}>
            {saving ? 'Adding…' : 'Add to program'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── categories as reusable labels (shared by every creator form) ──
   The directory stores them as a real text[]; a DEAL row keeps the single
   `category` column, holding the same list comma-joined. That round-trips
   losslessly: the deal→directory trigger runs the string back through
   split_creator_categories(), so both ends agree without a second column on the
   hot table. splitCats/joinCats are the boundary. */
const splitCats = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const joinCats = (list) => (list || []).map(x => String(x).trim()).filter(Boolean).join(', ');

// The shared vocabulary + a "remember what's new" commit, so both editors grow
// the catalogue on save rather than on every keystroke.
// ‼️ Reads the Dashboard's catalogue through CatCatalogueCtx when there is one,
// so the creator editors and Manage categories show ONE live list: a word added
// or renamed in either place is in the other at once. Outside the Dashboard it
// falls back to its own fetch.
const CatCatalogueCtx = React.createContext(null);
function useCategoryCatalogue() {
  const shared = React.useContext(CatCatalogueCtx);
  const [own, setOwn] = useState([]);
  useEffect(() => { if (!shared) store.loadCreatorCategories().then(setOwn).catch(() => { }); }, [shared]);
  const saved = shared ? shared.catalogue : own;
  const remember = useCallback((list) => {
    const known = new Set(saved.map(s => (s.name || '').toLowerCase()));
    const fresh = (list || []).map(c => String(c).trim()).filter(v => v && !known.has(v.toLowerCase()));
    if (!fresh.length) return;
    Promise.all(fresh.map(v => store.upsertCreatorCategory(v).catch(() => { })))
      .then(() => shared?.reload());
  }, [saved, shared]);
  return { saved, remember };
}

/* Categories as a dropdown: selected ones are chips, and ONE search box both
   filters the list and creates — if what you typed matches nothing, the top row
   offers "Create “…”". The list expands INLINE (not floating) because it lives
   in a scrolling modal body that would clip an absolute panel. */
function CategoryPicker({ value = [], onChange, saved = [], inUse = [] }) {
  const colors = React.useContext(CatColorsCtx);
  const shared = React.useContext(CatCatalogueCtx);
  const lastEdit = shared?.lastEdit;
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (!lastEdit) return;
    const from = lastEdit.from.trim().toLowerCase();
    const cur = valueRef.current;
    if (!cur.some(c => c.trim().toLowerCase() === from)) return;
    let next = cur.map(c => (c.trim().toLowerCase() === from ? (lastEdit.kind === 'rename' ? lastEdit.to : null) : c)).filter(Boolean);
    const seen = new Set();
    next = next.filter(c => { const k = c.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    onChange(next);
  }, [lastEdit]); // eslint-disable-line react-hooks/exhaustive-deps
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const has = n => value.some(c => c.toLowerCase() === String(n).trim().toLowerCase());
  const toggle = (n) => {
    const v = String(n || '').trim();
    if (!v) return;
    onChange(has(v) ? value.filter(c => c.toLowerCase() !== v.toLowerCase()) : [...value, v]);
  };
  const remove = i => onChange(value.filter((_, j) => j !== i));
  // catalogue + anything in use elsewhere + what is picked, one spelling per word
  const all = useMemo(() => {
    const seen = new Set(), out = [];
    [...saved.map(s => s.name), ...inUse, ...value].forEach(n => {
      const v = String(n || '').trim(), k = v.toLowerCase();
      if (!v || seen.has(k)) return;
      seen.add(k); out.push(v);
    });
    return out.sort((a, b) => a.localeCompare(b));
  }, [saved, inUse, value]);
  const typed = input.trim();
  const shown = typed ? all.filter(c => c.toLowerCase().includes(typed.toLowerCase())) : all;
  const canCreate = !!typed && !typed.includes(',') && !all.some(c => c.toLowerCase() === typed.toLowerCase());
  // rows: optional "create" first, then the matches
  const rows = canCreate ? [{ create: true, name: typed }, ...shown.map(name => ({ name }))] : shown.map(name => ({ name }));
  useEffect(() => { setHi(0); }, [typed]);
  useEffect(() => {
    if (!open) return;
    const down = e => { if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setInput(''); } };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);
  useEffect(() => {
    const el = listRef.current?.children?.[hi];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [hi]);
  function pick(row) {
    if (!row) return;
    if (row.create) { toggle(row.name); setInput(''); }
    else { toggle(row.name); if (typed) setInput(''); }
  }
  function onKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, Math.max(rows.length - 1, 0))); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open || typed) pick(rows[hi]); setOpen(true); }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); e.nativeEvent?.stopImmediatePropagation?.(); setOpen(false); setInput(''); } }
    else if (e.key === 'Backspace' && !input && value.length) remove(value.length - 1);
  }
  const dot = c => (colors[c.toLowerCase()] ? { background: colors[c.toLowerCase()] } : undefined);

  return (
    <div className={`pc-catdd ${open ? 'open' : ''}`} ref={boxRef}>
      {value.length > 0 && (
        <div className="pc-catdd-chips">
          {value.map((c, i) => (
            <span className="pc-catdd-chip" key={`${c}-${i}`} title={c}>
              <span className="pc-catdd-dot" style={dot(c)} />
              <span className="pc-catdd-name">{c}</span>
              <button type="button" className="pc-catdd-x" title="Remove" onClick={() => remove(i)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="pc-catdd-field">
        <i className="bi bi-search pc-catdd-ico" />
        <input className="pc-input pc-catdd-input" value={input}
          placeholder="Search or add a category…"
          onFocus={() => setOpen(true)}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onKeyDown={onKey} />
        <button type="button" className="pc-catdd-caret" tabIndex={-1} title={open ? 'Close list' : 'Show all categories'}
          onMouseDown={e => e.preventDefault()} onClick={() => setOpen(o => !o)}>
          <i className="bi bi-chevron-down" />
        </button>
      </div>
      {open && (
        <div className="pc-catdd-panel" ref={listRef} role="listbox" aria-multiselectable="true">
          {rows.length === 0 && <div className="pc-catfilter-empty">{typed.includes(',') ? 'A category cannot contain a comma' : 'No categories yet — type one to add it'}</div>}
          {rows.map((r, i) => {
            const on = !r.create && has(r.name);
            return (
              <div key={(r.create ? '+' : '') + r.name} role="option" aria-selected={on}
                className={`pc-catdd-row ${i === hi ? 'hi' : ''} ${on ? 'on' : ''} ${r.create ? 'create' : ''}`}
                onMouseDown={e => e.preventDefault()} onMouseMove={() => setHi(i)} onClick={() => pick(r)}>
                {r.create ? (
                  <><i className="bi bi-plus-lg" /><span className="pc-catdd-rowname">Create “<b>{r.name}</b>”</span></>
                ) : (
                  <>
                    <span className={`pc-catdd-check ${on ? 'on' : ''}`}>{on && <i className="bi bi-check" />}</span>
                    <span className="pc-catdd-dot" style={dot(r.name)} />
                    <span className="pc-catdd-rowname">{r.name}</span>
                  </>
                )}
              </div>
            );
          })}
          {shared?.openManager && (
            <div className="pc-catdd-foot">
              <button type="button" className="pc-linkbtn" onMouseDown={e => e.preventDefault()}
                onClick={() => { setOpen(false); setInput(''); shared.openManager(); }}>
                <i className="bi bi-pencil-square" /> Manage categories
              </button>
            </div>
          )}
        </div>
      )}
      <div className="pc-sig-hint">Pick as many as fit. A new one joins the shared list, so everyone can reuse it.</div>
    </div>
  );
}

/* ── categories as coloured labels: the filter, the chip, the manager ──
   Colours live on creator_categories.color and reach every chip through one
   context (provided by the Dashboard), so the memoised table rows need no new
   prop and a recolour lands everywhere at once. Keys are lower-cased names. */
const CatColorsCtx = React.createContext({});
const useCatColor = (name) => React.useContext(CatColorsCtx)[String(name || '').trim().toLowerCase()] || null;
const CATEGORY_PALETTE = ['#1259c3', '#0f9d58', '#e8862e', '#d93025', '#8e44ad', '#00897b', '#c2185b', '#6d4c41', '#546e7a', '#b8860b'];

function CatChip({ name, title = undefined, hidden = false }) {
  const color = useCatColor(name);
  return (
    <span className={`pc-cat ${color ? 'tinted' : ''}`} hidden={hidden} title={title}
      style={color ? { '--cat': color } : undefined}>{name}</span>
  );
}

// Case-insensitive tally of category lists -> [{name, count}] sorted by name.
function countCategories(lists) {
  const m = new Map();
  (lists || []).forEach(list => {
    const seen = new Set();
    (list || []).forEach(c => {
      const v = String(c || '').trim(), k = v.toLowerCase();
      if (!v || seen.has(k)) return;
      seen.add(k);
      const cur = m.get(k);
      if (cur) cur.count++; else m.set(k, { name: v, count: 1 });
    });
  });
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// 'any' = carries at least one picked category, 'all' = carries every one.
function matchesCategories(list, picked, mode = 'any') {
  if (!picked || !picked.length) return true;
  const mine = new Set((list || []).map(c => String(c).trim().toLowerCase()));
  const test = c => mine.has(String(c).trim().toLowerCase());
  return mode === 'all' ? picked.every(test) : picked.some(test);
}

/* Multi-select category filter: a button that opens a searchable checklist. */
export function CategoryFilter({ options = [], value = [], onChange, mode = 'any', onMode, onManage = null }) {
  const colors = React.useContext(CatColorsCtx);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const down = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    // stopPropagation so Escape closes this, not a surrounding modal
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  const sel = new Set(value.map(v => v.toLowerCase()));
  const toggle = (name) => onChange(sel.has(name.toLowerCase())
    ? value.filter(v => v.toLowerCase() !== name.toLowerCase())
    : [...value, name]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.name.toLowerCase().includes(needle)) : options;
  // picked ones first, so a long list never hides what is in force
  const ordered = [...shown.filter(o => sel.has(o.name.toLowerCase())), ...shown.filter(o => !sel.has(o.name.toLowerCase()))];
  const label = !value.length ? 'All categories' : value.length === 1 ? value[0] : `${value.length} categories`;

  return (
    <div className="pc-catfilter" ref={ref}>
      <button type="button" className={`pc-catfilter-btn ${value.length ? 'on' : ''}`}
        onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="true"
        title={value.length ? `Showing creators in ${value.join(mode === 'all' ? ' and ' : ' or ')}` : 'Filter by category'}>
        <i className="bi bi-tags" />
        <span className="pc-catfilter-l">{label}</span>
        {value.length > 1 && <span className="pc-catfilter-n">{mode === 'all' ? 'all' : 'any'}</span>}
        <i className="bi bi-chevron-down pc-catfilter-caret" />
      </button>
      {value.length > 0 && (
        <button type="button" className="pc-catfilter-clear" onClick={() => onChange([])} title="Clear category filter">×</button>
      )}
      {open && (
        <div className="pc-catfilter-panel" role="dialog" aria-label="Filter by category">
          <input className="pc-input pc-catfilter-search" autoFocus placeholder="Search categories…"
            value={q} onChange={e => setQ(e.target.value)} />
          {onMode && (
            <div className="pc-catfilter-mode" role="group" aria-label="Match">
              <span>Match</span>
              <button type="button" className={mode === 'any' ? 'on' : ''} onClick={() => onMode('any')}
                title="Creators with at least one of the picked categories">Any</button>
              <button type="button" className={mode === 'all' ? 'on' : ''} onClick={() => onMode('all')}
                title="Creators with every picked category">All</button>
            </div>
          )}
          <div className="pc-catfilter-list">
            {ordered.length ? ordered.map(o => {
              const on = sel.has(o.name.toLowerCase());
              const color = colors[o.name.toLowerCase()];
              return (
                <label key={o.name} className={`pc-catfilter-row ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(o.name)} />
                  <span className="pc-catfilter-dot" style={color ? { background: color } : undefined} />
                  <span className="pc-catfilter-name">{o.name}</span>
                  <span className="pc-catfilter-count">{o.count}</span>
                </label>
              );
            }) : <div className="pc-catfilter-empty">{options.length ? 'No category matches' : 'No categories yet'}</div>}
          </div>
          <div className="pc-catfilter-foot">
            <button type="button" className="pc-linkbtn" disabled={!value.length} onClick={() => onChange([])}>Clear</button>
            {onManage && (
              <button type="button" className="pc-linkbtn" onClick={() => { setOpen(false); onManage(); }}>
                <i className="bi bi-pencil-square" /> Manage categories
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Create, rename, recolour and delete categories. A rename or delete reaches
   every creator carrying the word (RPCs in 20261117090000); renaming into an
   existing name merges the two. `names` is the catalogue plus every word in
   use, so a category typed onto a deal before the catalogue existed is
   manageable too. */
function CategoryManagerModal({ catalogue = [], usage = [], onClose, onChanged, onEdit = null }) {
  /* Renames/deletes applied HERE at once. The catalogue reloads in a moment but
     the per-creator usage only refreshes when the whole workspace has re-read,
     so without this the old name lingered beside the new one for seconds. An
     entry drops off once the usage no longer carries the old word. */
  const [pending, setPending] = useState([]);   // [{ from, to | null }]
  useEffect(() => {
    setPending(list => {
      const next = list.filter(p => usage.some(u => u.name.toLowerCase() === p.from.toLowerCase()));
      return next.length === list.length ? list : next;   // same array = no re-render loop
    });
  }, [usage]);
  const rows = useMemo(() => {
    const mapName = (n) => {
      let v = n;
      for (const p of pending) if (v && v.toLowerCase() === p.from.toLowerCase()) v = p.to;
      return v;
    };
    const m = new Map();
    catalogue.forEach(c => {
      const v = mapName((c.name || '').trim());
      if (v && !m.has(v.toLowerCase())) m.set(v.toLowerCase(), { name: v, color: c.color || null, count: 0 });
    });
    usage.forEach(u => {
      const v = mapName(u.name);
      if (!v) return;
      const k = v.toLowerCase(), cur = m.get(k);
      if (cur) cur.count += u.count; else m.set(k, { name: v, color: null, count: u.count });
    });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogue, usage, pending]);
  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(null);
  const [editing, setEditing] = useState(null);   // name being renamed
  const [draft, setDraft] = useState('');
  const [paletteFor, setPaletteFor] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // capture on document + stopPropagation: it can sit over a creator editor
  // whose own window Escape listener must not close that too
  useEffect(() => {
    const k = e => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // Escape in the rename box cancels the rename, not the dialog
      if (e.target?.classList?.contains('pc-catmgr-edit')) { setEditing(null); return; }
      if (!busy) onClose();
    };
    document.addEventListener('keydown', k, true);
    return () => document.removeEventListener('keydown', k, true);
  }, [onClose, busy]);

  const exists = (n, except = null) => rows.some(r => r.name.toLowerCase() === n.trim().toLowerCase()
    && (!except || r.name.toLowerCase() !== except.toLowerCase()));
  async function run(fn, okMsg) {
    setBusy(true); setErr('');
    try { await fn(); await onChanged?.(); if (okMsg) toast(okMsg); return true; }
    catch (e) { setErr(e?.message || 'Could not save the change'); return false; }
    finally { setBusy(false); }
  }
  async function create() {
    const v = newName.trim();
    if (!v) return;
    if (v.includes(',')) { setErr('A category name cannot contain a comma'); return; }
    if (exists(v)) { setErr(`“${v}” already exists`); return; }
    const ok = await run(async () => {
      await store.upsertCreatorCategory(v);
      if (newColor) await store.setCreatorCategoryColor(v, newColor);
    }, `Added “${v}”`);
    if (ok) { setNewName(''); setNewColor(null); }
  }
  async function rename(oldName) {
    const v = draft.trim();
    if (!v || v === oldName) { setEditing(null); return; }
    if (v.includes(',')) { setErr('A category name cannot contain a comma'); return; }
    const merging = exists(v, oldName);
    const ok = await run(() => store.renameCreatorCategory(oldName, v),
      merging ? `Merged “${oldName}” into “${v}”` : `Renamed to “${v}”`);
    if (ok) { setEditing(null); setPending(l => [...l, { from: oldName, to: v }]); onEdit?.({ kind: 'rename', from: oldName, to: v }); }
  }
  const recolor = (name, color) => { setPaletteFor(null); run(() => store.setCreatorCategoryColor(name, color)); };
  async function remove(name) {
    const ok = await run(() => store.deleteCreatorCategory(name), `Deleted “${name}”`);
    if (ok) { setConfirmDel(null); setPending(l => [...l, { from: name, to: null }]); onEdit?.({ kind: 'delete', from: name }); }
  }

  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter(r => r.name.toLowerCase().includes(needle)) : rows;

  return (
    <div className="pc-overlay" onClick={() => !busy && onClose()}>
      <div className="pc-modal pc-modal-scroll pc-catmgr" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3><i className="bi bi-tags" style={{ marginRight: 8 }} />Creator categories</h3>
        <div className="pc-modal-sub">Shared by everyone in paid collab. Renaming or deleting a category updates every creator who has it.</div>
        <div className="pc-modal-body">
          <div className="pc-catmgr-add">
            <ColorDot color={newColor} onPick={setNewColor} />
            <input className="pc-input" placeholder="New category, e.g. Beauty" value={newName}
              onChange={e => { setNewName(e.target.value); setErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }} />
            <button className="pc-btn pc-btn-primary pc-btn-sm" disabled={busy || !newName.trim()} onClick={create}>Add</button>
          </div>
          {err && <div className="pc-inline-err">{err}</div>}
          {rows.length > 8 && (
            <input className="pc-input pc-catmgr-search" placeholder="Search categories…" value={q} onChange={e => setQ(e.target.value)} />
          )}
          <div className="pc-catmgr-list">
            {shown.length === 0 && <div className="pc-catfilter-empty">{rows.length ? 'No category matches' : 'No categories yet — add the first one above.'}</div>}
            {shown.map(r => (
              <div className="pc-catmgr-row" key={r.name}>
                <span className="pc-catmgr-swatch">
                  <button type="button" className="pc-catmgr-dot" style={r.color ? { background: r.color } : undefined}
                    title="Change colour" disabled={busy} onClick={() => setPaletteFor(p => p === r.name ? null : r.name)} />
                  {paletteFor === r.name && (
                    <Palette value={r.color} onPick={c => recolor(r.name, c)} onClose={() => setPaletteFor(null)} />
                  )}
                </span>
                {editing === r.name ? (
                  <input className="pc-input pc-catmgr-edit" autoFocus value={draft} disabled={busy}
                    onChange={e => { setDraft(e.target.value); setErr(''); }}
                    onBlur={() => rename(r.name)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); rename(r.name); }
                      if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); }
                    }} />
                ) : (
                  <button type="button" className="pc-catmgr-name" title="Rename" disabled={busy}
                    onClick={() => { setEditing(r.name); setDraft(r.name); }}>
                    <CatChip name={r.name} />
                  </button>
                )}
                <span className="pc-catmgr-count">{r.count} creator{r.count === 1 ? '' : 's'}</span>
                {confirmDel === r.name ? (
                  <span className="pc-catmgr-confirm">
                    <span>{r.count ? `Remove from ${r.count}?` : 'Delete?'}</span>
                    <button className="pc-btn pc-btn-danger pc-btn-sm" disabled={busy} onClick={() => remove(r.name)}>Delete</button>
                    <button className="pc-btn pc-btn-ghost pc-btn-sm" disabled={busy} onClick={() => setConfirmDel(null)}>Cancel</button>
                  </span>
                ) : (
                  <span className="pc-catmgr-acts">
                    <button type="button" className="pc-cdb-abtn" title="Rename" disabled={busy}
                      onClick={() => { setEditing(r.name); setDraft(r.name); }}><i className="bi bi-pencil" /></button>
                    <button type="button" className="pc-cdb-abtn danger" title="Delete category" disabled={busy}
                      onClick={() => setConfirmDel(r.name)}><i className="bi bi-trash" /></button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" disabled={busy} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Palette({ value, onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose]);
  return (
    <div className="pc-catmgr-palette" ref={ref}>
      <button type="button" className={`pc-catmgr-pal none ${!value ? 'on' : ''}`} title="No colour" onClick={() => onPick(null)} />
      {CATEGORY_PALETTE.map(c => (
        <button type="button" key={c} className={`pc-catmgr-pal ${value === c ? 'on' : ''}`} style={{ background: c }}
          title={c} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

function ColorDot({ color, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="pc-catmgr-swatch">
      <button type="button" className="pc-catmgr-dot" style={color ? { background: color } : undefined}
        title="Colour" onClick={() => setOpen(o => !o)} />
      {open && <Palette value={color} onPick={c => { onPick(c); setOpen(false); }} onClose={() => setOpen(false)} />}
    </span>
  );
}

/* Add / edit a creator_directory entry. In "add" mode the form can be
   pre-filled from a derived (deal-only) creator, so banking an existing
   collaborator's details is a two-click job. */
/* Removing a creator from the database — typed confirmation.

   ‼️ THE USERNAME HAS TO BE TYPED, and that is the whole point. The database
   is company-wide and a removal is not undoable (the only way back is adding
   the credentials again by hand), so a yes/no dialog is the wrong instrument:
   it is answered by reflex, and the row under the cursor is the one thing a
   mis-click gets wrong. Typing the handle cannot be done without reading which
   creator this is.

   ‼️ IT MATCHES THE HANDLE, NOT THE NAME, wherever there is one — the handle
   is what identifies a creator everywhere else in this app (it is what
   creator_identity_key keys on), and two people can share a name. A creator
   banked with no handle at all falls back to their name, because otherwise
   there would be nothing to type.

   ‼️ Case and a leading @ are FORGIVEN. TikTok handles are case-insensitive,
   so demanding the exact capitalisation would be a spelling test rather than a
   confirmation — it would add friction without adding a single moment of
   thought. Everything else must match, including the dots and underscores that
   are the whole difference between @jane.beauty and @janebeauty. */
export function CreatorDeleteModal({ entry, onClose, onConfirm }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const name = entry?.dir?.name || entry?.name || 'this creator';
  const handle = (entry?.handles || [])[0]?.handle || '';
  // What must be typed: their handle, else the name we have nothing better than.
  const target = (handle || name).trim();
  const tidy = (s) => String(s || '').trim().replace(/^@+/, '').toLowerCase();
  const ok = !!target && tidy(typed) === tidy(target);

  async function go() {
    if (!ok || busy) return;
    setBusy(true); setErr('');
    try {
      await onConfirm(entry);
    } catch (e) {
      // RLS refuses a row this handler did not bank; say so in the dialog
      // rather than in an alert that takes the context away with it.
      setErr(e?.message || 'Could not remove this creator.');
      setBusy(false);
    }
  }

  return (
    <div className={`pc-overlay pc-overlay-top ${busy ? 'is-busy' : ''}`} onClick={busy ? undefined : onClose}>
      <div className="pc-modal pc-del-modal" onClick={e => e.stopPropagation()}>
        <h3>Remove {name}?</h3>
        <div className="pc-modal-sub">
          This takes their credentials out of the shared creators database for everyone.
          It cannot be undone.
        </div>
        <div className="pc-modal-body">
          {err && <div className="pc-inline-err">{err}</div>}

          {/* Says plainly what survives. The deals are the part people worry
              about, and they are untouched — the row is only the banked
              credentials, and a creator with deals keeps appearing here,
              derived from them. */}
          <ul className="pc-del-keeps">
            <li><i className="bi bi-check-lg" /> Their deals, videos and payments stay exactly as they are</li>
            <li><i className="bi bi-x-lg" /> Their phone, email, payout details, categories, tags and notes are lost</li>
          </ul>

          <div className="pc-field">
            <label>Type <b className="pc-del-target">{target}</b> to confirm</label>
            <input className="pc-input" value={typed} autoFocus disabled={busy}
              placeholder={target}
              autoComplete="off" spellCheck={false}
              onChange={e => setTyped(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && ok) go(); }} />
            <div className="pc-sig-hint">
              {handle
                ? 'Their TikTok handle, as shown on their row. The @ and capitals do not matter.'
                : 'This creator has no TikTok handle on record, so type their name.'}
            </div>
          </div>
        </div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="pc-btn pc-btn-danger-solid" onClick={go} disabled={!ok || busy}>
            {busy ? 'Removing…' : 'Remove from the database'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DirectoryCreatorEditor({ editor, categories = [], onClose, onSave }) {
  const d = editor.entry || {};
  const isAdd = editor.mode === 'add';
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  /* Categories behave like labels: pick from the shared catalogue, or type a
     new one (which joins the catalogue on save so the next person can reuse it).
     Seeded from the array, falling back to splitting a legacy comma-crammed
     `category` string. */
  const [cats, setCats] = useState(() => (
    Array.isArray(d.categories) && d.categories.length ? d.categories.slice() : splitCats(d.category)
  ));
  const { saved, remember } = useCategoryCatalogue();

  const [f, setF] = useState({
    name: d.name || '',
    phone: d.phone || '', email: d.email || '',
    paypal: d.paypal || '', zelle: d.zelle || '', region: d.region || '',
    followers: d.followers != null ? String(d.followers) : '',
    rate: d.rate != null ? String(d.rate) : '',
    tags: Array.isArray(d.tags) ? d.tags.join(', ') : '',
    notes: d.notes || '',
  });
  const [tiktoks, setTiktoks] = useState(() => {
    const arr = String(d.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : [''];
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  async function save() {
    if (!f.name.trim() || saving) return;
    setSaving(true); setErr('');
    try {
      await onSave({
        ...f,
        categories: cats,
        tiktok_handle: tiktoks.map(s => s.trim()).filter(Boolean).join('\n'),
        tags: f.tags.split(',').map(s => s.trim()).filter(Boolean),
      });
      remember(cats);   // grow the shared vocabulary, best-effort
    } catch (e) {
      setErr(e.message || 'Could not save');
      setSaving(false);
    }
  }

  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal pc-modal-scroll" onClick={e => e.stopPropagation()}>
        <h3>{isAdd ? 'Add creator to the database' : 'Edit creator details'}</h3>
        <div className="pc-modal-sub">Shared with every paid-collab handler. Credentials only, no deal is created.</div>
        <div className="pc-modal-body">
          {err && <div className="pc-inline-err">{err}</div>}
          <div className="pc-field">
            <label>Name</label>
            <input className="pc-input" placeholder="Creator name" value={f.name} autoFocus onChange={e => set('name', e.target.value)} />
          </div>
          <div className="pc-field">
            <label>TikTok account(s)</label>
            {tiktoks.map((t, i) => (
              <div className="pc-multirow" key={i}>
                <input className="pc-input" placeholder="@handle or URL" value={t}
                  onChange={e => setTiktoks(prev => prev.map((x, j) => (j === i ? e.target.value : x)))} />
                {tiktoks.length > 1 && <button type="button" className="pc-multix" title="Remove"
                  onClick={() => setTiktoks(prev => prev.filter((_, j) => j !== i))}>×</button>}
              </div>
            ))}
            <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" style={{ marginTop: 2 }}
              onClick={() => setTiktoks(prev => [...prev, ''])}>+ Add another account</button>
            <div className="pc-sig-hint">The first handle identifies the creator across brands — keep it accurate.</div>
          </div>
          <div className="pc-field2">
            <div className="pc-field"><label>Number</label><input className="pc-input" placeholder="phone" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div className="pc-field"><label>Email</label><input className="pc-input" placeholder="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
          </div>
          <div className="pc-field"><label>Region</label><input className="pc-input" placeholder="e.g. US · UK · Berlin" value={f.region} onChange={e => set('region', e.target.value)} /></div>
          <div className="pc-field">
            <label>Categories</label>
            <CategoryPicker value={cats} onChange={setCats} saved={saved} inUse={categories} />
          </div>
          <div className="pc-field2">
            <div className="pc-field"><label>Followers</label><input className="pc-input" type="number" inputMode="numeric" placeholder="120000" value={f.followers} onChange={e => set('followers', e.target.value)} /></div>
            <div className="pc-field"><label>Asking rate / video</label><input className="pc-input" type="number" inputMode="numeric" placeholder="150" value={f.rate} onChange={e => set('rate', e.target.value)} /></div>
          </div>
          <div className="pc-field2">
            <div className="pc-field"><label>PayPal</label><input className="pc-input" placeholder="email" value={f.paypal} onChange={e => set('paypal', e.target.value)} /></div>
            <div className="pc-field"><label>Zelle</label><input className="pc-input" placeholder="email / phone" value={f.zelle} onChange={e => set('zelle', e.target.value)} /></div>
          </div>
          <div className="pc-field"><label>Tags</label><input className="pc-input" placeholder="comma separated — e.g. high-converting, US-based" value={f.tags} onChange={e => set('tags', e.target.value)} /></div>
          <div className="pc-field"><label>Notes</label><textarea className="pc-input pc-textarea" rows={3} placeholder="How you found them, past performance, what they charge…" value={f.notes} onChange={e => set('notes', e.target.value)} /></div>
        </div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={!f.name.trim() || saving}>{saving ? 'Saving…' : (isAdd ? 'Add' : 'Save')}</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   DASHBOARD — data-dense (KPIs + charts + insights) across all of the
   handler's brands, with a Monthly / Weekly lens.

   ‼️ The component is still called ReportingView and its CSS is still
   .pc-rd-* ("reporting dashboard"): the page was named "Internal Reporting"
   when it was a workspace tab, and it is the sidebar's "Dashboard" now. Only
   the user-facing name changed — renaming the component and its ~90 CSS
   classes would be a large diff for no behaviour. Read pc-rd-* as "this
   page", not as a second reporting feature.
════════════════════════════════════════════════════════════ */
const RD_STATUS = {
  videos_in_progress: { label: 'In progress', cls: 'prog', color: '#1259C3' },
  follow_up: { label: 'Follow-up', cls: 'fup', color: '#C62828' },
  pending: { label: 'Pending pay', cls: 'pend', color: '#E8862E' },
  paid: { label: 'Paid', cls: 'paid', color: '#198754' },
};
const rdDelivered = (c) => deliveredCount(c);
const rdAgreed = (c) => Number(c.videos_count) || 0;
const rdUnauthCodes = (c) => (Array.isArray(c.video_codes) ? c.video_codes : []).filter(v => (v?.adCode || '').trim() && !v?.auth).length;

/* Memoised — see MEMOISED TAB BODIES at the top of this file. */
const ReportingView = React.memo(function ReportingViewBody({ brands, brandById, creators, month, comments = [], onOpenComments }) {
  const [mode, setMode] = useState('weekly'); // monthly | weekly
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [weekSel, setWeekSel] = useState(null); // null = all weeks of the month
  const [brandSel, setBrandSel] = useState(''); // '' = all brands, else brand_id
  const isWeekly = mode === 'weekly';
  setReportCurrency(brandSel ? (brandById[brandSel] && brandById[brandSel].currency) : uniformCurrency(brands));
  const brandCommentCount = brandSel ? comments.filter(c => c.brand_id === brandSel).length : 0;

  // Everything below is computed over the chosen brand scope (all brands by default).
  const scoped = useMemo(() => brandSel ? creators.filter(c => c.brand_id === brandSel) : creators, [creators, brandSel]);
  const selBrandName = brandSel ? (brandById[brandSel]?.name || 'Brand') : null;

  // Distinct week-starts that have data in the selected month (within the brand scope).
  const monthWeekKeys = useMemo(() => {
    const set = new Set();
    scoped.forEach(c => { const w = (c.monthly || {}).weeks || {}; Object.keys(w).forEach(k => { if (k.slice(0, 7) === month) set.add(k); }); });
    return [...set].sort();
  }, [scoped, month]);
  // Selected week is only honoured if it exists in this month (auto-resets on month change).
  const activeWeek = isWeekly && weekSel && monthWeekKeys.includes(weekSel) ? weekSel : null;

  const periodGmv = (c) => {
    const mm = c.monthly || {};
    if (isWeekly) {
      const w = mm.weeks || {};
      if (activeWeek) return Number(w[activeWeek]?.gmv) || 0;
      return Object.keys(w).filter(k => k.slice(0, 7) === month).reduce((t, k) => t + (Number(w[k]?.gmv) || 0), 0);
    }
    return Number(mm[month]?.gmv) || 0;
  };
  const periodAd = (c) => {
    const mm = c.monthly || {};
    if (isWeekly) {
      const w = mm.weeks || {};
      if (activeWeek) return Number(w[activeWeek]?.adSpent) || 0;
      return Object.keys(w).filter(k => k.slice(0, 7) === month).reduce((t, k) => t + (Number(w[k]?.adSpent) || 0), 0);
    }
    return Number(mm[month]?.adSpent) || 0;
  };

  const kpis = useMemo(() => {
    const active = scoped.filter(c => c.payment_status !== 'paid').length;
    const posted = scoped.reduce((t, c) => t + rdDelivered(c), 0);
    const pipeline = scoped.reduce((t, c) => t + Math.max(0, rdAgreed(c) - rdDelivered(c)), 0);
    const pendingList = scoped.filter(c => c.payment_status === 'pending');
    const pendingAmt = pendingList.reduce((t, c) => t + (Number(c.amount) || 0), 0);
    const gmv = scoped.reduce((t, c) => t + periodGmv(c), 0);
    const ad = scoped.reduce((t, c) => t + periodAd(c), 0);
    return { active, posted, pipeline, pendingCount: pendingList.length, pendingAmt, gmv, ad, roas: ad > 0 ? gmv / ad : 0 };
  }, [scoped, month, isWeekly, activeWeek]);

  const trend = useMemo(() => {
    if (isWeekly) {
      const set = new Set();
      scoped.forEach(c => { const w = (c.monthly || {}).weeks || {}; Object.keys(w).forEach(k => { if (k.slice(0, 7) === month) set.add(k); }); });
      return [...set].sort().map(k => {
        let gmv = 0, ad = 0;
        scoped.forEach(c => { const cell = ((c.monthly || {}).weeks || {})[k]; if (cell) { gmv += Number(cell.gmv) || 0; ad += Number(cell.adSpent) || 0; } });
        return { label: rangeShort(k, addDaysISO(k, 6)), gmv, ad };
      });
    }
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const mk = addMonth(month, -i);
      let gmv = 0, ad = 0;
      scoped.forEach(c => { const cell = (c.monthly || {})[mk]; if (cell) { gmv += Number(cell.gmv) || 0; ad += Number(cell.adSpent) || 0; } });
      out.push({ label: monthShort(mk), gmv, ad });
    }
    return out;
  }, [scoped, month, isWeekly]);

  const topCreators = useMemo(() =>
    scoped.map(c => ({ name: c.name || '—', gmv: periodGmv(c) }))
      .filter(x => x.gmv > 0).sort((a, b) => b.gmv - a.gmv).slice(0, 6)
      .map(x => ({ name: x.name.length > 16 ? x.name.slice(0, 16) + '…' : x.name, gmv: x.gmv })),
    [scoped, month, isWeekly, activeWeek]);

  const payMix = useMemo(() => {
    const m = { videos_in_progress: 0, follow_up: 0, pending: 0, paid: 0 };
    scoped.forEach(c => { m[c.payment_status] = (m[c.payment_status] || 0) + 1; });
    return Object.keys(RD_STATUS).map(k => ({ name: RD_STATUS[k].label, value: m[k] || 0, color: RD_STATUS[k].color })).filter(s => s.value > 0);
  }, [scoped]);

  const creatorRows = useMemo(() =>
    scoped.map(c => ({ c, del: rdDelivered(c), ag: rdAgreed(c), gmv: periodGmv(c) }))
      .sort((a, b) => b.gmv - a.gmv || b.del - a.del).slice(0, 12),
    [scoped, month, isWeekly, activeWeek]);

  const approvals = useMemo(() => {
    const pays = scoped.filter(c => c.payment_status === 'pending').map(c => ({ c, amount: Number(c.amount) || 0 }));
    const auths = scoped.map(c => ({ c, n: rdUnauthCodes(c) })).filter(x => x.n > 0);
    return { pays, auths, total: pays.length + auths.length };
  }, [scoped]);

  const insights = useMemo(() => {
    const list = [];
    const top = [...scoped].map(c => ({ c, gmv: periodGmv(c) })).sort((a, b) => b.gmv - a.gmv)[0];
    if (top && top.gmv > 0) list.push({ tone: 'good', icon: 'bi-trophy-fill', text: <><b>{top.c.name}</b> leads with <b>{fmt$(top.gmv)}</b> GMV {isWeekly ? 'this month (weekly)' : `in ${monthLabel(month)}`}.</> });
    if (kpis.ad > 0) list.push({ tone: kpis.roas >= 1 ? 'good' : 'warn', icon: 'bi-graph-up-arrow', text: <>Blended ROAS <b>{kpis.roas.toFixed(2)}x</b> on {fmt$(kpis.ad)} ad spend.</> });
    if (kpis.pendingCount > 0) list.push({ tone: 'warn', icon: 'bi-cash-stack', text: <><b>{fmt$(kpis.pendingAmt)}</b> pending across <b>{kpis.pendingCount}</b> creator{kpis.pendingCount === 1 ? '' : 's'} — awaiting payout.</> });
    if (kpis.pipeline > 0) list.push({ tone: 'info', icon: 'bi-hourglass-split', text: <><b>{kpis.pipeline}</b> video{kpis.pipeline === 1 ? '' : 's'} still in pipeline across <b>{kpis.active}</b> active creator{kpis.active === 1 ? '' : 's'}.</> });
    if (!isWeekly) {
      const cur = trend[trend.length - 1]?.gmv || 0;
      const prev = trend[trend.length - 2]?.gmv || 0;
      if (prev > 0) { const pct = Math.round(((cur - prev) / prev) * 100); list.push({ tone: pct >= 0 ? 'good' : 'warn', icon: pct >= 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right', text: <>GMV is <b>{pct >= 0 ? 'up' : 'down'} {Math.abs(pct)}%</b> vs the previous month.</> }); }
    }
    if (approvals.auths.length > 0) { const n = approvals.auths.reduce((t, x) => t + x.n, 0); list.push({ tone: 'warn', icon: 'bi-shield-exclamation', text: <><b>{n}</b> ad code{n === 1 ? '' : 's'} awaiting authorisation.</> }); }
    return list.slice(0, 5);
  }, [scoped, kpis, trend, approvals, month, isWeekly, activeWeek]);

  const moneyTip = (v) => fmt$(Number(v) || 0);
  // When the chart has only one populated period (a single week/month of data), a
  // line/area is invisible — so render bigger dots and value labels instead.
  const fewPoints = trend.filter(t => (t.gmv || 0) || (t.ad || 0)).length <= 1;
  const lblMoney = (v) => (Number(v) > 0 ? fmt$(v) : '');

  if (!creators.length) {
    return (
      <div className="pc-card"><div className="pc-empty pc-empty-lg">
        <div className="pc-empty-icon">📊</div>
        <h3>Nothing to report yet</h3>
        <p>Onboard creators and log their GMV in the Performance tab — your reporting dashboard builds itself from there.</p>
      </div></div>
    );
  }

  return (
    <div className="pc-rd">
      {/* header */}
      <div className="pc-rd-top">
        <div>
          <h2 className="pc-rd-title">Dashboard</h2>
          <div className="pc-rd-sub">
            {isWeekly
              ? <>Weekly view · {activeWeek ? <b>{rangeShort(activeWeek, addDaysISO(activeWeek, 6))}</b> : 'all weeks'} · {monthLabel(month)} · {selBrandName || `${brands.length} brand${brands.length === 1 ? '' : 's'}`}</>
              : <>Monthly view · {monthLabel(month)} · {selBrandName || `${brands.length} brand${brands.length === 1 ? '' : 's'}`}</>}
          </div>
        </div>
        <div className="pc-rd-actions">
          <label className="pc-rd-brand">
            <i className="bi bi-shop" />
            <select value={brandSel} onChange={e => { setBrandSel(e.target.value); setWeekSel(null); }}>
              <option value="">All brands</option>
              {[...brands].sort((a, b) => a.name.localeCompare(b.name)).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          {brandSel && onOpenComments && (
            <button className="pc-disc-btn" onClick={() => onOpenComments(brandSel, 'brand', '')} title="Open discussion for this brand">
              <i className="bi bi-chat-left-text" />Discussion
              {brandCommentCount > 0 && <span className="pc-disc-badge">{brandCommentCount}</span>}
            </button>
          )}
          <button className={`pc-rd-appr ${approvals.total ? 'has' : ''}`} onClick={() => setApprovalsOpen(true)}
            title="Items that need action">
            <i className="bi bi-clipboard-check" />
            Actions Needed
            <span className="pc-rd-appr-badge">{approvals.total}</span>
          </button>
          <PerfModeToggle mode={mode} setMode={setMode} />
        </div>
      </div>

      {/* week selector (weekly mode) — which week's stats am I viewing */}
      {isWeekly && (
        <div className="pc-rd-weeks">
          <span className="pc-rd-weeks-l"><i className="bi bi-calendar3" /> Week</span>
          <button className={`pc-rd-week ${!activeWeek ? 'active' : ''}`} onClick={() => setWeekSel(null)}>All weeks</button>
          {monthWeekKeys.length === 0 ? (
            <span className="pc-rd-weeks-none">No weekly data in {monthLabel(month)} yet</span>
          ) : monthWeekKeys.map((k, i) => (
            <button key={k} className={`pc-rd-week ${activeWeek === k ? 'active' : ''}`} onClick={() => setWeekSel(k)}
              title={rangeLong(k, addDaysISO(k, 6))}>
              <span className="pc-rd-week-n">W{i + 1}</span>{rangeShort(k, addDaysISO(k, 6))}
            </button>
          ))}
        </div>
      )}

      {/* KPI tiles */}
      <div className="pc-rd-kpis">
        <RKpi icon="bi-people-fill" color="#6610F2" label="Active creators" value={fmtNum(kpis.active)} sub={`${scoped.length} total`} />
        <RKpi icon="bi-collection-play-fill" color="#198754" label="Videos posted" value={fmtNum(kpis.posted)} sub="delivered" />
        <RKpi icon="bi-hourglass-split" color="#0DCAF0" label="In pipeline" value={fmtNum(kpis.pipeline)} sub="to deliver" />
        <RKpi icon="bi-cash-stack" color="#E8862E" label="Pending payments" value={fmt$(kpis.pendingAmt)} sub={`${kpis.pendingCount} creator${kpis.pendingCount === 1 ? '' : 's'}`} />
        <RKpi icon="bi-graph-up-arrow" color="#1259C3" label="GMV generated" value={fmt$(kpis.gmv)} sub={kpis.ad > 0 ? `${kpis.roas.toFixed(2)}x ROAS` : (isWeekly ? (activeWeek ? rangeShort(activeWeek, addDaysISO(activeWeek, 6)) : 'all weeks') : monthLabel(month))} />
      </div>

      {/* charts */}
      <div className="pc-rd-charts">
        <div className="pc-rd-card">
          <div className="pc-rd-card-h">
            <span className="pc-rd-card-t">GMV vs Ad spend</span>
            <span className="pc-rd-card-s">{isWeekly ? `weeks of ${monthLabel(month)}` : 'last 6 months'}</span>
          </div>
          {trend.some(t => t.gmv || t.ad) ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rdGmv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1259C3" stopOpacity={0.45} /><stop offset="100%" stopColor="#1259C3" stopOpacity={0} /></linearGradient>
                    <linearGradient id="rdAd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8862E" stopOpacity={0.4} /><stop offset="100%" stopColor="#E8862E" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef1" vertical={false} />
                  <XAxis dataKey="label" stroke="#8b93a1" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8b93a1" fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                  <Tooltip formatter={moneyTip} contentStyle={{ borderRadius: 10, border: '1px solid #e9ecef', fontSize: 12 }} />
                  <Area type="monotone" dataKey="gmv" name="GMV" stroke="#1259C3" strokeWidth={2.5} fill="url(#rdGmv)"
                    dot={{ r: fewPoints ? 5 : 3, strokeWidth: 0, fill: '#1259C3' }} activeDot={{ r: 6 }}>
                    {fewPoints && <LabelList dataKey="gmv" position="top" offset={12} formatter={lblMoney} style={{ fontSize: 11, fontWeight: 800, fill: '#1259C3' }} />}
                  </Area>
                  <Area type="monotone" dataKey="ad" name="Ad spend" stroke="#E8862E" strokeWidth={2.5} fill="url(#rdAd)"
                    dot={{ r: fewPoints ? 5 : 3, strokeWidth: 0, fill: '#E8862E' }} activeDot={{ r: 6 }}>
                    {fewPoints && <LabelList dataKey="ad" position="bottom" offset={12} formatter={lblMoney} style={{ fontSize: 11, fontWeight: 800, fill: '#E8862E' }} />}
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="pc-rd-chart-empty">No GMV logged for this period yet.</div>}
          <div className="pc-rd-legend"><span className="pc-rd-leg"><i style={{ background: '#1259C3' }} />GMV</span><span className="pc-rd-leg"><i style={{ background: '#E8862E' }} />Ad spend</span></div>
        </div>

        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">Creator payment mix</span></div>
          {payMix.length ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={payMix} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
                    {payMix.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e9ecef', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="pc-rd-chart-empty">No creators yet.</div>}
          <div className="pc-rd-legend">
            {payMix.map((s, i) => <span className="pc-rd-leg" key={i}><i style={{ background: s.color }} />{s.name} · {s.value}</span>)}
          </div>
        </div>
      </div>

      {/* lower: creators list + insights */}
      <div className="pc-rd-lower">
        <div className="pc-rd-card">
          <div className="pc-rd-card-h">
            <span className="pc-rd-card-t">Creators &amp; videos</span>
            <span className="pc-rd-card-s">top {creatorRows.length} by GMV</span>
          </div>
          <div className="pc-rd-clist">
            <div className="pc-rd-crow pc-rd-crh">
              <span>Creator</span><span>Videos</span><span className="pc-rd-r">GMV</span><span className="pc-rd-r">Status</span>
            </div>
            {creatorRows.map(({ c, del, ag, gmv }) => {
              const pct = ag > 0 ? Math.min(100, Math.round((del / ag) * 100)) : (del > 0 ? 100 : 0);
              const st = RD_STATUS[c.payment_status] || RD_STATUS.videos_in_progress;
              const b = brandById[c.brand_id];
              return (
                <div className="pc-rd-crow" key={c.id}>
                  <span className="pc-rd-cname">
                    <span className="pc-rd-ava" style={{ background: getGradient(c.name) }}>{initial(c.name)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="pc-rd-cn">{c.name}</span>
                      <span className="pc-rd-cb">{b?.name || '—'}</span>
                    </span>
                  </span>
                  <span className="pc-rd-vid">
                    <span className="pc-rd-vid-top">{del}<i>/{ag || del || 0}</i></span>
                    <span className="pc-rd-track"><span className="pc-rd-fill" style={{ width: pct + '%', background: st.color }} /></span>
                  </span>
                  <span className="pc-rd-r pc-rd-gmv">{gmv > 0 ? fmt$(gmv) : '—'}</span>
                  <span className="pc-rd-r"><span className={`pc-rd-pill ${st.cls}`}>{st.label}</span></span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">Insights</span></div>
          {insights.length ? (
            <div className="pc-rd-ins">
              {insights.map((ins, i) => (
                <div className={`pc-rd-in ${ins.tone}`} key={i}>
                  <span className="pc-rd-in-ic"><i className={`bi ${ins.icon}`} /></span>
                  <span className="pc-rd-in-txt">{ins.text}</span>
                </div>
              ))}
            </div>
          ) : <div className="pc-rd-chart-empty">No insights yet.</div>}
        </div>
      </div>

      {approvalsOpen && (
        <div className="pc-overlay" onClick={() => setApprovalsOpen(false)}>
          <div className="pc-modal pc-appr-modal" onClick={e => e.stopPropagation()}>
            <div className="pc-appr-head">
              <h3>Actions Needed</h3>
              <button className="pc-iconbtn" onClick={() => setApprovalsOpen(false)} aria-label="Close">✕</button>
            </div>
            {approvals.total === 0 ? (
              <div className="pc-empty"><div className="pc-empty-icon">✅</div><h3>All clear</h3><p>Nothing needs your action right now.</p></div>
            ) : (
              <div className="pc-appr-list">
                {approvals.pays.length > 0 && <div className="pc-appr-group">Payments to release ({approvals.pays.length})</div>}
                {approvals.pays.map(({ c, amount }) => (
                  <div className="pc-appr-item" key={'p' + c.id}>
                    <span className="pc-rd-ava" style={{ background: getGradient(c.name) }}>{initial(c.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="pc-rd-cn">{c.name}</span>
                      <span className="pc-rd-cb">{brandById[c.brand_id]?.name || '—'}</span>
                    </span>
                    <span className="pc-appr-amt">{fmt$(amount)}</span>
                    <span className="pc-rd-pill pend">Pay</span>
                  </div>
                ))}
                {approvals.auths.length > 0 && <div className="pc-appr-group">Ad codes to authorise ({approvals.auths.length})</div>}
                {approvals.auths.map(({ c, n }) => (
                  <div className="pc-appr-item" key={'a' + c.id}>
                    <span className="pc-rd-ava" style={{ background: getGradient(c.name) }}>{initial(c.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="pc-rd-cn">{c.name}</span>
                      <span className="pc-rd-cb">{brandById[c.brand_id]?.name || '—'}</span>
                    </span>
                    <span className="pc-appr-amt">{n} code{n === 1 ? '' : 's'}</span>
                    <span className="pc-rd-pill prog">Authorise</span>
                  </div>
                ))}
              </div>
            )}
            <div className="pc-modal-actions" style={{ marginTop: 14 }}>
              <button className="pc-btn pc-btn-primary" onClick={() => setApprovalsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

function RKpi({ icon, color, label, value, sub }) {
  return (
    <div className="pc-rk" style={{ ['--rk']: color }}>
      <span className="pc-rk-ic" style={{ background: `${color}1a`, color }}><i className={`bi ${icon}`} /></span>
      <div className="pc-rk-body">
        <div className="pc-rk-label">{label}</div>
        <div className="pc-rk-value">{value}</div>
        {sub && <div className="pc-rk-sub">{sub}</div>}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Performance tab — brand → per-creator monthly GMV / Ad Spend matrix
════════════════════════════════════════════════════════════ */
function sumMonthly(c, field) {
  const m = c.monthly || {};
  let t = 0;
  Object.keys(m).forEach(k => { if (/^\d{4}-\d{2}$/.test(k)) t += Number(m[k]?.[field]) || 0; });
  return t;
}
// One deal's figure for the SELECTED period, same convention as the Reporting tab:
// monthly reads the YYYY-MM cell, weekly reads one week when `week` is given and
// otherwise sums every week whose start falls in the month. Weekly entries live in
// a nested `monthly.weeks` map (key = week-start YYYY-MM-DD) so they never collide
// with the YYYY-MM keys or the top-level `l30`.
function periodValue(c, field, isWeekly, month, week = null) {
  const mm = c.monthly || {};
  const w = mm.weeks || {};
  const weekSum = () => Object.keys(w).reduce((t, k) => t + (k.slice(0, 7) === month ? (Number(w[k]?.[field]) || 0) : 0), 0);
  if (isWeekly) return week ? (Number(w[week]?.[field]) || 0) : weekSum();
  // MONTHLY asks "what did this month total, however it was entered" — so the month
  // cell wins and a month with no monthly figure falls back to the sum of its weeks
  // (creatorGmvTotal's rule). Without this, every brand whose numbers are logged
  // weekly reads as zero the moment you flip to Monthly.
  const cell = mm[month]?.[field];
  return cell == null || cell === '' ? weekSum() : (Number(cell) || 0);
}

// Monthly | Weekly segmented toggle, shared by the brand list and the matrix.
function PerfModeToggle({ mode, setMode }) {
  return (
    <div className="pc-seg" role="tablist" aria-label="Performance period">
      <button type="button" role="tab" aria-selected={mode === 'monthly'}
        className={`pc-seg-btn ${mode === 'monthly' ? 'active' : ''}`} onClick={() => setMode('monthly')}>Monthly</button>
      <button type="button" role="tab" aria-selected={mode === 'weekly'}
        className={`pc-seg-btn ${mode === 'weekly' ? 'active' : ''}`} onClick={() => setMode('weekly')}>Weekly</button>
    </div>
  );
}

/* Memoised — see MEMOISED TAB BODIES at the top of this file. */
const PerformanceView = React.memo(function PerformanceViewBody({ brands, creators, brandById, month, reportWeeks, reportAnchors, onCreateWeek, onSaveMonthly }) {
  const [bId, setBId] = useState(null);
  // Period granularity for GMV / Ad tracking — persisted across the drilldown.
  const [mode, setMode] = useState('weekly'); // 'monthly' | 'weekly'
  const byBrand = useMemo(() => {
    const m = {};
    creators.forEach(c => { (m[c.brand_id] = m[c.brand_id] || []).push(c); });
    return m;
  }, [creators]);
  if (bId && brandById[bId]) {
    return <BrandMatrix brand={brandById[bId]} creators={byBrand[bId] || []} mode={mode} setMode={setMode}
      month={month} brandReportWeeks={(reportWeeks || {})[bId] || []} brandAnchor={(reportAnchors || {})[bId] || null}
      onCreateWeek={onCreateWeek} onBack={() => setBId(null)} onSaveMonthly={onSaveMonthly} />;
  }
  return <PerfBrandList brands={brands} byBrand={byBrand} mode={mode} setMode={setMode} month={month} onOpen={setBId} />;
});

function PerfBrandList({ brands, byBrand, mode, setMode, month, onOpen }) {
  setReportCurrency(uniformCurrency(brands)); // multi-brand list → common currency or $
  const [q, setQ] = useState('');
  const [weekSel, setWeekSel] = useState(null); // null = every week of the month
  const isWeekly = mode === 'weekly';

  // The week-starts that actually carry entries in the selected month, across every
  // brand — i.e. exactly the weeks the weekly data was entered into. Same list the
  // Reporting tab builds, so both tabs agree on which weeks exist.
  const monthWeekKeys = useMemo(() => {
    const set = new Set();
    brands.forEach(b => (byBrand[b.id] || []).forEach(c => {
      const w = (c.monthly || {}).weeks || {};
      Object.keys(w).forEach(k => { if (k.slice(0, 7) === month) set.add(k); });
    }));
    return [...set].sort();
  }, [brands, byBrand, month]);
  // A picked week is only honoured while it exists in this month, so switching
  // month (or back to monthly mode) falls back to the whole period on its own.
  const activeWeek = isWeekly && weekSel && monthWeekKeys.includes(weekSel) ? weekSel : null;
  const periodLabel = activeWeek ? rangeShort(activeWeek, addDaysISO(activeWeek, 6)) : monthLabel(month);

  let rows = brands.map(b => {
    const cs = byBrand[b.id] || [];
    // Every figure is scoped to the period picked in the header (month, or one of
    // its weeks), so the row moves with the nav instead of showing an all-time total.
    let gmv = 0, ad = 0, l30 = 0;
    const names = new Set();
    cs.forEach(c => {
      const g = periodValue(c, 'gmv', isWeekly, month, activeWeek);
      const a = periodValue(c, 'adSpent', isWeekly, month, activeWeek);
      // A deal belongs to the month when it was onboarded into it OR still produced
      // in it — a creator onboarded in July who keeps selling must not vanish from
      // August. Deals outside the month contribute nothing (incl. their l30, which
      // lives per deal and would otherwise be counted once per month they exist).
      if (monthKey(c.onboarded_on) !== month && !g && !a) return;
      const n = (c.name || '').trim().toLowerCase();
      if (n) names.add(n);
      gmv += g; ad += a; l30 += Number((c.monthly || {}).l30) || 0;
    });
    // Membership in the list stays ALL-TIME: a brand with no activity this month
    // must still be openable to enter that month's numbers.
    const everCreators = new Set(cs.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean)).size;
    return { id: b.id, name: b.name, logo: b.logo_url || null, creators: names.size, gmv, ad, l30, everCreators };
  }).filter(r => r.everCreators > 0 || r.gmv > 0);
  if (q.trim()) rows = rows.filter(r => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  rows.sort((a, b) => b.gmv - a.gmv || a.name.localeCompare(b.name));
  return (
    <>
      <div className="pc-toolbar">
        <input className="pc-search" placeholder="Search brands…" value={q} onChange={e => setQ(e.target.value)} />
        <PerfModeToggle mode={mode} setMode={setMode} />
        <span className="pc-count-pill">{rows.length} brand{rows.length === 1 ? '' : 's'} · {periodLabel}{isWeekly && !activeWeek ? ' · all weeks' : ''}</span>
      </div>

      {/* week selector (weekly mode) — the weeks this month's data was entered into */}
      {isWeekly && (
        <div className="pc-rd-weeks" style={{ marginBottom: 14 }}>
          <span className="pc-rd-weeks-l"><i className="bi bi-calendar3" /> Week</span>
          <button className={`pc-rd-week ${!activeWeek ? 'active' : ''}`} onClick={() => setWeekSel(null)}>All weeks</button>
          <div className="pc-rd-weeks-scroll">
            {monthWeekKeys.length === 0 ? (
              <span className="pc-rd-weeks-none">No weekly data in {monthLabel(month)} yet</span>
            ) : monthWeekKeys.map((k, i) => (
              <button key={k} className={`pc-rd-week ${activeWeek === k ? 'active' : ''}`} onClick={() => setWeekSel(k)}
                title={rangeLong(k, addDaysISO(k, 6))}>
                <span className="pc-rd-week-n">W{i + 1}</span>{rangeShort(k, addDaysISO(k, 6))}
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">📈</div><h3>No brands yet</h3><p>Onboard creators under a brand to track GMV here.</p></div></div>
      ) : (
        <div className="pc-card pc-list">
          <div className="pc-pf-head">
            <div className="pc-num">#</div><div>Brand</div>
            <div className="pc-num" title={`Creators working with this brand in ${periodLabel}`}>Creators</div>
            <div className="pc-num" title="Last-30-days GMV logged on this month's deals">L30 GMV</div>
            <div className="pc-num" title={`GMV logged for ${periodLabel}`}>Total GMV</div>
            <div className="pc-num" title={`Ad spend logged for ${periodLabel}`}>Total Ad</div>
            <div />
          </div>
          {rows.map((r, i) => (
            <div className="pc-pf-row" key={r.id} onClick={() => onOpen(r.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(r.id); }}>
              <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{i + 1}</span></div>
              <div className="pc-cell" data-label="Brand"><span className="pc-pf-brand"><BrandAva name={r.name} logo={r.logo} style={{ width: 30, height: 30, fontSize: 13 }} />{r.name}</span></div>
              <div className="pc-cell pc-num" data-label="Creators">{r.creators}</div>
              <div className="pc-cell pc-num" data-label="L30 GMV"><span className="pc-money">{fmt$(r.l30)}</span></div>
              <div className="pc-cell pc-num" data-label="Total GMV"><span className="pc-money">{fmt$(r.gmv)}</span></div>
              <div className="pc-cell pc-num" data-label="Total Ad"><span className="pc-money">{fmt$(r.ad)}</span></div>
              <div className="pc-chev pc-cell-hide-mobile">›</div>

              {/* ── purpose-built mobile card ── */}
              <div className="pc-mc">
                <div className="pc-mc-head">
                  <BrandAva name={r.name} logo={r.logo} />
                  <div className="pc-mc-idblock">
                    <div className="pc-mc-name">{r.name}</div>
                    <div className="pc-mc-subline">{r.creators} creator{r.creators === 1 ? '' : 's'}</div>
                  </div>
                  <span className="pc-mc-chev">›</span>
                </div>
                <div className="pc-mc-stats pc-mc-stats-3">
                  <div className="pc-mc-stat"><b className="pc-mx-l30h">{fmt$(r.l30)}</b><span>L30 GMV</span></div>
                  <div className="pc-mc-stat"><b>{fmt$(r.gmv)}</b><span>Total GMV</span></div>
                  <div className="pc-mc-stat"><b>{fmt$(r.ad)}</b><span>Total Ad</span></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BrandMatrix({ brand, creators, mode, setMode, month, brandReportWeeks, brandAnchor, onCreateWeek, onBack, onSaveMonthly, monthNav = null }) {
  const ro = useRO();
  setReportCurrency(brand && brand.currency); // single brand → its money symbol
  const isWeekly = mode === 'weekly';
  const [creating, setCreating] = useState(false);
  const canon = useMemo(() => {
    const m = {};
    creators.forEach(c => {
      const k = (c.name || '').trim().toLowerCase(); if (!k) return;
      if (!m[k] || String(c.onboarded_on || '9999') < String(m[k].onboarded_on || '9999')) m[k] = c;
    });
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name));
  }, [creators]);
  const start = useMemo(() => {
    const ms = creators.map(c => monthKey(c.onboarded_on)).filter(Boolean).sort();
    return ms[0] || thisMonthKey();
  }, [creators]);
  const months = useMemo(() => monthRange(start, addMonth(thisMonthKey(), -1)), [start]);
  // Build normalized period columns: { key, label, title }. Monthly = every month
  // since onboarding; weekly = ONLY the weeks that exist in this brand's weekly
  // reports (week_start..week_end), filtered to the selected month (a report belongs
  // to the month of its week_start, matching the reporting system).
  const periods = useMemo(() => {
    if (isWeekly) {
      return (brandReportWeeks || [])
        .filter(w => String(w.start).slice(0, 7) === month)
        .map(w => ({ key: w.start, end: w.end, label: rangeShort(w.start, w.end), title: rangeLong(w.start, w.end) }));
    }
    return months.map(m => ({ key: m, end: null, label: monthShort(m), title: monthShort(m) }));
  }, [isWeekly, brandReportWeeks, month, months]);
  const weeklyEmpty = isWeekly && periods.length === 0;
  const periodNoun = isWeekly ? 'week' : 'month';

  // "Create next weekly report" — anchor + existing weeks define the next window.
  const effectiveAnchor = brandAnchor
    || ((brandReportWeeks || []).length ? brandReportWeeks.map(w => w.start).slice().sort()[0] : null);
  const nextWindow = useMemo(() => {
    if (!effectiveAnchor) return null;
    const existing = new Set((brandReportWeeks || []).map(w => w.start));
    let start = effectiveAnchor, wn = 1;
    while (existing.has(start)) { start = addDaysISO(start, 7); wn++; }
    return { start, end: addDaysISO(start, 6), week_number: wn };
  }, [effectiveAnchor, brandReportWeeks]);
  const firstTime = isWeekly && (brandReportWeeks || []).length === 0 && !effectiveAnchor;
  async function createNext() {
    if (ro) return;
    setCreating(true);
    try { await onCreateWeek(brand.id); } finally { setCreating(false); }
  }
  // Weekly headers show a start–end range, so give those columns a touch more width.
  // One track per period: GMV only — ad spend is not shown in the creator matrix.
  const colW = isWeekly ? '92px' : '84px';
  const tpl = `160px 110px 88px ${periods.map(() => colW).join(' ')} 84px 96px`;

  // GMV is a sales figure — it can be zero but never negative. Clamped here, at
  // the one place every cell (monthly, weekly, L30) is written, so a pasted or
  // typed "-500" can't reach the jsonb whatever the input allows.
  const clean = (raw) => (raw === '' || raw == null ? undefined : Math.max(0, Number(raw) || 0));

  // ── monthly cell read/write (YYYY-MM keys on the jsonb root) ──
  function commitMonth(c, m, field, raw) {
    const num = clean(raw);
    const cur = c.monthly || {};
    const cell = { ...(cur[m] || {}) };
    if (num == null) delete cell[field]; else cell[field] = num;
    const next = { ...cur, [m]: cell };
    if (cell.gmv == null && cell.adSpent == null) delete next[m];
    onSaveMonthly(c.id, next);
  }
  // ── weekly cell read/write (nested under monthly.weeks, keyed by cadence week-start) ──
  function commitWeek(c, wk, field, raw) {
    const num = clean(raw);
    const cur = c.monthly || {};
    const wks = { ...(cur.weeks || {}) };
    const cell = { ...(wks[wk] || {}) };
    if (num == null) delete cell[field]; else cell[field] = num;
    if (cell.gmv == null && cell.adSpent == null) delete wks[wk]; else wks[wk] = cell;
    const next = { ...cur, weeks: wks };
    if (Object.keys(wks).length === 0) delete next.weeks;
    onSaveMonthly(c.id, next);
  }
  const readCell = (c, key, field) => isWeekly
    ? ((c.monthly || {}).weeks || {})[key]?.[field]
    : (c.monthly || {})[key]?.[field];
  const commitCell = (c, key, field, v) => isWeekly ? commitWeek(c, key, field, v) : commitMonth(c, key, field, v);
  // A period is locked (read-only) if it ends before the creator was onboarded —
  // i.e. only the onboarding period and everything after it is editable.
  const isLocked = (c, p) => {
    const onb = c.onboarded_on;
    if (!onb) return false;
    if (isWeekly) return (p.end || addDaysISO(p.key, 6)) < onb;  // whole week before onboarding
    return p.key < monthKey(onb);                                 // month before onboarding month
  };

  function commitL30(c, raw) {
    const num = clean(raw);
    const next = { ...(c.monthly || {}) };
    if (num == null) delete next.l30; else next.l30 = num;
    onSaveMonthly(c.id, next);
  }

  // Totals: monthly sums every month; weekly sums only the visible month's weeks.
  const weekKeys = periods.map(p => p.key);
  const sumFn = isWeekly
    ? (c, field) => { const w = (c.monthly || {}).weeks || {}; return weekKeys.reduce((t, k) => t + (Number(w[k]?.[field]) || 0), 0); }
    : (c, field) => sumMonthly(c, field);
  let grandGmv = 0, grandAd = 0;
  canon.forEach(c => { grandGmv += sumFn(c, 'gmv'); grandAd += sumFn(c, 'adSpent'); });
  const roas = grandAd > 0 ? (grandGmv / grandAd) : 0;
  // total videos a creator has made for THIS brand (delivered video_codes, across all their deals)
  const videosByName = {};
  creators.forEach(c => {
    const k = (c.name || '').trim().toLowerCase();
    const d = deliveredCount(c);
    videosByName[k] = (videosByName[k] || 0) + d;
  });
  const grandVideos = Object.values(videosByName).reduce((a, b) => a + b, 0);

  return (
    <>
      {onBack && <button className="pc-back" onClick={onBack}>‹ All brands</button>}
      <div className="pc-dd-head">
        <BrandAva name={brand.name} logo={brand.logo_url} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="pc-dd-title">{brand.name}</h2>
          <div className="pc-dd-sub">Performance · {canon.length} creator{canon.length === 1 ? '' : 's'}{isWeekly
            ? ` · ${monthLabel(month)} · ${periods.length} weekly report${periods.length === 1 ? '' : 's'}`
            : ` · ${periods.length} ${periodNoun}${periods.length === 1 ? '' : 's'} tracked`}</div>
        </div>
        <div className="pc-dd-actions">
          {monthNav}
          {!ro && isWeekly && nextWindow && (
            <button className="pc-btn pc-btn-primary pc-btn-sm" disabled={creating} onClick={createNext}
              title={`Create the next weekly report (${rangeLong(nextWindow.start, nextWindow.end)})`}>
              {creating ? 'Creating…' : `+ Week ${nextWindow.week_number} · ${rangeShort(nextWindow.start, nextWindow.end)}`}
            </button>
          )}
          <PerfModeToggle mode={mode} setMode={setMode} />
        </div>
      </div>
      {firstTime ? (
        ro
          ? <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">📅</div>
              <h3>No weekly reports for {brand.name}</h3>
              <p>Weekly performance columns mirror this brand's weekly reports.</p>
            </div></div>
          : <FirstReportPanel brand={brand} onCreate={(date) => onCreateWeek(brand.id, date)} />
      ) : weeklyEmpty ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">📅</div>
          <h3>No weekly reports for {monthLabel(month)}</h3>
          <p>Weekly performance columns mirror this brand's weekly reports.{!ro && nextWindow ? ` The next report is ${rangeLong(nextWindow.start, nextWindow.end)} — create it to start logging.` : ''}</p>
          {!ro && nextWindow && <button className="pc-btn pc-btn-primary" disabled={creating} onClick={createNext} style={{ marginTop: 6 }}>{creating ? 'Creating…' : `+ Create Week ${nextWindow.week_number} (${rangeShort(nextWindow.start, nextWindow.end)})`}</button>}
        </div></div>
      ) : canon.length === 0 ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">👤</div><h3>No creators for this brand</h3></div></div>
      ) : (
        <>
          <div className="pc-pf-stats">
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Total GMV for us</div><div className="pc-pf-stat-v pc-green">{fmt$(grandGmv)}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Total Ads Spent</div><div className="pc-pf-stat-v pc-red">{fmt$(grandAd)}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">ROAS</div><div className="pc-pf-stat-v">{roas ? roas.toFixed(2) + 'x' : '—'}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Total Videos</div><div className="pc-pf-stat-v">{grandVideos}</div></div>
          </div>
          <div className="pc-card">
            <div className="pc-matrix-wrap">
              <div className="pc-mx">
                <div className="pc-mx-head" style={{ gridTemplateColumns: tpl }}>
                  <div className="pc-mxh">Name</div>
                  <div className="pc-mxh">Username</div>
                  <div className="pc-mxh pc-mxh-c pc-mx-l30h">L30 GMV</div>
                  {periods.map(p => (
                    <div key={p.key} className="pc-mxh-month" title={p.title}>
                      <span className="pc-mxh-mname">{p.label}</span>
                      <span className="pc-mxh-sub pc-mxh-sub-1"><span>GMV</span></span>
                    </div>
                  ))}
                  <div className="pc-mxh pc-mxh-c">Total Videos</div>
                  <div className="pc-mxh pc-mxh-c pc-green">Total GMV for us</div>
                </div>
                {canon.map(c => {
                  const mm = c.monthly || {};
                  return (
                    <div className="pc-mx-row" key={c.id} style={{ gridTemplateColumns: tpl }}>
                      <div className="pc-mx-name" title={c.name}>{c.name}</div>
                      <div className="pc-mx-user">{tiktokAccounts(c.tiktok_handle)[0]?.handle || '—'}</div>
                      <MatrixCell value={mm.l30} l30 onCommit={v => commitL30(c, v)} />
                      {periods.map(p => (
                        <MatrixCell key={p.key} value={readCell(c, p.key, 'gmv')} locked={isLocked(c, p)}
                          onCommit={v => commitCell(c, p.key, 'gmv', v)} />
                      ))}
                      <div className="pc-mx-num strong">{videosByName[(c.name || '').trim().toLowerCase()] || 0}</div>
                      <div className="pc-mx-num strong pc-green">{fmt$(sumFn(c, 'gmv'))}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   Brand Performance pane — the Performance matrix for ONE brand, reused outside the
   handler workspace (Brand Detail → Paid Collab tab) so Bob / assigned APCs can view
   AND edit GMV (monthly or weekly) exactly like the handler does. It loads its own
   creators + weekly-report weeks/anchor for the brand and writes the `monthly` jsonb
   via store.setCreatorMonthly (a SECURITY DEFINER RPC → APCs can write too). Editing
   is gated by `canEdit`; the host only mounts this when the viewer may edit.
════════════════════════════════════════════════════════════ */
export function BrandPerformancePane({ brandId, brandName, brandLogo = null, canEdit = false, currency = null }: any) {
  const { user } = useAuth();
  const [creators, setCreators] = useState([]);
  const [month, setMonth] = useState(thisMonthKey());
  const [mode, setMode] = useState('weekly'); // 'monthly' | 'weekly'
  const [reportWeeks, setReportWeeks] = useState([]); // [{ start, end }]
  const [anchor, setAnchor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      // Three independent reads — in parallel, not one after another.
      const [{ data, error }, rw, an] = await Promise.all([
        supabase.from('handler_collab_creators').select('*').eq('brand_id', brandId),
        store.loadBrandReportWeeks([brandId]).catch(() => ({})),
        store.loadBrandReportAnchors([brandId]).catch(() => ({})),
      ]);
      if (error) throw error;
      // View-mode surface (Bob/APC/Team Lead/Ads Manager) — terminated deals stay
      // visible here (only the client-facing surfaces hide them).
      setCreators(data || []);
      setReportWeeks(rw[brandId] || []);
      setAnchor(an[brandId] || null);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load performance');
    } finally {
      setLoading(false);
    }
  }, [brandId]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  // Save a creator's monthly/weekly GMV map (optimistic, persist via the RPC).
  const saveMonthly = useCallback((id, monthly) => {
    if (!canEdit) return;
    setCreators(prev => prev.map(c => (c.id === id ? { ...c, monthly } : c)));
    store.setCreatorMonthly(id, monthly).catch(e => { alert(`Couldn't save: ${e.message}`); load(); });
  }, [canEdit, load]);

  // Create the next weekly report for this brand (mirrors the workspace flow). On the
  // very first report, firstAnchor seeds the brand's weekly anchor.
  const createWeek = useCallback(async (bId, firstAnchor) => {
    if (!user?.id) return;
    const existingArr = (reportWeeks || []).map(w => w.start);
    const existing = new Set(existingArr);
    let a = anchor || (existingArr.length ? existingArr.slice().sort()[0] : null) || firstAnchor || null;
    if (!a) { alert('Pick an anchor (week-1 start) date first.'); return; }
    if (firstAnchor && !anchor && existingArr.length === 0) {
      try { await store.setBrandWeeklyAnchor(bId, firstAnchor); }
      catch (e) { alert(`Couldn't set anchor: ${e.message}`); return; }
      setAnchor(firstAnchor); a = firstAnchor;
    }
    let start = a, wn = 1;
    while (existing.has(start)) { start = addDaysISO(start, 7); wn++; }
    const end = addDaysISO(start, 6);
    try { await store.createWeeklyReport(bId, user.id, start, end, wn); }
    catch (e) { alert(`Couldn't create weekly report: ${e.message}`); return; }
    await load();
    setMonth(start.slice(0, 7));
  }, [reportWeeks, anchor, user, load]);

  if (loading) return <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}><div className="pc-spinner" /></div>;

  // Only the weekly view is month-scoped (which weeks show); give it a compact month nav.
  const monthNav = mode === 'weekly' ? (
    <div className="pc-monthnav">
      <button className="pc-mn-arrow" aria-label="Previous month" onClick={() => setMonth(addMonth(month, -1))}>‹</button>
      <label className="pc-monthpicker" title="Pick a month">
        <MonthField value={month} onChange={v => { if (v) setMonth(v); }} />
      </label>
      <button className="pc-mn-arrow" aria-label="Next month" onClick={() => setMonth(addMonth(month, 1))}>›</button>
    </div>
  ) : null;

  return (
    <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}>
      {err && <div className="pc-banner" style={{ background: 'var(--pc-error-bg)', color: 'var(--pc-error-fg)' }}><span>⚠️</span><span>{err}</span></div>}
      <BrandMatrix
        brand={{ id: brandId, name: brandName, logo_url: brandLogo, currency }}
        creators={creators}
        mode={mode} setMode={setMode}
        month={month}
        brandReportWeeks={reportWeeks}
        brandAnchor={anchor}
        onCreateWeek={createWeek}
        onSaveMonthly={saveMonthly}
        monthNav={monthNav}
      />
    </div>
  );
}

// First-time weekly setup: the brand has no weekly reports/anchor yet. Pick week-1's
// start date → creates the first weekly report and seeds the brand's weekly anchor.
function FirstReportPanel({ brand, onCreate }) {
  const [d, setD] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() { if (!d) return; setBusy(true); try { await onCreate(d); } finally { setBusy(false); } }
  return (
    <div className="pc-card"><div className="pc-empty">
      <div className="pc-empty-icon">📅</div>
      <h3>No weekly reports yet</h3>
      <p>Pick the start date of <b>week 1</b> for <b>{brand.name}</b>. New weeks then auto-continue from here, and this date becomes the brand's weekly-report anchor.</p>
      <div className="pc-anchor-row">
        <DateField value={d} onChange={setD} />
        <button className="pc-btn pc-btn-primary" disabled={!d || busy} onClick={go}>{busy ? 'Creating…' : 'Create first weekly report'}</button>
      </div>
      {d && <div className="pc-anchor-hint">Week 1: <b>{rangeLong(d, addDaysISO(d, 6))}</b></div>}
    </div></div>
  );
}

function MatrixCell({ value, onCommit, ad, l30, locked }) {
  const ro = useRO();
  const [v, setV] = useState(value == null ? '' : String(value));
  // GMV can't go negative: drop a typed/pasted minus as it happens, so the field
  // never shows a value the commit would silently clamp anyway.
  const setClean = (raw) => setV(String(raw).replace(/-/g, ''));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  // Periods before the creator's onboarding are read-only — show the value (if any),
  // otherwise a muted lock, and never accept input.
  if (locked) {
    return (
      <div className={`pc-mx-input pc-mx-locked ${ad ? 'ad' : ''}`}
        title="Before this creator was onboarded" aria-disabled="true" onClick={e => e.stopPropagation()}>
        {value == null || value === '' ? (
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        ) : String(value)}
      </div>
    );
  }
  if (ro) {
    return (
      <div className={`pc-mx-input pc-mx-ro ${ad ? 'ad' : ''} ${l30 ? 'l30' : ''}`}
        title="View only" aria-disabled="true" onClick={e => e.stopPropagation()}>
        {value == null || value === '' ? '–' : String(value)}
      </div>
    );
  }
  return (
    <input className={`pc-mx-input ${ad ? 'ad' : ''} ${l30 ? 'l30' : ''}`} type="number" inputMode="numeric" placeholder="–"
      min="0" step="any" value={v}
      onChange={e => setClean(e.target.value)}
      onKeyDown={e => { if (e.key === '-') e.preventDefault(); }}
      onBlur={() => onCommit(v)} onClick={e => e.stopPropagation()} />
  );
}

// Shown only while a creator is "Payment Pending". Off (default) = the client/Bob
// read views mask the status as "Videos in Progress"; on = client sees "Payment Pending".
/* iconOnly drops the label and leans on the title tooltip — used where the
   toggle shares a table cell with the status pill and a second line of text
   would push the row taller. The title always carries the full wording, so
   nothing is lost, and aria-label keeps it readable without the text. */
function PendingVisibilityToggle({ c, onToggleVisible, iconOnly = false }) {
  const ro = useRO();
  if (c.payment_status !== 'pending' || !onToggleVisible) return null;
  const on = !!c.pending_visible_to_client;
  const label = on ? 'Visible to client' : 'Hidden from client';
  const cls = `pc-badge pc-visbtn ${on ? 'on' : ''} ${iconOnly ? 'icon' : ''}`;
  const text = iconOnly ? null : <span className="pc-visbtn-txt">{label}</span>;
  if (ro) return (
    <span className={cls} aria-label={iconOnly ? label : undefined}
      title={on ? 'Client can see “Payment Pending”.' : 'Hidden from the client.'}>
      <i className={`bi ${on ? 'bi-eye-fill' : 'bi-eye-slash'}`} />
      {text}
    </span>
  );
  return (
    <button
      type="button"
      className={cls}
      onClick={e => { e.stopPropagation(); onToggleVisible(c.id, !on); }}
      title={on
        ? 'Client can see “Payment Pending”. Click to hide it.'
        : 'Hidden from client. Click to show “Payment Pending”.'}
      aria-label={iconOnly ? label : undefined}
      aria-pressed={on}
    >
      <i className={`bi ${on ? 'bi-eye-fill' : 'bi-eye-slash'}`} />
      {text}
    </button>
  );
}

// Read-only chip shown once a share-link client has marked this creator's payment
// as done. Soft signal for the handler to cross-check, then set "Payment Sent".
function ClientPaidBadge({ c }) {
  if (!c.client_paid_confirmed_at || c.payment_status === 'paid') return null;
  const who = c.client_paid_confirmed_name ? ` by ${c.client_paid_confirmed_name}` : '';
  return (
    <span className="pc-badge pc-clientpaid" title={`Client marked this payment as done${who}. Cross-check, then set Payment Sent.`}>
      <i className="bi bi-cash-coin" />
      <span className="pc-clientpaid-txt">Client marked paid</span>
    </span>
  );
}

function StatusDropdown({ value, onChange }) {
  const ro = useRO();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const cur = deriveStatus({ payment_status: value });
  function toggle(e) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const menuW = Math.max(r.width, 184);
      // keep the portal menu inside the viewport (it would overflow off the right edge on mobile)
      const left = Math.max(10, Math.min(r.left, window.innerWidth - menuW - 10));
      const top = (r.bottom + 6 + 150 > window.innerHeight && r.top - 6 - 150 > 0) ? r.top - 6 : r.bottom + 6;
      setPos({ left, top, width: r.width, flip: top < r.top });
    }
    setOpen(o => !o);
  }
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { clearTimeout(t); document.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);
  if (ro) return <span className={`pc-badge ${cur.cls}`}><span className="dot" />{cur.label}</span>;
  return (
    <>
      <button ref={btnRef} className={`pc-badge ${cur.cls} pc-badge-btn`} onClick={toggle} title="Change status">
        <span className="dot" />{cur.label}<span className="pc-bcaret">▾</span>
      </button>
      {open && pos && createPortal(
        <div className="pc-statusmenu" style={{ left: pos.left, top: pos.top, minWidth: Math.max(pos.width, 184), transform: pos.flip ? 'translateY(-100%)' : 'none' }} onClick={e => e.stopPropagation()}>
          {STATUS_OPTIONS.map(s => (
            <button key={s.value} className={`pc-statusopt ${s.value === (value || DEFAULT_STATUS) ? 'active' : ''}`}
              onClick={() => { onChange(s.value); setOpen(false); }}>
              <span className={`pc-statusdot ${s.cls}`} />{s.label}
            </button>
          ))}
        </div>, document.body)}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   Creator expand — videos + ad codes
════════════════════════════════════════════════════════════ */
// `idx` is the creator's number in the list above (the `#1` on their row). Each
// video is numbered <creator>.<video> — 1.1, 1.2, … — so a link can be named
// out loud without repeating the creator. Null (no creator number in scope)
// falls back to the plain video number.
export function CreatorExpand({ c, idx = null, onEdit, onDelete, patchCreatorLocal, findCodeOwner = null }) {
  const ro = useRO();
  const committed = parseInt(c.videos_count, 10) || 0;
  // The client's star rating is READ-ONLY here and the column only appears once
  // something is actually rated — this row already carries seven, and an empty
  // eighth would cost width on every deal to say nothing.
  const anyRated = (Array.isArray(c.video_codes) ? c.video_codes : []).some(v => Number(v?.rating) > 0);
  // NOTE: invalid / invalidAt / invalidBy must be carried through — this array is
  // written back wholesale, so a dropped key erases staff's "invalid ad code"
  // report (set via the set_handler_creator_video_invalid RPC).
  // ‼️ The same goes for rating / ratedAt / ratedBy (20260870090000): the CLIENT
  // writes those from the share link, and this editor cannot see that happen.
  // Leave them out and the next ad-code keystroke silently deletes the client's
  // score. Any key a NON-handler writer owns has to be listed here.
  const codeRow = (r) => ({
    video: r?.video || '', adCode: r?.adCode || '', auth: !!r?.auth,
    // videoAt is the DB's (trigger 20260860090000 ignores whatever we send), but
    // it is carried anyway so the date stays on screen between the optimistic
    // local patch and the next refetch instead of blinking to "—".
    ...(r?.videoAt ? { videoAt: r.videoAt } : {}),
    ...(r?.invalid ? { invalid: true, invalidAt: r.invalidAt, invalidBy: r.invalidBy } : {}),
    ...(r?.best ? { best: true, bestAt: r.bestAt, bestBy: r.bestBy } : {}),
    ...(Number(r?.rating) > 0 ? { rating: Number(r.rating), ratedAt: r.ratedAt, ratedBy: r.ratedBy } : {}),
    // The Ads Manager's "tested" verdict (20261009090000) — theirs, not ours.
    ...(r?.tested ? { tested: true, testedAt: r.testedAt, testedBy: r.testedBy } : {}),
    // An EXTRA video — made by the creator beyond the deal, recorded only.
    ...(r?.extra ? { extra: true } : {}),
    // The creator's DRAFTS of this video, reviewed by the handler before it is
    // posted (videoDrafts.ts). Never on an extra, and never in `video`.
    ...(!r?.extra && Array.isArray(r?.drafts) && r.drafts.length ? { drafts: normalizeDrafts(r.drafts) } : {}),
  });
  // One array, DEAL rows first (padded to the agreed count) then the EXTRA
  // rows. Kept in one array so every per-row verdict (auth / invalid / best /
  // rating, all index-based) works on an extra exactly as on a deal video.
  const buildRows = (raw) => {
    const deal = dealCodes(raw), extra = extraCodes(raw);
    const n = Math.max(committed || 1, deal.length, 1);
    return [...Array.from({ length: n }, (_, i) => codeRow(deal[i])), ...extra.map(codeRow)];
  };
  const [codes, setCodes] = useState(() => buildRows(c.video_codes));
  const [saveState, setSaveState] = useState('idle');
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const debounce = useRef(null);
  const latest = useRef(codes);
  const dirty = useRef(false);
  const saving = useRef(false);
  // Unmount used to just drop the pending debounce. That was survivable while
  // this was an accordion; as a popup it closes three easy ways the row never
  // sees (the X, Escape, a backdrop click), so the last ~700ms of typing has to
  // be written out instead of silently discarded. pendingFlush is re-pointed
  // every render because persist() closes over the current props.
  const pendingFlush = useRef(null);
  useEffect(() => () => {
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    if (dirty.current) pendingFlush.current?.();
  }, []);

  // Re-sync from the source row when it changes underneath us (reload / external edit),
  // but never while the user has unsaved edits or a save is in flight.
  useEffect(() => {
    if (dirty.current || saving.current) return;
    const synced = buildRows(c.video_codes);
    setCodes(synced);
    latest.current = synced;
  }, [c.video_codes]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next) {
    if (ro) return;                    // view-only: never writes
    // A duplicate video link / ad code is never written. `dirty` stays true so the
    // typed value survives (and the re-sync effect can't wipe it) while it's fixed.
    if (hasVideoDup(videoDupMessages(next, c.id, findCodeOwner))) { setSaveState('idle'); return; }
    dirty.current = false;
    saving.current = true;
    setSaveState('saving');
    const patch = { video_codes: next };
    // once every DEAL video row has a URL: stamp completed-on date + advance Videos in Progress / Follow-up → Payment Pending.
    // Extra videos are outside the deal and never complete it.
    const dealRows = next.filter(r => !r.extra);
    const allFilled = dealRows.length > 0 && dealRows.every(r => (r.video || '').trim());
    if (allFilled) {
      if (c.payment_status === 'videos_in_progress' || c.payment_status === 'follow_up') patch.payment_status = 'pending';
      if (!c.completed_on) patch.completed_on = todayISO();
    }
    patchCreatorLocal(c.id, patch);
    try {
      await store.updateCreator(c.id, patch);
      // Again once it has COMMITTED: a refresh that read the row mid-write must
      // not land afterwards and put the old links back (see loadRef.writeGen).
      // Skipped when newer edits exist — their own save does this.
      if (latest.current === next) patchCreatorLocal(c.id, patch);
      saving.current = false; setSaveState('saved'); setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1800); }
    catch (e) { saving.current = false; setSaveState('idle'); alert(`Couldn't save: ${e.message}`); }
  }
  function change(idx, field, value) {
    if (ro) return;
    dirty.current = true;
    setCodes(prev => {
      const next = prev.map((row, i) => {
        if (i !== idx) return row;
        const patched = { ...row, [field]: value };
        // Replacing the ad code staff reported as invalid answers the request —
        // clear the flag so the row goes back to plain "awaiting authorisation".
        if (field === 'adCode' && row.invalid) {
          delete patched.invalid; delete patched.invalidAt; delete patched.invalidBy;
        }
        // A NEW ad code has not been tested — the Ads Manager's tick was about
        // the old one.
        if (field === 'adCode' && row.tested && String(value).trim() !== String(row.adCode || '').trim()) {
          delete patched.tested; delete patched.testedAt; delete patched.testedBy;
        }
        return patched;
      });
      latest.current = next;
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => persist(next), 700);
      return next;
    });
  }
  // Extra videos: added / removed as whole rows, written at once.
  function addExtra() {
    if (ro || dupCount > 0) return;
    dirty.current = true;
    setCodes(prev => {
      const next = [...prev, { video: '', adCode: '', auth: false, extra: true }];
      latest.current = next;
      return next;
    });
  }
  function removeExtra(idx) {
    if (ro) return;
    const row = latest.current[idx] || codes[idx];
    if (!row?.extra) return;
    if ((row.video || row.adCode) && !window.confirm('Remove this extra video?')) return;
    dirty.current = true;
    setCodes(prev => {
      const next = prev.filter((_, i) => i !== idx);
      latest.current = next;
      if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
      persist(next);
      return next;
    });
  }
  function flush() { if (!dirty.current) return; if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; } persist(latest.current); }
  pendingFlush.current = flush;
  // ad-code authorization toggle (manual) — persists immediately, no debounce.
  // Refused while a duplicate is showing: the whole array is written at once, so a
  // flip that can't be saved would silently revert on the next reload.
  function toggleAuth(idx) {
    if (ro || dupCount > 0) return;
    dirty.current = true;
    setCodes(prev => {
      const next = prev.map((row, i) => (i === idx ? { ...row, auth: !row.auth } : row));
      latest.current = next;
      if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
      persist(next);
      return next;
    });
  }
  // "Invalid ad code" verdict — the same flag staff set from the Brand Detail
  // Authorization queue, editable here so the handler can flag one themselves or
  // clear a report once the creator sends a working code. Deliberately written
  // through persist() (the plain array write) rather than the RPC: the RPC's job
  // is to notify the brand's handler(s), and that's this user — no self-pings,
  // and no race with the debounced array write this editor already owns.
  function toggleInvalid(idx) {
    if (ro || dupCount > 0) return;
    dirty.current = true;
    setCodes(prev => {
      const next = prev.map((row, i) => {
        if (i !== idx) return row;
        if (row.invalid) {
          const cleared = { ...row };
          delete cleared.invalid; delete cleared.invalidAt; delete cleared.invalidBy;
          return cleared;
        }
        // An invalid code is by definition not authorised (mirrors the RPC).
        return { ...row, invalid: true, auth: false, invalidAt: new Date().toISOString() };
      });
      latest.current = next;
      if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
      persist(next);
      return next;
    });
  }

  // ── Drafts ────────────────────────────────────────────────────────────
  // A draft is written onto its slot's row and the whole array goes out at
  // once through persist(), like toggleAuth. Computed from latest.current
  // rather than inside a state updater, so a write is never issued twice.
  const { profile: me, user: meUser } = useAuth();
  const myName = me?.full_name || me?.email || meUser?.email || '';
  const [openDrafts, setOpenDrafts] = useState(() => new Set());
  const [draftInput, setDraftInput] = useState({});
  const [draftCodeInput, setDraftCodeInput] = useState({});
  const [rejecting, setRejecting] = useState(null); // { idx, n, reason }
  // Approve / reject both ask first: { idx, n, status, reason, label, url }.
  const [confirmDraft, setConfirmDraft] = useState(null);
  function confirmDecision() {
    const cd = confirmDraft;
    if (!cd) return;
    setConfirmDraft(null);
    if (decideDraft(cd.idx, cd.n, cd.status, cd.reason || '') && cd.status === 'rejected') setRejecting(null);
  }
  const toggleDrafts = (i) => setOpenDrafts(prev => {
    const s = new Set(prev);
    if (s.has(i)) s.delete(i); else s.add(i);
    return s;
  });
  function writeDrafts(idx, mutate) {
    if (ro || dupCount > 0) return false;
    const base = latest.current;
    const row = base[idx];
    if (!row || row.extra) return false;
    const drafts = mutate(normalizeDrafts(row.drafts));
    const nextRow = { ...row };
    if (drafts.length) nextRow.drafts = drafts.map((d, k) => ({ ...d, n: k + 1 }));
    else delete nextRow.drafts;
    const next = base.map((r, i) => (i === idx ? nextRow : r));
    dirty.current = true;
    latest.current = next;
    setCodes(next);
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    persist(next);
    return true;
  }
  function addDraft(idx) {
    const url = String(draftInput[idx] || '').trim();
    if (!isValidUrl(url)) { alert('Paste the full draft link (starting with https://).'); return; }
    const row = latest.current[idx];
    if (!canAddDraft(normalizeDrafts(row?.drafts), row?.video)) return;
    const adCode = String(draftCodeInput[idx] || '').trim();
    const ok = writeDrafts(idx, ds => [...ds, { n: ds.length + 1, url, ...(adCode ? { adCode } : {}), status: 'review', at: new Date().toISOString() }]);
    if (ok) {
      setDraftInput(m => ({ ...m, [idx]: '' }));
      setDraftCodeInput(m => ({ ...m, [idx]: '' }));
      toast('Draft added — under review');
    }
  }
  // Add / change / clear a draft's ad code after it was submitted — the code
  // usually arrives later than the draft link.
  function setDraftAdCode(idx, n) {
    const d = normalizeDrafts(latest.current[idx]?.drafts).find(x => x.n === n);
    if (!d) return;
    const v = window.prompt(`Ad code for draft D${n} (leave empty to remove):`, d.adCode || '');
    if (v === null) return;
    const code = v.trim();
    writeDrafts(idx, ds => ds.map(x => {
      if (x.n !== n) return x;
      const out = { ...x };
      if (code) out.adCode = code; else delete out.adCode;
      return out;
    }));
  }
  function removeDraft(idx, n) {
    const d = normalizeDrafts(latest.current[idx]?.drafts).find(x => x.n === n);
    if (!d || d.status !== 'review') return;
    if (!window.confirm(`Remove draft D${n}? Only do this if the link was added by mistake.`)) return;
    writeDrafts(idx, ds => ds.filter(x => x.n !== n));
  }
  function decideDraft(idx, n, status, reason = '') {
    const stamp = { reviewedAt: new Date().toISOString(), ...(myName ? { reviewedBy: myName } : {}) };
    const ok = writeDrafts(idx, ds => ds.map(x => {
      if (x.n !== n || x.status !== 'review') return x;
      const out = { ...x, status, ...stamp };
      if (status === 'rejected') out.reason = String(reason).trim(); else delete out.reason;
      return out;
    }));
    if (ok) toast(status === 'approved' ? 'Draft approved' : 'Draft rejected');
    return ok;
  }
  function reopenDraft(idx, n) {
    // A decision taken by mistake goes back to "under review" — only the
    // newest draft, and only while the video is not posted yet.
    const row = latest.current[idx];
    const ds = normalizeDrafts(row?.drafts);
    if (String(row?.video || '').trim() || latestDraft(ds)?.n !== n) return;
    writeDrafts(idx, list => list.map(x => {
      if (x.n !== n) return x;
      const out = { ...x, status: 'review' };
      delete out.reason; delete out.reviewedAt; delete out.reviewedBy;
      return out;
    }));
  }
  // The approved draft IS the live post (it was uploaded straight to TikTok):
  // copy its link into the slot's Video field and write it now. persist()
  // then applies the usual "every deal video posted → Payment Pending" rule.
  // The draft's ad code comes along only when the slot has none yet.
  function postDraftLink(idx, url, adCode = '') {
    if (ro || dupCount > 0) return;
    const base = latest.current;
    if (!base[idx] || String(base[idx].video || '').trim()) return;
    const code = String(adCode || '').trim();
    const next = base.map((r, i) => {
      if (i !== idx) return r;
      const out = { ...r, video: url };
      if (code && !String(r.adCode || '').trim()) out.adCode = code;
      return out;
    });
    dirty.current = true;
    latest.current = next;
    setCodes(next);
    if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
    persist(next);
  }

  // Star / unstar a video for the Best Videos board. Goes through the RPC (it
  // stamps who starred it and when), then patches local state so the next
  // whole-array save can't drop the flag.
  const bump = useBestBump();
  const [bestBusy, setBestBusy] = useState(-1);
  async function toggleBest(idx) {
    if (ro || bestBusy >= 0) return;
    const row = latest.current[idx] || codes[idx];
    const next = !row?.best;
    if (next && !isValidUrl(row?.video)) { alert('Add the video link first — a best video needs something to open.'); return; }
    setBestBusy(idx);
    try {
      await store.setCreatorVideoBest(c.id, idx, next);
      setCodes(prev => {
        const out = prev.map((r, i) => {
          if (i !== idx) return r;
          if (!next) { const cl = { ...r }; delete cl.best; delete cl.bestAt; delete cl.bestBy; return cl; }
          return { ...r, best: true, bestAt: new Date().toISOString() };
        });
        latest.current = out;
        patchCreatorLocal(c.id, { video_codes: out });
        return out;
      });
      bump();
      toast(next ? 'Added to Best Videos' : 'Removed from Best Videos');
    } catch (e) {
      alert(`Couldn't update: ${e.message}`);
    } finally { setBestBusy(-1); }
  }

  const dupMsgs = useMemo(() => videoDupMessages(codes, c.id, findCodeOwner), [codes, c.id, findCodeOwner]);
  const dupCount = dupMsgs.filter(m => m.video || m.adCode).length;
  const dupKind = dupMsgs.some(m => m.video) && dupMsgs.some(m => m.adCode) ? 'video link and ad code'
    : dupMsgs.some(m => m.video) ? 'video link' : 'ad code';

  // The ring is the DEAL's progress — extras are shown separately and never count.
  const dealView = codes.filter(v => !v.extra);
  const filledCount = dealView.filter(v => isValidUrl(v.video)).length;
  const total = dealView.length;
  const extraIdx = codes.map((v, i) => (v.extra ? i : -1)).filter(i => i >= 0);
  const extraFilled = extraIdx.filter(i => isValidUrl(codes[i].video)).length;
  const pct = total ? filledCount / total : 0;
  const complete = total > 0 && filledCount === total;
  const adCount = codes.filter(v => (v.adCode || '').trim()).length;
  const authCount = codes.filter(v => v.auth).length;
  const allAuth = adCount > 0 && authCount === adCount;
  const initials = (c.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  const accounts = tiktokAccounts(c.tiktok_handle);
  const prodList = creatorProducts(c);
  const payouts = creatorPayouts(c);
  const RING = 2 * Math.PI * 19; // ring circumference (r = 19)
  function copyCode(i, code) { copyText(code); setCopiedIdx(i); setTimeout(() => setCopiedIdx(x => (x === i ? -1 : x)), 1400); }
  // "1.2" = creator #1's second video. Without a creator number in scope it is
  // just the video's own position, exactly as before.
  const videoNo = i => (idx == null ? String(i + 1) : `${idx}.${i + 1}`);
  // Extras are numbered on their own ("E1", "1.E1") so they never read as deal videos.
  const extraNo = n => (idx == null ? `E${n}` : `${idx}.E${n}`);
  const ratedTitle = (r) => {
    const n = Number(r?.rating) || 0;
    const who = (r?.ratedBy || '').trim();
    const when = r?.ratedAt ? new Date(r.ratedAt).toLocaleDateString() : '';
    return `Client rated this ${n}/5` + (who ? ` — ${who}` : '') + (when ? ` · ${when}` : '');
  };
  // The frame is CreatorPanelShell's — this renders the panel body only, so the
  // same markup can be dropped into a dialog or (were it ever wanted again) an
  // inline .pc-expand without knowing which.
  return (
    <div className={`pc-vx ${idx == null ? '' : 'pc-vx-numbered'}`} onClick={e => e.stopPropagation()}>
        {confirmDraft && (
          <DraftDecisionConfirm action={confirmDraft.status} label={confirmDraft.label} url={confirmDraft.url}
            reason={confirmDraft.reason} creator={c.name}
            onYes={confirmDecision} onCancel={() => setConfirmDraft(null)} />
        )}
        <div className="pc-vx-head">
          <div className="pc-vx-title">
            <span className="pc-vx-mono">{initials}</span>
            <div className="pc-vx-titletext">
              <div className="pc-vx-h">Videos &amp; Ad Codes</div>
              <div className="pc-vx-sub">{c.name}{accounts[0] ? <> · <span className="pc-vx-sub-h">{accounts[0].handle}</span></> : ''}</div>
            </div>
          </div>
          <div className="pc-vx-actions">
            <span className={`pc-savestate ${saveState === 'saved' ? 'saved' : ''}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : ''}</span>
            {adCount > 0 && (
              <span className={`pc-vx-authtally ${allAuth ? 'done' : ''}`} title="Ad codes authorised">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                {authCount}/{adCount} authorised
              </span>
            )}
            <div className={`pc-vx-ring ${complete ? 'full' : ''}`} role="img" aria-label={`${filledCount} of ${total} videos added`}>
              <svg viewBox="0 0 46 46" width="48" height="48">
                <circle className="pc-vx-ring-track" cx="23" cy="23" r="19" />
                <circle className="pc-vx-ring-fill" cx="23" cy="23" r="19" strokeDasharray={RING} strokeDashoffset={RING * (1 - pct)} transform="rotate(-90 23 23)" />
              </svg>
              <span className="pc-vx-ring-txt"><b>{filledCount}</b><i>/{total}</i></span>
            </div>
            {!ro && <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={onEdit}>Edit</button>}
            {!ro && <button className="pc-link-danger" onClick={onDelete}>Delete</button>}
          </div>
        </div>
        {prodList.length > 0 && (
          <div className="pc-vx-prods">
            <span className="pc-vx-prods-l">Promoting</span>
            {prodList.map((p, i) => (p.url
              ? <a key={i} className="pc-vx-prod" href={p.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={p.url}><span className="pc-vx-prod-dot" />{p.name || 'Product'}<span className="pc-vx-prod-go">↗</span></a>
              : <span key={i} className="pc-vx-prod" title={p.name}><span className="pc-vx-prod-dot" />{p.name}</span>))}
          </div>
        )}
        {payouts.length > 0 && (
          <div className="pc-vx-payouts">
            {payouts.map((p, i) => <PayoutDetail key={i} label={p.label} value={p.value} />)}
          </div>
        )}
        {dupCount > 0 && (
          <div className="pc-inline-err pc-vx-duperr">
            Duplicate {dupKind} on {dupCount === 1 ? 'a row' : `${dupCount} rows`} — see the rows marked in red.
            Nothing on {c.name || 'this creator'} is saved until every video link and ad code is unique.
          </div>
        )}
        <div className={`pc-vx-collabels ${anyRated ? 'pc-vx-8' : 'pc-vx-7'}`}>
          <span className="pc-vx-cl-no">{idx == null ? '' : 'No.'}</span>
          <span>Video</span>
          <span>Ad code</span>
          {anyRated && <span className="pc-vx-cl-rate" title="The client's score out of five">Rated</span>}
          <span className="pc-vx-cl-auth">Authorised</span>
          <span className="pc-vx-cl-auth">Invalid</span>
          <span className="pc-vx-cl-added">Added</span>
          <span />
        </div>
        {(() => {
          const renderDrafts = (row, i, no, drafts, dState, open) => {
            const posted = !!String(row.video || '').trim();
            const last = latestDraft(drafts);
            const addable = !ro && canAddDraft(drafts, row.video);
            const headText = posted
              ? 'Posted'
              : dState === 'review' ? 'Video under review'
              : dState === 'approved' ? 'Draft approved — waiting for the live link'
              : dState === 'rejected' ? `${draftLabel(no, last.n)} rejected — waiting for the next draft`
              : 'Drafts';
            const headCls = posted ? 'posted' : dState || 'none';
            const dateOf = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
            const rej = rejecting && rejecting.idx === i ? rejecting : null;
            return (
              <div className={`pc-vx-drafts is-${headCls}`}>
                <button type="button" className="pc-vx-drafthead" aria-expanded={open} onClick={() => toggleDrafts(i)}>
                  <i className={`bi ${posted ? 'bi-check2-all' : dState ? DRAFT_STATUS_META[dState].icon : 'bi-camera-reels'}`} />
                  <b>{headText}</b>
                  {last && !posted && <span className="pc-vx-draftref">{draftLabel(no, last.n)}</span>}
                  {drafts.length > 0 && <span className="pc-vx-draftcount">{drafts.length} draft{drafts.length > 1 ? 's' : ''}</span>}
                  <i className={`bi bi-chevron-down pc-vx-draftchev ${open ? 'open' : ''}`} />
                </button>
                {open && (
                  <div className="pc-vx-draftbody">
                    {drafts.length > 0 && (
                      <ol className="pc-vx-draftlist">
                        {drafts.map(d => {
                          const meta = DRAFT_STATUS_META[d.status];
                          const isLast = last && d.n === last.n;
                          return (
                            <li key={d.n} className={`pc-vx-draft is-${d.status}`}>
                              <div className="pc-vx-draftrow">
                                <span className="pc-vx-draftno" title={`Draft ${d.n} of video ${no}`}>{draftLabel(no, d.n)}</span>
                                <a className="pc-vx-draftlink" href={d.url} target="_blank" rel="noopener noreferrer" title={d.url}>
                                  <span>{d.url}</span><i className="bi bi-box-arrow-up-right" />
                                </a>
                                {d.adCode ? (
                                  <span className="pc-vx-draftcode" title={`Ad code: ${d.adCode}`}>
                                    <i className="bi bi-hash" /><span>{d.adCode}</span>
                                    <button type="button" title="Copy ad code" aria-label="Copy ad code"
                                      onClick={() => { copyText(d.adCode); toast('Ad code copied'); }}><i className="bi bi-clipboard" /></button>
                                    {!ro && !posted && (
                                      <button type="button" title="Change ad code" aria-label="Change ad code" disabled={dupCount > 0}
                                        onClick={() => setDraftAdCode(i, d.n)}><i className="bi bi-pencil" /></button>
                                    )}
                                  </span>
                                ) : (!ro && !posted && (
                                  <button type="button" className="pc-vx-draftcodeadd" disabled={dupCount > 0}
                                    title="Add this draft's ad code" onClick={() => setDraftAdCode(i, d.n)}>
                                    <i className="bi bi-plus" />Ad code
                                  </button>
                                ))}
                                <span className={`pc-vx-draftstatus ${meta.cls}`}><i className={`bi ${meta.icon}`} />{meta.label}</span>
                                <span className="pc-vx-draftdate" title={d.at ? new Date(d.at).toLocaleString() : ''}>{dateOf(d.at)}</span>
                                <span className="pc-vx-draftacts">
                                  {!ro && d.status === 'review' && !rej && (
                                    <>
                                      <button type="button" className="pc-vx-draftact ok" onClick={() => setConfirmDraft({ idx: i, n: d.n, status: 'approved', label: draftLabel(no, d.n), url: d.url })} disabled={dupCount > 0}>
                                        <i className="bi bi-check-lg" />Approve
                                      </button>
                                      <button type="button" className="pc-vx-draftact no" onClick={() => setRejecting({ idx: i, n: d.n, reason: '' })} disabled={dupCount > 0}>
                                        <i className="bi bi-x-lg" />Reject
                                      </button>
                                      <button type="button" className="pc-vx-draftact rm" title="Remove — added by mistake" aria-label="Remove draft" onClick={() => removeDraft(i, d.n)} disabled={dupCount > 0}>
                                        <i className="bi bi-trash3" />
                                      </button>
                                    </>
                                  )}
                                  {d.status === 'rejected' && (
                                    <button type="button" className="pc-vx-draftact" onClick={() => { copyText(draftRejectMessage(c.name, no, d.n, d.reason || '')); toast('Message copied'); }}>
                                      <i className="bi bi-clipboard" />Copy message
                                    </button>
                                  )}
                                  {d.status === 'approved' && (
                                    <>
                                      <button type="button" className="pc-vx-draftact" onClick={() => { copyText(draftApproveMessage(c.name, no)); toast('Message copied'); }}>
                                        <i className="bi bi-clipboard" />Copy message
                                      </button>
                                      {!ro && !posted && (
                                        <button type="button" className="pc-vx-draftact ok" disabled={dupCount > 0}
                                          title={d.adCode ? "Use this draft's link (and ad code, if the slot has none) as the posted video" : "Use this draft's link as the posted video"}
                                          onClick={() => postDraftLink(i, d.url, d.adCode)}>
                                          <i className="bi bi-arrow-up-circle" />Use as posted link
                                        </button>
                                      )}
                                    </>
                                  )}
                                  {!ro && isLast && !posted && d.status !== 'review' && (
                                    <button type="button" className="pc-vx-draftact rm" title="Undo the decision — back to under review" aria-label="Undo decision"
                                      onClick={() => reopenDraft(i, d.n)} disabled={dupCount > 0}>
                                      <i className="bi bi-arrow-counterclockwise" />
                                    </button>
                                  )}
                                </span>
                              </div>
                              {d.status === 'rejected' && d.reason && (
                                <div className="pc-vx-draftreason"><i className="bi bi-chat-left-quote" /><span>{d.reason}</span></div>
                              )}
                              {d.status !== 'review' && (d.reviewedBy || d.reviewedAt) && (
                                <div className="pc-vx-draftwho">
                                  {d.status === 'approved' ? 'Approved' : 'Rejected'}
                                  {d.reviewedBy ? ` by ${d.reviewedBy}` : ''}{d.reviewedAt ? ` · ${dateOf(d.reviewedAt)}` : ''}
                                </div>
                              )}
                              {rej && rej.n === d.n && (
                                <div className="pc-vx-draftreject">
                                  <textarea className="pc-input pc-textarea" rows={3} autoFocus
                                    placeholder="Why is this draft rejected? This goes to the creator."
                                    value={rej.reason}
                                    onChange={e => setRejecting({ ...rej, reason: e.target.value })} />
                                  <div className="pc-vx-draftreject-acts">
                                    <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setRejecting(null)}>Cancel</button>
                                    <button type="button" className="pc-btn pc-btn-sm pc-btn-danger-solid"
                                      disabled={!rej.reason.trim() || dupCount > 0}
                                      title={rej.reason.trim() ? '' : 'Add the reason first'}
                                      onClick={() => setConfirmDraft({ idx: i, n: d.n, status: 'rejected', reason: rej.reason.trim(), label: draftLabel(no, d.n), url: d.url })}>
                                      Reject draft
                                    </button>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    )}
                    {addable && (
                      <form className="pc-vx-draftadd" onSubmit={e => { e.preventDefault(); addDraft(i); }}>
                        <span className="pc-vx-draftno next">{draftLabel(no, drafts.length + 1)}</span>
                        <label className="pc-vx-draftfield link">
                          <i className="bi bi-link-45deg" aria-hidden="true" />
                          <input className="pc-input" placeholder="Paste the draft video link (TikTok, Drive…)" aria-label="Draft video link"
                            value={draftInput[i] || ''} onChange={e => setDraftInput(m => ({ ...m, [i]: e.target.value }))} />
                        </label>
                        <label className="pc-vx-draftfield code">
                          <i className="bi bi-hash" aria-hidden="true" />
                          <input className="pc-input" placeholder="Ad code (optional)" aria-label="Ad code (optional)"
                            value={draftCodeInput[i] || ''} onChange={e => setDraftCodeInput(m => ({ ...m, [i]: e.target.value }))} />
                        </label>
                        <button type="submit" className="pc-btn pc-btn-primary pc-btn-sm pc-vx-draftsubmit" disabled={!String(draftInput[i] || '').trim() || dupCount > 0}>
                          <i className="bi bi-send" />Submit for review
                        </button>
                      </form>
                    )}
                    {!addable && !ro && !posted && last?.status === 'review' && (
                      <div className="pc-vx-drafthint">Approve or reject {draftLabel(no, last.n)} before adding the next draft.</div>
                    )}
                    {posted && <div className="pc-vx-drafthint">This video is posted — its drafts are kept as history.</div>}
                  </div>
                )}
              </div>
            );
          };
          const renderRow = (row, i) => {
            const isExtra = !!row.extra;
            const no = isExtra ? extraNo(extraIdx.indexOf(i) + 1) : videoNo(i);
            const vOk = isValidUrl(row.video);
            const dup = dupMsgs[i] || { video: '', adCode: '' };
            // Staff reported this ad code as not working — clears itself as soon
            // as a new code is typed into the field (see change()).
            const bad = !!row.invalid;
            // Drafts: deal rows only. The block shows whenever the slot HAS
            // drafts (so "under review" is visible without a click) or the
            // handler opened it to add the first one.
            const drafts = isExtra ? [] : normalizeDrafts(row.drafts);
            const dState = isExtra ? null : slotDraftState(row);
            const draftsOpen = openDrafts.has(i);
            return (
              <div className="pc-vx-rowwrap" key={i}>
              <div className={`pc-vx-row ${anyRated ? 'pc-vx-8' : 'pc-vx-7'} ${vOk && !dup.video && !bad ? 'done' : ''} ${bad ? 'pc-vx-row-bad' : ''}`}>
                <span className={`pc-vx-num ${isExtra ? 'pc-vx-num-extra' : ''}`} title={isExtra ? `Extra video ${no} — recorded only, not part of the deal` : `Video ${no}`}>{no}</span>
                <label className={`pc-vx-inp ${(row.video && !vOk) || dup.video ? 'bad' : ''}`} title={dup.video || undefined}>
                  <span className="pc-vx-inp-ico"><svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M8 5v14l11-7z" /></svg></span>
                  <input placeholder={ro ? '—' : 'Paste TikTok video URL'} value={row.video} readOnly={ro}
                    onChange={e => change(i, 'video', e.target.value)} onBlur={flush} />
                  {!ro && (
                    <button type="button" className={`pc-vx-best ${row.best ? 'on' : ''}`}
                      disabled={bestBusy === i}
                      title={row.best ? 'One of the best videos — click to remove' : 'Mark as one of the best videos'}
                      aria-pressed={!!row.best}
                      onClick={e => { e.preventDefault(); toggleBest(i); }}>
                      <i className={`bi ${row.best ? 'bi-star-fill' : 'bi-star'}`} />
                    </button>
                  )}
                  {!isExtra && (!ro || drafts.length > 0) && (
                    <button type="button" className={`pc-vx-draftbtn ${dState ? `is-${dState}` : ''} ${draftsOpen ? 'open' : ''}`}
                      title={drafts.length ? `${drafts.length} draft${drafts.length > 1 ? 's' : ''} — show` : 'Add a draft for review'}
                      aria-expanded={draftsOpen}
                      onClick={e => { e.preventDefault(); toggleDrafts(i); }}>
                      <i className="bi bi-camera-reels" />
                      {drafts.length > 0 && <span className="pc-vx-draftbtn-n">{drafts.length}</span>}
                    </button>
                  )}
                  {!ro && isExtra && (
                    <button type="button" className="pc-vx-rm" title="Remove this extra video"
                      onClick={e => { e.preventDefault(); removeExtra(i); }}>
                      <i className="bi bi-trash3" />
                    </button>
                  )}
                </label>
                <label className={`pc-vx-inp pc-vx-inp-ad ${(row.adCode && !isValidAdCode(row.adCode)) || dup.adCode ? 'bad' : ''}`} title={dup.adCode || undefined}>
                  <span className="pc-vx-inp-ico">#</span>
                  <input placeholder={ro ? '—' : 'ad code'} value={row.adCode} readOnly={ro}
                    onChange={e => change(i, 'adCode', e.target.value)} onBlur={flush} />
                  {row.adCode ? (
                    <button type="button" className={`pc-vx-copy ${copiedIdx === i ? 'ok' : ''}`} title="Copy ad code" onClick={e => { e.preventDefault(); copyCode(i, row.adCode); }}>
                      {copiedIdx === i
                        ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                    </button>
                  ) : null}
                </label>
                {anyRated && (
                  /* The CLIENT's score, read-only. Compact "star N" rather than
                     five stars: this row already carries seven columns, and the
                     interactive five-star control belongs on the client's own
                     surfaces (see VideoStars in handlerCollabReadonly). */
                  Number(row.rating) > 0
                    ? <span className="pc-vx-rated" title={ratedTitle(row)}>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
                        {Number(row.rating)}
                      </span>
                    : <span className="pc-vx-rated none" title="Not rated by the client yet">—</span>
                )}
                <button type="button" className={`pc-vx-auth ${row.auth ? 'on' : ''}`} role="checkbox" aria-checked={row.auth} disabled={ro || dupCount > 0 || bad}
                  title={ro ? (row.auth ? 'Authorised' : 'Not authorised') : dupCount > 0 ? 'Fix the duplicate first' : bad ? 'Marked invalid — clear that first' : row.auth ? 'Ad code authorised — click to unmark' : 'Mark ad code authorised'} onClick={() => toggleAuth(i)}>
                  {row.auth && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </button>
                <button type="button" className={`pc-vx-auth pc-vx-bad ${bad ? 'on' : ''}`} role="checkbox" aria-checked={bad} disabled={ro || dupCount > 0}
                  title={ro ? (bad ? 'Reported invalid' : 'Ad code not flagged') : dupCount > 0 ? 'Fix the duplicate first' : bad ? 'Marked invalid — click to clear once the code works' : "Mark this ad code as not working"}
                  onClick={() => toggleInvalid(i)}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
                <span className={`pc-vx-added ${row.videoAt ? '' : 'none'}`} data-label="Added"
                  title={videoAddedTitle(row.videoAt)}>
                  {row.video.trim() ? videoAddedLabel(row.videoAt) : ''}
                </span>
                <a className="pc-vx-open" href={vOk ? row.video : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!vOk} title="Open video">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
                </a>
              </div>
              {(dup.video || dup.adCode) && (
                <div className="pc-vx-dupmsg" role="alert">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.01" /></svg>
                  {[dup.video, dup.adCode].filter(Boolean).join(' · ')}
                </div>
              )}
              {bad && (
                <div className="pc-vx-badmsg" role="status">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.01" /></svg>
                  <span>
                    {row.invalidBy ? `Ad code reported invalid by ${row.invalidBy}` : 'Ad code marked invalid'}
                    {' '}— ask {c.name || 'the creator'} for a new one, then paste it here.
                  </span>
                  <button type="button" className="pc-vx-badcopy"
                    onClick={() => { copyText(store.invalidCodeMessage(c.name, row.video)); toast('Message copied'); }}>
                    Copy message
                  </button>
                </div>
              )}
              {!isExtra && (drafts.length > 0 || (draftsOpen && !ro)) && renderDrafts(row, i, no, drafts, dState, draftsOpen)}
              </div>
            );
          };
          return (
            <>
              <div className="pc-vx-list">
                {codes.map((row, i) => (row.extra ? null : renderRow(row, i)))}
              </div>
              <div className="pc-vx-extra">
                <div className="pc-vx-extrahead">
                  <div>
                    <span className="pc-vx-extratitle"><i className="bi bi-plus-circle-dotted" /> Extra videos{extraIdx.length > 0 ? ` · ${extraFilled}` : ''}</span>
                    <span className="pc-vx-extrasub">Made by the creator beyond the deal — recorded only, not counted in the deal or the contract.</span>
                  </div>
                  {!ro && (
                    <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={addExtra} disabled={dupCount > 0}
                      title={dupCount > 0 ? 'Fix the duplicate first' : 'Add a video the creator made on their own'}>
                      + Add extra video
                    </button>
                  )}
                </div>
                {extraIdx.length > 0
                  ? <div className="pc-vx-list">{extraIdx.map(i => renderRow(codes[i], i))}</div>
                  : <div className="pc-vx-extraempty">{ro ? 'No extra videos.' : 'None yet.'}</div>}
              </div>
            </>
          );
        })()}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Brand editor (create/edit brand + month budget + links)
════════════════════════════════════════════════════════════ */
function BrandEditor({ editor, month, bm, assignableBrands = [], prevSetupFor = null, onClose, onSave }) {
  const isAdd = editor.mode === 'add';
  const [pickId, setPickId] = useState('');
  const [budget, setBudget] = useState(bm.budget != null ? String(bm.budget || '') : '');
  const [guide, setGuide] = useState(bm.content_guide_url || '');
  const [products, setProducts] = useState(() => { const r = focusProductList(bm); return r.length ? r : [{ name: '', url: '' }]; });
  /* Commission % (migration 20260892090000). Held as the raw string so a blank
     box stays blank: null means "not stated" and 0 means "zero percent", and
     coercing early would collapse the two into one answer. */
  const [stdComm, setStdComm] = useState(bm.standard_commission != null ? String(bm.standard_commission) : '');
  const [adsComm, setAdsComm] = useState(bm.shop_ads_commission != null ? String(bm.shop_ads_commission) : '');
  /* Does the client approve videos before they are posted, this month?
     (migration 20260895090000). A plain boolean — off is the right answer for a
     month nobody has set, so there is no third state to hold as a string the way
     the commissions above are. */
  const [approval, setApproval] = useState(!!bm.approval_required);
  /* When this program started (migration 20260899090000) — '' = not recorded,
     which is a real state and deliberately not the same as "the 1st".
     Prefilled on ADD only, with the same `defaultDateForMonth` rule the creator
     editor already applies to its own onboarded_on, because adding the budget
     IS the moment the program starts and the value is on screen to correct
     before Save. On EDIT it is left exactly as stored: somebody who opened the
     popup to fix a budget must not silently stamp a made-up start date onto a
     program that never recorded one. */
  const [onboarded, setOnboarded] = useState(bm.onboarded_on || (isAdd ? defaultDateForMonth(month) : ''));
  const [pulled, setPulled] = useState('');
  const stdVal = pctValue(stdComm), adsVal = pctValue(adsComm);
  /* The DB carries the same 0–100 bound (hcbm_commission_pct_chk), so without
     this the save would come back a 400 the popup has nowhere to show. */
  const pctErr = badPct(stdVal) || badPct(adsVal);

  /* "Get from Products tab" — the brand's own catalogue (brand_products, what
     the APC keeps on Brand Detail → Products). Paid collab keeps ITS OWN list:
     nothing here is synced or overwritten automatically. A handler can add any
     catalogue product (or all of them) to this month's focus products and copy
     the catalogue's commission rates, or keep typing their own; nothing is
     written until Save. Matched on the TikTok product ID first, the name
     second, because the two lists often name the same product differently. */
  const [catalog, setCatalog] = useState([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const catBrandId = editor.mode === 'add' ? pickId : editor.brand?.id;
  useEffect(() => {
    let live = true;
    setCatalog([]);
    if (!catBrandId) return;
    supabase.from('brand_products')
      .select('id,name,external_product_id,tiktok_link,standard_commission,shop_ads_commission,shop_ads_commission_not_set')
      .eq('brand_id', catBrandId).order('created_at')
      .then(({ data }) => { if (live) setCatalog(data || []); });
    return () => { live = false; };
  }, [catBrandId]);
  const pidOf = (url) => (String(url || '').match(/(\d{15,})/) || [])[1] || '';
  const catPid = (cp) => String(cp.external_product_id || '').trim() || pidOf(cp.tiktok_link);
  const inList = (cp) => {
    const pid = catPid(cp), nm = String(cp.name || '').trim().toLowerCase();
    return products.some(p => (pid && pidOf(p.url) === pid) || (nm && (p.name || '').trim().toLowerCase() === nm));
  };
  const catUrl = (cp) => (cp.tiktok_link || '').trim() || (catPid(cp) ? `https://www.tiktok.com/view/product/${catPid(cp)}` : '');
  function addFromCatalog(list) {
    const add = list.filter(cp => !inList(cp)).map(cp => ({ name: (cp.name || '').trim(), url: catUrl(cp) }));
    if (!add.length) return;
    setProducts(prev => {
      const kept = prev.filter(p => (p.name || '').trim() || (p.url || '').trim());
      return [...kept, ...add];
    });
  }
  // The catalogue holds a rate PER PRODUCT; paid collab holds one per month.
  // Offer the most common one, and say when they vary.
  const mostCommon = (vals) => {
    const n = {}; vals.forEach(v => { n[v] = (n[v] || 0) + 1; });
    const keys = Object.keys(n); if (!keys.length) return null;
    keys.sort((a, b) => n[b] - n[a] || Number(b) - Number(a));
    return { value: Number(keys[0]), varies: keys.length > 1 };
  };
  const catStd = mostCommon(catalog.map(cp => cp.standard_commission).filter(v => v != null).map(Number));
  const catAds = mostCommon(catalog.filter(cp => !cp.shop_ads_commission_not_set).map(cp => cp.shop_ads_commission).filter(v => v != null).map(Number));
  const commDiffers = (catStd && catStd.value !== stdVal) || (catAds && catAds.value !== adsVal);
  const missingCount = catalog.filter(cp => !inList(cp)).length;

  /* "Get from Resources" for the content guide link — the brand's resource
     the APC switched on as "This is the Content Guide" (migration
     20261113090000). Until one is marked, the brand's links whose name says
     guide / brief are offered to pick from. Fills the box only; Save writes. */
  const [guideRes, setGuideRes] = useState([]);
  useEffect(() => {
    let live = true;
    setGuideRes([]);
    if (!catBrandId) return;
    supabase.from('resources').select('id,name,url')
      .eq('scope', 'brand').eq('brand_id', catBrandId).order('created_at', { ascending: false })
      .then(({ data }) => { if (live) setGuideRes(data || []); });
    return () => { live = false; };
  }, [catBrandId]);
  const markedGuide = guideRes.find(r => r.is_content_guide) || null;
  const guideCandidates = markedGuide ? [] : guideRes.filter(r => /guide|brief/i.test(r.name || ''));
  const sameLink = (a, b) => String(a || '').trim().replace(/\/+$/, '').toLowerCase() === String(b || '').trim().replace(/\/+$/, '').toLowerCase();

  /* "Pull from <month>" — a brand's budget, content guide and focus products are
     usually the same setup month after month, so this copies the brand's most
     recent earlier month in instead of retyping it. In ADD mode the brand is not
     known until it is picked, hence the lookup by id rather than a fixed row.

     It only ever FILLS: a field the previous month left blank is left alone, so
     pulling can never wipe something already typed here. And nothing is written
     until Save, so the pull is reviewable — which is what the confirmation line
     under the button says. */
  const activeBrandId = isAdd ? pickId : editor.brand?.id;
  const prev = prevSetupFor ? prevSetupFor(activeBrandId) : null;
  const prevProducts = prev ? focusProductList(prev) : [];
  const prevBits = prev ? [
    Number(prev.budget) > 0 ? fmt$(prev.budget) : null,
    (prev.content_guide_url || '').trim() ? 'content guide' : null,
    prevProducts.length ? `${prevProducts.length} product${prevProducts.length > 1 ? 's' : ''}` : null,
    prev.standard_commission != null || prev.shop_ads_commission != null ? 'commission' : null,
    prev.approval_required ? 'approval required' : null,
  ].filter(Boolean) : [];
  function pullPrev() {
    if (!prev) return;
    if (Number(prev.budget) > 0) setBudget(String(prev.budget));
    if ((prev.content_guide_url || '').trim()) setGuide(prev.content_guide_url.trim());
    if (prevProducts.length) setProducts(prevProducts.map(p => ({ name: p.name || '', url: p.url || '' })));
    if (prev.standard_commission != null) setStdComm(String(prev.standard_commission));
    if (prev.shop_ads_commission != null) setAdsComm(String(prev.shop_ads_commission));
    /* Pulled only when the previous month had it ON, which keeps the
       "a pull only ever FILLS" rule working for a field that has no blank
       state: an earlier month's "off" can never switch off a toggle the
       handler has already turned on in this popup. */
    if (prev.approval_required) setApproval(true);
    /* The start date is deliberately NOT pulled. Every other field here
       describes an arrangement that usually repeats month after month; this one
       says when THIS month began, and copying it forward would put June's date
       on September's program. */
    setPulled(prev.month);
  }

  function save() {
    if (isAdd && !pickId) return;
    if (pctErr) return;
    const list = products.map(p => ({ name: (p.name || '').trim(), url: (p.url || '').trim(), ...(p.paused ? { paused: true } : {}) })).filter(p => p.url || p.name);
    onSave({
      brand_id: isAdd ? pickId : editor.brand.id,
      budget: budget === '' ? 0 : Number(budget) || 0,
      content_guide_url: guide.trim(),
      focus_product_url: list.length ? JSON.stringify(list) : '',
      standard_commission: stdVal,
      shop_ads_commission: adsVal,
      approval_required: approval,
      // Blank writes NULL, never '' — one thing for every reader to test for
      // "we don't know when this program started".
      onboarded_on: onboarded || null,
    });
  }
  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal pc-modal-scroll" onClick={e => e.stopPropagation()}>
        <h3>{isAdd ? 'Add brand to this month' : `${editor.brand.name}`}</h3>
        <div className="pc-modal-sub">{monthLabel(month)} · budget & links</div>
        <div className="pc-modal-body">
        {isAdd && (
          <div className="pc-field">
            <label>Brand</label>
            {assignableBrands.length === 0 ? (
              <div className="pc-modal-sub" style={{ marginTop: 4 }}>Every brand already has a budget this month. Brands are assigned to you by your manager.</div>
            ) : (
              <select className="pc-input" value={pickId} onChange={e => { setPickId(e.target.value); setPulled(''); }} autoFocus>
                <option value="">-- Pick a brand with no budget yet --</option>
                {assignableBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
        )}
        {prev && (
          <div className="pc-pullprev">
            <div className="pc-pullprev-txt">
              <strong>{monthLabel(prev.month)}</strong> has a setup for this brand
              {prevBits.length ? <> — {prevBits.join(' · ')}</> : null}
            </div>
            <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={pullPrev}>
              <i className="bi bi-arrow-down-square" aria-hidden="true" /> Pull from {monthShort(prev.month)}
            </button>
          </div>
        )}
        {pulled && <div className="pc-pullprev-done">Pulled from {monthLabel(pulled)}. Review the fields, then Save.</div>}
        {/* Budget and the date it was agreed sit on ONE row: the start date is a
            fact about this budget, not a separate arrangement, and the popup
            already has three stacked blocks below it. */}
        <div className="pc-field2">
          <div className="pc-field"><label>Budget ($)</label>
            <input className="pc-input" type="number" inputMode="numeric" placeholder="e.g. 2000" value={budget} onChange={e => setBudget(e.target.value)} autoFocus={!isAdd} /></div>
          {/* Onboarding date — when this program started. Optional: left blank
              it stores NULL, so a month nobody recorded a date for reads as
              unknown rather than as having started on the 1st. */}
          <div className="pc-field">
            <label>Onboarding date <span className="pc-field-opt">(optional)</span></label>
            <div className="pc-datefield">
              <DateField className="w-100" value={onboarded}
                onChange={setOnboarded} />
              {onboarded && (
                <button type="button" className="pc-multix" title="Clear the onboarding date"
                  onClick={() => setOnboarded('')}>×</button>
              )}
            </div>
            <div className="pc-field-hint">When this month's budget was set up for the brand.</div>
          </div>
        </div>
        <div className="pc-field2">
          <div className="pc-field"><label>Standard commission (%)</label>
            <input className="pc-input" type="number" inputMode="decimal" min="0" max="100" step="0.1" placeholder="e.g. 20"
              value={stdComm} onChange={e => setStdComm(e.target.value)} /></div>
          <div className="pc-field"><label>Shop ads commission (%)</label>
            <input className="pc-input" type="number" inputMode="decimal" min="0" max="100" step="0.1" placeholder="e.g. 10"
              value={adsComm} onChange={e => setAdsComm(e.target.value)} /></div>
        </div>
        {(catStd || catAds) && (
          <div className={`pc-catcomm ${commDiffers ? 'differs' : ''}`}>
            <span>
              Products tab: {catStd ? `${fmtPct(catStd.value)}${catStd.varies ? ' (varies)' : ''}` : '—'} standard
              {' · '}{catAds ? `${fmtPct(catAds.value)}${catAds.varies ? ' (varies)' : ''}` : '—'} shop ads
              {commDiffers ? ' — different from above' : ' — same as above'}
            </span>
            {commDiffers && (
              <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => {
                if (catStd) setStdComm(String(catStd.value));
                if (catAds) setAdsComm(String(catAds.value));
              }}>Use these</button>
            )}
          </div>
        )}
        {pctErr && <div className="pc-inline-err" style={{ marginTop: -8, marginBottom: 14 }}>A commission is a percentage between 0 and 100. Leave a box empty if the rate is not set.</div>}
        {/* Client video approval (migration 20260895090000). A switch rather
            than a checkbox: it is an on/off arrangement that changes how the
            month is worked, not one item ticked off a list — and the sub-line
            spells out that the client never sees this, since a setting NAMED
            after the client reads as something they are shown. */}
        <div className="pc-field">
          <label className="pc-switchrow" htmlFor="pc-appr-toggle">
            <span className="pc-switchrow-txt">
              <span className="pc-switchrow-name">Client approval required</span>
              <span className="pc-switchrow-sub">Videos need the client's sign-off before they go up. Shown to your team only — never on the client portal or a share link.</span>
            </span>
            <span className="pc-switch">
              <input id="pc-appr-toggle" type="checkbox" role="switch" checked={approval}
                onChange={e => setApproval(e.target.checked)} />
              <span className="pc-switch-track" aria-hidden="true"><span className="pc-switch-knob" /></span>
            </span>
          </label>
        </div>
        <div className="pc-field"><label>Content guide link</label><input className="pc-input" placeholder="https://…" value={guide} onChange={e => setGuide(e.target.value)} />
          {markedGuide ? (
            <div className={`pc-catcomm pc-guidefetch ${sameLink(markedGuide.url, guide) ? '' : 'differs'}`}>
              <span>
                <i className="bi bi-patch-check-fill" /> Resources: <a href={markedGuide.url} target="_blank" rel="noopener noreferrer">Content Guide ↗</a>
                {sameLink(markedGuide.url, guide) ? ' — same as above' : guide.trim() ? ' — different link from above' : ''}
              </span>
              {!sameLink(markedGuide.url, guide) && (
                <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setGuide(markedGuide.url)}>Get from Resources</button>
              )}
            </div>
          ) : guideCandidates.length > 0 ? (
            <div className="pc-catcomm pc-guidefetch pc-guidepick">
              <span>No Content Guide marked in Resources yet. Use one of these:</span>
              {guideCandidates.slice(0, 6).map(r => (
                <button key={r.id} type="button" className={`pc-btn pc-btn-ghost pc-btn-sm ${sameLink(r.url, guide) ? 'is-on' : ''}`}
                  onClick={() => setGuide(r.url)} title={r.url}>
                  {sameLink(r.url, guide) && <i className="bi bi-check-lg" />} {r.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="pc-field">
          <label>Focus product(s)</label>
          {products.map((p, i) => (
            <div className="pc-prodrow" key={i}>
              <input className="pc-input pc-prod-name" placeholder="Product name" value={p.name}
                onChange={e => setProducts(prev => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="pc-input" placeholder="https://…  (TikTok product link)" value={p.url}
                onChange={e => setProducts(prev => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              {products.length > 1 && <button type="button" className="pc-multix" title="Remove"
                onClick={() => setProducts(prev => prev.filter((_, j) => j !== i))}>×</button>}
            </div>
          ))}
          <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" style={{ marginTop: 2 }}
            onClick={() => setProducts(prev => [...prev, { name: '', url: '' }])}>+ Add another product</button>
          {catalog.length > 0 && (
            <div className="pc-catpick">
              <button type="button" className="pc-catpick-head" onClick={() => setCatalogOpen(o => !o)} aria-expanded={catalogOpen}>
                <i className="bi bi-box-seam" aria-hidden="true" />
                <span>Get from Products tab</span>
                <span className="pc-catpick-count">
                  {missingCount ? `${missingCount} not in this list` : 'all already added'}
                </span>
                <i className={`bi bi-chevron-${catalogOpen ? 'up' : 'down'}`} aria-hidden="true" />
              </button>
              {catalogOpen && (
                <div className="pc-catpick-body">
                  {catalog.map(cp => {
                    const added = inList(cp);
                    const rate = [
                      cp.standard_commission != null ? `${fmtPct(cp.standard_commission)} std` : null,
                      !cp.shop_ads_commission_not_set && cp.shop_ads_commission != null ? `${fmtPct(cp.shop_ads_commission)} ads` : null,
                    ].filter(Boolean).join(' · ');
                    return (
                      <div className="pc-catpick-row" key={cp.id}>
                        <div className="pc-catpick-name">
                          <span>{cp.name}</span>
                          <small>{[catPid(cp) || 'no product ID', rate].filter(Boolean).join(' · ')}</small>
                        </div>
                        {added
                          ? <span className="pc-catpick-added"><i className="bi bi-check-lg" /> Added</span>
                          : <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => addFromCatalog([cp])}>+ Add</button>}
                      </div>
                    );
                  })}
                  {missingCount > 1 && (
                    <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm pc-catpick-all" onClick={() => addFromCatalog(catalog)}>
                      + Add all {missingCount}
                    </button>
                  )}
                  <div className="pc-field-hint">Adds to this month's list only. Your own products stay; nothing is saved until Save.</div>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={(isAdd && !pickId) || pctErr}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Creator editor (add/edit a deal)
════════════════════════════════════════════════════════════ */
function CreatorEditor({ editor, month, directory = [], categories = [], brandProducts = [], onClose, onSave }) {
  const c = editor.creator || {};
  const isAdd = editor.mode === 'add';
  const [f, setF] = useState({
    name: c.name || '',
    phone: c.phone || '', email: c.email || '',
    amount: c.amount != null ? String(c.amount || '') : '', videos_count: c.videos_count != null ? String(c.videos_count || '') : '',
    onboarded_on: c.onboarded_on || defaultDateForMonth(month),
    // Contract §2 completion window (days after sample delivery); blank = auto.
    deliverable_days: c.deliverable_days != null ? String(c.deliverable_days) : '',
  });
  const [tiktoks, setTiktoks] = useState(() => {
    const arr = String(c.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : [''];
  });
  /* Payment methods (migration 20260872090000).

     PayPal and Zelle keep their own labelled inputs — they are what almost every
     deal uses, and burying them in a generic list made the common case slower to
     fill in than it was before. Everything else lives in `extras`, a repeating
     row with a free-text method name.

     One list is what actually gets stored, so this splits it on the way in and
     re-composes it on the way out. creatorPayouts() falls back to the legacy
     paypal/zelle columns, so a deal saved before the migration opens with its two
     fields filled exactly as it always did. A SECOND entry of a known kind (a
     creator with two PayPal addresses) stays in `extras` rather than being
     silently dropped — only the first fills the fixed field. */
  const stored = creatorPayouts(c);
  const [pp, setPp] = useState(() => stored.find(x => payoutKindOf(x.label) === 'paypal')?.value || '');
  const [zl, setZl] = useState(() => stored.find(x => payoutKindOf(x.label) === 'zelle')?.value || '');
  const [extras, setExtras] = useState(() => {
    let seenPp = false, seenZl = false;
    return stored.filter(x => {
      const k = payoutKindOf(x.label);
      if (k === 'paypal' && !seenPp) { seenPp = true; return false; }
      if (k === 'zelle' && !seenZl) { seenZl = true; return false; }
      return true;
    });
  });
  const setExtra = (i, k, v) => setExtras(prev => prev.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  // product(s) the creator promotes — prefill existing; on add with exactly one brand product, default-select it
  const [prods, setProds] = useState(() => {
    const existing = creatorProducts(c);
    if (existing.length) return existing;
    if (isAdd && brandProducts.length === 1) return [{ name: brandProducts[0].name || '', url: brandProducts[0].url || '' }];
    return [];
  });
  const [prodInput, setProdInput] = useState('');
  const hasProd = p => prods.some(x => prodKey(x) === prodKey(p));
  const toggleProd = p => setProds(prev => prev.some(x => prodKey(x) === prodKey(p)) ? prev.filter(x => prodKey(x) !== prodKey(p)) : [...prev, { name: p.name || '', url: p.url || '' }]);
  const removeProd = idx => setProds(prev => prev.filter((_, j) => j !== idx));
  function addCustomProd() {
    const name = prodInput.trim();
    if (!name) return;
    if (!prods.some(x => (x.name || '').toLowerCase().trim() === name.toLowerCase())) {
      const match = brandProducts.find(bp => (bp.name || '').toLowerCase().trim() === name.toLowerCase());
      setProds(prev => [...prev, { name, url: match?.url || '' }]);
    }
    setProdInput('');
  }
  const pickableProducts = brandProducts.filter(p => !hasProd(p));
  // categories are labels here too; the deal column holds them comma-joined
  const [cats, setCats] = useState(() => splitCats(c.category));
  const { saved: savedCats, remember: rememberCats } = useCategoryCatalogue();
  const [showSug, setShowSug] = useState(false);
  // The save is several round trips (this deal, then the same person's sibling
  // deals). Without a busy state the popup just sat there looking untouched.
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const matches = useMemo(() => {
    const q = f.name.trim().toLowerCase();
    if (!q) return [];
    return directory.filter(d => d.name.toLowerCase().includes(q) && d.name.toLowerCase() !== q).slice(0, 6);
  }, [f.name, directory]);
  function pick(d) {
    setF(prev => ({ ...prev, name: d.name, phone: d.phone || prev.phone, email: d.email || prev.email }));
    /* The creators database banks exactly two payout columns, so an auto-fill
       can only ever offer those two — and `extras` is left alone, being this
       deal's own arrangement rather than anything the database knows about. */
    setPp(prev => d.paypal || prev);
    setZl(prev => d.zelle || prev);
    setCats(prev => (prev.length ? prev : splitCats(d.category)));
    const arr = String(d.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    setTiktoks(arr.length ? arr : ['']);
    setShowSug(false);
  }
  async function save() {
    if (!f.name.trim() || saving) return;
    const tiktok_handle = tiktoks.map(s => s.trim()).filter(Boolean).join('\n');
    const products = prods.map(p => ({ name: (p.name || '').trim(), url: (p.url || '').trim() })).filter(p => p.name || p.url);
    /* Only the list is sent. `paypal` / `zelle` are mirrors the DB trigger
       derives from it, so sending those columns too would put two sources of
       truth in one write with no rule for which the row should believe. The two
       fixed fields go in as the first two entries instead, which is exactly what
       makes the trigger reproduce them in those columns. */
    const payoutList = [
      { label: 'PayPal', value: pp.trim() },
      { label: 'Zelle', value: zl.trim() },
      ...extras.map(x => ({ label: (x.label || '').trim() || 'Other', value: (x.value || '').trim() })),
    ].filter(x => x.value);
    setSaving(true); setErr('');
    try {
      await onSave({ ...(isAdd ? { brand_id: editor.brandId } : { id: c.id }), ...f, category: joinCats(cats), tiktok_handle, products, payouts: payoutList });
      // Only once the deal is actually stored — a rejected save must not grow the
      // shared category vocabulary off the back of it.
      rememberCats(cats);
      // No setSaving(false) on success: that path unmounts this popup, and clearing
      // the flag first would flash the button back to "Save" on the way out.
    } catch (e) {
      setErr(e?.message || 'Could not save this creator');
      setSaving(false);
    }
  }
  // Closing mid-save would leave the write running with nothing to report back to.
  const close = () => { if (!saving) onClose(); };
  return (
    <div className={`pc-overlay${saving ? ' is-busy' : ''}`} onClick={close}>
      <div className="pc-modal pc-modal-scroll" onClick={e => e.stopPropagation()}>
        <h3>{isAdd ? 'Onboard creator' : 'Edit creator'}</h3>
        <div className="pc-modal-sub">{monthLabel(monthKey(f.onboarded_on) || month)}</div>
        <div className="pc-modal-body">
          <div className="pc-field" style={{ position: 'relative' }}>
            <label>Name</label>
            <input className="pc-input" placeholder="Creator name" value={f.name} autoFocus
              onChange={e => { set('name', e.target.value); setShowSug(true); }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 150)} />
            {isAdd && showSug && matches.length > 0 && (
              <div className="pc-suggest">
                <div className="pc-suggest-head">Already worked with — tap to auto-fill</div>
                {matches.map((d, i) => (
                  <button type="button" key={i} className="pc-suggest-item" onClick={() => pick(d)}>
                    <span className="pc-suggest-name">{d.name}</span>
                    <span className="pc-suggest-meta">{tiktokAccounts(d.tiktok_handle).map(a => a.handle).join(' · ') || (d.paypal || d.zelle || '—')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="pc-field">
            <label>TikTok account(s)</label>
            {tiktoks.map((t, i) => (
              <div className="pc-multirow" key={i}>
                <input className="pc-input" placeholder="@handle or URL" value={t}
                  onChange={e => setTiktoks(prev => prev.map((x, j) => (j === i ? e.target.value : x)))} />
                {tiktoks.length > 1 && <button type="button" className="pc-multix" title="Remove"
                  onClick={() => setTiktoks(prev => prev.filter((_, j) => j !== i))}>×</button>}
              </div>
            ))}
            <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" style={{ marginTop: 2 }}
              onClick={() => setTiktoks(prev => [...prev, ''])}>+ Add another account</button>
          </div>
          <div className="pc-field2">
            <div className="pc-field"><label>Number</label><input className="pc-input" placeholder="phone" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div className="pc-field"><label>Email</label><input className="pc-input" placeholder="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
          </div>
          <div className="pc-field"><label>Categories</label>
            <CategoryPicker value={cats} onChange={setCats} saved={savedCats} inUse={categories} />
          </div>
          <div className="pc-field">
            <label>Promoting product{prods.length === 1 ? '' : '(s)'}</label>
            <div className="pc-prodbox">
              {prods.length > 0 && (
                <div className="pc-prodchips">
                  {prods.map((p, i) => (
                    <span className="pc-prodchip sel" key={i} title={p.url || p.name}>
                      <span className="pc-prodchip-dot" />
                      <span className="pc-prodchip-name">{p.name || p.url}</span>
                      <button type="button" className="pc-prodchip-x" onClick={() => removeProd(i)} title="Remove">×</button>
                    </span>
                  ))}
                </div>
              )}
              {pickableProducts.length > 0 && (
                <div className="pc-prodpick">
                  <span className="pc-prodpick-l">From this brand</span>
                  <div className="pc-prodchips">
                    {pickableProducts.map((p, i) => (
                      <button type="button" className="pc-prodchip add" key={i} onClick={() => toggleProd(p)} title={p.url || p.name}>+ {p.name || p.url}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="pc-multirow">
                <input className="pc-input" placeholder="Product name" value={prodInput}
                  onChange={e => setProdInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomProd(); } }} />
                <button type="button" className="pc-prodadd" onClick={addCustomProd} title="Add product" disabled={!prodInput.trim()}>+</button>
              </div>
            </div>
          </div>
          <div className="pc-field2">
            <div className="pc-field"><label>Amount ($)</label><input className="pc-input" type="number" inputMode="numeric" placeholder="200" value={f.amount} onChange={e => set('amount', e.target.value)} /></div>
            <div className="pc-field"><label>Videos</label><input className="pc-input" type="number" inputMode="numeric" placeholder="5" value={f.videos_count} onChange={e => set('videos_count', e.target.value)} /></div>
          </div>
          <div className="pc-field2">
            <div className="pc-field"><label>Onboarded on</label><DateField className="w-100" clearable value={f.onboarded_on} onChange={v => set('onboarded_on', v)} /></div>
            <div className="pc-field">
              <label>Deliverable deadline (days)</label>
              <input className="pc-input" type="number" inputMode="numeric" min="1"
                placeholder={`auto — ${(parseInt(f.videos_count, 10) || 0) < 6 ? 10 : 14} days`}
                value={f.deliverable_days} onChange={e => set('deliverable_days', e.target.value)} />
              <div className="pc-sig-hint">Contract §2 — days after the sample is delivered. Leave blank for the automatic rule.</div>
            </div>
          </div>
          <div className="pc-field2">
            <div className="pc-field"><label>PayPal</label><input className="pc-input" placeholder="email" value={pp} onChange={e => setPp(e.target.value)} /></div>
            <div className="pc-field"><label>Zelle</label><input className="pc-input" placeholder="email / phone" value={zl} onChange={e => setZl(e.target.value)} /></div>
          </div>
          <div className="pc-field">
            <label>Other payment method{extras.length === 1 ? '' : 's'}</label>
            {extras.map((x, i) => (
              <div className="pc-payrow" key={i}>
                <input className="pc-input" list="pc-payout-methods" placeholder="Method" value={x.label}
                  onChange={e => setExtra(i, 'label', e.target.value)} />
                <input className="pc-input" placeholder="email / phone / link / account number"
                  value={x.value} onChange={e => setExtra(i, 'value', e.target.value)} />
                <button type="button" className="pc-multix" title="Remove this method"
                  onClick={() => setExtras(prev => prev.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {/* A datalist, not a dropdown: the suggestions are a shortcut, and
                anything typed over them is a perfectly good payment method. */}
            <datalist id="pc-payout-methods">
              {PAYOUT_SUGGESTIONS.map(m => <option key={m} value={m} />)}
            </datalist>
            <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" style={{ marginTop: 2 }}
              onClick={() => setExtras(prev => [...prev, { label: '', value: '' }])}>+ Add another method</button>
            <div className="pc-sig-hint">Anything paid outside PayPal and Zelle — Wise, a bank transfer, whatever the creator calls it. A method with no value is dropped on save.</div>
          </div>
        </div>
        {/* The error sits IN the action row, beside the button that caused it —
            above the pinned footer it read as part of the scrolled form. */}
        <div className={`pc-modal-actions${err ? ' has-err' : ''}`}>
          {err && <div className="pc-inline-err pc-actions-err" role="alert">{err}</div>}
          <button className="pc-btn pc-btn-ghost" onClick={close} disabled={saving}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={!f.name.trim() || saving}>
            {saving && <span className="pc-btn-spin" aria-hidden="true" />}
            {saving ? (isAdd ? 'Adding…' : 'Saving…') : (isAdd ? 'Add' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Contract template — per-handler signature block settings.
   Only the Brand Representative name + signature are configurable;
   the agreement wording stays code-generated (see contractPdf.ts).
════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════
   Contract template — the user's DEFAULT contract.
   Signature block (representative name + signature) AND the wording: every
   section of the standard agreement can be rewritten, custom sections added,
   and the result seeds every NEW contract this user issues. Existing links keep
   their own wording. Edits may use {placeholders}, filled from each deal.
════════════════════════════════════════════════════════════ */
// Sample deal the template preview renders. Its distinctive values are turned
// back into {placeholders} when a section is opened for editing, so a saved
// default never freezes one deal's numbers.
const TPL_SAMPLE = {
  brandName: '{brand}', creatorName: '{creator_name}', username: '{creator}',
  amount: 1234, currency: 'USD', videosCount: 6, deliverableDays: null,
  effectiveDate: '2030-01-01', productNames: ['{products}'], productLinks: [],
  contentGuideUrl: null, contentRules: 2, productJoin: 'or',
};
function tokenizeSample(text) {
  return String(text || '')
    .split('USD $1,234').join('{amount}')
    .split('six (6)').join('{videos}')
    .split('fourteen (14)').join('{days}')
    .split('01 / 01 / 2030').join('{date}')
    .replace(/\bsix\b/g, '{videos_short}');
}

function ContractTemplateModal({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [repName, setRepName] = useState('');
  const [savedSigUrl, setSavedSigUrl] = useState('');   // already stored in the DB
  const [pendingSig, setPendingSig] = useState(null);   // uploaded SVG → PNG data URL, not yet saved
  const [removeSig, setRemoveSig] = useState(false);
  // Default wording, held locally until Save.
  const [sectionEdits, setSectionEdits] = useState({});
  const [extraSections, setExtraSections] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draftHeading, setDraftHeading] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [showTokens, setShowTokens] = useState(false);
  // Pointer/touch handling lives in the shared hook — see src/lib/signaturePad.ts
  // for why the old inline onPointer* + setPointerCapture version never worked on iOS.
  const pad = useSignaturePad({
    onStrokeStart: () => { setPendingSig(null); setRemoveSig(false); },
  });
  const { dirty: padDirty, clear: clearPad } = pad;   // something drawn on the pad

  useEffect(() => {
    let alive = true;
    store.getContractSettings()
      .then(s => {
        if (!alive) return;
        setRepName(s?.rep_name || ''); setSavedSigUrl(s?.signature_url || '');
        setSectionEdits(s?.template?.sectionEdits || {});
        setExtraSections(s?.template?.extraSections || []);
      })
      .catch(e => { if (alive) setErr(e.message || 'Could not load settings'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function onUploadSvg(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await svgToPngDataUrl(file);
      setPendingSig(dataUrl); setRemoveSig(false); clearPad();
    } catch (ex) { setErr(`Could not read that SVG: ${ex.message || ''}`); }
  }

  // Priority: uploaded SVG > pad drawing > existing (unless removed).
  const previewSig = pendingSig || (!padDirty && !removeSig && savedSigUrl) || null;

  // The preview renders the standard agreement with the default wording layered on.
  const previewInput = { ...TPL_SAMPLE, repName: repName.trim(), signatureDataUrl: previewSig, sectionEdits, extraSections };
  const sectionList = buildContractModel(previewInput).sections;

  function startEdit(section) {
    // Pre-fill from the UNFILLED wording: a stored edit as typed, otherwise the
    // standard text with the sample deal turned back into placeholders.
    const stored = String(section.id).startsWith('x_')
      ? extraSections.find(x => x.id === section.id)
      : sectionEdits[section.id];
    setEditingId(section.id);
    setDraftHeading(stored?.heading || section.heading);
    setDraftBody(stored?.body != null ? stored.body : tokenizeSample(blocksToText(section.blocks)));
  }
  function saveEdit() {
    const id = editingId;
    if (!id) return;
    const heading = draftHeading.trim();
    if (String(id).startsWith('x_')) {
      setExtraSections(list => list.map(x => x.id === id ? { ...x, heading, body: draftBody } : x));
    } else {
      setSectionEdits(m => ({ ...m, [id]: { heading, body: draftBody } }));
    }
    setEditingId(null);
  }
  function addSection() {
    const id = `x_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const heading = `${sectionList.length + 1}. New section`;
    const body = 'Describe this section.';
    setExtraSections(list => [...list, { id, heading, body }]);
    setEditingId(id); setDraftHeading(heading); setDraftBody(body);
  }
  function removeSection(id) {
    setExtraSections(list => list.filter(x => x.id !== id));
    if (editingId === id) setEditingId(null);
  }
  function resetSection(id) {
    setSectionEdits(m => { const n = { ...m }; delete n[id]; return n; });
    if (editingId === id) setEditingId(null);
  }
  function resetAll() {
    if (!window.confirm('Reset every section to the standard wording and remove your custom sections?')) return;
    setSectionEdits({}); setExtraSections([]); setEditingId(null);
  }
  const editApi = {
    editingId, draftHeading, draftBody,
    onHeading: setDraftHeading, onBody: setDraftBody,
    start: startEdit, save: saveEdit, cancel: () => setEditingId(null),
    add: addSection, remove: removeSection, reset: resetSection,
    busy: saving, locked: false,
  };
  const customised = Object.keys(sectionEdits).length + extraSections.length;

  async function save() {
    setSaving(true); setErr('');
    try {
      let signature_url = removeSig ? '' : savedSigUrl;
      let dataUrl = pendingSig;
      if (!dataUrl) dataUrl = pad.toDataURL();
      if (dataUrl) {
        const blob = await (await fetch(dataUrl)).blob();
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user?.id) throw new Error('Not signed in');
        signature_url = await uploadSignature(u.user.id, blob);
      }
      await store.saveContractSettings({ rep_name: repName.trim(), signature_url, template: { sectionEdits, extraSections } });
      onClose();
    } catch (ex) {
      setErr(ex.message || 'Save failed');
      setSaving(false);
    }
  }

  const stop = (e) => e.stopPropagation();
  return createPortal(
    <div className="pc-overlay" onClick={e => { e.stopPropagation(); onClose(); }} onKeyDown={stop} onKeyUp={stop}>
      <div className="pc-modal pc-cdoc-modal" onClick={e => e.stopPropagation()}>
        <div className="pc-cdoc-modal-head">
          <div>
            <h3>Contract template</h3>
            <div className="pc-modal-sub">Your default contract — every new contract you issue starts from this</div>
          </div>
          <button className="pc-cdoc-close" onClick={onClose} aria-label="Close"><i className="bi bi-x-lg" /></button>
        </div>

        {loading ? <div className="pc-cdoc-loading"><div className="pc-spinner" /></div> : (
          <div className="pc-cdoc-modal-grid">
            {/* LEFT — signature block + the sections */}
            <div className="pc-cdoc-side">
              <div className="pc-field">
                <label>Representative name</label>
                <input className="pc-input" placeholder="Who signs on behalf of the brand" value={repName} onChange={e => setRepName(e.target.value)} />
              </div>
              <div className="pc-field">
                <label>Signature</label>
                {previewSig && (
                  <div className="pc-sig-preview">
                    <img src={previewSig} alt="Saved signature" />
                    <span className="pc-sig-preview-l">{pendingSig ? 'New signature (not saved yet)' : 'Current signature'}</span>
                    <button type="button" className="pc-multix" title="Remove signature"
                      onClick={() => { setPendingSig(null); setRemoveSig(true); }}>×</button>
                  </div>
                )}
                <canvas ref={pad.ref} className="pc-sigpad" />
                <div className="pc-sig-actions">
                  <span className="pc-sig-hint">Draw above with mouse / finger, or</span>
                  <label className="pc-btn pc-btn-ghost pc-btn-sm"
                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', outline: '1px solid #b2b2b2' }}>
                    Upload SVG
                    <input type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }} onChange={onUploadSvg} />
                  </label>
                  {padDirty && <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={clearPad}>Clear drawing</button>}
                </div>
              </div>

              <div className="pc-cdoc-side-sec">
                <div className="pc-cdoc-side-h">
                  Sections
                  <span className="pc-cdoc-side-hint">tap to edit</span>
                </div>
                <div className="pc-cdoc-seclist">
                  {sectionList.map(s => (
                    <button type="button" key={s.id}
                      className={`pc-cdoc-secrow${editingId === s.id ? ' active' : ''}`}
                      disabled={saving}
                      onClick={() => startEdit(s)}>
                      <span className="pc-cdoc-secrow-t">{s.heading}</span>
                      {s.custom
                        ? <span className="pc-cdoc-tag custom">Custom</span>
                        : s.edited ? <span className="pc-cdoc-tag edited">Edited</span> : null}
                      <i className="bi bi-pencil pc-cdoc-secrow-ico" />
                    </button>
                  ))}
                </div>
                <button type="button" className="pc-cdoc-addbtn" onClick={addSection} disabled={saving}>
                  <i className="bi bi-plus-lg" /> Add a section
                </button>
                {customised > 0 && (
                  <button type="button" className="pc-cdoc-textbtn" onClick={resetAll} disabled={saving}>Reset all to the standard wording</button>
                )}
              </div>

              <div className="pc-field">
                <button type="button" className="pc-cdoc-textbtn" onClick={() => setShowTokens(v => !v)}>
                  <i className={`bi ${showTokens ? 'bi-chevron-up' : 'bi-chevron-down'}`} /> Placeholders you can type
                </button>
                {showTokens && (
                  <div className="pc-sig-hint">
                    Filled in from each deal when the contract is made:
                    {CONTRACT_TOKENS.map(t => (
                      <div key={t.token}><code>{`{${t.token}}`}</code> — {t.desc}</div>
                    ))}
                    Use <code>**bold**</code> and <code>[label](https://…)</code> for emphasis and links.
                  </div>
                )}
                <div className="pc-sig-hint">
                  Changes apply to contracts you create from now on. A contract already sent keeps its own wording — edit it from that creator's Contract button.
                </div>
              </div>

              {err && <div className="pc-formerr">{err}</div>}
            </div>

            {/* RIGHT — the whole agreement as a sample deal, section by section */}
            <div className="pc-cdoc-preview">
              <ContractDoc input={previewInput} edit={editApi} />
            </div>
          </div>
        )}

        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={loading || saving}>{saving ? 'Saving…' : 'Save template'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
