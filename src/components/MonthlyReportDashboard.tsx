import { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Badge, Offcanvas, Button, Form, Alert } from 'react-bootstrap';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line,
} from 'recharts';
import DOMPurify from 'dompurify';
import { MonthlyReportContent, ThisLast } from '../lib/monthlyReportSchema';
import { setReportCurrency, formatMoney } from '../lib/currency';
import { Comment, CommentSection } from './SectionComments';
import SectionComments from './SectionComments';
import { CommentsConfig, ApprovalDecisionView, ApprovalActionConfig, CustomSectionView } from './ReportDashboard';

export interface MonthlyTrendPoint {
  label: string;
  'Total Sales': number;
  'Affiliate GMV': number;
}

const SECTION_LABELS: Record<string, string> = {
  total_sales: 'Total Sales',
  kpis: "KPI's",
  gmv_breakdown: 'GMV Breakdown',
  top_creators: 'Top Creators',
  top_videos: 'Top Videos',
  video_performance: 'Video Performance',
  creators_performance: 'Creators Performance',
  product_analytics: 'Product Analytics',
  customers: 'Customers',
  strategy_insights: 'Strategy & Insights',
  discounting: 'Discounting',
  gmv_max_ads: 'GMV Max Ads',
  paid_collabs: 'Paid Collabs',
  ai_content: 'AI Content',
  strategy_moving_forward: 'Strategy Moving Forward',
  approval: 'Approval Needed / Action Items',
};

export default function MonthlyReportDashboard({
  c, p, hasPrev, trendData,
  monthLabel, brandName, clientName, currency,
  commentsConfig, approvalAction, approvalDecisions,
  openSectionOnLoad, highlightCommentId, }: {
  c: MonthlyReportContent;
  p?: MonthlyReportContent | null;
  hasPrev?: boolean;
  trendData?: MonthlyTrendPoint[];
  monthLabel: string;
  brandName: string;
  clientName?: string | null;
  /** brand display currency (e.g. 'USD', 'EUR'); drives all money formatting. */
  currency?: string;
  commentsConfig?: CommentsConfig;
  approvalAction?: ApprovalActionConfig;
  approvalDecisions?: ApprovalDecisionView[];
  openSectionOnLoad?: CommentSection | null;
  highlightCommentId?: string | null;
}) {
  setReportCurrency(currency);
  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  useEffect(() => {
    if (!openSectionOnLoad) return;
    setFeedbackSection(openSectionOnLoad);
    setTimeout(() => {
      const el = document.querySelector(`[data-section="${CSS.escape(openSectionOnLoad)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [openSectionOnLoad]);

  const sectionFeedbackCount = (s: CommentSection) =>
    (commentsConfig?.comments ?? []).filter(c => c.section === s).length;

  const labelFor = (s: CommentSection): string => {
    if (s.startsWith('cs:')) {
      const id = s.slice(3);
      const cs = c.custom_sections.find(x => x.id === id);
      return cs?.name || 'Custom Section';
    }
    return SECTION_LABELS[s] ?? s;
  };

  const FeedbackIcon = ({ section }: { section: CommentSection }) => {
    if (!commentsConfig) return null;
    const n = sectionFeedbackCount(section);
    if (commentsConfig.mode === 'authed' && n === 0 && section !== 'approval') return null;
    // On the public client view, the approval thread is the primary follow-up
    // channel (decisions are locked) — high-contrast button on the themed header.
    const isPublicApproval = commentsConfig.mode === 'public' && section === 'approval';
    if (isPublicApproval) {
      return (
        <Button
          size="sm"
          className="ms-2 fw-semibold"
          style={{
            backgroundColor: 'var(--ac-surface-raised)',
            color: 'var(--ac-info)',
            borderColor: 'var(--ac-info)',
            whiteSpace: 'nowrap',
          }}
          onClick={() => setFeedbackSection(section)}
          title="Open the conversation thread"
        >
          <i className="bi bi-chat-left-text me-1" />
          {n > 0 ? `Thread (${n})` : 'Open thread'}
        </Button>
      );
    }
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={() => setFeedbackSection(section)}
        title={commentsConfig.mode === 'authed' ? 'View / add staff notes' : 'View / add comments'}>
        <i className="bi bi-chat-left-text" />
        {n > 0 && <Badge bg="primary" pill>{n}</Badge>}
      </Button>
    );
  };
  const SectionHeader = ({ title, section }: { title: string; section: CommentSection }) => (
    <div className="d-flex justify-content-between align-items-center w-100">
      <span className="fw-semibold">{title}</span>
      <FeedbackIcon section={section} />
    </div>
  );

  const renderCustomAt = (anchor: string) =>
    c.custom_sections.filter(s => (s.insert_after as unknown as string) === anchor).map(s => (
      <CustomSectionView
        key={s.id}
        section={s}
        prevSection={(p?.custom_sections ?? []).find(ps => ps.id === s.id) ?? null}
        feedbackSlot={<FeedbackIcon section={`cs:${s.id}`} />}
      />
    ));

  // ---------------------------------------------------------------------------
  // KPI grid + comparison data

  const kpiCards: { label: string; value: string; cur: number; prev?: number; money?: boolean; sub?: string }[] = [
    { label: 'Total Sales', value: formatMoney(c.total_sales.month),
      cur: c.total_sales.month, prev: p?.total_sales.month, money: true,
      sub: c.total_sales.all_time > 0 ? `All time: ${formatMoney(c.total_sales.all_time)}` : undefined },
    { label: 'Total Orders', value: c.kpis.total_orders.this.toLocaleString(),
      cur: c.kpis.total_orders.this, prev: c.kpis.total_orders.last },
    { label: 'Samples Approved', value: c.kpis.samples_approved.this.toLocaleString(),
      cur: c.kpis.samples_approved.this, prev: c.kpis.samples_approved.last },
    { label: 'New Affiliate Posts', value: c.kpis.new_affiliate_posts.this.toLocaleString(),
      cur: c.kpis.new_affiliate_posts.this, prev: c.kpis.new_affiliate_posts.last },
    { label: 'Completed Collabs', value: c.kpis.completed_collabs.this.toLocaleString(),
      cur: c.kpis.completed_collabs.this, prev: c.kpis.completed_collabs.last },
    { label: 'Content Pending', value: c.kpis.content_pending.this.toLocaleString(),
      cur: c.kpis.content_pending.this, prev: c.kpis.content_pending.last },
  ];

  const gmvCompareData = [
    { metric: 'Affiliate',   'This Month': c.gmv_breakdown.affiliate_gmv.this,    'Last Month': c.gmv_breakdown.affiliate_gmv.last },
    { metric: 'Organic',     'This Month': c.gmv_breakdown.organic_gmv.this,      'Last Month': c.gmv_breakdown.organic_gmv.last },
    { metric: 'LIVE',        'This Month': c.gmv_breakdown.live_gmv.this,         'Last Month': c.gmv_breakdown.live_gmv.last },
    { metric: 'Video',       'This Month': c.gmv_breakdown.video_gmv.this,        'Last Month': c.gmv_breakdown.video_gmv.last },
    { metric: 'Product Card','This Month': c.gmv_breakdown.product_card_gmv.this, 'Last Month': c.gmv_breakdown.product_card_gmv.last },
  ];

  return (
    <div className="ac-themed">
      <div className="d-flex align-items-start gap-3 mb-4 flex-wrap">
        <div className="flex-grow-1 min-w-0">
          {clientName && <div className="text-muted small">{clientName}</div>}
          <h2 className="mb-1">{brandName} <span className="text-muted fs-6">— {monthLabel}</span></h2>
        </div>
      </div>

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            {commentsConfig?.mode === 'authed' ? 'Notes / feedback' : 'Comments'}
            {feedbackSection && <small className="text-muted ms-2 fw-normal">— {labelFor(feedbackSection)}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && commentsConfig && (
            <SectionComments
              section={feedbackSection}
              sectionLabel={labelFor(feedbackSection)}
              comments={commentsConfig.comments}
              mode={commentsConfig.mode}
              currentAuthorName={commentsConfig.currentAuthorName}
              defaultPublicName={commentsConfig.defaultPublicName}
              onAdd={(b, n, parentId) => commentsConfig.onAdd(feedbackSection, b, n, parentId)}
              canReply={commentsConfig.canReply}
              highlightCommentId={highlightCommentId ?? undefined}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      {renderCustomAt('start')}

      {/* KPI cards */}
      <Row className="g-3 mb-4" data-section="total_sales">
        {kpiCards.map(k => (
          <KpiCard key={k.label} label={k.label} value={k.value} prev={k.prev} cur={k.cur} money={k.money} sub={k.sub} />
        ))}
      </Row>
      {renderCustomAt('total_sales')}
      {renderCustomAt('kpis')}

      {/* GMV breakdown (this vs last) + multi-month trend */}
      <Row className="g-3 mb-4">
        <Col lg={7}>
          <Card className="h-100" data-section="gmv_breakdown">
            <Card.Header><SectionHeader title="GMV Breakdown — month-over-month" section="gmv_breakdown" /></Card.Header>
            <Card.Body style={{ height: 320 }}>
              <ResponsiveContainer>
                <BarChart data={gmvCompareData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="metric" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="This Month" fill="var(--ac-accent-base)" radius={[6,6,0,0]} />
                  <Bar dataKey="Last Month" fill="var(--ac-text-secondary)" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={5}>
          <Card className="h-100">
            <Card.Header><span className="fw-semibold">Total Sales image</span></Card.Header>
            <Card.Body>
              {c.total_sales.image_url ? (
                <ImageBlock url={c.total_sales.image_url} alt="Total Sales screenshot" />
              ) : (
                <div className="text-muted small">No screenshot uploaded.</div>
              )}
              {c.total_sales.all_time_period_label && (
                <div className="text-muted small mt-2">
                  All-time covers <strong>{c.total_sales.all_time_period_label}</strong>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
      {renderCustomAt('gmv_breakdown')}

      {trendData && trendData.length > 1 && (
        <Card className="mb-4">
          <Card.Header><span className="fw-semibold">GMV trend (last {trendData.length} months)</span></Card.Header>
          <Card.Body style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="Total Sales"   stroke="var(--ac-accent-base)" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Affiliate GMV" stroke="var(--ac-accent-hover)" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card.Body>
        </Card>
      )}

      {/* Top Creators (this | last) */}
      <Card className="mb-3" data-section="top_creators">
        <Card.Header><SectionHeader title="Top Creators" section="top_creators" /></Card.Header>
        <Card.Body className="p-0">
          <Row className="g-0">
            <Col lg={6} className="border-end">
              <div className="px-3 pt-3"><h6 className="text-muted small mb-2 text-uppercase" style={{ letterSpacing: '.5px' }}>This Month</h6></div>
              <CreatorsTable rows={c.top_creators_this} />
            </Col>
            <Col lg={6}>
              <div className="px-3 pt-3"><h6 className="text-muted small mb-2 text-uppercase" style={{ letterSpacing: '.5px' }}>Last Month</h6></div>
              <CreatorsTable rows={c.top_creators_last} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('top_creators')}

      {/* Top Videos (this | last) */}
      <Card className="mb-3" data-section="top_videos">
        <Card.Header><SectionHeader title="Top Videos" section="top_videos" /></Card.Header>
        <Card.Body className="p-0">
          <Row className="g-0">
            <Col lg={6} className="border-end">
              <div className="px-3 pt-3"><h6 className="text-muted small mb-2 text-uppercase" style={{ letterSpacing: '.5px' }}>This Month</h6></div>
              <VideosTable rows={c.top_videos_this} />
            </Col>
            <Col lg={6}>
              <div className="px-3 pt-3"><h6 className="text-muted small mb-2 text-uppercase" style={{ letterSpacing: '.5px' }}>Last Month</h6></div>
              <VideosTable rows={c.top_videos_last} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('top_videos')}

      {/* Video Performance — MiniStats with deltas */}
      <Card className="mb-3" data-section="video_performance">
        <Card.Header><SectionHeader title="Video Performance" section="video_performance" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <MiniStat label="Product Impressions" tl={c.video_performance.product_impressions} integer />
            <MiniStat label="Product Clicks"      tl={c.video_performance.product_clicks}      integer />
            <MiniStat label="Video Views"         tl={c.video_performance.video_views}         integer />
            <MiniStat label="CTR"                 tl={c.video_performance.ctr}                 suffix="%" />
            <MiniStat label="CTOR"                tl={c.video_performance.ctor}                suffix="%" />
            <MiniStat label="SKU Orders"          tl={c.video_performance.sku_orders}          integer />
            <MiniStat label="GMV"                 tl={c.video_performance.gmv}                 money />
            <MiniStat label="New Videos Posted"   tl={c.video_performance.new_videos_posted}   integer />
            <MiniStat label="Videos with 1M+ Views"   tl={c.video_performance.videos_1m_views}    integer />
            <MiniStat label="Videos with 100k+ Views" tl={c.video_performance.videos_100k_views}  integer />
            <MiniStat label="Videos with 10k+ Views"  tl={c.video_performance.videos_10k_views}   integer />
            <MiniStat label="Videos with $1000+ GMV"  tl={c.video_performance.videos_1k_gmv}      integer />
            <MiniStat label="Videos with $100+ GMV"   tl={c.video_performance.videos_100_gmv}     integer />
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('video_performance')}

      {/* Creators Performance — MiniStats */}
      <Card className="mb-3" data-section="creators_performance">
        <Card.Header><SectionHeader title="Creators Performance" section="creators_performance" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <MiniStat label="Posted 1+ videos"         tl={c.creators_performance.posted_1plus}        integer />
            <MiniStat label="Posted 3+ videos"         tl={c.creators_performance.posted_3plus}        integer />
            <MiniStat label="Posted 10+ videos"        tl={c.creators_performance.posted_10plus}       integer />
            <MiniStat label="Generated $1k+ GMV"       tl={c.creators_performance.generated_1k_plus}   integer />
            <MiniStat label="Generated $100+ GMV"      tl={c.creators_performance.generated_100_plus}  integer />
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('creators_performance')}

      {/* Product Analytics */}
      <Card className="mb-3" data-section="product_analytics">
        <Card.Header><SectionHeader title="Product Analytics" section="product_analytics" /></Card.Header>
        <Card.Body className="p-0">
          {c.product_analytics.length === 0 ? <p className="text-muted text-center py-3 mb-0 small">No products tracked.</p> : (
            <Table size="sm" responsive className="mb-0 align-middle">
              <thead><tr>
                <th>Product</th>
                <th className="text-end">Units Sold</th>
                <th className="text-end">GMV</th>
                <th className="text-end">Samples Approved</th>
                <th>Notes</th>
              </tr></thead>
              <tbody>
                {c.product_analytics.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.product_id && <div className="small text-muted" style={{ fontFamily: 'monospace' }}>{r.product_id}</div>}
                      <div className="fw-semibold">{r.product_name || '—'}</div>
                    </td>
                    <td className="text-end">{r.units_sold.toLocaleString()}</td>
                    <td className="text-end">{formatMoney(r.gmv)}</td>
                    <td className="text-end">{r.samples_approved.toLocaleString()}</td>
                    <td className="small text-muted">{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
      {renderCustomAt('product_analytics')}

      {/* Customers — MiniStats */}
      <Card className="mb-3" data-section="customers">
        <Card.Header><SectionHeader title="Customers" section="customers" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <MiniStat label="Aware Customers"         tl={c.customers.aware_customers}         integer />
            <MiniStat label="New Customers"           tl={c.customers.new_customers}           integer />
            <MiniStat label="Potential New Customers" tl={c.customers.potential_new_customers} integer />
            <MiniStat label="Converted Customers"     tl={c.customers.converted_customers}     integer />
            <Col md={3}>
              <div className="p-3 rounded h-100" style={{ background: 'var(--ac-surface-strong)', border: '1px solid var(--ac-border)' }}>
                <div className="ac-label">CRM Messages Sent</div>
                <div className="fs-5 fw-semibold mt-1">{c.customers.crm_messages_sent_this || '—'}</div>
                {c.customers.crm_messages_sent_last && (
                  <small className="text-muted">prev: {c.customers.crm_messages_sent_last}</small>
                )}
              </div>
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('customers')}

      {/* Six rich-text + image sections */}
      {(['strategy_insights','discounting','gmv_max_ads','paid_collabs','ai_content','strategy_moving_forward'] as const).map(sec => {
        const v = c[sec];
        const empty = (!v.body || v.body.replace(/<[^>]*>/g, '').trim().length === 0) && !v.image_url;
        if (empty) return null;
        return (
          <div key={sec}>
            <Card className="mb-3" data-section={sec}>
              <Card.Header><SectionHeader title={SECTION_LABELS[sec]} section={sec} /></Card.Header>
              <Card.Body>
                {v.body && <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(v.body) }} />}
                {v.image_url && <div className="mt-3"><ImageBlock url={v.image_url} alt={SECTION_LABELS[sec]} /></div>}
              </Card.Body>
            </Card>
            {renderCustomAt(sec)}
          </div>
        );
      })}

      {/* Approval Needed */}
      {c.approval?.enabled && (() => {
        const expiresAt = c.approval?.expires_at ?? null;
        const expired = !!expiresAt && new Date(expiresAt).getTime() < Date.now();
        return (
        <Card className="mb-3" data-section="approval" border="warning">
          <Card.Header className="d-flex justify-content-between align-items-center" style={{ background: 'var(--ac-accent-soft)' }}>
            <span className="fw-semibold">
              <i className="bi bi-shield-check me-2 text-warning" />
              Approval Needed / Action Items
              {expired && (
                <Badge bg="secondary" className="ms-2">
                  <i className="bi bi-clock-history me-1" />Auto-popup expired
                </Badge>
              )}
              {!expired && expiresAt && (
                <Badge bg="light" text="dark" className="ms-2 border">
                  <i className="bi bi-clock me-1" />Popup until {new Date(expiresAt).toLocaleDateString()}
                </Badge>
              )}
            </span>
            <div className="d-flex align-items-center gap-2">
              {approvalDecisions && approvalDecisions.length > 0 && (
                <Badge bg="success" pill>
                  {approvalDecisions.length} decision{approvalDecisions.length === 1 ? '' : 's'}
                </Badge>
              )}
              <FeedbackIcon section="approval" />
            </div>
          </Card.Header>
          <Card.Body>
            {expired && (
              <Alert variant="light" className="border small py-2 mb-3">
                <i className="bi bi-info-circle me-1" />
                The auto-popup window closed on <strong>{new Date(expiresAt!).toLocaleString()}</strong>.
                You can still submit a decision or reply in the thread below.
              </Alert>
            )}
            <div className="ac-rte-view ac-approval-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(c.approval.content) }} />
            {commentsConfig?.mode === 'public' && approvalAction && <PublicApprovalForm action={approvalAction} />}
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
  );
}

// ============================================================================
// helpers / sub-components

function ImageBlock({ url, alt }: { url: string; alt: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="d-inline-block">
      <img src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 8, border: '1px solid var(--ac-border)' }} />
    </a>
  );
}

function CreatorsTable({ rows }: { rows: { username: string; gmv: number }[] }) {
  if (rows.length === 0) return <p className="text-muted small mb-0 px-3 pb-3">No data</p>;
  return (
    <Table size="sm" className="mb-0 align-middle">
      <thead><tr><th className="ps-3">Username</th><th className="text-end pe-3">GMV Generated</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}>
          <td className="ps-3 fw-semibold">
            {r.username ? (
              <a href={tiktokLink(r.username)} target="_blank" rel="noreferrer" title="Open creator on TikTok">
                {r.username}
              </a>
            ) : '—'}
          </td>
          <td className="text-end pe-3">{formatMoney(r.gmv)}</td>
        </tr>
      ))}</tbody>
    </Table>
  );
}

function VideosTable({ rows }: { rows: { username: string; video_url: string; gmv: number }[] }) {
  if (rows.length === 0) return <p className="text-muted small mb-0 px-3 pb-3">No data</p>;
  return (
    <Table size="sm" className="mb-0 align-middle">
      <thead><tr><th className="ps-3">Video</th><th className="text-end pe-3">GMV Generated</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}>
          <td className="ps-3 fw-semibold">
            {r.video_url
              ? <a href={r.video_url} target="_blank" rel="noreferrer">{r.username || r.video_url}</a>
              : (r.username || '—')}
          </td>
          <td className="text-end pe-3">{formatMoney(r.gmv)}</td>
        </tr>
      ))}</tbody>
    </Table>
  );
}

function tiktokLink(handle: string): string {
  const clean = handle.trim().replace(/^@+/, '').replace(/\s+/g, '');
  return `https://www.tiktok.com/@${encodeURIComponent(clean)}`;
}

function KpiCard({ label, value, prev, cur, money, dec, sub }: {
  label: string; value: string; prev?: number; cur: number;
  money?: boolean; dec?: boolean; sub?: string;
}) {
  return (
    <Col xs={6} md={4} xl={2}>
      <Card className="h-100 shadow-sm" style={{ borderLeft: '4px solid var(--ac-accent-base)' }}>
        <Card.Body className="py-3">
          <div className="ac-label">{label}</div>
          <div className="fs-4 fw-bold mt-1">{value}</div>
          <Delta cur={cur} prev={prev} money={money} dec={dec} />
          {sub && <small className="text-muted d-block mt-1">{sub}</small>}
        </Card.Body>
      </Card>
    </Col>
  );
}

function MiniStat({ label, tl, money, integer, suffix }: {
  label: string; tl: ThisLast; money?: boolean; integer?: boolean; suffix?: string;
}) {
  const fmt = (n: number) =>
    money ? formatMoney(n)
    : integer ? n.toLocaleString()
    : suffix ? `${n.toFixed(2)}${suffix}`
    : n.toLocaleString();
  return (
    <Col md={3}>
      <div className="p-3 rounded h-100" style={{ background: 'var(--ac-surface-strong)', border: '1px solid var(--ac-border)' }}>
        <div className="ac-label">{label}</div>
        <div className="fs-5 fw-semibold mt-1">{fmt(tl.this)}</div>
        <Delta cur={tl.this} prev={tl.last} money={money} />
      </div>
    </Col>
  );
}

/** Format a percentage, abbreviating 1000%+ as "1k" / "1.1k" / "3.2k" (sign preserved, no leading +). */
function fmtPct(pct: number): string {
  const a = Math.abs(pct);
  const body = a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : a.toFixed(1);
  return pct < 0 ? `-${body}` : body;
}

function Delta({ cur, prev, money, dec }: { cur: number; prev?: number; money?: boolean; dec?: boolean; }) {
  if (prev == null) return <small className="text-muted">—</small>;
  if (prev === 0 && cur === 0) return <small className="text-muted">no change</small>;
  const diff = cur - prev;
  const pct = prev === 0 ? 100 : (diff / prev) * 100;
  const up = diff >= 0;
  const color = up ? 'text-success' : 'text-danger';
  const icon = up ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
  const fmt = (n: number) => money ? formatMoney(Math.abs(n)) : dec ? Math.abs(n).toFixed(2) : Math.abs(n).toLocaleString();
  return (
    <small className={color} title={`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}>
      <i className={`bi ${icon}`} /> {fmt(diff)} ({pct >= 0 ? '+' : ''}{fmtPct(pct)}%)
    </small>
  );
}

function PublicApprovalForm({ action }: { action: ApprovalActionConfig }) {
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
    try {
      await onSubmit(choice, comment.trim(), name.trim());
      setJustSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  // Once a decision is recorded it's immutable — show a read-only summary and
  // point the client at the conversation thread for follow-up.
  if (myDecision) {
    return (
      <div className="mt-4 pt-3 border-top">
        <Alert variant={myDecision.decision === 'approved' ? 'success' : 'warning'} className="py-2 mb-3">
          <div className="d-flex align-items-center gap-2 mb-1">
            <i className={`bi ${myDecision.decision === 'approved' ? 'bi-check-circle-fill' : 'bi-arrow-repeat'}`} />
            <strong>
              You {myDecision.decision === 'approved' ? 'approved' : 'requested changes on'} this report.
            </strong>
          </div>
          <div className="small">
            Recorded by <strong>{myDecision.decided_by_name}</strong> on{' '}
            {new Date(myDecision.decided_at).toLocaleString()}.
          </div>
          {myDecision.comment && (
            <blockquote className="mb-0 mt-2 small ps-2"
                        style={{ borderLeft: '3px solid var(--ac-border)', whiteSpace: 'pre-wrap' }}>
              {myDecision.comment}
            </blockquote>
          )}
        </Alert>
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 small">
          <div className="text-muted">
            <i className="bi bi-lock-fill me-1" />
            Your decision is locked. The conversation stays open — use the <strong>thread</strong> above to follow up.
          </div>
          <div className="text-muted">
            <i className="bi bi-arrow-up-right me-1" />
            Tap <strong>Open thread</strong> at the top of this card.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-top">
      <div className="fw-semibold small text-uppercase text-muted mb-2" style={{ letterSpacing: '.5px' }}>
        Submit your decision
      </div>
      {err && <Alert variant="danger" className="py-2 small mb-2">{err}</Alert>}
      {justSaved && !err && <Alert variant="success" className="py-2 small mb-2">Saved. Thank you.</Alert>}
      <Form.Group className="mb-2">
        <Form.Label className="small mb-1">Your name</Form.Label>
        <Form.Control size="sm" value={name} onChange={e => setName(e.target.value)} disabled={submitting} />
      </Form.Group>
      <div className="d-flex gap-2 flex-wrap mb-2">
        <Button size="sm" variant={choice === 'approved' ? 'success' : 'outline-success'}
          onClick={() => setChoice('approved')} disabled={submitting}>
          <i className="bi bi-check-circle me-1" /> Approve
        </Button>
        <Button size="sm" variant={choice === 'changes_requested' ? 'warning' : 'outline-warning'}
          onClick={() => setChoice('changes_requested')} disabled={submitting}>
          <i className="bi bi-arrow-repeat me-1" /> Request changes
        </Button>
      </div>
      <Form.Control as="textarea" rows={2}
        placeholder="Comment (optional) — your decision is final once submitted, but the thread stays open."
        value={comment} onChange={e => setComment(e.target.value)} disabled={submitting} />
      <div className="d-flex justify-content-end mt-2">
        <Button size="sm" onClick={submit} disabled={submitting || !choice || !name.trim()}>
          {submitting ? 'Submitting…' : 'Submit decision'}
        </Button>
      </div>
    </div>
  );
}
