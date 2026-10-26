import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { PAID_COLLAB_MIGRATION, friendlyDbError, isMissingSchema } from '../lib/dbError';
import Avatar from '../components/Avatar';
import ChangeRoleModal from '../components/ChangeRoleModal';

// Bob-only management page for Paid Collab Handlers (any Bob, incl. the Super
// Boss). A handler runs paid creator deals for the brands assigned here — only
// brands with the "Paid Collab" scope (`paid_creator`) can be assigned — and
// sees nothing but the /paid-collab workspace.

interface Handler {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  avatar_url?: string | null;
  brand_ids: string[];
}

interface BrandLite { id: string; name: string; }

export default function PaidCollabHandlers() {
  const [handlers, setHandlers] = useState<Handler[]>([]);
  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [edit, setEdit] = useState<Handler | null>(null);
  const [form, setForm] = useState({ email: '', password: '', full_name: '', brand_ids: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const [pwH, setPwH] = useState<Handler | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [delH, setDelH] = useState<Handler | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const [roleH, setRoleH] = useState<Handler | null>(null);
  const [flagBusy, setFlagBusy] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [h, b, a, f] = await Promise.all([
      supabase.from('profiles')
        .select('id,email,full_name,role,created_at,avatar_url')
        .eq('role', 'paid_collab_handler').order('created_at', { ascending: false }),
      supabase.from('brands').select('id,name,scope').order('name'),
      supabase.from('paid_collab_handler_brands').select('handler_id,brand_id'),
      supabase.from('app_feature_flags').select('enabled').eq('key', 'paid_collab').maybeSingle(),
    ]);
    const e = h.error ?? b.error ?? a.error ?? f.error;
    if (e) {
      // Paid Collab tables not created yet → just show the normal empty state.
      if (!isMissingSchema(e)) setErr(friendlyDbError(e));
      setLoading(false);
      return;
    }
    const paid = ((b.data ?? []) as { id: string; name: string; scope: string[] | null }[])
      .filter(x => (x.scope ?? []).includes('paid_creator'))
      .map(x => ({ id: x.id, name: x.name }));
    const byHandler = new Map<string, string[]>();
    (a.data ?? []).forEach(r => byHandler.set(r.handler_id, [...(byHandler.get(r.handler_id) ?? []), r.brand_id]));
    setBrands(paid);
    setHandlers(((h.data ?? []) as Omit<Handler, 'brand_ids'>[]).map(x => ({ ...x, brand_ids: byHandler.get(x.id) ?? [] })));
    setEnabled(f.data?.enabled ?? true);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const brandName = useMemo(() => new Map(brands.map(b => [b.id, b.name])), [brands]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return handlers;
    return handlers.filter(h =>
      `${h.full_name ?? ''} ${h.email} ${h.brand_ids.map(id => brandName.get(id) ?? '').join(' ')}`.toLowerCase().includes(q));
  }, [handlers, search, brandName]);

  const openAdd = () => {
    setEdit(null);
    setForm({ email: '', password: '', full_name: '', brand_ids: [] });
    setFormErr(null);
    setShow(true);
  };

  const openEdit = (h: Handler) => {
    setEdit(h);
    setForm({ email: h.email, password: '', full_name: h.full_name ?? '', brand_ids: h.brand_ids });
    setFormErr(null);
    setShow(true);
  };

  const toggleBrand = (id: string) =>
    setForm(f => ({ ...f, brand_ids: f.brand_ids.includes(id) ? f.brand_ids.filter(x => x !== id) : [...f.brand_ids, id] }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setFormErr(null);
    try {
      if (edit) {
        const { error: pErr } = await supabase.from('profiles')
          .update({ full_name: form.full_name }).eq('id', edit.id);
        if (pErr) throw pErr;
        const { error: bErr } = await supabase.rpc('set_paid_collab_handler_brands', {
          p_handler: edit.id, p_brands: form.brand_ids,
        });
        if (bErr) throw bErr;
      } else {
        const { data, error } = await supabase.functions.invoke('create-paid-collab-handler', {
          body: {
            email: form.email,
            password: form.password,
            full_name: form.full_name,
            brand_ids: form.brand_ids,
          },
        });
        if (error) throw await fnError(error);
        if ((data as any)?.error) throw new Error((data as any).error);
      }
      setShow(false);
      await load();
    } catch (e: any) {
      setFormErr(friendlyDbError(e, PAID_COLLAB_MIGRATION) || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = async () => {
    setFlagBusy(true);
    const { error } = await supabase.from('app_feature_flags')
      .upsert({ key: 'paid_collab', enabled: !enabled, updated_at: new Date().toISOString() });
    if (error) setErr(friendlyDbError(error, PAID_COLLAB_MIGRATION)); else setEnabled(!enabled);
    setFlagBusy(false);
  };

  const totalAssignments = handlers.reduce((s, h) => s + h.brand_ids.length, 0);

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2>Paid Collab Handlers</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{handlers.length}</span>
            <span className="ac-stat-label">handler{handlers.length === 1 ? '' : 's'}</span>
          </span>
          {totalAssignments > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num">{totalAssignments}</span>
              <span className="ac-stat-label">brand assignment{totalAssignments === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <Link to="/paid-collab" className="btn btn-outline-secondary">
            <i className="bi bi-camera-video me-1" /> Open workspace
          </Link>
          <Button onClick={openAdd}>
            <i className="bi bi-person-plus me-1" /> Add Handler
          </Button>
        </div>
      </div>

      <Alert variant="light" className="border small text-muted py-2 d-flex align-items-center gap-3 flex-wrap">
        <span className="flex-grow-1">
          <i className="bi bi-camera-video me-1" />
          Handlers run paid creator deals — budgets, creators, videos, payments, contracts — for the
          brands you assign them, and see <strong>only</strong> the Paid Collab workspace. Only brands
          with the <strong>Paid Collab</strong> scope can be assigned ({brands.length} right now; set
          the scope on the Brands page).
        </span>
        <Form.Check type="switch" id="pc-enabled" disabled={flagBusy}
          checked={enabled} onChange={toggleModule}
          label={enabled ? 'Workspace on for handlers' : 'Workspace OFF — handlers locked out'} />
      </Alert>

      {handlers.length > 0 && (
        <div className="ac-search mb-3">
          <i className="bi bi-search" />
          <input placeholder="Search by name, email, or brand…" value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button type="button" className="btn btn-link p-0 text-muted" onClick={() => setSearch('')}>
              <i className="bi bi-x-lg" />
            </button>
          )}
        </div>
      )}

      {err && <Alert variant="danger" dismissible onClose={() => setErr(null)}>{err}</Alert>}

      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" /></div>
      ) : handlers.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-camera-video" /></div>
              <h5>No Paid Collab Handlers yet</h5>
              <p>Add your first handler and give them the Paid Collab brands they will run.</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-person-plus me-1" /> Add Handler
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : filtered.length === 0 ? (
        <Card body className="text-muted text-center py-4">No handlers match "{search}".</Card>
      ) : (
        <div className="ac-list">
          {filtered.map(h => {
            const display = h.full_name || h.email;
            return (
              <div className="ac-list-row" key={h.id}>
                <Avatar name={display} src={h.avatar_url} size="lg" />
                <div className="ac-row-main">
                  <div className="ac-row-name">{h.full_name || <span className="text-muted">No name</span>}</div>
                  <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                    <span><i className="bi bi-envelope me-1" />{h.email}</span>
                  </div>
                  <div className="mt-2 ac-chip-group">
                    {h.brand_ids.length === 0 ? (
                      <span className="text-muted small fst-italic">No brands assigned</span>
                    ) : h.brand_ids.map(id => (
                      <span key={id} className="ac-chip neutral">
                        <i className="bi bi-shop" /> {brandName.get(id) ?? 'Brand without Paid Collab scope'}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="ac-row-actions">
                  <button className="ac-icon-btn" title="Reset password"
                    onClick={() => { setPwH(h); setNewPw(''); setPwErr(null); setPwOk(false); }}>
                    <i className="bi bi-key" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => openEdit(h)} title="Edit">
                    <i className="bi bi-pencil" />
                  </button>
                  <button className="ac-icon-btn" onClick={() => setRoleH(h)} title="Change role">
                    <i className="bi bi-person-gear" />
                  </button>
                  <button className="ac-icon-btn danger" onClick={() => { setDelH(h); setDelErr(null); }} title="Delete handler">
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
            <Modal.Title>{edit ? 'Edit Handler' : 'Add Paid Collab Handler'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {formErr && <Alert variant="danger">{formErr}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required disabled={!!edit} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
              {edit && <Form.Text className="text-muted">Email cannot be changed.</Form.Text>}
            </Form.Group>
            {!edit && (
              <Form.Group className="mb-3">
                <Form.Label>Password</Form.Label>
                <Form.Control type="text" required minLength={6} maxLength={72} value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })} />
                <Form.Text className="text-muted">Share this with the handler.</Form.Text>
              </Form.Group>
            )}
            <Form.Label>Brands ({form.brand_ids.length} selected)</Form.Label>
            {brands.length === 0 ? (
              <Alert variant="light" className="border small text-muted py-2 mb-0">
                No brand has the <strong>Paid Collab</strong> scope yet. Add it to a brand on the Brands page first.
              </Alert>
            ) : (
              <div className="border rounded p-2" style={{ maxHeight: 220, overflowY: 'auto' }}>
                {brands.map(b => (
                  <Form.Check key={b.id} id={`pc-brand-${b.id}`} label={b.name}
                    checked={form.brand_ids.includes(b.id)} onChange={() => toggleBrand(b.id)} />
                ))}
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (edit ? 'Save' : 'Create Handler')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwH} onHide={() => setPwH(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwH) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-paid-collab-handler-password', {
              body: { user_id: pwH.id, password: newPw },
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
            <Modal.Title>Reset password — {pwH?.full_name || pwH?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with the handler.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6} maxLength={72}
                value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="e.g. apexgmv-2026" autoFocus />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwH(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!delH} onHide={() => !delBusy && setDelH(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete handler?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {delErr && <Alert variant="danger">{delErr}</Alert>}
          <p className="mb-2">This permanently removes <strong>{delH?.full_name || delH?.email}</strong> and revokes their access.</p>
          <p className="text-muted small mb-0">The programs, creators and logs they worked on stay with the brand. Their private notes are deleted. This cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDelH(null)} disabled={delBusy}>Cancel</Button>
          <Button variant="danger" disabled={delBusy} onClick={async () => {
            if (!delH) return;
            setDelBusy(true); setDelErr(null);
            try {
              const { data, error } = await supabase.functions.invoke('delete-paid-collab-handler', { body: { user_id: delH.id } });
              if (error) throw await fnError(error);
              if ((data as any)?.error) throw new Error((data as any).error);
              setDelH(null);
              await load();
            } catch (e: any) {
              setDelErr(e?.message ?? 'Failed to delete handler');
            } finally {
              setDelBusy(false);
            }
          }}>{delBusy ? 'Deleting…' : 'Delete handler'}</Button>
        </Modal.Footer>
      </Modal>

      <ChangeRoleModal target={roleH} onHide={() => setRoleH(null)} onChanged={load} />
    </>
  );
}
