// ApexGMVOS service worker — PWA app shell (offline + installable) + web push.

// --- Dev self-destruct -------------------------------------------------------
// On localhost this SW must not run: its cache-first asset handler serves a
// stale @vite/client (with an old HMR token), which breaks Vite's dev
// websocket. If an old build's SW is still registered on a dev machine, this
// branch unregisters it, clears its caches, and reloads open tabs — a one-time
// auto-cleanup (the browser always fetches sw.js fresh, so it picks this up).
if (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach((c) => c.navigate(c.url));
      } catch { /* non-fatal */ }
    })());
  });
  // No fetch handler → nothing is intercepted or cached in dev.
} else {

const CACHE = 'apexgmvos-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/web-app-manifest-192x192.png', '/web-app-manifest-512x512.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// A fetch handler is required for installability, and gives basic offline support.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never intercept cross-origin requests (Supabase API/auth, fonts, etc.).
  if (url.origin !== self.location.origin) return;

  // SPA navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Same-origin static assets (Vite hashes filenames, so cache-first is safe).
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return cached || Response.error();
    }
  })());
});

// ---- Web push (Phase 2) ----
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: event.data ? event.data.text() : 'Notification' }; }
  const title = data.title || 'ApexGMVOS';
  const options = {
    body: data.body || '',
    icon: '/web-app-manifest-192x192.png',
    badge: '/web-app-manifest-192x192.png',
    data: { link: data.link || '/' },
    tag: data.tag || 'apexgmvos',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetLink = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.location.origin)) {
        c.focus();
        c.postMessage({ type: 'navigate', link: targetLink });
        return;
      }
    }
    await self.clients.openWindow(targetLink);
  })());
});

} // end production-only service worker
