// Cullit Service Worker
// - Network-first for HTML navigations (always fresh content)
// - Cache-first for static assets (images, icons)
const CACHE_NAME = 'cullit-v5';
const STATIC_ASSETS = [
  '/favicon.svg',
  '/og-image.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
    request.destination === 'document' ||
    request.headers.get('accept')?.includes('text/html');
}

// Network-first: try network, fall back to cache
function networkFirst(event) {
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
}

// Cache-first: serve from cache, update in background
function cacheFirst(event) {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Update cache in background
        fetch(event.request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
}

function isStaticAsset(request) {
  const url = new URL(request.url);
  return /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Only handle same-origin requests — skip cross-origin, extensions, etc.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (isNavigationRequest(event.request) || !isStaticAsset(event.request)) {
    networkFirst(event);
  } else {
    cacheFirst(event);
  }
});
