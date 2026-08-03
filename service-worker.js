const CACHE_NAME = 'massage-credits-v3.0.0';

const APP_SHELL = [
  './',
  './index.html',
  './login.html',
  './style.css?v=3.0.0',
  './app.js?v=3.0.0',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);

  // O Firebase e restantes recursos externos não devem passar pela cache da PWA.
  if (requestUrl.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      // Força uma consulta efetiva ao servidor quando existe ligação, evitando
      // que o browser devolva silenciosamente uma versão antiga de app.js.
      const freshRequest = new Request(event.request, { cache: 'no-store' });
      const response = await fetch(freshRequest);

      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, response.clone());
      }

      return response;
    } catch (error) {
      const cached = await caches.match(event.request, { ignoreSearch: true });
      if (cached) return cached;

      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('./index.html', { ignoreSearch: true });
        if (fallback) return fallback;
      }

      return new Response('', {
        status: 503,
        statusText: 'Offline'
      });
    }
  })());
});
