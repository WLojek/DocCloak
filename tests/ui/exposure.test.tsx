// Third pass (T268): what leaves the page is said where it leaves. The result names how many
// places stay readable and leads to the list; a lasting "never redact this type" answers with
// what it did and an Undo; a workbook says what was not checked; the restored text marks what
// came back and what stayed; the reminder can be switched back on.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, EngineClient, ReplacementEntry } from '@doccloak/core';
import { EntityTable } from '../../src/ui/components/EntityTable.tsx';
import { TextOutput } from '../../src/ui/components/TextOutput.tsx';
import { TextInput } from '../../src/ui/components/TextInput.tsx';
import { DeAnonymize } from '../../src/ui/components/DeAnonymize.tsx';
import { SpreadsheetNotice } from '../../src/ui/components/SpreadsheetNotice.tsx';
import { useAnonymizer } from '../../src/ui/hooks/useAnonymizer.ts';
import { keptRangesInOutput } from '../../src/ui/keptRanges.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const TEXT = 'Jan Kowalski of Acme Ltd met Anna Nowak of Borg GmbH. Acme Ltd pays Jan Kowalski; write to jan@acme.example.';

function entity(type: DetectedEntity['type'], value: string, from = 0): DetectedEntity {
  const start = TEXT.indexOf(value, from);
  return { type, value, start, end: start + value.length, confidence: 0.9, detector: 'test' };
}

const ENTITIES: DetectedEntity[] = [
  entity('PERSON', 'Jan Kowalski'),
  entity('COMPANY', 'Acme Ltd'),
  entity('PERSON', 'Anna Nowak'),
  entity('COMPANY', 'Borg GmbH'),
  entity('COMPANY', 'Acme Ltd', 40),
  entity('PERSON', 'Jan Kowalski', 40),
  entity('EMAIL', 'jan@acme.example'),
];

const ENTRIES: ReplacementEntry[] = [
  { original: 'Jan Kowalski', replacement: '[PERSON_1]', entityType: 'PERSON' },
  { original: 'Acme Ltd', replacement: '[COMPANY_1]', entityType: 'COMPANY' },
  { original: 'Anna Nowak', replacement: '[PERSON_2]', entityType: 'PERSON' },
  { original: 'Borg GmbH', replacement: '[COMPANY_2]', entityType: 'COMPANY' },
  { original: 'jan@acme.example', replacement: '[EMAIL_1]', entityType: 'EMAIL' },
];

function Table({ excluded = [], reveal }: { excluded?: number[]; reveal?: { kept: boolean; nonce: number } }) {
  // Entries of values that are redacted somewhere, as the hook builds them.
  const excludedSet = new Set(excluded);
  const live = new Set(ENTITIES.filter((_e, i) => !excludedSet.has(i)).map((e) => e.value));
  return (
    <Providers>
      <EntityTable
        entities={ENTITIES}
        entries={ENTRIES.filter((entry) => live.has(entry.original))}
        excludedIndices={excludedSet}
        text={TEXT}
        onToggle={() => {}}
        onSetExcluded={() => {}}
        onRenameLabel={() => {}}
        keepTypes={[]}
        onKeepTypesChange={() => {}}
        reveal={reveal}
      />
    </Providers>
  );
}

function rows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('table tbody tr[data-count]'));
}

function rowOf(value: string): HTMLElement {
  const row = rows().find((r) => r.querySelectorAll('td')[2].querySelector('span')?.textContent === value);
  if (!row) throw new Error(`no row for ${value}`);
  return row;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the result says what leaves the page with it', () => {
  it('everything found is replaced: a quiet line with the way to the list', () => {
    const onReviewList = vi.fn();
    render(<Providers><TextOutput value="[PERSON_1] signed" entries={ENTRIES} replacedPlaces={7} foundPlaces={7} onReviewList={onReviewList} /></Providers>);
    const line = screen.getByTestId('result-review');
    expect(line).toHaveTextContent(en.textOutput.reviewAll(7));
    expect(line).toHaveAttribute('data-kept', '0');
    expect(screen.queryByTestId('result-kept-hint')).toBeNull();
    expect(screen.getByText(en.textOutput.nextStepHint)).toBeInTheDocument();
    fireEvent.click(within(line).getByRole('button', { name: en.textOutput.reviewLink }));
    expect(onReviewList).toHaveBeenCalledWith(false);
  });

  it('places left readable: the line says how many, leads to them, and "safe to share" is gone', () => {
    const onReviewList = vi.fn();
    render(<Providers><TextOutput value="[PERSON_1] of Acme Ltd" entries={ENTRIES} replacedPlaces={4} foundPlaces={7} onReviewList={onReviewList} /></Providers>);
    const line = screen.getByTestId('result-review');
    expect(line).toHaveTextContent('4 of 7 places replaced. Still readable in this text: 3.');
    expect(line).toHaveAttribute('data-kept', '3');
    expect(screen.getByTestId('result-kept-hint')).toHaveTextContent(en.textOutput.keptHint(3));
    expect(screen.queryByText(en.textOutput.nextStepHint)).toBeNull();
    fireEvent.click(within(line).getByRole('button', { name: en.textOutput.showKeptLink }));
    expect(onReviewList).toHaveBeenCalledWith(true);
  });

  it('nothing found: no line', () => {
    render(<Providers><TextOutput value="plain text" entries={[]} replacedPlaces={0} foundPlaces={0} /></Providers>);
    expect(screen.queryByTestId('result-review')).toBeNull();
  });
});

describe('the list answers the line at the result', () => {
  it('a request opens the list on what is not redacted and brings it into view', async () => {
    vi.useFakeTimers();
    try {
      const view = render(<Table excluded={[1, 4]} />);
      // Collapsed or not, an old request from before this list existed does nothing.
      expect(screen.getByTestId('entity-filter-kept')).toHaveAttribute('aria-pressed', 'false');
      view.rerender(<Table excluded={[1, 4]} reveal={{ kept: true, nonce: 1 }} />);
      expect(screen.getByTestId('entity-filter-kept')).toHaveAttribute('aria-pressed', 'true');
      expect(rows().map((r) => r.querySelectorAll('td')[2].querySelector('span')?.textContent)).toEqual(['Acme Ltd']);
      act(() => { vi.advanceTimersByTime(100); });
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      // "Review the list" shows the whole of it again.
      view.rerender(<Table excluded={[1, 4]} reveal={{ kept: false, nonce: 2 }} />);
      expect(screen.getByTestId('entity-filter-kept')).toHaveAttribute('aria-pressed', 'false');
      expect(rows()).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a list that mounts with an old request stays where it is', () => {
    render(<Table excluded={[1, 4]} reveal={{ kept: true, nonce: 3 }} />);
    expect(screen.getByTestId('entity-filter-kept')).toHaveAttribute('aria-pressed', 'false');
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('a value that is not redacted says so in words, at full strength, with a stable box name', () => {
    render(<Table excluded={[1, 4]} />);
    const row = rowOf('Acme Ltd');
    expect(row).toHaveAttribute('data-state', 'kept');
    expect(row.className).not.toMatch(/opacity/);
    expect(within(row).getByTestId('entity-kept-tag')).toHaveTextContent(en.entityTable.keptChip);
    const box = within(row).getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'false');
    // The name does not flip with the state: unchecked "Redact: Acme Ltd" means it is readable.
    expect(box).toHaveAccessibleName(`${en.entityTable.include}: Acme Ltd`);
    expect(within(rowOf('Borg GmbH')).getByRole('checkbox')).toHaveAccessibleName(`${en.entityTable.include}: Borg GmbH`);
  });

  it('a value redacted in some places only says how many', () => {
    render(<Table excluded={[4]} />);
    const row = rowOf('Acme Ltd');
    expect(row).toHaveAttribute('data-state', 'mixed');
    expect(within(row).getByTestId('entity-group-partly')).toHaveTextContent(en.entityTable.partly(1, 2));
    expect(within(rowOf('Jan Kowalski')).queryByTestId('entity-group-partly')).toBeNull();
    // The places name their certainty.
    fireEvent.click(within(row).getByTestId('entity-group-count'));
    const places = screen.getAllByTestId('entity-group-places')[0];
    expect(places).toHaveTextContent(`${en.entityTable.confidence} 90%`);
    for (const box of within(places).getAllByRole('checkbox')) {
      expect(box.getAttribute('aria-label')).toMatch(new RegExp(`^${en.entityTable.include}: `));
    }
  });
});

describe('a workbook says what was checked and what was not', () => {
  it('the unchecked numbers are their own marked line', () => {
    render(<Providers><SpreadsheetNotice info={{ dateCells: 4, identifierCells: 2, otherNumberCells: 9, renamedSheets: [], unchecked: [] }} /></Providers>);
    const notice = screen.getByTestId('spreadsheet-notice');
    expect(notice).toHaveAccessibleName(en.xlsx.title);
    expect(notice).toHaveTextContent(en.xlsx.checked(4, 2));
    expect(notice).toHaveTextContent(en.xlsx.sheetNames);
    expect(screen.getByTestId('spreadsheet-not-checked')).toHaveTextContent(en.xlsx.notChecked(9));
    // Said before any download, not after it.
    expect(notice).toHaveTextContent(en.xlsx.formulasNote);
    expect(screen.queryByTestId('spreadsheet-renamed')).toBeNull();
    // Sentences, not a monospace dump.
    expect(notice.querySelector('.font-mono')).toBeNull();
  });

  it('no unchecked numbers: no warning line; renamed sheets are named after an export', () => {
    render(<Providers><SpreadsheetNotice info={{ dateCells: 0, identifierCells: 0, otherNumberCells: 0, renamedSheets: ['PERSON_1', 'COMPANY_1'], unchecked: [] }} /></Providers>);
    expect(screen.queryByTestId('spreadsheet-not-checked')).toBeNull();
    expect(screen.getByTestId('spreadsheet-renamed')).toHaveTextContent(en.xlsx.sheetsRenamed('PERSON_1, COMPANY_1', 2));
  });
});

describe('restored text: a long list of labels that stayed can be opened', () => {
  it('shows the first twelve, then all on request', () => {
    const labels = Array.from({ length: 15 }, (_v, i) => `[PERSON_${i + 20}]`);
    render(
      <Providers>
        <DeAnonymize
          onRestoreText={() => ({ text: labels.join(' '), restored: 0, unresolved: labels, segments: labels.map((text) => ({ text, kind: 'leftover' as const })) })}
          hasMapping
          mappingCount={4}
          mappingSample={{ replacement: '[PERSON_1]', original: 'Jan Kowalski' }}
          onRestoreDocx={async () => ({ success: false, message: '' })}
          onExportMapping={() => null}
          onImportMapping={async () => null}
          importedMapping={null}
          onClearImportedMapping={() => {}}
          onDownload={() => {}}
        />
      </Providers>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste the AI/), { target: { value: labels.join(' ') } });
    fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.restoreButton }));
    const left = screen.getByTestId('restore-text-unresolved');
    expect(left).toHaveTextContent(en.deAnonymize.andMore(3));
    expect(left).not.toHaveTextContent('[PERSON_34]');
    fireEvent.click(within(left).getByRole('button', { name: en.deAnonymize.showAll }));
    expect(left).toHaveTextContent('[PERSON_34]');
    expect(left).not.toHaveTextContent(en.deAnonymize.andMore(3));
  });
});

describe('lasting choices answer and can be taken back', () => {
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
    localStorage.setItem(CONSENT_STORAGE_KEY, '1');
    _setClientFactoryForTests(fakeFactory);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    _setClientFactoryForTests(null);
  });

  async function redacted() {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    act(() => hook.result.current.handleInputChange(TEXT));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(ENTITIES.length));
    return hook;
  }

  const companies = [1, 3, 4];

  it('"never redact this type" says what it did here and for how long, and Undo reverses all of it', async () => {
    const hook = await redacted();
    act(() => hook.result.current.handleKeepTypesChange(['COMPANY']));
    expect([...hook.result.current.excludedIndices].sort()).toEqual(companies);
    expect(screen.getByText(en.entityTable.neverOnToast(en.entityLabels.COMPANY, 3))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(hook.result.current.keepTypes).toEqual([]);
    expect(hook.result.current.excludedIndices.size).toBe(0);
    expect(localStorage.getItem('doccloak-keep-types')).toBeNull();
    expect(hook.result.current.anonymizedText).toContain('[COMPANY_1]');
  });

  it('Undo after another document was redacted takes the setting back and leaves the new document alone', async () => {
    const hook = await redacted();
    act(() => hook.result.current.handleKeepTypesChange(['COMPANY']));
    // Another text: the list is a new one, the old place numbers mean nothing in it.
    act(() => hook.result.current.handleInputChange(`${TEXT} `));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('[PERSON_1] of Acme Ltd'));
    const keptNow = [...hook.result.current.excludedIndices].sort();
    expect(keptNow).toEqual(companies);
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(hook.result.current.keepTypes).toEqual([]);
    expect([...hook.result.current.excludedIndices].sort()).toEqual(keptNow);
  });

  it('taking a type off the list says it holds from the next document and offers to redact the open one now', async () => {
    localStorage.setItem('doccloak-keep-types', JSON.stringify(['COMPANY']));
    const hook = await redacted();
    expect([...hook.result.current.excludedIndices].sort()).toEqual(companies);
    act(() => hook.result.current.handleKeepTypesChange([]));
    // The open document is the user's to decide: nothing changes by itself.
    expect([...hook.result.current.excludedIndices].sort()).toEqual(companies);
    expect(screen.getByText(en.entityTable.neverOffToast(en.entityLabels.COMPANY, 3))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.entityTable.redactThemNow }));
    expect(hook.result.current.excludedIndices.size).toBe(0);
    expect(hook.result.current.anonymizedText).toContain('[COMPANY_1]');
  });

  it('the reminder that was switched off says where to switch it on, and the switch brings it back', async () => {
    const hook = await redacted();
    act(() => hook.result.current.markResultTakenOut());
    expect(hook.result.current.tableReminder).toBe(true);
    expect(hook.result.current.tableReminderEnabled).toBe(true);
    act(() => hook.result.current.dismissTableReminder(true));
    expect(hook.result.current.tableReminder).toBe(false);
    expect(hook.result.current.tableReminderEnabled).toBe(false);
    expect(screen.getByText(en.tableReminder.offToast)).toBeInTheDocument();
    act(() => hook.result.current.setTableReminderEnabled(true));
    expect(hook.result.current.tableReminderEnabled).toBe(true);
    expect(localStorage.getItem('doccloak-table-reminder')).toBeNull();
    // The table of the open document is still unsaved: the reminder is back.
    expect(hook.result.current.tableReminder).toBe(true);
  });
});

describe('strings of the third pass', () => {
  it('every language has them, each with its numbers, none with an em dash', () => {
    for (const { code, translations: t } of languages) {
      const samples = [
        t.textOutput.reviewAll(1), t.textOutput.reviewAll(7), t.textOutput.reviewKept(7, 4, 3), t.textOutput.reviewLink,
        t.textOutput.showKeptLink, t.textOutput.keptHint(3),
        t.entityTable.neverOnToast('X', 0), t.entityTable.neverOnToast('X', 3), t.entityTable.neverOffToast('X', 0),
        t.entityTable.neverOffToast('X', 3), t.entityTable.redactThemNow, t.entityTable.partly(2, 4),
        t.entityTable.showing(1, 1), t.entityTable.showing(7, 7), t.entityTable.showing(2, 7),
        t.entityTable.dontRedactThese(1), t.entityTable.dontRedactThese(5), t.entityTable.redactThese(1), t.entityTable.redactThese(5),
        t.entityTable.keptToast(1), t.entityTable.keptToast(5), t.entityTable.redactedToast(1), t.entityTable.redactedToast(5),
        t.deAnonymize.allClear, t.deAnonymize.leftoverHelp, t.deAnonymize.showAll, t.deAnonymize.tableImport,
        t.tableReminder.body, t.tableReminder.dismiss, t.tableReminder.offToast,
        t.settings.reminderTitle, t.settings.reminderDescription,
        t.xlsx.title, t.xlsx.checked(4, 2), t.xlsx.sheetNames, t.xlsx.notChecked(9),
      ];
      for (const sample of samples) {
        expect(sample, code).toMatch(/\S/);
        expect(sample, code).not.toContain(String.fromCharCode(0x2014));
      }
      expect(t.textOutput.reviewKept(7, 4, 3), code).toMatch(/4.*7.*3/);
      expect(t.textOutput.reviewAll(7), code).toContain('7');
      expect(t.textOutput.keptHint(3), code).toContain('3');
      expect(t.entityTable.partly(2, 4), code).toMatch(/2.*4/);
      expect(t.entityTable.neverOnToast('X', 3), code).toMatch(/X.*3/);
      expect(t.entityTable.neverOffToast('X', 3), code).toMatch(/X.*3/);
      expect(t.entityTable.neverOnToast('X', 0), code).not.toBe(t.entityTable.neverOnToast('X', 3));
      // The loading button names the thing it loads, like the saving one.
      expect(t.deAnonymize.tableImport, code).not.toBe(t.textOutput.saveTable);
      if (code !== 'en') {
        expect(t.textOutput.reviewLink, code).not.toBe(en.textOutput.reviewLink);
        expect(t.xlsx.notChecked(9), code).not.toBe(en.xlsx.notChecked(9));
        expect(t.tableReminder.offToast, code).not.toBe(en.tableReminder.offToast);
      }
    }
  });
});

describe('findings of the measured assessment (T268)', () => {
  it('a label in the result is dark on its tint: the type colour is in the tint and the underline', () => {
    render(<Providers><TextOutput value="[PERSON_1] signed" entries={ENTRIES} replacedPlaces={1} /></Providers>);
    const mark = document.querySelector('mark.entity-highlight-animate') as HTMLElement;
    expect(mark).toHaveTextContent('[PERSON_1]');
    expect(mark.style.color).toBe('rgb(17, 17, 17)');
    expect(mark.style.borderBottom).toMatch(/2px solid/);
    // The count under the result is a sentence, not small capitals.
    expect(screen.getByTestId('replaced-summary').className).not.toMatch(/label-meta|uppercase/);
  });

  it('Enter or Escape in the rename field gives the focus back to the label', () => {
    render(<Table />);
    const label = within(rowOf('Anna Nowak')).getByRole('button', { name: `${en.entityTable.clickToRename}: [PERSON_2]` });
    fireEvent.click(label);
    const field = within(rowOf('Anna Nowak')).getByRole('textbox');
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(within(rowOf('Anna Nowak')).getByRole('button', { name: `${en.entityTable.clickToRename}: [PERSON_2]` })).toHaveFocus();
  });

  it('a control that removes itself hands the focus on', () => {
    const view = render(<Table />);
    fireEvent.change(screen.getByPlaceholderText(en.entityTable.filterPlaceholder), { target: { value: 'zzzz' } });
    fireEvent.click(within(screen.getByTestId('entity-filter-empty')).getByRole('button', { name: en.entityTable.clearFilter }));
    expect(screen.getByRole('button', { name: /^All 7$/ })).toHaveFocus();
    view.unmount();
  });

  it('the count button names the list it opens, and every box has a hit area', () => {
    render(<Table />);
    const count = within(rowOf('Acme Ltd')).getByTestId('entity-group-count');
    expect(count).not.toHaveAttribute('aria-controls');
    fireEvent.click(count);
    const places = screen.getAllByTestId('entity-group-places')[0];
    expect(count).toHaveAttribute('aria-controls', places.id);
    expect(places.id).not.toBe('');
    for (const box of screen.getAllByRole('checkbox')) expect(box.className, box.getAttribute('aria-label') ?? '').toMatch(/after:-inset-4/);
  });

  it('a very long unbroken value can wrap anywhere, so the Redact column stays in the card', () => {
    render(<Table />);
    const cell = rowOf('jan@acme.example').querySelectorAll('td')[2].querySelector('span') as HTMLElement;
    expect(cell.className).toContain('[overflow-wrap:anywhere]');
  });

  it('saving the table from the restore panel is announced', () => {
    render(
      <Providers>
        <DeAnonymize
          onRestoreText={() => ({ text: '', restored: 0, unresolved: [], segments: [] })}
          hasMapping
          mappingCount={4}
          mappingSample={{ replacement: '[PERSON_1]', original: 'Jan Kowalski' }}
          onRestoreDocx={async () => ({ success: false, message: '' })}
          onExportMapping={() => ({ blob: new Blob(['[]']), count: 4, downloadName: 'contract_replacement-table_2026-11-12_0905.json' })}
          onImportMapping={async () => null}
          importedMapping={null}
          onClearImportedMapping={() => {}}
          onDownload={() => {}}
        />
      </Providers>,
    );
    fireEvent.click(screen.getByTestId('mapping-export'));
    expect(screen.getByTestId('mapping-saved')).toHaveAttribute('role', 'status');
  });
});

describe('rename with Enter (T268)', () => {
  it('Enter commits, keeps the field closed and puts the focus on the renamed label', () => {
    const onRenameLabel = vi.fn();
    render(
      <Providers>
        <EntityTable entities={ENTITIES} entries={ENTRIES} excludedIndices={new Set()} text={TEXT} onToggle={() => {}} onSetExcluded={() => {}}
          onRenameLabel={onRenameLabel} keepTypes={[]} onKeepTypesChange={() => {}} />
      </Providers>,
    );
    fireEvent.click(within(rowOf('Anna Nowak')).getByRole('button', { name: `${en.entityTable.clickToRename}: [PERSON_2]` }));
    const field = within(rowOf('Anna Nowak')).getByRole('textbox');
    fireEvent.change(field, { target: { value: 'WITNESS' } });
    // The default action of this Enter must not reach the label button that takes the focus.
    const notPrevented = fireEvent.keyDown(field, { key: 'Enter' });
    expect(notPrevented).toBe(false);
    expect(onRenameLabel).toHaveBeenCalledWith('Anna Nowak', '[WITNESS]');
    expect(within(rowOf('Anna Nowak')).queryByRole('textbox')).toBeNull();
    expect(within(rowOf('Anna Nowak')).getByRole('button', { name: `${en.entityTable.clickToRename}: [PERSON_2]` })).toHaveFocus();
  });
});

describe('findings of the third assessment (T268)', () => {
  it('"everything is replaced" does not promise safety: it says a detector can miss things', () => {
    render(<Providers><TextOutput value="[PERSON_1] signed" entries={ENTRIES} replacedPlaces={7} foundPlaces={7} /></Providers>);
    const hint = screen.getByTestId('result-all-replaced-hint');
    expect(hint).toHaveTextContent(en.textOutput.nextStepHint);
    expect(en.textOutput.nextStepHint).toMatch(/No detector finds everything/);
    expect(en.textOutput.nextStepHint).not.toMatch(/safely/i);
    for (const { code, translations: t } of languages) expect(t.textOutput.nextStepHint, code).toContain('DocCloak');
  });

  it('a workbook with number cells that were not checked says so at the result, in place of the all-clear', () => {
    render(<Providers><TextOutput value="[PERSON_1] 8200.5" entries={ENTRIES} replacedPlaces={7} foundPlaces={7} uncheckedCells={3} /></Providers>);
    expect(screen.getByTestId('result-unchecked')).toHaveTextContent(en.xlsx.resultWarning(3));
    expect(screen.queryByTestId('result-all-replaced-hint')).toBeNull();
    expect(screen.queryByText(en.textOutput.nextStepHint)).toBeNull();
  });

  it('the readable places name their one reason, and the copy says what leaves with it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <Providers>
        <TextOutput value="[PERSON_1] of Acme Ltd" entries={ENTRIES} replacedPlaces={4} foundPlaces={7}
          keptReason={en.textOutput.keptBySetting('Company')} />
      </Providers>,
    );
    expect(screen.getByTestId('result-review')).toHaveTextContent(en.textOutput.keptBySetting('Company'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.textOutput.copy })); });
    expect(writeText).toHaveBeenCalledWith('[PERSON_1] of Acme Ltd');
    expect(screen.getByText(en.textOutput.copiedKept(3))).toBeInTheDocument();
  });

  it('a value that stands in one place can show that place too', () => {
    render(<Table />);
    const where = within(rowOf('Anna Nowak')).getByTestId('entity-group-where');
    expect(where).toHaveAccessibleName(en.entityTable.showPlace);
    expect(where).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(where);
    const places = screen.getAllByTestId('entity-group-places')[0];
    expect(places).toHaveTextContent('Acme Ltd met Anna Nowak of Borg GmbH');
  });

  it('typed brackets are not doubled in a renamed label', () => {
    const onRenameLabel = vi.fn();
    render(
      <Providers>
        <EntityTable entities={ENTITIES} entries={ENTRIES} excludedIndices={new Set()} text={TEXT} onToggle={() => {}} onSetExcluded={() => {}}
          onRenameLabel={onRenameLabel} keepTypes={[]} onKeepTypesChange={() => {}} />
      </Providers>,
    );
    fireEvent.click(within(rowOf('Anna Nowak')).getByRole('button', { name: `${en.entityTable.clickToRename}: [PERSON_2]` }));
    const field = within(rowOf('Anna Nowak')).getByRole('textbox');
    fireEvent.change(field, { target: { value: ' [the client] ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRenameLabel).toHaveBeenCalledWith('Anna Nowak', '[the client]');
  });

  it('the phone card names its box and its number', () => {
    render(<Table />);
    const card = document.querySelector('.md\\:hidden > div') as HTMLElement;
    expect(card).toHaveTextContent(en.entityTable.include);
    expect(card).toHaveTextContent(`${en.entityTable.confidence} 90%`);
  });

  it('the restored result goes away when the pasted text changes', () => {
    render(
      <Providers>
        <DeAnonymize
          onRestoreText={(text) => ({ text: text.replace('[PERSON_1]', 'Jan Kowalski'), restored: 1, unresolved: [], segments: [{ text: 'Jan Kowalski', kind: 'restored' }] })}
          hasMapping
          mappingCount={4}
          mappingSample={{ replacement: '[PERSON_1]', original: 'Jan Kowalski' }}
          onRestoreDocx={async () => ({ success: false, message: '' })}
          onExportMapping={() => null}
          onImportMapping={async () => null}
          importedMapping={null}
          onClearImportedMapping={() => {}}
          onDownload={() => {}}
        />
      </Providers>,
    );
    const box = screen.getByPlaceholderText(/Paste the AI/);
    fireEvent.change(box, { target: { value: '[PERSON_1]' } });
    fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.restoreButton }));
    expect(screen.getByTestId('restore-text-result')).toHaveTextContent('Jan Kowalski');
    fireEvent.change(box, { target: { value: '[PERSON_1] again' } });
    expect(screen.queryByTestId('restore-text-result')).toBeNull();
    // The report of the old result goes with it (the live region itself stays mounted).
    expect(screen.getByTestId('restore-text-status')).not.toHaveTextContent(en.deAnonymize.restoredCount(1));
  });

  it('every language has the strings of this round', () => {
    for (const { code, translations: t } of languages) {
      const samples = [
        t.textOutput.keptBySetting('X'), t.textOutput.downloadedKept(3), t.textOutput.copiedKept(3), t.textOutput.filebarKept(1),
        t.textOutput.filebarKept(3), t.xlsx.resultWarning(3), t.xlsx.checked(4, 2), t.xlsx.notChecked(9), t.entityTable.showPlace,
        t.entityTable.labelTaken('[X]'), t.deAnonymize.docxOnlyDocx, t.toast.dismiss, t.textOutput.nextStepHint,
      ];
      for (const sample of samples) {
        expect(sample, code).toMatch(/\S/);
        expect(sample, code).not.toContain(String.fromCharCode(0x2014));
      }
      expect(t.textOutput.downloadedKept(3), code).toContain('3');
      expect(t.textOutput.copiedKept(3), code).toContain('3');
      expect(t.textOutput.filebarKept(12), code).toContain('12');
      expect(t.xlsx.resultWarning(3), code).toContain('3');
      expect(t.entityTable.labelTaken('[X]'), code).toContain('[X]');
      expect(t.deAnonymize.docxOnlyDocx, code).toContain('PDF');
      if (code !== 'en') {
        expect(t.textOutput.nextStepHint, code).not.toBe(en.textOutput.nextStepHint);
        expect(t.toast.dismiss, code).not.toBe(en.toast.dismiss);
      }
    }
  });
});

describe('fourth pass (T269)', () => {
  it('the cells of a workbook that were not checked can be listed: sheet, address, value', () => {
    const unchecked = [
      { sheet: 'Pracownicy', cell: 'F2', value: '8200.5' },
      { sheet: 'Pracownicy', cell: 'F3', value: '9100' },
      { sheet: 'Podsumowanie', cell: 'B1', value: '3' },
    ];
    render(<Providers><SpreadsheetNotice info={{ dateCells: 6, identifierCells: 3, otherNumberCells: 5, renamedSheets: [], unchecked }} /></Providers>);
    expect(screen.queryByTestId('spreadsheet-cells')).toBeNull();
    const toggle = screen.getByTestId('spreadsheet-cells-toggle');
    expect(toggle).toHaveTextContent(en.xlsx.showCells);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const list = screen.getByTestId('spreadsheet-cells');
    expect(list).toHaveTextContent('Pracownicy!F2: 8200.5');
    expect(list).toHaveTextContent('Podsumowanie!B1: 3');
    // More cells than are listed: said, not hidden.
    expect(list).toHaveTextContent(en.deAnonymize.andMore(2));
  });

  it('readable places are found in the protected text whatever the labels before them did to its length', () => {
    const source = 'Jan Kowalski of Acme Ltd met Anna Nowak of Borg GmbH.';
    const at = (value: string): DetectedEntity => {
      const start = source.indexOf(value);
      return { type: value.includes(' Ltd') || value.includes('GmbH') ? 'COMPANY' : 'PERSON', value, start, end: start + value.length, confidence: 0.9, detector: 'test' };
    };
    const list = [at('Jan Kowalski'), at('Acme Ltd'), at('Anna Nowak'), at('Borg GmbH')];
    const table: ReplacementEntry[] = [
      { original: 'Jan Kowalski', replacement: '[PERSON_1]', entityType: 'PERSON' },
      { original: 'Anna Nowak', replacement: '[THE_SECOND_WITNESS]', entityType: 'PERSON' },
    ];
    const output = '[PERSON_1] of Acme Ltd met [THE_SECOND_WITNESS] of Borg GmbH.';
    const ranges = keptRangesInOutput(source, list, new Set([1, 3]), table, output);
    expect(ranges.map((range) => output.slice(range.start, range.end))).toEqual(['Acme Ltd', 'Borg GmbH']);
    // Nothing kept, or a text that does not match the list: no marks rather than wrong ones.
    expect(keptRangesInOutput(source, list, new Set(), table, output)).toEqual([]);
    expect(keptRangesInOutput(source, list, new Set([1, 3]), table, 'something else entirely, of the same length or not')).toEqual([]);
  });

  it('the protected text marks the places that stay readable', () => {
    const output = '[PERSON_1] of Acme Ltd met [PERSON_2].';
    render(
      <Providers>
        <TextOutput value={output} entries={ENTRIES} replacedPlaces={2} foundPlaces={3}
          keptRanges={[{ start: output.indexOf('Acme Ltd'), end: output.indexOf('Acme Ltd') + 8 }]} />
      </Providers>,
    );
    const kept = document.querySelectorAll('mark[data-kept="true"]');
    expect(kept).toHaveLength(1);
    expect(kept[0]).toHaveTextContent('Acme Ltd');
    expect(kept[0]).toHaveAttribute('title', en.entityTable.keptChip);
    expect(document.querySelectorAll('mark.entity-highlight-animate')).toHaveLength(2);
    // The text itself is unchanged.
    expect(kept[0].parentElement).toHaveTextContent(output);
  });

  it('the least certain finds have their own filter, and the list says what certainty is', () => {
    const mixed = ENTITIES.map((item, index) => (index === 2 || index === 6 ? { ...item, confidence: 0.6 } : item));
    render(
      <Providers>
        <EntityTable entities={mixed} entries={ENTRIES} excludedIndices={new Set()} text={TEXT} onToggle={() => {}} onSetExcluded={() => {}}
          onRenameLabel={() => {}} keepTypes={[]} onKeepTypesChange={() => {}} />
      </Providers>,
    );
    expect(document.body).toHaveTextContent(en.entityTable.certaintyHelp);
    const chip = screen.getByTestId('entity-filter-low');
    expect(chip).toHaveTextContent(`${en.entityTable.lowChip} 2`);
    fireEvent.click(chip);
    expect(rows().map((row) => row.querySelectorAll('td')[2].querySelector('span')?.textContent)).toEqual(['Anna Nowak', 'jan@acme.example']);
    // A narrowed group: the bulk action is offered for it.
    expect(screen.getByTestId('entity-keep-shown')).toHaveTextContent(en.entityTable.dontRedactThese(2));
  });

  it('no low-certainty chip when the detector was sure of everything', () => {
    render(<Table />);
    expect(screen.queryByTestId('entity-filter-low')).toBeNull();
  });

  it('a renamed label has a way back to the numbered one', () => {
    const onResetLabel = vi.fn();
    render(
      <Providers>
        <EntityTable entities={ENTITIES} entries={ENTRIES.map((entry) => (entry.original === 'Anna Nowak' ? { ...entry, replacement: '[WITNESS]' } : entry))}
          excludedIndices={new Set()} text={TEXT} onToggle={() => {}} onSetExcluded={() => {}} onRenameLabel={() => {}}
          renamedValues={new Set(['Anna Nowak'])} onResetLabel={onResetLabel} keepTypes={[]} onKeepTypesChange={() => {}} />
      </Providers>,
    );
    expect(within(rowOf('Jan Kowalski')).queryByTestId('entity-label-reset')).toBeNull();
    const reset = within(rowOf('Anna Nowak')).getByTestId('entity-label-reset');
    expect(reset).toHaveAccessibleName(`${en.entityTable.resetLabel}: [WITNESS]`);
    fireEvent.click(reset);
    expect(onResetLabel).toHaveBeenCalledWith('Anna Nowak');
  });

  it('every language has the strings of the fourth pass', () => {
    for (const { code, translations: t } of languages) {
      for (const sample of [t.xlsx.showCells, t.entityTable.lowChip, t.entityTable.certaintyHelp, t.entityTable.resetLabel]) {
        expect(sample, code).toMatch(/\S/);
        expect(sample, code).not.toContain(String.fromCharCode(0x2014));
      }
      if (code !== 'en') {
        expect(t.entityTable.certaintyHelp, code).not.toBe(en.entityTable.certaintyHelp);
        expect(t.xlsx.showCells, code).not.toBe(en.xlsx.showCells);
      }
    }
  });
});

describe('findings of the fourth assessment (T269)', () => {
  function panel(result: Parameters<typeof DeAnonymize>[0]['onRestoreText'], extra: Partial<Parameters<typeof DeAnonymize>[0]> = {}) {
    render(
      <Providers>
        <DeAnonymize
          onRestoreText={result}
          hasMapping
          mappingCount={4}
          mappingSample={{ replacement: '[PERSON_1]', original: 'Jan Kowalski' }}
          onRestoreDocx={async () => ({ success: false, message: '' })}
          onExportMapping={() => null}
          onImportMapping={async () => null}
          importedMapping={null}
          onClearImportedMapping={() => {}}
          onDownload={() => {}}
          {...extra}
        />
      </Providers>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste the AI/), { target: { value: 'reply' } });
    fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.restoreButton }));
  }

  it('a label from an earlier state of the list is named with the value it stood for, not blamed on the AI', () => {
    panel(() => ({
      text: 'Ask [PERSON_2] and Anna Nowak.', restored: 1, unresolved: ['[PERSON_2]'],
      segments: [{ text: 'Ask ', kind: 'plain' }, { text: '[PERSON_2]', kind: 'leftover' }, { text: ' and ', kind: 'plain' }, { text: 'Anna Nowak', kind: 'restored' }, { text: '.', kind: 'plain' }],
      stale: [{ label: '[PERSON_2]', original: 'Dwayne Okafor' }], others: [],
    }));
    const left = screen.getByTestId('restore-text-unresolved');
    expect(within(left).getByTestId('restore-text-unresolved-stale')).toHaveTextContent(en.deAnonymize.staleLabel('[PERSON_2]', 'Dwayne Okafor'));
    // Every leftover is explained: the "AI changed it" guess is not shown.
    expect(left).not.toHaveTextContent(en.deAnonymize.leftoverHelp);
    expect(screen.getByTestId('restore-text-status')).not.toHaveTextContent(en.deAnonymize.allClear);
  });

  it('other text in brackets is listed and no all-clear is given over it', () => {
    panel(() => ({
      text: 'Jan Kowalski and [PERSON] per [NAME_1].', restored: 1, unresolved: [],
      segments: [{ text: 'Jan Kowalski', kind: 'restored' }, { text: ' and [PERSON] per [NAME_1].', kind: 'plain' }],
      stale: [], others: ['[PERSON]', '[NAME_1]'],
    }));
    const status = screen.getByTestId('restore-text-status');
    expect(status).not.toHaveTextContent(en.deAnonymize.allClear);
    const others = screen.getByTestId('restore-text-unresolved-others');
    expect(others).toHaveTextContent(en.deAnonymize.otherBrackets);
    expect(others).toHaveTextContent('[PERSON]');
    expect(others).toHaveTextContent('[NAME_1]');
    expect(screen.queryByTestId('restore-text-unresolved')).toBeNull();
  });

  it('the report names the table when a file did the restoring, and the copy says when labels are still in the text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    panel(() => ({
      text: 'Maria Lis and [PERSON_9].', restored: 1, unresolved: ['[PERSON_9]'],
      segments: [{ text: 'Maria Lis', kind: 'restored' }, { text: ' and ', kind: 'plain' }, { text: '[PERSON_9]', kind: 'leftover' }, { text: '.', kind: 'plain' }],
      stale: [], others: [],
    }), { importedMapping: { fileName: 'saved.json', count: 9, sample: { replacement: '[PERSON_1]', original: 'Maria Lis' } } });
    expect(screen.getByTestId('restore-file-table')).toHaveTextContent(en.deAnonymize.usedFileTable('saved.json'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.copy })); });
    expect(screen.getByText(en.deAnonymize.copiedWithLabels(1))).toBeInTheDocument();
  });

  it('a click on a found value in the source text leaves it readable with a trace, instead of deleting the find', () => {
    const onToggleEntity = vi.fn();
    const onRemoveEntity = vi.fn();
    render(
      <Providers>
        <TextInput value={TEXT} onChange={() => {}} onClear={() => {}} entities={ENTITIES} onRemoveEntity={onRemoveEntity}
          onToggleEntity={onToggleEntity} keptIndices={new Set([1])} hasResult />
      </Providers>,
    );
    const marks = Array.from(document.querySelectorAll<HTMLElement>('mark[data-start]'));
    const redacted = marks.find((mark) => mark.textContent === 'Jan' || mark.textContent?.startsWith('Jan')) as HTMLElement;
    fireEvent.click(redacted);
    expect(onRemoveEntity).not.toHaveBeenCalled();
    expect(onToggleEntity).toHaveBeenCalledWith(0);
    expect(screen.getByText(en.entityTable.keptToast(1))).toBeInTheDocument();
    // A place that is not redacted is marked as such and a click redacts it again.
    const kept = marks.filter((mark) => mark.dataset.kept === 'true');
    expect(kept.length).toBeGreaterThan(0);
    expect(kept[0].getAttribute('aria-label')).toMatch(new RegExp(`^${en.entityTable.include}: `));
    fireEvent.click(kept[0]);
    expect(onToggleEntity).toHaveBeenLastCalledWith(1);
    // A result exists: the footer no longer says "ready, click Redact".
    expect(document.body).not.toHaveTextContent(en.textInput.readyToRedact);
  });

  it('Undo of a click in the source text acts on that place, also after the list changed under it', () => {
    const onToggleEntity = vi.fn();
    const view = render(
      <Providers>
        <TextInput value={TEXT} onChange={() => {}} onClear={() => {}} entities={ENTITIES} onToggleEntity={onToggleEntity} keptIndices={new Set()} hasResult />
      </Providers>,
    );
    // "Anna Nowak" is place 2 of the list.
    const mark = Array.from(document.querySelectorAll<HTMLElement>('mark[data-start]')).find((m) => m.textContent?.startsWith('Anna')) as HTMLElement;
    fireEvent.click(mark);
    expect(onToggleEntity).toHaveBeenLastCalledWith(2);
    // A value marked by hand before it moves every later place by one; the click left place 2 (now 3) readable.
    const added: DetectedEntity = { type: 'OTHER', value: 'of', start: TEXT.indexOf(' of ') + 1, end: TEXT.indexOf(' of ') + 3, confidence: 1, detector: 'manual' };
    const moved = [...ENTITIES, added].sort((a, b) => a.start - b.start);
    view.rerender(
      <Providers>
        <TextInput value={TEXT} onChange={() => {}} onClear={() => {}} entities={moved} onToggleEntity={onToggleEntity} keptIndices={new Set([3])} hasResult />
      </Providers>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(onToggleEntity).toHaveBeenLastCalledWith(3);
    expect(onToggleEntity).toHaveBeenCalledTimes(2);
  });

  it('Undo does nothing when the place was already redacted again by hand', () => {
    const onToggleEntity = vi.fn();
    const view = render(
      <Providers>
        <TextInput value={TEXT} onChange={() => {}} onClear={() => {}} entities={ENTITIES} onToggleEntity={onToggleEntity} keptIndices={new Set()} hasResult />
      </Providers>,
    );
    const mark = Array.from(document.querySelectorAll<HTMLElement>('mark[data-start]')).find((m) => m.textContent?.startsWith('Anna')) as HTMLElement;
    fireEvent.click(mark);
    // The parent never marked it as kept (or the user redacted it again): there is nothing to undo.
    view.rerender(
      <Providers>
        <TextInput value={TEXT} onChange={() => {}} onClear={() => {}} entities={ENTITIES} onToggleEntity={onToggleEntity} keptIndices={new Set()} hasResult />
      </Providers>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(onToggleEntity).toHaveBeenCalledTimes(1);
  });

  it('copying the protected text by hand counts as taking it out', () => {
    const onCopied = vi.fn();
    render(<Providers><TextOutput value="[PERSON_1] signed" entries={ENTRIES} replacedPlaces={1} foundPlaces={1} onCopied={onCopied} /></Providers>);
    fireEvent.copy(document.querySelector('mark.entity-highlight-animate') as HTMLElement);
    expect(onCopied).toHaveBeenCalledTimes(1);
  });

  it('Undo of a bulk action reaches its places after the list changed, and does nothing in another text', () => {
    const onSetExcluded = vi.fn();
    const props = { entries: ENTRIES, excludedIndices: new Set<number>(), onToggle: () => {}, onSetExcluded, onRenameLabel: () => {}, keepTypes: [] as DetectedEntity['type'][], onKeepTypesChange: () => {} };
    const view = render(<Providers><EntityTable entities={ENTITIES} text={TEXT} {...props} /></Providers>);
    fireEvent.click(screen.getByTestId('entity-filter-type-COMPANY'));
    fireEvent.click(screen.getByTestId('entity-keep-shown'));
    expect([...(onSetExcluded.mock.calls.at(-1)?.[0] as number[])].sort()).toEqual([1, 3, 4]);
    expect(onSetExcluded.mock.calls.at(-1)?.[1]).toBe(true);
    // A value marked by hand at the very start: every place is one further down the list.
    const added: DetectedEntity = { type: 'OTHER', value: 'Jan', start: 0, end: 3, confidence: 1, detector: 'manual' };
    view.rerender(<Providers><EntityTable entities={[added, ...ENTITIES]} text={TEXT} {...props} excludedIndices={new Set([2, 4, 5])} /></Providers>);
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(onSetExcluded).toHaveBeenLastCalledWith([2, 4, 5], false);
    expect(onSetExcluded).toHaveBeenCalledTimes(2);
  });

  it('a drag that selects part of a found value is a selection, not a click', () => {
    const onToggleEntity = vi.fn();
    render(
      <Providers>
        <TextInput value={TEXT} onChange={() => {}} onClear={() => {}} entities={ENTITIES} onToggleEntity={onToggleEntity} keptIndices={new Set()} hasResult />
      </Providers>,
    );
    const mark = Array.from(document.querySelectorAll<HTMLElement>('mark[data-start]')).find((m) => m.textContent?.startsWith('Anna')) as HTMLElement;
    const range = document.createRange();
    range.setStart(mark.firstChild as Node, 0);
    range.setEnd(mark.firstChild as Node, 3);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.click(mark);
    expect(onToggleEntity).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
    fireEvent.click(mark);
    expect(onToggleEntity).toHaveBeenCalledTimes(1);
  });

  it('a press that moved before it was released is not a click on a found value', () => {
    const onToggleEntity = vi.fn();
    render(
      <Providers>
        <TextInput value={TEXT} onChange={() => {}} onClear={() => {}} entities={ENTITIES} onToggleEntity={onToggleEntity} keptIndices={new Set()} hasResult />
      </Providers>,
    );
    const mark = Array.from(document.querySelectorAll<HTMLElement>('mark[data-start]')).find((m) => m.textContent?.startsWith('Anna')) as HTMLElement;
    // Down at one point, up 40 px further: a drag across part of the value (the selection is already gone when the click arrives).
    fireEvent.mouseDown(mark, { clientX: 100, clientY: 50 });
    fireEvent.click(mark, { clientX: 140, clientY: 50 });
    expect(onToggleEntity).not.toHaveBeenCalled();
    fireEvent.mouseDown(mark, { clientX: 100, clientY: 50 });
    fireEvent.click(mark, { clientX: 101, clientY: 50 });
    expect(onToggleEntity).toHaveBeenCalledTimes(1);
  });

  it('places lost by a re-run stay named at the result until they are answered', () => {
    const onKeepDropped = vi.fn();
    const onDismissDropped = vi.fn();
    render(
      <Providers>
        <TextOutput value="[PERSON_1] met Lauren Byrne" entries={ENTRIES} replacedPlaces={5} foundPlaces={5}
          droppedCount={2} onKeepDropped={onKeepDropped} onDismissDropped={onDismissDropped} />
      </Providers>,
    );
    const notice = screen.getByTestId('result-dropped');
    expect(notice).toHaveTextContent(en.entityTable.droppedToast(2));
    // "Everything found is replaced" is true and beside the point: no green line next to it.
    expect(screen.queryByTestId('result-all-replaced-hint')).toBeNull();
    fireEvent.click(screen.getByTestId('result-dropped-keep'));
    expect(onKeepDropped).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('result-dropped-dismiss'));
    expect(onDismissDropped).toHaveBeenCalledTimes(1);
  });

  it('a text in which nothing was found is not called replaced or safe', () => {
    render(<Providers><TextOutput value="Plain text with no data." entries={[]} replacedPlaces={0} foundPlaces={0} /></Providers>);
    expect(screen.getByTestId('result-nothing-found')).toHaveTextContent(en.textOutput.noDetectionsText);
    expect(screen.queryByTestId('result-all-replaced-hint')).toBeNull();
    expect(screen.queryByTestId('result-review')).toBeNull();
  });

  it('"Not redacted" counts the places that are not redacted, also for a value redacted in part', () => {
    render(<Table excluded={[4]} />);
    fireEvent.click(screen.getByTestId('entity-filter-kept'));
    expect(screen.getByTestId('entity-filter-count')).toHaveTextContent(en.entityTable.showing(1, 7));
    expect(screen.getByTestId('entity-redact-shown')).toHaveTextContent(en.entityTable.redactThese(1));
  });

  it('exactly 80% is not "low certainty" (pattern rules report a flat 80%)', () => {
    const flat = ENTITIES.map((item, index) => (index === 6 ? { ...item, confidence: 0.8 } : item));
    render(
      <Providers>
        <EntityTable entities={flat} entries={ENTRIES} excludedIndices={new Set()} text={TEXT} onToggle={() => {}} onSetExcluded={() => {}}
          onRenameLabel={() => {}} keepTypes={[]} onKeepTypesChange={() => {}} />
      </Providers>,
    );
    expect(screen.queryByTestId('entity-filter-low')).toBeNull();
  });

  it('every language has the strings of this round, and the hint names the dashed line', () => {
    for (const { code, translations: t } of languages) {
      const samples = [
        t.textOutput.changedAfterTaken, t.entityTable.labelTaken('[X]', 'Jan'), t.deAnonymize.staleLabel('[X]', 'Jan'), t.deAnonymize.otherBrackets,
        t.deAnonymize.usedFileTable('f.json'), t.deAnonymize.copiedWithLabels(2), t.textOutput.noDetectionsText, t.tableReminder.clearConfirm,
        t.xlsx.downloadedUnchecked(3), t.entityTable.resetLabel, t.textOutput.keptHint(2),
      ];
      for (const sample of samples) {
        expect(sample, code).toMatch(/\S/);
        expect(sample, code).not.toContain(String.fromCharCode(0x2014));
      }
      expect(t.entityTable.labelTaken('[X]', 'Jan'), code).toMatch(/\[X\].*Jan/);
      expect(t.deAnonymize.staleLabel('[X]', 'Jan'), code).toMatch(/\[X\].*Jan/);
      expect(t.deAnonymize.usedFileTable('f.json'), code).toContain('f.json');
      if (code !== 'en') {
        expect(t.tableReminder.clearConfirm, code).not.toBe(en.tableReminder.clearConfirm);
        expect(t.textOutput.keptHint(2), code).not.toBe(en.textOutput.keptHint(2));
      }
    }
    expect(en.textOutput.keptHint(2)).toMatch(/dashed underline/);
  });
});


describe('whose table did the restoring (T269)', () => {
  function show(extra: Partial<Parameters<typeof DeAnonymize>[0]>, result: Partial<ReturnType<Parameters<typeof DeAnonymize>[0]['onRestoreText']>> = {}) {
    render(
      <Providers>
        <DeAnonymize
          onRestoreText={() => ({ text: 'Jan Kowalski signed', restored: 1, unresolved: [], segments: [{ text: 'Jan Kowalski', kind: 'restored' }, { text: ' signed', kind: 'plain' }], stale: [], others: [], ...result })}
          hasMapping
          mappingCount={4}
          mappingSample={{ replacement: '[PERSON_1]', original: 'Jan Kowalski' }}
          onRestoreDocx={async () => ({ success: false, message: '' })}
          onExportMapping={() => null}
          onImportMapping={async () => null}
          importedMapping={null}
          onClearImportedMapping={() => {}}
          onDownload={() => {}}
          {...extra}
        />
      </Providers>,
    );
    fireEvent.change(screen.getByPlaceholderText(/Paste the AI/), { target: { value: '[PERSON_1] signed' } });
    fireEvent.click(screen.getByRole('button', { name: en.deAnonymize.restoreButton }));
    return screen.getByTestId('restore-text-status');
  }

  it('the report names the document table with one of its pairs', () => {
    const status = show({ resultTakenOut: true });
    expect(screen.getByTestId('restore-document-table')).toHaveTextContent(en.deAnonymize.usedDocumentTable('[PERSON_1]', 'Jan Kowalski'));
    expect(screen.queryByTestId('restore-not-taken-out')).toBeNull();
    expect(status).toHaveTextContent(en.deAnonymize.allClear);
  });

  it('a reply restored before the protected text ever left the page is flagged, with no all-clear', () => {
    const status = show({ resultTakenOut: false });
    expect(screen.getByTestId('restore-not-taken-out')).toHaveTextContent(en.deAnonymize.notTakenOut);
    expect(status).not.toHaveTextContent(en.deAnonymize.allClear);
  });

  it('a file table that restored labels the open document also uses is flagged, with no all-clear', () => {
    const status = show(
      { importedMapping: { fileName: 'saved.json', count: 9, sample: { replacement: '[PERSON_1]', original: 'Maria Lis' } } },
      { fileOverDocument: true },
    );
    expect(screen.getByTestId('restore-file-over-document')).toHaveTextContent(en.deAnonymize.fileOverDocument);
    expect(screen.getByTestId('restore-file-table')).toBeInTheDocument();
    expect(status).not.toHaveTextContent(en.deAnonymize.allClear);
  });

  it('every language has these strings', () => {
    for (const { code, translations: t } of languages) {
      for (const sample of [t.deAnonymize.notTakenOut, t.deAnonymize.fileOverDocument, t.deAnonymize.usedDocumentTable('[X]', 'Jan'), t.deAnonymize.staleTwo('[X]', 'Jan'),
        t.entityTable.labelInvalid, t.entityTable.labelOwnShape('[X]'), t.entityTable.labelDerivedTaken('[X]', '[X_LAST]', 'Jan'), t.textInput.alsoElsewhere(2), t.textInput.redactThemToo,
        t.deAnonymize.staleElsewhere('[X]'), t.deAnonymize.unreadLabel('[X]', 'Jan'), t.entityTable.labelsNotStable]) {
        expect(sample, code).toMatch(/\S/);
        expect(sample, code).not.toContain(String.fromCharCode(0x2014));
      }
      expect(t.entityTable.labelDerivedTaken('[X]', '[X_LAST]', 'Jan'), code).toMatch(/\[X\].*\[X_LAST\].*Jan/);
      if (code !== 'en') expect(t.deAnonymize.notTakenOut, code).not.toBe(en.deAnonymize.notTakenOut);
    }
  });
});
