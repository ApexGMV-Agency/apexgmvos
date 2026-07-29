import { ReactNode } from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { formatValue, FieldFormat, TargetRow } from '../../lib/reportSchemaV2';
import { Section14, Kpi, RagSignal, RagStatus } from '../../lib/section14';

// ---- small shared pieces ---------------------------------------------------
function fmtPct(p: number): string {
  const a = Math.abs(p);
  const body = a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : a.toFixed(a < 10 ? 1 : 0);
  return p < 0 ? `-${body}` : body;
}

/** WoW delta chip — only when both values exist (compare-when-available rule). */
function DeltaChip({ value, prev, lowerIsBetter }: { value: number | null; prev: number | null; lowerIsBetter?: boolean }) {
  if (value == null || prev == null) return null;
  const diff = value - prev;
  if (diff === 0) return <span className="s14-chip s14-chip-flat">±0%</span>;
  const p = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`ac-pill ${good ? 'ac-pill-up' : 'ac-pill-down'}`} title={`${p >= 0 ? '+' : ''}${p.toFixed(1)}%`}>
      <i className={`bi ${diff >= 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} />
      {prev === 0 ? 'new' : `${p >= 0 ? '+' : ''}${fmtPct(p)}%`}
    </span>
  );
}

function KpiTile({ k }: { k: Kpi; accent?: string }) {
  return (
    <div className="ac-kpi h-100">
      <div className="ac-kpi-label">{k.label}</div>
      <div className="ac-kpi-value">{formatValue(k.format, k.value)}</div>
      <div className="ac-kpi-foot">
        <DeltaChip value={k.value} prev={k.prev} lowerIsBetter={k.lowerIsBetter} />
        {k.hint && <span className="ac-kpi-hint">{k.hint}</span>}
      </div>
    </div>
  );
}

/** Clean section header — colored accent bar, title, optional comment button. */
function SectionTitle({ title, sub, color = '#e8862e', fb }: { title: string; sub?: string; color?: string; fb?: ReactNode }) {
  return (
    <div className="s14-title">
      <span className="s14-title-accent" style={{ background: color }} />
      <div className="flex-grow-1">
        <div className="s14-title-text">{title}</div>
        {sub && <div className="s14-title-sub">{sub}</div>}
      </div>
      {fb}
    </div>
  );
}

function spsColor(v: number) {
  if (v >= 4.5) return '#10b981';
  if (v >= 3.5) return '#e8862e';
  return '#ef4444';
}

const RAG_META: Record<RagStatus, { bg: string; fg: string; icon: string; label: string }> = {
  green: { bg: 'rgba(16,185,129,.12)', fg: '#0f766e', icon: 'bi-check-circle-fill', label: 'Healthy' },
  amber: { bg: 'rgba(245,158,11,.14)', fg: '#b45309', icon: 'bi-exclamation-triangle-fill', label: 'Watch' },
  red: { bg: 'rgba(239,68,68,.12)', fg: '#b91c1c', icon: 'bi-exclamation-octagon-fill', label: 'Act now' },
  na: { bg: 'rgba(148,163,184,.12)', fg: '#64748b', icon: 'bi-dash-circle', label: 'No data' },
};

function RagCard({ s }: { s: RagSignal }) {
  const m = RAG_META[s.status];
  return (
    <div className="s14-rag" style={{ background: m.bg, borderColor: m.fg }}>
      <div className="d-flex align-items-center justify-content-between mb-1">
        <span className="s14-rag-label">{s.label}</span>
        <span className="s14-rag-pill" style={{ background: m.fg }}>{m.label}</span>
      </div>
      <div className="d-flex align-items-start gap-2">
        <i className={`bi ${m.icon}`} style={{ color: m.fg, fontSize: '1.1rem' }} />
        <span className="s14-rag-detail">{s.detail}</span>
      </div>
    </div>
  );
}

// ---- main ------------------------------------------------------------------
export default function Section14Dashboard({ data, targets, renderFeedback, clientMode }: {
  data: Section14;
  targets: TargetRow[];
  /** Renders the per-section comment button for a given comment-section key. */
  renderFeedback?: (key: string) => ReactNode;
  /** Client view hides the internal-only Health & Risk Signals + Targets. */
  clientMode?: boolean;
}) {
  const { northStar, mix, funnel, productivity, sps, paid, signals } = data;
  const fb = (key: string) => renderFeedback?.(key);
  const totalGmv = northStar.find(k => k.key === 'gmv')?.value ?? null;
  const pieData = mix.slices.filter(s => (s.pct ?? 0) > 0);
  const maxFunnel = Math.max(1, ...funnel.stages.map(s => s.value ?? 0));
  const realTargets = (targets ?? []).filter(t => t.objective.trim() !== '' || t.target != null || t.actual != null);

  return (
    <div className="s14-root">
      {/* North-Star & Efficiency */}
      <section className="s14-section" data-section="14.1">
        <SectionTitle title="North-Star & Efficiency" sub="The numbers that define the week" color="#e8862e" fb={fb('14.1')} />
        <div className="row g-3">
          {northStar.map(k => (
            <div className="col-6 col-lg" key={k.key}><KpiTile k={k} accent="#e8862e" /></div>
          ))}
        </div>
      </section>

      {/* Channel & Source Mix */}
      <section className="s14-section" data-section="14.2">
        <SectionTitle title="Channel & Source Mix" sub="Where GMV comes from" color="#0d6efd" fb={fb('14.2')} />
        <div className="row g-3 align-items-stretch">
          <div className="col-lg-5">
            <div className="s14-card h-100 d-flex flex-column">
              <div className="s14-kpi-label mb-2">GMV by selling surface</div>
              {pieData.length === 0 ? (
                <div className="s14-empty">No channel mix yet</div>
              ) : (
                <div style={{ height: 240, position: 'relative' }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="92%" paddingAngle={2} stroke="none" cornerRadius={4}>
                        {pieData.map((s, i) => <Cell key={i} fill={s.color} />)}
                      </Pie>
                      <Tooltip formatter={(v: any, _n: any, e: any) => [`${formatValue('currency', Number(v))} · ${e?.payload?.pct != null ? e.payload.pct.toFixed(1) + '%' : ''}`, e?.payload?.label]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="s14-donut-center">
                    <div className="s14-donut-total">{formatValue('currency', totalGmv, { compact: true })}</div>
                    <div className="s14-donut-cap">Total GMV</div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="col-lg-7">
            <div className="s14-card h-100">
              <div className="s14-kpi-label mb-2">Share of total GMV</div>
              <div className="d-flex flex-column gap-2">
                {mix.slices.map(s => (
                  <div key={s.label}>
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <span className="s14-bar-label"><span className="s14-dot" style={{ background: s.color }} />{s.label}</span>
                      <span className="s14-bar-val">{s.pct != null ? `${s.pct.toFixed(1)}%` : '—'}<span className="text-muted ms-2 small">{formatValue('currency', s.value)}</span></span>
                    </div>
                    <div className="s14-track"><div className="s14-fill" style={{ width: `${Math.min(100, s.pct ?? 0)}%`, background: s.color }} /></div>
                  </div>
                ))}
              </div>
              <div className="s14-split mt-3">
                <div className="s14-split-head">Creator vs Seller content</div>
                <CreatorSellerBar creator={mix.creator} seller={mix.seller} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Conversion Funnel */}
      <section className="s14-section" data-section="14.3">
        <SectionTitle title="Conversion Funnel" sub="Impressions → Clicks → Cart → Orders" color="#06b6d4" fb={fb('14.3')} />
        <div className="row g-3">
          <div className="col-lg-7">
            <div className="s14-card h-100">
              {funnel.stages.every(s => (s.value ?? 0) === 0) ? (
                <div className="s14-empty">No funnel data yet</div>
              ) : funnel.stages.map((st, i) => (
                <div key={st.label} className="s14-funnel-row">
                  <div className="s14-funnel-meta">
                    <span className="s14-funnel-label">{st.label}</span>
                    <span className="s14-funnel-value">{formatValue('number', st.value)}</span>
                  </div>
                  <div className="s14-funnel-track">
                    <div className="s14-funnel-bar" style={{ width: `${Math.max(4, ((st.value ?? 0) / maxFunnel) * 100)}%` }} />
                  </div>
                  {i > 0 && st.rate != null && (
                    <span className="s14-funnel-rate"><i className="bi bi-arrow-return-right" /> {st.rate.toFixed(1)}%</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="col-lg-5">
            <div className="row g-3 h-100">
              {funnel.rates.map(k => (
                <div className="col-6" key={k.key}><KpiTile k={k} accent="#0d6efd" /></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Productivity & Marketing */}
      <section className="s14-section" data-section="14.4">
        <SectionTitle title="Productivity & Marketing" color="#198754" fb={fb('14.4')} />
        <div className="row g-3 align-items-stretch">
          {productivity.map(k => (
            <div className="col-6 col-lg-3" key={k.key}><KpiTile k={k} accent="#198754" /></div>
          ))}
          <div className="col-6 col-lg-3">
            <div className="s14-card h-100 d-flex flex-column align-items-center justify-content-center" style={{ position: 'relative' }}>
              <div className="s14-kpi-label mb-1 align-self-start">Shop Performance Score</div>
              {sps == null ? (
                <div className="s14-empty my-3">Not yet assigned</div>
              ) : (
                <div style={{ width: '100%', height: 150, position: 'relative' }}>
                  <ResponsiveContainer>
                    <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ value: (sps / 5) * 100, fill: spsColor(sps) }]} startAngle={90} endAngle={-270}>
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                      <RadialBar background dataKey="value" cornerRadius={20} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, fontFamily: 'Sora, sans-serif' }}>{sps.toFixed(1)}</div>
                    <div className="text-muted" style={{ fontSize: '.7rem' }}>out of 5.0</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Paid Media Efficiency */}
      <section className="s14-section" data-section="14.5">
        <SectionTitle title="Paid Media Efficiency" color="#8b5cf6" fb={fb('14.5')} />
        <div className="row g-3">
          {paid.map(k => (
            <div className="col-6 col-lg-2" key={k.key}><KpiTile k={k} accent="#8b5cf6" /></div>
          ))}
        </div>
      </section>

      {/* Health & Risk Signals — internal only, hidden from the client view */}
      {!clientMode && (
        <section className="s14-section" data-section="14.6">
          <SectionTitle title="Health & Risk Signals" sub="Internal · Red = act now · Amber = watch · Green = healthy" color="#ef4444" fb={fb('14.6')} />
          <div className="s14-rag-grid">
            {signals.map(s => <RagCard key={s.key} s={s} />)}
          </div>
        </section>
      )}

      {/* Weekly Targets & Action Items — internal only, hidden from the client */}
      {!clientMode && realTargets.length > 0 && (
        <section className="s14-section" data-section="14.7">
          <SectionTitle title="Weekly Targets & Action Items" color="#0ea5e9" fb={fb('14.7')} />
          <div className="s14-card">
            <div className="d-flex flex-column gap-3">
              {realTargets.map((t, i) => <TargetRowView key={i} t={t} />)}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function CreatorSellerBar({ creator, seller }: { creator: number | null; seller: number | null }) {
  const c = creator ?? 0, s = seller ?? 0, total = c + s;
  if (total <= 0) return <div className="s14-empty">No split data</div>;
  const cp = (c / total) * 100;
  return (
    <>
      <div className="s14-split-track">
        <div style={{ width: `${cp}%`, background: '#e8862e' }} />
        <div style={{ width: `${100 - cp}%`, background: '#0d6efd' }} />
      </div>
      <div className="d-flex justify-content-between mt-1 small">
        <span><span className="s14-dot" style={{ background: '#e8862e' }} />Creator {formatValue('currency', creator)} ({cp.toFixed(0)}%)</span>
        <span><span className="s14-dot" style={{ background: '#0d6efd' }} />Seller {formatValue('currency', seller)} ({(100 - cp).toFixed(0)}%)</span>
      </div>
    </>
  );
}

function TargetRowView({ t }: { t: TargetRow }) {
  const fmt = (v: number | null) => formatValue(t.unit as FieldFormat, v);
  const ratio = (t.target != null && t.target !== 0 && t.actual != null) ? t.actual / t.target : null;
  const onTrack = ratio == null ? null : (t.lower_is_better ? t.actual! <= t.target! : ratio >= 1);
  const pct = ratio == null ? null : Math.min(100, Math.max(0, ratio * 100));
  const status: RagStatus = onTrack == null ? 'na' : onTrack ? 'green' : (pct != null && pct >= 80 ? 'amber' : 'red');
  const m = RAG_META[status];
  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-1 flex-wrap gap-2">
        <span className="fw-semibold">{t.objective || 'Objective'}</span>
        <span className="d-flex align-items-center gap-2">
          <span className="small text-muted">{fmt(t.actual)} {t.target != null && <>/ {fmt(t.target)}</>}</span>
          <span className="s14-rag-pill" style={{ background: m.fg }}>{onTrack == null ? '—' : onTrack ? 'On track' : 'Behind'}</span>
        </span>
      </div>
      <div className="s14-track">
        <div className="s14-fill" style={{ width: `${pct ?? 0}%`, background: m.fg }} />
      </div>
      {t.owner && <div className="text-muted small mt-1"><i className="bi bi-person me-1" />{t.owner}</div>}
    </div>
  );
}
