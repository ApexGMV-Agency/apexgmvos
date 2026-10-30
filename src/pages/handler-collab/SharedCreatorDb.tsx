// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CreatorDatabaseView, ReadOnlyCtx, buildCreatorDatabase, reacherStat } from './HandlerCollabApp';
import { fetchSharedCreatorDb, CreatorDbLinkError } from './creatorDbShare';
import './handlerCollab.css';

/* ════════════════════════════════════════════════════════════
   PUBLIC read-only view of the Creators Database — /creators/<token>.

   No auth: the token in the URL is the credential, and `creator_db_shared()`
   (a SECURITY DEFINER RPC, the only door to tables with no anon policy) checks
   `enabled` itself. Migration 20260909090000 has the reasoning.

   ‼️ IT IS THE WORKSPACE'S OWN TABLE, not a copy of it. `CreatorDatabaseView`
   and `buildCreatorDatabase` are imported from HandlerCollabApp, so a creator
   cannot read one way for us and another way for whoever holds the link, and
   the stats, filters, sorting, search and detail popup all behave identically.
   That is the `handlerCollabReadonly` principle applied through an export
   rather than an extraction: this is one table, and it stays one table.

   ‼️ READ-ONLY IS STRUCTURAL, NOT A MATTER OF HIDING BUTTONS. The page provides
   `ReadOnlyCtx` as `true`, which withdraws every write control — but the real
   guarantee is underneath it: the anon key has no write policy on
   `creator_directory` or `handler_collab_creators` at all, so there is nothing
   for a determined visitor to poke at in devtools. The callbacks below are
   no-ops for the same reason, and they are wired as no-ops rather than left
   undefined so a control that somehow rendered could not throw.

   ‼️ IMPORT AND EXPORT ARE WITHDRAWN — the one thing this page removes beyond
   the write controls, and the reason `publicView` exists as a flag separate
   from `ro` (Bob's read-only workspace KEEPS its exports; see the 2026-08-14
   note in CLAUDE.local.md §10). Reading the list is what the link is for;
   taking a spreadsheet of it away is a different act.
════════════════════════════════════════════════════════════ */

/* The ISO month prefix — the same thing `monthKey` does inside the workspace.
   Inlined rather than exported: it is a slice of a date string, with no rule
   that could drift between the two. */
const monthOf = (d) => (d ? String(d).slice(0, 7) : '');

/** Nothing on this page may write. Wired rather than omitted — see the header. */
const noop = () => {};
const noDelete = () => ({ can: false, who: '—', why: 'This is a read-only view.' });

export default function SharedCreatorDb() {
  const { code } = useParams();
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!code) { setErr({ msg: 'This link is missing its code.', revoked: false }); setLoading(false); return; }
    let off = false;
    setLoading(true); setErr(null);
    fetchSharedCreatorDb(code)
      .then(d => { if (!off) { setDoc(d); setLoading(false); } })
      .catch(e => {
        if (off) return;
        setErr({ msg: e.message, revoked: e instanceof CreatorDbLinkError && e.reason === 'revoked' });
        setLoading(false);
      });
    return () => { off = true; };
  }, [code]);

  useEffect(() => {
    document.title = doc ? 'Creators · ApexGMV' : 'ApexGMV';
  }, [doc]);

  /* The deals, decorated exactly as `allCreatorsList` decorates them in the
     workspace — same field names, same sort. `buildCreatorDatabase` reads
     "first non-empty wins" down a newest-first list, so the order is not
     cosmetic: get it wrong and a creator shows an old phone number. */
  const entries = useMemo(() => {
    if (!doc) return [];
    const deals = doc.deals
      .map(c => ({
        ...c,
        _brandName: c.brand_name || '—',
        _brandCurrency: c.brand_currency || 'USD',
        _monthKey: monthOf(c.program_month || c.onboarded_on || c.created_at),
      }))
      .sort((a, b) => String(b._monthKey).localeCompare(String(a._monthKey))
        || String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || ''))
        || String(b.created_at || '').localeCompare(String(a.created_at || '')));
    return buildCreatorDatabase(deals, doc.directory);
  }, [doc]);

  /* Reacher's Level / TT GMV / Avg views, from the same cache the workspace
     reads — shaped by the same reacherStat() so the two cannot differ. The
     page never calls Reacher itself; the 5 AM job keeps the cache current. */
  const reacher = useMemo(() => {
    const stats = {};
    let updatedAt = null;
    Object.entries(doc?.reacher || {}).forEach(([h, r]) => {
      stats[h] = reacherStat(r);
      if (r.fetched_at && (!updatedAt || r.fetched_at > updatedAt)) updatedAt = r.fetched_at;
    });
    return { stats, loading: false, syncing: false, err: '', loaded: true,
      count: Object.keys(stats).length, remaining: 0, rateLimited: false, updatedAt };
  }, [doc]);

  const categories = useMemo(
    () => [...new Set(entries.flatMap(e => e.categories).map(c => c.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [entries]);

  return (
    <div className="pc-app pc-pubdb">
      <div className="pc-shell">
        <header className="pc-pubbar">
          <div className="pc-pubid">
            <span className="pc-pubmark">A</span>
            <div>
              <div className="pc-pubname">ApexGMV</div>
              <div className="pc-pubkicker">
                Creators{doc?.label ? ` · ${doc.label}` : ''}
              </div>
            </div>
          </div>
          <span className="pc-pubtag"><i className="bi bi-eye" /> Read-only</span>
        </header>

        {loading && (
          <div className="pc-card"><div className="pc-empty pc-empty-lg">
            <div className="pc-spinner" />
            <p>Opening the list…</p>
          </div></div>
        )}

        {err && (
          <div className="pc-card"><div className="pc-empty pc-empty-lg">
            <div className="pc-empty-icon">{err.revoked ? '🔒' : '❓'}</div>
            <h3>{err.revoked ? 'This link has been switched off' : 'Link not found'}</h3>
            <p>{err.msg}</p>
          </div></div>
        )}

        {doc && (
          /* The provider is what makes every control in the table below
             read-only. Do not replace it with prop-drilling: the row and the
             detail popup both read it, and a new write control added inside
             either one is gated by it automatically. */
          <ReadOnlyCtx.Provider value={true}>
            <CreatorDatabaseView
              entries={entries}
              categories={categories}
              publicView
              reacher={reacher}
              hideContact={!doc.include_contact}
              onAdd={noop} onEdit={noop} onDelete={noop} onAddToProgram={noop}
              onImport={null} onShare={null} onReloadReacher={null}
              deleteGate={noDelete}
            />
          </ReadOnlyCtx.Provider>
        )}

        {doc && (
          <footer className="pc-pubfoot">
            Shared by ApexGMV · read-only
          </footer>
        )}
      </div>
    </div>
  );
}
