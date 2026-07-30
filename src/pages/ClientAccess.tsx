import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Table, Spinner, Alert, Badge, InputGroup } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { resourceIcon } from '../lib/resourceIcon';

interface Client { id: string; name: string; }
interface Brand  { id: string; name: string; client_id: string | null; share_enabled: boolean; }
interface Resource { id: string; name: string; url: string; scope: 'general' | 'brand'; brand_id: string | null; is_shared: boolean; general_folder: string | null; }
type LinkMode = 'brand' | 'general';
interface Link {
  id: string; token: string; label: string | null; client_id: string;
  brand_ids: string[]; resource_ids: string[];
  include_reports: boolean; include_monthly_reports: boolean; include_resources: boolean;
  link_mode: LinkMode;
  created_at: string; revoked_at: string | null;
}

export default function ClientAccess() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [label, setLabel] = useState('');
  const [includeReports, setIncludeReports] = useState(true);
  const [includeMonthlyReports, setIncludeMonthlyReports] = useState(false);
  const [includeResources, setIncludeResources] = useState(true);
  const [linkMode, setLinkMode] = useState<LinkMode>('brand');
  const [pickedResourceIds, setPickedResourceIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [c, b, r, l] = await Promise.all([
      supabase.from('clients').select('id,name').order('name'),
      supabase.from('brands').select('id,name,client_id,share_enabled').order('name'),
      supabase.from('resources').select('id,name,url,scope,brand_id,is_shared,general_folder').order('name'),
      supabase.from('report_share_links').select('*').order('created_at', { ascending: false }),
    ]);
    const e = c.error ?? b.error ?? r.error ?? l.error;
    if (e) { setErr(e.message); setLoading(false); return; }
    setClients(c.data ?? []);
    setBrands(b.data ?? []);
    setResources((r.data as Resource[]) ?? []);
    setLinks((l.data as Link[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const clientMap = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);
  const brandMap  = useMemo(() => new Map(brands.map(b => [b.id, b])), [brands]);

  // Filter the share-link table by the header search box. Matches against
  // label, client, mode, brand names, included sections and status.
  const filteredLinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return links;
    return links.filter(l => {
      const mode: LinkMode = (l.link_mode as LinkMode) ?? 'brand';
      const brandNames = (l.brand_ids ?? []).map(id => brandMap.get(id)?.name ?? '').join(' ');
      const includes = [
        l.include_reports !== false ? 'weekly' : '',
        l.include_monthly_reports === true ? 'monthly' : '',
        l.include_resources !== false ? 'resources' : '',
      ].join(' ');
      const hay = [
        l.label ?? '',
        clientMap.get(l.client_id)?.name ?? '',
        mode === 'general' ? 'general files' : 'brand',
        brandNames,
        includes,
        l.revoked_at ? 'revoked' : 'active',
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [links, search, clientMap, brandMap]);
  const brandsForClient = useMemo(
    () => brands.filter(b => b.client_id === clientId),
    [brands, clientId],
  );
  const shareableForClient = useMemo(
    () => brandsForClient.filter(b => b.share_enabled),
    [brandsForClient],
  );
  const nonShareableForClient = useMemo(
    () => brandsForClient.filter(b => !b.share_enabled),
    [brandsForClient],
  );

  // Resources auto-included on this link: any is_shared resource that's general OR scoped to a linked brand.
  const autoIncludedResources = useMemo(() => {
    return resources.filter(r =>
      r.is_shared && (r.scope === 'general' || (r.brand_id && brandIds.includes(r.brand_id)))
    );
  }, [resources, brandIds]);

  const openAdd = () => {
    setEditingId(null);
    setClientId(''); setBrandIds([]); setLabel('');
    setIncludeReports(true); setIncludeMonthlyReports(false); setIncludeResources(true);
    setLinkMode('brand'); setPickedResourceIds([]);
    setErr(null); setShow(true);
  };

  const openEdit = (l: Link) => {
    setEditingId(l.id);
    setClientId(l.client_id);
    setBrandIds(l.brand_ids ?? []);
    setLabel(l.label ?? '');
    setIncludeReports(l.include_reports !== false);
    setIncludeMonthlyReports(l.include_monthly_reports === true);
    setIncludeResources(l.include_resources !== false);
    setLinkMode((l.link_mode as LinkMode) ?? 'brand');
    setPickedResourceIds(l.resource_ids ?? []);
    setErr(null);
    setShow(true);
  };

  const togglePickedResource = (id: string) => {
    setPickedResourceIds(arr => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };

  const generalResources = useMemo(
    () => resources.filter(r => r.scope === 'general'),
    [resources]
  );

  const toggle = (id: string) => {
    setBrandIds(arr => arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    if (linkMode === 'brand') {
      if (brandIds.length === 0) { setErr('Pick at least one brand'); setSaving(false); return; }
      if (!includeReports && !includeMonthlyReports && !includeResources) {
        setErr('Pick at least one of Weekly Reports / Monthly Reports / Resources — otherwise the client sees nothing.');
        setSaving(false); return;
      }
    } else if (linkMode === 'general') {
      if (pickedResourceIds.length === 0) {
        setErr('Pick at least one general resource to share.');
        setSaving(false); return;
      }
    }
    const payload = linkMode === 'brand'
      ? {
          label: label.trim() || null,
          client_id: clientId,
          link_mode: 'brand' as LinkMode,
          brand_ids: brandIds,
          resource_ids: [] as string[],   // auto-include drives brand-mode resource visibility
          include_reports: includeReports,
          include_monthly_reports: includeMonthlyReports,
          include_resources: includeResources,
        }
      : {
          label: label.trim() || null,
          client_id: clientId,
          link_mode: 'general' as LinkMode,
          brand_ids: [] as string[],
          resource_ids: pickedResourceIds,
          include_reports: false,
          include_monthly_reports: false,
          include_resources: true,
        };
    const res = editingId
      ? await supabase.from('report_share_links').update(payload).eq('id', editingId).select().single()
      : await supabase.from('report_share_links').insert({ ...payload, token: generateToken(), created_by: user?.id }).select().single();
    setSaving(false);
    if (res.error) { setErr(res.error.message); return; }
    const saved = res.data as Link;
    if (editingId) setLinks(links.map(l => l.id === saved.id ? saved : l));
    else setLinks([saved, ...links]);
    setShow(false);
  };

  const revoke = async (l: Link) => {
    if (!confirm('Revoke this link? Anyone using it will lose access.')) return;
    const revoked_at = new Date().toISOString();
    setLinks(links.map(x => x.id === l.id ? { ...x, revoked_at } : x));
    const { error } = await supabase.from('report_share_links')
      .update({ revoked_at }).eq('id', l.id);
    if (error) { alert(error.message); setLinks(links); }
  };

  const reactivate = async (l: Link) => {
    setLinks(links.map(x => x.id === l.id ? { ...x, revoked_at: null } : x));
    const { error } = await supabase.from('report_share_links')
      .update({ revoked_at: null }).eq('id', l.id);
    if (error) { alert(error.message); setLinks(links); }
  };

  const remove = async (l: Link) => {
    if (!confirm('Delete this link permanently?')) return;
    const prev = links;
    setLinks(links.filter(x => x.id !== l.id));
    const { error } = await supabase.from('report_share_links').delete().eq('id', l.id);
    if (error) { alert(error.message); setLinks(prev); }
  };

  const linkUrl = (token: string) => `${window.location.origin}/share/${token}`;

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
        <h2 className="mb-0">Client Access</h2>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <InputGroup size="sm" style={{ width: 280 }}>
            <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
            <Form.Control
              placeholder="Search links by label, client, brand…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <Button variant="outline-secondary" onClick={() => setSearch('')} title="Clear search">
                <i className="bi bi-x-lg" />
              </Button>
            )}
          </InputGroup>
          <Button onClick={openAdd}><i className="bi bi-link-45deg me-1" /> Create Share Link</Button>
        </div>
      </div>

      <Card>
        <Card.Body>
          {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
            : err ? <Alert variant="danger">{err}</Alert>
            : links.length === 0 ? <p className="text-muted text-center mb-0 py-4">No share links yet.</p>
            : filteredLinks.length === 0 ? <p className="text-muted text-center mb-0 py-4">No links match your search.</p>
            : (
              <Table hover responsive className="align-middle mb-0">
                <thead><tr>
                  <th>Label</th><th>Client</th><th>Mode</th><th>Scope</th><th>Includes</th><th>URL</th><th>Status</th><th style={{width:160}}></th>
                </tr></thead>
                <tbody>
                  {filteredLinks.map(l => {
                    const cl = clientMap.get(l.client_id);
                    const mode: LinkMode = (l.link_mode as LinkMode) ?? 'brand';
                    return (
                      <tr key={l.id}>
                        <td className="fw-semibold">{l.label || '—'}</td>
                        <td>{cl?.name ?? '—'}</td>
                        <td>
                          {mode === 'general'
                            ? <Badge bg="dark"><i className="bi bi-folder2-open me-1" />General files</Badge>
                            : <Badge bg="primary"><i className="bi bi-shop me-1" />Brand</Badge>}
                        </td>
                        <td>
                          {mode === 'general' ? (
                            <Badge bg="secondary">{l.resource_ids?.length ?? 0} file{(l.resource_ids?.length ?? 0) === 1 ? '' : 's'}</Badge>
                          ) : (
                            l.brand_ids.map(id => (
                              <Badge key={id} bg="info" className="me-1">{brandMap.get(id)?.name ?? '?'}</Badge>
                            ))
                          )}
                        </td>
                        <td>
                          {mode === 'general'
                            ? <Badge bg="warning" text="dark"><i className="bi bi-folder2 me-1" />Files only</Badge>
                            : (
                              <>
                                {l.include_reports !== false && <Badge bg="success" className="me-1"><i className="bi bi-bar-chart me-1" />Weekly</Badge>}
                                {l.include_monthly_reports === true && <Badge bg="info" className="me-1"><i className="bi bi-calendar-month me-1" />Monthly</Badge>}
                                {l.include_resources !== false && <Badge bg="warning" text="dark" className="me-1"><i className="bi bi-folder2 me-1" />Resources</Badge>}
                              </>
                            )}
                        </td>
                        <td>
                          <InputGroup size="sm">
                            <Form.Control readOnly value={linkUrl(l.token)} onFocus={e => (e.target as HTMLInputElement).select()} />
                            <Button variant="outline-secondary" onClick={() => { navigator.clipboard.writeText(linkUrl(l.token)); }}>
                              <i className="bi bi-clipboard" />
                            </Button>
                            <Button variant="outline-secondary" onClick={() => window.open(linkUrl(l.token), '_blank')}>
                              <i className="bi bi-box-arrow-up-right" />
                            </Button>
                          </InputGroup>
                        </td>
                        <td>
                          {l.revoked_at
                            ? <Badge bg="danger">Revoked</Badge>
                            : <Badge bg="success">Active</Badge>}
                        </td>
                        <td className="text-end">
                          <Button size="sm" variant="outline-primary" className="me-2" onClick={() => openEdit(l)}><i className="bi bi-pencil" /></Button>
                          {l.revoked_at
                            ? <Button size="sm" variant="outline-success" className="me-2" onClick={() => reactivate(l)}>Reactivate</Button>
                            : <Button size="sm" variant="outline-warning" className="me-2" onClick={() => revoke(l)}>Revoke</Button>}
                          <Button size="sm" variant="outline-danger" onClick={() => remove(l)}><i className="bi bi-trash" /></Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
        </Card.Body>
      </Card>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton><Modal.Title>{editingId ? 'Edit Share Link' : 'Create Share Link'}</Modal.Title></Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}

            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">Sharing mode</Form.Label>
              <div className="d-flex gap-2 flex-wrap">
                <ModePill
                  active={linkMode === 'brand'}
                  onClick={() => setLinkMode('brand')}
                  icon="bi-shop"
                  title="Brand sharing"
                  sub="Pick brands; reports & resources auto-include"
                />
                <ModePill
                  active={linkMode === 'general'}
                  onClick={() => setLinkMode('general')}
                  icon="bi-folder2-open"
                  title="General file sharing"
                  sub="Pick specific general resources to share"
                />
              </div>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Label (internal note)</Form.Label>
              <Form.Control value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Q2 review for Acme" />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Client</Form.Label>
              <Form.Select required value={clientId} onChange={e => { setClientId(e.target.value); setBrandIds([]); }}>
                <option value="">— Choose client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Form.Select>
            </Form.Group>

            {linkMode === 'general' && (
              <Form.Group>
                <Form.Label>
                  General resources to share
                  {pickedResourceIds.length > 0 && (
                    <Badge bg="info" pill className="ms-2">{pickedResourceIds.length} picked</Badge>
                  )}
                </Form.Label>
                {generalResources.length === 0 ? (
                  <Alert variant="info" className="py-2 small mb-0">
                    No general resources exist yet. Add some on the Resources page first.
                  </Alert>
                ) : (
                  <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--ac-border)', borderRadius: 6, padding: 10 }}>
                    {generalResources.map(r => {
                      const ic = resourceIcon(r.url);
                      const checked = pickedResourceIds.includes(r.id);
                      return (
                        <div key={r.id} className="d-flex align-items-center py-1"
                          style={{ background: checked ? 'rgba(252, 98, 21,.06)' : undefined, borderRadius: 6, padding: '4px 6px' }}>
                          <Form.Check type="checkbox" id={`g-${r.id}`}
                            checked={checked}
                            onChange={() => togglePickedResource(r.id)}
                            className="me-2" />
                          <i className={`bi ${ic.icon} me-2`} style={{ color: ic.color }} />
                          <label htmlFor={`g-${r.id}`} style={{ cursor: 'pointer', flex: 1 }}>
                            <span className="fw-semibold">{r.name}</span>
                            {r.general_folder && (
                              <span className="text-muted small ms-2">· {r.general_folder}</span>
                            )}
                            {!r.is_shared && (
                              <small className="text-warning ms-2" title="Resource isn't flagged is_shared. Turn on its share toggle on the Resources page or it will be filtered out.">
                                <i className="bi bi-exclamation-triangle-fill" />
                              </small>
                            )}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Form.Text className="text-muted">
                  Only the resources you check here will be visible on this link. The client won't see any brand-scoped reports or resources.
                </Form.Text>
              </Form.Group>
            )}

            {clientId && linkMode === 'brand' && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Brands to share</Form.Label>
                  {brandsForClient.length === 0 ? (
                    <p className="text-muted small mb-0">No brands linked to this client yet. Edit a brand and assign this client first.</p>
                  ) : shareableForClient.length === 0 ? (
                    <Alert variant="warning" className="py-2 small mb-0">
                      None of this client's brands have sharing enabled. Open a brand → Reporting tab and switch on "Sharing enabled" first.
                    </Alert>
                  ) : (
                    <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--ac-border)', borderRadius: 6, padding: 10 }}>
                      {shareableForClient.map(b => (
                        <Form.Check key={b.id} type="checkbox" id={`b-${b.id}`} label={b.name}
                          checked={brandIds.includes(b.id)} onChange={() => toggle(b.id)} />
                      ))}
                      {nonShareableForClient.length > 0 && (
                        <div className="text-muted small mt-2">
                          {nonShareableForClient.length} brand{nonShareableForClient.length === 1 ? '' : 's'} hidden — sharing disabled on the brand page.
                        </div>
                      )}
                    </div>
                  )}
                  <Form.Text className="text-muted">
                    Only weekly reports flagged "Shareable" on each brand will appear in the link.
                  </Form.Text>
                </Form.Group>

                {brandIds.length > 0 && (
                  <Form.Group className="mb-3">
                    <Form.Label className="fw-semibold">Share with this client</Form.Label>
                    <div className="border rounded p-2">
                      <Form.Check
                        type="switch"
                        id="include-reports"
                        label={<><strong>Weekly Reports</strong> <span className="text-muted small">— weekly performance dashboards</span></>}
                        checked={includeReports}
                        onChange={e => setIncludeReports(e.target.checked)}
                      />
                      <Form.Check
                        type="switch"
                        className="mt-2"
                        id="include-monthly-reports"
                        label={<><strong>Monthly Reports</strong> <span className="text-muted small">— monthly TikTok Shop reports</span></>}
                        checked={includeMonthlyReports}
                        onChange={e => setIncludeMonthlyReports(e.target.checked)}
                      />
                      <Form.Check
                        type="switch"
                        className="mt-2"
                        id="include-resources"
                        label={<><strong>Resources</strong> <span className="text-muted small">— links, docs, brand assets</span></>}
                        checked={includeResources}
                        onChange={e => setIncludeResources(e.target.checked)}
                      />
                    </div>
                    <Form.Text className="text-muted">
                      Turn off any to hide that section from this client. The others stay visible.
                    </Form.Text>
                  </Form.Group>
                )}

                {brandIds.length > 0 && includeResources && (
                  <Form.Group>
                    <Form.Label>Resources auto-included</Form.Label>
                    {autoIncludedResources.length === 0 ? (
                      <Alert variant="info" className="py-2 small mb-0">
                        No resources are flagged "Share with clients" yet. Open the Resources page (or a brand's Resources tab) and turn on the share toggle for the items you want clients to see.
                      </Alert>
                    ) : (
                      <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--ac-border)', borderRadius: 6, padding: 10 }}>
                        {autoIncludedResources.map(r => {
                          const ic = resourceIcon(r.url);
                          return (
                            <div key={r.id} className="d-flex align-items-center py-1">
                              <i className={`bi ${ic.icon} me-2`} style={{ color: ic.color }} />
                              <span className="fw-semibold flex-grow-1">{r.name}</span>
                              <span className="text-muted small">
                                {r.scope === 'general' ? 'General' : brands.find(b => b.id === r.brand_id)?.name}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <Form.Text className="text-muted">
                      Every resource flagged "Share with clients" is auto-included whenever it's general or its brand is on this link.
                      Toggle individual resources from the Resources page.
                    </Form.Text>
                  </Form.Group>
                )}
              </>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit"
              disabled={
                saving || !clientId ||
                (linkMode === 'brand' && brandIds.length === 0) ||
                (linkMode === 'general' && pickedResourceIds.length === 0)
              }>
              {saving ? 'Saving…' : (editingId ? 'Save changes' : 'Create link')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function ModePill({ active, onClick, icon, title, sub }: {
  active: boolean; onClick: () => void; icon: string; title: string; sub: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className="border rounded text-start px-3 py-2"
      style={{
        flex: 1, minWidth: 200,
        borderColor: active ? 'var(--ac-accent-base)' : 'var(--ac-border)',
        background: active ? 'var(--ac-accent-soft)' : 'var(--ac-surface-raised)',
        cursor: 'pointer',
        transition: 'all .15s',
      }}>
      <div className="d-flex align-items-center gap-2">
        <i className={`bi ${icon}`} style={{ fontSize: '1.1rem', color: active ? 'var(--ac-accent-base)' : 'var(--ac-text-secondary)' }} />
        <strong>{title}</strong>
      </div>
      <div className="text-muted small mt-1">{sub}</div>
    </button>
  );
}
