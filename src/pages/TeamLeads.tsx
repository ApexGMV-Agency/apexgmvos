import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert, Row, Col } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import Avatar from '../components/Avatar';
import ChangeRoleModal from '../components/ChangeRoleModal';

interface TeamLead {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  avatar_url?: string | null;
  brand_ids?: string[];
  brand_names?: string[];
  apc_count?: number;
}

interface BrandLite { id: string; name: string; }
interface ApcLite { id: string; email: string; full_name: string | null; team_lead_id: string | null; }

// Bob-only management of Team Leads: create accounts, assign Bob→TeamLead brands,
// reset passwords, and delete. Team Leads then manage their own APCs and re-assign
// a subset of these brands to them (see APCs page in the Team Lead view).
export default function TeamLeads() {
  const [leads, setLeads] = useState<TeamLead[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [allApcs, setAllApcs] = useState<ApcLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editLead, setEditLead] = useState<TeamLead | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', brand_ids: [] as string[], apc_ids: [] as string[] });
  const [saving, setSaving] = useState(false);

  const [pwLead, setPwLead] = useState<TeamLead | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [delLead, setDelLead] = useState<TeamLead | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const [roleLead, setRoleLead] = useState<TeamLead | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const [{ data: leadRows, error: e1 }, { data: brandRows, error: e2 }, { data: assigns, error: e3 }, { data: apcRows, error: e4 }] = await Promise.all([
      supabase.from('profiles').select('id,email,full_name,role,created_at,avatar_url').eq('role', 'team_lead').order('created_at', { ascending: false }),
      supabase.from('brands').select('id,name').order('name'),
      supabase.from('team_lead_brands').select('team_lead_id,brand_id'),
      supabase.from('profiles').select('id,email,full_name,team_lead_id').eq('role', 'apc').order('full_name'),
    ]);
    if (e1 || e2 || e3 || e4) {
      setErr((e1 ?? e2 ?? e3 ?? e4)!.message);
      setLoading(false); return;
    }
    const brandMap = new Map<string, string>((brandRows ?? []).map(b => [b.id, b.name]));
    const assignMap = new Map<string, string[]>();
    (assigns ?? []).forEach(a => {
      const arr = assignMap.get(a.team_lead_id) ?? [];
      arr.push(a.brand_id);
      assignMap.set(a.team_lead_id, arr);
    });
    const apcCount = new Map<string, number>();
    (apcRows ?? []).forEach(a => {
      if (!a.team_lead_id) return;
      apcCount.set(a.team_lead_id, (apcCount.get(a.team_lead_id) ?? 0) + 1);
    });
    setBrands(brandRows ?? []);
    setAllApcs((apcRows ?? []) as ApcLite[]);
    setLeads((leadRows ?? []).map(l => ({
      ...l,
      brand_ids: assignMap.get(l.id) ?? [],
      brand_names: (assignMap.get(l.id) ?? []).map(id => brandMap.get(id) ?? '?'),
      apc_count: apcCount.get(l.id) ?? 0,
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredLeads = useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.trim().toLowerCase();
    return leads.filter(l =>
      `${l.full_name ?? ''} ${l.email} ${(l.brand_names ?? []).join(' ')}`.toLowerCase().includes(q)
    );
  }, [leads, search]);

  const totalAssignments = leads.reduce((s, l) => s + (l.brand_ids?.length ?? 0), 0);

  // One brand → one Team Lead: map each assigned brand to its owning lead so the
  // picker can flag brands already held by a different lead.
  const brandOwner = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    leads.forEach(l => (l.brand_ids ?? []).forEach(bid => m.set(bid, { id: l.id, name: l.full_name || l.email })));
    return m;
  }, [leads]);

  // Brands the current selection will pull off another team lead (so we can warn Bob
  // and free them on save — one brand → one Team Lead, reassigned in place).
  const movingBrands = useMemo(
    () => form.brand_ids
      .map(id => ({ id, name: brands.find(b => b.id === id)?.name ?? '?', owner: brandOwner.get(id) }))
      .filter((x): x is { id: string; name: string; owner: { id: string; name: string } } =>
        !!x.owner && x.owner.id !== editLead?.id),
    [form.brand_ids, brands, brandOwner, editLead],
  );

  // APCs that will be moved off another lead's team if this is saved.
  const movingApcs = useMemo(
    () => allApcs.filter(a => form.apc_ids.includes(a.id) && a.team_lead_id && a.team_lead_id !== editLead?.id),
    [allApcs, form.apc_ids, editLead],
  );

  const openAdd = () => {
    setEditLead(null);
    setForm({ email: '', password: '', full_name: '', brand_ids: [], apc_ids: [] });
    setErr(null);
    setShow(true);
  };

  const openEdit = (l: TeamLead) => {
    setEditLead(l);
    setForm({
      email: l.email, password: '', full_name: l.full_name ?? '',
      brand_ids: l.brand_ids ?? [],
      apc_ids: allApcs.filter(a => a.team_lead_id === l.id).map(a => a.id),
    });
    setErr(null);
    setShow(true);
  };

  const toggleBrand = (id: string) => {
    setForm(f => ({
      ...f,
      brand_ids: f.brand_ids.includes(id) ? f.brand_ids.filter(b => b !== id) : [...f.brand_ids, id],
    }));
  };

  const toggleApc = (id: string) => {
    setForm(f => ({
      ...f,
      apc_ids: f.apc_ids.includes(id) ? f.apc_ids.filter(a => a !== id) : [...f.apc_ids, id],
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    // Brands pulled off another team lead by this save: free their old grant (and detach
    // them from any APC no longer in the brand's team) before re-granting, so one
    // brand → one Team Lead stays intact and reassignment happens in place.
    const movedBrandIds = movingBrands.map(b => b.id);
    const freeMovedBrands = async () => {
      if (movedBrandIds.length === 0) return;
      const { error: tErr } = await supabase.from('team_lead_brands').delete().in('brand_id', movedBrandIds);
      if (tErr) throw tErr;
      const { error: aErr } = await supabase.from('apc_brands').delete().in('brand_id', movedBrandIds);
      if (aErr) throw aErr;
    };
    try {
      let leadId: string;
      if (editLead) {
        const { error: pErr } = await supabase.from('profiles')
          .update({ full_name: form.full_name }).eq('id', editLead.id);
        if (pErr) throw pErr;
        const { error: dErr } = await supabase.from('team_lead_brands').delete().eq('team_lead_id', editLead.id);
        if (dErr) throw dErr;
        await freeMovedBrands();
        if (form.brand_ids.length > 0) {
          const rows = form.brand_ids.map(bid => ({ team_lead_id: editLead.id, brand_id: bid }));
          const { error: iErr } = await supabase.from('team_lead_brands').insert(rows);
          if (iErr) throw iErr;
        }
        leadId = editLead.id;
      } else {
        await freeMovedBrands();
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('create-team-lead', {
          body: {
            email: form.email,
            password: form.password,
            full_name: form.full_name,
            brand_ids: form.brand_ids,
          },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (error) throw await fnError(error);
        if ((data as any)?.error) throw new Error((data as any).error);
        leadId = (data as any).id as string;
      }
      // Set which APCs report to this Team Lead (notifies newly-added APCs).
      const { error: aErr } = await supabase.rpc('set_team_lead_apcs', { p_lead: leadId, p_apc_ids: form.apc_ids });
      if (aErr) throw aErr;
      setShow(false);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2>Team Leads</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{leads.length}</span>
            <span className="ac-stat-label">team lead{leads.length === 1 ? '' : 's'}</span>
          </span>
          {totalAssignments > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num">{totalAssignments}</span>
              <span className="ac-stat-label">brand assignment{totalAssignments === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <Button onClick={openAdd}>
          <i className="bi bi-person-plus me-1" /> Add Team Lead
        </Button>
      </div>

      {leads.length > 0 && (
        <div className="ac-search mb-3">
          <i className="bi bi-search" />
          <input
            placeholder="Search by name, email, or brand…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className="btn btn-link p-0 text-muted" onClick={() => setSearch('')}>
              <i className="bi bi-x-lg" />
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" /></div>
      ) : err && leads.length === 0 ? (
        <Alert variant="danger">{err}</Alert>
      ) : leads.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-diagram-3" /></div>
              <h5>No Team Leads yet</h5>
              <p>Add your first team lead. They'll manage their own APCs and the brands you assign to them.</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-person-plus me-1" /> Add Team Lead
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : filteredLeads.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No team leads match "{search}".
        </Card>
      ) : (
        <div className="ac-list">
          {filteredLeads.map(l => {
            const display = l.full_name || l.email;
            return (
              <div className="ac-list-row" key={l.id}>
                <Avatar name={display} src={l.avatar_url} size="lg" />
                <div className="ac-row-main">
                  <div className="ac-row-name">{l.full_name || <span className="text-muted">No name</span>}</div>
                  <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                    <span><i className="bi bi-envelope me-1" />{l.email}</span>
                    <span className="ac-chip" title="APCs managed by this team lead">
                      <i className="bi bi-people" /> {l.apc_count} APC{l.apc_count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-2 ac-chip-group">
                    {(l.brand_names ?? []).length === 0 ? (
                      <span className="text-muted small fst-italic">No brands assigned</span>
                    ) : l.brand_names!.map(n => (
                      <span key={n} className="ac-chip neutral">
                        <i className="bi bi-shop" /> {n}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ac-row-actions">
                  <button className="ac-icon-btn"
                    onClick={() => { setPwLead(l); setNewPw(''); setPwErr(null); setPwOk(false); }}
                    title="Reset password">
                    <i className="bi bi-key" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => openEdit(l)} title="Edit">
                    <i className="bi bi-pencil" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => setRoleLead(l)} title="Change role">
                    <i className="bi bi-person-gear" />
                  </button>
                  <button className="ac-icon-btn danger"
                    onClick={() => { setDelLead(l); setDelErr(null); }} title="Delete Team Lead">
                    <i className="bi bi-trash" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal show={show} onHide={() => setShow(false)} size="lg" centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editLead ? 'Edit Team Lead' : 'Add Team Lead'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            {movingApcs.length > 0 && (
              <Alert variant="warning" className="py-2">
                <i className="bi bi-exclamation-triangle me-1" />
                <strong>{movingApcs.length} APC{movingApcs.length === 1 ? '' : 's'} will be moved</strong> off their
                current team: {movingApcs.map(a => a.full_name || a.email).join(', ')}. They and their previous
                Team Lead will be notified.
              </Alert>
            )}
            {movingBrands.length > 0 && (
              <Alert variant="warning" className="py-2">
                <i className="bi bi-shop me-1" />
                <strong>{movingBrands.length} brand{movingBrands.length === 1 ? '' : 's'} will be reassigned</strong> here
                from {Array.from(new Set(movingBrands.map(b => b.owner.name))).join(', ')}:{' '}
                {movingBrands.map(b => b.name).join(', ')}. The previous Team Lead loses access, and any APC under them
                holding {movingBrands.length === 1 ? 'it' : 'them'} is detached.
              </Alert>
            )}
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required disabled={!!editLead} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
              {editLead && <Form.Text className="text-muted">Email cannot be changed.</Form.Text>}
            </Form.Group>
            {!editLead && (
              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control type="text" required minLength={6} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
                <Form.Text className="text-muted">Share this with the team lead.</Form.Text>
              </Form.Group>
            )}

            <Row>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label>Assign brands</Form.Label>
                  <Form.Text className="text-muted d-block mb-1">
                    The team lead can re-assign any subset of these to their own APCs.
                  </Form.Text>
                  {brands.length === 0 ? (
                    <p className="text-muted small mb-0">No brands exist yet. Create some first.</p>
                  ) : (
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 6, padding: 10 }}>
                      {brands.map(b => {
                        const owner = brandOwner.get(b.id);
                        const takenByOther = owner && owner.id !== editLead?.id;
                        const checked = form.brand_ids.includes(b.id);
                        return (
                          <Form.Check
                            key={b.id}
                            type="checkbox"
                            id={`tlb-${b.id}`}
                            checked={checked}
                            onChange={() => toggleBrand(b.id)}
                            label={
                              <span>
                                {b.name}
                                {takenByOther && (
                                  <span className={`small ms-1 ${checked ? 'text-warning' : 'text-muted'}`}>
                                    · {checked ? 'moving from' : 'on'} {owner!.name}
                                  </span>
                                )}
                              </span>
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-2">
                  <Form.Label>APCs in this team</Form.Label>
                  <Form.Text className="text-muted d-block mb-1">
                    Choose which APCs report to this team lead.
                  </Form.Text>
                  {allApcs.length === 0 ? (
                    <p className="text-muted small mb-0">No APCs exist yet.</p>
                  ) : (
                    <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 6, padding: 10 }}>
                      {allApcs.map(a => {
                        const otherLead = a.team_lead_id && a.team_lead_id !== editLead?.id;
                        return (
                          <Form.Check
                            key={a.id}
                            type="checkbox"
                            id={`tla-${a.id}`}
                            checked={form.apc_ids.includes(a.id)}
                            onChange={() => toggleApc(a.id)}
                            label={
                              <span>
                                {a.full_name || a.email}
                                {otherLead && <span className="text-warning small ms-1" title="Currently on another team">· on another team</span>}
                              </span>
                            }
                          />
                        );
                      })}
                    </div>
                  )}
                </Form.Group>
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editLead ? 'Save' : 'Create Team Lead')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwLead} onHide={() => setPwLead(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwLead) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-team-lead-password', {
              body: { user_id: pwLead.id, password: newPw },
            });
            if (error) throw await fnError(error);
            if ((data as any)?.error) throw new Error((data as any).error);
            setPwOk(true);
          } catch (e: any) {
            setPwErr(e?.message ?? 'Failed to reset password');
          } finally {
            setPwBusy(false);
          }
        }}>
          <Modal.Header closeButton>
            <Modal.Title>Reset password — {pwLead?.full_name || pwLead?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with the team lead.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6}
                value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="e.g. apexgmv-2026" autoFocus />
              <Form.Text className="text-muted">The team lead can use this to sign in immediately.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwLead(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!delLead} onHide={() => !delBusy && setDelLead(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete Team Lead?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {delErr && <Alert variant="danger">{delErr}</Alert>}
          <p className="mb-2">This will permanently remove <strong>{delLead?.full_name || delLead?.email}</strong> and revoke their access.</p>
          <p className="text-muted small mb-0">
            Their APCs are kept but detached (they fall back to no team lead); APC brand
            assignments and reports remain. This cannot be undone.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDelLead(null)} disabled={delBusy}>Cancel</Button>
          <Button variant="danger" disabled={delBusy} onClick={async () => {
            if (!delLead) return;
            setDelBusy(true); setDelErr(null);
            try {
              const { data, error } = await supabase.functions.invoke('delete-team-lead', {
                body: { user_id: delLead.id },
              });
              if (error) throw await fnError(error);
              if ((data as any)?.error) throw new Error((data as any).error);
              setDelLead(null);
              await load();
            } catch (e: any) {
              setDelErr(e?.message ?? 'Failed to delete team lead');
            } finally {
              setDelBusy(false);
            }
          }}>{delBusy ? 'Deleting…' : 'Delete Team Lead'}</Button>
        </Modal.Footer>
      </Modal>

      <ChangeRoleModal
        target={roleLead ? { ...roleLead, brand_count: roleLead.brand_ids?.length ?? 0 } : null}
        onHide={() => setRoleLead(null)}
        onChanged={load}
      />
    </>
  );
}
