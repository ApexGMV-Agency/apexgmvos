import { useState, FormEvent } from 'react';
import { Modal, Form, Alert, Button, InputGroup, Badge } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import FolderExplorer from '../../components/resources/FolderExplorer';
import type { Resource } from '../../lib/resourceFolders';

const DESC_MAX = 240;

export default function BrandResourcesTab({ brandId, brandName, canEdit }: { brandId: string; brandName: string; canEdit: boolean }) {
  const { user, profile } = useAuth();
  const isBob = profile?.role === 'bob';

  // Add/edit modal owned by the page (the explorer just delegates).
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [defaultFolderId, setDefaultFolderId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', url: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const openAdd = (folderId: string | null) => {
    setEditing(null);
    setDefaultFolderId(folderId);
    setForm({ name: '', url: '', description: '' });
    setErr(null); setShow(true);
  };
  const openEdit = (r: Resource) => {
    setEditing(r);
    setForm({ name: r.name, url: r.url.replace(/^https?:\/\//, ''), description: r.description ?? '' });
    setErr(null); setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const fullUrl = form.url.startsWith('http') ? form.url : `https://${form.url}`;
    const payload: any = {
      name: form.name.trim(),
      url: fullUrl.trim(),
      description: form.description.trim() || null,
      scope: 'brand',
      brand_id: brandId,
      created_by: user?.id,
    };
    if (!editing) payload.folder_id = defaultFolderId;
    const res = editing
      ? await supabase.from('resources').update(payload).eq('id', editing.id)
      : await supabase.from('resources').insert(payload);
    setSaving(false);
    if (res.error) setErr(res.error.message);
    else { setShow(false); setReloadKey(k => k + 1); }
  };

  const remove = async (r: Resource) => {
    if (!confirm(`Delete resource "${r.name}"?`)) return;
    const { error } = await supabase.from('resources').delete().eq('id', r.id);
    if (error) { alert(error.message); return; }
    setReloadKey(k => k + 1);
  };

  const toggleShared = async (r: Resource, next: boolean) => {
    const { error } = await supabase.from('resources').update({ is_shared: next }).eq('id', r.id);
    if (error) { alert(error.message); return; }
    setReloadKey(k => k + 1);
  };

  return (
    <>
      <FolderExplorer
        scope={{ kind: 'brand', brandId }}
        canEdit={canEdit}
        reloadKey={reloadKey}
        onAddResource={openAdd}
        onEditResource={openEdit}
        onDeleteResource={remove}
        renderResourceExtras={(r) => (
          <>
            <div className="mb-2">
              {r.is_shared
                ? <Badge bg="success" className="d-inline-flex align-items-center gap-1">
                    <i className="bi bi-globe" /> Shared
                  </Badge>
                : <Badge bg="light" text="dark" className="d-inline-flex align-items-center gap-1">
                    <i className="bi bi-lock" /> Private
                  </Badge>}
            </div>
            {isBob && canEdit && (
              <Form.Check
                type="switch"
                id={`share-${r.id}`}
                checked={!!r.is_shared}
                onChange={e => toggleShared(r, e.target.checked)}
                label={<small className="text-muted">Share with clients</small>}
              />
            )}
          </>
        )}
      />

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editing ? 'Edit resource' : 'Add resource'} — {brandName}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">Resource name</Form.Label>
              <Form.Control required placeholder="e.g. Q2 Brand Guidelines"
                value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">URL</Form.Label>
              <InputGroup>
                <InputGroup.Text>https://</InputGroup.Text>
                <Form.Control required placeholder="notion.so/brand-guide"
                  value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
              </InputGroup>
            </Form.Group>
            <Form.Group>
              <Form.Label className="fw-semibold">Description</Form.Label>
              <Form.Control as="textarea" rows={3} maxLength={DESC_MAX}
                value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              <div className="text-end small text-muted mt-1">{form.description.length} / {DESC_MAX}</div>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : (editing ? 'Save' : 'Add resource')}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
