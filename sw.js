/* Cairn service worker — makes the app installable and usable offline.

   Two jobs.

   One: keep the app's own files, so opening Cairn with no signal
   still gets you a working app rather than a dinosaur.

   Two: keep the Supabase client library. It comes from a CDN, and
   without it a signed-in person offline could not even work out
   whose data to show, so the app fell back to an empty wall. Caching
   it means the offline app still knows who you are.

   Nothing you write ever passes through here. Requests to Supabase
   and to the scripture API always go to the network and are never
   stored by this worker. */
const VERSION = 'cairn-v2';

const SHELL = [
  '/', '/index.html', '/styles.css', '/config.js', '/app.webmanifest',
  '/src/main.js', '/src/store.js', '/src/util.js', '/src/ui.js',
  '/src/readings.js', '/src/prompts.js', '/src/circles.js', '/src/emails.js',
  '/src/views/today.js', '/src/views/wall.js', '/src/views/answered.js',
  '/src/views/journal.js', '/src/views/settings.js', '/src/views/circles.js',
  '/src/views/unsubscribe.js',
];

/* The only third-party code worth keeping a copy of. Everything else
   from another origin is passed straight through, untouched. */
const KEEP_FROM = ['https://cdn.jsdelivr.net/', 'https://esm.sh/'];
const worthKeeping = (url) => KEEP_FROM.some((prefix) => url.startsWith(prefix));

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      /* One missing file must not take the whole install down with
         it, so they are added one at a time and failures shrugged off. */
      .then((c) => Promise.all(SHELL.map((path) => c.add(path).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  const sameOrigin = new URL(url).origin === self.location.origin;

  if (!sameOrigin && !worthKeeping(url)) return;   // Supabase, scripture, fonts: hands off

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        /* Only store a real answer. An error page cached in place of
           a module is worse than no cache at all. */
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => {
        if (hit) return hit;
        /* A navigation with nothing cached for that exact path still
           gets the app shell, so /join and /unsubscribe work offline. */
        if (e.request.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      }))
  );
});
