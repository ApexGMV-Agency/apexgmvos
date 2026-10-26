// @ts-nocheck
import { useCallback, useEffect, useState } from 'react';
import { copyWithToast } from '../../lib/copyToast';
import {
  loadShareLinks, createShareLink, updateShareLink, deleteShareLink,
  rotateShareToken, creatorDbShareUrl,
} from './creatorDbShare';

/* ════════════════════════════════════════════════════════════
   PUBLIC LINKS to the Creators Database — the management dialog.

   ‼️ IT IS OPEN TO EVERYONE WHO MAY USE THE DATABASE, and the CONTROLS are
   Bob's. A handler needs to be able to copy a link that already exists and to
   see whether one is switched on at all; making, rotating and removing one is
   the act that hands company data to an outsider, and RLS refuses it for
   anyone else. `canManage` mirrors that split — it never enforces it.

   ‼️ A LINK IS A ROW. Several can exist at once, each labelled, each switched
   off or rotated alone — so revoking the one that leaked does not break the
   one you sent somebody else. See migration 20260909090000.

   ‼️ ROTATING IS DESTRUCTIVE AND IS CONFIRMED. Every copy of the old URL stops
   working, which is the point, but it is not undoable and the people holding it
   are not told.
════════════════════════════════════════════════════════════ */

export default function CreatorDbShareModal({ canManage = false, onClose }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState('');
  /* Two-tap confirm rather than a second dialog, the pattern the bookmarks and
     promo rows already use: the first tap says what will happen. */
  const [armed, setArmed] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setErr('');
    try { setLinks(await loadShareLinks()); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const esc = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  /* Every mutation re-reads the row it changed from the SERVER rather than
     patching what was sent: the fill trigger mints the token and stamps the
     author, so the payload is not what the row ends up holding. */
  const run = useCallback(async (key, fn) => {
    setBusy(key); setErr('');
    try { await fn(); await refresh(); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(''); setArmed(''); }
  }, [refresh]);

  const add = () => run('new', async () => { await createShareLink(label); setLabel(''); });

  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal pc-modal-scroll pc-share-modal" onClick={ev => ev.stopPropagation()}
        role="dialog" aria-modal="true">
        <h3>Public links to the Creators Database</h3>
        <div className="pc-modal-sub">
          Anyone holding one of these links can read the list — no account needed.
          They cannot change anything, and import and export are not offered.
        </div>

        <div className="pc-modal-body">
          {err && <div className="pc-inline-err">{err}</div>}

          {canManage && (
            <div className="pc-share-new">
              <input className="pc-input" placeholder="What is this link for? (e.g. Wetcat agency)"
                value={label} onChange={e => setLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && label.trim()) add(); }} />
              <button className="pc-btn pc-btn-primary" onClick={add} disabled={!label.trim() || busy === 'new'}>
                {busy === 'new' ? 'Making…' : 'Make a link'}
              </button>
            </div>
          )}

          {loading ? (
            <div className="pc-empty"><div className="pc-spinner" /><p>Loading links…</p></div>
          ) : links.length === 0 ? (
            <div className="pc-empty">
              <div className="pc-empty-icon">🔗</div>
              <h3>No public link yet</h3>
              <p>{canManage
                ? 'Make one above. It can be switched off or replaced at any time.'
                : 'Only a Boss can create one of these links.'}</p>
            </div>
          ) : links.map(l => {
            const url = creatorDbShareUrl(l.share_token);
            return (
              <div className={`pc-share-row ${l.enabled ? '' : 'off'}`} key={l.id}>
                <div className="pc-share-main">
                  <div className="pc-share-label">
                    {l.label || 'Untitled link'}
                    {!l.enabled && <span className="pc-share-chip off">Switched off</span>}
                    {l.include_contact && (
                      <span className="pc-share-chip warn" title="This link publishes phone, email, PayPal, Zelle and notes.">
                        Contact details shared
                      </span>
                    )}
                  </div>
                  <button className="pc-share-url" onClick={() => copyWithToast(url, 'Link')}
                    title="Copy this link">
                    <i className="bi bi-link-45deg" />{url}
                  </button>
                  <div className="pc-share-meta">
                    Made by {l.created_by_name || 'someone who has since left'}
                    {l.created_at ? ` · ${new Date(l.created_at).toLocaleDateString()}` : ''}
                  </div>
                </div>

                {canManage && (
                  <div className="pc-share-acts">
                    <div className="pc-field pc-share-switch">
                      <label className="pc-switchrow">
                        <span className="pc-switchrow-txt">
                          <span className="pc-switchrow-name">Include contact details</span>
                          <span className="pc-switchrow-sub">Phone, email, PayPal, Zelle and internal notes.</span>
                        </span>
                        <span className="pc-switch">
                          <input type="checkbox" checked={l.include_contact} disabled={!!busy}
                            onChange={e => run(l.id, () => updateShareLink(l.id, { include_contact: e.target.checked }))} />
                          <span className="pc-switch-track" aria-hidden="true"><span className="pc-switch-knob" /></span>
                        </span>
                      </label>
                    </div>
                    <div className="pc-share-btns">
                      <button className="pc-btn pc-btn-ghost pc-btn-sm" disabled={!!busy}
                        onClick={() => run(l.id, () => updateShareLink(l.id, { enabled: !l.enabled }))}>
                        {l.enabled ? 'Switch off' : 'Switch on'}
                      </button>
                      <button className="pc-btn pc-btn-ghost pc-btn-sm" disabled={!!busy}
                        title="Issue a new URL. Every copy of the current one stops working."
                        onClick={() => (armed === `r:${l.id}`
                          ? run(l.id, () => rotateShareToken(l.id))
                          : setArmed(`r:${l.id}`))}>
                        {armed === `r:${l.id}` ? 'Replace the link?' : 'New link'}
                      </button>
                      <button className="pc-btn pc-btn-ghost pc-btn-danger pc-btn-sm" disabled={!!busy}
                        onClick={() => (armed === `d:${l.id}`
                          ? run(l.id, () => deleteShareLink(l.id))
                          : setArmed(`d:${l.id}`))}>
                        {armed === `d:${l.id}` ? 'Delete it?' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {canManage && (
            /* Said once, next to the switch it describes, rather than on a
               tooltip nobody hovers. The default is OFF for exactly this
               reason. */
            <div className="pc-share-note">
              <i className="bi bi-exclamation-triangle" />
              <span>
                A link publishes each creator’s name, handles, categories, region, followers,
                programs and GMV. Phone numbers, email addresses, PayPal/Zelle details and
                internal notes are held back unless you switch them on for that link.
              </span>
            </div>
          )}
        </div>

        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
