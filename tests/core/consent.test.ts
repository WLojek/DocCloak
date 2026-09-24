// T188 / S2: the consent gate lives in src/engine.ts. No code path may
// spawn the worker or start a model download until the stored flag exists,
// and the hook turns a pre-consent model choice into a preselection that
// the consent card names.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { EngineClient, ProviderId } from '@doccloak/core';
import { ENGINE_SETTINGS_KEYS } from '@doccloak/core';
import {
  CONSENT_STORAGE_KEY,
  ConsentRequiredError,
  PROVIDERS,
  detectEntities,
  preloadModel,
  switchProvider,
  getActiveProviderId,
  _setClientFactoryForTests,
} from '../../src/engine.ts';
import { useAnonymizer } from '../../src/ui/hooks/useAnonymizer.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { en } from '../../src/i18n/translations/en.ts';

interface FakeClient {
  client: EngineClient;
  preload: ReturnType<typeof vi.fn>;
  switchProvider: ReturnType<typeof vi.fn>;
  detect: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

function makeFakeClient(initialProvider: ProviderId): FakeClient {
  let providerId = initialProvider;
  const preload = vi.fn(() => Promise.resolve());
  const switchProviderFn = vi.fn((id: ProviderId) => { providerId = id; return Promise.resolve(); });
  const detect = vi.fn(() => Promise.resolve([]));
  const terminate = vi.fn();
  const client = {
    preload,
    switchProvider: switchProviderFn,
    detect,
    getSettings: () => ({ providerId, threshold: 0.5, regexEnabled: false, regexRegion: 'all', customLabels: [] }),
    onDownloadProgress: () => () => {},
    onDetectionProgress: () => () => {},
    updateSettings: () => Promise.resolve(),
    release: () => Promise.resolve(),
    close: vi.fn(),
  } as unknown as EngineClient;
  return { client, preload, switchProvider: switchProviderFn, detect, terminate };
}

let created: FakeClient[] = [];
const factory = vi.fn((initial: { providerId: ProviderId }) => {
  const fake = makeFakeClient(initial.providerId);
  created.push(fake);
  return { client: fake.client, terminate: fake.terminate };
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  // Saved default: the lightweight model, so a preselection of bardsai is a real switch.
  localStorage.setItem(ENGINE_SETTINGS_KEYS.provider, 'gliner');
  created = [];
  factory.mockClear();
  _setClientFactoryForTests(factory);
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('fetch must never be called before consent');
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

describe('engine consent gate (S2)', () => {
  it('preloadModel() without the flag throws ConsentRequiredError and never spawns the worker', async () => {
    await expect(preloadModel()).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(factory).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('switchProvider() without the flag throws, keeps the saved provider and never touches the client', async () => {
    const err = await switchProvider('bardsai').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConsentRequiredError);
    expect((err as ConsentRequiredError).providerId).toBe('bardsai');
    expect(localStorage.getItem(ENGINE_SETTINGS_KEYS.provider)).toBe('gliner');
    expect(getActiveProviderId()).toBe('gliner');
    expect(factory).not.toHaveBeenCalled();
  });

  it('detectEntities() without the flag goes through the same gate', async () => {
    await expect(detectEntities('Jan Kowalski')).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(factory).not.toHaveBeenCalled();
  });

  it('with the flag stored, preloadModel() asks the worker client to preload exactly once', async () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, '1');
    await Promise.all([preloadModel(), preloadModel()]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(created[0].preload).toHaveBeenCalledTimes(1);
  });

  it('PROVIDERS carries the download size next to the label', () => {
    const sizes = Object.fromEntries(PROVIDERS.map((p) => [p.id, p.sizeMB]));
    expect(sizes).toEqual({ gliner: 83, 'gliner-base': 197, bardsai: 279 });
    for (const p of PROVIDERS) expect(typeof p.label).toBe('string');
  });
});

describe('useAnonymizer consent flow', () => {
  it('switching before consent is a preselection: the card names the model, the client is never called', async () => {
    const { result } = renderHook(() => useAnonymizer(), { wrapper });
    expect(result.current.modelConsented).toBe(false);

    await act(async () => { await result.current.handleSwitchProvider('bardsai'); });

    expect(result.current.modelConsented).toBe(false);
    expect(result.current.pendingProvider).toBe('bardsai');
    expect(result.current.selectedProvider).toBe('bardsai');
    expect(result.current.activeProvider).toBe('gliner');
    expect(result.current.modelLoading).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();

    // The card copy the App renders for this preselection names the model and its size.
    const copy = en.consent.forModel(en.settings.models.bardsai.label, PROVIDERS.find((p) => p.id === 'bardsai')!.sizeMB);
    expect(copy).toBe('Download BardS.ai EU PII (279 MB)?');
  });

  it('Accept stores the flag and triggers exactly one switchProvider on the client', async () => {
    const { result } = renderHook(() => useAnonymizer(), { wrapper });
    await act(async () => { await result.current.handleSwitchProvider('bardsai'); });

    act(() => { result.current.acceptModelDownload(); });

    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBe('1');
    await waitFor(() => expect(result.current.modelLoaded).toBe(true));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(created[0].switchProvider).toHaveBeenCalledTimes(1);
    expect(created[0].switchProvider).toHaveBeenCalledWith('bardsai', []);
    expect(created[0].preload).not.toHaveBeenCalled();
    expect(result.current.activeProvider).toBe('bardsai');
    expect(result.current.pendingProvider).toBeNull();
    expect(result.current.modelConsented).toBe(true);
  });

  it('Accept without a preselection preloads the saved default exactly once', async () => {
    const { result } = renderHook(() => useAnonymizer(), { wrapper });
    act(() => { result.current.acceptModelDownload(); });

    await waitFor(() => expect(result.current.modelLoaded).toBe(true));
    expect(created).toHaveLength(1);
    expect(created[0].preload).toHaveBeenCalledTimes(1);
    expect(created[0].switchProvider).not.toHaveBeenCalled();
    expect(result.current.activeProvider).toBe('gliner');
  });

  it('the retry path goes through the same gate: no flag, no worker, no error banner', async () => {
    const { result } = renderHook(() => useAnonymizer(), { wrapper });
    act(() => { result.current.retryModelLoad(); });

    await waitFor(() => expect(result.current.modelLoading).toBe(false));
    expect(factory).not.toHaveBeenCalled();
    expect(result.current.modelError).toBe(false);
    expect(result.current.modelConsented).toBe(false);
    expect(result.current.pendingProvider).toBe('gliner');
  });

  it('a returning user (flag stored) loads on mount without asking again', async () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, '1');
    const { result } = renderHook(() => useAnonymizer(), { wrapper });
    await waitFor(() => expect(result.current.modelLoaded).toBe(true));
    expect(result.current.modelConsented).toBe(true);
    expect(created[0].preload).toHaveBeenCalledTimes(1);
  });
});
