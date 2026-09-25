// T222: the remaining-time estimate is a rate over a sliding window of
// progress samples, ignoring the oldest sample (the providers' preparation
// jump), with a plain-language formatter.
import { describe, it, expect } from 'vitest';
import {
  appendEtaSample,
  etaSeconds,
  formatEta,
  ETA_MIN_SAMPLES,
  ETA_WINDOW_MS,
  type EtaSample,
} from '../../src/lib/detection-eta.ts';

const labels = {
  hours: (n: number) => `${n} h`,
  minutes: (n: number) => `${n} min`,
  seconds: (n: number) => `${n} s`,
};

function run(points: Array<[number, number]>): EtaSample[] {
  let s: EtaSample[] = [];
  for (const [progress, at] of points) s = appendEtaSample(s, progress, at);
  return s;
}

describe('etaSeconds', () => {
  it('needs three samples and a measurable span', () => {
    expect(etaSeconds(run([[0, 0]]))).toBeNull();
    expect(etaSeconds(run([[0, 0], [0.1, 500]]))).toBeNull();
    expect(etaSeconds(run([[0, 0], [0.1, 500], [0.2, 1_500]]))).toBeNull(); // 1 s span from sample 2
  });

  it('measures the rate from the first sample past the oldest: the preparation jump does not count', () => {
    // bardsai: 0 -> 0.1 at once (tokenising), then 0.1 progress per 10 s.
    const s = run([[0, 0], [0.1, 100], [0.2, 10_100], [0.3, 20_100]]);
    // 0.2 gained over 20 s from the 0.1 sample; 0.7 left -> 70 s.
    expect(etaSeconds(s)).toBeCloseTo(70, 5);
    // As seen in the browser: the hook's own 0, the provider's 0, 0.1 twice
    // (tokenised, "tokenisation done"), then chunks of 0.005 per second.
    const real = run([[0, 0], [0, 50], [0.1, 1_500], [0.1, 1_500], [0.105, 2_500], [0.11, 3_500], [0.115, 4_500]]);
    // 0.015 over 3 s from the first 0.1; 0.885 left -> 177 s (not 25 s).
    expect(etaSeconds(real)).toBeCloseTo(177, 5);
    // Nothing past the oldest sample yet: no estimate.
    expect(etaSeconds(run([[0, 0], [0, 50], [0, 3_000]]))).toBeNull();
  });

  it('is null once the run finished or when progress stalls', () => {
    expect(etaSeconds(run([[0, 0], [0.5, 1_000], [1, 5_000]]))).toBeNull();
    expect(etaSeconds(run([[0, 0], [0.1, 1_000], [0.1, 5_000]]))).toBeNull();
  });

  it('a new run (progress going backwards) resets the window', () => {
    const s = run([[0, 0], [0.5, 1_000], [0.9, 3_000], [0, 4_000], [0.1, 5_000]]);
    expect(s).toEqual([{ progress: 0, at: 4_000 }, { progress: 0.1, at: 5_000 }]);
    expect(etaSeconds(s)).toBeNull();
  });

  it('old samples fall out of the window but the newest few are always kept', () => {
    const s = run([[0, 0], [0.1, 1_000], [0.2, 2_000], [0.3, ETA_WINDOW_MS + 2_500]]);
    expect(s.map((x) => x.progress)).toEqual([0.1, 0.2, 0.3]);
    expect(s.length).toBe(ETA_MIN_SAMPLES);
    // Slow chunks (a phone): three samples a minute apart still give a rate.
    const slow = run([[0, 0], [0.01, 60_000], [0.02, 120_000], [0.03, 180_000]]);
    expect(etaSeconds(slow)).toBeCloseTo(0.97 / (0.02 / 120), 3);
  });
});

describe('formatEta', () => {
  it('rounds seconds up to 5 s, minutes up, and shows hours with minutes', () => {
    expect(formatEta(2, labels)).toBe('5 s');
    expect(formatEta(12, labels)).toBe('15 s');
    expect(formatEta(59.9, labels)).toBe('60 s');
    expect(formatEta(61, labels)).toBe('2 min');
    expect(formatEta(20 * 60, labels)).toBe('20 min');
    expect(formatEta(3_600, labels)).toBe('1 h');
    expect(formatEta(3_600 + 30 * 60 + 1, labels)).toBe('1 h 31 min');
  });
});
