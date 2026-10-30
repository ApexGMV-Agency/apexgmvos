import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'react-bootstrap';
import type { ReactNode } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, LabelList,
  PieChart, Pie, Cell,
} from 'recharts';
import type { HandlerCreator } from '../handler-collab/store';
import { dealMonth } from '../handler-collab/store';
import { copyWithToast, payoutKind } from '../../lib/copyToast';
import { creatorPayouts, payoutTag, payoutTagClass, payoutUrl } from '../../lib/creatorPayouts';
import type { Payout } from '../../lib/creatorPayouts';
import { currencySymbol, setReportCurrency } from '../../lib/currency';
import { videoIdFromLine } from '../../lib/tiktokUsername';

// Creator identity: handle if present, otherwise the name (mirrors SQL creator_identity_key).
function creatorIdentityKey(c: { handle?: string | null; name?: string | null }): string {
  const handle = (c.handle || '').toLowerCase().replace(/^@+/, '').trim();
  if (handle) return `h:${handle}`;
  return `n:${(c.name || '').toLowerCase().trim()}`;
}
import '../handler-collab/handlerCollab.css';

/* ════════════════════════════════════════════════════════════
   Shared READ-ONLY pieces that reproduce the handler Workspace drilldown look
   (pc-* styling from handlerCollab.css). Used by the client/handler program view
   and Bob/APC's Brand Detail → Paid Collab tab. View-only — no editing.
════════════════════════════════════════════════════════════ */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)', 'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)', 'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)', 'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
];
export const STATUS = {
  videos_in_progress: { label: 'Videos in Progress', cls: 'progress' },
  follow_up: { label: 'Follow-up Required', cls: 'followup' },
  pending: { label: 'Payment Pending', cls: 'pending' },
  paid: { label: 'Payment Sent', cls: 'sent' },
  // Internal-only states — only ever rendered on staff surfaces (the Brand
  // Detail view-mode tab); client/share surfaces strip these rows out.
  awaiting_confirmation: { label: 'Awaiting Confirmation', cls: 'awaiting' },
  terminated: { label: 'Terminated', cls: 'terminated' },
} as Record<string, { label: string; cls: string }>;

// Status as shown outside the handler workspace. All read views mask a
// "Payment Pending" the handler hasn't shared yet (per-creator toggle) back to
// "Videos in Progress". Additionally, the internal "Follow-up Required" nudge is
// staff-only: client-facing views (client portal + share link, staff=false) only
// ever see three states — Videos in Progress / Payment Pending / Payment Sent —
// while staff views (Bob/APC brand tab) keep it.
export const clientStatus = (c: HandlerCreator, staff = false) => {
  let s = c.payment_status;
  if (s === 'pending' && !c.pending_visible_to_client) s = 'videos_in_progress';
  if (!staff && s === 'follow_up') s = 'videos_in_progress';
  return s;
};
// True when this creator's payment-pending status is visible to the client.
export const isPendingVisible = (c: HandlerCreator) => clientStatus(c) === 'pending';

// INTERNAL-ONLY statuses the handler sets by hand — a cancelled deal
// ('terminated') and one not confirmed yet ('awaiting_confirmation'). Neither
// may surface in a client-facing / read-only view (client portal, Brand Detail
// view mode, the public share link) and neither counts toward budget maths:
// one is money we won't spend, the other money not committed yet. Every read
// surface strips these rows (from both the rendered list AND its aggregate
// KPIs) before display; withoutInternalOnly is the shared filter, applied at
// each data source and, as a safety net, inside the read-only components below.
export const INTERNAL_ONLY_STATUSES = ['terminated', 'awaiting_confirmation'];
export const isInternalOnlyStatus = (c: { payment_status?: string | null }) =>
  INTERNAL_ONLY_STATUSES.includes(String(c?.payment_status ?? ''));
export const withoutInternalOnly = <T extends { payment_status?: string | null }>(list: T[]): T[] =>
  (list || []).filter(c => !isInternalOnlyStatus(c));

/* ── signed contract ──
   The creator signs through the handler's share link; every brand-access read
   view (client portal, share link, Bob/APC/Team Lead/Ads Manager brand tab)
   links to that signed copy at /sign/<token>, which serves the executed PDF
   read-only. Rows carry the signature as `signed_contract`, merged in at each
   fetch site. `contract_url` is the legacy manually-pasted link, kept as a
   fallback for deals signed before the e-signing flow. */
export type SignedContract = { token: string; signed_at?: string | null; signer_name?: string | null };
export const signedContractUrl = (c: any): string => {
  const t = c?.signed_contract?.token;
  if (t && c.signed_contract.signed_at) return `${window.location.origin}/sign/${t}`;
  return c?.contract_url || '';
};
export const signedContractTitle = (c: any): string => {
  const s = c?.signed_contract;
  if (s?.signed_at) {
    const who = s.signer_name ? ` by ${s.signer_name}` : '';
    return `Signed${who} · ${new Date(s.signed_at).toLocaleDateString()}`;
  }
  return 'Open signed contract';
};

export const monthKey = (d?: string | null) => (d ? String(d).slice(0, 7) : '');
// Whole-number money in the brand's currency. `code` is optional: single-brand
// views call setReportCurrency(brand.currency) at render and just use fmt$(n);
// multi-brand rows pass the row's currency explicitly.
export const fmt$ = (n: number, code?: string | null) => `${currencySymbol(code)}${Math.round(n || 0).toLocaleString()}`;
export const getGradient = (name: string) => (name ? AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length] : AVATAR_GRADIENTS[0]);
export const initial = (name: string) => { const s = (name || '').trim(); return s ? s[0].toUpperCase() : '?'; };

/** Brand avatar for every `pc-*` surface: the brand's uploaded picture when it
 *  has one (brands.logo_url), otherwise the usual gradient letter tile. Shared
 *  so the workspace, the client portal and the share pane can't drift. */
export function BrandAva(
  { name, logo, className = 'pc-ava', style }:
  { name?: string | null; logo?: string | null; className?: string; style?: React.CSSProperties },
) {
  const label = name || '';
  if (logo) {
    return (
      <span className={`${className} pc-ava-img`} style={style} title={label}>
        <img src={logo} alt={label} draggable={false} />
      </span>
    );
  }
  return (
    <span className={className} style={{ background: getGradient(label), ...style }} title={label}>
      {initial(label)}
    </span>
  );
}
export const isValidUrl = (s?: string) => !!s && (s.startsWith('http://') || s.startsWith('https://'));
function copyText(t: string) {
  try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t); return; } } catch { /* ignore */ }
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch { /* ignore */ }
}
export function monthLabel(key: string) { if (!key) return '—'; const [y, m] = key.split('-'); return `${MONTHS[parseInt(m, 10) - 1] || '?'} ${y}`; }
export function fmtDate(d?: string | null) { if (!d) return '—'; const x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }); }

/* When a video LINK was added (video_codes[i].videoAt, stamped by the DB —
   migration 20260860090000). Compact "12 Mar 25" because a creator's video list
   shows several at once. Videos added before that migration carry no stamp and
   deliberately read "—": we do not know, and completed_on / video_count_updated_at
   would only be right for the last video of a batch. */
export function videoAddedLabel(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
export function videoAddedTitle(iso?: string | null) {
  if (!iso) return 'No date recorded — this video was added before we started tracking it';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'No date recorded';
  return `Video link added ${d.toLocaleString()}`;
}
function tiktokHandle(raw: string) {
  if (!raw) return '';
  const t = String(raw).trim().replace(/\/$/, '');
  if (t.startsWith('http')) { const last = t.split('/').pop() || ''; return last.startsWith('@') ? last : `@${last}`; }
  return t.startsWith('@') ? t : `@${t}`;
}
export function tiktokAccounts(raw: string) {
  if (!raw) return [] as { handle: string; url: string }[];
  return String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(h => ({
    handle: tiktokHandle(h),
    url: h.startsWith('http') ? h : `https://www.tiktok.com/${tiktokHandle(h)}`,
  }));
}
export function focusProductList(raw: string) {
  if (!raw) return [] as { name: string; url: string }[];
  try { const p = JSON.parse(raw); if (Array.isArray(p)) return p.map((x: any) => (typeof x === 'string' ? { name: '', url: x } : { name: x.name || '', url: x.url || '' })).filter(x => x.url || x.name); } catch { /* legacy */ }
  return raw.split(/\n+/).map(s => s.trim()).filter(Boolean).map(url => ({ name: '', url }));
}
export function creatorProducts(c: HandlerCreator) {
  const raw: any = c?.products;
  if (!Array.isArray(raw)) return [] as { name: string; url: string }[];
  return raw.map((p: any) => (typeof p === 'string' ? { name: p, url: '' } : { name: p.name || '', url: p.url || '' })).filter((p: any) => p.name || p.url);
}
/* ── EXTRA videos (video_codes[i].extra) ──
   A video the creator made on their own, beyond what the deal agreed. The
   handler records it for reference only: it is NOT part of the deal or the
   contract, so it never counts toward "delivered", never completes a deal and
   never moves the follow-up timer (SQL twin: handler_collab_posted_videos /
   handler_collab_deal_rows, migration 20261008090000). Extras live in the SAME
   array, after the deal rows, so every per-row verdict (auth, invalid, best,
   rating) works on them unchanged. */
export const isExtraVideo = (v: any) => !!(v && v.extra);
export const dealCodes = (codes: any) => (Array.isArray(codes) ? codes : []).filter((v: any) => !isExtraVideo(v));
export const extraCodes = (codes: any) => (Array.isArray(codes) ? codes : []).filter((v: any) => isExtraVideo(v));
const hasLink = (v: any) => !!(v && v.video && String(v.video).trim());
export const deliveredCount = (c: HandlerCreator) => dealCodes(c.video_codes).filter(hasLink).length;
export const extraVideoCount = (c: HandlerCreator) => extraCodes(c.video_codes).filter(hasLink).length;
/* ── one deal's GMV / ad spend, read the way the Performance tab WRITES it ──
   `handler_collab_creators.monthly` carries BOTH lenses in one object:
     { "YYYY-MM": {gmv, adSpent, l30},  weeks: { "YYYY-MM-DD": {gmv, adSpent} } }
   (BrandMatrix commitMonth / commitWeek). Each month is counted ONCE: the month
   cell wins, and a month with no figure of its own falls back to the sum of its
   weeks — so the two lenses can never double up, and a creator whose numbers
   were entered WEEKLY no longer reads as zero.

   ‼️ This used to count month keys only, which is why a weekly-logged brand
   showed "—" for every creator on the client portal, the share link and report
   §13. Corrected 2026-09-07 on the user's call — the figure is meant to be what
   the creator actually made on that program. The change can only ever ADD money
   that was already recorded (a month that states its own GMV is untouched), so
   no previously-shown figure goes down.

   ‼️ ONE BODY: `creatorGmvTotal` in HandlerCollabApp was a second copy of this
   rule and now delegates here. Do not fork it again.

   `lensByMonth` is that body — the month-by-month breakdown every reader below
   is derived from, whether it wants one month or all of them. A week is filed
   under the month its START falls in, which is how the weekly reporting system
   files a report (BrandMatrix builds its week columns with the same test), so a
   week straddling a month boundary belongs to exactly one month. */
function lensByMonth(monthly: any, field: 'gmv' | 'adSpent'): Record<string, number> {
  const root = monthly && typeof monthly === 'object' ? monthly : {};
  const byMonth: Record<string, number> = {};
  Object.entries(root).forEach(([k, v]: [string, any]) => {
    if (k === 'weeks' || !v || typeof v !== 'object') return;
    if (!/^\d{4}-\d{2}$/.test(k)) return;               // month cells only
    if (v[field] == null || v[field] === '') return;     // not stated: let the weeks answer
    byMonth[k] = Number(v[field]) || 0;
  });
  const weeks = root.weeks && typeof root.weeks === 'object' ? root.weeks : {};
  const weekByMonth: Record<string, number> = {};
  Object.entries(weeks).forEach(([k, v]: [string, any]) => {
    if (!v || typeof v !== 'object' || v[field] == null || v[field] === '') return;
    const mk = String(k).slice(0, 7);
    weekByMonth[mk] = (weekByMonth[mk] || 0) + (Number(v[field]) || 0);
  });
  Object.entries(weekByMonth).forEach(([mk, val]) => {
    if (byMonth[mk] == null) byMonth[mk] = val;          // only where the month is silent
  });
  return byMonth;
}
function lensTotal(monthly: any, field: 'gmv' | 'adSpent'): number {
  return Object.values(lensByMonth(monthly, field)).reduce((t, n) => t + n, 0);
}
function lensMonth(monthly: any, field: 'gmv' | 'adSpent', month: string): number {
  if (!month) return 0;
  return lensByMonth(monthly, field)[month] || 0;
}
/** Everything this deal earned — both lenses, each month counted once. */
export function gmvSum(c: HandlerCreator) { return lensTotal(c.monthly, 'gmv'); }
/** Everything this deal spent on ads — the same rule, so ROAS divides like for like. */
export function adSum(c: HandlerCreator) { return lensTotal(c.monthly, 'adSpent'); }

/* ── ONE MONTH's figure for one deal ──────────────────────────────────────────
   ‼️ A PROGRAM IS A BRAND-MONTH, so what it earned is what was RECORDED FOR
   THAT MONTH — not the lifetime total of the deals that happen to have been
   onboarded into it. Those are different questions and they were being answered
   with the same number (`gmvSum`), which is why August's weeks were showing up
   on a July program: the deal was onboarded in July, so every later month it
   earned in was banked against July and August's own card read zero.
   Verified against the live DB before the change — e.g. Wetcat's August program
   showed $0 while $414.60 of August money sat on its June and July cards.
   `gmvSum` is still right where the question really is all-time: a PERSON's
   Total GMV in the Creators Database, and a deal's own lifetime figure in the
   creator popup. Use these two anywhere a month is in scope. */
export function gmvForMonth(c: HandlerCreator, month: string) { return lensMonth(c.monthly, 'gmv', month); }
export function adForMonth(c: HandlerCreator, month: string) { return lensMonth(c.monthly, 'adSpent', month); }
/** This deal's GMV broken out by month — `{ 'YYYY-MM': n }`, each month counted
    once. For a caller that needs several months of one deal at a time (the
    Creators Database's "programs worked" table) rather than asking month by
    month. */
export function gmvByMonth(c: HandlerCreator) { return lensByMonth(c.monthly, 'gmv'); }
/** Every month this deal recorded money in, oldest first. */
export function dealMonths(c: HandlerCreator) {
  const s = new Set([...Object.keys(lensByMonth(c.monthly, 'gmv')), ...Object.keys(lensByMonth(c.monthly, 'adSpent'))]);
  return [...s].sort();
}

/* ── who is ON a program ──────────────────────────────────────────────────────
   ‼️ A deal belongs to a month when it was ONBOARDED into it OR still PRODUCED
   in it. The second half is load-bearing rather than a nicety: measured on the
   live data, 100% of Wetcat's, Talon's and Zytrell's August GMV came from deals
   signed in an earlier month, so a roster of "onboarded this month" alone would
   leave those programs reading zero however the money is bucketed. It is also
   what keeps a program's header equal to the sum of the rows under it.
   Same rule the Performance tab's brand list already applies — keep them in step. */
export function producedIn(c: HandlerCreator, month: string) {
  return gmvForMonth(c, month) > 0 || adForMonth(c, month) > 0;
}
export function onProgram(c: HandlerCreator, month: string) {
  return dealMonth(c) === month || producedIn(c, month);
}
/** True for a roster member who was signed into an EARLIER month and is still
    producing in this one — so a row can say so and a reader is not left
    wondering why their fee is missing from Allocated. */
export function carriedOver(c: HandlerCreator, month: string) {
  return !!month && dealMonth(c) !== month && producedIn(c, month);
}

/* ── ONE program's figures ───────────────────────────────────────────────────
   The single body behind every program card and program detail (client portal,
   public share link, the standalone program page). They read the same rows and
   must not answer differently.

   ‼️ TWO SCOPES, and mixing them is the bug this function exists to prevent:
   · MONEY EARNED (gmv / ad) belongs to the month it was RECORDED in, so it is
     summed over the whole roster — including a deal signed earlier that was
     still selling. That is the fix: August's weeks now land on August.
   · A DEAL'S OWN TERMS (allocated, paid, agreed + delivered videos, payment
     pending) are committed ONCE, in the month the deal was signed, so they are
     summed over `signed` alone. Widening those to the roster too would add a
     June creator's fee to August's Allocated as well as June's — the budget
     would read as overspent and the same money would be counted twice.
   `carried` is how many roster rows are visiting from an earlier month. */
export function programStats(brandCreators: HandlerCreator[], month: string) {
  const roster = brandCreators.filter(c => onProgram(c, month));
  const signed = roster.filter(c => dealMonth(c) === month);
  let allocated = 0, paid = 0, videos = 0, delivered = 0, pendingCount = 0;
  signed.forEach(c => {
    const amt = Number(c.amount) || 0;
    allocated += amt;
    if (c.payment_status === 'paid') paid += amt;
    videos += Number(c.videos_count) || 0;
    delivered += deliveredCount(c);
    if (isPendingVisible(c)) pendingCount += 1;
  });
  let gmv = 0, ad = 0;
  roster.forEach(c => { gmv += gmvForMonth(c, month); ad += adForMonth(c, month); });
  return { roster, signed, carried: roster.length - signed.length, allocated, paid, videos, delivered, pendingCount, gmv, ad };
}
export type ProgramStats = ReturnType<typeof programStats>;

/* The two places a program has to say WHO it is made of. Shared so the card and
   the detail cannot phrase the same split differently — and so a program with no
   deals of its own but real GMV (it happens: every August seller signed in June)
   never reads as "0 creators" beside a live figure. */
export function programRosterLabel(st: ProgramStats) {
  const n = st.roster.length;
  const base = `${n} creator${n === 1 ? '' : 's'}`;
  return st.carried > 0 ? `${base} (${st.carried} from earlier months)` : base;
}
/** Sub-line for the Allocated tile — the allocation only ever covers the deals
    SIGNED into this month, so it counts those and names the rest separately. */
export function programAllocLabel(st: ProgramStats) {
  const n = st.signed.length;
  const base = `${n} creator${n === 1 ? '' : 's'}`;
  return st.carried > 0 ? `${n} signed · ${st.carried} from earlier` : base;
}

export function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="pc-kpi">
      <div className="pc-kpi-label"><span className="pc-kpi-dot" style={{ background: color }} />{label}</div>
      <div className="pc-kpi-value">{value}</div>
      <div className="pc-kpi-sub">{sub}</div>
    </div>
  );
}

const CopyIcon = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
const OpenIcon = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
);

// Compact payout chip for table rows: the method's badge (+ an open ↗ when the
// value is a link). Never prints the raw email/link inline.
// `label` is free text since 20260872090000, so the tag is derived, not a switch.
//
// ‼️ THE BADGE IS THE COPY CONTROL — there is deliberately NO separate copy icon.
// The badge is what reads as "the PayPal / Zelle address", so it is what a payer
// aims at; a copy glyph beside it was a second button for the same one action,
// and it cost this chip ~26px in every table that renders it. Hovering names the
// method and the full address and says the click copies, which is the affordance
// the removed icon was carrying.
export function PayChip({ label, value }: { label: string; value: string }) {
  const url = payoutUrl(value);
  const k = url ? 'Link' : payoutKind(value);
  return (
    <span className="pc-paychip" title={`${label}: ${value}`}>
      <button type="button" className={`pc-paytag pc-paytag-btn ${payoutTagClass(label)}`}
        onClick={e => { e.stopPropagation(); copyWithToast(url || value, k); }}
        title={`${label}: ${value} — click to copy`}
        aria-label={`Copy ${label} ${k.toLowerCase()}`}>{payoutTag(label)}</button>
      {url && (
        <a className="pc-payopen" href={url} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()} title="Open link" aria-label="Open link">{OpenIcon}</a>
      )}
    </span>
  );
}

// Full payout line for the expanded panel: label + value (clickable when it's a link)
// + a copy button.
export function PayoutDetail({ label, value }: { label: string; value: string }) {
  const url = payoutUrl(value);
  const k = url ? 'Link' : payoutKind(value);
  return (
    <div className="pc-payoutline">
      <span className={`pc-paytag ${payoutTagClass(label)}`}>{payoutTag(label)}</span>
      <span className="pc-payoutline-label">{label}</span>
      {url
        ? <a className="pc-payoutline-val pc-paylink" href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{value}</a>
        : <span className="pc-payoutline-val">{value}</span>}
      <button type="button" className="pc-paycopy" aria-label={`Copy ${label} ${k.toLowerCase()}`} title={`Copy ${label} ${k.toLowerCase()}`}
        onClick={e => { e.stopPropagation(); copyWithToast(url || value, k); }}>{CopyIcon}</button>
    </div>
  );
}

/* Payout cell — compact copy chips. No raw email/link printed in the row.
   Capped at PAYOUT_ROW_MAX: a deal may now carry any number of methods and the
   chips stack vertically, so an uncapped cell would drive the row height off
   the back of one creator's five accounts. The rest are one click away in the
   expanded panel, which is where a payer is looking anyway. */
const PAYOUT_ROW_MAX = 2;
export function PayoutChipsRO({ payouts }: { payouts: Payout[] }) {
  if (!payouts.length) return <span className="pc-handle">—</span>;
  const shown = payouts.slice(0, PAYOUT_ROW_MAX);
  const rest = payouts.length - shown.length;
  return (
    <div className="pc-payout">
      {shown.map((p, i) => <PayChip key={i} label={p.label} value={p.value} />)}
      {rest > 0 && (
        <span className="pc-paymore" title={payouts.slice(PAYOUT_ROW_MAX).map(p => `${p.label}: ${p.value}`).join('\n')}>
          +{rest} more
        </span>
      )}
    </div>
  );
}


// A video's 1-5 star rating. Read-only everywhere except the client's own two
// surfaces (share link + signed-in portal), which pass onRate.
// Re-rating is allowed and tapping the current score clears it — a rating is an
// opinion, and a mis-tap on a phone should not be permanent.
export function VideoStars({ value, onRate, busy, by }: {
  value?: number | null; onRate?: (n: number | null) => void; busy?: boolean; by?: string | null;
}) {
  const [hover, setHover] = useState(0);
  const score = Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
  const shown = hover || score;
  const ro = !onRate;
  const label = score
    ? `${score} out of 5${by ? ` — rated by ${by}` : ''}`
    : (ro ? 'Not rated yet' : 'Rate this video');
  return (
    <div className={`pc-stars ${ro ? 'is-ro' : ''} ${busy ? 'is-busy' : ''}`}
      title={label} aria-label={label} role={ro ? 'img' : 'radiogroup'}
      onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(n => {
        const on = n <= shown;
        const star = (
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden
            fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6"
            strokeLinejoin="round">
            <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
          </svg>
        );
        if (ro) return <span key={n} className={`pc-star ${on ? 'on' : ''}`}>{star}</span>;
        return (
          <button key={n} type="button" className={`pc-star ${on ? 'on' : ''}`} disabled={busy}
            role="radio" aria-checked={n === score} aria-label={`${n} star${n === 1 ? '' : 's'}`}
            onMouseEnter={() => setHover(n)}
            // Tapping the current score clears it, so a wrong tap is undoable.
            onClick={e => { e.stopPropagation(); onRate(n === score ? null : n); }}>
            {star}
          </button>
        );
      })}
    </div>
  );
}

// The creator detail is written ONCE and shown two ways. Inline (the accordion
// the client portal uses) or in a popup, which the share link and the handler
// workspace's brand drilldown both ask for: a creator's panel runs long, and
// expanding it in place pushes the rest of the list down the page and loses the
// reader's place in it. Exported because the workspace's own (editable) panel
// rides the same shell — two popups of the same thing must not drift.
// NOTE the panel is a SIBLING of the clickable row, never a child — so a click
// inside it cannot reach the row's toggle. That matters most for the modal,
// whose portal WOULD otherwise bubble back up through the React tree and close
// the popup on its own first click.
export function CreatorPanelShell({ asModal, name, handle, onClose, children }: {
  asModal?: boolean; name?: string | null; handle?: string; onClose: () => void; children: ReactNode;
}) {
  if (!asModal) return <div className="pc-expand" onClick={e => e.stopPropagation()}>{children}</div>;
  return (
    <Modal show onHide={onClose} size="xl" centered scrollable dialogClassName="pc-cmodal">
      <Modal.Header closeButton>
        <Modal.Title as="div" className="pc-cmodal-title">
          <span className="pc-cmodal-name">{name || 'Creator'}</span>
          {handle && <span className="pc-cmodal-handle">{handle}</span>}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="pc-cmodal-body">{children}</Modal.Body>
    </Modal>
  );
}

// The row's Discussion action. Stops propagation because the whole row is a
// click-to-expand button — without it, commenting would also toggle the panel.
function DiscussBtn({ onDiscuss, discuss, name }: { onDiscuss: () => void; discuss?: CreatorDiscuss; name?: string | null }) {
  const n = discuss?.count || 0;
  const hasNew = !!discuss?.hasNew;
  return (
    <button type="button"
      className={`pc-cdisc-btn ${n === 0 ? 'empty' : ''} ${hasNew ? 'has-new' : ''}`}
      onClick={e => { e.stopPropagation(); onDiscuss(); }}
      aria-label={`Discuss ${name || 'this creator'}`}
      title={n === 0
        ? `Start a discussion about ${name || 'this creator'}`
        : `${n} comment${n === 1 ? '' : 's'}${hasNew ? ' · new reply from the team' : ''}`}>
      <i className="bi bi-chat-left-text" />
      {n > 0 && <span className="pc-cdisc-n">{n > 99 ? '99+' : n}</span>}
    </button>
  );
}

/* The Ads Manager's "tested" checkbox for one video row — shared by the
   creator panel and the Brand Detail authorisation queue so the two read the
   same. `onToggle` absent = read-only. A row with no ad code has nothing to
   test; one reported invalid is waiting on a new code. */
export function testedTitle(row: { tested?: boolean; testedAt?: string; testedBy?: string }): string {
  if (!row.tested) return '';
  const when = row.testedAt ? new Date(row.testedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  return `Tested${row.testedBy ? ` by ${row.testedBy}` : ''}${when ? ` · ${when}` : ''}`;
}
export function TestedBox({ row, blocked, busy, onToggle }: {
  row: { adCode?: string; tested?: boolean; testedAt?: string; testedBy?: string };
  blocked?: boolean;
  busy?: boolean;
  onToggle?: () => void;
}) {
  const hasCode = !!(row.adCode || '').trim();
  const on = !!row.tested && hasCode;
  const tick = on && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>;
  if (!onToggle) {
    return <span className={`pc-vx-auth pc-vx-tested ${on ? 'on' : ''}`} aria-checked={on}
      title={on ? testedTitle(row) : 'Not tested by the Ads Manager yet'}>{tick}</span>;
  }
  const disabled = busy || !hasCode || (blocked && !on);
  return (
    <button type="button" role="checkbox" aria-checked={on}
      className={`pc-vx-auth pc-vx-auth-edit pc-vx-tested ${on ? 'on' : ''}`}
      disabled={disabled}
      title={!hasCode ? 'No ad code to test yet'
        : blocked && !on ? 'Reported invalid — waiting on a new ad code'
        : on ? `${testedTitle(row)} — click to unmark` : 'Mark as tested by the Ads Manager'}
      onClick={e => { e.stopPropagation(); onToggle(); }}>
      {tick}
    </button>
  );
}

/* ════════════════════════════════════════════════════════════
   "Videos & Ad Codes" — ONE creator deal's detail, written once.
   Rendered by the row's own panel (inline or popup) AND by the Performance
   tab's creator popup, which drills into a program. Two copies of this would
   drift, which is the same reason CreatorPanelShell is shared.
════════════════════════════════════════════════════════════ */
export function CreatorVideoPanel({ c, idx, staffView, showGmv, month, onToggleAuth, onToggleTested, onConfirmPaid, onRate }: {
  c: HandlerCreator;
  /** The creator's position in its list — the "1.2" video numbering reads off it. */
  idx: number;
  staffView?: boolean;
  showGmv?: boolean;
  /** The PROGRAM month this panel is being read inside, when there is one. See
      `gmvForMonth`: with it the GMV shown is what this deal earned in THAT month,
      without it the deal's own lifetime figure (the creator popup's per-deal view). */
  month?: string;
  onToggleAuth?: (videoIndex: number, auth: boolean) => void;
  /** The Ads Manager's "tested" verdict (20261009090000). Given = editable;
      absent on a staff view = the column shows read-only. Takes a LIST so
      "Tested all" is one write. Never shown off staff views. */
  onToggleTested?: (videoIndexes: number[], tested: boolean) => Promise<void> | void;
  onConfirmPaid?: (confirmed: boolean) => Promise<void> | void;
  onRate?: (videoIndex: number, rating: number | null) => Promise<void> | void;
}) {
  const [paidBusy, setPaidBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const clientConfirmed = !!c.client_paid_confirmed_at;
  const handleConfirmPaid = async (next: boolean) => {
    if (!onConfirmPaid || paidBusy) return;
    setPaidBusy(true);
    try { await onConfirmPaid(next); } finally { setPaidBusy(false); }
  };
  // Which copy button last fired, as `<kind>:<row>` — the ad code and the video
  // id sit on the same row, so a bare index would tick both at once.
  const [copiedKey, setCopiedKey] = useState('');
  // Which row is mid-write, so only that one's stars go inert.
  const [ratingIdx, setRatingIdx] = useState(-1);
  const rate = async (i: number, n: number | null) => {
    if (!onRate || ratingIdx >= 0) return;
    setRatingIdx(i);
    try { await onRate(i, n); } finally { setRatingIdx(-1); }
  };
  const copyCell = (key: string, value: string) => { copyText(value); setCopiedKey(key); setTimeout(() => setCopiedKey(k => (k === key ? '' : k)), 1400); };
  const accounts = tiktokAccounts(c.tiktok_handle);
  const codes = Array.isArray(c.video_codes) ? c.video_codes : [];
  // The numeric TikTok id behind each link. Derived, never stored — the same
  // rule the Videos table uses (`videoIdFromLine`), so an id copied here and one
  // exported there are the same string. A row with no link yields ''.
  const videoIds = codes.map(v => videoIdFromLine(String(v?.video || '')));
  const allIds = videoIds.filter(Boolean);
  const gmv = month ? gmvForMonth(c, month) : gmvSum(c);
  // The column shows where the client can rate, and anywhere a score already
  // exists — so staff see the verdict without the client's surfaces being the
  // only place it is legible.
  const showRating = !!onRate || codes.some(v => Number(v?.rating) > 0);
  // "1.2" = creator #1's second video, so a link can be named out loud
  // without repeating the creator. Same rule as the handler workspace's
  // CreatorExpand — keep the two in step.
  // Extra videos are numbered on their own ("1.E1") and deal rows skip them,
  // so the numbering matches the handler's CreatorExpand.
  const extraIdx = codes.map((v, i) => (isExtraVideo(v) ? i : -1)).filter(i => i >= 0);
  const videoNo = (i: number) => (isExtraVideo(codes[i])
    ? `${idx}.E${extraIdx.indexOf(i) + 1}`
    : `${idx}.${i + 1 - extraIdx.filter(x => x < i).length}`);
  // Parent owns the optimistic state (so it can revert on failure); we just report the toggle.
  const toggleAuth = (i: number) => { if (onToggleAuth) onToggleAuth(i, !codes[i].auth); };
  // Deal progress only — EXTRA videos (recorded only) never count.
  const dealRows = dealCodes(codes);
  const filled = dealRows.filter(v => isValidUrl(v.video)).length;
  const total = Math.max(dealRows.length, Number(c.videos_count) || 0);
  const pct = total ? filled / total : 0;
  const RING = 2 * Math.PI * 19;
  const adCount = codes.filter(v => (v.adCode || '').trim()).length;
  const authCount = codes.filter(v => v.auth).length;
  const allAuth = adCount > 0 && authCount === adCount;
  // "Tested by Ads Manager" — an internal verdict, staff views only. A row is
  // testable once it has an ad code that has not been reported invalid.
  const showTested = !!staffView;
  const allAdCodes = [...new Set(codes.map(v => (v.adCode || '').trim()).filter(Boolean))];
  const testable = codes.map((v, i) => ((v.adCode || '').trim() && !v.invalid ? i : -1)).filter(i => i >= 0);
  const testedCount = testable.filter(i => codes[i].tested).length;
  const allTested = testable.length > 0 && testedCount === testable.length;
  const setTested = async (indexes: number[], next: boolean) => {
    if (!onToggleTested || testBusy || !indexes.length) return;
    setTestBusy(true);
    try { await onToggleTested(indexes, next); } finally { setTestBusy(false); }
  };
  const toggleTestedAll = () => {
    if (allTested) {
      if (!window.confirm(`Unmark all ${testable.length} video${testable.length === 1 ? '' : 's'} as tested?`)) return;
      setTested(testable, false);
    } else {
      setTested(testable.filter(i => !codes[i].tested), true);
    }
  };
  const prodList = creatorProducts(c);
  const payouts = creatorPayouts(c);
  const contractUrl = signedContractUrl(c);
  const initials = (c.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

  return (
    <div className="pc-vx pc-vx-numbered">
      <div className="pc-vx-head">
        <div className="pc-vx-title">
          <span className="pc-vx-mono">{initials}</span>
          <div className="pc-vx-titletext">
            <div className="pc-vx-h">Videos &amp; Ad Codes</div>
            <div className="pc-vx-sub">{c.name}{accounts[0] ? <> · <span className="pc-vx-sub-h">{accounts[0].handle}</span></> : ''}</div>
          </div>
        </div>
        <div className="pc-vx-actions">
          {showGmv && gmv > 0 && (
            <span className="pc-vx-gmvtag" title={month ? `GMV attributed to this creator in ${monthLabel(month)}` : 'GMV attributed to this creator'}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 7-7" /><path d="M14 8h6v6" /></svg>
              {fmt$(gmv)} GMV
            </span>
          )}
          {/* One click for the whole batch — pasting a creator's ids into
              an ad account is the reason the per-row button exists, and
              doing it link by link is the thing worth removing. Newline
              separated, deduplicated, in the order the videos are listed. */}
          {allIds.length > 0 && (
            <button type="button" className={`pc-vx-copyall ${copiedKey === 'all' ? 'ok' : ''}`}
              title="Copy every video ID in this list"
              onClick={e => { e.stopPropagation(); copyCell('all', [...new Set(allIds)].join('\n')); }}>
              {copiedKey === 'all'
                ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
              {copiedKey === 'all' ? 'Copied' : `Copy all video IDs (${new Set(allIds).size})`}
            </button>
          )}
          {showTested && allAdCodes.length > 0 && (
            <button type="button" className={`pc-vx-copyall ${copiedKey === 'allad' ? 'ok' : ''}`}
              title="Copy every ad code in this list, one per line"
              onClick={e => { e.stopPropagation(); copyCell('allad', allAdCodes.join('\n')); }}>
              {copiedKey === 'allad'
                ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
              {copiedKey === 'allad' ? 'Copied' : `Copy all ad codes (${allAdCodes.length})`}
            </button>
          )}
          {showTested && testable.length > 0 && (onToggleTested ? (
            <button type="button" role="checkbox" aria-checked={allTested}
              className={`pc-vx-testall ${allTested ? 'on' : ''}`} disabled={testBusy}
              title={allTested ? 'Every ad code here is tested — click to unmark all' : 'Mark every ad code here as tested by the Ads Manager'}
              onClick={e => { e.stopPropagation(); toggleTestedAll(); }}>
              <span className="pc-vx-testall-box">
                {allTested && <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
              </span>
              {testBusy ? 'Saving…' : `Tested all (${testedCount}/${testable.length})`}
            </button>
          ) : (
            <span className={`pc-vx-testtally ${allTested ? 'done' : ''}`} title="Tested by the Ads Manager">
              <i className="bi bi-clipboard2-check" /> {testedCount}/{testable.length} tested
            </span>
          ))}
          {contractUrl && (
            <a className="pc-vx-contractlink" href={contractUrl} target="_blank" rel="noopener noreferrer"
              title={signedContractTitle(c)} onClick={e => e.stopPropagation()}>
              <i className="bi bi-file-earmark-check" />
              {(c as any).signed_contract?.signer_name
                ? `Signed by ${(c as any).signed_contract.signer_name}`
                : 'Signed contract'}
            </a>
          )}
          {adCount > 0 && (
            <span className={`pc-vx-authtally ${allAuth ? 'done' : ''}`}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              {authCount}/{adCount} authorised
            </span>
          )}
          <div className={`pc-vx-ring ${total > 0 && filled === total ? 'full' : ''}`}>
            <svg viewBox="0 0 46 46" width="48" height="48">
              <circle className="pc-vx-ring-track" cx="23" cy="23" r="19" />
              <circle className="pc-vx-ring-fill" cx="23" cy="23" r="19" strokeDasharray={RING} strokeDashoffset={RING * (1 - pct)} transform="rotate(-90 23 23)" />
            </svg>
            <span className="pc-vx-ring-txt"><b>{filled}</b><i>/{total}</i></span>
          </div>
        </div>
      </div>
      {prodList.length > 0 && (
        <div className="pc-vx-prods">
          <span className="pc-vx-prods-l">Promoting</span>
          {prodList.map((p, i) => (p.url
            ? <a key={i} className="pc-vx-prod" href={p.url} target="_blank" rel="noopener noreferrer"><span className="pc-vx-prod-dot" />{p.name || 'Product'}<span className="pc-vx-prod-go">↗</span></a>
            : <span key={i} className="pc-vx-prod"><span className="pc-vx-prod-dot" />{p.name}</span>))}
        </div>
      )}
      {payouts.length > 0 && (
        <div className="pc-vx-payouts">
          {payouts.map((p, i) => <PayoutDetail key={i} label={p.label} value={p.value} />)}
        </div>
      )}
      {/* Client "process payment & mark as done" panel — only on the client
          share view (onConfirmPaid set) while the deal is payment-pending. */}
      {onConfirmPaid && clientStatus(c) === 'pending' && (
        <div className={`pc-paynudge ${clientConfirmed ? 'done' : ''}`}>
          <div className="pc-paynudge-ic">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {clientConfirmed ? <path d="M20 6 9 17l-5-5" /> : <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>}
            </svg>
          </div>
          <div className="pc-paynudge-body">
            <div className="pc-paynudge-title">
              {clientConfirmed ? 'Payment marked as done' : 'Action needed — process this payment'}
            </div>
            <div className="pc-paynudge-text">
              {clientConfirmed
                ? <>Thanks{c.client_paid_confirmed_name ? `, ${c.client_paid_confirmed_name}` : ''} — the team has been notified and will verify, then finalize the status.</>
                : <>Please process the payment{payouts[0] ? <> via {payouts[0].label} (<b>{payouts[0].value}</b>){payouts.length > 1 ? <> — other methods are listed above</> : ''}</> : ''}, then mark it as done below. The team will cross-check and finalize.</>}
            </div>
          </div>
          <button type="button"
            className={`pc-paynudge-btn ${clientConfirmed ? 'on' : ''}`}
            aria-pressed={clientConfirmed}
            disabled={paidBusy}
            onClick={e => { e.stopPropagation(); handleConfirmPaid(!clientConfirmed); }}
            title={clientConfirmed ? 'Undo — mark as not paid' : 'Mark this payment as done'}>
            <span className="pc-paynudge-knob" />
            <span className="pc-paynudge-btn-txt">{paidBusy ? 'Saving…' : clientConfirmed ? 'Marked as paid' : 'Mark as paid'}</span>
          </button>
        </div>
      )}
      {/* Read-only badge so handler / Bob / APC views can see the client's claim. */}
      {!onConfirmPaid && clientConfirmed && (
        <div className="pc-paynudge done compact">
          <div className="pc-paynudge-ic">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div className="pc-paynudge-body">
            <div className="pc-paynudge-title">Client marked this payment as done</div>
            <div className="pc-paynudge-text">
              {c.client_paid_confirmed_name ? <><b>{c.client_paid_confirmed_name}</b> · </> : null}
              Cross-check, then set the status to Payment Sent.
            </div>
          </div>
        </div>
      )}
      {/* "Added" is an internal operational detail (when the link reached
          us, not when the creator posted), so it stays off the client
          portal and the public share link — same gate as the Invalid tag. */}
      <div className={`pc-vx-collabels ${staffView ? 'pc-vx-rodate' : ''} ${showRating ? 'pc-vx-rate' : ''} ${showTested ? 'pc-vx-tst' : ''}`}>
        <span className="pc-vx-cl-no">No.</span><span>Video</span><span>Ad code</span>
        {showRating && <span className="pc-vx-cl-rate">Rating</span>}
        <span className="pc-vx-cl-auth">Authorised</span>
        {showTested && <span className="pc-vx-cl-auth" title="Tested by the Ads Manager">Tested</span>}
        {staffView && <span className="pc-vx-cl-added">Added</span>}
        <span />
      </div>
      <div className="pc-vx-list">
        {codes.length === 0 ? (
          <div className="pc-handle" style={{ padding: '8px 4px' }}>No videos added yet.</div>
        ) : codes.map((row, i) => {
          const vOk = isValidUrl(row.video);
          // "Invalid ad code" is an internal verdict (staff → handler) —
          // never surfaced on the client portal / share link.
          const bad = !!row.invalid && !!staffView;
          return (
            <div className={`pc-vx-row ${staffView ? 'pc-vx-rodate' : ''} ${showRating ? 'pc-vx-rate' : ''} ${showTested ? 'pc-vx-tst' : ''} ${vOk && !bad ? 'done' : ''} ${bad ? 'pc-vx-row-bad' : ''}`} key={i}>
              <span className={`pc-vx-num ${isExtraVideo(row) ? 'pc-vx-num-extra' : ''}`}
                title={isExtraVideo(row) ? `Extra video ${videoNo(i)} — made beyond the deal, recorded only` : `Video ${videoNo(i)}`}>{videoNo(i)}</span>
              <div className="pc-vx-inp" style={{ alignItems: 'center' }}>
                <span className="pc-vx-inp-ico"><svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M8 5v14l11-7z" /></svg></span>
                {vOk
                  ? <a className="pc-handle pc-vx-val" href={row.video} target="_blank" rel="noopener noreferrer" title={row.video} onClick={e => e.stopPropagation()}>{row.video}</a>
                  : <span className="pc-handle pc-vx-val" title={row.video || ''}>{row.video || '—'}</span>}
                {/* The id, not the link — that is what an ad account and a
                    report ask for, and reading it out of the URL by hand is
                    the step this removes. Absent when the line carries none. */}
                {videoIds[i] ? (
                  <button type="button" className={`pc-vx-copy ${copiedKey === `id:${i}` ? 'ok' : ''}`}
                    title={`Copy video ID ${videoIds[i]}`} aria-label={`Copy video ID ${videoIds[i]}`}
                    onClick={e => { e.stopPropagation(); copyCell(`id:${i}`, videoIds[i]); }}>
                    {copiedKey === `id:${i}`
                      ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                  </button>
                ) : null}
              </div>
              <div className="pc-vx-inp pc-vx-inp-ad" style={{ alignItems: 'center' }}>
                <span className="pc-vx-inp-ico">#</span>
                <span className="pc-vx-val" title={row.adCode || ''}>{row.adCode || '—'}</span>
                {bad && (
                  <span className="pc-vx-badtag" title={row.invalidBy ? `Reported invalid by ${row.invalidBy}` : 'Reported invalid — new ad code requested'}>
                    Invalid
                  </span>
                )}
                {row.adCode ? (
                  <button type="button" className={`pc-vx-copy ${copiedKey === `ad:${i}` ? 'ok' : ''}`} title="Copy ad code" onClick={e => { e.stopPropagation(); copyCell(`ad:${i}`, row.adCode); }}>
                    {copiedKey === `ad:${i}`
                      ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                  </button>
                ) : null}
              </div>
              {showRating && (
                /* A row with no link has nothing to watch, so nothing to
                   score — the DB refuses it too. */
                vOk
                  ? <VideoStars value={row.rating} by={row.ratedBy} busy={ratingIdx === i}
                      onRate={onRate ? (n => rate(i, n)) : undefined} />
                  : <span className="pc-stars is-empty" aria-hidden>—</span>
              )}
              {onToggleAuth ? (
                <button type="button" role="checkbox" aria-checked={row.auth}
                  className={`pc-vx-auth pc-vx-auth-edit ${row.auth ? 'on' : ''}`}
                  disabled={bad}
                  title={bad ? 'Reported invalid — waiting on a new ad code'
                    : row.auth ? 'Authorised — click to unmark' : 'Mark as authorised'}
                  onClick={e => { e.stopPropagation(); toggleAuth(i); }}>
                  {row.auth && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </button>
              ) : (
                <span className={`pc-vx-auth ${row.auth ? 'on' : ''}`} aria-checked={row.auth}>
                  {row.auth && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </span>
              )}
              {showTested && (
                <TestedBox row={row} blocked={bad} busy={testBusy}
                  onToggle={onToggleTested ? (() => setTested([i], !row.tested)) : undefined} />
              )}
              {staffView && (
                <span className={`pc-vx-added ${row.videoAt ? '' : 'none'}`} data-label="Added"
                  title={videoAddedTitle(row.videoAt)}>
                  {videoAddedLabel(row.videoAt)}
                </span>
              )}
              <a className="pc-vx-open" href={vOk ? row.video : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!vOk}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Thread state for one creator's Discussion button: how many comments it holds,
// and whether any of them is a team reply the client has not seen yet.
export interface CreatorDiscuss { count: number; hasNew?: boolean }

export function CreatorRowRO({ c, idx, onToggleAuth, onToggleTested, onConfirmPaid, staffView, onDiscuss, discuss, asModal, onRate, showGmv, month }: {
  c: HandlerCreator; idx: number;
  // When provided, the row gains a Discussion column opening THIS creator's own
  // comment thread (target_type 'creator', target_key = the creator id — both
  // already supported by paid_collab_comments and the public post edge fn).
  // Opt-in: surfaces with no commenting (Brand Detail overview) pass nothing and
  // keep the 10-column grid.
  onDiscuss?: () => void;
  discuss?: CreatorDiscuss;
  // When provided, the "Authorised" cell becomes a clickable checkbox (APC/Bob).
  onToggleAuth?: (videoIndex: number, auth: boolean) => void;
  onToggleTested?: (videoIndexes: number[], tested: boolean) => Promise<void> | void;
  // When provided (client share view) and the creator is payment-pending, the
  // expanded panel shows a "process payment & mark as paid" toggle for the client.
  onConfirmPaid?: (confirmed: boolean) => Promise<void> | void;
  // Staff surfaces (Bob/APC brand tab) keep the internal "Follow-up Required"
  // status; client/share views mask it (see clientStatus).
  staffView?: boolean;
  // Open the detail in a popup rather than expanding it under the row.
  asModal?: boolean;
  // The CLIENT's star rating for one video. Provided only on the client's own
  // surfaces (share link, signed-in portal); everywhere else the stars render
  // read-only, so a score always means "what the client said".
  onRate?: (videoIndex: number, rating: number | null) => Promise<void> | void;
  // Adds a GMV column to the row and a GMV figure to the detail panel. OPT-IN,
  // like the Discussion column, because the grid is shared with surfaces that
  // deliberately keep the 10-column layout (see .pc-ct-gmv in handlerCollab.css).
  showGmv?: boolean;
  /** The PROGRAM month this row is listed under. Given one, GMV is what the deal
      earned IN THAT MONTH (`gmvForMonth`) rather than its lifetime total — so the
      column adds up to the program's own header instead of to every month the
      creator has ever billed. */
  month?: string;
}) {
  const [open, setOpen] = useState(false);
  const accounts = tiktokAccounts(c.tiktok_handle);
  const codes = Array.isArray(c.video_codes) ? c.video_codes : [];
  const gmv = month ? gmvForMonth(c, month) : gmvSum(c);
  /* Signed into an EARLIER month and still selling in this one. Marked because
     the row's Deal / Videos are that earlier month's commitment and are
     deliberately NOT in this program's Allocated — see `programStats`. Without
     the chip the reader is left with a column that does not add up. */
  const carried = carriedOver(c, month || '');
  const carriedFrom = carried ? monthLabel(dealMonth(c)) : '';
  const carriedTitle = carried ? `Signed in ${carriedFrom} and still selling in ${monthLabel(month || '')} — their fee counts toward ${carriedFrom}'s budget, not this one` : undefined;
  const dealRows = dealCodes(codes);
  const filled = dealRows.filter(v => isValidUrl(v.video)).length;
  const extras = extraCodes(codes).filter(v => isValidUrl(v.video)).length;
  const total = Math.max(dealRows.length, Number(c.videos_count) || 0);
  const st = STATUS[clientStatus(c, staffView)] || STATUS.videos_in_progress;
  const payouts = creatorPayouts(c);
  const contractUrl = signedContractUrl(c);

  return (
    <>
      <div className={`pc-ct-row ${open ? 'open' : ''} ${onDiscuss ? 'pc-ct-disc' : ''} ${showGmv ? 'pc-ct-gmv' : ''}`} onClick={() => setOpen(o => !o)} role="button" tabIndex={0}
        aria-label={asModal ? `Open ${c.name || 'creator'} details` : undefined}
        aria-expanded={asModal ? undefined : open}>
        <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{idx}</span></div>
        <div className="pc-cell" data-label="Completed on">{c.completed_on ? fmtDate(c.completed_on) : <span className="pc-handle">—</span>}</div>
        <div className="pc-cell" data-label="Name">
          <span className="pc-cname">{c.name}</span>
          {carried && <span className="pc-carried" title={carriedTitle}>from {carriedFrom}</span>}
        </div>
        <div className="pc-cell" data-label="TikTok">
          {accounts.length > 0
            ? <span className="pc-tiktok"><a className="pc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>{accounts.length > 1 && <span className="pc-more">+{accounts.length - 1}</span>}</span>
            : <span className="pc-handle">—</span>}
        </div>
        <div className="pc-cell pc-num" data-label="Amount"><span className="pc-money">{fmt$(Number(c.amount) || 0)}</span></div>
        {showGmv && (
          <div className="pc-cell pc-num" data-label="GMV">
            {gmv > 0 ? <span className="pc-money pc-green">{fmt$(gmv)}</span> : <span className="pc-handle">—</span>}
          </div>
        )}
        <div className="pc-cell pc-num" data-label="Videos">
          {/* Deal videos added / agreed — "0/5" until the first link lands. Extra
              videos (outside the deal) never count; they ride as a "+N" tag. */}
          <span className={`pc-vidprog ${(Number(c.videos_count) || 0) > 0 && filled >= (Number(c.videos_count) || 0) ? 'done' : ''}`}>{filled}/{(Number(c.videos_count) || 0)}</span>
          {extras > 0 ? <span className="pc-extra-tag" title={`${extras} extra video${extras > 1 ? 's' : ''} — made beyond the deal, recorded only`}>+{extras}</span> : ''}
        </div>
        <div className="pc-cell" data-label="Payout"><PayoutChipsRO payouts={payouts} /></div>
        <div className="pc-cell" data-label="Status"><span className={`pc-badge ${st.cls}`}><span className="dot" />{st.label}</span></div>
        <div className="pc-cell pc-contract-cell" data-label="Contract">
          {contractUrl
            ? (
              <a className="pc-contract-btn pc-clink has" href={contractUrl} target="_blank" rel="noopener noreferrer"
                title={signedContractTitle(c)} aria-label="Open signed contract" onClick={e => e.stopPropagation()}>
                <i className="bi bi-file-earmark-check" />
              </a>
            )
            : <span className="pc-handle">—</span>}
        </div>
        {onDiscuss && (
          <div className="pc-cell pc-cdisc-cell" data-label="Discussion">
            <DiscussBtn onDiscuss={onDiscuss} discuss={discuss} name={c.name} />
          </div>
        )}
        <div className="pc-cell pc-num" data-label="Content">
          <span className="pc-content-cell">
            {/* A chevron says "this expands". A popup does not expand, so the
                share link gets a framed expand glyph that reads as "open". */}
            {asModal
              ? <span className="pc-openbtn" aria-hidden><i className="bi bi-arrows-angle-expand" /></span>
              : (open ? '▴' : '▾')}
          </span>
        </div>

        {/* ── purpose-built mobile card (≤900px the cells above are hidden) ── */}
        <div className="pc-mc">
          <div className="pc-mc-head">
            <div className="pc-mc-idblock">
              <div className="pc-mc-name">{c.name}</div>
              <div className="pc-mc-subline">
                {accounts[0]
                  ? <a className="pc-mc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>
                  : <span className="pc-mc-muted">no TikTok</span>}
                {accounts.length > 1 && <span className="pc-more">+{accounts.length - 1}</span>}
                {c.completed_on && <><span className="pc-mc-dot">·</span><span className="pc-mc-muted">{fmtDate(c.completed_on)}</span></>}
                {carried && <span className="pc-carried" title={carriedTitle}>from {carriedFrom}</span>}
              </div>
            </div>
            {asModal
              ? <span className="pc-openbtn" aria-hidden><i className="bi bi-arrows-angle-expand" /></span>
              : <span className={`pc-mc-chev ${open ? 'open' : ''}`} aria-hidden>▾</span>}
          </div>
          <div className={`pc-mc-stats ${showGmv ? 'pc-mc-stats-4' : 'pc-mc-stats-3'}`}>
            <div className="pc-mc-stat"><b>{fmt$(Number(c.amount) || 0)}</b><span>Deal</span></div>
            {showGmv && <div className="pc-mc-stat"><b className={gmv ? 'pc-green' : ''}>{gmv ? fmt$(gmv) : '—'}</b><span>GMV</span></div>}
            <div className="pc-mc-stat"><b>{c.videos_count || '—'}</b><span>Videos</span></div>
            <div className="pc-mc-stat"><b className={filled ? 'pc-green' : ''}>{filled}/{total || 0}</b><span>Delivered</span></div>
          </div>
          <div className="pc-mc-foot">
            <span className={`pc-badge ${st.cls}`}><span className="dot" />{st.label}</span>
            {contractUrl && (
              <a className="pc-contract-btn pc-clink has" href={contractUrl} target="_blank" rel="noopener noreferrer"
                title={signedContractTitle(c)} aria-label="Open signed contract" onClick={e => e.stopPropagation()}>
                <i className="bi bi-file-earmark-check" />
              </a>
            )}
            {payouts.length > 0 && <span className="pc-mc-footmeta"><PayoutChipsRO payouts={payouts} /></span>}
            {onDiscuss && <DiscussBtn onDiscuss={onDiscuss} discuss={discuss} name={c.name} />}
          </div>
        </div>
      </div>
      {open && (
        <CreatorPanelShell asModal={asModal} name={c.name} handle={accounts[0]?.handle} onClose={() => setOpen(false)}>
          <CreatorVideoPanel c={c} idx={idx} staffView={staffView} showGmv={showGmv} month={month}
            onToggleAuth={onToggleAuth} onToggleTested={onToggleTested} onConfirmPaid={onConfirmPaid} onRate={onRate} />
        </CreatorPanelShell>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   The Performance tab's creator popup — one PERSON, and the programs of this
   brand they have run.

   A `handler_collab_creators` row is ONE DEAL (one brand-month = one program),
   so a creator who ran three months is three rows. This popup is the person:
   deals are grouped on `creatorBrandKey` — handle, else name, SCOPED BY BRAND,
   the repo-wide identity rule (creatorIdentityKey / creatorNoteKey), never
   across brands.

   One program means there is nothing to choose, so its videos render straight
   away. Several means pick one first, and picking drills IN (with a way back)
   rather than stacking a second modal — a modal over a modal is unreadable on
   a phone, and "‹ All programs" is the idiom the share link already uses.
════════════════════════════════════════════════════════════ */
export function creatorBrandKey(c: { brand_id?: string | null; tiktok_handle?: string | null; name?: string | null }): string {
  const first = String(c.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  return `${c.brand_id || ''}|${creatorIdentityKey({ handle: first.startsWith('http') ? tiktokHandle(first) : first, name: c.name || '' })}`;
}

/* One PERSON's record with a brand: the programs they have run and what each
   one is worth. ‼️ The GMV here is each DEAL's LIFETIME figure (`gmvSum`), not
   the program month's — deliberately, and unlike a program's own creator list.
   A row here IS the deal, the panel behind it is the deal's videos, and the
   summary above adds the rows up; scoping a row to its onboarding month would
   drop every later month that deal earned in out of a total that claims to be
   the person's. The month beside a row names the program the deal was SIGNED
   into, which is what identifies it. */
export function CreatorProgramsModal({ deals, onClose, staffView, showGmv, onToggleAuth, onConfirmPaid, onRate }: {
  /** Every deal this person holds with the brand. Newest program first. */
  deals: HandlerCreator[];
  onClose: () => void;
  staffView?: boolean;
  showGmv?: boolean;
  onToggleAuth?: (creatorId: string, videoIndex: number, auth: boolean) => void;
  onConfirmPaid?: (creatorId: string, confirmed: boolean) => Promise<void> | void;
  onRate?: (creatorId: string, videoIndex: number, rating: number | null) => Promise<void> | void;
}) {
  const single = deals.length === 1;
  // With one program there is nothing to pick, so open it. With several, the
  // list is the landing view.
  const [openId, setOpenId] = useState<string | null>(single ? deals[0].id : null);
  const person = deals[0];
  const accounts = tiktokAccounts(person?.tiktok_handle || '');
  const open = deals.find(d => d.id === openId) || null;
  const openIdx = open ? deals.indexOf(open) + 1 : 1;

  const rows = deals.map(d => ({
    d,
    month: dealMonth(d),
    del: deliveredCount(d),
    ag: Number(d.videos_count) || 0,
    gmv: gmvSum(d),
    st: STATUS[clientStatus(d, staffView)] || STATUS.videos_in_progress,
  }));
  const totalGmv = rows.reduce((t, r) => t + r.gmv, 0);
  const totalDel = rows.reduce((t, r) => t + r.del, 0);
  const totalAg = rows.reduce((t, r) => t + r.ag, 0);
  const totalDeal = deals.reduce((t, d) => t + (Number(d.amount) || 0), 0);

  return (
    <CreatorPanelShell asModal name={person?.name} handle={accounts[0]?.handle} onClose={onClose}>
      {/* The summary is the PERSON's, so it stays put while you drill into a
          program — otherwise going one level down would look like the creator's
          totals had just changed. */}
      <div className="pc-cpm-sum">
        <div className="pc-cpm-stat"><b>{deals.length}</b><span>Program{deals.length === 1 ? '' : 's'}</span></div>
        <div className="pc-cpm-stat"><b>{totalDel}<i>/{totalAg || totalDel || 0}</i></b><span>Videos</span></div>
        <div className="pc-cpm-stat"><b className={totalGmv ? 'pc-green' : ''}>{totalGmv ? fmt$(totalGmv) : '—'}</b><span>GMV</span></div>
        <div className="pc-cpm-stat"><b>{fmt$(totalDeal)}</b><span>Deal value</span></div>
      </div>

      {!single && (
        <div className="pc-cpm-progs">
          {open
            ? <button type="button" className="pc-cpm-back" onClick={() => setOpenId(null)}>‹ All programs</button>
            : <div className="pc-cpm-progs-h">Programs</div>}
          {!open && rows.map(r => (
            <button type="button" key={r.d.id} className="pc-cpm-prog" onClick={() => setOpenId(r.d.id)}>
              <span className="pc-cpm-prog-m">
                <span className="pc-cpm-prog-name">{monthLabel(r.month)}</span>
                <span className="pc-cpm-prog-sub">{r.del}/{r.ag || r.del || 0} video{(r.ag || r.del) === 1 ? '' : 's'} · {fmt$(Number(r.d.amount) || 0)} deal</span>
              </span>
              <span className={`pc-cpm-prog-gmv ${r.gmv ? 'has' : ''}`}
                title={r.gmv ? `Everything this deal has earned since it was signed in ${monthLabel(r.month)}` : undefined}>{r.gmv ? fmt$(r.gmv) : '—'}</span>
              <span className={`pc-badge ${r.st.cls}`}><span className="dot" />{r.st.label}</span>
              <span className="pc-cpm-prog-go" aria-hidden>›</span>
            </button>
          ))}
          {open && <div className="pc-cpm-progtag">{monthLabel(dealMonth(open))}</div>}
        </div>
      )}

      {open && (
        <CreatorVideoPanel c={open} idx={openIdx} staffView={staffView} showGmv={showGmv}
          onToggleAuth={onToggleAuth ? ((i, a) => onToggleAuth(open.id, i, a)) : undefined}
          onConfirmPaid={onConfirmPaid ? (v => onConfirmPaid(open.id, v)) : undefined}
          onRate={onRate ? ((i, n) => onRate(open.id, i, n)) : undefined} />
      )}
    </CreatorPanelShell>
  );
}

export function CreatorListHeadRO({ discuss, showGmv }: { discuss?: boolean; showGmv?: boolean } = {}) {
  return (
    <div className={`pc-ct-head ${discuss ? 'pc-ct-disc' : ''} ${showGmv ? 'pc-ct-gmv' : ''}`}>
      <div className="pc-num">#</div><div>Completed on</div><div>Name</div><div>TikTok</div><div className="pc-num">Amount</div>
      {showGmv && <div className="pc-num">GMV</div>}
      <div className="pc-num">Videos</div><div>Payout</div><div>Status</div><div>Contract</div>
      {discuss && <div>Discussion</div>}
      <div className="pc-num">Content</div>
    </div>
  );
}

const STATUS_GROUP_ORDER = ['pending', 'follow_up', 'videos_in_progress', 'paid'];
const statusGroupKey = (c: HandlerCreator, staff?: boolean) => { const s = clientStatus(c, staff); return STATUS[s] ? s : 'videos_in_progress'; };

// Read-only creator list grouped by payment status (Payment Pending → Videos in
// Progress → Payment Sent), each introduced by a labelled divider — mirrors the
// handler Workspace drilldown. `creators` should be pre-sorted; order is preserved
// within each group and the # index runs continuously top-to-bottom.
export function CreatorStatusGroupsRO({ creators, onToggleAuth, onConfirmPaid, staffView, onDiscuss, discuss, asModal, onRate, showGmv, month }: {
  creators: HandlerCreator[];
  onToggleAuth?: (creatorId: string, videoIndex: number, auth: boolean) => void;
  onConfirmPaid?: (creatorId: string, confirmed: boolean) => Promise<void> | void;
  staffView?: boolean;
  // Per-creator discussion (client share link / portal). Pass both, or neither —
  // `discuss` alone draws a column whose buttons do nothing.
  onDiscuss?: (creatorId: string) => void;
  discuss?: Record<string, CreatorDiscuss>;
  // Open each creator's detail in a popup instead of an inline accordion.
  asModal?: boolean;
  // Client star ratings (share link / signed-in portal only).
  onRate?: (creatorId: string, videoIndex: number, rating: number | null) => Promise<void> | void;
  // Draws the GMV column. Must match what the caller passed CreatorListHeadRO,
  // or the headings and the cells fall out of step.
  showGmv?: boolean;
  /** The PROGRAM month this list belongs to — see CreatorRowRO's `month`. */
  month?: string;
}) {
  let n = 0;
  // Safety net: terminated / awaiting-confirmation deals are internal-only and
  // never render here (callers also strip them at the data source, so their
  // KPIs match this list).
  const shown = withoutInternalOnly(creators);
  const groups = STATUS_GROUP_ORDER
    .map(val => ({ val, st: STATUS[val], items: shown.filter(c => statusGroupKey(c, staffView) === val) }))
    .filter(g => g.items.length > 0);
  return (
    <>
      {groups.map(g => (
        <Fragment key={g.val}>
          <div className={`pc-ct-group ${g.st.cls}`}>
            <span className="pc-ct-group-label">
              <span className={`pc-statusdot ${g.st.cls}`} />{g.st.label}
              <span className="pc-ct-group-count">{g.items.length}</span>
            </span>
          </div>
          {g.items.map(c => { n += 1; return <CreatorRowRO key={c.id} c={c} idx={n} staffView={staffView} onToggleAuth={onToggleAuth ? (i, a) => onToggleAuth(c.id, i, a) : undefined} onConfirmPaid={onConfirmPaid ? (v) => onConfirmPaid(c.id, v) : undefined} onDiscuss={onDiscuss ? () => onDiscuss(c.id) : undefined} discuss={discuss?.[c.id]} asModal={asModal} showGmv={showGmv} month={month} onRate={onRate ? ((i, n) => onRate(c.id, i, n)) : undefined} />; })}
        </Fragment>
      ))}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   Performance report — client-facing reporting dashboard (read-only).
   Mirrors the handler's Internal Reporting: Monthly/Weekly lens, week selector,
   KPI tiles, GMV vs Ad area chart, payment mix, top creators + insights.
   Shared by the public share link's "Performance" tab and the client portal
   dashboard — both pass a brand + that brand's creators (current handler-collab model).
════════════════════════════════════════════════════════════ */
export interface PerfBrand { id: string; name: string; client: string | null; currency?: string | null }

const PR_STATUS: Record<string, { label: string; cls: string; color: string }> = {
  videos_in_progress: { label: 'In progress', cls: 'prog', color: '#1259C3' },
  pending:            { label: 'Pending',     cls: 'pend', color: '#E8862E' },
  paid:               { label: 'Paid',        cls: 'paid', color: '#198754' },
};
export const prAddDays = (k: string, n: number) => { const d = new Date(k + 'T00:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const prRangeShort = (s: string, e: string) => { const a = new Date(s + 'T00:00:00'), b = new Date(e + 'T00:00:00'); const am = a.toLocaleDateString('en-US', { month: 'short' }), bm = b.toLocaleDateString('en-US', { month: 'short' }); return am === bm ? `${am} ${a.getDate()}–${b.getDate()}` : `${am} ${a.getDate()} – ${bm} ${b.getDate()}`; };
const prRangeLong = (s: string, e: string) => { const f = (k: string) => new Date(k + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); return `${f(s)} – ${f(e)}`; };
const prMonthShort = (k: string) => { const [y, m] = k.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); };

export function PerformanceReport({ brand, creators: allCreators, onDiscuss, showGmv, onToggleAuth, onConfirmPaid, onRate }: {
  brand: PerfBrand; creators: HandlerCreator[];
  onDiscuss?: (tt: string, tk: string) => void;
  // Passed straight through to the creator popup's video panel. All optional —
  // this is a report, so with none of them the popup is purely read-only.
  showGmv?: boolean;
  onToggleAuth?: (creatorId: string, videoIndex: number, auth: boolean) => void;
  onConfirmPaid?: (creatorId: string, confirmed: boolean) => Promise<void> | void;
  onRate?: (creatorId: string, videoIndex: number, rating: number | null) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<'monthly' | 'weekly'>('weekly');
  const [weekSel, setWeekSel] = useState<string | null>(null);
  // Which PERSON's popup is open, as their brand-scoped identity key — not a
  // deal id: the popup is the person, and holding a row's id would pin it to
  // the one program that row happens to be.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const isWeekly = mode === 'weekly';
  // Money in this brand's currency ($/£/€). Set during render so fmt$ below uses it.
  setReportCurrency(brand.currency);
  // Terminated / awaiting-confirmation deals are internal-only — excluded from this
  // client-facing report (drives every KPI/trend/chart below, so counts stay
  // consistent with the rows).
  const creators = useMemo(() => withoutInternalOnly(allCreators), [allCreators]);

  const weekKeys = useMemo(() => {
    const s = new Set<string>();
    creators.forEach(c => { const w = (c.monthly as any)?.weeks || {}; Object.keys(w).forEach(k => s.add(k)); });
    return [...s].sort();
  }, [creators]);
  const activeWeek = isWeekly && weekSel && weekKeys.includes(weekSel) ? weekSel : null;

  /* Only a PICKED WEEK narrows the figure. "All weeks" and "Monthly" both mean
     everything, so they must produce the SAME number — the switch chooses how
     the chart is bucketed, not which money counts. Before this they disagreed:
     "all weeks" summed the weeks bag alone, so a brand whose handler logs
     monthly showed every creator at "—" in the default view while their popup
     (which reads the deal) showed the real figure. */
  const pGmv = (c: HandlerCreator) => {
    if (isWeekly && activeWeek) return Number(((c.monthly as any)?.weeks || {})[activeWeek]?.gmv) || 0;
    return gmvSum(c);
  };
  const pAd = (c: HandlerCreator) => {
    if (isWeekly && activeWeek) return Number(((c.monthly as any)?.weeks || {})[activeWeek]?.adSpent) || 0;
    return adSum(c);
  };

  const kpis = useMemo(() => {
    let gmv = 0, ad = 0, del = 0, ag = 0, active = 0, pending = 0;
    creators.forEach(c => {
      gmv += pGmv(c); ad += pAd(c); del += deliveredCount(c); ag += Number(c.videos_count) || 0;
      if (c.payment_status !== 'paid') active += 1;
      if (isPendingVisible(c)) pending += 1;
    });
    const pipeline = creators.reduce((t, c) => t + Math.max(0, (Number(c.videos_count) || 0) - deliveredCount(c)), 0);
    return { gmv, ad, roas: ad > 0 ? gmv / ad : 0, del, ag, active, pipeline, pending, count: creators.length };
  }, [creators, isWeekly, activeWeek]);

  const trend = useMemo(() => {
    if (isWeekly) {
      return weekKeys.map(k => {
        let gmv = 0, ad = 0;
        creators.forEach(c => { const cell = (c.monthly as any)?.weeks?.[k]; if (cell) { gmv += Number(cell.gmv) || 0; ad += Number(cell.adSpent) || 0; } });
        return { label: prRangeShort(k, prAddDays(k, 6)), gmv, ad };
      });
    }
    const ms = new Set<string>();
    creators.forEach(c => { const mm: any = c.monthly || {}; Object.keys(mm).forEach(k => { if (/^\d{4}-\d{2}$/.test(k)) ms.add(k); }); });
    return [...ms].sort().map(k => {
      let gmv = 0, ad = 0;
      creators.forEach(c => { const cell = (c.monthly as any)?.[k]; if (cell) { gmv += Number(cell.gmv) || 0; ad += Number(cell.adSpent) || 0; } });
      return { label: prMonthShort(k), gmv, ad };
    });
  }, [creators, isWeekly, weekKeys]);

  const payMix = useMemo(() => {
    const m: any = { videos_in_progress: 0, pending: 0, paid: 0 };
    creators.forEach(c => { const s = clientStatus(c); m[s] = (m[s] || 0) + 1; });
    return Object.keys(PR_STATUS).map(k => ({ name: PR_STATUS[k].label, value: m[k] || 0, color: PR_STATUS[k].color })).filter(x => x.value > 0);
  }, [creators]);

  const rows = useMemo(() =>
    creators.map(c => ({ c, key: creatorBrandKey(c), del: deliveredCount(c), ag: Number(c.videos_count) || 0, gmv: pGmv(c) }))
      .sort((a, b) => b.gmv - a.gmv || b.del - a.del).slice(0, 10),
  [creators, isWeekly, activeWeek]);

  // identity → every deal that person holds. Built from the UNTRUNCATED list, so
  // a creator whose second program missed the top-10 cut still shows both in
  // their popup. `creators` (not `allCreators`) so an internal-only deal cannot
  // reach a client-facing popup through the back door.
  const dealsByPerson = useMemo(() => {
    const m = new Map<string, HandlerCreator[]>();
    creators.forEach(c => {
      const k = creatorBrandKey(c);
      (m.get(k) || (m.set(k, []), m.get(k)!)).push(c);
    });
    // Newest program first, matching every other program list in the app.
    m.forEach(list => list.sort((a, b) => String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || ''))));
    return m;
  }, [creators]);
  const openDeals = openKey ? dealsByPerson.get(openKey) : undefined;

  const insights = useMemo(() => {
    const list: any[] = [];
    const top = [...creators].map(c => ({ c, gmv: pGmv(c) })).sort((a, b) => b.gmv - a.gmv)[0];
    if (top && top.gmv > 0) list.push({ tone: 'good', icon: 'bi-trophy-fill', text: <><b>{top.c.name}</b> leads with <b>{fmt$(top.gmv)}</b> GMV.</> });
    if (kpis.ad > 0) list.push({ tone: kpis.roas >= 1 ? 'good' : 'warn', icon: 'bi-graph-up-arrow', text: <>ROAS <b>{kpis.roas.toFixed(2)}x</b> on {fmt$(kpis.ad)} ad spend.</> });
    if (kpis.pipeline > 0) list.push({ tone: 'info', icon: 'bi-hourglass-split', text: <><b>{kpis.pipeline}</b> video{kpis.pipeline === 1 ? '' : 's'} in pipeline across <b>{kpis.active}</b> active creator{kpis.active === 1 ? '' : 's'}.</> });
    if (!isWeekly) { const cur = trend[trend.length - 1]?.gmv || 0, prev = trend[trend.length - 2]?.gmv || 0; if (prev > 0) { const pct = Math.round(((cur - prev) / prev) * 100); list.push({ tone: pct >= 0 ? 'good' : 'warn', icon: pct >= 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right', text: <>GMV {pct >= 0 ? 'up' : 'down'} <b>{Math.abs(pct)}%</b> vs the previous month.</> }); } }
    if (kpis.pending > 0) list.push({ tone: 'warn', icon: 'bi-cash-stack', text: <><b>{kpis.pending}</b> payment{kpis.pending === 1 ? '' : 's'} pending.</> });
    return list.slice(0, 5);
  }, [creators, kpis, trend, isWeekly, activeWeek]);

  const fewPoints = trend.filter(t => (t.gmv || 0) || (t.ad || 0)).length <= 1;
  const lblMoney = (v: any) => (Number(v) > 0 ? fmt$(v) : '');
  const moneyTip = (v: any) => fmt$(Number(v) || 0);

  return (
    <div className="pc-rd">
      <div className="pc-rd-top">
        <div>
          <h2 className="pc-rd-title">Performance report</h2>
          <div className="pc-rd-sub">
            {isWeekly
              ? <>Weekly · {activeWeek ? <b>{prRangeShort(activeWeek, prAddDays(activeWeek, 6))}</b> : 'all weeks'} · {brand.name}</>
              : <>Monthly · {brand.name}</>}
          </div>
        </div>
        <div className="pc-rd-actions">
          <div className="pc-seg" role="tablist" aria-label="Performance period">
            <button type="button" className={`pc-seg-btn ${!isWeekly ? 'active' : ''}`} onClick={() => setMode('monthly')}>Monthly</button>
            <button type="button" className={`pc-seg-btn ${isWeekly ? 'active' : ''}`} onClick={() => setMode('weekly')}>Weekly</button>
          </div>
        </div>
      </div>

      {isWeekly && (
        <PillRow label={<><i className="bi bi-calendar3" /> Week</>}>
          <button className={`pc-rd-week ${!activeWeek ? 'active' : ''}`} onClick={() => setWeekSel(null)}>All weeks</button>
          {weekKeys.length === 0 ? (
            <span className="pc-rd-weeks-none">No weekly data yet</span>
          ) : weekKeys.map((k, i) => (
            <button key={k} className={`pc-rd-week ${activeWeek === k ? 'active' : ''}`} onClick={() => setWeekSel(k)} title={prRangeLong(k, prAddDays(k, 6))}>
              <span className="pc-rd-week-n">W{i + 1}</span>{prRangeShort(k, prAddDays(k, 6))}
            </button>
          ))}
        </PillRow>
      )}

      <div className="pc-rd-kpis">
        <RShareKpi icon="bi-people-fill" color="#6610F2" label="Active creators" value={String(kpis.active)} sub={`${kpis.count} total`} />
        <RShareKpi icon="bi-collection-play-fill" color="#198754" label="Videos posted" value={String(kpis.del)} sub="delivered" />
        <RShareKpi icon="bi-hourglass-split" color="#0DCAF0" label="In pipeline" value={String(kpis.pipeline)} sub="to deliver" />
        <RShareKpi icon="bi-graph-up-arrow" color="#1259C3" label="GMV generated" value={fmt$(kpis.gmv)} sub={kpis.ad > 0 ? `${kpis.roas.toFixed(2)}x ROAS` : (isWeekly && activeWeek ? prRangeShort(activeWeek, prAddDays(activeWeek, 6)) : 'all time')} />
        <RShareKpi icon="bi-cash-coin" color="#E8862E" label="Ad spend" value={fmt$(kpis.ad)} sub="for this period" />
      </div>

      <div className="pc-rd-charts">
        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">GMV vs Ad spend</span><span className="pc-rd-card-s">{isWeekly ? 'by week' : 'by month'}</span></div>
          {trend.some(t => t.gmv || t.ad) ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="shGmv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1259C3" stopOpacity={0.45} /><stop offset="100%" stopColor="#1259C3" stopOpacity={0} /></linearGradient>
                    <linearGradient id="shAd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8862E" stopOpacity={0.4} /><stop offset="100%" stopColor="#E8862E" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef1" vertical={false} />
                  <XAxis dataKey="label" stroke="#8b93a1" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8b93a1" fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)} />
                  <Tooltip formatter={moneyTip} contentStyle={{ borderRadius: 10, border: '1px solid #e9ecef', fontSize: 12 }} />
                  <Area type="monotone" dataKey="gmv" name="GMV" stroke="#1259C3" strokeWidth={2.5} fill="url(#shGmv)" dot={{ r: fewPoints ? 5 : 3, strokeWidth: 0, fill: '#1259C3' }} activeDot={{ r: 6 }}>
                    {fewPoints && <LabelList dataKey="gmv" position="top" offset={12} formatter={lblMoney} style={{ fontSize: 11, fontWeight: 800, fill: '#1259C3' }} />}
                  </Area>
                  <Area type="monotone" dataKey="ad" name="Ad spend" stroke="#E8862E" strokeWidth={2.5} fill="url(#shAd)" dot={{ r: fewPoints ? 5 : 3, strokeWidth: 0, fill: '#E8862E' }} activeDot={{ r: 6 }}>
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
          <div className="pc-rd-legend">{payMix.map((s, i) => <span className="pc-rd-leg" key={i}><i style={{ background: s.color }} />{s.name} · {s.value}</span>)}</div>
        </div>
      </div>

      <div className="pc-rd-lower">
        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">Creators &amp; videos</span><span className="pc-rd-card-s">top {rows.length} by GMV</span></div>
          <div className="pc-rd-clist">
            <div className="pc-rd-crow pc-rd-crh"><span>Creator</span><span>Videos</span><span className="pc-rd-r">GMV</span><span className="pc-rd-r">Status</span></div>
            {rows.map(({ c, key, del, ag, gmv }) => {
              const pct = ag > 0 ? Math.min(100, Math.round((del / ag) * 100)) : (del > 0 ? 100 : 0);
              const st = PR_STATUS[clientStatus(c)] || PR_STATUS.videos_in_progress;
              const progs = dealsByPerson.get(key)?.length || 1;
              return (
                <button type="button" className="pc-rd-crow pc-rd-crow-btn" key={c.id}
                  onClick={() => setOpenKey(key)}
                  aria-label={`Open ${c.name || 'creator'} details`}>
                  <span className="pc-rd-cname">
                    <span className="pc-rd-ava" style={{ background: getGradient(c.name) }}>{initial(c.name)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="pc-rd-cn">{c.name}</span>
                      {/* Only said when it changes the answer — on a brand where
                          everyone ran one program it would be noise on every row. */}
                      {progs > 1 && <span className="pc-rd-cprogs">{progs} programs</span>}
                    </span>
                  </span>
                  <span className="pc-rd-vid">
                    <span className="pc-rd-vid-top">{del}<i>/{ag || del || 0}</i></span>
                    <span className="pc-rd-track"><span className="pc-rd-fill" style={{ width: pct + '%', background: st.color }} /></span>
                  </span>
                  <span className="pc-rd-r pc-rd-gmv">{gmv > 0 ? fmt$(gmv) : '—'}</span>
                  <span className="pc-rd-r"><span className={`pc-rd-pill ${st.cls}`}>{st.label}</span></span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="pc-rd-card">
          <div className="pc-rd-card-h">
            <span className="pc-rd-card-t">Insights</span>
            {onDiscuss && <button className="pcc-reply" onClick={() => onDiscuss('insights', '')}><i className="bi bi-chat-left-text" />Discuss</button>}
          </div>
          {insights.length ? (
            <div className="pc-rd-ins">
              {insights.map((ins, i) => (
                <div className={`pc-rd-in ${ins.tone}`} key={i}><span className="pc-rd-in-ic"><i className={`bi ${ins.icon}`} /></span><span className="pc-rd-in-txt">{ins.text}</span></div>
              ))}
            </div>
          ) : <div className="pc-rd-chart-empty">No insights yet.</div>}
        </div>
      </div>

      {openDeals && openDeals.length > 0 && (
        <CreatorProgramsModal deals={openDeals} onClose={() => setOpenKey(null)}
          showGmv={showGmv} onToggleAuth={onToggleAuth} onConfirmPaid={onConfirmPaid} onRate={onRate} />
      )}
    </div>
  );
}

function RShareKpi({ icon, color, label, value, sub }: { icon: string; color: string; label: string; value: string; sub?: string }) {
  return (
    <div className="pc-rk" style={{ ['--rk' as any]: color }}>
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
   Horizontal pill row with a pinned label and left/right nav arrows.
   The native scrollbar is hidden (it looked bad); the arrows appear only when
   the pills overflow and disable at each end. Used for the week selector and
   the client dashboard / Programs brand switcher.
════════════════════════════════════════════════════════════ */
export function PillRow({ label, className, children }: { label?: ReactNode; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const update = () => {
    const el = ref.current; if (!el) return;
    setOver(el.scrollWidth > el.clientWidth + 1);
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  };
  useEffect(() => {
    update();
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(update); ro.observe(el);
    window.addEventListener('resize', update);
    return () => { ro.disconnect(); window.removeEventListener('resize', update); };
  });
  const by = (d: number) => ref.current?.scrollBy({ left: d, behavior: 'smooth' });
  return (
    <div className={`pc-rd-weeks ${className || ''}`}>
      {label && <span className="pc-rd-weeks-l">{label}</span>}
      {over && <button type="button" className="pc-pill-arrow" disabled={atStart} onClick={() => by(-240)} aria-label="Scroll left">‹</button>}
      <div className="pc-rd-weeks-scroll" ref={ref} onScroll={update}>{children}</div>
      {over && <button type="button" className="pc-pill-arrow" disabled={atEnd} onClick={() => by(240)} aria-label="Scroll right">›</button>}
    </div>
  );
}
