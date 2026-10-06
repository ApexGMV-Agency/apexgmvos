import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Dropdown, Form, InputGroup, Spinner } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { copyWithToast } from '../../lib/copyToast';
import SopSectionsView, { sopWordCount } from './SopSectionsView';
import SopSectionsEditor from './SopSectionsEditor';
import { downloadSopPdf } from './sopPdf';
import {
  createSop, deleteSop, loadSop, resetShareToken, saveSop, setShareEnabled, sopShareUrl,
  type SopRow,
} from './sopApi';
import { EMPTY_LIVE, loadSopLive, sopHeading, type SopLive, type SopSection } from './sopSections';

const brandInitials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * The SOP document for one brand: header, share bar, View/Edit switch, PDF
 * download and the autosave queue. Shared by the Brand Detail tab and /sops.
 *
 * NEVER give this component a `key`: switching brand would remount it in the
 * middle of a debounce and drop the pending write. Instead a brandId change
 * flushes the queue (the pending payload carries its own SOP id) and reloads.
 */
export default function SopDocPane({ brandId, brandName, canEdit }: {
  brandId: string;
  brandName: string;
  canEdit: boolean;
}) {
  const { user } = useAuth();
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;

  const [sop, setSop] = useState<SopRow | null>(null);
  const [live, setLive] = useState<SopLive>(EMPTY_LIVE);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const viewRef = useRef<HTMLDivElement>(null);

  /* ── autosave: 1.2s debounce, writes serialised on one promise chain ── */
  const pendingRef = useRef<{ id: string; sections: SopSection[] } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const snap = pendingRef.current;
    pendingRef.current = null;
    if (!snap) return chainRef.current;
    setSaveState('saving');
    chainRef.current = chainRef.current.then(async () => {
      try {
        const stamp = await saveSop(snap.id, snap.sections, userIdRef.current);
        setSop(cur => (cur && cur.id === snap.id ? { ...cur, ...stamp } : cur));
        if (!pendingRef.current) setSaveState('saved');
      } catch (e: any) {
        // Put the failed payload back unless something newer replaced it.
        if (!pendingRef.current) pendingRef.current = snap;
        setSaveState('error');
        setErr(`Couldn't save: ${e?.message ?? e}`);
      }
    });
    return chainRef.current;
  }, []);

  const queueSave = (id: string, sections: SopSection[]) => {
    pendingRef.current = { id, sections };  // snapshotted now — state may move on
    setSaveState('pending');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush(); }, 1200);
  };

  // Flush on unmount and when the tab/window is closing.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!pendingRef.current) return;
      void flush();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); void flush(); };
  }, [flush]);

  /* ── load (and reload on brand switch) ── */
  const loadSeq = useRef(0);
  useEffect(() => {
    void flush();
    const seq = ++loadSeq.current;
    setMode('view'); setErr(null); setSaveState('idle'); setLoading(true);
    (async () => {
      try {
        const [row, liveData] = await Promise.all([loadSop(brandId), loadSopLive(brandId)]);
        if (seq !== loadSeq.current) return;
        setSop(row); setLive(liveData);
      } catch (e: any) {
        if (seq === loadSeq.current) setErr(e?.message ?? String(e));
      } finally {
        if (seq === loadSeq.current) setLoading(false);
      }
    })();
  }, [brandId, flush]);

  // Re-read live data when switching back to View, so edits made on other tabs show.
  const brandIdRef = useRef(brandId);
  brandIdRef.current = brandId;
  const refreshLive = async () => {
    const id = brandId;
    const data = await loadSopLive(id).catch(() => null);
    if (data && id === brandIdRef.current) setLive(data);
  };

  const onSectionsChange = (next: SopSection[]) => {
    if (!sop) return;
    setSop({ ...sop, sections: next });
    queueSave(sop.id, next);
  };

  const create = async () => {
    setBusy(true); setErr(null);
    try { setSop(await createSop(brandId, user?.id)); setMode('edit'); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
    finally { setBusy(false); }
  };

  const toggleShare = async (next: boolean) => {
    if (!sop) return;
    const prev = sop.share_enabled;
    setSop({ ...sop, share_enabled: next });
    try { await setShareEnabled(sop.id, next); }
    catch (e: any) { setSop(s => (s ? { ...s, share_enabled: prev } : s)); setErr(e?.message ?? String(e)); }
  };

  const rotate = async () => {
    if (!sop) return;
    if (!window.confirm('Make a new link? The current link will stop working for everyone who has it.')) return;
    try { const token = await resetShareToken(sop.id); setSop(s => (s ? { ...s, share_token: token } : s)); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  };

  const remove = async () => {
    if (!sop) return;
    if (!window.confirm(`Delete the SOP for ${brandName}? Everything written in it will be lost, and its share link will stop working.`)) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    await chainRef.current;
    try { await deleteSop(sop.id); setSop(null); setMode('view'); setSaveState('idle'); }
    catch (e: any) { setErr(e?.message ?? String(e)); }
  };

  const pdf = async () => {
    setPrinting(true);
    try {
      // Let the .ac-sop-printing layout paint before capturing.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (viewRef.current) {
        const safe = brandName.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'brand';
        await downloadSopPdf(viewRef.current, `${safe}-SOP.pdf`);
      }
    } catch (e: any) {
      setErr(`PDF failed: ${e?.message ?? e}`);
    } finally {
      setPrinting(false);
    }
  };

  const switchMode = (m: 'view' | 'edit') => {
    if (m === mode) return;
    if (m === 'view') { void flush(); void refreshLive(); }
    setMode(m);
  };

  // Who last edited — resolved from profiles; RLS may hide it, then it's omitted.
  const [editorName, setEditorName] = useState<string | null>(null);
  const editorId = sop?.updated_by ?? null;
  useEffect(() => {
    setEditorName(null);
    if (!editorId) return;
    let alive = true;
    supabase.from('profiles').select('full_name,email').eq('id', editorId).maybeSingle()
      .then(({ data }) => { if (alive && data) setEditorName((data as any).full_name || (data as any).email); });
    return () => { alive = false; };
  }, [editorId]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;

  if (!sop) {
    return (
      <div className="ac-sop-blank">
        {err && <Alert variant="danger">{err}</Alert>}
        <i className="bi bi-journal-text" />
        <h3>No SOP for {brandName} yet</h3>
        {canEdit ? (
          <>
            <p>Start one — it comes with the standard sections (Focus Products, Tasks, GMV Max, Discounts, Resource Links) already in place.</p>
            <Button variant="success" onClick={create} disabled={busy}>
              {busy ? <Spinner size="sm" animation="border" /> : <><i className="bi bi-plus-lg me-1" />Create SOP</>}
            </Button>
          </>
        ) : (
          <p>Bob or this brand's Team Lead can write it.</p>
        )}
      </div>
    );
  }

  const shareUrl = sopShareUrl(sop.share_token);
  const updatedAt = new Date(sop.updated_at);
  const updatedLabel = `${updatedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${updatedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  const words = sopWordCount(sop.sections);

  return (
    <div className="ac-sop-pane">
      <div className="ac-sop-head">
        <span className="ac-sop-head-avatar">{brandInitials(brandName)}</span>
        <div className="ac-sop-head-text">
          <h2>{sopHeading(brandName)}</h2>
          <div className="ac-sop-meta">
            <span>Standard operating procedure</span>
            <span>Updated {updatedLabel}</span>
            {editorName && <span>by {editorName}</span>}
            <span>{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
            {canEdit && mode === 'edit' && saveState !== 'idle' && (
              <span className={`ac-sop-save ac-sop-save-${saveState}`}>
                {saveState === 'pending' || saveState === 'saving'
                  ? <><Spinner size="sm" animation="border" /> Saving…</>
                  : saveState === 'error'
                  ? <><i className="bi bi-exclamation-triangle" /> Not saved <Button size="sm" variant="link" className="p-0 ms-1 align-baseline" onClick={() => { setErr(null); void flush(); }}>Retry</Button></>
                  : <><i className="bi bi-check2" /> Saved</>}
              </span>
            )}
          </div>
        </div>
        <div className="ac-sop-actions">
          {canEdit && (
            <div className="ac-sop-switch" role="group" aria-label="View or edit">
              <button type="button" className={mode === 'edit' ? 'active' : ''} onClick={() => switchMode('edit')}>
                <i className="bi bi-pencil" />Edit
              </button>
              <button type="button" className={mode === 'view' ? 'active' : ''} onClick={() => switchMode('view')}>
                <i className="bi bi-eye" />View
              </button>
            </div>
          )}
          {mode === 'view' && (
            <button type="button" className="ac-sop-btn" onClick={pdf} disabled={printing}>
              {printing ? <Spinner size="sm" animation="border" /> : <i className="bi bi-file-earmark-pdf" />}PDF
            </button>
          )}
          {canEdit && (
            <Dropdown align="end" autoClose="outside">
              <Dropdown.Toggle as="button" type="button" className="ac-sop-btn ac-sop-btn-nocaret">
                <i className="bi bi-share" />Share
                {sop.share_enabled && <span className="ac-sop-live-dot" title="Public link is on" />}
              </Dropdown.Toggle>
              <Dropdown.Menu className="ac-sop-share-menu">
                <div className="ac-sop-share-title">Public link</div>
                <p className="ac-sop-share-help">Anyone with the link can read this SOP — no sign-in needed.</p>
                <Form.Check
                  type="switch"
                  id={`sop-share-${sop.id}`}
                  checked={sop.share_enabled}
                  onChange={e => toggleShare(e.target.checked)}
                  label={sop.share_enabled ? 'Link is on' : 'Link is off'}
                />
                {sop.share_enabled && (
                  <>
                    <InputGroup size="sm" className="mt-2">
                      <Form.Control readOnly value={shareUrl} onFocus={e => e.currentTarget.select()} aria-label="Share link" />
                      <Button variant="outline-secondary" onClick={() => copyWithToast(shareUrl, 'Link')} title="Copy link"><i className="bi bi-clipboard" /></Button>
                      <Button variant="outline-secondary" href={shareUrl} target="_blank" rel="noopener noreferrer" title="Open"><i className="bi bi-box-arrow-up-right" /></Button>
                    </InputGroup>
                    <Button variant="link" size="sm" className="p-0 mt-2" onClick={rotate}>
                      <i className="bi bi-arrow-repeat me-1" />Make a new link
                    </Button>
                  </>
                )}
              </Dropdown.Menu>
            </Dropdown>
          )}
          {canEdit && mode === 'edit' && (
            <button type="button" className="ac-sop-btn ac-sop-btn-danger" onClick={remove} title="Delete this SOP">
              <i className="bi bi-trash3" />
            </button>
          )}
        </div>
      </div>

      {err && <Alert variant="danger" dismissible onClose={() => setErr(null)}>{err}</Alert>}

      {mode === 'edit' && canEdit ? (
        <SopSectionsEditor sections={sop.sections} live={live} onChange={onSectionsChange} />
      ) : (
        <div ref={viewRef}>
          <SopSectionsView brandName={brandName} sections={sop.sections} live={live} updatedAt={sop.updated_at} printing={printing} />
        </div>
      )}
    </div>
  );
}
