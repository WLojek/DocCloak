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

  // The JavaScript MIME type essences of the HTML standard. A script the browser
  // runs as a module or worker is refused under any other type, so storing one
  // would break the app until the next build (WLojek/DocCloak#2: a server sent
  // ort-wasm-*.mjs as application/octet-stream). Other files are not checked:
  // ONNX Runtime and Tesseract load their .wasm under any type.
  var JS_TYPE = /^(?:(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/;

  function isScriptPath(pathname) {
    return /\.m?js$/.test(pathname);
  }

  /** The Content-Type without parameters, lowercase ('' when absent). */
  function typeOf(response) {
    var value = response && response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-type')
      : null;
    return value ? String(value).split(';')[0].trim().toLowerCase() : '';
  }

  /**
   * False for a script (.js, .mjs) served without a JavaScript MIME type: it is
   * served as it came but never stored, and a stored one is dropped and fetched
   * again. True for every other file.
   */
  function hasUsableType(pathname, response) {
    return !isScriptPath(pathname) || JS_TYPE.test(typeOf(response));
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
  /**
   * Download one shell file for the precache: `makeRequest()` builds a fresh
   * request for every attempt, a network error or any status but 200 counts
   * as a failure, and a failed attempt is tried again after each of `delays`
   * (ms, waited through `wait`). The install is all or nothing, so without
   * this a single dropped request on a first visit left the app without a
   * service worker, and without offline use, until the next online visit.
   * Resolves the 200 response, rejects with the last failure.
   */
  function fetchWithRetry(fetchFn, makeRequest, delays, wait) {
    var attempt = 0;
    function once() {
      return Promise.resolve()
        .then(function () { return fetchFn(makeRequest()); })
        .then(function (response) {
          if (response && response.status === 200) return response;
          throw new Error('status ' + (response && response.status));
        })
        .catch(function (err) {
          if (attempt >= delays.length) throw err;
          var delay = delays[attempt++];
          return wait(delay).then(once);
        });
    }
    return once();
  }

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

    /**
     * The network copy of a request. A script that comes under a wrong type is asked for once
     * more past the browser's HTTP cache: a server that once sent the wrong type answers the
     * revalidation with a 304 that carries no Content-Type, so the browser keeps the old type
     * even after the server was fixed (WLojek/DocCloak#2).
     */
    function fromNetwork(request, pathname) {
      return Promise.resolve()
        .then(function () { return fetchFn(request); })
        .then(function (response) {
          if (!isCacheable(response) || hasUsableType(pathname, response) || typeof Request !== 'function') return response;
          return Promise.resolve()
            .then(function () { return fetchFn(new Request(request.url, { cache: 'reload', credentials: 'same-origin' })); })
            .catch(function () { return response; });
        });
    }

    function cacheFirst(request) {
      var pathname = pathnameOf(request.url, deps.origin);
      // A request that asks for a fresh copy (cache: 'reload') skips the stored ones.
      var fresh = request.cache === 'reload';
      return openCache(shellName)
        .then(function (shell) { return fresh ? undefined : matchIn(shell, request); })
        .then(function (hit) {
          if (hit) return hit;
          return openCache(runtimeName).then(function (runtime) {
            return (fresh ? Promise.resolve(undefined) : matchIn(runtime, request)).then(function (runtimeHit) {
              if (runtimeHit && hasUsableType(pathname, runtimeHit)) return runtimeHit;
              // A script stored without a JavaScript type can never run: drop it and fetch it again.
              var dropped = runtimeHit && runtime
                ? Promise.resolve().then(function () { return runtime.delete(request); }).catch(function () { /* ignore */ })
                : Promise.resolve();
              return dropped
                .then(function () { return fromNetwork(request, pathname); })
                .then(function (response) {
                  if (!runtime || !isCacheable(response) || !hasUsableType(pathname, response)) return response;
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
    hasUsableType: hasUsableType,
    cleanResponse: cleanResponse,
    fetchWithRetry: fetchWithRetry,
    createFetchHandler: createFetchHandler,
  };
})(typeof self !== 'undefined' ? self : globalThis);
