import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Modal, Form, Spinner, Alert, Badge, Dropdown, InputGroup } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import TemplatePicker from '../components/canvas/TemplatePicker';
import ReportConversationOffcanvas, { ConvReport } from '../components/ReportConversationOffcanvas';

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(yyyymm: string, delta: number) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtMonth(yyyymm: string) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function recentMonths(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
function shortMonthLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

// Deterministic colored avatar palette.
const AVATAR_COLORS = [
  { bg: '#fee4cc', text: '#c5640f' },
  { bg: '#ddebfe', text: '#1e40af' },
  { bg: '#dcfce7', text: '#15803d' },
  { bg: '#fce7f3', text: '#a21caf' },
  { bg: '#fee2e2', text: '#b91c1c' },
  { bg: '#f3e8ff', text: '#7e22ce' },
  { bg: '#fef3c7', text: '#a16207' },
  { bg: '#cffafe', text: '#0e7490' },
];
function avatarFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Brand { id: string; name: string; client: string; client_status: string | null; }
interface ApcLite { id: string; email: string; full_name: string | null; }
interface MonthlyReport {
  id: string;
  brand_id: string;
  created_by: string;
  month: string;                    // 'YYYY-MM'
  status: string;
  created_at: string;
  review_status?: string;
  content?: any;
}

// Small internal-review pill shown on report cards.
const REVIEW_PILL: Record<string, { bg: string; text?: string; icon: string; label: string }> = {
  submitted: { bg: 'warning', text: 'dark', icon: 'bi-hourglass-split', label: 'Pending review' },
  approved:  { bg: 'success', icon: 'bi-patch-check-fill', label: 'Reviewed' },
  rejected:  { bg: 'danger',  icon: 'bi-arrow-counterclockwise', label: 'Changes requested' },
};

type StatusTab = 'all' | 'draft' | 'submitted' | 'unread' | 'approved';

// Latest client decision on a report (for the Approvals tab).
interface ApprovalInfo { decision: 'approved' | 'changes_requested'; name: string; at: string; }

// The report asked the client for approval — every request counts, even past
// its expires_at (expiry only stops the share link's auto-prompt).
function approvalRequested(r: { content?: any }): boolean {
  return !!r.content?.approval?.enabled;
}

export default function MonthlyReports() {
  const { profile, user } = useAuth();
  const { notifications } = useNotifications();
  const nav = useNavigate();
  const isBob = profile?.role === 'bob';
  // Ads Manager: browse + open reports read-only, never create/edit them.
  const isAdsManager = profile?.role === 'ads_manager';

  const unreadByReport = useMemo(() => {
    const m = new Map<string, number>();
    notifications.forEach(n => {
      if (n.read_at) return;
      if (n.payload?.report_type !== 'monthly') return;
      const rid = n.payload?.report_id;
      if (!rid) return;
      m.set(rid, (m.get(rid) ?? 0) + 1);
    });
    return m;
  }, [notifications]);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [apcs, setApcs] = useState<ApcLite[]>([]);
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Client approval decisions + comment counts (for the Approvals tab + conversation icon).
  const [approvalMap, setApprovalMap] = useState<Map<string, ApprovalInfo>>(new Map());
  const [commentCounts, setCommentCounts] = useState<Map<string, number>>(new Map());
  const [convReport, setConvReport] = useState<ConvReport | null>(null);

  // header state
  const [fMonth, setFMonth] = useState(thisMonth());
  const [fSearch, setFSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('all');

  // advanced filters
  const [fBrand, setFBrand] = useState('');
  const [fApc, setFApc] = useState('');

  // new report flow
  const [pickerOpen, setPickerOpen] = useState(false);
  const [show, setShow] = useState(false);
  const [createBrand, setCreateBrand] = useState<Brand | null>(null);
  const [createMonth, setCreateMonth] = useState(thisMonth());
  const [createTemplateId, setCreateTemplateId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [bRes, rRes, aRes] = await Promise.all([
      supabase.from('brands').select('id,name,client,client_status').order('name'),
      supabase.from('monthly_reports').select('*').order('month', { ascending: false }),
      isBob
        ? supabase.from('profiles').select('id,email,full_name').eq('role', 'apc')
        : Promise.resolve({ data: [] as ApcLite[], error: null }),
    ]);
    const e = bRes.error ?? rRes.error ?? (aRes as any).error;
    if (e) { setErr(e.message); setLoading(false); return; }
    setBrands(bRes.data ?? []);
    setApcs(((aRes as any).data ?? []) as ApcLite[]);
    setReports((rRes.data as MonthlyReport[]) ?? []);
    setLoading(false);
    loadFeedbackMeta();
  };

  // Client approvals + comment counts — RLS scopes both to the viewer's brands
  // (bob/team_lead/apc all have read policies). Report ids are globally unique,
  // so filtering by report_type isn't needed to look them up per card.
  const loadFeedbackMeta = async () => {
    const [decRes, cmtRes] = await Promise.all([
      supabase.from('report_approval_decisions')
        .select('report_id,decision,decided_by_name,decided_at'),
      supabase.from('report_comments').select('report_id'),
    ]);
    const am = new Map<string, ApprovalInfo>();
    (decRes.data ?? []).forEach((d: any) => {
      const cur = am.get(d.report_id);
      if (!cur || d.decided_at > cur.at) am.set(d.report_id, { decision: d.decision, name: d.decided_by_name, at: d.decided_at });
    });
    setApprovalMap(am);
    const cc = new Map<string, number>();
    (cmtRes.data ?? []).forEach((c: any) => cc.set(c.report_id, (cc.get(c.report_id) ?? 0) + 1));
    setCommentCounts(cc);
  };

  useEffect(() => { load(); }, [isBob]);

  // Re-fetch on tab focus so deletes / creates from a sibling tab stay in sync.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBob]);

  const brandMap = useMemo(() => {
    const m = new Map<string, Brand>();
    brands.forEach(b => m.set(b.id, b));
    return m;
  }, [brands]);

  const apcMap = useMemo(() => {
    const m = new Map<string, ApcLite>();
    apcs.forEach(a => m.set(a.id, a));
    return m;
  }, [apcs]);

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      if (r.month !== fMonth) return false;
      if (statusTab === 'draft' && r.status !== 'draft') return false;
      if (statusTab === 'submitted' && r.status !== 'submitted') return false;
      if (statusTab === 'unread' && (unreadByReport.get(r.id) ?? 0) === 0) return false;
      if (statusTab === 'approved' && !approvalMap.has(r.id) && !approvalRequested(r)) return false;
      if (fBrand && r.brand_id !== fBrand) return false;
      if (fApc && r.created_by !== fApc) return false;
      if (fSearch) {
        const q = fSearch.toLowerCase();
        const b = brandMap.get(r.brand_id);
        const a = apcMap.get(r.created_by);
        const hay = `${b?.name ?? ''} ${b?.client ?? ''} ${a?.full_name ?? ''} ${a?.email ?? ''} ${r.month} ${r.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, fMonth, statusTab, unreadByReport, approvalMap, fBrand, fApc, fSearch, brandMap, apcMap]);

  const tabCounts = useMemo(() => {
    const monthReports = reports.filter(r => r.month === fMonth);
    const drafts = monthReports.filter(r => r.status === 'draft').length;
    const submitted = monthReports.filter(r => r.status === 'submitted').length;
    const unread = monthReports.filter(r => (unreadByReport.get(r.id) ?? 0) > 0).length;
    const approvals = monthReports.filter(r => approvalMap.has(r.id) || approvalRequested(r)).length;
    const approvalsPending = monthReports.filter(r => !approvalMap.has(r.id) && approvalRequested(r)).length;
    return { all: monthReports.length, drafts, submitted, unread, approvals, approvalsPending };
  }, [reports, fMonth, unreadByReport, approvalMap]);

  const openCreate = (b: Brand) => {
    if (b.client_status === 'closed') {
      alert(`${b.name} is inactive — reactivate the brand before creating reports.`);
      return;
    }
    setCreateBrand(b);
    const existing = reports.filter(r => r.brand_id === b.id).map(r => r.month).sort();
    const latest = existing[existing.length - 1];
    setCreateMonth(latest ? shiftMonth(latest, 1) : thisMonth());
    setErr(null);
    setShow(true);
    setPickerOpen(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!createBrand || !user) return;
    setSaving(true); setErr(null);
    try {
      const { data: existing } = await supabase.from('monthly_reports')
        .select('id').eq('brand_id', createBrand.id).eq('month', createMonth).maybeSingle();
      if (existing) throw new Error(`A report for ${fmtMonth(createMonth)} already exists for ${createBrand.name}.`);
      const { data: inserted, error } = await supabase.from('monthly_reports').insert({
        brand_id: createBrand.id,
        created_by: user.id,
        month: createMonth,
        status: 'draft',
        template_id: createTemplateId,
      }).select('id').single();
      if (error) throw error;
      setShow(false);
      nav(`/reporting/monthly/${(inserted as any).id}/edit`);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteReport = async (r: MonthlyReport, e: React.MouseEvent) => {
    e.stopPropagation();
    const b = brandMap.get(r.brand_id);
    if (!confirm(`Delete monthly report for ${b?.name ?? 'this brand'} (${fmtMonth(r.month)})? This removes all its data and comments permanently.`)) return;
    const prev = reports;
    setReports(reports.filter(x => x.id !== r.id));
    const { error } = await supabase.from('monthly_reports').delete().eq('id', r.id);
    if (error) { alert(error.message); setReports(prev); }
  };

  const clearFilters = () => { setFBrand(''); setFApc(''); setFSearch(''); setStatusTab('all'); };
  const activeAdvancedFilters = (fBrand ? 1 : 0) + (fApc ? 1 : 0);

  const statusBadge = (r: MonthlyReport) => {
    const unread = unreadByReport.get(r.id) ?? 0;
    if (unread > 0) return { label: 'New replies', tone: 'unread' as const };
    if (r.status === 'submitted') return { label: 'Submitted', tone: 'success' as const };
    return { label: 'Draft', tone: 'draft' as const };
  };

  return (
    <div className="wr-page">
      {/* Header */}
      <div className="wr-header">
        <div className="wr-header-left">
          <div className="wr-month-seg" role="group" aria-label="Recent months">
            <i className="bi bi-calendar3 wr-month-seg-ico" />
            {recentMonths(3).map(m => (
              <button
                key={m}
                type="button"
                className={`wr-month-seg-btn${m === fMonth ? ' is-active' : ''}`}
                onClick={() => setFMonth(m)}
                aria-pressed={m === fMonth}
              >
                {shortMonthLabel(m)}
              </button>
            ))}
          </div>
        </div>

        <div className="wr-header-search">
          <InputGroup size="sm">
            <InputGroup.Text className="bg-white border-end-0">
              <i className="bi bi-search text-muted" />
            </InputGroup.Text>
            <Form.Control
              placeholder="Search brand, client, APC…"
              value={fSearch}
              onChange={e => setFSearch(e.target.value)}
              className="border-start-0"
            />
          </InputGroup>
        </div>

        <div className="wr-header-right">
          {!isAdsManager && (
            <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
              <i className="bi bi-plus-lg me-1" /> New Report
            </Button>
          )}
          <Dropdown align="end">
            <Dropdown.Toggle variant="outline-secondary" size="sm" id="mr-filters">
              <i className="bi bi-funnel me-1" /> Filters
              {activeAdvancedFilters > 0 && <Badge bg="primary" className="ms-1">{activeAdvancedFilters}</Badge>}
            </Dropdown.Toggle>
            <Dropdown.Menu className="p-3" style={{ minWidth: 280 }}>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1">Brand</Form.Label>
                <Form.Select size="sm" value={fBrand} onChange={e => setFBrand(e.target.value)}>
                  <option value="">All brands</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Form.Select>
              </Form.Group>
              {isBob && (
                <Form.Group className="mb-2">
                  <Form.Label className="small mb-1">Created by (APC)</Form.Label>
                  <Form.Select size="sm" value={fApc} onChange={e => setFApc(e.target.value)}>
                    <option value="">Anyone</option>
                    {apcs.map(a => <option key={a.id} value={a.id}>{a.full_name || a.email}</option>)}
                  </Form.Select>
                </Form.Group>
              )}
              <Button size="sm" variant="outline-secondary" className="w-100 mt-2" onClick={clearFilters}>
                <i className="bi bi-x-lg me-1" /> Clear all
              </Button>
            </Dropdown.Menu>
          </Dropdown>
          <span className="wr-count text-muted small">
            {filteredReports.length} {filteredReports.length === 1 ? 'report' : 'reports'}
          </span>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="wr-tabs">
        <button className={`wr-tab ${statusTab === 'all' ? 'is-active' : ''}`} onClick={() => setStatusTab('all')}>
          <i className="bi bi-grid me-1" /> All
          <span className="wr-tab-count">{tabCounts.all}</span>
        </button>
        <button className={`wr-tab ${statusTab === 'submitted' ? 'is-active' : ''}`} onClick={() => setStatusTab('submitted')}>
          <i className="bi bi-check-circle me-1" /> Submitted
          <span className="wr-tab-count">{tabCounts.submitted}</span>
        </button>
        <button className={`wr-tab ${statusTab === 'draft' ? 'is-active' : ''}`} onClick={() => setStatusTab('draft')}>
          <i className="bi bi-pencil me-1" /> Drafts
          <span className="wr-tab-count">{tabCounts.drafts}</span>
        </button>
        <button className={`wr-tab ${statusTab === 'unread' ? 'is-active' : ''}`} onClick={() => setStatusTab('unread')}>
          <i className="bi bi-chat-left-dots me-1" /> New replies
          <span className="wr-tab-count">{tabCounts.unread}</span>
        </button>
        <button className={`wr-tab ${statusTab === 'approved' ? 'is-active' : ''}`} onClick={() => setStatusTab('approved')}>
          <i className="bi bi-patch-check me-1" /> Approvals
          <span className="wr-tab-count">{tabCounts.approvals}</span>
          {tabCounts.approvalsPending > 0 && (
            <span
              title={`${tabCounts.approvalsPending} report${tabCounts.approvalsPending === 1 ? '' : 's'} awaiting the client's decision`}
              style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc3545', display: 'inline-block', marginLeft: 6, verticalAlign: 'middle' }}
            />
          )}
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-5"><Spinner animation="border" /></div>
      ) : err ? (
        <Alert variant="danger">{err}</Alert>
      ) : filteredReports.length === 0 ? (
        <div className="wr-empty card">
          <div className="card-body text-center py-5">
            <div className="wr-empty-icon"><i className="bi bi-calendar-month" /></div>
            <h5 className="mb-1">No reports for {fmtMonth(fMonth)}</h5>
            <p className="text-muted mb-3">
              {tabCounts.all === 0
                ? 'Nothing has been created for this month yet.'
                : 'Try adjusting your filters or status tab.'}
            </p>
            <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
              <i className="bi bi-plus-lg me-1" /> Create the first one
            </Button>
          </div>
        </div>
      ) : (
        <div className="wr-grid">
          {filteredReports.map(r => {
            const b = brandMap.get(r.brand_id);
            const a = apcMap.get(r.created_by);
            const ava = avatarFor(b?.name ?? '??');
            const sb = statusBadge(r);
            const newCount = unreadByReport.get(r.id) ?? 0;
            const clientDec = approvalMap.get(r.id);
            const cmtCount = commentCounts.get(r.id) ?? 0;
            const apcName = a?.full_name || a?.email || (r.created_by === user?.id ? 'You' : '—');
            const openConv = (e: React.MouseEvent) => {
              e.stopPropagation();
              setConvReport({
                id: r.id, type: 'monthly', title: b?.name ?? 'Report', subtitle: fmtMonth(r.month),
              });
            };
            return (
              <div
                key={r.id}
                className={`wr-card ${newCount > 0 ? 'has-unread' : ''}`}
                onClick={() => nav(`/reporting/monthly/${r.id}`)}
                role="button"
              >
                <div className="wr-card-top">
                  <div className="wr-card-brand">
                    <div className="wr-avatar" style={{ background: ava.bg, color: ava.text }}>
                      {initialsFor(b?.name ?? '??')}
                    </div>
                    <div className="wr-card-brand-meta">
                      <div className="wr-card-brand-name">{b?.name ?? '—'}</div>
                      <div className="wr-card-brand-sub">
                        by <span className="fw-medium">{apcName}</span>
                        {b?.client && <> · {b.client}</>}
                      </div>
                    </div>
                  </div>
                  <div className="wr-card-top-right">
                    {clientDec ? (
                      clientDec.decision === 'approved' ? (
                        <Badge bg="success" title={`Approved by ${clientDec.name}`}>
                          <i className="bi bi-patch-check-fill me-1" />
                          Client approved
                        </Badge>
                      ) : (
                        <Badge bg="warning" text="dark" title={`Changes requested by ${clientDec.name}`}>
                          <i className="bi bi-arrow-repeat me-1" />
                          Changes requested
                        </Badge>
                      )
                    ) : approvalRequested(r) && (
                      <Badge bg="danger" title="Approval requested — the client hasn't decided yet">
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
                        Approval pending
                      </Badge>
                    )}
                    {r.review_status && REVIEW_PILL[r.review_status] && (
                      <Badge bg={REVIEW_PILL[r.review_status].bg} text={REVIEW_PILL[r.review_status].text as any}>
                        <i className={`bi ${REVIEW_PILL[r.review_status].icon} me-1`} />
                        {REVIEW_PILL[r.review_status].label}
                      </Badge>
                    )}
                    <span className={`wr-status wr-status-${sb.tone}`}>{sb.label}</span>
                    <i className="bi bi-chevron-right wr-card-arrow" />
                  </div>
                </div>

                <div className="wr-card-mid">
                  <div className="wr-week-tag">
                    <i className="bi bi-calendar-month me-1" />
                    {fmtMonth(r.month)}
                  </div>
                  <div className="wr-year-tag">Monthly</div>
                </div>

                {/* Approvals tab: show the question/request the client was asked to approve */}
                {statusTab === 'approved' && String(r.content?.approval?.content ?? '').trim() !== '' && (
                  <div
                    className="ac-rte-view ac-approval-content small mt-2"
                    style={{ maxHeight: 110, overflowY: 'auto' }}
                    onClick={e => e.stopPropagation()}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(r.content.approval.content)) }}
                  />
                )}

                <div className="wr-card-bottom">
                  <span className="text-muted small">
                    Created {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  {newCount > 0 && (
                    <span className="wr-unread-pill">
                      <i className="bi bi-chat-left-text me-1" />{newCount} new
                    </span>
                  )}
                  {cmtCount > 0 && (
                    <Button
                      size="sm" variant="outline-secondary" className="ms-auto"
                      onClick={openConv}
                      title="View the client conversation for this report"
                    >
                      <i className="bi bi-chat-left-text me-1" />
                      Conversation
                    </Button>
                  )}
                  {isBob && statusTab !== 'approved' && (
                    <Button
                      size="sm" variant="link" className="wr-card-delete"
                      onClick={(e) => deleteReport(r, e)}
                      title="Delete report"
                    >
                      <i className="bi bi-trash" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Brand picker */}
      <Modal show={pickerOpen} onHide={() => setPickerOpen(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-plus-circle me-2 text-primary" />
            Start a new monthly report
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small mb-3">
            Pick a brand below. The month after its most recent report is selected automatically — you can change it next.
          </p>
          {brands.length === 0 ? (
            <p className="text-muted mb-0">
              {isBob ? 'No brands yet.' : 'No brands assigned to you.'}
            </p>
          ) : (
            <div className="wr-brand-grid">
              {brands.map(b => {
                const last = reports
                  .filter(r => r.brand_id === b.id)
                  .map(r => r.month)
                  .sort()
                  .pop();
                const next = last ? shiftMonth(last, 1) : thisMonth();
                const inactive = b.client_status === 'closed';
                const ava = avatarFor(b.name);
                return (
                  <button
                    key={b.id}
                    type="button"
                    className={`wr-brand-card ${inactive ? 'is-inactive' : ''}`}
                    disabled={inactive}
                    onClick={() => openCreate(b)}
                  >
                    <div className="wr-avatar wr-avatar-sm" style={{ background: ava.bg, color: ava.text }}>
                      {initialsFor(b.name)}
                    </div>
                    <div className="wr-brand-card-body">
                      <div className="fw-semibold d-flex align-items-center gap-2 flex-wrap">
                        {b.name}
                        {inactive && <Badge bg="dark"><i className="bi bi-archive me-1" />Inactive</Badge>}
                      </div>
                      <small className="text-muted">
                        {inactive ? 'Reactivate to create reports' : `Next: ${fmtMonth(next)}`}
                      </small>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Modal.Body>
      </Modal>

      {/* Create modal */}
      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>New monthly report — {createBrand?.name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group>
              <Form.Label>Month</Form.Label>
              <Form.Control type="month" required value={createMonth}
                onChange={e => setCreateMonth(e.target.value)} />
              <Form.Text className="text-muted">
                The report will cover <strong>{fmtMonth(createMonth)}</strong>.
                If a previous month's report exists for this brand, "Last Month" data will be auto-pulled into the new one.
              </Form.Text>
            </Form.Group>
            {createBrand && (
              <TemplatePicker
                reportKind="monthly"
                brandId={createBrand.id}
                value={createTemplateId}
                onChange={setCreateTemplateId}
              />
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create report'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <ReportConversationOffcanvas
        report={convReport}
        canReply={isBob}
        currentAuthorName={profile?.full_name || profile?.email || 'User'}
        onClose={() => setConvReport(null)}
      />
    </div>
  );
}
