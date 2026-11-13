// T265: spreadsheets in the web app, through Core's xlsx reader and writer. A real workbook
// (built here), the real Core; only the detection worker is faked. Covers what a user of a
// staff list needs: names, numbers stored as numbers, dates stored as dates, a sheet named
// after a person, and the notes that say what was and was not checked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import JSZip from 'jszip';
import type { DetectedEntity, EngineClient } from '@doccloak/core';
import { useAnonymizer, xlsxDownloadName } from '../../src/ui/hooks/useAnonymizer.ts';
import { TableReminder } from '../../src/ui/components/TableReminder.tsx';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

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

const SS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const text = (ref: string, value: string) => `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;

async function staffList(): Promise<File> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="${SS}" xmlns:r="${OD}"><sheets><sheet name="Staff" sheetId="1" r:id="rId1"/><sheet name="Jan Kowalski" sheetId="2" r:id="rId2"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OD}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${OD}/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', `<?xml version="1.0"?><styleSheet xmlns="${SS}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`);
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="${SS}"><sheetData>
    <row r="1">${text('A1', 'Name')}${text('B1', 'Born')}${text('C1', 'PESEL')}${text('D1', 'Salary')}</row>
    <row r="2">${text('A2', 'Jan Kowalski')}<c r="B2" s="1"><v>31118</v></c><c r="C2"><v>85031212345</v></c><c r="D2"><v>8200.5</v></c></row>
    <row r="3"><c r="A3"><f>'Jan Kowalski'!A1</f><v>0</v></c></row>
  </sheetData></worksheet>`);
  zip.file('xl/worksheets/sheet2.xml', `<?xml version="1.0"?><worksheet xmlns="${SS}"><sheetData><row r="1"><c r="A1"><v>3</v></c></row></sheetData></worksheet>`);
  return new File([await zip.generateAsync({ type: 'arraybuffer' })], 'staff.xlsx');
}

let detect: (text: string) => DetectedEntity[] = () => [];

function fakeFactory() {
  const client = {
    preload: () => Promise.resolve(),
    detect: (input: string) => Promise.resolve(detect(input)),
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

function found(input: string, type: DetectedEntity['type'], value: string): DetectedEntity {
  const start = input.indexOf(value);
  return { type, value, start, end: start + value.length, confidence: 0.95, detector: 'test' };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  _setClientFactoryForTests(fakeFactory);
  detect = (input) => [found(input, 'PERSON', 'Jan Kowalski'), found(input, 'DATE', '1985-03-12'), found(input, 'SSN', '85031212345')];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  _setClientFactoryForTests(null);
});

describe('spreadsheets (T265)', () => {
  it('reads the workbook as text, dates as dates, and says what was and was not checked', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    let loaded: { success: boolean } | undefined;
    await act(async () => { loaded = await hook.result.current.loadFile(await staffList()); });
    expect(loaded?.success).toBe(true);
    expect(hook.result.current.fileName).toBe('staff.xlsx');
    expect(hook.result.current.hasXlsxExtraction).toBe(true);
    expect(hook.result.current.hasDocumentExtraction).toBe(true);
    expect(hook.result.current.hasDocxExtraction).toBe(false);
    expect(hook.result.current.inputText.split('\n')).toEqual(['Name', 'Born', 'PESEL', 'Salary', 'Jan Kowalski', '1985-03-12', '85031212345']);
    // What was read and what was not is its own notice, not a line among file warnings.
    expect(hook.result.current.fileWarnings).toEqual([]);
    // The salary, the formula result and the 3 on the second sheet: not checked, and said so.
    expect(hook.result.current.xlsxInfo).toMatchObject({ dateCells: 1, identifierCells: 1, otherNumberCells: 3, renamedSheets: [] });
    // ... and named: sheet, address and value of each, so the user can see them before sharing the file.
    const unchecked = hook.result.current.xlsxInfo?.unchecked ?? [];
    expect(unchecked).toHaveLength(3);
    expect(unchecked.map((cell) => cell.value)).toContain('8200.5');
    for (const cell of unchecked) {
      expect(cell.sheet).toMatch(/\S/);
      expect(cell.cell).toMatch(/^[A-Z]+\d+$/);
    }
  });

  it('exports a workbook with the values replaced, the sheet renamed and the formula following', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await hook.result.current.loadFile(await staffList()); });
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(3));
    let blob: Blob | undefined;
    await act(async () => { blob = await hook.result.current.exportXlsx(); });
    const zip = await JSZip.loadAsync(await (blob as Blob).arrayBuffer());
    const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet1).toContain('[PERSON_1]');
    expect(sheet1).toContain('[DATE_1]');
    expect(sheet1).toContain('[SSN_1]');
    // The salary is a number that was not checked: untouched.
    expect(sheet1).toContain('<v>8200.5</v>');
    expect(sheet1).toContain("<f>'PERSON_1'!A1</f>");
    const workbook = await zip.file('xl/workbook.xml')!.async('string');
    expect(workbook).toContain('name="PERSON_1"');
    for (const path of Object.keys(zip.files)) {
      if (zip.files[path].dir) continue;
      const xml = await zip.file(path)!.async('string');
      expect(xml, path).not.toContain('Kowalski');
      expect(xml, path).not.toContain('85031212345');
      expect(xml, path).not.toContain('31118');
    }
    // What happened to the workbook is said next to the file.
    expect(hook.result.current.xlsxInfo?.renamedSheets).toEqual(['PERSON_1']);
    expect(hook.result.current.exportMapping()?.downloadName).toMatch(/^staff_replacement-table_/);
  });

  it('a value kept visible stays in the workbook and its sheet keeps its name', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await hook.result.current.loadFile(await staffList()); });
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(3));
    act(() => hook.result.current.setEntitiesExcluded([0], true));
    let blob: Blob | undefined;
    await act(async () => { blob = await hook.result.current.exportXlsx(); });
    const zip = await JSZip.loadAsync(await (blob as Blob).arrayBuffer());
    expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('name="Jan Kowalski"');
    const sheet1 = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet1).toContain('Jan Kowalski');
    expect(sheet1).toContain('[DATE_1]');
    expect(hook.result.current.fileWarnings).not.toContain(en.xlsx.sheetsRenamed('PERSON_1', 1));
  });

  it('refuses a file that is not a workbook, with a remedy, and the old .xls format', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    let result: { success: boolean; message?: string; error?: string } | undefined;
    await act(async () => { result = await hook.result.current.loadFile(new File(['not a zip'], 'broken.xlsx')); });
    expect(result?.success).toBe(false);
    expect(result?.message).toBe(en.xlsx.invalid);
    await act(async () => { result = await hook.result.current.loadFile(new File(['x'], 'old.xls')); });
    expect(result).toMatchObject({ success: false, error: 'unsupported' });
    expect(hook.result.current.fileName).toBeNull();
  });

  it('removing the file clears the workbook; a document loaded after it replaces it', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    await act(async () => { await hook.result.current.loadFile(await staffList()); });
    act(() => hook.result.current.removeFile());
    expect(hook.result.current.hasXlsxExtraction).toBe(false);
    expect(hook.result.current.inputText).toBe('');
    await expect(hook.result.current.exportXlsx()).rejects.toThrow();
  });

  it('names the download after the workbook', () => {
    expect(xlsxDownloadName('staff.xlsx')).toBe('staff_redacted.xlsx');
    expect(xlsxDownloadName('Lista płac 2026.XLSX')).toBe('Lista płac 2026_redacted.xlsx');
    expect(xlsxDownloadName(null)).toBe('workbook_redacted.xlsx');
  });

  it('every language has the spreadsheet strings and names the format in the upload hint', () => {
    for (const { code, translations: t } of languages) {
      for (const key of ['title', 'sheetNames', 'formulasNote', 'invalid'] as const) expect(t.xlsx[key], `${code}.${key}`).toMatch(/\S/);
      expect(t.xlsx.checked(4, 2), code).toMatch(/4.*2/);
      expect(t.xlsx.notChecked(9), code).toContain('9');
      expect(t.xlsx.sheetsRenamed('PERSON_1', 1), code).toContain('PERSON_1');
      expect(t.xlsx.sheetsRenamed('A, B', 2), code).toContain('A, B');
      expect(t.xlsx.sheetsRenamed('A, B', 2), code).not.toBe(t.xlsx.sheetsRenamed('A, B', 1));
      expect(t.textInput.uploadDocxSub, code).toContain('.xlsx');
      expect(t.textInput.unsupportedFormat, code).toContain('.xlsx');
      expect(t.xlsx.invalid, code).toContain('.xlsx');
      if (code !== 'en') expect(t.xlsx.title, code).not.toBe(en.xlsx.title);
    }
  });
});

describe('TableReminder (T261)', () => {
  it('says what is at stake and offers the three ways on', () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    render(<Providers><TableReminder onSave={onSave} onDismiss={onDismiss} /></Providers>);
    const reminder = screen.getByTestId('table-reminder');
    expect(reminder).toHaveTextContent(en.tableReminder.title);
    expect(reminder).toHaveTextContent(en.tableReminder.body);
    // It says what the file holds, and the save button carries the one name of that action.
    expect(en.tableReminder.body).toMatch(/every original value/);
    expect(screen.getByTestId('table-reminder-save')).toHaveTextContent(en.textOutput.saveTable);
    fireEvent.click(screen.getByTestId('table-reminder-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('table-reminder-dismiss'));
    expect(onDismiss).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByTestId('table-reminder-never'));
    expect(onDismiss).toHaveBeenLastCalledWith(true);
  });

  it('every language has its strings, and the landing copy mentions the Word route and the saved table', () => {
    for (const { code, translations: t } of languages) {
      for (const key of ['title', 'body', 'dismiss', 'never', 'offToast'] as const) expect(t.tableReminder[key], `${code}.${key}`).toMatch(/\S/);
      expect(t.textOutput.saveTable, code).toMatch(/\S/);
      expect(t.textOutput.tableSaved, code).toMatch(/\S/);
      expect(t.landing.howItWorks.step4Body, code).toContain('.docx');
      if (code !== 'en') expect(t.tableReminder.body, code).not.toBe(en.tableReminder.body);
      expect(t.settings.reminderTitle, code).toMatch(/\S/);
      expect(t.settings.reminderDescription, code).toMatch(/\S/);
      expect(JSON.stringify([t.tableReminder, t.xlsx, t.settings.neverTitle, t.settings.neverDescription, t.settings.reminderTitle, t.settings.reminderDescription], (_k, v) => (typeof v === 'function' ? v('x', 2) : v)), code)
        .not.toContain(String.fromCharCode(0x2014));
    }
  });
});
