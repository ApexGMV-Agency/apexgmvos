import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Card, Form, Button, Row, Col, Table, Modal, Spinner, Alert, Badge } from 'react-bootstrap';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend, LabelList,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { toISO } from '../../lib/dates';
import { currencySymbol } from '../../lib/currency';
import NumberInput from '../../components/NumberInput';

export interface SampleProduct {
  id: string;
  brand_id: string;
  external_product_id: string | null;
  name: string;
  monthly_goal: number | null; // legacy single global goal — superseded by monthly_goals
  monthly_goals: Record<string, number> | null; // 'YYYY-MM' -> goal for that month
  sort_order: number;
}
export interface DailyEntry {
  id?: string;
  brand_id: string;
  entry_date: string;
  new_videos: number | null;
  live_sessions: number | null;
  daily_sps: number | null;
  reason_of_drop: string | null;
  others_count: number;
  product_counts: Record<string, number>;
  dump_usernames: string | null;
}
interface WeeklyGmv {
  brand_id: string;
  month: string;
  week_index: number;
  affiliate_gmv: number | null;
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function monthLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}
export function daysInMonth(yyyymm: string): string[] {
  const [y, m] = yyyymm.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) out.push(toISO(new Date(y, m - 1, d)));
  return out;
}
function weekIndexFor(dayOfMonth: number): number {
  return Math.min(5, Math.floor((dayOfMonth - 1) / 7) + 1);
}
function weekRangeLabel(yyyymm: string, idx: number): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const start = (idx - 1) * 7 + 1;
  const end = Math.min(idx * 7, last);
  if (start > last) return '';
  const monthName = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
  return `${monthName} ${start}–${end}`;
}
function prevMonthOf(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function recentMonths(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
export function isWeekend(iso: string): boolean {
  const wd = new Date(iso + 'T00:00:00').getDay();
  return wd === 0 || wd === 6;
}
export const sumValues = (m: Record<string, number>) =>
  Object.values(m).reduce((s, v) => s + (v ?? 0), 0);

// Product goal for a specific month only — never falls back to the legacy
// global monthly_goal (that fallback is what made one month's goal show in
// every other month; the migration backfilled it into monthly_goals).
export function productGoalFor(p: SampleProduct, month: string): number | null {
  const v = p.monthly_goals?.[month];
  return typeof v === 'number' && v > 0 ? v : null;
}

const SECTION_HEADING_STYLE: React.CSSProperties = { textTransform: 'none', letterSpacing: 0 };

export default function BrandSamplesTab({ brandId, canEdit, currency }: { brandId: string; canEdit: boolean; currency?: string | null }) {
  const sym = currencySymbol(currency); // brand region money symbol ($/£/€)
  const [month, setMonth] = useState<string>(currentMonth());
  const [products, setProducts] = useState<SampleProduct[]>([]);
  const [periodGoal, setPeriodGoal] = useState<number>(0);
  const [hasGoalRow, setHasGoalRow] = useState(false);
  const [goalEditing, setGoalEditing] = useState(false);
  const [days, setDays] = useState<DailyEntry[]>([]);
  const [prevDays, setPrevDays] = useState<DailyEntry[]>([]);
  const [weekly, setWeekly] = useState<WeeklyGmv[]>([]);
  const [editingWeeks, setEditingWeeks] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);

  const allDates = useMemo(() => daysInMonth(month), [month]);
  const weekIndices = useMemo(() => {
    const last = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0).getDate();
    return Array.from({ length: Math.ceil(last / 7) }, (_, i) => i + 1);
  }, [month]);

  const dayByDate = useMemo(() => {
    const m = new Map<string, DailyEntry>();
    for (const d of days) m.set(d.entry_date, d);
    return m;
  }, [days]);

  // Stats
  const totalApproved = useMemo(() =>
    days.reduce((s, d) => s + sumValues(d.product_counts) + (d.others_count ?? 0), 0),
  [days]);
  const totalNewVideos = useMemo(() =>
    days.reduce((s, d) => s + (d.new_videos ?? 0), 0),
  [days]);
  const totalLiveSessions = useMemo(() =>
    days.reduce((s, d) => s + (d.live_sessions ?? 0), 0),
  [days]);
  const avgSps = useMemo(() => {
    const xs = days.filter(d => !isWeekend(d.entry_date)).map(d => d.daily_sps).filter((n): n is number => n != null);
    if (xs.length === 0) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }, [days]);
  const daysWithEntry = useMemo(() =>
    days.filter(d => d.id || sumValues(d.product_counts) > 0 || d.others_count > 0 || d.new_videos != null).length,
  [days]);

  // Per-product totals this month
  const perProductTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const d of days) {
      for (const [pid, c] of Object.entries(d.product_counts)) {
        totals[pid] = (totals[pid] ?? 0) + (c ?? 0);
      }
    }
    return totals;
  }, [days]);

  const dailyChartData = useMemo(() =>
    allDates.map(date => {
      const d = dayByDate.get(date);
      const total = d ? sumValues(d.product_counts) + (d.others_count ?? 0) : 0;
      return { label: date.slice(8), Approved: total, weekend: isWeekend(date) };
    }),
  [allDates, dayByDate]);

  const prevMonthYyyymm = useMemo(() => prevMonthOf(month), [month]);
  const prevAllDates = useMemo(() => daysInMonth(prevMonthYyyymm), [prevMonthYyyymm]);
  const prevDayByDate = useMemo(() => {
    const m = new Map<string, DailyEntry>();
    for (const d of prevDays) m.set(d.entry_date, d);
    return m;
  }, [prevDays]);
  const prevDailyChartData = useMemo(() =>
    prevAllDates.map(date => {
      const d = prevDayByDate.get(date);
      const total = d ? sumValues(d.product_counts) + (d.others_count ?? 0) : 0;
      return { label: date.slice(8), Approved: total };
    }),
  [prevAllDates, prevDayByDate]);
  const prevTotalApproved = useMemo(() =>
    prevDays.reduce((s, d) => s + sumValues(d.product_counts) + (d.others_count ?? 0), 0),
  [prevDays]);

  const weeklyChartData = useMemo(() => {
    return weekIndices.map(idx => {
      const range = weekRangeLabel(month, idx);
      const start = (idx - 1) * 7 + 1;
      const end = idx * 7;
      let approved = 0;
      for (const d of days) {
        const day = Number(d.entry_date.slice(8));
        if (day >= start && day <= end) {
          approved += sumValues(d.product_counts) + (d.others_count ?? 0);
        }
      }
      return { label: range.replace(/^[A-Z][a-z]+ /, ''), Approved: approved };
    }).filter(r => r.label);
  }, [weekIndices, days, month]);

  const productChartData = useMemo(() =>
    products.map(p => ({
      name: p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name,
      Approved: perProductTotals[p.id] ?? 0,
      Goal: productGoalFor(p, month) ?? 0,
    })),
  [products, perProductTotals, month]);

  const dropReasons = useMemo(() =>
    days
      .filter(d => d.reason_of_drop && d.reason_of_drop.trim().length > 0)
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
  [days]);

  // Load
  const load = async () => {
    setLoading(true); setErr(null);
    const monthFirst = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const monthLast = toISO(new Date(y, m, 0));
    const prevYyyymm = prevMonthOf(month);
    const [py, pm] = prevYyyymm.split('-').map(Number);
    const prevFirst = `${prevYyyymm}-01`;
    const prevLast = toISO(new Date(py, pm, 0));
    const [pRes, gRes, dRes, wRes, prevRes] = await Promise.all([
      supabase.from('brand_samples_products').select('*').eq('brand_id', brandId).order('sort_order').order('created_at'),
      supabase.from('brand_samples_periods').select('*').eq('brand_id', brandId).eq('month', month).maybeSingle(),
      supabase.from('brand_samples_daily').select('*').eq('brand_id', brandId)
        .gte('entry_date', monthFirst).lte('entry_date', monthLast).order('entry_date'),
      supabase.from('brand_samples_weekly_gmv').select('*').eq('brand_id', brandId).eq('month', month),
      supabase.from('brand_samples_daily').select('*').eq('brand_id', brandId)
        .gte('entry_date', prevFirst).lte('entry_date', prevLast).order('entry_date'),
    ]);
    if (pRes.error) { setErr(pRes.error.message); setLoading(false); return; }
    if (gRes.error && !gRes.error.message?.includes('No rows')) {
      setErr(gRes.error.message); setLoading(false); return;
    }
    if (dRes.error) { setErr(dRes.error.message); setLoading(false); return; }
    if (wRes.error) { setErr(wRes.error.message); setLoading(false); return; }
    if (prevRes.error) { setErr(prevRes.error.message); setLoading(false); return; }

    setProducts((pRes.data ?? []) as SampleProduct[]);
    setPrevDays(((prevRes.data ?? []) as any[]).map(r => ({
      ...r,
      product_counts: r.product_counts ?? {},
      dump_usernames: r.dump_usernames ?? null,
    })) as DailyEntry[]);
    const goalRow = gRes.data as any;
    setPeriodGoal(goalRow?.total_goal ?? 0);
    setHasGoalRow(!!goalRow);
    setGoalEditing(!goalRow);
    setDays(((dRes.data ?? []) as any[]).map(r => ({
      ...r,
      product_counts: r.product_counts ?? {},
      dump_usernames: r.dump_usernames ?? null,
      live_sessions: r.live_sessions ?? null,
    })) as DailyEntry[]);
    setWeekly((wRes.data ?? []) as WeeklyGmv[]);
    setEditingWeeks(new Set());
    setLoading(false);
  };

  useEffect(() => { load(); }, [brandId, month]);

  // Save monthly goal
  const saveGoal = async () => {
    setSavingGoal(true); setErr(null);
    const { error } = await supabase.from('brand_samples_periods')
      .upsert({ brand_id: brandId, month, total_goal: periodGoal }, { onConflict: 'brand_id,month' });
    setSavingGoal(false);
    if (error) { setErr(error.message); return; }
    setHasGoalRow(true);
    setGoalEditing(false);
  };

  // Products manager
  const [productModal, setProductModal] = useState(false);
  // monthly_goal on the draft doubles as "goal for the currently selected
  // month" while the modal is open; it's written to monthly_goals[month].
  const emptyProduct = (): SampleProduct => ({
    id: '', brand_id: brandId, external_product_id: '', name: '', monthly_goal: null, monthly_goals: {}, sort_order: 0,
  });
  const [productDraft, setProductDraft] = useState<SampleProduct>(emptyProduct());
  const [productEditing, setProductEditing] = useState<SampleProduct | null>(null);

  const openAddProduct = () => { setProductEditing(null); setProductDraft(emptyProduct()); setProductModal(true); };
  const openEditProduct = (p: SampleProduct) => {
    setProductEditing(p);
    setProductDraft({ ...p, monthly_goal: productGoalFor(p, month) });
    setProductModal(true);
  };
  const submitProduct = async (e: FormEvent) => {
    e.preventDefault();
    // Merge this month's goal into the per-month map; other months untouched.
    const goals: Record<string, number> = { ...(productEditing?.monthly_goals ?? {}) };
    if (productDraft.monthly_goal != null && productDraft.monthly_goal > 0) goals[month] = productDraft.monthly_goal;
    else delete goals[month];
    const payload: any = {
      brand_id: brandId,
      external_product_id: productDraft.external_product_id?.trim() || null,
      name: productDraft.name.trim(),
      monthly_goals: goals,
    };
    const res = productEditing
      ? await supabase.from('brand_samples_products').update(payload).eq('id', productEditing.id)
      : await supabase.from('brand_samples_products').insert(payload);
    if (res.error) { setErr(res.error.message); return; }
    setProductModal(false);
    load();
  };
  const removeProduct = async (p: SampleProduct) => {
    if (!confirm(`Remove "${p.name}" from tracked products? Historical daily counts for this product will remain in past entries.`)) return;
    const { error } = await supabase.from('brand_samples_products').delete().eq('id', p.id);
    if (error) { alert(error.message); return; }
    load();
  };

  // Daily entry editor
  const [dayModal, setDayModal] = useState(false);
  const [dayDraft, setDayDraft] = useState<DailyEntry | null>(null);
  const [usersModal, setUsersModal] = useState<DailyEntry | null>(null);
  const openEditDay = (date: string) => {
    const existing = dayByDate.get(date);
    setDayDraft(existing
      ? { ...existing, product_counts: { ...existing.product_counts } }
      : {
          brand_id: brandId, entry_date: date,
          new_videos: null, live_sessions: null, daily_sps: null, reason_of_drop: '',
          others_count: 0, product_counts: {}, dump_usernames: null,
        });
    setDayModal(true);
  };
  const dayDraftTotal = dayDraft
    ? sumValues(dayDraft.product_counts) + (dayDraft.others_count ?? 0)
    : 0;
  const dayIsWeekend = dayDraft ? isWeekend(dayDraft.entry_date) : false;
  const submitDay = async (e: FormEvent) => {
    e.preventDefault();
    if (!dayDraft) return;
    const payload: any = {
      brand_id: brandId,
      entry_date: dayDraft.entry_date,
      new_videos: dayDraft.new_videos,
      // LIVE sessions are always kept (they can happen on weekends too), like new_videos
      live_sessions: dayDraft.live_sessions,
      // Weekend rows: only persist new_videos + live_sessions + reason_of_drop, force approvals to zero/null
      daily_sps: dayIsWeekend ? null : dayDraft.daily_sps,
      reason_of_drop: dayDraft.reason_of_drop?.trim() || null,
      others_count: dayIsWeekend ? 0 : (dayDraft.others_count ?? 0),
      product_counts: dayIsWeekend ? {} : (dayDraft.product_counts ?? {}),
      dump_usernames: dayIsWeekend ? null : (dayDraft.dump_usernames?.trim() || null),
    };
    const { error } = await supabase.from('brand_samples_daily')
      .upsert(payload, { onConflict: 'brand_id,entry_date' });
    if (error) { setErr(error.message); return; }
    setDayModal(false);
    load();
  };
  const deleteDay = async () => {
    if (!dayDraft?.id) { setDayModal(false); return; }
    if (!confirm(`Clear all entries for ${dayDraft.entry_date}?`)) return;
    const { error } = await supabase.from('brand_samples_daily').delete().eq('id', dayDraft.id);
    if (error) { alert(error.message); return; }
    setDayModal(false);
    load();
  };

  // Weekly GMV row-level save
  const saveWeeklyGmv = async (idx: number, val: number) => {
    const { error } = await supabase.from('brand_samples_weekly_gmv')
      .upsert({ brand_id: brandId, month, week_index: idx, affiliate_gmv: val },
              { onConflict: 'brand_id,month,week_index' });
    if (error) { alert(error.message); return; }
    setWeekly(prev => {
      const next = prev.filter(w => w.week_index !== idx);
      next.push({ brand_id: brandId, month, week_index: idx, affiliate_gmv: val });
      return next.sort((a, b) => a.week_index - b.week_index);
    });
    setEditingWeeks(prev => {
      const next = new Set(prev);
      next.delete(idx);
      return next;
    });
  };
  const toggleWeekEdit = (idx: number, on: boolean) => {
    setEditingWeeks(prev => {
      const next = new Set(prev);
      if (on) next.add(idx); else next.delete(idx);
      return next;
    });
  };

  const weeklyAvgSps = (idx: number): number | null => {
    const start = (idx - 1) * 7 + 1;
    const end = idx * 7;
    const xs = days
      .filter(d => {
        const day = Number(d.entry_date.slice(8));
        return day >= start && day <= end && !isWeekend(d.entry_date) && d.daily_sps != null;
      })
      .map(d => d.daily_sps as number);
    if (xs.length === 0) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };

  const goalPct = periodGoal > 0 ? Math.min(100, Math.round((totalApproved / periodGoal) * 100)) : 0;

  // CSV export modal
  const [csvModal, setCsvModal] = useState(false);
  const [csvFrom, setCsvFrom] = useState<string>(`${month}-01`);
  const [csvTo, setCsvTo] = useState<string>(toISO(new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0)));
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvErr, setCsvErr] = useState<string | null>(null);

  const downloadCsv = async () => {
    setCsvBusy(true); setCsvErr(null);
    try {
      const { data, error } = await supabase
        .from('brand_samples_daily')
        .select('entry_date, dump_usernames')
        .eq('brand_id', brandId)
        .gte('entry_date', csvFrom)
        .lte('entry_date', csvTo)
        .order('entry_date');
      if (error) throw error;
      const rows: string[] = ['Date,Username'];
      let count = 0;
      for (const r of (data ?? []) as { entry_date: string; dump_usernames: string | null }[]) {
        if (!r.dump_usernames) continue;
        const users = r.dump_usernames
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean);
        for (const u of users) {
          const safe = u.includes(',') || u.includes('"') ? `"${u.replace(/"/g, '""')}"` : u;
          rows.push(`${r.entry_date},${safe}`);
          count += 1;
        }
      }
      if (count === 0) {
        setCsvErr('No approved-creator usernames found in that range.');
        setCsvBusy(false);
        return;
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `approved-creators-${csvFrom}-to-${csvTo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setCsvBusy(false);
      setCsvModal(false);
    } catch (e: any) {
      setCsvErr(e?.message ?? 'Failed to export');
      setCsvBusy(false);
    }
  };

  return (
    <>
      {/* Header: month + monthly goal */}
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md={3}>
              <Form.Label className="small fw-semibold d-block">Month</Form.Label>
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
            <Col md={3}>
              <Form.Label className="small fw-semibold">Total monthly goal</Form.Label>
              <NumberInput
                disabled={!canEdit || !goalEditing}
                value={periodGoal}
                onChange={n => setPeriodGoal(n)}
                placeholder="e.g. 200"
              />
            </Col>
            <Col md={3} className="d-flex gap-2">
              {goalEditing ? (
                <>
                  <Button className="flex-grow-1" disabled={!canEdit || savingGoal} onClick={saveGoal}>
                    {savingGoal ? 'Saving…' : (hasGoalRow ? 'Update goal' : 'Save goal')}
                  </Button>
                  {hasGoalRow && (
                    <Button variant="outline-secondary" disabled={savingGoal}
                      onClick={() => { setGoalEditing(false); load(); }}>
                      Cancel
                    </Button>
                  )}
                </>
              ) : (
                <Button variant="outline-secondary" className="flex-grow-1"
                  disabled={!canEdit} onClick={() => setGoalEditing(true)}>
                  <i className="bi bi-pencil me-1" /> Edit goal
                </Button>
              )}
            </Col>
            <Col md={3} className="text-md-end">
              <div className="text-muted small">{monthLabel(month)}</div>
            </Col>
          </Row>

          {/* Beautiful, colorful KPI tiles */}
          <Row className="g-3 mt-1">
            <Col xl={4}>
              <GoalProgressTile approved={totalApproved} goal={periodGoal} pct={goalPct} />
            </Col>
            <Col md={6} xl={2}>
              <KpiTile icon="bi-camera-video" color="var(--ac-info)" label="New Videos" value={totalNewVideos.toLocaleString()} />
            </Col>
            <Col md={6} xl={2}>
              <KpiTile icon="bi-broadcast" color="#f472b6" label="LIVE" value={totalLiveSessions.toLocaleString()} />
            </Col>
            <Col md={6} xl={2}>
              <KpiTile icon="bi-graph-up" color="var(--ac-success)" label="Avg SPS" value={avgSps == null ? '—' : avgSps.toFixed(2)} />
            </Col>
            <Col md={6} xl={2}>
              <KpiTile icon="bi-calendar-check" color="#a78bfa" label="Days Entered" value={`${daysWithEntry} / ${allDates.length}`} />
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Tracked Products */}
      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold" style={SECTION_HEADING_STYLE}>Tracked Products</span>
          {canEdit && (
            <Button size="sm" onClick={openAddProduct}>
              <i className="bi bi-plus-lg me-1" /> Add Product
            </Button>
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
            : err ? <div className="p-3"><Alert variant="danger">{err}</Alert></div>
            : products.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">No products tracked yet.</p>
            ) : (
              <Table size="sm" responsive className="align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Product</th>
                    <th>Product ID</th>
                    <th className="text-end">Goal</th>
                    <th className="text-end">Approved</th>
                    <th style={{ minWidth: 200 }}>Progress</th>
                    {canEdit && <th style={{ width: 100 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, i) => {
                    const approved = perProductTotals[p.id] ?? 0;
                    const goal = productGoalFor(p, month) ?? 0;
                    const pct = goal > 0 ? Math.min(100, Math.round((approved / goal) * 100)) : null;
                    return (
                      <tr key={p.id}>
                        <td className="text-muted small">{i + 1}</td>
                        <td className="fw-semibold">{p.name}</td>
                        <td className="small text-muted" style={{ fontFamily: 'monospace' }}>
                          {p.external_product_id || '—'}
                        </td>
                        <td className="text-end">{goal > 0 ? goal : <span className="text-muted">—</span>}</td>
                        <td className="text-end">{approved}</td>
                        <td>
                          {pct == null
                            ? <span className="text-muted small">No goal</span>
                            : <ProductProgressBar pct={pct} approved={approved} goal={goal} />}
                        </td>
                        {canEdit && (
                          <td className="text-end">
                            <Button size="sm" variant="outline-primary" className="me-1" onClick={() => openEditProduct(p)}>
                              <i className="bi bi-pencil" />
                            </Button>
                            <Button size="sm" variant="outline-danger" onClick={() => removeProduct(p)}>
                              <i className="bi bi-trash" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
        </Card.Body>
      </Card>

      {/* Daily Entries */}
      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <span className="fw-semibold" style={SECTION_HEADING_STYLE}>Daily Entries</span>
            <small className="text-muted ms-2">Click any day to add or edit. Weekends only collect videos.</small>
          </div>
          <Button size="sm" variant="outline-secondary" onClick={() => setCsvModal(true)}>
            <i className="bi bi-download me-1" /> Export Approved Creators CSV
          </Button>
        </Card.Header>
        <Card.Body className="p-0">
          <Table size="sm" responsive hover className="align-middle mb-0">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-end">New videos</th>
                <th className="text-end">LIVE</th>
                <th className="text-end">Approved</th>
                <th className="text-end">SPS</th>
                <th>Reason of drop</th>
                <th>Top products</th>
                {canEdit && <th style={{ width: 110 }}></th>}
              </tr>
            </thead>
            <tbody>
              {allDates.map(date => {
                const d = dayByDate.get(date);
                const total = d ? sumValues(d.product_counts) + (d.others_count ?? 0) : 0;
                const top = d ? Object.entries(d.product_counts)
                  .filter(([, c]) => c > 0)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([pid, c]) => ({ name: products.find(p => p.id === pid)?.name ?? '?', c })) : [];
                const dayNum = Number(date.slice(8));
                const weekend = isWeekend(date);
                const hasUsers = !!(d?.dump_usernames && d.dump_usernames.trim().length > 0);
                return (
                  <tr key={date}
                      style={{
                        cursor: canEdit ? 'pointer' : 'default',
                        backgroundColor: weekend ? 'rgba(252, 98, 21, 0.05)' : undefined,
                      }}>
                    <td className="fw-semibold" onClick={() => canEdit && openEditDay(date)}>
                      {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}
                      <small className="text-muted ms-2">W{weekIndexFor(dayNum)}</small>
                      {weekend && <Badge bg="warning" text="dark" className="ms-2"><i className="bi bi-cup-hot me-1" />Weekend</Badge>}
                    </td>
                    <td className="text-end" onClick={() => canEdit && openEditDay(date)}>
                      {d?.new_videos ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="text-end" onClick={() => canEdit && openEditDay(date)}>
                      {d?.live_sessions ?? <span className="text-muted">—</span>}
                    </td>
                    {weekend ? (
                      <td colSpan={4} className="text-center text-muted fst-italic small"
                          style={{ backgroundColor: 'var(--ac-surface-hover)' }}
                          onClick={() => canEdit && openEditDay(date)}>
                        No approvals on weekends
                      </td>
                    ) : (
                      <>
                        <td className="text-end fw-semibold" onClick={() => canEdit && openEditDay(date)}>
                          {total > 0 ? total : <span className="text-muted fw-normal">—</span>}
                        </td>
                        <td className="text-end" onClick={() => canEdit && openEditDay(date)}>
                          {d?.daily_sps != null ? d.daily_sps.toFixed(1) : <span className="text-muted">—</span>}
                        </td>
                        <td className="small text-muted"
                            style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            onClick={() => canEdit && openEditDay(date)}>
                          {d?.reason_of_drop || ''}
                        </td>
                        <td className="small text-muted" onClick={() => canEdit && openEditDay(date)}>
                          {top.length === 0 ? '' : top.map(t => `${t.name}: ${t.c}`).join(', ')}
                          {d && d.others_count > 0 && (top.length > 0 ? `, Others: ${d.others_count}` : `Others: ${d.others_count}`)}
                        </td>
                      </>
                    )}
                    {canEdit && (
                      <td className="text-end">
                        {hasUsers && !weekend && (
                          <Button size="sm" variant="link" className="p-0 me-2 text-secondary"
                            onClick={(e) => { e.stopPropagation(); setUsersModal(d!); }}
                            title="View approved creator usernames">
                            <i className="bi bi-eye" />
                          </Button>
                        )}
                        <Button size="sm" variant="link" className="p-0 text-primary"
                          onClick={(e) => { e.stopPropagation(); openEditDay(date); }}
                          title="Edit">
                          <i className="bi bi-pencil" />
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {/* Weekly Summary + charts row */}
      <Row className="g-3 mb-3">
        <Col lg={5}>
          <Card className="h-100">
            <Card.Header><span className="fw-semibold" style={SECTION_HEADING_STYLE}>Weekly Summary</span></Card.Header>
            <Card.Body className="p-0">
              <Table size="sm" className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th className="text-end">Avg SPS</th>
                    <th>Affiliate GMV</th>
                    {canEdit && <th style={{ width: 70 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {weekIndices.map(idx => {
                    const range = weekRangeLabel(month, idx);
                    if (!range) return null;
                    const sps = weeklyAvgSps(idx);
                    const gmvRow = weekly.find(w => w.week_index === idx);
                    const hasValue = gmvRow?.affiliate_gmv != null;
                    const editingThis = editingWeeks.has(idx);
                    return (
                      <tr key={idx}>
                        <td className="fw-semibold">{range}</td>
                        <td className="text-end">{sps == null ? <span className="text-muted">—</span> : sps.toFixed(2)}</td>
                        <td style={{ minWidth: 180 }}>
                          {editingThis ? (
                            <WeeklyGmvEditor
                              initial={gmvRow?.affiliate_gmv ?? 0}
                              onSave={(v) => saveWeeklyGmv(idx, v)}
                              onCancel={() => toggleWeekEdit(idx, false)}
                            />
                          ) : (
                            hasValue
                              ? <span className="fw-semibold">{sym}{gmvRow!.affiliate_gmv!.toLocaleString()}</span>
                              : <span className="text-muted small fst-italic">Not set</span>
                          )}
                        </td>
                        {canEdit && (
                          <td className="text-end">
                            {!editingThis && (
                              <Button size="sm" variant="outline-secondary" onClick={() => toggleWeekEdit(idx, true)}>
                                <i className="bi bi-pencil" />
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={7}>
          <Card className="h-100">
            <Card.Header><span className="fw-semibold" style={SECTION_HEADING_STYLE}>Daily Approvals</span></Card.Header>
            <Card.Body style={{ height: 280 }}>
              <ResponsiveContainer>
                <AreaChart data={dailyChartData} margin={{ top: 10, right: 20, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="approvedAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor="var(--ac-accent-base)" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="var(--ac-accent-base)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--ac-border)" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--ac-border)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--ac-border)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ stroke: 'var(--ac-accent-base)', strokeWidth: 1, strokeOpacity: 0.3 }}
                    contentStyle={{ borderRadius: 8, border: '1px solid var(--ac-border)' }}
                  />
                  <Area
                    type="monotone" dataKey="Approved" stroke="var(--ac-accent-base)" strokeWidth={2.5}
                    fill="url(#approvedAreaGrad)" dot={{ r: 3, fill: 'var(--ac-accent-base)' }}
                    activeDot={{ r: 5, fill: 'var(--ac-text-primary)', stroke: 'var(--ac-accent-base)', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Weekly Approvals chart */}
      <Card className="mb-3">
        <Card.Header><span className="fw-semibold" style={SECTION_HEADING_STYLE}>Weekly Approvals</span></Card.Header>
        <Card.Body style={{ height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={weeklyChartData} margin={{ top: 20, right: 20, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id="weeklyBarGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"  stopColor="var(--ac-accent-base)" stopOpacity={1} />
                  <stop offset="100%" stopColor="var(--ac-accent-hover)" stopOpacity={0.8} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ac-border)" vertical={false} />
              <XAxis dataKey="label" stroke="var(--ac-border)" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--ac-border)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--ac-border)' }} />
              <Bar dataKey="Approved" fill="url(#weeklyBarGrad)" radius={[8, 8, 0, 0]} barSize={48}>
                <LabelList dataKey="Approved" position="top" fill="var(--ac-text-primary)" fontSize={12} fontWeight={600} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card.Body>
      </Card>

      {/* Previous month daily approvals (for comparison) */}
      <Card className="mb-3">
        <Card.Header className="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <span className="fw-semibold" style={SECTION_HEADING_STYLE}>
            Previous Month Daily Approvals
          </span>
          <span className="text-muted small">
            {monthLabel(prevMonthYyyymm)} · {prevTotalApproved.toLocaleString()} total approved
          </span>
        </Card.Header>
        <Card.Body style={{ height: 280 }}>
          {prevTotalApproved === 0 ? (
            <div className="d-flex align-items-center justify-content-center h-100 text-muted">
              <div className="text-center">
                <i className="bi bi-calendar-x fs-1 d-block mb-2 opacity-50" />
                No approvals recorded for {monthLabel(prevMonthYyyymm)}.
              </div>
            </div>
          ) : (
            <ResponsiveContainer>
              <AreaChart data={prevDailyChartData} margin={{ top: 10, right: 20, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="prevApprovedAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="var(--ac-text-secondary)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--ac-text-secondary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ac-border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--ac-border)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--ac-border)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: 'var(--ac-border)', strokeWidth: 1, strokeOpacity: 0.3 }}
                  contentStyle={{ borderRadius: 8, border: '1px solid var(--ac-border)' }}
                />
                <Area
                  type="monotone" dataKey="Approved" stroke="var(--ac-border)" strokeWidth={2.5}
                  fill="url(#prevApprovedAreaGrad)" dot={{ r: 3, fill: 'var(--ac-text-secondary)' }}
                  activeDot={{ r: 5, fill: 'var(--ac-text-primary)', stroke: 'var(--ac-border)', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card.Body>
      </Card>

      {productChartData.length > 0 && (
        <Card className="mb-3">
          <Card.Header><span className="fw-semibold" style={SECTION_HEADING_STYLE}>Per-Product Totals vs Goal</span></Card.Header>
          <Card.Body style={{ height: 340 }}>
            <ResponsiveContainer>
              <BarChart data={productChartData} margin={{ top: 20, right: 20, left: -8, bottom: 60 }}>
                <defs>
                  <linearGradient id="prodApprovedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="var(--ac-accent-base)" stopOpacity={1} />
                    <stop offset="100%" stopColor="var(--ac-accent-hover)" stopOpacity={0.7} />
                  </linearGradient>
                  <linearGradient id="prodGoalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="var(--ac-text-secondary)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="var(--ac-text-secondary)" stopOpacity={0.7} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--ac-border)" vertical={false} />
                <XAxis dataKey="name" interval={0} angle={-15} textAnchor="end" stroke="var(--ac-border)" fontSize={11} tickLine={false} />
                <YAxis stroke="var(--ac-border)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--ac-border)' }} />
                <Legend />
                <Bar dataKey="Approved" fill="url(#prodApprovedGrad)" radius={[8, 8, 0, 0]} barSize={28}>
                  <LabelList dataKey="Approved" position="top" fill="var(--ac-text-primary)" fontSize={11} fontWeight={600} />
                </Bar>
                <Bar dataKey="Goal" fill="url(#prodGoalGrad)" radius={[8, 8, 0, 0]} barSize={28}>
                  <LabelList dataKey="Goal" position="top" fill="var(--ac-text-primary)" fontSize={11} fontWeight={600} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card.Body>
        </Card>
      )}

      {dropReasons.length > 0 && (
        <Card className="mb-3">
          <Card.Header><span className="fw-semibold" style={SECTION_HEADING_STYLE}>Drop Reasons This Month</span></Card.Header>
          <Card.Body>
            <ul className="mb-0 small">
              {dropReasons.map(d => (
                <li key={d.entry_date}>
                  <strong>{new Date(d.entry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}:</strong>{' '}
                  {d.reason_of_drop}
                </li>
              ))}
            </ul>
          </Card.Body>
        </Card>
      )}

      {/* Product editor modal */}
      <Modal show={productModal} onHide={() => setProductModal(false)} centered>
        <Form onSubmit={submitProduct}>
          <Modal.Header closeButton>
            <Modal.Title>{productEditing ? 'Edit Product' : 'Add Product'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col md={12}>
                <Form.Label className="small fw-semibold">Product name *</Form.Label>
                <Form.Control required value={productDraft.name}
                  placeholder="e.g. Wireless Headphones"
                  onChange={e => setProductDraft({ ...productDraft, name: e.target.value })} />
              </Col>
              <Col md={12}>
                <Form.Label className="small fw-semibold">External product ID <span className="text-muted">(optional)</span></Form.Label>
                <Form.Control value={productDraft.external_product_id ?? ''}
                  onChange={e => setProductDraft({ ...productDraft, external_product_id: e.target.value })}
                  placeholder="e.g. 1729401883758137709"
                  style={{ fontFamily: 'monospace' }} />
              </Col>
              <Col md={12}>
                <Form.Label className="small fw-semibold">Goal for {monthLabel(month)} <span className="text-muted">(blank = no goal)</span></Form.Label>
                <NumberInput value={productDraft.monthly_goal ?? 0}
                  placeholder="e.g. 75"
                  onChange={n => setProductDraft({ ...productDraft, monthly_goal: n || null })} />
                <Form.Text className="text-muted">
                  Each month has its own goal — switch the month above to set goals for other months.
                </Form.Text>
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setProductModal(false)}>Cancel</Button>
            <Button type="submit" disabled={!productDraft.name.trim()}>
              {productEditing ? 'Save' : 'Add Product'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Daily entry modal */}
      <Modal show={dayModal} onHide={() => setDayModal(false)} centered size="lg" scrollable>
        {dayDraft && (
          <Form onSubmit={submitDay}>
            <Modal.Header closeButton>
              <Modal.Title className="d-flex align-items-center gap-2 flex-wrap">
                {new Date(dayDraft.entry_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                {dayIsWeekend && (
                  <Badge bg="warning" text="dark"><i className="bi bi-cup-hot me-1" />Weekend</Badge>
                )}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              {dayIsWeekend && (
                <Alert variant="warning" className="py-2 small">
                  <i className="bi bi-info-circle me-1" />
                  Sample approvals don't happen on weekends — only new-video counts are collected.
                </Alert>
              )}

              <Row className="g-3">
                <Col md={dayIsWeekend ? 6 : 3}>
                  <Form.Label className="small fw-semibold">New videos</Form.Label>
                  <NumberInput value={dayDraft.new_videos ?? 0}
                    placeholder="e.g. 8"
                    onChange={n => setDayDraft({ ...dayDraft, new_videos: n })} />
                </Col>
                <Col md={dayIsWeekend ? 6 : 3}>
                  <Form.Label className="small fw-semibold">LIVE sessions</Form.Label>
                  <NumberInput value={dayDraft.live_sessions ?? 0}
                    placeholder="e.g. 2"
                    onChange={n => setDayDraft({ ...dayDraft, live_sessions: n })} />
                </Col>
                {!dayIsWeekend && (
                  <>
                    <Col md={3}>
                      <Form.Label className="small fw-semibold">Daily SPS</Form.Label>
                      <NumberInput step="0.1" value={dayDraft.daily_sps ?? 0}
                        placeholder="e.g. 4.2"
                        onChange={n => setDayDraft({ ...dayDraft, daily_sps: n })} />
                    </Col>
                    <Col md={3}>
                      <Form.Label className="small fw-semibold">Total approved <small className="text-muted">(auto)</small></Form.Label>
                      <Form.Control disabled value={dayDraftTotal} />
                    </Col>
                  </>
                )}

                <Col md={12}>
                  <Form.Label className="small fw-semibold">Reason of drop <span className="text-muted">(optional)</span></Form.Label>
                  <Form.Control as="textarea" rows={2}
                    placeholder="e.g. Held off approvals — waiting for new product launch"
                    value={dayDraft.reason_of_drop ?? ''}
                    onChange={e => setDayDraft({ ...dayDraft, reason_of_drop: e.target.value })} />
                </Col>

                {!dayIsWeekend && (
                  <>
                    <Col md={12}>
                      <hr className="my-2" />
                      <div className="fw-semibold mb-2">Per-product approvals</div>
                      {products.length === 0 ? (
                        <Alert variant="info" className="mb-0 py-2">
                          Add tracked products above to record per-product breakdowns.
                        </Alert>
                      ) : (
                        <Row className="g-2">
                          {products.map(p => (
                            <Col md={12} key={p.id}>
                              <div className="d-flex align-items-center gap-2 ac-pp-row">
                                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                  <div className="small text-truncate" title={p.name}>{p.name}</div>
                                  {p.external_product_id && (
                                    <div className="text-muted text-truncate"
                                      style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}
                                      title={p.external_product_id}>
                                      {p.external_product_id}
                                    </div>
                                  )}
                                </div>
                                <div style={{ width: 110 }}>
                                  <NumberInput
                                    size="sm"
                                    placeholder="0"
                                    value={dayDraft.product_counts[p.id] ?? 0}
                                    onChange={n => setDayDraft({
                                      ...dayDraft,
                                      product_counts: { ...dayDraft.product_counts, [p.id]: n },
                                    })}
                                  />
                                </div>
                              </div>
                            </Col>
                          ))}
                          <Col md={12}>
                            <div className="d-flex align-items-center gap-2 ac-pp-row">
                              <div className="flex-grow-1 small fst-italic">Others</div>
                              <div style={{ width: 110 }}>
                                <NumberInput
                                  size="sm"
                                  placeholder="0"
                                  value={dayDraft.others_count ?? 0}
                                  onChange={n => setDayDraft({ ...dayDraft, others_count: n })}
                                />
                              </div>
                            </div>
                          </Col>
                        </Row>
                      )}
                    </Col>

                    <Col md={12}>
                      <hr className="my-2" />
                      <Form.Label className="small fw-semibold">Dump usernames</Form.Label>
                      <Form.Control as="textarea" rows={5}
                        value={dayDraft.dump_usernames ?? ''}
                        placeholder="Please paste the usernames of approved creators (one per line)
e.g.
@creator1
@creator2"
                        onChange={e => setDayDraft({ ...dayDraft, dump_usernames: e.target.value })} />
                      <Form.Text className="text-muted">
                        These usernames will be available in the CSV export and via the eye icon next to this day.
                      </Form.Text>
                    </Col>
                  </>
                )}
              </Row>
            </Modal.Body>
            <Modal.Footer className="d-flex justify-content-between">
              <div>
                {dayDraft.id && (
                  <Button variant="outline-danger" onClick={deleteDay}>
                    <i className="bi bi-trash me-1" /> Clear day
                  </Button>
                )}
              </div>
              <div className="d-flex gap-2">
                <Button variant="secondary" onClick={() => setDayModal(false)}>Cancel</Button>
                <Button type="submit">Save</Button>
              </div>
            </Modal.Footer>
          </Form>
        )}
      </Modal>

      {/* Approved creators usernames view modal */}
      <Modal show={!!usersModal} onHide={() => setUsersModal(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <i className="bi bi-people me-2" />
            Approved Creators — {usersModal && new Date(usersModal.entry_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {usersModal?.dump_usernames
            ? (
              <pre className="mb-0 p-3 rounded border bg-light" style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflowY: 'auto' }}>
                {usersModal.dump_usernames}
              </pre>
            )
            : <p className="text-muted mb-0">No usernames recorded.</p>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setUsersModal(null)}>Close</Button>
        </Modal.Footer>
      </Modal>

      {/* CSV export modal */}
      <Modal show={csvModal} onHide={() => setCsvModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Export Approved Creators</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {csvErr && <Alert variant="danger" className="py-2">{csvErr}</Alert>}
          <p className="text-muted small">
            Choose a date range. We'll export one row per username with the date it was approved.
          </p>
          <Row className="g-3">
            <Col md={6}>
              <Form.Label className="small fw-semibold">From</Form.Label>
              <Form.Control type="date" value={csvFrom} onChange={e => setCsvFrom(e.target.value)} />
            </Col>
            <Col md={6}>
              <Form.Label className="small fw-semibold">To</Form.Label>
              <Form.Control type="date" value={csvTo} onChange={e => setCsvTo(e.target.value)} />
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setCsvModal(false)} disabled={csvBusy}>Cancel</Button>
          <Button onClick={downloadCsv} disabled={csvBusy || !csvFrom || !csvTo || csvFrom > csvTo}>
            {csvBusy ? 'Preparing…' : (<><i className="bi bi-download me-1" /> Download CSV</>)}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

// =====================================================================
// Goal progress tile — large, gradient bar, percentage centered
// =====================================================================

export function GoalProgressTile({ approved, goal, pct }: { approved: number; goal: number; pct: number }) {
  const color = pct >= 100 ? '#34d399' : pct >= 75 ? '#fc6215' : pct >= 40 ? '#fb923c' : '#f87171';
  return (
    <div className="p-3 rounded h-100 position-relative" style={{
      background: 'linear-gradient(135deg, var(--ac-accent-soft) 0%, var(--ac-accent-soft) 100%)',
      border: '1px solid var(--ac-warning)',
    }}>
      <div className="d-flex align-items-center justify-content-between">
        <div>
          <div className="small fw-semibold text-muted">Goal Progress</div>
          <div className="d-flex align-items-baseline gap-2 mt-1">
            <span className="fw-bold" style={{ fontSize: '1.7rem', color: 'var(--ac-text-primary)' }}>{approved.toLocaleString()}</span>
            <span className="text-muted">/ {goal.toLocaleString() || '—'}</span>
          </div>
        </div>
        <div
          className="d-flex align-items-center justify-content-center rounded-circle text-white fw-bold"
          style={{
            width: 56, height: 56, fontSize: '1rem',
            background: `conic-gradient(${color} ${pct}%, rgba(0,0,0,0.06) ${pct}% 100%)`,
          }}
        >
          <div className="bg-white rounded-circle d-flex align-items-center justify-content-center"
            style={{ width: 44, height: 44, color }}>
            {pct}%
          </div>
        </div>
      </div>
      <div className="mt-3 position-relative" style={{ height: 14, borderRadius: 999, background: 'var(--ac-surface-hover)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: `linear-gradient(90deg, ${color} 0%, ${color}cc 100%)`,
          transition: 'width .4s ease',
        }} />
      </div>
    </div>
  );
}

// =====================================================================
// Generic colored KPI tile (icon + label + value)
// =====================================================================

export function KpiTile({ icon, color, label, value }: { icon: string; color: string; label: string; value: string }) {
  return (
    <div className="p-3 rounded h-100 d-flex align-items-center gap-3" style={{
      background: `linear-gradient(135deg, ${color}1a 0%, ${color}0d 100%)`,
      border: `1px solid ${color}33`,
    }}>
      <div
        className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
        style={{ width: 44, height: 44, backgroundColor: color }}
      >
        <i className={`bi ${icon}`} style={{ fontSize: '1.2rem' }} />
      </div>
      <div className="min-w-0">
        <div className="small fw-semibold text-muted text-truncate">{label}</div>
        <div className="fw-bold" style={{ fontSize: '1.15rem', color: 'var(--ac-text-primary)' }}>{value}</div>
      </div>
    </div>
  );
}

// =====================================================================
// Beautiful per-product progress bar (used in the products table)
// =====================================================================

export function ProductProgressBar({ pct, approved, goal }: { pct: number; approved: number; goal: number }) {
  const color = pct >= 100 ? '#34d399' : pct >= 75 ? '#fc6215' : pct >= 40 ? '#fb923c' : '#f87171';
  return (
    <div className="d-flex align-items-center gap-2">
      <div className="position-relative flex-grow-1"
        style={{ height: 14, borderRadius: 999, background: 'var(--ac-surface-hover)', overflow: 'hidden', minWidth: 120 }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: `linear-gradient(90deg, ${color} 0%, ${color}cc 100%)`,
          transition: 'width .3s ease',
        }} />
      </div>
      <span className="small fw-semibold" style={{ color, minWidth: 38, textAlign: 'right' }}>{pct}%</span>
      <span className="small text-muted" style={{ minWidth: 50 }}>{approved}/{goal}</span>
    </div>
  );
}

// =====================================================================
// Inline editor for the weekly Affiliate GMV column
// (own state so the user can type freely without firing the server)
// =====================================================================

function WeeklyGmvEditor({ initial, onSave, onCancel }: { initial: number; onSave: (v: number) => void; onCancel: () => void }) {
  const [val, setVal] = useState(initial);
  return (
    <div className="d-flex gap-1">
      <NumberInput size="sm" step="0.01" value={val} placeholder="e.g. 1250" onChange={setVal} />
      <Button size="sm" variant="primary" onClick={() => onSave(val)} title="Save">
        <i className="bi bi-check2" />
      </Button>
      <Button size="sm" variant="outline-secondary" onClick={onCancel} title="Cancel">
        <i className="bi bi-x" />
      </Button>
    </div>
  );
}
