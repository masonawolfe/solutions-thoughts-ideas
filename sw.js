const CACHE_NAME = 'sti-v1';
const SHELL_ASSETS = ['/', '/index.html', '/manifest.json'];

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API calls, cache-first for static assets
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls: always network, cache successful responses for offline
  if (url.pathname.startsWith('/.netlify/functions/')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Cache successful search responses for offline viewing
          if (res.ok && url.pathname.includes('/search')) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          // Offline: try cache, otherwise return offline message
          return caches.match(e.request).then(cached => {
            if (cached) return cached;
            return new Response(JSON.stringify({
              error: "You're offline. Previously viewed topics are available, but new searches require an internet connection."
            }), { headers: { 'Content-Type': 'application/json' } });
          });
        })
    );
    return;
  }

  // Static assets: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetched = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
