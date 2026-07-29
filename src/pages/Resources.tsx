import { useEffect, useState, FormEvent, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Modal, Form, Alert, Badge, Col, InputGroup, Offcanvas, Nav, Spinner } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import ResourceComments, { ResourceComment } from '../components/ResourceComments';
import FolderExplorer from '../components/resources/FolderExplorer';
import type { Resource, ExplorerScope } from '../lib/resourceFolders';

interface BrandLite { id: string; name: string; share_enabled: boolean; }

const DESC_MAX = 240;

function brandColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 50%)`;
}
function brandInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map(s => s[0]?.toUpperCase() ?? '').join('') || '?';
}

type ScopeKey = 'general' | `b:${string}`;

export default function Resources() {
  const { user, profile } = useAuth();
  const isBob = profile?.role === 'bob';
  const isApc = profile?.role === 'apc';
  // Ads Manager: APC-like brand scoping, but strictly READ-ONLY (comments still allowed).
  const isAdsManager = profile?.role === 'ads_manager';
  const isApcLike = isApc || isAdsManager;
  const { notifications, markRead } = useNotifications();
  const [params, setParams] = useSearchParams();

  const [brands, setBrands] = useState<BrandLite[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // APCs default to their first brand; Bob defaults to General.
  const [activeScope, setActiveScope] = useState<ScopeKey>(isApcLike ? 'b:placeholder' : 'general');

  // Add/Edit resource modal — owned by this page.
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [defaultFolderId, setDefaultFolderId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', url: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Comments offcanvas + deep-link
  const [comments, setComments] = useState<ResourceComment[]>([]);
  const [feedbackResource, setFeedbackResource] = useState<Resource | null>(null);
  const [highlightCommentId, setHighlightCommentId] = useState<string | null>(null);

  // Initial load — brands and comments.
  useEffect(() => {
    (async () => {
      setBrandsLoading(true); setErr(null);
      const [b, c] = await Promise.all([
        supabase.from('brands').select('id,name,share_enabled').order('name'),
        supabase.from('resource_comments').select('*').order('created_at', { ascending: true }),
      ]);
      const blist = (b.data as BrandLite[]) ?? [];
      setBrands(blist);
      setComments((c.data as ResourceComment[]) ?? []);
      if (b.error) setErr(b.error.message);
      // Resolve default scope for APCs once we know their brands.
      if (isApcLike && blist.length > 0 && activeScope === 'b:placeholder') {
        setActiveScope(`b:${blist[0].id}`);
      }
      setBrandsLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: live comments
  useEffect(() => {
    const ch = supabase
      .channel('resource_comments_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'resource_comments' },
        (payload) => setComments(prev => {
          const next = payload.new as ResourceComment;
          if (prev.some(c => c.id === next.id)) return prev;
          return [...prev, next];
        }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Deep link: ?resource=<id>&comment=<id> opens feedback panel for that resource.
  useEffect(() => {
    if (brandsLoading) return;
    const rid = params.get('resource');
    const cid = params.get('comment');
    if (!rid) return;
    (async () => {
      const { data } = await supabase.from('resources').select('*').eq('id', rid).maybeSingle();
      const r = data as any as Resource | null;
      if (!r) return;
      // Jump to the right scope.
      if (r.scope === 'brand' && r.brand_id) setActiveScope(`b:${r.brand_id}`);
      else setActiveScope('general');
      setFeedbackResource({ ...r, pinned: !!(r as any).pinned, is_shared: !!(r as any).is_shared } as Resource);
      setHighlightCommentId(cid);
      notifications.forEach(n => {
        if (!n.read_at && n.payload?.resource_id === rid) markRead(n.id);
      });
      const next = new URLSearchParams(params);
      next.delete('resource'); next.delete('comment');
      setParams(next, { replace: true });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandsLoading]);

  const scope: ExplorerScope = useMemo(() => {
    if (activeScope.startsWith('b:')) return { kind: 'brand', brandId: activeScope.slice(2) };
    return { kind: 'general' };
  }, [activeScope]);

  const activeBrand = scope.kind === 'brand' ? brands.find(b => b.id === scope.brandId) : null;

  const addComment = async (body: string, authorName: string, parentId?: string) => {
    if (!feedbackResource || !profile) return;
    const { data, error } = await supabase.from('resource_comments').insert({
      resource_id: feedbackResource.id,
      parent_id: parentId ?? null,
      author_type: profile.role === 'bob' ? 'bob' : 'apc',
      author_name: authorName,
      body,
    }).select().single();
    if (error) throw error;
    setComments(prev => [...prev, data as ResourceComment]);
  };
  const commentCountFor = (id: string) => comments.filter(c => c.resource_id === id).length;

  const openAdd = (folderId: string | null) => {
    setEditing(null);
    setDefaultFolderId(folderId);
    setForm({ name: '', url: '', description: '' });
    setShow(true);
  };
  const openEdit = (r: Resource) => {
    setEditing(r);
    setForm({ name: r.name, url: r.url.replace(/^https?:\/\//, ''), description: r.description ?? '' });
    setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const fullUrl = form.url.startsWith('http') ? form.url : `https://${form.url}`;
    const payload: any = {
      name: form.name.trim(),
      url: fullUrl.trim(),
      description: form.description.trim() || null,
      scope: scope.kind,
      brand_id: scope.kind === 'brand' ? scope.brandId : null,
      created_by: user?.id,
    };
    if (!editing) payload.folder_id = defaultFolderId;
    const res = editing
      ? await supabase.from('resources').update(payload).eq('id', editing.id)
      : await supabase.from('resources').insert(payload);
    setSaving(false);
    if (res.error) alert(res.error.message);
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

  if (brandsLoading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  // APCs only see brand scopes they're assigned to (RLS filters `brands` already).
  // For Bob, surface General + every brand.
  const scopeChips: { key: ScopeKey; label: string; sub?: string; color: string }[] = [];
  if (!isApcLike) {
    scopeChips.push({ key: 'general', label: 'General', sub: 'Workspace-wide', color: '#64748b' });
  }
  brands.forEach(b => {
    scopeChips.push({ key: `b:${b.id}`, label: b.name, sub: 'Brand-specific', color: brandColor(b.id) });
  });

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Resources</h2>
      </div>

      {/* Scope chooser — chips, one per scope */}
      <Card className="mb-3 shadow-sm">
        <Card.Body className="py-2">
          <div className="d-flex flex-wrap gap-2">
            {scopeChips.map(s => {
              const active = activeScope === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveScope(s.key)}
                  className="border-0 rounded d-inline-flex align-items-center gap-2 px-3 py-2"
                  style={{
                    background: active ? 'rgba(232,134,46,.12)' : '#f8fafc',
                    border: active ? '1px solid rgba(232,134,46,.55)' : '1px solid #e9ecef',
                    boxShadow: active ? '0 0 0 1px rgba(232,134,46,.25)' : undefined,
                    transition: 'all .12s',
                  }}
                >
                  <span
                    style={{
                      width: 28, height: 28, borderRadius: 6,
                      background: s.color, color: '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: '.75rem',
                    }}
                  >
                    {s.key === 'general'
                      ? <i className="bi bi-globe" />
                      : brandInitials(s.label)}
                  </span>
                  <div className="text-start">
                    <div className="fw-semibold" style={{ fontSize: '.92rem' }}>{s.label}</div>
                    {s.sub && <div className="text-muted" style={{ fontSize: '.7rem' }}>{s.sub}</div>}
                  </div>
                </button>
              );
            })}
            {scopeChips.length === 0 && (
              <div className="text-muted small">No brands assigned yet.</div>
            )}
          </div>
        </Card.Body>
      </Card>

      {/* Explorer */}
      <FolderExplorer
        scope={scope}
        canEdit={!isAdsManager}
        reloadKey={reloadKey}
        onAddResource={openAdd}
        onEditResource={openEdit}
        onDeleteResource={remove}
        onCommentResource={(r) => { setFeedbackResource(r); setHighlightCommentId(null); }}
        renderResourceExtras={(r) => (
          <>
            <div className="mb-2 d-flex gap-1 flex-wrap">
              {activeBrand && <Badge bg="info">{activeBrand.name}</Badge>}
              {scope.kind === 'general' && <Badge bg="secondary">General</Badge>}
              {r.is_shared
                ? <Badge bg="success" className="d-inline-flex align-items-center gap-1">
                    <i className="bi bi-globe" /> Shared
                  </Badge>
                : <Badge bg="light" text="dark" className="d-inline-flex align-items-center gap-1">
                    <i className="bi bi-lock" /> Private
                  </Badge>}
              {commentCountFor(r.id) > 0 && (
                <Badge bg="primary" pill>
                  <i className="bi bi-chat-left-text me-1" />{commentCountFor(r.id)}
                </Badge>
              )}
            </div>
            {isBob && (
              <Form.Check
                type="switch"
                id={`share-${r.id}`}
                checked={!!r.is_shared}
                onChange={e => toggleShared(r, e.target.checked)}
                label={
                  <small className="text-muted">
                    Share with clients
                    {r.scope === 'brand' && !brands.find(b => b.id === r.brand_id)?.share_enabled && (
                      <span className="text-warning ms-1" title="Brand sharing is off — turn on the brand's master switch first.">
                        <i className="bi bi-exclamation-triangle-fill" />
                      </span>
                    )}
                  </small>
                }
              />
            )}
          </>
        )}
      />

      {/* Add / edit modal */}
      <Modal show={show} onHide={() => setShow(false)} centered size="lg">
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>
              <i className="bi bi-file-earmark-plus me-2" />
              {editing ? 'Edit resource' : 'Add resource'}
              <div className="text-muted small fw-normal mt-1">
                {scope.kind === 'general' ? 'General · Workspace-wide' : `Brand · ${activeBrand?.name ?? ''}`}
              </div>
            </Modal.Title>
          </Modal.Header>
          <Modal.Body>
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
                value={form.description}
                onChange={e => setForm({ ...form, description: e.target.value })} />
              <div className="text-end small text-muted mt-1">{form.description.length} / {DESC_MAX}</div>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              <i className="bi bi-check2 me-1" />
              {saving ? 'Saving…' : (editing ? 'Save' : 'Add resource')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Comments offcanvas */}
      <Offcanvas show={!!feedbackResource}
        onHide={() => { setFeedbackResource(null); setHighlightCommentId(null); }}
        placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            Client feedback
            {feedbackResource && <small className="text-muted ms-2 fw-normal">— {feedbackResource.name}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackResource && (
            <ResourceComments
              resourceId={feedbackResource.id}
              resourceName={feedbackResource.name}
              comments={comments}
              mode="authed"
              currentAuthorName={profile?.full_name || profile?.email || 'User'}
              onAdd={addComment}
              highlightCommentId={highlightCommentId ?? undefined}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
