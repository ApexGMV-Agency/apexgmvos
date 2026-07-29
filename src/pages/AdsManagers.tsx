import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import Avatar from '../components/Avatar';
import ChangeRoleModal from '../components/ChangeRoleModal';

// Bob-only management page for Ads Managers: APC-like VIEW access to their
// assigned brands (reports, sample seeding, products, resources, paid collab),
// but their only edit surfaces are the GMV Max tab and the paid-collab video
// "Authorised" toggle. Unlike APC brands, assignment is NOT exclusive — an Ads
// Manager coexists with the brand's APC / Team Lead.

interface AdsManager {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  avatar_url?: string | null;
  brand_ids?: string[];
  brand_names?: string[];
}

interface BrandLite { id: string; name: string; }

export default function AdsManagers() {
  const [managers, setManagers] = useState<AdsManager[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editMgr, setEditMgr] = useState<AdsManager | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '' });
  const [saving, setSaving] = useState(false);

  const [pwMgr, setPwMgr] = useState<AdsManager | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [delMgr, setDelMgr] = useState<AdsManager | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const [roleMgr, setRoleMgr] = useState<AdsManager | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const [{ data: mgrRows, error: e1 }, { data: brandRowsRaw, error: e2 }, { data: assigns, error: e3 }] = await Promise.all([
      supabase.from('profiles')
        .select('id,email,full_name,role,created_at,avatar_url')
        .eq('role', 'ads_manager').order('created_at', { ascending: false }),
      supabase.from('brands').select('id,name,scope').order('name'),
      supabase.from('ads_manager_brands').select('ads_manager_id,brand_id'),
    ]);
    if (e1 || e2 || e3) {
      setErr((e1 ?? e2 ?? e3)!.message);
      setLoading(false); return;
    }
    // Only brands with the GMV Max scope ('ads') can be given to an Ads Manager
    // (enforced server-side too, in set_ads_manager_brands + create-ads-manager).
    const brandRows = ((brandRowsRaw ?? []) as { id: string; name: string; scope: string[] | null }[])
      .filter(b => (b.scope ?? []).includes('ads'))
      .map(b => ({ id: b.id, name: b.name }));
    const brandMap = new Map<string, string>((brandRows ?? []).map(b => [b.id, b.name]));
    const assignMap = new Map<string, string[]>();
    (assigns ?? []).forEach(a => {
      const arr = assignMap.get(a.ads_manager_id) ?? [];
      arr.push(a.brand_id);
      assignMap.set(a.ads_manager_id, arr);
    });
    setBrands(brandRows ?? []);
    setManagers((mgrRows ?? []).map(m => ({
      ...m,
      brand_ids: assignMap.get(m.id) ?? [],
      brand_names: (assignMap.get(m.id) ?? []).map(id => brandMap.get(id) ?? '?'),
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredManagers = useMemo(() => {
    if (!search.trim()) return managers;
    const q = search.trim().toLowerCase();
    return managers.filter(m =>
      `${m.full_name ?? ''} ${m.email} ${(m.brand_names ?? []).join(' ')}`.toLowerCase().includes(q)
    );
  }, [managers, search]);

  const totalAssignments = managers.reduce((s, m) => s + (m.brand_ids?.length ?? 0), 0);

  const openAdd = () => {
    setEditMgr(null);
    setForm({ email: '', password: '', full_name: '' });
    setErr(null);
    setShow(true);
  };

  const openEdit = (m: AdsManager) => {
    setEditMgr(m);
    setForm({ email: m.email, password: '', full_name: m.full_name ?? '' });
    setErr(null);
    setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      if (editMgr) {
        // Brands are auto-assigned (all GMV Max brands); only the name is editable here.
        const { error: pErr } = await supabase.from('profiles')
          .update({ full_name: form.full_name }).eq('id', editMgr.id);
        if (pErr) throw pErr;
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const { data, error } = await supabase.functions.invoke('create-ads-manager', {
          body: {
            email: form.email,
            password: form.password,
            full_name: form.full_name,
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
          <h2>Ads Managers</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{managers.length}</span>
            <span className="ac-stat-label">ads manager{managers.length === 1 ? '' : 's'}</span>
          </span>
          {totalAssignments > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num">{totalAssignments}</span>
              <span className="ac-stat-label">brand assignment{totalAssignments === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <Button onClick={openAdd}>
          <i className="bi bi-person-plus me-1" /> Add Ads Manager
        </Button>
      </div>

      <Alert variant="light" className="border small text-muted py-2">
        <i className="bi bi-eye me-1" />
        Ads Managers automatically get <strong>every GMV Max-scope brand</strong> — no manual
        picking. They <strong>view</strong> those brands (reports, sample seeding, products,
        resources, paid collab) but can only <strong>edit GMV Max</strong> and toggle a paid-collab
        video's <strong>Authorised</strong> flag. They get team <strong>Chats</strong> (incl. their
        brands' groups) and <strong>Tasks</strong> (you assign to them; they assign up to Bobs).
        Turning the GMV Max scope on/off for a brand adds/removes it for all Ads Managers, and
        this doesn't affect the brand's APC / Team Lead.
      </Alert>

      {managers.length > 0 && (
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
      ) : err && managers.length === 0 ? (
        <Alert variant="danger">{err}</Alert>
      ) : managers.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-badge-ad" /></div>
              <h5>No Ads Managers yet</h5>
              <p>Add your first Ads Manager. They'll see the brands you assign read-only, and manage those brands' GMV Max.</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-person-plus me-1" /> Add Ads Manager
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : filteredManagers.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No Ads Managers match "{search}".
        </Card>
      ) : (
        <div className="ac-list">
          {filteredManagers.map(m => {
            const display = m.full_name || m.email;
            return (
              <div className="ac-list-row" key={m.id}>
                <Avatar name={display} src={m.avatar_url} size="lg" />
                <div className="ac-row-main">
                  <div className="ac-row-name">{m.full_name || <span className="text-muted">No name</span>}</div>
                  <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                    <span><i className="bi bi-envelope me-1" />{m.email}</span>
                    <span className="ac-chip" title="Can manage GMV Max on assigned brands; everything else read-only">
                      <i className="bi bi-graph-up" /> GMV Max editor
                    </span>
                  </div>
                  <div className="mt-2 ac-chip-group">
                    {(m.brand_names ?? []).length === 0 ? (
                      <span className="text-muted small fst-italic">No brands assigned</span>
                    ) : m.brand_names!.map(n => (
                      <span key={n} className="ac-chip neutral">
                        <i className="bi bi-shop" /> {n}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ac-row-actions">
                  <button className="ac-icon-btn"
                    onClick={() => { setPwMgr(m); setNewPw(''); setPwErr(null); setPwOk(false); }}
                    title="Reset password">
                    <i className="bi bi-key" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => openEdit(m)} title="Edit">
                    <i className="bi bi-pencil" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => setRoleMgr(m)} title="Change role">
                    <i className="bi bi-person-gear" />
                  </button>
                  <button className="ac-icon-btn danger"
                    onClick={() => { setDelMgr(m); setDelErr(null); }} title="Delete Ads Manager">
                    <i className="bi bi-trash" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editMgr ? 'Edit Ads Manager' : 'Add Ads Manager'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required disabled={!!editMgr} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
              {editMgr && <Form.Text className="text-muted">Email cannot be changed.</Form.Text>}
            </Form.Group>
            {!editMgr && (
              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control type="text" required minLength={6} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
                <Form.Text className="text-muted">Share this with the Ads Manager.</Form.Text>
              </Form.Group>
            )}
            <Alert variant="light" className="border small text-muted py-2 mb-0">
              <i className="bi bi-magic me-1" />
              Brands are assigned <strong>automatically</strong>: this Ads Manager gets
              {' '}<strong>all {brands.length} GMV Max brand{brands.length === 1 ? '' : 's'}</strong>,
              and any brand you later give the GMV Max scope is added for them too. No manual
              selection needed.
            </Alert>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editMgr ? 'Save' : 'Create Ads Manager')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwMgr} onHide={() => setPwMgr(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwMgr) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-ads-manager-password', {
              body: { user_id: pwMgr.id, password: newPw },
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
            <Modal.Title>Reset password — {pwMgr?.full_name || pwMgr?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with the Ads Manager.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6}
                value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="e.g. apexgmv-2026" autoFocus />
              <Form.Text className="text-muted">They can use this to sign in immediately. Copy it and send it to them manually.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwMgr(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!delMgr} onHide={() => !delBusy && setDelMgr(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete Ads Manager?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {delErr && <Alert variant="danger">{delErr}</Alert>}
          <p className="mb-2">This will permanently remove <strong>{delMgr?.full_name || delMgr?.email}</strong> and revoke their access. Their brand assignments will be cleared.</p>
          <p className="text-muted small mb-0">Brand data they could view is unaffected. This cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDelMgr(null)} disabled={delBusy}>Cancel</Button>
          <Button variant="danger" disabled={delBusy} onClick={async () => {
            if (!delMgr) return;
            setDelBusy(true); setDelErr(null);
            try {
              const { data, error } = await supabase.functions.invoke('delete-ads-manager', {
                body: { user_id: delMgr.id },
              });
              if (error) throw await fnError(error);
              if ((data as any)?.error) throw new Error((data as any).error);
              setDelMgr(null);
              await load();
            } catch (e: any) {
              setDelErr(e?.message ?? 'Failed to delete Ads Manager');
            } finally {
              setDelBusy(false);
            }
          }}>{delBusy ? 'Deleting…' : 'Delete Ads Manager'}</Button>
        </Modal.Footer>
      </Modal>

      <ChangeRoleModal target={roleMgr} onHide={() => setRoleMgr(null)} onChanged={load} />
    </>
  );
}
