// T280 (WLojek/DocCloak.Core#5): detection runs on several WASM threads where the page is
// cross-origin isolated, and a threaded model load that hangs falls back to one thread.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EngineClient, ProviderId } from '@doccloak/core';
import { MAX_ORT_THREADS, SINGLE_THREAD_STORAGE_KEY, detectionWorkerName, ortThreadsFor, threadsFromWorkerName } from '../../src/ort-threads.ts';
import {
  CONSENT_STORAGE_KEY,
  LOAD_STALL_MS,
  detectionThreads,
  isModelLoaded,
  preloadModel,
  _setClientFactoryForTests,
  _setWorkerThreadsForTests,
} from '../../src/engine.ts';

describe('thread count', () => {
  const desktop = { isolated: true, mobile: false, singleThreadStored: false };

  it('is half the cores, from 1 to the cap', () => {
    expect(ortThreadsFor({ ...desktop, cores: 2 })).toBe(1);
    expect(ortThreadsFor({ ...desktop, cores: 4 })).toBe(2);
    expect(ortThreadsFor({ ...desktop, cores: 6 })).toBe(3);
    expect(ortThreadsFor({ ...desktop, cores: 8 })).toBe(4);
    expect(ortThreadsFor({ ...desktop, cores: 32 })).toBe(MAX_ORT_THREADS);
    expect(ortThreadsFor({ ...desktop, cores: 1 })).toBe(1);
    expect(ortThreadsFor({ ...desktop, cores: undefined })).toBe(1);
  });

  it('stays 1 without cross-origin isolation, on phones, and after a stored fallback', () => {
    expect(ortThreadsFor({ ...desktop, cores: 12, isolated: false })).toBe(1);
    expect(ortThreadsFor({ ...desktop, cores: 12, mobile: true })).toBe(1);
    expect(ortThreadsFor({ ...desktop, cores: 12, singleThreadStored: true })).toBe(1);
  });

  it('travels to the worker in its name, and any other name means one thread', () => {
    expect(threadsFromWorkerName(detectionWorkerName(4))).toBe(4);
    expect(threadsFromWorkerName(detectionWorkerName(1))).toBe(1);
    expect(threadsFromWorkerName('')).toBe(1);
    expect(threadsFromWorkerName(undefined)).toBe(1);
    expect(threadsFromWorkerName('doccloak-detection:threads=64')).toBe(1);
    expect(threadsFromWorkerName('doccloak-detection:threads=0')).toBe(1);
  });

  it('the page decides from what the browser reports', () => {
    const scope = globalThis as { crossOriginIsolated?: boolean };
    const before = Object.getOwnPropertyDescriptor(scope, 'crossOriginIsolated');
    const cores = vi.spyOn(navigator, 'hardwareConcurrency', 'get').mockReturnValue(8);
    try {
      Object.defineProperty(scope, 'crossOriginIsolated', { value: true, configurable: true });
      localStorage.removeItem(SINGLE_THREAD_STORAGE_KEY);
      expect(detectionThreads()).toBe(4);
      localStorage.setItem(SINGLE_THREAD_STORAGE_KEY, '1');
      expect(detectionThreads()).toBe(1);
      localStorage.removeItem(SINGLE_THREAD_STORAGE_KEY);
      Object.defineProperty(scope, 'crossOriginIsolated', { value: false, configurable: true });
      expect(detectionThreads()).toBe(1);
    } finally {
      cores.mockRestore();
      if (before) Object.defineProperty(scope, 'crossOriginIsolated', before);
      else delete scope.crossOriginIsolated;
      localStorage.removeItem(SINGLE_THREAD_STORAGE_KEY);
    }
  });
});

interface FakeClient {
  client: EngineClient;
  preload: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  progress: (downloaded: number, total: number) => void;
}

/** A client whose preload settles only when the test says so, or when the worker is dropped (as the real one does). */
function makeFakeClient(providerId: ProviderId, hangs: boolean): FakeClient {
  let rejectPending: ((err: Error) => void) | null = null;
  let onProgress: ((p: { loaded: number; total: number }) => void) | null = null;
  const preload = vi.fn(() => (hangs ? new Promise<void>((_, reject) => { rejectPending = reject; }) : Promise.resolve()));
  const terminate = vi.fn();
  const client = {
    preload,
    detect: () => Promise.resolve([]),
    switchProvider: () => Promise.resolve(),
    getSettings: () => ({ providerId, threshold: 0.5, regexEnabled: false, regexRegion: 'all', customLabels: [] }),
    onDownloadProgress: (cb: (p: { loaded: number; total: number }) => void) => { onProgress = cb; return () => {}; },
    onDetectionProgress: () => () => {},
    updateSettings: () => Promise.resolve(),
    release: () => Promise.resolve(),
    close: (reason: Error) => rejectPending?.(reason),
  } as unknown as EngineClient;
  return { client, preload, terminate, progress: (downloaded, total) => onProgress?.({ loaded: downloaded, total }) };
}

describe('a threaded model load that hangs', () => {
  let created: FakeClient[] = [];
  let hangs: boolean[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    localStorage.setItem(CONSENT_STORAGE_KEY, '1');
    created = [];
    _setClientFactoryForTests((initial) => {
      const fake = makeFakeClient(initial.providerId, hangs[created.length] ?? false);
      created.push(fake);
      return { client: fake.client, terminate: fake.terminate };
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    _setClientFactoryForTests(null);
  });

  it('is dropped after LOAD_STALL_MS and loaded again on one thread, which is then stored', async () => {
    hangs = [true, false];
    _setWorkerThreadsForTests(4);
    const outcome = preloadModel().then(() => 'loaded', (err: unknown) => err);
    await vi.advanceTimersByTimeAsync(LOAD_STALL_MS - 1);
    expect(created).toHaveLength(1);
    expect(created[0].terminate).not.toHaveBeenCalled();
    expect(localStorage.getItem(SINGLE_THREAD_STORAGE_KEY)).toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe('loaded');
    // The hung worker is gone, a second one loaded the model, and this profile stays on one thread.
    expect(created[0].terminate).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
    expect(created[1].preload).toHaveBeenCalledTimes(1);
    expect(isModelLoaded()).toBe(true);
    expect(localStorage.getItem(SINGLE_THREAD_STORAGE_KEY)).toBe('1');
    expect(detectionThreads()).toBe(1);
  });

  it('a download that is still running is not a hang, however long it takes', async () => {
    hangs = [true, false];
    _setWorkerThreadsForTests(4);
    const outcome = preloadModel().then(() => 'loaded', (err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);
    created[0].progress(10, 100);
    await vi.advanceTimersByTimeAsync(LOAD_STALL_MS * 5);
    expect(created).toHaveLength(1);
    expect(created[0].terminate).not.toHaveBeenCalled();
    // The bytes are in: from here the load has LOAD_STALL_MS to finish.
    created[0].progress(100, 100);
    await vi.advanceTimersByTimeAsync(LOAD_STALL_MS - 1);
    expect(created[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe('loaded');
    expect(created).toHaveLength(2);
  });

  it('a load that fails for another reason is reported as it is, with the threads kept', async () => {
    _setWorkerThreadsForTests(4);
    _setClientFactoryForTests((initial) => {
      const fake = makeFakeClient(initial.providerId, false);
      fake.preload.mockImplementation(() => Promise.reject(new Error('checksum mismatch')));
      created.push(fake);
      return { client: fake.client, terminate: fake.terminate };
    });
    _setWorkerThreadsForTests(4);
    await expect(preloadModel()).rejects.toThrow('checksum mismatch');
    expect(created).toHaveLength(1);
    expect(localStorage.getItem(SINGLE_THREAD_STORAGE_KEY)).toBeNull();
  });

  it('with one thread nothing is watched: a slow load is left alone', async () => {
    hangs = [true];
    const outcome = preloadModel().then(() => 'loaded', () => 'failed');
    await vi.advanceTimersByTimeAsync(LOAD_STALL_MS * 3);
    expect(created).toHaveLength(1);
    expect(created[0].terminate).not.toHaveBeenCalled();
    expect(localStorage.getItem(SINGLE_THREAD_STORAGE_KEY)).toBeNull();
    void outcome;
  });
});
