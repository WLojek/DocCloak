// T251 (WLojek/DocCloak#2): when the model runtime script fails to import (a copy the browser kept
// under a wrong type), the runtime scripts are fetched again past the HTTP cache and the model is
// loaded once more in a fresh worker; at most once a session, and not for other errors.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { EngineClient } from '@doccloak/core';
import { useAnonymizer, isRuntimeImportError } from '../../src/ui/hooks/useAnonymizer.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { RUNTIME_SCRIPTS } from '../../src/sw-register.ts';
import { _resetEngineStateForTests, _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';

const IMPORT_ERROR = new Error('no available backend found. ERR: [wasm] TypeError: Importing a module script failed.');

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

function factoryFailing(failures: Error[]) {
  const spawned = vi.fn();
  const factory = () => {
    spawned();
    const client = {
      preload: () => (failures.length ? Promise.reject(failures.shift()) : Promise.resolve()),
      detect: () => Promise.resolve([]),
      switchProvider: () => Promise.resolve(),
      getSettings: () => ({ providerId: 'bardsai', threshold: 0.5, regexEnabled: true, regexRegion: 'all', customLabels: [] }),
      onDownloadProgress: () => () => {},
      onDetectionProgress: () => () => {},
      updateSettings: () => Promise.resolve(),
      release: () => Promise.resolve(),
      close: () => {},
    } as unknown as EngineClient;
    return { client, terminate: vi.fn() };
  };
  return { factory, spawned };
}

const fetchMock = vi.fn(async () => new Response('x', { status: 200 }));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  _resetEngineStateForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
  _resetEngineStateForTests();
});

describe('model runtime recovery', () => {
  it('tells a refused runtime script from other load failures', () => {
    expect(isRuntimeImportError(IMPORT_ERROR)).toBe(true);
    expect(isRuntimeImportError(new TypeError('Failed to fetch dynamically imported module: https://x/ort-wasm-simd-threaded.asyncify.mjs'))).toBe(true);
    expect(isRuntimeImportError(new Error("Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of 'application/octet-stream'"))).toBe(true);
    expect(isRuntimeImportError(new Error('Failed to download model: HTTP 503'))).toBe(false);
    expect(isRuntimeImportError(new Error('Model failed SHA-256 integrity check'))).toBe(false);
  });

  it('fetches the runtime scripts again past the HTTP cache and loads in a fresh worker', async () => {
    const { factory, spawned } = factoryFailing([IMPORT_ERROR]);
    _setClientFactoryForTests(factory);
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await waitFor(() => expect(result.current.modelLoaded).toBe(true));
    expect(result.current.modelError).toBe(false);
    expect(spawned).toHaveBeenCalledTimes(2);
    expect(RUNTIME_SCRIPTS).toContain('/ort-wasm-simd-threaded.asyncify.mjs');
    for (const path of RUNTIME_SCRIPTS) expect(fetchMock).toHaveBeenCalledWith(path, { cache: 'reload', credentials: 'same-origin' });
  });

  it('only once a session: a second failure shows the error', async () => {
    const { factory, spawned } = factoryFailing([IMPORT_ERROR, IMPORT_ERROR]);
    _setClientFactoryForTests(factory);
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await waitFor(() => expect(result.current.modelError).toBe(true));
    expect(spawned).toHaveBeenCalledTimes(2);
    expect(result.current.modelLoaded).toBe(false);
  });

  it('other failures (a download error) show the error at once, nothing fetched again', async () => {
    const { factory, spawned } = factoryFailing([new Error('Failed to download model: HTTP 503')]);
    _setClientFactoryForTests(factory);
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await waitFor(() => expect(result.current.modelError).toBe(true));
    expect(spawned).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offline: no refetch, the error is shown', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { factory, spawned } = factoryFailing([IMPORT_ERROR]);
    _setClientFactoryForTests(factory);
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await waitFor(() => expect(result.current.modelError).toBe(true));
    expect(spawned).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
