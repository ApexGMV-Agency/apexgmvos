import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, InputGroup, Spinner, Alert, Modal, Dropdown, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { downloadCsv } from '../lib/csv';

// --- helpers ---------------------------------------------------------------

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthIso(ym: string) {
  return `${ym}-01`;
}
function fmtMoney(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

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

// --- types -----------------------------------------------------------------

interface Brand {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  client_status: string | null;
  monthly_fee: number;
}
interface Payment {
  id: string;
  brand_id: string;
  month: string;          // YYYY-MM-01
  amount: number;
  paid_at: string;
  notes: string | null;
}
interface ClientLite { id: string; name: string; }

type StatusTab = 'all' | 'paid' | 'pending' | 'closed';

// --- page ------------------------------------------------------------------

export default function BudgetManager() {
  const { profile, user } = useAuth();
  const nav = useNavigate();
  const isBob = profile?.role === 'bob';

  const [brands, setBrands] = useState<Brand[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // header state
  const [fMonth, setFMonth] = useState(currentMonth());
  const [fSearch, setFSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('all');
  const [fClient, setFClient] = useState('');

  // payment modal state
  const [payModal, setPayModal] = useState<{ brand: Brand; existing: Payment | null } | null>(null);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payNotes, setPayNotes] = useState('');
  const [payDate, setPayDate] = useState('');
  const [paySaving, setPaySaving] = useState(false);

  // bulk "mark paid" state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkDate, setBulkDate] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    // monthly_fee lives in the Bob-only `brand_billing` table — not on brands.
    const [bRes, cRes, pRes, fRes] = await Promise.all([
      supabase.from('brands').select('id,name,client,client_id,client_status').order('name'),
      supabase.from('clients').select('id,name').order('name'),
      supabase.from('brand_payments').select('id,brand_id,month,amount,paid_at,notes'),
      supabase.from('brand_billing').select('brand_id,monthly_fee'),
    ]);
    const e = bRes.error ?? cRes.error ?? pRes.error ?? fRes.error;
    if (e) { setErr(e.message); setLoading(false); return; }
    const feeMap = new Map<string, number>();
    (fRes.data ?? []).forEach((r: any) => feeMap.set(r.brand_id, Number(r.monthly_fee ?? 0)));
    const bs = (bRes.data ?? []).map((b: any) => ({ ...b, monthly_fee: feeMap.get(b.id) ?? 0 })) as Brand[];
    setBrands(bs);
    setClients((cRes.data ?? []) as ClientLite[]);
    setPayments(((pRes.data ?? []) as any[]).map(p => ({
      ...p,
      amount: Number(p.amount ?? 0),
      month: typeof p.month === 'string' ? p.month.slice(0, 10) : p.month,
    })));
    setLoading(false);
  };
  useEffect(() => { if (isBob) load(); }, [isBob]);

  // Payments for the currently-selected month, indexed by brand.
  const monthPaymentByBrand = useMemo(() => {
    const targetMonth = monthIso(fMonth);
    const m = new Map<string, Payment>();
    payments.forEach(p => {
      if (p.month === targetMonth) m.set(p.brand_id, p);
    });
    return m;
  }, [payments, fMonth]);

  // Each brand's row for the selected month — combined view.
  type Row = {
    brand: Brand;
    payment: Payment | null;
    paid: boolean;
    expected: number;       // monthly_fee
    amount: number;         // payment.amount or 0
  };

  const rows = useMemo<Row[]>(() => {
    return brands.map(b => {
      const p = monthPaymentByBrand.get(b.id) ?? null;
      return {
        brand: b,
        payment: p,
        paid: !!p,
        expected: Number(b.monthly_fee ?? 0),
        amount: p ? Number(p.amount) : 0,
      };
    });
  }, [brands, monthPaymentByBrand]);

  const filteredRows = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return rows.filter(r => {
      const inactive = r.brand.client_status === 'closed';
      if (statusTab === 'paid' && !r.paid) return false;
      if (statusTab === 'pending' && (r.paid || inactive)) return false;
      if (statusTab === 'closed' && !inactive) return false;
      if (statusTab === 'all' && inactive) return false; // hide inactive from default view
      if (fClient && r.brand.client_id !== fClient) return false;
      if (q) {
        const hay = `${r.brand.name} ${r.brand.client ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, statusTab, fClient, fSearch]);

  // Pending rows in the current view that can be bulk-marked (fee > 0, unpaid).
  const bulkEligibleRows = useMemo(
    () => filteredRows.filter(r => !r.paid && r.expected > 0 && r.brand.client_status !== 'closed'),
    [filteredRows]);

  // Drop any selected ids that are no longer eligible (month change, filters, etc.)
  useEffect(() => {
    const eligible = new Set(bulkEligibleRows.map(r => r.brand.id));
    setSelected(prev => {
      const next = new Set([...prev].filter(id => eligible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [bulkEligibleRows]);

  // Summary tile counts — only consider active brands for expected/outstanding.
  const summary = useMemo(() => {
    const activeRows = rows.filter(r => r.brand.client_status !== 'closed');
    const expected = activeRows.reduce((s, r) => s + r.expected, 0);
    const collected = activeRows.reduce((s, r) => s + r.amount, 0);
    const outstanding = activeRows.filter(r => !r.paid).reduce((s, r) => s + r.expected, 0);
    const paidCount = activeRows.filter(r => r.paid).length;
    const pendingCount = activeRows.filter(r => !r.paid).length;
    const inactiveCount = rows.length - activeRows.length;
    return { expected, collected, outstanding, paidCount, pendingCount, inactiveCount, totalActive: activeRows.length };
  }, [rows]);

  // Tab counts
  const tabCounts = useMemo(() => ({
    all: summary.totalActive,
    paid: summary.paidCount,
    pending: summary.pendingCount,
    inactive: summary.inactiveCount,
  }), [summary]);

  const openPay = (brand: Brand, existing: Payment | null) => {
    setPayModal({ brand, existing });
    setPayAmount(existing ? existing.amount : (brand.monthly_fee ?? 0));
    setPayNotes(existing?.notes ?? '');
    setPayDate(existing ? existing.paid_at.slice(0, 10) : new Date().toISOString().slice(0, 10));
  };

  const submitPayment = async () => {
    if (!payModal) return;
    setPaySaving(true); setErr(null);
    const month = monthIso(fMonth);
    const paid_at = new Date(payDate + 'T12:00:00').toISOString();
    if (payModal.existing) {
      const { error } = await supabase.from('brand_payments')
        .update({ amount: payAmount, paid_at, notes: payNotes || null })
        .eq('id', payModal.existing.id);
      if (error) { setErr(error.message); setPaySaving(false); return; }
      setPayments(prev => prev.map(p => p.id === payModal.existing!.id
        ? { ...p, amount: payAmount, paid_at, notes: payNotes || null }
        : p));
    } else {
      const { data, error } = await supabase.from('brand_payments').insert({
        brand_id: payModal.brand.id,
        month,
        amount: payAmount,
        paid_at,
        notes: payNotes || null,
        created_by: user?.id ?? null,
      }).select('*').single();
      if (error) { setErr(error.message); setPaySaving(false); return; }
      const p = data as any;
      setPayments(prev => [...prev, {
        id: p.id,
        brand_id: p.brand_id,
        month: typeof p.month === 'string' ? p.month.slice(0, 10) : p.month,
        amount: Number(p.amount),
        paid_at: p.paid_at,
        notes: p.notes ?? null,
      }]);
    }
    setPaySaving(false);
    setPayModal(null);
  };

  const exportCsv = () => {
    const header = ['Brand', 'Client', 'Monthly fee (USD)', 'Status', 'Amount paid (USD)', 'Paid on', 'Notes'];
    const rows = filteredRows.map(r => [
      r.brand.name,
      r.brand.client ?? '',
      r.expected.toFixed(2),
      r.paid ? 'Paid' : 'Pending',
      r.paid ? r.amount.toFixed(2) : '',
      r.paid && r.payment ? new Date(r.payment.paid_at).toLocaleDateString('en-CA') : '',
      r.payment?.notes ?? '',
    ]);
    // Totals row
    const totalExpected = filteredRows.reduce((s, r) => s + r.expected, 0);
    const totalCollected = filteredRows.reduce((s, r) => s + (r.paid ? r.amount : 0), 0);
    rows.push([]);
    rows.push(['TOTAL', '', totalExpected.toFixed(2), '', totalCollected.toFixed(2), '', '']);
    downloadCsv(`brand-budget-${fMonth}.csv`, [header, ...rows]);
  };

  // ----- Bulk mark paid ----------------------------------------------------

  const toggleSelect = (brandId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(brandId)) next.delete(brandId);
      else next.add(brandId);
      return next;
    });
  };
  const allEligibleSelected = bulkEligibleRows.length > 0
    && bulkEligibleRows.every(r => selected.has(r.brand.id));
  const toggleSelectAll = () => {
    if (allEligibleSelected) setSelected(new Set());
    else setSelected(new Set(bulkEligibleRows.map(r => r.brand.id)));
  };

  const selectedRows = useMemo(
    () => bulkEligibleRows.filter(r => selected.has(r.brand.id)),
    [bulkEligibleRows, selected]);
  const selectedTotal = selectedRows.reduce((s, r) => s + r.expected, 0);

  const openBulkModal = () => {
    setBulkDate(new Date().toISOString().slice(0, 10));
    setErr(null);
    setBulkModal(true);
  };

  const submitBulk = async () => {
    if (selectedRows.length === 0) return;
    setBulkSaving(true); setErr(null);
    const month = monthIso(fMonth);
    const paid_at = new Date(bulkDate + 'T12:00:00').toISOString();
    const inserts = selectedRows.map(r => ({
      brand_id: r.brand.id,
      month,
      amount: r.expected,
      paid_at,
      notes: 'Bulk marked paid',
      created_by: user?.id ?? null,
    }));
    const { data, error } = await supabase.from('brand_payments').insert(inserts).select('*');
    if (error) { setErr(error.message); setBulkSaving(false); return; }
    const newPayments: Payment[] = ((data ?? []) as any[]).map(p => ({
      id: p.id,
      brand_id: p.brand_id,
      month: typeof p.month === 'string' ? p.month.slice(0, 10) : p.month,
      amount: Number(p.amount),
      paid_at: p.paid_at,
      notes: p.notes ?? null,
    }));
    setPayments(prev => [...prev, ...newPayments]);
    setSelected(new Set());
    setBulkSaving(false);
    setBulkModal(false);
  };

  const unmarkPaid = async () => {
    if (!payModal?.existing) return;
    if (!confirm(`Remove payment record for ${payModal.brand.name} (${monthLabel(fMonth)})? It will show as Pending again.`)) return;
    setPaySaving(true);
    const { error } = await supabase.from('brand_payments').delete().eq('id', payModal.existing.id);
    if (error) { setErr(error.message); setPaySaving(false); return; }
    setPayments(prev => prev.filter(p => p.id !== payModal.existing!.id));
    setPaySaving(false);
    setPayModal(null);
  };

  if (!isBob) {
    return <Alert variant="warning">Budget Manager is only available to Bob.</Alert>;
  }
  if (loading) {
    return <div className="text-center py-5"><Spinner animation="border" /></div>;
  }
  if (err && !payModal) {
    return <Alert variant="danger">{err}</Alert>;
  }

  const pct = summary.expected > 0 ? Math.round((summary.collected / summary.expected) * 100) : 0;

  return (
    <div className="bm-page">
      <h2 className="mb-3">
        <i className="bi bi-shop me-2 text-primary" />
        Brand Budget
      </h2>
      {/* Header */}
      <div className="wr-header">
        <div className="wr-header-left">
          <Button variant="link" className="wr-icon-btn" onClick={() => setFMonth(m => shiftMonth(m, -1))} title="Previous month">
            <i className="bi bi-chevron-left" />
          </Button>
          <div className="wr-month-picker">
            <i className="bi bi-calendar3 me-2" />
            <span>{monthLabel(fMonth)}</span>
            <input
              type="month"
              value={fMonth}
              onChange={e => e.target.value && setFMonth(e.target.value)}
              className="wr-month-input"
              aria-label="Pick month"
            />
          </div>
          <Button variant="link" className="wr-icon-btn" onClick={() => setFMonth(m => shiftMonth(m, 1))} title="Next month">
            <i className="bi bi-chevron-right" />
          </Button>
          <Button size="sm" variant="outline-secondary" className="wr-today-btn" onClick={() => setFMonth(currentMonth())}>
            Today
          </Button>
        </div>

        <div className="wr-header-search">
          <InputGroup size="sm">
            <InputGroup.Text className="bg-white border-end-0">
              <i className="bi bi-search text-muted" />
            </InputGroup.Text>
            <Form.Control
              placeholder="Search brand or client…"
              value={fSearch}
              onChange={e => setFSearch(e.target.value)}
              className="border-start-0"
            />
          </InputGroup>
        </div>

        <div className="wr-header-right">
          <Button variant="outline-secondary" size="sm" onClick={exportCsv} disabled={filteredRows.length === 0}>
            <i className="bi bi-download me-1" /> Export CSV
          </Button>
          <Dropdown align="end">
            <Dropdown.Toggle variant="outline-secondary" size="sm" id="bm-filters">
              <i className="bi bi-funnel me-1" /> Filters
              {fClient && <Badge bg="primary" className="ms-1">1</Badge>}
            </Dropdown.Toggle>
            <Dropdown.Menu className="p-3" style={{ minWidth: 260 }}>
              <Form.Group className="mb-2">
                <Form.Label className="small mb-1">Client</Form.Label>
                <Form.Select size="sm" value={fClient} onChange={e => setFClient(e.target.value)}>
                  <option value="">All clients</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Form.Select>
              </Form.Group>
              <Button size="sm" variant="outline-secondary" className="w-100 mt-2"
                onClick={() => { setFClient(''); setFSearch(''); setStatusTab('all'); }}>
                <i className="bi bi-x-lg me-1" /> Clear all
              </Button>
            </Dropdown.Menu>
          </Dropdown>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="bm-tiles">
        <div className="bm-tile">
          <div className="bm-tile-label">Expected</div>
          <div className="bm-tile-value">{fmtMoney(summary.expected)}</div>
          <div className="bm-tile-sub text-muted">
            from {summary.totalActive} active brand{summary.totalActive === 1 ? '' : 's'}
          </div>
        </div>
        <div className="bm-tile bm-tile-success">
          <div className="bm-tile-label">Collected</div>
          <div className="bm-tile-value">{fmtMoney(summary.collected)}</div>
          <div className="bm-tile-sub">
            <i className="bi bi-check-circle me-1" />
            {summary.paidCount} paid
          </div>
        </div>
        <div className="bm-tile bm-tile-warning">
          <div className="bm-tile-label">Outstanding</div>
          <div className="bm-tile-value">{fmtMoney(summary.outstanding)}</div>
          <div className="bm-tile-sub">
            <i className="bi bi-hourglass-split me-1" />
            {summary.pendingCount} pending
          </div>
        </div>
        <div className="bm-tile">
          <div className="bm-tile-label">Collection rate</div>
          <div className="bm-tile-value">{pct}%</div>
          <div className="bm-progress">
            <div className="bm-progress-bar" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* Status tabs */}
      <div className="wr-tabs">
        <button className={`wr-tab ${statusTab === 'all' ? 'is-active' : ''}`} onClick={() => setStatusTab('all')}>
          <i className="bi bi-grid me-1" /> All
          <span className="wr-tab-count">{tabCounts.all}</span>
        </button>
        <button className={`wr-tab ${statusTab === 'paid' ? 'is-active' : ''}`} onClick={() => setStatusTab('paid')}>
          <i className="bi bi-check-circle me-1" /> Paid
          <span className="wr-tab-count">{tabCounts.paid}</span>
        </button>
        <button className={`wr-tab ${statusTab === 'pending' ? 'is-active' : ''}`} onClick={() => setStatusTab('pending')}>
          <i className="bi bi-hourglass-split me-1" /> Pending
          <span className="wr-tab-count">{tabCounts.pending}</span>
        </button>
        <button className={`wr-tab ${statusTab === 'closed' ? 'is-active' : ''}`} onClick={() => setStatusTab('closed')}>
          <i className="bi bi-archive me-1" /> Closed
          <span className="wr-tab-count">{tabCounts.inactive}</span>
        </button>
      </div>

      {/* Bulk action bar */}
      {bulkEligibleRows.length > 0 && (
        <div className="bm-bulk-bar">
          <Form.Check
            type="checkbox"
            id="bm-select-all"
            checked={allEligibleSelected}
            ref={(el: HTMLInputElement | null) => {
              if (el) el.indeterminate = selected.size > 0 && !allEligibleSelected;
            }}
            onChange={toggleSelectAll}
            label={
              <span className="fw-semibold">
                {selected.size > 0
                  ? `${selected.size} of ${bulkEligibleRows.length} selected`
                  : `Select all ${bulkEligibleRows.length} pending`}
              </span>
            }
          />
          {selected.size > 0 && (
            <>
              <span className="text-muted small ms-2">
                Total {fmtMoney(selectedTotal)}
              </span>
              <div className="ms-auto d-flex gap-2">
                <Button size="sm" variant="outline-secondary" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button size="sm" variant="success" onClick={openBulkModal}>
                  <i className="bi bi-check2-all me-1" />
                  Mark {selected.size} as paid
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Rows */}
      {filteredRows.length === 0 ? (
        <div className="bm-empty">
          <div className="bm-empty-icon"><i className="bi bi-cash-stack" /></div>
          <h5 className="mb-1">No brands match</h5>
          <p className="text-muted mb-0">
            {brands.length === 0
              ? 'No brands yet — add one from the Brands page with a monthly fee.'
              : 'Try a different month, status tab, or filter.'}
          </p>
        </div>
      ) : (
        <div className="bm-grid">
          {filteredRows.map(r => {
            const ava = avatarFor(r.brand.name);
            const inactive = r.brand.client_status === 'closed';
            const selectable = !r.paid && r.expected > 0 && !inactive;
            const isSel = selected.has(r.brand.id);
            return (
              <div key={r.brand.id} className={`bm-card ${r.paid ? 'is-paid' : 'is-pending'} ${inactive ? 'is-inactive' : ''} ${isSel ? 'is-selected' : ''}`}>
                <div className="bm-card-top">
                  <div className="bm-card-brand">
                    {selectable && (
                      <Form.Check
                        type="checkbox"
                        className="bm-card-check"
                        checked={isSel}
                        onChange={() => toggleSelect(r.brand.id)}
                        aria-label={`Select ${r.brand.name}`}
                      />
                    )}
                    <div className="wr-avatar" style={{ background: ava.bg, color: ava.text }}>
                      {initialsFor(r.brand.name)}
                    </div>
                    <div className="bm-card-brand-meta">
                      <div className="bm-card-brand-name">{r.brand.name}</div>
                      <div className="bm-card-brand-sub">
                        {r.brand.client ?? '—'}
                        {inactive && <Badge bg="dark" className="ms-2"><i className="bi bi-archive me-1" />Inactive</Badge>}
                      </div>
                    </div>
                  </div>
                  <span className={`bm-status ${r.paid ? 'is-paid' : 'is-pending'}`}>
                    {r.paid ? 'Paid' : 'Pending'}
                  </span>
                </div>

                <div className="bm-card-amount">
                  <div className="bm-card-fee">
                    <span className="bm-money">{fmtMoney(r.paid ? r.amount : r.expected)}</span>
                    {r.paid && r.amount !== r.expected && (
                      <small className="text-muted ms-1">
                        (fee {fmtMoney(r.expected)})
                      </small>
                    )}
                  </div>
                  {r.paid && r.payment && (
                    <small className="text-muted">
                      <i className="bi bi-check-circle me-1 text-success" />
                      Paid on {new Date(r.payment.paid_at).toLocaleDateString()}
                    </small>
                  )}
                  {!r.paid && r.expected === 0 && (
                    <small className="text-muted">
                      <i className="bi bi-info-circle me-1" />
                      No fee set
                    </small>
                  )}
                </div>

                {r.payment?.notes && (
                  <div className="bm-card-notes">
                    <i className="bi bi-sticky me-1" />{r.payment.notes}
                  </div>
                )}

                <div className="bm-card-actions">
                  <Button
                    size="sm"
                    variant={r.paid ? 'outline-secondary' : 'primary'}
                    onClick={() => openPay(r.brand, r.payment)}
                    disabled={r.expected === 0 && !r.paid}
                  >
                    <i className={`bi ${r.paid ? 'bi-pencil' : 'bi-check2-circle'} me-1`} />
                    {r.paid ? 'Edit payment' : 'Mark paid'}
                  </Button>
                  <Button
                    size="sm" variant="link" className="ms-auto text-muted"
                    onClick={() => nav(`/brands/${r.brand.id}`)}
                  >
                    View brand <i className="bi bi-arrow-right ms-1" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Payment modal */}
      <Modal show={!!payModal} onHide={() => setPayModal(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {payModal?.existing ? 'Edit payment' : 'Record payment'} — {payModal?.brand.name}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger">{err}</Alert>}
          <p className="text-muted small mb-3">
            {monthLabel(fMonth)} — fee on file: <strong>{fmtMoney(payModal?.brand.monthly_fee ?? 0)}</strong>
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
              <Button variant="outline-danger" size="sm" onClick={unmarkPaid} disabled={paySaving}>
                <i className="bi bi-x-circle me-1" /> Unmark paid
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

      {/* Bulk mark-paid modal */}
      <Modal show={bulkModal} onHide={() => setBulkModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Mark {selectedRows.length} brand{selectedRows.length === 1 ? '' : 's'} as paid</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger">{err}</Alert>}
          <p className="text-muted small mb-3">
            Each brand is recorded as paid for <strong>{monthLabel(fMonth)}</strong> at its monthly fee on file.
            Edit individual amounts later if a client paid a different amount.
          </p>
          <Form.Group className="mb-3">
            <Form.Label>Paid on</Form.Label>
            <Form.Control type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
          </Form.Group>
          <div className="bm-bulk-list">
            {selectedRows.map(r => (
              <div key={r.brand.id} className="bm-bulk-list-row">
                <span className="text-truncate">{r.brand.name}</span>
                <strong>{fmtMoney(r.expected)}</strong>
              </div>
            ))}
            <div className="bm-bulk-list-row bm-bulk-list-total">
              <span>Total</span>
              <strong>{fmtMoney(selectedTotal)}</strong>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setBulkModal(false)} disabled={bulkSaving}>Cancel</Button>
          <Button variant="success" onClick={submitBulk} disabled={bulkSaving || selectedRows.length === 0}>
            {bulkSaving ? 'Saving…' : <><i className="bi bi-check2-all me-1" />Confirm — mark paid</>}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
