// WLojek/DocCloak#3: the docx an assistant edited gets its original names
// back (formatting kept, unknown placeholders listed), and the replacement
// table can be saved and loaded again so the restore also works after the
// tab that made it was closed. Real Core, real docx packages; only the
// detection worker is faked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import JSZip from 'jszip';
import type { DetectedEntity, EngineClient } from '@doccloak/core';
import { readDocx } from '@doccloak/core/dom';
import { DeAnonymize } from '../../src/ui/components/DeAnonymize.tsx';
import {
  useAnonymizer,
  restoredDownloadName,
  mappingDownloadName,
  MAPPING_MAX_BYTES,
  type RestoreDocxResult,
} from '../../src/ui/hooks/useAnonymizer.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

// jsdom's Blob has neither arrayBuffer() nor text(); Core and the hook read files through them.
function readBlob(blob: Blob, as: 'buffer' | 'text'): Promise<ArrayBuffer | string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer | string);
    reader.onerror = () => reject(reader.error);
    if (as === 'buffer') reader.readAsArrayBuffer(blob);
    else reader.readAsText(blob);
  });
}
if (typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) { return readBlob(this, 'buffer') as Promise<ArrayBuffer>; };
}
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob) { return readBlob(this, 'text') as Promise<string>; };
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

async function docxFile(bodyXml: string, name = 'contract_redacted.docx'): Promise<File> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL}">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}"><w:body>${bodyXml}</w:body></w:document>`);
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], name);
}

const TEXT = 'Jan Kowalski of Acme Ltd met Anna Nowak. Write to jan@acme.example.';

function entity(type: DetectedEntity['type'], value: string): DetectedEntity {
  const start = TEXT.indexOf(value);
  return { type, value, start, end: start + value.length, confidence: 0.9, detector: 'test' };
}
const ENTITIES = [
  entity('PERSON', 'Jan Kowalski'),
  entity('COMPANY', 'Acme Ltd'),
  entity('PERSON', 'Anna Nowak'),
  entity('EMAIL', 'jan@acme.example'),
];

function fakeFactory() {
  const client = {
    preload: () => Promise.resolve(),
    detect: () => Promise.resolve(ENTITIES.map((e) => ({ ...e }))),
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

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  _setClientFactoryForTests(fakeFactory);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

async function redacted() {
  const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
  act(() => hook.result.current.handleInputChange(TEXT));
  act(() => hook.result.current.anonymize());
  await waitFor(() => expect(hook.result.current.entities).toHaveLength(ENTITIES.length));
  return hook;
}

const EDITED = `
  <w:p>
    <w:r><w:t xml:space="preserve">Summary for </w:t></w:r>
    <w:r><w:rPr><w:b/></w:rPr><w:t>[PER</w:t></w:r>
    <w:r><w:rPr><w:b/></w:rPr><w:t>SON_1]</w:t></w:r>
    <w:r><w:t xml:space="preserve"> and [person_2] of [COMPANY_1].</w:t></w:r>
  </w:p>
  <w:p><w:r><w:t>Also ask [PERSON_9], see [Table 1].</w:t></w:r></w:p>`;

describe('useAnonymizer.restoreDocx (WLojek/DocCloak#3)', () => {
  it('puts the originals back, keeps the runs and lists what it does not know', async () => {
    const hook = await redacted();
    let outcome: RestoreDocxResult | undefined;
    await act(async () => { outcome = await hook.result.current.restoreDocx(await docxFile(EDITED)); });
    if (!outcome?.success) throw new Error('restore failed');
    expect(outcome.restored).toBe(3);
    expect(outcome.unresolved).toEqual(['[PERSON_9]']);
    // A label stayed in the file, and the name of the download says so.
    expect(outcome.downloadName).toBe('contract_partly-restored.docx');
    expect(outcome.blob).not.toBeNull();

    const written = await readDocx(new File([await (outcome.blob as Blob).arrayBuffer()], 'r.docx'));
    expect(written.plainText).toBe('Summary for Jan Kowalski and Anna Nowak of Acme Ltd.\nAlso ask [PERSON_9], see [Table 1].');
    const xml = await (await JSZip.loadAsync(await (outcome.blob as Blob).arrayBuffer())).file('word/document.xml')!.async('string');
    expect(xml).toMatch(/<w:b\/><\/w:rPr><w:t[^>]*>Jan Kowalski<\/w:t>/);
  });

  it('leaves the working document, the detections and the table as they were', async () => {
    const hook = await redacted();
    const before = {
      input: hook.result.current.inputText,
      output: hook.result.current.anonymizedText,
      entities: hook.result.current.entities,
      entries: hook.result.current.entries,
      file: hook.result.current.fileName,
    };
    await act(async () => { await hook.result.current.restoreDocx(await docxFile(EDITED)); });
    expect(hook.result.current.inputText).toBe(before.input);
    expect(hook.result.current.anonymizedText).toBe(before.output);
    expect(hook.result.current.entities).toBe(before.entities);
    expect(hook.result.current.entries).toBe(before.entries);
    expect(hook.result.current.fileName).toBe(before.file);
    expect(hook.result.current.hasDocxExtraction).toBe(false);
  });

  it('a file without any placeholder of the table gives nothing to download', async () => {
    const hook = await redacted();
    let outcome: RestoreDocxResult | undefined;
    await act(async () => {
      outcome = await hook.result.current.restoreDocx(await docxFile('<w:p><w:r><w:t>Plain text, [Table 1].</w:t></w:r></w:p>'));
    });
    expect(outcome).toMatchObject({ success: true, restored: 0, unresolved: [], blob: null });
  });

  it('refuses other formats and unreadable files with a remedy', async () => {
    const hook = await redacted();
    let outcome: RestoreDocxResult | undefined;
    await act(async () => { outcome = await hook.result.current.restoreDocx(new File(['x'], 'reply.pdf')); });
    expect(outcome).toEqual({ success: false, message: en.deAnonymize.docxOnlyDocx });
    await act(async () => { outcome = await hook.result.current.restoreDocx(new File(['x'], 'old.doc')); });
    expect(outcome).toEqual({ success: false, message: en.deAnonymize.docxOnlyDocx });
    await act(async () => { outcome = await hook.result.current.restoreDocx(new File(['not a zip'], 'broken.docx')); });
    expect(outcome?.success).toBe(false);
    expect([en.fileErrors['invalid-package'], en.deAnonymize.docxFailed]).toContain((outcome as { message: string }).message);
  });

  it('uses the renamed label the user chose', async () => {
    const hook = await redacted();
    act(() => hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'));
    let outcome: RestoreDocxResult | undefined;
    await act(async () => {
      outcome = await hook.result.current.restoreDocx(await docxFile('<w:p><w:r><w:t>[CLIENT] signed, [PERSON_1] did not.</w:t></w:r></w:p>'));
    });
    if (!outcome?.success) throw new Error('restore failed');
    expect(outcome.restored).toBe(1);
    expect(outcome.unresolved).toEqual(['[PERSON_1]']);
  });
});

describe('replacement table as a file (WLojek/DocCloak#3)', () => {
  it('saves the current table in the format the command line reads', async () => {
    const hook = await redacted();
    const table = hook.result.current.exportMapping();
    expect(table?.count).toBe(4);
    expect(table?.downloadName).toMatch(/^doccloak_replacement-table_\d{4}-\d{2}-\d{2}_\d{6}\.json$/);
    const saved = JSON.parse(await (table as { blob: Blob }).blob.text()) as unknown[];
    expect(saved).toHaveLength(4);
    expect(saved).toEqual(expect.arrayContaining([
      { original: 'Jan Kowalski', replacement: '[PERSON_1]', entity_type: 'PERSON' },
      { original: 'Acme Ltd', replacement: '[COMPANY_1]', entity_type: 'COMPANY' },
      { original: 'Anna Nowak', replacement: '[PERSON_2]', entity_type: 'PERSON' },
      { original: 'jan@acme.example', replacement: '[EMAIL_1]', entity_type: 'EMAIL' },
    ]));
  });

  it('has nothing to save before a redaction', () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    expect(hook.result.current.exportMapping()).toBeNull();
  });

  it('a saved table restores in a fresh session, text and docx', async () => {
    const first = await redacted();
    const saved = await (first.result.current.exportMapping() as { blob: Blob }).blob.text();
    first.unmount();

    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    expect(hook.result.current.deanonymize('[PERSON_1] signed')).toBe('[PERSON_1] signed');
    let imported: unknown;
    await act(async () => { imported = await hook.result.current.importMapping(new File([saved], 'contract_replacement-table.json')); });
    expect(imported).toMatchObject({ fileName: 'contract_replacement-table.json', count: 4 });
    // One real pair travels with the table so the panel can show whose table it is.
    const sample = (imported as { sample: { replacement: string; original: string } }).sample;
    expect(hook.result.current.restoreText(sample.replacement).text).toBe(sample.original);
    expect(hook.result.current.importedMapping).toEqual(imported);
    expect(hook.result.current.deanonymize('[PERSON_1] wrote to [EMAIL_1]')).toBe('Jan Kowalski wrote to jan@acme.example');
    // Nothing of the working state appears: the table only restores.
    expect(hook.result.current.entries).toEqual([]);
    expect(hook.result.current.entities).toEqual([]);

    let outcome: RestoreDocxResult | undefined;
    await act(async () => { outcome = await hook.result.current.restoreDocx(await docxFile(EDITED)); });
    expect(outcome).toMatchObject({ success: true, restored: 3, unresolved: ['[PERSON_9]'] });

    act(() => hook.result.current.clearImportedMapping());
    expect(hook.result.current.importedMapping).toBeNull();
    expect(hook.result.current.deanonymize('[PERSON_1] signed')).toBe('[PERSON_1] signed');
  });

  it('a loaded table wins over the current document until the next redaction', async () => {
    const hook = await redacted();
    const other = JSON.stringify([{ original: 'Maria Lis', replacement: '[PERSON_1]', entity_type: 'PERSON' }]);
    await act(async () => { await hook.result.current.importMapping(new File([other], 'other.json')); });
    expect(hook.result.current.deanonymize('[PERSON_1]')).toBe('Maria Lis');
    // The working document keeps its own table: exports and the list do not change.
    expect(hook.result.current.entries).toHaveLength(4);
    expect(hook.result.current.anonymizedText).toContain('[PERSON_1] of [COMPANY_1]');

    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.importedMapping).toBeNull());
    // Said out loud: the restore now uses another table than a moment ago.
    expect(screen.getByText(en.deAnonymize.tableDroppedToast)).toBeInTheDocument();
    await waitFor(() => expect(hook.result.current.deanonymize('[PERSON_1]')).toBe('Jan Kowalski'));
  });

  it('pasted text: reports how many places changed and which labels stayed', async () => {
    const hook = await redacted();
    expect(hook.result.current.restoreText('[PERSON_1] wrote to [EMAIL_1] and [person_2]; ask [PERSON_9], see [Table 1].')).toEqual({
      text: 'Jan Kowalski wrote to jan@acme.example and Anna Nowak; ask [PERSON_9], see [Table 1].',
      restored: 3,
      unresolved: ['[PERSON_9]'],
      // The same text in pieces: what came back and what stayed can be marked in the panel.
      segments: [
        { text: 'Jan Kowalski', kind: 'restored' },
        { text: ' wrote to ', kind: 'plain' },
        { text: 'jan@acme.example', kind: 'restored' },
        { text: ' and ', kind: 'plain' },
        { text: 'Anna Nowak', kind: 'restored' },
        { text: '; ask ', kind: 'plain' },
        { text: '[PERSON_9]', kind: 'leftover' },
        { text: ', see [Table 1].', kind: 'plain' },
      ],
      // Not a label this tab issued, and not known to be a label at all: listed apart, without a verdict.
      stale: [],
      others: ['[Table 1]'],
      fileOverDocument: false,
    });
    expect(hook.result.current.restoreText('Nothing here.')).toEqual({
      text: 'Nothing here.', restored: 0, unresolved: [], segments: [{ text: 'Nothing here.', kind: 'plain' }], stale: [], others: [], fileOverDocument: false,
    });
    // A label of a kind the table does not hold at all is still a label that stayed (no false all-clear).
    expect(hook.result.current.restoreText('Paid by [COMPANY_7].').unresolved).toEqual(['[COMPANY_7]']);
  });

  it('refuses a file that is not a replacement table', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    const refused = [
      new File(['hello'], 'notes.json'),
      new File(['{"a":1}'], 'object.json'),
      new File(['[]'], 'empty.json'),
      new File([JSON.stringify([{ original: 'x', replacement: '', entity_type: 'PERSON' }])], 'blank.json'),
      new File([JSON.stringify([{ original: 'x' }])], 'partial.json'),
    ];
    for (const file of refused) {
      let imported: unknown = 'unset';
      await act(async () => { imported = await hook.result.current.importMapping(file); });
      expect(imported, file.name).toBeNull();
    }
    expect(hook.result.current.importedMapping).toBeNull();

    const big = new File(['[]'], 'big.json');
    Object.defineProperty(big, 'size', { value: MAPPING_MAX_BYTES + 1 });
    let imported: unknown = 'unset';
    await act(async () => { imported = await hook.result.current.importMapping(big); });
    expect(imported).toBeNull();
  });

  it('names the downloads after the file', () => {
    expect(restoredDownloadName('contract_redacted.docx')).toBe('contract_restored.docx');
    expect(restoredDownloadName('Reply from AI.DOCX')).toBe('Reply from AI_restored.docx');
    expect(restoredDownloadName(null)).toBe('document_restored.docx');
    // A file that still holds labels is not called restored.
    expect(restoredDownloadName('contract_redacted.docx', true)).toBe('contract_partly-restored.docx');
    // Document and moment in the name: every table holds a [PERSON_1], the name tells them apart.
    const at = new Date(2026, 10, 12, 9, 5, 7);
    expect(mappingDownloadName('contract.docx', at)).toBe('contract_replacement-table_2026-11-12_090507.json');
    expect(mappingDownloadName('scan.final.pdf', at)).toBe('scan.final_replacement-table_2026-11-12_090507.json');
    expect(mappingDownloadName(null, at)).toBe('doccloak_replacement-table_2026-11-12_090507.json');
  });
});

describe('DeAnonymize panel', () => {
  const DONE: RestoreDocxResult = {
    success: true,
    restored: 37,
    unresolved: ['[PERSON_9]', '[COMPANY_7]'],
    blob: new Blob(['docx']),
    downloadName: 'reply_restored.docx',
  };
  const SAMPLE = { replacement: '[PERSON_1]', original: 'Jan Kowalski' };

  function renderPanel(overrides: Partial<Parameters<typeof DeAnonymize>[0]> = {}) {
    const props = {
      onRestoreText: vi.fn((text: string) => {
        const [before, after] = text.split('[PERSON_1]');
        return {
          text: text.replace('[PERSON_1]', 'Jan Kowalski'),
          restored: 1,
          unresolved: [] as string[],
          segments: [
            ...(before ? [{ text: before, kind: 'plain' as const }] : []),
            { text: 'Jan Kowalski', kind: 'restored' as const },
            ...(after ? [{ text: after, kind: 'plain' as const }] : []),
          ],
        };
      }),
      hasMapping: true,
      mappingCount: 4,
      mappingSample: SAMPLE,
      onRestoreDocx: vi.fn(async () => DONE),
      onExportMapping: vi.fn(() => ({ blob: new Blob(['[]']), count: 4, downloadName: 'contract_replacement-table_2026-11-12_090507.json' })),
      onImportMapping: vi.fn(async () => ({ fileName: 'saved.json', count: 9, sample: { replacement: '[PERSON_1]', original: 'Maria Lis' } })),
      importedMapping: null,
      onClearImportedMapping: vi.fn(),
      onDownload: vi.fn(),
      ...overrides,
    };
    render(<Providers><DeAnonymize {...props} /></Providers>);
    return props;
  }

  function choose(testId: string, file: File) {
    fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } });
  }

  it('goes from "no table yet" to the full panel in place (the first Redact), and the report stands above the restored text', () => {
    // The panel is on the page before the first redaction, with only the way in for a saved table.
    // A hook placed after that early return broke the whole page at the first Redact (caught on the
    // preview by the acceptance run, not by these tests: nothing rendered the panel both ways).
    const base = {
      onRestoreText: vi.fn(() => ({ text: 'Jan Kowalski signs.', restored: 1, unresolved: ['Person 2'], segments: [{ text: 'Jan Kowalski', kind: 'restored' as const }, { text: ' signs.', kind: 'plain' as const }], stale: [{ label: 'Person 2', original: 'Anna Nowak', reason: 'unread' as const }] })),
      mappingCount: 4,
      mappingSample: SAMPLE,
      onRestoreDocx: vi.fn(async () => DONE),
      onExportMapping: vi.fn(() => null),
      onImportMapping: vi.fn(async () => null),
      importedMapping: null,
      onClearImportedMapping: vi.fn(),
      onDownload: vi.fn(),
    };
    const view = render(<Providers><DeAnonymize {...base} hasMapping={false} /></Providers>);
    expect(screen.getByTestId('restore-load-table')).toBeInTheDocument();
    view.rerender(<Providers><DeAnonymize {...base} hasMapping /></Providers>);
    expect(screen.queryByTestId('restore-load-table')).toBeNull();
    fireEvent.change(document.querySelector('textarea')!, { target: { value: '[PERSON_1] signs.' } });
    fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.restoreButton }));
    const status = screen.getByTestId('restore-text-status');
    const result = screen.getByTestId('restore-text-result');
    expect(status.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status).toHaveTextContent(en.deAnonymize.unreadLabel('Person 2', 'Anna Nowak'));
    // And back: the table is gone (Clear), the panel is the small one again.
    view.rerender(<Providers><DeAnonymize {...base} hasMapping={false} /></Providers>);
    expect(screen.getByTestId('restore-load-table')).toBeInTheDocument();
  });

  it('without a table only offers to load one saved earlier', async () => {
    const props = renderPanel({ hasMapping: false, mappingCount: 0, mappingSample: null, onImportMapping: vi.fn(async () => null) });
    expect(screen.getByTestId('restore-load-table')).toHaveTextContent(en.deAnonymize.loadEarlier);
    expect(screen.queryByTestId('restore-docx')).toBeNull();
    expect(screen.queryByText(en.deAnonymize.pasteLabel)).toBeNull();
    choose('mapping-file-input', new File(['x'], 'notes.json'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(en.deAnonymize.tableInvalid));
    expect(props.onImportMapping).toHaveBeenCalledTimes(1);
  });

  it('opens with the table in use: what it is, one real pair, and that it lives only in this tab', () => {
    renderPanel();
    const source = screen.getByTestId('restore-source');
    expect(source).toHaveAttribute('data-source', 'document');
    expect(screen.getByTestId('restore-source-line')).toHaveTextContent(en.deAnonymize.tableCurrent(4));
    expect(screen.getByTestId('restore-source-sample')).toHaveTextContent('[PERSON_1] = Jan Kowalski');
    expect(source).toHaveTextContent(en.deAnonymize.tableBody);
    // The file type is said before the click.
    expect(source).toHaveTextContent(en.deAnonymize.tableSaveHint);
    expect(en.deAnonymize.tableSaveHint).toContain('.json');
    // One name for one action, the same as in the file bar and the reminder.
    expect(screen.getByTestId('mapping-export')).toHaveTextContent(en.textOutput.saveTable);
    expect(screen.getByTestId('mapping-import')).toHaveTextContent(en.deAnonymize.tableImport);
  });

  it('a table from a file is marked, shows whose it is, and cannot be mistaken for the document\'s', () => {
    const props = renderPanel({ importedMapping: { fileName: 'saved.json', count: 9, sample: { replacement: '[PERSON_1]', original: 'Maria Lis' } } });
    const source = screen.getByTestId('restore-source');
    expect(source).toHaveAttribute('data-source', 'file');
    expect(screen.getByTestId('restore-source-line')).toHaveTextContent(en.deAnonymize.tableFromFile('saved.json', 9));
    expect(screen.getByTestId('restore-source-sample')).toHaveTextContent('[PERSON_1] = Maria Lis');
    expect(source).toHaveTextContent(en.deAnonymize.tableFromFileNote);
    // Saving now would save the other table: not offered while a file is in use.
    expect(screen.queryByTestId('mapping-export')).toBeNull();
    const back = screen.getByTestId('mapping-unload');
    expect(back).toHaveTextContent(en.deAnonymize.tableUseCurrent);
    fireEvent.click(back);
    expect(props.onClearImportedMapping).toHaveBeenCalledTimes(1);
    // The pressed button goes away with the loaded table: focus lands on a control, not on the page.
    expect(document.activeElement).toBe(screen.getByTestId('mapping-import'));
  });

  it('a table from a file with no document open: the way out removes it', () => {
    renderPanel({ hasMapping: false, mappingCount: 0, mappingSample: null, importedMapping: { fileName: 'saved.json', count: 9, sample: null } });
    expect(screen.getByTestId('restore-source')).toHaveTextContent(en.deAnonymize.tableFromFileNoteAlone);
    expect(screen.getByTestId('mapping-unload')).toHaveTextContent(en.deAnonymize.tableRemove);
    expect(screen.queryByTestId('restore-source-sample')).toBeNull();
  });

  it('a long original in the example is cut short', () => {
    renderPanel({ mappingSample: { replacement: '[ADDRESS_1]', original: 'os. Bolesława Śmiałego 12/48,\n60-682 Poznań, województwo wielkopolskie, Polska' } });
    const sample = screen.getByTestId('restore-source-sample').textContent ?? '';
    expect(sample).toContain('[ADDRESS_1] = os. Bolesława Śmiałego 12/48, 60-682 Poznań');
    expect(sample.endsWith('...')).toBe(true);
  });

  it('restores a chosen docx: download, how many places, and the labels that stayed with what to do', async () => {
    const props = renderPanel();
    const file = new File(['x'], 'reply.docx');
    choose('restore-docx-input', file);
    await waitFor(() => expect(props.onDownload).toHaveBeenCalledWith(DONE.success && DONE.blob, 'reply_restored.docx'));
    expect(props.onRestoreDocx).toHaveBeenCalledWith(file);
    const status = screen.getByTestId('restore-docx-status');
    expect(status).toHaveTextContent(en.deAnonymize.restoredCount(37));
    expect(status).toHaveTextContent(en.deAnonymize.docxDownloaded('reply_restored.docx'));
    // Labels stayed: no all-clear.
    expect(status).not.toHaveTextContent(en.deAnonymize.allClear);
    const unresolved = screen.getByTestId('restore-docx-unresolved');
    expect(unresolved).toHaveTextContent(en.deAnonymize.leftover(2));
    expect(unresolved).toHaveTextContent('[PERSON_9]');
    expect(unresolved).toHaveTextContent('[COMPANY_7]');
    expect(unresolved).toHaveTextContent(en.deAnonymize.leftoverHelp);

    fireEvent.click(within(status).getByRole('button', { name: en.deAnonymize.docxDownloadAgain }));
    expect(props.onDownload).toHaveBeenCalledTimes(2);
  });

  it('says so when every label of a docx came back', async () => {
    renderPanel({ onRestoreDocx: vi.fn(async () => ({ ...DONE, unresolved: [] })) });
    choose('restore-docx-input', new File(['x'], 'reply.docx'));
    await waitFor(() => expect(screen.getByTestId('restore-docx-status')).toHaveTextContent(en.deAnonymize.allClear));
    expect(screen.queryByTestId('restore-docx-unresolved')).toBeNull();
  });

  it('sums up a long list of labels that stayed', async () => {
    const many = Array.from({ length: 15 }, (_, i) => `[PERSON_${i + 20}]`);
    renderPanel({ onRestoreDocx: vi.fn(async () => ({ ...DONE, unresolved: many })) });
    choose('restore-docx-input', new File(['x'], 'reply.docx'));
    const unresolved = await screen.findByTestId('restore-docx-unresolved');
    expect(unresolved).toHaveTextContent('[PERSON_31]');
    expect(unresolved).not.toHaveTextContent('[PERSON_32]');
    expect(unresolved).toHaveTextContent(en.deAnonymize.andMore(3));
  });

  it('says so when the file holds nothing to restore, with what to check, without a download', async () => {
    const props = renderPanel({
      onRestoreDocx: vi.fn(async () => ({ success: true as const, restored: 0, unresolved: [], blob: null, downloadName: 'x_restored.docx' })),
    });
    choose('restore-docx-input', new File(['x'], 'other.docx'));
    await waitFor(() => expect(screen.getByTestId('restore-docx-status')).toHaveTextContent(en.deAnonymize.docxNothing('other.docx')));
    expect(props.onDownload).not.toHaveBeenCalled();
  });

  it('shows the refusal of a file that cannot be restored', async () => {
    const props = renderPanel({ onRestoreDocx: vi.fn(async () => ({ success: false as const, message: en.deAnonymize.docxOnlyDocx })) });
    choose('restore-docx-input', new File(['x'], 'reply.pdf'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(en.deAnonymize.docxOnlyDocx));
    expect(props.onDownload).not.toHaveBeenCalled();
  });

  it('saves the table on request', () => {
    const props = renderPanel();
    fireEvent.click(screen.getByTestId('mapping-export'));
    expect(props.onExportMapping).toHaveBeenCalledTimes(1);
    expect(props.onDownload).toHaveBeenCalledWith(expect.any(Blob), 'contract_replacement-table_2026-11-12_090507.json');
    // Confirmed next to the button, with the name of the file to look for later.
    expect(screen.getByTestId('mapping-saved')).toHaveTextContent(en.deAnonymize.docxDownloaded('contract_replacement-table_2026-11-12_090507.json'));
  });

  it('pasted text: the result, how many places, and an all-clear', () => {
    renderPanel();
    expect(screen.getByLabelText(en.deAnonymize.pasteLabel)).toBe(screen.getByPlaceholderText(/Paste the AI/));
    fireEvent.change(screen.getByPlaceholderText(/Paste the AI/), { target: { value: '[PERSON_1] signed' } });
    fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.restoreButton }));
    const restored = screen.getByTestId('restore-text-result');
    expect(restored).toHaveTextContent('Jan Kowalski signed');
    // What came back is marked in the text.
    expect(restored.querySelector('mark[data-kind="restored"]')).toHaveTextContent('Jan Kowalski');
    expect(restored.querySelector('mark[data-kind="leftover"]')).toBeNull();
    const status = screen.getByTestId('restore-text-status');
    expect(status).toHaveTextContent(en.deAnonymize.restoredCount(1));
    expect(status).toHaveTextContent(en.deAnonymize.allClear);
  });

  it('pasted text: labels that stayed are listed like in a docx; nothing found gives no all-clear', () => {
    const onRestoreText = vi.fn()
      .mockReturnValueOnce({
        text: 'Jan Kowalski and [PERSON_9]', restored: 1, unresolved: ['[PERSON_9]'],
        segments: [{ text: 'Jan Kowalski', kind: 'restored' }, { text: ' and ', kind: 'plain' }, { text: '[PERSON_9]', kind: 'leftover' }],
      })
      .mockReturnValueOnce({ text: 'plain', restored: 0, unresolved: [], segments: [{ text: 'plain', kind: 'plain' }] });
    renderPanel({ onRestoreText });
    const box = screen.getByPlaceholderText(/Paste the AI/);
    fireEvent.change(box, { target: { value: '[PERSON_1] and [PERSON_9]' } });
    fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.restoreButton }));
    const left = screen.getByTestId('restore-text-unresolved');
    expect(left).toHaveTextContent(en.deAnonymize.leftover(1));
    expect(left).toHaveTextContent('[PERSON_9]');
    expect(screen.getByTestId('restore-text-status')).not.toHaveTextContent(en.deAnonymize.allClear);
    // The label that stayed is marked where it stands in the text.
    expect(screen.getByTestId('restore-text-result').querySelector('mark[data-kind="leftover"]')).toHaveTextContent('[PERSON_9]');

    fireEvent.change(box, { target: { value: 'plain' } });
    fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.restoreButton }));
    const status = screen.getByTestId('restore-text-status');
    expect(status).toHaveTextContent(en.deAnonymize.restoredCount(0));
    expect(status).not.toHaveTextContent(en.deAnonymize.allClear);
    expect(screen.queryByTestId('restore-text-unresolved')).toBeNull();
  });

  it('every language has the new strings', () => {
    const plain = [
      'docxTitle', 'docxBody', 'docxButton', 'docxWorking', 'allClear', 'docxDownloadAgain', 'leftoverHelp', 'docxOnlyDocx', 'docxFailed',
      'tableTitle', 'tableExample', 'tableBody', 'tableSaveHint', 'tableFromFileNote', 'tableFromFileNoteAlone', 'tableImport', 'showAll',
      'tableUseCurrent', 'tableRemove', 'tableInvalid', 'tableDroppedToast', 'loadEarlier',
    ] as const;
    for (const { code, translations: t } of languages) {
      for (const key of plain) expect(t.deAnonymize[key], `${code}.${key}`).toMatch(/\S/);
      for (const n of [1, 2, 5, 22]) {
        expect(t.deAnonymize.restoredCount(n), code).toContain(String(n));
        expect(t.deAnonymize.tableCurrent(n), code).toContain(String(n));
        expect(t.deAnonymize.tableFromFile('t.json', n), code).toContain('t.json');
        expect(t.deAnonymize.andMore(n), code).toContain(String(n));
      }
      expect(t.deAnonymize.restoredCount(0), code).toMatch(/\S/);
      expect(t.deAnonymize.leftover(3), code).toContain('3');
      expect(t.deAnonymize.leftover(1), code).toMatch(/\S/);
      expect(t.deAnonymize.docxNothing('a.docx'), code).toContain('a.docx');
      expect(t.deAnonymize.docxDownloaded('a.docx'), code).toContain('a.docx');
      // The file type and the name to look for are said in the interface, in every language.
      expect(t.deAnonymize.tableSaveHint, code).toContain('.json');
      expect(t.deAnonymize.tableInvalid, code).toContain('replacement-table');
      expect(t.step2.description, code).toContain('.docx');
      if (code !== 'en') {
        expect(t.deAnonymize.tableBody, code).not.toBe(en.deAnonymize.tableBody);
        expect(t.deAnonymize.docxBody, code).not.toBe(en.deAnonymize.docxBody);
      }
      // House style: no em dash anywhere.
      expect(JSON.stringify([t.deAnonymize, t.entityTable, t.step2], (_k, v) => (typeof v === 'function' ? v(2, 'f') : v)), code).not.toContain(String.fromCharCode(0x2014));
    }
  });
});
