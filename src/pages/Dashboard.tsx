import { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Spinner, Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type ClientStatus = 'onboarding' | 'in_progress' | 'paused' | 'closed';

interface BrandRow {
  id: string;
  name: string;
  client_status: ClientStatus | null;
}

interface ClientRow {
  id: string;
  name: string;
}

interface WeeklyReportRow {
  id: string;
  brand_id: string;
  week_end: string;
  content: any;
}

const STATUS_META: Record<ClientStatus, { label: string; color: string; icon: string }> = {
  onboarding:  { label: 'Onboarding',  color: '#0ea5e9', icon: 'bi-rocket-takeoff-fill' },
  in_progress: { label: 'In Progress', color: '#198754', icon: 'bi-check-circle-fill' },
  paused:      { label: 'Paused',      color: '#f59e0b', icon: 'bi-pause-circle-fill' },
  closed:      { label: 'Closed',      color: '#6b7280', icon: 'bi-archive-fill' },
};

function isoNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(n);
}

export default function Dashboard() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [reports, setReports] = useState<WeeklyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      try {
        const since = isoNDaysAgo(30);
        const [bRes, cRes, rRes] = await Promise.all([
          // RLS already scopes brands to whatever the role can see (Bob sees
          // every brand; APC sees their assigned brands).
          supabase.from('brands').select('id,name,client_status'),
          supabase.from('clients').select('id,name'),
          supabase.from('weekly_reports')
            .select('id,brand_id,week_end,content')
            .gte('week_end', since),
        ]);
        if (bRes.error) throw bRes.error;
        if (cRes.error) throw cRes.error;
        if (rRes.error) throw rRes.error;
        setBrands((bRes.data ?? []) as BrandRow[]);
        setClients((cRes.data ?? []) as ClientRow[]);
        setReports((rRes.data ?? []) as WeeklyReportRow[]);
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Counts by status.
  const counts = useMemo(() => {
    const c: Record<ClientStatus | 'total' | 'active' | 'inactive', number> = {
      total: brands.length,
      onboarding: 0, in_progress: 0, paused: 0, closed: 0,
      active: 0, inactive: 0,
    };
    for (const b of brands) {
      const s = (b.client_status ?? 'in_progress') as ClientStatus;
      c[s] += 1;
      if (s === 'closed') c.inactive += 1; else c.active += 1;
    }
    return c;
  }, [brands]);

  // Each report's Total GMV — reads the v2 (14-section) path first, falling back
  // to the legacy `overall` shape so historical reports still count.
  const reportGmv = (content: any): number => {
    const v = content?.snapshot?.total_gmv
      ?? content?.gmv_performance?.total_gmv
      ?? content?.overall?.total_gmv;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // Sum Total GMV across every weekly report whose week_end fell in the last
  // 30 days for the workspace-wide total.
  const gmv30d = useMemo(() => {
    let total = 0;
    for (const r of reports) total += reportGmv(r?.content);
    return total;
  }, [reports]);

  // How many distinct brands contributed to the last-30-days GMV — a useful
  // sub-stat that explains the headline number.
  const brandsContributingToGmv = useMemo(() => {
    const set = new Set<string>();
    for (const r of reports) {
      if (reportGmv(r?.content) > 0) set.add(r.brand_id);
    }
    return set.size;
  }, [reports]);

  return (
    <>
      <h2 className="mb-1">Dashboard</h2>
      <p className="text-muted small mb-4">Workspace-wide overview — counts respect your role's brand access.</p>

      {err && (
        <Card body className="border-danger mb-3">
          <span className="text-danger">{err}</span>
        </Card>
      )}

      <Row className="g-3">
        {/* Total Brands + status breakdown */}
        <Col md={4}>
          <Card body className="h-100 shadow-sm">
            <div className="d-flex align-items-center justify-content-between">
              <div className="text-muted small text-uppercase fw-semibold" style={{ letterSpacing: '.5px' }}>
                <i className="bi bi-shop me-1 text-primary" />Total Brands
              </div>
              {!loading && (
                <Link to="/brands" className="small text-decoration-none">
                  View all <i className="bi bi-arrow-right" />
                </Link>
              )}
            </div>
            <div className="fs-1 fw-bold mt-1" style={{ fontFamily: 'Sora, sans-serif' }}>
              {loading ? <Spinner animation="border" size="sm" /> : counts.total}
            </div>
            {!loading && (
              <>
                <div className="d-flex gap-2 mt-2 flex-wrap">
                  <Badge bg="success">
                    <i className="bi bi-check-circle-fill me-1" />
                    {counts.active} active
                  </Badge>
                  <Badge bg="secondary">
                    <i className="bi bi-archive-fill me-1" />
                    {counts.inactive} closed
                  </Badge>
                </div>
                <div className="mt-3 small">
                  <StatusBreakdown counts={counts} total={counts.total} />
                </div>
              </>
            )}
          </Card>
        </Col>

        {/* GMV last 30 days */}
        <Col md={4}>
          <Card body className="h-100 shadow-sm">
            <div className="text-muted small text-uppercase fw-semibold" style={{ letterSpacing: '.5px' }}>
              <i className="bi bi-cash-coin me-1 text-success" />GMV (Last 30 Days)
            </div>
            <div className="fs-1 fw-bold mt-1" style={{ color: '#198754', fontFamily: 'Sora, sans-serif' }}>
              {loading ? <Spinner animation="border" size="sm" /> : fmtMoney(gmv30d)}
            </div>
            {!loading && (
              <div className="text-muted small mt-2">
                Across {reports.length} weekly report{reports.length === 1 ? '' : 's'}
                {brandsContributingToGmv > 0 && (
                  <> · {brandsContributingToGmv} brand{brandsContributingToGmv === 1 ? '' : 's'} contributing</>
                )}
              </div>
            )}
          </Card>
        </Col>

        {/* Clients */}
        <Col md={4}>
          <Card body className="h-100 shadow-sm">
            <div className="d-flex align-items-center justify-content-between">
              <div className="text-muted small text-uppercase fw-semibold" style={{ letterSpacing: '.5px' }}>
                <i className="bi bi-people-fill me-1" style={{ color: '#6610f2' }} />Clients
              </div>
              {!loading && (
                <Link to="/clients" className="small text-decoration-none">
                  View all <i className="bi bi-arrow-right" />
                </Link>
              )}
            </div>
            <div className="fs-1 fw-bold mt-1" style={{ color: '#6610f2', fontFamily: 'Sora, sans-serif' }}>
              {loading ? <Spinner animation="border" size="sm" /> : clients.length}
            </div>
            {!loading && (
              <div className="text-muted small mt-2">
                {counts.active > 0 && (
                  <>{counts.active} active brand{counts.active === 1 ? '' : 's'} across these clients</>
                )}
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </>
  );
}

/** Compact per-status row with a colored chip + count for each status. */
function StatusBreakdown({
  counts, total,
}: {
  counts: Record<ClientStatus | string, number>;
  total: number;
}) {
  const statuses: ClientStatus[] = ['onboarding', 'in_progress', 'paused', 'closed'];
  return (
    <div className="d-flex flex-column gap-1">
      {statuses.map(s => {
        const n = counts[s] ?? 0;
        if (n === 0) return null;
        const meta = STATUS_META[s];
        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
        return (
          <div key={s} className="d-flex align-items-center gap-2">
            <i className={`bi ${meta.icon}`} style={{ color: meta.color }} />
            <span className="flex-grow-1">{meta.label}</span>
            <span className="text-muted" style={{ fontSize: '.75rem' }}>{pct}%</span>
            <strong style={{ minWidth: 24, textAlign: 'right' }}>{n}</strong>
          </div>
        );
      })}
    </div>
  );
}
