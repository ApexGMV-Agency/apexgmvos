import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';
import ChangeRoleModal from '../components/ChangeRoleModal';

interface APC {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  can_edit_brands: boolean;
  can_manage_gmv_max: boolean;
  avatar_url?: string | null;
  brand_ids?: string[];
  brand_names?: string[];
}

interface BrandLite { id: string; name: string; }

export default function APCs() {
  const { profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const isTeamLead = profile?.role === 'team_lead';
  const [apcs, setApcs] = useState<APC[]>([]);
  const [availableApcs, setAvailableApcs] = useState<{ id: string; email: string; full_name: string | null; avatar_url?: string | null }[]>([]);
  const [claimBusy, setClaimBusy] = useState<string | null>(null);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editApc, setEditApc] = useState<APC | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', brand_ids: [] as string[], can_edit_brands: false, can_manage_gmv_max: false });
  const [saving, setSaving] = useState(false);

  const [pwApc, setPwApc] = useState<APC | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [delApc, setDelApc] = useState<APC | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const [roleApc, setRoleApc] = useState<APC | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    // A Team Lead can now also read unassigned APCs (to claim them), so scope the
    // "my team" list explicitly to their own APCs; Bob sees everyone.
    let apcQuery = supabase.from('profiles')
      .select('id,email,full_name,role,created_at,can_edit_brands,can_manage_gmv_max,avatar_url')
      .eq('role', 'apc').order('created_at', { ascending: false });
    if (isTeamLead && profile?.id) apcQuery = apcQuery.eq('team_lead_id', profile.id);
    const [{ data: apcRows, error: e1 }, { data: brandRows, error: e2 }, { data: assigns, error: e3 }] = await Promise.all([
      apcQuery,
      supabase.from('brands').select('id,name').order('name'),
      supabase.from('apc_brands').select('apc_id,brand_id'),
    ]);
    if (e1 || e2 || e3) {
      setErr((e1 ?? e2 ?? e3)!.message);
      setLoading(false); return;
    }
    // Team Leads: list of APCs not on any team, offered as "add to my team".
    if (isTeamLead) {
      const { data: avail } = await supabase.from('profiles')
        .select('id,email,full_name,avatar_url').eq('role', 'apc').is('team_lead_id', null).order('full_name');
      setAvailableApcs(avail ?? []);
    } else {
      setAvailableApcs([]);
    }
    const brandMap = new Map<string,string>((brandRows ?? []).map(b => [b.id, b.name]));
    const assignMap = new Map<string, string[]>();
    (assigns ?? []).forEach(a => {
      const arr = assignMap.get(a.apc_id) ?? [];
      arr.push(a.brand_id);
      assignMap.set(a.apc_id, arr);
    });
    setBrands(brandRows ?? []);
    setApcs((apcRows ?? []).map(a => ({
      ...a,
      can_edit_brands: !!a.can_edit_brands,
      can_manage_gmv_max: !!a.can_manage_gmv_max,
      brand_ids: assignMap.get(a.id) ?? [],
      brand_names: (assignMap.get(a.id) ?? []).map(id => brandMap.get(id) ?? '?'),
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredApcs = useMemo(() => {
    if (!search.trim()) return apcs;
    const q = search.trim().toLowerCase();
    return apcs.filter(a =>
      `${a.full_name ?? ''} ${a.email} ${(a.brand_names ?? []).join(' ')}`.toLowerCase().includes(q)
    );
  }, [apcs, search]);

  const totalAssignments = apcs.reduce((s, a) => s + (a.brand_ids?.length ?? 0), 0);

  // One brand → one APC: map each assigned brand to its owning APC so the picker
  // can disable brands already held by a different APC.
  const brandOwner = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    apcs.forEach(a => (a.brand_ids ?? []).forEach(bid => m.set(bid, { id: a.id, name: a.full_name || a.email })));
    return m;
  }, [apcs]);

  const openAdd = () => {
    setEditApc(null);
    setForm({ email: '', password: '', full_name: '', brand_ids: [], can_edit_brands: false, can_manage_gmv_max: false });
    setErr(null);
    setShow(true);
  };

  const openEdit = (a: APC) => {
    setEditApc(a);
    setForm({ email: a.email, password: '', full_name: a.full_name ?? '', brand_ids: a.brand_ids ?? [], can_edit_brands: a.can_edit_brands, can_manage_gmv_max: a.can_manage_gmv_max });
    setErr(null);
    setShow(true);
  };

  const toggleBrand = (id: string) => {
    setForm(f => ({
      ...f,
      brand_ids: f.brand_ids.includes(id) ? f.brand_ids.filter(b => b !== id) : [...f.brand_ids, id],
    }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      if (editApc) {
        const { error: pErr } = await supabase.from('profiles')
          .update({
            full_name: form.full_name,
            can_edit_brands: form.can_edit_brands,
            can_manage_gmv_max: form.can_manage_gmv_max,
          }).eq('id', editApc.id);
        if (pErr) throw pErr;
        // Replace brand assignments + notify the APC of any newly-added brands.
        const { error: bErr } = await supabase.rpc('set_apc_brands', {
          p_apc: editApc.id, p_brand_ids: form.brand_ids,
        });
        if (bErr) throw bErr;
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('create-apc', {
          body: {
            email: form.email,
            password: form.password,
            full_name: form.full_name,
            brand_ids: form.brand_ids,
            can_edit_brands: form.can_edit_brands,
            can_manage_gmv_max: form.can_manage_gmv_max,
          },
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (error) throw await fnError(error);
        if ((data as any)?.error) throw new Error((data as any).error);
      }
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
          <h2>APCs</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{apcs.length}</span>
            <span className="ac-stat-label">account manager{apcs.length === 1 ? '' : 's'}</span>
          </span>
          {totalAssignments > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num">{totalAssignments}</span>
              <span className="ac-stat-label">brand assignment{totalAssignments === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <Button onClick={openAdd}>
          <i className="bi bi-person-plus me-1" /> Add APC
        </Button>
      </div>

      {apcs.length > 0 && (
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
      ) : err && apcs.length === 0 ? (
        <Alert variant="danger">{err}</Alert>
      ) : apcs.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-people" /></div>
              <h5>No APCs yet</h5>
              <p>Add your first account manager. They'll be able to sign in and manage the brands you assign to them.</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-person-plus me-1" /> Add APC
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : filteredApcs.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No APCs match "{search}".
        </Card>
      ) : (
        <div className="ac-list">
          {filteredApcs.map(a => {
            const display = a.full_name || a.email;
            return (
              <div className="ac-list-row" key={a.id}>
                <Avatar name={display} src={a.avatar_url} size="lg" />
                <div className="ac-row-main">
                  <div className="ac-row-name">{a.full_name || <span className="text-muted">No name</span>}</div>
                  <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                    <span><i className="bi bi-envelope me-1" />{a.email}</span>
                    {a.can_edit_brands && (
                      <span className="ac-chip warning" title="Can edit brand details">
                        <i className="bi bi-pencil-square" /> Brand editor
                      </span>
                    )}
                    {a.can_manage_gmv_max && (
                      <span className="ac-chip" title="Can manage GMV Max budgets">
                        <i className="bi bi-graph-up" /> GMV Max
                      </span>
                    )}
                  </div>
                  <div className="mt-2 ac-chip-group">
                    {(a.brand_names ?? []).length === 0 ? (
                      <span className="text-muted small fst-italic">No brands assigned</span>
                    ) : a.brand_names!.map(n => (
                      <span key={n} className="ac-chip neutral">
                        <i className="bi bi-shop" /> {n}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ac-row-actions">
                  <button className="ac-icon-btn"
                    onClick={() => { setPwApc(a); setNewPw(''); setPwErr(null); setPwOk(false); }}
                    title="Reset password">
                    <i className="bi bi-key" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => openEdit(a)} title="Edit">
                    <i className="bi bi-pencil" />
                  </button>
                  {/* Only Bob can change an APC's role or delete them. */}
                  {isBob && (
                    <button className="ac-icon-btn" onClick={() => setRoleApc(a)} title="Change role">
                      <i className="bi bi-person-gear" />
                    </button>
                  )}
                  {isBob && (
                    <button className="ac-icon-btn danger"
                      onClick={() => { setDelApc(a); setDelErr(null); }} title="Delete APC">
                      <i className="bi bi-trash" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Team Lead: APCs not on any team yet — claim them into your team. */}
      {isTeamLead && availableApcs.length > 0 && (
        <div className="mt-4">
          <h6 className="text-muted mb-2">
            <i className="bi bi-people me-1" />Available APCs (no team)
          </h6>
          <div className="ac-list">
            {availableApcs.map(a => (
              <div className="ac-list-row" key={a.id}>
                <Avatar name={a.full_name || a.email} src={a.avatar_url} size="lg" />
                <div className="ac-row-main">
                  <div className="ac-row-name">{a.full_name || <span className="text-muted">No name</span>}</div>
                  <div className="ac-row-sub"><i className="bi bi-envelope me-1" />{a.email}</div>
                </div>
                <div className="ac-row-actions">
                  <Button size="sm" variant="outline-primary" disabled={claimBusy === a.id}
                    onClick={async () => {
                      setClaimBusy(a.id);
                      const { error } = await supabase.rpc('claim_apc', { p_apc: a.id });
                      setClaimBusy(null);
                      if (error) { alert(error.message); return; }
                      await load();
                    }}>
                    <i className="bi bi-plus-lg me-1" />{claimBusy === a.id ? 'Adding…' : 'Add to my team'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editApc ? 'Edit APC' : 'Add APC'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required disabled={!!editApc} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
              {editApc && <Form.Text className="text-muted">Email cannot be changed.</Form.Text>}
            </Form.Group>
            {!editApc && (
              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control type="text" required minLength={6} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
                <Form.Text className="text-muted">Share this with the APC.</Form.Text>
              </Form.Group>
            )}
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold mb-1">Permissions</Form.Label>
              <div className="border rounded p-2">
                <Form.Check
                  type="switch"
                  id="can-edit-brands"
                  label={<><strong>Edit brand details</strong> <span className="text-muted small">— name, client, GMV, tier on assigned brands</span></>}
                  checked={form.can_edit_brands}
                  onChange={e => setForm({ ...form, can_edit_brands: e.target.checked })}
                />
                <Form.Check
                  type="switch"
                  className="mt-2"
                  id="can-manage-gmv-max"
                  label={<><strong>Manage GMV Max</strong> <span className="text-muted small">— monthly budgets and weekly entries on assigned brands</span></>}
                  checked={form.can_manage_gmv_max}
                  onChange={e => setForm({ ...form, can_manage_gmv_max: e.target.checked })}
                />
              </div>
              <Form.Text className="text-muted">
                Bob can always do everything; these toggles only widen what an APC can do.
              </Form.Text>
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label>Assign brands</Form.Label>
              {isTeamLead && (
                <Form.Text className="text-muted d-block mb-1">
                  Only the brands assigned to you by Bob are shown.
                </Form.Text>
              )}
              {brands.length === 0 ? (
                <p className="text-muted small mb-0">
                  {isTeamLead ? 'You have no brands assigned yet.' : 'No brands exist yet. Create some first.'}
                </p>
              ) : (
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--ac-border)', borderRadius: 6, padding: 10 }}>
                  {brands.map(b => {
                    const owner = brandOwner.get(b.id);
                    const takenByOther = owner && owner.id !== editApc?.id;
                    return (
                      <Form.Check
                        key={b.id}
                        type="checkbox"
                        id={`b-${b.id}`}
                        disabled={!!takenByOther}
                        checked={form.brand_ids.includes(b.id)}
                        onChange={() => toggleBrand(b.id)}
                        label={
                          <span>
                            {b.name}
                            {takenByOther && <span className="text-muted small ms-1">· with {owner!.name}</span>}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              )}
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editApc ? 'Save' : 'Create APC')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwApc} onHide={() => setPwApc(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwApc) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-apc-password', {
              body: { user_id: pwApc.id, password: newPw },
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
            <Modal.Title>Reset password — {pwApc?.full_name || pwApc?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with the APC.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6}
                value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="e.g. apexgmv-2026" autoFocus />
              <Form.Text className="text-muted">The APC can use this to sign in immediately. Copy it and send it to them manually.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwApc(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!delApc} onHide={() => !delBusy && setDelApc(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete APC?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {delErr && <Alert variant="danger">{delErr}</Alert>}
          <p className="mb-2">This will permanently remove <strong>{delApc?.full_name || delApc?.email}</strong> and revoke their access. Their brand assignments will be cleared.</p>
          <p className="text-muted small mb-0">Reports they created will remain. This cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDelApc(null)} disabled={delBusy}>Cancel</Button>
          <Button variant="danger" disabled={delBusy} onClick={async () => {
            if (!delApc) return;
            setDelBusy(true); setDelErr(null);
            try {
              const { data, error } = await supabase.functions.invoke('delete-apc', {
                body: { user_id: delApc.id },
              });
              if (error) throw await fnError(error);
              if ((data as any)?.error) throw new Error((data as any).error);
              setDelApc(null);
              await load();
            } catch (e: any) {
              setDelErr(e?.message ?? 'Failed to delete APC');
            } finally {
              setDelBusy(false);
            }
          }}>{delBusy ? 'Deleting…' : 'Delete APC'}</Button>
        </Modal.Footer>
      </Modal>

      <ChangeRoleModal
        target={roleApc ? { ...roleApc, brand_count: roleApc.brand_ids?.length ?? 0 } : null}
        onHide={() => setRoleApc(null)}
        onChanged={load}
      />
    </>
  );
}
