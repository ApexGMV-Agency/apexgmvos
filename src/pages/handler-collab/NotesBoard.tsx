// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '../../lib/supabase';
import SearchSelect from './SearchSelect';
import { useAuth } from '../../auth/AuthContext';
import * as store from './store';
import RichTextEditor from '../../components/RichTextEditor';
import { BrandAva } from '../paid-collab/handlerCollabReadonly';
import { requestNotificationPermission } from '../../notifications/swSetup';
import { DateTimeField, MonthField } from '../../components/ThemedPicker';

/* ════════════════════════════════════════════════════════════
   NOTES — Google Keep-style board for the handler workspace.
   Global notes (handler_notes): colored cards, free-form labels,
   optional brand (brand-wise) + program/month (program-wise)
   links, and reminders that fire notifications. The label
   sidebar (left) is the "labels shown aside" filter rail.
════════════════════════════════════════════════════════════ */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = String(key).split('-');
  return `${MONTHS[parseInt(m, 10) - 1] || '?'} ${y}`;
}
function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Role-based card colours (the manual colour picker is gone). A note you OWN is
// white; a note shared WITH you is tinted by the role of whoever shared it
// (owner_role / owner_is_superbob come from list_visible_notes). The legacy
// per-note `color` column is ignored.
const ROLE_COLORS = {
  super_boss:  '#FEEFC3', // sand / gold
  bob:         '#E8F0FE', // sky
  team_lead:   '#E6F4EA', // sage
  apc:         '#F3E8FD', // lilac
  ads_manager: '#E0F2F1', // mint
  paid_collab_handler: '#FCE4EC', // rose
};
const ROLE_LABEL = {
  super_boss: 'Super Boss', bob: 'Boss', team_lead: 'Team Lead',
  apc: 'APC', ads_manager: 'Ads Manager',
  paid_collab_handler: 'Paid Collab Handler',
};
const OWN_BG = '#FFFFFF';
const FALLBACK_BG = '#F1F3F4';
// Which role bucket owns this note (super_boss wins over a plain bob owner).
function ownerRoleKey(n) {
  if (n?.owner_is_superbob) return 'super_boss';
  return n?.owner_role || null;
}
function isOwnNote(n, viewerId) {
  return n?.is_owner ?? (!n?.owner_id || (viewerId && n?.owner_id === viewerId));
}
function noteColorBg(n, viewerId) {
  if (isOwnNote(n, viewerId)) return OWN_BG;
  return ROLE_COLORS[ownerRoleKey(n)] || FALLBACK_BG;
}
// The role groups a note can be shared with. In ApexGMVOS the board lives only
// in the Paid Collab workspace, so the audience is the people who can open it:
// the Super Boss, the Bobs and the Paid Collab Handlers — one circle, no
// internal/external split. Keep in step with the `hns owner all` policy.
const STAFF_ROLE_TARGETS = [
  { role: 'super_boss', label: 'Super Boss' },
  { role: 'bob',        label: 'Boss' },
  { role: 'paid_collab_handler', label: 'Paid Collab Handlers' },
];
const HANDLER_ROLE = 'paid_collab_handler';
const STAFF_ROLES = ['bob'];
// Roles whose owners get a Share section at all.
const SHARING_ROLES = [...STAFF_ROLES, HANDLER_ROLE];

function shareRoleTargets() { return STAFF_ROLE_TARGETS; }
function legendRoles() { return STAFF_ROLE_TARGETS; }

const shareTokenKey = (t) =>
  t.kind === 'all' ? 'all' : t.kind === 'team' ? `team:${t.team}` : `role:${t.role}`;

// Plural recipient labels for the "shared with" summary (Team Leads vs Team Lead).
const SHARE_ROLE_LABEL = {
  ...Object.fromEntries(STAFF_ROLE_TARGETS.map(r => [r.role, r.label])),
};
// "Team Leads, Super Boss" / "Everyone" / "Acme's team" — from a note's `shares`.
function shareSummary(shares) {
  if (!shares || !shares.length) return '';
  return shares.map(s =>
    s.kind === 'all' ? 'Everyone'
      : s.kind === 'team' ? `${s.team_name || 'A team'}'s team`
        : (SHARE_ROLE_LABEL[s.role] || s.role)
  ).join(', ');
}

// Editor label quick-pick source: the saved catalogue (note_labels) PLUS labels
// already used on the viewer's OWN notes (deduped, case-insensitive), so labels
// created before the catalogue existed are still selectable when adding a note.
function mergeLabelChoices(catalog, notes, viewerId) {
  const seen = new Set();
  const out = [];
  (catalog || []).forEach(l => {
    const k = (l?.name || '').toLowerCase();
    if (l?.name && !seen.has(k)) { seen.add(k); out.push({ id: l.id, name: l.name }); }
  });
  (notes || []).forEach(n => {
    if (!isOwnNote(n, viewerId)) return;
    (n.labels || []).forEach(name => {
      const k = String(name || '').toLowerCase();
      if (name && !seen.has(k)) { seen.add(k); out.push({ id: `note:${name}`, name }); }
    });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)', 'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)', 'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)', 'linear-gradient(135deg,#3B82F6,#2563EB)',
];
const getGradient = (name) => AVATAR_GRADIENTS[(name || '?').charCodeAt(0) % AVATAR_GRADIENTS.length];

// "2026-06-29T14:30" (datetime-local) <-> ISO. Stored as timestamptz (ISO).
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
// Body is rich text (HTML from Quill). Strip tags for emptiness checks + search.
function htmlToText(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
function reminderLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const opts = sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return d.toLocaleString(undefined, opts);
}

// The board loads via list_visible_notes() — the signed-in user's OWN notes +
// notes shared WITH them (own + shared, with owner role/name for colouring), so
// Bob's read-all RLS no longer floods it.
// creators: raw handler_collab_creators rows (all months) — enables the
// "creator-wise" note link (select in the editor, chips, sidebar group).
export default function NotesBoard({ brands = [], brandById = {}, creators = [], month }) {
  const { user, profile } = useAuth();
  const viewerId = user?.id;
  const viewerRole = profile?.role;
  const viewerIsSuperbob = !!profile?.is_superbob;
  // A note is editable only by its owner. is_owner comes from list_visible_notes;
  // fall back to the owner_id comparison for rows loaded another way.
  const canEditNote = useCallback(
    (n) => isOwnNote(n, viewerId), [viewerId]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState({ kind: 'all' }); // {kind, value?}
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState(null); // null | { mode, note }
  const [labelCatalog, setLabelCatalog] = useState([]); // reusable saved labels (mine)
  const [teamLeads, setTeamLeads] = useState([]);        // for the Super Boss "specific team" share
  const busyRef = useRef(false);

  const reload = useCallback(async () => {
    // own + shared-to-me, with owner role/name for colouring + the shared-by chip.
    try { setNotes(await store.loadVisibleNotes()); setErr(''); }
    catch (e) { setErr(e.message || 'Failed to load notes'); }
  }, []);

  // Reusable label catalogue (mine) + Team Leads (Super Boss share picker).
  const reloadLabels = useCallback(async () => {
    if (!viewerId) return;
    try { setLabelCatalog(await store.loadNoteLabels(viewerId)); } catch { /* ignore */ }
  }, [viewerId]);
  useEffect(() => { reloadLabels(); }, [reloadLabels]);
  const onCreateLabel = useCallback(async (name) => {
    try { await store.upsertNoteLabel(name); reloadLabels(); } catch { /* ignore */ }
  }, [reloadLabels]);

  useEffect(() => { (async () => { setLoading(true); await reload(); setLoading(false); })(); }, [reload]);
  useEffect(() => { busyRef.current = !!editor; }, [editor]);

  // (Due-reminder firing runs workspace-wide in HandlerCollabApp, so it works on
  // any tab — not only while the Notes board is mounted.)

  // Live sync across devices/tabs.
  useEffect(() => {
    if (!supabase) return;
    let t = null;
    const ping = () => { if (busyRef.current) return; clearTimeout(t); t = setTimeout(reload, 300); };
    const ch = supabase.channel('pc-notes-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_notes' }, ping)
      .subscribe();
    return () => { clearTimeout(t); try { supabase.removeChannel(ch); } catch {} };
  }, [reload]);

  /* ── optimistic mutations ── */
  const patchLocal = (id, patch) => setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));

  // Auto-save: create-or-update without closing. Returns the (real) note id so the
  // composer can switch from insert to update after the first save.
  const persistNote = useCallback(async (payload) => {
    if (payload.id) {
      patchLocal(payload.id, payload);
      try { await store.updateNote(payload.id, stripId(payload)); }
      catch (e) { setErr(e.message || 'Save failed'); }
      return payload.id;
    }
    try {
      const row = await store.createNote(stripId(payload));
      setNotes(prev => [row, ...prev]);
      return row.id;
    } catch (e) { setErr(e.message || 'Save failed'); return null; }
  }, []);

  const togglePin = useCallback(async (n) => {
    patchLocal(n.id, { pinned: !n.pinned });
    try { await store.updateNote(n.id, { pinned: !n.pinned }); } catch { reload(); }
  }, [reload]);

  const setArchived = useCallback(async (n, archived) => {
    patchLocal(n.id, { archived });
    try { await store.updateNote(n.id, { archived }); reload(); } catch { reload(); }
  }, [reload]);

  const doneReminder = useCallback(async (n) => {
    patchLocal(n.id, { reminder_done: true });
    try { await store.updateNote(n.id, { reminder_done: true }); } catch { reload(); }
  }, [reload]);

  const removeNote = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    setNotes(prev => prev.filter(x => x.id !== n.id));
    try { await store.deleteNote(n.id); } catch { reload(); }
  }, [reload]);

  /* ── sidebar groups (built from the notes themselves) ── */
  const live = useMemo(() => notes.filter(n => !n.archived), [notes]);
  // Creator lookups: a note links one deal row, but grouping/filtering follows
  // the creator identity across months within the brand (store.creatorNoteKey).
  const creatorById = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = c; }); return m;
  }, [creators]);
  const creatorKeyById = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = store.creatorNoteKey(c); }); return m;
  }, [creators]);
  const brandGroups = useMemo(() => {
    const m = {};
    live.forEach(n => { if (n.brand_id) m[n.brand_id] = (m[n.brand_id] || 0) + 1; });
    return Object.entries(m)
      .map(([id, count]) => ({ id, count, name: brandById[id]?.name || 'Brand' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [live, brandById]);
  const creatorGroups = useMemo(() => {
    const m = {};
    live.forEach(n => {
      const row = n.creator_id ? creatorById[n.creator_id] : null;
      if (!row) return;
      const k = creatorKeyById[n.creator_id];
      if (!m[k]) m[k] = { key: k, count: 0, name: row.name || 'Creator' };
      m[k].count += 1;
    });
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name));
  }, [live, creatorById, creatorKeyById]);
  const programGroups = useMemo(() => {
    const m = {};
    live.forEach(n => { if (n.month) m[n.month] = (m[n.month] || 0) + 1; });
    return Object.entries(m).map(([k, count]) => ({ key: k, count })).sort((a, b) => b.key.localeCompare(a.key));
  }, [live]);
  const labelGroups = useMemo(() => {
    const m = {};
    live.forEach(n => (n.labels || []).forEach(l => { m[l] = (m[l] || 0) + 1; }));
    return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [live]);
  // Reusable label choices for the editor's quick-pick: the saved catalogue PLUS
  // labels already used on MY OWN notes — so previously-used ("pre") labels are
  // selectable on a new note even before they were ever saved to the catalogue.
  const labelChoices = useMemo(() => mergeLabelChoices(labelCatalog, notes, viewerId), [labelCatalog, notes, viewerId]);
  const reminderCount = useMemo(
    () => live.filter(n => n.reminder_at && !n.reminder_done).length, [live]);

  /* ── apply filter + search ── */
  const visible = useMemo(() => {
    let list = notes;
    switch (filter.kind) {
      case 'archive': list = list.filter(n => n.archived); break;
      case 'reminders': list = list.filter(n => !n.archived && n.reminder_at && !n.reminder_done); break;
      case 'pinned': list = list.filter(n => !n.archived && n.pinned); break;
      case 'shared': list = list.filter(n => !n.archived && !isOwnNote(n, viewerId)); break;
      case 'sharedByMe': list = list.filter(n => !n.archived && isOwnNote(n, viewerId) && (n.shares || []).length > 0); break;
      case 'brand': list = list.filter(n => !n.archived && n.brand_id === filter.value); break;
      case 'creator': list = list.filter(n => !n.archived && n.creator_id && creatorKeyById[n.creator_id] === filter.value); break;
      case 'program': list = list.filter(n => !n.archived && n.month === filter.value); break;
      case 'label': list = list.filter(n => !n.archived && (n.labels || []).includes(filter.value)); break;
      default: list = list.filter(n => !n.archived);
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      htmlToText(n.body).toLowerCase().includes(q) ||
      (n.labels || []).some(l => l.toLowerCase().includes(q)) ||
      (n.creator_id && (creatorById[n.creator_id]?.name || '').toLowerCase().includes(q)));
    // pinned first, then by sort key
    const key = filter.kind === 'reminders'
      ? (n) => new Date(n.reminder_at).getTime()
      : (n) => -new Date(n.updated_at).getTime();
    return [...list].sort((a, b) => (b.pinned - a.pinned) || (key(a) - key(b)));
  }, [notes, filter, search, creatorById, creatorKeyById, viewerId]);

  const sharedCount = useMemo(() => live.filter(n => !isOwnNote(n, viewerId)).length, [live, viewerId]);
  const sharedByMeCount = useMemo(
    () => live.filter(n => isOwnNote(n, viewerId) && (n.shares || []).length > 0).length, [live, viewerId]);

  const pinned = visible.filter(n => n.pinned);
  const others = visible.filter(n => !n.pinned);

  const SideItem = ({ active, icon, label, count, onClick }) => (
    <button className={`pc-nside-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="pc-nside-ico"><i className={`bi ${icon}`} /></span>
      <span className="pc-nside-label">{label}</span>
      {count != null && count > 0 && <span className="pc-nside-count">{count}</span>}
    </button>
  );
  const isF = (kind, value) => filter.kind === kind && filter.value === value;

  return (
    <div className="pc-notes">
      {/* ── label sidebar (shown aside) ── */}
      <aside className="pc-nside">
        <SideItem active={filter.kind === 'all'} icon="bi-journal-text" label="All notes" count={live.length}
          onClick={() => setFilter({ kind: 'all' })} />
        <SideItem active={filter.kind === 'reminders'} icon="bi-alarm" label="Reminders" count={reminderCount}
          onClick={() => setFilter({ kind: 'reminders' })} />
        <SideItem active={filter.kind === 'pinned'} icon="bi-pin-angle" label="Pinned"
          onClick={() => setFilter({ kind: 'pinned' })} />
        {sharedCount > 0 && (
          <SideItem active={filter.kind === 'shared'} icon="bi-people" label="Shared with me" count={sharedCount}
            onClick={() => setFilter({ kind: 'shared' })} />
        )}
        {sharedByMeCount > 0 && (
          <SideItem active={filter.kind === 'sharedByMe'} icon="bi-send" label="Shared by me" count={sharedByMeCount}
            onClick={() => setFilter({ kind: 'sharedByMe' })} />
        )}

        {brandGroups.length > 0 && <div className="pc-nside-head">Brands</div>}
        {brandGroups.map(g => (
          <SideItem key={g.id} active={isF('brand', g.id)} icon="bi-shop" label={g.name} count={g.count}
            onClick={() => setFilter({ kind: 'brand', value: g.id })} />
        ))}

        {creatorGroups.length > 0 && <div className="pc-nside-head">Creators</div>}
        {creatorGroups.map(g => (
          <SideItem key={g.key} active={isF('creator', g.key)} icon="bi-person" label={g.name} count={g.count}
            onClick={() => setFilter({ kind: 'creator', value: g.key })} />
        ))}

        {programGroups.length > 0 && <div className="pc-nside-head">Programs</div>}
        {programGroups.map(g => (
          <SideItem key={g.key} active={isF('program', g.key)} icon="bi-calendar3" label={monthLabel(g.key)} count={g.count}
            onClick={() => setFilter({ kind: 'program', value: g.key })} />
        ))}

        {labelGroups.length > 0 && <div className="pc-nside-head">Labels</div>}
        {labelGroups.map(g => (
          <SideItem key={g.name} active={isF('label', g.name)} icon="bi-tag" label={g.name} count={g.count}
            onClick={() => setFilter({ kind: 'label', value: g.name })} />
        ))}

        <div className="pc-nside-head">More</div>
        <SideItem active={filter.kind === 'archive'} icon="bi-archive" label="Archive"
          onClick={() => setFilter({ kind: 'archive' })} />

        {/* colour legend — cards are tinted by who shared them */}
        <div className="pc-nside-head">Colours</div>
        <div className="pc-nlegend">
          <div className="pc-nlegend-row"><span className="pc-nlegend-dot" style={{ background: OWN_BG }} /> Mine</div>
          {legendRoles(viewerRole).map(r => (
            <div key={r.role} className="pc-nlegend-row">
              <span className="pc-nlegend-dot" style={{ background: ROLE_COLORS[r.role] }} /> {ROLE_LABEL[r.role]}
            </div>
          ))}
        </div>
      </aside>

      {/* ── board ── */}
      <div className="pc-nmain">
        <div className="pc-nbar">
          <div className="pc-nsearch">
            <i className="bi bi-search" />
            <input placeholder="Search notes…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="pc-nsearch-x" onClick={() => setSearch('')}>×</button>}
          </div>
          <button className="pc-btn pc-btn-primary" onClick={() => setEditor({
            mode: 'add',
            note: { color: 'default', labels: [], brand_id: null, creator_id: null, month: month || null },
          })}><i className="bi bi-plus-lg" />New note</button>
        </div>

        {err && <div className="pc-banner" style={{ background: 'var(--pc-error-bg)', color: 'var(--pc-error-fg)' }}><span>⚠️</span><span>{err}</span></div>}

        {loading ? <div className="pc-spinner" /> : visible.length === 0 ? (
          <div className="pc-nempty">
            <div className="pc-nempty-ico"><i className="bi bi-journal-text" /></div>
            <div className="pc-nempty-t">No notes here yet</div>
            <div className="pc-nempty-s">Capture reminders, label them by brand or program, and they'll show up in the rail on the left.</div>
          </div>
        ) : (
          <>
            {pinned.length > 0 && others.length > 0 && filter.kind === 'all' && <div className="pc-nsection">Pinned</div>}
            <div className="pc-ngrid">
              {pinned.map(n => <NoteCard key={n.id} n={n} viewerId={viewerId} brandById={brandById} creatorById={creatorById} readOnly={!canEditNote(n)}
                onOpen={() => setEditor({ mode: 'edit', note: n })} onPin={() => togglePin(n)}
                onArchive={() => setArchived(n, !n.archived)} onDelete={() => removeNote(n)} onDone={() => doneReminder(n)} />)}
            </div>
            {pinned.length > 0 && others.length > 0 && filter.kind === 'all' && <div className="pc-nsection">Others</div>}
            <div className="pc-ngrid">
              {others.map(n => <NoteCard key={n.id} n={n} viewerId={viewerId} brandById={brandById} creatorById={creatorById} readOnly={!canEditNote(n)}
                onOpen={() => setEditor({ mode: 'edit', note: n })} onPin={() => togglePin(n)}
                onArchive={() => setArchived(n, !n.archived)} onDelete={() => removeNote(n)} onDone={() => doneReminder(n)} />)}
            </div>
          </>
        )}
      </div>

      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} creators={creators} month={month}
          viewerId={viewerId} viewerRole={viewerRole} viewerIsSuperbob={viewerIsSuperbob}
          teamLeads={teamLeads} labelCatalog={labelChoices} onCreateLabel={onCreateLabel}
          onLoadShares={store.loadNoteShares} onSaveShares={store.setNoteShares}
          readOnly={editor.mode === 'edit' && !canEditNote(editor.note)}
          onClose={() => { setEditor(null); reload(); }} onPersist={persistNote}
          onArchive={editor.mode === 'edit' && canEditNote(editor.note) ? () => { setEditor(null); setArchived(editor.note, !editor.note.archived); } : null}
          onDelete={editor.mode === 'edit' && canEditNote(editor.note) ? () => { setEditor(null); removeNote(editor.note); } : null} />
      )}
    </div>
  );
}

function stripId(d) { const { id, ...rest } = d; return rest; }

// First TikTok handle of a creator row, "@name" form (handles URL / multi-account values).
function creatorHandle(c) {
  const first = String(c?.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  const h = first.startsWith('http') ? (first.replace(/\/+$/, '').split('/').pop() || '') : first;
  return h ? (h.startsWith('@') ? h : `@${h}`) : '';
}

/* ── one card ── */
function NoteCard({ n, viewerId, brandById, creatorById = {}, onOpen, onPin, onArchive, onDelete, onDone, readOnly = false }) {
  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
  const brandName = n.brand_id ? brandById[n.brand_id]?.name : null;
  const creatorName = n.creator_id ? creatorById[n.creator_id]?.name : null;
  // Shared-with-me note: chip names who shared it (owner_name / role).
  const sharedBy = readOnly ? (n.owner_name || ROLE_LABEL[ownerRoleKey(n)] || 'Shared') : null;
  // My own note that I've shared: chip names the recipients.
  const sharedWith = !readOnly ? shareSummary(n.shares) : '';
  return (
    <div className="pc-ncard" style={{ background: noteColorBg(n, viewerId) }} onClick={onOpen}>
      {!readOnly && (
        <button className={`pc-npin ${n.pinned ? 'on' : ''}`} title={n.pinned ? 'Unpin' : 'Pin'}
          onClick={e => { e.stopPropagation(); onPin(); }}><i className={`bi ${n.pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle'}`} /></button>
      )}
      {n.title && <div className="pc-ntitle">{n.title}</div>}
      {htmlToText(n.body) && <div className="pc-nbody ac-rte-view"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(n.body) }} />}

      {(sharedBy || sharedWith || n.reminder_at || brandName || creatorName || n.month || (n.labels || []).length > 0) && (
        <div className="pc-nchips">
          {sharedBy && <span className="pc-nchip"><i className="bi bi-person-badge" /> {sharedBy}</span>}
          {sharedWith && <span className="pc-nchip pc-nchip-shared"><i className="bi bi-send" /> {sharedWith}</span>}
          {!readOnly && n.reminder_at && !n.reminder_done && (
            <button className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`} title="Mark reminder done"
              onClick={e => { e.stopPropagation(); onDone(); }}>
              <i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}
            </button>
          )}
          {brandName && <span className="pc-nchip pc-nchip-brand"><i className="bi bi-shop" /> {brandName}</span>}
          {creatorName && <span className="pc-nchip pc-nchip-creator"><i className="bi bi-person" /> {creatorName}</span>}
          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
        </div>
      )}

      {!readOnly && (
        <div className="pc-ncard-actions" onClick={e => e.stopPropagation()}>
          {/* Delete is archive-gated: active notes can only be archived; a note
              can be restored or permanently deleted from the Archive view. */}
          {n.archived ? (
            <>
              <button title="Restore" onClick={onArchive}><i className="bi bi-arrow-counterclockwise" /></button>
              <button className="pc-ndel" title="Delete" onClick={onDelete}><i className="bi bi-trash" /></button>
            </>
          ) : (
            <button title="Archive" onClick={onArchive}><i className="bi bi-archive" /></button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── note viewer / editor (auto-saves, Google Keep-style) ──
   An OWN note opens in VIEW mode first (read-only render + Edit button); a NEW
   note ('add') opens straight into the editable composer. readOnly = a note
   shared WITH the viewer (view-only, no Edit). Colours are role-based (owner's
   role), not chosen. Delete is archive-gated: the footer offers Archive on an
   active note, and Restore + Delete once archived.
   Sharing: internal staff (bob/team_lead/apc/ads_manager, + Super Boss) get a
   "Share with" section on their own notes — role groups for everyone, plus
   Everyone / a specific team for the Super Boss. onLoadShares/onSaveShares
   persist to handler_note_shares; teamLeads feeds the specific-team picker.
   labelCatalog / onCreateLabel: reusable saved labels (quick-pick + persist).
   Brand and Creator are ALWAYS editable here. The scoped drawers (brand,
   creator, brand-pinned all-notes) pre-fill them and then let them be changed;
   they used to disable the selects, which left a note filed against the wrong
   brand or person fixable only from the global notes board. */
export function NoteEditor({ editor, brands, brandById, creators = [], month, onClose, onPersist, onDelete, onArchive,
  overlayClass = '', readOnly = false,
  /* Which Notes page this composer is writing for (20260904090000). 'update' is
     the team timeline: stamped on the new row, and it hides the three controls
     that only mean something on the Keep board — a reminder there would link to
     a page the note is not on, sharing is moot when the whole team already sees
     it, and pinning orders a board this note never appears on. */
  stream = 'private',
  viewerId, viewerRole, viewerIsSuperbob = false,
  teamLeads = [], labelCatalog = [],
  onCreateLabel, onLoadShares, onSaveShares }) {
  const src = editor.note || {};
  // Own existing notes open in view mode; a new note goes straight to editing.
  const [editing, setEditing] = useState(editor.mode === 'add');
  const [f, setF] = useState({
    title: src.title || '',
    body: src.body || '',
    color: src.color || 'default',
    brand_id: src.brand_id || '',
    creator_id: src.creator_id || '',
    month: src.month || '',
    labels: src.labels || [],
    pinned: !!src.pinned,
  });
  const [reminderInput, setReminderInput] = useState(toLocalInput(src.reminder_at));
  const [labelInput, setLabelInput] = useState('');
  const [status, setStatus] = useState(''); // '' | 'saving' | 'saved'
  const [shareTargets, setShareTargets] = useState([]); // NoteShareTarget[]
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  // Internal staff and paid-collab handlers may share, and only their OWN notes
  // (new, or owned by the viewer) — Super Boss oversight editing someone else's
  // note gets no share UI.
  const isOwnEditing = editor.mode === 'add' || isOwnNote(src, viewerId);
  const canShare = stream !== 'update'
    && !readOnly && isOwnEditing && SHARING_ROLES.includes(viewerRole) && !!onSaveShares;
  const roleTargets = shareRoleTargets();

  // Creator select: one option per creator identity per brand — a creator's
  // deal rows across months collapse into one, keeping the newest row's id.
  const creatorRowById = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = c; }); return m;
  }, [creators]);
  const creatorOptions = useMemo(() => {
    const byKey = {};
    creators.forEach(c => {
      const k = store.creatorNoteKey(c);
      const prev = byKey[k];
      if (!prev || String(c.onboarded_on || c.created_at || '') > String(prev.onboarded_on || prev.created_at || '')) byKey[k] = c;
    });
    return Object.values(byKey).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [creators]);
  // Scope to the picked brand; keep the current selection visible even when it
  // isn't the identity's newest row (e.g. a note linked from an older month).
  const creatorChoices = useMemo(() => {
    const scoped = f.brand_id ? creatorOptions.filter(c => c.brand_id === f.brand_id) : creatorOptions;
    const sel = f.creator_id ? creatorRowById[f.creator_id] : null;
    return sel && !scoped.some(c => c.id === sel.id) ? [sel, ...scoped] : scoped;
  }, [creatorOptions, creatorRowById, f.brand_id, f.creator_id]);
  const pickCreator = (id) => setF(prev => {
    const row = id ? creatorRowById[id] : null;
    // picking a creator drags their brand along; picking none leaves brand as-is
    return { ...prev, creator_id: id, ...(row?.brand_id && row.brand_id !== prev.brand_id ? { brand_id: row.brand_id } : {}) };
  });
  const pickBrand = (id) => setF(prev => {
    const row = prev.creator_id ? creatorRowById[prev.creator_id] : null;
    // switching to a DIFFERENT brand unlinks a mismatched creator
    return { ...prev, brand_id: id, creator_id: row && id && row.brand_id !== id ? '' : prev.creator_id };
  });

  /* Options for the two searchable selects. `sub` is searched as well as shown,
     so a creator is findable by handle or brand — the old native <option> text
     crammed all three into one string, which nothing could filter on. The brand
     is only worth showing when the list is not already scoped to one. */
  const brandChoiceOptions = useMemo(
    () => brands.map(b => ({ value: b.id, label: b.name })),
    [brands]);
  const creatorChoiceOptions = useMemo(() => creatorChoices.map(c => {
    const h = creatorHandle(c);
    const b = !f.brand_id ? brandById?.[c.brand_id]?.name : '';
    return { value: c.id, label: c.name || 'Unnamed creator', sub: [h, b].filter(Boolean).join(' · ') };
  }), [creatorChoices, brandById, f.brand_id]);

  // Persistence bookkeeping. idRef holds the real id once created so subsequent
  // auto-saves update instead of inserting; the saving/dirty refs serialize writes.
  const idRef = useRef(src.id || null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const skipNextRef = useRef(true); // don't auto-save on initial mount

  const buildPayload = () => ({
    ...(idRef.current ? { id: idRef.current } : {}),
    title: f.title.trim(),
    body: htmlToText(f.body) ? f.body : '', // drop Quill's empty <p><br></p>
    color: f.color,
    brand_id: f.brand_id || null,
    creator_id: f.creator_id || null,
    month: f.month || null,
    labels: f.labels,
    pinned: f.pinned,
    reminder_at: fromLocalInput(reminderInput),
    // Only on CREATE: a note's stream is its page (and, for 'update', its
    // audience), decided where it is written and never moved afterwards.
    ...(idRef.current ? {} : { stream }),
  });

  const flush = useCallback(async () => {
    if (readOnly || !editing) return idRef.current; // view-only / view mode: never persist
    const payload = buildPayload();
    if (!payload.title && !htmlToText(payload.body)) return idRef.current; // never persist a blank note
    if (savingRef.current) { dirtyRef.current = true; return idRef.current; }
    savingRef.current = true;
    setStatus('saving');
    const newId = await onPersist(payload);
    if (newId && !idRef.current) idRef.current = newId;
    savingRef.current = false;
    setStatus('saved');
    if (dirtyRef.current) { dirtyRef.current = false; flush(); }
    return idRef.current;
  }, [f, reminderInput, onPersist, readOnly, editing]);

  // Load the note's current share targets (owner only, existing note).
  useEffect(() => {
    if (!canShare || !idRef.current || !onLoadShares) return;
    let alive = true;
    onLoadShares(idRef.current).then(list => { if (alive) setShareTargets(list || []); }).catch(() => {});
    return () => { alive = false; };
  }, [canShare]); // eslint-disable-line

  const hasTarget = (t) => shareTargets.some(x => shareTokenKey(x) === shareTokenKey(t));
  // Toggle a share target; ensure the note exists first (flush), then persist.
  const toggleTarget = async (t) => {
    const key = shareTokenKey(t);
    const next = hasTarget(t) ? shareTargets.filter(x => shareTokenKey(x) !== key) : [...shareTargets, t];
    setShareTargets(next);
    const id = idRef.current || await flush();
    if (id && onSaveShares) { try { await onSaveShares(id, next); } catch { /* ignore */ } }
  };

  // debounced auto-save on any change
  useEffect(() => {
    if (skipNextRef.current) { skipNextRef.current = false; return; }
    const t = setTimeout(() => flush(), 600);
    return () => clearTimeout(t);
  }, [f, reminderInput]); // eslint-disable-line

  // save-and-close (overlay click, Done, Esc)
  const close = useCallback(() => { flush(); onClose(); }, [flush, onClose]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // save=true also stores the label in the reusable catalogue (for re-labelling).
  function addLabel(raw, save = true) {
    const v = (raw ?? labelInput).trim().replace(/^#/, '');
    if (v && !f.labels.includes(v)) {
      set('labels', [...f.labels, v]);
      if (save && onCreateLabel) onCreateLabel(v);
    }
    setLabelInput('');
  }

  // VIEW mode: a note shared WITH me (read-only), OR my own note before I hit
  // Edit. Shared → Close only; own → Archive/Restore/Delete + Edit.
  if (readOnly || !editing) {
    const brandName = src.brand_id ? brandById?.[src.brand_id]?.name : null;
    const roCreatorName = src.creator_id ? creatorRowById[src.creator_id]?.name : null;
    const isArchived = !!src.archived;
    const sharedWith = !readOnly ? shareSummary(src.shares) : '';
    return (
      <div className={`pc-overlay ${overlayClass}`} onClick={onClose}>
        <div className="pc-modal pc-modal-scroll pc-note-modal" onClick={e => e.stopPropagation()}
          style={{ background: noteColorBg(src, viewerId) }}>
          <div className="pc-modal-body">
            {src.title && <div className="pc-ntitle-in" style={{ pointerEvents: 'none' }}>{src.title}</div>}
            {htmlToText(src.body) && <div className="pc-nbody ac-rte-view" style={{ maxHeight: 'none' }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(src.body) }} />}
            {((readOnly && src.owner_name) || sharedWith || brandName || roCreatorName || src.reminder_at || src.month || (src.labels || []).length > 0) && (
              <div className="pc-nchips" style={{ marginTop: 12 }}>
                {readOnly && src.owner_name && <span className="pc-nchip"><i className="bi bi-person-badge" /> {src.owner_name}</span>}
                {sharedWith && <span className="pc-nchip pc-nchip-shared"><i className="bi bi-send" /> Shared with {sharedWith}</span>}
                {src.reminder_at && !src.reminder_done && <span className="pc-nchip pc-nchip-rem"><i className="bi bi-alarm" /> {reminderLabel(src.reminder_at)}</span>}
                {brandName && <span className="pc-nchip pc-nchip-brand"><i className="bi bi-shop" /> {brandName}</span>}
                {roCreatorName && <span className="pc-nchip pc-nchip-creator"><i className="bi bi-person" /> {roCreatorName}</span>}
                {src.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(src.month)}</span>}
                {(src.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
              </div>
            )}
          </div>
          <div className="pc-modal-actions">
            {readOnly ? (
              <span className="pc-nstatus"><i className="bi bi-eye" /> Shared with you — read-only</span>
            ) : isArchived ? (
              <>
                {onArchive && <button className="pc-btn pc-btn-ghost" onClick={onArchive}><i className="bi bi-arrow-counterclockwise" />Restore</button>}
                {onDelete && <button className="pc-btn pc-btn-ghost pc-btn-danger" onClick={onDelete}><i className="bi bi-trash" />Delete</button>}
              </>
            ) : (
              onArchive && <button className="pc-btn pc-btn-ghost" onClick={onArchive}><i className="bi bi-archive" />Archive</button>
            )}
            <div style={{ flex: 1 }} />
            {readOnly ? (
              <button className="pc-btn pc-btn-primary" onClick={onClose}>Close</button>
            ) : (
              <>
                <button className="pc-btn pc-btn-ghost" onClick={onClose}>Close</button>
                <button className="pc-btn pc-btn-primary" onClick={() => { skipNextRef.current = true; setEditing(true); }}><i className="bi bi-pencil" />Edit</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const catalogSuggestions = (labelCatalog || [])
    .filter(l => !f.labels.includes(l.name))
    .slice(0, 12);

  return (
    <div className={`pc-overlay ${overlayClass}`} onClick={close}>
      <div className="pc-modal pc-modal-scroll pc-note-modal" onClick={e => e.stopPropagation()}
        style={{ background: OWN_BG }}>
        <div className="pc-modal-body">
        <input className="pc-ntitle-in" placeholder="Title" value={f.title}
          onChange={e => set('title', e.target.value)} autoFocus />
        <div className="pc-nbody-rte">
          <RichTextEditor value={f.body} onChange={html => set('body', html)}
            placeholder="Take a note…" minHeight={150} />
        </div>

        {/* labels */}
        <div className="pc-nlabels">
          {f.labels.map(l => (
            <span key={l} className="pc-nchip pc-nchip-edit"><i className="bi bi-tag" /> {l}
              <button onClick={() => set('labels', f.labels.filter(x => x !== l))}>×</button>
            </span>
          ))}
          <input className="pc-nlabel-in" placeholder="+ label" value={labelInput}
            onChange={e => setLabelInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addLabel(); } }}
            onBlur={() => labelInput.trim() && addLabel()} />
        </div>
        {catalogSuggestions.length > 0 && (
          <div className="pc-nlabel-pick">
            <span className="pc-nlabel-pick-hd">Your labels</span>
            {catalogSuggestions.map(l => (
              <button key={l.id} type="button" className="pc-nchip pc-nchip-pick"
                onClick={() => addLabel(l.name, true)}><i className="bi bi-tag" /> {l.name}</button>
            ))}
          </div>
        )}

        <div className="pc-nrow">
          <div className="pc-field"><label>Brand</label>
            <SearchSelect value={f.brand_id} onChange={pickBrand} placeholder="Search brands…"
              options={brandChoiceOptions} />
          </div>
          <div className="pc-field"><label>Program (month)</label>
            <MonthField variant="field" className="w-100" value={f.month}
              onChange={v => set('month', v)} />
          </div>
          {creators.length > 0 && (
            <div className="pc-field"><label>Creator</label>
              <SearchSelect value={f.creator_id} onChange={pickCreator} placeholder="Search creators…"
                options={creatorChoiceOptions} />
            </div>
          )}
        </div>

        {stream !== 'update' && (
        <div className="pc-field"><label>Reminder</label>
          <div className="pc-nrem-row">
            <DateTimeField className="flex-grow-1" value={reminderInput}
              onChange={v => { setReminderInput(v); if (v) requestNotificationPermission(); }} />
            {reminderInput && <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setReminderInput('')}>Clear</button>}
          </div>
          <div className="pc-nrem-hint">Shows a browser + in-app notification when due. Allow notifications when prompted.</div>
        </div>
        )}

        {/* share with role groups / teams (internal staff, own notes) */}
        {canShare && (
          <div className="pc-nshare">
            <label className="pc-field-label"><i className="bi bi-people" /> Share with</label>
            <div className="pc-nshare-chips">
              {viewerIsSuperbob && (
                <button type="button" className={`pc-nshare-chip ${hasTarget({ kind: 'all' }) ? 'on' : ''}`}
                  onClick={() => toggleTarget({ kind: 'all' })}><i className="bi bi-globe2" /> Everyone</button>
              )}
              {roleTargets.map(r => (
                <button key={r.role} type="button"
                  className={`pc-nshare-chip ${hasTarget({ kind: 'role', role: r.role }) ? 'on' : ''}`}
                  onClick={() => toggleTarget({ kind: 'role', role: r.role })}>{r.label}</button>
              ))}
            </div>
            {viewerIsSuperbob && teamLeads.length > 0 && (
              <>
                <label className="pc-field-label" style={{ marginTop: 8 }}><i className="bi bi-diagram-3" /> Or a specific team</label>
                <div className="pc-nshare-chips">
                  {teamLeads.map(tl => (
                    <button key={tl.id} type="button"
                      className={`pc-nshare-chip ${hasTarget({ kind: 'team', team: tl.id }) ? 'on' : ''}`}
                      onClick={() => toggleTarget({ kind: 'team', team: tl.id })}>{tl.name}'s team</button>
                  ))}
                </div>
              </>
            )}
            <div className="pc-nrem-hint">Recipients can view (not edit); the note shows on their board tinted by your role.</div>
          </div>
        )}
        </div>{/* /pc-modal-body */}

        <div className="pc-modal-actions">
          {stream !== 'update' && (
            <label className="pc-npin-toggle">
              <input type="checkbox" checked={f.pinned} onChange={e => set('pinned', e.target.checked)} /> Pin
            </label>
          )}
          <span className="pc-nstatus">{status === 'saving' ? 'Saving…' : status === 'saved' ? <><i className="bi bi-check2" /> Saved</> : ''}</span>
          <div style={{ flex: 1 }} />
          {/* Delete is archive-gated — the composer only offers Archive. */}
          {onArchive && !src.archived && <button className="pc-btn pc-btn-ghost" onClick={onArchive}><i className="bi bi-archive" />Archive</button>}
          <button className="pc-btn pc-btn-primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ── Searchable select ──
   A <select> replacement with a type-to-filter box: a native select has no
   search, and a handler with dozens of brands (or hundreds of creator deals)
   cannot find a name by scrolling one.

   Expands INLINE rather than as a floating menu on purpose — the note editor's
   body is a scroll container (.pc-modal-scroll), so an absolutely positioned
   panel would be clipped by it, and .pc-modal animates with a transform, which
   would trap a position:fixed panel too.

   options: [{ value, label, sub? }] — `sub` is searched as well as shown, so a
   creator is findable by their handle or brand, not just their name. */

/* Keeps a SCOPED drawer's list honest once brand/creator became editable.
   `belongs` says whether a saved note still falls inside this drawer: a note
   reassigned elsewhere drops out, and a new note created for another
   brand/creator is never inserted. Without this the drawer would show a note
   that contradicts its own heading until the next reload. */
function upsertScoped(setList, row, belongs) {
  const keep = belongs ? !!belongs(row) : true;
  setList(prev => {
    const i = prev.findIndex(n => n.id === row.id);
    if (i === -1) return keep ? [row, ...prev] : prev;
    if (!keep) return prev.filter(n => n.id !== row.id);
    const next = prev.slice();
    next[i] = { ...prev[i], ...row };   // keep server fields the payload lacks
    return next;
  });
}

/* ── Brand notes drawer ──
   Slide-over listing a single brand's Keep notes (used from the Brands tab,
   next to the brand name). Click a note to open the same auto-saving editor;
   "New" PRE-LINKS the note to this brand but does not pin it — the Brand and
   Creator selects stay editable, and a note moved to another brand simply
   leaves this list. */
export function BrandNotesDrawer({ brandId, brandName, brands, brandById, creators = [], month, notes = [], onClose, onChanged }) {
  const { user } = useAuth();
  const [list, setList] = useState(() => notes.filter(n => !n.archived));
  const [editor, setEditor] = useState(null);
  useEffect(() => { setList(notes.filter(n => !n.archived)); }, [notes]);
  const creatorNames = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = c.name; }); return m;
  }, [creators]);

  // The brand comes from the payload, NOT from the drawer: forcing brand_id here
  // silently discarded a brand the user picked in the editor.
  const belongs = useCallback((n) => n.brand_id === brandId, [brandId]);
  const persist = useCallback(async (payload) => {
    if (payload.id) {
      upsertScoped(setList, payload, belongs);
      try { await store.updateNote(payload.id, stripId(payload)); } catch {}
      onChanged && onChanged();
      return payload.id;
    }
    try {
      const row = await store.createNote(stripId(payload));
      upsertScoped(setList, row, belongs);
      onChanged && onChanged();
      return row.id;
    } catch { return null; }
  }, [belongs, onChanged]);

  const remove = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.deleteNote(n.id); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  // Archive (delete is archive-gated): drops the note from this active list.
  const archive = useCallback(async (n) => {
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.updateNote(n.id, { archived: true }); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  const sorted = [...list].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));

  return (
    <>
      <div className="pc-drawer-overlay" onClick={onClose}>
        <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="pc-drawer-head">
            <div className="pc-drawer-head-l">
              <BrandAva name={brandName} logo={brandById?.[brandId]?.logo_url} />
              <div>
                <div className="pc-drawer-title">{brandName}</div>
                <div className="pc-drawer-sub">{sorted.length} note{sorted.length === 1 ? '' : 's'}</div>
              </div>
            </div>
            <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => setEditor({ mode: 'add', note: { color: 'default', labels: [], brand_id: brandId, month: month || null } })}>
              <i className="bi bi-plus-lg" />New
            </button>
          </div>
          <div className="pc-drawer-body">
            {sorted.length === 0 ? (
              <div className="pc-nempty" style={{ padding: '46px 10px' }}>
                <div className="pc-nempty-ico"><i className="bi bi-journal-text" /></div>
                <div className="pc-nempty-t">No notes yet</div>
                <div className="pc-nempty-s">Add a note to track reminders, deliverables and follow-ups for {brandName}.</div>
              </div>
            ) : (
              <div className="pc-bnlist">
                {sorted.map(n => {
                  const text = htmlToText(n.body);
                  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
                  return (
                    <button key={n.id} className="pc-bnitem" style={{ background: noteColorBg(n, user?.id) }} onClick={() => setEditor({ mode: 'edit', note: n })}>
                      {n.pinned && <i className="bi bi-pin-angle-fill pc-bnpin" />}
                      {n.title && <div className="pc-bntitle">{n.title}</div>}
                      {text && <div className="pc-bnsnippet">{text}</div>}
                      {(n.reminder_at || n.creator_id || n.month || (n.labels || []).length > 0) && (
                        <div className="pc-nchips">
                          {n.reminder_at && !n.reminder_done && <span className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`}><i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}</span>}
                          {n.creator_id && creatorNames[n.creator_id] && <span className="pc-nchip pc-nchip-creator"><i className="bi bi-person" /> {creatorNames[n.creator_id]}</span>}
                          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
                          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} creators={creators} month={month}
          viewerId={user?.id} overlayClass="pc-overlay-top"
          onClose={() => setEditor(null)} onPersist={persist}
          onArchive={editor.mode === 'edit' ? () => { setEditor(null); archive(editor.note); } : null}
          onDelete={editor.mode === 'edit' ? () => { setEditor(null); remove(editor.note); } : null} />
      )}
    </>
  );
}

/* ── Creator notes drawer ──
   Slide-over listing ONE creator's Keep notes (opened from the journal icon
   next to a creator's name in the Drilldown / Creators tab). The caller passes
   the notes pre-filtered by creator identity (notes follow the creator across
   months within the brand); "New" PRE-LINKS this deal row + its brand, but both
   selects stay editable — a note filed against the wrong person is otherwise
   only fixable from the global notes board.
   `belongs` mirrors the caller's identity filter so a note reassigned to
   someone else leaves this list; it falls back to the deal row when the caller
   passes none. */
export function CreatorNotesDrawer({ creator, brands, brandById, creators = [], month, notes = [], onClose, onChanged, belongs = null }) {
  // creator: { id (deal row new notes link to), name, handle, brandId, brandName }
  const { user } = useAuth();
  const [list, setList] = useState(() => notes.filter(n => !n.archived));
  const [editor, setEditor] = useState(null);
  useEffect(() => { setList(notes.filter(n => !n.archived)); }, [notes]);

  const inScope = useCallback(
    (n) => (belongs ? belongs(n) : n.creator_id === creator.id),
    [belongs, creator.id]);
  // creator_id / brand_id come from the payload, NOT from the drawer: forcing
  // them here silently discarded whatever the user picked in the editor.
  const persist = useCallback(async (payload) => {
    if (payload.id) {
      upsertScoped(setList, payload, inScope);
      try { await store.updateNote(payload.id, stripId(payload)); } catch {}
      onChanged && onChanged();
      return payload.id;
    }
    try {
      const row = await store.createNote(stripId(payload));
      upsertScoped(setList, row, inScope);
      onChanged && onChanged();
      return row.id;
    } catch { return null; }
  }, [inScope, onChanged]);

  const remove = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.deleteNote(n.id); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  // Archive (delete is archive-gated): drops the note from this active list.
  const archive = useCallback(async (n) => {
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.updateNote(n.id, { archived: true }); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  const sorted = [...list].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));

  return (
    <>
      <div className="pc-drawer-overlay" onClick={onClose}>
        <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="pc-drawer-head">
            <div className="pc-drawer-head-l">
              <span className="pc-ava" style={{ background: getGradient(creator.name) }}>{(creator.name || '?')[0]?.toUpperCase()}</span>
              <div>
                <div className="pc-drawer-title">{creator.name}</div>
                <div className="pc-drawer-sub">
                  {[creator.handle, creator.brandName].filter(Boolean).join(' · ')}
                  {(creator.handle || creator.brandName) ? ' · ' : ''}{sorted.length} note{sorted.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => setEditor({ mode: 'add', note: { color: 'default', labels: [], brand_id: creator.brandId || null, creator_id: creator.id, month: month || null } })}>
              <i className="bi bi-plus-lg" />New
            </button>
          </div>
          <div className="pc-drawer-body">
            {sorted.length === 0 ? (
              <div className="pc-nempty" style={{ padding: '46px 10px' }}>
                <div className="pc-nempty-ico"><i className="bi bi-journal-text" /></div>
                <div className="pc-nempty-t">No notes yet</div>
                <div className="pc-nempty-s">Add a note to track deals, deliverables and follow-ups for {creator.name}.</div>
              </div>
            ) : (
              <div className="pc-bnlist">
                {sorted.map(n => {
                  const text = htmlToText(n.body);
                  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
                  return (
                    <button key={n.id} className="pc-bnitem" style={{ background: noteColorBg(n, user?.id) }} onClick={() => setEditor({ mode: 'edit', note: n })}>
                      {n.pinned && <i className="bi bi-pin-angle-fill pc-bnpin" />}
                      {n.title && <div className="pc-bntitle">{n.title}</div>}
                      {text && <div className="pc-bnsnippet">{text}</div>}
                      {(n.reminder_at || n.month || (n.labels || []).length > 0) && (
                        <div className="pc-nchips">
                          {n.reminder_at && !n.reminder_done && <span className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`}><i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}</span>}
                          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
                          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} creators={creators} month={month}
          viewerId={user?.id} overlayClass="pc-overlay-top"
          onClose={() => setEditor(null)} onPersist={persist}
          onArchive={editor.mode === 'edit' ? () => { setEditor(null); archive(editor.note); } : null}
          onDelete={editor.mode === 'edit' ? () => { setEditor(null); remove(editor.note); } : null} />
      )}
    </>
  );
}

/* ── All-notes drawer ──
   Global, searchable list of every note — opened from the floating notes button
   so any note is reachable from anywhere in the handler workspace. Also reused
   by the Super Boss "Ads Manager notes" view (notes carry an injected
   owner_name shown as a chip). Includes a brand-wise filter.
   fixedBrand {id,name}: pin the drawer to ONE brand — only that brand's notes
   and no brand filter. New notes are PRE-LINKED to it, but the editor's Brand
   select stays editable; a note moved to another brand leaves this list.
   defaultBrand {id,name}: the SOFTER version — the brand filter OPENS on that
   brand (and a new note is pre-linked to it), but the searchable brand select
   stays on screen and every other brand is one pick away. Used where the page
   is ABOUT a brand without being that brand's own page — a weekly or monthly
   report — so the drawer opens on the notes you came for without deciding for
   you that nothing else exists. fixedBrand wins where both are passed.
   canEditNote(n): notes failing it open read-only. Defaults to "only the owner
   edits" — a host that renders shared-in notes and forgets to pass it would
   otherwise open a colleague's note in the composer, where the write is refused
   by RLS and swallowed, i.e. the edit silently evaporates.
   viewerRole / viewerIsSuperbob / teamLeads: drive the
   editor's Share section.
   labelCatalog / onCreateLabel: reusable saved labels. */
export function AllNotesDrawer({ notes = [], brands, brandById, creators = [], month, onClose, onChanged,
  canCreate = true, title = 'All notes', fixedBrand = null, canEditNote = null,
  /* Which Notes page this drawer is showing (20260904090000): it decides what a
     new note is stamped with and which controls the composer offers. `tabs` is
     an optional node the caller puts above the list — the fab's Updates Timeline /
     Private Notes switch — so the switch lives with whoever owns both lists. */
  stream = 'private', tabs = null, defaultBrand = null,
  viewerRole, viewerIsSuperbob = false,
  teamLeads = [], labelCatalog = [], onCreateLabel,
  onLoadShares = store.loadNoteShares, onSaveShares = store.setNoteShares }) {
  const { user } = useAuth();
  const canEdit = useCallback(
    (n) => (canEditNote ? canEditNote(n) : isOwnNote(n, user?.id)),
    [canEditNote, user?.id]);
  const scoped = useCallback(
    (arr) => arr.filter(n => !n.archived && (!fixedBrand || n.brand_id === fixedBrand.id)),
    [fixedBrand]);
  const [list, setList] = useState(() => scoped(notes));
  const [editor, setEditor] = useState(null);
  const [search, setSearch] = useState('');
  // 'all' | 'none' | <brand_id>. A defaultBrand only decides where it STARTS —
  // it is an ordinary selection from there on, which is the whole difference
  // between it and fixedBrand.
  const softBrandId = !fixedBrand && defaultBrand ? defaultBrand.id : null;
  const [brandFilter, setBrandFilter] = useState(softBrandId || 'all');
  // Follow a change of page while the drawer is open (report → report), but
  // never undo a pick the viewer has since made on THIS brand.
  const softRef = useRef(softBrandId);
  useEffect(() => {
    if (softRef.current === softBrandId) return;
    softRef.current = softBrandId;
    setBrandFilter(softBrandId || 'all');
  }, [softBrandId]);
  useEffect(() => { setList(scoped(notes)); }, [notes, scoped]);
  const creatorNames = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = c.name; }); return m;
  }, [creators]);

  // Pinned to a brand: a note moved off it leaves this list (unpinned = keep all).
  const inScope = useCallback(
    (n) => !fixedBrand || n.brand_id === fixedBrand.id,
    [fixedBrand]);
  const persist = useCallback(async (payload) => {
    if (payload.id) {
      upsertScoped(setList, payload, inScope);
      try { await store.updateNote(payload.id, stripId(payload)); } catch {}
      onChanged && onChanged();
      return payload.id;
    }
    try {
      const row = await store.createNote(stripId(payload));
      upsertScoped(setList, row, inScope);
      onChanged && onChanged();
      return row.id;
    } catch { return null; }
  }, [inScope, onChanged]);

  const remove = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.deleteNote(n.id); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  // Archive (delete is archive-gated): drops the note from this active list.
  const archive = useCallback(async (n) => {
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.updateNote(n.id, { archived: true }); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  // Brand-wise filter options, built from the notes themselves (with counts).
  const brandOptions = useMemo(() => {
    const m = {};
    list.forEach(n => { if (n.brand_id) m[n.brand_id] = (m[n.brand_id] || 0) + 1; });
    // The pre-selected brand is always offered, even at zero notes: otherwise
    // the select would sit on a value it does not list and render blank, which
    // reads as "no filter" on exactly the screen that just applied one.
    if (softBrandId && !m[softBrandId]) m[softBrandId] = 0;
    return Object.entries(m)
      .map(([id, count]) => ({
        id, count,
        name: brandById[id]?.name || (id === softBrandId ? defaultBrand?.name : null) || 'Brand',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [list, brandById, softBrandId, defaultBrand]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let l = list;
    if (brandFilter === 'none') l = l.filter(n => !n.brand_id);
    else if (brandFilter !== 'all') l = l.filter(n => n.brand_id === brandFilter);
    if (q) l = l.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      htmlToText(n.body).toLowerCase().includes(q) ||
      (n.labels || []).some(x => x.toLowerCase().includes(q)) ||
      (n.owner_name || '').toLowerCase().includes(q) ||
      (n.creator_id && (creatorNames[n.creator_id] || '').toLowerCase().includes(q)) ||
      (n.brand_id && (brandById[n.brand_id]?.name || '').toLowerCase().includes(q)));
    return [...l].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));
  }, [list, search, brandFilter, brandById, creatorNames]);

  return (
    <>
      <div className="pc-drawer-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="pc-drawer-head">
            <div className="pc-drawer-head-l">
              <span className="pc-ava" style={{ background: 'var(--pc-accent)', color: '#fff' }}><i className="bi bi-journal-text" /></span>
              <div>
                <div className="pc-drawer-title">{title}</div>
                <div className="pc-drawer-sub">{list.length} note{list.length === 1 ? '' : 's'}</div>
              </div>
            </div>
            {canCreate && (
              <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => {
                setEditor({ mode: 'add', note: { color: 'default', labels: [], brand_id: fixedBrand ? fixedBrand.id : (softBrandId || null), month: month || null } });
              }}>
                <i className="bi bi-plus-lg" />New
              </button>
            )}
          </div>
          <div className="pc-drawer-body">
            {tabs}
            <div className="pc-nsearch" style={{ marginBottom: 10 }}>
              <i className="bi bi-search" />
              <input placeholder="Search all notes…" value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button className="pc-nsearch-x" onClick={() => setSearch('')}>×</button>}
            </div>
            {!fixedBrand && brandOptions.length > 0 && (
              <select className="pc-input" style={{ marginBottom: 14 }} value={brandFilter}
                onChange={e => setBrandFilter(e.target.value)} aria-label="Filter by brand">
                <option value="all">All brands</option>
                <option value="none">No brand</option>
                {brandOptions.map(b => <option key={b.id} value={b.id}>{b.name} ({b.count})</option>)}
              </select>
            )}
            {visible.length === 0 ? (
              <div className="pc-nempty" style={{ padding: '40px 10px' }}>
                <div className="pc-nempty-ico"><i className="bi bi-journal-text" /></div>
                <div className="pc-nempty-t">{search ? 'No matching notes' : 'No notes yet'}</div>
                <div className="pc-nempty-s">{search
                  ? 'Try a different search.'
                  : stream === 'update'
                    ? 'Post an update and the whole team sees it.'
                    : 'Create a note to track reminders, deliverables and follow-ups.'}</div>
              </div>
            ) : (
              <div className="pc-bnlist">
                {visible.map(n => {
                  const text = htmlToText(n.body);
                  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
                  const brandName = n.brand_id ? brandById[n.brand_id]?.name : null;
                  const sharedBy = !isOwnNote(n, user?.id) ? (n.owner_name || ROLE_LABEL[ownerRoleKey(n)]) : null;
                  const sharedWith = isOwnNote(n, user?.id) ? shareSummary(n.shares) : '';
                  return (
                    <button key={n.id} className="pc-bnitem" style={{ background: noteColorBg(n, user?.id) }} onClick={() => setEditor({ mode: 'edit', note: n })}>
                      {n.pinned && <i className="bi bi-pin-angle-fill pc-bnpin" />}
                      {n.title && <div className="pc-bntitle">{n.title}</div>}
                      {text && <div className="pc-bnsnippet">{text}</div>}
                      {(sharedBy || sharedWith || brandName || n.creator_id || n.reminder_at || n.month || (n.labels || []).length > 0) && (
                        <div className="pc-nchips">
                          {sharedBy && <span className="pc-nchip"><i className="bi bi-person-badge" /> {sharedBy}</span>}
                          {sharedWith && <span className="pc-nchip pc-nchip-shared"><i className="bi bi-send" /> {sharedWith}</span>}
                          {n.reminder_at && !n.reminder_done && <span className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`}><i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}</span>}
                          {brandName && <span className="pc-nchip pc-nchip-brand"><i className="bi bi-shop" /> {brandName}</span>}
                          {n.creator_id && creatorNames[n.creator_id] && <span className="pc-nchip pc-nchip-creator"><i className="bi bi-person" /> {creatorNames[n.creator_id]}</span>}
                          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
                          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} creators={creators} month={month}
          overlayClass="pc-overlay-top" stream={stream}
          viewerId={user?.id} viewerRole={viewerRole} viewerIsSuperbob={viewerIsSuperbob}
          teamLeads={teamLeads} labelCatalog={mergeLabelChoices(labelCatalog, notes, user?.id)} onCreateLabel={onCreateLabel}
          onLoadShares={onLoadShares} onSaveShares={onSaveShares}
          readOnly={editor.mode === 'edit' && !canEdit(editor.note)}
          onClose={() => { setEditor(null); onChanged && onChanged(); }} onPersist={persist}
          onArchive={editor.mode === 'edit' && canEdit(editor.note) ? () => { setEditor(null); archive(editor.note); } : null}
          onDelete={editor.mode === 'edit' && canEdit(editor.note) ? () => { setEditor(null); remove(editor.note); } : null} />
      )}
    </>
  );
}
