import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { Card, Spinner, Alert, Form, Row, Col, Badge, Button, Tab, Nav, Offcanvas, Modal } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { addDays, formatRange, formatHuman, formatWeekShort, fromISO } from '../lib/dates';
import { WeeklyReportContent, normalizeContent } from '../lib/reportSchema';
import { normalizeContentV2 } from '../lib/reportSchemaV2';
import { normalizeContentV3 } from '../lib/reportSchemaV3';
import { MonthlyReportContent, normalizeMonthlyContent } from '../lib/monthlyReportSchema';
import ReportDashboard, { TrendPoint, ApprovalDecisionView } from '../components/ReportDashboard';
import ReportDashboardV2 from '../components/ReportDashboardV2';
import ReportDashboardV3 from '../components/ReportDashboardV3';
import MonthlyReportDashboard from '../components/MonthlyReportDashboard';
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { resourceIcon } from '../lib/resourceIcon';
import ResourceComments, { ResourceComment } from '../components/ResourceComments';
import ApprovalsModal, { PendingApprovalReport } from '../components/share/ApprovalsModal';
// import MonthPickerModal from '../components/share/MonthPickerModal'; // disabled — see MonthQuickPicks
import LatestReportsModal from '../components/share/LatestReportsModal';
import Avatar from '../components/Avatar';

interface ApprovalDecisionRow {
  id: string;
  report_id: string;
  report_type: 'weekly' | 'monthly';
  share_link_id: string;
  decision: 'approved' | 'changes_requested';
  comment: string | null;
  decided_by_name: string;
  decided_at: string;
}

interface Brand { id: string; name: string; client: string | null; client_id: string | null; payment_popup_default?: 'auto' | 'force_hide' | 'force_show'; currency?: string | null; }
interface Report {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: WeeklyReportContent;
}
interface MonthlyReport {
  id: string; brand_id: string; month: string;
  status: string; content: MonthlyReportContent;
}
interface SharedResource { id: string; name: string; url: string; description: string | null; scope: string; brand_id: string | null; }

export default function SharedReports() {
  const { token } = useParams<{ token: string }>();
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [monthlyReports, setMonthlyReports] = useState<MonthlyReport[]>([]);
  const [resources, setResources] = useState<SharedResource[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [resourceComments, setResourceComments] = useState<ResourceComment[]>([]);
  const [feedbackResource, setFeedbackResource] = useState<SharedResource | null>(null);
  const [publicName, setPublicName] = useState<string>(localStorage.getItem('ac_public_name') ?? '');
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [activeBrandId, setActiveBrandId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'reporting' | 'monthly' | 'approved' | 'resources'>('reporting');
  const [month, setMonth] = useState(currentMonth());
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMonthlyId, setOpenMonthlyId] = useState<string | null>(null);
  const [includeReports, setIncludeReports] = useState(true);
  const [includeMonthlyReports, setIncludeMonthlyReports] = useState(false);
  const [includeResources, setIncludeResources] = useState(true);

  const [linkMode, setLinkMode] = useState<'brand' | 'general'>('brand');
  // Sample-seeding rows for the v3 MTD tiles / per-product samples column.
  // null = the edge fn payload didn't carry them (not redeployed yet).
  const [samplesDaily, setSamplesDaily] = useState<any[] | null>(null);
  const [samplesProducts, setSamplesProducts] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<ApprovalDecisionRow[]>([]);
  // Every link's decisions on this link's reports — feeds the "Approvals"
  // tab so decisions made via an older/rotated link still show.
  const [allDecisions, setAllDecisions] = useState<ApprovalDecisionRow[]>([]);
  const [showApprovals, setShowApprovals] = useState(false);
  const [singleApprovalId, setSingleApprovalId] = useState<string | null>(null);
  const [singleApprovalType, setSingleApprovalType] = useState<'weekly' | 'monthly'>('weekly');
  const [pickerAfterApprovals, setPickerAfterApprovals] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  // Replaces the legacy month picker as the initial landing prompt — shows the
  // 3 most-recent reports so the client can jump straight in or close to browse.
  const [showLatestReports, setShowLatestReports] = useState(false);
  // Standalone approval-thread offcanvas — lets the client open a report's
  // conversation thread from the share landing cards without going into the
  // full dashboard. Each report has its own thread (filtered by report_id).
  const [threadFor, setThreadFor] = useState<{
    reportId: string; reportType: 'weekly' | 'monthly';
    brandName: string; periodLabel: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      try {
        const { data, error } = await supabase.functions.invoke('get-shared-reports', {
          body: { token },
        });
        if (error) throw await fnError(error);
        if ((data as any)?.error) throw new Error((data as any).error);
        setClient(data.client);
        setBrands(data.brands);
        setReports(data.reports);
        setMonthlyReports(data.monthly_reports ?? []);
        setResources(data.resources ?? []);
        setComments(data.comments ?? []);
        setResourceComments(data.resource_comments ?? []);
        setDecisions(data.approval_decisions ?? []);
        // Fallback to the per-link list if the edge fn hasn't been redeployed
        // with approval_decisions_all yet.
        setAllDecisions(data.approval_decisions_all ?? data.approval_decisions ?? []);
        setLabel(data.label);
        const ir = data.include_reports !== false;
        const im = data.include_monthly_reports === true;
        const ix = data.include_resources !== false;
        setIncludeReports(ir);
        setIncludeMonthlyReports(im);
        setIncludeResources(ix);
        setSamplesDaily((data.samples_daily as any[] | undefined) ?? null);
        setSamplesProducts((data.samples_products as any[] | undefined) ?? []);
        const mode: 'brand' | 'general' = data.link_mode === 'general' ? 'general' : 'brand';
        setLinkMode(mode);
        // Default landing tab — first enabled section
        if (ir) setActiveTab('reporting');
        else if (im) setActiveTab('monthly');
        else if (ix) setActiveTab('resources');
        if (data.brands?.length > 0) setActiveBrandId(data.brands[0].id);

        // Brand-mode entry flow: the welcome popup (latest reports).
        if (mode === 'brand') {
          // Approvals no longer auto-open on landing — the prompt appears only
          // when the client opens the specific report that requested approval
          // (see maybePromptApproval, driven by openId / openMonthlyId).
          if (ir || im) {
            setShowLatestReports(true);
          }
        }
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load');
      }
      setLoading(false);
    })();
  }, [token]);

  const activeBrand = useMemo(() => brands.find(b => b.id === activeBrandId) ?? null, [brands, activeBrandId]);

  const brandReports = useMemo(() => {
    return reports.filter(r => r.brand_id === activeBrandId);
  }, [reports, activeBrandId]);

  const monthFiltered = useMemo(() => {
    if (month === 'all') return brandReports;
    return brandReports.filter(r => r.week_start.slice(0, 7) === month);
  }, [brandReports, month]);

  const brandResources = useMemo(() => {
    // brand-specific + general for the public
    return resources.filter(r =>
      (r.scope === 'brand' && r.brand_id === activeBrandId) || r.scope === 'general'
    );
  }, [resources, activeBrandId]);

  const openReport = useMemo(() => reports.find(r => r.id === openId) ?? null, [reports, openId]);
  const prevReport = useMemo(() => {
    if (!openReport) return null;
    const prevEnd = addDays(openReport.week_start, -1);
    return reports.find(r => r.brand_id === openReport.brand_id && r.week_end === prevEnd) ?? null;
  }, [openReport, reports]);
  const trendData: TrendPoint[] = useMemo(() => {
    if (!openReport) return [];
    return reports
      .filter(r => r.brand_id === openReport.brand_id && r.week_start <= openReport.week_start)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-8)
      .map(t => {
        const cn: any = t.content ?? {};
        const gmv = cn?.snapshot?.total_gmv ?? cn?.gmv_performance?.total_gmv ?? cn?.overall?.total_gmv;
        const aff = cn?.snapshot?.affiliate_gmv ?? cn?.gmv_performance?.affiliate_gmv ?? cn?.overall?.affiliate_gmv ?? cn?.affiliate?.affiliate_gmv;
        return {
          label: formatWeekShort(t.week_start, t.week_end),
          GMV: Number(gmv) || 0,
          'Affiliate GMV': Number(aff) || 0,
        };
      });
  }, [openReport, reports]);

  // v3 week-over-week combo series (bars = orders, line = GMV).
  const wowData = useMemo(() => {
    if (!openReport) return [];
    return reports
      .filter(r => r.brand_id === openReport.brand_id && r.week_start <= openReport.week_start)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-8)
      .map(t => {
        const cn: any = t.content ?? {};
        const gmv = cn?.overall?.total_gmv ?? cn?.snapshot?.total_gmv ?? cn?.gmv_performance?.total_gmv;
        const orders = cn?.overall?.orders ?? cn?.snapshot?.orders ?? cn?.shop_analytics?.orders;
        return { label: formatWeekShort(t.week_start, t.week_end), gmv: Number(gmv) || 0, orders: Number(orders) || 0 };
      });
  }, [openReport, reports]);

  // v3 §1 samples/videos weekly series (from report content — client-safe).
  const sampleSeries = useMemo(() => {
    if (!openReport) return [];
    return reports
      .filter(r => r.brand_id === openReport.brand_id && r.week_start <= openReport.week_start)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-8)
      .map(t => {
        const cn: any = t.content ?? {};
        const s: any = cn?.sampling ?? {};
        const toN = (v: any) => (v == null || v === '') ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
        return { label: formatWeekShort(t.week_start, t.week_end), samples: toN(s.samples_approved), videos: toN(s.new_videos_posted) };
      });
  }, [openReport, reports]);

  // v3 §7 — per-week offsite metric series for the trend sparklines (client-safe;
  // read straight from each shared report's content).
  const offsiteSeries = useMemo(() => {
    if (!openReport) return [];
    return reports
      .filter(r => r.brand_id === openReport.brand_id && r.week_start <= openReport.week_start)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-8)
      .map(t => {
        const cn: any = t.content ?? {};
        const o: any = cn?.offsite ?? {};
        const toN = (v: any) => (v == null || v === '') ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
        return { label: formatWeekShort(t.week_start, t.week_end), offsite_gmv: toN(o.offsite_gmv), tiktok_shop_gmv: toN(o.tiktok_shop_gmv), offsite_effect: toN(o.offsite_effect) };
      });
  }, [openReport, reports]);

  // v3 §8 — per-week affiliate metric series for the multi-line trend.
  const affiliateSeries = useMemo(() => {
    if (!openReport) return [];
    return reports
      .filter(r => r.brand_id === openReport.brand_id && r.week_start <= openReport.week_start)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-8)
      .map(t => {
        const cn: any = t.content ?? {};
        const a: any = cn?.affiliate ?? {};
        const toN = (v: any) => (v == null || v === '') ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
        return { label: formatWeekShort(t.week_start, t.week_end), affiliate_gmv: toN(a.affiliate_gmv), live_sessions: toN(a.live_sessions), contacted_creators: toN(a.contacted_creators) };
      });
  }, [openReport, reports]);

  // v3 §12 — per-week GMV Max aggregates (summed over the week's product rows).
  const gmvMaxSeries = useMemo(() => {
    if (!openReport) return [];
    return reports
      .filter(r => r.brand_id === openReport.brand_id && r.week_start <= openReport.week_start)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-8)
      .map(t => {
        const gr: any[] = Array.isArray((t.content as any)?.gmv_max) ? (t.content as any).gmv_max : [];
        const nv = (v: any) => Number(v) || 0;
        const cost = gr.reduce((s, r) => s + nv(r.cost), 0);
        const rev = gr.reduce((s, r) => s + nv(r.gross_revenue), 0);
        const orders = gr.reduce((s, r) => s + nv(r.sku_orders), 0);
        return {
          label: formatWeekShort(t.week_start, t.week_end),
          ad_spend: gr.length ? cost : null, revenue: gr.length ? rev : null,
          roas: cost > 0 ? rev / cost : null, cpo: orders > 0 ? cost / orders : null,
        };
      });
  }, [openReport, reports]);

  // v3 §1 "Samples Approved MTD" / "Videos Posted MTD" tiles + §3 per-product
  // samples column. When the edge fn returns the sample-seeding daily rows
  // (samples_daily) this runs the EXACT same math as Bob's WeeklyReportView —
  // month-window scoped to the 1st, so a week straddling the month boundary
  // only counts its in-month days. Fallback (older fn payload): approximate by
  // summing the shared weekly reports whose week ends in the open month.
  const { mtd, productSamples } = useMemo(() => {
    const none = { mtd: undefined, productSamples: undefined as Record<string, number | null> | undefined };
    if (!openReport || (openReport.content as any)?.format_version !== 'v3') return none;
    const monthStart = `${openReport.week_end.slice(0, 7)}-01`;
    if (samplesDaily) {
      const rows = samplesDaily.filter(d =>
        d.brand_id === openReport.brand_id && d.entry_date <= openReport.week_end);
      const sumCounts = (pc: any) => Object.values(pc ?? {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
      const monthRows = rows.filter(d => d.entry_date >= monthStart);
      const mtdVal: { samples: number | null; videos: number | null } = monthRows.length === 0
        ? { samples: null, videos: null }
        : {
          samples: monthRows.reduce((s, d) => s + sumCounts(d.product_counts) + (Number(d.others_count) || 0), 0),
          videos: monthRows.reduce((s, d) => s + (Number(d.new_videos) || 0), 0),
        };
      const weekRows = rows.filter(d => d.entry_date >= openReport.week_start);
      const bySpid: Record<string, number> = {};
      for (const d of weekRows) for (const [spid, cnt] of Object.entries(d.product_counts ?? {})) bySpid[spid] = (bySpid[spid] ?? 0) + (Number(cnt) || 0);
      const extBySpid = new Map(samplesProducts.filter(p => p.brand_id === openReport.brand_id)
        .map(p => [String(p.id), String(p.external_product_id ?? '')]));
      const byExt: Record<string, number | null> = {};
      for (const [spid, cnt] of Object.entries(bySpid)) { const ext = extBySpid.get(spid); if (ext) byExt[ext] = (Number(byExt[ext]) || 0) + cnt; }
      return { mtd: mtdVal, productSamples: byExt };
    }
    const toN = (v: any) => (v == null || v === '') ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
    const monthReports = reports.filter(r =>
      r.brand_id === openReport.brand_id && r.week_end >= monthStart && r.week_end <= openReport.week_end);
    const sum = (key: 'samples_approved' | 'new_videos_posted') => {
      const vals = monthReports.map(r => toN(((r.content as any)?.sampling ?? {})[key])).filter((v): v is number => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    };
    return { mtd: { samples: sum('samples_approved'), videos: sum('new_videos_posted') }, productSamples: undefined };
  }, [openReport, reports, samplesDaily, samplesProducts]);

  // Latest decision per report from ANY link (allDecisions), keyed
  // `type:id` so a weekly + monthly report never accidentally share state.
  // Legacy decision rows may lack report_type — treat anything that isn't
  // 'monthly' as weekly (report ids are unique across both tables anyway).
  // This single map drives every decision read-out: the report cards, the
  // Approvals tab, the popup's locked "your decision" state, and the
  // pending-approvals prompt — so they can never disagree with each other.
  const latestDecisions = useMemo(() => {
    const m = new Map<string, ApprovalDecisionRow>();
    for (const d of allDecisions) {
      const t = d.report_type === 'monthly' ? 'monthly' : 'weekly';
      const k = `${t}:${d.report_id}`;
      const cur = m.get(k);
      if (!cur || d.decided_at > cur.decided_at) m.set(k, d);
    }
    return m;
  }, [allDecisions]);
  const decidedSet = useMemo(
    () => new Set(latestDecisions.keys()),
    [latestDecisions],
  );
  // Show the approval prompt only when the client OPENS a report that requested
  // approval (and hasn't decided yet). promptedRef stops it re-popping when the
  // client navigates between weeks and back.
  const promptedRef = useRef<Set<string>>(new Set());
  const maybePromptApproval = (r: { id: string; content: any } | null, type: 'weekly' | 'monthly') => {
    if (!r) return;
    const a = (r.content as any)?.approval;
    if (!a?.enabled) return;
    if (a.expires_at && new Date(a.expires_at).getTime() < Date.now()) return;
    const key = `${type}:${r.id}`;
    // Don't re-prompt for a report already decided on ANY link (decidedSet
    // derives from allDecisions, so rotated links are covered).
    if (decidedSet.has(key) || promptedRef.current.has(key)) return;
    promptedRef.current.add(key);
    setSingleApprovalId(r.id);
    setSingleApprovalType(type);
    setShowApprovals(true);
  };
  useEffect(() => { maybePromptApproval(reports.find(r => r.id === openId) ?? null, 'weekly'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [openId]);
  useEffect(() => { maybePromptApproval(monthlyReports.find(r => r.id === openMonthlyId) ?? null, 'monthly'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [openMonthlyId]);
  const fmtMonth = (yyyymm: string) => {
    const [y, m] = yyyymm.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  };
  const weeklyToPending = (r: Report): PendingApprovalReport => {
    const b = brands.find(x => x.id === r.brand_id);
    return {
      id: r.id,
      report_type: 'weekly',
      brand_id: r.brand_id,
      brand_name: b?.name ?? 'Brand',
      period_label: `Week #${r.week_number} — ${formatRange(r.week_start, r.week_end)}`,
      approval_html: normalizeContent(r.content).approval?.content ?? '',
    };
  };
  const monthlyToPending = (r: MonthlyReport): PendingApprovalReport => {
    const b = brands.find(x => x.id === r.brand_id);
    return {
      id: r.id,
      report_type: 'monthly',
      brand_id: r.brand_id,
      brand_name: b?.name ?? 'Brand',
      period_label: fmtMonth(r.month),
      approval_html: normalizeMonthlyContent(r.content).approval?.content ?? '',
    };
  };
  const pendingApprovals: PendingApprovalReport[] = useMemo(() => {
    const now = Date.now();
    const stillAutoPromptable = (a: any) => {
      if (a?.enabled !== true) return false;
      if (a.expires_at && new Date(a.expires_at).getTime() < now) return false;
      return true;
    };
    const w = reports
      .filter(r => stillAutoPromptable(r.content?.approval) && !decidedSet.has(`weekly:${r.id}`))
      .map(weeklyToPending);
    const m = monthlyReports
      .filter(r => stillAutoPromptable(r.content?.approval) && !decidedSet.has(`monthly:${r.id}`))
      .map(monthlyToPending);
    return [...w, ...m];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, monthlyReports, brands, decidedSet]);
  // For the badge → popup flow we may pass a single (possibly already-decided) report.
  const modalPending: PendingApprovalReport[] = useMemo(() => {
    if (singleApprovalId) {
      if (singleApprovalType === 'monthly') {
        const one = monthlyReports.find(r => r.id === singleApprovalId);
        return one ? [monthlyToPending(one)] : [];
      }
      const one = reports.find(r => r.id === singleApprovalId);
      return one ? [weeklyToPending(one)] : [];
    }
    return pendingApprovals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleApprovalId, singleApprovalType, reports, monthlyReports, pendingApprovals]);
  const existingDecisionsMap = useMemo(() => {
    const map: Record<string, { decision: 'approved' | 'changes_requested'; comment: string | null; decided_by_name: string; decided_at: string }> = {};
    for (const d of latestDecisions.values()) {
      map[d.report_id] = {
        decision: d.decision,
        comment: d.comment,
        decided_by_name: d.decided_by_name,
        decided_at: d.decided_at,
      };
    }
    return map;
  }, [latestDecisions]);
  const monthsWithData = useMemo(() => {
    const s = new Set<string>(reports.map(r => r.week_start.slice(0, 7)));
    monthlyReports.forEach(r => s.add(r.month));
    return s;
  }, [reports, monthlyReports]);

  // "Approvals" tab — every shared report on this brand that requested client
  // approval, joined to the client's latest decision when one exists (null =
  // still awaiting the client — action required). Undecided requests sort
  // first (newest period), then decided rows newest-decision-first. Uses
  // allDecisions (every link's decisions) so history survives link rotation;
  // reports no longer on the link are skipped (we iterate the shared reports).
  const approvalsForBrand = useMemo(() => {
    // Every requested approval gets a row, decided or not — expiry only stops
    // the auto-prompt, the client can still decide from the cards/this tab.
    const stillRequested = (a: any) => !!a?.enabled;
    const rows: {
      decision: ApprovalDecisionRow | null;
      reportType: 'weekly' | 'monthly';
      reportId: string;
      periodLabel: string;
      monthKey: string;
      approvalHtml: string;
    }[] = [];
    for (const r of reports) {
      if (r.brand_id !== activeBrandId) continue;
      const d = latestDecisions.get(`weekly:${r.id}`) ?? null;
      if (!d && !stillRequested((r.content as any)?.approval)) continue;
      rows.push({
        decision: d, reportType: 'weekly', reportId: r.id,
        periodLabel: `Week #${r.week_number} — ${formatRange(r.week_start, r.week_end)}`,
        monthKey: r.week_start.slice(0, 7),
        approvalHtml: String((r.content as any)?.approval?.content ?? ''),
      });
    }
    for (const r of monthlyReports) {
      if (r.brand_id !== activeBrandId) continue;
      const d = latestDecisions.get(`monthly:${r.id}`) ?? null;
      if (!d && !stillRequested((r.content as any)?.approval)) continue;
      rows.push({
        decision: d, reportType: 'monthly', reportId: r.id,
        periodLabel: fmtMonthLabel(r.month), monthKey: r.month,
        approvalHtml: String((r.content as any)?.approval?.content ?? ''),
      });
    }
    rows.sort((a, b) => {
      if (!a.decision !== !b.decision) return a.decision ? 1 : -1;
      if (!a.decision || !b.decision) return b.monthKey.localeCompare(a.monthKey);
      return b.decision.decided_at.localeCompare(a.decision.decided_at);
    });
    return rows;
  }, [latestDecisions, reports, monthlyReports, activeBrandId]);
  const pendingApprovalRows = approvalsForBrand.filter(r => !r.decision).length;

  const clientName = client?.name ?? 'Client';
  if (loading) return <PublicShell clientName={clientName}><div className="text-center py-5"><Spinner animation="border" /></div></PublicShell>;
  if (err) return <PublicShell clientName={clientName}><Alert variant="danger">{err}</Alert></PublicShell>;

  // Low-level: post a comment to a specific (report, section). Used by both
  // the in-dashboard threads and the standalone thread offcanvas on the cards.
  const postComment = async (
    reportType: 'weekly' | 'monthly', reportId: string,
    section: CommentSection, body: string, authorName: string, parentId?: string,
  ) => {
    const { data, error } = await supabase.functions.invoke('post-shared-comment', {
      body: { token, report_id: reportId, report_type: reportType, section, author_name: authorName, body, parent_id: parentId },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
    setPublicName(authorName);
  };

  const addComment = async (
    section: CommentSection, body: string, authorName: string, parentId?: string,
    reportType: 'weekly' | 'monthly' = 'weekly',
  ) => {
    const reportId = reportType === 'monthly' ? openMonthlyId : (openReport?.id ?? null);
    if (!reportId) return;
    await postComment(reportType, reportId, section, body, authorName, parentId);
  };

  // Count approval-section comments per report so the "Thread (N)" badge on
  // each card shows live counts. Comments include the mirrored decision rows.
  const approvalThreadCount = (reportId: string, reportType: 'weekly' | 'monthly') =>
    comments.filter(c =>
      c.report_id === reportId &&
      ((reportType === 'monthly' ? c.report_type === 'monthly' : c.report_type !== 'monthly')) &&
      c.section === 'approval'
    ).length;

  // Comments to show inside the standalone thread offcanvas.
  const threadComments: Comment[] = threadFor
    ? comments.filter(c =>
        c.report_id === threadFor.reportId &&
        ((threadFor.reportType === 'monthly' ? c.report_type === 'monthly' : c.report_type !== 'monthly')) &&
        c.section === 'approval'
      )
    : [];

  const onThreadAdd = async (body: string, name: string, parentId?: string) => {
    if (!threadFor) return;
    await postComment(threadFor.reportType, threadFor.reportId, 'approval', body, name, parentId);
  };

  const reportComments = openReport ? comments.filter(c => c.report_id === openReport.id && c.report_type !== 'monthly') : [];
  const openMonthly = openMonthlyId ? monthlyReports.find(r => r.id === openMonthlyId) ?? null : null;
  const monthlyReportComments = openMonthly ? comments.filter(c => c.report_id === openMonthly.id && c.report_type === 'monthly') : [];

  const submitApprovals = async (
    items: { report_id: string; report_type: 'weekly' | 'monthly'; decision: 'approved' | 'changes_requested'; comment: string; decided_by_name: string }[]
  ) => {
    for (const it of items) {
      const { data, error } = await supabase.functions.invoke('post-approval-decision', {
        body: { token, ...it },
      });
      if (error) throw await fnError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      const inserted = (data as any).decision;
      setDecisions(prev => {
        const filtered = prev.filter(d => !(d.report_id === inserted.report_id && d.report_type === inserted.report_type));
        return [...filtered, inserted];
      });
      // Keep the "Approved" history tab in sync (decision rows are unique by
      // id, so a plain de-dup append is enough here).
      setAllDecisions(prev => prev.some(d => d.id === inserted.id) ? prev : [...prev, inserted]);
      // The edge function also mirrors the decision into report_comments so the
      // approval section's offcanvas thread shows it. Push it into local state.
      const mirrorComment = (data as any).comment;
      if (mirrorComment?.id) {
        setComments(prev => prev.some(c => c.id === mirrorComment.id) ? prev : [...prev, mirrorComment as Comment]);
      }
    }
    if (items[0]?.decided_by_name) {
      setPublicName(items[0].decided_by_name);
      localStorage.setItem('ac_public_name', items[0].decided_by_name);
    }
  };

  const addResourceComment = async (body: string, authorName: string, parentId?: string) => {
    if (!feedbackResource) return;
    const { data, error } = await supabase.functions.invoke('post-shared-resource-comment', {
      body: { token, resource_id: feedbackResource.id, author_name: authorName, body, parent_id: parentId },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setResourceComments(prev => [...prev, (data as any).comment as ResourceComment]);
    setPublicName(authorName);
  };
  const resourceCommentCount = (rid: string) => resourceComments.filter(c => c.resource_id === rid).length;

  // Approval prompt — reused across the landing list and the report detail views
  // so it can pop over an opened report (a report-open triggers an early return
  // that would otherwise skip the landing-page modal).
  const approvalsModalEl = (
    <ApprovalsModal
      show={showApprovals}
      pending={modalPending}
      defaultName={publicName}
      existingDecisions={existingDecisionsMap}
      onClose={() => {
        setShowApprovals(false);
        setSingleApprovalId(null);
        if (pickerAfterApprovals) {
          setPickerAfterApprovals(false);
          setShowLatestReports(true);
        }
      }}
      onSubmit={submitApprovals}
    />
  );

  // Report detail view
  if (openReport && activeBrand) {
    // Reports for this brand are sorted desc by week_start (newest first).
    const sameBrand = reports.filter(r => r.brand_id === activeBrand.id);
    const idx = sameBrand.findIndex(r => r.id === openReport.id);
    const newer = idx > 0 ? sameBrand[idx - 1] : null;          // index-1 is more recent
    const older = idx >= 0 && idx < sameBrand.length - 1 ? sameBrand[idx + 1] : null;
    // v3 (12-section) and v2 (14-section) reports render on their premium client
    // dashboards; older reports stay on the classic layout.
    const openFmt = (openReport.content as any)?.format_version;
    const isOpenV3 = openFmt === 'v3';
    const isOpenV2 = openFmt === 'v2';
    const isClientDash = isOpenV3 || isOpenV2;   // both use the sidebar client view
    const WeeklyDash: any = isOpenV3 ? ReportDashboardV3 : isOpenV2 ? ReportDashboardV2 : ReportDashboard;
    const normWeekly = isOpenV3 ? normalizeContentV3 : isOpenV2 ? normalizeContentV2 : normalizeContent;
    return (
      <PublicShell clientName={clientName}>
        <div className="d-flex align-items-start gap-3 mb-4 flex-wrap">
          <button type="button" className="ac-back-btn" onClick={() => setOpenId(null)}>
            <i className="bi bi-arrow-left" /> Back
          </button>
          {!isClientDash && (
            <div className="flex-grow-1 min-w-0">
              <div className="text-muted small">{activeBrand.name}</div>
              <h4 className="mb-0">Week #{openReport.week_number} — {formatRange(openReport.week_start, openReport.week_end)}</h4>
            </div>
          )}
        </div>
        <WeeklyDash
          c={normWeekly(openReport.content)}
          p={prevReport ? normWeekly(prevReport.content) : null}
          currency={activeBrand.currency ?? undefined}
          trendData={trendData}
          wow={wowData}
          sampleSeries={sampleSeries}
          mtd={mtd}
          productSamples={productSamples}
          offsiteSeries={offsiteSeries}
          affiliateSeries={affiliateSeries}
          gmvMaxSeries={gmvMaxSeries}
          hasPrev={!!prevReport}
          audience={isClientDash ? 'client' : undefined}
          reportMeta={isClientDash ? {
            title: `${activeBrand.name} — Weekly Performance`,
            period: formatRange(openReport.week_start, openReport.week_end),
            compare: prevReport ? `Week #${openReport.week_number} vs #${prevReport.week_number}` : `Week #${openReport.week_number}`,
          } : undefined}
          prevTopVideos={prevReport ? (normWeekly(prevReport.content) as any).top_videos : undefined}
          approvalAction={openReport.content?.approval?.enabled ? {
            myDecision: (() => {
              const d = latestDecisions.get(`weekly:${openReport.id}`);
              return d ? {
                id: d.id, decision: d.decision, comment: d.comment,
                decided_by_name: d.decided_by_name, decided_at: d.decided_at,
              } : null;
            })(),
            defaultName: publicName,
            onSubmit: async (choice: 'approved' | 'changes_requested', comment: string, name: string) => {
              await submitApprovals([{
                report_id: openReport.id,
                report_type: 'weekly',
                decision: choice,
                comment,
                decided_by_name: name,
              }]);
            },
          } : undefined}
          commentsConfig={{
            mode: 'public',
            comments: reportComments,
            defaultPublicName: publicName,
            onAdd: addComment,
          }}
        />
        <div className="ac-report-nav">
          <button
            type="button"
            className="ac-nav-arrow-btn"
            onClick={() => older && setOpenId(older.id)}
            disabled={!older}
          >
            <i className="bi bi-arrow-left" />
            <span className="ac-nav-arrow-label">
              <span className="ac-nav-arrow-hint">Previous</span>
              <span>{older ? `Week #${older.week_number}` : 'No earlier report'}</span>
            </span>
          </button>
          <button
            type="button"
            className="ac-nav-arrow-btn"
            onClick={() => newer && setOpenId(newer.id)}
            disabled={!newer}
          >
            <span className="ac-nav-arrow-label" style={{ alignItems: 'flex-end' }}>
              <span className="ac-nav-arrow-hint">Next</span>
              <span>{newer ? `Week #${newer.week_number}` : 'No later report'}</span>
            </span>
            <i className="bi bi-arrow-right" />
          </button>
        </div>
        {approvalsModalEl}
      </PublicShell>
    );
  }

  // Monthly report detail view
  if (openMonthly && activeBrand) {
    const sameBrandM = monthlyReports.filter(r => r.brand_id === activeBrand.id)
      .sort((a, b) => b.month.localeCompare(a.month));    // newest first
    const idxM = sameBrandM.findIndex(r => r.id === openMonthly.id);
    const newerM = idxM > 0 ? sameBrandM[idxM - 1] : null;
    const olderM = idxM >= 0 && idxM < sameBrandM.length - 1 ? sameBrandM[idxM + 1] : null;
    const fmtMonthLabel = (yyyymm: string) => {
      const [y, m] = yyyymm.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    };
    return (
      <PublicShell clientName={clientName}>
        <div className="d-flex align-items-start gap-3 mb-4 flex-wrap">
          <button type="button" className="ac-back-btn" onClick={() => setOpenMonthlyId(null)}>
            <i className="bi bi-arrow-left" /> Back
          </button>
          <div className="flex-grow-1 min-w-0">
            <div className="text-muted small">{activeBrand.name}</div>
            <h4 className="mb-0">{fmtMonthLabel(openMonthly.month)} <Badge bg="info" className="ms-2">Monthly</Badge></h4>
          </div>
        </div>
        <MonthlyReportDashboard
          c={normalizeMonthlyContent(openMonthly.content)}
          p={(() => {
            const [y, mm] = openMonthly.month.split('-').map(Number);
            const prevYM = `${new Date(y, mm - 2, 1).getFullYear()}-${String(new Date(y, mm - 2, 1).getMonth() + 1).padStart(2, '0')}`;
            const pr = monthlyReports.find(r => r.brand_id === openMonthly.brand_id && r.month === prevYM);
            return pr ? normalizeMonthlyContent(pr.content) : null;
          })()}
          hasPrev={(() => {
            const [y, mm] = openMonthly.month.split('-').map(Number);
            const prevYM = `${new Date(y, mm - 2, 1).getFullYear()}-${String(new Date(y, mm - 2, 1).getMonth() + 1).padStart(2, '0')}`;
            return monthlyReports.some(r => r.brand_id === openMonthly.brand_id && r.month === prevYM);
          })()}
          trendData={(() => {
            const sameBrand = monthlyReports
              .filter(r => r.brand_id === openMonthly.brand_id && r.month <= openMonthly.month)
              .sort((a, b) => a.month.localeCompare(b.month))
              .slice(-8);
            return sameBrand.map(t => {
              const n = normalizeMonthlyContent(t.content);
              const [y, mm] = t.month.split('-').map(Number);
              return {
                label: new Date(y, mm - 1, 1).toLocaleString(undefined, { month: 'short' }),
                'Total Sales':   n.total_sales.month,
                'Affiliate GMV': n.gmv_breakdown.affiliate_gmv.this,
              };
            });
          })()}
          monthLabel={fmtMonthLabel(openMonthly.month)}
          brandName={activeBrand.name}
          clientName={activeBrand.client}
          currency={activeBrand.currency ?? undefined}
          approvalDecisions={allDecisions
            .filter(d => d.report_id === openMonthly.id && d.report_type === 'monthly')
            .map(d => ({
              id: d.id, decision: d.decision, comment: d.comment,
              decided_by_name: d.decided_by_name, decided_at: d.decided_at,
            }))}
          approvalAction={openMonthly.content?.approval?.enabled ? {
            myDecision: (() => {
              const d = latestDecisions.get(`monthly:${openMonthly.id}`);
              return d ? {
                id: d.id, decision: d.decision, comment: d.comment,
                decided_by_name: d.decided_by_name, decided_at: d.decided_at,
              } : null;
            })(),
            defaultName: publicName,
            onSubmit: async (choice, comment, name) => {
              await submitApprovals([{
                report_id: openMonthly.id,
                report_type: 'monthly',
                decision: choice,
                comment,
                decided_by_name: name,
              }]);
            },
          } : undefined}
          commentsConfig={{
            mode: 'public',
            comments: monthlyReportComments,
            defaultPublicName: publicName,
            onAdd: (section, body, name, parentId) => addComment(section, body, name, parentId, 'monthly'),
          }}
        />
        <div className="ac-report-nav">
          <button
            type="button"
            className="ac-nav-arrow-btn"
            onClick={() => olderM && setOpenMonthlyId(olderM.id)}
            disabled={!olderM}
          >
            <i className="bi bi-arrow-left" />
            <span className="ac-nav-arrow-label">
              <span className="ac-nav-arrow-hint">Previous</span>
              <span>{olderM ? fmtMonthLabel(olderM.month) : 'No earlier month'}</span>
            </span>
          </button>
          <button
            type="button"
            className="ac-nav-arrow-btn"
            onClick={() => newerM && setOpenMonthlyId(newerM.id)}
            disabled={!newerM}
          >
            <span className="ac-nav-arrow-label" style={{ alignItems: 'flex-end' }}>
              <span className="ac-nav-arrow-hint">Next</span>
              <span>{newerM ? fmtMonthLabel(newerM.month) : 'No later month'}</span>
            </span>
            <i className="bi bi-arrow-right" />
          </button>
        </div>
        {approvalsModalEl}
      </PublicShell>
    );
  }

  const brandReportCount = (brandId: string) => reports.filter(r => r.brand_id === brandId).length;
  const brandMonthlyCount = (brandId: string) => monthlyReports.filter(r => r.brand_id === brandId).length;
  const brandResourceCount = (brandId: string) =>
    resources.filter(r => (r.scope === 'brand' && r.brand_id === brandId) || r.scope === 'general').length;


  // General-mode: a flat shared-files page (no brand tiles, no tabs).
  if (linkMode === 'general') {
    return (
      <PublicShell clientName={clientName}>
        {label && <div className="text-muted small mb-3">{label}</div>}
        <Card className="shadow-sm border-0">
          <Card.Header className="bg-white border-0 pt-3 pb-2">
            <h5 className="mb-0">
              <i className="bi bi-folder2-open me-2" /> Shared files
              <Badge bg="secondary" className="ms-2">{resources.length}</Badge>
            </h5>
            <small className="text-muted">Click a file to open it. Use Comment to leave feedback.</small>
          </Card.Header>
          <Card.Body>
            {resources.length === 0 ? (
              <div className="text-center py-5 text-muted">
                <i className="bi bi-folder-x" style={{ fontSize: '2rem' }} /><br />
                Nothing shared on this link yet.
              </div>
            ) : (
              <Row className="g-3">
                {resources.map(r => {
                  const ic = resourceIcon(r.url);
                  const cmtCount = resourceCommentCount(r.id);
                  return (
                    <Col md={6} lg={4} key={r.id}>
                      <div
                        className="d-flex flex-column gap-2 p-3 rounded h-100"
                        style={{ background: 'white', border: '1px solid #e5e7eb' }}
                      >
                        <div className="d-flex align-items-center gap-3">
                          <div style={{
                            width: 44, height: 44, borderRadius: 10,
                            background: `${ic.color}15`,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <i className={`bi ${ic.icon}`} style={{ color: ic.color, fontSize: '1.3rem' }} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="fw-semibold text-truncate">{r.name}</div>
                            <small className="text-muted">{ic.label}</small>
                            {r.description && (
                              <small className="text-muted d-block mt-1 text-truncate">{r.description}</small>
                            )}
                          </div>
                        </div>
                        <div className="d-flex justify-content-between align-items-center mt-1">
                          <a href={r.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary">
                            Open <i className="bi bi-box-arrow-up-right ms-1" />
                          </a>
                          <Button size="sm" variant="outline-info" onClick={() => setFeedbackResource(r)}>
                            <i className="bi bi-chat-left-text me-1" />
                            {cmtCount > 0 ? `${cmtCount} comment${cmtCount === 1 ? '' : 's'}` : 'Comment'}
                          </Button>
                        </div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            )}
          </Card.Body>
        </Card>

        <Offcanvas show={!!feedbackResource} onHide={() => setFeedbackResource(null)} placement="end" style={{ width: 480 }}>
          <Offcanvas.Header closeButton>
            <Offcanvas.Title>
              <i className="bi bi-chat-left-text me-2" />
              Comments
              {feedbackResource && <small className="text-muted ms-2 fw-normal">— {feedbackResource.name}</small>}
            </Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            {feedbackResource && (
              <ResourceComments
                resourceId={feedbackResource.id}
                resourceName={feedbackResource.name}
                comments={resourceComments}
                mode="public"
                defaultPublicName={publicName}
                onAdd={addResourceComment}
              />
            )}
          </Offcanvas.Body>
        </Offcanvas>
      </PublicShell>
    );
  }

  return (
    <PublicShell clientName={clientName}>
      {label && <div className="text-muted small mb-3">{label}</div>}

      {/* Brand tiles */}
      <div className="mb-4">
        <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
          {brands.map(b => {
            const active = b.id === activeBrandId;
            return (
              <button
                key={b.id}
                onClick={() => { setActiveBrandId(b.id); setOpenId(null); }}
                className="border-0"
                style={{
                  position: 'relative',
                  background: active ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : 'white',
                  color: active ? 'white' : '#111827',
                  border: active ? 'none' : '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: '12px 18px',
                  width: 248,
                  height: 104,
                  overflow: 'visible',
                  textAlign: 'left',
                  cursor: 'pointer',
                  boxShadow: active ? '0 8px 20px rgba(37,99,235,.25)' : 'none',
                  transition: 'all .15s',
                }}
              >
                <div className="small" style={{ opacity: active ? .8 : .55, fontSize: '.7rem', letterSpacing: '.5px' }}>BRAND</div>
                <div className="fw-semibold text-truncate" style={{ fontSize: '1.05rem', maxWidth: '100%' }}>{b.name}</div>
                <div className="small mt-1" style={{ opacity: active ? .85 : .6, fontSize: '.78rem', lineHeight: 1.3 }}>
                  {includeReports && <>{brandReportCount(b.id)} weekly · </>}
                  {includeMonthlyReports && <>{brandMonthlyCount(b.id)} monthly · </>}
                  {brandResourceCount(b.id)} resource{brandResourceCount(b.id) !== 1 ? 's' : ''}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activeBrand && (
        <Tab.Container activeKey={activeTab} onSelect={k => setActiveTab((k as any) ?? 'reporting')}>
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-white border-0 pt-3 pb-0">
              <Nav variant="tabs" className="border-0">
                {includeReports && (
                  <Nav.Item>
                    <Nav.Link eventKey="reporting" className="d-flex align-items-center gap-2 px-3">
                      <i className="bi bi-bar-chart-line" /> Weekly
                      <Badge bg="secondary">{brandReports.length}</Badge>
                    </Nav.Link>
                  </Nav.Item>
                )}
                {includeMonthlyReports && (
                  <Nav.Item>
                    <Nav.Link eventKey="monthly" className="d-flex align-items-center gap-2 px-3">
                      <i className="bi bi-calendar-month" /> Monthly
                      <Badge bg="secondary">{monthlyReports.filter(r => r.brand_id === activeBrandId).length}</Badge>
                    </Nav.Link>
                  </Nav.Item>
                )}
                {(includeReports || includeMonthlyReports) && (
                  <Nav.Item>
                    <Nav.Link eventKey="approved" className="d-flex align-items-center gap-2 px-3">
                      <i className="bi bi-check2-circle" /> Approvals
                      <Badge bg="secondary">{approvalsForBrand.length}</Badge>
                      {pendingApprovalRows > 0 && (
                        <Badge bg="danger" pill title={`${pendingApprovalRows} report${pendingApprovalRows === 1 ? '' : 's'} awaiting your decision`}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
                          {pendingApprovalRows}
                        </Badge>
                      )}
                    </Nav.Link>
                  </Nav.Item>
                )}
                {includeResources && (
                  <Nav.Item>
                    <Nav.Link eventKey="resources" className="d-flex align-items-center gap-2 px-3">
                      <i className="bi bi-folder2" /> Resources
                      <Badge bg="secondary">{brandResources.length}</Badge>
                    </Nav.Link>
                  </Nav.Item>
                )}
              </Nav>
            </Card.Header>
            <Card.Body>
              <Tab.Content>
                <Tab.Pane eventKey="reporting">
                  <div className="d-flex justify-content-between align-items-end mb-3 flex-wrap gap-2">
                    <div>
                      <h5 className="mb-0">{activeBrand.name} — Reports</h5>
                      <small className="text-muted">{monthFiltered.length} report{monthFiltered.length !== 1 ? 's' : ''} {month === 'all' ? '— all months' : `in ${fmtMonthLabel(month)}`}</small>
                    </div>
                    <MonthQuickPicks month={month} setMonth={setMonth} monthsWithData={monthsWithData} />
                  </div>

                  {brandReports.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-inbox" style={{ fontSize: '2rem' }} /><br />
                      No reports shared for this brand yet.
                    </div>
                  ) : monthFiltered.length === 0 ? (
                    <div className="text-center py-4 text-muted">No reports in this month. Try a different month.</div>
                  ) : (
                    <Row className="g-3">
                      {monthFiltered.map(r => {
                        const dec = latestDecisions.get(`weekly:${r.id}`);
                        const approvalEnabled = !!r.content?.approval?.enabled;
                        return (
                          <Col md={6} lg={4} key={r.id}>
                            <Card
                              className="h-100 shadow-sm report-card"
                              style={{ cursor: 'pointer', borderLeft: '4px solid #2563eb', transition: 'transform .15s, box-shadow .15s' }}
                              onClick={() => setOpenId(r.id)}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                            >
                              <Card.Body>
                                <div className="d-flex justify-content-between align-items-start">
                                  <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>Week</div>
                                  <Badge bg="primary" pill>#{r.week_number}</Badge>
                                </div>
                                <div className="fs-5 fw-semibold mt-1">{formatRange(r.week_start, r.week_end)}</div>
                                <div className="text-muted small mt-2">
                                  <i className="bi bi-calendar3 me-1" /> Click to view dashboard
                                </div>
                                {approvalEnabled && (() => {
                                  const tn = approvalThreadCount(r.id, 'weekly');
                                  return (
                                    <div className="mt-2 d-flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                                      {dec ? (
                                        <Button size="sm" variant={dec.decision === 'approved' ? 'success' : 'warning'}
                                                onClick={() => { setSingleApprovalId(r.id); setSingleApprovalType('weekly'); setShowApprovals(true); }}
                                                title="View your decision">
                                          <i className={`bi ${dec.decision === 'approved' ? 'bi-check-circle' : 'bi-arrow-repeat'} me-1`} />
                                          {dec.decision === 'approved' ? 'Approved' : 'Changes requested'}
                                        </Button>
                                      ) : (
                                        <Button size="sm" variant="warning"
                                                onClick={() => { setSingleApprovalId(r.id); setSingleApprovalType('weekly'); setShowApprovals(true); }}
                                                title="Open the approval request">
                                          <i className="bi bi-shield-exclamation me-1" /> Approval requested
                                        </Button>
                                      )}
                                      <Button size="sm" variant="outline-primary"
                                              onClick={() => setThreadFor({
                                                reportId: r.id, reportType: 'weekly',
                                                brandName: activeBrand.name,
                                                periodLabel: `Week #${r.week_number} — ${formatRange(r.week_start, r.week_end)}`,
                                              })}
                                              title="Open the conversation thread for this approval">
                                        <i className="bi bi-chat-left-text me-1" />
                                        Thread{tn > 0 ? ` (${tn})` : ''}
                                      </Button>
                                    </div>
                                  );
                                })()}
                              </Card.Body>
                            </Card>
                          </Col>
                        );
                      })}
                    </Row>
                  )}
                </Tab.Pane>

                <Tab.Pane eventKey="monthly">
                  {(() => {
                    const brandMonthly = monthlyReports
                      .filter(r => r.brand_id === activeBrandId)
                      .sort((a, b) => b.month.localeCompare(a.month));
                    const monthFilteredMonthly = month === 'all' ? brandMonthly : brandMonthly.filter(r => r.month === month);
                    const fmtMonthLabel = (yyyymm: string) => {
                      const [y, m] = yyyymm.split('-').map(Number);
                      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
                    };
                    return (
                      <>
                        <div className="d-flex justify-content-between align-items-end mb-3 flex-wrap gap-2">
                          <div>
                            <h5 className="mb-0">{activeBrand.name} — Monthly Reports</h5>
                            <small className="text-muted">{monthFilteredMonthly.length} report{monthFilteredMonthly.length !== 1 ? 's' : ''} {month === 'all' ? '— all months' : `in ${fmtMonthLabel(month)}`}</small>
                          </div>
                          <MonthQuickPicks month={month} setMonth={setMonth} monthsWithData={monthsWithData} />
                        </div>
                        {brandMonthly.length === 0 ? (
                          <div className="text-center py-5 text-muted">
                            <i className="bi bi-inbox" style={{ fontSize: '2rem' }} /><br />
                            No monthly reports shared for this brand yet.
                          </div>
                        ) : monthFilteredMonthly.length === 0 ? (
                          <div className="text-center py-4 text-muted">
                            {month === 'all' ? 'No monthly reports shared yet.' : `No monthly report for ${fmtMonthLabel(month)}. Try a different month.`}
                          </div>
                        ) : (
                          <Row className="g-3">
                            {monthFilteredMonthly.map(r => {
                              const dec = latestDecisions.get(`monthly:${r.id}`);
                              const approvalEnabled = !!r.content?.approval?.enabled;
                              return (
                                <Col md={6} lg={4} key={r.id}>
                                  <Card
                                    className="h-100 shadow-sm report-card"
                                    style={{ cursor: 'pointer', borderLeft: '4px solid #14b8a6', transition: 'transform .15s, box-shadow .15s' }}
                                    onClick={() => setOpenMonthlyId(r.id)}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                                  >
                                    <Card.Body>
                                      <div className="d-flex justify-content-between align-items-start">
                                        <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>Month</div>
                                        <Badge bg="info" pill>Monthly</Badge>
                                      </div>
                                      <div className="fs-5 fw-semibold mt-1">{fmtMonthLabel(r.month)}</div>
                                      <div className="text-muted small mt-2">
                                        <i className="bi bi-calendar3 me-1" /> Click to view dashboard
                                      </div>
                                      {approvalEnabled && (() => {
                                        const tn = approvalThreadCount(r.id, 'monthly');
                                        return (
                                          <div className="mt-2 d-flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                                            {dec ? (
                                              <Button size="sm" variant={dec.decision === 'approved' ? 'success' : 'warning'}
                                                      onClick={() => { setSingleApprovalId(r.id); setSingleApprovalType('monthly'); setShowApprovals(true); }}
                                                      title="View your decision">
                                                <i className={`bi ${dec.decision === 'approved' ? 'bi-check-circle' : 'bi-arrow-repeat'} me-1`} />
                                                {dec.decision === 'approved' ? 'Approved' : 'Changes requested'}
                                              </Button>
                                            ) : (
                                              <Button size="sm" variant="warning"
                                                      onClick={() => { setSingleApprovalId(r.id); setSingleApprovalType('monthly'); setShowApprovals(true); }}
                                                      title="Open the approval request">
                                                <i className="bi bi-shield-exclamation me-1" /> Approval requested
                                              </Button>
                                            )}
                                            <Button size="sm" variant="outline-primary"
                                                    onClick={() => setThreadFor({
                                                      reportId: r.id, reportType: 'monthly',
                                                      brandName: activeBrand.name,
                                                      periodLabel: fmtMonthLabel(r.month),
                                                    })}
                                                    title="Open the conversation thread for this approval">
                                              <i className="bi bi-chat-left-text me-1" />
                                              Thread{tn > 0 ? ` (${tn})` : ''}
                                            </Button>
                                          </div>
                                        );
                                      })()}
                                    </Card.Body>
                                  </Card>
                                </Col>
                              );
                            })}
                          </Row>
                        )}
                      </>
                    );
                  })()}
                </Tab.Pane>

                <Tab.Pane eventKey="approved">
                  <div className="mb-3">
                    <h5 className="mb-0">{activeBrand.name} — Report Approvals</h5>
                    <small className="text-muted">
                      {approvalsForBrand.length} approval request{approvalsForBrand.length !== 1 ? 's' : ''}
                      {pendingApprovalRows > 0 && (
                        <> · <span className="text-danger fw-semibold">{pendingApprovalRows} awaiting your decision</span></>
                      )} — click a row to open the report
                    </small>
                  </div>
                  {approvalsForBrand.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-clipboard-check" style={{ fontSize: '2rem' }} /><br />
                      No approval requests yet. Reports that need your approval will show up here.
                    </div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {approvalsForBrand.map(({ decision: d, reportType, reportId, periodLabel, monthKey, approvalHtml }) => {
                        const state: 'pending' | 'approved' | 'changes' =
                          !d ? 'pending' : d.decision === 'approved' ? 'approved' : 'changes';
                        const color = state === 'approved' ? '#198754' : state === 'changes' ? '#d97706' : '#dc3545';
                        const icon = state === 'approved' ? 'bi-check-circle-fill'
                          : state === 'changes' ? 'bi-arrow-repeat' : 'bi-shield-exclamation';
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
                          onClick={() => {
                            setMonth(monthKey);
                            if (reportType === 'monthly') { setOpenMonthlyId(reportId); setOpenId(null); }
                            else { setOpenId(reportId); setOpenMonthlyId(null); }
                            window.scrollTo({ top: 0 });
                          }}
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
                                  Action required
                                </Badge>
                              )}
                              {state === 'changes' && (
                                <Badge bg="warning" text="dark" pill>Changes requested</Badge>
                              )}
                            </div>
                            <small className="text-muted d-block mt-1">
                              {state === 'pending' ? (
                                <><i className="bi bi-hourglass-split me-1" />Awaiting your approval — no decision yet</>
                              ) : state === 'approved' ? (
                                <><i className="bi bi-person-check me-1" />Approved by {d!.decided_by_name} · {fmtDecidedAt(d!.decided_at)}</>
                              ) : (
                                <><i className="bi bi-person-exclamation me-1" />Changes requested by {d!.decided_by_name} · {fmtDecidedAt(d!.decided_at)}</>
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
                          {state === 'pending' && (
                            <Button
                              size="sm"
                              variant="danger"
                              title="Review this report and give your decision"
                              onClick={e => {
                                e.stopPropagation();
                                setSingleApprovalId(reportId);
                                setSingleApprovalType(reportType);
                                setShowApprovals(true);
                              }}
                            >
                              <i className="bi bi-shield-check me-1" /> Review &amp; decide
                            </Button>
                          )}
                          {(() => {
                            const threadCount = approvalThreadCount(reportId, reportType);
                            return (
                              <Button
                                size="sm"
                                variant={state === 'approved' ? 'outline-success' : 'outline-secondary'}
                                title="View the conversation for this report"
                                onClick={e => {
                                  e.stopPropagation();
                                  setThreadFor({
                                    reportId, reportType,
                                    brandName: activeBrand.name, periodLabel,
                                  });
                                }}
                              >
                                <i className="bi bi-chat-left-text me-1" /> Conversation
                                {threadCount > 0 && <Badge bg={state === 'approved' ? 'success' : 'secondary'} pill className="ms-1">{threadCount}</Badge>}
                              </Button>
                            );
                          })()}
                          <i className="bi bi-chevron-right text-muted" />
                        </div>
                        );
                      })}
                    </div>
                  )}
                </Tab.Pane>

                <Tab.Pane eventKey="resources">
                  <div className="d-flex justify-content-between align-items-end mb-3">
                    <div>
                      <h5 className="mb-0">{activeBrand.name} — Resources</h5>
                      <small className="text-muted">Includes shared general resources</small>
                    </div>
                  </div>
                  {brandResources.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-folder-x" style={{ fontSize: '2rem' }} /><br />
                      No resources shared for this brand.
                    </div>
                  ) : (
                    <Row className="g-3">
                      {brandResources.map(r => {
                        const ic = resourceIcon(r.url);
                        const cmtCount = resourceCommentCount(r.id);
                        return (
                          <Col md={6} lg={4} key={r.id}>
                            <div
                              className="d-flex flex-column gap-2 p-3 rounded h-100"
                              style={{
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                transition: 'transform .15s, box-shadow .15s, border-color .15s',
                              }}
                              onMouseEnter={e => {
                                const el = e.currentTarget as HTMLElement;
                                el.style.transform = 'translateY(-2px)';
                                el.style.boxShadow = '0 10px 25px rgba(0,0,0,.08)';
                                el.style.borderColor = ic.color;
                              }}
                              onMouseLeave={e => {
                                const el = e.currentTarget as HTMLElement;
                                el.style.transform = '';
                                el.style.boxShadow = '';
                                el.style.borderColor = '#e5e7eb';
                              }}
                            >
                              <div className="d-flex align-items-center gap-3">
                                <div style={{
                                  width: 44, height: 44, borderRadius: 10,
                                  background: `${ic.color}15`,
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  flexShrink: 0,
                                }}>
                                  <i className={`bi ${ic.icon}`} style={{ color: ic.color, fontSize: '1.3rem' }} />
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div className="fw-semibold text-truncate">{r.name}</div>
                                  <div className="d-flex align-items-center gap-2 mt-1">
                                    <small className="text-muted">{ic.label}</small>
                                    {r.scope === 'general' && <><span className="text-muted">·</span><small className="text-muted">General</small></>}
                                  </div>
                                  {r.description && (
                                    <small className="text-muted d-block mt-1 text-truncate">{r.description}</small>
                                  )}
                                </div>
                              </div>
                              <div className="d-flex justify-content-between align-items-center mt-1">
                                <a href={r.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary">
                                  Open <i className="bi bi-box-arrow-up-right ms-1" />
                                </a>
                                <Button size="sm" variant="outline-info" onClick={() => setFeedbackResource(r)}
                                  title={cmtCount > 0 ? `${cmtCount} comment${cmtCount === 1 ? '' : 's'}` : 'Add a comment'}>
                                  <i className="bi bi-chat-left-text me-1" />
                                  {cmtCount > 0 ? `${cmtCount} comment${cmtCount === 1 ? '' : 's'}` : 'Comment'}
                                </Button>
                              </div>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  )}
                </Tab.Pane>
              </Tab.Content>
            </Card.Body>
          </Card>
        </Tab.Container>
      )}

      <Offcanvas show={!!feedbackResource} onHide={() => setFeedbackResource(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            Comments
            {feedbackResource && <small className="text-muted ms-2 fw-normal">— {feedbackResource.name}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackResource && (
            <ResourceComments
              resourceId={feedbackResource.id}
              resourceName={feedbackResource.name}
              comments={resourceComments}
              mode="public"
              defaultPublicName={publicName}
              onAdd={addResourceComment}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      {approvalsModalEl}
      {/* Month picker popup disabled — replaced by inline MonthQuickPicks
          (latest 2 months + All). Kept here for later re-use.
      <MonthPickerModal
        show={showMonthPicker}
        monthsWithData={monthsWithData}
        selectedMonth={month}
        onPick={(m) => { setMonth(m); setShowMonthPicker(false); }}
        onClose={() => setShowMonthPicker(false)}
      />
      */}
      <LatestReportsModal
        show={showLatestReports}
        brands={brands}
        weeklyReports={reports}
        monthlyReports={monthlyReports}
        onPickWeekly={(r) => {
          // Sync filter month to the report's month so its card is visible
          // when the dashboard renders behind it.
          const ym = (r.week_start || '').slice(0, 7);
          if (ym) setMonth(ym);
          setActiveBrandId(r.brand_id);
          setActiveTab('reporting');
          setOpenId(r.id);
          setOpenMonthlyId(null);
          setShowLatestReports(false);
        }}
        onPickMonthly={(r) => {
          if (r.month) setMonth(r.month);
          setActiveBrandId(r.brand_id);
          setActiveTab('monthly');
          setOpenMonthlyId(r.id);
          setOpenId(null);
          setShowLatestReports(false);
        }}
        onClose={() => setShowLatestReports(false)}
      />

      {/* Standalone approval-thread offcanvas — opened from the report cards
          (and equivalent to the "Open thread" button inside the dashboard). */}
      <Offcanvas show={!!threadFor} onHide={() => setThreadFor(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            Approval thread
            {threadFor && (
              <div className="small text-muted fw-normal mt-1">
                {threadFor.brandName} — {threadFor.periodLabel}
              </div>
            )}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {threadFor && (
            <SectionComments
              section="approval"
              sectionLabel="Approval Needed / Action Items"
              comments={threadComments}
              mode="public"
              defaultPublicName={publicName}
              onAdd={onThreadAdd}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </PublicShell>
  );
}

function fmtMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Approval timestamps carry a time-of-day, so show date + time.
function fmtDecidedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Inline quick-pick for the 3 most-recent months — replaces the "Change month"
// button so clients can jump straight to a month's reports without the popup.
// (The MonthPickerModal is still mounted for later re-use.)
function MonthQuickPicks({ month, setMonth, monthsWithData }: {
  month: string;
  setMonth: (m: string) => void;
  monthsWithData: Set<string>;
}) {
  const shift = (yyyymm: string, delta: number): string => {
    const [y, m] = yyyymm.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const fmtShort = (yyyymm: string): string => {
    const [y, m] = yyyymm.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  };
  const cur = currentMonth();
  const picks = [shift(cur, 0), shift(cur, -1)];
  return (
    <div className="d-flex gap-2 align-items-center flex-wrap">
      {picks.map(ym => {
        const active = ym === month;
        const has = monthsWithData.has(ym);
        return (
          <Button
            key={ym}
            size="sm"
            variant={active ? 'primary' : 'outline-primary'}
            onClick={() => setMonth(ym)}
            title={has ? `${fmtShort(ym)} — reports available` : `${fmtShort(ym)} — no reports`}
          >
            <i className="bi bi-calendar3 me-1" />
            {fmtShort(ym)}
            {has && <span className="ms-1" style={{ color: active ? '#fff' : '#198754' }}>●</span>}
          </Button>
        );
      })}
      <Button
        size="sm"
        variant={month === 'all' ? 'primary' : 'outline-primary'}
        onClick={() => setMonth('all')}
        title="Show all reports across every month"
      >
        <i className="bi bi-collection me-1" /> All
      </Button>
    </div>
  );
}
function PublicShell({ children, clientName }: { children: React.ReactNode; clientName: string }) {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #fff8f5 0%, #fdeee2 100%)', backgroundAttachment: 'fixed' }}>
      <div style={{ background: '#111827', color: 'white', padding: '14px 24px' }}>
        <strong>ApexGMVOS</strong>
        <span className="opacity-75 mx-2">— Reporting</span>
        <span className="opacity-75">|</span>
        <span className="ms-2 fw-semibold">{clientName}</span>
      </div>
      <div className="container-fluid py-4" style={{ maxWidth: 1400 }}>{children}</div>
    </div>
  );
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

