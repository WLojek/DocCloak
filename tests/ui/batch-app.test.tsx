// WLojek/DocCloak#6 on the page: the list of the set, the line in the progress view and the tab
// title that say which file is running, and the single-file page that stays as it was.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, EngineClient } from '@doccloak/core';
import type { DocxExtraction } from '@doccloak/core/dom';
import App from '../../src/App.tsx';
import { FileQueue } from '../../src/ui/components/FileQueue.tsx';
import { TextInput } from '../../src/ui/components/TextInput.tsx';
import type { BatchFileView } from '../../src/ui/batch.ts';
import { batchStrings, type BatchStrings } from '../../src/i18n/features/batch.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY, DetectionAbortedError } from '../../src/engine.ts';

const mocks = vi.hoisted(() => ({ readDocx: vi.fn() }));

vi.mock('@doccloak/core/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@doccloak/core/dom')>();
  return { ...actual, readDocx: (...args: unknown[]) => mocks.readDocx(...args) };
});

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const text = batchStrings.en;

interface Run {
  text: string;
  onProgress: (progress: number) => void;
  resolve: (entities: DetectedEntity[]) => void;
}
let runs: Run[] = [];

function person(source: string, value: string): DetectedEntity[] {
  const start = source.indexOf(value);
  return start < 0 ? [] : [{ type: 'PERSON', value, start, end: start + value.length, confidence: 0.9, detector: 'test' }];
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  runs = [];
  document.title = 'DocCloak - test';
  mocks.readDocx.mockReset();
  mocks.readDocx.mockImplementation(async (source: File) => ({
    plainText: `Letter of ${source.name.replace('.docx', '')} to Jan Kowalski.`,
    empty: false,
    unredactable: [],
    warnings: [],
  } as unknown as DocxExtraction));
  _setClientFactoryForTests(() => ({
    client: {
      preload: () => Promise.resolve(),
      detect: (input: string, signal: AbortSignal | undefined, onProgress: (progress: number) => void) =>
        new Promise<DetectedEntity[]>((resolve, reject) => {
          runs.push({ text: input, onProgress, resolve });
          signal?.addEventListener('abort', () => setTimeout(() => reject(new DetectionAbortedError()), 0), { once: true });
        }),
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

function pick(container: HTMLElement, names: string[]) {
  const input = container.querySelector('main input[type="file"]:not([data-testid])') as HTMLInputElement;
  expect(input.multiple).toBe(true);
  fireEvent.change(input, { target: { files: names.map((name) => new File(['x'], name)) } });
}

describe('a set of files on the page', () => {
  it('shows which file is running in the progress view and in the tab title, then the list', async () => {
    const { container } = render(<Providers><App /></Providers>);
    await waitFor(() => expect(screen.getByRole('button', { name: en.header.ready })).toBeTruthy());
    expect(screen.queryByTestId('file-queue')).toBeNull();

    pick(container, ['one.docx', 'two.docx', 'three.docx']);
    await waitFor(() => expect(runs).toHaveLength(1));
    // The progress view names the file; the title says which of how many, with the percent.
    expect(screen.getByTestId('queue-file').textContent).toBe(text.fileOf(1, 3, 'one.docx'));
    expect(document.title).toBe('1/3 · 0% · DocCloak');
    act(() => runs[0].onProgress(0.42));
    expect(document.title).toBe('1/3 · 42% · DocCloak');
    const rows = () => screen.getAllByTestId('file-queue-row');
    expect(rows().map((row) => row.dataset.status)).toEqual(['analysing', 'waiting', 'waiting']);
    expect(screen.getByTestId('file-queue-summary').textContent).toBe(text.summary(0, 3));

    act(() => runs[0].resolve(person(runs[0].text, 'Jan Kowalski')));
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(screen.getByTestId('queue-file').textContent).toBe(text.fileOf(2, 3, 'two.docx'));
    expect(document.title).toBe('2/3 · 0% · DocCloak');
    act(() => runs[1].resolve(person(runs[1].text, 'Jan Kowalski')));
    await waitFor(() => expect(runs).toHaveLength(3));
    act(() => runs[2].resolve(person(runs[2].text, 'Jan Kowalski')));

    // Done: the progress view is gone, the title is the page's own again, the first file is open.
    await waitFor(() => expect(screen.queryByTestId('queue-file')).toBeNull());
    expect(document.title).toBe('DocCloak - test');
    expect(rows().map((row) => row.dataset.status)).toEqual(['opened', 'ready', 'ready']);
    expect(screen.getByTestId('file-queue-summary').textContent).toBe(text.summary(3, 3));
    const current = container.querySelectorAll('[data-testid="file-queue"] [aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain('one.docx');
    expect(within(rows()[1]).getByText(new RegExp(text.found(1)))).toBeTruthy();

    // A click opens another file: the whole page is that file.
    fireEvent.click(within(rows()[1]).getByRole('button', { name: /^two\.docx/ }));
    expect(rows().map((row) => row.dataset.status)).toEqual(['opened', 'opened', 'ready']);
    expect(container.querySelector('[data-testid="file-queue"] [aria-current="true"]')?.textContent).toContain('two.docx');
    expect(container.querySelector('main')?.textContent).toContain('Letter of two to [PERSON_1].');
    // No "download all": each file is downloaded from its own view.
    expect(screen.getAllByRole('button', { name: en.textOutput.downloadDocx })).toHaveLength(1);

    // Removing the open file brings the next one on the page.
    fireEvent.click(screen.getByRole('button', { name: text.remove('two.docx') }));
    expect(rows().map((row) => row.dataset.status)).toEqual(['opened', 'opened']);
    expect(container.querySelector('[data-testid="file-queue"] [aria-current="true"]')?.textContent).toContain('three.docx');
    // "Remove all" ends the set: the list goes, the page takes text again.
    fireEvent.click(screen.getByRole('button', { name: text.clearSet }));
    expect(screen.queryByTestId('file-queue')).toBeNull();
    expect(container.querySelector('main textarea')).toBeTruthy();
  });

  it('Cancel in the progress view stops the queue; the list offers to continue', async () => {
    const { container } = render(<Providers><App /></Providers>);
    await waitFor(() => expect(screen.getByRole('button', { name: en.header.ready })).toBeTruthy());
    pick(container, ['one.docx', 'two.docx']);
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => runs[0].resolve(person(runs[0].text, 'Jan Kowalski')));
    await waitFor(() => expect(runs).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: en.anonymizing.cancel }));
    await waitFor(() => expect(screen.getByTestId('file-queue-paused')).toBeTruthy());
    expect(screen.getByTestId('file-queue-paused').textContent).toContain(text.stopped(1));
    expect(screen.queryByTestId('queue-file')).toBeNull();
    expect(document.title).toBe('DocCloak - test');
    expect(screen.getAllByTestId('file-queue-row').map((row) => row.dataset.status)).toEqual(['opened', 'waiting']);

    fireEvent.click(screen.getByRole('button', { name: text.resume }));
    await waitFor(() => expect(runs).toHaveLength(3));
    expect(screen.getByTestId('queue-file').textContent).toBe(text.fileOf(2, 2, 'two.docx'));
    act(() => runs[2].resolve([]));
    await waitFor(() => expect(screen.getAllByTestId('file-queue-row').map((row) => row.dataset.status)).toEqual(['opened', 'ready']));
    expect(screen.queryByTestId('file-queue-paused')).toBeNull();
  });

  it('one file leaves the page as it was: no list, the title with the percent alone', async () => {
    const { container } = render(<Providers><App /></Providers>);
    await waitFor(() => expect(screen.getByRole('button', { name: en.header.ready })).toBeTruthy());
    pick(container, ['one.docx']);
    await waitFor(() => expect(container.querySelector('main')?.textContent).toContain('Letter of one to Jan Kowalski.'));
    expect(screen.queryByTestId('file-queue')).toBeNull();
    expect(runs).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(en.redactButton.redact) }));
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(screen.queryByTestId('queue-file')).toBeNull();
    act(() => runs[0].onProgress(0.42));
    expect(document.title).toBe('42% · DocCloak');
    act(() => runs[0].resolve(person(runs[0].text, 'Jan Kowalski')));
    await waitFor(() => expect(container.querySelector('main')?.textContent).toContain('Letter of one to [PERSON_1].'));
    expect(document.title).toBe('DocCloak - test');
    expect(screen.queryByTestId('file-queue')).toBeNull();
  });
});

describe('FileQueue', () => {
  const view = (patch: Partial<BatchFileView>): BatchFileView => ({ id: 'a', name: 'a.docx', status: 'ready', found: 4, open: false, canOpen: true, takenOut: false, ...patch });
  const FILES: BatchFileView[] = [
    view({ id: 'a', name: 'a.docx', status: 'opened', open: true }),
    view({ id: 'b', name: 'b.docx', status: 'ready', found: 1 }),
    view({ id: 'c', name: 'c.docx', status: 'needs-decision', found: null }),
    view({ id: 'd', name: 'd.docx', status: 'failed', found: null, canOpen: false, reason: 'This file is protected with a password.' }),
    view({ id: 'e', name: 'e.docx', status: 'waiting', found: null, canOpen: false }),
    view({ id: 'f', name: 'f.docx', status: 'downloaded', found: 0, takenOut: true }),
  ];
  const handlers = () => ({ onOpen: vi.fn(), onRemove: vi.fn(), onAddFiles: vi.fn(), onResume: vi.fn(), onClear: vi.fn() });

  it('lists every file with its status, marks the open one and opens a file on a click', () => {
    const on = handlers();
    render(<Providers><FileQueue files={FILES} busy={false} paused={false} waiting={1} waitingForModel={false} maxFiles={25} {...on} /></Providers>);
    const rows = screen.getAllByTestId('file-queue-row');
    expect(rows.map((row) => within(row).getByTestId('file-queue-status').textContent)).toEqual([
      `${text.status.opened} · ${text.found(4)}`,
      `${text.status.ready} · ${text.found(1)}`,
      text.status['needs-decision'],
      text.status.failed,
      text.status.waiting,
      `${text.status.downloaded} · ${text.found(0)}`,
    ]);
    // The line that is read out when the queue moves on.
    expect(screen.getByTestId('file-queue-summary').getAttribute('role')).toBe('status');
    expect(screen.getByTestId('file-queue-summary').textContent).toBe(text.summary(3, 6));
    // The open file is the current one; a file that was not read is text, not a button.
    expect(within(rows[0]).getByRole('button', { name: /^a\.docx/ }).getAttribute('aria-current')).toBe('true');
    expect(within(rows[1]).getByRole('button', { name: /^b\.docx/ }).getAttribute('aria-current')).toBeNull();
    expect(within(rows[3]).queryByRole('button', { name: /^d\.docx/ })).toBeNull();
    expect(rows[3].textContent).toContain('This file is protected with a password.');
    expect(rows[2].textContent).toContain(text.decisionHint(en.redactButton.redact));
    fireEvent.click(within(rows[1]).getByRole('button', { name: /^b\.docx/ }));
    expect(on.onOpen).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: text.remove('d.docx') }));
    expect(on.onRemove).toHaveBeenCalledWith('d');
    fireEvent.click(screen.getByRole('button', { name: text.clearSet }));
    expect(on.onClear).toHaveBeenCalledTimes(1);
    // Every row and control is a touch target on a phone (44 px) and compact on a desktop.
    for (const control of screen.getAllByRole('button')) {
      expect(control.className, control.textContent ?? '').toMatch(/min-h-11|w-11/);
    }
    // More files through the list's own field.
    const input = screen.getByTestId('file-queue-input') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const more = [new File(['x'], 'g.docx'), new File(['y'], 'h.pdf')];
    fireEvent.change(input, { target: { files: more } });
    expect(on.onAddFiles).toHaveBeenCalledWith(more);
  });

  it('while something is at work no file is opened or removed; a stopped queue offers to continue', () => {
    const on = handlers();
    render(<Providers><FileQueue files={FILES} busy paused waiting={1} waitingForModel={false} maxFiles={6} {...on} /></Providers>);
    const rows = screen.getAllByTestId('file-queue-row');
    expect((within(rows[1]).getByRole('button', { name: /^b\.docx/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: text.remove('b.docx') }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: text.clearSet }) as HTMLButtonElement).disabled).toBe(true);
    // The set is full.
    expect((screen.getByRole('button', { name: text.addFiles }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('file-queue-paused').textContent).toContain(text.stopped(1));
    fireEvent.click(screen.getByRole('button', { name: text.resume }));
    expect(on.onResume).toHaveBeenCalledTimes(1);
  });

  it('says that the files wait for the model, and shows nothing without files', () => {
    const on = handlers();
    const { rerender } = render(<Providers><FileQueue files={[view({ status: 'waiting', found: null, canOpen: false })]} busy={false} paused={false} waiting={1} waitingForModel maxFiles={25} {...on} /></Providers>);
    expect(screen.getByTestId('file-queue-model').textContent).toBe(text.waitingForModel);
    rerender(<Providers><FileQueue files={[]} busy={false} paused={false} waiting={0} waitingForModel={false} maxFiles={25} {...on} /></Providers>);
    expect(screen.queryByTestId('file-queue')).toBeNull();
  });
});

describe('TextInput with several files', () => {
  it('takes every file picked or dropped, and shows a note instead of the text field when asked to', async () => {
    const onLoadFiles = vi.fn().mockResolvedValue({ success: true });
    const onLoadFile = vi.fn().mockResolvedValue({ success: true });
    const { container, rerender } = render(
      <Providers><TextInput value="" onChange={() => {}} onClear={() => {}} entities={[]} onLoadFile={onLoadFile} onLoadFiles={onLoadFiles} /></Providers>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    const files = [new File(['a'], 'a.docx'), new File(['b'], 'b.pdf')];
    await act(async () => { fireEvent.change(input, { target: { files } }); });
    expect(onLoadFiles).toHaveBeenCalledWith(files);
    await act(async () => { fireEvent.drop(container.firstElementChild!, { dataTransfer: { files, types: ['Files'] } }); });
    expect(onLoadFiles).toHaveBeenCalledTimes(2);
    expect(onLoadFile).not.toHaveBeenCalled();

    rerender(<Providers><TextInput value="" onChange={() => {}} onClear={() => {}} entities={[]} onLoadFiles={onLoadFiles} emptyNote={text.noFileOpen} /></Providers>);
    expect(screen.getByTestId('input-empty-note').textContent).toBe(text.noFileOpen);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('without the new callback it takes one file, as before', async () => {
    const onLoadFile = vi.fn().mockResolvedValue({ success: true });
    const { container } = render(
      <Providers><TextInput value="" onChange={() => {}} onClear={() => {}} entities={[]} onLoadFile={onLoadFile} /></Providers>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(false);
    const files = [new File(['a'], 'a.docx'), new File(['b'], 'b.pdf')];
    await act(async () => { fireEvent.change(input, { target: { files } }); });
    expect(onLoadFile).toHaveBeenCalledTimes(1);
    expect(onLoadFile).toHaveBeenCalledWith(files[0]);
  });
});

describe('the strings of the feature', () => {
  it('exist in every interface language, and none holds an em dash', () => {
    const codes = Object.keys(batchStrings) as Array<keyof typeof batchStrings>;
    expect(codes.sort()).toEqual(['de', 'en', 'es', 'fr', 'no', 'pl', 'pt', 'sv']);
    const sample = (strings: BatchStrings): string[] => [
      strings.title, strings.summary(1, 3), strings.summary(3, 3), strings.addFiles, strings.clearSet, strings.remove('a.docx'),
      ...Object.values(strings.status), strings.found(1), strings.found(5), strings.fileOf(2, 5, 'a.docx'), strings.readingTitle,
      strings.stopped(1), strings.stopped(4), strings.resume, strings.waitingForModel, strings.capReached(25, 3),
      strings.tooManyPairs('10,000'), strings.tableConflict, strings.failedFallback, strings.detectionFailed('Redact'),
      strings.noFileOpen, strings.preparing, strings.nothingToOpen, strings.decisionHint('Redact'), strings.unsavedConfirm,
    ];
    const english = sample(batchStrings.en);
    for (const code of codes) {
      const strings = sample(batchStrings[code]);
      expect(strings).toHaveLength(english.length);
      for (const [index, value] of strings.entries()) {
        expect(value.trim().length, `${code} #${index}`).toBeGreaterThan(0);
        expect(value, `${code} #${index}`).not.toContain(String.fromCharCode(0x2014));
        // Translated, not copied from the English.
        if (code !== 'en' && english[index].length > 12) expect(value, `${code} #${index}`).not.toBe(english[index]);
      }
      expect(batchStrings[code].fileOf(2, 5, 'a.docx')).toContain('a.docx');
      expect(batchStrings[code].tooManyPairs('10,000')).toContain('10,000');
      expect(batchStrings[code].capReached(25, 3)).toContain('25');
    }
  });
});
