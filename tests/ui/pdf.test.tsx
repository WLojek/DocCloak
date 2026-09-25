// T216: PDF upload, redact and download in the web app. '@doccloak/core/pdf'
// is mocked (it is loaded lazily by the hook); the fake extraction carries a
// scanned page so the informed-consent notice flow (T177) is exercised for
// PDFs, and the writer's typed failures (PdfVerifyError,
// StalePdfExtractionError) map to translated messages.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, act, cleanup, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { PdfExtraction, RemovedPart } from '@doccloak/core/pdf';
import { PdfVerifyError, StalePdfExtractionError } from '@doccloak/core/pdf';
import { UnsupportedDocumentError } from '@doccloak/core/dom';
import type { UnredactablePart } from '@doccloak/core/dom';
import { UnredactableNotice } from '../../src/ui/components/UnredactableNotice.tsx';
import { TextInput } from '../../src/ui/components/TextInput.tsx';
import { useAnonymizer, fileErrorCode, fileErrorMessage, pdfDownloadName, PDF_MAX_BYTES, PDF_SIZE_LIMIT_LABEL } from '../../src/ui/hooks/useAnonymizer.ts';
import { isPdfFile, pdfAssets } from '../../src/pdf.web.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests } from '../../src/engine.ts';

const mocks = vi.hoisted(() => ({
  readPdf: vi.fn(),
  writeAnonymizedPdfWithReport: vi.fn(),
  readDocx: vi.fn(),
}));

vi.mock('@doccloak/core/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@doccloak/core/pdf')>();
  return {
    ...actual,
    readPdf: (...args: unknown[]) => mocks.readPdf(...args),
    writeAnonymizedPdfWithReport: (...args: unknown[]) => mocks.writeAnonymizedPdfWithReport(...args),
  };
});

vi.mock('@doccloak/core/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@doccloak/core/dom')>();
  return {
    ...actual,
    readDocx: (...args: unknown[]) => mocks.readDocx(...args),
  };
});

const SCANNED: UnredactablePart = { part: 'page 2', kind: 'scanned-page', label: 'scanned page 2 (image only)' };
const UNDECODABLE: UnredactablePart = { part: 'page 4 font F3', kind: 'undecodable-text', label: 'text on page 4 no decoder can read' };
const REMOVED: RemovedPart[] = [
  { kind: 'annotations', label: 'annotations', count: 3 },
  { kind: 'form-fields', label: 'form fields', count: 2 },
  { kind: 'metadata', label: 'document information and XMP metadata' },
];

const ASSETS = {
  pdfjsWorkerUrl: `/pdf/pdf.worker.mjs?v=${__PDFJS_VERSION__}`,
  cMapUrl: '/pdf/cmaps/',
  standardFontDataUrl: '/pdf/standard_fonts/',
  wasmUrl: '/pdf/wasm/',
  fontsUrl: '/pdf/fonts/',
};

function extraction(overrides: Partial<PdfExtraction> = {}): PdfExtraction {
  return {
    plainText: 'Hello Jan Kowalski, welcome.',
    pageCount: 4,
    pages: [],
    runs: [],
    unredactable: [],
    removed: [],
    warnings: [],
    empty: false,
    rasterOnlyPages: [],
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    ...overrides,
  } as unknown as PdfExtraction;
}

function writeResult(overrides: Partial<Awaited<ReturnType<typeof import('@doccloak/core/pdf').writeAnonymizedPdfWithReport>>> = {}) {
  return { blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), warnings: [], removed: [], rasterizedPages: [], shiftedLines: 0, ...overrides };
}

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  mocks.readPdf.mockReset();
  mocks.writeAnonymizedPdfWithReport.mockReset();
  mocks.readDocx.mockReset();
  // No worker in jsdom; the hook must not need one for file handling.
  _setClientFactoryForTests(() => { throw new Error('worker must not be spawned in this test'); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

describe('pdf.web adapter', () => {
  it('routes .pdf by extension and builds same-origin asset URLs from BASE_URL', () => {
    expect(isPdfFile('report.pdf')).toBe(true);
    expect(isPdfFile('REPORT.PDF ')).toBe(true);
    expect(isPdfFile('report.pdf.docx')).toBe(false);
    expect(isPdfFile('report.docx')).toBe(false);
    expect(pdfAssets()).toEqual(ASSETS);
  });

  it('names the download <base>_redacted.pdf', () => {
    expect(pdfDownloadName('Contract v2.PDF')).toBe('Contract v2_redacted.pdf');
    expect(pdfDownloadName(null)).toBe('document_redacted.pdf');
  });

  it('the file input accepts .pdf', () => {
    const { container } = render(
      <Providers><TextInput value="" onChange={() => {}} onClear={() => {}} entities={[]} onLoadFile={vi.fn()} /></Providers>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept.split(',')).toContain('.pdf');
  });
});

describe('useAnonymizer with a PDF', () => {
  it('loads a .pdf through readPdf with the self-hosted assets and reports its parts', async () => {
    mocks.readPdf.mockResolvedValue(extraction({ unredactable: [SCANNED], removed: REMOVED, warnings: ['page 3: form XObject shared by two pages'] }));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });

    let loaded: { success: boolean } | undefined;
    const file = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
    await act(async () => { loaded = await result.current.loadFile(file); });
    expect(loaded?.success).toBe(true);
    expect(mocks.readPdf).toHaveBeenCalledTimes(1);
    expect(mocks.readPdf.mock.calls[0][0]).toBe(file);
    expect(mocks.readPdf.mock.calls[0][1]).toEqual({ assets: ASSETS });
    expect(mocks.readDocx).not.toHaveBeenCalled();

    expect(result.current.inputText).toBe('Hello Jan Kowalski, welcome.');
    expect(result.current.fileName).toBe('report.pdf');
    expect(result.current.pdfFileName).toBe('report.pdf');
    expect(result.current.hasPdfExtraction).toBe(true);
    expect(result.current.hasDocumentExtraction).toBe(true);
    expect(result.current.hasDocxExtraction).toBe(false);
    expect(result.current.hasImage).toBe(false);
    expect(result.current.unredactableItems).toEqual([SCANNED]);
    expect(result.current.fileWarnings).toEqual(['page 3: form XObject shared by two pages']);
    expect(result.current.pdfRemoved).toEqual(REMOVED);
    expect(result.current.unredactablePending).toBe(true);
    expect(result.current.allowUnredactable).toBe(false);
  });

  it('a scanned page blocks export until Continue, then the writer runs with allowUnredactable and the assets', async () => {
    mocks.readPdf.mockResolvedValue(extraction({ unredactable: [SCANNED] }));
    mocks.writeAnonymizedPdfWithReport.mockResolvedValue(writeResult({ warnings: ['scanned page 2 (image only) (exported as is)'] }));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'report.pdf')); });

    // Detection is mocked away: a manual entity over "Jan Kowalski" stands in.
    act(() => { result.current.addManualEntity(6, 18, 'PERSON'); });
    await waitFor(() => expect(result.current.entries.length).toBe(1));

    await expect(result.current.exportPdf()).rejects.toThrow(/not been confirmed/);
    expect(mocks.writeAnonymizedPdfWithReport).not.toHaveBeenCalled();

    act(() => { result.current.continueWithUnredactable(); });
    expect(result.current.allowUnredactable).toBe(true);
    expect(result.current.unredactablePending).toBe(false);

    const blob = await result.current.exportPdf();
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(pdfDownloadName(result.current.fileName)).toBe('report_redacted.pdf');
    expect(mocks.writeAnonymizedPdfWithReport).toHaveBeenCalledTimes(1);
    const [passed, replacements, valueReplacements, options] = mocks.writeAnonymizedPdfWithReport.mock.calls[0];
    expect(passed.plainText).toBe('Hello Jan Kowalski, welcome.');
    expect(replacements).toEqual([{ start: 6, end: 18, replacement: '[PERSON_1]' }]);
    expect(valueReplacements).toEqual([{ value: 'Jan Kowalski', replacement: '[PERSON_1]' }]);
    expect(options).toEqual({ assets: ASSETS, allowUnredactable: true });
    await waitFor(() => expect(result.current.fileWarnings).toContain('scanned page 2 (image only) (exported as is)'));
  });

  it('a clean PDF with no detections can still be exported (allowUnredactable: false, no replacements)', async () => {
    mocks.readPdf.mockResolvedValue(extraction());
    mocks.writeAnonymizedPdfWithReport.mockResolvedValue(writeResult({ removed: REMOVED.slice(2) }));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'clean.pdf')); });
    expect(result.current.unredactablePending).toBe(false);
    expect(result.current.pdfRemoved).toEqual([]);
    await act(async () => { await result.current.exportPdf(); });
    const [, replacements, valueReplacements, options] = mocks.writeAnonymizedPdfWithReport.mock.calls[0];
    expect(replacements).toEqual([]);
    expect(valueReplacements).toEqual([]);
    expect(options).toEqual({ assets: ASSETS, allowUnredactable: false });
    // The writer's own report of dropped parts replaces the reader's.
    expect(result.current.pdfRemoved).toEqual(REMOVED.slice(2));
  });

  it('rasterized pages are reported as a warning line with 1-based page numbers', async () => {
    mocks.readPdf.mockResolvedValue(extraction({ rasterOnlyPages: [2] }));
    mocks.writeAnonymizedPdfWithReport.mockResolvedValue(writeResult({ rasterizedPages: [2, 6], warnings: ['page 3 uses a Type3 font'] }));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'scan.pdf')); });
    await act(async () => { await result.current.exportPdf(); });
    expect(result.current.fileWarnings).toEqual(['page 3 uses a Type3 font', en.pdf.rasterizedPages('3, 7', 2)]);
    expect(en.pdf.rasterizedPages('3, 7', 2)).toContain('3, 7');
  });

  it('PdfVerifyError maps to verify-failed and StalePdfExtractionError to stale-extraction', async () => {
    mocks.readPdf.mockResolvedValue(extraction());
    mocks.writeAnonymizedPdfWithReport
      .mockRejectedValueOnce(new PdfVerifyError([{ pass: 'text', where: 'page 1', value: 'Jan Kowalski' }] as never))
      .mockRejectedValueOnce(new StalePdfExtractionError());
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'report.pdf')); });

    const verify = await result.current.exportPdf().catch((err: unknown) => err);
    expect(verify).toBeInstanceOf(PdfVerifyError);
    expect(fileErrorCode(verify)).toBe('verify-failed');
    expect(fileErrorMessage(en, 'verify-failed')).toBe(en.fileErrors['verify-failed']);
    expect(en.fileErrors['verify-failed']).toMatch(/refused to export/);

    const stale = await result.current.exportPdf().catch((err: unknown) => err);
    expect(stale).toBeInstanceOf(StalePdfExtractionError);
    expect(fileErrorCode(stale)).toBe('stale-extraction');
    expect(fileErrorMessage(en, 'stale-extraction')).toBe(en.fileErrors['stale-extraction']);

    // Matching is by name too, so the check survives a mocked or re-bundled module.
    expect(fileErrorCode(Object.assign(new Error('x'), { name: 'PdfVerifyError' }))).toBe('verify-failed');
    expect(fileErrorCode(new UnsupportedDocumentError('encrypted'))).toBe('encrypted');
    expect(fileErrorCode(new Error('plain'))).toBeNull();
  });

  it('the writer reporting unredactable parts the reader missed re-opens the notice', async () => {
    mocks.readPdf.mockResolvedValue(extraction());
    mocks.writeAnonymizedPdfWithReport.mockRejectedValue(new UnsupportedDocumentError('unredactable-parts', 'x', ['page 9']));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'report.pdf')); });
    let err: unknown;
    await act(async () => { err = await result.current.exportPdf().catch((e: unknown) => e); });
    expect(fileErrorCode(err)).toBe('unredactable-parts');
    expect(result.current.unredactableItems).toEqual([{ part: 'page 9', kind: 'unknown' }]);
    expect(result.current.unredactablePending).toBe(true);
  });

  it.each(['encrypted', 'too-large', 'invalid-package'] as const)('loadFile maps a %s refusal from readPdf to its translated text', async (code) => {
    mocks.readPdf.mockRejectedValue(new UnsupportedDocumentError(code, 'raw core message'));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    let loaded: { success: boolean; code?: string; message?: string; error?: string } | undefined;
    await act(async () => { loaded = await result.current.loadFile(new File(['%PDF'], 'locked.pdf')); });
    expect(loaded).toMatchObject({ success: false, code, message: fileErrorMessage(en, code, 'pdf'), error: 'raw core message' });
    expect(result.current.hasPdfExtraction).toBe(false);
  });

  it('a PDF over the size cap is refused before the PDF chunk is loaded', async () => {
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    const big = new File(['%PDF'], 'big.pdf');
    Object.defineProperty(big, 'size', { value: PDF_MAX_BYTES + 1 });
    let loaded: { success: boolean; code?: string; message?: string } | undefined;
    await act(async () => { loaded = await result.current.loadFile(big); });
    expect(loaded).toMatchObject({ success: false, code: 'too-large', message: fileErrorMessage(en, 'too-large', 'pdf') });
    expect(loaded?.message).toContain(PDF_SIZE_LIMIT_LABEL);
    expect(mocks.readPdf).not.toHaveBeenCalled();
  });

  it('a PDF without readable text is refused with the empty-document code', async () => {
    mocks.readPdf.mockResolvedValue(extraction({ plainText: '', empty: true, unredactable: [SCANNED] }));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    let loaded: { success: boolean; code?: string; message?: string } | undefined;
    await act(async () => { loaded = await result.current.loadFile(new File(['%PDF'], 'scan.pdf')); });
    expect(loaded).toMatchObject({ success: false, code: 'empty-document', message: en.fileErrors['empty-document'] });
    expect(result.current.fileName).toBeNull();
  });

  it('Cancel (removeFile) drops the PDF, its parts and the pending decision', async () => {
    mocks.readPdf.mockResolvedValue(extraction({ unredactable: [SCANNED], removed: REMOVED }));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'report.pdf')); });
    act(() => { result.current.removeFile(); });
    expect(result.current.hasPdfExtraction).toBe(false);
    expect(result.current.hasDocumentExtraction).toBe(false);
    expect(result.current.pdfRemoved).toEqual([]);
    expect(result.current.unredactableItems).toEqual([]);
    expect(result.current.fileName).toBeNull();
    expect(result.current.inputText).toBe('');
    await expect(result.current.exportPdf()).rejects.toThrow(/No PDF/);
  });

  it('loading a .docx after a PDF clears the PDF state (and vice versa)', async () => {
    mocks.readPdf.mockResolvedValue(extraction({ removed: REMOVED }));
    mocks.readDocx.mockResolvedValue({ plainText: 'Docx text', empty: false, unredactable: [], warnings: [] });
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'report.pdf')); });
    await act(async () => { await result.current.loadFile(new File(['x'], 'report.docx')); });
    expect(result.current.hasPdfExtraction).toBe(false);
    expect(result.current.hasDocxExtraction).toBe(true);
    expect(result.current.pdfRemoved).toEqual([]);
    expect(result.current.fileName).toBe('report.docx');
    expect(result.current.inputText).toBe('Docx text');
    await act(async () => { await result.current.loadFile(new File(['%PDF'], 'again.pdf')); });
    expect(result.current.hasDocxExtraction).toBe(false);
    expect(result.current.hasPdfExtraction).toBe(true);
    expect(result.current.fileName).toBe('again.pdf');
  });
});

describe('PDF notice and i18n', () => {
  it('UnredactableNotice labels scanned pages and undecodable text', () => {
    render(<Providers><UnredactableNotice items={[SCANNED, UNDECODABLE]} decided={false} onContinue={() => {}} onCancel={() => {}} /></Providers>);
    expect(screen.getByText(en.unredactable.kinds['scanned-page'])).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.kinds['undecodable-text'])).toBeInTheDocument();
    expect(screen.getByText('page 2')).toBeInTheDocument();
  });

  it('every new key is translated in all 8 languages, mentions PDF where it should, and has no em dashes', () => {
    const EM_DASH = String.fromCharCode(0x2014);
    const REMOVED_KINDS: RemovedPart['kind'][] = [
      'annotations', 'form-fields', 'outlines', 'attachments', 'javascript', 'metadata',
      'structure-tree', 'page-labels', 'named-destinations', 'optional-content', 'signatures',
    ];
    expect(languages).toHaveLength(8);
    for (const lang of languages) {
      const t = lang.translations;
      const strings: string[] = [
        t.textInput.uploadDocx,
        t.textInput.uploadDocxSub,
        t.textInput.unsupportedFormat,
        t.textOutput.downloadPdf,
        t.fileErrors['verify-failed'],
        t.fileErrors['stale-extraction'],
        t.unredactable.kinds['scanned-page'],
        t.unredactable.kinds['undecodable-text'],
        t.pdf.removedTitle,
        t.pdf.removedBody,
        ...REMOVED_KINDS.map((k) => t.pdf.removed[k]),
        t.pdf.rasterizedPages('3, 7', 2),
        t.pdf.rasterizedPages('3', 1),
      ];
      for (const s of strings) {
        expect(typeof s, lang.code).toBe('string');
        expect(s.trim().length, lang.code).toBeGreaterThan(0);
        expect(s.includes(EM_DASH), `${lang.code}: ${s}`).toBe(false);
      }
      expect(t.textInput.uploadDocxSub, lang.code).toContain('.pdf');
      expect(t.textInput.unsupportedFormat, lang.code).toContain('.pdf');
      expect(t.textOutput.downloadPdf, lang.code).toContain('PDF');
      expect(t.fileErrors['verify-failed'].length, lang.code).toBeGreaterThan(20);
      expect(t.fileErrors['stale-extraction'].length, lang.code).toBeGreaterThan(20);
      expect(t.pdf.rasterizedPages('3, 7', 2), lang.code).toContain('3, 7');
      expect(t.pdf.rasterizedPages('3', 1), lang.code).toContain('3');
      expect(new Set(REMOVED_KINDS.map((k) => t.pdf.removed[k])).size, lang.code).toBe(REMOVED_KINDS.length);
    }
  });
});
