// @vitest-environment node
/**
 * How many PDF pages the web app's OCR reads at the same time (T248, DocCloak.Core#4): one core is
 * left for the page, at most OCR_MAX_WORKERS (6) with 8 GB of memory or more, four when the memory
 * is not known, two on phones, tablets and devices with 4 GB or less, and always at least one.
 */
import { describe, it, expect } from 'vitest';
import { OCR_MAX_WORKERS, ocrWorkerCount } from '../../src/ocr.web.ts';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

describe('ocrWorkerCount', () => {
  it('a computer: one worker per core but one, up to the cap its memory allows', () => {
    expect(ocrWorkerCount({ hardwareConcurrency: 4, userAgent: WINDOWS, deviceMemory: 8 })).toBe(3);
    expect(ocrWorkerCount({ hardwareConcurrency: 14, userAgent: MAC, deviceMemory: 8 })).toBe(OCR_MAX_WORKERS);
    expect(ocrWorkerCount({ hardwareConcurrency: 64, userAgent: WINDOWS, deviceMemory: 32 })).toBe(OCR_MAX_WORKERS);
    expect(OCR_MAX_WORKERS).toBe(6);
    // Firefox and Safari do not report memory.
    expect(ocrWorkerCount({ hardwareConcurrency: 14, userAgent: MAC })).toBe(4);
    expect(ocrWorkerCount({ hardwareConcurrency: 16, userAgent: WINDOWS, deviceMemory: 6 })).toBe(4);
  });

  it('phones, tablets and devices with little memory: two at most', () => {
    expect(ocrWorkerCount({ hardwareConcurrency: 6, userAgent: IPHONE })).toBe(2);
    expect(ocrWorkerCount({ hardwareConcurrency: 8, userAgent: ANDROID, userAgentData: { mobile: true } })).toBe(2);
    // iPadOS reports a Mac with a touch screen.
    expect(ocrWorkerCount({ hardwareConcurrency: 8, userAgent: MAC, maxTouchPoints: 5 })).toBe(2);
    expect(ocrWorkerCount({ hardwareConcurrency: 8, userAgent: WINDOWS, deviceMemory: 4 })).toBe(2);
  });

  it('at least one worker', () => {
    expect(ocrWorkerCount({ hardwareConcurrency: 1, userAgent: WINDOWS })).toBe(1);
    expect(ocrWorkerCount({ hardwareConcurrency: 2, userAgent: IPHONE })).toBe(1);
    expect(ocrWorkerCount({ userAgent: WINDOWS })).toBe(1);
  });
});
