// T177 founder decision (web side, T188): parts DocCloak cannot redact are
// reported, not refused. The notice lists them in plain language; Cancel
// removes the file, Continue lets the export run with allowUnredactable.
// Typed refusal codes (T177/T178) map to translated messages with a remedy.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DocxExtraction, UnredactablePart } from '@doccloak/core/dom';
import { UnsupportedDocumentError } from '@doccloak/core/dom';
import type { UnsupportedDocumentCode } from '@doccloak/core/dom';
import { UnredactableNotice } from '../../src/ui/components/UnredactableNotice.tsx';
import { TextInput } from '../../src/ui/components/TextInput.tsx';
import { useAnonymizer, fileErrorMessage, UNPACKED_SIZE_LIMIT_LABEL, PDF_SIZE_LIMIT_LABEL } from '../../src/ui/hooks/useAnonymizer.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests } from '../../src/engine.ts';

const mocks = vi.hoisted(() => ({
  readDocx: vi.fn(),
  writeAnonymizedDocxWithReport: vi.fn(),
  readDocText: vi.fn(),
  inspectDoc: vi.fn(),
}));

vi.mock('@doccloak/core/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@doccloak/core/dom')>();
  return {
    ...actual,
    readDocx: (...args: unknown[]) => mocks.readDocx(...args),
    writeAnonymizedDocxWithReport: (...args: unknown[]) => mocks.writeAnonymizedDocxWithReport(...args),
  };
});

vi.mock('@doccloak/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@doccloak/core')>();
  return {
    ...actual,
    readDocText: (...args: unknown[]) => mocks.readDocText(...args),
    inspectDoc: (...args: unknown[]) => mocks.inspectDoc(...args),
  };
});

const ITEMS: UnredactablePart[] = [
  { part: 'word/embeddings/oleObject1.bin', kind: 'embedded-object', label: 'embedded Excel sheet' },
  { part: 'word/vbaProject.bin', kind: 'macros', label: 'macros' },
  { part: 'word/afchunk.mht', kind: 'html-chunk', label: 'HTML chunk' },
  { part: 'xl/connections.xml', kind: 'external-data', label: 'external data connection' },
  { part: 'word/printerSettings/printerSettings1.bin', kind: 'printer-settings', label: 'printer settings' },
  { part: 'word/mystery.bin', kind: 'unknown', label: 'unknown part' },
];

function extraction(overrides: Partial<DocxExtraction> = {}): DocxExtraction {
  return {
    plainText: 'Hello Jan Kowalski, welcome.',
    empty: false,
    unredactable: [],
    warnings: [],
    ...overrides,
  } as unknown as DocxExtraction;
}

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

// jsdom's Blob has no arrayBuffer(); the legacy .doc path needs it.
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  mocks.readDocx.mockReset();
  mocks.writeAnonymizedDocxWithReport.mockReset();
  mocks.readDocText.mockReset();
  mocks.inspectDoc.mockReset();
  // No worker in jsdom; the hook must not need one for file handling.
  _setClientFactoryForTests(() => { throw new Error('worker must not be spawned in this test'); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

describe('UnredactableNotice', () => {
  it('renders every item with its plain-language label and the part name', () => {
    render(<Providers><UnredactableNotice items={ITEMS} decided={false} onContinue={() => {}} onCancel={() => {}} /></Providers>);
    expect(screen.getByText(en.unredactable.title)).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.body)).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.kinds['embedded-object'])).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.kinds.macros)).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.kinds['html-chunk'])).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.kinds['external-data'])).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.kinds['printer-settings'])).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.kinds.unknown('word/mystery.bin'))).toBeInTheDocument();
    expect(screen.getByText('word/embeddings/oleObject1.bin')).toBeInTheDocument();
  });

  it('Cancel calls onCancel, Continue calls onContinue', () => {
    const onCancel = vi.fn();
    const onContinue = vi.fn();
    render(<Providers><UnredactableNotice items={ITEMS.slice(0, 1)} decided={false} onContinue={onContinue} onCancel={onCancel} /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: en.unredactable.cancel }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onContinue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en.unredactable.continue }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('after Continue the buttons are gone and the reminder stays; warnings render as a note', () => {
    render(
      <Providers>
        <UnredactableNotice items={ITEMS.slice(0, 1)} warnings={['word/glossary/document.xml: not well-formed XML, skipped by the text extractor']} decided onContinue={() => {}} onCancel={() => {}} />
      </Providers>,
    );
    expect(screen.queryByRole('button', { name: en.unredactable.continue })).toBeNull();
    expect(screen.queryByRole('button', { name: en.unredactable.cancel })).toBeNull();
    expect(screen.getByText(en.unredactable.continued)).toBeInTheDocument();
    expect(screen.getByText(en.unredactable.warningsTitle)).toBeInTheDocument();
    expect(screen.getByText(/not well-formed XML/)).toBeInTheDocument();
  });

  it('renders nothing without items or warnings', () => {
    const { container } = render(<Providers><UnredactableNotice items={[]} decided={false} onContinue={() => {}} onCancel={() => {}} /></Providers>);
    expect(container.querySelector('[data-testid="unredactable-notice"]')).toBeNull();
  });
});

describe('useAnonymizer informed-consent export', () => {
  it('a .docx with unredactable parts blocks export until Continue, which passes allowUnredactable to the writer', async () => {
    mocks.readDocx.mockResolvedValue(extraction({ unredactable: ITEMS.slice(0, 2), warnings: ['w1'] }));
    mocks.writeAnonymizedDocxWithReport.mockResolvedValue({ blob: new Blob(['ok']), warnings: [] });
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });

    let loaded: { success: boolean } | undefined;
    await act(async () => { loaded = await result.current.loadFile(new File(['x'], 'report.docx')); });
    expect(loaded?.success).toBe(true);
    expect(result.current.unredactableItems).toEqual(ITEMS.slice(0, 2));
    expect(result.current.fileWarnings).toEqual(['w1']);
    expect(result.current.unredactablePending).toBe(true);
    expect(result.current.allowUnredactable).toBe(false);

    // Something to export: a manual entity over "Jan Kowalski".
    act(() => { result.current.addManualEntity(6, 18, 'PERSON'); });
    await waitFor(() => expect(result.current.entries.length).toBe(1));

    await expect(result.current.exportDocx()).rejects.toThrow(/not been confirmed/);
    expect(mocks.writeAnonymizedDocxWithReport).not.toHaveBeenCalled();

    act(() => { result.current.continueWithUnredactable(); });
    expect(result.current.allowUnredactable).toBe(true);
    expect(result.current.unredactablePending).toBe(false);

    const blob = await result.current.exportDocx();
    expect(blob).toBeInstanceOf(Blob);
    expect(mocks.writeAnonymizedDocxWithReport).toHaveBeenCalledTimes(1);
    const [, replacements, valueReplacements, options] = mocks.writeAnonymizedDocxWithReport.mock.calls[0];
    expect(replacements).toEqual([{ start: 6, end: 18, replacement: '[PERSON_1]' }]);
    expect(valueReplacements).toEqual([{ value: 'Jan Kowalski', replacement: '[PERSON_1]' }]);
    expect(options).toEqual({ allowUnredactable: true });
  });

  it('a clean .docx exports with allowUnredactable: false and no notice', async () => {
    mocks.readDocx.mockResolvedValue(extraction());
    mocks.writeAnonymizedDocxWithReport.mockResolvedValue({ blob: new Blob(['ok']), warnings: [] });
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['x'], 'clean.docx')); });
    expect(result.current.unredactablePending).toBe(false);
    act(() => { result.current.addManualEntity(6, 18, 'PERSON'); });
    await waitFor(() => expect(result.current.entries.length).toBe(1));
    await result.current.exportDocx();
    expect(mocks.writeAnonymizedDocxWithReport.mock.calls[0][3]).toEqual({ allowUnredactable: false });
  });

  it('Cancel (removeFile) drops the file and the pending decision', async () => {
    mocks.readDocx.mockResolvedValue(extraction({ unredactable: ITEMS.slice(0, 1) }));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['x'], 'report.docx')); });
    expect(result.current.unredactablePending).toBe(true);
    act(() => { result.current.removeFile(); });
    expect(result.current.unredactableItems).toEqual([]);
    expect(result.current.unredactablePending).toBe(false);
    expect(result.current.fileName).toBeNull();
    expect(result.current.inputText).toBe('');
  });

  it('a legacy .doc with ObjectPool and Macros streams shows the same notice', async () => {
    mocks.readDocx.mockRejectedValue(new UnsupportedDocumentError('invalid-package'));
    mocks.readDocText.mockReturnValue('Hello Jan Kowalski from a .doc');
    mocks.inspectDoc.mockReturnValue({ encrypted: false, fastSaved: false, streams: { data: true, objectPool: true, macros: true } });
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await result.current.loadFile(new File(['x'], 'legacy.doc')); });
    expect(result.current.unredactableItems.map((i) => i.kind)).toEqual(['embedded-object', 'macros']);
    expect(result.current.unredactablePending).toBe(true);
  });

  it('an empty document is refused with the empty-document code', async () => {
    mocks.readDocx.mockResolvedValue(extraction({ plainText: '   ', empty: true }));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    let loaded: { success: boolean; code?: string; message?: string } | undefined;
    await act(async () => { loaded = await result.current.loadFile(new File(['x'], 'empty.docx')); });
    expect(loaded).toMatchObject({ success: false, code: 'empty-document', message: en.fileErrors['empty-document'] });
  });
});

describe('UnsupportedDocumentError code mapping (T177/T178)', () => {
  const CODES: UnsupportedDocumentCode[] = [
    'unrecognized-namespace', 'invalid-package', 'too-large', 'fast-saved', 'encrypted', 'unredactable-parts',
  ];

  it('every code has a translated message with a remedy in all 8 languages (no em dashes)', () => {
    expect(languages).toHaveLength(8);
    for (const lang of languages) {
      const t = lang.translations;
      for (const code of CODES) {
        const msg = fileErrorMessage(t, code);
        expect(msg.length, `${lang.code}:${code}`).toBeGreaterThan(20);
        expect(msg.includes(String.fromCharCode(0x2014))).toBe(false);
      }
      expect(fileErrorMessage(t, 'too-large')).toContain(UNPACKED_SIZE_LIMIT_LABEL);
      // PDFs quote Core's PDF caps, not the docx unpacked-size limit.
      expect(fileErrorMessage(t, 'too-large', 'pdf')).toContain(PDF_SIZE_LIMIT_LABEL);
      expect(fileErrorMessage(t, 'too-large', 'pdf')).not.toContain(UNPACKED_SIZE_LIMIT_LABEL);
      // A damaged PDF must not be told to open the file in Word and save it as .docx.
      expect(fileErrorMessage(t, 'invalid-package', 'pdf')).not.toMatch(/docx|Word/);
      expect(fileErrorMessage(t, 'invalid-package', 'pdf').length).toBeGreaterThan(20);
      expect(fileErrorMessage(t, 'empty-document').length).toBeGreaterThan(5);
      expect(t.consent.forModel('GLiNER PII Small', 83)).toContain('GLiNER PII Small');
      expect(t.consent.forModel('GLiNER PII Small', 83)).toContain('83');
      expect(t.detect.timeout.length).toBeGreaterThan(20);
      expect(t.unredactable.kinds.unknown('word/x.bin')).toContain('word/x.bin');
    }
  });

  it.each(CODES)('loadFile maps a %s refusal from the .docx reader to its translated text', async (code) => {
    mocks.readDocx.mockRejectedValue(new UnsupportedDocumentError(code, 'raw core message'));
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    let loaded: { success: boolean; code?: string; message?: string; error?: string } | undefined;
    await act(async () => { loaded = await result.current.loadFile(new File(['x'], 'file.docx')); });
    expect(loaded).toMatchObject({ success: false, code, message: fileErrorMessage(en, code), error: 'raw core message' });
  });

  it.each(['fast-saved', 'encrypted'] as const)('loadFile surfaces readDocText\'s %s refusal for a legacy .doc', async (code) => {
    mocks.readDocx.mockRejectedValue(new Error('not a zip'));
    mocks.readDocText.mockImplementation(() => { throw new UnsupportedDocumentError(code); });
    const { result } = renderHook(() => useAnonymizer(), { wrapper: Providers });
    let loaded: { success: boolean; code?: string; message?: string } | undefined;
    await act(async () => { loaded = await result.current.loadFile(new File(['x'], 'old.doc')); });
    expect(loaded).toMatchObject({ success: false, code, message: en.fileErrors[code] });
    expect(mocks.inspectDoc).not.toHaveBeenCalled();
  });

  it('TextInput shows the mapped message when a code is present and the raw text otherwise', async () => {
    const onLoadFile = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'raw core message', code: 'encrypted', message: en.fileErrors.encrypted })
      .mockResolvedValueOnce({ success: false, error: 'Something odd happened' });
    const { container } = render(
      <Providers>
        <TextInput value="" onChange={() => {}} onClear={() => {}} entities={[]} onLoadFile={onLoadFile} />
      </Providers>,
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(['x'], 'secret.doc')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(en.fileErrors.encrypted);

    fireEvent.change(input, { target: { files: [new File(['x'], 'odd.docx')] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Something odd happened'));
  });
});
