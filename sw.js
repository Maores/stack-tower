/* Stack service worker.

   Policy: network-first for our own GET requests, cache only as a
   fallback. Freshness is therefore identical to a normal page load, which
   is the whole point: a deploy must reach a phone immediately, exactly as
   it did before this file existed.

   Two request classes are never touched, and the handler returns without
   calling respondWith so the browser handles them itself:
     - anything cross-origin, which is the Supabase leaderboard
     - anything that is not a GET, which is the score POST
   That is what keeps the save flow and its tests byte-identical.

   The worker must never be the reason the game fails to load. Every path
   below either serves the game or gets out of the way.

   Recovery, if a bad worker ever ships: undoing it is not as simple as
   deleting the registration block from index.html and pushing -- devices
   that already registered keep running the worker they have, since
   nothing about a normal deploy revisits an existing registration. The
   reliable kill switch is to KEEP this file at its current URL (sw.js) and
   replace its body with an unregister-and-clear stub: call skipWaiting()
   on install; on activate, delete every 'stack-shell-*' cache, call
   registration.unregister(), then clients.claim(). That reaches
   already-installed devices because the browser re-checks sw.js on every
   navigation, and that check of the top-level worker script bypasses the
   HTTP cache -- GitHub Pages' max-age=600 on this file does not delay it.
   skipWaiting plus claim means the replacement takes over on the FIRST
   navigation rather than waiting for every open tab to close first, so the
   fix spreads as fast as the bad worker did. And if none of that is fast
   enough: Stack.html is a single file proven free of PWA markup (see
   pw-pwa.js section G), so a working copy of the game always exists that
   no worker, however broken, can ever reach. */

var CACHE = 'stack-shell-v1';

/* The shell, and only the shell. The maskable and apple-touch icons are
   deliberately absent from this LIST -- not from the cache. On a real
   device the platform fetches exactly those two files itself at install
   time, and the fetch handler below caches every successful same-origin
   GET it sees, listed here or not, so both icons end up cached anyway,
   the same way any other same-origin file the game requests would. */
var PRECACHE = [
  './index.html',
  './hud.css',
  './core.js',
  './visuals.js',
  './hud.js',
  './audio.js',
  './vendor/three.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  /* addAll is atomic on purpose. A half-cached shell is a broken offline
     experience, which is worse than none: a failed install simply leaves
     the previous behaviour in place. */
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        /* caches.keys() is origin-scoped, not app-scoped: maores.github.io
           also hosts a sibling site (SystemResourceMonitor) with its own
           cache. Only ever delete this app's own versioned caches -- a
           "stack-shell-" prefix test still catches superseded versions
           like a future stack-shell-v0, without touching anything a
           sibling site put there. */
        return Promise.all(keys.map(function (k) {
          return (k !== CACHE && k.indexOf('stack-shell-') === 0) ? caches.delete(k) : null;
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') { return; }
  if (new URL(req.url).origin !== self.location.origin) { return; }

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) { return hit; }
        /* A launch from start_url is a navigation to "./", which is not a
           precache key. Serving the cached page for any failed navigation
           is what lets the home-screen app open with no network. */
        if (req.mode === 'navigate') {
          return caches.match('./index.html').then(function (page) {
            return page || Response.error();
          });
        }
        return Response.error();
      });
    })
  );
});
