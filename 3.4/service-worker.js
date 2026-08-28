const CACHE_NAME = 'massagens-v3.4.0';

const CORE_ASSETS = [
  './',
  './index.html?v=3.4.0',
  './login.html',
  './style.css?v=3.4.0',
  './app.js?v=3.4.0',
  './manifest.json'
];

const OPTIONAL_ASSETS = [
  './icon.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS);
    await Promise.allSettled(OPTIONAL_ASSETS.map((asset) => cache.add(asset)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const freshRequest = new Request(event.request, { cache: 'no-store' });
      const response = await fetch(freshRequest);

      if (response?.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;

      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('./index.html?v=3.4.0', { ignoreSearch: true });
        if (fallback) return fallback;
      }

      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
