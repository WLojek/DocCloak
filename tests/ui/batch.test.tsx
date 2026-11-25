// WLojek/DocCloak#6: several files at once. A set of files is read and analysed one after another
// without the user; each file is reviewed and downloaded on its own; the labels and ONE replacement
// table hold for the whole set. The detection worker and Core's docx reader/writer are faked (the
// fake writer returns the text it was asked to write, so a test can see whose text a download is).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { AnonymizationSession } from '@doccloak/core';
import type { DetectedEntity, EngineClient, EntityType } from '@doccloak/core';
import type { DocxExtraction, UnredactablePart } from '@doccloak/core/dom';
import { UnsupportedDocumentError } from '@doccloak/core/dom';
import type { PdfExtraction } from '@doccloak/core/pdf';
import { StalePdfExtractionError } from '@doccloak/core/pdf';
import { useAnonymizer, fileErrorCode, type AnonymizerOptions } from '../../src/ui/hooks/useAnonymizer.ts';
import { BATCH_MAX_FILES, TABLE_MAX_PAIRS, mergePairs, statusOf, type BatchFileRecord } from '../../src/ui/batch.ts';
import { batchStrings } from '../../src/i18n/features/batch.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY, DetectionAbortedError } from '../../src/engine.ts';

const mocks = vi.hoisted(() => ({
  readDocx: vi.fn(),
  writeAnonymizedDocxWithReport: vi.fn(),
  writeRestoredDocxWithReport: vi.fn(),
  readPdf: vi.fn(),
  writeAnonymizedPdfWithReport: vi.fn(),
  readXlsx: vi.fn(),
  writeAnonymizedXlsxWithReport: vi.fn(),
  renderRedactedImage: vi.fn(),
  loadImageToCanvas: vi.fn(),
  recognizeCanvas: vi.fn(),
}));

vi.mock('../../src/ocr.web.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ocr.web.ts')>();
  return {
    ...actual,
    loadImageToCanvas: (...args: unknown[]) => mocks.loadImageToCanvas(...args),
    recognizeCanvas: (...args: unknown[]) => mocks.recognizeCanvas(...args),
  };
});

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
    writeAnonymizedDocxWithReport: (...args: unknown[]) => mocks.writeAnonymizedDocxWithReport(...args),
    writeRestoredDocxWithReport: (...args: unknown[]) => mocks.writeRestoredDocxWithReport(...args),
    readXlsx: (...args: unknown[]) => mocks.readXlsx(...args),
    writeAnonymizedXlsxWithReport: (...args: unknown[]) => mocks.writeAnonymizedXlsxWithReport(...args),
    renderRedactedImage: (...args: unknown[]) => mocks.renderRedactedImage(...args),
  };
});

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

// jsdom's Blob has no text(); the hook reads a table file through it.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob) { return readBlob(this); };
}

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const text = batchStrings.en;

// The files of the tests, by name: the text Core's reader "finds" in each.
const TEXTS: Record<string, string> = {
  'a.docx': 'Contract between Jan Kowalski and Acme Ltd. Contact: jan@example.com.',
  'b.docx': 'Invoice for Acme Ltd, attention Maria Nowak. Signed by Jan Kowalski.',
  'c.docx': 'Memo: Maria Nowak wrote to jan@example.com and to Piotr Zielony.',
  'solo.docx': 'Kowalski called twice.',
  'macro.docx': 'Offer for Maria Nowak with a macro.',
  'boom.docx': 'BOOM Jan Kowalski.',
  'template.docx': 'Template with [CLIENT] and Jan Kowalski.',
};
const MACROS: UnredactablePart = { part: 'word/vbaProject.bin', kind: 'macros', label: 'macros' };

const KNOWN: Array<[EntityType, string]> = [
  ['PERSON', 'Jan Kowalski'],
  ['PERSON', 'Maria Nowak'],
  ['PERSON', 'Piotr Zielony'],
  ['PERSON', 'Kowalski'],
  ['COMPANY', 'Acme Ltd'],
  ['EMAIL', 'jan@example.com'],
];

/** Every known value in the text, the longest first, in reading order. */
function find(source: string): DetectedEntity[] {
  const found: DetectedEntity[] = [];
  for (const [type, value] of [...KNOWN].sort((a, b) => b[1].length - a[1].length)) {
    for (let at = source.indexOf(value); at !== -1; at = source.indexOf(value, at + value.length)) {
      const end = at + value.length;
      if (found.some((entity) => at < entity.end && end > entity.start)) continue;
      found.push({ type, value, start: at, end, confidence: 0.9, detector: 'test' });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

interface Run {
  text: string;
  signal: AbortSignal | undefined;
  onProgress: (progress: number) => void;
  resolve: (entities: DetectedEntity[]) => void;
  reject: (err: Error) => void;
}
/** Every call of the detector, in order. */
let runs: Run[] = [];
/** When set, a detection waits until the test resolves it. */
let hold = false;

function fakeFactory() {
  const client = {
    preload: () => Promise.resolve(),
    detect: (input: string, signal: AbortSignal | undefined, onProgress: (progress: number) => void) =>
      new Promise<DetectedEntity[]>((resolve, reject) => {
        runs.push({ text: input, signal, onProgress, resolve, reject });
        signal?.addEventListener('abort', () => setTimeout(() => reject(new DetectionAbortedError()), 0), { once: true });
        if (hold) return;
        if (input.includes('BOOM')) reject(new Error('the model fell over'));
        else resolve(find(input));
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

function file(name: string): File {
  return new File([TEXTS[name] ?? name], name);
}

/** The text a writer makes of an extraction: every replacement applied at its offsets. */
function written(source: string, replacements: Array<{ start: number; end: number; replacement: string }>): string {
  let out = source;
  for (const item of [...replacements].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, item.start) + item.replacement + out.slice(item.end);
  }
  return out;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  runs = [];
  hold = false;
  mocks.readDocx.mockReset();
  mocks.writeAnonymizedDocxWithReport.mockReset();
  mocks.writeRestoredDocxWithReport.mockReset();
  mocks.readPdf.mockReset();
  mocks.writeAnonymizedPdfWithReport.mockReset();
  mocks.readXlsx.mockReset();
  mocks.writeAnonymizedXlsxWithReport.mockReset();
  mocks.renderRedactedImage.mockReset();
  mocks.loadImageToCanvas.mockReset();
  mocks.recognizeCanvas.mockReset();
  mocks.readDocx.mockImplementation(async (source: File) => {
    if (source.name === 'broken.docx') throw new UnsupportedDocumentError('encrypted', 'raw core message');
    if (source.name === 'odd.docx') throw new Error('something untyped');
    if (source.name === 'empty.docx') return { plainText: '', empty: true, unredactable: [], warnings: [] };
    if (!(source.name in TEXTS)) return { plainText: source.name, empty: false, unredactable: [], warnings: [] };
    return {
      plainText: TEXTS[source.name],
      empty: false,
      unredactable: source.name === 'macro.docx' ? [MACROS] : [],
      warnings: [],
    } as unknown as DocxExtraction;
  });
  mocks.writeAnonymizedDocxWithReport.mockImplementation(async (extraction: DocxExtraction, replacements: Array<{ start: number; end: number; replacement: string }>) => ({
    blob: new Blob([written(extraction.plainText, replacements)]),
    warnings: [],
  }));
  _setClientFactoryForTests(fakeFactory);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

type Hook = ReturnType<typeof start>;

function start(options?: AnonymizerOptions) {
  return renderHook(() => useAnonymizer(options), { wrapper: Providers });
}

/** name -> status, as the list shows it. */
function statuses(hook: Hook): Record<string, string> {
  return Object.fromEntries(hook.result.current.batch.files.map((item) => [item.name, item.status]));
}

function idOf(hook: Hook, name: string): string {
  const found = hook.result.current.batch.files.find((item) => item.name === name);
  if (!found) throw new Error(`${name} is not in the set`);
  return found.id;
}

/** value -> label of the document on the page. */
function labels(hook: Hook): Record<string, string> {
  return Object.fromEntries(hook.result.current.entries.map((entry) => [entry.original, entry.replacement]));
}

function open(hook: Hook, name: string): boolean {
  let opened = false;
  act(() => { opened = hook.result.current.batch.open(idOf(hook, name)); });
  return opened;
}

/** Pick several files at once and wait until the queue has nothing left to do. */
async function loadSet(names: string[], options?: AnonymizerOptions): Promise<Hook> {
  const hook = start(options);
  await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
  await act(async () => { await hook.result.current.loadFiles(names.map(file)); });
  await waitFor(() => {
    expect(hook.result.current.batch.running).toBe(false);
    expect(hook.result.current.batch.waiting).toBe(0);
    expect(hook.result.current.batch.activeId).not.toBeNull();
  });
  return hook;
}

/** The saved table as pairs. */
async function savedTable(hook: Hook): Promise<{ pairs: Array<{ original: string; replacement: string; entity_type: string }>; count: number; name: string; json: string }> {
  let table: ReturnType<Hook['result']['current']['exportMapping']> = null;
  act(() => { table = hook.result.current.exportMapping(); });
  if (table === null) throw new Error('no table was saved');
  const saved = table as { blob: Blob; count: number; downloadName: string };
  const json = await readBlob(saved.blob);
  return { pairs: JSON.parse(json), count: saved.count, name: saved.downloadName, json };
}

async function download(hook: Hook): Promise<string> {
  let blob: Blob | undefined;
  await act(async () => { blob = await hook.result.current.exportDocx(); });
  act(() => hook.result.current.markResultTakenOut());
  return readBlob(blob!);
}

describe('one file behaves as before there were sets', () => {
  it('a single file picked through loadFiles is loaded, no set is shown', async () => {
    const hook = start();
    await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
    await act(async () => { await hook.result.current.loadFiles([file('a.docx')]); });
    expect(hook.result.current.batch.files).toEqual([]);
    expect(hook.result.current.batch.activeId).toBeNull();
    expect(hook.result.current.fileName).toBe('a.docx');
    expect(hook.result.current.inputText).toBe(TEXTS['a.docx']);
    // Nothing is analysed on its own: the user presses Redact, as before.
    expect(runs).toHaveLength(0);
    expect(hook.result.current.hasMapping).toBe(false);

    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(3));
    expect(labels(hook)).toEqual({ 'Jan Kowalski': '[PERSON_1]', 'Acme Ltd': '[COMPANY_1]', 'jan@example.com': '[EMAIL_1]' });
    expect(hook.result.current.mappingCount).toBe(3);
    expect(hook.result.current.mappingSample).toEqual({ replacement: '[PERSON_1]', original: 'Jan Kowalski' });
    const table = await savedTable(hook);
    expect(table.count).toBe(3);
    expect(table.name).toMatch(/^a_replacement-table_/);
    expect(await download(hook)).toBe('Contract between [PERSON_1] and [COMPANY_1]. Contact: [EMAIL_1].');
    // A second single file takes the place of the first, as before.
    await act(async () => { await hook.result.current.loadFile(file('b.docx')); });
    expect(hook.result.current.batch.files).toEqual([]);
    expect(hook.result.current.fileName).toBe('b.docx');
    expect(hook.result.current.entities).toEqual([]);
  });
});

describe('Undo of Clear', () => {
  it('brings a cleared text back, but never onto a file or a set that was loaded since', async () => {
    const hook = start();
    await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
    const typed = 'Note about Jan Kowalski.';
    act(() => hook.result.current.handleInputChange(typed));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(1));
    let snapshot = hook.result.current.snapshotText();
    act(() => hook.result.current.clear());
    expect(hook.result.current.inputText).toBe('');
    // As before: Undo brings the text and its list back.
    act(() => hook.result.current.restoreSnapshot(snapshot));
    expect(hook.result.current.inputText).toBe(typed);
    expect(hook.result.current.entities).toHaveLength(1);

    // Cleared again, then a file is loaded: the Undo of the text must not put its list on the file.
    snapshot = hook.result.current.snapshotText();
    act(() => hook.result.current.clear());
    await act(async () => { await hook.result.current.loadFile(file('b.docx')); });
    act(() => hook.result.current.restoreSnapshot(snapshot));
    expect(hook.result.current.inputText).toBe(TEXTS['b.docx']);
    expect(hook.result.current.entities).toEqual([]);
    expect(hook.result.current.fileName).toBe('b.docx');

    // The same for a set.
    await act(async () => { await hook.result.current.loadFiles([file('a.docx'), file('c.docx')]); });
    await waitFor(() => expect(hook.result.current.batch.activeId).not.toBeNull());
    await waitFor(() => expect(hook.result.current.batch.running).toBe(false));
    act(() => hook.result.current.restoreSnapshot({ ...snapshot, epoch: undefined }));
    expect(hook.result.current.inputText).toBe(TEXTS['a.docx']);
    expect(hook.result.current.entities).toHaveLength(3);
  });
});

describe('the queue', () => {
  it('reads and analyses three files in order, without the user, and puts the first on the page', async () => {
    const hook = await loadSet(['a.docx', 'b.docx', 'c.docx']);
    expect(mocks.readDocx.mock.calls.map((call) => (call[0] as File).name)).toEqual(['a.docx', 'b.docx', 'c.docx']);
    expect(runs.map((run) => run.text)).toEqual([TEXTS['a.docx'], TEXTS['b.docx'], TEXTS['c.docx']]);
    expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'b.docx': 'ready', 'c.docx': 'ready' });
    expect(hook.result.current.batch.files.map((item) => item.found)).toEqual([3, 3, 3]);
    expect(hook.result.current.batch.files.map((item) => item.open)).toEqual([true, false, false]);
    expect(hook.result.current.batch.files.every((item) => item.canOpen)).toBe(true);
    expect(hook.result.current.fileName).toBe('a.docx');
    expect(hook.result.current.anonymizedText).toBe('Contract between [PERSON_1] and [COMPANY_1]. Contact: [EMAIL_1].');
    expect(hook.result.current.anonymizing).toBe(false);
    expect(hook.result.current.batch.current).toBeNull();
    expect(hook.result.current.batch.documentsHeld()).toBe(3);
  });

  it('says which file is running, and holds the others until it is done', async () => {
    hold = true;
    const hook = start();
    await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
    await act(async () => { await hook.result.current.loadFiles([file('a.docx'), file('b.docx')]); });
    await waitFor(() => expect(runs).toHaveLength(1));
    expect(statuses(hook)).toEqual({ 'a.docx': 'analysing', 'b.docx': 'waiting' });
    expect(hook.result.current.batch.current).toEqual({ index: 1, total: 2, name: 'a.docx', phase: 'analysing' });
    expect(hook.result.current.batch.running).toBe(true);
    expect(hook.result.current.batch.busy).toBe(true);
    expect(hook.result.current.anonymizing).toBe(true);
    act(() => runs[0].onProgress(0.5));
    expect(hook.result.current.detectionProgress).toBe(0.5);
    // Nothing is on the page while the first file runs: no file is opened under the queue.
    expect(hook.result.current.batch.activeId).toBeNull();
    expect(hook.result.current.inputText).toBe('');

    act(() => runs[0].resolve(find(runs[0].text)));
    await waitFor(() => expect(runs).toHaveLength(2));
    expect(statuses(hook)).toEqual({ 'a.docx': 'ready', 'b.docx': 'analysing' });
    expect(hook.result.current.batch.current).toEqual({ index: 2, total: 2, name: 'b.docx', phase: 'analysing' });
    act(() => runs[1].resolve(find(runs[1].text)));
    await waitFor(() => expect(hook.result.current.batch.running).toBe(false));
    expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'b.docx': 'ready' });
  });

  it('waits for the model and starts on its own when it is there', async () => {
    localStorage.removeItem(CONSENT_STORAGE_KEY);
    const hook = start();
    await act(async () => { await hook.result.current.loadFiles([file('a.docx'), file('b.docx')]); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(hook.result.current.modelLoaded).toBe(false);
    expect(statuses(hook)).toEqual({ 'a.docx': 'waiting', 'b.docx': 'waiting' });
    expect(hook.result.current.batch.waitingForModel).toBe(true);
    expect(mocks.readDocx).not.toHaveBeenCalled();
    expect(runs).toHaveLength(0);

    act(() => hook.result.current.acceptModelDownload());
    await waitFor(() => expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'b.docx': 'ready' }));
    expect(hook.result.current.batch.waitingForModel).toBe(false);
  });

  it('a file that fails and a file that needs a decision do not stop it', async () => {
    const hook = await loadSet(['broken.docx', 'macro.docx', 'odd.docx', 'empty.docx', 'boom.docx', 'a.docx']);
    expect(statuses(hook)).toEqual({
      'broken.docx': 'failed',
      'macro.docx': 'needs-decision',
      'odd.docx': 'failed',
      'empty.docx': 'failed',
      'boom.docx': 'failed',
      'a.docx': 'ready',
    });
    const view = (name: string) => hook.result.current.batch.files.find((item) => item.name === name)!;
    // The reason is the translated one of the reader, or a fallback; never the raw error.
    expect(view('broken.docx').reason).toBe(en.fileErrors.encrypted);
    expect(view('odd.docx').reason).toBe(text.failedFallback);
    expect(view('empty.docx').reason).toBe(en.fileErrors['empty-document']);
    expect(view('boom.docx').reason).toBe(text.detectionFailed(en.redactButton.redact));
    expect(view('a.docx').found).toBe(3);
    // The file with parts that cannot be redacted was read and NOT analysed.
    expect(runs.map((run) => run.text)).toEqual([TEXTS['boom.docx'], TEXTS['a.docx']]);
    // The first file that was read is on the page: the one that waits for a decision.
    expect(hook.result.current.fileName).toBe('macro.docx');
    expect(hook.result.current.unredactablePending).toBe(true);
    expect(hook.result.current.entities).toEqual([]);
    // A file that could not be read cannot be opened, and holds nothing.
    expect(view('broken.docx').canOpen).toBe(false);
    expect(open(hook, 'broken.docx')).toBe(false);
    expect(hook.result.current.fileName).toBe('macro.docx');
    expect(hook.result.current.batch.documentsHeld()).toBe(3);
  });

  it('Cancel stops it: what is done stays, the rest waits, Continue goes on without reading again', async () => {
    hold = true;
    const hook = start();
    await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
    await act(async () => { await hook.result.current.loadFiles([file('a.docx'), file('b.docx'), file('c.docx')]); });
    await waitFor(() => expect(runs).toHaveLength(1));
    act(() => runs[0].resolve(find(runs[0].text)));
    await waitFor(() => expect(runs).toHaveLength(2));

    act(() => hook.result.current.cancelAnonymize());
    expect(runs[1].signal?.aborted).toBe(true);
    expect(hook.result.current.anonymizing).toBe(false);
    expect(screen.getByText(en.detect.cancelled)).toBeTruthy();
    // A worker that ignored the cancel and answered anyway: its result is not applied to any file.
    act(() => runs[1].resolve(find(runs[1].text)));
    await waitFor(() => expect(hook.result.current.batch.running).toBe(false));
    expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'b.docx': 'waiting', 'c.docx': 'waiting' });
    expect(hook.result.current.batch.paused).toBe(true);
    expect(hook.result.current.batch.waiting).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'b.docx': 'waiting', 'c.docx': 'waiting' });
    expect(hook.result.current.batch.files.map((item) => item.found)).toEqual([3, null, null]);
    expect(runs).toHaveLength(2);
    // The file that is done can be worked on meanwhile.
    expect(hook.result.current.fileName).toBe('a.docx');
    expect(hook.result.current.entities).toHaveLength(3);

    hold = false;
    act(() => hook.result.current.batch.resume());
    await waitFor(() => expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'b.docx': 'ready', 'c.docx': 'ready' }));
    expect(hook.result.current.batch.paused).toBe(false);
    // b.docx was read before the cancel: it is analysed again, not read again.
    expect(mocks.readDocx.mock.calls.map((call) => (call[0] as File).name)).toEqual(['a.docx', 'b.docx', 'c.docx']);
    expect(runs.map((run) => run.text)).toEqual([TEXTS['a.docx'], TEXTS['b.docx'], TEXTS['b.docx'], TEXTS['c.docx']]);
  });

  it('files can be added to an open set, and the file on the page stays', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    act(() => hook.result.current.toggleEntity(0));
    const before = hook.result.current.anonymizedText;
    let added: { added: number; skipped: number } | undefined;
    act(() => { added = hook.result.current.batch.add([file('c.docx')]); });
    expect(added).toEqual({ added: 1, skipped: 0 });
    await waitFor(() => expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'b.docx': 'ready', 'c.docx': 'ready' }));
    expect(hook.result.current.fileName).toBe('a.docx');
    expect(hook.result.current.anonymizedText).toBe(before);
    expect([...hook.result.current.excludedIndices]).toEqual([0]);
    // One file dropped on the page while a set is open joins the set too.
    await act(async () => { await hook.result.current.loadFile(file('solo.docx')); });
    await waitFor(() => expect(statuses(hook)['solo.docx']).toBe('ready'));
    expect(hook.result.current.fileName).toBe('a.docx');
  });

  it('holds at most the limit, and says what was not added', async () => {
    expect(BATCH_MAX_FILES).toBe(25);
    const hook = start({ maxBatchFiles: 3 });
    await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
    await act(async () => { await hook.result.current.loadFiles(['a.docx', 'b.docx', 'c.docx', 'solo.docx', 'macro.docx'].map(file)); });
    await waitFor(() => expect(hook.result.current.batch.waiting).toBe(0));
    expect(hook.result.current.batch.files.map((item) => item.name)).toEqual(['a.docx', 'b.docx', 'c.docx']);
    expect(hook.result.current.batch.maxFiles).toBe(3);
    expect(screen.getByText(text.capReached(3, 2))).toBeTruthy();
    // A full set takes nothing more, and the refusal carries the reason.
    let result: { success: boolean; message?: string } | undefined;
    await act(async () => { result = await hook.result.current.loadFiles([file('solo.docx')]); });
    expect(result).toEqual({ success: false, error: 'set-full', message: text.capReached(3, 1) });
    expect(hook.result.current.batch.files).toHaveLength(3);
  });
});

describe('one file at a time on the page', () => {
  it('the same value has the same label in every file', async () => {
    const hook = await loadSet(['a.docx', 'b.docx', 'c.docx']);
    expect(labels(hook)).toEqual({ 'Jan Kowalski': '[PERSON_1]', 'Acme Ltd': '[COMPANY_1]', 'jan@example.com': '[EMAIL_1]' });
    expect(open(hook, 'b.docx')).toBe(true);
    expect(hook.result.current.fileName).toBe('b.docx');
    expect(labels(hook)).toEqual({ 'Acme Ltd': '[COMPANY_1]', 'Maria Nowak': '[PERSON_2]', 'Jan Kowalski': '[PERSON_1]' });
    expect(hook.result.current.anonymizedText).toBe('Invoice for [COMPANY_1], attention [PERSON_2]. Signed by [PERSON_1].');
    expect(open(hook, 'c.docx')).toBe(true);
    expect(labels(hook)).toEqual({ 'Maria Nowak': '[PERSON_2]', 'jan@example.com': '[EMAIL_1]', 'Piotr Zielony': '[PERSON_3]' });
    expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'b.docx': 'opened', 'c.docx': 'opened' });
  });

  it('pins the rule for a name part across files: the surname alone in a second file joins the person of the first', async () => {
    // Nothing is added for sets: this is what the label building does for a second document in one tab.
    const hook = await loadSet(['a.docx', 'solo.docx']);
    expect(labels(hook)['Jan Kowalski']).toBe('[PERSON_1]');
    open(hook, 'solo.docx');
    expect(labels(hook)).toEqual({ Kowalski: '[PERSON_1_LAST]' });
    expect(hook.result.current.anonymizedText).toBe('[PERSON_1_LAST] called twice.');
    const table = await savedTable(hook);
    expect(table.pairs.map((pair) => [pair.original, pair.replacement])).toEqual([
      ['Jan Kowalski', '[PERSON_1]'],
      ['Acme Ltd', '[COMPANY_1]'],
      ['jan@example.com', '[EMAIL_1]'],
      ['Kowalski', '[PERSON_1_LAST]'],
    ]);
    // Also pinned: a label typed for the full name is not carried to the surname in a file that
    // holds the surname alone (that file's table has no entry of the full name to derive it from).
    open(hook, 'a.docx');
    act(() => { hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'); });
    open(hook, 'solo.docx');
    expect(labels(hook)).toEqual({ Kowalski: '[PERSON_1_LAST]' });
    expect(hook.result.current.restoreText('[CLIENT] and [PERSON_1_LAST]').text).toBe('Jan Kowalski and Kowalski');
  });

  it('switching back and forth brings each file back as it was left', async () => {
    const hook = await loadSet(['a.docx', 'macro.docx', 'b.docx']);
    // a.docx: the company stays readable, a word is marked by hand.
    const company = hook.result.current.entities.findIndex((entity) => entity.value === 'Acme Ltd');
    act(() => hook.result.current.toggleEntity(company));
    const at = TEXTS['a.docx'].indexOf('Contract');
    act(() => hook.result.current.addManualEntity(at, at + 'Contract'.length, 'OTHER'));
    const a = {
      text: hook.result.current.anonymizedText,
      entities: hook.result.current.entities,
      excluded: [...hook.result.current.excludedIndices],
      entries: hook.result.current.entries,
    };
    expect(a.text).toBe('[OTHER_1] between [PERSON_1] and Acme Ltd. Contact: [EMAIL_1].');

    // macro.docx: the notice is answered, the file is analysed by the user.
    expect(open(hook, 'macro.docx')).toBe(true);
    expect(hook.result.current.unredactableItems).toEqual([MACROS]);
    expect(hook.result.current.unredactablePending).toBe(true);
    expect(hook.result.current.entities).toEqual([]);
    expect(hook.result.current.anonymizedText).toBe('');
    act(() => hook.result.current.continueWithUnredactable());
    expect(statuses(hook)['macro.docx']).toBe('needs-decision');
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(1));
    expect(statuses(hook)['macro.docx']).toBe('opened');

    // b.docx: one person stays readable.
    expect(open(hook, 'b.docx')).toBe(true);
    expect(hook.result.current.unredactableItems).toEqual([]);
    expect(hook.result.current.allowUnredactable).toBe(false);
    const maria = hook.result.current.entities.findIndex((entity) => entity.value === 'Maria Nowak');
    act(() => hook.result.current.toggleEntity(maria));
    const b = { text: hook.result.current.anonymizedText, excluded: [...hook.result.current.excludedIndices] };
    expect(b.text).toBe('Invoice for [COMPANY_1], attention Maria Nowak. Signed by [PERSON_1].');

    // Back to a.docx: text, list, choices, table, file.
    expect(open(hook, 'a.docx')).toBe(true);
    expect(hook.result.current.fileName).toBe('a.docx');
    expect(hook.result.current.inputText).toBe(TEXTS['a.docx']);
    expect(hook.result.current.anonymizedText).toBe(a.text);
    expect(hook.result.current.entities).toEqual(a.entities);
    expect([...hook.result.current.excludedIndices]).toEqual(a.excluded);
    expect(hook.result.current.entries).toEqual(a.entries);
    expect(hook.result.current.hasDocxExtraction).toBe(true);

    // Back to macro.docx: the decision and the result are still there.
    expect(open(hook, 'macro.docx')).toBe(true);
    expect(hook.result.current.unredactableItems).toEqual([MACROS]);
    expect(hook.result.current.allowUnredactable).toBe(true);
    expect(hook.result.current.unredactablePending).toBe(false);
    expect(hook.result.current.anonymizedText).toBe('Offer for [PERSON_2] with a macro.');

    expect(open(hook, 'b.docx')).toBe(true);
    expect(hook.result.current.anonymizedText).toBe(b.text);
    expect([...hook.result.current.excludedIndices]).toEqual(b.excluded);
  });

  it('a download is the open file, made of its own places and nothing else', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    expect(await download(hook)).toBe('Contract between [PERSON_1] and [COMPANY_1]. Contact: [EMAIL_1].');
    expect(statuses(hook)['a.docx']).toBe('downloaded');

    open(hook, 'b.docx');
    expect(await download(hook)).toBe('Invoice for [COMPANY_1], attention [PERSON_2]. Signed by [PERSON_1].');
    // What the writer was given for b.docx: its own text, its own offsets, its own values.
    const [extraction, replacements, values] = mocks.writeAnonymizedDocxWithReport.mock.calls[1] as [DocxExtraction, Array<{ start: number; end: number; replacement: string }>, Array<{ value: string }>];
    expect(extraction.plainText).toBe(TEXTS['b.docx']);
    for (const item of replacements) {
      const value = TEXTS['b.docx'].slice(item.start, item.end);
      expect(labels(hook)[value], value).toBe(item.replacement);
    }
    expect(values.map((item) => item.value).sort()).toEqual(['Acme Ltd', 'Jan Kowalski', 'Maria Nowak']);
    expect(statuses(hook)).toEqual({ 'a.docx': 'downloaded', 'b.docx': 'downloaded' });
  });

  it('what was made for the file that left the page does nothing to the one that came', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    // Kept by a message, a menu or a slow click: the functions of a.docx.
    const forA = hook.result.current;
    open(hook, 'b.docx');
    const before = { text: hook.result.current.anonymizedText, excluded: [...hook.result.current.excludedIndices], entities: hook.result.current.entities };
    // An export made for a.docx is refused: it would pair a.docx's offsets with what is on the page now.
    await expect(forA.exportDocx()).rejects.toThrow('The document on the page has changed');
    expect(mocks.writeAnonymizedDocxWithReport).not.toHaveBeenCalled();
    // Its indices are not places of b.docx.
    act(() => forA.toggleEntity(0));
    act(() => forA.setEntitiesExcluded([0, 1, 2], true));
    act(() => forA.removeEntity(0));
    expect(hook.result.current.anonymizedText).toBe(before.text);
    expect([...hook.result.current.excludedIndices]).toEqual(before.excluded);
    expect(hook.result.current.entities).toEqual(before.entities);
    // The functions of b.docx work.
    act(() => hook.result.current.toggleEntity(0));
    expect([...hook.result.current.excludedIndices]).toEqual([0]);
  });

  it('a file is not switched or removed while it is analysed or exported', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    // The user runs the analysis of the open file again.
    hold = true;
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(runs).toHaveLength(3));
    expect(hook.result.current.batch.busy).toBe(true);
    expect(open(hook, 'b.docx')).toBe(false);
    let removed = true;
    act(() => { removed = hook.result.current.batch.remove(idOf(hook, 'b.docx')); });
    expect(removed).toBe(false);
    act(() => { removed = hook.result.current.batch.clear(); });
    expect(removed).toBe(false);
    expect(hook.result.current.batch.activeId).toBe(idOf(hook, 'a.docx'));
    // The result lands in the file it was made for.
    act(() => runs[2].resolve(find(runs[2].text).slice(0, 1)));
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(hook.result.current.fileName).toBe('a.docx');
    expect(hook.result.current.entities.map((entity) => entity.value)).toEqual(['Jan Kowalski']);
    hold = false;

    // An export that takes its time.
    let finish: (value: { blob: Blob; warnings: string[] }) => void = () => {};
    mocks.writeAnonymizedDocxWithReport.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let exported: Promise<Blob> | undefined;
    await act(async () => {
      exported = hook.result.current.exportDocx();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(hook.result.current.batch.busy).toBe(true);
    expect(open(hook, 'b.docx')).toBe(false);
    expect(hook.result.current.fileName).toBe('a.docx');
    await act(async () => {
      finish({ blob: new Blob(['done']), warnings: ['note of a.docx'] });
      await exported;
    });
    expect(hook.result.current.batch.busy).toBe(false);
    // The writer's note went to the file it was written for; the other file has none.
    const notes = hook.result.current.fileWarnings;
    expect(notes).toHaveLength(1);
    expect(open(hook, 'b.docx')).toBe(true);
    expect(hook.result.current.fileWarnings).toEqual([]);
    expect(hook.result.current.entities).toHaveLength(3);
    expect(open(hook, 'a.docx')).toBe(true);
    expect(hook.result.current.fileWarnings).toEqual(notes);
  });

  it('a file that needs a decision or failed is never downloaded as protected', async () => {
    const hook = await loadSet(['macro.docx', 'boom.docx', 'broken.docx']);
    expect(statuses(hook)).toEqual({ 'macro.docx': 'needs-decision', 'boom.docx': 'failed', 'broken.docx': 'failed' });
    // Needs a decision: refused before the decision ...
    await expect(hook.result.current.exportDocx()).rejects.toThrow();
    // ... and after it, until the file was analysed (the queue never analysed it).
    act(() => hook.result.current.continueWithUnredactable());
    await expect(hook.result.current.exportDocx()).rejects.toThrow('This file has not been analysed');
    // Failed in the analysis: it can be opened, and it cannot be downloaded.
    expect(open(hook, 'boom.docx')).toBe(true);
    expect(hook.result.current.anonymizedText).toBe('');
    await expect(hook.result.current.exportDocx()).rejects.toThrow('This file has not been analysed');
    // Failed while it was read: there is nothing to open.
    expect(open(hook, 'broken.docx')).toBe(false);
    expect(hook.result.current.fileName).toBe('boom.docx');
    expect(mocks.writeAnonymizedDocxWithReport).not.toHaveBeenCalled();

    // Once the user has decided and pressed Redact, the first file is a file like any other.
    expect(open(hook, 'macro.docx')).toBe(true);
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).not.toBe(''));
    expect(await download(hook)).toBe('Offer for [PERSON_1] with a macro.');
    expect(mocks.writeAnonymizedDocxWithReport.mock.calls[0][3]).toEqual({ allowUnredactable: true });
  });

  it('a PDF of the set keeps its own parsed file, and the writer\'s refusals stay with it', async () => {
    const parsed = {
      plainText: 'Scan for Maria Nowak, page two.',
      pageCount: 2,
      pages: [],
      runs: [],
      unredactable: [],
      removed: [{ kind: 'annotations', label: 'annotations', count: 2 }],
      warnings: [],
      empty: false,
      rasterOnlyPages: [],
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    } as unknown as PdfExtraction;
    mocks.readPdf.mockResolvedValue(parsed);
    mocks.writeAnonymizedPdfWithReport.mockImplementation(async (extraction: PdfExtraction, replacements: Array<{ start: number; end: number; replacement: string }>) => ({
      blob: new Blob([written(extraction.plainText, replacements)]),
      warnings: [],
      removed: [],
      rasterizedPages: [],
      scanPages: [],
      shiftedLines: 0,
    }));
    const hook = await loadSet(['a.docx', 'scan.pdf']);
    expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'scan.pdf': 'ready' });
    // While the Word file is on the page there is no PDF to export.
    expect(hook.result.current.hasPdfExtraction).toBe(false);
    await expect(hook.result.current.exportPdf()).rejects.toThrow('No PDF to export');

    open(hook, 'scan.pdf');
    expect(hook.result.current.hasPdfExtraction).toBe(true);
    expect(hook.result.current.hasDocxExtraction).toBe(false);
    expect(hook.result.current.pdfRemoved).toEqual(parsed.removed);
    await expect(hook.result.current.exportDocx()).rejects.toThrow('No document to export');
    let blob: Blob | undefined;
    await act(async () => { blob = await hook.result.current.exportPdf(); });
    expect(await readBlob(blob!)).toBe('Scan for [PERSON_2], page two.');
    // The writer got the parsed file of this PDF itself, with this PDF's places.
    expect(mocks.writeAnonymizedPdfWithReport.mock.calls[0][0]).toBe(parsed);
    expect(mocks.writeAnonymizedPdfWithReport.mock.calls[0][1]).toEqual([{ start: 9, end: 20, replacement: '[PERSON_2]' }]);

    // Back and forth: the Word file is the Word file, the PDF the PDF.
    open(hook, 'a.docx');
    expect(hook.result.current.hasPdfExtraction).toBe(false);
    expect(hook.result.current.pdfRemoved).toEqual([]);
    expect(await download(hook)).toBe('Contract between [PERSON_1] and [COMPANY_1]. Contact: [EMAIL_1].');
    open(hook, 'scan.pdf');
    // Core's check that the bytes still give the analysed text is the writer's: its refusal reaches the caller.
    mocks.writeAnonymizedPdfWithReport.mockRejectedValueOnce(new StalePdfExtractionError());
    let failure: unknown;
    await act(async () => { failure = await hook.result.current.exportPdf().catch((err: unknown) => err); });
    expect(fileErrorCode(failure)).toBe('stale-extraction');
    // A part the writer cannot redact: the notice is raised for this file, and it is not downloaded.
    mocks.writeAnonymizedPdfWithReport.mockRejectedValueOnce(new UnsupportedDocumentError('unredactable-parts', 'x', ['page 2']));
    await act(async () => { await hook.result.current.exportPdf().catch(() => {}); });
    expect(hook.result.current.unredactablePending).toBe(true);
    expect(statuses(hook)['scan.pdf']).toBe('needs-decision');
    await expect(hook.result.current.exportPdf()).rejects.toThrow('Unredactable parts have not been confirmed');
    // The other file knows nothing of it.
    open(hook, 'a.docx');
    expect(hook.result.current.unredactablePending).toBe(false);
    expect(statuses(hook)).toEqual({ 'a.docx': 'downloaded', 'scan.pdf': 'needs-decision' });
  });
});

describe('what each kind of file keeps while another is on the page', () => {
  it('a workbook keeps its notes and its check that the text still matches; an image its picture and words', async () => {
    const sheet = {
      plainText: 'Staff: Maria Nowak, Acme Ltd.',
      empty: false,
      unredactable: [],
      warnings: [],
      stats: { dateCells: 1, identifierCells: 2, otherNumberCells: 3 },
      uncheckedCells: [{ sheet: 'Staff', cell: 'D2', value: '8200.5' }],
    };
    mocks.readXlsx.mockResolvedValue(sheet);
    mocks.writeAnonymizedXlsxWithReport.mockImplementation(async (extraction: { plainText: string }, replacements: Array<{ start: number; end: number; replacement: string }>) => ({
      blob: new Blob([written(extraction.plainText, replacements)]),
      warnings: [],
      renamedSheets: ['Sheet of PERSON_2'],
    }));
    const canvas = { picture: 'of a letter' } as unknown as HTMLCanvasElement;
    const words = [{ text: 'Piotr', start: 7, end: 12 }, { text: 'Zielony', start: 13, end: 20 }];
    mocks.loadImageToCanvas.mockResolvedValue(canvas);
    mocks.recognizeCanvas.mockResolvedValue({ text: 'Letter Piotr Zielony here.', words });
    mocks.renderRedactedImage.mockResolvedValue(new Blob(['png']));

    const hook = await loadSet(['a.docx', 'staff.xlsx', 'letter.png']);
    expect(statuses(hook)).toEqual({ 'a.docx': 'opened', 'staff.xlsx': 'ready', 'letter.png': 'ready' });
    expect(hook.result.current.xlsxInfo).toBeNull();
    expect(hook.result.current.hasImage).toBe(false);

    open(hook, 'staff.xlsx');
    expect(hook.result.current.hasXlsxExtraction).toBe(true);
    expect(hook.result.current.xlsxInfo).toEqual({ dateCells: 1, identifierCells: 2, otherNumberCells: 3, renamedSheets: [], unchecked: sheet.uncheckedCells });
    let blob: Blob | undefined;
    await act(async () => { blob = await hook.result.current.exportXlsx(); });
    expect(await readBlob(blob!)).toBe('Staff: [PERSON_2], [COMPANY_1].');
    expect(hook.result.current.xlsxInfo?.renamedSheets).toEqual(['Sheet of PERSON_2']);

    open(hook, 'letter.png');
    expect(hook.result.current.hasImage).toBe(true);
    expect(hook.result.current.hasXlsxExtraction).toBe(false);
    expect(hook.result.current.xlsxInfo).toBeNull();
    await expect(hook.result.current.exportXlsx()).rejects.toThrow('No workbook to export');
    await act(async () => { await hook.result.current.exportRedactedImage(); });
    // The picture, the words and the places are the image's own.
    expect(mocks.renderRedactedImage.mock.calls[0][0]).toBe(canvas);
    expect(mocks.renderRedactedImage.mock.calls[0][1]).toBe(words);
    expect((mocks.renderRedactedImage.mock.calls[0][2] as DetectedEntity[]).map((entity) => entity.value)).toEqual(['Piotr Zielony']);

    // Back at the workbook: what the export had said about it is still there.
    open(hook, 'staff.xlsx');
    expect(hook.result.current.hasImage).toBe(false);
    expect(hook.result.current.xlsxInfo?.renamedSheets).toEqual(['Sheet of PERSON_2']);
    await expect(hook.result.current.exportRedactedImage()).rejects.toThrow('No image or entities to export');
    // The file on disk changed since it was analysed: the offsets are not its own any more.
    mocks.readXlsx.mockResolvedValue({ ...sheet, plainText: 'Staff: Somebody Else, Acme Ltd.' });
    await expect(hook.result.current.exportXlsx()).rejects.toThrow('The workbook no longer matches the analysed text');
    expect(mocks.writeAnonymizedXlsxWithReport).toHaveBeenCalledTimes(1);
  });

  it('the notice about places an earlier run had redacted stays with its file', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    // The same text again, and the detector misses the company this time.
    hold = true;
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(runs).toHaveLength(3));
    act(() => runs[2].resolve(find(runs[2].text).filter((entity) => entity.value !== 'Acme Ltd')));
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(hook.result.current.droppedCount).toBe(1);
    open(hook, 'b.docx');
    expect(hook.result.current.droppedCount).toBe(0);
    open(hook, 'a.docx');
    expect(hook.result.current.droppedCount).toBe(1);
    // Answered here: the place is redacted again, in this file.
    act(() => hook.result.current.keepDroppedRedacted());
    expect(hook.result.current.droppedCount).toBe(0);
    expect(hook.result.current.anonymizedText).toBe('Contract between [PERSON_1] and [COMPANY_1]. Contact: [EMAIL_1].');
  });
});

describe('one table for the set', () => {
  it('holds the pairs of every file and restores a reply about a file that is not open', async () => {
    const hook = await loadSet(['a.docx', 'b.docx', 'c.docx']);
    expect(hook.result.current.hasMapping).toBe(true);
    expect(hook.result.current.mappingCount).toBe(5);
    expect(hook.result.current.mappingSample).toEqual({ replacement: '[PERSON_1]', original: 'Jan Kowalski' });

    const table = await savedTable(hook);
    expect(table.count).toBe(5);
    expect(table.name).toMatch(/^a_and_2_more_replacement-table_\d{4}-\d{2}-\d{2}_\d{6}\.json$/);
    expect(table.pairs).toEqual([
      { original: 'Jan Kowalski', replacement: '[PERSON_1]', entity_type: 'PERSON' },
      { original: 'Acme Ltd', replacement: '[COMPANY_1]', entity_type: 'COMPANY' },
      { original: 'jan@example.com', replacement: '[EMAIL_1]', entity_type: 'EMAIL' },
      { original: 'Maria Nowak', replacement: '[PERSON_2]', entity_type: 'PERSON' },
      { original: 'Piotr Zielony', replacement: '[PERSON_3]', entity_type: 'PERSON' },
    ]);
    // The file is one Core reads back (the command line and "load a table" use the same reader).
    const loaded = AnonymizationSession.deserialize(table.json);
    expect(loaded.deanonymize('[PERSON_3] and [COMPANY_1]')).toBe('Piotr Zielony and Acme Ltd');

    // a.docx is open; the reply is about c.docx, which was never opened.
    expect(hook.result.current.fileName).toBe('a.docx');
    const reply = hook.result.current.restoreText('Dear [PERSON_3], [PERSON_2] wrote to [EMAIL_1]. [PERSON_9] did not.');
    expect(reply.text).toBe('Dear Piotr Zielony, Maria Nowak wrote to jan@example.com. [PERSON_9] did not.');
    expect(reply.restored).toBe(3);
    expect(reply.unresolved).toEqual(['[PERSON_9]']);
    expect(hook.result.current.deanonymize('[PERSON_3]')).toBe('Piotr Zielony');
  });

  it('restores a Word reply about any file of the set', async () => {
    const hook = await loadSet(['a.docx', 'c.docx']);
    mocks.readDocx.mockResolvedValueOnce({ plainText: 'Reply to [PERSON_2] and [PERSON_1].', empty: false, unredactable: [], warnings: [] });
    mocks.writeRestoredDocxWithReport.mockResolvedValue({ blob: new Blob(['restored']) });
    let outcome: Awaited<ReturnType<Hook['result']['current']['restoreDocx']>> | undefined;
    await act(async () => { outcome = await hook.result.current.restoreDocx(new File(['x'], 'reply.docx')); });
    expect(outcome).toMatchObject({ success: true, restored: 2, unresolved: [] });
    const spans = mocks.writeRestoredDocxWithReport.mock.calls[0][1] as Array<{ replacement: string }>;
    expect(spans.map((span) => span.replacement)).toEqual(['Maria Nowak', 'Jan Kowalski']);
  });

  it('a label typed in one file holds in the others and in the table, also for a file that is not open', async () => {
    const hook = await loadSet(['a.docx', 'b.docx', 'c.docx']);
    let refusal: string | null = 'not called';
    act(() => { refusal = hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'); });
    expect(refusal).toBeNull();
    expect(hook.result.current.anonymizedText).toBe('Contract between [CLIENT] and [COMPANY_1]. Contact: [EMAIL_1].');

    // b.docx is not open: the table gives the pairs it would have if it were opened now.
    const table = await savedTable(hook);
    expect(table.pairs.filter((pair) => pair.original === 'Jan Kowalski')).toEqual([
      { original: 'Jan Kowalski', replacement: '[CLIENT]', entity_type: 'PERSON' },
    ]);
    expect(table.pairs.some((pair) => pair.replacement === '[PERSON_1]')).toBe(false);
    expect(hook.result.current.restoreText('[CLIENT] and [PERSON_2]').text).toBe('Jan Kowalski and Maria Nowak');
    // The numbered label it had is not in the table any more: it stays in a reply and is reported.
    const old = hook.result.current.restoreText('[PERSON_1] signed');
    expect(old.restored).toBe(0);
    expect(old.text).toBe('[PERSON_1] signed');
    expect(old.stale?.map((item) => item.label)).toEqual(['[PERSON_1]']);

    open(hook, 'b.docx');
    expect(labels(hook)['Jan Kowalski']).toBe('[CLIENT]');
    expect(hook.result.current.anonymizedText).toBe('Invoice for [COMPANY_1], attention [PERSON_2]. Signed by [CLIENT].');
    expect(hook.result.current.renamedOriginals.has('Jan Kowalski')).toBe(true);
    // Taken back in b.docx: a.docx has its numbered label again.
    act(() => hook.result.current.resetLabel('Jan Kowalski'));
    open(hook, 'a.docx');
    expect(labels(hook)['Jan Kowalski']).toBe('[PERSON_1]');
    expect(hook.result.current.renamedOriginals.size).toBe(0);
  });

  it('a label typed for the set outlives the Redact button pressed in another file', async () => {
    const hook = await loadSet(['a.docx', 'macro.docx', 'b.docx']);
    act(() => { hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'); });
    open(hook, 'b.docx');
    act(() => { hook.result.current.renameLabel('Maria Nowak', '[BUYER]'); });
    // The file that waited for a decision is analysed by the user: a first run of a new text.
    open(hook, 'macro.docx');
    act(() => hook.result.current.continueWithUnredactable());
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(1));
    // It takes the label typed for its value in another file ...
    expect(hook.result.current.anonymizedText).toBe('Offer for [BUYER] with a macro.');
    // ... and the other files keep theirs.
    open(hook, 'a.docx');
    expect(labels(hook)['Jan Kowalski']).toBe('[CLIENT]');
    open(hook, 'b.docx');
    expect(hook.result.current.anonymizedText).toBe('Invoice for [COMPANY_1], attention [BUYER]. Signed by [CLIENT].');
  });

  it('a label that another file of the set holds as text is refused when it is typed', async () => {
    const hook = await loadSet(['a.docx', 'template.docx']);
    let refusal: string | null = null;
    act(() => { refusal = hook.result.current.renameLabel('Jan Kowalski', '[Client]'); });
    expect(refusal).toBe(en.entityTable.labelInText('[CLIENT]'));
    expect(labels(hook)['Jan Kowalski']).toBe('[PERSON_1]');
  });

  it('a label typed before a file joined the set stays where it can be used; the file that holds it as text keeps the number', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    act(() => { hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'); });
    act(() => { hook.result.current.batch.add([file('template.docx')]); });
    await waitFor(() => expect(statuses(hook)['template.docx']).toBe('ready'));
    // a.docx still has the typed label; merely opening the new file changes nothing about that.
    open(hook, 'template.docx');
    expect(labels(hook)['Jan Kowalski']).toBe('[PERSON_1]');
    expect(hook.result.current.renamedOriginals.has('Jan Kowalski')).toBe(false);
    open(hook, 'a.docx');
    expect(labels(hook)['Jan Kowalski']).toBe('[CLIENT]');
    // The table has both labels for the value: each is in a file that went out with it.
    const table = await savedTable(hook);
    expect(table.pairs.filter((pair) => pair.original === 'Jan Kowalski').map((pair) => pair.replacement).sort()).toEqual(['[CLIENT]', '[PERSON_1]']);
    // "[CLIENT]" stands in template.docx as text: in a reply nobody can tell it from the label, so it is not restored.
    const reply = hook.result.current.restoreText('[CLIENT] and [PERSON_1]');
    expect(reply.text).toBe('[CLIENT] and Jan Kowalski');
    expect(reply.stale?.map((item) => [item.label, item.reason])).toEqual([['[CLIENT]', 'textlabel']]);
  });

  it('a type chosen in one file holds in the others', async () => {
    const hook = await loadSet(['a.docx', 'c.docx']);
    act(() => hook.result.current.changeEntityType('jan@example.com', 'OTHER'));
    expect(labels(hook)['jan@example.com']).toBe('[OTHER_1]');
    open(hook, 'c.docx');
    expect(hook.result.current.entities.find((entity) => entity.value === 'jan@example.com')?.type).toBe('OTHER');
    expect(labels(hook)['jan@example.com']).toBe('[OTHER_1]');
    expect(hook.result.current.anonymizedText).toBe('Memo: [PERSON_2] wrote to [OTHER_1] and to [PERSON_3].');
    // Taken back while a file without the value is on the page (the Undo of a message): the set follows.
    act(() => { hook.result.current.batch.add([file('solo.docx')]); });
    await waitFor(() => expect(statuses(hook)['solo.docx']).toBe('ready'));
    open(hook, 'solo.docx');
    act(() => hook.result.current.changeEntityType('jan@example.com', 'EMAIL'));
    open(hook, 'c.docx');
    expect(hook.result.current.entities.find((entity) => entity.value === 'jan@example.com')?.type).toBe('EMAIL');
    expect(labels(hook)['jan@example.com']).toBe('[EMAIL_1]');
    act(() => hook.result.current.changeEntityType('jan@example.com', 'OTHER'));
    expect(labels(hook)['jan@example.com']).toBe('[OTHER_1]');
    // A file added afterwards is analysed with the choice.
    act(() => { hook.result.current.batch.add([new File(['x'], 'Mail jan@example.com now.docx')]); });
    await waitFor(() => expect(hook.result.current.batch.waiting).toBe(0));
    await waitFor(() => expect(hook.result.current.batch.running).toBe(false));
    open(hook, 'Mail jan@example.com now.docx');
    expect(hook.result.current.entities.map((entity) => entity.type)).toEqual(['OTHER']);
    expect(hook.result.current.anonymizedText).toBe('Mail [OTHER_1] now.docx');
  });

  it('typed labels and chosen types are forgotten when the set is cleared', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    act(() => { hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'); });
    act(() => hook.result.current.changeEntityType('jan@example.com', 'OTHER'));
    let cleared = false;
    act(() => { cleared = hook.result.current.batch.clear(); });
    expect(cleared).toBe(true);
    expect(hook.result.current.batch.files).toEqual([]);
    expect(hook.result.current.batch.documentsHeld()).toBe(0);
    expect(hook.result.current.inputText).toBe('');
    expect(hook.result.current.fileName).toBeNull();
    expect(hook.result.current.hasMapping).toBe(false);

    await act(async () => { await hook.result.current.loadFiles([file('a.docx'), file('b.docx')]); });
    await waitFor(() => expect(hook.result.current.batch.activeId).not.toBeNull());
    await waitFor(() => expect(hook.result.current.batch.running).toBe(false));
    // The numbered label of the tab is back, and the detector's own type.
    expect(labels(hook)['Jan Kowalski']).toBe('[PERSON_1]');
    expect(hook.result.current.entities.find((entity) => entity.value === 'jan@example.com')?.type).toBe('EMAIL');
    expect(hook.result.current.renamedOriginals.size).toBe(0);
  });

  it('more pairs than a table holds are refused aloud, never cut', async () => {
    expect(TABLE_MAX_PAIRS).toBe(10_000);
    const hook = await loadSet(['a.docx', 'b.docx', 'c.docx'], { maxTablePairs: 4 });
    // 5 pairs, 4 allowed.
    let table: unknown = 'not called';
    act(() => { table = hook.result.current.exportMapping(); });
    expect(table).toBeNull();
    expect(screen.getByText(text.tooManyPairs('4'))).toBeTruthy();
    // Not marked as saved: nothing was.
    act(() => hook.result.current.markResultTakenOut());
    expect(hook.result.current.tableUnsaved).toBe(true);
    // Nothing is restored with part of a table either.
    let reply: ReturnType<Hook['result']['current']['restoreText']> | undefined;
    act(() => { reply = hook.result.current.restoreText('[PERSON_1] and [PERSON_3]'); });
    expect(reply?.restored).toBe(0);
    expect(reply?.text).toBe('[PERSON_1] and [PERSON_3]');
    let outcome: Awaited<ReturnType<Hook['result']['current']['restoreDocx']>> | undefined;
    await act(async () => { outcome = await hook.result.current.restoreDocx(new File(['x'], 'reply.docx')); });
    expect(outcome).toEqual({ success: false, message: text.tooManyPairs('4') });
    // With one file less the set fits.
    act(() => { hook.result.current.batch.remove(idOf(hook, 'c.docx')); });
    expect((await savedTable(hook)).count).toBe(4);
  });

  it('a file whose labels cannot be kept stable is not given numbers of its own: it fails, with the reason', async () => {
    // Two tables loaded from files reserve 12 000 labels in this tab: more than Core lets the
    // label building hold, so no label can be issued the stable way any more.
    const hook = start();
    await waitFor(() => expect(hook.result.current.modelLoaded).toBe(true));
    for (const batch of [0, 1]) {
      const entries = Array.from({ length: 6000 }, (_, index) => ({
        original: `value ${batch}-${index}`,
        replacement: `[OTHER_${batch * 6000 + index + 1}]`,
        entity_type: 'OTHER',
      }));
      let loaded: unknown;
      await act(async () => { loaded = await hook.result.current.importMapping(new File([JSON.stringify(entries)], `table-${batch}.json`)); });
      expect(loaded).not.toBeNull();
    }
    act(() => hook.result.current.clearImportedMapping());
    await act(async () => { await hook.result.current.loadFiles([file('a.docx'), file('b.docx')]); });
    await waitFor(() => expect(hook.result.current.batch.waiting).toBe(0));
    await waitFor(() => expect(hook.result.current.batch.running).toBe(false));
    expect(statuses(hook)).toEqual({ 'a.docx': 'failed', 'b.docx': 'failed' });
    expect(hook.result.current.batch.files.map((item) => item.reason)).toEqual([text.tooManyPairs('10,000'), text.tooManyPairs('10,000')]);
    // Nothing of them is held, nothing is on the page, nothing can be downloaded.
    expect(hook.result.current.batch.documentsHeld()).toBe(0);
    expect(hook.result.current.batch.files.every((item) => !item.canOpen)).toBe(true);
    expect(hook.result.current.inputText).toBe('');
    expect(hook.result.current.hasMapping).toBe(false);
  });

  it('mergePairs refuses a label that stands for two values in two files, and counts before it cuts', () => {
    const pair = (original: string, replacement: string) => ({ original, replacement, entityType: 'PERSON' as EntityType });
    expect(mergePairs([[pair('A', '[PERSON_1]')], [pair('A', '[PERSON_1]'), pair('B', '[PERSON_2]')]])).toEqual({
      ok: true,
      pairs: [pair('A', '[PERSON_1]'), pair('B', '[PERSON_2]')],
    });
    expect(mergePairs([[pair('A', '[PERSON_1]')], [pair('B', '[PERSON_1]')]])).toEqual({ ok: false, reason: 'conflict', label: '[PERSON_1]' });
    expect(mergePairs([[pair('A', '[PERSON_1]')], [pair('B', '[PERSON_2]')]], 1)).toEqual({ ok: false, reason: 'too-many', count: 2 });
  });

  it('the reminder and the question before removing are about the set as a whole', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    expect(hook.result.current.tableUnsaved).toBe(false);
    expect(hook.result.current.tableReminder).toBe(false);
    await download(hook);
    expect(hook.result.current.tableUnsaved).toBe(true);
    expect(hook.result.current.tableReminder).toBe(true);
    // Another file on the page: its own result never left, the set's table is still at risk.
    open(hook, 'b.docx');
    expect(hook.result.current.tableUnsaved).toBe(true);
    expect(hook.result.current.tableReminder).toBe(true);
    // Closing the tab now asks first.
    const leaving = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leaving()).toBe(true);
    expect(hook.result.current.resultTakenOut).toBe(true);
    expect(hook.result.current.batch.files.map((item) => item.takenOut)).toEqual([true, false]);

    await savedTable(hook);
    expect(hook.result.current.tableUnsaved).toBe(false);
    expect(hook.result.current.tableReminder).toBe(false);
    expect(leaving()).toBe(false);
    // Looking at the files changes nothing: the saved table stays the table.
    const shown = { count: hook.result.current.mappingCount, sample: hook.result.current.mappingSample };
    const version = hook.result.current.tableVersion;
    open(hook, 'a.docx');
    open(hook, 'b.docx');
    open(hook, 'a.docx');
    expect(hook.result.current.tableUnsaved).toBe(false);
    expect(hook.result.current.tableVersion).toBe(version);
    expect(screen.queryByText(en.textOutput.changedAfterTaken)).toBeNull();
    // The restore panel sees the same table whichever file is open.
    open(hook, 'b.docx');
    expect({ count: hook.result.current.mappingCount, sample: hook.result.current.mappingSample }).toEqual(shown);
    expect(leaving()).toBe(false);

    // A change in a file that never left the page: the set's table is not the saved one any more.
    open(hook, 'b.docx');
    act(() => hook.result.current.toggleEntity(0));
    expect(hook.result.current.tableUnsaved).toBe(true);
    expect(hook.result.current.tableVersion).toBeGreaterThan(version);
    // b.docx itself is not out, so nothing is said about a copy.
    expect(screen.queryByText(en.textOutput.changedAfterTaken)).toBeNull();
    // A label typed here changes a.docx, which IS out: that is said.
    act(() => { hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'); });
    expect(screen.getByText(en.textOutput.changedAfterTaken)).toBeTruthy();
  });
});

describe('removing', () => {
  it('a removed file is gone from the list, from memory and from the table; the next one comes on the page', async () => {
    const hook = await loadSet(['a.docx', 'b.docx', 'c.docx']);
    expect(hook.result.current.batch.documentsHeld()).toBe(3);
    // A file that is not open.
    act(() => { hook.result.current.batch.remove(idOf(hook, 'c.docx')); });
    expect(hook.result.current.batch.files.map((item) => item.name)).toEqual(['a.docx', 'b.docx']);
    expect(hook.result.current.batch.documentsHeld()).toBe(2);
    expect(hook.result.current.fileName).toBe('a.docx');
    const table = await savedTable(hook);
    expect(table.pairs.map((pair) => pair.original)).toEqual(['Jan Kowalski', 'Acme Ltd', 'jan@example.com', 'Maria Nowak']);
    expect(hook.result.current.restoreText('[PERSON_3]').restored).toBe(0);

    // The open file: the one after it comes on the page.
    act(() => hook.result.current.removeFile());
    expect(hook.result.current.batch.files.map((item) => item.name)).toEqual(['b.docx']);
    expect(hook.result.current.batch.documentsHeld()).toBe(1);
    expect(hook.result.current.fileName).toBe('b.docx');
    expect(hook.result.current.inputText).toBe(TEXTS['b.docx']);
    expect(hook.result.current.anonymizedText).toBe('Invoice for [COMPANY_1], attention [PERSON_2]. Signed by [PERSON_1].');
    expect((await savedTable(hook)).pairs.map((pair) => pair.original).sort()).toEqual(['Acme Ltd', 'Jan Kowalski', 'Maria Nowak']);

    // The last file takes the set with it.
    act(() => hook.result.current.removeFile());
    expect(hook.result.current.batch.files).toEqual([]);
    expect(hook.result.current.batch.documentsHeld()).toBe(0);
    expect(hook.result.current.fileName).toBeNull();
    expect(hook.result.current.inputText).toBe('');
    expect(hook.result.current.entities).toEqual([]);
    expect(hook.result.current.hasDocxExtraction).toBe(false);
    expect(hook.result.current.hasMapping).toBe(false);
  });

  it('Clear on the page clears the set', async () => {
    const hook = await loadSet(['a.docx', 'b.docx']);
    act(() => hook.result.current.clear());
    expect(hook.result.current.batch.files).toEqual([]);
    expect(hook.result.current.batch.documentsHeld()).toBe(0);
    expect(hook.result.current.inputText).toBe('');
    // The page takes text again.
    act(() => hook.result.current.handleInputChange('Hello Jan Kowalski'));
    expect(hook.result.current.inputText).toBe('Hello Jan Kowalski');
  });
});

describe('the status of a file', () => {
  const record = (patch: Partial<BatchFileRecord>): BatchFileRecord => ({ id: 'x', name: 'x.docx', stage: 'done', opened: false, summary: { analysed: true, pending: false, found: 2, takenOut: false, pairs: [] }, ...patch });
  it('follows what happened to it', () => {
    expect(statusOf(record({ stage: 'waiting', summary: null }))).toBe('waiting');
    expect(statusOf(record({ stage: 'reading', summary: null }))).toBe('reading');
    expect(statusOf(record({ stage: 'analysing', summary: null }))).toBe('analysing');
    expect(statusOf(record({ stage: 'failed', summary: null, reason: 'x' }))).toBe('failed');
    expect(statusOf(record({}))).toBe('ready');
    expect(statusOf(record({ opened: true }))).toBe('opened');
    expect(statusOf(record({ opened: true, summary: { analysed: true, pending: false, found: 2, takenOut: true, pairs: [] } }))).toBe('downloaded');
    // Parts that cannot be redacted come first, also for a file that was downloaded before the writer found them.
    expect(statusOf(record({ opened: true, summary: { analysed: true, pending: true, found: 2, takenOut: true, pairs: [] } }))).toBe('needs-decision');
    expect(statusOf(record({ summary: { analysed: false, pending: false, found: 0, takenOut: false, pairs: [] } }))).toBe('needs-decision');
    expect(statusOf(record({ reason: 'the analysis failed', summary: { analysed: false, pending: false, found: 0, takenOut: false, pairs: [] } }))).toBe('failed');
  });
});
