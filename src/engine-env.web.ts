/**
 * Web CoreEnv for @doccloak/core (T009, T186).
 *
 * The single place where the browser environment is adapted to the core
 * engine contracts: localStorage-backed KV (mapped 1:1 onto the exact keys
 * the app used before the extraction - no prefixing, so legacy profiles
 * read back unchanged), Cache-Storage-backed model blob cache
 * ('doccloak-models'), BASE_URL wasm paths, tokenizer construction from
 * core's pinned and hash-checked tokenizer files, userAgent/deviceMemory
 * hardware hints for the default-model heuristic and
 * navigator.storage.persist().
 *
 * Tokenizers (T186, security report S1/S3/S5): core downloads
 * tokenizer.json and tokenizer_config.json itself through fetchModelBlob
 * (immutable resolve/<commit> URL, SHA-256 + size check, 'doccloak-models'
 * cache, resume and retry) and hands the parsed objects to buildTokenizer.
 * This module only picks the @huggingface/transformers constructor named by
 * tokenizer_config.json. Nothing here calls AutoTokenizer.from_pretrained,
 * so the library never probes the mutable resolve/main branch and never
 * keeps its own unverified 'transformers-cache' bucket; a warm
 * 'doccloak-models' cache therefore works with the network switched off.
 *
 * Consumed by the detection worker bootstrap (src/detection.worker.ts).
 * Note: this module statically imports @huggingface/transformers, so only
 * worker-side code should import it - the main-thread engine adapter keeps
 * its own copy of the hardware sniffing to stay out of the main bundle.
 */

import type { BlobCache, CoreEnv, HardwareHints, KVStore } from '@doccloak/core';
import {
  DebertaV2Tokenizer,
  PreTrainedTokenizer,
  XLMRobertaTokenizer,
  env as hfEnv,
} from '@huggingface/transformers';

/** The web cache bucket name stays host-side; core never knows it. */
const MODEL_CACHE_NAME = 'doccloak-models';

/**
 * Cache Storage bucket @huggingface/transformers filled for
 * AutoTokenizer.from_pretrained before T186. Its entries were fetched
 * through the library (resolve/main probes, no hash check), so the bucket
 * is dropped once per page load and never written again.
 */
export const LEGACY_TRANSFORMERS_CACHE_NAME = 'transformers-cache';

// The library must not keep a cache of its own: every tokenizer byte the web
// app uses comes through core's verified 'doccloak-models' cache.
hfEnv.useBrowserCache = false;
// No code path on the web calls from_pretrained any more. Keep both library
// loaders switched off so an accidental call fails instead of probing
// huggingface.co or a local path (fail closed).
hfEnv.allowRemoteModels = false;
hfEnv.allowLocalModels = false;

type TokenizerJson = Record<string, unknown>;
type TokenizerConfig = Record<string, unknown>;
type TokenizerConstructor = new (tokenizerJson: TokenizerJson, tokenizerConfig: TokenizerConfig) => PreTrainedTokenizer;

/**
 * tokenizer_class values of the pinned providers mapped onto the
 * @huggingface/transformers constructors (all three are root exports in
 * 4.2.0). AutoTokenizer.from_pretrained resolves the class the same way
 * (strip a "Fast" suffix, look the name up) and ends in the same
 * `new cls(tokenizerJson, tokenizerConfig)` call, so the constructor path
 * is token-identical to the from_pretrained path; the one difference is
 * that an unknown class throws here instead of silently falling back to
 * the base class.
 *
 * - PreTrainedTokenizerFast -> PreTrainedTokenizer (GLiNER PII Small)
 * - DebertaV2Tokenizer (GLiNER PII Base)
 * - XLMRobertaTokenizer (BardS.ai EU PII)
 */
const TOKENIZER_CLASSES: ReadonlyMap<string, TokenizerConstructor> = new Map<string, TokenizerConstructor>([
  ['PreTrainedTokenizer', PreTrainedTokenizer],
  ['DebertaV2Tokenizer', DebertaV2Tokenizer],
  ['XLMRobertaTokenizer', XLMRobertaTokenizer],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * CoreEnv.buildTokenizer for the web: turn core's verified, parsed
 * tokenizer.json and tokenizer_config.json into a tokenizer instance.
 * Never touches the network or Cache Storage. Throws (fail closed) when
 * tokenizer_config.json names a class outside TOKENIZER_CLASSES.
 */
export function buildWebTokenizer(tokenizerJson: unknown, tokenizerConfig: unknown): PreTrainedTokenizer {
  if (!isRecord(tokenizerJson)) {
    throw new Error('Pinned tokenizer.json did not parse to an object');
  }
  if (!isRecord(tokenizerConfig)) {
    throw new Error('Pinned tokenizer_config.json did not parse to an object');
  }
  const declared = tokenizerConfig.tokenizer_class;
  if (typeof declared !== 'string' || declared === '') {
    throw new Error(`Unsupported tokenizer_class: tokenizer_config.json declares none (expected one of ${[...TOKENIZER_CLASSES.keys()].join(', ')})`);
  }
  // Fast variants share the tokenizer.json format and the JS constructor.
  const ctor = TOKENIZER_CLASSES.get(declared.replace(/Fast$/, ''));
  if (!ctor) {
    throw new Error(`Unsupported tokenizer_class "${declared}" (expected one of ${[...TOKENIZER_CLASSES.keys()].join(', ')})`);
  }
  return new ctor(tokenizerJson, tokenizerConfig);
}

let legacyCacheCleanup: Promise<boolean> | null = null;

/**
 * Best-effort, once per page load: drop the library's legacy
 * 'transformers-cache' bucket. Resolves true when a bucket was removed,
 * false when there was none or Cache Storage is unavailable; never throws.
 */
export function dropLegacyTransformersCache(): Promise<boolean> {
  if (!legacyCacheCleanup) {
    legacyCacheCleanup = (async () => {
      if (typeof caches === 'undefined') return false;
      try {
        return await caches.delete(LEGACY_TRANSFORMERS_CACHE_NAME);
      } catch {
        // Private mode with strict storage, insecure context: nothing to drop.
        return false;
      }
    })();
  }
  return legacyCacheCleanup;
}

/**
 * localStorage-backed KVStore under the same keys as before the extraction.
 * In a Web Worker localStorage is unavailable, so gets return null and sets
 * are no-ops, matching the previous try/catch-around-localStorage behavior
 * (settings arrive over the worker protocol instead).
 */
export function localStorageKV(): KVStore {
  return {
    async get(key: string): Promise<string | null> {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    async set(key: string, value: string): Promise<void> {
      try { localStorage.setItem(key, value); } catch { /* quota/private mode/worker */ }
    },
    async remove(key: string): Promise<void> {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };
}

async function openModelCache(): Promise<Cache | null> {
  try {
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    // Cache API unavailable (private mode with strict storage, insecure
    // context, jsdom). Proceed without caching.
    return null;
  }
}

/** Cache Storage adapter for the core BlobCache contract. */
export function cacheStorageBlobCache(): BlobCache {
  return {
    async match(url: string): Promise<Blob | undefined> {
      const cache = await openModelCache();
      if (!cache) return undefined;
      const cached = await cache.match(url);
      return cached ? await cached.blob() : undefined;
    },
    async put(url: string, blob: Blob): Promise<boolean> {
      const cache = await openModelCache();
      if (!cache) return false;
      // Large models can exceed per-origin quota; the throw surfaces in core
      // as a best-effort warning, matching the previous behavior.
      await cache.put(url, new Response(blob));
      return true;
    },
    async delete(url: string): Promise<void> {
      const cache = await openModelCache();
      await cache?.delete(url);
    },
  };
}

/**
 * userAgent/deviceMemory sniffing for core's default-model heuristic
 * (mobile/low-memory devices default to the lightweight GLiNER model).
 * The decision itself lives in core (pickDefaultProvider); this only
 * reports what the browser exposes.
 */
export function webHardwareHints(): HardwareHints {
  const hints: HardwareHints = {};
  try {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean }; deviceMemory?: number };
    let isMobile = false;
    if (nav.userAgentData?.mobile) isMobile = true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) isMobile = true;
    // iPadOS 13+ reports itself as macOS; tell it apart via touch support
    if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) isMobile = true;
    hints.isMobile = isMobile;
    if (typeof nav.deviceMemory === 'number') hints.deviceMemoryGB = nav.deviceMemory;
  } catch { /* ignore - assume unconstrained */ }
  return hints;
}

async function persistWebStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    // No navigator (tests) or persist() rejected: treat as not persisted.
    return false;
  }
}

/** Build the full web CoreEnv (main thread or worker). */
export function createWebCoreEnv(): CoreEnv {
  void dropLegacyTransformersCache();
  return {
    kv: localStorageKV(),
    modelCache: cacheStorageBlobCache(),
    // Wrap instead of passing the function reference so fetch keeps its
    // expected receiver (avoids Illegal invocation in browsers).
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    // Same behavior as before the move: BASE_URL wasm assets, single-threaded
    // WASM (ORT's multi-threaded path hangs in some cross-origin-isolated
    // contexts).
    wasm: { paths: import.meta.env.BASE_URL, numThreads: 1 },
    buildTokenizer: buildWebTokenizer,
    hardware: webHardwareHints(),
    persistStorage: persistWebStorage,
  };
}
