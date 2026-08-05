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
   below either serves the game or gets out of the way. */

var CACHE = 'stack-shell-v1';

/* The shell, and only the shell. The maskable and apple-touch icons are
   deliberately absent: the platform reads those at install time, when
   there is by definition a network, and they would be dead weight in a
   cache whose only job is to boot the game. */
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
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
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
