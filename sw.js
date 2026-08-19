/* Cairn service worker — makes the app installable and usable offline.
   Only the app's own files are cached. Nothing you write ever passes
   through here; Supabase and scripture requests always go to the network. */
const VERSION = 'cairn-v1';
const SHELL = [
  './', './index.html', './styles.css', './config.js', './app.webmanifest',
  './src/main.js', './src/store.js', './src/util.js', './src/ui.js',
  './src/readings.js', './src/prompts.js',
  './src/views/today.js', './src/views/wall.js', './src/views/answered.js',
  './src/views/journal.js', './src/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;   // never touch Supabase / scripture / fonts

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
