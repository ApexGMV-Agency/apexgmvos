import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Spinner, Alert, Badge, Button } from 'react-bootstrap';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { goBack } from '../lib/navBack';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { MonthlyReportContent, normalizeMonthlyContent } from '../lib/monthlyReportSchema';
import MonthlyReportDashboard, { MonthlyTrendPoint } from '../components/MonthlyReportDashboard';
import { ApprovalDecisionView } from '../components/ReportDashboard';
import CanvasRenderer from '../components/canvas/CanvasRenderer';
import {
  CanvasSchema, parseTemplateRow, buildMetricBagFromReportContent,
} from '../lib/reportingCanvas';
import { Comment, CommentSection } from '../components/SectionComments';
import ReportReviewBar, { ReviewState, ReviewStatus } from '../components/ReportReviewBar';

interface MonthlyRow {
  id: string; brand_id: string; month: string;
  status: string; content: any;
  template_id?: string | null;
  review_status?: ReviewStatus; reviewed_at?: string | null; review_note?: string | null;
}
interface Brand { id: string; name: string; client: string; client_status: string | null; currency?: string | null; }

function shiftMonth(yyyymm: string, delta: number) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export default function MonthlyReportView() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const openSection = params.get('section') as CommentSection | null;
  const highlightCommentId = params.get('comment');
  const { profile } = useAuth();
  const { notifications, markRead } = useNotifications();
  const [report, setReport] = useState<MonthlyRow | null>(null);
  const [templateSchema, setTemplateSchema] = useState<CanvasSchema | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [decisions, setDecisions] = useState<ApprovalDecisionView[]>([]);
  const [prev, setPrev] = useState<MonthlyRow | null>(null);
  const [trend, setTrend] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const exportPdf = async () => {
    const el = exportRef.current;
    if (!el || !report || !brand) return;
    setExporting(true);
    document.body.classList.add('ac-pdf-capturing');
    const prevWidth = el.style.width;
    const captureWidth = 1280;
    el.style.width = `${captureWidth}px`;
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    try {
      const canvas = await html2canvas(el, {
        scale: 2, useCORS: true, backgroundColor: '#ffffff',
        windowWidth: captureWidth, width: captureWidth, scrollX: 0, scrollY: 0,
      });
      const PX_TO_MM = 25.4 / 96;
      const contentWidthMm = (canvas.width / 2) * PX_TO_MM;
      const contentHeightMm = (canvas.height / 2) * PX_TO_MM;
      const margin = 8;
      const pageWidth = contentWidthMm + margin * 2;
      const pageHeight = contentHeightMm + margin * 2;
      const pdf = new jsPDF({
        unit: 'mm', format: [pageWidth, pageHeight],
        orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
      });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', margin, margin, contentWidthMm, contentHeightMm);
      pdf.save(`${brand.name.replace(/\s+/g, '_')}-${report.month}.pdf`);
    } finally {
      el.style.width = prevWidth;
      document.body.classList.remove('ac-pdf-capturing');
      setExporting(false);
    }
  };

  useEffect(() => {
    notifications.forEach(n => {
      if (!n.read_at && n.payload?.report_id === id && n.payload?.report_type === 'monthly') markRead(n.id);
    });
  }, [id, notifications, markRead]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: cur, error } = await supabase.from('monthly_reports').select('*').eq('id', id).single();
      if (error) { setErr(error.message); setLoading(false); return; }
      const r = cur as MonthlyRow;
      setReport(r);
      const { data: bd } = await supabase.from('brands').select('id,name,client,client_status,currency').eq('id', r.brand_id).single();
      setBrand(bd as Brand);
      if (r.template_id) {
        const { data: tpl } = await supabase
          .from('report_templates').select('*').eq('id', r.template_id).maybeSingle();
        if (tpl) setTemplateSchema(parseTemplateRow(tpl).schema_json);
      } else {
        setTemplateSchema(null);
      }
      // Previous month (for "Last Month" auto-comparison) and 8-month trend
      const prevMonth = shiftMonth(r.month, -1);
      const { data: pv } = await supabase.from('monthly_reports')
        .select('*').eq('brand_id', r.brand_id).eq('month', prevMonth).maybeSingle();
      setPrev(pv as MonthlyRow | null);
      const { data: tr } = await supabase.from('monthly_reports')
        .select('*').eq('brand_id', r.brand_id)
        .lte('month', r.month).order('month', { ascending: true }).limit(8);
      setTrend((tr as MonthlyRow[]) ?? []);
      const { data: cm } = await supabase.from('report_comments')
        .select('*').eq('report_id', r.id).eq('report_type', 'monthly')
        .order('created_at', { ascending: true });
      setComments((cm as Comment[]) ?? []);
      const { data: dec } = await supabase.from('report_approval_decisions')
        .select('id,decision,comment,decided_by_name,decided_at,share_link_id,report_share_links(label)')
        .eq('report_id', r.id).eq('report_type', 'monthly')
        .order('decided_at', { ascending: false });
      setDecisions(((dec as any[]) ?? []).map(d => ({
        id: d.id,
        decision: d.decision,
        comment: d.comment,
        decided_by_name: d.decided_by_name,
        decided_at: d.decided_at,
        share_link_label: d.report_share_links?.label ?? null,
      })));
      setLoading(false);
    })();
  }, [id]);

  const c = useMemo<MonthlyReportContent>(() => normalizeMonthlyContent(report?.content), [report]);
  const p = useMemo<MonthlyReportContent | null>(() => prev ? normalizeMonthlyContent(prev.content) : null, [prev]);
  const trendData: MonthlyTrendPoint[] = useMemo(() => trend.map(t => {
    const n = normalizeMonthlyContent(t.content);
    const [y, mm] = t.month.split('-').map(Number);
    return {
      label: new Date(y, mm - 1, 1).toLocaleString(undefined, { month: 'short' }),
      'Total Sales': n.total_sales.month,
      'Affiliate GMV': n.gmv_breakdown.affiliate_gmv.this,
    };
  }), [trend]);

  const addComment = async (section: CommentSection, body: string, _authorName: string, parentId?: string) => {
    if (!report) return;
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, report_type: 'monthly', section, body, parent_id: parentId ?? null },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err || !report || !brand) return <Alert variant="danger">{err ?? 'Not found'}</Alert>;

  const brandActive = brand.client_status !== 'closed';

  return (
    <>
      <div className="d-flex align-items-start gap-3 mb-3 flex-wrap">
        <button type="button" className="ac-back-btn" onClick={() => goBack(nav, '/reporting/monthly')}>
          <i className="bi bi-arrow-left" /> Back
        </button>
        <div className="flex-grow-1" />
        <div className="d-flex gap-2 flex-wrap">
          <Button variant="outline-secondary" onClick={exportPdf} disabled={exporting} title="Download a PDF copy">
            <i className="bi bi-printer me-1" /> {exporting ? 'Building PDF…' : 'Export PDF'}
          </Button>
          {brandActive && profile?.role !== 'ads_manager' && (
            <Button variant="primary" onClick={() => nav(`/reporting/monthly/${id}/edit`)}>
              <i className="bi bi-pencil me-1" /> Edit data
            </Button>
          )}
          {profile?.role === 'bob' && brandActive && (
            <Button variant="outline-danger" onClick={async () => {
              if (!confirm(`Delete this monthly report permanently?`)) return;
              const { error } = await supabase.from('monthly_reports').delete().eq('id', report!.id);
              if (error) { alert(error.message); return; }
              nav('/reporting/monthly');
            }}>
              <i className="bi bi-trash me-1" /> Delete
            </Button>
          )}
        </div>
      </div>

      <ReportReviewBar
        kind="monthly"
        reportId={report.id}
        brandId={report.brand_id}
        review={{ status: report.review_status ?? 'none', reviewed_at: report.reviewed_at, review_note: report.review_note }}
        onChanged={(next) => setReport(r => r ? { ...r, review_status: next.status, reviewed_at: next.reviewed_at, review_note: next.review_note } : r)}
        disabled={!brandActive}
      />

      {!brandActive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div>
            <strong>{brand.name} is inactive.</strong>{' '}
            This report is read-only — reactivate the brand to edit or delete it.
          </div>
        </Alert>
      )}

      <div ref={exportRef} className="ac-report-export-area">
        <div className="d-flex align-items-start gap-3 mb-4 flex-wrap">
          <div className="flex-grow-1 min-w-0">
            <div className="text-muted small">{brand.client}</div>
            <h2 className="mb-1">{brand.name} <span className="text-muted fs-6">— {fmtMonth(report.month)}</span></h2>
            <div className="text-muted">
              Monthly report
              <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
            </div>
          </div>
        </div>

        {templateSchema && (
          <div className="mb-4">
            <div className="d-flex align-items-center gap-2 mb-2">
              <Badge bg="warning" text="dark">
                <i className="bi bi-easel2 me-1" />Canvas template
              </Badge>
              <small className="text-muted">Rendered above the standard dashboard for this report.</small>
            </div>
            <CanvasRenderer
              schema={templateSchema}
              metricBag={{
                current: buildMetricBagFromReportContent(c),
                previous: prev ? buildMetricBagFromReportContent((prev as any).content) : {},
              }}
            />
            <hr className="my-4" />
          </div>
        )}

        <MonthlyReportDashboard
          c={c}
          p={p}
          hasPrev={!!prev}
          trendData={trendData}
          monthLabel={fmtMonth(report.month)}
          brandName={brand.name}
          clientName={brand.client}
          currency={brand.currency ?? undefined}
          openSectionOnLoad={openSection}
          highlightCommentId={highlightCommentId}
          approvalDecisions={decisions}
          commentsConfig={{
            mode: 'authed',
            comments,
            currentAuthorName: profile?.full_name || profile?.email || 'User',
            onAdd: addComment,
            canReply: profile?.role === 'bob',
          }}
        />
      </div>
    </>
  );
}
