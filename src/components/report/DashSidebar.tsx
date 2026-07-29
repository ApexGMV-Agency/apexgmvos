import { useEffect, useState } from 'react';

export interface DashNavItem { id: string; label: string; icon: string; }

/**
 * Collapsible left rail for the client dashboard. Each item scroll-jumps to a
 * section (matched by its data-section attribute) and a scroll-spy highlights
 * whichever section is currently in view.
 */
export default function DashSidebar({ items, collapsed, onToggle }: {
  items: DashNavItem[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [active, setActive] = useState<string>(items[0]?.id ?? '');

  // Scroll-spy — highlight the section nearest the top of the viewport.
  useEffect(() => {
    const els = items
      .map(it => document.querySelector(`[data-section="${CSS.escape(it.id)}"]`))
      .filter(Boolean) as HTMLElement[];
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      entries => {
        const vis = entries.filter(e => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const sec = vis[0]?.target?.getAttribute('data-section');
        if (sec) setActive(sec);
      },
      { rootMargin: '-15% 0px -75% 0px', threshold: [0, 0.25, 0.6] }
    );
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [items]);

  const jump = (id: string) => {
    const el = document.querySelector(`[data-section="${CSS.escape(id)}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActive(id);
    }
  };

  return (
    <aside className={`dash-sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="dash-sidebar-head">
        {!collapsed && <span className="dash-sidebar-title">Jump to</span>}
        <button type="button" className="dash-sidebar-toggle" onClick={onToggle}
          title={collapsed ? 'Expand menu' : 'Collapse menu'} aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}>
          <i className={`bi ${collapsed ? 'bi-chevron-double-right' : 'bi-chevron-double-left'}`} />
        </button>
      </div>
      <nav className="dash-sidebar-nav">
        {items.map(it => (
          <button key={it.id} type="button" title={it.label}
            className={`dash-sidebar-item ${active === it.id ? 'active' : ''}`}
            onClick={() => jump(it.id)}>
            <i className={`bi ${it.icon}`} />
            {!collapsed && <span className="dash-sidebar-label">{it.label}</span>}
          </button>
        ))}
      </nav>
      <div className="dash-sidebar-foot">
        <span className="dash-live-dot" />
        {!collapsed && <span className="dash-live-label">Live report</span>}
      </div>
    </aside>
  );
}
