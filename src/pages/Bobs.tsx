import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Spinner, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../components/Avatar';

interface Bob {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_superbob: boolean;
  created_at: string;
  avatar_url?: string | null;
}

// Super Bob-only management of Bob (admin) accounts: create, reset passwords,
// delete. A new Bob has full Bob access everywhere (brands, budget, chats,
// tasks, paid collab…) — everything except this page. Super Bob accounts can't
// be deleted or have their password reset here.
export default function Bobs() {
  const { profile, user } = useAuth();
  const isSuperBob = profile?.role === 'bob' && !!profile?.is_superbob;

  const [bobs, setBobs] = useState<Bob[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', full_name: '' });
  const [saving, setSaving] = useState(false);

  const [pwBob, setPwBob] = useState<Bob | null>(null);
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  const [delBob, setDelBob] = useState<Bob | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase
      .from('profiles')
      .select('id,email,full_name,role,is_superbob,created_at,avatar_url')
      .eq('role', 'bob')
      .order('is_superbob', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) { setErr(error.message); setLoading(false); return; }
    setBobs((data ?? []) as Bob[]);
    setLoading(false);
  };

  useEffect(() => { if (isSuperBob) load(); }, [isSuperBob]);

  const regularCount = useMemo(() => bobs.filter(b => !b.is_superbob).length, [bobs]);

  const openAdd = () => {
    setForm({ email: '', password: '', full_name: '' });
    setErr(null);
    setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('create-bob', {
        body: { email: form.email, password: form.password, full_name: form.full_name },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw await fnError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      setShow(false);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to create Bob');
    } finally {
      setSaving(false);
    }
  };

  if (!isSuperBob) {
    return <Alert variant="danger">Only the Super Boss can manage Bob accounts.</Alert>;
  }

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2>Bobs</h2>
          <span className="ac-stat-pill">
            <span className="ac-stat-num">{regularCount}</span>
            <span className="ac-stat-label">bob{regularCount === 1 ? '' : 's'}</span>
          </span>
        </div>
        <Button onClick={openAdd}>
          <i className="bi bi-person-plus me-1" /> Add Bob
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-4"><Spinner animation="border" /></div>
      ) : err && bobs.length === 0 ? (
        <Alert variant="danger">{err}</Alert>
      ) : bobs.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-person-badge" /></div>
              <h5>No Bobs yet</h5>
              <p>Add a Bob account. They get full admin access — everything except managing Bobs.</p>
              <Button className="mt-3" onClick={openAdd}>
                <i className="bi bi-person-plus me-1" /> Add Bob
              </Button>
            </div>
          </Card.Body>
        </Card>
      ) : (
        <div className="ac-list">
          {bobs.map(b => {
            const display = b.full_name || b.email;
            const isMe = b.id === user?.id;
            return (
              <div className="ac-list-row" key={b.id}>
                <Avatar name={display} src={b.avatar_url} size="lg" variant="dark" />
                <div className="ac-row-main">
                  <div className="ac-row-name d-flex align-items-center gap-2 flex-wrap">
                    {b.full_name || <span className="text-muted">No name</span>}
                    {b.is_superbob
                      ? <Badge bg="warning" text="dark"><i className="bi bi-star-fill me-1" />Super Boss</Badge>
                      : <Badge bg="dark">Bob</Badge>}
                    {isMe && <Badge bg="secondary">You</Badge>}
                  </div>
                  <div className="ac-row-sub d-flex align-items-center flex-wrap gap-2">
                    <span><i className="bi bi-envelope me-1" />{b.email}</span>
                    <span className="text-muted">joined {new Date(b.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="ac-row-actions">
                  {!b.is_superbob && (
                    <button className="ac-icon-btn"
                      onClick={() => { setPwBob(b); setNewPw(''); setPwErr(null); setPwOk(false); }}
                      title="Reset password">
                      <i className="bi bi-key" />
                    </button>
                  )}
                  {!b.is_superbob && !isMe && (
                    <button className="ac-icon-btn danger"
                      onClick={() => { setDelBob(b); setDelErr(null); }} title="Delete Bob">
                      <i className="bi bi-trash" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>Add Bob</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Alert variant="warning" className="py-2 small">
              <i className="bi bi-exclamation-triangle me-1" />
              A Bob has <strong>full admin access</strong>: all brands, clients, budget,
              reporting, tasks and chats. Only add people you fully trust.
            </Alert>
            <Form.Group className="mb-3">
              <Form.Label>Full name</Form.Label>
              <Form.Control value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Email</Form.Label>
              <Form.Control type="email" required value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control type="text" required minLength={6} value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })} />
              <Form.Text className="text-muted">Share this with the new Bob.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create Bob'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!pwBob} onHide={() => setPwBob(null)} centered>
        <Form onSubmit={async (e) => {
          e.preventDefault();
          if (!pwBob) return;
          setPwBusy(true); setPwErr(null); setPwOk(false);
          try {
            const { data, error } = await supabase.functions.invoke('reset-bob-password', {
              body: { user_id: pwBob.id, password: newPw },
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
            <Modal.Title>Reset password — {pwBob?.full_name || pwBob?.email}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {pwErr && <Alert variant="danger">{pwErr}</Alert>}
            {pwOk && <Alert variant="success">Password updated. Share it with the Bob.</Alert>}
            <Form.Group>
              <Form.Label>New password (min 6 chars)</Form.Label>
              <Form.Control type="text" required minLength={6}
                value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="e.g. apexgmv-2026" autoFocus />
              <Form.Text className="text-muted">They can use this to sign in immediately.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setPwBob(null)}>Close</Button>
            <Button type="submit" disabled={pwBusy || newPw.length < 6}>{pwBusy ? 'Updating…' : 'Reset password'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      <Modal show={!!delBob} onHide={() => !delBusy && setDelBob(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Delete Bob?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {delErr && <Alert variant="danger">{delErr}</Alert>}
          <p className="mb-2">This will permanently remove <strong>{delBob?.full_name || delBob?.email}</strong> and revoke their admin access.</p>
          <p className="text-muted small mb-0">
            Brands, reports, tasks and other data they created are kept. This cannot be undone.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setDelBob(null)} disabled={delBusy}>Cancel</Button>
          <Button variant="danger" disabled={delBusy} onClick={async () => {
            if (!delBob) return;
            setDelBusy(true); setDelErr(null);
            try {
              const { data, error } = await supabase.functions.invoke('delete-bob', {
                body: { user_id: delBob.id },
              });
              if (error) throw await fnError(error);
              if ((data as any)?.error) throw new Error((data as any).error);
              setDelBob(null);
              await load();
            } catch (e: any) {
              setDelErr(e?.message ?? 'Failed to delete Bob');
            } finally {
              setDelBusy(false);
            }
          }}>{delBusy ? 'Deleting…' : 'Delete Bob'}</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
