import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Form, InputGroup, Modal, Spinner } from 'react-bootstrap';
import { copyWithToast } from '../../lib/copyToast';
import BriefFrame from '../briefs/BriefFrame';
import {
  brandAccessDetails, briefShareUrl, deleteBrief, listBriefs, listVersions, loadVersionHtml,
  renameBrief, renameVersion, resetBriefShareToken, restoreVersion, setBriefShareEnabled,
  type BriefRow, type BriefVersion,
} from '../briefs/briefApi';
import '../briefs/briefs.css';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
};
const fileName = (name: string, v: number) =>
  `${name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'brief'}-v${v}.html`;
const versionName = (v: BriefVersion) => v.note?.trim() || 'Untitled version';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Click-to-rename text. Enter / blur saves, Escape cancels. */
function InlineName({ value, onSave, editing, setEditing, maxLength, className, placeholder }: {
  value: string;
  onSave: (next: string) => Promise<void>;
  editing: boolean;
  setEditing: (on: boolean) => void;
  maxLength: number;
  className?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const done = useRef(false);
  useEffect(() => { if (editing) { setDraft(value); done.current = false; } }, [editing, value]);
  if (!editing) return <span className={className}>{value || placeholder}</span>;
  const commit = async () => {
    if (done.current) return;
    done.current = true;
    const next = draft.trim();
    if (next === value.trim()) { setEditing(false); return; }
    setSaving(true);
    try { await onSave(next); setEditing(false); }
    catch { done.current = false; }
    finally { setSaving(false); }
  };
  return (
    <Form.Control
      size="sm"
      autoFocus
      className="ac-bx-rename"
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      disabled={saving}
      onChange={e => setDraft(e.target.value)}
      onClick={e => e.stopPropagation()}
      onFocus={e => e.currentTarget.select()}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { done.current = true; setEditing(false); }
      }}
      onBlur={commit}
    />
  );
}

type Confirm = { title: string; body: string; action: string; danger?: boolean; run: () => Promise<void> } | null;

/**
 * Content briefs for one brand — used by Brand Detail → Briefs and /briefs.
 * Claude writes the HTML (Supabase MCP → save_content_brief); this view lists
 * briefs with their versions, shows one in a sandboxed frame, and handles
 * rename (brief + version), restore, share, download and delete.
 * canEdit = Bob + the brand's Team Lead (RLS mirrors this).
 */
export default function BrandBriefsTab({ brandId, brandName, canEdit, onCountChange }: {
  brandId: string;
  brandName: string;
  canEdit: boolean;
  onCountChange?: (n: number) => void;
}) {
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [versions, setVersions] = useState<BriefVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [html, setHtml] = useState<string | null>(null);
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null); // brief id or `v:<version id>`
  const [confirm, setConfirm] = useState<Confirm>(null);
  const htmlCache = useRef(new Map<string, string>());

  const selected = briefs.find(b => b.id === selectedId) ?? null;
  const byBrief = useMemo(() => {
    const m = new Map<string, BriefVersion[]>();
    for (const v of versions) m.set(v.brief_id, [...(m.get(v.brief_id) ?? []), v]);
    return m;
  }, [versions]);
  const selVersions = selected ? byBrief.get(selected.id) ?? [] : [];
  const viewing = selVersions.find(v => v.version === viewVersion) ?? null;

  const load = useCallback(async (opts?: { keepId?: string | null; quiet?: boolean }) => {
    if (opts?.quiet) setRefreshing(true);
    try {
      const rows = await listBriefs(brandId);
      const vs = await listVersions(rows.map(r => r.id));
      setBriefs(rows);
      setVersions(vs);
      onCountChange?.(rows.length);
      setSelectedId(prev => {
        const want = opts?.keepId !== undefined ? opts.keepId : prev;
        return want && rows.some(r => r.id === want) ? want : rows[0]?.id ?? null;
      });
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [brandId, onCountChange]);

  useEffect(() => {
    setLoading(true); setSelectedId(null); setExpanded(new Set()); htmlCache.current.clear();
    load({ keepId: null });
  }, [brandId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coming back from Claude → pick up anything it just saved.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load({ quiet: true }); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // A newly selected brief (or a new current version) opens on its newest version.
  useEffect(() => {
    if (!selected) { setViewVersion(null); return; }
    setViewVersion(selected.current_version);
    setExpanded(s => (s.has(selected.id) ? s : new Set(s).add(selected.id)));
  }, [selected?.id, selected?.current_version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected || !viewVersion) { setHtml(null); return; }
    const key = `${selected.id}:${viewVersion}`;
    const hit = htmlCache.current.get(key);
    if (hit !== undefined) { setHtml(hit); return; }
    let alive = true;
    setHtmlLoading(true);
    loadVersionHtml(selected.id, viewVersion)
      .then(h => { htmlCache.current.set(key, h); if (alive) setHtml(h); })
      .catch(e => { if (alive) setErr(e?.message ?? String(e)); })
      .finally(() => { if (alive) setHtmlLoading(false); });
    return () => { alive = false; };
  }, [selected?.id, viewVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchBrief = (id: string, p: Partial<BriefRow>) =>
    setBriefs(bs => bs.map(b => (b.id === id ? { ...b, ...p } : b)));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e: any) { setErr(e?.message ?? String(e)); throw e; } finally { setBusy(false); }
  };

  const toggleExpanded = (id: string) =>
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pickBrief = (b: BriefRow) => {
    if (b.id === selectedId) { toggleExpanded(b.id); return; }
    setSelectedId(b.id);
  };
  const pickVersion = (b: BriefRow, v: number) => { setSelectedId(b.id); setViewVersion(v); };

  const saveBriefName = (b: BriefRow) => (name: string) => run(async () => {
    if (!name) throw new Error('A brief needs a name.');
    await renameBrief(b.id, name);
    patchBrief(b.id, { name });
  });
  const saveVersionName = (v: BriefVersion) => (name: string) => run(async () => {
    await renameVersion(v.id, name);
    setVersions(vs => vs.map(x => (x.id === v.id ? { ...x, note: name || null } : x)));
  });

  const toggleShare = (next: boolean) => selected && run(async () => {
    await setBriefShareEnabled(selected.id, next);
    patchBrief(selected.id, { share_enabled: next });
  }).catch(() => {});

  const askRotate = () => selected && setConfirm({
    title: 'Make a new link?',
    body: 'The current link will stop working for anyone who already has it.',
    action: 'Make new link',
    run: async () => { const token = await resetBriefShareToken(selected.id); patchBrief(selected.id, { share_token: token }); },
  });

  const askDelete = () => selected && setConfirm({
    title: `Delete “${selected.name}”?`,
    body: `This removes the brief and all ${plural(selVersions.length, 'version')}. Its share link will stop working. This can't be undone.`,
    action: 'Delete brief',
    danger: true,
    run: async () => { await deleteBrief(selected.id); await load({ keepId: null }); },
  });

  const askRestore = () => selected && viewing && setConfirm({
    title: `Restore v${viewing.version}?`,
    body: `“${versionName(viewing)}” is saved again as a new current version (v${selected.current_version + 1}). Nothing is deleted.`,
    action: 'Restore',
    run: async () => { await restoreVersion(selected, viewing.version); await load({ keepId: selected.id }); },
  });

  const download = () => {
    if (!selected || !html || !viewVersion) return;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName(selected.name, viewVersion); a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyDetails = () => copyWithToast(brandAccessDetails(brandId, brandName), 'Text');

  if (loading) return <div className="ac-bx ac-bx-loading"><Spinner animation="border" /></div>;

  const isOld = !!selected && !!viewVersion && viewVersion !== selected.current_version;
  const shareUrl = selected ? briefShareUrl(selected.share_token) : '';

  return (
    <>
      {err && <Alert variant="danger" dismissible onClose={() => setErr(null)} className="mb-3">{err}</Alert>}

      <div className="ac-bx">
        {/* ── Left: briefs with their versions ── */}
        <aside className="ac-bx-side">
          <div className="ac-bx-side-head">
            <div>
              <div className="ac-bx-side-title">Briefs</div>
              <div className="ac-bx-side-sub">{briefs.length ? plural(briefs.length, 'brief') : 'Designed by Claude'}</div>
            </div>
            <div className="d-flex gap-1">
              <button type="button" className="ac-bx-icon" onClick={() => load({ quiet: true })} title="Refresh" aria-label="Refresh">
                <i className={`bi bi-arrow-clockwise${refreshing ? ' ac-bx-spin' : ''}`} />
              </button>
              {canEdit && (
                <button type="button" className="ac-bx-icon" onClick={copyDetails} title="Copy brand details for Claude" aria-label="Copy brand details">
                  <i className="bi bi-clipboard" />
                </button>
              )}
            </div>
          </div>

          {briefs.length === 0 ? (
            <div className="ac-bx-side-empty">No briefs yet</div>
          ) : (
            <ul className="ac-bx-tree">
              {briefs.map(b => {
                const vs = byBrief.get(b.id) ?? [];
                const open = expanded.has(b.id);
                const active = b.id === selectedId;
                return (
                  <li key={b.id} className={`ac-bx-brief${active ? ' is-active' : ''}`}>
                    <div className="ac-bx-brief-row" role="button" tabIndex={0}
                      onClick={() => pickBrief(b)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickBrief(b); } }}>
                      <button type="button" className="ac-bx-chevron" aria-label={open ? 'Hide versions' : 'Show versions'}
                        onClick={e => { e.stopPropagation(); toggleExpanded(b.id); }}>
                        <i className={`bi bi-chevron-${open ? 'down' : 'right'}`} />
                      </button>
                      <div className="ac-bx-brief-text">
                        <InlineName
                          className="ac-bx-brief-name"
                          value={b.name}
                          maxLength={200}
                          editing={renaming === b.id}
                          setEditing={on => setRenaming(on ? b.id : null)}
                          onSave={saveBriefName(b)}
                        />
                        <span className="ac-bx-brief-meta">
                          {plural(vs.length, 'version')} · {fmtDate(b.updated_at)}
                          {b.share_enabled && <span className="ac-bx-public"><i className="bi bi-globe2" />Public</span>}
                        </span>
                      </div>
                      {canEdit && renaming !== b.id && (
                        <button type="button" className="ac-bx-edit" title="Rename brief" aria-label="Rename brief"
                          onClick={e => { e.stopPropagation(); setRenaming(b.id); }}>
                          <i className="bi bi-pencil" />
                        </button>
                      )}
                    </div>

                    {open && (
                      <ol className="ac-bx-versions">
                        {vs.map(v => {
                          const on = active && v.version === viewVersion;
                          const key = `v:${v.id}`;
                          return (
                            <li key={v.id} className={`ac-bx-version${on ? ' is-on' : ''}`}>
                              <div className="ac-bx-version-row" role="button" tabIndex={0}
                                onClick={() => pickVersion(b, v.version)}
                                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickVersion(b, v.version); } }}>
                                <span className="ac-bx-dot" />
                                <div className="ac-bx-version-text">
                                  <span className="ac-bx-version-top">
                                    <span className="ac-bx-vnum">v{v.version}</span>
                                    {v.version === b.current_version && <span className="ac-bx-current">Current</span>}
                                  </span>
                                  <InlineName
                                    className={`ac-bx-version-name${v.note?.trim() ? '' : ' is-untitled'}`}
                                    value={v.note ?? ''}
                                    placeholder="Untitled version"
                                    maxLength={120}
                                    editing={renaming === key}
                                    setEditing={on2 => setRenaming(on2 ? key : null)}
                                    onSave={saveVersionName(v)}
                                  />
                                  <span className="ac-bx-version-date">{fmtWhen(v.created_at)}</span>
                                </div>
                                {canEdit && renaming !== key && (
                                  <button type="button" className="ac-bx-edit" title="Rename version" aria-label="Rename version"
                                    onClick={e => { e.stopPropagation(); setRenaming(key); }}>
                                    <i className="bi bi-pencil" />
                                  </button>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Right: the selected version ── */}
        <section className="ac-bx-main">
          {!selected ? (
            <div className="ac-bx-empty">
              <div className="ac-bx-empty-icon"><i className="bi bi-file-earmark-richtext" /></div>
              <h3>No briefs for {brandName} yet</h3>
              {canEdit ? (
                <>
                  <p>Claude designs each brief from scratch, with whatever layout fits.</p>
                  <ol className="ac-bx-steps">
                    <li><span>1</span>Copy the brand details below</li>
                    <li><span>2</span>Paste them into Claude (Supabase connector on) and say what you want</li>
                    <li><span>3</span>Come back here, and the brief shows up on its own</li>
                  </ol>
                  <Button variant="primary" onClick={copyDetails}><i className="bi bi-clipboard me-2" />Copy brand details</Button>
                </>
              ) : (
                <p>Briefs show up here once Bob or the brand's Team Lead creates them.</p>
              )}
            </div>
          ) : (
            <>
              <header className="ac-bx-head">
                <div className="ac-bx-head-text">
                  <h2 className="ac-bx-title">{selected.name}</h2>
                  <div className="ac-bx-sub">
                    {viewing ? (
                      <>
                        <span className={`ac-bx-chip${isOld ? ' is-old' : ' is-current'}`}>
                          v{viewing.version} · {isOld ? 'Older version' : 'Current'}
                        </span>
                        <span className="text-truncate">{versionName(viewing)}</span>
                        <span className="ac-bx-sep">·</span>
                        <span>{fmtWhen(viewing.created_at)}</span>
                      </>
                    ) : <span>&nbsp;</span>}
                  </div>
                </div>
                <div className="ac-bx-actions">
                  {canEdit && (
                    <Dropdown align="end" autoClose="outside">
                      <Dropdown.Toggle size="sm" variant={selected.share_enabled ? 'outline-success' : 'outline-secondary'} className="ac-bx-nocaret">
                        <i className={`bi ${selected.share_enabled ? 'bi-globe2' : 'bi-share'} me-1`} />
                        {selected.share_enabled ? 'Shared' : 'Share'}
                      </Dropdown.Toggle>
                      <Dropdown.Menu className="ac-bx-share-menu">
                        <div className="ac-bx-share-title">Public link</div>
                        <p className="ac-bx-share-help">Anyone with the link sees the <strong>current</strong> version, with no sign-in.</p>
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
                            <Button variant="link" size="sm" className="p-0 mt-2" onClick={askRotate} disabled={busy}>
                              <i className="bi bi-arrow-repeat me-1" />Make a new link
                            </Button>
                          </>
                        )}
                      </Dropdown.Menu>
                    </Dropdown>
                  )}
                  <Button size="sm" variant="outline-secondary" onClick={() => setFullscreen(true)} disabled={!html} title="Full screen" aria-label="Full screen">
                    <i className="bi bi-arrows-fullscreen" />
                  </Button>
                  <Button size="sm" variant="outline-secondary" onClick={download} disabled={!html} title="Download .html" aria-label="Download">
                    <i className="bi bi-download" />
                  </Button>
                  <Dropdown align="end">
                    <Dropdown.Toggle size="sm" variant="outline-secondary" className="ac-bx-nocaret" aria-label="More">
                      <i className="bi bi-three-dots" />
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                      <Dropdown.Item onClick={() => copyWithToast(selected.id, 'Text')}>
                        <i className="bi bi-hash me-2" />Copy brief id
                      </Dropdown.Item>
                      {canEdit && (
                        <>
                          <Dropdown.Item onClick={copyDetails}><i className="bi bi-clipboard me-2" />Copy brand details</Dropdown.Item>
                          <Dropdown.Item onClick={() => setRenaming(selected.id)}><i className="bi bi-pencil me-2" />Rename brief</Dropdown.Item>
                          {viewing && (
                            <Dropdown.Item onClick={() => { setExpanded(s => new Set(s).add(selected.id)); setRenaming(`v:${viewing.id}`); }}>
                              <i className="bi bi-input-cursor-text me-2" />Rename v{viewing.version}
                            </Dropdown.Item>
                          )}
                          <Dropdown.Divider />
                          <Dropdown.Item className="text-danger" onClick={askDelete}><i className="bi bi-trash me-2" />Delete brief</Dropdown.Item>
                        </>
                      )}
                    </Dropdown.Menu>
                  </Dropdown>
                </div>
              </header>

              {isOld && (
                <div className="ac-bx-oldbar">
                  <i className="bi bi-clock-history" />
                  <span>You're viewing an older version. The share link still shows v{selected.current_version}.</span>
                  <div className="ms-auto d-flex gap-2">
                    <Button size="sm" variant="link" onClick={() => setViewVersion(selected.current_version)}>View current</Button>
                    {canEdit && <Button size="sm" variant="primary" onClick={askRestore} disabled={busy}>Restore this version</Button>}
                  </div>
                </div>
              )}

              <div className="ac-bx-stage">
                {htmlLoading || html === null
                  ? <div className="ac-bx-stage-loading"><Spinner animation="border" /></div>
                  : <BriefFrame html={html} title={selected.name} className="ac-bx-frame" />}
              </div>
            </>
          )}
        </section>
      </div>

      <Modal show={fullscreen && !!html} onHide={() => setFullscreen(false)} fullscreen>
        <Modal.Header closeButton>
          <Modal.Title className="fs-6">{selected?.name} · v{viewVersion}{viewing?.note ? ` · ${viewing.note}` : ''}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="p-0">
          {html && selected && <BriefFrame html={html} title={selected.name} className="ac-bx-frame-full" />}
        </Modal.Body>
      </Modal>

      <Modal show={!!confirm} onHide={() => !busy && setConfirm(null)} centered>
        <Modal.Header closeButton={!busy}><Modal.Title className="fs-5">{confirm?.title}</Modal.Title></Modal.Header>
        <Modal.Body>{confirm?.body}</Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setConfirm(null)} disabled={busy}>Cancel</Button>
          <Button
            variant={confirm?.danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() => confirm && run(confirm.run).then(() => setConfirm(null)).catch(() => setConfirm(null))}
          >
            {busy && <Spinner size="sm" animation="border" className="me-2" />}{confirm?.action}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
