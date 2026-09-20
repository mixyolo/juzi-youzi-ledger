const CACHE_NAME = 'juzi-youzi-v8';
const APP_SHELL = ['./', './index.html?v=8', './styles.css?v=8', './app.js?v=8', './supabase-config.js?v=8', './vendor/lucide.min.js?v=1', './vendor/supabase.min.js?v=1', './manifest.webmanifest?v=8', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })
        .then(response => response || (event.request.mode === 'navigate' ? caches.match('./index.html?v=8') : null)))
  );
});
