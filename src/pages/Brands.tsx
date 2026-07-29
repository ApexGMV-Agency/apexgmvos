import { useEffect, useMemo, useRef, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Modal, Form, Spinner, Alert, Row, Col, InputGroup } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { REGIONS, regionToCurrency, currencyToRegion, Region } from '../lib/currency';
import { ScopeKey, SCOPE_OPTIONS, SCOPE_LABEL, SCOPE_ICON } from '../lib/brandScope';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import RegionChip from '../components/RegionChip';

interface Brand {
  id: string;
  name: string;
  client: string;
  client_id: string | null;
  scope: string[];
  client_status: ClientStatus;
  shop_code: string | null;
  notes: string | null;
  currency: string;
  region: string;
  created_at: string;
}
interface ClientLite { id: string; name: string; }
interface LeadLite { id: string; email: string; full_name: string | null; avatar_url?: string | null; }
interface ApcLite { id: string; email: string; full_name: string | null; team_lead_id: string | null; avatar_url?: string | null; }

type ClientStatus = 'onboarding' | 'in_progress' | 'paused' | 'closed';

const STATUS_ORDER: ClientStatus[] = ['onboarding', 'in_progress', 'paused', 'closed'];

const STATUS_LABEL: Record<ClientStatus, string> = {
  onboarding:  'Onboarding',
  in_progress: 'In Progress',
  paused:      'Temporarily Paused',
  closed:      'Closed',
};

const STATUS_META: Record<ClientStatus, { bg: string; color: string; icon: string }> = {
  onboarding:  { bg: 'rgba(37,99,235,.12)',   color: '#1d4ed8', icon: 'bi-rocket-takeoff-fill' },
  in_progress: { bg: 'rgba(16,185,129,.12)',  color: '#047857', icon: 'bi-check-circle-fill' },
  paused:      { bg: 'rgba(245,158,11,.16)',  color: '#b45309', icon: 'bi-pause-circle-fill' },
  closed:      { bg: 'rgba(110,110,128,.14)', color: '#475569', icon: 'bi-x-circle-fill' },
};

const empty = {
  name: '',
  client_id: '',
  scope: [] as ScopeKey[],
  client_status: 'in_progress' as ClientStatus,
  shop_code: '',
  notes: '',
  region: 'US' as Region,
  monthly_fee: 0,
  paid_current_month: false,
};

function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function monthLabel(date: Date) {
  return date.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export default function Brands() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const isApcEditor = profile?.role === 'apc' && !!profile?.can_edit_brands;
  const canEditAny = isBob || isApcEditor;

  const [brands, setBrands] = useState<Brand[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  // Team Leads + APCs and who currently owns each brand. Bob uses them for the
  // assignment sidebar + the Team Lead filter; every viewer gets the owner
  // chips on the cards (RLS scopes what each role can actually read).
  const [leads, setLeads] = useState<LeadLite[]>([]);
  const [apcs, setApcs] = useState<ApcLite[]>([]);
  const [brandLeadOwner, setBrandLeadOwner] = useState<Record<string, string>>({});
  const [brandApcOwner, setBrandApcOwner] = useState<Record<string, string>>({});
  const [assignLeadId, setAssignLeadId] = useState('');
  const [assignApcId, setAssignApcId] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ClientStatus>('in_progress');
  const [clientFilter, setClientFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState<ScopeKey | ''>('');
  // '' = all, 'none' = brands without a Team Lead, else a team_lead id.
  const [leadFilter, setLeadFilter] = useState('');

  const [show, setShow] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  // Brand monthly fees — Bob only. Lives in the Bob-only `brand_billing`
  // table; never on the APC-readable `brands` row.
  const [feeByBrand, setFeeByBrand] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    const [b, c] = await Promise.all([
      supabase.from('brands').select('*').order('name'),
      supabase.from('clients').select('id,name').order('name'),
    ]);
    if (b.error || c.error) setErr((b.error ?? c.error)!.message);
    else {
      const rows = (b.data as any[]).map(r => ({
        ...r,
        scope: Array.isArray(r.scope) ? r.scope : [],
        client_status: (r.client_status ?? 'in_progress') as ClientStatus,
        shop_code: r.shop_code ?? null,
        notes: r.notes ?? null,
      })) as Brand[];
      setBrands(rows);
      setClients((c.data as ClientLite[]) ?? []);
    }
    // Bob-only: fetch monthly fees from the locked-down billing table.
    if (isBob) {
      const { data: billing } = await supabase.from('brand_billing').select('brand_id,monthly_fee');
      const map: Record<string, number> = {};
      (billing ?? []).forEach((r: any) => { map[r.brand_id] = Number(r.monthly_fee ?? 0); });
      setFeeByBrand(map);
    }
    // Team Leads + APCs + current brand ownership — assignment sidebar +
    // Team Lead filter (Bob) and the owner avatars on every card. RLS scopes
    // each role to the rows it may read (e.g. an APC gets just their own lead).
    const [leadRes, apcRes, tlbRes, abRes] = await Promise.all([
      supabase.from('profiles').select('id,email,full_name,avatar_url').eq('role', 'team_lead').order('full_name'),
      supabase.from('profiles').select('id,email,full_name,team_lead_id,avatar_url').eq('role', 'apc').order('full_name'),
      supabase.from('team_lead_brands').select('team_lead_id,brand_id'),
      supabase.from('apc_brands').select('apc_id,brand_id'),
    ]);
    setLeads((leadRes.data as LeadLite[]) ?? []);
    setApcs((apcRes.data as ApcLite[]) ?? []);
    const leadOwn: Record<string, string> = {};
    (tlbRes.data ?? []).forEach((r: any) => { leadOwn[r.brand_id] = r.team_lead_id; });
    setBrandLeadOwner(leadOwn);
    const apcOwn: Record<string, string> = {};
    (abRes.data ?? []).forEach((r: any) => { apcOwn[r.brand_id] = r.apc_id; });
    setBrandApcOwner(apcOwn);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return brands.filter(b => {
      if (statusFilter !== 'all' && b.client_status !== statusFilter) return false;
      if (clientFilter && b.client_id !== clientFilter) return false;
      if (scopeFilter && !b.scope.includes(scopeFilter)) return false;
      if (leadFilter === 'none' && brandLeadOwner[b.id]) return false;
      if (leadFilter && leadFilter !== 'none' && brandLeadOwner[b.id] !== leadFilter) return false;
      if (q) {
        const hay = `${b.name} ${b.client ?? ''} ${b.shop_code ?? ''} ${b.scope.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [brands, search, statusFilter, clientFilter, scopeFilter, leadFilter, brandLeadOwner]);

  const counts = useMemo(() => {
    const c: Record<ClientStatus, number> = { onboarding: 0, in_progress: 0, paused: 0, closed: 0 };
    brands.forEach(b => { if (c[b.client_status] !== undefined) c[b.client_status]++; });
    return c;
  }, [brands]);

  // Bob sees the assignment sidebar on both create and edit.
  const showAssign = isBob;
  // Map: team lead id → display name (for the "all APCs" list sub-labels).
  const leadName = useMemo(() => {
    const m: Record<string, string> = {};
    leads.forEach(l => { m[l.id] = l.full_name || l.email; });
    return m;
  }, [leads]);
  // id → display name + photo for the owner chips on the brand cards.
  const personById = useMemo(() => {
    const m = new Map<string, { name: string; avatar: string | null }>();
    leads.forEach(l => m.set(l.id, { name: l.full_name || l.email, avatar: l.avatar_url ?? null }));
    apcs.forEach(a => m.set(a.id, { name: a.full_name || a.email, avatar: a.avatar_url ?? null }));
    return m;
  }, [leads, apcs]);
  // APCs on the currently-selected lead's team (control 2).
  const teamApcs = useMemo(
    () => (assignLeadId ? apcs.filter(a => a.team_lead_id === assignLeadId) : []),
    [apcs, assignLeadId],
  );

  // Control 1 — pick a Team Lead. Changing the lead clears the APC (team changed).
  const pickLead = (id: string) => { setAssignLeadId(id); setAssignApcId(''); };
  // Control 2 — pick an APC within the selected lead's team (keep the lead).
  const pickTeamApc = (id: string) => setAssignApcId(id);
  // Control 3 — pick any APC; auto-derive its Team Lead (or clear if teamless).
  const pickAnyApc = (id: string) => {
    if (!id) { setAssignApcId(''); return; }
    setAssignApcId(id);
    setAssignLeadId(apcs.find(a => a.id === id)?.team_lead_id ?? '');
  };
  const clearAssign = () => { setAssignLeadId(''); setAssignApcId(''); };

  const openAdd = () => {
    setEditId(null);
    setForm({ ...empty });
    clearAssign();
    setShow(true);
  };

  const openEdit = (b: Brand) => {
    setEditId(b.id);
    setForm({
      name: b.name,
      client_id: b.client_id ?? '',
      scope: (b.scope ?? []) as ScopeKey[],
      client_status: b.client_status,
      shop_code: b.shop_code ?? '',
      notes: b.notes ?? '',
      region: (b.region as Region) || currencyToRegion(b.currency),
      monthly_fee: isBob ? Number(feeByBrand[b.id] ?? 0) : 0,
      paid_current_month: false,
    });
    // Pre-fill the assignment from the brand's current owner.
    setAssignApcId(brandApcOwner[b.id] ?? '');
    setAssignLeadId(brandLeadOwner[b.id] ?? '');
    setShow(true);
  };

  const remove = async (b: Brand) => {
    if (!confirm(`Delete brand "${b.name}"?`)) return;
    const prev = brands;
    setBrands(brands.filter(x => x.id !== b.id));
    const { error } = await supabase.from('brands').delete().eq('id', b.id);
    if (error) { alert(error.message); setBrands(prev); }
  };

  const toggleScope = (k: ScopeKey) => {
    setForm(f => ({
      ...f,
      scope: f.scope.includes(k) ? f.scope.filter(x => x !== k) : [...f.scope, k],
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const clientName = clients.find(c => c.id === form.client_id)?.name ?? '';
    // NOTE: the brand row never carries the monthly fee — it lives in the
    // Bob-only `brand_billing` table so APCs can never read it.
    const payload = {
      name: form.name.trim(),
      client_id: form.client_id || null,
      client: clientName,
      scope: form.scope,
      client_status: form.client_status,
      shop_code: form.shop_code.trim() || null,
      notes: form.notes.trim() || null,
      // Region is the user's pick; currency is derived so every money formatter
      // (reports, paid collab, contracts) shows the right symbol for the region.
      region: form.region || 'US',
      currency: regionToCurrency(form.region),
    };
    const fee = Number.isFinite(form.monthly_fee) ? form.monthly_fee : 0;
    let brandId = editId;
    if (editId) {
      const { error } = await supabase.from('brands').update(payload).eq('id', editId);
      if (error) { setErr(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('brands').insert(payload).select('id').single();
      if (error) { setErr(error.message); setSaving(false); return; }
      brandId = (data as any)?.id ?? null;
    }
    // Bob only: persist the monthly fee into the locked-down billing table.
    if (isBob && brandId) {
      const { error: feeErr } = await supabase.from('brand_billing')
        .upsert({ brand_id: brandId, monthly_fee: fee }, { onConflict: 'brand_id' });
      if (feeErr) {
        setErr(`Brand saved, but the monthly fee could not be stored: ${feeErr.message}`);
        setSaving(false);
        load();
        return;
      }
    }
    // Bob only: set the brand's Team Lead / APC owner (create + edit). The RPC
    // reconciles one-brand→one-lead and one-brand→one-APC, cascades an APC's own
    // team lead, and notifies anyone newly given the brand.
    if (isBob && brandId) {
      const { error: aErr } = await supabase.rpc('set_brand_assignment', {
        p_brand: brandId,
        p_lead: assignLeadId || null,
        p_apc: assignApcId || null,
      });
      if (aErr) {
        setErr(`Brand saved, but the assignment could not be applied: ${aErr.message}`);
        setSaving(false);
        load();
        return;
      }
    }
    // If creating a brand and the client has already paid for the current
    // month, drop a brand_payments row so the Budget Manager picks it up.
    if (isBob && !editId && form.paid_current_month && brandId && fee > 0) {
      const { error: payErr } = await supabase.from('brand_payments').insert({
        brand_id: brandId,
        month: currentMonthIso(),
        amount: fee,
        notes: 'Marked paid at brand creation',
      });
      if (payErr) {
        // Brand was created — surface the error but don't roll back.
        setErr(`Brand saved, but payment record failed: ${payErr.message}`);
        setSaving(false);
        load();
        return;
      }
    }
    setSaving(false);
    setShow(false);
    load();
  };

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2 className="mb-0">Brands</h2>
          <button
            type="button"
            className={`ac-stat-pill is-tab ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
            title="Show all brands"
          >
            <span className="ac-stat-num" style={statusFilter === 'all' ? { color: '#fff' } : undefined}>{brands.length}</span>
            <span className="ac-stat-label">brand{brands.length === 1 ? '' : 's'}</span>
          </button>
          {STATUS_ORDER.map(s => {
            const active = statusFilter === s;
            return (
              <button
                type="button"
                className={`ac-stat-pill is-tab ${active ? 'active' : ''}`}
                key={s}
                onClick={() => setStatusFilter(s)}
                title={`Show ${STATUS_LABEL[s].toLowerCase()} brands`}
              >
                <span className="ac-stat-num" style={{ color: active ? '#fff' : STATUS_META[s].color }}>{counts[s]}</span>
                <span className="ac-stat-label">{STATUS_LABEL[s].toLowerCase()}</span>
              </button>
            );
          })}
        </div>
        {isBob && (
          <Button onClick={openAdd}>
            <i className="bi bi-plus-lg me-1" /> Add Brand
          </Button>
        )}
      </div>

      {brands.length > 0 && (
        <Card className="mb-3">
          <Card.Body className="py-2">
            <Row className="g-2 align-items-center">
              <Col md>
                <InputGroup size="sm">
                  <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                  <Form.Control
                    placeholder="Search by brand, client, scope, or shop code…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {search && (
                    <Button variant="outline-secondary" onClick={() => setSearch('')}>
                      <i className="bi bi-x-lg" />
                    </Button>
                  )}
                </InputGroup>
              </Col>
              <Col md="auto">
                <Form.Select size="sm" value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value as any)}>
                  <option value="all">All statuses</option>
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Form.Select>
              </Col>
              <Col md="auto">
                <Form.Select size="sm" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
                  <option value="">All clients</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Form.Select>
              </Col>
              <Col md="auto">
                <Form.Select size="sm" value={scopeFilter}
                  onChange={e => setScopeFilter(e.target.value as ScopeKey | '')}>
                  <option value="">All scopes</option>
                  {SCOPE_OPTIONS.map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </Form.Select>
              </Col>
              {leads.length > 0 && (
                <Col md="auto">
                  <Form.Select size="sm" value={leadFilter} aria-label="Filter by Team Lead"
                    onChange={e => setLeadFilter(e.target.value)}>
                    <option value="">All team leads</option>
                    <option value="none">No team lead</option>
                    {leads.map(l => <option key={l.id} value={l.id}>{l.full_name || l.email}</option>)}
                  </Form.Select>
                </Col>
              )}
              {(statusFilter !== 'all' || clientFilter || scopeFilter || leadFilter || search) && (
                <Col md="auto">
                  <Button size="sm" variant="link" className="text-muted"
                    onClick={() => { setSearch(''); setStatusFilter('all'); setClientFilter(''); setScopeFilter(''); setLeadFilter(''); }}>
                    Clear filters
                  </Button>
                </Col>
              )}
            </Row>
          </Card.Body>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" /></div>
      ) : err ? (
        <Alert variant="danger">{err}</Alert>
      ) : brands.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-shop" /></div>
              <h5>No brands yet</h5>
              <p>Add your first brand. You'll capture its client, scope, status, and shop code — and from there create weekly reports, set up GMV Max, and share with clients.</p>
              {isBob && (
                <Button className="mt-3" onClick={openAdd}>
                  <i className="bi bi-plus-lg me-1" /> Add Brand
                </Button>
              )}
            </div>
          </Card.Body>
        </Card>
      ) : filtered.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No brands match your filters.
        </Card>
      ) : (
        <Row className="g-3">
          {filtered.map(b => (
            <Col xs={12} md={6} lg={4} xl={3} key={b.id}>
              <Card
                className="h-100 shadow-sm"
                role="button"
                onClick={() => nav(`/brands/${b.id}`)}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                style={{ cursor: 'pointer', transition: 'transform .15s, box-shadow .15s' }}
              >
                <Card.Body className="d-flex flex-column">
                  <div className="d-flex align-items-start gap-2 mb-2">
                    <Avatar name={b.name} size="lg" />
                    <div className="flex-grow-1 min-w-0">
                      <div className="fw-semibold text-truncate" style={{ fontSize: '1.05rem' }}>{b.name}</div>
                      <div className="text-muted small text-truncate">
                        {b.client ? <><i className="bi bi-building me-1" />{b.client}</> : <span className="fst-italic">No client linked</span>}
                      </div>
                    </div>
                    {canEditAny && (
                      <div className="d-flex flex-column gap-1" onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm btn-link p-0 text-muted" onClick={() => openEdit(b)} title="Edit brand">
                          <i className="bi bi-pencil" />
                        </button>
                        {isBob && (
                          <button className="btn btn-sm btn-link p-0 text-danger" onClick={() => remove(b)} title="Delete brand">
                            <i className="bi bi-trash" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
                    <StatusBadge status={b.client_status} />
                    <RegionChip region={b.region} size="sm" />
                    {b.shop_code && (
                      <span className="ac-shop-code" title="Shop code"
                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(b.shop_code!); }}>
                        <i className="bi bi-upc-scan" /> {b.shop_code}
                      </span>
                    )}
                  </div>

                  {b.notes && (
                    <div className="text-muted small mb-2" title={b.notes}
                      style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      <i className="bi bi-sticky me-1" />{b.notes}
                    </div>
                  )}

                  {/* Who runs this brand: its Team Lead + APC (with photos). */}
                  {(() => {
                    const lead = brandLeadOwner[b.id] ? personById.get(brandLeadOwner[b.id]) : null;
                    const apc = brandApcOwner[b.id] ? personById.get(brandApcOwner[b.id]) : null;
                    if (!lead && !apc) return null;
                    return (
                      <div className="ac-brand-owners mt-auto pt-2">
                        {lead && (
                          <span className="ac-owner-chip" title={`Team Lead: ${lead.name}`}>
                            <Avatar name={lead.name} src={lead.avatar} size="sm" variant="dark" />
                            <span className="ac-owner-name">{lead.name}</span>
                            <span className="ac-owner-role">TL</span>
                          </span>
                        )}
                        {apc && (
                          <span className="ac-owner-chip" title={`APC: ${apc.name}`}>
                            <Avatar name={apc.name} src={apc.avatar} size="sm" />
                            <span className="ac-owner-name">{apc.name}</span>
                            <span className="ac-owner-role">APC</span>
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {b.scope.length > 0 && (
                    <div className={`${brandLeadOwner[b.id] || brandApcOwner[b.id] ? '' : 'mt-auto'} pt-2 ac-chip-group`}>
                      {b.scope.map(k => (
                        <span key={k} className="ac-chip">
                          <i className={`bi ${SCOPE_ICON[k] ?? 'bi-tag'}`} /> {SCOPE_LABEL[k] ?? k}
                        </span>
                      ))}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered size={showAssign ? 'xl' : 'lg'}>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editId ? 'Edit Brand' : 'Add Brand'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Row className="g-4">
            <Col lg={showAssign ? 7 : 12}>
            <div className="row g-3">
              <Form.Group className="col-md-7">
                <Form.Label>Store name</Form.Label>
                <Form.Control required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. MyRosy Beauty" />
              </Form.Group>
              <Form.Group className="col-md-5">
                <Form.Label>Shop code</Form.Label>
                <Form.Control
                  value={form.shop_code}
                  onChange={e => setForm({ ...form, shop_code: e.target.value.toUpperCase() })}
                  placeholder="e.g. USLCJYEAPD"
                  style={{ fontFamily: 'monospace', letterSpacing: '.5px' }}
                />
              </Form.Group>
              <Form.Group className="col-md-7">
                <Form.Label>Client</Form.Label>
                <Form.Select required value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">— Choose client —</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Form.Select>
                {clients.length === 0 && (
                  <Form.Text className="text-muted">No clients yet — add one from the Clients menu first.</Form.Text>
                )}
              </Form.Group>
              <Form.Group className="col-md-4">
                <Form.Label>Client status</Form.Label>
                <Form.Select value={form.client_status} onChange={e => setForm({ ...form, client_status: e.target.value as ClientStatus })}>
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                </Form.Select>
              </Form.Group>
              <Form.Group className="col-md-3">
                <Form.Label>Region</Form.Label>
                <Form.Select value={form.region} onChange={e => setForm({ ...form, region: e.target.value as Region })}>
                  {REGIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Form.Select>
                <Form.Text className="text-muted">Sets the currency symbol shown for this brand everywhere.</Form.Text>
              </Form.Group>
              {/* Monthly fee + paid-status — Bob only. APCs never see or
                  submit budget data. */}
              {isBob && (
              <Form.Group className="col-md-5">
                <Form.Label>
                  Monthly fee <small className="text-muted fw-normal">(USD)</small>
                </Form.Label>
                <InputGroup>
                  <InputGroup.Text>$</InputGroup.Text>
                  <Form.Control
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.monthly_fee || ''}
                    placeholder="e.g. 750"
                    onChange={e => setForm({ ...form, monthly_fee: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </InputGroup>
                <Form.Text className="text-muted">
                  Amount the client pays each month to manage this brand.
                </Form.Text>
              </Form.Group>
              )}
              {isBob && !editId && (
                <Form.Group className="col-md-7 d-flex align-items-end">
                  <div
                    className={`w-100 p-3 rounded border ${form.paid_current_month ? 'border-success bg-success-subtle' : 'border-secondary-subtle bg-light'}`}
                    style={{ cursor: form.monthly_fee > 0 ? 'pointer' : 'not-allowed', opacity: form.monthly_fee > 0 ? 1 : 0.6 }}
                    onClick={() => {
                      if (form.monthly_fee > 0) setForm({ ...form, paid_current_month: !form.paid_current_month });
                    }}
                  >
                    <Form.Check
                      type="switch"
                      id="paid-current-month"
                      checked={form.paid_current_month}
                      disabled={form.monthly_fee <= 0}
                      onChange={e => setForm({ ...form, paid_current_month: e.target.checked })}
                      label={<>
                        <span className="fw-semibold">Client has paid for {monthLabel(new Date())}</span>
                        <div className="small text-muted mt-1">
                          {form.paid_current_month
                            ? `A paid record of $${form.monthly_fee.toFixed(2)} will be added for this month.`
                            : 'Leave off if payment is still pending — Budget Manager will show it as outstanding.'}
                        </div>
                      </>}
                    />
                  </div>
                </Form.Group>
              )}
              <Form.Group className="col-12">
                <Form.Label>Scope <small className="text-muted fw-normal">— pick all that apply</small></Form.Label>
                <div className="ac-chip-group">
                  {SCOPE_OPTIONS.map(o => {
                    const on = form.scope.includes(o.key);
                    return (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => toggleScope(o.key)}
                        className={`ac-chip ${on ? '' : 'neutral'}`}
                        style={{
                          cursor: 'pointer',
                          opacity: on ? 1 : .85,
                          background: on ? undefined : '#fff',
                        }}
                      >
                        <i className={`bi ${on ? 'bi-check2' : o.icon}`} /> {o.label}
                      </button>
                    );
                  })}
                </div>
              </Form.Group>
              <Form.Group className="col-12">
                <Form.Label>Notes <small className="text-muted fw-normal">(optional)</small></Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={form.notes}
                  placeholder="Any context about this brand — onboarding details, preferences, reminders…"
                  onChange={e => setForm({ ...form, notes: e.target.value })}
                />
              </Form.Group>
            </div>
            </Col>
            {showAssign && (
              <Col lg={5} className="ac-assign-side">
                <div className="d-flex align-items-center justify-content-between mb-1">
                  <h6 className="mb-0">
                    <i className="bi bi-diagram-3 me-1" />Assign brand
                    <span className="text-muted fw-normal small ms-1">(optional)</span>
                  </h6>
                  {(assignLeadId || assignApcId) && (
                    <button type="button" className="btn btn-link btn-sm p-0 text-muted" onClick={clearAssign}>
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-muted small mb-3">
                  Hand this brand to a Team Lead, one of their APCs, or any APC directly.
                </p>

                {/* Control 1 — Team Lead */}
                <Form.Group className="mb-3">
                  <Form.Label className="small fw-semibold mb-1">Team Lead</Form.Label>
                  <SearchableDropdown
                    items={leads.map(l => ({ id: l.id, label: l.full_name || l.email, sub: l.email }))}
                    value={assignLeadId}
                    onChange={pickLead}
                    placeholder="Select a Team Lead…"
                    noneLabel="No Team Lead"
                    emptyText="No team leads yet."
                  />
                </Form.Group>

                {/* Control 2 — an APC within the selected lead's team */}
                <Form.Group className="mb-3">
                  <Form.Label className="small fw-semibold mb-1">APC in this team</Form.Label>
                  <SearchableDropdown
                    items={teamApcs.map(a => ({ id: a.id, label: a.full_name || a.email, sub: a.email }))}
                    value={teamApcs.some(a => a.id === assignApcId) ? assignApcId : ''}
                    onChange={pickTeamApc}
                    placeholder="Team Lead only"
                    noneLabel="Team Lead only (no APC)"
                    emptyText="This team lead has no APCs yet."
                    disabled={!assignLeadId}
                    disabledText="Pick a team lead first"
                  />
                </Form.Group>

                <div className="d-flex align-items-center gap-2 text-muted small my-2">
                  <span className="flex-grow-1 border-top" /> or <span className="flex-grow-1 border-top" />
                </div>

                {/* Control 3 — any APC directly (auto-cascades to their team lead) */}
                <Form.Group className="mb-2">
                  <Form.Label className="small fw-semibold mb-1">Assign directly to any APC</Form.Label>
                  <SearchableDropdown
                    items={apcs.map(a => ({
                      id: a.id,
                      label: a.full_name || a.email,
                      sub: a.team_lead_id ? `team: ${leadName[a.team_lead_id] ?? '—'}` : 'no team',
                    }))}
                    value={assignApcId}
                    onChange={pickAnyApc}
                    placeholder="Select an APC…"
                    noneLabel="No APC"
                    emptyText="No APCs yet."
                  />
                  <Form.Text className="text-muted">
                    If the APC is on a team, the brand is also given to their Team Lead.
                  </Form.Text>
                </Form.Group>

                <AssignSummary
                  leadLabel={assignLeadId ? (leadName[assignLeadId] ?? 'a Team Lead') : ''}
                  apcLabel={assignApcId ? (apcs.find(a => a.id === assignApcId)?.full_name || apcs.find(a => a.id === assignApcId)?.email || 'an APC') : ''}
                />
              </Col>
            )}
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editId ? 'Save' : 'Create')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}

function StatusBadge({ status }: { status: ClientStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.in_progress;
  return (
    <span className="ac-chip" style={{ background: m.bg, color: m.color, borderColor: 'transparent' }}>
      <i className={`bi ${m.icon}`} /> {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// Searchable single-select dropdown used in the brand-assignment sidebar: a toggle
// button shows the current pick; opening it reveals a search field + the option list.
// Closes on select or outside click.
function SearchableDropdown({ items, value, onChange, placeholder, noneLabel, emptyText, disabled, disabledText }: {
  items: { id: string; label: string; sub?: string }[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  noneLabel?: string;
  emptyText?: string;
  disabled?: boolean;
  disabledText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const selected = items.find(i => i.id === value);
  const term = q.trim().toLowerCase();
  const filtered = term
    ? items.filter(i => `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(term))
    : items;

  const pick = (id: string) => { onChange(id); setOpen(false); setQ(''); };

  return (
    <div className="ac-dd" ref={ref}>
      <button
        type="button"
        className="ac-dd-toggle"
        disabled={disabled}
        onClick={() => { setOpen(o => !o); setQ(''); }}
      >
        <span className={`ac-dd-label ${selected ? '' : 'text-muted'}`}>
          {disabled ? (disabledText ?? placeholder) : (selected ? selected.label : placeholder)}
        </span>
        <i className={`bi bi-chevron-${open ? 'up' : 'down'}`} />
      </button>
      {open && !disabled && (
        <div className="ac-dd-menu">
          <div className="ac-search ac-search-sm m-1">
            <i className="bi bi-search" />
            <input autoFocus placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
            {q && (
              <button type="button" className="btn btn-link p-0 text-muted" onClick={() => setQ('')}>
                <i className="bi bi-x-lg" />
              </button>
            )}
          </div>
          <div className="ac-dd-list">
            <button type="button" className={`ac-pick-row ${!value ? 'active' : ''}`} onClick={() => pick('')}>
              <i className={`bi ${!value ? 'bi-check-circle-fill' : 'bi-circle'}`} />
              <span className="text-muted">{noneLabel ?? placeholder}</span>
            </button>
            {items.length === 0 ? (
              <div className="text-muted small p-2">{emptyText ?? 'None'}</div>
            ) : filtered.length === 0 ? (
              <div className="text-muted small p-2">No matches.</div>
            ) : filtered.map(i => (
              <button
                type="button"
                key={i.id}
                className={`ac-pick-row ${value === i.id ? 'active' : ''}`}
                onClick={() => pick(i.id)}
              >
                <i className={`bi ${value === i.id ? 'bi-check-circle-fill' : 'bi-circle'}`} />
                <span>
                  {i.label}
                  {i.sub && <span className="text-muted small ms-1">· {i.sub}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Plain-language summary of what the current assignment selection will do.
function AssignSummary({ leadLabel, apcLabel }: { leadLabel: string; apcLabel: string }) {
  let text: string;
  if (apcLabel && leadLabel) text = `Assigned to ${apcLabel} (and their Team Lead ${leadLabel}).`;
  else if (apcLabel) text = `Assigned directly to ${apcLabel} (no team).`;
  else if (leadLabel) text = `Assigned to Team Lead ${leadLabel}.`;
  else text = 'Not assigned — you can set this later.';
  return (
    <div className={`small mt-3 p-2 rounded ${apcLabel || leadLabel ? 'bg-success-subtle text-success-emphasis' : 'bg-light text-muted'}`}>
      <i className={`bi ${apcLabel || leadLabel ? 'bi-check2-circle' : 'bi-info-circle'} me-1`} />
      {text}
    </div>
  );
}
