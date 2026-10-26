import { useEffect, useMemo, useState } from 'react';
import * as store from '../pages/handler-collab/store';
import type { BestVideo } from '../pages/handler-collab/store';
import { BrandAva, monthLabel, isValidUrl } from '../pages/paid-collab/handlerCollabReadonly';
import { copyText, showToast } from '../lib/copyToast';
import { useAuth } from '../auth/AuthContext';
import '../pages/handler-collab/handlerCollab.css';
import { MonthField } from './ThemedPicker';

interface Props {
  /** Show the "remove from best" control on starred deal videos (the handler workspace passes this). */
  canEdit?: boolean;
  /**
   * Show "Add video" and let the viewer manage the manual entries they added.
   * Separate from canEdit on purpose: curating DEAL videos stays in the handler
   * workspace where the videos live, but any staff surface showing the board can
   * add a standalone one.
   */
  canAdd?: boolean;
  /** Bumped by the host to force a reload (e.g. after starring elsewhere). */
  reloadKey?: number;
}

/**
 * Best Videos — every starred deal video plus every hand-added entry, across
 * the brands the viewer may see. One board serves the handler workspace tab and
 * the staff page; RLS on handler_collab_creators and best_videos_manual does the
 * scoping, so this component needs no role logic of its own (Bob sees all
 * brands, an APC only theirs, and so on).
 */
export default function BestVideosBoard({ canEdit = false, canAdd = false, reloadKey = 0 }: Props) {
  const { user, profile } = useAuth();
  const [rows, setRows] = useState<BestVideo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [brand, setBrand] = useState('all');
  const [month, setMonth] = useState('all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => {
    setErr(null);
    store.loadBestVideos()
      .then(setRows)
      .catch(e => { setErr(e.message || 'Could not load the best videos'); setRows([]); });
  };
  useEffect(load, [reloadKey]);

  // A manual entry is the adder's to remove — or Bob's, matching the RLS.
  const canManage = (r: BestVideo) =>
    r.source === 'manual' && (profile?.role === 'bob' || (!!r.addedBy && r.addedBy === user?.id));

  const brands = useMemo(() => {
    const m = new Map<string, string>();
    (rows ?? []).forEach(r => { if (r.brandId) m.set(r.brandId, r.brandName); });
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  const hasBrandless = useMemo(() => (rows ?? []).some(r => !r.brandId), [rows]);
  const months = useMemo(
    () => [...new Set((rows ?? []).map(r => r.month).filter(Boolean))].sort().reverse(),
    [rows],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(r =>
      (brand === 'all' || (brand === 'none' ? !r.brandId : r.brandId === brand))
      && (month === 'all' || r.month === month)
      && (!needle
        || r.creator.toLowerCase().includes(needle)
        || r.handle.toLowerCase().includes(needle)
        || r.brandName.toLowerCase().includes(needle)
        || r.adCode.toLowerCase().includes(needle)));
  }, [rows, brand, month, q]);

  const unstar = async (r: BestVideo) => {
    if (busy) return;
    if (!window.confirm(`Remove ${r.creator}'s video from Best Videos?`)) return;
    setBusy(r.key);
    try {
      await store.setCreatorVideoBest(r.creatorId, r.index, false);
      setRows(prev => (prev ?? []).filter(x => x.key !== r.key));
      showToast('Removed from Best Videos');
    } catch (e) {
      alert(`Couldn't update: ${(e as Error).message}`);
    } finally { setBusy(''); }
  };

  const removeManual = async (r: BestVideo) => {
    if (busy) return;
    if (!window.confirm(`Remove this video from Best Videos?`)) return;
    setBusy(r.key);
    try {
      await store.deleteManualBestVideo(r.manualId);
      setRows(prev => (prev ?? []).filter(x => x.key !== r.key));
      showToast('Removed from Best Videos');
    } catch (e) {
      alert(`Couldn't remove: ${(e as Error).message}`);
    } finally { setBusy(''); }
  };

  const copyAll = () => {
    const links = shown.map(r => r.video).filter(isValidUrl);
    if (!links.length) return;
    copyText(links.join('\n'));
    showToast(`${links.length} link${links.length === 1 ? '' : 's'} copied`);
  };

  if (rows === null) return <div className="pc-spinner" />;
  if (err) return <div className="pc-inline-err">{err}</div>;

  return (
    <>
      <div className="pc-toolbar pc-bv-toolbar">
        <input className="pc-search" placeholder="Search creator, brand or ad code…"
          value={q} onChange={e => setQ(e.target.value)} />
        {(brands.length > 1 || (brands.length === 1 && hasBrandless)) && (
          <select className="pc-input pc-bv-filter" value={brand} onChange={e => setBrand(e.target.value)}>
            <option value="all">All brands</option>
            {brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            {hasBrandless && <option value="none">No brand</option>}
          </select>
        )}
        {months.length > 1 && (
          <select className="pc-input pc-bv-filter" value={month} onChange={e => setMonth(e.target.value)}>
            <option value="all">All months</option>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        )}
        <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={copyAll}
          disabled={!shown.some(r => isValidUrl(r.video))}>
          <i className="bi bi-copy" /> Copy links
        </button>
        {canAdd && (
          <button type="button" className="pc-btn pc-btn-sm pc-bv-add" onClick={() => setAdding(true)}>
            <i className="bi bi-plus-lg" /> Add video
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">⭐</div>
          <h3>{rows.length === 0 ? 'No best videos yet' : 'Nothing matches those filters'}</h3>
          <p>
            {rows.length === 0
              ? (canAdd
                ? 'Handlers star a creator’s video in the paid-collab workspace and it lands here — or add one by hand.'
                : 'Handlers star a creator’s video in the paid-collab workspace and it lands here.')
              : 'Try a different brand, month or search.'}
          </p>
          {rows.length === 0 && canAdd && (
            <button type="button" className="pc-btn pc-btn-sm" onClick={() => setAdding(true)}>
              <i className="bi bi-plus-lg" /> Add a video
            </button>
          )}
        </div></div>
      ) : (
        <div className="pc-card pc-bv-list">
          <div className="pc-bv-head" role="row">
            <span className="pc-num">#</span>
            <span>Brand</span>
            <span>Creator</span>
            <span>Programme</span>
            <span>Ad code</span>
            <span>Added</span>
            <span className="pc-bv-acthead">Video</span>
          </div>
          {shown.map((r, i) => {
            const ok = isValidUrl(r.video);
            return (
              <div className="pc-bv-row" key={r.key} role="row">
                <span className="pc-cell pc-num pc-bv-idx" data-label="#">{i + 1}</span>

                <span className="pc-cell pc-bv-brandcell" data-label="Brand">
                  {r.brandId
                    ? (
                      <>
                        <BrandAva name={r.brandName} logo={r.brandLogo} className="pc-bv-ava" />
                        <span className="pc-bv-brand" title={r.brandName}>{r.brandName}</span>
                      </>
                    )
                    : <span className="pc-bv-nobrand" title="Not tied to a brand">No brand</span>}
                </span>

                <span className="pc-cell pc-bv-creatorcell" data-label="Creator">
                  <span className="pc-cname" title={r.creator}>
                    {r.creator}
                    {r.source === 'manual' && (
                      <span className="pc-bv-manual" title="Added by hand, not from a deal">Manual</span>
                    )}
                  </span>
                  {r.handle && <span className="pc-handle">{r.handle}</span>}
                </span>

                <span className="pc-cell" data-label="Programme">
                  <span className="pc-bv-month">{r.month ? monthLabel(r.month) : '—'}</span>
                </span>

                <span className="pc-cell pc-bv-codecell" data-label="Ad code">
                  {r.adCode
                    ? (
                      <button type="button" className="pc-bv-code" title={`Copy ${r.adCode}`}
                        onClick={() => { copyText(r.adCode); showToast('Ad code copied'); }}>
                        <span className="pc-bv-codetext">{r.adCode}</span>
                        <i className="bi bi-copy" />
                      </button>
                    )
                    : <span className="pc-handle">—</span>}
                  {r.auth && <span className="pc-bv-tag" title="Ad code authorised"><i className="bi bi-check2-circle" /></span>}
                </span>

                <span className="pc-cell pc-bv-bycell" data-label="Added">
                  {r.starredBy && <span className="pc-bv-by" title={`Added by ${r.starredBy}`}>{r.starredBy}</span>}
                  {r.starredAt && <span className="pc-bv-when">{r.starredAt.slice(0, 10)}</span>}
                </span>

                <span className="pc-cell pc-bv-actions" data-label="">
                  {ok
                    ? (
                      <>
                        <a className="pc-bv-watch" href={r.video} target="_blank" rel="noopener noreferrer"
                          title="Open the video">
                          <i className="bi bi-play-fill" /> Watch
                        </a>
                        <button type="button" className="pc-bv-iconbtn" title="Copy the video link"
                          onClick={() => { copyText(r.video); showToast('Link copied'); }}>
                          <i className="bi bi-link-45deg" />
                        </button>
                      </>
                    )
                    : <span className="pc-handle">No link</span>}
                  {canEdit && r.source === 'deal' && (
                    <button type="button" className="pc-bv-iconbtn star" title="Remove from Best Videos"
                      aria-label="Remove from Best Videos" disabled={busy === r.key} onClick={() => unstar(r)}>
                      <i className="bi bi-star-fill" />
                    </button>
                  )}
                  {canManage(r) && (
                    <button type="button" className="pc-bv-iconbtn del" title="Remove from Best Videos"
                      aria-label="Remove from Best Videos" disabled={busy === r.key} onClick={() => removeManual(r)}>
                      <i className="bi bi-trash" />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {shown.length > 0 && (
        <div className="pc-bv-count">
          {shown.length} video{shown.length === 1 ? '' : 's'}
          {shown.length !== rows.length ? ` of ${rows.length}` : ''}
          {' · '}{new Set(shown.map(r => r.brandId || 'none')).size} brand{new Set(shown.map(r => r.brandId || 'none')).size === 1 ? '' : 's'}
        </div>
      )}

      {adding && (
        <AddBestVideoModal
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }}
        />
      )}
    </>
  );
}

/**
 * Add a video that has no deal behind it — an organic post, a GMV Max creative,
 * a creator we never contracted. A video that IS on a deal should be starred in
 * the workspace instead, so it keeps one home; the hint says so.
 */
function AddBestVideoModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [brands, setBrands] = useState<{ id: string; name: string }[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ brandId: '', video: '', creatorName: '', handle: '', adCode: '', month: '' });
  const set = (k: keyof typeof f, v: string) => setF(prev => ({ ...prev, [k]: v }));

  useEffect(() => {
    store.loadBestVideoBrands()
      .then(setBrands)
      .catch(() => setBrands([]));   // the brand link is optional, so this never blocks saving
  }, []);

  const linkOk = isValidUrl(f.video.trim());

  async function save() {
    if (saving) return;
    const video = f.video.trim();
    if (!video) { setErr('Paste the video link.'); return; }
    if (!linkOk) { setErr('That link needs to start with http:// or https://'); return; }
    setSaving(true);
    setErr('');
    try {
      await store.addManualBestVideo({
        brandId: f.brandId || null,
        video,
        creatorName: f.creatorName,
        handle: f.handle,
        adCode: f.adCode,
        month: f.month,
      });
      showToast('Added to Best Videos');
      onSaved();
    } catch (e) {
      setErr((e as Error).message || 'Could not add the video');
      setSaving(false);
    }
  }

  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal pc-modal-scroll" onClick={e => e.stopPropagation()}>
        <h3>Add a best video</h3>
        <div className="pc-modal-sub">
          For a video with no deal behind it. A creator’s deal video is better starred
          in the paid-collab workspace, so it stays tied to the deal.
        </div>
        <div className="pc-modal-body">
          {err && <div className="pc-inline-err">{err}</div>}

          <div className="pc-field">
            <label>Video link</label>
            <input className="pc-input" type="url" inputMode="url" autoFocus
              placeholder="https://www.tiktok.com/@handle/video/…"
              value={f.video} onChange={e => set('video', e.target.value)} />
          </div>

          <div className="pc-field2">
            <div className="pc-field">
              <label>Creator</label>
              <input className="pc-input" placeholder="Jane Doe"
                value={f.creatorName} onChange={e => set('creatorName', e.target.value)} />
            </div>
            <div className="pc-field">
              <label>TikTok handle</label>
              <input className="pc-input" placeholder="@janedoe"
                value={f.handle} onChange={e => set('handle', e.target.value)} />
            </div>
          </div>

          <div className="pc-field">
            <label>Brand <span className="pc-bv-opt">optional</span></label>
            <select className="pc-input" value={f.brandId} onChange={e => set('brandId', e.target.value)}
              disabled={brands === null}>
              <option value="">No brand — reference only</option>
              {(brands ?? []).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <div className="pc-sig-hint">
              {f.brandId
                ? 'Everyone who works on that brand will see it.'
                : 'Without a brand it is visible to all internal staff.'}
            </div>
          </div>

          <div className="pc-field2">
            <div className="pc-field">
              <label>Month <span className="pc-bv-opt">optional</span></label>
              <MonthField variant="field" className="w-100" value={f.month}
                onChange={v => set('month', v)} />
            </div>
            <div className="pc-field">
              <label>Ad code <span className="pc-bv-opt">optional</span></label>
              <input className="pc-input" placeholder="#AD1234"
                value={f.adCode} onChange={e => set('adCode', e.target.value)} />
            </div>
          </div>
        </div>

        <div className="pc-modal-actions">
          <button type="button" className="pc-btn pc-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="pc-btn" onClick={save} disabled={saving || !f.video.trim()}>
            {saving ? 'Adding…' : 'Add video'}
          </button>
        </div>
      </div>
    </div>
  );
}
