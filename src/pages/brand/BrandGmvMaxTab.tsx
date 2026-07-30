import { Fragment, useEffect, useMemo, useState, FormEvent } from 'react';
import { Card, Form, Button, Row, Col, Table, Modal, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { addDays, formatRange, toISO, fromISO } from '../../lib/dates';
import { BrandProduct } from '../../lib/brandProducts';
import { currencySymbol } from '../../lib/currency';
import NumberInput from '../../components/NumberInput';

/** Days between two ISO dates (b - a). */
function daysDiff(a: string, b: string): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The latest `count` months as `YYYY-MM`, oldest first, ending with the current month. */
function recentMonths(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const n = (v: any) => (v == null ? 0 : Number(v) || 0);

interface MonthRow {
  id?: string;
  brand_id: string;
  month: string;
  allocated_budget: number;
  spend_to_date: number;
  target_roi: number;
}
interface WeekRow {
  id?: string;
  brand_id: string;
  week_start: string;
  week_end: string;
  ad_spend: number;
  roi: number;
  orders: number;
  cpo: number;
  gmv: number;
  notes: string;
}
/** Product-level breakdown of a weekly entry. product_id null + is_other = the "Other Products" catch-all. */
interface ProductRow {
  id?: string;
  weekly_id: string;
  product_id: string | null;
  is_other: boolean;
  ad_spend: number;
  roi: number;
  orders: number;
  cpo: number;
  gmv: number;
}

const emptyMonth = (brandId: string, month: string): MonthRow => ({
  brand_id: brandId, month, allocated_budget: 0, spend_to_date: 0, target_roi: 0,
});

export default function BrandGmvMaxTab({ brandId, canEdit, currency }: { brandId: string; canEdit: boolean; currency?: string | null }) {
  const sym = currencySymbol(currency); // brand region money symbol ($/£/€)
  const [month, setMonth] = useState<string>(currentMonth());
  const [monthRow, setMonthRow] = useState<MonthRow>(emptyMonth(brandId, month));
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [products, setProducts] = useState<BrandProduct[]>([]);
  // Product-level rows loaded from the DB, keyed by weekly_id.
  const [childrenByWeek, setChildrenByWeek] = useState<Record<string, ProductRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingMonth, setSavingMonth] = useState(false);
  // Allocated budget is locked once a month row is saved — click Update to edit.
  const [editBudget, setEditBudget] = useState(false);
  // Weekly-report anchor for this brand — GMV Max weeks sync to this cycle.
  const [anchor, setAnchor] = useState<string | null>(null);
  // Every GMV Max week_start for this brand (used to suggest the next week).
  const [allWeekStarts, setAllWeekStarts] = useState<Set<string>>(new Set());

  // Expandable per-week product editor.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, ProductRow[]>>({});
  const [savingProducts, setSavingProducts] = useState<Record<string, boolean>>({});

  // Add-week modal (only picks the week — metrics are entered per product afterwards).
  const [show, setShow] = useState(false);
  const [newWeekStart, setNewWeekStart] = useState('');
  const [newWeekNotes, setNewWeekNotes] = useState('');
  const [savingWeek, setSavingWeek] = useState(false);

  const monthRange = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = toISO(new Date(y, m - 1, 1));
    const last  = toISO(new Date(y, m, 0));
    return { first, last };
  }, [month]);

  /** Build the editable draft rows for a week: one per brand product + the "Other Products" row. */
  const buildDraft = (weekId: string, kids: ProductRow[], prods: BrandProduct[]): ProductRow[] => {
    const byProduct = new Map(kids.filter(c => !c.is_other && c.product_id).map(c => [c.product_id!, c]));
    const rows: ProductRow[] = prods.map(p => {
      const ex = byProduct.get(p.id);
      return ex
        ? { ...ex, ad_spend: n(ex.ad_spend), roi: n(ex.roi), orders: n(ex.orders), cpo: n(ex.cpo), gmv: n(ex.gmv) }
        : { weekly_id: weekId, product_id: p.id, is_other: false, ad_spend: 0, roi: 0, orders: 0, cpo: 0, gmv: 0 };
    });
    const other = kids.find(c => c.is_other);
    rows.push(other
      ? { ...other, ad_spend: n(other.ad_spend), roi: n(other.roi), orders: n(other.orders), cpo: n(other.cpo), gmv: n(other.gmv) }
      : { weekly_id: weekId, product_id: null, is_other: true, ad_spend: 0, roi: 0, orders: 0, cpo: 0, gmv: 0 });
    return rows;
  };

  const load = async () => {
    setLoading(true); setErr(null);
    // A week belongs to the month if its [start,end] range OVERLAPS the month —
    // so a week that spans a month boundary shows up in BOTH months.
    const [m, w, anchorRes, allW, prods] = await Promise.all([
      supabase.from('brand_gmv_max_monthly').select('*').eq('brand_id', brandId).eq('month', month).maybeSingle(),
      supabase.from('brand_gmv_max_weekly').select('*').eq('brand_id', brandId)
        .lte('week_start', monthRange.last).gte('week_end', monthRange.first)
        .order('week_start', { ascending: true }),
      supabase.from('brand_report_settings').select('weekly_anchor').eq('brand_id', brandId).maybeSingle(),
      supabase.from('brand_gmv_max_weekly').select('week_start').eq('brand_id', brandId),
      supabase.from('brand_products').select('*').eq('brand_id', brandId).order('name'),
    ]);
    if (m.error && !m.error.message?.includes('does not exist')) setErr(m.error.message);
    else if (m.error) setErr('Run schema_brand_detail.sql in Supabase to enable GMV Max.');
    else setMonthRow((m.data as MonthRow) ?? emptyMonth(brandId, month));
    const weekRows = ((w.data as WeekRow[]) ?? []);
    if (w.error && !err) setErr(w.error.message);
    else setWeeks(weekRows);
    setProducts((prods.data as BrandProduct[]) ?? []);
    setAnchor((anchorRes.data as any)?.weekly_anchor ?? null);
    setAllWeekStarts(new Set(((allW.data as any[]) ?? []).map(r =>
      typeof r.week_start === 'string' ? r.week_start.slice(0, 10) : r.week_start)));
    setEditBudget(false);

    // Product-level breakdown for the weeks in view.
    const ids = weekRows.map(r => r.id!).filter(Boolean);
    if (ids.length) {
      const ch = await supabase.from('brand_gmv_max_weekly_products').select('*').in('weekly_id', ids);
      const grouped: Record<string, ProductRow[]> = {};
      for (const row of (ch.data as ProductRow[]) ?? []) {
        (grouped[row.weekly_id] ??= []).push(row);
      }
      setChildrenByWeek(grouped);
    } else {
      setChildrenByWeek({});
    }
    setDrafts({});
    setExpanded(new Set());
    setLoading(false);
  };
  useEffect(() => { load(); }, [brandId, month]);

  const saveMonth = async () => {
    setSavingMonth(true); setErr(null);
    // spend_to_date is auto-calculated from the weekly entries.
    const spendToDate = weeks.reduce((s, w) => s + n(w.ad_spend), 0);
    const payload = {
      brand_id: brandId,
      month,
      allocated_budget: monthRow.allocated_budget,
      spend_to_date: spendToDate,
      target_roi: monthRow.target_roi,
    };
    const res = await supabase.from('brand_gmv_max_monthly')
      .upsert(payload, { onConflict: 'brand_id,month' }).select().single();
    setSavingMonth(false);
    if (res.error) { setErr(res.error.message); return; }
    setMonthRow(res.data as MonthRow);
    setEditBudget(false);
  };

  // Next GMV Max week aligned to the weekly-report cycle (anchor + 7n),
  // skipping weeks that already have an entry.
  const nextAnchoredWeek = (): string => {
    if (!anchor) return monthRange.first;
    let s = anchor;
    while (allWeekStarts.has(s)) s = addDays(s, 7);
    return s;
  };

  const openAddWeek = () => {
    setNewWeekStart(nextAnchoredWeek());
    setNewWeekNotes('');
    setErr(null); setShow(true);
  };
  const onWeekStartChange = (s: string) => {
    // GMV Max weeks must line up with the brand's weekly-report cycle so the
    // weekly report can later pull that week's GMV data. Warn on off-cycle dates.
    if (s && anchor && daysDiff(anchor, s) % 7 !== 0) {
      const ok = window.confirm(
        `GMV Max weeks should stay in sync with this brand's weekly report cycle ` +
        `(weeks starting from ${anchor}). Picking an off-cycle date breaks that ` +
        `alignment and the weekly report won't be able to pull this week's data.\n\n` +
        `Use this date anyway?`,
      );
      if (!ok) return;
    }
    setNewWeekStart(s);
  };

  // Create the week, then seed a product row for every brand product + one "Other Products" row.
  const submitWeek = async (e: FormEvent) => {
    e.preventDefault();
    if (!newWeekStart) return;
    setSavingWeek(true); setErr(null);
    const parent = await supabase.from('brand_gmv_max_weekly').insert({
      brand_id: brandId,
      week_start: newWeekStart,
      week_end: addDays(newWeekStart, 6),
      ad_spend: 0, roi: 0, orders: 0, cpo: 0, gmv: 0,
      notes: newWeekNotes,
    }).select().single();
    if (parent.error) { setSavingWeek(false); setErr(parent.error.message); return; }
    const weeklyId = (parent.data as WeekRow).id!;
    const seed = [
      ...products.map(p => ({ weekly_id: weeklyId, product_id: p.id, is_other: false })),
      { weekly_id: weeklyId, product_id: null, is_other: true },
    ];
    const kids = await supabase.from('brand_gmv_max_weekly_products').insert(seed);
    setSavingWeek(false);
    if (kids.error) { setErr(kids.error.message); return; }
    setShow(false);
    load();
  };

  const removeWeek = async (w: WeekRow) => {
    if (!w.id) return;
    if (!confirm(`Delete weekly entry for ${formatRange(w.week_start, w.week_end)}? This removes its product breakdown too.`)) return;
    const prev = weeks;
    setWeeks(weeks.filter(x => x.id !== w.id));
    const { error } = await supabase.from('brand_gmv_max_weekly').delete().eq('id', w.id);
    if (error) { alert(error.message); setWeeks(prev); }
  };

  const toggleExpand = (w: WeekRow) => {
    const id = w.id!;
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      next.add(id);
      setDrafts(d => (d[id] ? d : { ...d, [id]: buildDraft(id, childrenByWeek[id] ?? [], products) }));
      return next;
    });
  };

  const updateDraft = (weekId: string, idx: number, patch: Partial<ProductRow>) => {
    setDrafts(d => {
      const arr = [...(d[weekId] ?? [])];
      arr[idx] = { ...arr[idx], ...patch };
      return { ...d, [weekId]: arr };
    });
  };

  // Persist the product rows for a week, then refresh that week's parent totals + children.
  const saveProducts = async (weekId: string) => {
    const draft = drafts[weekId] ?? [];
    setSavingProducts(s => ({ ...s, [weekId]: true }));
    setErr(null);
    const ops = draft.map(r => {
      const payload = {
        weekly_id: weekId,
        product_id: r.is_other ? null : r.product_id,
        is_other: r.is_other,
        ad_spend: r.ad_spend, roi: r.roi, orders: r.orders, cpo: r.cpo, gmv: r.gmv,
      };
      return r.id
        ? supabase.from('brand_gmv_max_weekly_products').update(payload).eq('id', r.id)
        : supabase.from('brand_gmv_max_weekly_products').insert(payload);
    });
    const results = await Promise.all(ops);
    const firstErr = results.find(res => res.error);
    if (firstErr?.error) {
      setSavingProducts(s => ({ ...s, [weekId]: false }));
      setErr(firstErr.error.message);
      return;
    }
    // Reload just this week (the DB trigger has recomputed the parent totals).
    const [pr, ch] = await Promise.all([
      supabase.from('brand_gmv_max_weekly').select('*').eq('id', weekId).maybeSingle(),
      supabase.from('brand_gmv_max_weekly_products').select('*').eq('weekly_id', weekId),
    ]);
    setSavingProducts(s => ({ ...s, [weekId]: false }));
    if (pr.data) setWeeks(ws => ws.map(w => (w.id === weekId ? (pr.data as WeekRow) : w)));
    const kids = (ch.data as ProductRow[]) ?? [];
    setChildrenByWeek(m => ({ ...m, [weekId]: kids }));
    setDrafts(d => ({ ...d, [weekId]: buildDraft(weekId, kids, products) }));
  };

  const totalSpend = weeks.reduce((s, w) => s + n(w.ad_spend), 0);
  const totalGmv   = weeks.reduce((s, w) => s + n(w.gmv), 0);
  const remaining  = (monthRow.allocated_budget ?? 0) - totalSpend;
  // Achieved blended ROI for the month = total GMV / total ad spend.
  const targetRoi   = n(monthRow.target_roi);
  const achievedRoi = totalSpend > 0 ? totalGmv / totalSpend : 0;
  // How much of the ROI goal is met (null = no goal set).
  const roiPct = targetRoi > 0 ? (achievedRoi / targetRoi) * 100 : null;
  const roiMet = roiPct != null && roiPct >= 100;
  // Allocated budget is read-only once the month row is saved, until Update.
  const budgetLocked = !!monthRow.id && !editBudget;
  // Period covered by the spend — first week start to last week end.
  const spendPeriod = weeks.length
    ? formatRange(weeks[0].week_start, weeks[weeks.length - 1].week_end)
    : null;

  const colCount = 9 + (canEdit ? 1 : 0);

  const productLabel = (r: ProductRow): { name: string; pid: string } => {
    if (r.is_other) return { name: 'Other Products', pid: '' };
    const p = products.find(pp => pp.id === r.product_id);
    return { name: p?.name ?? 'Unknown product', pid: p?.external_product_id ?? '' };
  };

  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-3 align-items-start">
            <Col md={3}>
              <Form.Label className="fw-bold d-block">Month</Form.Label>
              <div className="btn-group w-100" role="group" aria-label="Choose month">
                {recentMonths(3).map(m => (
                  <Button
                    key={m}
                    variant={m === month ? 'primary' : 'outline-secondary'}
                    onClick={() => setMonth(m)}
                  >
                    {new Date(Number(m.split('-')[0]), Number(m.split('-')[1]) - 1, 1)
                      .toLocaleString('en-US', { month: 'short', year: '2-digit' })}
                  </Button>
                ))}
              </div>
            </Col>
            <Col md={2}>
              <Form.Label className="fw-bold">Allocated budget ({sym})</Form.Label>
              <NumberInput step="0.01" disabled={!canEdit || budgetLocked} value={monthRow.allocated_budget}
                onChange={n => setMonthRow({ ...monthRow, allocated_budget: n })} />
            </Col>
            <Col md={2}>
              <Form.Label className="fw-bold">Target ROI</Form.Label>
              <NumberInput step="0.01" disabled={!canEdit || budgetLocked} value={monthRow.target_roi}
                onChange={n => setMonthRow({ ...monthRow, target_roi: n })} />
              <Form.Text className="text-muted">Goal (e.g. 3.5).</Form.Text>
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold d-flex justify-content-between align-items-baseline">
                <span>Spend to date ({sym})</span>
                {spendPeriod && <small className="fw-normal text-muted">{spendPeriod}</small>}
              </Form.Label>
              <NumberInput step="0.01" disabled value={totalSpend} onChange={() => {}} />
              <Form.Text className="text-muted">Auto-calculated from weekly entries.</Form.Text>
            </Col>
            <Col md={2} className="d-flex flex-column">
              {/* spacer keeps the button level with the inputs above */}
              <div className="invisible d-none d-md-block" aria-hidden>
                <Form.Label className="fw-bold">&nbsp;</Form.Label>
              </div>
              {budgetLocked ? (
                <Button className="w-100" variant="outline-primary" disabled={!canEdit}
                  onClick={() => setEditBudget(true)}>
                  Update
                </Button>
              ) : (
                <Button className="w-100" disabled={!canEdit || savingMonth} onClick={saveMonth}>
                  {savingMonth ? 'Saving…' : 'Save budget & target'}
                </Button>
              )}
            </Col>
          </Row>
          <Row className="g-3 mt-1">
            <Col md={3}><MiniStat label="Allocated" value={`${sym}${monthRow.allocated_budget.toLocaleString()}`} /></Col>
            <Col md={3}><MiniStat label="Spend" value={`${sym}${totalSpend.toLocaleString()}`} /></Col>
            <Col md={3}><MiniStat label="Remaining" value={`${sym}${remaining.toLocaleString()}`} variant={remaining < 0 ? 'danger' : 'success'} /></Col>
            <Col md={3}><MiniStat label="GMV (sum of weeks)" value={`${sym}${totalGmv.toLocaleString()}`} /></Col>
          </Row>
          <Row className="g-3 mt-1">
            <Col md={12}>
              <RoiGoalTile target={targetRoi} achieved={achievedRoi} pct={roiPct} met={roiMet} />
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <span className="fw-semibold">Weekly entries</span>
            <small className="text-muted ms-2">
              Weeks within {month}. Expand a week to edit its per-product breakdown; totals auto-calculate.
            </small>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openAddWeek}>
              <i className="bi bi-plus-lg me-1" /> Add weekly entry
            </Button>
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
            : err ? <div className="p-3"><Alert variant="danger">{err}</Alert></div>
            : weeks.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">No weekly entries for this month.</p>
            ) : (
              <Table size="sm" responsive className="align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Week start</th>
                    <th>Period</th>
                    <th className="text-end">Ad Spend</th>
                    <th className="text-end">ROI</th>
                    <th className="text-end">Orders</th>
                    <th className="text-end">CPO</th>
                    <th className="text-end">GMV</th>
                    <th>Notes</th>
                    {canEdit && <th style={{ width: 60 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map(w => {
                    const open = expanded.has(w.id!);
                    const draft = drafts[w.id!] ?? [];
                    return (
                      <Fragment key={w.id ?? w.week_start}>
                        <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(w)}>
                          <td className="text-center text-muted">
                            <i className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`} />
                          </td>
                          <td className="fw-semibold">{w.week_start}</td>
                          <td><small className="text-muted">{formatRange(w.week_start, w.week_end)}</small></td>
                          <td className="text-end">{sym}{n(w.ad_spend).toLocaleString()}</td>
                          <td className="text-end">{n(w.roi).toFixed(2)}</td>
                          <td className="text-end">{n(w.orders).toLocaleString()}</td>
                          <td className="text-end">{sym}{n(w.cpo).toLocaleString()}</td>
                          <td className="text-end">{sym}{n(w.gmv).toLocaleString()}</td>
                          <td className="small text-muted">{w.notes}</td>
                          {canEdit && (
                            <td className="text-end" onClick={e => e.stopPropagation()}>
                              <Button size="sm" variant="outline-danger" onClick={() => removeWeek(w)}>
                                <i className="bi bi-trash" />
                              </Button>
                            </td>
                          )}
                        </tr>
                        {open && (
                          <tr key={`${w.id}-detail`}>
                            <td colSpan={colCount} className="p-0" style={{ background: 'var(--ac-surface-strong)' }}>
                              <div className="p-3">
                                <div className="fw-semibold small text-uppercase text-muted mb-2" style={{ letterSpacing: '.4px' }}>
                                  Product breakdown · {formatRange(w.week_start, w.week_end)}
                                </div>
                                <Table size="sm" responsive className="align-middle mb-2 bg-white">
                                  <thead>
                                    <tr>
                                      <th>Product</th>
                                      <th style={{ width: 160 }}>Product ID</th>
                                      <th className="text-end" style={{ width: 130 }}>Ad Spend</th>
                                      <th className="text-end" style={{ width: 110 }}>ROI</th>
                                      <th className="text-end" style={{ width: 110 }}>Orders</th>
                                      <th className="text-end" style={{ width: 110 }}>CPO</th>
                                      <th className="text-end" style={{ width: 130 }}>GMV</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {draft.map((r, idx) => {
                                      const { name, pid } = productLabel(r);
                                      return (
                                        <tr key={r.id ?? (r.is_other ? 'other' : r.product_id) ?? idx}>
                                          <td className={`fw-semibold ${r.is_other ? 'fst-italic text-muted' : ''}`}>{name}</td>
                                          <td className="text-muted small" style={{ fontFamily: 'monospace' }}>{pid || '—'}</td>
                                          <td><NumberInput step="0.01" disabled={!canEdit} value={r.ad_spend} onChange={v => updateDraft(w.id!, idx, { ad_spend: v })} /></td>
                                          <td><NumberInput step="0.01" disabled={!canEdit} value={r.roi} onChange={v => updateDraft(w.id!, idx, { roi: v })} /></td>
                                          <td><NumberInput disabled={!canEdit} value={r.orders} onChange={v => updateDraft(w.id!, idx, { orders: v })} /></td>
                                          <td><NumberInput step="0.01" disabled={!canEdit} value={r.cpo} onChange={v => updateDraft(w.id!, idx, { cpo: v })} /></td>
                                          <td><NumberInput step="0.01" disabled={!canEdit} value={r.gmv} onChange={v => updateDraft(w.id!, idx, { gmv: v })} /></td>
                                        </tr>
                                      );
                                    })}
                                    <tr className="fw-semibold">
                                      <td colSpan={2} className="text-end">Week total</td>
                                      <td className="text-end">{sym}{draft.reduce((s, r) => s + n(r.ad_spend), 0).toLocaleString()}</td>
                                      <td className="text-end">{(() => { const sp = draft.reduce((s, r) => s + n(r.ad_spend), 0); const g = draft.reduce((s, r) => s + n(r.gmv), 0); return sp > 0 ? (g / sp).toFixed(2) : '0.00'; })()}</td>
                                      <td className="text-end">{draft.reduce((s, r) => s + n(r.orders), 0).toLocaleString()}</td>
                                      <td className="text-end">{(() => { const sp = draft.reduce((s, r) => s + n(r.ad_spend), 0); const o = draft.reduce((s, r) => s + n(r.orders), 0); return o > 0 ? `${sym}${(sp / o).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : `${sym}0`; })()}</td>
                                      <td className="text-end">{sym}{draft.reduce((s, r) => s + n(r.gmv), 0).toLocaleString()}</td>
                                    </tr>
                                  </tbody>
                                </Table>
                                {canEdit && (
                                  <div className="d-flex justify-content-end">
                                    <Button size="sm" disabled={!!savingProducts[w.id!]} onClick={() => saveProducts(w.id!)}>
                                      {savingProducts[w.id!] ? 'Saving…' : 'Save product breakdown'}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
            )}
        </Card.Body>
      </Card>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submitWeek}>
          <Modal.Header closeButton>
            <Modal.Title>Add weekly GMV Max entry</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Row className="g-3">
              <Col md={12}>
                <Form.Label className="fw-bold">Week start</Form.Label>
                <Form.Control type="date" required
                  value={newWeekStart} onChange={e => onWeekStartChange(e.target.value)} />
                <Form.Text className="text-muted">
                  {newWeekStart ? `Covers ${formatRange(newWeekStart, addDays(newWeekStart, 6))}` : '7-day window starts here.'}
                </Form.Text>
              </Col>
              <Col md={12}>
                <Form.Label className="fw-bold">Notes</Form.Label>
                <Form.Control as="textarea" rows={2}
                  value={newWeekNotes} onChange={e => setNewWeekNotes(e.target.value)} />
              </Col>
            </Row>
            <p className="text-muted small mb-0 mt-3">
              A row for every brand product{products.length ? ` (${products.length})` : ''} plus an “Other Products”
              row will be created. Fill in each product’s Ad Spend, ROI, Orders, CPO and GMV by expanding the week —
              the weekly totals calculate automatically.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={savingWeek}>Cancel</Button>
            <Button type="submit" disabled={savingWeek || !newWeekStart}>
              {savingWeek ? 'Creating…' : 'Add week'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}

function MiniStat({ label, value, variant }: { label: string; value: string; variant?: 'success' | 'danger' }) {
  return (
    <div className="p-3 rounded h-100" style={{ background: 'var(--ac-surface-strong)', border: '1px solid var(--ac-border)' }}>
      <div className="text-muted fw-bold text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.8rem' }}>{label}</div>
      <div className={`fs-5 fw-semibold mt-1 ${variant === 'danger' ? 'text-danger' : variant === 'success' ? 'text-success' : ''}`}>{value}</div>
    </div>
  );
}

/** ROI goal vs achieved, with a progress bar showing how much of the target is met. */
function RoiGoalTile({ target, achieved, pct, met }: { target: number; achieved: number; pct: number | null; met: boolean }) {
  const barPct = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="p-3 rounded h-100" style={{ background: 'var(--ac-surface-strong)', border: '1px solid var(--ac-border)' }}>
      <div className="d-flex justify-content-between align-items-baseline mb-1">
        <span className="text-muted fw-bold text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.8rem' }}>ROI goal</span>
        {pct != null && (
          <span className={`fw-semibold ${met ? 'text-success' : 'text-danger'}`}>
            {pct.toFixed(0)}% of target
          </span>
        )}
      </div>
      <div className="d-flex align-items-baseline gap-2 flex-wrap">
        <span className={`fs-4 fw-semibold ${pct == null ? '' : met ? 'text-success' : 'text-danger'}`}>{achieved.toFixed(2)}</span>
        <span className="text-muted">achieved</span>
        <span className="text-muted ms-auto">Target {target > 0 ? target.toFixed(2) : '—'}</span>
      </div>
      <div className="progress mt-2" style={{ height: 8 }}>
        <div className={`progress-bar ${met ? 'bg-success' : 'bg-warning'}`} role="progressbar"
          style={{ width: `${barPct}%` }} aria-valuenow={barPct} aria-valuemin={0} aria-valuemax={100} />
      </div>
      {target <= 0 && (
        <div className="text-muted small mt-2">Set a Target ROI above to track attainment. Achieved = total GMV ÷ total ad spend.</div>
      )}
    </div>
  );
}
