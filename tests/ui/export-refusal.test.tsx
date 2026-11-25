// T288: a refused PDF export names the values the writer's own check found again, and says what
// to do. (The French judgment of WLojek/DocCloak.Core#1 was refused with "found a trace of the
// original data" and nothing else: nobody could tell that "ris" and "MO-" were the reason.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { PdfExtraction } from '@doccloak/core/pdf';
import { PdfVerifyError } from '@doccloak/core/pdf';
import type { EngineClient } from '@doccloak/core';
import { useAnonymizer, refusalMessage } from '../../src/ui/hooks/useAnonymizer.ts';
import { quotedValues, traceValues } from '../../src/ui/exportRefusal.ts';
import { exportRefusalStrings } from '../../src/i18n/features/exportRefusal.ts';
import type { FeatureLanguage } from '../../src/i18n/features/index.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';

const mocks = vi.hoisted(() => ({ readPdf: vi.fn(), writeAnonymizedPdfWithReport: vi.fn() }));

vi.mock('@doccloak/core/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@doccloak/core/pdf')>();
  return {
    ...actual,
    readPdf: (...args: unknown[]) => mocks.readPdf(...args),
    writeAnonymizedPdfWithReport: (...args: unknown[]) => mocks.writeAnonymizedPdfWithReport(...args),
  };
});

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const TEXT = 'Le tribunal de Paris a jugé MONETA.';

function extraction(): PdfExtraction {
  return {
    plainText: TEXT,
    pageCount: 1,
    pages: [{ index: 0, width: 595, height: 842, rotate: 0, hasImages: false, imageOnly: false, ocrText: false, textStart: 0, textEnd: TEXT.length }],
    runs: [], unredactable: [], removed: [], warnings: [], empty: false, rasterOnlyPages: [], bytes: new Uint8Array([37, 80, 68, 70]),
  };
}

const found = (pass: string, needle: string, where = 'text') => ({ pass, needle, where });

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  mocks.readPdf.mockReset();
  mocks.writeAnonymizedPdfWithReport.mockReset();
  _setClientFactoryForTests(() => ({
    client: {
      preload: () => Promise.resolve(),
      detect: () => Promise.resolve([{ type: 'COMPANY', value: 'MONETA', start: TEXT.indexOf('MONETA'), end: TEXT.indexOf('MONETA') + 6, confidence: 0.9, detector: 'test' }]),
      switchProvider: () => Promise.resolve(),
      getSettings: () => ({ providerId: 'bardsai', threshold: 0.5, regexEnabled: false, regexRegion: 'all', customLabels: [] }),
      onDownloadProgress: () => () => {},
      onDetectionProgress: () => () => {},
      updateSettings: () => Promise.resolve(),
      release: () => Promise.resolve(),
      close: () => {},
    } as unknown as EngineClient,
    terminate: vi.fn(),
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

describe('what a refused export found', () => {
  it('takes the values of the checks that look for a value, each once, and nothing else', () => {
    const err = new PdfVerifyError([
      found('own-extractor', 'ris'),
      found('string-bytes', 'MO-', 'obj 72 name'),
      found('oracle', 'ris'),
      found('stream-bytes', 'Jan\n  Kowalski'),
      found('code-sequence', '<0041>'),
      found('region-pixels', 'page 1'),
      found('page-count', '3'),
    ] as never);
    expect(traceValues(err)).toEqual(['ris', 'MO-', 'Jan Kowalski']);
    expect(quotedValues(['ris', 'MO-'])).toBe('"ris", "MO-"');
  });

  it('names at most five values and shortens a long one', () => {
    const many = new PdfVerifyError(['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'].map((n) => found('own-extractor', n)) as never);
    expect(traceValues(many)).toEqual(['a1', 'b2', 'c3', 'd4', 'e5']);
    const long = new PdfVerifyError([found('own-extractor', 'x'.repeat(90))] as never);
    expect(traceValues(long)[0]).toHaveLength(40);
    expect(traceValues(long)[0].endsWith('...')).toBe(true);
  });

  it('is empty for any other failure, also for a check that names no value', () => {
    expect(traceValues(new Error('plain'))).toEqual([]);
    expect(traceValues(null)).toEqual([]);
    expect(traceValues(Object.assign(new Error('x'), { name: 'PdfVerifyError' }))).toEqual([]);
    expect(traceValues(new PdfVerifyError([{ pass: 'text', where: 'page 1', value: 'Jan Kowalski' }] as never))).toEqual([]);
    expect(traceValues(new PdfVerifyError([found('region-text', 'page 2')] as never))).toEqual([]);
  });

  it('the message is the refusal, then the values and the way out', () => {
    const err = new PdfVerifyError([found('own-extractor', 'ris'), found('string-bytes', 'MO-', 'obj 72 name')] as never);
    const message = refusalMessage(en, err, 'pdf', exportRefusalStrings.en);
    expect(message?.startsWith(en.fileErrors['verify-failed'])).toBe(true);
    expect(message).toContain('"ris", "MO-"');
    expect(message).toMatch(/Untick these values/);
    // One value: singular wording.
    const one = refusalMessage(en, new PdfVerifyError([found('own-extractor', 'ris')] as never), 'pdf', exportRefusalStrings.en);
    expect(one).toMatch(/Untick this value/);
    // Without the strings, and for a refusal that found no value, the message is the old one.
    expect(refusalMessage(en, err)).toBe(en.fileErrors['verify-failed']);
    expect(refusalMessage(en, new PdfVerifyError([found('page-count', '3')] as never), 'pdf', exportRefusalStrings.en)).toBe(en.fileErrors['verify-failed']);
  });

  it('every language says it, with the values in place and no em dash', () => {
    for (const { code } of languages) {
      const s = exportRefusalStrings[code as FeatureLanguage];
      for (const count of [1, 2]) {
        const text = s.traceValues('"ris", "MO-"', count);
        expect(text, code).toContain('"ris", "MO-"');
        expect(text.length, code).toBeGreaterThan(80);
        expect(text, code).not.toContain('\u2014');
      }
      expect(s.traceValues('"x"', 1)).not.toBe(s.traceValues('"x"', 2));
    }
  });
});

describe('a refused PDF export in the app', () => {
  it('leaves a note on the page that names the values, and downloads nothing', async () => {
    mocks.readPdf.mockResolvedValue(extraction());
    const refusal = new PdfVerifyError([found('own-extractor', 'ris'), found('string-bytes', 'MO-', 'obj 72 name')] as never);
    mocks.writeAnonymizedPdfWithReport.mockRejectedValue(refusal);
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'jugement.pdf')); });
    await act(async () => { result.current.anonymize(); });
    await act(async () => { await Promise.resolve(); });
    let err: unknown;
    await act(async () => { err = await result.current.exportPdf().catch((e: unknown) => e); });
    // The error is the writer's own: the code and the old message still hold.
    expect(err).toBe(refusal);
    const note = exportRefusalStrings.en.traceValues('"ris", "MO-"', 2);
    expect(result.current.fileWarnings).toContain(note);
    // A second refusal with the same values does not repeat the note.
    await act(async () => { await result.current.exportPdf().catch(() => {}); });
    expect(result.current.fileWarnings.filter((w) => w === note)).toHaveLength(1);
  });

  it('a refusal that names no value leaves no note', async () => {
    mocks.readPdf.mockResolvedValue(extraction());
    mocks.writeAnonymizedPdfWithReport.mockRejectedValue(new PdfVerifyError([found('page-count', '3')] as never));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'jugement.pdf')); });
    await act(async () => { result.current.anonymize(); });
    await act(async () => { await Promise.resolve(); });
    const before = result.current.fileWarnings;
    await act(async () => { await result.current.exportPdf().catch(() => {}); });
    expect(result.current.fileWarnings).toEqual(before);
  });
});
