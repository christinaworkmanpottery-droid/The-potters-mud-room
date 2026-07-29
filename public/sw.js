const CACHE = 'mudroom-v2';
const STATIC = ['/','style.css','app.js','/manifest.json','/assets/icon-192.png','/assets/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Never intercept API calls or auth — always go to network
  if (e.request.url.includes('/api/') || e.request.method !== 'GET') return;
  // Cache first for static assets, network first for HTML
  if (e.request.destination === 'document') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
    if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
    return res;
  })));
});
