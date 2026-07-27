/**
 * Web CoreEnv for @doccloak/core (T009).
 *
 * The single place where the browser environment is adapted to the core
 * engine contracts: localStorage-backed KV (mapped 1:1 onto the exact keys
 * the app used before the extraction - no prefixing, so legacy profiles
 * read back unchanged), Cache-Storage-backed model blob cache
 * ('doccloak-models'), BASE_URL wasm paths, @huggingface/transformers
 * tokenizer loading, userAgent/deviceMemory hardware hints for the
 * default-model heuristic and navigator.storage.persist().
 *
 * Consumed by the detection worker bootstrap; supersedes the per-provider
 * shims in src/core/detectors/ner/ for the worker path (T010 deletes those).
 * Note: this module statically imports @huggingface/transformers, so only
 * worker-side code should import it - the main-thread engine adapter keeps
 * its own copy of the hardware sniffing to stay out of the main bundle.
 */

import type { BlobCache, CoreEnv, HardwareHints, KVStore } from '@doccloak/core';
import { AutoTokenizer, env as hfEnv } from '@huggingface/transformers';

/** The web cache bucket name stays host-side; core never knows it. */
const MODEL_CACHE_NAME = 'doccloak-models';

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

/** Build the full web CoreEnv (main thread or worker). */
export function createWebCoreEnv(): CoreEnv {
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
    async loadTokenizer(hfModelId: string): Promise<unknown> {
      // Configure @huggingface/transformers - load tokenizer from HF
      hfEnv.allowLocalModels = false;
      hfEnv.allowRemoteModels = true;
      return AutoTokenizer.from_pretrained(hfModelId);
    },
    hardware: webHardwareHints(),
    persistStorage: async () => (await navigator.storage?.persist?.()) ?? false,
  };
}
