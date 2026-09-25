// T222: the hook exposes a remaining-time estimate while the detector runs
// and a cancel that closes the overlay at once, aborts the worker call and
// ignores anything that run still returns. Translations for the new keys
// exist in every language.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, EngineClient } from '@doccloak/core';
import { useAnonymizer } from '../../src/ui/hooks/useAnonymizer.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { formatEta } from '../../src/lib/detection-eta.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY, DetectionAbortedError } from '../../src/engine.ts';

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const ENTITY: DetectedEntity = { type: 'PERSON', value: 'Jan Kowalski', start: 6, end: 18, confidence: 0.9, detector: 'test' };

interface Run {
  onProgress: (p: number) => void;
  signal: AbortSignal | undefined;
  resolve: (e: DetectedEntity[]) => void;
  reject: (err: Error) => void;
}
let runs: Run[] = [];
let terminate = vi.fn();

function fakeFactory() {
  const client = {
    preload: () => Promise.resolve(),
    detect: (_text: string, signal: AbortSignal | undefined, onProgress: (p: number) => void) =>
      new Promise<DetectedEntity[]>((resolve, reject) => {
        const run: Run = { onProgress, signal, resolve, reject };
        runs.push(run);
        // A cooperative worker: acknowledges the cancel on the next tick.
        signal?.addEventListener('abort', () => setTimeout(() => reject(new DetectionAbortedError()), 0), { once: true });
      }),
    switchProvider: () => Promise.resolve(),
    getSettings: () => ({ providerId: 'bardsai', threshold: 0.5, regexEnabled: false, regexRegion: 'all', customLabels: [] }),
    onDownloadProgress: () => () => {},
    onDetectionProgress: () => () => {},
    updateSettings: () => Promise.resolve(),
    release: () => Promise.resolve(),
    close: () => {},
  } as unknown as EngineClient;
  return { client, terminate };
}

let now = 1_000_000;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  runs = [];
  terminate = vi.fn();
  _setClientFactoryForTests(fakeFactory);
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

async function startRun() {
  const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
  act(() => hook.result.current.handleInputChange('Hello Jan Kowalski, welcome.'));
  act(() => hook.result.current.anonymize());
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(hook.result.current.anonymizing).toBe(true);
  expect(hook.result.current.detectionProgress).toBe(0);
  expect(hook.result.current.detectionEta).toBeNull();
  return hook;
}

describe('detection ETA and cancel (T222)', () => {
  it('shows an estimate once the rate over the progress samples is measurable', async () => {
    const hook = await startRun();
    // bardsai-style: preparation jump, then steady chunks.
    now += 100; act(() => runs[0].onProgress(0.1));
    expect(hook.result.current.detectionEta).toBeNull();
    now += 10_000; act(() => runs[0].onProgress(0.2));
    // Rate from the second sample: 0.1 per 10 s, 0.8 left -> 80 s.
    expect(hook.result.current.detectionEta).toBeCloseTo(80, 5);
    expect(hook.result.current.detectionProgress).toBe(0.2);
    expect(formatEta(hook.result.current.detectionEta!, en.anonymizing)).toBe('2 min');

    act(() => runs[0].resolve([ENTITY]));
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(hook.result.current.detectionEta).toBeNull();
    expect(hook.result.current.detectionProgress).toBeNull();
    expect(hook.result.current.entities.map((e) => e.value)).toEqual(['Jan Kowalski']);
  });

  it('cancel closes the overlay at once, aborts the worker call and shows a toast', async () => {
    const hook = await startRun();
    now += 5_000; act(() => runs[0].onProgress(0.3));
    act(() => hook.result.current.cancelAnonymize());
    expect(hook.result.current.anonymizing).toBe(false);
    expect(hook.result.current.detectionProgress).toBeNull();
    expect(hook.result.current.detectionEta).toBeNull();
    expect(hook.result.current.detectionError).toBeNull();
    expect(runs[0].signal?.aborted).toBe(true);
    expect(screen.getByText(en.detect.cancelled)).toBeTruthy();
    // The typed rejection that follows is swallowed: no error, no crash.
    await new Promise((r) => setTimeout(r, 10));
    expect(hook.result.current.detectionError).toBeNull();
    expect(hook.result.current.anonymizing).toBe(false);
    expect(terminate).not.toHaveBeenCalled();
  });

  it('a result of a cancelled run is never applied, and a new run works', async () => {
    const hook = await startRun();
    act(() => hook.result.current.cancelAnonymize());
    // A worker that ignored the cancel and answered anyway.
    act(() => runs[0].resolve([ENTITY]));
    await new Promise((r) => setTimeout(r, 10));
    expect(hook.result.current.entities).toEqual([]);
    expect(hook.result.current.anonymizedText).toBe('');

    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(hook.result.current.anonymizing).toBe(true);
    act(() => runs[1].resolve([ENTITY]));
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(hook.result.current.entities.map((e) => e.value)).toEqual(['Jan Kowalski']);
  });

  it('cancel is a no-op when nothing runs', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    act(() => hook.result.current.cancelAnonymize());
    expect(hook.result.current.anonymizing).toBe(false);
    expect(screen.queryByText(en.detect.cancelled)).toBeNull();
  });

  it('every language translates the overlay estimate, the cancel button and the toast', () => {
    for (const lang of languages) {
      const a = lang.translations.anonymizing;
      expect(a.cancel.length, lang.code).toBeGreaterThan(0);
      expect(a.remaining(a.minutes(3)), lang.code).toContain('3');
      expect(a.hours(1), lang.code).toContain('1');
      expect(a.seconds(15), lang.code).toContain('15');
      expect(lang.translations.detect.cancelled.length, lang.code).toBeGreaterThan(0);
    }
  });
});
