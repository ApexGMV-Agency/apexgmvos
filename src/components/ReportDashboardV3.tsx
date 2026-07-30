import { useEffect, useState, ReactNode } from 'react';
import { Offcanvas, Button, Badge, Alert, Form } from 'react-bootstrap';
import {
  ResponsiveContainer, ComposedChart, LineChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, LabelList,
} from 'recharts';
import {
  WeeklyReportContentV3, WEEKLY_SECTIONS_V3, SECTION_BY_ID_V3, SectionDefV3, SectionField,
  ScalarData, RowData, fieldValue, formatValue,
} from '../lib/reportSchemaV3';
import { setReportCurrency } from '../lib/currency';
import { sanitizeRich } from '../lib/sanitize';
import DashSidebar, { DashNavItem } from './report/DashSidebar';
import SectionComments, { Comment, CommentSection } from './SectionComments';
import { CustomSectionView } from './ReportDashboardV2';
import type { TrendPoint, CommentsConfig, ApprovalDecisionView, ApprovalActionConfig } from './ReportDashboardV2';

/** One point of the week-over-week combo chart (bars = orders, line = GMV). */
export interface WowPoint { label: string; gmv: number; orders: number }

// Sections the internal team sees but the client does not (currently none —
// GMV Max was client-hidden until 2026-07-17, user call to show it).
const CLIENT_HIDE = new Set<string>([]);

// num() preserves "never entered" as null (blank -> "—", no fabricated 0);
// numv() coerces to 0 for sums / chart values where a real number is required.
const num = (v: any): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const numv = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const PIE = ['#fc6215', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#f87171'];

function fmtPct(p: number): string {
  const a = Math.abs(p);
  const body = a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : a.toFixed(a < 10 ? 1 : 0);
  return p < 0 ? `-${body}` : body;
}

function DeltaPill({ f, cur, prev }: { f: SectionField; cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (diff === 0) return <span className="ac-pill ac-pill-flat">±0%</span>;
  const p = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = f.lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`ac-pill ${good ? 'ac-pill-up' : 'ac-pill-down'}`} title={`${p >= 0 ? '+' : ''}${p.toFixed(1)}%`}>
      <i className={`bi ${diff >= 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} />
      {prev === 0 ? 'new' : `${p >= 0 ? '+' : ''}${fmtPct(p)}%`}
    </span>
  );
}

function KpiTile({ f, data, prev }: { f: SectionField; data: ScalarData; prev: ScalarData | null }) {
  const cur = fieldValue(f, data);
  const pv = prev ? fieldValue(f, prev) : null;
  return (
    <div className="ac-kpi h-100">
      <div className="ac-kpi-label">{f.label}</div>
      <div className="ac-kpi-value">{formatValue(f.format, cur)}</div>
      <div className="ac-kpi-foot">{f.comparable && <DeltaPill f={f} cur={cur} prev={pv} />}</div>
    </div>
  );
}

/** §1 sampling tile — the weekly value and its month-to-date companion share
 *  one card (Samples Approved: week + MTD, Videos Posted: week + MTD). The MTD
 *  half only renders when the page supplied `mtd` (undefined = not available). */
function WeekMtdTile({ label, f, data, prev, mtd }: {
  label: string; f: SectionField; data: ScalarData; prev: ScalarData | null; mtd?: number | null;
}) {
  const cur = fieldValue(f, data);
  const pv = prev ? fieldValue(f, prev) : null;
  const hasMtd = mtd !== undefined;
  return (
    <div className="ac-kpi h-100 v3-wmtile">
      <div className="ac-kpi-label">{label}</div>
      <div className="v3-wmtile-split">
        <div className="v3-wmtile-half">
          <div className="ac-kpi-value">{formatValue(f.format, cur)}</div>
          <div className="v3-mtd-note">This week</div>
          {f.comparable && <div className="mt-2"><DeltaPill f={f} cur={cur} prev={pv} /></div>}
        </div>
        {hasMtd && (
          <>
            <div className="v3-wmtile-divider" />
            <div className="v3-wmtile-half">
              <div className="ac-kpi-value">{mtd == null ? '—' : formatValue('number', mtd)}</div>
              <div className="v3-mtd-note">Month to date</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ title, sub, color = 'var(--ac-accent-base)', fb }: { title: string; sub?: string; color?: string; fb?: ReactNode }) {
  return (
    <div className="s14-title">
      <span className="s14-title-accent" style={{ background: color }} />
      <div className="flex-grow-1">
        <h2 className="s14-title-text">{title}</h2>
        {sub && <div className="s14-title-sub">{sub}</div>}
      </div>
      {fb}
    </div>
  );
}

/** Grid of KPI tiles for a scalar section (skips the fields handled elsewhere). */
function TileGrid({ def, data, prev, skip, col }: {
  def: SectionDefV3; data: ScalarData; prev: ScalarData | null; skip?: Set<string>; col?: string;
}) {
  const fields = def.fields.filter(f => f.format !== 'bool' && !(skip?.has(f.key)));
  return (
    <div className="row g-3">
      {fields.map(f => (
        <div className={col ?? 'col-6 col-lg-3'} key={f.key}><KpiTile f={f} data={data} prev={prev} /></div>
      ))}
    </div>
  );
}

// ---- ss2 · Shop Health semicircle gauge ------------------------------------
function spsColor(v: number) { return v >= 4.5 ? '#34d399' : v >= 3.5 ? '#fc6215' : '#f87171'; }
function spsLabel(v: number) { return v >= 4.5 ? 'Excellent' : v >= 3.5 ? 'Healthy' : 'Needs attention'; }

function ShopHealthGauge({ score, ranking, prevRanking }: {
  score: number | null; ranking: number | null; prevRanking: number | null;
}) {
  const s = score;
  const arc = s == null ? [{ v: 0 }, { v: 5 }] : [{ v: s }, { v: Math.max(0, 5 - s) }];
  const color = s == null ? '#919191' : spsColor(s);
  const rankDelta = (ranking != null && prevRanking != null) ? prevRanking - ranking : null; // rank up = improvement
  return (
    <div className="s14-card h-100 v3-gauge-card">
      <div className="s14-kpi-label mb-1">Shop Health</div>
      <div className="v3-gauge">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={arc} dataKey="v" startAngle={180} endAngle={0} innerRadius="66%" outerRadius="100%"
              cornerRadius={8} stroke="none" isAnimationActive={false}>
              <Cell fill={color} /><Cell fill="var(--ac-text-secondary)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="v3-gauge-center">
          <div className="v3-gauge-val">{s == null ? '—' : s.toFixed(1)}</div>
          <div className="v3-gauge-cap">{s == null ? 'no score' : `of 5.0 · ${spsLabel(s)}`}</div>
        </div>
        <span className="v3-gauge-end v3-gauge-end-l">0</span>
        <span className="v3-gauge-end v3-gauge-end-r">5</span>
      </div>
      <div className="v3-gauge-pills">
        <span className="v3-pill"><span className="text-muted">Shop rank</span> {ranking == null ? '—' : `#${formatValue('number', ranking)}`}</span>
        {rankDelta != null && rankDelta !== 0 && (
          <span className={`v3-pill ${rankDelta > 0 ? 'v3-pill-up' : 'v3-pill-down'}`}>
            <span className="text-muted">Rank Δ</span> {rankDelta > 0 ? '+' : ''}{rankDelta}
          </span>
        )}
      </div>
    </div>
  );
}

// Shared "live" accent for the current (latest) week — a vivid green that pops
// against the orange/blue series lines so "this week" is unmistakable.
const LIVE = 'var(--ac-success)';
// Dot renderer: plain series-coloured dots, but the latest point (the report
// being viewed) gets a big blinking green "live" marker — expanding halo +
// pulsing inner dot + white ring, so no hover is needed to spot the current week.
function makeDot(lastIdx: number, baseColor: string, opts?: { small?: boolean }) {
  const s = opts?.small;
  const h0 = s ? 5 : 9, h1 = s ? 11 : 17, inner = s ? 4.5 : 6, ring = s ? 2 : 2.5, base = s ? 2.5 : 3.5;
  return (props: any) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g key={index} />;
    if (index === lastIdx) {
      return (
        <g key={index}>
          <circle cx={cx} cy={cy} r={h0} fill={LIVE} opacity={0.22}>
            <animate attributeName="r" values={`${h0};${h1};${h0}`} dur="1.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0;0.35" dur="1.4s" repeatCount="indefinite" />
          </circle>
          <circle cx={cx} cy={cy} r={inner} fill={LIVE} stroke="var(--ac-border-strong)" strokeWidth={ring}>
            <animate attributeName="fill-opacity" values="1;0.5;1" dur="1.4s" repeatCount="indefinite" />
          </circle>
        </g>
      );
    }
    return <circle key={index} cx={cx} cy={cy} r={base} fill={baseColor} />;
  };
}

// ---- ss3 · GMV (line) + Orders (bars) combo, up to 8 weeks ------------------
//  Every GMV point carries its value label (no hover needed); the latest week
//  (the report being viewed) gets a blinking green "live" dot.
function WowCombo({ data }: { data: WowPoint[] }) {
  if (data.length < 2) return null;
  return (
    <div className="s14-card h-100">
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <div className="s14-kpi-label">GMV &amp; Orders · last {data.length} weeks</div>
        <div className="d-flex gap-3 align-items-center">
          <span className="ac-legend-dot" style={{ '--c': '#c9ced9' } as any}>Orders</span>
          <span className="ac-legend-dot" style={{ '--c': '#fc6215' } as any}>GMV</span>
          <span className="v3-live-legend"><span className="v3-live-pulse" />This week</span>
        </div>
      </div>
      <div style={{ height: 290 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 26, right: 14, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--ac-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={{ stroke: 'var(--ac-border)' }} />
            <YAxis yAxisId="o" tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false} width={40} />
            <YAxis yAxisId="g" orientation="right" tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false}
              width={52} tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
            <Tooltip cursor={{ fill: 'rgba(252,98,21,.06)' }}
              contentStyle={{ borderRadius: 12, border: '1px solid var(--ac-border)', boxShadow: '0 10px 28px rgba(0,0,0,.55)', fontSize: 13 }}
              formatter={(v: any, n: any) => n === 'GMV' ? [formatValue('currency', Number(v)), 'GMV'] : [formatValue('number', Number(v)), 'Orders']} />
            <Bar yAxisId="o" dataKey="orders" name="Orders" fill="var(--ac-text-secondary)" radius={[6, 6, 0, 0]} maxBarSize={44} />
            <Line yAxisId="g" type="monotone" dataKey="gmv" name="GMV" stroke="var(--ac-accent-base)" strokeWidth={3}
              dot={makeDot(data.length - 1, '#fc6215')} activeDot={{ r: 6 }} isAnimationActive={false}>
              <LabelList dataKey="gmv" position="top" offset={12}
                formatter={(v: any) => Number(v) ? formatValue('currency', Number(v), { compact: true }) : ''}
                style={{ fontSize: 11, fontWeight: 700, fill: 'var(--ac-text-secondary)' }} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- ss2 · Samples vs Videos weekly line chart (live dot on current week) --
function SamplesLineChart({ data }: { data: { label: string; samples: number | null; videos: number | null }[] }) {
  if (data.filter(d => d.samples != null || d.videos != null).length < 2) return null;
  const lastIdx = data.length - 1;
  const numLabel = (v: any) => (v == null || v === '') ? '' : formatValue('number', Number(v));
  return (
    <div className="s14-card mt-3">
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <div className="s14-kpi-label">Samples &amp; videos · last {data.length} weeks</div>
        <div className="d-flex gap-3 align-items-center">
          <span className="ac-legend-dot" style={{ '--c': '#fc6215' } as any}>Samples</span>
          <span className="ac-legend-dot" style={{ '--c': '#60a5fa' } as any}>Videos</span>
          <span className="v3-live-legend"><span className="v3-live-pulse" />This week</span>
        </div>
      </div>
      <div style={{ height: 252 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 24, right: 14, bottom: 16, left: 4 }}>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--ac-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={{ stroke: 'var(--ac-border)' }} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--ac-border)', boxShadow: '0 10px 28px rgba(0,0,0,.55)', fontSize: 13 }} />
            <Line type="monotone" dataKey="samples" name="Samples" stroke="var(--ac-accent-base)" strokeWidth={3} dot={makeDot(lastIdx, '#fc6215')} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls>
              <LabelList dataKey="samples" position="top" offset={12} formatter={numLabel} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--ac-accent-base)' }} />
            </Line>
            <Line type="monotone" dataKey="videos" name="Videos" stroke="var(--ac-info)" strokeWidth={3} dot={makeDot(lastIdx, '#60a5fa')} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls>
              <LabelList dataKey="videos" position="bottom" offset={12} formatter={numLabel} style={{ fontSize: 11, fontWeight: 700, fill: 'var(--ac-info)' }} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- ss8 · affiliate multi-metric trend (dual axis, direct labels) ---------
//  One graph, one coloured line per affiliate metric over the last 8 weeks.
//  Collabs-in-progress is excluded (per request); counts share the left axis,
//  Affiliate GMV rides its own right axis. Every point is labelled (no hover)
//  and the latest week carries the green blinking "live" dot.
export type AffPoint = { label: string; affiliate_gmv: number | null; live_sessions: number | null; contacted_creators: number | null };
const AFF_LINES: { key: keyof AffPoint; name: string; color: string; axis: 'n' | 'g'; fmt: 'currency' | 'number'; pos: 'top' | 'bottom' }[] = [
  { key: 'affiliate_gmv', name: 'Affiliate GMV', color: 'var(--ac-accent-base)', axis: 'g', fmt: 'currency', pos: 'top' },
  { key: 'contacted_creators', name: 'Contacted Creators', color: '#22d3ee', axis: 'n', fmt: 'number', pos: 'top' },
  { key: 'live_sessions', name: 'LIVE Sessions', color: '#a78bfa', axis: 'n', fmt: 'number', pos: 'bottom' },
];
function AffiliateTrend({ data }: { data: AffPoint[] }) {
  if (data.filter(d => AFF_LINES.some(l => d[l.key] != null)).length < 2) return null;
  const lastIdx = data.length - 1;
  const lab = (fmt: 'currency' | 'number') => (v: any) =>
    (v == null || v === '') ? '' : formatValue(fmt, Number(v), fmt === 'currency' ? { compact: true } : undefined);
  return (
    <div className="s14-card mt-3">
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <div className="s14-kpi-label">Affiliate metrics · last {data.length} weeks</div>
        <div className="d-flex gap-3 align-items-center flex-wrap">
          {AFF_LINES.map(l => <span key={String(l.key)} className="ac-legend-dot" style={{ '--c': l.color } as any}>{l.name}</span>)}
          <span className="v3-live-legend"><span className="v3-live-pulse" />This week</span>
        </div>
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 24, right: 50, bottom: 16, left: 6 }}>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--ac-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={{ stroke: 'var(--ac-border)' }} />
            <YAxis yAxisId="n" tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false} width={34} allowDecimals={false} />
            <YAxis yAxisId="g" orientation="right" tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false}
              width={50} tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--ac-border)', boxShadow: '0 10px 28px rgba(0,0,0,.55)', fontSize: 13 }}
              formatter={(v: any, n: any) => { const l = AFF_LINES.find(x => x.name === n); return [formatValue(l?.fmt ?? 'number', Number(v)), n]; }} />
            {AFF_LINES.map(l => (
              <Line key={String(l.key)} yAxisId={l.axis} type="monotone" dataKey={l.key as string} name={l.name} stroke={l.color} strokeWidth={3}
                dot={makeDot(lastIdx, l.color)} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls>
                <LabelList dataKey={l.key as string} position={l.pos} offset={10} formatter={lab(l.fmt)}
                  style={{ fontSize: 10.5, fontWeight: 700, fill: l.color }} />
              </Line>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- §7 Offsite weekly trend — one coloured line per metric (no value cards) -
//  GMV metrics share the left currency axis; Offsite Effect (%) rides the right
//  axis. Direct labels (no hover) + green live dot on the latest week.
export type OffPoint = { label: string; offsite_gmv: number | null; tiktok_shop_gmv: number | null; offsite_effect: number | null };
const OFF_LINES: { key: keyof OffPoint; name: string; color: string; axis: 'g' | 'p'; fmt: 'currency' | 'percent'; pos: 'top' | 'bottom' }[] = [
  { key: 'tiktok_shop_gmv', name: 'TikTok Shop GMV', color: 'var(--ac-info)', axis: 'g', fmt: 'currency', pos: 'top' },
  { key: 'offsite_gmv', name: 'Offsite GMV', color: 'var(--ac-accent-base)', axis: 'g', fmt: 'currency', pos: 'bottom' },
  { key: 'offsite_effect', name: 'Offsite Effect', color: 'var(--ac-success)', axis: 'p', fmt: 'percent', pos: 'top' },
];
function OffsiteTrend({ data }: { data: OffPoint[] }) {
  if (data.filter(d => OFF_LINES.some(l => d[l.key] != null)).length < 2) return null;
  const lastIdx = data.length - 1;
  const lab = (fmt: 'currency' | 'percent') => (v: any) =>
    (v == null || v === '') ? '' : formatValue(fmt, Number(v), fmt === 'currency' ? { compact: true } : undefined);
  return (
    <div className="s14-card mt-3">
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <div className="s14-kpi-label">Weekly trend · last {data.length} weeks</div>
        <div className="d-flex gap-3 align-items-center flex-wrap">
          {OFF_LINES.map(l => <span key={String(l.key)} className="ac-legend-dot" style={{ '--c': l.color } as any}>{l.name}</span>)}
          <span className="v3-live-legend"><span className="v3-live-pulse" />This week</span>
        </div>
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 24, right: 52, bottom: 16, left: 6 }}>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--ac-border)" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={{ stroke: 'var(--ac-border)' }} />
            <YAxis yAxisId="g" tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false}
              width={50} tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
            <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false}
              width={44} tickFormatter={(v: number) => formatValue('percent', v)} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--ac-border)', boxShadow: '0 10px 28px rgba(0,0,0,.55)', fontSize: 13 }}
              formatter={(v: any, n: any) => { const l = OFF_LINES.find(x => x.name === n); return [formatValue(l?.fmt ?? 'currency', Number(v)), n]; }} />
            {OFF_LINES.map(l => (
              <Line key={String(l.key)} yAxisId={l.axis} type="monotone" dataKey={l.key as string} name={l.name} stroke={l.color} strokeWidth={3}
                dot={makeDot(lastIdx, l.color)} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls>
                <LabelList dataKey={l.key as string} position={l.pos} offset={10} formatter={lab(l.fmt)}
                  style={{ fontSize: 10.5, fontWeight: 700, fill: l.color }} />
              </Line>
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- ss6 · horizontal conversion funnel (Traffic Analysis) -----------------
//  Teal trapezoid stages in a light track: stage name in white on the left,
//  value on the right; the conversion rate between two stages sits in a left
//  gutter with an elbow connector — matching the TikTok-Shop funnel.
function Funnel({ stages }: { stages: { label: string; value: number | null; rate?: number | null; rateLabel?: string }[] }) {
  const present = stages.filter(s => s.value != null);
  if (present.length === 0) return <div className="s14-empty">No funnel data yet</div>;
  const max = Math.max(1, ...present.map(s => s.value ?? 0));
  const TEAL = ['#3fc5cf', '#1aa6b4', '#0b8795', '#0b8795'];
  return (
    <div className="v3fn">
      {stages.map((s, i) => {
        const w = Math.max(14, Math.round(((s.value ?? 0) / max) * 100));
        return (
          <div className="v3fn-item" key={s.label}>
            {i > 0 && (
              <div className="v3fn-rate">
                <span className="v3fn-rate-lbl">{s.rateLabel}</span>
                <span className="v3fn-rate-val">{s.rate != null ? `${s.rate.toFixed(2)}%` : '—'}</span>
              </div>
            )}
            <div className="v3fn-track">
              <div className="v3fn-bar" style={{ width: `${w}%`, background: TEAL[i] ?? TEAL[TEAL.length - 1] }}>
                <span className="v3fn-name">{s.label}</span>
              </div>
              <span className="v3fn-val">{formatValue('number', s.value)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- ss5 · attribution donut with leader-line value labels (no hover) ------
type Slice = { label: string; value: number; color?: string };
function Donut({ slices, total, centerLabel }: { slices: Slice[]; total?: number; centerLabel: string }) {
  const data = slices.filter(s => s.value > 0);
  if (data.length === 0) return <div className="s14-empty">No data yet</div>;
  const center = total != null ? total : data.reduce((a, b) => a + b.value, 0);
  const renderLabel = (e: any) => {
    const RAD = Math.PI / 180;
    const r = e.outerRadius + 14;
    const x = e.cx + r * Math.cos(-e.midAngle * RAD);
    const y = e.cy + r * Math.sin(-e.midAngle * RAD);
    const anchor = x >= e.cx ? 'start' : 'end';
    return (
      <text x={x} y={y} textAnchor={anchor} dominantBaseline="central">
        <tspan x={x} dy="-0.35em" fontSize={10} fontWeight={600} fill="var(--ac-text-secondary)">{e.payload.label}</tspan>
        <tspan x={x} dy="1.15em" fontSize={12.5} fontWeight={800} fill="var(--ac-text-primary)">{formatValue('currency', e.value, { compact: true })}</tspan>
      </text>
    );
  };
  return (
    <div style={{ height: 250, position: 'relative' }}>
      <ResponsiveContainer>
        <PieChart margin={{ top: 16, right: 66, bottom: 16, left: 66 }}>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="80%" paddingAngle={2}
            stroke="none" cornerRadius={4} isAnimationActive={false}
            label={renderLabel} labelLine={{ stroke: 'var(--ac-border)', strokeWidth: 1 }}>
            {data.map((s, i) => <Cell key={i} fill={s.color ?? PIE[i % PIE.length]} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="s14-donut-center">
        <div className="s14-donut-total">{formatValue('currency', center, { compact: true })}</div>
        <div className="s14-donut-cap">{centerLabel}</div>
      </div>
    </div>
  );
}

function LegendList({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div className="d-flex flex-column gap-2">
      {slices.map((s, i) => {
        const pct = (s.value / total) * 100;
        const c = s.color ?? PIE[i % PIE.length];
        return (
          <div key={s.label}>
            <div className="d-flex justify-content-between align-items-center mb-1">
              <span className="s14-bar-label"><span className="s14-dot" style={{ background: c }} />{s.label}</span>
              <span className="s14-bar-val">{pct.toFixed(1)}%<span className="text-muted ms-2 small">{formatValue('currency', s.value)}</span></span>
            </div>
            <div className="s14-track"><div className="s14-fill" style={{ width: `${Math.min(100, pct)}%`, background: c }} /></div>
          </div>
        );
      })}
    </div>
  );
}

// ---- ss7 · one metric as a value + WoW delta + trend sparkline -------------
//  Replaces the old right-hand KPI cards: each metric shows its current value,
//  the week-over-week change, and a mini trend line whose latest week is the
//  green blinking "live" dot.
type TrendSeries = { label: string; v: number | null }[];
function MetricTrend({ label, format, color, series, current, lowerIsBetter, highlight }: {
  label: string; format: 'currency' | 'percent' | 'number'; color: string;
  series: TrendSeries; current: number | null; lowerIsBetter?: boolean; highlight?: boolean;
}) {
  const valued = series.filter(s => s.v != null);
  const n = series.length;
  // Value/delta/live-dot all describe the current (latest) week — series[n-1].
  const cur = (n ? series[n - 1].v : null) ?? current;
  const prev = n > 1 ? series[n - 2].v : null;
  const diff = (cur != null && prev != null) ? cur - prev : null;
  const pct = diff == null ? null : (prev === 0 ? 100 : (diff / Math.abs(prev as number)) * 100);
  const good = diff == null ? false : (lowerIsBetter ? diff < 0 : diff > 0);
  return (
    <div className={`v3-offtrend${highlight ? ' is-accent' : ''}`}>
      <div className="v3-offtrend-head">
        <span className="s14-kpi-label">{label}</span>
        {pct != null && diff !== 0 && (
          <span className={`ac-pill ${good ? 'ac-pill-up' : 'ac-pill-down'}`} title={`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}>
            <i className={`bi ${diff! >= 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} />
            {prev === 0 ? 'new' : `${pct >= 0 ? '+' : ''}${fmtPct(pct)}%`}
          </span>
        )}
      </div>
      <div className="v3-offtrend-body">
        <div className="v3-offtrend-val" style={highlight ? { color } : undefined}>{cur == null ? '—' : formatValue(format, cur)}</div>
        {valued.length >= 2 && (
          <div className="v3-offtrend-spark">
            <ResponsiveContainer>
              <LineChart data={series} margin={{ top: 12, right: 14, bottom: 8, left: 14 }}>
                <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2.5}
                  dot={makeDot(series.length - 1, color, { small: true })} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- ss4 · product analytics table -----------------------------------------
function ProductTable({ def, rows, prevRows, samplesByProduct }: {
  def: SectionDefV3; rows: RowData[]; prevRows: RowData[]; samplesByProduct?: Record<string, number | null>;
}) {
  if (!rows || rows.length === 0) return <div className="s14-empty">No products yet</div>;
  // product_id is always a string ('' when unset), so fall back to the product
  // name with || and never key on an empty string (that would collide rows).
  const keyOf = (r: RowData) => String(r.product_id || r.product || '');
  const prevById = new Map(prevRows.filter(r => keyOf(r) !== '').map(r => [keyOf(r), r]));
  const cols = def.fields.filter(f => f.key !== 'product' && f.key !== 'product_id');
  const gmvF = def.fields.find(f => f.key === 'total_gmv');
  const showSamples = !!samplesByProduct;
  return (
    <div className="s14-card p-0 v3-prodtable-wrap">
      <div className="table-responsive">
        <table className="table align-middle mb-0 v3-prodtable">
          <thead><tr>
            <th style={{ width: 40 }}>#</th>
            <th>Product</th>
            {showSamples && <th className="text-end">Samples Approved This Week</th>}
            {cols.map(f => <th key={f.key} className="text-end">{f.label}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((row, i) => {
              const k = keyOf(row);
              const prev = k ? prevById.get(k) : undefined;
              const name = String(row.product ?? '').trim() || 'Product';
              const samp = showSamples ? (samplesByProduct?.[String(row.product_id ?? '')] ?? null) : null;
              return (
                <tr key={i}>
                  <td><span className="v3-prod-rank">{i + 1}</span></td>
                  <td>
                    <div style={{ minWidth: 0 }}>
                      <div className="v3-prod-name text-truncate">{name}</div>
                      {row.product_id && <div className="v3-prod-id text-truncate">ID {String(row.product_id)}</div>}
                    </div>
                  </td>
                  {showSamples && <td className="text-end"><div className="v3-prod-val">{samp == null ? '—' : formatValue('number', samp)}</div></td>}
                  {cols.map(f => {
                    const cur = fieldValue(f, row);
                    const pv = prev ? fieldValue(f, prev) : null;
                    const showDelta = f.key === (gmvF?.key ?? 'total_gmv');
                    return (
                      <td key={f.key} className="text-end">
                        <div className="v3-prod-val">{formatValue(f.format, cur)}</div>
                        {showDelta && <DeltaInline f={f} cur={cur} prev={pv} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function DeltaInline({ f, cur, prev }: { f: SectionField; cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (diff === 0) return <div className="v3-prod-delta text-muted">±0%</div>;
  const p = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = f.lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <div className={`v3-prod-delta ${good ? 'text-success' : 'text-danger'}`}>
      <i className={`bi ${diff >= 0 ? 'bi-caret-up-fill' : 'bi-caret-down-fill'}`} /> {prev === 0 ? 'new' : `${fmtPct(p)}%`}
    </div>
  );
}

// ---- top creators / videos / lives -----------------------------------------
const MEDAL = ['#fbbf24', '#919191', '#cd7f32'];
// Rank presentation: just the numeral on a gold/silver/bronze pill (grey for 4+).
const rankColor = (i: number) => MEDAL[i] ?? '#919191';
function rankInner(i: number) {
  return <span className="tp-rank-n">{i + 1}</span>;
}
function tiktokLink(h: string) { return `https://www.tiktok.com/@${encodeURIComponent(String(h).trim().replace(/^@+/, '').replace(/\s+/g, ''))}`; }

function TopCreators({ rows }: { rows: RowData[] }) {
  const cs = rows.filter(c => String(c.username ?? '').trim() !== '' || num(c.gmv_generated) != null);
  if (cs.length === 0) return <div className="s14-empty">No creators yet</div>;
  return (
    <div className="row g-3">
      {cs.map((c, i) => {
        const handle = String(c.username ?? '').trim().replace(/^@+/, '');
        return (
          <div className="col-sm-6 col-lg-4" key={i}>
            <div className={`s14-card h-100 tp-card ${i === 0 ? 'tp-gold' : ''}`}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  {handle ? <a className="tp-name" href={tiktokLink(handle)} target="_blank" rel="noreferrer">@{handle}</a> : <span className="tp-name text-muted">—</span>}
                </div>
                <span className="tp-rank" style={{ background: rankColor(i) }}>{rankInner(i)}</span>
              </div>
              <div className="d-flex justify-content-between align-items-end gap-2">
                <div style={{ minWidth: 0 }}>
                  <div className="tp-gmv">{formatValue('currency', num(c.gmv_generated))}</div>
                  <div className="tp-sub">GMV generated</div>
                </div>
                <div className="text-end">
                  <div className="tp-num">{formatValue('number', num(c.items_sold))}</div>
                  <div className="tp-sub">Items sold</div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopVideos({ rows }: { rows: RowData[] }) {
  const vs = rows.filter(v => String(v.video_link ?? '').trim() !== '' || String(v.product_promoted ?? '').trim() !== '' || num(v.gmv) != null);
  if (vs.length === 0) return <div className="s14-empty">No videos yet</div>;
  return (
    <div className="row g-3">
      {vs.map((v, i) => {
        const url = String(v.video_link ?? '').trim();
        return (
          <div className="col-sm-6 col-lg-4" key={i}>
            <div className={`s14-card h-100 tp-video ${i === 0 ? 'tp-gold' : ''}`}>
              <a className="tp-thumb" href={url || undefined} target="_blank" rel="noreferrer" style={{ pointerEvents: url ? 'auto' : 'none' }}>
                <span className="tp-rank-badge" style={{ background: rankColor(i) }}>{rankInner(i)}</span>
                <span className="tp-thumb-c">
                  <i className="bi bi-play-circle-fill tp-play" />
                  {url && <span className="tp-watch-center"><i className="bi bi-tiktok me-1" />Watch on TikTok</span>}
                </span>
              </a>
              <div className="tp-video-body">
                <div className="tp-product">{String(v.product_promoted ?? '').trim() || 'Product'}</div>
                <div className="tp-gmv">{formatValue('currency', num(v.gmv))}</div>
                <div className="tp-sub">Video GMV</div>
                <div className="tp-stat mt-1"><strong>{formatValue('number', num(v.items_sold))}</strong> items sold this week</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopLives({ rows }: { rows: RowData[] }) {
  const ls = rows.filter(l => String(l.live_id ?? '').trim() !== '' || String(l.creator ?? '').trim() !== '' || num(l.gmv) != null);
  if (ls.length === 0) return <div className="s14-empty">No LIVE sessions yet</div>;
  return (
    <div className="row g-3">
      {ls.map((l, i) => {
        const creator = String(l.creator ?? '').trim().replace(/^@+/, '');
        return (
          <div className="col-sm-6 col-lg-4" key={i}>
            <div className={`s14-card h-100 tp-card v3-live ${i === 0 ? 'tp-gold' : ''}`}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="v3-live-badge"><i className="bi bi-broadcast" /> LIVE</span>
                <div className="flex-grow-1 text-truncate">
                  {creator ? <a className="tp-name" href={tiktokLink(creator)} target="_blank" rel="noreferrer">@{creator}</a> : <span className="tp-name text-muted">—</span>}
                </div>
                <span className="tp-rank" style={{ background: rankColor(i) }}>{rankInner(i)}</span>
              </div>
              <div className="tp-gmv">{formatValue('currency', num(l.gmv))}</div>
              <div className="tp-sub">LIVE GMV</div>
              <div className="v3-live-meta mt-2 d-flex justify-content-between align-items-center gap-2 flex-wrap">
                {l.product_sold && <span className="v3-live-prod"><i className="bi bi-bag me-1 text-muted" />{String(l.product_sold)}</span>}
                <span className="d-flex gap-2 align-items-center flex-shrink-0">
                  {l.live_duration && <span className="tp-stat"><i className="bi bi-clock me-1" />{String(l.live_duration)}</span>}
                  {l.live_id && <span className="tp-stat text-muted">{String(l.live_id)}</span>}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- §6 · Channel Analytics (Video ∥ LIVE side by side) --------------------
function ChannelPair({ def, rows, prevRows }: { def: SectionDefV3; rows: RowData[]; prevRows: RowData[] }) {
  const metricFields = def.fields.filter(f => f.key !== 'channel');
  const find = (arr: RowData[], ch: string) => arr.find(r => String(r.channel) === ch) ?? {};
  const META: Record<string, { icon: string; color: string; sub: string }> = {
    Video: { icon: 'bi-play-btn-fill', color: 'var(--ac-info)', sub: 'Short-form video' },
    LIVE: { icon: 'bi-broadcast', color: '#f472b6', sub: 'LIVE selling' },
  };
  return (
    <div className="row g-3">
      {(def.fixedRows ?? []).map(ch => {
        const row = find(rows, ch); const prev = find(prevRows, ch);
        const m = META[ch] ?? { icon: 'bi-graph-up', color: 'var(--ac-accent-base)', sub: '' };
        return (
          <div className="col-md-6" key={ch}>
            <div className="s14-card h-100 v3-channel" style={{ ['--ch' as any]: m.color }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="v3-channel-icon" style={{ background: m.color }}><i className={`bi ${m.icon}`} /></span>
                <div><div className="v3-channel-title">{ch}</div><div className="v3-channel-sub">{m.sub}</div></div>
              </div>
              <div className="row g-3">
                {metricFields.map(f => (
                  <div className="col-6" key={f.key}><KpiTile f={f} data={row as ScalarData} prev={prev as ScalarData} /></div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- §12 · GMV Max dashboard ------------------------------------------------
export type GmvMaxPoint = { label: string; ad_spend: number | null; revenue: number | null; roas: number | null; cpo: number | null };
const GMX_METRICS: { key: keyof Omit<GmvMaxPoint, 'label'>; label: string; color: string; kind: 'currency' | 'roas' | 'cpo' }[] = [
  { key: 'revenue', label: 'Gross Revenue', color: 'var(--ac-success)', kind: 'currency' },
  { key: 'ad_spend', label: 'Ad Spend', color: 'var(--ac-text-secondary)', kind: 'currency' },
  { key: 'roas', label: 'Blended ROAS', color: 'var(--ac-accent-base)', kind: 'roas' },
  { key: 'cpo', label: 'Blended CPO', color: '#a78bfa', kind: 'cpo' },
];
function fmtGmx(kind: 'currency' | 'roas' | 'cpo', v: number | null, compact = false): string {
  if (v == null) return '—';
  if (kind === 'roas') return `${v.toFixed(2)}x`;
  if (kind === 'cpo') return formatValue('currency', v);
  return formatValue('currency', v, compact ? { compact: true } : undefined);
}
function GmvMaxViz({ rows, series }: { rows: RowData[]; series?: GmvMaxPoint[] }) {
  const [metricKey, setMetricKey] = useState<keyof Omit<GmvMaxPoint, 'label'>>('revenue');
  if (!rows || rows.length === 0) return <div className="s14-empty">No GMV Max data yet</div>;
  const totCost = rows.reduce((a, r) => a + numv(r.cost), 0);
  const totRev = rows.reduce((a, r) => a + numv(r.gross_revenue), 0);
  const totOrders = rows.reduce((a, r) => a + numv(r.sku_orders), 0);
  const roas = totCost > 0 ? totRev / totCost : null;
  const cpo = totOrders > 0 ? totCost / totOrders : null;
  const tiles: { label: string; value: string }[] = [
    { label: 'Total Ad Spend', value: formatValue('currency', totCost) },
    { label: 'Gross Revenue', value: formatValue('currency', totRev) },
    { label: 'Blended ROAS', value: roas == null ? '—' : `${roas.toFixed(2)}x` },
    { label: 'Blended CPO', value: cpo == null ? '—' : formatValue('currency', cpo) },
  ];
  // A weekly trend line needs ≥2 weeks with data; otherwise fall back to the
  // per-product cost-vs-revenue bar chart so single-week reports still show one.
  const S = series ?? [];
  const hasTrend = S.filter(s => GMX_METRICS.some(m => s[m.key] != null)).length >= 2;
  const active = GMX_METRICS.find(m => m.key === metricKey)!;
  const lastIdx = S.length - 1;
  const chart = rows.map(r => ({ name: String(r.product ?? '').slice(0, 14) || '—', Cost: numv(r.cost), Revenue: numv(r.gross_revenue) }));
  return (
    <>
      {/* Full-width KPI tiles */}
      <div className="row g-3 mb-3">
        {tiles.map(t => (
          <div className="col-6 col-lg-3" key={t.label}>
            <div className="ac-kpi h-100"><div className="ac-kpi-label">{t.label}</div><div className="ac-kpi-value">{t.value}</div></div>
          </div>
        ))}
      </div>
      {hasTrend ? (
        <div className="s14-card">
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <div className="s14-kpi-label">{active.label} · last {S.length} weeks</div>
            <div className="d-flex align-items-center gap-3 flex-wrap">
              <div className="v3-seg">
                {GMX_METRICS.map(m => (
                  <button key={String(m.key)} type="button" className={`v3-seg-btn${m.key === metricKey ? ' active' : ''}`}
                    style={m.key === metricKey ? ({ '--seg': m.color } as any) : undefined} onClick={() => setMetricKey(m.key)}>{m.label}</button>
                ))}
              </div>
              <span className="v3-live-legend"><span className="v3-live-pulse" />This week</span>
            </div>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={S} margin={{ top: 26, right: 18, bottom: 8, left: 6 }}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--ac-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={{ stroke: 'var(--ac-border)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false} width={52}
                  tickFormatter={(v: number) => fmtGmx(active.kind, v, true)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid var(--ac-border)', boxShadow: '0 10px 28px rgba(0,0,0,.55)', fontSize: 13 }}
                  formatter={(v: any) => [fmtGmx(active.kind, Number(v)), active.label]} />
                <Line type="monotone" dataKey={active.key as string} name={active.label} stroke={active.color} strokeWidth={3}
                  dot={makeDot(lastIdx, active.color)} activeDot={{ r: 6 }} isAnimationActive={false} connectNulls>
                  <LabelList dataKey={active.key as string} position="top" offset={12}
                    formatter={(v: any) => (v == null || v === '') ? '' : fmtGmx(active.kind, Number(v), true)}
                    style={{ fontSize: 11, fontWeight: 700, fill: active.color }} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div className="s14-card">
          <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
            <div className="s14-kpi-label">Ad spend vs gross revenue by product</div>
            <div className="d-flex gap-3">
              <span className="ac-legend-dot" style={{ '--c': '#c9ced9' } as any}>Cost</span>
              <span className="ac-legend-dot" style={{ '--c': '#34d399' } as any}>Revenue</span>
            </div>
          </div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={4}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--ac-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} interval={0} angle={-12} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--ac-text-secondary)' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
                <Tooltip formatter={(v: any, n: any) => [formatValue('currency', Number(v)), n]} />
                <Bar dataKey="Cost" fill="var(--ac-text-secondary)" radius={[6, 6, 0, 0]} maxBarSize={34} />
                <Bar dataKey="Revenue" fill="var(--ac-success)" radius={[6, 6, 0, 0]} maxBarSize={34} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </>
  );
}

const NAV_ICON: Record<string, string> = {
  sampling: 'bi-box-seam', overall: 'bi-graph-up-arrow', product_analytics: 'bi-grid-3x3-gap-fill',
  product_traffic: 'bi-signpost-split-fill', traffic_analysis: 'bi-funnel-fill', channel_analytics: 'bi-collection-play-fill',
  offsite: 'bi-box-arrow-up-right', affiliate: 'bi-people-fill', top_creators: 'bi-trophy-fill',
  top_videos: 'bi-play-btn-fill', top_lives: 'bi-broadcast', gmv_max: 'bi-cash-stack',
};
const SECTION_ACCENT: Record<string, string> = {
  sampling: 'var(--ac-accent-base)', overall: 'var(--ac-accent-base)', product_analytics: '#60a5fa', product_traffic: '#22d3ee',
  traffic_analysis: '#22d3ee', channel_analytics: '#a78bfa', offsite: '#22d3ee', affiliate: 'var(--ac-success)',
  top_creators: '#fc6215', top_videos: '#60a5fa', top_lives: '#f472b6', gmv_max: '#a78bfa',
};

export default function ReportDashboardV3({
  c, p, wow, sampleSeries, mtd, productSamples, offsiteSeries, affiliateSeries, gmvMaxSeries, hasPrev, commentsConfig, openSectionOnLoad, highlightCommentId,
  approvalDecisions, approvalAction, audience = 'staff', reportMeta, currency,
}: {
  c: WeeklyReportContentV3;
  p: WeeklyReportContentV3 | null;
  /** brand display currency (e.g. 'USD', 'EUR'); drives all money formatting. */
  currency?: string;
  /** week-over-week series (bars=orders, line=GMV) built by the page. Falls back to trendData GMV. */
  wow?: WowPoint[];
  /** per-week samples/videos series for the §1 line chart (last point = current week). */
  sampleSeries?: { label: string; samples: number | null; videos: number | null }[];
  /** §1 month-to-date totals (1st of month → this report's week end). */
  mtd?: { samples: number | null; videos: number | null };
  /** §3 per-product "samples approved this week", keyed by product_id. */
  productSamples?: Record<string, number | null>;
  /** §7 per-week offsite metrics for the trend sparklines (last point = current week). */
  offsiteSeries?: { label: string; offsite_gmv: number | null; tiktok_shop_gmv: number | null; offsite_effect: number | null }[];
  /** §8 per-week affiliate metrics for the multi-line trend (last point = current week). */
  affiliateSeries?: AffPoint[];
  /** §12 per-week GMV Max aggregates for the metric-toggle trend (last point = current week). */
  gmvMaxSeries?: GmvMaxPoint[];
  trendData?: TrendPoint[];
  hasPrev: boolean;
  reportMeta?: { title: string; period: string; compare?: string };
  commentsConfig?: CommentsConfig;
  openSectionOnLoad?: CommentSection | null;
  highlightCommentId?: string | null;
  approvalDecisions?: ApprovalDecisionView[];
  approvalAction?: ApprovalActionConfig;
  audience?: 'staff' | 'client';
}) {
  // Set the report currency during render (before children paint) so every
  // formatValue('currency', …) below emits this brand's symbol.
  setReportCurrency(currency);
  const isClient = audience === 'client';
  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('ac_dash_nav') === '1'; } catch { return false; }
  });
  const toggleNav = () => setNavCollapsed(v => { const n = !v; try { localStorage.setItem('ac_dash_nav', n ? '1' : '0'); } catch { /* ignore */ } return n; });

  const wowData: WowPoint[] = wow ?? [];
  // §1 "Sampling & Videos" is no longer a standalone section — its cards are
  // rendered inside §8 (Affiliate Performance). It stays in the schema/editor so
  // data entry + auto-fill keep working; it's just merged in the report view.
  const visibleSections = WEEKLY_SECTIONS_V3.filter(d =>
    d.id !== 'sampling'
    && !(isClient && CLIENT_HIDE.has(d.id)));
  // Display numbering follows the visible order (no gap left by the removed §1).
  const dispNum = new Map<string, number>();
  visibleSections.forEach((d, i) => dispNum.set(d.id, i + 1));

  const sectionHasData = (def: SectionDefV3): boolean => {
    const data = (c as any)[def.id];
    if (def.kind === 'scalar') return def.fields.some(f => !f.auto && data?.[f.key] != null);
    // Fixed sections (channel_analytics) always carry their locked rows, so
    // count them as "has data" only when a real metric was entered.
    if (def.kind === 'fixed') {
      return Array.isArray(data) && data.some((r: any) =>
        def.fields.some(f => f.key !== def.labelKey && !f.auto && r?.[f.key] != null));
    }
    return Array.isArray(data) && data.length > 0;
  };

  const navItems: DashNavItem[] = visibleSections
    .filter(sectionHasData)
    .map(d => ({ id: d.id, label: d.title.split(' — ')[0].replace('GMV Max — Product-Level Ad Spend & Overall', 'GMV Max'), icon: NAV_ICON[d.id] ?? 'bi-dot' }));
  const insightsText = c.insights?.summary?.replace(/<[^>]*>/g, '').trim();
  if (insightsText) navItems.push({ id: 'insights', label: 'Insights', icon: 'bi-lightbulb-fill' });
  if (c.approval?.enabled) navItems.push({ id: 'approval', label: 'Approval', icon: 'bi-shield-check' });

  useEffect(() => {
    if (!openSectionOnLoad) return;
    setFeedbackSection(openSectionOnLoad);
    setTimeout(() => {
      const el = document.querySelector(`[data-section="${CSS.escape(openSectionOnLoad)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [openSectionOnLoad]);

  const feedbackCount = (section: CommentSection) => (commentsConfig?.comments ?? []).filter(x => x.section === section).length;
  const customSectionFor = (section: CommentSection) => section.startsWith('cs:') ? ((c.custom_sections ?? []).find(s => s.id === section.slice(3)) ?? null) : null;
  const labelFor = (section: CommentSection): string => {
    const cs = customSectionFor(section);
    if (cs) return cs.name || 'Custom Section';
    if (section === 'approval') return 'Approval Needed / Action Items';
    if (section === 'insights') return 'Insights';
    const def = SECTION_BY_ID_V3[section];
    if (!def) return section;
    const n = dispNum.get(section);
    return n ? `${n}. ${def.title}` : def.title;
  };
  const FeedbackIcon = ({ section }: { section: CommentSection }) => {
    if (!commentsConfig) return null;
    const n = feedbackCount(section);
    if (commentsConfig.mode === 'authed' && n === 0 && section !== 'approval') return null;
    if (commentsConfig.mode === 'public' && section === 'approval') {
      return (
        <Button size="sm" className="ms-2 fw-semibold" style={{ backgroundColor: 'var(--ac-surface-raised)', color: 'var(--ac-info)', borderColor: 'var(--ac-info)', whiteSpace: 'nowrap' }}
          onClick={() => setFeedbackSection(section)} title="Open the conversation thread">
          <i className="bi bi-chat-left-text me-1" />{n > 0 ? `Thread (${n})` : 'Open thread'}
        </Button>
      );
    }
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={() => setFeedbackSection(section)} title={commentsConfig.mode === 'authed' ? 'View / add staff notes' : 'View / add comments'}>
        <i className="bi bi-chat-left-text" />{n > 0 && <Badge bg="primary" pill>{n}</Badge>}
      </Button>
    );
  };

  const renderCustomAt = (anchor: string) =>
    isClient ? null : (c.custom_sections ?? []).filter(s => s.insert_after === anchor).map(s => (
      <CustomSectionView key={s.id} section={s}
        prevSection={(p?.custom_sections ?? []).find(ps => ps.id === s.id) ?? null}
        feedbackSlot={<FeedbackIcon section={`cs:${s.id}` as CommentSection} />} />
    ));

  // ---- per-section renderer -------------------------------------------------
  const body = (def: SectionDefV3): ReactNode => {
    const data = (c as any)[def.id] as ScalarData;
    const prev = p ? (p as any)[def.id] as ScalarData : null;
    const rows = (c as any)[def.id] as RowData[];
    const prevRows = (p ? (p as any)[def.id] : []) as RowData[];

    switch (def.id) {
      case 'sampling': {
        const wkS = def.fields.find(f => f.key === 'samples_approved')!;
        const wkV = def.fields.find(f => f.key === 'new_videos_posted')!;
        return (
          <>
            <div className="row g-3">
              <div className="col-sm-6"><WeekMtdTile label="Samples Approved" f={wkS} data={data} prev={prev} mtd={mtd ? mtd.samples : undefined} /></div>
              <div className="col-sm-6"><WeekMtdTile label="Videos Posted" f={wkV} data={data} prev={prev} mtd={mtd ? mtd.videos : undefined} /></div>
            </div>
            {sampleSeries && <SamplesLineChart data={sampleSeries} />}
          </>
        );
      }
      case 'overall': {
        const scoreF = def.fields.find(f => f.key === 'shop_performance_score')!;
        return (
          <>
            <TileGrid def={def} data={data} prev={prev} skip={new Set(['shop_performance_score', 'shop_ranking'])} />
            <div className="row g-3 mt-0">
              <div className="col-lg-8">{wowData.length >= 2 ? <WowCombo data={wowData} /> : <div className="s14-card h-100 d-flex align-items-center justify-content-center s14-empty">Week-over-week chart needs at least 2 weekly reports</div>}</div>
              <div className="col-lg-4">
                <ShopHealthGauge score={fieldValue(scoreF, data)} ranking={num(data?.shop_ranking)} prevRanking={prev ? num(prev?.shop_ranking) : null} />
              </div>
            </div>
          </>
        );
      }
      case 'product_analytics':
        return <ProductTable def={def} rows={rows} prevRows={prevRows} samplesByProduct={productSamples} />;
      case 'product_traffic': {
        const gmv = numv(data?.gmv);
        const attr: Slice[] = [
          { label: 'Seller LIVE', value: numv(data?.seller_live_gmv), color: 'var(--ac-info)' },
          { label: 'Seller Video', value: numv(data?.seller_video_gmv), color: '#a78bfa' },
          { label: 'Creator', value: numv(data?.creator_gmv), color: 'var(--ac-success)' },
        ];
        const sumAttr = attr.reduce((a, b) => a + b.value, 0);
        const other = Math.max(0, gmv - sumAttr);
        // "Other" fills the gap so the donut sums to Total GMV (center = Total GMV).
        const slices: Slice[] = other > 0 ? [...attr, { label: 'Other', value: other, color: 'var(--ac-text-secondary)' }] : attr;
        return (
          <div className="s14-card">
            <div className="s14-kpi-label mb-2">GMV by traffic source</div>
            <div className="row g-3 align-items-center">
              <div className="col-lg-7"><Donut slices={slices} total={gmv > 0 ? gmv : sumAttr} centerLabel="Total GMV" /></div>
              <div className="col-lg-5"><LegendList slices={slices} /></div>
            </div>
          </div>
        );
      }
      case 'traffic_analysis': {
        const impr = num(data?.impressions), clicks = num(data?.clicks), orders = num(data?.sku_orders);
        const rate = (a: number | null, b: number | null) => (a != null && b != null && b !== 0) ? (a / b) * 100 : null;
        const stages = [
          { label: 'Product impressions', value: impr },
          { label: 'Product clicks', value: clicks, rate: rate(clicks, impr), rateLabel: 'CTR' },
          { label: 'SKU orders', value: orders, rate: rate(orders, clicks), rateLabel: 'CTOR (SKU order)' },
        ];
        return <div className="s14-card"><Funnel stages={stages} /></div>;
      }
      case 'channel_analytics':
        return <ChannelPair def={def} rows={rows} prevRows={prevRows} />;
      case 'offsite': {
        const slices: Slice[] = [
          { label: 'TikTok Shop GMV', value: numv(data?.tiktok_shop_gmv), color: 'var(--ac-info)' },
          { label: 'Offsite GMV', value: numv(data?.offsite_gmv), color: 'var(--ac-accent-base)' },
        ];
        const S = offsiteSeries ?? [];
        return (
          <>
            {/* Donut + legend — same treatment as §4 Product Traffic */}
            <div className="s14-card">
              <div className="s14-kpi-label mb-2">GMV by source</div>
              <div className="row g-3 align-items-center">
                <div className="col-lg-7"><Donut slices={slices} centerLabel="Total GMV" /></div>
                <div className="col-lg-5"><LegendList slices={slices} /></div>
              </div>
            </div>
            {/* Weekly trend — multi-line graph below the donut (no value cards) */}
            <OffsiteTrend data={S} />
          </>
        );
      }
      case 'affiliate':
        return (
          <>
            {/* Merged from the former §1 — sampling cards + samples/videos chart */}
            <div data-section="sampling">
              <div className="v3-subhead">
                <span><i className="bi bi-box-seam me-2" />Sampling &amp; videos</span>
                <FeedbackIcon section={'sampling' as CommentSection} />
              </div>
              {body(SECTION_BY_ID_V3.sampling)}
            </div>
            <div className="v3-subhead mt-4"><span><i className="bi bi-people-fill me-2" />Affiliate activity</span></div>
            <TileGrid def={def} data={data} prev={prev} col="col-6 col-lg-3" />
            {affiliateSeries && <AffiliateTrend data={affiliateSeries} />}
          </>
        );
      case 'top_creators': return <TopCreators rows={rows} />;
      case 'top_videos': return <TopVideos rows={rows} />;
      case 'top_lives': return <TopLives rows={rows} />;
      case 'gmv_max': return <GmvMaxViz rows={rows} series={gmvMaxSeries} />;
      default:
        return def.kind === 'scalar' ? <TileGrid def={def} data={data} prev={prev} /> : null;
    }
  };

  const inner = (
    <>
      {reportMeta && (
        <div className="dash-report-head ac-fade">
          <div>
            <h1 className="dash-report-title">{reportMeta.title}</h1>
            <div className="dash-report-period"><i className="bi bi-calendar3" />{reportMeta.period}</div>
          </div>
          {reportMeta.compare && <div className="dash-report-pill"><i className="bi bi-arrow-left-right" />{reportMeta.compare}</div>}
        </div>
      )}
      {!hasPrev && !isClient && <Alert variant="warning" className="py-2">No previous period — single-period view (no comparison).</Alert>}

      {renderCustomAt('start')}

      <div className="s14-root">
        {visibleSections.map(def => (
          <div key={def.id}>
            <section className="s14-section" data-section={def.id}>
              <SectionTitle title={`${dispNum.get(def.id)}. ${def.title.replace(' — Product-Level Ad Spend & Overall', '')}`} sub={isClient ? undefined : def.blurb}
                color={SECTION_ACCENT[def.id]} fb={<FeedbackIcon section={def.id as CommentSection} />} />
              {body(def)}
            </section>
            {renderCustomAt(def.id)}
          </div>
        ))}

        {insightsText && (
          <section className="s14-section" data-section="insights">
            <SectionTitle title="Insights" sub="This week in words" color="#22d3ee" fb={<FeedbackIcon section="insights" />} />
            <div className="s14-card"><div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: sanitizeRich(c.insights.summary) }} /></div>
          </section>
        )}
        {renderCustomAt('insights')}

        {c.approval?.enabled && (
          <section className="s14-section" data-section="approval">
            <SectionTitle title="Approval Needed / Action Items" color="var(--ac-warning)" fb={<FeedbackIcon section="approval" />} />
            <div className="s14-card v3-approval">
              <div className="ac-rte-view ac-approval-content" dangerouslySetInnerHTML={{ __html: sanitizeRich(c.approval.content) }} />
              {commentsConfig?.mode === 'public' && approvalAction && <ApprovalActionInline action={approvalAction} />}
              {commentsConfig?.mode === 'authed' && approvalDecisions && approvalDecisions.length > 0 && (
                <div className="mt-3">
                  <h6 className="text-muted mb-2 small text-uppercase" style={{ letterSpacing: '.5px' }}>Client decisions</h6>
                  {approvalDecisions.map(d => (
                    <div key={d.id} className="d-flex align-items-center gap-2 small mb-1">
                      <Badge bg={d.decision === 'approved' ? 'success' : 'warning'} text={d.decision === 'approved' ? undefined : 'dark'}>
                        {d.decision === 'approved' ? 'Approved' : 'Changes requested'}
                      </Badge>
                      <strong>{d.decided_by_name}</strong>
                      <span className="text-muted">{new Date(d.decided_at).toLocaleDateString()}</span>
                      {d.comment && <span className="text-muted">— {d.comment}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );

  return (
    <div className="ac-themed dash-shell v3-dash">
      <DashSidebar items={navItems} collapsed={navCollapsed} onToggle={toggleNav} />
      <div className={`dash-client ${navCollapsed ? 'nav-collapsed' : ''}`}>
        <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
          <Offcanvas.Header closeButton>
            <Offcanvas.Title><i className="bi bi-chat-left-text me-2" />{commentsConfig?.mode === 'authed' ? 'Client feedback' : 'Comments'}
              {feedbackSection && <small className="text-muted ms-2 fw-normal">— {labelFor(feedbackSection)}</small>}</Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            {feedbackSection && commentsConfig && (
              <SectionComments section={feedbackSection} sectionLabel={labelFor(feedbackSection)}
                comments={commentsConfig.comments} mode={commentsConfig.mode}
                currentAuthorName={commentsConfig.currentAuthorName} defaultPublicName={commentsConfig.defaultPublicName}
                onAdd={(b, n, parentId) => commentsConfig.onAdd(feedbackSection, b, n, parentId)}
                highlightCommentId={highlightCommentId ?? undefined}
                canReply={commentsConfig.canReply} />
            )}
          </Offcanvas.Body>
        </Offcanvas>
        {inner}
      </div>
    </div>
  );
}

// ===== Approval inline form (client share view) =============================
function ApprovalActionInline({ action }: { action: ApprovalActionConfig }) {
  const { myDecision, defaultName, onSubmit } = action;
  const [name, setName] = useState(defaultName);
  const [choice, setChoice] = useState<'approved' | 'changes_requested' | null>(myDecision?.decision ?? null);
  const [comment, setComment] = useState(myDecision?.comment ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setChoice(myDecision?.decision ?? null); setComment(myDecision?.comment ?? '');
    setName(prev => prev || defaultName); setJustSaved(false);
  }, [myDecision, defaultName]);

  const submit = async () => {
    setErr(null);
    if (!choice) { setErr('Pick Approve or Request changes first.'); return; }
    if (!name.trim()) { setErr('Enter your name so we can credit your decision.'); return; }
    setSubmitting(true);
    try { await onSubmit(choice, comment.trim(), name.trim()); setJustSaved(true); }
    catch (e: any) { setErr(e?.message ?? 'Failed to submit'); }
    finally { setSubmitting(false); }
  };

  if (myDecision) {
    return (
      <div className="mt-4 pt-3 border-top">
        <Alert variant={myDecision.decision === 'approved' ? 'success' : 'warning'} className="py-2 mb-0">
          <strong>You {myDecision.decision === 'approved' ? 'approved' : 'requested changes on'} this report.</strong>
          <div className="small">Recorded by {myDecision.decided_by_name} on {new Date(myDecision.decided_at).toLocaleString()}.</div>
        </Alert>
      </div>
    );
  }
  return (
    <div className="mt-4 pt-3 border-top">
      <div className="fw-semibold small text-uppercase text-muted mb-2" style={{ letterSpacing: '.5px' }}>Submit your decision</div>
      {err && <Alert variant="danger" className="py-2 small mb-2">{err}</Alert>}
      {justSaved && !err && <Alert variant="success" className="py-2 small mb-2">Saved. Thank you.</Alert>}
      <Form.Group className="mb-2"><Form.Label className="small mb-1">Your name</Form.Label>
        <Form.Control size="sm" value={name} onChange={e => setName(e.target.value)} disabled={submitting} /></Form.Group>
      <div className="d-flex gap-2 flex-wrap mb-2">
        <Button size="sm" variant={choice === 'approved' ? 'success' : 'outline-success'} onClick={() => setChoice('approved')} disabled={submitting}><i className="bi bi-check-circle me-1" /> Approve</Button>
        <Button size="sm" variant={choice === 'changes_requested' ? 'warning' : 'outline-warning'} onClick={() => setChoice('changes_requested')} disabled={submitting}><i className="bi bi-arrow-repeat me-1" /> Request changes</Button>
      </div>
      <Form.Control as="textarea" rows={2} placeholder="Comment (optional)" value={comment} onChange={e => setComment(e.target.value)} disabled={submitting} />
      <div className="d-flex justify-content-end mt-2"><Button size="sm" onClick={submit} disabled={submitting || !choice || !name.trim()}>{submitting ? 'Submitting…' : 'Submit decision'}</Button></div>
    </div>
  );
}
