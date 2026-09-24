/*
 * DocCloak Service Worker (T195). Hand-written, no dependencies.
 *
 * What it does:
 *   - precaches ONLY the app shell (index.html, hashed /assets/*, the fonts
 *     and icons index.html references), a few MB in total;
 *   - ORT WASM (/ort-wasm-*) and Tesseract (/tesseract/*) are runtime
 *     cache-first: stored on first successful GET, served from cache after;
 *   - navigations are network-first with the cached /index.html as fallback;
 *   - everything cross-origin, every Range request and every non-GET is
 *     passed through untouched (model downloads from huggingface.co and the
 *     app's own 'doccloak-models' cache are never involved).
 *
 * Cache names are versioned by a build id computed from the shell manifest.
 * scripts/sw-manifest.mjs (run by `npm run build` after `vite build`)
 * replaces the two markers below in dist/sw.js: the manifest literal and the
 * inlined copy of sw-logic.js, so the deployed worker is a single file.
 *
 * Kill switch: deploy a sw.js that only calls
 *   self.registration.unregister() and deletes the doccloak-shell-* and
 *   doccloak-runtime-* caches (see src/sw-register.ts unregisterServiceWorker
 *   for the same steps from the page). /sw.js is served with
 *   Cache-Control: no-cache, so every client picks it up on its next visit.
 */

/* @@SW_MANIFEST@@ */
self.__DOCCLOAK_SW_MANIFEST__ = self.__DOCCLOAK_SW_MANIFEST__ || null;

/* @@SW_LOGIC@@ */
importScripts('/sw-logic.js');

(function () {
  'use strict';

  var Logic = self.DocCloakSwLogic;
  var MANIFEST = self.__DOCCLOAK_SW_MANIFEST__ || { buildId: 'dev', precache: [] };
  var BUILD_ID = String(MANIFEST.buildId || 'dev');
  var PRECACHE = Array.isArray(MANIFEST.precache) ? MANIFEST.precache.slice() : [];
  var PRECACHED = new Set(PRECACHE);
  var SHELL_CACHE = Logic.shellCacheName(BUILD_ID);
  var ORIGIN = self.location.origin;

  var handle = Logic.createFetchHandler({
    buildId: BUILD_ID,
    caches: self.caches,
    fetch: self.fetch.bind(self),
    origin: ORIGIN,
    precached: PRECACHED,
  });

  function precacheShell() {
    return self.caches.open(SHELL_CACHE).then(function (cache) {
      return Promise.all(PRECACHE.map(function (path) {
        // Hashed /assets/* are immutable, the HTTP cache may serve them.
        // Everything else (index.html, fonts, icons) is fetched fresh so the
        // shell cache matches the build that shipped this worker.
        var mode = path.indexOf('/assets/') === 0 ? 'default' : 'reload';
        var request = new Request(path, { cache: mode, credentials: 'same-origin' });
        return fetch(request).then(function (response) {
          if (!response || response.status !== 200) {
            throw new Error('[sw] precache failed for ' + path + ': ' + (response && response.status));
          }
          return cache.put(path, Logic.cleanResponse(response));
        });
      }));
    });
  }

  self.addEventListener('install', function (event) {
    event.waitUntil(precacheShell().then(function () { return self.skipWaiting(); }));
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(
      self.caches.keys()
        .then(function (names) {
          return Promise.all(names
            .filter(function (name) { return Logic.isStaleCache(name, BUILD_ID); })
            .map(function (name) { return self.caches.delete(name); }));
        })
        .then(function () { return self.clients.claim(); }),
    );
  });

  self.addEventListener('fetch', function (event) {
    var response = handle(event.request);
    if (response) event.respondWith(response);
  });
})();
