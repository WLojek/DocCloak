// T222: cancelling a detect call. An aborted signal reaches the worker as
// cancelDetect; when the worker acknowledges, the call rejects with
// DetectionAbortedError and the worker stays. A worker that does not
// acknowledge within CANCEL_GRACE_MS is terminated and replaced, like on a
// watchdog stall.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DetectedEntity, EngineClient, ProviderId } from '@doccloak/core';
import {
  CONSENT_STORAGE_KEY,
  CANCEL_GRACE_MS,
  DETECTION_STALL_MS,
  DetectionAbortedError,
  DetectionTimeoutError,
  detectEntities,
  _setClientFactoryForTests,
} from '../../src/engine.ts';

type DetectImpl = (
  text: string,
  signal: AbortSignal | undefined,
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
  const detect = vi.fn((text: string, signal: AbortSignal | undefined, onProgress?: (p: number) => void) => detectImpl(text, signal, onProgress));
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
let nextDetect: DetectImpl = () => new Promise(() => {});

const factory = vi.fn((initial: { providerId: ProviderId }) => {
  const fake = makeFakeClient(initial.providerId, nextDetect);
  created.push(fake);
  return { client: fake.client, terminate: fake.terminate };
});

/** A worker that honours the signal: progress every second, acknowledges a cancel 300 ms later. */
const cooperative: DetectImpl = (_text, signal, onProgress) => new Promise((resolve, reject) => {
  let n = 0;
  const tick = () => {
    n += 1;
    onProgress?.(n / 100);
    if (n < 100) timer = setTimeout(tick, 1_000);
    else resolve([ENTITY]);
  };
  let timer = setTimeout(tick, 1_000);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    setTimeout(() => reject(new DetectionAbortedError()), 300);
  }, { once: true });
});

/** A worker that ignores the signal (keeps reporting progress forever). */
const deaf: DetectImpl = (_text, _signal, onProgress) => new Promise(() => {
  let n = 0;
  const tick = () => { n += 1; onProgress?.(n / 1000); setTimeout(tick, 1_000); };
  setTimeout(tick, 1_000);
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
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  _setClientFactoryForTests(null);
});

describe('detection cancel (T222)', () => {
  it('an acknowledged cancel rejects with DetectionAbortedError and keeps the worker', async () => {
    nextDetect = cooperative;
    const controller = new AbortController();
    const progress = vi.fn();
    const outcome = detectEntities('a long document', progress, controller.signal).then(
      () => 'resolved', (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(progress).toHaveBeenCalledTimes(3);
    // The signal handed to the client is the caller's.
    expect(created[0].detect.mock.calls[0][1]).toBe(controller.signal);

    controller.abort();
    await vi.advanceTimersByTimeAsync(300);
    expect(await outcome).toBeInstanceOf(DetectionAbortedError);
    expect(created[0].terminate).not.toHaveBeenCalled();
    expect(created[0].close).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    // Nothing fires later (grace timer and watchdog were cleared).
    await vi.advanceTimersByTimeAsync(DETECTION_STALL_MS * 2);
    expect(created[0].terminate).not.toHaveBeenCalled();
  });

  it('a worker that does not acknowledge within the grace period is terminated and replaced', async () => {
    nextDetect = deaf;
    const controller = new AbortController();
    const outcome = detectEntities('a long document', undefined, controller.signal).then(
      () => 'resolved', (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(2_500);
    controller.abort();
    // Progress keeps arriving during the grace period; it does not extend it.
    await vi.advanceTimersByTimeAsync(CANCEL_GRACE_MS - 1);
    expect(created[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const err = await outcome;
    expect(err).toBeInstanceOf(DetectionAbortedError);
    expect(err).not.toBeInstanceOf(DetectionTimeoutError);
    expect(created[0].terminate).toHaveBeenCalledTimes(1);
    expect(created[0].close.mock.calls[0][0]).toBeInstanceOf(DetectionAbortedError);
    // Replacement spawned and warmed from cache.
    expect(created).toHaveLength(2);
    expect(created[1].preload).toHaveBeenCalledTimes(1);
  });

  it('a cancel does not trip the watchdog while waiting for the acknowledgement', async () => {
    // Acknowledges after 4 s of silence: within the grace period, past nothing else.
    nextDetect = (_text, signal, onProgress) => new Promise((_resolve, reject) => {
      onProgress?.(0.1);
      signal?.addEventListener('abort', () => setTimeout(() => reject(new DetectionAbortedError()), 4_000), { once: true });
    });
    const controller = new AbortController();
    const outcome = detectEntities('text', undefined, controller.signal).then(() => 'resolved', (err: unknown) => err);
    await vi.advanceTimersByTimeAsync(DETECTION_STALL_MS - 1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await outcome).toBeInstanceOf(DetectionAbortedError);
    expect(created[0].terminate).not.toHaveBeenCalled();
  });

  it('a signal aborted before the call rejects without asking the worker', async () => {
    nextDetect = cooperative;
    const controller = new AbortController();
    controller.abort();
    await expect(detectEntities('text', undefined, controller.signal)).rejects.toBeInstanceOf(DetectionAbortedError);
    await vi.advanceTimersByTimeAsync(0);
    expect(created.length === 0 || created[0].detect.mock.calls.length === 0).toBe(true);
  });

  it('without a signal nothing changes: a slow cooperative worker finishes', async () => {
    nextDetect = cooperative;
    const promise = detectEntities('text');
    await vi.advanceTimersByTimeAsync(100_000);
    await expect(promise).resolves.toEqual([ENTITY]);
    expect(created[0].terminate).not.toHaveBeenCalled();
  });
});
