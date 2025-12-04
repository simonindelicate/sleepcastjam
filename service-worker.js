const CACHE_NAME = 'sleepcastjam-v1';
const OFFLINE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/src/app.js',
  '/src/assets/wires.ogg',
  '/src/assets/waves.ogg',
  '/src/assets/pool.ogg',
  '/src/assets/rain.ogg',
  '/src/assets/sepia.ogg',
  '/src/assets/wires.jpg',
  '/src/assets/pool.png',
  '/src/assets/waves.png',
  '/src/assets/rain.png',
  '/src/assets/sepia.png',
  '/src/assets/icons/icon-192.png',
  '/src/assets/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          OFFLINE_ASSETS.map((asset) =>
            cache.add(asset).catch(() => {
              // Icons may be added later; skip any missing assets during install.
              console.warn('Skipping asset during cache add', asset);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  const isDocument = request.mode === 'navigate' || request.destination === 'document';

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone())).catch(() => {});
          }
          return networkResponse.clone();
        })
        .catch(() => (isDocument ? caches.match('/') : cachedResponse));

      return cachedResponse || networkFetch;
    })
  );
});
