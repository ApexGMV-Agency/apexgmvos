import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Dropdown, Form, InputGroup, Modal, Spinner } from 'react-bootstrap';
import { copyWithToast } from '../../lib/copyToast';
import BriefFrame from '../briefs/BriefFrame';
import {
  briefShareUrl, claudeBriefPrompt, deleteBrief, listBriefs, listVersions, loadVersionHtml,
  renameBrief, resetBriefShareToken, restoreVersion, setBriefShareEnabled,
  type BriefRow, type BriefVersion,
} from '../briefs/briefApi';
import '../briefs/briefs.css';

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};

const fileName = (name: string, v: number) =>
  `${name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'brief'}-v${v}.html`;

/**
 * Brand Detail → Briefs tab (?tab=briefs). Briefs are written by Claude (via
 * the Supabase MCP) — this tab shows them in a sandboxed frame and handles
 * versions, sharing, rename and delete. canEdit = Bob + the brand's Team Lead.
 */
export default function BrandBriefsTab({ brandId, brandName, canEdit }: {
  brandId: string;
  brandName: string;
  canEdit: boolean;
}) {
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [versions, setVersions] = useState<BriefVersion[]>([]);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);

  const selected = briefs.find(b => b.id === selectedId) ?? null;

  const load = useCallback(async (keepId?: string | null) => {
    setErr(null);
    try {
      const rows = await listBriefs(brandId);
      setBriefs(rows);
      setSelectedId(prev => {
        const want = keepId ?? prev;
        return rows.some(r => r.id === want) ? want! : rows[0]?.id ?? null;
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [brandId]);

  useEffect(() => { setLoading(true); setSelectedId(null); load(null); }, [brandId, load]);

  // Versions of the selected brief; jump to the newest whenever it changes.
  useEffect(() => {
    if (!selected) { setVersions([]); setViewVersion(null); return; }
    let alive = true;
    listVersions(selected.id)
      .then(v => { if (alive) { setVersions(v); setViewVersion(selected.current_version); } })
      .catch(e => { if (alive) setErr(e?.message ?? String(e)); });
    return () => { alive = false; };
  }, [selected?.id, selected?.current_version]);

  useEffect(() => {
    if (!selected || !viewVersion) { setHtml(null); return; }
    let alive = true;
    setHtmlLoading(true);
    loadVersionHtml(selected.id, viewVersion)
      .then(h => { if (alive) setHtml(h); })
      .catch(e => { if (alive) setErr(e?.message ?? String(e)); })
      .finally(() => { if (alive) setHtmlLoading(false); });
    return () => { alive = false; };
  }, [selected?.id, viewVersion]);

  const patch = (id: string, p: Partial<BriefRow>) =>
    setBriefs(bs => bs.map(b => (b.id === id ? { ...b, ...p } : b)));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e?.message ?? String(e)); } finally { setBusy(false); }
  };

  const toggleShare = (next: boolean) => selected && run(async () => {
    await setBriefShareEnabled(selected.id, next);
    patch(selected.id, { share_enabled: next });
  });

  const rotate = () => selected && run(async () => {
    if (!window.confirm('Make a new link? The current link will stop working for anyone who has it.')) return;
    const token = await resetBriefShareToken(selected.id);
    patch(selected.id, { share_token: token });
  });

  const rename = () => selected && run(async () => {
    const name = window.prompt('Brief name', selected.name)?.trim();
    if (!name || name === selected.name) return;
    await renameBrief(selected.id, name);
    patch(selected.id, { name });
  });

  const remove = () => selected && run(async () => {
    if (!window.confirm(`Delete "${selected.name}" and all ${versions.length} version${versions.length === 1 ? '' : 's'}? Its share link will stop working.`)) return;
    await deleteBrief(selected.id);
    await load(null);
  });

  const restore = () => selected && viewVersion && run(async () => {
    await restoreVersion(selected, viewVersion);
    await load(selected.id);
  });

  const download = () => {
    if (!selected || !html || !viewVersion) return;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName(selected.name, viewVersion); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyPrompt = () => copyWithToast(claudeBriefPrompt(brandId, brandName), 'Text');

  if (loading) return <div className="text-center py-4"><Spinner animation="border" /></div>;

  const isOld = !!selected && !!viewVersion && viewVersion !== selected.current_version;
  const shareUrl = selected ? briefShareUrl(selected.share_token) : '';

  return (
    <>
      {err && <Alert variant="danger" dismissible onClose={() => setErr(null)}>{err}</Alert>}

      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <span className="fw-semibold">Content Briefs</span>
            <small className="text-muted ms-2">Designed by Claude, any structure. Ask Claude for a new one or for changes.</small>
          </div>
          <div className="d-flex gap-2">
            <Button size="sm" variant="outline-secondary" onClick={() => load(selectedId)} title="Reload — pick up briefs Claude just saved">
              <i className="bi bi-arrow-clockwise" />
            </Button>
            {canEdit && (
              <Button size="sm" variant="primary" onClick={copyPrompt}>
                <i className="bi bi-stars me-1" />Copy Claude prompt
              </Button>
            )}
          </div>
        </Card.Header>

        {briefs.length === 0 ? (
          <Card.Body>
            <div className="ac-brief-blank">
              <i className="bi bi-file-earmark-richtext" />
              <h3>No briefs yet</h3>
              {canEdit ? (
                <p>
                  Click <strong>Copy Claude prompt</strong>, paste it into Claude (with the Supabase connector on),
                  and add what you want, e.g. <em>"launch brief, focus on the serum, bold style"</em>.
                  Claude saves it here; hit reload to see it.
                </p>
              ) : (
                <p>Briefs for {brandName} will show up here once Bob or the Team Lead creates them.</p>
              )}
            </div>
          </Card.Body>
        ) : (
          <div className="ac-brief-layout">
            <div className="ac-brief-list">
              {briefs.map(b => (
                <button
                  key={b.id}
                  type="button"
                  className={`ac-brief-item${b.id === selectedId ? ' is-active' : ''}`}
                  onClick={() => setSelectedId(b.id)}
                >
                  <span className="ac-brief-item-name">{b.name}</span>
                  <span className="ac-brief-item-meta">
                    v{b.current_version} · {fmtWhen(b.updated_at)}
                    {b.share_enabled && <i className="bi bi-globe2 ms-1" title="Public link is on" />}
                  </span>
                </button>
              ))}
            </div>

            {selected && (
              <div className="ac-brief-main">
                <div className="ac-brief-toolbar">
                  <Form.Select
                    size="sm"
                    className="ac-brief-version"
                    value={viewVersion ?? ''}
                    onChange={e => setViewVersion(Number(e.target.value))}
                    aria-label="Version"
                  >
                    {versions.map(v => (
                      <option key={v.id} value={v.version}>
                        v{v.version}{v.version === selected.current_version ? ' (current)' : ''} · {fmtWhen(v.created_at)}{v.note ? ` · ${v.note}` : ''}
                      </option>
                    ))}
                  </Form.Select>
                  {isOld && canEdit && (
                    <Button size="sm" variant="outline-primary" disabled={busy} onClick={restore}>
                      <i className="bi bi-arrow-counterclockwise me-1" />Restore this version
                    </Button>
                  )}
                  <div className="ms-auto d-flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline-secondary" onClick={() => setFullscreen(true)} disabled={!html} title="Full screen">
                      <i className="bi bi-arrows-fullscreen" />
                    </Button>
                    <Button size="sm" variant="outline-secondary" onClick={download} disabled={!html} title="Download .html">
                      <i className="bi bi-download" />
                    </Button>
                    {canEdit && (
                      <Dropdown align="end" autoClose="outside">
                        <Dropdown.Toggle size="sm" variant="outline-secondary">
                          <i className="bi bi-share me-1" />Share
                        </Dropdown.Toggle>
                        <Dropdown.Menu className="ac-brief-share-menu">
                          <div className="fw-semibold mb-1">Public link</div>
                          <p className="small text-muted mb-2">Anyone with the link sees the current version, no sign-in needed.</p>
                          <Form.Check
                            type="switch"
                            id={`brief-share-${selected.id}`}
                            checked={selected.share_enabled}
                            disabled={busy}
                            onChange={e => toggleShare(e.currentTarget.checked)}
                            label={selected.share_enabled ? 'Link is on' : 'Link is off'}
                          />
                          {selected.share_enabled && (
                            <>
                              <InputGroup size="sm" className="mt-2">
                                <Form.Control readOnly value={shareUrl} onFocus={e => e.currentTarget.select()} aria-label="Share link" />
                                <Button variant="outline-secondary" onClick={() => copyWithToast(shareUrl, 'Link')} title="Copy link"><i className="bi bi-clipboard" /></Button>
                                <Button variant="outline-secondary" href={shareUrl} target="_blank" rel="noopener noreferrer" title="Open"><i className="bi bi-box-arrow-up-right" /></Button>
                              </InputGroup>
                              <Button variant="link" size="sm" className="p-0 mt-2" onClick={rotate} disabled={busy}>
                                <i className="bi bi-arrow-repeat me-1" />Make a new link
                              </Button>
                            </>
                          )}
                        </Dropdown.Menu>
                      </Dropdown>
                    )}
                    {canEdit && (
                      <Dropdown align="end">
                        <Dropdown.Toggle size="sm" variant="outline-secondary" className="ac-brief-more" aria-label="More">
                          <i className="bi bi-three-dots" />
                        </Dropdown.Toggle>
                        <Dropdown.Menu>
                          <Dropdown.Item onClick={() => copyWithToast(selected.id, 'Text')}>
                            <i className="bi bi-hash me-2" />Copy brief id (for Claude edits)
                          </Dropdown.Item>
                          <Dropdown.Item onClick={rename}><i className="bi bi-pencil me-2" />Rename</Dropdown.Item>
                          <Dropdown.Divider />
                          <Dropdown.Item className="text-danger" onClick={remove}><i className="bi bi-trash me-2" />Delete</Dropdown.Item>
                        </Dropdown.Menu>
                      </Dropdown>
                    )}
                  </div>
                </div>

                <div className="ac-brief-stage">
                  {htmlLoading || html === null
                    ? <div className="text-center py-5"><Spinner animation="border" /></div>
                    : <BriefFrame html={html} title={selected.name} className="ac-brief-frame" />}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <Modal show={fullscreen && !!html} onHide={() => setFullscreen(false)} fullscreen>
        <Modal.Header closeButton>
          <Modal.Title className="fs-6">{selected?.name} · v{viewVersion}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          {html && selected && <BriefFrame html={html} title={selected.name} className="ac-brief-frame-full" />}
        </Modal.Body>
      </Modal>
    </>
  );
}
