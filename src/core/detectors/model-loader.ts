/**
 * Web shim for the model loader that moved to @doccloak/core.
 *
 * The core implementation (Range resume, retry backoff, stall watchdog,
 * throttled progress) now receives its environment by injection:
 * { cache: BlobCache, fetch, persistStorage? }. This shim keeps the legacy
 * zero-config API for the detection providers by constructing a
 * Cache-Storage-backed BlobCache adapter internally. Temporary until the
 * engine env wiring lands (T007/T008), after which providers receive the
 * env directly and this file goes away.
 */

import {
  fetchModelBlob as coreFetchModelBlob,
  evictModelFromCache as coreEvictModelFromCache,
} from '@doccloak/core';
import type {
  BlobCache,
  ModelLoaderEnv,
  DownloadProgress,
  FetchModelOptions,
} from '@doccloak/core';

export { retryAsync } from '@doccloak/core';
export type { DownloadProgress, FetchModelOptions } from '@doccloak/core';

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

/**
 * Cache Storage adapter for the core BlobCache contract. Read/put errors on
 * an available cache propagate so core can apply its own fallback semantics
 * (fall through to network, warn on failed put).
 */
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

function webModelLoaderEnv(): ModelLoaderEnv {
  return {
    cache: cacheStorageBlobCache(),
    // Wrap instead of passing the function reference so fetch keeps its
    // expected receiver (avoids Illegal invocation in browsers).
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    persistStorage: async () => (await navigator.storage?.persist?.()) ?? false,
  };
}

/**
 * Download a model with progress reporting, resume and retry.
 * Returns a Blob (disk-backed via the Cache API when possible).
 */
export function fetchModelBlob(
  url: string,
  onProgress?: DownloadProgress,
  options?: FetchModelOptions,
): Promise<Blob> {
  return coreFetchModelBlob(webModelLoaderEnv(), url, onProgress, options);
}

/**
 * Remove a single model from the cache (e.g. when its URL changes).
 */
export function evictModelFromCache(url: string): Promise<void> {
  return coreEvictModelFromCache(webModelLoaderEnv(), url);
}
