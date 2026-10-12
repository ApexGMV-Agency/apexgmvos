// TikTok video posters for the weekly + monthly Top Videos sections.
//
// TikTok's public oEmbed endpoint returns a cover image for a video link, but
// that image URL is signed and expires within days. So the cover is copied into
// our own 'report-images' bucket and the permanent public URL is stored on the
// row (`poster_url`), next to the link it was made for (`poster_for`). A poster
// only counts while `poster_for` still matches the row's current link — edit the
// link and the stale poster stops showing and a fresh one is fetched.
//
// Both oEmbed and the TikTok image CDN send `Access-Control-Allow-Origin: *`,
// so this runs entirely in the browser — no edge function needed.

import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

const BUCKET = 'report-images';

/** Video links oEmbed can try to resolve. Private/deleted videos still fail — that's fine. */
export function isTikTokUrl(url: string): boolean {
  try {
    const host = new URL(url.trim()).hostname.toLowerCase();
    return host === 'tiktok.com' || host.endsWith('.tiktok.com');
  } catch { return false; }
}

/** The stored poster for a row, or '' when there is none / it belongs to an older link. */
export function posterFor(link: unknown, posterUrl: unknown, posterLink: unknown): string {
  const l = String(link ?? '').trim();
  const p = String(posterUrl ?? '').trim();
  return l && p && String(posterLink ?? '').trim() === l ? p : '';
}

// Session caches: link → stored poster URL, and links that already failed (so a
// private/deleted video isn't re-requested on every keystroke; a reload retries).
const done = new Map<string, string>();
const failed = new Set<string>();

async function fetchAndStorePoster(link: string, folder: string): Promise<string> {
  const cached = done.get(link);
  if (cached) return cached;
  const meta = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`);
  if (!meta.ok) throw new Error(`oEmbed ${meta.status}`);
  const json = await meta.json().catch(() => null);
  const thumb = json?.thumbnail_url;
  if (typeof thumb !== 'string' || !thumb) throw new Error('no thumbnail');

  const img = await fetch(thumb);
  if (!img.ok) throw new Error(`thumbnail ${img.status}`);
  const blob = await img.blob();
  const type = blob.type || 'image/jpeg';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const id = link.match(/\/(?:video|photo)\/(\d+)/)?.[1] ?? Math.random().toString(36).slice(2, 10);
  const path = `${folder}/posters/${id}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    cacheControl: '31536000', upsert: false, contentType: type,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('no public URL');
  done.set(link, data.publicUrl);
  return data.publicUrl;
}

/**
 * Fetches + stores posters for `pending` links (rows whose link has no matching
 * poster yet), one at a time, and hands each result to `onPoster` so the editor
 * can patch it into content — autosave then persists it. Debounced so a link
 * being typed isn't fetched until it settles.
 */
export function useVideoPosters(opts: {
  pending: string[];
  enabled: boolean;
  brandId?: string;
  reportType: 'weekly' | 'monthly';
  onPoster: (link: string, posterUrl: string) => void;
}) {
  const onPosterRef = useRef(opts.onPoster);
  onPosterRef.current = opts.onPoster;
  const enabledRef = useRef(opts.enabled);
  enabledRef.current = opts.enabled;
  const busy = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const todo = [...new Set(opts.pending.map(l => l.trim()))]
    .filter(l => isTikTokUrl(l) && !failed.has(l));
  const key = todo.join('\n');
  const folder = `${opts.reportType}/${opts.brandId ?? 'misc'}`;

  useEffect(() => {
    if (!opts.enabled || !key) return;
    let alive = true;
    const t = setTimeout(async () => {
      for (const link of key.split('\n')) {
        if (!alive) return;                      // a newer run took over
        if (busy.current.has(link) || failed.has(link)) continue;
        busy.current.add(link);
        try {
          const url = await fetchAndStorePoster(link, folder);
          // Deliver even if this run was superseded — the newer run skipped
          // this link while it was busy, so nobody else will.
          if (mounted.current && enabledRef.current) onPosterRef.current(link, url);
        } catch {
          failed.add(link);
        } finally {
          busy.current.delete(link);
        }
      }
    }, 1500);
    return () => { alive = false; clearTimeout(t); };
  }, [key, opts.enabled, folder]);
}
