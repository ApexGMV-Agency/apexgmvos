import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { resourceIcon } from '../../lib/resourceIcon';
import { folderPathLabel, type Resource, type ResourceFolder } from '../../lib/resourceFolders';
import { copyWithToast } from '../../lib/copyToast';

interface Props {
  brandId: string;
  brandName: string;
}

/**
 * "Resources" dropdown for the paid-collab workspace brand drilldown — the
 * brand's own resource links, one tap from the program the handler is working
 * on, without leaving for the Resources page.
 *
 * Scoped to THIS brand by the query (scope = 'brand' + brand_id) and by RLS on
 * top: a handler only reads the resources of brands assigned to them
 * (migration 20260878090000 — every paid-collab handler, internal or external;
 * 20260848090000 was internal-only), Bob reads everything. General-scope
 * resources are deliberately not listed — same rule as their Resources page.
 *
 * Rendered for Bob and EVERY paid-collab handler. It was internal-only while an
 * external handler had no read grant and the button would have been a
 * permanently empty affordance; 20260878090000 gave them the grant, so the gate
 * moved with it. Keep this predicate in step with the one in Resources.tsx —
 * both are the front end mirroring paid_collab_handler_has_brand().
 */
export default function BrandResourcesMenu({ brandId, brandName }: Props) {
  const { profile } = useAuth();
  const nav = useNavigate();
  const allowed = profile?.role === 'bob' || profile?.role === 'paid_collab_handler';

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Resource[] | null>(null);
  const [folders, setFolders] = useState<ResourceFolder[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Load this brand's links up front so the button can carry a count and open
  // instantly. Re-runs when the drilldown moves to another brand.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setRows(null); setErr(null); setOpen(false); setQ('');
    (async () => {
      const [r, f] = await Promise.all([
        supabase.from('resources').select('*')
          .eq('scope', 'brand').eq('brand_id', brandId)
          .order('pinned', { ascending: false })
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase.from('resource_folders').select('*')
          .eq('scope', 'brand').eq('brand_id', brandId),
      ]);
      if (cancelled) return;
      if (r.error) { setErr(r.error.message); setRows([]); return; }
      setFolders((f.data ?? []) as ResourceFolder[]);
      setRows((r.data ?? []) as Resource[]);
    })();
    return () => { cancelled = true; };
  }, [brandId, allowed]);

  // Close on outside click / Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const list = rows ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(r =>
      (r.name || '').toLowerCase().includes(needle)
      || (r.description || '').toLowerCase().includes(needle)
      || (r.url || '').toLowerCase().includes(needle)
      || folderPathLabel(folders, r.folder_id).toLowerCase().includes(needle));
  }, [list, folders, q]);

  if (!allowed) return null;

  return (
    <div className="pc-resmenu-wrap" ref={wrapRef}>
      <button type="button"
        className={`pc-btn pc-btn-sm ${open ? 'pc-btn-accentlight' : 'pc-btn-ghost'}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open} aria-haspopup="menu"
        title={`${brandName} resources`}>
        <i className="bi bi-folder2-open" style={{ marginRight: 2 }} />
        Resources
        {list.length > 0 && <span className="pc-resmenu-count">{list.length}</span>}
        <i className={`bi bi-chevron-down pc-resmenu-caret ${open ? 'up' : ''}`} />
      </button>

      {open && (
        <div className="pc-resmenu" role="menu">
          <div className="pc-resmenu-head">
            <span className="pc-resmenu-title">{brandName} · resources</span>
            {/* The Resources page is staff-only in ApexGMVOS; handlers use this menu. */}
            {profile?.role === 'bob' && (
              <button type="button" className="pc-resmenu-all"
                onClick={() => { setOpen(false); nav(`/resources?brand=${brandId}`); }}>
                Open page ↗
              </button>
            )}
          </div>

          {list.length > 6 && (
            <input className="pc-input pc-resmenu-search" value={q} autoFocus
              placeholder="Search resources…" onChange={e => setQ(e.target.value)} />
          )}

          <div className="pc-resmenu-list">
            {rows === null ? (
              <div className="pc-resmenu-empty">Loading…</div>
            ) : err ? (
              <div className="pc-resmenu-empty pc-resmenu-err">{err}</div>
            ) : filtered.length === 0 ? (
              <div className="pc-resmenu-empty">
                {list.length === 0
                  ? `No resources saved for ${brandName} yet.`
                  : 'Nothing matches that search.'}
              </div>
            ) : filtered.map(r => {
              const ico = resourceIcon(r.url || '');
              const path = folderPathLabel(folders, r.folder_id);
              return (
                <div key={r.id} className="pc-resmenu-row">
                  <a className="pc-resmenu-link" href={r.url || undefined}
                    target="_blank" rel="noopener noreferrer" title={r.url || ''}>
                    <span className="pc-resmenu-ico" style={{ color: ico.color, background: `${ico.color}14` }}>
                      <i className={`bi ${ico.icon}`} />
                    </span>
                    <span className="pc-resmenu-text">
                      <span className="pc-resmenu-name">
                        {r.pinned && <i className="bi bi-pin-angle-fill pc-resmenu-pin" title="Pinned" />}
                        {r.name || 'Untitled'}
                      </span>
                      <span className="pc-resmenu-sub">{path || ico.label}</span>
                    </span>
                  </a>
                  <button type="button" className="pc-resmenu-copy" title="Copy link"
                    onClick={() => copyWithToast(r.url || '', 'Link')}>
                    <i className="bi bi-copy" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
