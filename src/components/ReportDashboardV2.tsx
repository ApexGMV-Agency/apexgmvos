import { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Alert, Badge, Offcanvas, Button, Form } from 'react-bootstrap';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  WeeklyReportContentV2, CustomSection, CustomField, StandardSectionIdV2,
  WEEKLY_SECTIONS, SECTION_BY_ID, SectionDef, SectionField,
  ScalarData, RowData, fieldValue, formatValue, FieldFormat, deriveSnapshot,
} from '../lib/reportSchemaV2';
import { sanitizeRich } from '../lib/sanitize';
import { setReportCurrency } from '../lib/currency';
import { computeSection14 } from '../lib/section14';
import Section14Dashboard from './report/Section14Dashboard';
import TopPerformers from './report/TopPerformers';
import ChronologyChart, { ChronoPoint } from './report/ChronologyChart';
import DashSidebar, { DashNavItem } from './report/DashSidebar';
import SectionComments, { Comment, CommentSection } from './SectionComments';

export interface TrendPoint { label: string; GMV: number; 'Affiliate GMV': number; }

export interface CommentsConfig {
  mode: 'authed' | 'public';
  comments: Comment[];
  currentAuthorName?: string;
  defaultPublicName?: string;
  onAdd: (section: CommentSection, body: string, authorName: string, parentId?: string) => Promise<void>;
  /** Gate who may reply to client feedback (e.g. Bob-only). Defaults to true. */
  canReply?: boolean;
}

export interface ApprovalDecisionView {
  id: string;
  decision: 'approved' | 'changes_requested';
  comment: string | null;
  decided_by_name: string;
  decided_at: string;
  share_link_label?: string | null;
}

export interface ApprovalActionConfig {
  myDecision: ApprovalDecisionView | null;
  defaultName: string;
  onSubmit: (decision: 'approved' | 'changes_requested', comment: string, name: string) => Promise<void>;
}

const PIE_COLORS = ['#e8862e', '#0d6efd', '#198754', '#6f42c1', '#dc3545'];

// §14 sub-section comment keys -> label (for the per-section feedback threads).
const S14_LABELS: Record<string, string> = {
  '14.1': 'North-Star & Efficiency',
  '14.2': 'Channel & Source Mix',
  '14.3': 'Conversion Funnel',
  '14.4': 'Productivity & Marketing',
  '14.5': 'Paid Media Efficiency',
  '14.6': 'Health & Risk Signals',
  '14.7': 'Weekly Targets & Action Items',
};

export default function ReportDashboard({
  c, p, trendData, hasPrev, commentsConfig, openSectionOnLoad, highlightCommentId,
  approvalDecisions, approvalAction, audience = 'staff',
  chronologyData, reportMeta, currency,
}: {
  c: WeeklyReportContentV2;
  p: WeeklyReportContentV2 | null;
  /** brand display currency (e.g. 'USD', 'EUR'); drives all money formatting. */
  currency?: string;
  trendData: TrendPoint[];
  hasPrev: boolean;
  /** §2 auto-timeline (this report + prior weeks), built by the page. */
  chronologyData?: ChronoPoint[];
  /** Client report header (brand · period · comparison pill). */
  reportMeta?: { title: string; period: string; compare?: string };
  commentsConfig?: CommentsConfig;
  prevTopVideos?: RowData[];
  openSectionOnLoad?: CommentSection | null;
  highlightCommentId?: string | null;
  approvalDecisions?: ApprovalDecisionView[];
  approvalAction?: ApprovalActionConfig;
  /** 'client' = the share view: only §1 + §14 + Insights + Approval.
   *  'staff' (default) = the full input dashboard + a §14 client preview. */
  audience?: 'staff' | 'client';
}) {
  setReportCurrency(currency);
  const isClient = audience === 'client';
  const section14 = computeSection14(c, p);
  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('ac_dash_nav') === '1'; } catch { return false; }
  });
  const toggleNav = () => setNavCollapsed(v => {
    const n = !v; try { localStorage.setItem('ac_dash_nav', n ? '1' : '0'); } catch { /* ignore */ }
    return n;
  });

  // Left-rail items — only the sections the client actually sees.
  const insightsText = c.insights?.summary?.replace(/<[^>]*>/g, '').trim();
  const navItems: DashNavItem[] = [{ id: 'snapshot', label: 'Overview', icon: 'bi-grid-1x2-fill' }];
  if (section14.hasAnyData) {
    navItems.push({ id: '14.1', label: 'North-Star', icon: 'bi-stars' });
    navItems.push({ id: '14.2', label: 'Channel Mix', icon: 'bi-pie-chart-fill' });
    navItems.push({ id: '14.3', label: 'Funnel', icon: 'bi-funnel-fill' });
    navItems.push({ id: '14.5', label: 'Paid Media', icon: 'bi-cash-stack' });
  }
  if ((c.top_creators ?? []).length > 0) navItems.push({ id: 'top_creators', label: 'Top Creators', icon: 'bi-trophy-fill' });
  if ((c.top_videos ?? []).length > 0) navItems.push({ id: 'top_videos', label: 'Top Videos', icon: 'bi-play-btn-fill' });
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

  const sectionFeedbackCount = (section: CommentSection) =>
    (commentsConfig?.comments ?? []).filter(c => c.section === section).length;

  const customSectionFor = (section: CommentSection): CustomSection | null => {
    if (!section.startsWith('cs:')) return null;
    const id = section.slice(3);
    return c.custom_sections.find(s => s.id === id) ?? null;
  };
  const labelFor = (section: CommentSection): string => {
    const cs = customSectionFor(section);
    if (cs) return cs.name || 'Custom Section';
    if (section === 'approval') return 'Approval Needed / Action Items';
    if (section === 'insights') return 'Insights';
    if (S14_LABELS[section]) return `Key Stats — ${S14_LABELS[section]}`;
    const def = SECTION_BY_ID[section];
    return def ? `${def.num}. ${def.title}` : section;
  };

  const FeedbackIcon = ({ section }: { section: CommentSection }) => {
    if (!commentsConfig) return null;
    const n = sectionFeedbackCount(section);
    if (commentsConfig.mode === 'authed' && n === 0 && section !== 'approval') return null;
    const isPublicApproval = commentsConfig.mode === 'public' && section === 'approval';
    if (isPublicApproval) {
      return (
        <Button size="sm" className="ms-2 fw-semibold"
          style={{ backgroundColor: '#fff', color: '#0d6efd', borderColor: '#0d6efd', whiteSpace: 'nowrap' }}
          onClick={() => setFeedbackSection(section)} title="Open the conversation thread">
          <i className="bi bi-chat-left-text me-1" />{n > 0 ? `Thread (${n})` : 'Open thread'}
        </Button>
      );
    }
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={() => setFeedbackSection(section)}
        title={commentsConfig.mode === 'authed' ? 'View / add staff notes' : 'View / add comments'}>
        <i className="bi bi-chat-left-text" />{n > 0 && <Badge bg="primary" pill>{n}</Badge>}
      </Button>
    );
  };

  const SectionCard = ({ def, children }: { def: SectionDef; children: React.ReactNode }) => (
    <Card className="mb-3" data-section={def.id}>
      <Card.Header>
        <div className="d-flex justify-content-between align-items-center w-100">
          <h2 className="fw-semibold fs-6 mb-0"><span className="text-muted me-1">{def.num}.</span>{def.title}</h2>
          <FeedbackIcon section={def.id} />
        </div>
      </Card.Header>
      <Card.Body>
        {def.blurb && !isClient && <p className="text-muted small mb-3">{def.blurb}</p>}
        {children}
      </Card.Body>
    </Card>
  );

  const renderCustomAt = (anchor: StandardSectionIdV2) =>
    isClient ? null : (c.custom_sections ?? []).filter(s => s.insert_after === anchor).map(s => (
      <CustomSectionView
        key={s.id}
        section={s}
        prevSection={(p?.custom_sections ?? []).find(ps => ps.id === s.id) ?? null}
        feedbackSlot={<FeedbackIcon section={`cs:${s.id}`} />}
      />
    ));

  // ---- per-section renderers ------------------------------------------------
  const renderSection = (def: SectionDef) => {
    const data = (c as any)[def.id];
    const prev = p ? (p as any)[def.id] : null;

    // 1 — Executive Snapshot scorecard (derived from the detail sections)
    if (def.id === 'snapshot') {
      const snap = deriveSnapshot(c);
      const psnap = p ? deriveSnapshot(p) : null;
      return (
        <div data-section="snapshot" className="s14-section">
          <div className="s14-title">
            <span className="s14-title-accent" style={{ background: '#e8862e' }} />
            <div className="flex-grow-1">
              <div className="s14-title-text">Executive Snapshot</div>
              <div className="s14-title-sub">{isClient ? 'This week at a glance — vs the previous week' : 'Headline scorecard · auto-calculated'}</div>
            </div>
            <FeedbackIcon section="snapshot" />
          </div>
          <div className="ac-bento">
            {def.fields.map(f => (
              <KpiTile key={f.key} label={f.label} value={formatValue(f.format, fieldValue(f, snap))}
                f={f} cur={fieldValue(f, snap)} prev={psnap ? fieldValue(f, psnap) : null} />
            ))}
          </div>
          {trendData.length > 1 && (
            <div className="s14-card mt-3">
              <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
                <div className="s14-kpi-label">GMV by week · last {trendData.length} weeks</div>
                <div className="d-flex gap-3">
                  <span className="ac-legend-dot" style={{ '--c': '#e8862e' } as any}>GMV</span>
                  <span className="ac-legend-dot" style={{ '--c': '#f5b06a' } as any}>Affiliate GMV</span>
                </div>
              </div>
              <div style={{ height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={trendData} margin={{ top: 10, right: 12, bottom: 4, left: 4 }} barGap={8} barCategoryGap="32%">
                    <defs>
                      <linearGradient id="gmvBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f2a35a" /><stop offset="100%" stopColor="#e8862e" />
                      </linearGradient>
                      <linearGradient id="affBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ffd6ac" /><stop offset="100%" stopColor="#f5b06a" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#8a93a6' }} tickLine={false} axisLine={{ stroke: '#eadfd6' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#8a93a6' }} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
                    <Tooltip cursor={{ fill: 'rgba(232,134,46,.07)', radius: 8 }}
                      contentStyle={{ borderRadius: 12, border: '1px solid #eef0f4', boxShadow: '0 10px 28px rgba(16,24,40,.12)', fontSize: 13 }}
                      formatter={(v: any, n: any) => [formatValue('currency', Number(v)), n]} />
                    <Bar dataKey="GMV" fill="url(#gmvBar)" radius={[8, 8, 0, 0]} maxBarSize={56} />
                    <Bar dataKey="Affiliate GMV" fill="url(#affBar)" radius={[8, 8, 0, 0]} maxBarSize={56} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      );
    }

    // 2 — Weekly Chronology — auto-derived timeline from §1 / §3 across weeks.
    if (def.id === 'chronology') {
      return (
        <SectionCard def={def}>
          <ChronologyChart data={chronologyData ?? []} />
        </SectionCard>
      );
    }

    // 4.1 — GMV Breakdown mix (donut)
    if (def.id === 'gmv_breakdown') {
      const sd = data as ScalarData;
      const slices = def.fields
        .map(f => ({ name: f.label, value: numv(sd?.[f.key]) }))
        .filter(s => s.value > 0);
      return (
        <SectionCard def={def}>
          <Row className="g-3 align-items-center">
            <Col md={5} style={{ height: 240 }}>
              {slices.length === 0 ? (
                <div className="d-flex align-items-center justify-content-center h-100 text-muted small">No data yet</div>
              ) : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={slices} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
                      {slices.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatValue('currency', Number(v))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Col>
            <Col md={7}>
              <StatGrid def={def} data={data} prev={prev} cols={6} />
            </Col>
          </Row>
        </SectionCard>
      );
    }

    // 7 — Product Traffic funnel by channel
    if (def.id === 'product_traffic') {
      const rows = (data as RowData[]) ?? [];
      const prevRows = (prev as RowData[]) ?? [];
      const overall = rows.find(r => String(r.channel) === 'Overall') ?? rows[rows.length - 1] ?? {};
      const prevOverall = prevRows.find(r => String(r.channel) === 'Overall') ?? {};
      const funnel = [
        { stage: 'Impressions', 'This Week': numv(overall.impressions), 'Last Week': numOrUndef(prevOverall.impressions) },
        { stage: 'Clicks', 'This Week': numv(overall.clicks), 'Last Week': numOrUndef(prevOverall.clicks) },
        { stage: 'Add-to-Cart', 'This Week': numv(overall.add_to_cart), 'Last Week': numOrUndef(prevOverall.add_to_cart) },
      ];
      const hasFunnel = funnel.some(s => s['This Week'] > 0);
      return (
        <SectionCard def={def}>
          {hasFunnel && (
            <div style={{ height: 220 }} className="mb-3">
              <ResponsiveContainer>
                <BarChart data={funnel} layout="vertical" margin={{ left: 24, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" /><YAxis type="category" dataKey="stage" width={90} />
                  <Tooltip /><Legend />
                  <Bar dataKey="This Week" fill="#e8862e" radius={[0, 6, 6, 0]} />
                  <Bar dataKey="Last Week" fill="#6e6e80" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <DashTable def={def} rows={rows} prevRows={prevRows} matchKey="channel" />
        </SectionCard>
      );
    }

    // 11.1 — paid performance (honours the "no paid ads" toggle)
    if (def.special === 'gmv_max') {
      const sd = data as ScalarData;
      return (
        <SectionCard def={def}>
          {sd?.not_started
            ? <Alert variant="secondary" className="mb-0">No paid ads ran this period.</Alert>
            : <StatGrid def={def} data={data} prev={prev} />}
        </SectionCard>
      );
    }

    // generic scalar
    if (def.kind === 'scalar') {
      return <SectionCard def={def}><StatGrid def={def} data={data} prev={prev} /></SectionCard>;
    }
    // generic table / fixed
    return (
      <SectionCard def={def}>
        <DashTable def={def} rows={(data as RowData[]) ?? []} prevRows={(prev as RowData[]) ?? []}
          matchKey={tableMatchKey(def)} />
      </SectionCard>
    );
  };

  return (
    <div className={isClient ? 'ac-themed dash-shell' : 'ac-themed'}>
      {isClient && <DashSidebar items={navItems} collapsed={navCollapsed} onToggle={toggleNav} />}
      <div className={isClient ? `dash-client ${navCollapsed ? 'nav-collapsed' : ''}` : ''}>
      {isClient && reportMeta && (
        <div className="dash-report-head ac-fade">
          <div>
            <h1 className="dash-report-title">{reportMeta.title}</h1>
            <div className="dash-report-period"><i className="bi bi-calendar3" />{reportMeta.period}</div>
          </div>
          {reportMeta.compare && (
            <div className="dash-report-pill"><i className="bi bi-arrow-left-right" />{reportMeta.compare}</div>
          )}
        </div>
      )}
      {!hasPrev && !isClient && <Alert variant="warning" className="py-2">No previous period — single-period view (no comparison).</Alert>}

      {renderCustomAt('start')}

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            {commentsConfig?.mode === 'authed' ? 'Client feedback' : 'Comments'}
            {feedbackSection && <small className="text-muted ms-2 fw-normal">— {labelFor(feedbackSection)}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && commentsConfig && (
            <SectionComments
              section={feedbackSection} sectionLabel={labelFor(feedbackSection)}
              comments={commentsConfig.comments} mode={commentsConfig.mode}
              currentAuthorName={commentsConfig.currentAuthorName} defaultPublicName={commentsConfig.defaultPublicName}
              onAdd={(b, n, parentId) => commentsConfig.onAdd(feedbackSection, b, n, parentId)}
              highlightCommentId={highlightCommentId ?? undefined}
              canReply={commentsConfig.canReply}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      {/* Sections. Client share view shows ONLY the Executive Snapshot (§1);
          staff see every input section. Both then get the §14 dashboard. */}
      {isClient ? (
        <div>{renderSection(SECTION_BY_ID.snapshot)}</div>
      ) : (
        WEEKLY_SECTIONS.map(def => (
          <div key={def.id}>
            {renderSection(def)}
            {renderCustomAt(def.id)}
          </div>
        ))
      )}

      {/* Section 14 — Key Stats Dashboard (auto-computed, client-facing) */}
      {section14.hasAnyData && (
        <div className="mt-2 mb-3">
          {!isClient && (
            <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
              <Badge bg="dark"><i className="bi bi-eye me-1" />Key Stats Dashboard</Badge>
              <small className="text-muted">Auto-generated. <strong>Health &amp; Risk Signals</strong> and <strong>Targets</strong> are internal — the client sees the rest plus Top Creators &amp; Top Videos.</small>
            </div>
          )}
          <Section14Dashboard data={section14} targets={c.targets ?? []} clientMode={isClient}
            renderFeedback={(key) => <FeedbackIcon section={key} />} />
        </div>
      )}

      {/* Top Creators & Top Videos — shown to the client (§13.2 / §13.3) */}
      {isClient && (
        <TopPerformers creators={c.top_creators ?? []} videos={c.top_videos ?? []}
          renderFeedback={(key) => <FeedbackIcon section={key} />} />
      )}

      {/* Insights */}
      {c.insights.summary && c.insights.summary.replace(/<[^>]*>/g, '').trim().length > 0 && (
        <Card className="mb-3" data-section="insights">
          <Card.Header>
            <div className="d-flex justify-content-between align-items-center w-100">
              <span className="fw-semibold">Insights</span><FeedbackIcon section="insights" />
            </div>
          </Card.Header>
          <Card.Body>
            <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: sanitizeRich(c.insights.summary) }} />
          </Card.Body>
        </Card>
      )}
      {renderCustomAt('insights')}

      {/* Approval Needed */}
      {c.approval?.enabled && (() => {
        const expiresAt = c.approval?.expires_at ?? null;
        const expired = !!expiresAt && new Date(expiresAt).getTime() < Date.now();
        return (
          <Card className="mb-3" data-section="approval" border="warning">
            <Card.Header className="d-flex justify-content-between align-items-center" style={{ background: '#fff8ef' }}>
              <span className="fw-semibold">
                <i className="bi bi-shield-check me-2 text-warning" />Approval Needed / Action Items
                {expired && <Badge bg="secondary" className="ms-2"><i className="bi bi-clock-history me-1" />Auto-popup expired</Badge>}
                {!expired && expiresAt && <Badge bg="light" text="dark" className="ms-2 border"><i className="bi bi-clock me-1" />Popup until {new Date(expiresAt).toLocaleDateString()}</Badge>}
              </span>
              <div className="d-flex align-items-center gap-2">
                {approvalDecisions && approvalDecisions.length > 0 && (
                  <Badge bg="success" pill>{approvalDecisions.length} decision{approvalDecisions.length === 1 ? '' : 's'}</Badge>
                )}
                <FeedbackIcon section="approval" />
              </div>
            </Card.Header>
            <Card.Body>
              {expired && (
                <Alert variant="light" className="border small py-2 mb-3">
                  <i className="bi bi-info-circle me-1" />
                  The auto-popup window closed on <strong>{new Date(expiresAt!).toLocaleString()}</strong>. You can still submit a decision or reply in the thread below.
                </Alert>
              )}
              <div className="ac-rte-view ac-approval-content" dangerouslySetInnerHTML={{ __html: sanitizeRich(c.approval.content) }} />
              {commentsConfig?.mode === 'public' && approvalAction && <ApprovalActionInline action={approvalAction} />}
              {commentsConfig?.mode === 'authed' && (
                <div className="mt-3">
                  <h6 className="text-muted mb-2 small text-uppercase" style={{ letterSpacing: '.5px' }}>Client decisions</h6>
                  {(!approvalDecisions || approvalDecisions.length === 0) ? (
                    <p className="text-muted small mb-0">No client has decided yet.</p>
                  ) : (
                    <Table size="sm" className="mb-0 align-middle">
                      <thead><tr><th>Decision</th><th>Client</th><th>When</th><th>Comment</th></tr></thead>
                      <tbody>
                        {approvalDecisions.map(d => (
                          <tr key={d.id}>
                            <td>
                              <Badge bg={d.decision === 'approved' ? 'success' : 'warning'} text={d.decision === 'approved' ? undefined : 'dark'}>
                                <i className={`bi ${d.decision === 'approved' ? 'bi-check-circle' : 'bi-arrow-repeat'} me-1`} />
                                {d.decision === 'approved' ? 'Approved' : 'Changes requested'}
                              </Badge>
                            </td>
                            <td><div className="fw-semibold">{d.decided_by_name}</div>{d.share_link_label && <small className="text-muted">{d.share_link_label}</small>}</td>
                            <td className="text-muted small">{new Date(d.decided_at).toLocaleString()}</td>
                            <td className="small">{d.comment || <span className="text-muted">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </div>
              )}
            </Card.Body>
          </Card>
        );
      })()}
      </div>
    </div>
  );
}

// ===== shared little pieces ==================================================

function numv(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function numOrUndef(v: any): number | undefined { if (v == null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function tableMatchKey(def: SectionDef): string | undefined {
  if (def.fields.some(f => f.key === 'product_id')) return 'product_id';
  if (def.fields.some(f => f.key === 'channel')) return 'channel';
  if (def.fields.some(f => f.key === 'username')) return 'username';
  return undefined;
}

/** Grid of stat tiles with null-safe WoW deltas. */
function StatGrid({ def, data, prev, cols }: {
  def: SectionDef; data: ScalarData; prev: ScalarData | null; cols?: number;
}) {
  return (
    <Row className="g-3">
      {def.fields.map(f => {
        if (f.format === 'bool') return null;
        const cur = fieldValue(f, data);
        const pv = prev ? fieldValue(f, prev) : null;
        return (
          <Col md={cols ?? f.col ?? 3} key={f.key}>
            <KpiTile label={f.label} value={formatValue(f.format, cur)} f={f} cur={cur} prev={pv} />
          </Col>
        );
      })}
    </Row>
  );
}

/** Read-only table for a registry section; auto columns computed, url columns linked. */
function DashTable({ def, rows, prevRows, matchKey }: {
  def: SectionDef; rows: RowData[]; prevRows?: RowData[]; matchKey?: string;
}) {
  if (!rows || rows.length === 0) return <p className="text-muted text-center py-3 mb-0 small">No rows.</p>;
  const findPrev = (row: RowData): RowData | undefined =>
    matchKey && prevRows ? prevRows.find(r => String(r[matchKey] ?? '') !== '' && r[matchKey] === row[matchKey]) : undefined;
  return (
    <Table responsive className="mb-0 align-middle dash-table">
      <thead><tr>
        {def.fields.map(f => (
          <th key={f.key} className={isTextCol(f) ? '' : 'text-end'} style={{ whiteSpace: 'nowrap' }}>{f.label}</th>
        ))}
      </tr></thead>
      <tbody>
        {rows.map((row, i) => {
          const prev = findPrev(row);
          return (
            <tr key={i}>
              {def.fields.map(f => (
                <td key={f.key} className={isTextCol(f) ? '' : 'text-end'} style={{ whiteSpace: 'nowrap' }}>
                  <Cellv f={f} row={row} prev={prev} />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function isTextCol(f: SectionField) { return f.format === 'text' || f.format === 'url'; }

function Cellv({ f, row, prev }: { f: SectionField; row: RowData; prev?: RowData }) {
  if (f.format === 'url') {
    const v = String(row[f.key] ?? '');
    return v ? <a href={v} target="_blank" rel="noreferrer">link</a> : <span className="text-muted">—</span>;
  }
  if (f.format === 'text') {
    const v = String(row[f.key] ?? '');
    return v ? <span className="fw-semibold">{v}</span> : <span className="text-muted">—</span>;
  }
  const cur = fieldValue(f, row);
  const pv = prev ? fieldValue(f, prev) : null;
  return (
    <>
      <div>{formatValue(f.format, cur)}</div>
      {f.comparable !== false && <DeltaV f={f} cur={cur} prev={pv} inline />}
    </>
  );
}

/** Format a percentage, abbreviating 1000%+ as "1k" / "3.2k". */
function fmtPct(pct: number): string {
  const a = Math.abs(pct);
  const body = a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : a.toFixed(1);
  return pct < 0 ? `-${body}` : body;
}

/**
 * Null-safe delta: only renders when BOTH this and last values exist.
 * Missing data (null) => nothing shown — exactly the "compare only when
 * available" rule. A real stored 0 still compares.
 */
function DeltaV({ f, cur, prev, inline }: {
  f: SectionField; cur: number | null; prev: number | null; inline?: boolean;
}) {
  if (cur == null || prev == null) {
    return inline ? null : <small className="text-muted">—</small>;
  }
  const diff = cur - prev;
  if (diff === 0) return inline ? <small className="text-muted">±0</small> : <small className="text-muted">no change</small>;
  const pct = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = f.lowerIsBetter ? diff < 0 : diff > 0;
  const color = good ? 'text-success' : 'text-danger';
  const icon = diff >= 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
  const abs = formatValue(f.format === 'percent' || f.format === 'ratio' ? 'decimal' : f.format, Math.abs(diff));
  const newBadge = prev === 0;
  return (
    <small className={`${color} ${inline ? 'd-block' : ''}`} title={`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}>
      <i className={`bi ${icon}`} /> {abs}{newBadge ? ' (new)' : ` (${pct >= 0 ? '+' : ''}${fmtPct(pct)}%)`}
    </small>
  );
}

/** Pill-style WoW delta for KPI tiles (matches the design-system delta badge). */
export function DeltaPill({ f, cur, prev }: { f: SectionField; cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (diff === 0) return <span className="ac-pill ac-pill-flat">±0%</span>;
  const pct = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = f.lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`ac-pill ${good ? 'ac-pill-up' : 'ac-pill-down'}`} title={`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}>
      <i className={`bi ${diff >= 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} />
      {prev === 0 ? 'new' : `${pct >= 0 ? '+' : ''}${fmtPct(pct)}%`}
    </span>
  );
}

/** Premium KPI tile (design-system spec: label-caps + stat-lg + pill delta). */
function KpiTile({ label, value, f, cur, prev }: {
  label: string; value: string; f: SectionField; cur: number | null; prev: number | null;
}) {
  return (
    <div className="ac-kpi h-100">
      <div className="ac-kpi-label">{label}</div>
      <div className="ac-kpi-value">{value}</div>
      <div className="ac-kpi-foot"><DeltaPill f={f} cur={cur} prev={prev} /></div>
    </div>
  );
}

// ===== Approval inline form (unchanged) =====================================
function ApprovalActionInline({ action }: { action: ApprovalActionConfig }) {
  const { myDecision, defaultName, onSubmit } = action;
  const [name, setName] = useState(defaultName);
  const [choice, setChoice] = useState<'approved' | 'changes_requested' | null>(myDecision?.decision ?? null);
  const [comment, setComment] = useState(myDecision?.comment ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setChoice(myDecision?.decision ?? null);
    setComment(myDecision?.comment ?? '');
    setName(prev => prev || defaultName);
    setJustSaved(false);
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
        <Alert variant={myDecision.decision === 'approved' ? 'success' : 'warning'} className="py-2 mb-3">
          <div className="d-flex align-items-center gap-2 mb-1">
            <i className={`bi ${myDecision.decision === 'approved' ? 'bi-check-circle-fill' : 'bi-arrow-repeat'}`} />
            <strong>You {myDecision.decision === 'approved' ? 'approved' : 'requested changes on'} this report.</strong>
          </div>
          <div className="small">Recorded by <strong>{myDecision.decided_by_name}</strong> on {new Date(myDecision.decided_at).toLocaleString()}.</div>
          {myDecision.comment && (
            <blockquote className="mb-0 mt-2 small ps-2" style={{ borderLeft: '3px solid rgba(0,0,0,.15)', whiteSpace: 'pre-wrap' }}>{myDecision.comment}</blockquote>
          )}
        </Alert>
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 small">
          <div className="text-muted"><i className="bi bi-lock-fill me-1" />Your decision is locked. The conversation stays open — use the <strong>thread</strong> above to follow up.</div>
          <div className="text-muted"><i className="bi bi-arrow-up-right me-1" />Tap <strong>Open thread</strong> at the top of this card.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-top">
      <div className="fw-semibold small text-uppercase text-muted mb-2" style={{ letterSpacing: '.5px' }}>Submit your decision</div>
      {err && <Alert variant="danger" className="py-2 small mb-2">{err}</Alert>}
      {justSaved && !err && <Alert variant="success" className="py-2 small mb-2">Saved. Thank you.</Alert>}
      <Form.Group className="mb-2">
        <Form.Label className="small mb-1">Your name</Form.Label>
        <Form.Control size="sm" value={name} onChange={e => setName(e.target.value)} disabled={submitting} />
      </Form.Group>
      <div className="d-flex gap-2 flex-wrap mb-2">
        <Button size="sm" variant={choice === 'approved' ? 'success' : 'outline-success'} onClick={() => setChoice('approved')} disabled={submitting}>
          <i className="bi bi-check-circle me-1" /> Approve
        </Button>
        <Button size="sm" variant={choice === 'changes_requested' ? 'warning' : 'outline-warning'} onClick={() => setChoice('changes_requested')} disabled={submitting}>
          <i className="bi bi-arrow-repeat me-1" /> Request changes
        </Button>
      </div>
      <Form.Control as="textarea" rows={2}
        placeholder="Comment (optional) — your decision is final once submitted, but the thread stays open."
        value={comment} onChange={e => setComment(e.target.value)} disabled={submitting} />
      <div className="d-flex justify-content-end mt-2">
        <Button size="sm" onClick={submit} disabled={submitting || !choice || !name.trim()}>{submitting ? 'Submitting…' : 'Submit decision'}</Button>
      </div>
    </div>
  );
}

// ===== Custom sections (unchanged behaviour, sanitizeRich for bodies) =======
export function CustomSectionView({ section, prevSection, feedbackSlot }: {
  section: CustomSection;
  prevSection?: CustomSection | null;
  feedbackSlot?: React.ReactNode;
}) {
  const isTable = section.is_repeater;
  const hasContent = isTable ? (section.fields.length > 0) : (section.body && section.body.replace(/<[^>]*>/g, '').trim().length > 0);
  if (!hasContent) return null;
  const numericFields = isTable ? section.fields.filter(f => f.type === 'number') : [];
  const showCompare = !!section.compare_with_previous && isTable && numericFields.length > 0;
  const sumCol = (sec: CustomSection | null | undefined, fieldId: string) =>
    (sec?.rows ?? []).reduce((s, r) => s + (Number(r[fieldId]) || 0), 0);
  return (
    <Card className="mb-3" data-section={`cs:${section.id}`}>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">{section.name || 'Custom Section'}</span>{feedbackSlot}
      </Card.Header>
      <Card.Body>
        {section.description && <p className="text-muted small mb-3">{section.description}</p>}
        {isTable ? (
          showCompare ? (
            <div className="d-flex flex-wrap gap-2">
              {numericFields.map(f => {
                const cur = sumCol(section, f.id);
                const prev = prevSection ? sumCol(prevSection, f.id) : null;
                const pct = (prev !== null && prev !== 0) ? ((cur - prev) / prev) * 100 : null;
                return (
                  <div key={f.id} className="bm-tile" style={{ flex: '1 1 160px', padding: 14 }}>
                    <div className="bm-tile-label">{f.label}</div>
                    <div className="bm-tile-value" style={{ fontSize: '1.35rem' }}>{cur.toLocaleString()}</div>
                    {pct !== null ? (
                      <div className={`bm-tile-sub fw-semibold ${pct >= 0 ? 'text-success' : 'text-danger'}`} title={`${Math.abs(pct).toFixed(1)}%`}>
                        {pct >= 0 ? '▲' : '▼'} {fmtPct(Math.abs(pct))}% vs previous
                      </div>
                    ) : prev !== null && prev === 0 && cur > 0 ? (
                      <div className="bm-tile-sub text-success fw-semibold">▲ New this period</div>
                    ) : (<div className="bm-tile-sub text-muted">&nbsp;</div>)}
                  </div>
                );
              })}
            </div>
          ) : (
            section.rows.length === 0 ? <p className="text-muted small mb-0">No data</p> : (
              <Table size="sm" responsive className="mb-0 align-middle">
                <thead><tr>{section.fields.map(f => <th key={f.id}>{f.label}</th>)}</tr></thead>
                <tbody>
                  {section.rows.map((row, i) => (
                    <tr key={i}>{section.fields.map(f => <td key={f.id}>{renderValue(f, row[f.id])}</td>)}</tr>
                  ))}
                </tbody>
              </Table>
            )
          )
        ) : (
          <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: sanitizeRich(section.body) }} />
        )}
      </Card.Body>
    </Card>
  );
}

function renderValue(field: CustomField, value: any) {
  if (value == null || value === '') return <span className="text-muted">—</span>;
  switch (field.type) {
    case 'number': return Number(value).toLocaleString();
    case 'url': return <a href={String(value)} target="_blank" rel="noreferrer">{String(value)}</a>;
    case 'richtext':
    case 'textarea': return <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: sanitizeRich(String(value)) }} />;
    case 'date': return new Date(String(value)).toLocaleDateString();
    default: return String(value);
  }
}

// re-export so existing imports that referenced these types keep resolving
export type { FieldFormat };
