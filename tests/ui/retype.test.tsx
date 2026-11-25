// WLojek/DocCloak#5: change the type of a found value. A decision number found as a phone number
// went into the protected text as "[PHONE_1]"; the user could only un-redact it. The type can now
// be chosen from a menu (on the row of the list and on the marked place in the text), with "do not
// redact" as its last choice. The label follows the type, and the label the value had before is
// never given to another value: a reply that still holds it is reported, not restored.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, fireEvent, act, cleanup, waitFor, within } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, EngineClient, EntityType, ReplacementEntry } from '@doccloak/core';
import { EntityTable } from '../../src/ui/components/EntityTable.tsx';
import { TextInput } from '../../src/ui/components/TextInput.tsx';
import { useAnonymizer } from '../../src/ui/hooks/useAnonymizer.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { en } from '../../src/i18n/translations/en.ts';
import { retypeStrings } from '../../src/i18n/features/retype.ts';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const r = retypeStrings.en;

// The decision number is found as a phone number, twice, after a real one: its "[PHONE_2]" is the
// highest phone label, the one the next phone number would get if it were ever free again.
// "Lindqvist" alone is found as a company. "222 333 444" is not found at all: it is there to be
// marked by hand.
const NOTE = 'Maria Lindqvist of Nordbank called 555 123 456 about decision 600 700 800. '
  + 'Lindqvist sent decision 600 700 800 again. Fax 222 333 444. Erik Holm signed. Holm agreed.';
// A later text of the same tab: the decision number again, and a phone number not seen before.
const NEXT = 'Call 999 888 777 or 600 700 800 today.';
const DECISION = '600 700 800';

function found(text: string, type: EntityType, value: string, from = 0): DetectedEntity {
  const start = text.indexOf(value, from);
  if (start < 0) throw new Error(`"${value}" is not in the text`);
  return { type, value, start, end: start + value.length, confidence: 0.9, detector: 'test' };
}

/** The detector never learns: it reports the decision number as a phone number on every run. */
function detect(text: string): DetectedEntity[] {
  if (text === NEXT) return [found(text, 'PHONE', '999 888 777'), found(text, 'PHONE', DECISION)];
  const second = text.indexOf('Lindqvist sent');
  return [
    found(text, 'PERSON', 'Maria Lindqvist'),
    found(text, 'COMPANY', 'Nordbank'),
    found(text, 'PHONE', '555 123 456'),
    found(text, 'PHONE', DECISION),
    found(text, 'COMPANY', 'Lindqvist', second),
    found(text, 'PHONE', DECISION, second),
    found(text, 'PERSON', 'Erik Holm'),
    found(text, 'PERSON', 'Holm', text.indexOf('Holm agreed')),
  ].sort((a, b) => a.start - b.start);
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  _setClientFactoryForTests(() => ({
    client: {
      preload: () => Promise.resolve(),
      detect: (input: string) => Promise.resolve(detect(input)),
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
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // jsdom has no matchMedia; the text panel asks it whether the pointer is a finger.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  // jsdom ranges have no layout; the text panel anchors a menu to the selection.
  Range.prototype.getBoundingClientRect = () =>
    ({ left: 40, right: 120, top: 100, bottom: 120, width: 80, height: 20, x: 40, y: 100, toJSON: () => ({}) }) as DOMRect;
});

afterEach(() => {
  _setClientFactoryForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.getSelection()?.removeAllRanges();
});

async function redacted(text = NOTE) {
  const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
  act(() => hook.result.current.handleInputChange(text));
  act(() => hook.result.current.anonymize());
  await waitFor(() => expect(hook.result.current.entities).toHaveLength(detect(text).length));
  return hook;
}

type Hook = Awaited<ReturnType<typeof redacted>>;

/** value -> label, as the list shows it. */
function labels(hook: Hook): Record<string, string> {
  return Object.fromEntries(hook.result.current.entries.map((entry) => [entry.original, entry.replacement]));
}

function typesOf(hook: Hook, value: string): EntityType[] {
  return hook.result.current.entities.filter((entity) => entity.value === value).map((entity) => entity.type);
}

function indicesOf(hook: Hook, value: string): number[] {
  return hook.result.current.entities.flatMap((entity, index) => (entity.value === value ? [index] : []));
}

function markByHand(hook: Hook, value: string, type: EntityType) {
  const at = hook.result.current.inputText.indexOf(value);
  act(() => hook.result.current.addManualEntity(at, at + value.length, type));
}

describe('the type of a value can be changed (WLojek/DocCloak#5)', () => {
  it('starts from what the detector says', async () => {
    const hook = await redacted();
    expect(labels(hook)).toEqual({
      'Maria Lindqvist': '[PERSON_1]',
      'Erik Holm': '[PERSON_2]',
      Holm: '[PERSON_2_LAST]',
      [DECISION]: '[PHONE_2]',
      Nordbank: '[COMPANY_1]',
      Lindqvist: '[COMPANY_2]',
      '555 123 456': '[PHONE_1]',
    });
  });

  it('every place of the value takes the new type, and its label is the next free one of that type', async () => {
    const hook = await redacted();
    const before = labels(hook);
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));

    expect(typesOf(hook, DECISION)).toEqual(['OTHER', 'OTHER']);
    expect(labels(hook)[DECISION]).toBe('[OTHER_1]');
    expect(hook.result.current.entries.find((entry) => entry.original === DECISION)?.entityType).toBe('OTHER');
    const text = hook.result.current.anonymizedText;
    expect(text).toContain('about decision [OTHER_1].');
    expect(text).toContain('sent decision [OTHER_1] again');
    expect(text).not.toContain('[PHONE_2]');
    expect(text).not.toContain(DECISION);
    // No other value is touched: not its type, not its label, not whether it is redacted.
    for (const value of Object.keys(before)) {
      if (value !== DECISION) expect(labels(hook)[value], value).toBe(before[value]);
    }
    expect(typesOf(hook, '555 123 456')).toEqual(['PHONE']);
    expect(hook.result.current.excludedIndices.size).toBe(0);
    // The table that would be saved holds the new label only.
    expect(hook.result.current.deanonymize('[OTHER_1] and [PHONE_1]')).toBe(`${DECISION} and 555 123 456`);
  });

  it('the type it already has changes nothing, and a value that is not in the list is ignored', async () => {
    const hook = await redacted();
    const before = { list: hook.result.current.entities, text: hook.result.current.anonymizedText, table: hook.result.current.entries };
    act(() => hook.result.current.changeEntityType(DECISION, 'PHONE'));
    act(() => hook.result.current.changeEntityType('not in the text', 'OTHER'));
    expect(hook.result.current.entities).toBe(before.list);
    expect(hook.result.current.anonymizedText).toBe(before.text);
    expect(hook.result.current.entries).toBe(before.table);
  });

  it('the old label is never given to another value: not to one marked by hand, not to one found in the next text', async () => {
    const hook = await redacted();
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));

    // A real phone number, marked by hand in the same text: the freed "[PHONE_2]" is not for it.
    markByHand(hook, '222 333 444', 'PHONE');
    expect(labels(hook)['222 333 444']).toBe('[PHONE_3]');
    expect(Object.values(labels(hook))).not.toContain('[PHONE_2]');
    // Every later change of the list issues the numbers again: still not.
    act(() => hook.result.current.toggleEntity(indicesOf(hook, 'Nordbank')[0]));
    act(() => hook.result.current.toggleEntity(indicesOf(hook, 'Nordbank')[0]));
    expect(Object.values(labels(hook))).not.toContain('[PHONE_2]');

    // The next text of the tab holds a phone number never seen before.
    const taken = new Set(Object.values(labels(hook)));
    act(() => hook.result.current.handleInputChange(NEXT));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('today'));
    const next = labels(hook);
    expect(next['999 888 777']).toMatch(/^\[PHONE_\d+\]$/);
    expect(next['999 888 777']).not.toBe('[PHONE_2]');
    expect(taken.has(next['999 888 777'])).toBe(false);
    // The decision number keeps the label it has in this tab, whatever the detector calls it now.
    expect(next[DECISION]).toBe('[OTHER_1]');
    // A reply to the first text, with the label from before the change, is still not misread.
    const restored = hook.result.current.restoreText('Ring [PHONE_2].');
    expect(restored.text).toBe('Ring [PHONE_2].');
    expect(restored.restored).toBe(0);
  });

  it('a reply that still holds the old label is reported with what it stood for, and nothing wrong is restored', async () => {
    const hook = await redacted();
    const copied = hook.result.current.anonymizedText;
    expect(copied).toContain('about decision [PHONE_2].');
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    markByHand(hook, '222 333 444', 'PHONE');

    const restored = hook.result.current.restoreText('Ref [PHONE_2]: call [PHONE_1] or fax [PHONE_3], see [OTHER_1].');
    expect(restored.text).toBe(`Ref [PHONE_2]: call 555 123 456 or fax 222 333 444, see ${DECISION}.`);
    expect(restored.restored).toBe(3);
    expect(restored.unresolved).toEqual(['[PHONE_2]']);
    expect(restored.stale).toEqual([{ label: '[PHONE_2]', original: DECISION, reason: 'gone' }]);
    expect(restored.segments.filter((segment) => segment.kind === 'leftover').map((segment) => segment.text)).toEqual(['[PHONE_2]']);
    // The spellings restore reads as the same label are no way around it.
    expect(hook.result.current.restoreText('[phone 2] and PHONE_2').text).toBe('[phone 2] and PHONE_2');
    expect(hook.result.current.deanonymize('[PHONE_2]')).toBe('[PHONE_2]');
  });

  it('a label typed by hand stays; only the type changes', async () => {
    const hook = await redacted();
    act(() => { hook.result.current.renameLabel(DECISION, '[CASE]'); });
    expect(labels(hook)[DECISION]).toBe('[CASE]');
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));

    expect(typesOf(hook, DECISION)).toEqual(['OTHER', 'OTHER']);
    expect(labels(hook)[DECISION]).toBe('[CASE]');
    expect(hook.result.current.entries.find((entry) => entry.original === DECISION)?.entityType).toBe('OTHER');
    expect(hook.result.current.renamedOriginals.has(DECISION)).toBe(true);
    expect(hook.result.current.anonymizedText).toContain('about decision [CASE].');
    expect(hook.result.current.restoreText('[CASE]').text).toBe(DECISION);
    // The way back from the rename leads to the numbered label of the new type, not of the old one.
    act(() => hook.result.current.resetLabel(DECISION));
    expect(labels(hook)[DECISION]).toBe('[OTHER_1]');
    markByHand(hook, '222 333 444', 'PHONE');
    expect(labels(hook)['222 333 444']).toBe('[PHONE_3]');
  });

  it('says that the result changed when a copy of it already left the page', async () => {
    const hook = await redacted();
    act(() => hook.result.current.markResultTakenOut());
    expect(screen.queryByText(en.textOutput.changedAfterTaken)).toBeNull();
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    expect(screen.getByText(en.textOutput.changedAfterTaken)).toBeInTheDocument();
  });

  it('a re-run on the same text keeps the choice, though the detector reports the old type again', async () => {
    const hook = await redacted();
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    const before = { labels: labels(hook), text: hook.result.current.anonymizedText };

    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(screen.getByText(en.entityTable.choicesKeptToast)).toBeInTheDocument());
    expect(typesOf(hook, DECISION)).toEqual(['OTHER', 'OTHER']);
    expect(typesOf(hook, '555 123 456')).toEqual(['PHONE']);
    expect(labels(hook)).toEqual(before.labels);
    expect(hook.result.current.anonymizedText).toBe(before.text);
  });

  it('another text starts from the detector again; the label of the value stays the one it has in this tab', async () => {
    const hook = await redacted();
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    act(() => hook.result.current.handleInputChange(NEXT));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('today'));
    expect(typesOf(hook, DECISION)).toEqual(['PHONE']);
    expect(labels(hook)[DECISION]).toBe('[OTHER_1]');
    expect(screen.queryByText(en.entityTable.choicesKeptToast)).toBeNull();
  });

  it('Undo after Clear brings the choice back; a text that is cleared for good forgets it', async () => {
    const hook = await redacted();
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    const before = { labels: labels(hook), text: hook.result.current.anonymizedText };
    let snapshot: ReturnType<typeof hook.result.current.snapshotText> | undefined;
    act(() => { snapshot = hook.result.current.snapshotText(); hook.result.current.clear(); });
    expect(hook.result.current.entities).toHaveLength(0);

    act(() => hook.result.current.restoreSnapshot(snapshot!));
    expect(typesOf(hook, DECISION)).toEqual(['OTHER', 'OTHER']);
    expect(labels(hook)).toEqual(before.labels);
    expect(hook.result.current.anonymizedText).toBe(before.text);
    // The choice itself is back, not only the list: the next run of the text still applies it.
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(typesOf(hook, DECISION)).toEqual(['OTHER', 'OTHER']);
    expect(labels(hook)).toEqual(before.labels);

    // Cleared and typed in again without Undo: a new text, the detector's type.
    act(() => hook.result.current.clear());
    act(() => hook.result.current.handleInputChange(NOTE));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(8));
    expect(typesOf(hook, DECISION)).toEqual(['PHONE', 'PHONE']);
  });

  it('going back to a type the value had gives it its own label of that time back', async () => {
    const hook = await redacted();
    const before = { labels: labels(hook), text: hook.result.current.anonymizedText };
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    markByHand(hook, '222 333 444', 'PHONE');
    act(() => hook.result.current.changeEntityType(DECISION, 'PHONE'));
    // Its own "[PHONE_2]": that label never stood for anything else, so a copy made before the
    // first change restores again.
    expect(labels(hook)).toEqual({ ...before.labels, '222 333 444': '[PHONE_3]' });
    expect(hook.result.current.restoreText('[PHONE_2]').text).toBe(DECISION);
    // And "[OTHER_1]" is now the retired one: reported, and not given to the next "other" value.
    expect(hook.result.current.restoreText('[OTHER_1]').stale).toEqual([{ label: '[OTHER_1]', original: DECISION, reason: 'gone' }]);
    markByHand(hook, 'Fax', 'OTHER');
    expect(labels(hook).Fax).toBe('[OTHER_2]');
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    expect(labels(hook)[DECISION]).toBe('[OTHER_1]');
  });

  it('a value that is not redacted takes the type too, and gets the label of that type when it is redacted again', async () => {
    const hook = await redacted();
    const places = indicesOf(hook, DECISION);
    act(() => hook.result.current.setEntitiesExcluded(places, true));
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    expect(typesOf(hook, DECISION)).toEqual(['OTHER', 'OTHER']);
    expect([...hook.result.current.excludedIndices].sort()).toEqual(places);
    expect(hook.result.current.anonymizedText).toContain(`about decision ${DECISION}.`);
    act(() => hook.result.current.setEntitiesExcluded(places, false));
    expect(labels(hook)[DECISION]).toBe('[OTHER_1]');
  });

  it('the type and what is redacted, changed in one turn in either order, both hold', async () => {
    const hook = await redacted();
    const places = indicesOf(hook, DECISION);
    act(() => {
      hook.result.current.setEntitiesExcluded(places, true);
      hook.result.current.changeEntityType(DECISION, 'OTHER');
    });
    expect(typesOf(hook, DECISION)).toEqual(['OTHER', 'OTHER']);
    expect(hook.result.current.anonymizedText).toContain(`about decision ${DECISION}.`);
    expect(labels(hook)[DECISION]).toBeUndefined();
    act(() => {
      hook.result.current.changeEntityType(DECISION, 'ADDRESS');
      hook.result.current.setEntitiesExcluded(places, false);
    });
    expect(hook.result.current.anonymizedText).toContain('about decision [ADDRESS_1].');
    expect(hook.result.current.anonymizedText).toContain('sent decision [ADDRESS_1] again');
    expect(labels(hook)[DECISION]).toBe('[ADDRESS_1]');
  });

  it('in the other replacement modes the type changes as well, and the labels follow once they are back', async () => {
    const hook = await redacted();
    act(() => hook.result.current.handleReplacementModeChange('blanked'));
    act(() => hook.result.current.changeEntityType(DECISION, 'OTHER'));
    expect(typesOf(hook, DECISION)).toEqual(['OTHER', 'OTHER']);
    expect(hook.result.current.anonymizedText).not.toContain(DECISION);
    act(() => hook.result.current.handleReplacementModeChange('labeled'));
    expect(labels(hook)[DECISION]).toBe('[OTHER_1]');
    markByHand(hook, '222 333 444', 'PHONE');
    expect(labels(hook)['222 333 444']).toBe('[PHONE_3]');
  });
});

describe('names and their parts (PERSON)', () => {
  it('to PERSON: a value that is part of a name joins that person; one that is not gets the next number', async () => {
    const hook = await redacted();
    const before = labels(hook);
    // "Lindqvist" was found as a company; it is the surname of Maria Lindqvist.
    act(() => hook.result.current.changeEntityType('Lindqvist', 'PERSON'));
    expect(labels(hook).Lindqvist).toBe('[PERSON_1_LAST]');
    // "Nordbank" is nobody's name part.
    act(() => hook.result.current.changeEntityType('Nordbank', 'PERSON'));
    expect(labels(hook).Nordbank).toBe('[PERSON_3]');
    // The people who were there keep their labels, and so do the parts of their names.
    for (const value of ['Maria Lindqvist', 'Erik Holm', 'Holm']) expect(labels(hook)[value], value).toBe(before[value]);
    // The company labels they had are retired: reported in a reply, never issued again.
    const restored = hook.result.current.restoreText('[PERSON_1_LAST] of [COMPANY_2] at [COMPANY_1]');
    expect(restored.text).toBe('Lindqvist of [COMPANY_2] at [COMPANY_1]');
    expect(restored.stale).toEqual([
      { label: '[COMPANY_2]', original: 'Lindqvist', reason: 'gone' },
      { label: '[COMPANY_1]', original: 'Nordbank', reason: 'gone' },
    ]);
    markByHand(hook, 'Fax', 'COMPANY');
    expect(labels(hook).Fax).toBe('[COMPANY_3]');
  });

  it('away from PERSON, a part of a name: it leaves the group, the full name and the label of the part stay as they were', async () => {
    const hook = await redacted();
    const before = labels(hook);
    act(() => hook.result.current.changeEntityType('Holm', 'COMPANY'));
    expect(labels(hook).Holm).toBe('[COMPANY_3]');
    for (const value of Object.keys(before)) {
      if (value !== 'Holm') expect(labels(hook)[value], value).toBe(before[value]);
    }
    // "[PERSON_2_LAST]" from a copy made before: reported with its value, and "[PERSON_2]" still restores.
    const restored = hook.result.current.restoreText('[PERSON_2] and [PERSON_2_LAST]');
    expect(restored.text).toBe('Erik Holm and [PERSON_2_LAST]');
    expect(restored.stale).toEqual([{ label: '[PERSON_2_LAST]', original: 'Holm', reason: 'gone' }]);
    // Back to PERSON: its own label of the group again.
    act(() => hook.result.current.changeEntityType('Holm', 'PERSON'));
    expect(labels(hook)).toEqual(before);
    expect(hook.result.current.restoreText('[PERSON_2] and [PERSON_2_LAST]').text).toBe('Erik Holm and Holm');
  });

  it('away from PERSON, the full name: the part of the name keeps its label, and the number of the person is never issued again', async () => {
    const hook = await redacted();
    const before = labels(hook);
    act(() => hook.result.current.changeEntityType('Erik Holm', 'COMPANY'));
    expect(labels(hook)['Erik Holm']).toBe('[COMPANY_3]');
    // "Holm" was copied out as "[PERSON_2_LAST]": it still is that, and still restores.
    expect(labels(hook).Holm).toBe('[PERSON_2_LAST]');
    for (const value of Object.keys(before)) {
      if (value !== 'Erik Holm') expect(labels(hook)[value], value).toBe(before[value]);
    }
    const restored = hook.result.current.restoreText('[PERSON_2] met [PERSON_2_LAST] and [PERSON_1]');
    expect(restored.text).toBe('[PERSON_2] met Holm and Maria Lindqvist');
    expect(restored.stale).toEqual([{ label: '[PERSON_2]', original: 'Erik Holm', reason: 'gone' }]);
    // A person marked by hand now is a new person: not "[PERSON_2]", and not a part of anyone.
    markByHand(hook, 'Fax', 'PERSON');
    expect(labels(hook).Fax).toBe('[PERSON_3]');
    // Back to PERSON: the group is whole again, with the labels it had.
    act(() => hook.result.current.changeEntityType('Erik Holm', 'PERSON'));
    expect(labels(hook)).toEqual({ ...before, Fax: '[PERSON_3]' });
    expect(hook.result.current.restoreText('[PERSON_2] met [PERSON_2_LAST]').text).toBe('Erik Holm met Holm');
  });

  it('a renamed person who changes type keeps the typed label; the part of the name goes back to its numbered label', async () => {
    const hook = await redacted();
    act(() => { hook.result.current.renameLabel('Erik Holm', '[SIGNER]'); });
    expect(labels(hook).Holm).toBe('[SIGNER_LAST]');
    act(() => hook.result.current.changeEntityType('Erik Holm', 'COMPANY'));
    expect(labels(hook)['Erik Holm']).toBe('[SIGNER]');
    // The surname no longer follows a person: it has the label it had before the rename.
    expect(labels(hook).Holm).toBe('[PERSON_2_LAST]');
    // A copy made in between holds "[SIGNER_LAST]": reported with its value, not restored as another.
    const restored = hook.result.current.restoreText('[SIGNER] and [SIGNER_LAST]');
    expect(restored.text).toBe('Erik Holm and [SIGNER_LAST]');
    expect(restored.stale).toEqual([{ label: '[SIGNER_LAST]', original: 'Holm', reason: 'gone' }]);
  });
});

// ---- The menu -------------------------------------------------------------------------------

const ENTITIES = detect(NOTE);
const ENTRIES: ReplacementEntry[] = [
  { original: 'Maria Lindqvist', replacement: '[PERSON_1]', entityType: 'PERSON' },
  { original: 'Erik Holm', replacement: '[PERSON_2]', entityType: 'PERSON' },
  { original: 'Holm', replacement: '[PERSON_2_LAST]', entityType: 'PERSON' },
  { original: DECISION, replacement: '[PHONE_2]', entityType: 'PHONE' },
  { original: 'Nordbank', replacement: '[COMPANY_1]', entityType: 'COMPANY' },
  { original: 'Lindqvist', replacement: '[COMPANY_2]', entityType: 'COMPANY' },
  { original: '555 123 456', replacement: '[PHONE_1]', entityType: 'PHONE' },
];
const DECISION_PLACES = ENTITIES.flatMap((entity, index) => (entity.value === DECISION ? [index] : []));

function rowOf(value: string): HTMLElement {
  const rows = Array.from(document.querySelectorAll<HTMLElement>('table tbody tr[data-count]'));
  const row = rows.find((candidate) => candidate.querySelectorAll('td')[2].querySelector('span')?.textContent === value);
  if (!row) throw new Error(`no row for ${value}`);
  return row;
}

function chipOf(value: string, type: EntityType): HTMLElement {
  return within(rowOf(value)).getByRole('button', { name: r.change(en.entityLabels[type], value) });
}

function markOf(value: string, nth = 0): HTMLElement {
  return Array.from(document.querySelectorAll<HTMLElement>('mark[data-start]')).filter((mark) => mark.textContent === value)[nth];
}

function menuOf(value: string): HTMLElement {
  return screen.getByRole('dialog', { name: `${r.heading}: ${value}` });
}

function renderTable(excluded: number[] = []) {
  const onSetExcluded = vi.fn();
  const onChangeType = vi.fn();
  render(
    <Providers>
      <EntityTable
        entities={ENTITIES}
        entries={ENTRIES.filter((entry) => ENTITIES.some((entity, index) => entity.value === entry.original && !excluded.includes(index)))}
        excludedIndices={new Set(excluded)}
        text={NOTE}
        onToggle={vi.fn()}
        onSetExcluded={onSetExcluded}
        onRenameLabel={vi.fn()}
        onChangeType={onChangeType}
        keepTypes={[]}
        onKeepTypesChange={vi.fn()}
      />
    </Providers>,
  );
  return { onSetExcluded, onChangeType };
}

function renderText(excluded: number[] = []) {
  const onToggleEntity = vi.fn();
  const onAddEntity = vi.fn();
  const onSetExcluded = vi.fn();
  const onChangeType = vi.fn();
  render(
    <Providers>
      <TextInput value={NOTE} onChange={() => {}} onClear={() => {}} entities={ENTITIES} onAddEntity={onAddEntity}
        onToggleEntity={onToggleEntity} onChangeType={onChangeType} onSetExcluded={onSetExcluded} keptIndices={new Set(excluded)} hasResult />
    </Providers>,
  );
  return { onToggleEntity, onAddEntity, onSetExcluded, onChangeType };
}

describe('the menu on a row of the list', () => {
  it('without a way to change the type the list is as it was: a plain badge', () => {
    render(
      <Providers>
        <EntityTable entities={ENTITIES} entries={ENTRIES} excludedIndices={new Set()} text={NOTE} onToggle={vi.fn()} onSetExcluded={vi.fn()}
          onRenameLabel={vi.fn()} keepTypes={[]} onKeepTypesChange={vi.fn()} />
      </Providers>,
    );
    expect(screen.queryByTestId('entity-type-change')).toBeNull();
    expect(rowOf(DECISION).querySelectorAll('td')[0]).toHaveTextContent(en.entityLabels.PHONE);
  });

  it('the type of a row is a button that says what it does, in both layouts', () => {
    renderTable();
    const chip = chipOf(DECISION, 'PHONE');
    expect(chip).toHaveTextContent(en.entityLabels.PHONE);
    expect(chip).toHaveAttribute('title', r.heading);
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    // 44 px tall under a finger without making the row taller: the press area reaches past the badge.
    expect(chip.className).toMatch(/after:-inset-y-3/);
    expect(chip.className).toMatch(/md:after:-inset-y-0\.5/);
    // One per value in the table and one in the cards of the phone layout.
    expect(screen.getAllByTestId('entity-type-change')).toHaveLength(2 * ENTRIES.length);
  });

  it('by keyboard: opens on the type it has, arrows and Tab stay in it, Escape closes it and the focus is back on the row', () => {
    const { onChangeType, onSetExcluded } = renderTable();
    const chip = chipOf(DECISION, 'PHONE');
    // A real button: Tab reaches it, Enter and Space press it (a press by key is a click).
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.tabIndex).toBe(0);
    chip.focus();
    fireEvent.click(chip, { detail: 0 });

    const menu = menuOf(DECISION);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    // It says how far the choice reaches.
    expect(menu).toHaveTextContent(r.scope(2));
    const phone = within(menu).getByRole('button', { name: en.entityLabels.PHONE });
    expect(phone).toHaveAttribute('aria-pressed', 'true');
    expect(phone).toHaveFocus();
    expect(within(menu).getAllByRole('button', { pressed: true })).toHaveLength(1);
    // The last choice, apart from the types.
    const keep = within(menu).getByRole('button', { name: r.keep });
    expect(keep).toHaveAttribute('aria-pressed', 'false');
    const all = within(menu).getAllByRole('button');
    expect(all[all.length - 1]).toBe(keep);
    expect(all).toHaveLength(13);
    for (const choice of all) expect(choice.className, choice.textContent ?? '').toMatch(/min-h-11/);

    fireEvent.keyDown(phone, { key: 'ArrowDown' });
    expect(within(menu).getByRole('button', { name: en.entityLabels.ADDRESS })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(phone).toHaveFocus();
    keep.focus();
    fireEvent.keyDown(keep, { key: 'Tab' });
    expect(all[0]).toHaveFocus();
    fireEvent.keyDown(all[0], { key: 'Tab', shiftKey: true });
    expect(keep).toHaveFocus();

    fireEvent.keyDown(keep, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip).toHaveFocus();
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(onChangeType).not.toHaveBeenCalled();
    expect(onSetExcluded).not.toHaveBeenCalled();
  });

  it('a type changes every place of the value, says so, and Undo puts the type back', () => {
    const { onChangeType, onSetExcluded } = renderTable();
    fireEvent.click(chipOf(DECISION, 'PHONE'));
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: en.entityLabels.OTHER }));
    expect(onChangeType).toHaveBeenCalledWith(DECISION, 'OTHER');
    expect(onSetExcluded).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(r.changedToast(en.entityLabels.OTHER, 2))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(onChangeType).toHaveBeenLastCalledWith(DECISION, 'PHONE');
    expect(onChangeType).toHaveBeenCalledTimes(2);
  });

  it('the type it already has closes the menu and changes nothing', () => {
    const { onChangeType } = renderTable();
    fireEvent.click(chipOf(DECISION, 'PHONE'));
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: en.entityLabels.PHONE }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChangeType).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: en.toast.undo })).toBeNull();
  });

  it('"Don\'t redact" leaves every place of the value readable, in one step, with an Undo', () => {
    // One of its two places is readable already: the choice takes the other one.
    const { onChangeType, onSetExcluded } = renderTable([DECISION_PLACES[0]]);
    fireEvent.click(chipOf(DECISION, 'PHONE'));
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: r.keep }));
    expect(onSetExcluded).toHaveBeenCalledWith([DECISION_PLACES[1]], true);
    expect(onChangeType).not.toHaveBeenCalled();
    expect(screen.getByText(en.entityTable.keptToast(1))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(onSetExcluded).toHaveBeenLastCalledWith([DECISION_PLACES[1]], false);
  });

  it('a value that is not redacted shows "Don\'t redact" as its state; a type then redacts it as that type', () => {
    const { onChangeType, onSetExcluded } = renderTable(DECISION_PLACES);
    fireEvent.click(chipOf(DECISION, 'PHONE'));
    const menu = menuOf(DECISION);
    const keep = within(menu).getByRole('button', { name: r.keep });
    expect(keep).toHaveAttribute('aria-pressed', 'true');
    expect(keep).toHaveFocus();
    expect(within(menu).getAllByRole('button', { pressed: true })).toEqual([keep]);
    fireEvent.click(within(menu).getByRole('button', { name: en.entityLabels.OTHER }));
    expect(onChangeType).toHaveBeenCalledWith(DECISION, 'OTHER');
    expect(onSetExcluded).toHaveBeenCalledWith(DECISION_PLACES, false);
    expect(screen.getByText(en.entityTable.redactedToast(2))).toBeInTheDocument();
    // Undo: readable again, under the type it had.
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(onSetExcluded).toHaveBeenLastCalledWith(DECISION_PLACES, true);
    expect(onChangeType).toHaveBeenLastCalledWith(DECISION, 'PHONE');
  });

  it('a click beside the menu closes it', () => {
    const { onChangeType } = renderTable();
    fireEvent.click(chipOf('Nordbank', 'COMPANY'));
    expect(menuOf('Nordbank')).not.toHaveTextContent(r.scope(1));
    fireEvent.click(document.querySelector('.fixed.inset-0') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChangeType).not.toHaveBeenCalled();
  });
});

describe('the menu on a marked place of the source text', () => {
  it('a click is what it was (redact or not this one place); the context menu opens the types', () => {
    const { onToggleEntity, onChangeType } = renderText();
    const mark = markOf(DECISION, 1);
    expect(mark.getAttribute('title')).toBe(`${en.entityTable.dontRedactThese(1)}. ${r.markHint}`);
    fireEvent.click(mark);
    expect(onToggleEntity).toHaveBeenCalledWith(DECISION_PLACES[1]);
    expect(screen.queryByRole('dialog')).toBeNull();

    mark.focus();
    const event = fireEvent.contextMenu(mark);
    // The browser's own menu is replaced.
    expect(event).toBe(false);
    const menu = menuOf(DECISION);
    expect(within(menu).getByRole('button', { name: en.entityLabels.PHONE })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(menu).getByRole('button', { name: en.entityLabels.OTHER }));
    expect(onChangeType).toHaveBeenCalledWith(DECISION, 'OTHER');
    expect(onToggleEntity).toHaveBeenCalledTimes(1);
    // The focus is back on the place the menu was opened from.
    expect(mark).toHaveFocus();
  });

  it('by keyboard: Shift+F10 or the menu key on a marked place; Enter still redacts or not; Escape gives the focus back', () => {
    const { onToggleEntity, onSetExcluded } = renderText();
    const mark = markOf('555 123 456');
    expect(mark.tabIndex).toBe(0);
    expect(mark).toHaveAttribute('aria-keyshortcuts', 'Shift+F10');
    mark.focus();
    fireEvent.keyDown(mark, { key: 'F10', shiftKey: true });
    expect(within(menuOf('555 123 456')).getByRole('button', { name: en.entityLabels.PHONE })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mark).toHaveFocus();

    fireEvent.keyDown(mark, { key: 'ContextMenu' });
    fireEvent.click(within(menuOf('555 123 456')).getByRole('button', { name: r.keep }));
    expect(onSetExcluded).toHaveBeenCalledWith([ENTITIES.findIndex((entity) => entity.value === '555 123 456')], true);
    expect(mark).toHaveFocus();

    expect(onToggleEntity).not.toHaveBeenCalled();
    fireEvent.keyDown(mark, { key: 'Enter' });
    expect(onToggleEntity).toHaveBeenCalledTimes(1);
  });

  it('with text selected the context menu is the browser\'s own, so the selection can be copied', () => {
    renderText();
    const mark = markOf('Nordbank');
    const range = document.createRange();
    range.selectNodeContents(mark);
    window.getSelection()?.addRange(range);
    expect(fireEvent.contextMenu(mark)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a selection inside a redacted value opens the types for that value, not "Mark as"', () => {
    const { onAddEntity, onChangeType } = renderText();
    const mark = markOf('Maria Lindqvist');
    const range = document.createRange();
    range.setStart(mark.firstChild as Node, 0);
    range.setEnd(mark.firstChild as Node, 5);
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(mark, { clientX: 30, clientY: 60 });
    const menu = menuOf('Maria Lindqvist');
    expect(screen.queryByRole('dialog', { name: new RegExp(`^${en.entityTable.markAs}`) })).toBeNull();
    expect(window.getSelection()?.isCollapsed ?? true).toBe(true);
    fireEvent.click(within(menu).getByRole('button', { name: en.entityLabels.COMPANY }));
    expect(onChangeType).toHaveBeenCalledWith('Maria Lindqvist', 'COMPANY');
    expect(onAddEntity).not.toHaveBeenCalled();
  });

  it('a selection on a place that is not redacted opens the types too: a type redacts that place, as that type', () => {
    // "Nordbank" stands once and is readable; the decision number is readable in its first place only.
    const nordbank = ENTITIES.findIndex((entity) => entity.value === 'Nordbank');
    const { onAddEntity, onChangeType, onSetExcluded } = renderText([nordbank, DECISION_PLACES[0]]);
    const select = (mark: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(mark);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      fireEvent.mouseUp(mark, { clientX: 30, clientY: 60 });
    };
    select(markOf('Nordbank'));
    // Not redacted anywhere: that is its state in the menu.
    expect(within(menuOf('Nordbank')).getByRole('button', { name: r.keep })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(menuOf('Nordbank')).getByRole('button', { name: en.entityLabels.OTHER }));
    expect(onChangeType).toHaveBeenLastCalledWith('Nordbank', 'OTHER');
    expect(onSetExcluded).toHaveBeenLastCalledWith([nordbank], false);

    // Redacted in its other place: the type is the state, and choosing one redacts the place the
    // menu was opened on. The other place is left as the user had it.
    select(markOf(DECISION, 0));
    expect(within(menuOf(DECISION)).getByRole('button', { name: en.entityLabels.PHONE })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: en.entityLabels.OTHER }));
    expect(onChangeType).toHaveBeenLastCalledWith(DECISION, 'OTHER');
    expect(onSetExcluded).toHaveBeenLastCalledWith([DECISION_PLACES[0]], false);
    expect(screen.getByText(en.entityTable.redactedToast(1))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(onSetExcluded).toHaveBeenLastCalledWith([DECISION_PLACES[0]], true);
    expect(onChangeType).toHaveBeenLastCalledWith(DECISION, 'PHONE');
    expect(onAddEntity).not.toHaveBeenCalled();
  });

  it('a selection of text that is not found yet still offers "Mark as", and that list is as it was', () => {
    const { onAddEntity, onChangeType } = renderText();
    const word = Array.from(document.querySelectorAll<HTMLElement>('span[data-start]')).find((span) => span.textContent === 'Fax') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(word);
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(word, { clientX: 30, clientY: 60 });
    const picker = screen.getByRole('dialog', { name: `${en.entityTable.markAs}: Fax` });
    // No chosen type, no "Don't redact".
    expect(within(picker).queryByRole('button', { name: r.keep })).toBeNull();
    for (const choice of within(picker).getAllByRole('button')) expect(choice).not.toHaveAttribute('aria-pressed');
    fireEvent.click(within(picker).getByRole('button', { name: en.entityLabels.COMPANY }));
    expect(onAddEntity).toHaveBeenCalledWith(NOTE.indexOf('Fax'), NOTE.indexOf('Fax') + 3, 'COMPANY');
    expect(onChangeType).not.toHaveBeenCalled();
  });

  it('without a way to change the type a marked place is as it was', () => {
    render(
      <Providers>
        <TextInput value={NOTE} onChange={() => {}} onClear={() => {}} entities={ENTITIES} onToggleEntity={vi.fn()} keptIndices={new Set()} hasResult />
      </Providers>,
    );
    const mark = markOf(DECISION);
    expect(mark.getAttribute('title')).toBe(en.entityTable.dontRedactThese(1));
    expect(mark).not.toHaveAttribute('aria-keyshortcuts');
    expect(fireEvent.contextMenu(mark)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// The list, the text and the hook together, as the page wires them.
function Page({ onReady }: { onReady: (api: ReturnType<typeof useAnonymizer>) => void }) {
  const api = useAnonymizer();
  onReady(api);
  return (
    <>
      <TextInput value={api.inputText} onChange={api.handleInputChange} onClear={api.clear} entities={api.entities} onAddEntity={api.addManualEntity}
        onToggleEntity={api.toggleEntity} onChangeType={api.changeEntityType} onSetExcluded={api.setEntitiesExcluded} keptIndices={api.excludedIndices}
        hasResult={api.anonymizedText !== ''} />
      <EntityTable entities={api.entities} entries={api.entries} excludedIndices={api.excludedIndices} text={api.inputText} onToggle={api.toggleEntity}
        onSetExcluded={api.setEntitiesExcluded} onRenameLabel={api.renameLabel} onChangeType={api.changeEntityType} keepTypes={api.keepTypes}
        onKeepTypesChange={api.handleKeepTypesChange} />
      <output data-testid="result">{api.anonymizedText}</output>
    </>
  );
}

describe('the menu, the list and the labels together', () => {
  async function page() {
    let api!: ReturnType<typeof useAnonymizer>;
    render(<Providers><Page onReady={(next) => { api = next; }} /></Providers>);
    act(() => api.handleInputChange(NOTE));
    act(() => api.anonymize());
    await waitFor(() => expect(api.entities).toHaveLength(8));
    const result = () => screen.getByTestId('result').textContent ?? '';
    return { api: () => api, result };
  }

  it('from the row: the type, the label and the text change, the focus stays on the row; Undo is exact', async () => {
    const { result } = await page();
    expect(result()).toContain('about decision [PHONE_2].');
    fireEvent.click(chipOf(DECISION, 'PHONE'));
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: en.entityLabels.OTHER }));

    // The row is made anew under its type: its button has the focus, and its label is the new one.
    expect(chipOf(DECISION, 'OTHER')).toHaveFocus();
    expect(within(rowOf(DECISION)).getByRole('button', { name: `${en.entityTable.clickToRename}: [OTHER_1]` })).toBeInTheDocument();
    expect(result()).toContain('about decision [OTHER_1].');
    expect(result()).toContain('sent decision [OTHER_1] again');
    expect(result()).not.toContain('[PHONE_2]');

    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(chipOf(DECISION, 'PHONE')).toBeInTheDocument();
    expect(result()).toContain('about decision [PHONE_2].');
  });

  it('"Don\'t redact" keeps every place of the value visible; Undo redacts them again under the same label', async () => {
    const { api, result } = await page();
    fireEvent.click(chipOf(DECISION, 'PHONE'));
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: r.keep }));

    expect(result()).toContain(`about decision ${DECISION}.`);
    expect(result()).toContain(`sent decision ${DECISION} again`);
    expect([...api().excludedIndices].sort()).toEqual(DECISION_PLACES);
    expect(within(rowOf(DECISION)).getByTestId('entity-kept-tag')).toBeInTheDocument();
    expect(document.querySelectorAll('mark[data-kept="true"]')).toHaveLength(2);
    // Nothing else became readable.
    expect(result()).not.toContain('555 123 456');
    expect(chipOf(DECISION, 'PHONE')).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(api().excludedIndices.size).toBe(0);
    expect(result()).toContain('about decision [PHONE_2].');
  });

  it('from the text: the context menu of one place changes every place of the value', async () => {
    const { api, result } = await page();
    fireEvent.contextMenu(markOf(DECISION, 1));
    expect(menuOf(DECISION)).toHaveTextContent(r.scope(2));
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: en.entityLabels.OTHER }));
    expect(api().entities.filter((entity) => entity.value === DECISION).map((entity) => entity.type)).toEqual(['OTHER', 'OTHER']);
    expect(result()).toContain('about decision [OTHER_1].');
    expect(chipOf(DECISION, 'OTHER')).toBeInTheDocument();
  });

  it('a value that is not redacted, given a type from the menu, is redacted as that type', async () => {
    const { api, result } = await page();
    act(() => api().setEntitiesExcluded(DECISION_PLACES, true));
    expect(result()).toContain(`about decision ${DECISION}.`);
    fireEvent.contextMenu(markOf(DECISION));
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: en.entityLabels.OTHER }));
    expect(api().excludedIndices.size).toBe(0);
    expect(result()).toContain('about decision [OTHER_1].');
    expect(result()).not.toContain(DECISION);
    // Undo: readable again, and a phone number again in the list.
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect([...api().excludedIndices].sort()).toEqual(DECISION_PLACES);
    expect(chipOf(DECISION, 'PHONE')).toBeInTheDocument();
    expect(result()).toContain(`about decision ${DECISION}.`);
    expect(result()).toContain(`sent decision ${DECISION} again`);
    expect(result()).not.toContain('[OTHER_1]');
  });

  it('what the issue asked for: un-redact the wrong find, select it again and say what it is; the label is of that type', async () => {
    const { api, result } = await page();
    const nordbank = api().entities.findIndex((entity) => entity.value === 'Nordbank');
    // Found as a company; the user unchecks it, then selects the word in the text.
    fireEvent.click(markOf('Nordbank'));
    expect(result()).toContain('of Nordbank called');
    const range = document.createRange();
    range.selectNodeContents(markOf('Nordbank'));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.mouseUp(markOf('Nordbank'), { clientX: 30, clientY: 60 });
    fireEvent.click(within(menuOf('Nordbank')).getByRole('button', { name: en.entityLabels.OTHER }));
    // Redacted again, as "other": not under the "[COMPANY_1]" it was found as.
    expect(api().excludedIndices.has(nordbank)).toBe(false);
    expect(result()).toContain('of [OTHER_1] called');
    expect(result()).not.toContain('[COMPANY_1]');
    expect(result()).not.toContain('Nordbank');
  });

  it('a row that leaves the filtered list with its new type hands the focus to "All"', async () => {
    await page();
    fireEvent.click(screen.getByTestId('entity-filter-type-PHONE'));
    fireEvent.click(chipOf(DECISION, 'PHONE'));
    fireEvent.click(within(menuOf(DECISION)).getByRole('button', { name: en.entityLabels.OTHER }));
    expect(() => rowOf(DECISION)).toThrow();
    expect(within(screen.getByTestId('entity-filter')).getByRole('button', { name: new RegExp(`^${en.entityTable.allTypes}`) })).toHaveFocus();
  });
});

describe('the strings of the feature', () => {
  it('exist in all eight languages, in their own words, without an em dash', () => {
    const codes = Object.keys(retypeStrings) as Array<keyof typeof retypeStrings>;
    expect(codes.sort()).toEqual(['de', 'en', 'es', 'fr', 'no', 'pl', 'pt', 'sv']);
    for (const code of codes) {
      const s = retypeStrings[code];
      const all = [s.heading, s.keep, s.markHint, s.change('TYPE', 'VALUE'), s.scope(3), s.changedToast('TYPE', 1), s.changedToast('TYPE', 3)];
      for (const text of all) {
        expect(text.trim(), code).not.toBe('');
        expect(text.includes(String.fromCharCode(0x2014)), code).toBe(false);
      }
      expect(s.change('TYPE', 'VALUE'), code).toMatch(/TYPE.*VALUE/);
      expect(s.scope(3), code).toContain('3');
      expect(s.changedToast('TYPE', 1), code).toContain('TYPE');
      expect(s.changedToast('TYPE', 3), code).toMatch(/TYPE.*3|3.*TYPE/);
      if (code !== 'en') {
        expect(s.heading, code).not.toBe(retypeStrings.en.heading);
        expect(s.keep, code).not.toBe(retypeStrings.en.keep);
        expect(s.markHint, code).not.toBe(retypeStrings.en.markHint);
      }
    }
  });
});
