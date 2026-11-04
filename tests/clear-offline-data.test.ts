/**
 * T251 (WLojek/DocCloak#2): Clear offline data fetches every runtime script past the HTTP cache
 * first, then unregisters the worker and drops its caches; doccloak-models stays.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { clearOfflineData } from '../src/sw-register';

const g = globalThis as unknown as { caches?: unknown; fetch: typeof fetch };
const realFetch = g.fetch;
const nav = navigator as Navigator & { serviceWorker?: unknown };

afterEach(() => {
  g.fetch = realFetch;
  delete g.caches;
  delete (nav as { serviceWorker?: unknown }).serviceWorker;
});

describe('clearOfflineData', () => {
  it('reloads each script past the HTTP cache, then unregisters and drops only the worker caches', async () => {
    const order: string[] = [];
    g.fetch = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
      order.push(`fetch ${String(path)} ${init?.cache}`);
      return new Response('x', { status: 200 });
    }) as unknown as typeof fetch;
    const names = ['doccloak-models', 'doccloak-shell-b1', 'doccloak-runtime-b1', 'other'];
    g.caches = {
      keys: async () => names,
      delete: vi.fn(async (name: string) => { order.push(`delete ${name}`); return true; }),
    };
    const unregister = vi.fn(async () => { order.push('unregister'); return true; });
    Object.defineProperty(nav, 'serviceWorker', { value: { getRegistrations: async () => [{ unregister }] }, configurable: true });
    await clearOfflineData(['/ort-wasm-simd-threaded.asyncify.mjs', '/pdf/pdf.worker.mjs']);
    expect(order).toEqual([
      'fetch /ort-wasm-simd-threaded.asyncify.mjs reload',
      'fetch /pdf/pdf.worker.mjs reload',
      'unregister',
      'delete doccloak-shell-b1',
      'delete doccloak-runtime-b1',
    ]);
  });

  it('a script that cannot be fetched (offline) does not stop the rest', async () => {
    g.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    g.caches = { keys: async () => ['doccloak-runtime-b1'], delete: vi.fn(async () => true) };
    const unregister = vi.fn(async () => true);
    Object.defineProperty(nav, 'serviceWorker', { value: { getRegistrations: async () => [{ unregister }] }, configurable: true });
    await expect(clearOfflineData(['/a.mjs'])).resolves.toBeUndefined();
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
