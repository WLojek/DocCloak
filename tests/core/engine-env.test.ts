// @vitest-environment node
/**
 * Web CoreEnv tests (T186, security report S1/S3/S5/S9).
 *
 * Node environment on purpose: jsdom's Blob has no arrayBuffer(), which
 * core's hashing path needs, while Node 22 ships Blob, Response, fetch and
 * WebCrypto. Cache Storage and the worker globals are stubbed per test.
 *
 * Covered:
 * - buildTokenizer maps tokenizer_class onto the @huggingface/transformers
 *   constructors and fails closed on anything else.
 * - Token identity: for each provider, the constructor path produces the
 *   same ids as AutoTokenizer.from_pretrained on the same pinned files
 *   (needs the real tokenizer files; skipped with a reason when absent).
 * - Egress: a cold preload() fetches exactly the three pinned
 *   resolve/<commit> URLs of the active provider and nothing else; a warm
 *   preload() with a full 'doccloak-models' cache fetches nothing even when
 *   fetch throws; the library never gets a 'transformers-cache' bucket.
 * - The worker bootstrap runs the engine with autoLoad off: detect() before
 *   init/preload is refused without touching the network.
 * - The legacy 'transformers-cache' bucket is dropped once.
 *
 * SHA-256 verification is stubbed for the fake model bytes and the padded
 * fake tokenizer files served in the egress tests (the real verification
 * path, including tampering and eviction, is covered by the core suite).
 * Token identity runs against the real files with real hashing.
 *
 * Fixtures for the token-identity tests: tokenizer.json and
 * tokenizer_config.json per provider under
 *   $DOCCLOAK_TOKENIZER_FIXTURES/<gliner|gliner-base|bardsai>/
 * (default: tests/fixtures/tokenizers). Download them from the pinned URLs
 * in the provider *_TOKENIZER_FILES; the test checks their SHA-256 against
 * the pins before use.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── onnxruntime-web mock ──────────────────────────────────────
// No wasm, no real session: the model bytes served below are fake.

const ortMock = {
  env: { wasm: {} as { wasmPaths?: string; numThreads?: number } },
  InferenceSession: {
    create: vi.fn(async () => ({
      inputNames: ['input_ids'],
      outputNames: ['logits'],
      run: vi.fn(),
      release: vi.fn(),
    })),
  },
  Tensor: class {},
};

/**
 * Dev checkouts link @doccloak/core to a sibling directory
 * ("file:../DocCloak.Core") that carries its own node_modules copy of
 * onnxruntime-web. Core's `import 'onnxruntime-web/webgpu'` resolves to
 * that copy (realpath), which the bare-specifier mock below does not cover,
 * so the same factory is registered for the resolved file as well.
 */
function resolveCoreOrtEntry(): string | null {
  try {
    const coreDir = realpathSync(path.resolve(HERE, '../../node_modules/@doccloak/core'));
    const ortDir = path.join(coreDir, 'node_modules/onnxruntime-web');
    const pkgPath = path.join(ortDir, 'package.json');
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { exports?: Record<string, unknown> };
    let entry: unknown = pkg.exports?.['./webgpu'];
    if (entry && typeof entry === 'object') entry = (entry as Record<string, unknown>).import;
    if (entry && typeof entry === 'object') entry = (entry as Record<string, unknown>).default;
    return typeof entry === 'string' ? path.join(ortDir, entry) : null;
  } catch {
    return null;
  }
}

vi.doMock('onnxruntime-web/webgpu', () => ortMock);
const coreOrtEntry = resolveCoreOrtEntry();
if (coreOrtEntry) vi.doMock(coreOrtEntry, () => ortMock);

// Imported after the mocks are registered (vi.doMock is not hoisted).
const core = await import('@doccloak/core');
const hf = await import('@huggingface/transformers');
const webEnv = await import('../../src/engine-env.web.ts');

type ProviderKey = 'gliner' | 'gliner-base' | 'bardsai';

// ── Fixtures ──────────────────────────────────────────────────

const FIXTURE_ROOT = process.env.DOCCLOAK_TOKENIZER_FIXTURES ?? path.resolve(HERE, '../fixtures/tokenizers');
const SENTENCE = 'Jan Kowalski mieszka w Warszawie.';

interface TokenCase {
  provider: ProviderKey;
  files: typeof core.GLINER_TOKENIZER_FILES;
  tokenizerClass: string;
  ctor: typeof hf.PreTrainedTokenizer;
  /** AutoTokenizer.from_pretrained(<pinned files>).encode(SENTENCE), transformers.js 4.2.0 */
  ids: number[];
}

const TOKEN_CASES: TokenCase[] = [
  {
    provider: 'gliner',
    files: core.GLINER_TOKENIZER_FILES,
    tokenizerClass: 'PreTrainedTokenizerFast',
    ctor: hf.PreTrainedTokenizer,
    ids: [50281, 3344, 611, 319, 932, 5985, 278, 447, 91, 4530, 259, 14848, 91, 1403, 466, 15, 50282],
  },
  {
    provider: 'gliner-base',
    files: core.GLINER_BASE_TOKENIZER_FILES,
    tokenizerClass: 'DebertaV2Tokenizer',
    ctor: hf.DebertaV2Tokenizer,
    ids: [1, 2846, 89886, 88415, 268, 58216, 2976, 6344, 6407, 39512, 260, 2],
  },
  {
    provider: 'bardsai',
    files: core.BARDSAI_TOKENIZER_FILES,
    tokenizerClass: 'XLMRobertaTokenizer',
    ctor: hf.XLMRobertaTokenizer,
    ids: [0, 3342, 1204, 8202, 1336, 39089, 148, 78747, 5, 2],
  },
];

function fixtureDir(provider: ProviderKey): string {
  return path.join(FIXTURE_ROOT, provider);
}

function fixturesPresent(provider: ProviderKey): boolean {
  const dir = fixtureDir(provider);
  return existsSync(path.join(dir, 'tokenizer.json')) && existsSync(path.join(dir, 'tokenizer_config.json'));
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Read a fixture and check it is byte-identical to the pinned file. */
function readPinnedFixture(provider: ProviderKey, spec: typeof core.GLINER_TOKENIZER_FILES[number]): unknown {
  const file = path.join(fixtureDir(provider), path.basename(new URL(spec.url).pathname));
  const bytes = readFileSync(file);
  expect(bytes.byteLength, `${file} size`).toBe(spec.size);
  expect(sha256(bytes), `${file} sha256`).toBe(spec.sha256);
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

// ── Fake Cache Storage ────────────────────────────────────────

interface FakeCacheStorage {
  storage: CacheStorage;
  buckets: Map<string, Map<string, Blob>>;
  deleted: string[];
}

function fakeCacheStorage(): FakeCacheStorage {
  const buckets = new Map<string, Map<string, Blob>>();
  const deleted: string[] = [];
  const storage = {
    async open(name: string) {
      let bucket = buckets.get(name);
      if (!bucket) {
        bucket = new Map();
        buckets.set(name, bucket);
      }
      const entries = bucket;
      return {
        async match(url: string) {
          const blob = entries.get(url);
          return blob ? new Response(blob) : undefined;
        },
        async put(url: string, response: Response) {
          entries.set(url, await response.blob());
        },
        async delete(url: string) {
          return entries.delete(url);
        },
      };
    },
    async delete(name: string) {
      deleted.push(name);
      return buckets.delete(name);
    },
    async has(name: string) {
      return buckets.has(name);
    },
    async keys() {
      return [...buckets.keys()];
    },
  };
  return { storage: storage as unknown as CacheStorage, buckets, deleted };
}

// ── Fake pinned files ─────────────────────────────────────────

/** Small but real tokenizer.json (WordPiece) that PreTrainedTokenizer accepts. */
const FAKE_TOKENIZER_JSON = {
  version: '1.0',
  truncation: null,
  padding: null,
  added_tokens: [],
  normalizer: null,
  pre_tokenizer: { type: 'Whitespace' },
  post_processor: null,
  decoder: null,
  model: {
    type: 'WordPiece',
    unk_token: '[UNK]',
    continuing_subword_prefix: '##',
    max_input_chars_per_word: 100,
    vocab: { '[UNK]': 0, '[CLS]': 1, '[SEP]': 2, '[PAD]': 3, jan: 4, kowalski: 5 },
  },
};

const FAKE_TOKENIZER_CONFIG = {
  tokenizer_class: 'PreTrainedTokenizerFast',
  model_max_length: 512,
  unk_token: '[UNK]',
  cls_token: '[CLS]',
  sep_token: '[SEP]',
  pad_token: '[PAD]',
};

const FAKE_MODEL_BYTES = new Uint8Array(4096).map((_, i) => (i * 31) & 0xff);

/** JSON padded with whitespace to the pinned byte size (core cross-checks size). */
function paddedJson(value: unknown, size: number): string {
  const text = JSON.stringify(value);
  const textBytes = Buffer.byteLength(text);
  if (textBytes > size) throw new Error(`fake JSON (${textBytes} B) larger than the pinned size ${size}`);
  return text + ' '.repeat(size - textBytes);
}

interface PinnedProvider {
  id: ProviderKey;
  revision: string;
  modelUrl: string;
  modelSha256: string;
  files: typeof core.GLINER_TOKENIZER_FILES;
}

const GLINER: PinnedProvider = {
  id: 'gliner',
  revision: core.GLINER_MODEL_REVISION,
  modelUrl: core.GLINER_MODEL_URL,
  modelSha256: core.GLINER_MODEL_SHA256,
  files: core.GLINER_TOKENIZER_FILES,
};

/**
 * fetch stub that records every URL and serves the fake bytes for the
 * provider's three pinned files (404 for anything else).
 */
function servingFetch(p: PinnedProvider): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const [tokenizerJson, tokenizerConfig] = p.files;
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url === p.modelUrl) return new Response(FAKE_MODEL_BYTES);
    if (url === tokenizerJson.url) return new Response(paddedJson(FAKE_TOKENIZER_JSON, tokenizerJson.size));
    if (url === tokenizerConfig.url) return new Response(paddedJson(FAKE_TOKENIZER_CONFIG, tokenizerConfig.size));
    return new Response(null, { status: 404 });
  });
  return { fetch: fetchFn as unknown as typeof fetch, urls };
}

/** fetch stub for the offline case: records and throws like a browser with no network. */
function offlineFetch(): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    throw new TypeError('Failed to fetch');
  });
  return { fetch: fetchFn as unknown as typeof fetch, urls };
}

function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes.buffer;
}

/**
 * Make the fake bytes pass core's pinned SHA-256 check: digest() answers
 * with the pinned hash for inputs of the fake files' sizes and hashes
 * everything else for real.
 */
function stubDigestForFakeFiles(p: PinnedProvider): void {
  const pinnedBySize = new Map<number, string>([
    [FAKE_MODEL_BYTES.byteLength, p.modelSha256],
    [p.files[0].size, p.files[0].sha256],
    [p.files[1].size, p.files[1].sha256],
  ]);
  const realDigest = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
    const pinned = pinnedBySize.get(data.byteLength);
    return pinned ? hexToArrayBuffer(pinned) : realDigest(algorithm, data);
  });
}

const pinnedUrls = (p: PinnedProvider): string[] => [p.modelUrl, p.files[0].url, p.files[1].url];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ── buildTokenizer ────────────────────────────────────────────

describe('createWebCoreEnv buildTokenizer (T186)', () => {
  it('is wired as CoreEnv.buildTokenizer and loadTokenizer is gone', () => {
    const env = webEnv.createWebCoreEnv();
    expect(env.buildTokenizer).toBe(webEnv.buildWebTokenizer);
    expect(env.loadTokenizer).toBeUndefined();
  });

  it('keeps the library away from its own cache and loaders', () => {
    expect(hf.env.useBrowserCache).toBe(false);
    expect(hf.env.allowRemoteModels).toBe(false);
    expect(hf.env.allowLocalModels).toBe(false);
  });

  it('maps PreTrainedTokenizerFast onto PreTrainedTokenizer', () => {
    const tokenizer = webEnv.buildWebTokenizer(FAKE_TOKENIZER_JSON, FAKE_TOKENIZER_CONFIG);
    expect(tokenizer).toBeInstanceOf(hf.PreTrainedTokenizer);
    expect(tokenizer).not.toBeInstanceOf(hf.DebertaV2Tokenizer);
    expect(tokenizer.encode('jan kowalski')).toEqual([4, 5]);
  });

  it('maps DebertaV2Tokenizer and XLMRobertaTokenizer (with or without the Fast suffix)', () => {
    const cases: Array<[string, typeof hf.PreTrainedTokenizer]> = [
      ['DebertaV2Tokenizer', hf.DebertaV2Tokenizer],
      ['DebertaV2TokenizerFast', hf.DebertaV2Tokenizer],
      ['XLMRobertaTokenizer', hf.XLMRobertaTokenizer],
      ['XLMRobertaTokenizerFast', hf.XLMRobertaTokenizer],
      ['PreTrainedTokenizer', hf.PreTrainedTokenizer],
    ];
    for (const [tokenizerClass, ctor] of cases) {
      const tokenizer = webEnv.buildWebTokenizer(FAKE_TOKENIZER_JSON, { ...FAKE_TOKENIZER_CONFIG, tokenizer_class: tokenizerClass });
      expect(tokenizer, tokenizerClass).toBeInstanceOf(ctor);
    }
  });

  it('fails closed on an unknown tokenizer_class', () => {
    expect(() => webEnv.buildWebTokenizer(FAKE_TOKENIZER_JSON, { ...FAKE_TOKENIZER_CONFIG, tokenizer_class: 'BertTokenizer' }))
      .toThrow(/Unsupported tokenizer_class "BertTokenizer"/);
    expect(() => webEnv.buildWebTokenizer(FAKE_TOKENIZER_JSON, { ...FAKE_TOKENIZER_CONFIG, tokenizer_class: 'PreTrainedTokenizerFastFast' }))
      .toThrow(/Unsupported tokenizer_class/);
    expect(() => webEnv.buildWebTokenizer(FAKE_TOKENIZER_JSON, { model_max_length: 512 }))
      .toThrow(/Unsupported tokenizer_class/);
    expect(() => webEnv.buildWebTokenizer(FAKE_TOKENIZER_JSON, { ...FAKE_TOKENIZER_CONFIG, tokenizer_class: 42 }))
      .toThrow(/Unsupported tokenizer_class/);
  });

  it('rejects inputs that are not objects', () => {
    expect(() => webEnv.buildWebTokenizer('{}', FAKE_TOKENIZER_CONFIG)).toThrow(/tokenizer\.json/);
    expect(() => webEnv.buildWebTokenizer(null, FAKE_TOKENIZER_CONFIG)).toThrow(/tokenizer\.json/);
    expect(() => webEnv.buildWebTokenizer(FAKE_TOKENIZER_JSON, [])).toThrow(/tokenizer_config\.json/);
  });
});

// ── Token identity against the real pinned files ──────────────

describe('buildTokenizer is token-identical to AutoTokenizer.from_pretrained (pinned files)', () => {
  for (const c of TOKEN_CASES) {
    const present = fixturesPresent(c.provider);
    const run = present ? it : it.skip;
    const why = present ? '' : ` [skipped: no fixtures in ${fixtureDir(c.provider)}]`;

    run(`${c.provider}: ${c.tokenizerClass}${why}`, async () => {
      const tokenizerJson = readPinnedFixture(c.provider, c.files[0]);
      const tokenizerConfig = readPinnedFixture(c.provider, c.files[1]) as Record<string, unknown>;
      expect(tokenizerConfig.tokenizer_class).toBe(c.tokenizerClass);

      const built = webEnv.buildWebTokenizer(tokenizerJson, tokenizerConfig);
      expect(built).toBeInstanceOf(c.ctor);
      expect(built.constructor).toBe(c.ctor);
      expect(built.encode(SENTENCE)).toEqual(c.ids);

      // Reference: the library's own loader over the same files on disk.
      const flags = { local: hf.env.allowLocalModels, remote: hf.env.allowRemoteModels, fs: hf.env.useFSCache };
      hf.env.allowLocalModels = true;
      hf.env.allowRemoteModels = false;
      hf.env.useFSCache = false;
      try {
        const reference = await hf.AutoTokenizer.from_pretrained(fixtureDir(c.provider) + path.sep, { local_files_only: true });
        expect(reference.constructor).toBe(c.ctor);
        expect(reference.encode(SENTENCE)).toEqual(c.ids);
        expect(built.encode(SENTENCE)).toEqual(reference.encode(SENTENCE));
      } finally {
        hf.env.allowLocalModels = flags.local;
        hf.env.allowRemoteModels = flags.remote;
        hf.env.useFSCache = flags.fs;
      }
    });
  }
});

// ── Egress and offline through the real web env ───────────────

describe('web engine egress (T186)', () => {
  let cacheStorage: FakeCacheStorage;

  beforeEach(() => {
    cacheStorage = fakeCacheStorage();
    vi.stubGlobal('caches', cacheStorage.storage);
  });

  async function coldStart(p: PinnedProvider) {
    const { fetch, urls } = servingFetch(p);
    vi.stubGlobal('fetch', fetch);
    stubDigestForFakeFiles(p);
    const env = webEnv.createWebCoreEnv();
    const buildTokenizer = vi.spyOn(env, 'buildTokenizer');
    const engine = core.createEngine(env, { providerId: p.id }, { autoLoad: false });
    await engine.preload();
    return { engine, urls, buildTokenizer, fetch };
  }

  it('cold start fetches exactly the three pinned resolve/<commit> URLs and nothing else', async () => {
    const { urls, buildTokenizer } = await coldStart(GLINER);

    expect(new Set(urls)).toEqual(new Set(pinnedUrls(GLINER)));
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url.startsWith('https://huggingface.co/')).toBe(true);
      expect(url).toContain(`/resolve/${GLINER.revision}/`);
      expect(url).not.toContain('resolve/main');
    }

    // The tokenizer came out of core's verified files, through the web constructor path.
    expect(buildTokenizer).toHaveBeenCalledTimes(1);
    const [json, config] = buildTokenizer.mock.calls[0];
    expect(json).toEqual(FAKE_TOKENIZER_JSON);
    expect(config).toEqual(FAKE_TOKENIZER_CONFIG);
    expect(buildTokenizer.mock.results[0].value).toBeInstanceOf(hf.PreTrainedTokenizer);
    expect(ortMock.InferenceSession.create).toHaveBeenCalledTimes(1);
  });

  it('cold start fills doccloak-models only; the library never creates transformers-cache', async () => {
    await coldStart(GLINER);

    const models = cacheStorage.buckets.get('doccloak-models');
    expect(models).toBeDefined();
    for (const url of pinnedUrls(GLINER)) expect(models?.has(url), url).toBe(true);
    expect(cacheStorage.buckets.has('transformers-cache')).toBe(false);
    expect([...cacheStorage.buckets.keys()]).toEqual(['doccloak-models']);
  });

  it('warm start with a full cache and no network fetches nothing and loads', async () => {
    const first = await coldStart(GLINER);
    first.engine.release();
    vi.restoreAllMocks();
    ortMock.InferenceSession.create.mockClear();

    // Fresh page load: new env, new engine, same Cache Storage, network gone.
    const { fetch: offline, urls } = offlineFetch();
    vi.stubGlobal('fetch', offline);
    // Warm cache entries carry the size-bound verification marker, so no
    // re-hash happens here: the real digest stays in place.
    const env = webEnv.createWebCoreEnv();
    const buildTokenizer = vi.spyOn(env, 'buildTokenizer');
    const engine = core.createEngine(env, { providerId: GLINER.id }, { autoLoad: false });

    await expect(engine.preload()).resolves.toBeUndefined();

    expect(urls).toEqual([]);
    expect(offline).not.toHaveBeenCalled();
    expect(buildTokenizer).toHaveBeenCalledTimes(1);
    expect(buildTokenizer.mock.results[0].value).toBeInstanceOf(hf.PreTrainedTokenizer);
    expect(ortMock.InferenceSession.create).toHaveBeenCalledTimes(1);
    expect(cacheStorage.buckets.has('transformers-cache')).toBe(false);
  });

  it('with autoLoad off, detect() before preload() is refused without touching the network', async () => {
    const { fetch, urls } = servingFetch(GLINER);
    vi.stubGlobal('fetch', fetch);
    const engine = core.createEngine(webEnv.createWebCoreEnv(), { providerId: GLINER.id }, { autoLoad: false });

    await expect(engine.detect(SENTENCE)).rejects.toBeInstanceOf(core.ModelNotLoadedError);

    expect(urls).toEqual([]);
    expect(ortMock.InferenceSession.create).not.toHaveBeenCalled();
  });
});

// ── Worker bootstrap ──────────────────────────────────────────

describe('detection worker bootstrap (T186)', () => {
  it('serves the engine with autoLoad off: detect before init reports ModelNotLoadedError and fetches nothing', async () => {
    const { storage } = fakeCacheStorage();
    vi.stubGlobal('caches', storage);
    const { fetch, urls } = servingFetch(GLINER);
    vi.stubGlobal('fetch', fetch);
    const posted: Array<{ type: string; requestId?: number; error?: string }> = [];
    vi.stubGlobal('self', globalThis);
    vi.stubGlobal('postMessage', (msg: { type: string }) => { posted.push(msg); });

    await import('../../src/detection.worker.ts');
    const worker = globalThis as unknown as { onmessage: ((e: { data: unknown }) => void) | null };
    expect(worker.onmessage).toBeTypeOf('function');

    worker.onmessage?.({ data: { type: 'detect', requestId: 7, text: SENTENCE } });
    await vi.waitFor(() => {
      expect(posted.some((m) => m.type === 'detectError' && m.requestId === 7)).toBe(true);
    });

    const reply = posted.find((m) => m.type === 'detectError');
    expect(reply?.error).toMatch(/not loaded; call engine\.preload\(\)/);
    expect(posted.some((m) => m.type === 'detected')).toBe(false);
    expect(urls).toEqual([]);
    expect(ortMock.InferenceSession.create).not.toHaveBeenCalled();

    worker.onmessage = null;
  });
});

// ── Legacy transformers-cache cleanup ─────────────────────────
// Last on purpose: vi.resetModules() below gives the env module a fresh
// once-guard; the module instances imported at the top stay untouched.

describe('legacy transformers-cache cleanup (T186)', () => {
  it('attempts caches.delete("transformers-cache") once per page load, never writes it', async () => {
    const { storage, deleted, buckets } = fakeCacheStorage();
    buckets.set('transformers-cache', new Map([['https://huggingface.co/x/tokenizer.json', new Blob(['{}'])]]));
    vi.stubGlobal('caches', storage);
    vi.resetModules();
    const fresh = await import('../../src/engine-env.web.ts');

    fresh.createWebCoreEnv();
    fresh.createWebCoreEnv();
    await expect(fresh.dropLegacyTransformersCache()).resolves.toBe(true);

    expect(deleted).toEqual(['transformers-cache']);
    expect(buckets.has('transformers-cache')).toBe(false);
  });

  it('is a no-op without Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    vi.resetModules();
    const fresh = await import('../../src/engine-env.web.ts');

    expect(() => fresh.createWebCoreEnv()).not.toThrow();
    await expect(fresh.dropLegacyTransformersCache()).resolves.toBe(false);
  });

  it('swallows a rejecting caches.delete', async () => {
    vi.stubGlobal('caches', { delete: vi.fn(async () => { throw new DOMException('denied', 'SecurityError'); }) });
    vi.resetModules();
    const fresh = await import('../../src/engine-env.web.ts');

    await expect(fresh.dropLegacyTransformersCache()).resolves.toBe(false);
  });
});
