// T253 (DocCloak.Core#4): the pages-at-a-time setting. Automatic keeps ocrWorkerCount; a number is
// stored, capped at what this device offers; anything unreadable counts as Automatic.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { OcrWorkersSetting } from '../../src/ui/components/OcrWorkersSetting.tsx';
import {
  OCR_WORKERS_STORAGE_KEY, getOcrWorkerSetting, ocrWorkerChoices, ocrWorkerCount, ocrWorkersInEffect, setOcrWorkerSetting,
} from '../../src/ocr.web.ts';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const computer = { hardwareConcurrency: 14, deviceMemory: 8, userAgent: MAC };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('pages read at a time: the setting', () => {
  it('Automatic by default and for anything unreadable', () => {
    expect(getOcrWorkerSetting()).toBe('auto');
    for (const raw of ['auto', '0', '-3', '2.5', 'many', '']) {
      localStorage.setItem(OCR_WORKERS_STORAGE_KEY, raw);
      expect(getOcrWorkerSetting(), raw).toBe('auto');
    }
    expect(ocrWorkersInEffect(computer)).toBe(ocrWorkerCount(computer));
  });

  it('a number is kept and used, capped at what the device offers', () => {
    setOcrWorkerSetting(8);
    expect(localStorage.getItem(OCR_WORKERS_STORAGE_KEY)).toBe('8');
    expect(ocrWorkersInEffect(computer)).toBe(8);
    expect(ocrWorkersInEffect({ ...computer, hardwareConcurrency: 4 })).toBe(4);
    setOcrWorkerSetting(1);
    expect(ocrWorkersInEffect(computer)).toBe(1);
    setOcrWorkerSetting('auto');
    expect(localStorage.getItem(OCR_WORKERS_STORAGE_KEY)).toBeNull();
  });

  it('offers 1 up to one per core, at least 2 and at most 16', () => {
    expect(ocrWorkerChoices(computer)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(ocrWorkerChoices({ hardwareConcurrency: 1 })).toEqual([1, 2]);
    expect(ocrWorkerChoices({ hardwareConcurrency: 64 }).length).toBe(16);
    expect(ocrWorkerChoices({})).toEqual([1, 2, 3, 4]);
  });

  it('the select shows Automatic with its number and stores a choice', () => {
    render(createElement(LanguageProvider, null, createElement(OcrWorkersSetting)));
    const select = screen.getByLabelText('Scanned pages read at a time') as HTMLSelectElement;
    expect(select.value).toBe('auto');
    expect(select.options[0].textContent).toBe(`Automatic (${ocrWorkerCount()} on this device)`);
    fireEvent.change(select, { target: { value: '3' } });
    expect(localStorage.getItem(OCR_WORKERS_STORAGE_KEY)).toBe('3');
    fireEvent.change(select, { target: { value: 'auto' } });
    expect(localStorage.getItem(OCR_WORKERS_STORAGE_KEY)).toBeNull();
    expect(screen.getByText(/about 0.25 GB per page/)).toBeTruthy();
  });
});
