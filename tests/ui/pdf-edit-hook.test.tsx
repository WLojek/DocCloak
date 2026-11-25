// T284 (WLojek/DocCloak.Core#6) in the hook: pages of a PDF left out and areas hidden by hand. The
// extraction on the page is replaced by the edited one, and with it the text, what was found in
// it, the parts that cannot be redacted, the notes and what the export writes.
//
// Core's reader and writer are mocked (pdf.js does not run in jsdom). Everything between them is
// Core's own code: applyPdfEdits and mapKeptRange run on an extraction built with real glyph
// geometry (see pdf-fixture.ts), so "the word under the rectangle leaves the text" is Core's doing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, EngineClient, EntityType } from '@doccloak/core';
import type { DocxExtraction } from '@doccloak/core/dom';
import { UnsupportedDocumentError } from '@doccloak/core/dom';
import type { PdfEdits, PdfExtraction } from '@doccloak/core/pdf';
import { PdfVerifyError, StalePdfExtractionError } from '@doccloak/core/pdf';
import type { VerifyFinding } from '@doccloak/core/pdf';
import { useAnonymizer, fileErrorCode, refusalMessage, pdfReadNotes, TranslatedRefusal } from '../../src/ui/hooks/useAnonymizer.ts';
import { pdfEditStrings } from '../../src/i18n/features/pdfEdit.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { en } from '../../src/i18n/translations/en.ts';
import { pl } from '../../src/i18n/translations/pl.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY, DetectionAbortedError } from '../../src/engine.ts';
import { EMPTY_SPOT, fakePdf, rectAround } from './pdf-fixture.ts';

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
  return { ...actual, readDocx: (...args: unknown[]) => mocks.readDocx(...args) };
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const text = pdfEditStrings.en;

// A contract of three pages. Page 2 is the one a user would leave out; the last line of page 3 is
// the signature.
const PAGES = [
  ['Umowa najmu lokalu', 'Wynajmujacy: Jan Kowalski, Warszawa', 'Email: jan@example.com'],
  ['Aneks poufny do umowy', 'Wspolnik: Maria Nowak, Gdansk', 'Kontakt: Piotr Zielony'],
  ['Postanowienia koncowe', 'Najemca: Jan Kowalski, Krakow', 'Podpis: Maria Nowak'],
];
const PAGE_TEXT = PAGES.map((lines) => lines.join('\n'));
const FULL_TEXT = PAGE_TEXT.join('\n\n');
const WITHOUT_PAGE_2 = `${PAGE_TEXT[0]}\n\n${PAGE_TEXT[2]}`;

const KNOWN: Array<[EntityType, string]> = [
  ['PERSON', 'Jan Kowalski'],
  ['PERSON', 'Maria Nowak'],
  ['PERSON', 'Piotr Zielony'],
  ['EMAIL', 'jan@example.com'],
  ['COMPANY', 'Acme Ltd'],
];

function find(source: string): DetectedEntity[] {
  const found: DetectedEntity[] = [];
  for (const [type, value] of KNOWN) {
    for (let at = source.indexOf(value); at !== -1; at = source.indexOf(value, at + value.length)) {
      found.push({ type, value, start: at, end: at + value.length, confidence: 0.9, detector: 'test' });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

interface Run {
  text: string;
  resolve: (entities: DetectedEntity[]) => void;
}
let runs: Run[] = [];
let hold = false;

function fakeFactory() {
  const client = {
    preload: () => Promise.resolve(),
    detect: (input: string, signal: AbortSignal | undefined) =>
      new Promise<DetectedEntity[]>((resolve, reject) => {
        runs.push({ text: input, resolve });
        signal?.addEventListener('abort', () => setTimeout(() => reject(new DetectionAbortedError()), 0), { once: true });
        if (!hold) resolve(find(input));
      }),
    switchProvider: () => Promise.resolve(),
    getSettings: () => ({ providerId: 'bardsai', threshold: 0.5, regexEnabled: false, regexRegion: 'all', customLabels: [] }),
    onDownloadProgress: () => () => {},
    onDetectionProgress: () => () => {},
    updateSettings: () => Promise.resolve(),
    release: () => Promise.resolve(),
    close: () => {},
  } as unknown as EngineClient;
  return { client, terminate: () => {} };
}

/** The text a writer makes of an extraction: every replacement applied at its offsets. */
function written(source: string, replacements: Array<{ start: number; end: number; replacement: string }>): string {
  let out = source;
  for (const item of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, item.start) + item.replacement + out.slice(item.end);
  }
  return out;
}

/** What Core's writer reports for the edits an extraction carries: text pages with areas are written as "scans". */
function writeResult(extraction: PdfExtraction, replacements: Array<{ start: number; end: number; replacement: string }>, more: Record<string, unknown> = {}) {
  const removedPages = [...(extraction.edits?.removedPages ?? [])];
  const regionPages = [...new Set((extraction.edits?.regions ?? []).map((r) => r.page))].filter((p) => !removedPages.includes(p)).sort((a, b) => a - b);
  return {
    blob: new Blob([written(extraction.plainText, replacements)]),
    warnings: regionPages.map((p) => `page ${p + 1}: 1 area hidden by hand, painted black in the picture; the page is exported as an image, with its text (placeholders in place of the values) as an invisible layer`),
    removed: [],
    rasterizedPages: [],
    scanPages: regionPages,
    removedPages,
    regionPages,
    shiftedLines: 0,
    ...more,
  };
}

type Hook = ReturnType<typeof start>;

function start() {
  return renderHook(() => useAnonymizer(), { wrapper: Providers });
}

function pdfFile(name = 'umowa.pdf'): File {
  return new File(['%PDF'], name, { type: 'application/pdf' });
}

/** A hook with the PDF on the page, the model there, nothing analysed yet. */
async function loaded(extraction: PdfExtraction = fakePdf(PAGES)): Promise<Hook> {
  mocks.readPdf.mockResolvedValue(extraction);
  const hook = start();
  await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
  await act(async () => { await hook.result.current.loadFile(pdfFile()); });
  expect(hook.result.current.hasPdfExtraction).toBe(true);
  return hook;
}

async function redact(hook: Hook): Promise<void> {
  const before = runs.length;
  act(() => hook.result.current.anonymize());
  await waitFor(() => {
    expect(runs.length).toBe(before + 1);
    expect(hook.result.current.anonymizing).toBe(false);
  });
}

function apply(hook: Hook, edits: PdfEdits): boolean {
  let applied = false;
  act(() => { applied = hook.result.current.pdfPages!.apply(edits); });
  return applied;
}

const values = (hook: Hook): string[] => hook.result.current.entities.map((entity) => entity.value);
const labels = (hook: Hook): Record<string, string> => Object.fromEntries(hook.result.current.entries.map((entry) => [entry.original, entry.replacement]));
/** Every item sits on its own value in the text on the page. */
function expectInPlace(hook: Hook): void {
  const { inputText, entities } = hook.result.current;
  for (const entity of entities) expect(inputText.slice(entity.start, entity.end)).toBe(entity.value);
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  runs = [];
  hold = false;
  mocks.readPdf.mockReset();
  mocks.writeAnonymizedPdfWithReport.mockReset();
  mocks.readDocx.mockReset();
  mocks.writeAnonymizedPdfWithReport.mockImplementation(async (extraction: PdfExtraction, replacements: Array<{ start: number; end: number; replacement: string }>) => writeResult(extraction, replacements));
  mocks.readDocx.mockImplementation(async () => ({ plainText: 'Letter to Jan Kowalski of Acme Ltd.', empty: false, unredactable: [], warnings: [] } as unknown as DocxExtraction));
  _setClientFactoryForTests(fakeFactory);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

describe('the fixture is a file Core can edit', () => {
  it('reads as the three pages, and the hook shows it as it was read', async () => {
    const hook = await loaded();
    expect(hook.result.current.inputText).toBe(FULL_TEXT);
    const view = hook.result.current.pdfPages!;
    expect(view.extraction.pageCount).toBe(3);
    expect(view.edits).toEqual({});
    expect(view.covered).toEqual([]);
    expect(view.busy).toBe(false);
    // Without a PDF there is no page view.
    const empty = start();
    expect(empty.result.current.pdfPages).toBeNull();
  });
});

describe('edits before the document is analysed', () => {
  it('a page left out leaves the text, and the analysis then runs on what is left', async () => {
    const hook = await loaded();
    expect(apply(hook, { removedPages: [1] })).toBe(true);
    expect(hook.result.current.inputText).toBe(WITHOUT_PAGE_2);
    const view = hook.result.current.pdfPages!;
    expect(view.edits.removedPages).toEqual([1]);
    expect(view.extraction.pages.map((page) => Boolean(page.removed))).toEqual([false, true, false]);
    expect(view.extraction.plainText).toBe(WITHOUT_PAGE_2);
    // Nothing was found yet, so there is nothing to clear and nothing to say.
    expect(hook.result.current.entities).toEqual([]);
    expect(hook.result.current.anonymizedText).toBe('');
    expect(screen.queryByText(text.redactAgain(en.redactButton.redact))).toBeNull();
    expect(screen.queryByText(text.itemsGone(1))).toBeNull();
    expect(runs).toHaveLength(0);

    await redact(hook);
    expect(runs[0].text).toBe(WITHOUT_PAGE_2);
    expect(values(hook)).toEqual(['Jan Kowalski', 'jan@example.com', 'Jan Kowalski', 'Maria Nowak']);
    expect(hook.result.current.anonymizedText).not.toContain('Piotr');
    // And the page comes back before any analysis as easily: the text is the file's again.
    const fresh = await loaded();
    apply(fresh, { removedPages: [1] });
    expect(apply(fresh, {})).toBe(true);
    expect(fresh.result.current.inputText).toBe(FULL_TEXT);
    expect(fresh.result.current.pdfPages!.edits).toEqual({});
    expect(screen.queryByText(text.redactAgain(en.redactButton.redact))).toBeNull();
  });

  it('marks made by hand move with their text, whichever way the edit goes', async () => {
    const hook = await loaded();
    // The landlord's city on page 1 and the tenant's on page 3, marked by hand; nothing analysed.
    const warszawa = FULL_TEXT.indexOf('Warszawa');
    const krakow = FULL_TEXT.indexOf('Krakow');
    act(() => hook.result.current.addManualEntity(warszawa, warszawa + 8, 'ADDRESS'));
    act(() => hook.result.current.addManualEntity(krakow, krakow + 6, 'ADDRESS'));
    expect(values(hook)).toEqual(['Warszawa', 'Krakow']);
    const before = labels(hook);

    apply(hook, { removedPages: [1] });
    expect(values(hook)).toEqual(['Warszawa', 'Krakow']);
    expectInPlace(hook);
    expect(hook.result.current.entities[1].start).toBe(WITHOUT_PAGE_2.indexOf('Krakow'));
    expect(labels(hook)).toEqual(before);
    // Brought back: text is added, but nothing here ever claimed to have read the whole document.
    apply(hook, {});
    expect(values(hook)).toEqual(['Warszawa', 'Krakow']);
    expectInPlace(hook);
    expect(hook.result.current.entities[1].start).toBe(krakow);
    expect(hook.result.current.anonymizedText).toContain(before.Krakow);
    expect(screen.queryByText(text.redactAgain(en.redactButton.redact))).toBeNull();
  });
});

describe('edits after the document was analysed', () => {
  it('a page left out: what stays moves to its place with its choices and labels, what goes is said', async () => {
    const hook = await loaded();
    await redact(hook);
    expect(values(hook)).toEqual(['Jan Kowalski', 'jan@example.com', 'Maria Nowak', 'Piotr Zielony', 'Jan Kowalski', 'Maria Nowak']);
    // Kept readable: the e-mail (before the page) and the signature (after it, the last of the list).
    act(() => hook.result.current.setEntitiesExcluded([1, 5], true));
    expect([...hook.result.current.excludedIndices].sort()).toEqual([1, 5]);
    const before = labels(hook);
    expect(before).toEqual({ 'Jan Kowalski': '[PERSON_1]', 'Maria Nowak': '[PERSON_2]', 'Piotr Zielony': '[PERSON_3]' });

    expect(apply(hook, { removedPages: [1] })).toBe(true);
    expect(hook.result.current.inputText).toBe(WITHOUT_PAGE_2);
    expect(values(hook)).toEqual(['Jan Kowalski', 'jan@example.com', 'Jan Kowalski', 'Maria Nowak']);
    expectInPlace(hook);
    // The same two places are readable, at their new numbers in the list.
    expect([...hook.result.current.excludedIndices].sort()).toEqual([1, 3]);
    expect(hook.result.current.entities[3].start).toBe(WITHOUT_PAGE_2.lastIndexOf('Maria Nowak'));
    // The signature is the only "Maria Nowak" left and it is readable: she is in no label now.
    expect(labels(hook)).toEqual({ 'Jan Kowalski': '[PERSON_1]' });
    expect(hook.result.current.anonymizedText).toBe(WITHOUT_PAGE_2.replaceAll('Jan Kowalski', '[PERSON_1]'));
    // Two items left with the page.
    expect(screen.getByText(text.itemsGone(2))).toBeTruthy();
    expect(screen.queryByText(text.redactAgain(en.redactButton.redact))).toBeNull();
    // The edit ran no detection, and the document still counts as analysed: redacting her again
    // gives her the label she had, and a second press of Redact keeps the choice about the e-mail.
    expect(runs).toHaveLength(1);
    act(() => hook.result.current.setEntitiesExcluded([3], false));
    expect(labels(hook)).toEqual({ 'Jan Kowalski': '[PERSON_1]', 'Maria Nowak': '[PERSON_2]' });
    await redact(hook);
    expect(runs[1].text).toBe(WITHOUT_PAGE_2);
    expect([...hook.result.current.excludedIndices]).toEqual([1]);
    expect(labels(hook)).toEqual({ 'Jan Kowalski': '[PERSON_1]', 'Maria Nowak': '[PERSON_2]' });
  });

  it('an area hidden over a name takes exactly that item; an area over a picture takes none', async () => {
    const extraction = fakePdf(PAGES);
    const hook = await loaded(extraction);
    await redact(hook);
    const listBefore = hook.result.current.entities;
    const outputBefore = hook.result.current.anonymizedText;

    // A signature in a picture: no text is under the rectangle.
    expect(apply(hook, { regions: [{ page: 2, rect: EMPTY_SPOT }] })).toBe(true);
    expect(hook.result.current.pdfPages!.edits.regions).toEqual([{ page: 2, rect: EMPTY_SPOT }]);
    expect(hook.result.current.pdfPages!.covered).toEqual([]);
    expect(hook.result.current.inputText).toBe(FULL_TEXT);
    expect(hook.result.current.entities).toBe(listBefore);
    expect(hook.result.current.anonymizedText).toBe(outputBefore);
    expect(screen.queryByText(text.itemsGone(1))).toBeNull();

    // The handwritten name of the partner on page 2.
    const name = rectAround(extraction, 'Piotr Zielony');
    expect(apply(hook, { regions: [{ page: 2, rect: EMPTY_SPOT }, name] })).toBe(true);
    expect(hook.result.current.inputText).toBe(FULL_TEXT.replace('Kontakt: Piotr Zielony', 'Kontakt: '));
    expect(values(hook)).toEqual(['Jan Kowalski', 'jan@example.com', 'Maria Nowak', 'Jan Kowalski', 'Maria Nowak']);
    expectInPlace(hook);
    expect(labels(hook)).toEqual({ 'Jan Kowalski': '[PERSON_1]', 'Maria Nowak': '[PERSON_2]', 'jan@example.com': '[EMAIL_1]' });
    expect(hook.result.current.anonymizedText).not.toContain('Piotr');
    expect(screen.getByText(text.itemsGone(1))).toBeTruthy();
    // Core says which letters it paints, and the page view gets them.
    const covered = hook.result.current.pdfPages!.covered;
    expect(covered.length).toBeGreaterThan(0);
    expect(covered.every((box) => box.page === 1)).toBe(true);
    expect(Math.min(...covered.map((box) => box.rect.x0))).toBeLessThanOrEqual(name.rect.x0);
    expect(Math.max(...covered.map((box) => box.rect.x1))).toBeGreaterThanOrEqual(name.rect.x1);

    // Half of a name under a rectangle: the item is gone as a whole, the letters outside stay in the text.
    const surname = rectAround(extraction, 'Kowalski');
    apply(hook, { regions: [name, surname] });
    expect(hook.result.current.inputText).toContain('Wynajmujacy: Jan , Warszawa');
    expect(values(hook)).toEqual(['jan@example.com', 'Maria Nowak', 'Jan Kowalski', 'Maria Nowak']);
    expectInPlace(hook);
  });

  it('a page brought back: the result is cleared and the user is asked to redact again', async () => {
    const hook = await loaded();
    apply(hook, { removedPages: [1] });
    await redact(hook);
    act(() => hook.result.current.setEntitiesExcluded([1], true));
    expect(hook.result.current.anonymizedText).not.toBe('');
    expect(hook.result.current.entries.length).toBeGreaterThan(0);

    expect(apply(hook, {})).toBe(true);
    expect(hook.result.current.inputText).toBe(FULL_TEXT);
    expect(hook.result.current.pdfPages!.edits).toEqual({});
    // Page 2 was never analysed: nothing may look finished.
    expect(hook.result.current.entities).toEqual([]);
    expect(hook.result.current.excludedIndices.size).toBe(0);
    expect(hook.result.current.anonymizedText).toBe('');
    expect(hook.result.current.entries).toEqual([]);
    expect(hook.result.current.hasMapping).toBe(false);
    expect(screen.getByText(text.redactAgain(en.redactButton.redact))).toBeTruthy();
    expect(text.redactAgain(en.redactButton.redact)).toContain('Redact Document');
    expect(runs).toHaveLength(1);

    // Redact again: the whole file, and every value has the label it had (they belong to their values).
    await redact(hook);
    expect(runs[1].text).toBe(FULL_TEXT);
    expect(values(hook)).toHaveLength(6);
    expect(labels(hook)['Jan Kowalski']).toBe('[PERSON_1]');
    expect(labels(hook)['Maria Nowak']).toBe('[PERSON_2]');
  });

  it('an area taken away brings its text back the same way', async () => {
    const extraction = fakePdf(PAGES);
    const hook = await loaded(extraction);
    const name = rectAround(extraction, 'Piotr Zielony');
    apply(hook, { regions: [name] });
    await redact(hook);
    expect(values(hook)).not.toContain('Piotr Zielony');
    // One more area: only takes text, the result stays.
    apply(hook, { regions: [name, rectAround(extraction, 'Gdansk')] });
    expect(hook.result.current.anonymizedText).not.toBe('');
    expect(screen.queryByText(text.redactAgain(en.redactButton.redact))).toBeNull();
    // The first area goes: "Piotr Zielony" is in the text again, and no detector has seen it.
    apply(hook, { regions: [rectAround(extraction, 'Gdansk')] });
    expect(hook.result.current.inputText).toContain('Piotr Zielony');
    expect(hook.result.current.anonymizedText).toBe('');
    expect(hook.result.current.entities).toEqual([]);
    expect(screen.getByText(text.redactAgain(en.redactButton.redact))).toBeTruthy();
  });
});

describe('what an edit is refused for', () => {
  it('nothing is edited while the document is analysed', async () => {
    const hook = await loaded();
    hold = true;
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(hook.result.current.pdfPages!.busy).toBe(true);
    expect(apply(hook, { removedPages: [1] })).toBe(false);
    expect(hook.result.current.inputText).toBe(FULL_TEXT);
    expect(hook.result.current.pdfPages!.edits).toEqual({});
    // The answer belongs to the text it was asked for, and that text is still on the page.
    await act(async () => { runs[0].resolve(find(runs[0].text)); });
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(values(hook)).toHaveLength(6);
    expectInPlace(hook);
    expect(hook.result.current.pdfPages!.busy).toBe(false);
    expect(apply(hook, { removedPages: [1] })).toBe(true);
  });

  it('nothing is edited while the file is written', async () => {
    const hook = await loaded();
    await redact(hook);
    let finish: () => void = () => {};
    mocks.writeAnonymizedPdfWithReport.mockImplementationOnce((extraction: PdfExtraction, replacements: Array<{ start: number; end: number; replacement: string }>) =>
      new Promise((resolve) => { finish = () => resolve(writeResult(extraction, replacements)); }));
    let blob: Blob | undefined;
    let exporting: Promise<void> = Promise.resolve();
    act(() => { exporting = hook.result.current.exportPdf().then((made) => { blob = made; }); });
    await waitFor(() => expect(mocks.writeAnonymizedPdfWithReport).toHaveBeenCalledTimes(1));
    expect(hook.result.current.pdfPages!.busy).toBe(true);
    expect(apply(hook, { removedPages: [1] })).toBe(false);
    expect(hook.result.current.inputText).toBe(FULL_TEXT);
    await act(async () => { finish(); await exporting; });
    expect(await readBlob(blob!)).toContain('[PERSON_3]');
    expect(hook.result.current.pdfPages!.busy).toBe(false);
    expect(apply(hook, { removedPages: [1] })).toBe(true);
  });

  it('the last page is never left out, and a set of edits Core refuses changes nothing', async () => {
    const hook = await loaded();
    expect(apply(hook, { removedPages: [0, 1] })).toBe(true);
    expect(apply(hook, { removedPages: [0, 1, 2] })).toBe(false);
    expect(hook.result.current.pdfPages!.edits.removedPages).toEqual([0, 1]);
    expect(hook.result.current.inputText).toBe(PAGE_TEXT[2]);
    // A page the file does not have, a rectangle that is not one: refused, and said.
    expect(apply(hook, { removedPages: [7] })).toBe(false);
    expect(apply(hook, { regions: [{ page: 2, rect: { x0: 1, y0: Number.NaN, x1: 5, y1: 9 } }] })).toBe(false);
    expect(screen.getByText(text.editFailed)).toBeTruthy();
    expect(hook.result.current.pdfPages!.edits.removedPages).toEqual([0, 1]);
    expect(hook.result.current.inputText).toBe(PAGE_TEXT[2]);
  });
});

describe('the download of an edited PDF', () => {
  it('writes the edited extraction with the places of the edited text, and says what was left out and hidden', async () => {
    const extraction = fakePdf(PAGES);
    const hook = await loaded(extraction);
    await redact(hook);
    apply(hook, { removedPages: [1], regions: [rectAround(extraction, 'Maria Nowak', 1)] });
    const onPage = hook.result.current.pdfPages!.extraction;
    expect(onPage.plainText).toBe(hook.result.current.inputText);

    let blob: Blob | undefined;
    await act(async () => { blob = await hook.result.current.exportPdf(); });
    const [written1, replacements] = mocks.writeAnonymizedPdfWithReport.mock.calls[0] as [PdfExtraction, Array<{ start: number; end: number; replacement: string }>];
    // The writer got the extraction that carries the edits, not the file as read.
    expect(written1).toBe(onPage);
    expect(written1.edits).toEqual({ removedPages: [1], regions: [rectAround(extraction, 'Maria Nowak', 1)] });
    expect(written1.unedited).toBe(extraction);
    // Every place is a place of the edited text.
    expect(replacements.map((r) => [onPage.plainText.slice(r.start, r.end), r.replacement])).toEqual([
      ['Jan Kowalski', '[PERSON_1]'], ['jan@example.com', '[EMAIL_1]'], ['Jan Kowalski', '[PERSON_1]'],
    ]);
    const out = await readBlob(blob!);
    expect(out).toBe(`${PAGE_TEXT[0]}\n\nPostanowienia koncowe\nNajemca: Jan Kowalski, Krakow\nPodpis: `.replaceAll('Jan Kowalski', '[PERSON_1]').replace('jan@example.com', '[EMAIL_1]'));
    for (const gone of ['Maria Nowak', 'Piotr Zielony', 'Aneks']) expect(out).not.toContain(gone);

    // The notes: page 2 left out, page 3 a picture for its hidden area. The writer lists page 3
    // with the scans, but it is not one, and its own English note is not shown as an unknown one.
    const notes = hook.result.current.fileWarnings;
    expect(notes).toContain(text.exportLeftOut('2', 1));
    expect(notes).toContain(text.exportAreas('3', 1));
    expect(notes).not.toContain(en.pdf.scanPages('3', 1));
    expect(notes).not.toContain(en.coreNotes.other(1));
    expect(notes).toHaveLength(2);

    // An edit after the download: those notes described a file that is not the next one.
    apply(hook, { removedPages: [1] });
    expect(hook.result.current.fileWarnings).toEqual([]);
  });

  it('keeps real scans and rasterized pages in their own notes, and says when a hidden page lost its text', async () => {
    const extraction = fakePdf(PAGES, { ocrPages: [0] });
    const hook = await loaded(extraction);
    await redact(hook);
    apply(hook, { regions: [{ page: 1, rect: EMPTY_SPOT }, { page: 2, rect: EMPTY_SPOT }] });
    mocks.writeAnonymizedPdfWithReport.mockImplementationOnce(async (written1: PdfExtraction, replacements: Array<{ start: number; end: number; replacement: string }>) =>
      writeResult(written1, replacements, { scanPages: [0, 1], rasterizedPages: [2], warnings: ['page 3: rasterized (unsafe to edit); its text layer is gone', 'page 3: 1 area hidden by hand, painted black in the picture'] }));
    await act(async () => { await hook.result.current.exportPdf(); });
    const notes = hook.result.current.fileWarnings;
    expect(notes).toContain(en.pdf.scanPages('1', 1));
    expect(notes).toContain(text.exportAreas('2', 1));
    expect(notes).toContain(text.exportAreasNoText('3', 1));
    expect(notes).not.toContain(en.pdf.rasterizedPages('3', 1));
    expect(notes.some((note) => note.includes('technical note'))).toBe(false);
  });

  it('is refused when the text on the page and the PDF disagree', async () => {
    const hook = await loaded();
    await redact(hook);
    apply(hook, { removedPages: [1] });
    // The hook is told another text than the PDF holds (the page itself has no way to do this).
    act(() => hook.result.current.handleInputChange('Something typed over the file.'));
    await expect(hook.result.current.exportPdf()).rejects.toThrow('The PDF no longer matches the analysed text');
    expect(mocks.writeAnonymizedPdfWithReport).not.toHaveBeenCalled();
    // The next edit puts the PDF's own text back; what was found in the other text is not carried over.
    act(() => hook.result.current.addManualEntity(10, 15, 'OTHER'));
    expect(apply(hook, {})).toBe(true);
    expect(hook.result.current.inputText).toBe(FULL_TEXT);
    expect(hook.result.current.entities).toEqual([]);
    let blob: Blob | undefined;
    await act(async () => { blob = await hook.result.current.exportPdf(); });
    expect(await readBlob(blob!)).toBe(FULL_TEXT);
  });

  it("every refusal of Core's writer reaches the user as a sentence, and nothing comes out", async () => {
    const extraction = fakePdf(PAGES);
    const hook = await loaded(extraction);
    await redact(hook);
    apply(hook, { removedPages: [1], regions: [{ page: 2, rect: EMPTY_SPOT }] });
    const refuse = async (err: Error): Promise<unknown> => {
      mocks.writeAnonymizedPdfWithReport.mockRejectedValueOnce(err);
      let failure: unknown;
      let blob: Blob | undefined;
      await act(async () => { blob = await hook.result.current.exportPdf().catch((caught: unknown) => { failure = caught; return undefined; }); });
      expect(blob).toBeUndefined();
      return failure;
    };

    // The verifier: the output still holds something of a page left out or shows through a hidden area.
    for (const pass of ['page-count', 'removed-page', 'foreign-stream', 'region-page', 'region-pixels', 'region-text'] as Array<VerifyFinding['pass']>) {
      const failure = await refuse(new PdfVerifyError([{ pass, needle: '', where: 'page 3' }]));
      expect(fileErrorCode(failure), pass).toBe('verify-failed');
      expect(refusalMessage(en, failure), pass).toBe(en.fileErrors['verify-failed']);
      expect(refusalMessage(pl, failure), pass).toBe(pl.fileErrors['verify-failed']);
    }
    // The bytes no longer give the edited text.
    const stale = await refuse(new StalePdfExtractionError());
    expect(refusalMessage(en, stale)).toBe(en.fileErrors['stale-extraction']);

    // A page with a hidden area that cannot be made into a picture: Core calls it a part it cannot
    // redact. There is nothing to consent to, so no card is raised; the user is told what to do.
    const area = await refuse(new UnsupportedDocumentError('unredactable-parts', 'pages 3 hold content a viewer cannot render safely (rasterization refused)', ['page 3']));
    expect(area).toBeInstanceOf(TranslatedRefusal);
    expect(refusalMessage(en, area)).toBe(text.areaRefused('3', 1));
    expect(fileErrorCode(area)).toBeNull();
    expect(hook.result.current.unredactablePending).toBe(false);
    expect(hook.result.current.unredactableItems).toEqual([]);

    // The same refusal for a page without a hidden area is the card's business, as before.
    const other = await refuse(new UnsupportedDocumentError('unredactable-parts', 'x', ['page 1']));
    expect(fileErrorCode(other)).toBe('unredactable-parts');
    expect(refusalMessage(en, other)).toBe(en.fileErrors['unredactable-parts']);
    expect(hook.result.current.unredactablePending).toBe(true);
    await expect(hook.result.current.exportPdf()).rejects.toThrow('Unredactable parts have not been confirmed');
    // An untyped failure has no sentence of its own: the page says "export failed".
    expect(refusalMessage(en, new Error('boom'))).toBeNull();
  });
});

describe('the "cannot be redacted" card and the notes follow the pages', () => {
  it('Redact and Download unlock when the last such page is left out or the user chose Continue, never earlier', async () => {
    // Pages 2 and 3 are pictures nobody could read.
    const scans = [['Umowa: Jan Kowalski'], [], [], ['Podpis: Maria Nowak']];
    const hook = await loaded(fakePdf(scans, { scannedPages: [1, 2] }));
    expect(hook.result.current.unredactableItems.map((item) => item.part)).toEqual(['page 2', 'page 3']);
    expect(hook.result.current.unredactablePending).toBe(true);
    // Locked: no analysis, no file.
    act(() => hook.result.current.anonymize());
    expect(runs).toHaveLength(0);
    await expect(hook.result.current.exportPdf()).rejects.toThrow('Unredactable parts have not been confirmed');

    // Another page left out, then one of the two: still locked.
    apply(hook, { removedPages: [3] });
    expect(hook.result.current.unredactablePending).toBe(true);
    apply(hook, { removedPages: [1] });
    expect(hook.result.current.unredactableItems.map((item) => item.part)).toEqual(['page 3']);
    expect(hook.result.current.unredactablePending).toBe(true);
    act(() => hook.result.current.anonymize());
    expect(runs).toHaveLength(0);

    // Both left out: nothing is left to decide about.
    apply(hook, { removedPages: [1, 2] });
    expect(hook.result.current.unredactableItems).toEqual([]);
    expect(hook.result.current.unredactablePending).toBe(false);
    await redact(hook);
    expect(values(hook)).toEqual(['Jan Kowalski', 'Maria Nowak']);
    let blob: Blob | undefined;
    await act(async () => { blob = await hook.result.current.exportPdf(); });
    expect(await readBlob(blob!)).toBe('Umowa: [PERSON_1]\n\nPodpis: [PERSON_2]');
    expect(mocks.writeAnonymizedPdfWithReport.mock.calls[0][0].unredactable).toEqual([]);

    // One comes back: the card is back, and the lock with it. (No text came back, so the result stays.)
    apply(hook, { removedPages: [1] });
    expect(hook.result.current.unredactableItems.map((item) => item.part)).toEqual(['page 3']);
    expect(hook.result.current.unredactablePending).toBe(true);
    expect(values(hook)).toEqual(['Jan Kowalski', 'Maria Nowak']);
    await expect(hook.result.current.exportPdf()).rejects.toThrow('Unredactable parts have not been confirmed');
  });

  it('Continue holds while pages only go, and is asked again for a page that comes back', async () => {
    const scans = [['Umowa: Jan Kowalski'], [], [], ['Podpis: Maria Nowak']];
    const hook = await loaded(fakePdf(scans, { scannedPages: [1, 2] }));
    // Core names the two pages in one line.
    apply(hook, {});
    act(() => hook.result.current.continueWithUnredactable());
    expect(hook.result.current.unredactablePending).toBe(false);
    // One of them goes: the user already said yes to what is left.
    apply(hook, { removedPages: [2] });
    expect(hook.result.current.unredactableItems.map((item) => item.part)).toEqual(['page 2']);
    expect(hook.result.current.allowUnredactable).toBe(true);
    expect(hook.result.current.unredactablePending).toBe(false);
    // It comes back: that is a part nobody has said yes to in this state.
    apply(hook, {});
    expect(hook.result.current.allowUnredactable).toBe(false);
    expect(hook.result.current.unredactablePending).toBe(true);
  });

  it('a note about a page goes with the page and comes back with it', async () => {
    const extraction = fakePdf(PAGES, { ocrPages: [1], extra: { warnings: ['page 2: contains images; text inside images is not scanned', 'page 3: contains images; text inside images is not scanned'] } });
    const hook = await loaded(extraction);
    expect(hook.result.current.fileWarnings).toEqual([en.pdf.scanPagesFound('2', 1), en.coreNotes.imagesNotScanned('2, 3', 2)]);
    apply(hook, { removedPages: [1] });
    expect(hook.result.current.fileWarnings).toEqual([en.coreNotes.imagesNotScanned('3', 1)]);
    apply(hook, {});
    expect(hook.result.current.fileWarnings).toEqual([en.pdf.scanPagesFound('2', 1), en.coreNotes.imagesNotScanned('2, 3', 2)]);
  });

  it("says in the user's language when a hidden area cannot take a text out", () => {
    const extraction = fakePdf(PAGES, { extra: { warnings: ['page 2: text inside a pattern or a soft mask has no place on the page; a hidden area does not take it out of the text'] } });
    expect(pdfReadNotes(en, extraction, text)).toEqual([text.areaTextStays('2', 1)]);
    expect(pdfReadNotes(pl, extraction, pdfEditStrings.pl)).toEqual([pdfEditStrings.pl.areaTextStays('2', 1)]);
  });
});

describe('a PDF in a set of files', () => {
  async function loadSet(extraction: PdfExtraction): Promise<Hook> {
    mocks.readPdf.mockResolvedValue(extraction);
    const hook = start();
    await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
    await act(async () => { await hook.result.current.loadFiles([new File(['x'], 'letter.docx'), pdfFile('umowa.pdf')]); });
    await waitFor(() => {
      expect(hook.result.current.batch.running).toBe(false);
      expect(hook.result.current.batch.waiting).toBe(0);
      expect(hook.result.current.batch.activeId).not.toBeNull();
    });
    return hook;
  }
  const idOf = (hook: Hook, name: string): string => hook.result.current.batch.files.find((item) => item.name === name)!.id;
  function open(hook: Hook, name: string): boolean {
    let opened = false;
    act(() => { opened = hook.result.current.batch.open(idOf(hook, name)); });
    return opened;
  }
  async function tablePairs(hook: Hook): Promise<Record<string, string>> {
    let table: ReturnType<Hook['result']['current']['exportMapping']> = null;
    act(() => { table = hook.result.current.exportMapping(); });
    const json = await readBlob((table as unknown as { blob: Blob }).blob);
    return Object.fromEntries((JSON.parse(json) as Array<{ original: string; replacement: string }>).map((pair) => [pair.original, pair.replacement]));
  }

  it('an edited PDF comes back as it was left, and the table of the set is made of its edited text', async () => {
    const extraction = fakePdf(PAGES);
    const hook = await loadSet(extraction);
    // The Word file is on the page: no pages to edit.
    expect(hook.result.current.fileName).toBe('letter.docx');
    expect(hook.result.current.pdfPages).toBeNull();
    // Before any edit the table of the set holds every value of the PDF, also the partner of page 2.
    expect(Object.keys(await tablePairs(hook)).sort()).toEqual(['Acme Ltd', 'Jan Kowalski', 'Maria Nowak', 'Piotr Zielony', 'jan@example.com']);

    expect(open(hook, 'umowa.pdf')).toBe(true);
    expect(hook.result.current.pdfPages!.edits).toEqual({});
    expect(values(hook)).toHaveLength(6);
    // Leave page 2 out, hide the city on page 3, keep the e-mail readable.
    const city = rectAround(extraction, 'Krakow');
    apply(hook, { removedPages: [1], regions: [city] });
    act(() => hook.result.current.setEntitiesExcluded([1], true));
    const left = {
      text: hook.result.current.inputText,
      entities: hook.result.current.entities,
      excluded: [...hook.result.current.excludedIndices],
      output: hook.result.current.anonymizedText,
      view: hook.result.current.pdfPages!,
    };
    expect(left.text).toBe(WITHOUT_PAGE_2.replace('Krakow', ''));
    expect(left.view.covered.length).toBeGreaterThan(0);
    expect(left.entities.map((entity) => entity.value)).toEqual(['Jan Kowalski', 'jan@example.com', 'Jan Kowalski', 'Maria Nowak']);

    // Away: the page is the Word file's, and the table of the set no longer holds the partner
    // (his page is left out) nor the e-mail (readable), while the PDF is NOT on the page.
    expect(open(hook, 'letter.docx')).toBe(true);
    expect(hook.result.current.pdfPages).toBeNull();
    expect(hook.result.current.inputText).toBe('Letter to Jan Kowalski of Acme Ltd.');
    const table = await tablePairs(hook);
    expect(Object.keys(table).sort()).toEqual(['Acme Ltd', 'Jan Kowalski', 'Maria Nowak']);
    expect(table['Jan Kowalski']).toBe('[PERSON_1]');
    // A reply about the PDF is restored from that table; the partner's label is not in it.
    expect(hook.result.current.restoreText('[PERSON_2] signed for [PERSON_1]; [PERSON_3] did not.').text).toBe('Maria Nowak signed for Jan Kowalski; [PERSON_3] did not.');

    // And back: edits, text, items, choices and what is painted, all as left.
    expect(open(hook, 'umowa.pdf')).toBe(true);
    const back = hook.result.current;
    expect(back.inputText).toBe(left.text);
    expect(back.pdfPages!.extraction).toBe(left.view.extraction);
    expect(back.pdfPages!.edits).toEqual({ removedPages: [1], regions: [city] });
    expect(back.pdfPages!.covered).toEqual(left.view.covered);
    expect(back.entities).toEqual(left.entities);
    expect([...back.excludedIndices]).toEqual(left.excluded);
    expect(back.anonymizedText).toBe(left.output);
    expectInPlace(hook);

    // The download is this file, edited: the writer gets the edited extraction and its places.
    let blob: Blob | undefined;
    await act(async () => { blob = await hook.result.current.exportPdf(); });
    expect(mocks.writeAnonymizedPdfWithReport.mock.calls[0][0]).toBe(left.view.extraction);
    const out = await readBlob(blob!);
    expect(out).toBe(left.output);
    expect(out).not.toContain('Piotr');
    expect(out).not.toContain('Krakow');
    // It can still be edited further from here: the page comes back, and with it the question to redact again.
    apply(hook, { regions: [city] });
    expect(hook.result.current.inputText).toBe(FULL_TEXT.replace('Krakow', ''));
    expect(hook.result.current.anonymizedText).toBe('');
    // In a set a file that is not analysed is not downloaded.
    await expect(hook.result.current.exportPdf()).rejects.toThrow('This file has not been analysed');
  });

  it('a PDF that waits for a decision is unlocked by leaving its scan out, also in a set', async () => {
    const hook = await loadSet(fakePdf([['Umowa: Jan Kowalski'], [], ['Podpis: Maria Nowak']], { scannedPages: [1] }));
    expect(open(hook, 'umowa.pdf')).toBe(true);
    // The queue read it and left it for the user: nothing was analysed.
    expect(hook.result.current.unredactablePending).toBe(true);
    expect(hook.result.current.entities).toEqual([]);
    apply(hook, { removedPages: [1] });
    expect(hook.result.current.unredactablePending).toBe(false);
    await redact(hook);
    expect(runs[runs.length - 1].text).toBe('Umowa: Jan Kowalski\n\nPodpis: Maria Nowak');
    // Away and back: the decision that is no longer needed stays not needed.
    open(hook, 'letter.docx');
    open(hook, 'umowa.pdf');
    expect(hook.result.current.unredactablePending).toBe(false);
    expect(hook.result.current.pdfPages!.edits.removedPages).toEqual([1]);
    expect(values(hook)).toEqual(['Jan Kowalski', 'Maria Nowak']);
  });
});

describe('Clear and its Undo', () => {
  it('Undo brings back the text and the list as they were on the page, not the PDF', async () => {
    const extraction = fakePdf(PAGES);
    const hook = await loaded(extraction);
    await redact(hook);
    apply(hook, { removedPages: [1], regions: [rectAround(extraction, 'Krakow')] });
    const edited = hook.result.current.inputText;
    const list = hook.result.current.entities;
    let snapshot: ReturnType<typeof hook.result.current.snapshotText> | undefined;
    act(() => { snapshot = hook.result.current.snapshotText(); hook.result.current.clear(); });
    // Clear takes the file with its pages and edits.
    expect(hook.result.current.pdfPages).toBeNull();
    expect(hook.result.current.hasPdfExtraction).toBe(false);
    expect(hook.result.current.inputText).toBe('');

    act(() => hook.result.current.restoreSnapshot(snapshot!));
    // What comes back is the EDITED text with its list, as plain text: the file is gone, as a
    // Word file is after Clear, so there are no pages to edit and no PDF to download.
    expect(hook.result.current.inputText).toBe(edited);
    expect(hook.result.current.entities).toEqual(list);
    expectInPlace(hook);
    expect(hook.result.current.anonymizedText).not.toContain('Piotr');
    expect(hook.result.current.pdfPages).toBeNull();
    expect(hook.result.current.hasPdfExtraction).toBe(false);
    await expect(hook.result.current.exportPdf()).rejects.toThrow('No PDF to export');
    expect(mocks.writeAnonymizedPdfWithReport).not.toHaveBeenCalled();
  });

  it('removing the file takes its edits; the same file loaded again is the file as read', async () => {
    const extraction = fakePdf(PAGES);
    const hook = await loaded(extraction);
    apply(hook, { removedPages: [1] });
    act(() => hook.result.current.removeFile());
    expect(hook.result.current.pdfPages).toBeNull();
    await act(async () => { await hook.result.current.loadFile(pdfFile()); });
    expect(hook.result.current.inputText).toBe(FULL_TEXT);
    expect(hook.result.current.pdfPages!.edits).toEqual({});
    expect(hook.result.current.pdfPages!.extraction).toBe(extraction);
  });
});
