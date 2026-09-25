import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

/**
 * Unit tests for the Service Worker routing logic (T195).
 *
 * public/sw-logic.js is a plain script (importScripts in the worker, inlined
 * into dist/sw.js at build time). Importing it here registers
 * globalThis.DocCloakSwLogic; the fetch handler takes its I/O (caches, fetch)
 * as arguments, so the strategies run against small in-memory doubles.
 */

interface RequestLike {
  url: string;
  method?: string;
  headers?: Headers;
  mode?: string;
}

interface FakeCache {
  match(key: RequestLike | string): Promise<Response | undefined>;
  put(key: RequestLike | string, response: Response): Promise<void>;
  store: Map<string, Response>;
}

interface FakeCacheStorage {
  open(name: string): Promise<FakeCache>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
  caches: Map<string, FakeCache>;
}

interface SwLogic {
  SHELL_PREFIX: string;
  RUNTIME_PREFIX: string;
  shellCacheName(buildId: string): string;
  runtimeCacheName(buildId: string): string;
  shouldBypass(request: RequestLike, origin: string): boolean;
  classify(url: string, precached?: Set<string>, origin?: string): string;
  isRuntimeAsset(pathname: string): boolean;
  isStaleCache(name: string, buildId: string): boolean;
  cleanResponse(response: Response): Response;
  createFetchHandler(deps: {
    buildId: string;
    caches: FakeCacheStorage;
    fetch: (request: RequestLike) => Promise<Response>;
    origin: string;
    precached: Set<string>;
  }): (request: RequestLike) => Promise<Response> | null;
}

const ORIGIN = 'https://doccloak.com';
const BUILD = 'abc123';

let logic: SwLogic;

beforeAll(async () => {
  await import('../public/sw-logic.js');
  logic = (globalThis as unknown as { DocCloakSwLogic: SwLogic }).DocCloakSwLogic;
});

function keyOf(key: RequestLike | string): string {
  return new URL(typeof key === 'string' ? key : key.url, ORIGIN).href;
}

function makeCacheStorage(): FakeCacheStorage {
  const caches = new Map<string, FakeCache>();
  return {
    caches,
    async open(name) {
      let cache = caches.get(name);
      if (!cache) {
        const store = new Map<string, Response>();
        cache = {
          store,
          async match(key) {
            const hit = store.get(keyOf(key));
            return hit ? hit.clone() : undefined;
          },
          async put(key, response) {
            store.set(keyOf(key), response);
          },
        };
        caches.set(name, cache);
      }
      return cache;
    },
    async keys() {
      return [...caches.keys()];
    },
    async delete(name) {
      return caches.delete(name);
    },
  };
}

function get(path: string, init: { mode?: string; headers?: HeadersInit; method?: string } = {}): RequestLike {
  return {
    url: new URL(path, ORIGIN).href,
    method: init.method ?? 'GET',
    headers: new Headers(init.headers),
    mode: init.mode ?? 'cors',
  };
}

const PRECACHED = new Set([
  '/',
  '/index.html',
  '/assets/index-abc.js',
  '/assets/index-abc.css',
  '/fonts/inter-latin.woff2',
  '/favicon-32x32.png',
]);

describe('shouldBypass', () => {
  it('bypasses cross-origin requests (huggingface model downloads)', () => {
    const req = new Request('https://huggingface.co/onnx-community/model/resolve/main/model.onnx');
    expect(logic.shouldBypass(req, ORIGIN)).toBe(true);
  });

  it('bypasses same-origin requests with a Range header', () => {
    const req = new Request(`${ORIGIN}/tesseract/lang/eng.traineddata.gz`, { headers: { Range: 'bytes=100-' } });
    expect(logic.shouldBypass(req, ORIGIN)).toBe(true);
  });

  it('bypasses non-GET requests', () => {
    const req = new Request(`${ORIGIN}/index.html`, { method: 'POST', body: 'x' });
    expect(logic.shouldBypass(req, ORIGIN)).toBe(true);
    expect(logic.shouldBypass(new Request(`${ORIGIN}/index.html`, { method: 'HEAD' }), ORIGIN)).toBe(true);
  });

  it('bypasses non-http schemes', () => {
    expect(logic.shouldBypass({ url: 'blob:https://doccloak.com/1234', method: 'GET' }, ORIGIN)).toBe(true);
  });

  it('lets plain same-origin GETs through', () => {
    expect(logic.shouldBypass(new Request(`${ORIGIN}/assets/index-abc.js`), ORIGIN)).toBe(false);
    expect(logic.shouldBypass(new Request(`${ORIGIN}/`), ORIGIN)).toBe(false);
  });
});

describe('classify', () => {
  it('routes the document to navigation', () => {
    expect(logic.classify(`${ORIGIN}/`, PRECACHED)).toBe('navigation');
    expect(logic.classify(`${ORIGIN}/index.html`, PRECACHED)).toBe('navigation');
    expect(logic.classify(`${ORIGIN}/?utm=x#tool`, PRECACHED)).toBe('navigation');
  });

  it('routes hashed assets to cache-first', () => {
    expect(logic.classify(`${ORIGIN}/assets/index-abc.js`, PRECACHED)).toBe('asset');
    expect(logic.classify(`${ORIGIN}/assets/detection.worker-xyz.js`, PRECACHED)).toBe('asset');
  });

  it('routes ORT and Tesseract files to the runtime cache', () => {
    expect(logic.classify(`${ORIGIN}/ort-wasm-simd-threaded.asyncify.wasm`, PRECACHED)).toBe('runtime');
    expect(logic.classify(`${ORIGIN}/ort-wasm-simd-threaded.asyncify.mjs`, PRECACHED)).toBe('runtime');
    expect(logic.classify(`${ORIGIN}/tesseract/worker.min.js`, PRECACHED)).toBe('runtime');
    expect(logic.classify(`${ORIGIN}/tesseract/core/tesseract-core-simd-lstm.wasm.js`, PRECACHED)).toBe('runtime');
    expect(logic.classify(`${ORIGIN}/tesseract/lang/pol.traineddata.gz`, PRECACHED)).toBe('runtime');
    // Vite's hashed ORT copies under /assets are runtime too, never shell.
    expect(logic.classify(`${ORIGIN}/assets/ort-wasm-simd-threaded.asyncify-CsxMlmQ8.wasm`, PRECACHED)).toBe('runtime');
  });

  it('routes the self-hosted PDF assets (worker, cmaps, fonts) to the runtime cache', () => {
    expect(logic.isRuntimeAsset('/pdf/pdf.worker.mjs')).toBe(true);
    expect(logic.classify(`${ORIGIN}/pdf/pdf.worker.mjs`, PRECACHED)).toBe('runtime');
    expect(logic.classify(`${ORIGIN}/pdf/cmaps/UniJIS-UCS2-H.bcmap`, PRECACHED)).toBe('runtime');
    expect(logic.classify(`${ORIGIN}/pdf/standard_fonts/FoxitSans.pfb`, PRECACHED)).toBe('runtime');
    expect(logic.classify(`${ORIGIN}/pdf/fonts/LiberationSans-Regular.ttf`, PRECACHED)).toBe('runtime');
    expect(logic.classify(`${ORIGIN}/pdf/wasm/openjpeg.wasm`, PRECACHED)).toBe('runtime');
    // The lazily loaded PDF chunk under /assets stays a hashed asset.
    expect(logic.classify(`${ORIGIN}/assets/index-pdf-abc.js`, PRECACHED)).toBe('asset');
    // A page path that merely starts with "pdf" is not a runtime asset.
    expect(logic.classify(`${ORIGIN}/pdf-guide`, PRECACHED)).toBe('other');
  });

  it('routes precached fonts and icons to the shell', () => {
    expect(logic.classify(`${ORIGIN}/fonts/inter-latin.woff2`, PRECACHED)).toBe('shell');
    expect(logic.classify(`${ORIGIN}/favicon-32x32.png`, PRECACHED)).toBe('shell');
  });

  it('passes everything else through', () => {
    expect(logic.classify(`${ORIGIN}/og-image.jpg`, PRECACHED)).toBe('other');
    expect(logic.classify(`${ORIGIN}/robots.txt`, PRECACHED)).toBe('other');
    expect(logic.classify(`${ORIGIN}/fonts/lora-latin.woff2`, PRECACHED)).toBe('other');
    expect(logic.classify(`${ORIGIN}/sw.js`, PRECACHED)).toBe('other');
  });
});

describe('isStaleCache (activate cleanup)', () => {
  it('flags only doccloak-shell-* and doccloak-runtime-* caches of other builds', () => {
    expect(logic.isStaleCache('doccloak-shell-old', BUILD)).toBe(true);
    expect(logic.isStaleCache('doccloak-runtime-old', BUILD)).toBe(true);
    expect(logic.isStaleCache(`doccloak-shell-${BUILD}`, BUILD)).toBe(false);
    expect(logic.isStaleCache(`doccloak-runtime-${BUILD}`, BUILD)).toBe(false);
  });

  it('never touches doccloak-models or foreign caches', () => {
    expect(logic.isStaleCache('doccloak-models', BUILD)).toBe(false);
    expect(logic.isStaleCache('transformers-cache', BUILD)).toBe(false);
    expect(logic.isStaleCache('workbox-precache-v2', BUILD)).toBe(false);
    expect(logic.isStaleCache('', BUILD)).toBe(false);
  });

  it('cleanup over a realistic key list keeps the model cache', async () => {
    const storage = makeCacheStorage();
    for (const name of ['doccloak-models', 'doccloak-shell-old', 'doccloak-runtime-old', `doccloak-shell-${BUILD}`]) {
      await storage.open(name);
    }
    const names = await storage.keys();
    await Promise.all(names.filter((n) => logic.isStaleCache(n, BUILD)).map((n) => storage.delete(n)));
    expect((await storage.keys()).sort()).toEqual(['doccloak-models', `doccloak-shell-${BUILD}`]);
  });
});

describe('fetch handler', () => {
  let storage: FakeCacheStorage;
  let fetchMock: ReturnType<typeof vi.fn<(request: RequestLike) => Promise<Response>>>;
  let handle: (request: RequestLike) => Promise<Response> | null;

  beforeEach(async () => {
    storage = makeCacheStorage();
    fetchMock = vi.fn<(request: RequestLike) => Promise<Response>>();
    handle = logic.createFetchHandler({
      buildId: BUILD,
      caches: storage,
      fetch: fetchMock,
      origin: ORIGIN,
      precached: PRECACHED,
    });
    const shell = await storage.open(logic.shellCacheName(BUILD));
    await shell.put('/index.html', new Response('<html>cached shell</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
    await shell.put('/assets/index-abc.js', new Response('cached js', { status: 200 }));
  });

  it('returns null (no respondWith) for bypassed requests', () => {
    expect(handle(new Request('https://huggingface.co/x/model.onnx'))).toBeNull();
    expect(handle(get('/ort-wasm-simd-threaded.asyncify.wasm', { headers: { Range: 'bytes=0-' } }))).toBeNull();
    expect(handle(get('/index.html', { method: 'POST' }))).toBeNull();
    expect(handle(get('/og-image.jpg'))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('navigation: network-first, network response wins when available', async () => {
    fetchMock.mockResolvedValue(new Response('<html>fresh</html>', { status: 200 }));
    const res = await handle(get('/', { mode: 'navigate' }))!;
    expect(await res.text()).toBe('<html>fresh</html>');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('navigation: falls back to the cached /index.html when offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await handle(get('/?from=home', { mode: 'navigate' }))!;
    expect(await res.text()).toBe('<html>cached shell</html>');
    expect(res.headers.get('Content-Type')).toBe('text/html');
  });

  it('navigation: rethrows when offline and nothing is cached', async () => {
    const empty = makeCacheStorage();
    const h = logic.createFetchHandler({ buildId: BUILD, caches: empty, fetch: fetchMock, origin: ORIGIN, precached: PRECACHED });
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(h(get('/', { mode: 'navigate' }))!).rejects.toThrow('Failed to fetch');
  });

  it('assets: cache-first, served from the shell cache without hitting the network', async () => {
    const res = await handle(get('/assets/index-abc.js'))!;
    expect(await res.text()).toBe('cached js');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('assets: cache miss goes to the network and is stored in the runtime cache', async () => {
    fetchMock.mockResolvedValue(new Response('new chunk', { status: 200 }));
    const res = await handle(get('/assets/chunk-new.js'))!;
    expect(await res.text()).toBe('new chunk');
    const runtime = await storage.open(logic.runtimeCacheName(BUILD));
    expect(runtime.store.has(`${ORIGIN}/assets/chunk-new.js`)).toBe(true);
    // second request: cache hit, no network
    fetchMock.mockClear();
    const again = await handle(get('/assets/chunk-new.js'))!;
    expect(await again.text()).toBe('new chunk');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ORT, Tesseract and PDF assets: runtime cache-first, stored on first successful GET', async () => {
    fetchMock.mockResolvedValue(new Response('wasm bytes', { status: 200 }));
    await handle(get('/ort-wasm-simd-threaded.asyncify.wasm'))!;
    await handle(get('/tesseract/lang/eng.traineddata.gz'))!;
    await handle(get('/pdf/fonts/LiberationSerif-Bold.ttf'))!;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const runtime = await storage.open(logic.runtimeCacheName(BUILD));
    expect([...runtime.store.keys()].sort()).toEqual([
      `${ORIGIN}/ort-wasm-simd-threaded.asyncify.wasm`,
      `${ORIGIN}/pdf/fonts/LiberationSerif-Bold.ttf`,
      `${ORIGIN}/tesseract/lang/eng.traineddata.gz`,
    ]);
    // Nothing leaked into the shell cache.
    const shell = await storage.open(logic.shellCacheName(BUILD));
    expect(shell.store.has(`${ORIGIN}/ort-wasm-simd-threaded.asyncify.wasm`)).toBe(false);

    fetchMock.mockClear();
    const res = await handle(get('/ort-wasm-simd-threaded.asyncify.wasm'))!;
    expect(await res.text()).toBe('wasm bytes');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('runtime: non-200 responses are returned but not cached', async () => {
    fetchMock.mockResolvedValue(new Response('missing', { status: 404 }));
    const res = await handle(get('/tesseract/lang/xxx.traineddata.gz'))!;
    expect(res.status).toBe(404);
    const runtime = await storage.open(logic.runtimeCacheName(BUILD));
    expect(runtime.store.size).toBe(0);
  });

  it('runtime: never writes to doccloak-models', async () => {
    fetchMock.mockResolvedValue(new Response('wasm bytes', { status: 200 }));
    await handle(get('/tesseract/worker.min.js'))!;
    expect(storage.caches.has('doccloak-models')).toBe(false);
  });

  it('cached responses keep their headers (COOP/COEP survive the Cache API)', async () => {
    fetchMock.mockResolvedValue(new Response('js', {
      status: 200,
      headers: {
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    }));
    await handle(get('/assets/chunk-h.js'))!;
    fetchMock.mockClear();
    const res = await handle(get('/assets/chunk-h.js'))!;
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });
});
