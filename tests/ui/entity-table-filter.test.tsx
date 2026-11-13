// WLojek/DocCloak#4: keep a whole category (or every value containing a text)
// visible in one step. The table filters by type and by original value and
// acts on everything shown; the hook applies the change with one rebuild and
// a renamed label survives it (it used to fall back to the numbered one).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, EngineClient, ReplacementEntry } from '@doccloak/core';
import { EntityTable } from '../../src/ui/components/EntityTable.tsx';
import { useAnonymizer } from '../../src/ui/hooks/useAnonymizer.ts';
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

// Sorted by position, as the hook keeps them.
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

function renderTable(excluded: number[] = [], keepTypes: DetectedEntity['type'][] = []) {
  const onSetExcluded = vi.fn();
  const onToggle = vi.fn();
  const onRenameLabel = vi.fn();
  const onKeepTypesChange = vi.fn();
  render(
    <Providers>
      <EntityTable
        entities={ENTITIES}
        entries={ENTRIES}
        excludedIndices={new Set(excluded)}
        text={TEXT}
        onToggle={onToggle}
        onSetExcluded={onSetExcluded}
        onRenameLabel={onRenameLabel}
        keepTypes={keepTypes}
        onKeepTypesChange={onKeepTypesChange}
      />
    </Providers>,
  );
  return { onSetExcluded, onToggle, onRenameLabel, onKeepTypesChange };
}

/** Value rows of the desktop table (the mobile cards repeat them; the rows that list places are not values). */
function valueRows(): HTMLElement[] {
  const table = document.querySelector('table');
  return table ? Array.from(table.querySelectorAll<HTMLElement>('tbody tr[data-count]')) : [];
}

/** Original values shown, one per row. */
function shownValues(): string[] {
  return valueRows().map((row) => row.querySelectorAll('td')[2].querySelector('span')?.textContent ?? '');
}

function rowOf(value: string): HTMLElement {
  const row = valueRows().find((r) => r.querySelectorAll('td')[2].querySelector('span')?.textContent === value);
  if (!row) throw new Error(`no row for ${value}`);
  return row;
}

const sorted = (indices: number[]) => [...indices].sort((a, b) => a - b);

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EntityTable: one row per value (T262)', () => {
  it('lists each value once, in the order it first appears, with how many places it stands in', () => {
    renderTable();
    // 7 places, 5 different values.
    expect(shownValues()).toEqual(['Jan Kowalski', 'Acme Ltd', 'Anna Nowak', 'Borg GmbH', 'jan@acme.example']);
    expect(valueRows().map((row) => row.getAttribute('data-count'))).toEqual(['2', '2', '1', '1', '1']);
    expect(within(rowOf('Jan Kowalski')).getByTestId('entity-group-count')).toHaveTextContent('×2');
    expect(within(rowOf('Anna Nowak')).queryByTestId('entity-group-count')).toBeNull();
    // The counts of the bar stay in places, like the heading.
    expect(screen.getByRole('heading', { name: en.entityTable.title(7) })).toBeInTheDocument();
    expect(screen.getByTestId('entity-filter-count')).toHaveTextContent(en.entityTable.showing(7, 7));
  });

  it('the box of a value redacts or keeps every place of it', () => {
    const { onSetExcluded, onToggle } = renderTable();
    const box = within(rowOf('Acme Ltd')).getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'true');
    // One stable name: checked means redacted.
    expect(box).toHaveAccessibleName(`${en.entityTable.include}: Acme Ltd`);
    fireEvent.click(box);
    expect(onSetExcluded).toHaveBeenCalledWith([1, 4], true);
    // A value that stands in one place is a single toggle.
    fireEvent.click(within(rowOf('Anna Nowak')).getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith(2);
  });

  it('a value with some places kept shows a mixed box; a click redacts all of it again', () => {
    const { onSetExcluded } = renderTable([4]);
    const box = within(rowOf('Acme Ltd')).getByRole('checkbox');
    expect(box).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(box);
    expect(onSetExcluded).toHaveBeenCalledWith([1, 4], false);
  });

  it('the places of a repeated value open on demand, each with the words around it and its own box', () => {
    const { onToggle } = renderTable();
    expect(screen.queryByTestId('entity-group-places')).toBeNull();
    const count = within(rowOf('Jan Kowalski')).getByTestId('entity-group-count');
    expect(count).toHaveAttribute('aria-expanded', 'false');
    expect(count).toHaveAccessibleName(en.entityTable.places(2));
    fireEvent.click(count);
    expect(count).toHaveAttribute('aria-expanded', 'true');
    const table = document.querySelector('table') as HTMLElement;
    const places = within(table).getByTestId('entity-group-places');
    const items = within(places).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Jan Kowalski of Acme Ltd met Anna Nowak');
    expect(items[1]).toHaveTextContent('Acme Ltd pays Jan Kowalski; write to jan@acme.example.');
    fireEvent.click(within(items[1]).getByRole('checkbox'));
    expect(onToggle).toHaveBeenCalledWith(5);
    fireEvent.click(count);
    expect(within(table).queryByTestId('entity-group-places')).toBeNull();
  });
});

describe('EntityTable filter and bulk actions (WLojek/DocCloak#4)', () => {
  it('lists every type with its count of places, most frequent first', () => {
    renderTable();
    const filter = screen.getByTestId('entity-filter');
    const chips = within(filter).getAllByRole('button').slice(0, 4).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(chips).toEqual([`${en.entityTable.allTypes} 7`, `${en.entityLabels.PERSON} 3`, `${en.entityLabels.COMPANY} 3`, `${en.entityLabels.EMAIL} 1`]);
    expect(screen.getByTestId('entity-filter-status')).toHaveTextContent(en.entityTable.status(7, 0));
  });

  it('offers no bulk action until the list is narrowed down: one click must not un-redact a whole document', () => {
    renderTable();
    expect(screen.queryByTestId('entity-keep-shown')).toBeNull();
    expect(screen.queryByTestId('entity-redact-shown')).toBeNull();
    expect(screen.getByTestId('entity-filter-hint')).toHaveTextContent(en.entityTable.bulkHint);
    // Nothing is kept yet, so there is nothing to list under "not redacted".
    expect(screen.queryByTestId('entity-filter-kept')).toBeNull();
    fireEvent.click(screen.getByTestId('entity-filter-type-EMAIL'));
    expect(screen.queryByTestId('entity-filter-hint')).toBeNull();
    expect(screen.getByTestId('entity-keep-shown')).toHaveTextContent(en.entityTable.dontRedactThese(1));
  });

  it('a type chip narrows the list and the action takes every place of the values shown', () => {
    const { onSetExcluded } = renderTable();
    fireEvent.click(screen.getByTestId('entity-filter-type-COMPANY'));
    expect(shownValues()).toEqual(['Acme Ltd', 'Borg GmbH']);
    expect(screen.getByTestId('entity-filter-count')).toHaveTextContent(en.entityTable.showing(3, 7));
    expect(screen.getByTestId('entity-filter-type-COMPANY')).toHaveAttribute('aria-pressed', 'true');

    const keep = screen.getByTestId('entity-keep-shown');
    expect(keep).toHaveTextContent(en.entityTable.dontRedactThese(3));
    // Nothing shown is kept yet: the opposite action is not offered.
    expect(screen.queryByTestId('entity-redact-shown')).toBeNull();
    fireEvent.click(keep);
    expect(onSetExcluded).toHaveBeenCalledTimes(1);
    expect(sorted(onSetExcluded.mock.calls[0][0])).toEqual([1, 3, 4]);
    expect(onSetExcluded.mock.calls[0][1]).toBe(true);
  });

  it('several types can be chosen, "All" clears them', () => {
    renderTable();
    fireEvent.click(screen.getByTestId('entity-filter-type-COMPANY'));
    fireEvent.click(screen.getByTestId('entity-filter-type-EMAIL'));
    expect(shownValues()).toEqual(['Acme Ltd', 'Borg GmbH', 'jan@acme.example']);
    fireEvent.click(within(screen.getByTestId('entity-filter')).getByRole('button', { name: new RegExp(`^${en.entityTable.allTypes}`) }));
    expect(shownValues()).toHaveLength(5);
  });

  it('the text filter matches the original value, whatever the case, and combines with the type', () => {
    const { onSetExcluded } = renderTable();
    const input = screen.getByPlaceholderText(en.entityTable.filterPlaceholder);
    fireEvent.change(input, { target: { value: 'ACME' } });
    expect(shownValues()).toEqual(['Acme Ltd', 'jan@acme.example']);
    fireEvent.click(screen.getByTestId('entity-filter-type-COMPANY'));
    expect(shownValues()).toEqual(['Acme Ltd']);
    fireEvent.click(screen.getByTestId('entity-keep-shown'));
    expect(sorted(onSetExcluded.mock.calls[0][0])).toEqual([1, 4]);
  });

  it('"redact these" brings back only the shown places that are kept', () => {
    const { onSetExcluded } = renderTable([1, 3, 4, 6]);
    fireEvent.click(screen.getByTestId('entity-filter-type-COMPANY'));
    expect(screen.queryByTestId('entity-keep-shown')).toBeNull();
    const redact = screen.getByTestId('entity-redact-shown');
    expect(redact).toHaveTextContent(en.entityTable.redactThese(3));
    fireEvent.click(redact);
    expect(sorted(onSetExcluded.mock.calls[0][0])).toEqual([1, 3, 4]);
    expect(onSetExcluded.mock.calls[0][1]).toBe(false);
  });

  it('says how much is redacted at all times and lists what is not, to redact it again in one step', () => {
    const { onSetExcluded } = renderTable([1, 3, 4, 6]);
    expect(screen.getByTestId('entity-filter-status')).toHaveTextContent(en.entityTable.status(3, 4));
    const kept = screen.getByTestId('entity-filter-kept');
    expect(kept).toHaveTextContent(`${en.entityTable.keptChip} 4`);
    expect(kept).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(kept);
    expect(kept).toHaveAttribute('aria-pressed', 'true');
    expect(shownValues()).toEqual(['Acme Ltd', 'Borg GmbH', 'jan@acme.example']);
    // Listing what is kept offers one thing: redact it again.
    expect(screen.queryByTestId('entity-keep-shown')).toBeNull();
    fireEvent.click(screen.getByTestId('entity-redact-shown'));
    expect(sorted(onSetExcluded.mock.calls[0][0])).toEqual([1, 3, 4, 6]);
    expect(onSetExcluded.mock.calls[0][1]).toBe(false);
    // It combines with a type.
    fireEvent.click(screen.getByTestId('entity-filter-type-EMAIL'));
    expect(shownValues()).toEqual(['jan@acme.example']);
  });

  it('the "not redacted" filter ends when nothing is kept, and does not come back by itself', () => {
    const props = { entities: ENTITIES, entries: ENTRIES, text: TEXT, onToggle: () => {}, onSetExcluded: () => {}, onRenameLabel: () => {}, keepTypes: [], onKeepTypesChange: () => {} };
    const view = render(<Providers><EntityTable {...props} excludedIndices={new Set([6])} /></Providers>);
    fireEvent.click(screen.getByTestId('entity-filter-kept'));
    expect(shownValues()).toEqual(['jan@acme.example']);
    // Everything is redacted again: the whole list is back.
    view.rerender(<Providers><EntityTable {...props} excludedIndices={new Set()} /></Providers>);
    expect(shownValues()).toHaveLength(5);
    // One place is kept later: the list stays whole, the chip is offered unpressed.
    view.rerender(<Providers><EntityTable {...props} excludedIndices={new Set([2])} /></Providers>);
    expect(shownValues()).toHaveLength(5);
    expect(screen.getByTestId('entity-filter-kept')).toHaveAttribute('aria-pressed', 'false');
  });

  it('the text filter ignores accents and case', () => {
    const accented: DetectedEntity[] = [
      { type: 'COMPANY', value: 'SAS MÉDITERRANÉE FROID', start: 0, end: 22, confidence: 0.9, detector: 'test' },
      { type: 'ADDRESS', value: 'Łódź, ul. Żółta 3', start: 30, end: 47, confidence: 0.9, detector: 'test' },
      { type: 'PERSON', value: 'Jan Kowalski', start: 50, end: 62, confidence: 0.9, detector: 'test' },
    ];
    render(
      <Providers>
        <EntityTable entities={accented} entries={[]} excludedIndices={new Set()} text="" onToggle={() => {}} onSetExcluded={() => {}} onRenameLabel={() => {}} keepTypes={[]} onKeepTypesChange={() => {}} />
      </Providers>,
    );
    const input = screen.getByPlaceholderText(en.entityTable.filterPlaceholder);
    fireEvent.change(input, { target: { value: 'mediterranee' } });
    expect(shownValues()).toEqual(['SAS MÉDITERRANÉE FROID']);
    fireEvent.change(input, { target: { value: 'lodz' } });
    expect(shownValues()).toEqual(['Łódź, ul. Żółta 3']);
    fireEvent.change(input, { target: { value: 'ŻÓŁTA' } });
    expect(shownValues()).toEqual(['Łódź, ul. Żółta 3']);
  });

  it('the toast offers Undo, which reverses exactly the change', () => {
    const { onSetExcluded } = renderTable();
    fireEvent.click(screen.getByTestId('entity-filter-type-PERSON'));
    fireEvent.click(screen.getByTestId('entity-keep-shown'));
    expect(screen.getByText(en.entityTable.keptToast(3))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    const last = onSetExcluded.mock.calls[onSetExcluded.mock.calls.length - 1];
    expect(sorted(last[0])).toEqual([0, 2, 5]);
    expect(last[1]).toBe(false);
  });

  it('a filter with no match says so and can be cleared', () => {
    renderTable();
    fireEvent.change(screen.getByPlaceholderText(en.entityTable.filterPlaceholder), { target: { value: 'zzz' } });
    expect(screen.getByTestId('entity-filter-empty')).toHaveTextContent(en.entityTable.noMatches);
    expect(document.querySelector('table')).toBeNull();
    expect(screen.queryByTestId('entity-keep-shown')).toBeNull();
    fireEvent.click(within(screen.getByTestId('entity-filter-empty')).getByRole('button', { name: en.entityTable.clearFilter }));
    expect(shownValues()).toHaveLength(5);
  });
});

describe('EntityTable: never anonymize a type (T263)', () => {
  it('is offered where the choice is made: one type on screen', () => {
    const { onKeepTypesChange } = renderTable();
    expect(screen.queryByTestId('entity-never-offer')).toBeNull();
    fireEvent.click(screen.getByTestId('entity-filter-type-COMPANY'));
    const offer = screen.getByTestId('entity-never-offer');
    expect(offer).toHaveTextContent(en.entityTable.neverOffer(en.entityLabels.COMPANY));
    // A button, not a box: in this list a ticked box means "redact".
    expect(offer.tagName).toBe('BUTTON');
    expect(within(offer).queryByRole('checkbox')).toBeNull();
    fireEvent.click(offer);
    expect(onKeepTypesChange).toHaveBeenCalledWith(['COMPANY']);
    // Two types, or a text filter: not one type any more.
    fireEvent.click(screen.getByTestId('entity-filter-type-EMAIL'));
    expect(screen.queryByTestId('entity-never-offer')).toBeNull();
  });

  it('is named for as long as it is in force, with a way out', () => {
    const { onKeepTypesChange } = renderTable([1, 3, 4], ['COMPANY', 'DATE']);
    const note = screen.getByTestId('entity-never-note');
    expect(note).toHaveTextContent(en.entityTable.neverNote);
    expect(note).toHaveTextContent(en.entityLabels.COMPANY);
    expect(note).toHaveTextContent(en.entityLabels.DATE);
    fireEvent.click(within(note).getByRole('button', { name: en.entityTable.neverRemove(en.entityLabels.COMPANY) }));
    expect(onKeepTypesChange).toHaveBeenCalledWith(['DATE']);
    // Already set: not offered a second time.
    fireEvent.click(screen.getByTestId('entity-filter-type-COMPANY'));
    expect(screen.queryByTestId('entity-never-offer')).toBeNull();
  });
});

describe('EntityTable: labels and badges (T266)', () => {
  it('a label is renamed through a real button, in the one cell that was activated', () => {
    const { onRenameLabel } = renderTable();
    const table = document.querySelector('table') as HTMLElement;
    const button = within(rowOf('Jan Kowalski')).getByRole('button', { name: `${en.entityTable.clickToRename}: [PERSON_1]` });
    // Reachable with the keyboard: a button in the tab order, not a click-only span.
    expect(button.tagName).toBe('BUTTON');
    expect(button.tabIndex).toBe(0);
    fireEvent.click(button);
    const inputs = Array.from(document.querySelectorAll('input:not([type="search"])')) as HTMLInputElement[];
    expect(inputs).toHaveLength(1);
    expect(table.contains(inputs[0])).toBe(true);
    expect(inputs[0].value).toBe('PERSON_1');
    expect(document.activeElement).toBe(inputs[0]);
    fireEvent.change(inputs[0], { target: { value: 'CLIENT' } });
    fireEvent.keyDown(inputs[0], { key: 'Enter' });
    expect(onRenameLabel).toHaveBeenCalledTimes(1);
    expect(onRenameLabel).toHaveBeenCalledWith('Jan Kowalski', '[CLIENT]');
    expect(document.querySelectorAll('input:not([type="search"])')).toHaveLength(0);
  });

  it('Escape leaves the label as it was', () => {
    const { onRenameLabel } = renderTable();
    fireEvent.click(within(rowOf('Acme Ltd')).getByRole('button', { name: `${en.entityTable.clickToRename}: [COMPANY_1]` }));
    const input = document.querySelector('input:not([type="search"])') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRenameLabel).not.toHaveBeenCalled();
    expect(document.querySelectorAll('input:not([type="search"])')).toHaveLength(0);
  });

  it('the word of a type badge is dark on its tint: the colour is carried by the square', () => {
    renderTable();
    const badge = rowOf('Acme Ltd').querySelector('td span') as HTMLElement;
    expect(badge).toHaveTextContent(en.entityLabels.COMPANY);
    // No coloured text (it measured 3.5:1 on its own tint); the tint and the square keep the colour.
    expect(badge.style.color).toBe('');
    expect(badge.className).toContain('text-[#111111]');
    expect(badge.style.backgroundColor).not.toBe('');
  });

  it('every language has the strings of the list', () => {
    for (const { code, translations: t } of languages) {
      for (const key of ['filterLabel', 'allTypes', 'keptChip', 'filterPlaceholder', 'clearFilter', 'bulkHint', 'noMatches', 'choicesKeptToast', 'neverNote'] as const) {
        expect(t.entityTable[key], `${code}.${key}`).toMatch(/\S/);
      }
      expect(t.entityTable.showing(3, 7), code).toMatch(/3.*7/);
      expect(t.entityTable.showing(7, 7), code).toContain('7');
      for (const fn of ['dontRedactThese', 'redactThese', 'keptToast', 'redactedToast', 'places'] as const) {
        expect(t.entityTable[fn](5), `${code}.${fn}`).toContain('5');
        expect(t.entityTable[fn](1), `${code}.${fn}`).toMatch(/\S/);
        expect(t.entityTable[fn](1), `${code}.${fn}`).not.toMatch(/undefined|NaN/);
      }
      expect(t.entityTable.status(242, 54), code).toMatch(/242.*54/);
      expect(t.entityTable.neverOffer('X-TYPE'), code).toContain('X-TYPE');
      expect(t.entityTable.neverRemove('X-TYPE'), code).toContain('X-TYPE');
      expect(t.settings.neverTitle, code).toMatch(/\S/);
      expect(t.settings.neverDescription, code).toMatch(/\S/);
      // The two actions must never read alike.
      expect(t.entityTable.dontRedactThese(5), code).not.toBe(t.entityTable.redactThese(5));
      if (code !== 'en') expect(t.entityTable.dontRedactThese(2), code).not.toBe(en.entityTable.dontRedactThese(2));
    }
  });
});

describe('useAnonymizer bulk exclusion and renamed labels', () => {
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
    Element.prototype.scrollIntoView = vi.fn();
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

  it('keeps a whole type visible in one step; the other placeholders keep their numbers', async () => {
    const hook = await redacted();
    expect(hook.result.current.anonymizedText).toBe(
      '[PERSON_1] of [COMPANY_1] met [PERSON_2] of [COMPANY_2]. [COMPANY_1] pays [PERSON_1]; write to [EMAIL_1].',
    );
    act(() => hook.result.current.setEntitiesExcluded(companies, true));
    expect(hook.result.current.anonymizedText).toBe(
      '[PERSON_1] of Acme Ltd met [PERSON_2] of Borg GmbH. Acme Ltd pays [PERSON_1]; write to [EMAIL_1].',
    );
    expect([...hook.result.current.excludedIndices].sort()).toEqual(companies);
    expect(hook.result.current.entries.map((e) => e.original)).toEqual(['Jan Kowalski', 'Anna Nowak', 'jan@acme.example']);

    act(() => hook.result.current.setEntitiesExcluded(companies, false));
    expect(hook.result.current.excludedIndices.size).toBe(0);
    expect(hook.result.current.anonymizedText).toContain('[COMPANY_1] pays');
  });

  it('ignores indices outside the list', async () => {
    const hook = await redacted();
    act(() => hook.result.current.setEntitiesExcluded([-1, 99, 6], true));
    expect([...hook.result.current.excludedIndices]).toEqual([6]);
  });

  it('a renamed label survives a checkbox, a bulk change and coming back from kept visible', async () => {
    const hook = await redacted();
    act(() => hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'));
    expect(hook.result.current.anonymizedText).toContain('[CLIENT] of [COMPANY_1]');

    act(() => hook.result.current.toggleEntity(6));
    expect(hook.result.current.anonymizedText).toBe(
      '[CLIENT] of [COMPANY_1] met [PERSON_2] of [COMPANY_2]. [COMPANY_1] pays [CLIENT]; write to jan@acme.example.',
    );
    act(() => hook.result.current.setEntitiesExcluded(companies, true));
    expect(hook.result.current.anonymizedText).toContain('[CLIENT] of Acme Ltd');
    expect(hook.result.current.entries.find((e) => e.original === 'Jan Kowalski')?.replacement).toBe('[CLIENT]');
    expect(hook.result.current.deanonymize('[CLIENT] agreed')).toBe('Jan Kowalski agreed');

    // Kept visible and redacted again: the label the user chose is back.
    act(() => hook.result.current.setEntitiesExcluded([0, 5], true));
    expect(hook.result.current.anonymizedText).toContain('Jan Kowalski of Acme Ltd');
    act(() => hook.result.current.setEntitiesExcluded([0, 5], false));
    expect(hook.result.current.anonymizedText).toContain('[CLIENT] of Acme Ltd');
  });

  it('a re-run on the same text keeps what the user chose: what is not redacted and the renamed label (T261)', async () => {
    const hook = await redacted();
    act(() => hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'));
    act(() => hook.result.current.setEntitiesExcluded(companies, true));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(screen.getByText(en.entityTable.choicesKeptToast)).toBeInTheDocument());
    expect([...hook.result.current.excludedIndices].sort()).toEqual(companies);
    expect(hook.result.current.anonymizedText).toBe(
      '[CLIENT] of Acme Ltd met [PERSON_2] of Borg GmbH. Acme Ltd pays [CLIENT]; write to [EMAIL_1].',
    );
  });

  it('another text starts clean: nothing kept, numbered placeholders', async () => {
    const hook = await redacted();
    act(() => hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'));
    act(() => hook.result.current.setEntitiesExcluded(companies, true));
    // The fake detector answers with the same places; the text is another one.
    act(() => hook.result.current.handleInputChange(`${TEXT} `));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(ENTITIES.length));
    expect(hook.result.current.excludedIndices.size).toBe(0);
    expect(hook.result.current.anonymizedText).toContain('[PERSON_1] of [COMPANY_1]');
    expect(screen.queryByText(en.entityTable.choicesKeptToast)).toBeNull();
  });

  it('a value marked by hand survives a re-run on the same text', async () => {
    const hook = await redacted();
    const start = TEXT.indexOf('write to');
    act(() => hook.result.current.addManualEntity(start, start + 5, 'OTHER'));
    expect(hook.result.current.entities.some((e) => e.detector === 'manual' && e.value === 'write')).toBe(true);
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(hook.result.current.entities.some((e) => e.detector === 'manual' && e.value === 'write')).toBe(true);
    expect(hook.result.current.anonymizedText).not.toContain('; write to');
  });

  it('blanked mode never takes a renamed label', async () => {
    const hook = await redacted();
    act(() => hook.result.current.renameLabel('Jan Kowalski', '[CLIENT]'));
    act(() => hook.result.current.handleReplacementModeChange('blanked'));
    expect(hook.result.current.anonymizedText).not.toContain('[CLIENT]');
    expect(hook.result.current.anonymizedText).not.toContain('Jan Kowalski');
    act(() => hook.result.current.handleReplacementModeChange('labeled'));
    expect(hook.result.current.anonymizedText).toContain('[CLIENT] of [COMPANY_1]');
  });

  it('types set to never be anonymized stay readable after detection, are stored, and apply at once to the open document (T263)', async () => {
    const hook = await redacted();
    expect(hook.result.current.keepTypes).toEqual([]);
    act(() => hook.result.current.handleKeepTypesChange(['COMPANY']));
    // The open document follows at once.
    expect([...hook.result.current.excludedIndices].sort()).toEqual(companies);
    expect(hook.result.current.anonymizedText).toContain('[PERSON_1] of Acme Ltd');
    expect(JSON.parse(localStorage.getItem('doccloak-keep-types') ?? '[]')).toEqual(['COMPANY']);
    hook.unmount();

    // A later visit, another document: the choice is already in force and visible in the list.
    const next = await redacted();
    expect(next.result.current.keepTypes).toEqual(['COMPANY']);
    expect([...next.result.current.excludedIndices].sort()).toEqual(companies);
    expect(next.result.current.entities).toHaveLength(ENTITIES.length);
    expect(next.result.current.anonymizedText).toBe(
      '[PERSON_1] of Acme Ltd met [PERSON_2] of Borg GmbH. Acme Ltd pays [PERSON_1]; write to [EMAIL_1].',
    );
    // Taking the type off the list changes nothing in the open document; the next one is redacted in full.
    act(() => next.result.current.handleKeepTypesChange([]));
    expect([...next.result.current.excludedIndices].sort()).toEqual(companies);
    expect(localStorage.getItem('doccloak-keep-types')).toBeNull();
  });

  it('a re-run does not undo a choice the user made against the type setting', async () => {
    localStorage.setItem('doccloak-keep-types', JSON.stringify(['COMPANY']));
    const hook = await redacted();
    expect([...hook.result.current.excludedIndices].sort()).toEqual(companies);
    // The user redacts one company after all.
    act(() => hook.result.current.setEntitiesExcluded([3], false));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect([...hook.result.current.excludedIndices].sort()).toEqual([1, 4]);
  });

  it('an unreadable or unknown stored list of types is ignored', async () => {
    localStorage.setItem('doccloak-keep-types', '{"oops":true}');
    let hook = await redacted();
    expect(hook.result.current.keepTypes).toEqual([]);
    hook.unmount();
    localStorage.setItem('doccloak-keep-types', JSON.stringify(['NOT_A_TYPE', 'EMAIL']));
    hook = await redacted();
    expect(hook.result.current.keepTypes).toEqual(['EMAIL']);
    expect([...hook.result.current.excludedIndices]).toEqual([6]);
  });

  it('reminds to save the replacement table once the result left the page, until it is saved or declined (T261)', async () => {
    const hook = await redacted();
    expect(hook.result.current.tableReminder).toBe(false);
    act(() => hook.result.current.markResultTakenOut());
    expect(hook.result.current.tableReminder).toBe(true);
    // Leaving now asks first.
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    act(() => { hook.result.current.exportMapping(); });
    expect(hook.result.current.tableReminder).toBe(false);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);

    // The table changed: the saved file no longer holds it.
    act(() => hook.result.current.toggleEntity(6));
    expect(hook.result.current.tableReminder).toBe(true);
    act(() => hook.result.current.dismissTableReminder());
    expect(hook.result.current.tableReminder).toBe(false);
    expect(localStorage.getItem('doccloak-table-reminder')).toBeNull();
  });

  it('"do not remind me again" is kept on the device', async () => {
    const hook = await redacted();
    act(() => hook.result.current.markResultTakenOut());
    act(() => hook.result.current.dismissTableReminder(true));
    expect(hook.result.current.tableReminder).toBe(false);
    expect(localStorage.getItem('doccloak-table-reminder')).toBe('off');
    hook.unmount();
    const next = await redacted();
    act(() => next.result.current.markResultTakenOut());
    expect(next.result.current.tableReminder).toBe(false);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });

  it('no reminder in blanked mode: there is no table to save', async () => {
    const hook = await redacted();
    act(() => hook.result.current.handleReplacementModeChange('blanked'));
    act(() => hook.result.current.markResultTakenOut());
    expect(hook.result.current.tableReminder).toBe(false);
  });
});

// T274: a refused label used to be a passing message over a field that had already closed, with
// the typed text gone. The reason now stands at the field, which stays open.
describe('EntityTable: a refused label is said at the field', () => {
  function openField(value: string): HTMLInputElement {
    fireEvent.click(rowOf(value).querySelector<HTMLElement>('button[data-rename]')!);
    return rowOf(value).querySelector<HTMLInputElement>('input[aria-invalid]')!;
  }

  it('keeps the field open with what was typed, names the reason and ties it to the field', () => {
    const { onRenameLabel } = renderTable();
    onRenameLabel.mockReturnValue(en.entityTable.labelTaken('[PERSON_2]', 'Anna Nowak'));
    const field = openField('Jan Kowalski');
    expect(field).toHaveAttribute('aria-invalid', 'false');
    fireEvent.change(field, { target: { value: 'PERSON_2' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRenameLabel).toHaveBeenCalledWith('Jan Kowalski', '[PERSON_2]');
    const still = rowOf('Jan Kowalski').querySelector<HTMLInputElement>('input[aria-invalid]')!;
    expect(still).toHaveValue('PERSON_2');
    expect(still).toHaveAttribute('aria-invalid', 'true');
    const reason = within(rowOf('Jan Kowalski')).getByRole('alert');
    expect(reason).toHaveTextContent(en.entityTable.labelTaken('[PERSON_2]', 'Anna Nowak'));
    expect(still.getAttribute('aria-describedby')).toBe(reason.id);
    // Typing again takes the reason away; a label that is accepted closes the field.
    fireEvent.change(still, { target: { value: 'CLIENT' } });
    expect(within(rowOf('Jan Kowalski')).queryByRole('alert')).toBeNull();
    onRenameLabel.mockReturnValue(null);
    fireEvent.keyDown(still, { key: 'Enter' });
    expect(onRenameLabel).toHaveBeenLastCalledWith('Jan Kowalski', '[CLIENT]');
    expect(rowOf('Jan Kowalski').querySelector('input[aria-invalid]')).toBeNull();
  });

  it('a refusal on leaving the field keeps it too, and there is a way out without a keyboard', () => {
    const { onRenameLabel } = renderTable();
    onRenameLabel.mockReturnValue(en.entityTable.labelInvalid);
    const field = openField('Anna Nowak');
    fireEvent.change(field, { target: { value: '???' } });
    fireEvent.blur(field);
    expect(within(rowOf('Anna Nowak')).getByRole('alert')).toHaveTextContent(en.entityTable.labelInvalid);
    expect(rowOf('Anna Nowak').querySelector<HTMLInputElement>('input[aria-invalid]')).toHaveValue('???');
    // The cross closes the field and leaves the label as it was.
    fireEvent.click(within(rowOf('Anna Nowak')).getByTestId('entity-label-cancel'));
    expect(rowOf('Anna Nowak').querySelector('input[aria-invalid]')).toBeNull();
    expect(within(rowOf('Anna Nowak')).queryByRole('alert')).toBeNull();
    expect(rowOf('Anna Nowak')).toHaveTextContent('[PERSON_2]');
    // Escape does the same.
    const again = openField('Anna Nowak');
    fireEvent.change(again, { target: { value: '???' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    fireEvent.keyDown(rowOf('Anna Nowak').querySelector<HTMLInputElement>('input[aria-invalid]')!, { key: 'Escape' });
    expect(rowOf('Anna Nowak').querySelector('input[aria-invalid]')).toBeNull();
  });
});
