import { ReactNode } from 'react';
import { RowData, formatValue } from '../../lib/reportSchemaV2';

function tiktokLink(handle: string): string {
  const clean = String(handle).trim().replace(/^@+/, '').replace(/\s+/g, '');
  return `https://www.tiktok.com/@${encodeURIComponent(clean)}`;
}
const num = (v: any): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const MEDAL = ['#f59e0b', '#94a3b8', '#cd7f32']; // gold / silver / bronze
const AVATAR_BG = ['#fff1e9', '#eef2ff', '#ecfdf5'];
const AVATAR_FG = ['#c5640f', '#4f46e5', '#0f766e'];
function initials(name: string): string {
  const clean = name.replace(/^@+/, '').trim();
  if (!clean) return '?';
  const parts = clean.split(/[\s_.-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[1][0] : (parts[0]?.[1] ?? ''))).toUpperCase();
}

function Title({ title, sub, color, fb }: { title: string; sub?: string; color: string; fb?: ReactNode }) {
  return (
    <div className="s14-title">
      <span className="s14-title-accent" style={{ background: color }} />
      <div className="flex-grow-1">
        <div className="s14-title-text">{title}</div>
        {sub && <div className="s14-title-sub">{sub}</div>}
      </div>
      {fb}
    </div>
  );
}

/** Client-facing showcase of §13.2 Top Creators + §13.3 Top Videos. */
export default function TopPerformers({ creators, videos, renderFeedback }: {
  creators: RowData[];
  videos: RowData[];
  renderFeedback?: (key: string) => ReactNode;
}) {
  const cs = (creators ?? []).filter(c =>
    String(c.username ?? '').trim() !== '' || num(c.creator_gmv) != null);
  const vs = (videos ?? []).filter(v =>
    String(v.video_url ?? '').trim() !== '' || String(v.product ?? '').trim() !== '' || num(v.video_gmv) != null);
  if (cs.length === 0 && vs.length === 0) return null;

  return (
    <div className="s14-root">
      {cs.length > 0 && (
        <section className="s14-section" data-section="top_creators">
          <Title title="Top Creators" sub="Your highest-performing creators this week" color="#e8862e" fb={renderFeedback?.('top_creators')} />
          <div className="row g-3">
            {cs.map((c, i) => {
              const handle = String(c.username ?? '').trim();
              return (
                <div className="col-sm-6 col-lg-4" key={i}>
                  <div className={`s14-card h-100 tp-card ${i === 0 ? 'tp-gold' : ''}`}>
                    <div className="d-flex align-items-center gap-2 mb-3">
                      <span className="tp-avatar" style={{ background: AVATAR_BG[i % 3], color: AVATAR_FG[i % 3] }}>
                        {handle ? initials(handle) : <i className="bi bi-person" />}
                      </span>
                      <div className="flex-grow-1" style={{ minWidth: 0 }}>
                        {handle ? (
                          <a className="tp-name" href={tiktokLink(handle)} target="_blank" rel="noreferrer">@{handle}</a>
                        ) : <span className="tp-name text-muted">—</span>}
                      </div>
                      <span className="tp-rank" style={{ background: MEDAL[i] ?? '#cbd5e1' }}>{i + 1}</span>
                    </div>
                    <div className="tp-gmv">{formatValue('currency', num(c.creator_gmv))}</div>
                    <div className="tp-sub">creator GMV</div>
                    <div className="d-flex gap-3 mt-2 flex-wrap">
                      <span className="tp-stat"><strong>{formatValue('number', num(c.items_sold))}</strong> items</span>
                      <span className="tp-stat"><strong>{formatValue('number', num(c.videos_posted))}</strong> videos</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {vs.length > 0 && (
        <section className="s14-section" data-section="top_videos">
          <Title title="Top Videos" sub="The videos that drove the most sales" color="#0d6efd" fb={renderFeedback?.('top_videos')} />
          <div className="row g-3">
            {vs.map((v, i) => {
              const url = String(v.video_url ?? '').trim();
              return (
                <div className="col-sm-6 col-lg-4" key={i}>
                  <div className={`s14-card h-100 tp-video ${i === 0 ? 'tp-gold' : ''}`}>
                    <a className="tp-thumb" href={url || undefined} target="_blank" rel="noreferrer"
                       style={{ pointerEvents: url ? 'auto' : 'none' }}>
                      <span className="tp-rank-badge" style={{ background: MEDAL[i] ?? '#cbd5e1' }}>#{i + 1}</span>
                      <i className="bi bi-play-circle-fill tp-play" />
                    </a>
                    <div className="tp-video-body">
                      <div className="tp-product">{String(v.product ?? '').trim() || 'Product'}</div>
                      <div className="tp-gmv">{formatValue('currency', num(v.video_gmv))}</div>
                      <div className="tp-sub">video GMV · {formatValue('number', num(v.items_sold))} items</div>
                      {url && (
                        <a className="tp-watch mt-2 d-inline-flex align-items-center" href={url} target="_blank" rel="noreferrer">
                          <i className="bi bi-tiktok me-1" />Watch on TikTok
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
