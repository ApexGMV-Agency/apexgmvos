import { useEffect, useMemo, useState } from 'react';
import { Button, Form, InputGroup, Spinner, Alert, Modal, Badge } from 'react-bootstrap';
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

// --- types -----------------------------------------------------------------

interface BrandPayment { id: string; brand_id: string; month: string; amount: number; }
interface BrandLite { id: string; name: string; }
interface Income {
  id: string;
  month: string;
  source: string;
  amount: number;
  received_at: string | null;
  notes: string | null;
}
interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_default: boolean;
}
interface Expense {
  id: string;
  month: string;
  category_id: string | null;
  label: string;
  amount: number;
  spent_at: string | null;
  notes: string | null;
}

type TabKey = 'income' | 'expenses';

// --- page ------------------------------------------------------------------

export default function CompanyBudget() {
  const { profile, user } = useAuth();
  const isBob = profile?.role === 'bob';

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [fMonth, setFMonth] = useState(currentMonth());
  const [tab, setTab] = useState<TabKey>('income');

  const [brandPayments, setBrandPayments] = useState<BrandPayment[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [incomes, setIncomes] = useState<Income[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // Income modal
  const [incModal, setIncModal] = useState<Income | 'new' | null>(null);
  const [incSrc, setIncSrc] = useState('');
  const [incAmt, setIncAmt] = useState<number>(0);
  const [incDate, setIncDate] = useState('');
  const [incNotes, setIncNotes] = useState('');
  const [incSaving, setIncSaving] = useState(false);
  const [incErr, setIncErr] = useState<string | null>(null);

  // Expense modal
  const [expModal, setExpModal] = useState<Expense | 'new' | null>(null);
  const [expLabel, setExpLabel] = useState('');
  const [expAmt, setExpAmt] = useState<number>(0);
  const [expCatId, setExpCatId] = useState('');
  const [expDate, setExpDate] = useState('');
  const [expNotes, setExpNotes] = useState('');
  const [expSaving, setExpSaving] = useState(false);
  const [expErrMsg, setExpErrMsg] = useState<string | null>(null);

  // Category modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#475569');
  const [newCatIcon, setNewCatIcon] = useState('bi-tag');
  const [catSaving, setCatSaving] = useState(false);

  // Expense category filter
  const [expFilterCat, setExpFilterCat] = useState('');

  // ----- Load data --------------------------------------------------------

  const load = async () => {
    setLoading(true); setErr(null);
    const [bpRes, bRes, iRes, cRes, eRes] = await Promise.all([
      supabase.from('brand_payments').select('id,brand_id,month,amount'),
      supabase.from('brands').select('id,name').order('name'),
      supabase.from('income_entries').select('*').order('received_at', { ascending: false }),
      supabase.from('expense_categories').select('*').order('sort_order'),
      supabase.from('expense_entries').select('*').order('spent_at', { ascending: false }),
    ]);
    const e = bpRes.error ?? bRes.error ?? iRes.error ?? cRes.error ?? eRes.error;
    if (e) { setErr(e.message); setLoading(false); return; }
    setBrandPayments(((bpRes.data ?? []) as any[]).map(p => ({
      ...p, amount: Number(p.amount ?? 0),
      month: typeof p.month === 'string' ? p.month.slice(0, 10) : p.month,
    })));
    setBrands((bRes.data ?? []) as BrandLite[]);
    setIncomes(((iRes.data ?? []) as any[]).map(i => ({
      ...i, amount: Number(i.amount ?? 0),
      month: typeof i.month === 'string' ? i.month.slice(0, 10) : i.month,
    })));
    setCategories((cRes.data ?? []) as Category[]);
    setExpenses(((eRes.data ?? []) as any[]).map(x => ({
      ...x, amount: Number(x.amount ?? 0),
      month: typeof x.month === 'string' ? x.month.slice(0, 10) : x.month,
    })));
    setLoading(false);
  };
  useEffect(() => { if (isBob) load(); }, [isBob]);

  // ----- Derived for current month ----------------------------------------

  const target = monthIso(fMonth);
  const brandMap = useMemo(() => {
    const m = new Map<string, string>();
    brands.forEach(b => m.set(b.id, b.name));
    return m;
  }, [brands]);
  const catMap = useMemo(() => {
    const m = new Map<string, Category>();
    categories.forEach(c => m.set(c.id, c));
    return m;
  }, [categories]);

  const monthBrandPayments = useMemo(() =>
    brandPayments.filter(p => p.month === target),
    [brandPayments, target]);

  const monthIncomes = useMemo(() =>
    incomes.filter(i => i.month === target),
    [incomes, target]);

  const monthExpenses = useMemo(() =>
    expenses.filter(x => x.month === target),
    [expenses, target]);

  const brandRevenue = useMemo(() =>
    monthBrandPayments.reduce((s, p) => s + p.amount, 0),
    [monthBrandPayments]);
  const otherIncome = useMemo(() =>
    monthIncomes.reduce((s, i) => s + i.amount, 0),
    [monthIncomes]);
  const totalIncome = brandRevenue + otherIncome;
  const totalExpenses = useMemo(() =>
    monthExpenses.reduce((s, x) => s + x.amount, 0),
    [monthExpenses]);
  const net = totalIncome - totalExpenses;

  // Expense grouping by category
  const expensesByCat = useMemo(() => {
    const m = new Map<string | null, Expense[]>();
    monthExpenses
      .filter(x => !expFilterCat || x.category_id === expFilterCat)
      .forEach(x => {
        const key = x.category_id;
        if (!m.has(key)) m.set(key, []);
        m.get(key)!.push(x);
      });
    return m;
  }, [monthExpenses, expFilterCat]);

  const expenseCatTotals = useMemo(() => {
    const m = new Map<string | null, number>();
    monthExpenses.forEach(x => {
      m.set(x.category_id, (m.get(x.category_id) ?? 0) + x.amount);
    });
    return m;
  }, [monthExpenses]);

  // ----- Income CRUD -------------------------------------------------------

  const openIncomeNew = () => {
    setIncModal('new');
    setIncSrc('');
    setIncAmt(0);
    setIncDate(new Date().toISOString().slice(0, 10));
    setIncNotes('');
    setIncErr(null);
  };
  const openIncomeEdit = (i: Income) => {
    setIncModal(i);
    setIncSrc(i.source);
    setIncAmt(i.amount);
    setIncDate(i.received_at ?? '');
    setIncNotes(i.notes ?? '');
    setIncErr(null);
  };

  const submitIncome = async () => {
    setIncSaving(true); setIncErr(null);
    const payload = {
      month: target,
      source: incSrc.trim(),
      amount: incAmt,
      received_at: incDate || null,
      notes: incNotes || null,
      created_by: user?.id ?? null,
    };
    if (!payload.source) { setIncErr('Source is required.'); setIncSaving(false); return; }
    const isNew = incModal === 'new';
    if (isNew) {
      const { data, error } = await supabase.from('income_entries').insert(payload).select('*').single();
      if (error) { setIncErr(error.message); setIncSaving(false); return; }
      const d = data as any;
      setIncomes(prev => [{
        ...d, amount: Number(d.amount),
        month: typeof d.month === 'string' ? d.month.slice(0, 10) : d.month,
      }, ...prev]);
    } else if (incModal) {
      const editingId = incModal.id;
      const { error } = await supabase.from('income_entries').update(payload).eq('id', editingId);
      if (error) { setIncErr(error.message); setIncSaving(false); return; }
      setIncomes(prev => prev.map(x => x.id === editingId
        ? { ...x, ...payload, month: target } as Income : x));
    }
    setIncSaving(false);
    setIncModal(null);
  };

  const deleteIncome = async (i: Income) => {
    if (!confirm(`Delete income "${i.source}" (${fmtMoney(i.amount)})?`)) return;
    const { error } = await supabase.from('income_entries').delete().eq('id', i.id);
    if (error) { alert(error.message); return; }
    setIncomes(prev => prev.filter(x => x.id !== i.id));
  };

  // ----- Expense CRUD ------------------------------------------------------

  const openExpNew = () => {
    setExpModal('new');
    setExpLabel('');
    setExpAmt(0);
    setExpCatId(categories[0]?.id ?? '');
    setExpDate(new Date().toISOString().slice(0, 10));
    setExpNotes('');
    setExpErrMsg(null);
  };
  const openExpEdit = (x: Expense) => {
    setExpModal(x);
    setExpLabel(x.label);
    setExpAmt(x.amount);
    setExpCatId(x.category_id ?? '');
    setExpDate(x.spent_at ?? '');
    setExpNotes(x.notes ?? '');
    setExpErrMsg(null);
  };

  const submitExp = async () => {
    setExpSaving(true); setExpErrMsg(null);
    const payload = {
      month: target,
      category_id: expCatId || null,
      label: expLabel.trim(),
      amount: expAmt,
      spent_at: expDate || null,
      notes: expNotes || null,
      created_by: user?.id ?? null,
    };
    if (!payload.label) { setExpErrMsg('Label is required.'); setExpSaving(false); return; }
    const isNew = expModal === 'new';
    if (isNew) {
      const { data, error } = await supabase.from('expense_entries').insert(payload).select('*').single();
      if (error) { setExpErrMsg(error.message); setExpSaving(false); return; }
      const d = data as any;
      setExpenses(prev => [{
        ...d, amount: Number(d.amount),
        month: typeof d.month === 'string' ? d.month.slice(0, 10) : d.month,
      }, ...prev]);
    } else if (expModal) {
      const editingId = expModal.id;
      const { error } = await supabase.from('expense_entries').update(payload).eq('id', editingId);
      if (error) { setExpErrMsg(error.message); setExpSaving(false); return; }
      setExpenses(prev => prev.map(x => x.id === editingId
        ? { ...x, ...payload, month: target } as Expense : x));
    }
    setExpSaving(false);
    setExpModal(null);
  };

  const deleteExp = async (x: Expense) => {
    if (!confirm(`Delete expense "${x.label}" (${fmtMoney(x.amount)})?`)) return;
    const { error } = await supabase.from('expense_entries').delete().eq('id', x.id);
    if (error) { alert(error.message); return; }
    setExpenses(prev => prev.filter(y => y.id !== x.id));
  };

  // ----- Category CRUD -----------------------------------------------------

  const addCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    setCatSaving(true);
    const { data, error } = await supabase.from('expense_categories').insert({
      name, icon: newCatIcon, color: newCatColor,
      sort_order: 100, is_default: false,
    }).select('*').single();
    if (error) { alert(error.message); setCatSaving(false); return; }
    setCategories(prev => [...prev, data as Category]);
    setNewCatName(''); setNewCatColor('#475569'); setNewCatIcon('bi-tag');
    setCatSaving(false);
  };

  const deleteCategory = async (c: Category) => {
    if (c.is_default) {
      alert('Default categories can\'t be deleted, but you can rename them.');
      return;
    }
    const using = expenses.some(x => x.category_id === c.id);
    if (using && !confirm(`"${c.name}" has expenses assigned. Delete it and unset those expenses?`)) return;
    const { error } = await supabase.from('expense_categories').delete().eq('id', c.id);
    if (error) { alert(error.message); return; }
    setCategories(prev => prev.filter(x => x.id !== c.id));
    setExpenses(prev => prev.map(x => x.category_id === c.id ? { ...x, category_id: null } : x));
  };

  // ----- CSV exports -------------------------------------------------------

  const exportIncomeCsv = () => {
    const header = ['Type', 'Source / Brand', 'Amount (USD)', 'Date', 'Notes'];
    const brandRows = monthBrandPayments.map(p => [
      'Brand revenue',
      brandMap.get(p.brand_id) ?? p.brand_id,
      p.amount.toFixed(2),
      '',
      '',
    ]);
    const otherRows = monthIncomes.map(i => [
      'Other income',
      i.source,
      i.amount.toFixed(2),
      i.received_at ?? '',
      i.notes ?? '',
    ]);
    const rows: (string | number)[][] = [header, ...brandRows, ...otherRows];
    rows.push([]);
    rows.push(['TOTAL', '', totalIncome.toFixed(2), '', '']);
    downloadCsv(`company-income-${fMonth}.csv`, rows);
  };

  const exportExpenseCsv = () => {
    const header = ['Category', 'Label', 'Amount (USD)', 'Date', 'Notes'];
    const rows: (string | number)[][] = [header];
    const sorted = [...monthExpenses].sort((a, b) => {
      const ca = catMap.get(a.category_id ?? '')?.name ?? 'Uncategorized';
      const cb = catMap.get(b.category_id ?? '')?.name ?? 'Uncategorized';
      return ca.localeCompare(cb);
    });
    sorted.forEach(x => {
      rows.push([
        catMap.get(x.category_id ?? '')?.name ?? 'Uncategorized',
        x.label,
        x.amount.toFixed(2),
        x.spent_at ?? '',
        x.notes ?? '',
      ]);
    });
    rows.push([]);
    rows.push(['TOTAL', '', totalExpenses.toFixed(2), '', '']);
    downloadCsv(`company-expenses-${fMonth}.csv`, rows);
  };

  // ----- Render ------------------------------------------------------------

  if (!isBob) return <Alert variant="warning">Company Budget is only available to Bob.</Alert>;
  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <div className="bm-page">
      <h2 className="mb-3">
        <i className="bi bi-bank me-2 text-primary" />
        Company Budget
      </h2>

      {/* Header — month nav */}
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
        <div className="wr-header-right ms-auto">
          <Button size="sm" variant="outline-secondary"
            onClick={tab === 'income' ? exportIncomeCsv : exportExpenseCsv}>
            <i className="bi bi-download me-1" /> Export {tab === 'income' ? 'income' : 'expenses'} CSV
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="bm-tiles">
        <div className="bm-tile bm-tile-success">
          <div className="bm-tile-label">Income</div>
          <div className="bm-tile-value">{fmtMoney(totalIncome)}</div>
          <div className="bm-tile-sub">
            {fmtMoney(brandRevenue)} brands · {fmtMoney(otherIncome)} other
          </div>
        </div>
        <div className="bm-tile bm-tile-warning">
          <div className="bm-tile-label">Expenses</div>
          <div className="bm-tile-value">{fmtMoney(totalExpenses)}</div>
          <div className="bm-tile-sub">
            <i className="bi bi-receipt me-1" />
            {monthExpenses.length} entr{monthExpenses.length === 1 ? 'y' : 'ies'}
          </div>
        </div>
        <div className={`bm-tile ${net >= 0 ? 'bm-tile-success' : 'bm-tile-warning'}`}>
          <div className="bm-tile-label">Net {net >= 0 ? 'profit' : 'loss'}</div>
          <div className="bm-tile-value" style={{ color: net >= 0 ? '#15803d' : '#b91c1c' }}>
            {net >= 0 ? '+' : ''}{fmtMoney(net)}
          </div>
          <div className="bm-tile-sub text-muted">income − expenses</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="wr-tabs">
        <button className={`wr-tab ${tab === 'income' ? 'is-active' : ''}`} onClick={() => setTab('income')}>
          <i className="bi bi-graph-up-arrow me-1" /> Income
          <span className="wr-tab-count">{monthBrandPayments.length + monthIncomes.length}</span>
        </button>
        <button className={`wr-tab ${tab === 'expenses' ? 'is-active' : ''}`} onClick={() => setTab('expenses')}>
          <i className="bi bi-receipt me-1" /> Expenses
          <span className="wr-tab-count">{monthExpenses.length}</span>
        </button>
      </div>

      {/* Income tab */}
      {tab === 'income' && (
        <>
          {/* Brand revenue summary card (read-only) */}
          <div className="cb-section-card mb-3">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
              <div>
                <div className="cb-section-title">
                  <i className="bi bi-shop me-1 text-primary" />
                  Brand revenue
                </div>
                <div className="text-muted small">
                  Auto-pulled from Brand Budget for {monthLabel(fMonth)} — edit there.
                </div>
              </div>
              <div className="cb-section-amount text-success">{fmtMoney(brandRevenue)}</div>
            </div>
            {monthBrandPayments.length === 0 ? (
              <p className="text-muted small mb-0">No brand payments recorded for this month yet.</p>
            ) : (
              <ul className="cb-mini-list">
                {monthBrandPayments.map(p => (
                  <li key={p.id}>
                    <span>{brandMap.get(p.brand_id) ?? '—'}</span>
                    <span className="fw-semibold">{fmtMoney(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Other income */}
          <div className="cb-section-card">
            <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
              <div>
                <div className="cb-section-title">
                  <i className="bi bi-coin me-1 text-warning" />
                  Other income
                </div>
                <div className="text-muted small">
                  Consulting, affiliate commissions, one-off payments — anything outside brand fees.
                </div>
              </div>
              <Button size="sm" variant="primary" onClick={openIncomeNew}>
                <i className="bi bi-plus-lg me-1" /> Add income
              </Button>
            </div>
            {monthIncomes.length === 0 ? (
              <p className="text-muted small mb-0">No manual income recorded for this month.</p>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0 align-middle">
                  <thead className="small text-uppercase text-muted">
                    <tr>
                      <th className="ps-3">Source</th>
                      <th>Amount</th>
                      <th>Received</th>
                      <th>Notes</th>
                      <th className="text-end pe-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthIncomes.map(i => (
                      <tr key={i.id}>
                        <td className="ps-3 fw-semibold">{i.source}</td>
                        <td><strong className="text-success">{fmtMoney(i.amount)}</strong></td>
                        <td className="text-muted small">{i.received_at ? new Date(i.received_at).toLocaleDateString() : '—'}</td>
                        <td className="text-muted small" style={{ maxWidth: 280 }}>
                          <div className="text-truncate" title={i.notes ?? ''}>{i.notes ?? '—'}</div>
                        </td>
                        <td className="text-end pe-3">
                          <Button size="sm" variant="outline-secondary" onClick={() => openIncomeEdit(i)}>
                            <i className="bi bi-pencil" />
                          </Button>
                          <Button size="sm" variant="outline-danger" className="ms-1" onClick={() => deleteIncome(i)}>
                            <i className="bi bi-trash" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Expenses tab */}
      {tab === 'expenses' && (
        <>
          {/* Category chips */}
          <div className="cb-cat-chips mb-3">
            <button
              className={`cb-cat-chip ${!expFilterCat ? 'is-active' : ''}`}
              onClick={() => setExpFilterCat('')}
            >
              <i className="bi bi-grid me-1" /> All <Badge bg="light" text="dark" className="ms-1">{monthExpenses.length}</Badge>
            </button>
            {categories.map(c => {
              const n = monthExpenses.filter(x => x.category_id === c.id).length;
              return (
                <button key={c.id}
                  className={`cb-cat-chip ${expFilterCat === c.id ? 'is-active' : ''}`}
                  style={{ borderLeftColor: c.color }}
                  onClick={() => setExpFilterCat(c.id)}
                >
                  <i className={`bi ${c.icon} me-1`} style={{ color: c.color }} />
                  {c.name}
                  {n > 0 && <Badge bg="light" text="dark" className="ms-1">{n}</Badge>}
                </button>
              );
            })}
            <Button size="sm" variant="link" className="ms-1" onClick={() => setCatModalOpen(true)}>
              <i className="bi bi-gear me-1" /> Categories
            </Button>
            <Button size="sm" variant="primary" className="ms-auto" onClick={openExpNew}>
              <i className="bi bi-plus-lg me-1" /> Add expense
            </Button>
          </div>

          {monthExpenses.length === 0 ? (
            <div className="bm-empty">
              <div className="bm-empty-icon"><i className="bi bi-receipt" /></div>
              <h5 className="mb-1">No expenses for {monthLabel(fMonth)}</h5>
              <p className="text-muted mb-3">
                Track salaries, bills, software, marketing and one-offs here.
              </p>
              <Button variant="primary" size="sm" onClick={openExpNew}>
                <i className="bi bi-plus-lg me-1" /> Add the first expense
              </Button>
            </div>
          ) : (
            <div className="cb-expense-groups">
              {[...expensesByCat.entries()].map(([catId, list]) => {
                const cat = catId ? catMap.get(catId) : null;
                const total = list.reduce((s, x) => s + x.amount, 0);
                return (
                  <div key={catId ?? 'none'} className="cb-expense-group">
                    <div className="cb-expense-group-head" style={{ borderLeftColor: cat?.color ?? '#475569' }}>
                      <div className="fw-semibold">
                        <i className={`bi ${cat?.icon ?? 'bi-three-dots'} me-1`} style={{ color: cat?.color ?? '#475569' }} />
                        {cat?.name ?? 'Uncategorized'}
                      </div>
                      <div className="cb-expense-group-total">{fmtMoney(total)}</div>
                    </div>
                    <ul className="cb-expense-list">
                      {list.map(x => (
                        <li key={x.id}>
                          <div className="cb-expense-main">
                            <div className="fw-semibold">{x.label}</div>
                            {x.notes && <div className="text-muted small">{x.notes}</div>}
                          </div>
                          <div className="cb-expense-meta">
                            <span className="text-muted small me-3">
                              {x.spent_at ? new Date(x.spent_at).toLocaleDateString() : '—'}
                            </span>
                            <strong className="me-3">{fmtMoney(x.amount)}</strong>
                            <Button size="sm" variant="outline-secondary" onClick={() => openExpEdit(x)}>
                              <i className="bi bi-pencil" />
                            </Button>
                            <Button size="sm" variant="outline-danger" className="ms-1" onClick={() => deleteExp(x)}>
                              <i className="bi bi-trash" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Income modal */}
      <Modal show={!!incModal} onHide={() => setIncModal(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{incModal === 'new' ? 'Add income' : 'Edit income'} — {monthLabel(fMonth)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {incErr && <Alert variant="danger">{incErr}</Alert>}
          <Form.Group className="mb-3">
            <Form.Label>Source</Form.Label>
            <Form.Control value={incSrc} placeholder="e.g. Consulting — Acme Co" onChange={e => setIncSrc(e.target.value)} />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Amount</Form.Label>
            <InputGroup>
              <InputGroup.Text>$</InputGroup.Text>
              <Form.Control type="number" min={0} step="0.01"
                value={incAmt || ''}
                onChange={e => setIncAmt(e.target.value === '' ? 0 : Number(e.target.value))} />
            </InputGroup>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>Received on</Form.Label>
            <Form.Control type="date" value={incDate} onChange={e => setIncDate(e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Label>Notes <small className="text-muted fw-normal">(optional)</small></Form.Label>
            <Form.Control as="textarea" rows={2} value={incNotes} onChange={e => setIncNotes(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setIncModal(null)} disabled={incSaving}>Cancel</Button>
          <Button onClick={submitIncome} disabled={incSaving || !incSrc.trim() || incAmt <= 0}>
            {incSaving ? 'Saving…' : (incModal === 'new' ? 'Add' : 'Save')}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Expense modal */}
      <Modal show={!!expModal} onHide={() => setExpModal(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{expModal === 'new' ? 'Add expense' : 'Edit expense'} — {monthLabel(fMonth)}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {expErrMsg && <Alert variant="danger">{expErrMsg}</Alert>}
          <Form.Group className="mb-3">
            <Form.Label>Label</Form.Label>
            <Form.Control value={expLabel} placeholder="e.g. May salaries — Faheem" onChange={e => setExpLabel(e.target.value)} />
          </Form.Group>
          <div className="row g-2">
            <Form.Group className="col-md-6 mb-3">
              <Form.Label>Amount</Form.Label>
              <InputGroup>
                <InputGroup.Text>$</InputGroup.Text>
                <Form.Control type="number" min={0} step="0.01"
                  value={expAmt || ''}
                  onChange={e => setExpAmt(e.target.value === '' ? 0 : Number(e.target.value))} />
              </InputGroup>
            </Form.Group>
            <Form.Group className="col-md-6 mb-3">
              <Form.Label>Category</Form.Label>
              <Form.Select value={expCatId} onChange={e => setExpCatId(e.target.value)}>
                <option value="">Uncategorized</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Form.Select>
            </Form.Group>
          </div>
          <Form.Group className="mb-3">
            <Form.Label>Spent on</Form.Label>
            <Form.Control type="date" value={expDate} onChange={e => setExpDate(e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Label>Notes <small className="text-muted fw-normal">(optional)</small></Form.Label>
            <Form.Control as="textarea" rows={2} value={expNotes} onChange={e => setExpNotes(e.target.value)} />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setExpModal(null)} disabled={expSaving}>Cancel</Button>
          <Button onClick={submitExp} disabled={expSaving || !expLabel.trim() || expAmt <= 0}>
            {expSaving ? 'Saving…' : (expModal === 'new' ? 'Add' : 'Save')}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Category management modal */}
      <Modal show={catModalOpen} onHide={() => setCatModalOpen(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Expense categories</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small mb-3">
            Defaults can be renamed but not deleted. Add as many custom categories as you need.
          </p>
          <ul className="cb-cat-list mb-3">
            {categories.map(c => (
              <li key={c.id} style={{ borderLeftColor: c.color }}>
                <i className={`bi ${c.icon} me-2`} style={{ color: c.color }} />
                <span className="flex-grow-1 fw-semibold">{c.name}</span>
                {c.is_default && <Badge bg="light" text="dark" className="me-2">default</Badge>}
                {!c.is_default && (
                  <Button size="sm" variant="outline-danger" onClick={() => deleteCategory(c)}>
                    <i className="bi bi-trash" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <div className="cb-cat-add">
            <Form.Control placeholder="New category name" value={newCatName}
              onChange={e => setNewCatName(e.target.value)} />
            <Form.Control type="color" value={newCatColor}
              onChange={e => setNewCatColor(e.target.value)}
              style={{ width: 50, padding: 2 }} title="Color" />
            <Form.Control placeholder="bi-tag" value={newCatIcon}
              onChange={e => setNewCatIcon(e.target.value)}
              style={{ maxWidth: 130 }} title="Bootstrap icon class" />
            <Button onClick={addCategory} disabled={catSaving || !newCatName.trim()}>
              <i className="bi bi-plus-lg" />
            </Button>
          </div>
          <Form.Text className="text-muted">
            Icon = a <a href="https://icons.getbootstrap.com/" target="_blank" rel="noreferrer">Bootstrap icon</a> class (e.g. <code>bi-receipt</code>).
          </Form.Text>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setCatModalOpen(false)}>Done</Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
