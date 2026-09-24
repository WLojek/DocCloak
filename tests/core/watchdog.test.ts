// T188 / R1: the detection watchdog is progress-based. A detect call that
// reports no progress for DETECTION_STALL_MS gets its worker terminated and
// replaced; a slow call that keeps reporting progress is never interrupted,
// however long it takes. There is no total time budget.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DetectedEntity, EngineClient, ProviderId } from '@doccloak/core';
import {
  CONSENT_STORAGE_KEY,
  DETECTION_STALL_MS,
  DetectionTimeoutError,
  detectEntities,
  _setClientFactoryForTests,
} from '../../src/engine.ts';

type DetectImpl = (
  text: string,
  onProgress?: (progress: number) => void,
) => Promise<DetectedEntity[]>;

interface FakeClient {
  client: EngineClient;
  preload: ReturnType<typeof vi.fn>;
  detect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

const ENTITY: DetectedEntity = {
  type: 'PERSON', value: 'Jan Kowalski', start: 0, end: 12, confidence: 0.9, detector: 'test',
};

function makeFakeClient(providerId: ProviderId, detectImpl: DetectImpl): FakeClient {
  const preload = vi.fn(() => Promise.resolve());
  const detect = vi.fn((text: string, _labels: unknown, onProgress?: (p: number) => void) => detectImpl(text, onProgress));
  const close = vi.fn();
  const terminate = vi.fn();
  const client = {
    preload,
    detect,
    switchProvider: () => Promise.resolve(),
    getSettings: () => ({ providerId, threshold: 0.5, regexEnabled: false, regexRegion: 'all', customLabels: [] }),
    onDownloadProgress: () => () => {},
    onDetectionProgress: () => () => {},
    updateSettings: () => Promise.resolve(),
    release: () => Promise.resolve(),
    close,
  } as unknown as EngineClient;
  return { client, preload, detect, close, terminate };
}

let created: FakeClient[] = [];
let nextDetect: DetectImpl = () => new Promise(() => { /* never resolves, never reports */ });

const factory = vi.fn((initial: { providerId: ProviderId }) => {
  const fake = makeFakeClient(initial.providerId, nextDetect);
  created.push(fake);
  return { client: fake.client, terminate: fake.terminate };
});

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  created = [];
  factory.mockClear();
  nextDetect = () => new Promise(() => {});
  _setClientFactoryForTests(factory);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  _setClientFactoryForTests(null);
});

describe('detection watchdog (progress-based)', () => {
  it('a detect that never reports progress is cut off after 20 s: DetectionTimeoutError, worker terminated, new client created', async () => {
    const progress = vi.fn();
    const outcome = detectEntities('some text', progress).then(
      () => ({ kind: 'resolved' as const }),
      (err: unknown) => ({ kind: 'rejected' as const, err }),
    );
    // Preload (fake, instant) then detect is issued.
    await vi.advanceTimersByTimeAsync(0);
    expect(created).toHaveLength(1);
    expect(created[0].detect).toHaveBeenCalledTimes(1);

    // Just under the stall limit: still waiting, nothing killed.
    await vi.advanceTimersByTimeAsync(DETECTION_STALL_MS - 1);
    expect(created[0].terminate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await outcome;
    expect(result.kind).toBe('rejected');
    expect((result as { err: unknown }).err).toBeInstanceOf(DetectionTimeoutError);

    // The hung worker is gone and its client closed with the same reason.
    expect(created[0].terminate).toHaveBeenCalledTimes(1);
    expect(created[0].close).toHaveBeenCalledTimes(1);
    expect(created[0].close.mock.calls[0][0]).toBeInstanceOf(DetectionTimeoutError);
    // A replacement was spawned and warmed from cache (through the gate).
    expect(created).toHaveLength(2);
    expect(created[1].preload).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
  });

  it('a detect that reports progress every 5 s for 60 s is never interrupted', async () => {
    const TICKS = 12;
    nextDetect = (_text, onProgress) => new Promise((resolve) => {
      let n = 0;
      const tick = () => {
        n += 1;
        onProgress?.(n / TICKS);
        if (n < TICKS) setTimeout(tick, 5_000);
        else resolve([ENTITY]);
      };
      setTimeout(tick, 5_000);
    });

    const progress = vi.fn();
    const promise = detectEntities('a long document', progress);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).resolves.toEqual([ENTITY]);
    expect(progress).toHaveBeenCalledTimes(TICKS);
    expect(created).toHaveLength(1);
    expect(created[0].terminate).not.toHaveBeenCalled();
    expect(created[0].close).not.toHaveBeenCalled();
  });

  it('a stall after progress stopped still trips the watchdog (no progress for 20 s, whatever came before)', async () => {
    nextDetect = (_text, onProgress) => new Promise(() => {
      setTimeout(() => onProgress?.(0.5), 15_000);
      // then silence forever (e.g. a hung regex after the ML pass)
    });
    const outcome = detectEntities('text').then(() => 'resolved', (err: unknown) => err);
    await vi.advanceTimersByTimeAsync(0);
    // 15 s: progress arrives, timer re-armed. 15 s + 19.999 s: still alive.
    await vi.advanceTimersByTimeAsync(15_000 + DETECTION_STALL_MS - 1);
    expect(created[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBeInstanceOf(DetectionTimeoutError);
    expect(created[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('a detect that finishes disarms the watchdog: nothing is terminated later', async () => {
    nextDetect = () => new Promise((resolve) => setTimeout(() => resolve([ENTITY]), 1_000));
    const promise = detectEntities('text');
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toEqual([ENTITY]);
    await vi.advanceTimersByTimeAsync(DETECTION_STALL_MS * 2);
    expect(created).toHaveLength(1);
    expect(created[0].terminate).not.toHaveBeenCalled();
  });
});
