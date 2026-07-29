import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Form, InputGroup, Spinner, Alert, Modal, Badge } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';

function ymOf(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}
function monthIso(ym: string) {
  return `${ym}-01`;
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' });
}
function monthLabelLong(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
function listMonthsBetween(startYm: string, endYm: string): string[] {
  const out: string[] = [];
  const [sy, sm] = startYm.split('-').map(Number);
  const [ey, em] = endYm.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

interface Payment {
  id: string;
  brand_id: string;
  month: string;       // YYYY-MM-01
  amount: number;
  paid_at: string;
  notes: string | null;
}

interface BrandLite {
  id: string;
  name: string;
  client_status: string | null;
  created_at: string;
  monthly_fee: number;
}

export default function BrandBillingTab({ brandId }: { brandId: string }) {
  const { user, profile } = useAuth();
  const isBob = profile?.role === 'bob';

  const [brand, setBrand] = useState<BrandLite | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // monthly_fee inline edit
  const [feeDraft, setFeeDraft] = useState<number>(0);
  const [feeSaving, setFeeSaving] = useState(false);
  const feeDirty = useMemo(() => brand && feeDraft !== brand.monthly_fee, [brand, feeDraft]);

  // payment modal
  const [payModal, setPayModal] = useState<{ ym: string; existing: Payment | null } | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payNotes, setPayNotes] = useState('');
  const [payDate, setPayDate] = useState('');
  const [paySaving, setPaySaving] = useState(false);
  const [modalErr, setModalErr] = useState<string | null>(null);

  // "+ Add payment for past month" picker
  const [addPickerYm, setAddPickerYm] = useState('');

  const load = async () => {
    setLoading(true); setErr(null);
    // monthly_fee comes from the Bob-only `brand_billing` table.
    const [bRes, pRes, fRes] = await Promise.all([
      supabase.from('brands').select('id,name,client_status,created_at').eq('id', brandId).maybeSingle(),
      supabase.from('brand_payments').select('id,brand_id,month,amount,paid_at,notes').eq('brand_id', brandId).order('month', { ascending: false }),
      supabase.from('brand_billing').select('monthly_fee').eq('brand_id', brandId).maybeSingle(),
    ]);
    if (bRes.error) { setErr(bRes.error.message); setLoading(false); return; }
    if (pRes.error) { setErr(pRes.error.message); setLoading(false); return; }
    if (!bRes.data) { setErr('Brand not found.'); setLoading(false); return; }
    const b: BrandLite = {
      ...(bRes.data as any),
      monthly_fee: Number((fRes.data as any)?.monthly_fee ?? 0),
    };
    setBrand(b);
    setFeeDraft(b.monthly_fee);
    setPayments(((pRes.data ?? []) as any[]).map(p => ({
      ...p,
      amount: Number(p.amount ?? 0),
      month: typeof p.month === 'string' ? p.month.slice(0, 10) : p.month,
    })));
    setLoading(false);
  };
  useEffect(() => { load(); }, [brandId]);

  // Pre-compute list of months from brand creation → current month.
  const months = useMemo(() => {
    if (!brand) return [] as string[];
    const created = new Date(brand.created_at);
    const earliestFromPayments = payments.length
      ? payments.reduce((min, p) => p.month < min ? p.month : min, payments[0].month).slice(0, 7)
      : null;
    const createdYm = ymOf(created);
    const startYm = earliestFromPayments && earliestFromPayments < createdYm ? earliestFromPayments : createdYm;
    const endYm = ymOf(new Date());
    return listMonthsBetween(startYm, endYm).reverse(); // newest first
  }, [brand, payments]);

  const paymentByYm = useMemo(() => {
    const m = new Map<string, Payment>();
    payments.forEach(p => m.set(p.month.slice(0, 7), p));
    return m;
  }, [payments]);

  const summary = useMemo(() => {
    if (!brand) return null;
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const monthsPaid = payments.length;
    const avg = monthsPaid > 0 ? totalPaid / monthsPaid : 0;
    const activeMonths = months.filter(ym => !paymentByYm.has(ym));
    const outstanding = brand.client_status === 'closed' ? 0 : activeMonths.length * brand.monthly_fee;
    return { totalPaid, monthsPaid, avg, outstanding, outstandingMonths: activeMonths.length };
  }, [payments, months, paymentByYm, brand]);

  // ----- Actions -----------------------------------------------------------

  const saveFee = async () => {
    if (!brand) return;
    setFeeSaving(true); setErr(null);
    const { error } = await supabase.from('brand_billing')
      .upsert({ brand_id: brand.id, monthly_fee: feeDraft }, { onConflict: 'brand_id' });
    if (error) { setErr(error.message); setFeeSaving(false); return; }
    setBrand({ ...brand, monthly_fee: feeDraft });
    setFeeSaving(false);
  };

  const openPay = (ym: string, existing: Payment | null) => {
    setPayModal({ ym, existing });
    setPayAmount(existing ? existing.amount : (brand?.monthly_fee ?? 0));
    setPayNotes(existing?.notes ?? '');
    setPayDate(existing ? existing.paid_at.slice(0, 10) : `${ym}-01`);
    setModalErr(null);
  };

  const submitPayment = async () => {
    if (!payModal || !brand) return;
    setPaySaving(true); setModalErr(null);
    const month = monthIso(payModal.ym);
    const paid_at = new Date(payDate + 'T12:00:00').toISOString();
    if (payModal.existing) {
      const { error } = await supabase.from('brand_payments')
        .update({ amount: payAmount, paid_at, notes: payNotes || null })
        .eq('id', payModal.existing.id);
      if (error) { setModalErr(error.message); setPaySaving(false); return; }
      setPayments(prev => prev.map(p => p.id === payModal.existing!.id
        ? { ...p, amount: payAmount, paid_at, notes: payNotes || null } : p));
    } else {
      const { data, error } = await supabase.from('brand_payments').insert({
        brand_id: brand.id,
        month,
        amount: payAmount,
        paid_at,
        notes: payNotes || null,
        created_by: user?.id ?? null,
      }).select('*').single();
      if (error) { setModalErr(error.message); setPaySaving(false); return; }
      const p = data as any;
      setPayments(prev => [{
        id: p.id,
        brand_id: p.brand_id,
        month: typeof p.month === 'string' ? p.month.slice(0, 10) : p.month,
        amount: Number(p.amount),
        paid_at: p.paid_at,
        notes: p.notes ?? null,
      }, ...prev]);
    }
    setPaySaving(false);
    setPayModal(null);
  };

  const removePayment = async () => {
    if (!payModal?.existing) return;
    if (!confirm(`Remove payment record for ${monthLabelLong(payModal.ym)}? It will show as Pending again.`)) return;
    setPaySaving(true);
    const { error } = await supabase.from('brand_payments').delete().eq('id', payModal.existing.id);
    if (error) { setModalErr(error.message); setPaySaving(false); return; }
    setPayments(prev => prev.filter(p => p.id !== payModal.existing!.id));
    setPaySaving(false);
    setPayModal(null);
  };

  // ----- Render ------------------------------------------------------------

  // Defense in depth — billing is Bob-only (RLS + tab visibility already
  // enforce this; this guard makes the intent explicit).
  if (!isBob) return <Alert variant="warning">Billing is only available to Bob.</Alert>;
  if (loading) return <div className="text-center py-4"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!brand) return null;

  return (
    <div className="bm-billing-tab">
      {/* Monthly fee */}
      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex align-items-center gap-3 flex-wrap">
            <div style={{ minWidth: 180 }}>
              <div className="small text-muted mb-1 fw-semibold text-uppercase" style={{ letterSpacing: '.4px' }}>Monthly fee</div>
              <InputGroup>
                <InputGroup.Text>$</InputGroup.Text>
                <Form.Control
                  type="number" min={0} step="0.01"
                  value={feeDraft || ''}
                  placeholder="0.00"
                  onChange={e => setFeeDraft(e.target.value === '' ? 0 : Number(e.target.value))}
                />
              </InputGroup>
            </div>
            <Button variant="primary" disabled={!feeDirty || feeSaving} onClick={saveFee}>
              {feeSaving ? 'Saving…' : 'Save fee'}
            </Button>
            <div className="text-muted small flex-grow-1">
              Used as the default expected amount each month in Budget Manager and on new brand-payment records.
            </div>
          </div>
        </Card.Body>
      </Card>

      {/* Lifetime summary tiles */}
      {summary && (
        <div className="bm-tiles mb-3">
          <div className="bm-tile bm-tile-success">
            <div className="bm-tile-label">Lifetime collected</div>
            <div className="bm-tile-value">{fmtMoney(summary.totalPaid)}</div>
            <div className="bm-tile-sub">across {summary.monthsPaid} month{summary.monthsPaid === 1 ? '' : 's'}</div>
          </div>
          <div className="bm-tile">
            <div className="bm-tile-label">Avg / month</div>
            <div className="bm-tile-value">{fmtMoney(summary.avg)}</div>
            <div className="bm-tile-sub text-muted">when paid</div>
          </div>
          <div className="bm-tile bm-tile-warning">
            <div className="bm-tile-label">Outstanding</div>
            <div className="bm-tile-value">{fmtMoney(summary.outstanding)}</div>
            <div className="bm-tile-sub">
              {summary.outstandingMonths} pending month{summary.outstandingMonths === 1 ? '' : 's'}
              {brand.client_status === 'closed' && ' · brand closed'}
            </div>
          </div>
          <div className="bm-tile">
            <div className="bm-tile-label">Current fee</div>
            <div className="bm-tile-value">{fmtMoney(brand.monthly_fee)}</div>
            <div className="bm-tile-sub text-muted">expected each month</div>
          </div>
        </div>
      )}

      {/* Payment history */}
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div className="fw-semibold">
            <i className="bi bi-clock-history me-2 text-primary" />
            Payment history
          </div>
          <div className="d-flex align-items-center gap-2">
            <InputGroup size="sm" style={{ width: 'auto' }}>
              <InputGroup.Text className="small">Backfill</InputGroup.Text>
              <Form.Control type="month" size="sm" value={addPickerYm} onChange={e => setAddPickerYm(e.target.value)} />
              <Button size="sm" variant="outline-primary" disabled={!addPickerYm}
                onClick={() => {
                  if (!addPickerYm) return;
                  const existing = paymentByYm.get(addPickerYm) ?? null;
                  openPay(addPickerYm, existing);
                  setAddPickerYm('');
                }}>
                <i className="bi bi-plus-lg me-1" />Add
              </Button>
            </InputGroup>
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          {months.length === 0 ? (
            <p className="text-muted text-center py-4 mb-0">No billing months yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0 align-middle">
                <thead className="small text-uppercase text-muted" style={{ background: 'var(--ac-bg-light)' }}>
                  <tr>
                    <th className="ps-3">Month</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Paid on</th>
                    <th>Notes</th>
                    <th className="text-end pe-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map(ym => {
                    const p = paymentByYm.get(ym) ?? null;
                    const isCurrent = ym === ymOf(new Date());
                    return (
                      <tr key={ym}>
                        <td className="ps-3 fw-semibold">
                          {monthLabel(ym)}
                          {isCurrent && <Badge bg="primary" className="ms-2">Current</Badge>}
                        </td>
                        <td>
                          {p
                            ? <span className="bm-status is-paid">Paid</span>
                            : <span className="bm-status is-pending">Pending</span>}
                        </td>
                        <td>
                          {p
                            ? <strong>{fmtMoney(p.amount)}</strong>
                            : <span className="text-muted">{fmtMoney(brand.monthly_fee)} <small>expected</small></span>}
                        </td>
                        <td className="text-muted small">
                          {p ? new Date(p.paid_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="text-muted small" style={{ maxWidth: 240 }}>
                          <div className="text-truncate" title={p?.notes ?? ''}>{p?.notes ?? '—'}</div>
                        </td>
                        <td className="text-end pe-3">
                          <Button size="sm" variant={p ? 'outline-secondary' : 'primary'} onClick={() => openPay(ym, p)}>
                            <i className={`bi ${p ? 'bi-pencil' : 'bi-check2-circle'} me-1`} />
                            {p ? 'Edit' : 'Mark paid'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Payment modal */}
      <Modal show={!!payModal} onHide={() => setPayModal(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {payModal?.existing ? 'Edit payment' : 'Record payment'} — {payModal && monthLabelLong(payModal.ym)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalErr && <Alert variant="danger">{modalErr}</Alert>}
          <p className="text-muted small mb-3">
            Current fee on file: <strong>{fmtMoney(brand.monthly_fee)}</strong>
          </p>
          <Form.Group className="mb-3">
            <Form.Label>Amount paid</Form.Label>
            <InputGroup>
              <InputGroup.Text>$</InputGroup.Text>
              <Form.Control
                type="number" min={0} step="0.01"
                value={payAmount || ''}
                onChange={e => setPayAmount(e.target.value === '' ? 0 : Number(e.target.value))}
              />
            </InputGroup>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Paid on</Form.Label>
            <Form.Control type="date" value={payDate} onChange={e => setPayDate(e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Label>Notes <small className="text-muted fw-normal">(optional)</small></Form.Label>
            <Form.Control as="textarea" rows={2} value={payNotes}
              placeholder="e.g. Wire transfer ref #4421"
              onChange={e => setPayNotes(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between">
          <div>
            {payModal?.existing && (
              <Button variant="outline-danger" size="sm" onClick={removePayment} disabled={paySaving}>
                <i className="bi bi-x-circle me-1" /> Remove
              </Button>
            )}
          </div>
          <div>
            <Button variant="secondary" onClick={() => setPayModal(null)} disabled={paySaving}>Cancel</Button>
            <Button className="ms-2" onClick={submitPayment} disabled={paySaving || payAmount <= 0}>
              {paySaving ? 'Saving…' : (payModal?.existing ? 'Save changes' : 'Mark paid')}
            </Button>
          </div>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
