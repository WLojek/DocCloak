// T284 (WLojek/DocCloak.Core#6) on the page: the pages of a PDF are offered as soon as the file is
// there, leaving a scan out unlocks Redact and Download, the download is the edited file, and a
// refusal of the writer is a sentence with nothing downloaded. The whole App is mounted; Core's
// reader, writer and page pictures are mocked (pdf.js does not run in jsdom), its edits are real.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, EngineClient } from '@doccloak/core';
import type { PdfExtraction } from '@doccloak/core/pdf';
import { PdfVerifyError } from '@doccloak/core/pdf';
import App from '../../src/App.tsx';
import { pdfEditStrings } from '../../src/i18n/features/pdfEdit.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';
import { fakePdf } from './pdf-fixture.ts';

const mocks = vi.hoisted(() => ({
  readPdf: vi.fn(),
  writeAnonymizedPdfWithReport: vi.fn(),
  openPdfPreview: vi.fn(),
}));

vi.mock('@doccloak/core/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@doccloak/core/pdf')>();
  return {
    ...actual,
    readPdf: (...args: unknown[]) => mocks.readPdf(...args),
    writeAnonymizedPdfWithReport: (...args: unknown[]) => mocks.writeAnonymizedPdfWithReport(...args),
    openPdfPreview: (...args: unknown[]) => mocks.openPdfPreview(...args),
  };
});

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const text = pdfEditStrings.en;
// Page 2 is a picture nobody could read: the file waits for a decision.
const PAGES = [['Umowa: Jan Kowalski, Warszawa'], [], ['Podpis: Maria Nowak']];

let createdUrls: Blob[] = [];
let clicks: string[] = [];

function pickPdf(container: HTMLElement) {
  const input = container.querySelector('main input[type="file"]:not([data-testid])') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['%PDF'], 'umowa.pdf', { type: 'application/pdf' })] } });
}

const redactButton = () => screen.getByRole('button', { name: new RegExp(en.redactButton.redact) }) as HTMLButtonElement;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  createdUrls = [];
  clicks = [];
  mocks.readPdf.mockReset();
  mocks.writeAnonymizedPdfWithReport.mockReset();
  mocks.openPdfPreview.mockReset();
  mocks.readPdf.mockResolvedValue(fakePdf(PAGES, { scannedPages: [1] }));
  mocks.openPdfPreview.mockResolvedValue({
    pageCount: 3,
    pageSize: async () => ({ width: 400, height: 300, rotate: 0 }),
    render: async () => ({ widthPx: 96, heightPx: 72, widthPt: 400, heightPt: 300, transform: [0.24, 0, 0, -0.24, 0, 72], canvas: { canvas: document.createElement('canvas') } }),
    close: async () => {},
  });
  mocks.writeAnonymizedPdfWithReport.mockImplementation(async (extraction: PdfExtraction) => ({
    blob: new Blob(['%PDF-1.7 edited'], { type: 'application/pdf' }),
    warnings: [],
    removed: [],
    rasterizedPages: [],
    scanPages: [],
    removedPages: [...(extraction.edits?.removedPages ?? [])],
    regionPages: [],
    shiftedLines: 0,
  }));
  _setClientFactoryForTests(() => ({
    client: {
      preload: () => Promise.resolve(),
      detect: (input: string) => Promise.resolve(['Jan Kowalski', 'Maria Nowak'].flatMap((value): DetectedEntity[] => {
        const start = input.indexOf(value);
        return start < 0 ? [] : [{ type: 'PERSON', value, start, end: start + value.length, confidence: 0.9, detector: 'test' }];
      })),
      switchProvider: () => Promise.resolve(),
      getSettings: () => ({ providerId: 'bardsai', threshold: 0.5, regexEnabled: false, regexRegion: 'all', customLabels: [] }),
      onDownloadProgress: () => () => {},
      onDetectionProgress: () => () => {},
      updateSettings: () => Promise.resolve(),
      release: () => Promise.resolve(),
      close: () => {},
    } as unknown as EngineClient,
    terminate: () => {},
  }));
  // jsdom has none of these; the page uses them.
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  Element.prototype.scrollIntoView = () => {};
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true });
  // A download: the blob that was handed to the browser, and the name of the file.
  URL.createObjectURL = (blob: Blob) => { createdUrls.push(blob); return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { clicks.push(this.download); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

describe('the pages of a PDF on the page', () => {
  it('are offered as soon as the file is there; leaving the scan out unlocks Redact, and the download is the edited file', async () => {
    const { container } = render(<Providers><App /></Providers>);
    await waitFor(() => expect(screen.getByRole('button', { name: en.header.ready })).toBeTruthy());
    expect(screen.queryByTestId('pdf-pages')).toBeNull();

    pickPdf(container);
    // Before Redact: the section is there with its one line, closed, and pdf.js is not opened for it.
    const section = await screen.findByTestId('pdf-pages');
    const toggle = within(section).getByTestId('pdf-pages-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain(text.title);
    expect(toggle.textContent).toContain('3');
    expect(toggle.textContent).toContain(text.hint);
    expect(mocks.openPdfPreview).not.toHaveBeenCalled();
    // It stands above the document, after the card it can make go away.
    const notice = screen.getByTestId('unredactable-notice');
    expect(notice.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.compareDocumentPosition(container.querySelector('main input[type="file"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The scan page locks the file.
    expect(redactButton().disabled).toBe(true);

    // Open the pages and leave the scan out.
    fireEvent.click(toggle);
    const switches = within(section).getAllByTestId('pdf-page-toggle');
    expect(switches).toHaveLength(3);
    fireEvent.click(switches[1]);
    expect(within(section).getByTestId('pdf-pages-summary').textContent).toBe(text.pagesLeftOut(1));
    expect(screen.queryByTestId('unredactable-notice')).toBeNull();
    expect(redactButton().disabled).toBe(false);

    // Redact, then download: the writer gets the extraction with the page left out.
    fireEvent.click(redactButton());
    const download = await screen.findByRole('button', { name: en.textOutput.downloadPdf });
    expect(container.querySelector('main')?.textContent).toContain('Umowa: [PERSON_1], Warszawa');
    fireEvent.click(download);
    await waitFor(() => expect(clicks).toEqual(['umowa_redacted.pdf']));
    expect(createdUrls).toHaveLength(1);
    const written = mocks.writeAnonymizedPdfWithReport.mock.calls[0][0] as PdfExtraction;
    expect(written.edits).toEqual({ removedPages: [1], regions: [] });
    expect(written.plainText).toBe('Umowa: Jan Kowalski, Warszawa\n\nPodpis: Maria Nowak');
    // What was left out is said next to the file.
    await waitFor(() => expect(container.textContent).toContain(text.exportLeftOut('2', 1)));

    // The page comes back: the card and the lock are back with it.
    fireEvent.click(within(screen.getByTestId('pdf-pages')).getAllByTestId('pdf-page-toggle')[1]);
    expect(screen.getByTestId('unredactable-notice')).toBeTruthy();
    expect(redactButton().disabled).toBe(true);
    expect((screen.getByRole('button', { name: en.textOutput.downloadPdf }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a refusal of the writer is said in a sentence and nothing is downloaded', async () => {
    mocks.readPdf.mockResolvedValue(fakePdf([['Umowa: Jan Kowalski'], ['Aneks: Maria Nowak']]));
    const { container } = render(<Providers><App /></Providers>);
    await waitFor(() => expect(screen.getByRole('button', { name: en.header.ready })).toBeTruthy());
    pickPdf(container);
    const section = await screen.findByTestId('pdf-pages');
    fireEvent.click(within(section).getByTestId('pdf-pages-toggle'));
    fireEvent.click(within(section).getAllByTestId('pdf-page-toggle')[1]);
    fireEvent.click(redactButton());
    const download = await screen.findByRole('button', { name: en.textOutput.downloadPdf });

    // The verifier found text of the page left out in the output.
    mocks.writeAnonymizedPdfWithReport.mockRejectedValueOnce(new PdfVerifyError([{ pass: 'removed-page', needle: 'Aneks: Maria Nowak', where: 'text' }]));
    fireEvent.click(download);
    expect(await screen.findByText(en.fileErrors['verify-failed'])).toBeTruthy();
    expect(createdUrls).toHaveLength(0);
    expect(clicks).toEqual([]);
    // The pages can be edited again once the export is over (page 1 stays locked: it is the last one in).
    const switches = () => within(screen.getByTestId('pdf-pages')).getAllByTestId('pdf-page-toggle');
    await waitFor(() => expect(switches()[1].getAttribute('aria-disabled')).toBe('false'));
    expect(switches()[0].getAttribute('aria-disabled')).toBe('true');
  });
});
