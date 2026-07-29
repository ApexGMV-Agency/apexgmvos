import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import Avatar from '../components/Avatar';

interface Client { id: string; name: string; created_at: string; brands?: { id: string; name: string }[]; }

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [{ data: cls, error: e1 }, { data: brs, error: e2 }] = await Promise.all([
      supabase.from('clients').select('*').order('name'),
      supabase.from('brands').select('id,name,client_id'),
    ]);
    if (e1 || e2) { setErr((e1 ?? e2)!.message); setLoading(false); return; }
    const map = new Map<string, { id: string; name: string }[]>();
    (brs ?? []).forEach((b: any) => {
      if (!b.client_id) return;
      const arr = map.get(b.client_id) ?? [];
      arr.push({ id: b.id, name: b.name });
      map.set(b.client_id, arr);
    });
    setClients((cls ?? []).map(c => ({ ...c, brands: map.get(c.id) ?? [] })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filteredClients = useMemo(() => {
    if (!search.trim()) return clients;
    const q = search.trim().toLowerCase();
    return clients.filter(c =>
      `${c.name} ${(c.brands ?? []).map(b => b.name).join(' ')}`.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const totalBrands = clients.reduce((s, c) => s + (c.brands?.length ?? 0), 0);

  const openAdd = () => { setEditing(null); setName(''); setErr(null); setShow(true); };
  const openEdit = (c: Client) => { setEditing(c); setName(c.name); setErr(null); setShow(true); };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const res = editing
      ? await supabase.from('clients').update({ name: name.trim() }).eq('id', editing.id)
      : await supabase.from('clients').insert({ name: name.trim() });
    setSaving(false);
    if (res.error) { setErr(res.error.message); return; }
    setShow(false); load();
  };

  const remove = async (c: Client) => {
    if (!confirm(`Delete client "${c.name}"? Brands will be unlinked.`)) return;
    const prev = clients;
    setClients(clients.filter(x => x.id !== c.id));
    const { error } = await supabase.from('clients').delete().eq('id', c.id);
    if (error) { alert(error.message); setClients(prev); }
  };

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2>Clients</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{clients.length}</span>
            <span className="ac-stat-label">client{clients.length === 1 ? '' : 's'}</span>
          </span>
          {totalBrands > 0 && (
            <span className="ac-stat-pill">
              <span className="ac-stat-num">{totalBrands}</span>
              <span className="ac-stat-label">linked brand{totalBrands === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
        <Button onClick={openAdd}><i className="bi bi-plus-lg me-1" /> Add Client</Button>
      </div>

      {clients.length > 0 && (
        <div className="ac-search mb-3">
          <i className="bi bi-search" />
          <input
            placeholder="Search by client or brand…"
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
      ) : err ? (
        <Alert variant="danger">{err}</Alert>
      ) : clients.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-building" /></div>
              <h5>No clients yet</h5>
              <p>Add your first client. Brands can then be linked to a client and shared with them.</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-plus-lg me-1" /> Add Client
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : filteredClients.length === 0 ? (
        <Card body className="text-muted text-center py-4">
          No clients match "{search}".
        </Card>
      ) : (
        <div className="ac-list">
          {filteredClients.map(c => (
            <div className="ac-list-row" key={c.id}>
              <Avatar name={c.name} size="lg" variant="dark" />
              <div className="ac-row-main">
                <div className="ac-row-name">{c.name}</div>
                <div className="ac-row-sub">
                  <i className="bi bi-shop me-1" />
                  {(c.brands ?? []).length} brand{(c.brands?.length ?? 0) === 1 ? '' : 's'}
                </div>
                <div className="mt-2 ac-chip-group">
                  {(c.brands ?? []).length === 0 ? (
                    <span className="text-muted small fst-italic">No brands linked yet — assign one from the Brands page.</span>
                  ) : c.brands!.map(b => (
                    <span key={b.id} className="ac-chip">
                      <i className="bi bi-shop" /> {b.name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="ac-row-actions">
                <button className="ac-icon-btn" onClick={() => openEdit(c)} title="Edit">
                  <i className="bi bi-pencil" />
                </button>
                <button className="ac-icon-btn danger" onClick={() => remove(c)} title="Delete">
                  <i className="bi bi-trash" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton><Modal.Title>{editing ? 'Edit Client' : 'Add Client'}</Modal.Title></Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group>
              <Form.Label>Client name</Form.Label>
              <Form.Control required value={name} onChange={e => setName(e.target.value)} />
            </Form.Group>
            <Form.Text className="text-muted">After creating the client, edit any brand to assign it to this client.</Form.Text>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Create')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
