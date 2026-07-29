import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Spinner, Alert } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { formatRange } from '../../lib/dates';
import ReportConversationOffcanvas, { ConvReport } from '../../components/ReportConversationOffcanvas';

// Brand-wise view of the client approval lifecycle — every weekly/monthly
// report of this brand that requested client approval (content.approval
// section) or already carries a decision. Same three states as the share
// link's Approvals tab: pending (red "Action required" dot), Approved,
// Changes requested. Rows open the internal report view; the Conversation
// button opens the client-feedback thread (replies are Bob-only).

interface DecisionInfo {
  decision: 'approved' | 'changes_requested';
  name: string;
  at: string;
  comment: string | null;
}

interface ApprovalRow {
  reportType: 'weekly' | 'monthly';
  reportId: string;
  periodLabel: string;
  periodKey: string;              // sortable YYYY-MM(-DD) for pending ordering
  decision: DecisionInfo | null;  // null = awaiting the client
  approvalHtml: string;           // the request body shown to the client
}

// The report asked the client for approval — every request counts, even past
// its expires_at (expiry only stops the share link's auto-prompt); same rule
// as the reporting list pages / share link.
function stillRequested(a: any): boolean {
  return !!a?.enabled;
}

function fmtMonthLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function fmtDecidedAt(at: string) {
  return new Date(at).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function BrandApprovalsTab({ brandId, brandName }: { brandId: string; brandName: string }) {
  const nav = useNavigate();
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';

  const [rows, setRows] = useState<ApprovalRow[]>([]);
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [convReport, setConvReport] = useState<ConvReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      // `approval:content->approval` pulls just the approval section of the
      // content jsonb — enough to know a request exists without the full report.
      const [wRes, mRes, dRes, cRes] = await Promise.all([
        supabase.from('weekly_reports')
          .select('id,week_start,week_end,week_number,approval:content->approval')
          .eq('brand_id', brandId).order('week_start', { ascending: false }),
        supabase.from('monthly_reports')
          .select('id,month,approval:content->approval')
          .eq('brand_id', brandId).order('month', { ascending: false }),
        // Decisions/comments have no brand column — RLS scopes them to the
        // viewer's brands; we intersect with this brand's report ids below.
        supabase.from('report_approval_decisions')
          .select('report_id,report_type,decision,comment,decided_by_name,decided_at'),
        supabase.from('report_comments').select('report_id'),
      ]);
      if (cancelled) return;
      const e = wRes.error ?? mRes.error ?? dRes.error ?? cRes.error;
      if (e) { setErr(e.message); setLoading(false); return; }

      const latest = new Map<string, DecisionInfo>();
      (dRes.data ?? []).forEach((d: any) => {
        const cur = latest.get(d.report_id);
        if (!cur || d.decided_at > cur.at) {
          latest.set(d.report_id, {
            decision: d.decision, name: d.decided_by_name, at: d.decided_at, comment: d.comment,
          });
        }
      });

      const out: ApprovalRow[] = [];
      (wRes.data ?? []).forEach((r: any) => {
        const dec = latest.get(r.id) ?? null;
        if (!dec && !stillRequested(r.approval)) return;
        out.push({
          reportType: 'weekly', reportId: r.id,
          periodLabel: `Week #${r.week_number} — ${formatRange(r.week_start, r.week_end)}`,
          periodKey: r.week_start, decision: dec,
          approvalHtml: String(r.approval?.content ?? ''),
        });
      });
      (mRes.data ?? []).forEach((r: any) => {
        const dec = latest.get(r.id) ?? null;
        if (!dec && !stillRequested(r.approval)) return;
        out.push({
          reportType: 'monthly', reportId: r.id,
          periodLabel: fmtMonthLabel(r.month), periodKey: r.month, decision: dec,
          approvalHtml: String(r.approval?.content ?? ''),
        });
      });
      // Pending first (newest period), then decided newest-decision-first.
      out.sort((a, b) => {
        if (!a.decision !== !b.decision) return a.decision ? 1 : -1;
        if (!a.decision || !b.decision) return b.periodKey.localeCompare(a.periodKey);
        return b.decision.at.localeCompare(a.decision.at);
      });
      setRows(out);

      const brandReportIds = new Set<string>([
        ...(wRes.data ?? []).map((r: any) => r.id),
        ...(mRes.data ?? []).map((r: any) => r.id),
      ]);
      const cc = new Map<string, number>();
      (cRes.data ?? []).forEach((c: any) => {
        if (brandReportIds.has(c.report_id)) cc.set(c.report_id, (cc.get(c.report_id) ?? 0) + 1);
      });
      setCommentCounts(cc);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  const pendingCount = useMemo(() => rows.filter(r => !r.decision).length, [rows]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <div>
      <div className="mb-3">
        <h5 className="mb-0">{brandName} — Report Approvals</h5>
        <small className="text-muted">
          {rows.length} approval request{rows.length !== 1 ? 's' : ''}
          {pendingCount > 0 && (
            <> · <span className="text-danger fw-semibold">{pendingCount} awaiting the client's decision</span></>
          )} — click a row to open the report
        </small>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <i className="bi bi-clipboard-check" style={{ fontSize: '2rem' }} /><br />
          No approval requests yet. Reports that ask the client for approval will show up here.
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {rows.map(({ reportType, reportId, periodLabel, decision: d, approvalHtml }) => {
            const state: 'pending' | 'approved' | 'changes' =
              !d ? 'pending' : d.decision === 'approved' ? 'approved' : 'changes';
            const color = state === 'approved' ? '#198754' : state === 'changes' ? '#d97706' : '#dc3545';
            const icon = state === 'approved' ? 'bi-check-circle-fill'
              : state === 'changes' ? 'bi-arrow-repeat' : 'bi-shield-exclamation';
            const cmtCount = commentCounts.get(reportId) ?? 0;
            return (
              <div
                key={`${reportType}:${reportId}`}
                role="button"
                tabIndex={0}
                title="Open this report"
                className="d-flex align-items-center gap-3 p-3 rounded"
                style={{
                  background: 'white', border: '1px solid #e5e7eb',
                  borderLeft: `4px solid ${color}`, cursor: 'pointer',
                  transition: 'transform .15s, box-shadow .15s',
                }}
                onClick={() => nav(`/reporting/${reportType}/${reportId}`)}
                onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 10, background: `${color}15`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <i className={`bi ${icon}`} style={{ color, fontSize: '1.3rem' }} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="fw-semibold">{periodLabel}</span>
                    <Badge bg={reportType === 'weekly' ? 'primary' : 'info'} pill>
                      {reportType === 'weekly' ? 'Weekly' : 'Monthly'}
                    </Badge>
                    {state === 'pending' && (
                      <Badge bg="danger" pill>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
                        Awaiting client
                      </Badge>
                    )}
                    {state === 'changes' && (
                      <Badge bg="warning" text="dark" pill>Changes requested</Badge>
                    )}
                  </div>
                  <small className="text-muted d-block mt-1">
                    {state === 'pending' ? (
                      <><i className="bi bi-hourglass-split me-1" />Approval requested — the client hasn't decided yet</>
                    ) : state === 'approved' ? (
                      <><i className="bi bi-person-check me-1" />Approved by {d!.name} · {fmtDecidedAt(d!.at)}</>
                    ) : (
                      <><i className="bi bi-person-exclamation me-1" />Changes requested by {d!.name} · {fmtDecidedAt(d!.at)}</>
                    )}
                  </small>
                  {approvalHtml && (
                    <div
                      className="ac-rte-view ac-approval-content small mt-2"
                      style={{ maxHeight: 110, overflowY: 'auto' }}
                      onClick={e => e.stopPropagation()}
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(approvalHtml) }}
                    />
                  )}
                  {d?.comment && (
                    <small className="text-muted d-block mt-1 text-truncate fst-italic">
                      “{d.comment}”
                    </small>
                  )}
                </div>
                {cmtCount > 0 && (
                  <Button
                    size="sm"
                    variant={state === 'approved' ? 'outline-success' : 'outline-secondary'}
                    title="View the client conversation for this report"
                    onClick={e => {
                      e.stopPropagation();
                      setConvReport({
                        id: reportId, type: reportType, title: brandName, subtitle: periodLabel,
                      });
                    }}
                  >
                    <i className="bi bi-chat-left-text me-1" /> Conversation
                    <Badge bg={state === 'approved' ? 'success' : 'secondary'} pill className="ms-1">{cmtCount}</Badge>
                  </Button>
                )}
                <i className="bi bi-chevron-right text-muted" />
              </div>
            );
          })}
        </div>
      )}

      <ReportConversationOffcanvas
        report={convReport}
        canReply={isBob}
        currentAuthorName={profile?.full_name || profile?.email || 'User'}
        onClose={() => setConvReport(null)}
      />
    </div>
  );
}
