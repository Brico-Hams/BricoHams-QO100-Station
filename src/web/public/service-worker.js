'use strict';

// Only static assets are cached. API, auth and WebSocket traffic always goes to the network,
// so a cached page can never show stale tuning, PTT or log data.
const CACHE = 'bricohams-static-v3';
const STATIC = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/scope-math.js',
  '/shortcuts.js',
  '/features.js',
  '/radio-tools.js',
  '/plugin-loader.js',
  '/notch-dsp.js',
  '/rx-player.js',
  '/mic-capture.js',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-maskable.svg',
  '/help.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !STATIC.includes(url.pathname)) return;
  // Network first so a new release is picked up at once; the cache only covers being offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
