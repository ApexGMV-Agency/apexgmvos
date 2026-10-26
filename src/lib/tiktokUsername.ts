/* ════════════════════════════════════════════════════════════
   TikTok video ID → creator username.

   Pure logic, no React and no DOM, so the parsing and the
   resolution strategy are testable on their own and the page
   stays presentational.

   ‼️ RESOLUTION IS BEST-EFFORT BY NATURE. The only public source
   for "who posted this video" is TikTok's own oEmbed endpoint,
   which answers a browser directly (it sends
   Access-Control-Allow-Origin: *) — but a private, deleted or
   region-locked video returns an error, and a network that
   blocks tiktok.com fails the request outright. The two public
   CORS proxies are FALLBACKS for that second case only; they
   cannot make a restricted video resolve. A row we cannot
   confirm is reported as "Needs review" with a link to check by
   hand, never guessed at.
════════════════════════════════════════════════════════════ */

const TIKTOK_ORIGIN = 'https://www.tiktok.com';

/** Fallbacks for networks that block tiktok.com outright. Tried in order. */
const PROXIES: ((target: string) => string)[] = [
  (target) => `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`,
  (target) => `https://corsproxy.io/?${encodeURIComponent(target)}`,
];

/** How many lookups run at once. */
export const LOOKUP_CONCURRENCY = 5;

/** Per-attempt timeout. Each proxy attempt gets its own budget. */
const ATTEMPT_TIMEOUT_MS = 12_000;

// A share URL carries the id after /video/ or /photo/; anything else that
// looks like a bare id is accepted too. Checking the PATH first matters —
// a URL can carry other long numbers in its query string (…?share_item_id=…),
// and a plain "first long number wins" scan would pick the wrong one.
const PATH_ID_RE = /\/(?:video|photo|v)\/(\d{10,25})/i;
const BARE_ID_RE = /(?<!\d)(\d{10,25})(?!\d)/;

/** The id in one line of input, or '' when the line carries none. */
export function videoIdFromLine(line: string): string {
  const trimmed = (line || '').trim();
  if (!trimmed) return '';
  const path = trimmed.match(PATH_ID_RE);
  if (path) return path[1];
  const bare = trimmed.match(BARE_ID_RE);
  return bare ? bare[1] : '';
}

/**
 * Every id in a block of text, in the order typed, deduplicated.
 * Accepts bare ids, full share URLs, and a mix of the two.
 */
export function parseVideoIds(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of (value || '').split(/\r?\n/)) {
    const id = videoIdFromLine(line);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** How many lines carried something we could not read as an id. */
export function unreadableLineCount(value: string): number {
  return (value || '')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !videoIdFromLine(l))
    .length;
}

/**
 * The URL the oEmbed API is asked about.
 *
 * ‼️ Deliberately the handle-less form, and deliberately NOT what we link a
 * human to. We have no handle until this very call answers, and the API
 * accepts this form and returns the right creator (verified live). The
 * WEBSITE does not — see videoUrl. Don't merge the two.
 */
function lookupUrl(id: string) { return `${TIKTOK_ORIGIN}/video/${id}`; }

/**
 * The page URL for a video, for a person to open.
 *
 * ‼️ THE HANDLE IS NOT DECORATION. `tiktok.com/video/<id>` — the form the
 * original tool linked to — redirects to `tiktok.com/404?fromUrl=…`,
 * verified against the live site, so every "open" link was dead. Only the
 * canonical `/@<handle>/video/<id>` opens the video, and that is exactly the
 * URL TikTok's own oEmbed payload cites for it.
 *
 * A row still resolving has no handle to compose with, so it falls back to
 * TikTok's own shortlink, which redirects to the handle-less canonical form
 * rather than to the 404.
 */
export function videoUrl(id: string, username?: string) {
  const handle = (username || '').trim().replace(/^@+/, '');
  return handle
    ? `${TIKTOK_ORIGIN}/@${handle}/video/${id}`
    : `https://m.tiktok.com/v/${id}.html`;
}

/** Third-party mirror, offered only for rows TikTok would not confirm. */
export function viewerUrl(id: string) { return `https://urlebird.com/video/${id}/`; }

export function profileUrl(username: string) {
  return `${TIKTOK_ORIGIN}/${username.startsWith('@') ? username : `@${username}`}`;
}

function oembedUrl(id: string) {
  return `${TIKTOK_ORIGIN}/oembed?url=${encodeURIComponent(lookupUrl(id))}`;
}

/**
 * One JSON GET with its own timeout, cancellable from outside.
 * The caller's signal aborts the whole batch; the timer aborts only
 * this attempt, so the next proxy still gets a turn.
 */
/** A response we actually got back, with its status — as opposed to never reaching the server. */
class HttpError extends Error {
  constructor(public status: number) { super(`HTTP ${status}`); this.name = 'HttpError'; }
}

/**
 * Statuses that mean TikTok answered and the video has no public data:
 * private, removed, or not embeddable. Asking a proxy re-puts the same
 * question to the same server, so these end the attempt immediately.
 *
 * ‼️ 403 and 429 are deliberately NOT here — those can be about the CALLER
 * (region lock, rate limit), which is exactly what a proxy in another
 * location can get past.
 */
const DEFINITIVE_STATUSES = new Set([400, 404, 410]);

async function fetchJson(url: string, signal?: AbortSignal): Promise<any> {
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', relay, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new HttpError(res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', relay);
  }
}

/** Shown when TikTok answered but has nothing public for the video. */
export const UNAVAILABLE = 'TikTok has no public data for this video — it may be private, removed, or not embeddable.';

export interface Resolved {
  username: string;   // always '@handle'
  authorName: string; // display name, '' when absent
}

/** Read the handle out of an oEmbed payload, '' when it carries none. */
export function usernameFromOembed(data: any): string {
  const authorUrl = typeof data?.author_url === 'string' ? data.author_url : '';
  const uniqueId = typeof data?.author_unique_id === 'string' ? data.author_unique_id : '';
  const fromUrl = authorUrl.match(/@([\w.]+)/);
  const handle = fromUrl ? fromUrl[1] : uniqueId.replace(/^@/, '').trim();
  return handle ? `@${handle}` : '';
}

/**
 * Resolve one id. Tries TikTok directly, then each proxy.
 * Throws with the last failure's message when none of them answer.
 */
export async function resolveUsername(id: string, signal?: AbortSignal): Promise<Resolved> {
  const endpoint = oembedUrl(id);
  const attempts = [endpoint, ...PROXIES.map((p) => p(endpoint))];
  let lastError: unknown;

  for (let i = 0; i < attempts.length; i++) {
    // The user cancelled — stop, don't burn the remaining proxies.
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    try {
      const data = await fetchJson(attempts[i], signal);
      const username = usernameFromOembed(data);
      if (username) return { username, authorName: typeof data?.author_name === 'string' ? data.author_name : '' };
      throw new Error('TikTok returned no creator for this video');
    } catch (error) {
      if (signal?.aborted) throw error;
      // TikTok itself gave a definitive "nothing here" — the proxies would
      // relay the identical answer, so stop rather than spend ~12s per row
      // discovering that. Only trusted from the DIRECT attempt (i === 0):
      // the same status out of a proxy may be the proxy's own failure.
      if (i === 0 && error instanceof HttpError && DEFINITIVE_STATUSES.has(error.status)) {
        throw new Error(UNAVAILABLE);
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Unable to resolve');
}

/**
 * Run `worker` over `items`, at most `limit` at a time.
 *
 * ‼️ Not a nicety: the original tool fired the whole list through
 * Promise.all, so a 200-line paste opened 200 sockets at once and
 * TikTok rate-limited most of them into false "Needs review" rows.
 * `worker` must resolve, never reject — errors belong in its result.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}
