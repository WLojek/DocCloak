/*
 * DocCloak Service Worker routing logic (T195).
 *
 * Plain script on purpose: sw.js loads it with importScripts() in dev and
 * preview, scripts/sw-manifest.mjs inlines it into dist/sw.js at build time,
 * and tests/sw.test.ts imports it and reads globalThis.DocCloakSwLogic.
 * No ES module syntax, no dependencies, no DOM access.
 *
 * Every function here is pure or takes its I/O (caches, fetch) as an
 * argument so the routing decisions can be unit-tested without a browser.
 */
(function (global) {
  'use strict';

  var SHELL_PREFIX = 'doccloak-shell-';
  var RUNTIME_PREFIX = 'doccloak-runtime-';

  function shellCacheName(buildId) {
    return SHELL_PREFIX + buildId;
  }

  function runtimeCacheName(buildId) {
    return RUNTIME_PREFIX + buildId;
  }

  function pathnameOf(url, origin) {
    return new URL(String(url), origin).pathname;
  }

  /**
   * True when the service worker must not touch the request at all (no
   * respondWith). Anything cross-origin (huggingface.co model and tokenizer
   * downloads), anything with a Range header (resumable model downloads,
   * media) and anything that is not a plain GET goes straight to the network.
   * This keeps the app's own 'doccloak-models' cache and core's
   * fetchModelBlob() untouched.
   */
  function shouldBypass(request, origin) {
    if (!request) return true;
    if (request.method && request.method !== 'GET') return true;
    var url;
    try {
      url = new URL(request.url);
    } catch (_e) {
      return true;
    }
    if (url.origin !== origin) return true;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
    var headers = request.headers;
    if (headers && typeof headers.has === 'function' && headers.has('range')) return true;
    return false;
  }

  /** Runtime cache-first assets: never precached, stored on first use. */
  function isRuntimeAsset(pathname) {
    if (pathname.indexOf('/tesseract/') === 0) return true;
    if (pathname.indexOf('/ort-wasm-') === 0) return true;
    // pdf.js worker, CMaps, standard fonts, wasm decoders and the Liberation fallback faces.
    if (pathname.indexOf('/pdf/') === 0) return true;
    // Vite also emits hashed copies of the ORT binaries under /assets; keep
    // them out of the shell precache and treat them like the root copies.
    if (pathname.indexOf('/assets/') === 0 && /\.wasm$/.test(pathname)) return true;
    return false;
  }

  /**
   * Classify a same-origin GET URL.
   *   'navigation' -> network-first, fallback to the cached /index.html
   *   'asset'      -> hashed /assets/* file, cache-first
   *   'shell'      -> other precached shell file (fonts, icons), cache-first
   *   'runtime'    -> ORT WASM / Tesseract / PDF assets, runtime cache-first
   *   'other'      -> not handled, pass through untouched
   */
  function classify(url, precached, origin) {
    var pathname = pathnameOf(url, origin || 'http://localhost');
    if (pathname === '/' || pathname === '/index.html') return 'navigation';
    if (isRuntimeAsset(pathname)) return 'runtime';
    if (pathname.indexOf('/assets/') === 0) return 'asset';
    if (precached && typeof precached.has === 'function' && precached.has(pathname)) return 'shell';
    return 'other';
  }

  /**
   * True for a cache this worker owns (doccloak-shell-* or doccloak-runtime-*)
   * that belongs to a different build. Never true for 'doccloak-models' or
   * any cache with another prefix, so activate() cannot delete them.
   */
  function isStaleCache(name, buildId) {
    if (name.indexOf(SHELL_PREFIX) === 0) return name !== shellCacheName(buildId);
    if (name.indexOf(RUNTIME_PREFIX) === 0) return name !== runtimeCacheName(buildId);
    return false;
  }

  /** Redirected responses cannot be served to non-navigation requests; strip the flag. */
  function cleanResponse(response) {
    if (!response.redirected) return response;
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  function isCacheable(response) {
    return !!response && response.status === 200;
  }

  /**
   * Build the fetch handler. `deps`:
   *   buildId    string
   *   caches     CacheStorage (or a test double with open())
   *   fetch      fetch function
   *   origin     self.location.origin
   *   precached  Set of precached pathnames (from the manifest)
   *
   * The returned function decides synchronously: it returns null when the
   * request must pass through untouched (caller must not call respondWith),
   * otherwise a Promise<Response>.
   */
  function createFetchHandler(deps) {
    var shellName = shellCacheName(deps.buildId);
    var runtimeName = runtimeCacheName(deps.buildId);
    var fetchFn = deps.fetch;
    var caches = deps.caches;

    function openCache(name) {
      return Promise.resolve()
        .then(function () { return caches.open(name); })
        .catch(function () { return null; });
    }

    function matchIn(cache, key) {
      if (!cache) return Promise.resolve(undefined);
      return Promise.resolve()
        .then(function () { return cache.match(key); })
        .catch(function () { return undefined; });
    }

    function networkFirstNavigation(request) {
      return Promise.resolve()
        .then(function () { return fetchFn(request); })
        .catch(function (err) {
          return openCache(shellName)
            .then(function (cache) { return matchIn(cache, '/index.html'); })
            .then(function (cached) {
              if (cached) return cached;
              throw err;
            });
        });
    }

    function cacheFirst(request) {
      return openCache(shellName)
        .then(function (shell) { return matchIn(shell, request); })
        .then(function (hit) {
          if (hit) return hit;
          return openCache(runtimeName).then(function (runtime) {
            return matchIn(runtime, request).then(function (runtimeHit) {
              if (runtimeHit) return runtimeHit;
              return Promise.resolve()
                .then(function () { return fetchFn(request); })
                .then(function (response) {
                  if (!runtime || !isCacheable(response)) return response;
                  var toStore = cleanResponse(response.clone());
                  return Promise.resolve()
                    .then(function () { return runtime.put(request, toStore); })
                    .catch(function () { /* quota or storage blocked: serve anyway */ })
                    .then(function () { return response; });
                });
            });
          });
        });
    }

    return function handle(request) {
      if (shouldBypass(request, deps.origin)) return null;
      var route = request.mode === 'navigate'
        ? 'navigation'
        : classify(request.url, deps.precached, deps.origin);
      if (route === 'other') return null;
      if (route === 'navigation') return networkFirstNavigation(request);
      return cacheFirst(request);
    };
  }

  global.DocCloakSwLogic = {
    SHELL_PREFIX: SHELL_PREFIX,
    RUNTIME_PREFIX: RUNTIME_PREFIX,
    shellCacheName: shellCacheName,
    runtimeCacheName: runtimeCacheName,
    shouldBypass: shouldBypass,
    classify: classify,
    isRuntimeAsset: isRuntimeAsset,
    isStaleCache: isStaleCache,
    cleanResponse: cleanResponse,
    createFetchHandler: createFetchHandler,
  };
})(typeof self !== 'undefined' ? self : globalThis);
