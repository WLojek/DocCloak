/**
 * Web shim for the BardS.ai provider that moved to @doccloak/core.
 *
 * The core implementation receives its environment (wasm paths, model blob
 * cache, fetch, tokenizer loader) via CoreEnv injection. This shim keeps the
 * legacy zero-config constructor for the detection worker by building a
 * temporary web CoreEnv internally: Cache-Storage-backed blob cache,
 * import.meta.env.BASE_URL wasm paths and an AutoTokenizer-based
 * loadTokenizer. Temporary until the engine env wiring lands (T009/T010),
 * after which the worker builds one CoreEnv and this file goes away.
 */

import { BardsaiProvider as CoreBardsaiProvider } from '@doccloak/core';
import type { BlobCache, CoreEnv, KVStore } from '@doccloak/core';
import { AutoTokenizer, env as hfEnv } from '@huggingface/transformers';

/** The web cache bucket name stays host-side; core never knows it. */
const CACHE_NAME = 'doccloak-models';

async function openModelCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Cache API unavailable (private mode with strict storage, insecure
    // context, jsdom). Proceed without caching.
    return null;
  }
}

/** Cache Storage adapter for the core BlobCache contract. */
function cacheStorageBlobCache(): BlobCache {
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

/** localStorage-backed KVStore. BardS.ai itself never touches it (custom labels are GLiNER-only). */
function localStorageKV(): KVStore {
  return {
    async get(key: string): Promise<string | null> {
      try { return localStorage.getItem(key); } catch { return null; }
    },
    async set(key: string, value: string): Promise<void> {
      try { localStorage.setItem(key, value); } catch { /* quota/private mode */ }
    },
    async remove(key: string): Promise<void> {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };
}

function webCoreEnv(): CoreEnv {
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
    persistStorage: async () => (await navigator.storage?.persist?.()) ?? false,
  };
}

/** Legacy zero-config provider, backed by the core implementation. */
export class BardsaiProvider extends CoreBardsaiProvider {
  constructor() {
    super(webCoreEnv());
  }
}
