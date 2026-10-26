// @ts-nocheck
/* ════════════════════════════════════════════════════════════
   Templates — the handler team's shared library of the messages they send
   over and over, and the panel that fills one in.

   ‼️ IT FETCHES ITS OWN ROWS, like BestVideosBoard and unlike every other tab
   in this workspace. reload() already costs ten parallel round trips on every
   workspace load; a library most people open a few times a week does not
   belong in that set. The cost is one query when the tab is first opened.

   ‼️ NOTHING HERE SENDS A MESSAGE. The tab produces text and copies it; the
   handler pastes it into the TikTok / WhatsApp / e-mail thread they are
   already in. There is deliberately no "sent" state, no recipient column and
   no history — see the migration for why that boundary matters.

   ‼️ THE LIBRARY IS SHARED. Anyone in the handler group may correct the
   wording everyone is pasting, so an edit is not gated on authorship. Only
   DELETING is (author or Bob), and a delete somebody may not perform is drawn
   DISABLED with the reason on it rather than hidden — a missing control reads
   as a bug, a disabled one that names who can reads as a rule (the
   2026-09-11 creator-directory call).
════════════════════════════════════════════════════════════ */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as store from './store';
import SearchSelect from './SearchSelect';
import { copyWithToast, showToast } from '../../lib/copyToast';
import { clientStatus, STATUS } from '../paid-collab/handlerCollabReadonly';
import {
  TEMPLATE_AUDIENCES, audienceMeta, placeholdersFor, placeholdersIn, fillTemplate,
  categoryOptions, templatePreview, templateMatches,
} from '../../lib/messageTemplates';

/* Full month name — "September 2026", not the "Sep 2026" the tables use. This
   string is pasted into a message to a person, where the abbreviation reads as
   a spreadsheet cell. */
function fullMonthLabel(key) {
  if (!key || !/^\d{4}-\d{2}$/.test(key)) return '';
  const [y, m] = key.split('-').map(Number);
  try {
    return new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return key;
  }
}

/* "added 14 Oct 2026" — when the deal row was created, read in local time. */
function addedLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `added ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/* Money in the BRAND's own currency — a figure quoted to a creator or a client
   must carry the currency they are actually paid in, and this tab spans every
   brand at once, so the module-global setReportCurrency() the single-brand
   views use is the wrong instrument here. */
function money(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: (currency || 'USD').toUpperCase(), maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)}`;
  }
}

/* A blank is NOT a zero. "$0 of the budget is still unallocated" is a claim;
   "no budget has been set for this month" is the truth, and the fill panel says
   so by leaving the placeholder visible. Same rule as brandMonthExport. */
const moneyOrBlank = (value, currency) =>
  (Number(value) || value === 0) && Number.isFinite(Number(value)) && Number(value) !== 0
    ? money(value, currency)
    : '';

/* The brand's focus products for the month — the ones a handler adds with the
   "+ Focus product" chips in the Edit-budget popup. Same reader as
   focusProductList() in HandlerCollabApp, including its LEGACY arm: before
   product names existed the column held newline-separated bare URLs, so those
   rows produce a url with no name and must still render. */
function focusProducts(bm) {
  const raw = bm?.focus_product_url || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(p => (typeof p === 'string'
          ? { name: '', url: p }
          : { name: (p?.name || '').trim(), url: (p?.url || '').trim() }))
        .filter(p => p.name || p.url);
    }
  } catch { /* fall through to the legacy shape */ }
  return String(raw).split(/\n+/).map(t => t.trim()).filter(Boolean).map(url => ({ name: '', url }));
}

/* ‼️ ONE PRODUCT PER LINE, name AND link — this is the block a creator is
   actually sent, and a product they were only told the name of is one they
   cannot open. A product with only one of the two prints just that, rather
   than a dangling dash. */
const productBlock = list => list
  .map(p => (p.name && p.url ? `${p.name} — ${p.url}` : (p.url || p.name)))
  .join('\n');

/* The inline form, for the mid-sentence case a multi-line block would break. */
const productNames = list => list.map(p => p.name).filter(Boolean).join(', ');

const postedVideos = c => (Array.isArray(c?.video_codes) ? c.video_codes.filter(v => v?.video && !v?.extra).length : 0);

const firstHandle = (raw) => {
  const first = String(raw || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  const bare = (first.startsWith('http') ? (first.replace(/\/+$/, '').split('/').pop() || '') : first)
    .replace(/^@+/, '').trim();
  return bare ? `@${bare}` : '';
};

/* ── The creator's contract link ──
   The e-signing link the creator opens to read and sign — the same
   `${origin}/sign/<token>` the Contract column's share modal hands out — with
   the LEGACY `contract_url` (a hand-pasted Drive URL from before e-signing) as
   the fallback for deals that predate it.

   ‼️ A DEACTIVATED, UNSIGNED LINK COUNTS AS NOTHING. It resolves to a page the
   creator cannot use, and pasting a dead URL into their DM is worse than
   leaving "{contract}" visible for somebody to notice. A SIGNED link is still
   returned: it serves the signed copy, which is a perfectly good thing to send
   somebody who asks for it.

   Returns '' when there is nothing sendable, which fillTemplate reports as
   missing. */
export function contractUrlFor(creator, contractLinkFor) {
  const link = typeof contractLinkFor === 'function' ? contractLinkFor(creator) : null;
  if (link?.token && (link.active || link.signed_at)) {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/sign/${link.token}`;
  }
  return String(creator?.contract_url || '').trim();
}

/* ── Who may delete this template ──
   The UI mirror of the "hmt delete" policy. It returns the REASON as well as
   the verdict so the disabled button can explain itself; RLS is still the
   enforcement, and deleteMessageTemplate reports a zero-row delete if the two
   ever disagree. */
export function templateDeleteRule(t, myId, isBob) {
  if (isBob) return { can: true, why: '' };
  if (t?.created_by && t.created_by === myId) return { can: true, why: '' };
  if (!t?.created_by) {
    return { can: false, why: 'This is one of the starter templates. Only a Boss can remove it.' };
  }
  return { can: false, why: `Only ${t.created_by_name || 'whoever wrote it'} or a Boss can remove this template.` };
}

/* ════════════════════════════════════════════════════════════
   The fill panel: pick who it is for, read the message back, copy it.
════════════════════════════════════════════════════════════ */
function UseTemplateModal({ tpl, brandRows, brands = [], creators, month, myName, contractLinkFor, onClose }) {
  const forCreator = tpl.audience === 'creator';

  // Creator templates open on the creator picker, because picking one fills
  // the brand in as well — a deal knows its own brand, so asking for both
  // would be asking the same question twice.
  const [creatorId, setCreatorId] = useState('');
  const [brandId, setBrandId] = useState('');

  const creator = useMemo(
    () => creators.find(c => c.id === creatorId) || null,
    [creators, creatorId],
  );

  // A picked creator decides the brand; otherwise the brand is chosen directly.
  const effectiveBrandId = creator ? creator.brand_id : brandId;
  const row = useMemo(
    () => brandRows.find(r => r.id === effectiveBrandId) || null,
    [brandRows, effectiveBrandId],
  );

  /* ── Narrowing the creator list ──
     ‼️ A creator row is ONE DEAL — one brand, one month — so a person who ran
     three programs is three rows with the same name, and a bare name list
     cannot tell them apart. The picker therefore (a) can be narrowed by brand
     and by program month first, and (b) names the brand + month on every row
     whose name is not unique in what is left, so the closed trigger still says
     WHICH deal was picked. */
  const brandName = useCallback((id) => {
    const r = brandRows.find(x => x.id === id);
    if (r) return r.brand || '';
    const b = brands.find(x => x.id === id);
    return b?.name || '';
  }, [brandRows, brands]);
  const dealMonth = (c) => String(c.onboarded_on || '').slice(0, 7);

  const [fBrand, setFBrand] = useState('');
  const [fMonth, setFMonth] = useState('');

  const named = useMemo(() => creators.filter(c => (c.name || '').trim()), [creators]);
  const filterBrands = useMemo(() => {
    const ids = [...new Set(named.map(c => c.brand_id).filter(Boolean))];
    return ids.map(id => ({ id, name: brandName(id) || 'Unknown brand' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [named, brandName]);
  const filterMonths = useMemo(() => {
    const pool = fBrand ? named.filter(c => c.brand_id === fBrand) : named;
    return [...new Set(pool.map(dealMonth).filter(m => /^\d{4}-\d{2}$/.test(m)))].sort().reverse();
  }, [named, fBrand]);
  // A month that the newly picked brand never ran is dropped rather than left
  // filtering the list down to nothing.
  useEffect(() => {
    if (fMonth && !filterMonths.includes(fMonth)) setFMonth('');
  }, [filterMonths, fMonth]);

  const creatorOptions = useMemo(() => {
    const pool = named.filter(c =>
      (!fBrand || c.brand_id === fBrand) && (!fMonth || dealMonth(c) === fMonth));
    const nameCount = new Map();
    for (const c of pool) {
      const k = c.name.trim().toLowerCase();
      nameCount.set(k, (nameCount.get(k) || 0) + 1);
    }
    return pool
      .map(c => {
        const brand = brandName(c.brand_id);
        const mon = fullMonthLabel(dealMonth(c));
        const dup = nameCount.get(c.name.trim().toLowerCase()) > 1;
        const status = (STATUS[clientStatus(c, false)] || STATUS.videos_in_progress).label;
        return {
          value: c.id,
          label: dup ? `${c.name} — ${[brand, mon].filter(Boolean).join(' · ')}` : c.name,
          // Every part is SEARCHED by SearchSelect, word by word — so
          // "jane wetcat sept" finds that one deal.
          sub: [firstHandle(c.tiktok_handle), brand, mon, status, addedLabel(c.created_at)].filter(Boolean).join(' · '),
          _name: c.name, _month: dealMonth(c), _added: String(c.created_at || ''),
        };
      })
      // Newest-added deal first (the one you are most likely messaging about),
      // then the newest program month, then name as a stable tiebreak.
      .sort((a, b) => b._added.localeCompare(a._added)
        || b._month.localeCompare(a._month)
        || a._name.localeCompare(b._name))
      .map(({ _name, _month, _added, ...o }) => o);
  }, [named, fBrand, fMonth, brandName]);

  // A picked deal that the filters now hide stays picked — the trigger would
  // otherwise read "Pick a creator" while the message is still filled from it.
  const pickedHidden = creatorId && !creatorOptions.some(o => o.value === creatorId);

  const brandOptions = useMemo(
    () => brandRows.map(r => ({ value: r.id, label: r.brand, sub: r.client || '' })),
    [brandRows],
  );

  const values = useMemo(() => {
    const v = { me: myName || '' };

    if (row) {
      const cur = row.currency || 'USD';
      v.brand = row.brand || '';
      v.month = fullMonthLabel(month);
      v.budget = moneyOrBlank(row.budget, cur);
      v.remaining = moneyOrBlank(row.remaining, cur);
      // Counts: 0 is a real answer ("we have 0 creators live"), unlike money.
      v.creators = String(row.creators ?? '');
      v.content_guide = row.bm?.content_guide_url || '';
      const prods = focusProducts(row.bm);
      v.products = productBlock(prods);
      v.product_names = productNames(prods);
      v.videos = String(row.videos ?? '');
      v.delivered = String(row.delivered ?? '');
      v.remaining_videos = String(Math.max(0, (row.videos || 0) - (row.delivered || 0)));
    }

    if (creator) {
      const cur = row?.currency || 'USD';
      const agreed = parseInt(creator.videos_count, 10) || 0;
      const done = postedVideos(creator);
      v.creator = creator.name || '';
      v.handle = firstHandle(creator.tiktok_handle);
      v.deal = moneyOrBlank(creator.amount, cur);
      // ‼️ The CLIENT-FACING wording, never the internal label. STATUS calls a
      // stalled deal "Follow-up Required", which is a note to ourselves — it
      // must not be pasted into the creator's own DM. clientStatus(c, false)
      // is the same mask the share link and the client portal already apply.
      v.status = (STATUS[clientStatus(creator, false)] || STATUS.videos_in_progress).label;
      v.contract = contractUrlFor(creator, contractLinkFor);
      // A creator template's counts are the DEAL's, overriding the brand-wide
      // ones set above: "we agreed 5 videos" means theirs, not the month's.
      v.videos = String(agreed);
      v.delivered = String(done);
      v.remaining_videos = String(Math.max(0, agreed - done));
    }

    return v;
  }, [row, creator, month, myName, contractLinkFor]);

  const result = useMemo(() => fillTemplate(tpl.body, values), [tpl.body, values]);
  const needsPick = forCreator ? !creator : !row;

  return (
    <div className="pc-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc-modal pc-modal-scroll pc-tpl-usemodal" onMouseDown={e => e.stopPropagation()}>
        <h3>{tpl.name}</h3>
        <div className="pc-modal-sub">
          {audienceMeta(tpl.audience).label}
          {tpl.category ? ` · ${tpl.category}` : ''}
        </div>

        <div className="pc-modal-body">
          <div className="pc-field2">
            {forCreator ? (
              <div className="pc-field pc-tpl-creatorfield">
                <label>Creator</label>
                <div className="pc-tpl-cfilters">
                  <select className="pc-input pc-select" value={fBrand} onChange={e => setFBrand(e.target.value)}
                    aria-label="Filter creators by brand">
                    <option value="">All brands</option>
                    {filterBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                  <select className="pc-input pc-select" value={fMonth} onChange={e => setFMonth(e.target.value)}
                    aria-label="Filter creators by program month">
                    <option value="">All months</option>
                    {filterMonths.map(m => <option key={m} value={m}>{fullMonthLabel(m)}</option>)}
                  </select>
                </div>
                <SearchSelect
                  value={pickedHidden ? '' : creatorId}
                  onChange={setCreatorId}
                  options={creatorOptions}
                  noneLabel={pickedHidden && creator ? `${creator.name} (hidden by the filters)` : '— Pick a creator —'}
                  placeholder="Search name, handle, brand, month…"
                />
                <div className="pc-field-hint">
                  {creator
                    ? `${[brandName(creator.brand_id), fullMonthLabel(dealMonth(creator))].filter(Boolean).join(' · ')} — the message uses this deal.`
                    : `${creatorOptions.length} deal${creatorOptions.length === 1 ? '' : 's'} · the same person appears once per brand and month.`}
                </div>
              </div>
            ) : (
              <div className="pc-field">
                <label>Brand</label>
                <SearchSelect
                  value={brandId}
                  onChange={setBrandId}
                  options={brandOptions}
                  noneLabel="— Pick a brand —"
                  placeholder="Search brands…"
                />
                <div className="pc-field-hint">Figures come from {fullMonthLabel(month) || 'the selected month'}.</div>
              </div>
            )}
          </div>

          <div className="pc-field">
            <label>Message</label>
            <div className={`pc-tpl-preview ${needsPick ? 'is-waiting' : ''}`}>{result.text}</div>
          </div>

          {/* Said BEFORE the copy, not after: an unfilled token is visible in
              the text above precisely so it can be caught here. */}
          {result.missing.length > 0 && (
            <div className="pc-tpl-warn">
              <i className="bi bi-exclamation-triangle" aria-hidden="true" />
              <span>
                {needsPick
                  ? `Pick ${forCreator ? 'a creator' : 'a brand'} to fill this in.`
                  : `We have nothing on record for ${result.missing.map(t => `{${t}}`).join(', ')} — fill ${result.missing.length > 1 ? 'them' : 'it'} in by hand after pasting, or edit the message below.`}
              </span>
            </div>
          )}
          {result.unknown.length > 0 && (
            <div className="pc-tpl-warn">
              <i className="bi bi-question-circle" aria-hidden="true" />
              <span>
                {result.unknown.map(t => `{${t}}`).join(', ')} {result.unknown.length > 1 ? 'are not placeholders' : 'is not a placeholder'} — check the spelling in the template.
              </span>
            </div>
          )}
        </div>

        <div className="pc-modal-actions">
          <button className="pc-btn" onClick={onClose}>Close</button>
          <button
            className="pc-btn pc-btn-primary"
            onClick={() => copyWithToast(result.text, 'Text')}
          >
            <i className="bi bi-clipboard" aria-hidden="true" /> Copy message
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Writing one.
════════════════════════════════════════════════════════════ */
function TemplateEditor({ editor, categories, onClose, onSave }) {
  const [f, setF] = useState(() => ({
    name: editor.tpl?.name || '',
    audience: editor.tpl?.audience || 'creator',
    category: editor.tpl?.category || '',
    body: editor.tpl?.body || '',
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const bodyRef = React.useRef(null);

  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const allowed = placeholdersFor(f.audience);
  const used = placeholdersIn(f.body);
  // Tokens the body uses that this audience may not — the reason a brand-only
  // figure cannot drift into a creator message by editing the audience after
  // the fact.
  const offLimits = used.filter(t => {
    const def = allowed.find(p => p.token === t);
    return !def;
  });

  /* Insert at the caret rather than appending: a placeholder belongs mid
     sentence, and appending it to the end is a step the writer then has to
     undo. (The composer's own rule, MessageComposer.insertAtCaret.) */
  const insert = (token) => {
    const el = bodyRef.current;
    const snippet = `{${token}}`;
    if (!el) { set('body', `${f.body}${snippet}`); return; }
    const start = el.selectionStart ?? f.body.length;
    const end = el.selectionEnd ?? start;
    const next = `${f.body.slice(0, start)}${snippet}${f.body.slice(end)}`;
    set('body', next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
    });
  };

  const submit = async () => {
    setErr('');
    setSaving(true);
    try {
      await onSave(f);
    } catch (e) {
      setErr(e?.message || 'Could not save this template');
      setSaving(false);   // on success the modal unmounts; clearing first flashes the button back
    }
  };

  return (
    <div className="pc-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pc-modal pc-modal-scroll pc-tpl-editmodal" onMouseDown={e => e.stopPropagation()}>
        <h3>{editor.tpl ? 'Edit template' : 'New template'}</h3>
        <div className="pc-modal-sub">
          {editor.tpl
            ? 'The whole team uses this wording, so an edit here changes it for everyone.'
            : 'Saved to the shared library — every handler can use and correct it.'}
        </div>

        <div className="pc-modal-body">
          <div className="pc-field2">
            <div className="pc-field">
              <label>Name</label>
              <input
                className="pc-input" value={f.name} autoFocus
                placeholder="Week-one nudge"
                onChange={e => set('name', e.target.value)}
              />
              <div className="pc-field-hint">What you will look for in the library, not the message's opening line.</div>
            </div>
            <div className="pc-field">
              <label>Category <span className="pc-field-opt">optional</span></label>
              <input
                className="pc-input" value={f.category} list="pc-tpl-cats"
                placeholder="Follow-up"
                onChange={e => set('category', e.target.value)}
              />
              <datalist id="pc-tpl-cats">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
              <div className="pc-field-hint">Type anything — the list grows with what the team uses.</div>
            </div>
          </div>

          <div className="pc-field">
            <label>Who is it addressed to?</label>
            <div className="pc-tpl-audience">
              {TEMPLATE_AUDIENCES.map(a => (
                <button
                  key={a.id} type="button"
                  className={`pc-tpl-audbtn ${f.audience === a.id ? 'on' : ''}`}
                  onClick={() => set('audience', a.id)}
                >
                  <i className={`bi ${a.icon}`} aria-hidden="true" />
                  <span className="pc-tpl-audname">{a.label}</span>
                  <span className="pc-tpl-audhint">{a.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="pc-field">
            <label>Message</label>
            <textarea
              ref={bodyRef}
              className="pc-textarea pc-tpl-body" rows={10}
              value={f.body}
              placeholder={'Hey! Just checking in on the {brand} collab…'}
              onChange={e => set('body', e.target.value)}
            />
          </div>

          <div className="pc-field">
            <label>Fill in with</label>
            <div className="pc-tpl-tokens">
              {allowed.map(p => (
                <button
                  key={p.token} type="button"
                  className={`pc-tpl-token ${used.includes(p.token) ? 'on' : ''}`}
                  title={`${p.label} — e.g. ${p.example}`}
                  onClick={() => insert(p.token)}
                >
                  {`{${p.token}}`}
                </button>
              ))}
            </div>
            <div className="pc-field-hint">
              Click one to drop it in where the cursor is. Anything we have no figure for stays
              on screen as its own <code>{'{token}'}</code> rather than going blank, so it never
              gets sent unnoticed.
            </div>
          </div>

          {offLimits.length > 0 && (
            <div className="pc-tpl-warn">
              <i className="bi bi-exclamation-triangle" aria-hidden="true" />
              <span>
                {offLimits.map(t => `{${t}}`).join(', ')} {offLimits.length > 1 ? 'are' : 'is'} not available
                for a message {f.audience === 'creator' ? 'to a creator' : 'to a brand'} and will be left as written.
              </span>
            </div>
          )}

          {err && <div className="pc-inline-err">{err}</div>}
        </div>

        <div className="pc-modal-actions">
          <button className="pc-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            className="pc-btn pc-btn-primary" onClick={submit}
            disabled={saving || !f.name.trim() || !f.body.trim()}
          >
            {saving ? <><span className="pc-btn-spin" aria-hidden="true" /> Saving…</> : 'Save template'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   The library.
════════════════════════════════════════════════════════════ */
function MessageTemplates({
  brandRows = [], brands = [], creators = [], month, canEdit, myId, myName, isBob,
  // Resolves a deal's e-signing link (HandlerCollabApp's contractLinkFor).
  // Optional: without it {contract} falls back to the legacy contract_url.
  contractLinkFor = null,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [aud, setAud] = useState('all');
  const [cat, setCat] = useState('all');
  const [editor, setEditor] = useState(null);
  const [using, setUsing] = useState(null);
  // Two-tap delete, in place — a confirm dialog for one line of text somebody
  // wrote is heavier than the act.
  const [confirmId, setConfirmId] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await store.loadMessageTemplates());
      setErr('');
    } catch (e) {
      setErr(e?.message || 'Could not load the templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => categoryOptions(rows), [rows]);
  const inUse = useMemo(() => {
    const seen = [];
    rows.forEach(r => {
      const c = (r.category || '').trim();
      if (c && !seen.some(x => x.toLowerCase() === c.toLowerCase())) seen.push(c);
    });
    return seen.sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const shown = useMemo(() => rows.filter(t => (
    (aud === 'all' || t.audience === aud) &&
    (cat === 'all' || (t.category || '').toLowerCase() === cat.toLowerCase()) &&
    templateMatches(t, q)
  )), [rows, aud, cat, q]);

  const save = async (form) => {
    const row = editor?.tpl
      ? await store.updateMessageTemplate(editor.tpl.id, form)
      : await store.addMessageTemplate(form);
    setRows(prev => {
      const next = editor?.tpl ? prev.map(t => (t.id === row.id ? row : t)) : [...prev, row];
      return next.sort((a, b) => a.name.localeCompare(b.name));
    });
    setEditor(null);
    showToast(editor?.tpl ? 'Template updated' : 'Template saved');
  };

  const remove = async (t) => {
    try {
      const n = await store.deleteMessageTemplate(t.id);
      if (!n) {
        // RLS refused it. The rule mirror above said otherwise, so say what
        // actually happened rather than pretending the row is gone.
        setErr('That template was not removed — it belongs to somebody else.');
        setConfirmId('');
        return;
      }
      setRows(prev => prev.filter(x => x.id !== t.id));
      setConfirmId('');
      showToast('Template removed');
    } catch (e) {
      setErr(e?.message || 'Could not remove that template');
      setConfirmId('');
    }
  };

  return (
    <div className="pc-tpl">
      <div className="pc-card pc-tpl-head">
        <div className="pc-tpl-headtext">
          <h3>Message templates</h3>
          <p>
            The wording the team sends over and over — creator nudges, ad-code asks, client
            updates. Shared with every handler: pick one, fill it in with a creator or a brand,
            and copy it into your own thread.
          </p>
        </div>
        {canEdit && (
          <button className="pc-btn pc-btn-primary pc-tpl-new" onClick={() => setEditor({ tpl: null })}>
            <i className="bi bi-plus-lg" aria-hidden="true" /> New template
          </button>
        )}
      </div>

      <div className="pc-tpl-tools">
        <div className="pc-tpl-search">
          <i className="bi bi-search" aria-hidden="true" />
          <input
            className="pc-input" value={q} placeholder="Search names, categories, wording…"
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <div className="pc-tpl-filters">
          <div className="pc-tpl-seg">
            <button className={aud === 'all' ? 'on' : ''} onClick={() => setAud('all')}>All</button>
            {TEMPLATE_AUDIENCES.map(a => (
              <button key={a.id} className={aud === a.id ? 'on' : ''} onClick={() => setAud(a.id)}>
                <i className={`bi ${a.icon}`} aria-hidden="true" /> {a.label.replace('To a ', '')}
              </button>
            ))}
          </div>
          {inUse.length > 0 && (
            <select className="pc-select pc-tpl-catsel" value={cat} onChange={e => setCat(e.target.value)}>
              <option value="all">Every category</option>
              {inUse.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      {err && <div className="pc-inline-err pc-tpl-err">{err}</div>}

      {loading ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">💬</div><p>Loading the library…</p></div></div>
      ) : rows.length === 0 ? (
        <div className="pc-card"><div className="pc-empty pc-empty-lg">
          <div className="pc-empty-icon">💬</div>
          <h3>No templates yet</h3>
          <p>Save the message you find yourself re-typing, and the next handler on this brand gets it too.</p>
          {canEdit && <button className="pc-btn pc-btn-primary" onClick={() => setEditor({ tpl: null })}>Write the first one</button>}
        </div></div>
      ) : shown.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">🔍</div>
          <p>Nothing matches those filters.</p>
          <button className="pc-btn" onClick={() => { setQ(''); setAud('all'); setCat('all'); }}>Clear filters</button>
        </div></div>
      ) : (
        <div className="pc-tpl-grid">
          {shown.map(t => {
            const meta = audienceMeta(t.audience);
            const gate = templateDeleteRule(t, myId, isBob);
            const confirming = confirmId === t.id;
            return (
              <div className={`pc-tpl-card aud-${t.audience}`} key={t.id}>
                <div className="pc-tpl-cardhead">
                  <span className={`pc-tpl-audtag ${t.audience}`} title={meta.hint}>
                    <i className={`bi ${meta.icon}`} aria-hidden="true" />
                    {meta.label.replace('To a ', '')}
                  </span>
                  {t.category && <span className="pc-tpl-cattag">{t.category}</span>}
                </div>

                <h4 className="pc-tpl-name">{t.name}</h4>
                <p className="pc-tpl-snip">{templatePreview(t.body)}</p>

                <div className="pc-tpl-by">
                  {t.created_by_name
                    ? `Written by ${t.created_by_name}`
                    : 'Starter template'}
                  {t.updated_by_name && t.updated_by_name !== t.created_by_name
                    ? ` · last edited by ${t.updated_by_name}`
                    : ''}
                </div>

                <div className="pc-tpl-actions">
                  <button className="pc-btn pc-btn-primary pc-tpl-use" onClick={() => setUsing(t)}>
                    <i className="bi bi-magic" aria-hidden="true" /> Use
                  </button>
                  <button
                    className="pc-btn pc-tpl-copy" title="Copy the wording as written, placeholders and all"
                    onClick={() => copyWithToast(t.body, 'Text')}
                  >
                    <i className="bi bi-clipboard" aria-hidden="true" />
                  </button>
                  {canEdit && (
                    <button className="pc-btn pc-tpl-edit" title="Edit for everyone" onClick={() => setEditor({ tpl: t })}>
                      <i className="bi bi-pencil" aria-hidden="true" />
                    </button>
                  )}
                  {canEdit && (
                    confirming ? (
                      <button className="pc-btn pc-btn-danger-solid pc-tpl-del" onClick={() => remove(t)}>
                        Remove?
                      </button>
                    ) : (
                      <button
                        className="pc-btn pc-btn-danger pc-tpl-del"
                        disabled={!gate.can}
                        title={gate.can ? 'Remove this template' : gate.why}
                        onClick={() => setConfirmId(t.id)}
                      >
                        <i className="bi bi-trash" aria-hidden="true" />
                      </button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {using && (
        <UseTemplateModal
          tpl={using} brandRows={brandRows} brands={brands} creators={creators} month={month}
          myName={myName} contractLinkFor={contractLinkFor}
          onClose={() => setUsing(null)}
        />
      )}
      {editor && (
        <TemplateEditor
          editor={editor} categories={categories}
          onClose={() => setEditor(null)} onSave={save}
        />
      )}
    </div>
  );
}

// Memoised like every other tab body in this workspace — see the MEMOISED TAB
// BODIES note in HandlerCollabApp. Its props are stable arrays from Dashboard.
export default React.memo(MessageTemplates);
