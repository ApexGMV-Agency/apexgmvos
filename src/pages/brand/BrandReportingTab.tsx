import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Spinner, Alert, Badge, Form, Button } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { formatRange } from '../../lib/dates';

interface Brand {
  id: string;
  name: string;
  share_enabled: boolean;
}
interface WeeklyReport {
  id: string;
  brand_id: string;
  week_start: string;
  week_end: string;
  week_number: number;
  status: string;
  is_shared: boolean;
  created_at: string;
}
interface MonthlyReport {
  id: string;
  brand_id: string;
  month: string;             // 'YYYY-MM'
  status: string;
  is_shared: boolean;
  created_at: string;
}

function fmtMonth(yyyymm: string) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export default function BrandReportingTab({
  brand, isBob, canEdit, onShareEnabledChanged,
}: {
  brand: Brand;
  isBob: boolean;
  canEdit: boolean;
  onShareEnabledChanged: (next: boolean) => void;
}) {
  const nav = useNavigate();
  const [weekly, setWeekly] = useState<WeeklyReport[]>([]);
  const [monthly, setMonthly] = useState<MonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingShare, setSavingShare] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [w, m] = await Promise.all([
      supabase.from('weekly_reports')
        .select('id,brand_id,week_start,week_end,week_number,status,is_shared,created_at')
        .eq('brand_id', brand.id)
        .order('week_start', { ascending: false }),
      supabase.from('monthly_reports')
        .select('id,brand_id,month,status,is_shared,created_at')
        .eq('brand_id', brand.id)
        .order('month', { ascending: false }),
    ]);
    const e = w.error ?? m.error;
    if (e) { setErr(e.message); setLoading(false); return; }
    setWeekly((w.data as WeeklyReport[]) ?? []);
    setMonthly((m.data as MonthlyReport[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [brand.id]);

  const toggleBrandShare = async (next: boolean) => {
    setSavingShare(true);
    const { error } = await supabase.from('brands')
      .update({ share_enabled: next }).eq('id', brand.id);
    setSavingShare(false);
    if (error) { alert(error.message); return; }
    onShareEnabledChanged(next);
  };

  const toggleWeeklyShare = async (r: WeeklyReport, next: boolean) => {
    const prev = weekly;
    setWeekly(weekly.map(x => x.id === r.id ? { ...x, is_shared: next } : x));
    const { error } = await supabase.from('weekly_reports')
      .update({ is_shared: next }).eq('id', r.id);
    if (error) { alert(error.message); setWeekly(prev); }
  };
  const toggleMonthlyShare = async (r: MonthlyReport, next: boolean) => {
    const prev = monthly;
    setMonthly(monthly.map(x => x.id === r.id ? { ...x, is_shared: next } : x));
    const { error } = await supabase.from('monthly_reports')
      .update({ is_shared: next }).eq('id', r.id);
    if (error) { alert(error.message); setMonthly(prev); }
  };

  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <div className="fw-semibold">Client sharing for {brand.name}</div>
              <div className="text-muted small">
                Master switch — when off, this brand can't be added to any client share link.
                When on, also pick which weeks and months are shareable below.
              </div>
            </div>
            <Form.Check
              type="switch"
              id="brand-share-master"
              disabled={!canEdit || savingShare}
              checked={!!brand.share_enabled}
              onChange={e => toggleBrandShare(e.target.checked)}
              label={brand.share_enabled ? 'Sharing enabled' : 'Sharing disabled'}
            />
          </div>
        </Card.Body>
      </Card>

      {loading ? (
        <Card><Card.Body className="text-center py-4"><Spinner animation="border" /></Card.Body></Card>
      ) : err ? (
        <Card><Card.Body><Alert variant="danger" className="mb-0">{err}</Alert></Card.Body></Card>
      ) : (
        <>
          {/* Weekly reports */}
          <Card className="mb-3">
            <Card.Header className="fw-semibold">
              <i className="bi bi-bar-chart-line me-2" />
              Weekly Reports
              <Badge bg="secondary" className="ms-2">{weekly.length}</Badge>
            </Card.Header>
            <Card.Body className="p-0">
              {weekly.length === 0 ? (
                <p className="text-muted text-center py-4 mb-0">
                  No weekly reports yet for {brand.name}. Create one from the Reporting menu.
                </p>
              ) : (
                <Table hover responsive className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Week</th>
                      <th>Period</th>
                      <th>Status</th>
                      <th>Created</th>
                      {isBob && <th className="text-end" style={{ width: 200 }}>Share with client</th>}
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekly.map(r => (
                      <tr key={r.id} style={{ cursor: 'pointer' }}
                        onClick={() => nav(`/reporting/weekly/${r.id}`)}>
                        <td className="fw-semibold">#{r.week_number}</td>
                        <td>{formatRange(r.week_start, r.week_end)}</td>
                        <td><Badge bg={r.status === 'draft' ? 'secondary' : 'success'}>{r.status}</Badge></td>
                        <td><small className="text-muted">{new Date(r.created_at).toLocaleDateString()}</small></td>
                        {isBob && (
                          <td className="text-end" onClick={e => e.stopPropagation()}>
                            {!brand.share_enabled ? (
                              <span className="text-muted small">enable master switch</span>
                            ) : (
                              <Form.Check
                                type="switch"
                                id={`w-share-${r.id}`}
                                disabled={!canEdit}
                                checked={r.is_shared}
                                onChange={e => toggleWeeklyShare(r, e.target.checked)}
                                label={r.is_shared ? 'Shareable' : 'Not shared'}
                              />
                            )}
                          </td>
                        )}
                        <td className="text-end">
                          <Button size="sm" variant="outline-primary"
                            onClick={e => { e.stopPropagation(); nav(`/reporting/weekly/${r.id}`); }}>
                            <i className="bi bi-eye" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>

          {/* Monthly reports */}
          <Card>
            <Card.Header className="fw-semibold">
              <i className="bi bi-calendar-month me-2" />
              Monthly Reports
              <Badge bg="secondary" className="ms-2">{monthly.length}</Badge>
            </Card.Header>
            <Card.Body className="p-0">
              {monthly.length === 0 ? (
                <p className="text-muted text-center py-4 mb-0">
                  No monthly reports yet for {brand.name}. Create one from Reporting → Monthly.
                </p>
              ) : (
                <Table hover responsive className="align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th>Status</th>
                      <th>Created</th>
                      {isBob && <th className="text-end" style={{ width: 200 }}>Share with client</th>}
                      <th style={{ width: 60 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map(r => (
                      <tr key={r.id} style={{ cursor: 'pointer' }}
                        onClick={() => nav(`/reporting/monthly/${r.id}`)}>
                        <td className="fw-semibold">{fmtMonth(r.month)}</td>
                        <td><Badge bg={r.status === 'draft' ? 'secondary' : 'success'}>{r.status}</Badge></td>
                        <td><small className="text-muted">{new Date(r.created_at).toLocaleDateString()}</small></td>
                        {isBob && (
                          <td className="text-end" onClick={e => e.stopPropagation()}>
                            {!brand.share_enabled ? (
                              <span className="text-muted small">enable master switch</span>
                            ) : (
                              <Form.Check
                                type="switch"
                                id={`m-share-${r.id}`}
                                disabled={!canEdit}
                                checked={r.is_shared}
                                onChange={e => toggleMonthlyShare(r, e.target.checked)}
                                label={r.is_shared ? 'Shareable' : 'Not shared'}
                              />
                            )}
                          </td>
                        )}
                        <td className="text-end">
                          <Button size="sm" variant="outline-primary"
                            onClick={e => { e.stopPropagation(); nav(`/reporting/monthly/${r.id}`); }}>
                            <i className="bi bi-eye" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </>
      )}
    </>
  );
}
