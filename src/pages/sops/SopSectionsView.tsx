import { useEffect, useRef, useState } from 'react';
import { copyWithToast } from '../../lib/copyToast';
import { resourceIcon } from '../../lib/resourceIcon';
import { SCOPE_ICON } from '../../lib/brandScope';
import { sopHtml } from './sopHtml';
import {
  currentMonthKey, isBlankHtml, sampleGoalFor, scopeLines, sectionIcon,
  type SopLive, type SopSection,
} from './sopSections';
import './sops.css';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap';
if (typeof document !== 'undefined' && !document.querySelector(`link[href="${FONT_HREF}"]`)) {
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = FONT_HREF;
  document.head.appendChild(l);
}

/* ════════════════════════════════════════════════════════════
   The SOP read view — ONE component for the app (View mode), the PDF
   capture and the public /sop/<token> page. The derived-section blocks are
   exported so the editor can show the same live preview.
════════════════════════════════════════════════════════════ */

const pct = (n: number | null) => (n == null ? null : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);

/** One-line explainer under each spine heading. */
const SUBTITLE: Record<string, string> = {
  focus_products: 'The brand\'s products with their IDs, links, sample goals and commission rates.',
  tasks: 'What we run for this brand, one line per scope.',
  gmv_max: 'How GMV Max is run for this brand.',
  discounts: 'The promotions running on the shop right now.',
  resources: 'Every link on the brand\'s Resources tab, with its description.',
};

function CopyChip({ text, label }: { text: string; label: string }) {
  return (
    <button type="button" className="ac-sop-copy" title={`Copy ${label}`} aria-label={`Copy ${label}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyWithToast(text); }}>
      <i className="bi bi-clipboard" />
    </button>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="ac-sop-empty">{children}</p>;

export function FocusProductsBlock({ live }: { live: SopLive }) {
  const month = currentMonthKey();
  if (live.products.length === 0) return <Empty>No products yet — add them on the Products tab.</Empty>;
  const monthLabel = new Date(`${month}-01T00:00:00`)
    .toLocaleString(undefined, { month: 'short', year: 'numeric' }).toUpperCase();
  return (
    <div className="ac-sop-table-wrap">
      <table className="ac-sop-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>TikTok link</th>
            <th>Commission</th>
            <th>Sample goal ({monthLabel})</th>
          </tr>
        </thead>
        <tbody>
          {live.products.map((p, i) => {
            const goal = sampleGoalFor(p, live.samples, month);
            return (
              <tr key={p.id}>
                <td>
                  <div className="ac-sop-prod-cell">
                  <span className="ac-sop-row-num">{i + 1}</span>
                  <div className="ac-sop-prod-main">
                    <div className="ac-sop-clamp-2 ac-sop-prod-name" title={p.name}>{p.name}</div>
                    {p.external_product_id && (
                      <div className="ac-sop-prod-id">
                        <code>{p.external_product_id}</code>
                        <CopyChip text={p.external_product_id} label="product ID" />
                      </div>
                    )}
                  </div>
                  </div>
                </td>
                <td className="ac-sop-center">
                  {p.tiktok_link ? (
                    <span className="ac-sop-open">
                      <a href={p.tiktok_link} target="_blank" rel="noopener noreferrer" title={p.tiktok_link}>
                        Open <i className="bi bi-box-arrow-up-right" />
                      </a>
                      <CopyChip text={p.tiktok_link} label="TikTok link" />
                      <span className="ac-sop-url">{p.tiktok_link}</span>
                    </span>
                  ) : <span className="ac-sop-muted">—</span>}
                </td>
                <td className="ac-sop-center">
                  <div className="ac-sop-chips-stack">
                    {pct(p.standard_commission) != null && (
                      <span className="ac-sop-chip">Std {pct(p.standard_commission)}</span>
                    )}
                    {p.shop_ads_commission == null
                      ? <span className="ac-sop-chip ac-sop-chip-muted">Ads not set</span>
                      : <span className="ac-sop-chip">Ads {pct(p.shop_ads_commission)}</span>}
                  </div>
                </td>
                <td className="ac-sop-center">
                  {goal != null
                    ? <span className="ac-sop-goal">{goal.toLocaleString()}</span>
                    : <span className="ac-sop-muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TasksBlock({ live }: { live: SopLive }) {
  const lines = scopeLines(live.scope);
  if (lines.length === 0) return <Empty>No scope set for this brand — set it from the Brands list.</Empty>;
  return (
    <div className="ac-sop-panel">
      <ul className="ac-sop-tasks">
        {lines.map((t, i) => (
          <li key={t.key} title={t.line}>
            <span className="ac-sop-check"><i className="bi bi-check-lg" /></span>
            <i className={`bi ${SCOPE_ICON[t.key] ?? 'bi-tag'} ac-sop-task-icon`} />
            <span className="ac-sop-task-label">{t.label}</span>
            <span className="ac-sop-task-num">{String(i + 1).padStart(2, '0')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const hostOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

export function ResourcesBlock({ live }: { live: SopLive }) {
  if (live.resources.length === 0) return <Empty>No brand resources yet — add them on the Resources tab.</Empty>;
  return (
    <div className="ac-sop-res-grid">
      {live.resources.map(r => {
        const ic = resourceIcon(r.url);
        const kind = ic.label.includes('.') ? hostOf(r.url) : ic.label;
        return (
          <div key={r.id} className="ac-sop-res-card" style={{ '--rc-rail': ic.color } as React.CSSProperties}>
            <div className="ac-sop-res-top">
              <span className="ac-sop-res-icon"><i className={`bi ${ic.icon}`} /></span>
              <CopyChip text={r.url} label="link" />
            </div>
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="ac-sop-res-name" title={r.name}>
              <span className="ac-sop-clamp-2">{r.name} <i className="bi bi-box-arrow-up-right" /></span>
            </a>
            <div className="ac-sop-res-kind">{kind}</div>
            {r.description && <p className="ac-sop-clamp-3" title={r.description}>{r.description}</p>}
            <div className="ac-sop-url">{r.url}</div>
            <span className="ac-sop-res-open" aria-hidden="true">Open link <i className="bi bi-arrow-right" /></span>
          </div>
        );
      })}
    </div>
  );
}

export function RichBlock({ html, emptyText = 'Nothing written yet.' }: { html?: string; emptyText?: string }) {
  if (isBlankHtml(html)) return <Empty>{emptyText}</Empty>;
  return (
    <div className="ac-sop-panel">
      <div className="ac-sop-rich" dangerouslySetInnerHTML={{ __html: sopHtml(html) }} />
    </div>
  );
}

export function DiscountsBlock({ html }: { html?: string }) {
  if (isBlankHtml(html)) return <Empty>No discounts running right now.</Empty>;
  return (
    <div className="ac-sop-callout">
      <span className="ac-sop-callout-icon"><i className="bi bi-megaphone-fill" /></span>
      <div className="ac-sop-callout-body">
        <div className="ac-sop-callout-title">Running right now</div>
        <div className="ac-sop-rich" dangerouslySetInnerHTML={{ __html: sopHtml(html) }} />
      </div>
    </div>
  );
}

export function SectionBody({ section, live }: { section: SopSection; live: SopLive }) {
  switch (section.kind) {
    case 'focus_products': return <FocusProductsBlock live={live} />;
    case 'tasks':          return <TasksBlock live={live} />;
    case 'resources':      return <ResourcesBlock live={live} />;
    case 'discounts':      return <DiscountsBlock html={section.body} />;
    default:               return <RichBlock html={section.body} />;
  }
}

/** Count shown beside a section in the index; null = no badge. */
function sectionCount(s: SopSection, live: SopLive): number | null {
  switch (s.kind) {
    case 'focus_products': return live.products.length;
    case 'tasks':          return live.scope.length;
    case 'resources':      return live.resources.length;
    case 'discounts': {
      if (isBlankHtml(s.body)) return 0;
      const items = (s.body!.match(/<li\b/gi) ?? []).length;
      return items || 1;
    }
    default: return null;
  }
}

export const sopWordCount = (sections: SopSection[]) =>
  sections.reduce((n, s) => {
    const text = (s.body ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
    return n + (text ? text.split(/\s+/).length : 0);
  }, 0);

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';

export default function SopSectionsView({ brandName, sections, live, updatedAt, printing = false }: {
  brandName: string;
  sections: SopSection[];
  live: SopLive;
  updatedAt?: string | null;
  printing?: boolean;
}) {
  const refs = useRef(new Map<string, HTMLElement>());
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  // Set by an index click; released only when the reader scrolls themselves,
  // so the observer doesn't snap the mark back during the smooth scroll.
  const holdRef = useRef(false);

  useEffect(() => {
    const release = () => { holdRef.current = false; };
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchmove', release, { passive: true });
    window.addEventListener('keydown', release);
    return () => {
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchmove', release);
      window.removeEventListener('keydown', release);
    };
  }, []);

  const sectionKey = sections.map(s => s.id).join('|');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        const id = (e.target as HTMLElement).dataset.sopId!;
        if (e.isIntersecting) visible.set(id, e.boundingClientRect.top); else visible.delete(id);
      });
      if (holdRef.current || visible.size === 0) return;
      const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0][0];
      setActive(top);
    }, { rootMargin: '-90px 0px -55% 0px' });
    refs.current.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [sectionKey]);

  const jump = (id: string) => {
    holdRef.current = true;
    setActive(id);
    refs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const updated = updatedAt
    ? new Date(updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  return (
    <div className={`ac-sop-sheet${printing ? ' ac-sop-printing' : ''}`}>
      <div className="ac-sop-layout">
        <nav className="ac-sop-index" aria-label="Sections">
          <div className="ac-sop-index-brand">
            <span className="ac-sop-index-mark">{initials(brandName)}</span>
            <div>
              <div className="ac-sop-index-name" title={brandName}>{brandName}</div>
              <div className="ac-sop-index-sub">SOP</div>
            </div>
          </div>
          <div className="ac-sop-index-title">Sections</div>
          <ol>
            {sections.map(s => {
              const count = sectionCount(s, live);
              return (
                <li key={s.id}>
                  <button type="button" className={active === s.id ? 'active' : ''} onClick={() => jump(s.id)} title={s.title}>
                    <i className={`bi ${sectionIcon(s)}`} />
                    <span className="ac-sop-index-label">{s.title}</span>
                    {count != null && <span className="ac-sop-index-count">{count}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="ac-sop-doc">
          <header className="ac-sop-hero">
            <div className="ac-sop-hero-eyebrow"><span className="ac-sop-hero-dot" />Standard operating procedure</div>
            <h1>{brandName}</h1>
            <p className="ac-sop-hero-lede">
              Everything the team follows for this brand — the products to push, what we run,
              the promotions on now and the links to work from.
            </p>
            <div className="ac-sop-stats">
              <div><strong>{live.products.length}</strong><span>Focus products</span></div>
              <div><strong>{live.scope.length}</strong><span>Things we run</span></div>
              <div><strong>{live.resources.length}</strong><span>Resource links</span></div>
              <div><strong>{updated}</strong><span>Last updated</span></div>
            </div>
          </header>

          {sections.map(s => (
            <section
              key={s.id}
              data-sop-id={s.id}
              ref={el => { if (el) refs.current.set(s.id, el); else refs.current.delete(s.id); }}
              className="ac-sop-section"
            >
              <h2 className="ac-sop-section-title">{s.title}</h2>
              {SUBTITLE[s.id] && <p className="ac-sop-section-sub">{SUBTITLE[s.id]}</p>}
              <SectionBody section={s} live={live} />
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
