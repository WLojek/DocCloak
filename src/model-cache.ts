/**
 * The Cache Storage bucket that holds the downloaded models, seen from the main thread (T250):
 * which models are on this device, and removing one to free its space. The detection worker
 * writes the bucket (engine-env.web.ts); Cache Storage is shared by the page and its workers.
 * Kept apart from engine-env.web.ts so the main bundle does not import transformers.js.
 */

import { isProviderCached, removeProviderFromCache, type ModelCacheIndex, type ProviderId } from '@doccloak/core';

/** The web cache bucket name stays host-side; core never knows it. */
export const MODEL_CACHE_NAME = 'doccloak-models';

/** Base of the files DocCloak serves itself, as the worker's CoreEnv.assetBaseUrl. */
function assetBaseUrl(): string | undefined {
  return typeof location === 'undefined' ? undefined : new URL(import.meta.env.BASE_URL, location.origin).href;
}

async function openIndex(): Promise<ModelCacheIndex | null> {
  try {
    const cache = await caches.open(MODEL_CACHE_NAME);
    return {
      // match() answers without reading the body, which for a model is hundreds of MB.
      has: async (url) => (await cache.match(url)) !== undefined,
      delete: async (url) => { await cache.delete(url); },
    };
  } catch {
    // Cache API unavailable (private mode with strict storage, insecure context, jsdom).
    return null;
  }
}

/** The models saved on this device; null when the browser does not let the page see its cache. */
export async function savedProviderIds(ids: readonly ProviderId[]): Promise<Set<ProviderId> | null> {
  const index = await openIndex();
  if (!index) return null;
  const base = assetBaseUrl();
  const saved = await Promise.all(ids.map(async (id) => ((await isProviderCached(index, id, { assetBaseUrl: base })) ? id : null)));
  return new Set(saved.filter((id): id is ProviderId => id !== null));
}

/** Remove one model's files from this device, keeping what another saved model shares. */
export async function removeSavedProvider(id: ProviderId): Promise<void> {
  const index = await openIndex();
  if (!index) throw new Error('Cache Storage is not available');
  await removeProviderFromCache(index, id, { assetBaseUrl: assetBaseUrl() });
}
