// A label belongs to its value for the life of the document (T268). The numbers used to be issued
// again on every change of the list: un-redacting one person renumbered the people after it, so
// a reply written from a text copied BEFORE the change came back with other people's names and
// the report said that no label was left. Found by the independent review of the preview.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, EngineClient } from '@doccloak/core';
import { useAnonymizer } from '../../src/ui/hooks/useAnonymizer.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';
import { leftoversIn } from '../../src/ui/restoreReport.ts';

// jsdom's Blob has no text(); the hook reads a table file through it.
if (typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const REPORT = 'Victim: Rosa Delgado-Whitfield. Witness: Dwayne Okafor. Officer: Lauren Byrne of Harbor PD. '
  + 'Delgado-Whitfield called Okafor; Byrne wrote to rosa@example.com and to Victor Han.';

function found(text: string, type: DetectedEntity['type'], value: string, from = 0): DetectedEntity {
  const start = text.indexOf(value, from);
  if (start < 0) throw new Error(`"${value}" is not in the text`);
  return { type, value, start, end: start + value.length, confidence: 0.9, detector: 'test' };
}

// Switched on by a test: the detector then misses one person (as a lower sensitivity would).
let missOnePerson = false;
let shorterPerson = false;

function detect(text: string): DetectedEntity[] {
  // A second document that shares two values with the report and holds text shaped like their labels.
  if (text.startsWith('Template field')) {
    return [found(text, 'PERSON', 'Rosa Delgado-Whitfield'), found(text, 'EMAIL', 'rosa@example.com')];
  }
  if (missOnePerson) return detectAll(text).filter((entity) => !entity.value.includes('Byrne'));
  // The full name is found as its surname only (as a lower sensitivity can do).
  if (shorterPerson) {
    return detectAll(text).map((entity) => (entity.value === 'Lauren Byrne'
      ? { ...entity, value: 'Byrne', start: entity.start + 'Lauren '.length }
      : entity));
  }
  return detectAll(text);
}

function detectAll(text: string): DetectedEntity[] {
  const second = text.indexOf('Delgado-Whitfield called');
  return [
    ...(text.includes('Zoe Adams') ? [found(text, 'PERSON', 'Zoe Adams')] : []),
    found(text, 'PERSON', 'Rosa Delgado-Whitfield'),
    found(text, 'PERSON', 'Dwayne Okafor'),
    found(text, 'PERSON', 'Lauren Byrne'),
    found(text, 'COMPANY', 'Harbor PD'),
    found(text, 'PERSON', 'Delgado-Whitfield', second),
    found(text, 'PERSON', 'Okafor', second),
    found(text, 'PERSON', 'Byrne', second),
    found(text, 'EMAIL', 'rosa@example.com'),
    found(text, 'PERSON', 'Victor Han'),
  ].sort((a, b) => a.start - b.start);
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  let text = '';
  _setClientFactoryForTests(() => ({
    client: {
      preload: () => Promise.resolve(),
      detect: (input: string) => { text = input; return Promise.resolve(detect(text)); },
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
  missOnePerson = false;
  shorterPerson = false;
});

afterEach(() => {
  _setClientFactoryForTests(null);
  vi.restoreAllMocks();
});

async function redacted(text = REPORT) {
  const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
  act(() => hook.result.current.handleInputChange(text));
  act(() => hook.result.current.anonymize());
  await waitFor(() => expect(hook.result.current.entities).toHaveLength(9));
  return hook;
}

/** value -> label, as the list shows it. */
function labels(hook: Awaited<ReturnType<typeof redacted>>): Record<string, string> {
  return Object.fromEntries(hook.result.current.entries.map((entry) => [entry.original, entry.replacement]));
}

function indicesOf(hook: Awaited<ReturnType<typeof redacted>>, value: string): number[] {
  return hook.result.current.entities.map((entity, index) => (entity.value === value ? index : -1)).filter((index) => index >= 0);
}

describe('a label stays with its value', () => {
  it('un-redacting one person leaves every other label as it was; a reply from the earlier copy restores to the right people', async () => {
    const hook = await redacted();
    const before = labels(hook);
    const copied = hook.result.current.anonymizedText;
    expect(before['Rosa Delgado-Whitfield']).toBe('[PERSON_1]');
    expect(before['Dwayne Okafor']).toBe('[PERSON_2]');
    expect(before['Lauren Byrne']).toBe('[PERSON_3]');
    expect(before['Delgado-Whitfield']).toBe('[PERSON_1_LAST]');

    // The user copies the text, then decides the victim's full name may stay readable.
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Rosa Delgado-Whitfield'), true));
    const after = labels(hook);
    expect(after['Rosa Delgado-Whitfield']).toBeUndefined();
    for (const value of Object.keys(after)) expect(after[value], value).toBe(before[value]);
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length - 1);
    expect(hook.result.current.anonymizedText).toContain('Victim: Rosa Delgado-Whitfield. Witness: [PERSON_2]. Officer: [PERSON_3]');

    // The assistant answered from the copy made before the change.
    const reply = 'Victim: [PERSON_1]. Witness: [PERSON_2]. Officer: [PERSON_3].';
    expect(copied).toContain(reply.slice(0, 20));
    const restored = hook.result.current.restoreText(reply);
    // Nobody gets another person's name; the label that is no longer in the table is reported.
    expect(restored.text).toBe('Victim: [PERSON_1]. Witness: Dwayne Okafor. Officer: Lauren Byrne.');
    expect(restored.unresolved).toEqual(['[PERSON_1]']);
    expect(restored.restored).toBe(2);
  });

  it('redacting the value again gives it its own label back', async () => {
    const hook = await redacted();
    const before = labels(hook);
    const first = hook.result.current.anonymizedText;
    const places = indicesOf(hook, 'Dwayne Okafor');
    act(() => hook.result.current.setEntitiesExcluded(places, true));
    act(() => hook.result.current.setEntitiesExcluded(places, false));
    expect(labels(hook)).toEqual(before);
    expect(hook.result.current.anonymizedText).toBe(first);
  });

  it('a whole type kept visible, a single box and a value marked by hand change no other label', async () => {
    const hook = await redacted();
    const before = labels(hook);
    const people = hook.result.current.entities.map((entity, index) => (entity.type === 'PERSON' ? index : -1)).filter((index) => index >= 0);
    act(() => hook.result.current.setEntitiesExcluded(people.slice(0, 3), true));
    act(() => hook.result.current.toggleEntity(people[3]));
    // "Witness" marked by hand as a person: it is new, so it takes the next free number.
    const at = REPORT.indexOf('Witness');
    act(() => hook.result.current.addManualEntity(at, at + 7, 'PERSON'));
    const after = labels(hook);
    for (const value of Object.keys(after)) {
      if (value !== 'Witness') expect(after[value], value).toBe(before[value]);
    }
    const taken = new Set(Object.values(before));
    expect(after.Witness).toMatch(/^\[PERSON_\d+\]$/);
    expect(taken.has(after.Witness)).toBe(false);
    // Everything redacted again: the first labels, plus the new one.
    const kept = [...hook.result.current.excludedIndices];
    act(() => hook.result.current.setEntitiesExcluded(kept, false));
    expect(labels(hook)).toEqual({ ...before, Witness: after.Witness });
  });

  it('marking a value by hand does not move what the user chose to leave readable', async () => {
    const hook = await redacted();
    // The company and the last person stay readable: places 3 and 8 of the list.
    act(() => hook.result.current.setEntitiesExcluded([...indicesOf(hook, 'Harbor PD'), ...indicesOf(hook, 'Victor Han')], true));
    const keptValues = () => [...hook.result.current.excludedIndices].map((index) => hook.result.current.entities[index].value).sort();
    expect(keptValues()).toEqual(['Harbor PD', 'Victor Han']);
    // A value before both of them is marked by hand: every place after it moves down by one.
    const at = REPORT.indexOf('Witness');
    act(() => hook.result.current.addManualEntity(at, at + 7, 'OTHER'));
    expect(hook.result.current.entities).toHaveLength(10);
    expect(keptValues()).toEqual(['Harbor PD', 'Victor Han']);
    const text = hook.result.current.anonymizedText;
    expect(text).toContain('of Harbor PD.');
    expect(text).toContain('and to Victor Han.');
    // Nothing that was redacted became readable.
    for (const value of ['Rosa Delgado-Whitfield', 'Dwayne Okafor', 'Lauren Byrne', 'rosa@example.com', 'Witness']) {
      expect(text, value).not.toContain(value);
    }
    // A value marked after them changes nothing either.
    const end = REPORT.indexOf('wrote');
    act(() => hook.result.current.addManualEntity(end, end + 5, 'OTHER'));
    expect(keptValues()).toEqual(['Harbor PD', 'Victor Han']);
  });

  it('a re-run on the same text keeps the labels; another text starts from one', async () => {
    const hook = await redacted();
    const before = labels(hook);
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Rosa Delgado-Whitfield'), true));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    const rerun = labels(hook);
    for (const value of Object.keys(rerun)) expect(rerun[value], value).toBe(before[value]);

    const other = REPORT.replace('Victim: Rosa Delgado-Whitfield. ', 'Victim: Rosa Delgado-Whitfield, born 1990. ');
    act(() => hook.result.current.handleInputChange(other));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('born 1990'));
    expect(labels(hook)['Rosa Delgado-Whitfield']).toBe('[PERSON_1]');
    expect(labels(hook)['Dwayne Okafor']).toBe('[PERSON_2]');
  });

  it('the saved table holds what is redacted now, with the same labels', async () => {
    const hook = await redacted();
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Rosa Delgado-Whitfield'), true));
    let saved: { blob: Blob; count: number } | null = null;
    act(() => { saved = hook.result.current.exportMapping(); });
    const json = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText((saved as unknown as { blob: Blob }).blob);
    });
    const table = JSON.parse(json) as Array<{ original: string; replacement: string }>;
    const byValue = Object.fromEntries(table.map((entry) => [entry.original, entry.replacement]));
    expect(byValue['Rosa Delgado-Whitfield']).toBeUndefined();
    expect(byValue['Dwayne Okafor']).toBe('[PERSON_2]');
    expect(byValue['Delgado-Whitfield']).toBe('[PERSON_1_LAST]');
    expect(table).toHaveLength(hook.result.current.entries.length);
  });

  it('a place marked by hand takes the place of the finds it covers: one place is one row', async () => {
    const hook = await redacted();
    const all = hook.result.current.entities.length;
    // The same words once more: nothing is added.
    const byrne = REPORT.indexOf('Lauren Byrne');
    act(() => hook.result.current.addManualEntity(byrne, byrne + 'Lauren Byrne'.length, 'PERSON'));
    expect(hook.result.current.entities).toHaveLength(all);
    expect(hook.result.current.entities.filter((entity) => entity.start === byrne)).toHaveLength(1);
    expect(labels(hook)['Lauren Byrne']).toBe('[PERSON_3]');
    // A wider mark over a found name: the found one gives way, and its "not redacted" goes with it.
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Dwayne Okafor'), true));
    const witness = REPORT.indexOf('Witness: Dwayne Okafor');
    act(() => hook.result.current.addManualEntity(witness, witness + 'Witness: Dwayne Okafor'.length, 'OTHER'));
    const there = hook.result.current.entities.filter((entity) => entity.start >= witness && entity.end <= witness + 'Witness: Dwayne Okafor'.length);
    expect(there.map((entity) => entity.value)).toEqual(['Witness: Dwayne Okafor']);
    expect(hook.result.current.entities).toHaveLength(all);
    expect(hook.result.current.anonymizedText).not.toContain('Witness: Dwayne Okafor');
    // The label the found name had stays reserved for it: a reply from an earlier copy is not misread.
    expect(Object.values(labels(hook))).not.toContain('[PERSON_2]');
    expect(hook.result.current.restoreText('[PERSON_2] and [PERSON_3]').text).toBe('[PERSON_2] and Lauren Byrne');
  });

  it('Undo after Clear brings back the list, what is not redacted and the renamed labels, with the same labels', async () => {
    const hook = await redacted();
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Lauren Byrne'), true));
    act(() => { hook.result.current.renameLabel('Dwayne Okafor', '[WITNESS]'); });
    const before = { labels: labels(hook), text: hook.result.current.anonymizedText, excluded: [...hook.result.current.excludedIndices] };
    let snapshot: ReturnType<typeof hook.result.current.snapshotText> | undefined;
    act(() => { snapshot = hook.result.current.snapshotText(); hook.result.current.clear(); });
    expect(hook.result.current.inputText).toBe('');
    expect(hook.result.current.entries).toHaveLength(0);
    act(() => hook.result.current.restoreSnapshot(snapshot!));
    expect(hook.result.current.inputText).toBe(REPORT);
    expect(labels(hook)).toEqual(before.labels);
    expect(hook.result.current.anonymizedText).toBe(before.text);
    expect([...hook.result.current.excludedIndices]).toEqual(before.excluded);
    expect(hook.result.current.renamedOriginals.has('Dwayne Okafor')).toBe(true);
    // A reply written before the Clear restores as it would have.
    expect(hook.result.current.restoreText('[WITNESS] met [PERSON_1].').text).toBe('Dwayne Okafor met Rosa Delgado-Whitfield.');
    // A re-run on the text that came back still keeps the choices.
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(labels(hook)).toEqual(before.labels);
  });

  it('Undo after Clear of a text that was never redacted brings back the text', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    act(() => hook.result.current.handleInputChange('Just a note.'));
    let snapshot: ReturnType<typeof hook.result.current.snapshotText> | undefined;
    act(() => { snapshot = hook.result.current.snapshotText(); hook.result.current.clear(); });
    act(() => hook.result.current.restoreSnapshot(snapshot!));
    expect(hook.result.current.inputText).toBe('Just a note.');
    expect(hook.result.current.anonymizedText).toBe('');
  });

  it('a label that belongs to another value is refused with a message, also while that value is not redacted', async () => {
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted();
    // Taken by a value in the table.
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[PERSON_3]'));
    expect(labels(hook)['Dwayne Okafor']).toBe('[PERSON_2]');
    // The reason comes back to the caller: the list shows it at the field, which stays open.
    expect(hook.result.current.renameLabel('Dwayne Okafor', '[PERSON_3]')).toBe(en.entityTable.labelTaken('[PERSON_3]', 'Lauren Byrne'));
    // Reserved by a value that is not redacted now: a reply from an earlier copy still means that value.
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Lauren Byrne'), true));
    expect(labels(hook)['Lauren Byrne']).toBeUndefined();
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[PERSON_3]'));
    expect(labels(hook)['Dwayne Okafor']).toBe('[PERSON_2]');
    // A free label is taken as before.
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[WITNESS]'));
    expect(labels(hook)['Dwayne Okafor']).toBe('[WITNESS]');
  });

  it('a renamed label can be taken back: the value gets its numbered label again, the others keep theirs', async () => {
    const hook = await redacted();
    const before = labels(hook);
    const first = hook.result.current.anonymizedText;
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[WITNESS]'));
    expect(hook.result.current.renamedOriginals.has('Dwayne Okafor')).toBe(true);
    expect(labels(hook).Okafor).toBe('[WITNESS_LAST]');
    act(() => hook.result.current.resetLabel('Dwayne Okafor'));
    expect(hook.result.current.renamedOriginals.size).toBe(0);
    expect(labels(hook)).toEqual(before);
    expect(hook.result.current.anonymizedText).toBe(first);
    // Nothing to take back: nothing happens.
    act(() => hook.result.current.resetLabel('Lauren Byrne'));
    expect(labels(hook)).toEqual(before);
  });

  it('the places left readable are located in the protected text', async () => {
    const hook = await redacted();
    expect(hook.result.current.keptRanges).toEqual([]);
    act(() => hook.result.current.setEntitiesExcluded([...indicesOf(hook, 'Harbor PD'), ...indicesOf(hook, 'Victor Han')], true));
    const output = hook.result.current.anonymizedText;
    expect(hook.result.current.keptRanges.map((range) => output.slice(range.start, range.end))).toEqual(['Harbor PD', 'Victor Han']);
    // A rename changes the length of the text before them: the marks follow.
    act(() => hook.result.current.renameLabel('Rosa Delgado-Whitfield', '[THE_VICTIM_OF_THE_INCIDENT]'));
    const renamed = hook.result.current.anonymizedText;
    expect(hook.result.current.keptRanges.map((range) => renamed.slice(range.start, range.end))).toEqual(['Harbor PD', 'Victor Han']);
  });

  it('a label that differs from another value\'s only in case or separators is refused too: restore reads them as one', async () => {
    const hook = await redacted();
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Dwayne Okafor'), true));
    for (const typed of ['[Person 2]', '[person-2]', '[PERSON 2]']) {
      act(() => hook.result.current.renameLabel('Lauren Byrne', typed));
      expect(labels(hook)['Lauren Byrne'], typed).toBe('[PERSON_3]');
    }
    // The reply written from the earlier copy still cannot come back as someone else.
    const restored = hook.result.current.restoreText('Please ask [PERSON_2] to sign.');
    expect(restored.text).toBe('Please ask [PERSON_2] to sign.');
    expect(restored.stale).toEqual([{ label: '[PERSON_2]', original: 'Dwayne Okafor', reason: 'gone' }]);
  });

  it('a label once given to a value is never given to another, also after the rename was taken back', async () => {
    const hook = await redacted();
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[CLIENT]'));
    act(() => hook.result.current.resetLabel('Dwayne Okafor'));
    act(() => hook.result.current.renameLabel('Lauren Byrne', '[CLIENT]'));
    expect(labels(hook)['Lauren Byrne']).toBe('[PERSON_3]');
    // A reply from the copy made while the rename stood: the label is named with what it stood for.
    const restored = hook.result.current.restoreText('Confirm with [CLIENT] and [PERSON_3].');
    expect(restored.text).toBe('Confirm with [CLIENT] and Lauren Byrne.');
    expect(restored.unresolved).toEqual(['[CLIENT]']);
    expect(restored.stale).toEqual([{ label: '[CLIENT]', original: 'Dwayne Okafor', reason: 'gone' }]);
    expect(restored.segments.some((segment) => segment.kind === 'leftover' && segment.text === '[CLIENT]')).toBe(true);
  });

  it('a corrected text keeps the labels of the values it shares with the first one; a reply from the first copy restores to the right people', async () => {
    const hook = await redacted();
    const before = labels(hook);
    const reply = 'Victim: [PERSON_1]. Witness: [PERSON_2]. Officer: [PERSON_3]. Mail: [EMAIL_1].';
    // Clear, undo, a sentence added at the top with a new person: the text is another one now.
    act(() => hook.result.current.clear());
    const next = hook;
    act(() => next.result.current.handleInputChange(`Reported by Zoe Adams. ${REPORT}`));
    act(() => next.result.current.anonymize());
    await waitFor(() => expect(next.result.current.anonymizedText).toContain('Reported by'));
    const after = labels(next);
    for (const value of Object.keys(before)) expect(after[value], value).toBe(before[value]);
    expect(after['Zoe Adams']).toMatch(/^\[PERSON_\d+\]$/);
    expect(Object.values(before)).not.toContain(after['Zoe Adams']);
    expect(next.result.current.restoreText(reply).text).toBe('Victim: Rosa Delgado-Whitfield. Witness: Dwayne Okafor. Officer: Lauren Byrne. Mail: rosa@example.com.');
  });

  it('values other than people are numbered in reading order', async () => {
    const twoCompanies = 'Acme Ltd sued Borg GmbH. Write to a@acme.example or b@borg.example.';
    _setClientFactoryForTests(() => ({
      client: {
        preload: () => Promise.resolve(),
        detect: (input: string) => Promise.resolve([
          found(input, 'COMPANY', 'Acme Ltd'), found(input, 'COMPANY', 'Borg GmbH'), found(input, 'EMAIL', 'a@acme.example'), found(input, 'EMAIL', 'b@borg.example'),
        ]),
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
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    act(() => hook.result.current.handleInputChange(twoCompanies));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(4));
    expect(hook.result.current.anonymizedText).toBe('[COMPANY_1] sued [COMPANY_2]. Write to [EMAIL_1] or [EMAIL_2].');
  });

  it('a rename makes the saved table stale: the reminder comes back', async () => {
    const hook = await redacted();
    act(() => hook.result.current.markResultTakenOut());
    act(() => { hook.result.current.exportMapping(); });
    expect(hook.result.current.tableReminder).toBe(false);
    expect(hook.result.current.tableUnsaved).toBe(false);
    const version = hook.result.current.tableVersion;
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[WITNESS]'));
    expect(hook.result.current.tableUnsaved).toBe(true);
    expect(hook.result.current.tableReminder).toBe(true);
    expect(hook.result.current.tableVersion).toBeGreaterThan(version);
  });

  it('a hand label shaped like a variant label keeps that variant label from another value', async () => {
    const hook = await redacted();
    // "Okafor" is [PERSON_2_LAST]; a hand label for another value in the spelling of [PERSON_3_LAST].
    act(() => hook.result.current.renameLabel('Victor Han', '[person 3 last]'));
    act(() => hook.result.current.resetLabel('Victor Han'));
    const after = labels(hook);
    // Lauren Byrne's surname had [PERSON_3_LAST] before the rename: it keeps it (the rename was refused, the form was hers).
    expect(after.Byrne).toBe('[PERSON_3_LAST]');
    expect(after['Victor Han']).toBe('[PERSON_4]');
  });

  it('a hand label in the shape of DocCloak\'s own numbered labels is refused, in every spelling', async () => {
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted();
    const refused = [
      '[PERSON_9]', '[person 9]', '[Person-9]', '[PERSON9]', '[PERSON.9]', '[PERSON#9]', '[Person/9]', '[PERSON_\uFF19]',
      '[COMPANY_2]', '[credit card 1]', '[person 9 last]', '[PERSON_9_FIRST]', '[REDACTED_1]',
    ];
    for (const typed of refused) {
      act(() => hook.result.current.renameLabel('Victor Han', typed));
      expect(labels(hook)['Victor Han'], typed).toBe('[PERSON_4]');
    }
    expect(hook.result.current.renameLabel('Victor Han', '[REDACTED_1]')).toBe(en.entityTable.labelOwnShape('[REDACTED_1]'));
    // Names of one's own stay free, numbered or not.
    for (const typed of ['[CLIENT]', '[CLIENT_2]', '[PERSONA]', '[PARTY A]']) {
      act(() => hook.result.current.renameLabel('Victor Han', typed));
      expect(labels(hook)['Victor Han'], typed).toBe(typed);
    }
    // ... and the way back to the value's own numbered label is open.
    act(() => hook.result.current.resetLabel('Victor Han'));
    expect(labels(hook)['Victor Han']).toBe('[PERSON_4]');
  });

  it('a label that would be derived for a surname is checked like a typed one', async () => {
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted();
    // "[CLIENT_LAST]" typed for one person and copied, then taken back.
    act(() => hook.result.current.renameLabel('Victor Han', '[CLIENT_LAST]'));
    act(() => hook.result.current.resetLabel('Victor Han'));
    // "[CLIENT]" for a person whose surname stands alone in the text would make that surname "[CLIENT_LAST]".
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[CLIENT]'));
    expect(labels(hook)['Dwayne Okafor']).toBe('[PERSON_2]');
    expect(labels(hook).Okafor).toBe('[PERSON_2_LAST]');
    // The message names the label that was typed and the one that would follow from it.
    expect(hook.result.current.renameLabel('Dwayne Okafor', '[CLIENT]')).toBe(en.entityTable.labelDerivedTaken('[CLIENT]', '[CLIENT_LAST]', 'Victor Han'));
    for (const typed of ['[klient last]', '[X_LAST]']) {
      act(() => hook.result.current.renameLabel('Victor Han', typed));
      act(() => hook.result.current.resetLabel('Victor Han'));
      act(() => hook.result.current.renameLabel('Dwayne Okafor', typed.replace(/[ _]last/i, '')));
      expect(labels(hook).Okafor, typed).toBe('[PERSON_2_LAST]');
    }
  });

  it('a surname found later does not take a label that stood for another value: it keeps its numbered one', async () => {
    const hook = await redacted();
    act(() => hook.result.current.clear());
    const text = `Reported by Zoe Adams. ${REPORT} Adams agreed.`;
    act(() => hook.result.current.handleInputChange(text));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('Reported by'));
    // "[X_LAST]" stood for Victor Han in a copy; Zoe Adams becomes "[X]" while her surname is not yet a value.
    act(() => hook.result.current.renameLabel('Victor Han', '[X_LAST]'));
    act(() => hook.result.current.resetLabel('Victor Han'));
    act(() => hook.result.current.renameLabel('Zoe Adams', '[X]'));
    expect(labels(hook)['Zoe Adams']).toBe('[X]');
    // Her surname is marked afterwards: the session derives its label from hers.
    const at = text.indexOf('Adams agreed');
    act(() => hook.result.current.addManualEntity(at, at + 5, 'PERSON'));
    // "[X_LAST]" would follow from "[X]"; it stood for Victor Han, so the surname keeps its own number.
    expect(labels(hook).Adams).toMatch(/^\[PERSON_\d+_LAST\]$/);
    expect(labels(hook)['Zoe Adams']).toBe('[X]');
    const restored = hook.result.current.restoreText('Dear [X_LAST], greetings from [X].');
    // The copy that is out meant Victor Han: the label is left and reported, "Adams" is not written.
    expect(restored.text).toBe('Dear [X_LAST], greetings from Zoe Adams.');
    expect(restored.restored).toBe(1);
    expect(restored.stale).toEqual([{ label: '[X_LAST]', original: 'Victor Han', reason: 'gone' }]);
  });

  it('two renames that meet in one label after a value comes back: both values keep what a copy may hold', async () => {
    const hook = await redacted();
    // The surname is not redacted for now; its person becomes "[X]", another person "[X_LAST]".
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Okafor'), true));
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[X]'));
    act(() => hook.result.current.renameLabel('Victor Han', '[X_LAST]'));
    expect(labels(hook)['Victor Han']).toBe('[X_LAST]');
    // The surname is redacted again: the label that follows "[X]" is Victor Han's, so it keeps its number.
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Okafor'), false));
    const after = labels(hook);
    expect(after['Victor Han']).toBe('[X_LAST]');
    expect(after['Dwayne Okafor']).toBe('[X]');
    expect(after.Okafor).toBe('[PERSON_2_LAST]');
    expect(hook.result.current.restoreText('Mr [X_LAST] and [X] and [PERSON_2_LAST].').text).toBe('Mr Victor Han and Dwayne Okafor and Okafor.');
    // ... and it stays that way through another change.
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Okafor'), true));
    expect(hook.result.current.restoreText('Mr [X_LAST] agreed.').text).toBe('Mr Victor Han agreed.');
  });

  it('a label that the document itself holds as bracketed text is refused: restore would replace that text', async () => {
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted(`${REPORT} As set out in [Annex A], the [Client] pays the <<Fee>> (Deposit).`);
    for (const typed of ['[CLIENT]', '[client]', '[Annex A]', '[annex_a]', '[FEE]']) {
      act(() => hook.result.current.renameLabel('Victor Han', typed));
      expect(labels(hook)['Victor Han'], typed).toBe('[PERSON_4]');
    }
    expect(hook.result.current.renameLabel('Victor Han', '[FEE]')).toBe(en.entityTable.labelInText('<<Fee>>'));
    // Round brackets are not a form restore reads: "(Deposit)" in the text does not stand in the way.
    act(() => hook.result.current.renameLabel('Victor Han', '[DEPOSIT]'));
    expect(labels(hook)['Victor Han']).toBe('[DEPOSIT]');
    const restored = hook.result.current.restoreText('Under [Annex A] the [Client] pays the <<Fee>> (Deposit) to [DEPOSIT].');
    expect(restored.text).toBe('Under [Annex A] the [Client] pays the <<Fee>> (Deposit) to Victor Han.');
  });

  it('a result that left the page is still out after Clear and the same text again', async () => {
    const hook = await redacted();
    act(() => hook.result.current.markResultTakenOut());
    act(() => hook.result.current.clear());
    expect(hook.result.current.resultTakenOut).toBe(false);
    act(() => hook.result.current.handleInputChange(REPORT));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(9));
    expect(hook.result.current.resultTakenOut).toBe(true);
    // Another text has not left the page.
    act(() => hook.result.current.handleInputChange(`Reported by Zoe Adams. ${REPORT}`));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('Reported by'));
    expect(hook.result.current.resultTakenOut).toBe(false);
  });

  it('text of the document that restore would read as a label keeps that label from being issued', async () => {
    const sheet = 'Sheet columns: NAME, ADDRESS_1, PHONE_1, EMAIL_1. Row 2: John Smith, 12 Baker Street, +44 20 7946 0958, john.smith@example.com. '
      + 'Template field {PERSON_1} and (PERSON_2) are filled in later; see also <<COMPANY_1>> of Acme Ltd.';
    _setClientFactoryForTests(() => ({
      client: {
        preload: () => Promise.resolve(),
        detect: (input: string) => Promise.resolve([
          found(input, 'PERSON', 'John Smith'), found(input, 'ADDRESS', '12 Baker Street'), found(input, 'PHONE', '+44 20 7946 0958'),
          found(input, 'EMAIL', 'john.smith@example.com'), found(input, 'COMPANY', 'Acme Ltd'),
        ]),
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
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    act(() => hook.result.current.handleInputChange(sheet));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(5));
    const issued = labels(hook);
    // Every number that stands in the text, in any form restore reads, is passed over.
    expect(issued['12 Baker Street']).toBe('[ADDRESS_2]');
    expect(issued['+44 20 7946 0958']).toBe('[PHONE_2]');
    expect(issued['john.smith@example.com']).toBe('[EMAIL_2]');
    expect(issued['John Smith']).toBe('[PERSON_3]');
    expect(issued['Acme Ltd']).toBe('[COMPANY_2]');
    // The protected text, given straight back, is the source again: the column names and the
    // template fields are not filled with the person's data.
    const round = hook.result.current.restoreText(hook.result.current.anonymizedText);
    expect(round.text).toBe(sheet);
    expect(round.restored).toBe(5);
    // A typed label that stands in the text as a bare code is given up, with a message.
    const { en } = await import('../../src/i18n/translations/en.ts');
    const coded = `Case code CLIENT_2 applies. ${sheet}`;
    act(() => hook.result.current.handleInputChange(coded));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('Case code'));
    // Given up while the text is made again: still a refusal of this rename, returned to the field.
    let refused: string | null = null;
    act(() => { refused = hook.result.current.renameLabel('John Smith', '[CLIENT_2]'); });
    expect(labels(hook)['John Smith']).toBe('[PERSON_3]');
    expect(refused).toBe(en.entityTable.labelInText('[CLIENT_2]'));
    expect(hook.result.current.restoreText('Under case code CLIENT_2, [PERSON_3] signed.').text).toBe('Under case code CLIENT_2, John Smith signed.');
  });

  it('the buttons of the never-redact toasts act on their places after the list changed', async () => {
    const { screen, fireEvent } = await import('@testing-library/react');
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted();
    act(() => hook.result.current.handleKeepTypesChange(['PERSON']));
    const keptValues = () => [...hook.result.current.excludedIndices].map((index) => hook.result.current.entities[index].value);
    expect(keptValues()).toHaveLength(7);
    // A word marked by hand in between: every later place has a new number.
    const at = REPORT.indexOf('Victim');
    act(() => hook.result.current.addManualEntity(at, at + 6, 'OTHER'));
    fireEvent.click(screen.getByRole('button', { name: en.toast.undo }));
    expect(hook.result.current.keepTypes).toEqual([]);
    expect(keptValues()).toEqual([]);
    // The same for "Redact them now" after the type was taken off the list.
    act(() => hook.result.current.handleKeepTypesChange(['PERSON']));
    act(() => hook.result.current.handleKeepTypesChange([]));
    expect(keptValues()).toHaveLength(7);
    const other = REPORT.indexOf('Officer');
    act(() => hook.result.current.addManualEntity(other, other + 7, 'OTHER'));
    fireEvent.click(screen.getByRole('button', { name: en.entityTable.redactThemNow }));
    expect(keptValues()).toEqual([]);
    expect(hook.result.current.anonymizedText).not.toContain('Dwayne Okafor');
  });

  it('a value the tab already knows keeps its label in a second document; where that document reads as the label, restore leaves it', async () => {
    const hook = await redacted();
    expect(labels(hook)['Rosa Delgado-Whitfield']).toBe('[PERSON_1]');
    act(() => hook.result.current.clear());
    const second = 'Template field {PERSON_1} is filled in later. Rosa Delgado-Whitfield signed on form EMAIL_1, mail rosa@example.com.';
    act(() => hook.result.current.handleInputChange(second));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(2));
    // The labels stay (a copy of the first document is out with them)...
    expect(labels(hook)).toEqual({ 'Rosa Delgado-Whitfield': '[PERSON_1]', 'rosa@example.com': '[EMAIL_1]' });
    const protectedText = hook.result.current.anonymizedText;
    expect(protectedText).toBe('Template field {PERSON_1} is filled in later. [PERSON_1] signed on form EMAIL_1, mail [EMAIL_1].');
    // ... so in a reply nobody can tell the field from the label: neither is filled in.
    const restored = hook.result.current.restoreText(protectedText);
    expect(restored.text).toBe(protectedText);
    expect(restored.restored).toBe(0);
    expect(new Set(restored.stale?.map((item) => item.reason))).toEqual(new Set(['textlabel']));
    expect(restored.text).not.toContain('{Rosa');
    expect(restored.text).not.toContain('form rosa@');
  });

  it('a re-run that no longer finds a redacted place says so and can keep it redacted', async () => {
    const { screen, fireEvent } = await import('@testing-library/react');
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted();
    expect(hook.result.current.anonymizedText).not.toContain('Byrne');
    missOnePerson = true;
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(7));
    // "Lauren Byrne" and "Byrne" are readable now: said, with the way back.
    expect(hook.result.current.anonymizedText).toContain('Officer: Lauren Byrne of');
    // Kept as a state of the result (not a toast that goes away), until it is answered.
    expect(hook.result.current.droppedCount).toBe(2);
    expect(screen.queryByText(en.entityTable.droppedToast(2))).toBeNull();
    void fireEvent;
    act(() => hook.result.current.keepDroppedRedacted());
    expect(hook.result.current.droppedCount).toBe(0);
    expect(hook.result.current.entities).toHaveLength(9);
    expect(hook.result.current.anonymizedText).not.toContain('Byrne');
    // With their own labels, as before.
    expect(labels(hook)['Lauren Byrne']).toBe('[PERSON_3]');
    expect(labels(hook).Byrne).toBe('[PERSON_3_LAST]');
  });

  it('a value found shorter by a re-run counts as lost too: the part it no longer covers is readable', async () => {
    const hook = await redacted();
    shorterPerson = true;
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('Officer: Lauren ['));
    expect(hook.result.current.droppedCount).toBe(1);
    act(() => hook.result.current.keepDroppedRedacted());
    expect(hook.result.current.anonymizedText).not.toContain('Lauren');
    expect(hook.result.current.droppedCount).toBe(0);
    // Dismissed instead: the notice goes, the text stays as the run left it.
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    act(() => hook.result.current.dismissDropped());
    expect(hook.result.current.droppedCount).toBe(0);
  });

  it('a label of signs only, or with brackets inside, is refused', async () => {
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted();
    for (const typed of ['[???]', '[***]', '[---]', '[\u2026]', '[#]', '[CLIENT][BOSS]', '[A<B>]', '[{X}]']) {
      act(() => hook.result.current.renameLabel('Victor Han', typed));
      expect(labels(hook)['Victor Han'], typed).toBe('[PERSON_4]');
    }
    expect(hook.result.current.renameLabel('Victor Han', '[{X}]')).toBe(en.entityTable.labelInvalid);
    // An ordinary name with a number, a space or a non-Latin letter is fine.
    for (const typed of ['[COMPANY_1X]', '[sp\u00F3\u0142ka B]', '[MANAGER 1]']) {
      act(() => hook.result.current.renameLabel('Victor Han', typed));
      expect(labels(hook)['Victor Han'], typed).toBe(typed);
    }
  });

  it('a table from a file that restores labels the open document also uses says so; a reply before any copy is flagged in the panel', async () => {
    const hook = await redacted();
    const table = [
      { original: 'Olivia Green', replacement: '[PERSON_1]', entity_type: 'PERSON' },
      { original: 'Harry White', replacement: '[PERSON_2]', entity_type: 'PERSON' },
    ];
    await act(async () => { await hook.result.current.importMapping(new File([JSON.stringify(table)], 'other_replacement-table.json')); });
    const crossed = hook.result.current.restoreText('Victim: [PERSON_1]. Witness: [PERSON_2].');
    expect(crossed.text).toBe('Victim: Olivia Green. Witness: Harry White.');
    expect(crossed.fileOverDocument).toBe(true);
    act(() => hook.result.current.clearImportedMapping());
    const own = hook.result.current.restoreText('Victim: [PERSON_1]. Witness: [PERSON_2].');
    expect(own.text).toBe('Victim: Rosa Delgado-Whitfield. Witness: Dwayne Okafor.');
    expect(own.fileOverDocument).toBe(false);
    expect(hook.result.current.resultTakenOut).toBe(false);
    act(() => hook.result.current.markResultTakenOut());
    expect(hook.result.current.resultTakenOut).toBe(true);
  });

  it('the labels of a table loaded from a file are taken: a document redacted afterwards gets other numbers', async () => {
    const hook = renderHook(() => useAnonymizer(), { wrapper: Providers });
    const table = [
      { original: 'Olivia Green', replacement: '[PERSON_1]', entity_type: 'PERSON' },
      { original: 'Harry White', replacement: '[PERSON_2]', entity_type: 'PERSON' },
      { original: 'olivia@example.org', replacement: '[EMAIL_1]', entity_type: 'EMAIL' },
    ];
    let loaded: unknown = null;
    await act(async () => { loaded = await hook.result.current.importMapping(new File([JSON.stringify(table)], 'other_replacement-table.json')); });
    expect(loaded).not.toBeNull();
    const reply = 'Summary: [PERSON_1] reports to [PERSON_2], mail [EMAIL_1].';
    expect(hook.result.current.restoreText(reply).text).toBe('Summary: Olivia Green reports to Harry White, mail olivia@example.org.');
    // Another document is redacted: the file table is put away, the reply is still in the box.
    act(() => hook.result.current.handleInputChange(REPORT));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.entities).toHaveLength(9));
    const now = labels(hook);
    expect(Object.values(now)).not.toContain('[PERSON_1]');
    expect(Object.values(now)).not.toContain('[PERSON_2]');
    expect(Object.values(now)).not.toContain('[EMAIL_1]');
    const again = hook.result.current.restoreText(reply);
    expect(again.text).toBe(reply);
    expect(again.restored).toBe(0);
    expect(again.stale?.map((item) => item.reason)).toEqual(['elsewhere', 'elsewhere', 'elsewhere']);
    expect(JSON.stringify(again)).not.toContain('Olivia');
  });

  it('redacting the same text again after a copy keeps the reminder and the unsaved-table guard', async () => {
    const hook = await redacted();
    act(() => hook.result.current.markResultTakenOut());
    expect(hook.result.current.tableUnsaved).toBe(true);
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(hook.result.current.tableUnsaved).toBe(true);
    expect(hook.result.current.tableReminder).toBe(true);
    // Another text is another result: nothing of it has left the page yet.
    act(() => hook.result.current.handleInputChange(`Reported by Zoe Adams. ${REPORT}`));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('Reported by'));
    expect(hook.result.current.tableUnsaved).toBe(false);
  });

  it('values of a text that is no longer open are not shown in the restore report', async () => {
    const hook = await redacted();
    act(() => hook.result.current.clear());
    // A text that shares only the e-mail address with the first one.
    _setClientFactoryForTests(null);
    const other = 'Note for rosa@example.com about the invoice.';
    act(() => hook.result.current.handleInputChange(other));
    act(() => hook.result.current.addManualEntity(other.indexOf('rosa@example.com'), other.indexOf('rosa@example.com') + 16, 'EMAIL'));
    const restored = hook.result.current.restoreText('Victim: [PERSON_1], mail [EMAIL_1].');
    expect(restored.text).toBe('Victim: [PERSON_1], mail rosa@example.com.');
    expect(restored.stale).toEqual([{ label: '[PERSON_1]', original: '', reason: 'elsewhere' }]);
    expect(JSON.stringify(restored)).not.toContain('Delgado');
  });

  it('a hand mark leaves punctuation out and offers the other places of the same text', async () => {
    const { screen, fireEvent } = await import('@testing-library/react');
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted();
    // "Byrne" stands twice; the second place is found by the detector, so a third word is used: "Officer:" with its colon.
    const at = REPORT.indexOf('Officer:');
    act(() => hook.result.current.addManualEntity(at, at + 'Officer:'.length, 'OTHER'));
    const marked = hook.result.current.entities.find((entity) => entity.detector === 'manual');
    expect(marked?.value).toBe('Officer');
    expect(hook.result.current.anonymizedText).toContain(': [PERSON_3] of');
    expect(hook.result.current.anonymizedText).toMatch(/\[OTHER_\d+\]: \[PERSON_3\]/);
    // "Witness" stands once: nothing to offer. "Delgado-Whitfield" is covered by the detector everywhere.
    expect(screen.queryByText(en.textInput.alsoElsewhere(1))).toBeNull();
    const text = `${REPORT} The clerk called again; the clerk left.`;
    act(() => hook.result.current.handleInputChange(text));
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('clerk'));
    const first = text.indexOf('clerk');
    act(() => hook.result.current.addManualEntity(first, first + 5, 'OTHER'));
    expect(screen.getByText(en.textInput.alsoElsewhere(1))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.textInput.redactThemToo }));
    expect(hook.result.current.entities.filter((entity) => entity.value === 'clerk')).toHaveLength(2);
    expect(hook.result.current.anonymizedText).not.toContain('clerk');
  });

  it('a renamed label and the blanked style still work', async () => {
    const hook = await redacted();
    act(() => hook.result.current.renameLabel('Dwayne Okafor', '[WITNESS]'));
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Rosa Delgado-Whitfield'), true));
    expect(labels(hook)['Dwayne Okafor']).toBe('[WITNESS]');
    expect(labels(hook)['Lauren Byrne']).toBe('[PERSON_3]');
    act(() => hook.result.current.handleReplacementModeChange('blanked'));
    expect(hook.result.current.anonymizedText).toContain('Witness: ________.');
    expect(hook.result.current.anonymizedText).toContain('Victim: Rosa Delgado-Whitfield.');
    act(() => hook.result.current.handleReplacementModeChange('labeled'));
    expect(labels(hook)['Lauren Byrne']).toBe('[PERSON_3]');
    expect(labels(hook)['Dwayne Okafor']).toBe('[WITNESS]');
  });
});

describe('what is left after a restore', () => {
  const ever = new Map([
    ['person_2', { label: '[PERSON_2]', original: 'Dwayne Okafor' }],
    ['client', { label: '[CLIENT]', original: 'Rosa Delgado-Whitfield' }],
    ['person_7', { label: '[PERSON_7]', original: 'Someone Else' }],
    ['person_3', { label: '[PERSON_3]', original: 'Lauren Byrne' }],
  ]);
  // The open document holds Dwayne and Rosa (not redacted now) and Lauren (in the table as [PERSON_3]).
  const context = { ever, documentValues: new Set(['Dwayne Okafor', 'Rosa Delgado-Whitfield', 'Lauren Byrne']), tableForms: new Set(['person_3']) };

  it('tells a label this tab issued from other text in brackets, and leaves links and footnotes alone', () => {
    const left = leftoversIn(
      ['Ask [person 2] and [CLIENT]; see [Table 1], [PERSON], [NAME_1], <PERSON_9>, [1], [x], [ ], [the terms](https://example.com) and <b>bold</b>.'],
      ['[PERSON_44]'],
      context,
    );
    expect(left.unresolved).toEqual(['[PERSON_44]', '[person 2]', '[CLIENT]']);
    expect(left.stale).toEqual([
      { label: '[person 2]', original: 'Dwayne Okafor', reason: 'gone' },
      { label: '[CLIENT]', original: 'Rosa Delgado-Whitfield', reason: 'gone' },
    ]);
    expect(left.others).toEqual(['[Table 1]', '[PERSON]', '[NAME_1]', '<PERSON_9>']);
  });

  it('a token the session already listed is explained when this tab issued it', () => {
    const left = leftoversIn(['[PERSON_2]'], ['[PERSON_2]'], context);
    expect(left.unresolved).toEqual(['[PERSON_2]']);
    expect(left.stale).toEqual([{ label: '[PERSON_2]', original: 'Dwayne Okafor', reason: 'gone' }]);
    expect(left.others).toEqual([]);
  });

  it('a label of another document is not named with its value; a label of the table in an unread form says so', () => {
    const left = leftoversIn(['Ask [PERSON_7] and <PERSON_3>.'], ['[PERSON_7]'], context);
    expect(left.stale).toEqual([
      // Its value is not part of the open document: nothing of it is shown.
      { label: '[PERSON_7]', original: '', reason: 'elsewhere' },
      // Lauren Byrne is in the table: the label was only written in a form restore does not read.
      { label: '<PERSON_3>', original: 'Lauren Byrne', reason: 'unread' },
    ]);
    expect(left.unresolved).toEqual(['[PERSON_7]', '<PERSON_3>']);
  });

  it('nothing known, nothing in brackets: nothing to report', () => {
    expect(leftoversIn(['plain text'], [], { ever: new Map(), documentValues: new Set(), tableForms: new Set() })).toEqual({ unresolved: [], stale: [], others: [] });
  });
});

// Found by the independent review of 0.17.0 in production (T274).
describe('the list never holds two places that overlap', () => {
  const noOverlap = (list: DetectedEntity[]) => list.every((entity, index) => index === 0 || list[index - 1].end <= entity.start);
  const roundTrip = (hook: Awaited<ReturnType<typeof redacted>>) => hook.result.current.restoreText(hook.result.current.anonymizedText).text;

  it('a mark that reaches into a found value becomes one place with it: one label, restored once', async () => {
    const hook = await redacted();
    const all = hook.result.current.entities.length;
    const at = REPORT.indexOf('Witness: Dwayne');
    act(() => hook.result.current.addManualEntity(at, at + 'Witness: Dwayne'.length, 'PERSON'));
    const list = hook.result.current.entities;
    expect(noOverlap(list)).toBe(true);
    expect(list).toHaveLength(all);
    expect(list.filter((entity) => entity.start === at).map((entity) => entity.value)).toEqual(['Witness: Dwayne Okafor']);
    // It used to read "[PERSON_n][PERSON_2]" and come back as "Witness: DwayneDwayne Okafor".
    expect(hook.result.current.anonymizedText).toMatch(/\[PERSON_1\]\. \[[A-Z0-9_]+\]\. Officer/);
    expect(roundTrip(hook)).toBe(REPORT);
  });

  it('a mark across two found values takes both; what is between them is redacted too', async () => {
    const hook = await redacted();
    const all = hook.result.current.entities.length;
    const at = REPORT.indexOf('Okafor. Officer: Lauren');
    act(() => hook.result.current.addManualEntity(at, at + 'Okafor. Officer: Lauren'.length, 'OTHER'));
    const list = hook.result.current.entities;
    expect(noOverlap(list)).toBe(true);
    expect(list).toHaveLength(all - 1);
    expect(list.some((entity) => entity.value === 'Dwayne Okafor. Officer: Lauren Byrne')).toBe(true);
    expect(hook.result.current.anonymizedText).not.toContain('Officer');
    expect(roundTrip(hook)).toBe(REPORT);
  });

  it('a mark inside a value that is redacted changes nothing and says so', async () => {
    const { screen } = await import('@testing-library/react');
    const { en } = await import('../../src/i18n/translations/en.ts');
    const hook = await redacted();
    const before = { list: hook.result.current.entities, text: hook.result.current.anonymizedText, table: hook.result.current.entries };
    const at = REPORT.indexOf('Delgado');
    act(() => hook.result.current.addManualEntity(at, at + 'Delgado'.length, 'COMPANY'));
    expect(hook.result.current.entities).toBe(before.list);
    expect(hook.result.current.anonymizedText).toBe(before.text);
    expect(hook.result.current.entries).toEqual(before.table);
    expect(screen.getByText(en.textInput.alreadyRedacted('Rosa Delgado-Whitfield'))).toBeInTheDocument();
  });

  it('a mark over part of a value that is not redacted takes its place: only what was marked is redacted', async () => {
    const hook = await redacted();
    const all = hook.result.current.entities.length;
    act(() => hook.result.current.setEntitiesExcluded(indicesOf(hook, 'Harbor PD'), true));
    const at = REPORT.indexOf('of Harbor');
    act(() => hook.result.current.addManualEntity(at, at + 'of Harbor'.length, 'OTHER'));
    const list = hook.result.current.entities;
    expect(noOverlap(list)).toBe(true);
    expect(list).toHaveLength(all);
    expect(list.some((entity) => entity.value === 'Harbor PD')).toBe(false);
    expect(hook.result.current.excludedIndices.size).toBe(0);
    expect(hook.result.current.anonymizedText).toMatch(/\[[A-Z0-9_]+\] PD\./);
    expect(roundTrip(hook)).toBe(REPORT);
  });

  it('the same words marked under another type change the type; the place stays one', async () => {
    const hook = await redacted();
    const all = hook.result.current.entities.length;
    const at = REPORT.indexOf('Harbor PD');
    act(() => hook.result.current.addManualEntity(at, at + 'Harbor PD'.length, 'PERSON'));
    const there = hook.result.current.entities.filter((entity) => entity.start === at);
    expect(there.map((entity) => entity.type)).toEqual(['PERSON']);
    expect(hook.result.current.entities).toHaveLength(all);
    expect(roundTrip(hook)).toBe(REPORT);
  });

  it('a re-run on the same text keeps the wider mark: what only the mark covered does not become readable', async () => {
    const hook = await redacted();
    const at = REPORT.indexOf('Witness: Dwayne');
    act(() => hook.result.current.addManualEntity(at, at + 'Witness: Dwayne'.length, 'PERSON'));
    const before = hook.result.current.anonymizedText;
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizing).toBe(false));
    expect(noOverlap(hook.result.current.entities)).toBe(true);
    expect(hook.result.current.anonymizedText).toBe(before);
    expect(hook.result.current.anonymizedText).not.toContain('Witness');
    expect(roundTrip(hook)).toBe(REPORT);
  });

  it('"Keep them redacted" after a value was found shorter leaves one place there, counted once', async () => {
    const hook = await redacted();
    const all = hook.result.current.entities.length;
    shorterPerson = true;
    act(() => hook.result.current.anonymize());
    await waitFor(() => expect(hook.result.current.anonymizedText).toContain('Officer: Lauren ['));
    act(() => hook.result.current.keepDroppedRedacted());
    const list = hook.result.current.entities;
    expect(noOverlap(list)).toBe(true);
    expect(list).toHaveLength(all);
    expect(list.filter((entity) => entity.value === 'Lauren Byrne')).toHaveLength(1);
    expect(hook.result.current.anonymizedText).not.toContain('Lauren');
    expect(roundTrip(hook)).toBe(REPORT);
  });
});

describe('the restore report finds a known label in any spelling', () => {
  it('labels without brackets, in another case, with another separator or broken over two lines are listed: no all-clear', async () => {
    const hook = await redacted();
    const reply = '[PERSON_1] met Person 2 and PERSON 3, person_2, PERSON-3, [PERSON_\n2], [PERSON\\_3] and [COMPANY_1].';
    const result = hook.result.current.restoreText(reply);
    expect(result.restored).toBe(2);
    for (const token of ['Person 2', 'PERSON 3', 'person_2', 'PERSON-3', '[PERSON_\n2]', '[PERSON\\_3]']) {
      expect(result.unresolved, token).toContain(token);
    }
    expect(result.others).toEqual([]);
    const said = Object.fromEntries(result.stale.map((item) => [item.label, item]));
    expect(said['Person 2']).toMatchObject({ original: 'Dwayne Okafor', reason: 'unread' });
    expect(said['PERSON-3']).toMatchObject({ original: 'Lauren Byrne', reason: 'unread' });
    expect(said['[PERSON\\_3]']).toMatchObject({ original: 'Lauren Byrne', reason: 'unread' });
    // Marked in the text where they stand.
    expect(result.segments.filter((segment) => segment.kind === 'leftover').map((segment) => segment.text)).toContain('Person 2');
  });

  it('the label of a surname is taken whole, and a number that only starts like a label is not one', async () => {
    const hook = await redacted();
    const result = hook.result.current.restoreText('Dear Person 1 last, see person 20 and PERSON_1x.');
    expect(result.unresolved).toEqual(['Person 1 last']);
    expect(result.stale[0]).toMatchObject({ original: 'Delgado-Whitfield', reason: 'unread' });
  });

  it('a table loaded from a file names its own labels too', async () => {
    const hook = await redacted();
    const table = [{ original: 'Ewa Lis', replacement: '[PERSON_1]', entity_type: 'PERSON' }, { original: 'Adam Mak', replacement: '[PERSON_2]', entity_type: 'PERSON' }];
    await act(async () => { await hook.result.current.importMapping(new File([JSON.stringify(table)], 'other_replacement-table.json')); });
    const result = hook.result.current.restoreText('[PERSON_1] wrote to Person 2.');
    expect(result.text).toBe('Ewa Lis wrote to Person 2.');
    expect(result.unresolved).toEqual(['Person 2']);
    expect(result.stale[0]).toMatchObject({ label: 'Person 2', original: 'Adam Mak', reason: 'unread' });
  });

  // The review of 0.17.1 tried 88 odd spellings; 63 passed under "No labels are left".
  it('finds a known label through other dashes, invisible characters, entities, a cut at a line end, marks around it, a plural, a file name', () => {
    const none = { ever: new Map(), documentValues: new Set<string>(), tableForms: new Set<string>() };
    const table = [{ label: '[PERSON_2]', original: 'Jan Kos' }, { label: '[COMPANY_3]', original: 'Acme Ltd' }];
    const spellings = [
      'PERSON‑2', 'PERSON–2', 'Person ２', 'PER​SON_2', 'PERSON­_2', '__PERSON_2__', '_PERSON_2_', '**PERSON 2**',
      'PERSON&nbsp;2', 'PERSON&#95;2', 'PERSON%5F2', '[PER-\nSON_2]', '[COM-\nPANY_3]', 'Persons 2', 'PERSONS_2', 'PERSON_2s',
      'Person #2', 'Person No. 2', 'PERSON 2', '`PERSON_2`', '\\[PERSON\\_2\\]',
    ];
    for (const spelling of spellings) {
      const left = leftoversIn([`Signed by ${spelling} today.`], [], { ...none, tableLabels: table });
      expect(left.unresolved, JSON.stringify(spelling)).toEqual([spelling]);
      expect(left.stale[0], JSON.stringify(spelling)).toMatchObject({ reason: 'unread', original: spelling.toUpperCase().includes('COM') ? 'Acme Ltd' : 'Jan Kos' });
    }
    // As the start of a longer name: a file name, a label of a surname the table does not hold.
    expect(leftoversIn(['see https://example.com/files/PERSON_2_file.pdf'], [], { ...none, tableLabels: table }).unresolved).toEqual(['PERSON_2']);
    expect(leftoversIn(['the PERSON_2_LAST file'], [], { ...none, tableLabels: table }).unresolved).toEqual(['PERSON_2']);
    // Not a label: another number, a word that only starts like one.
    for (const text of ['PERSON_20 and Person 21', 'PERSONAL 2', 'UNPERSON_2', 'COMPANY 30']) {
      expect(leftoversIn([text], [], { ...none, tableLabels: table }).unresolved, text).toEqual([]);
    }
  });

  it('a renamed label without brackets is found in capitals only; cut at a line end inside brackets it is found', () => {
    const none = { ever: new Map(), documentValues: new Set<string>(), tableForms: new Set<string>() };
    const table = [{ label: '[THE SELLER]', original: 'Jan Kos' }];
    expect(leftoversIn(['THE_SELLER signs. THE SELLER pays.'], [], { ...none, tableLabels: table }).unresolved).toEqual(['THE_SELLER', 'THE SELLER']);
    expect(leftoversIn(['The Seller signs and the seller pays.'], [], { ...none, tableLabels: table }).unresolved).toEqual([]);
    expect(leftoversIn(['[THE SEL-\nLER] signs.'], [], { ...none, tableLabels: table }).unresolved).toEqual(['[THE SEL-\nLER]']);
    // A document that itself says "THE SELLER" in capitals: its own words.
    expect(leftoversIn(['THE SELLER pays.'], [], { ...none, tableLabels: table, documentText: 'THE SELLER shall deliver.' }).unresolved).toEqual([]);
  });

  it('what is listed already is not reported a second time under a shorter name', () => {
    const none = { ever: new Map(), documentValues: new Set<string>(), tableForms: new Set<string>() };
    const table = [{ label: '[PERSON_1]', original: 'Jan Kos' }];
    // The session lists the unknown variant; the label inside it is not listed again.
    const left = leftoversIn(['Dear [PERSON_1_FIRST],'], ['[PERSON_1_FIRST]'], { ...none, tableLabels: table });
    expect(left.unresolved).toEqual(['[PERSON_1_FIRST]']);
  });

  it('ordinary words are left alone: a renamed label without brackets, and words the document itself holds', () => {
    const none = { ever: new Map(), documentValues: new Set<string>(), tableForms: new Set<string>() };
    const client = [{ label: '[CLIENT]', original: 'Jan Kos' }];
    expect(leftoversIn(['the client and The Client agreed'], [], { ...none, tableLabels: client }).unresolved).toEqual([]);
    // In brackets it is the label, however it was broken.
    expect(leftoversIn(['signed by [ client\n] today'], [], { ...none, tableLabels: client }).unresolved).toEqual(['[ client\n]']);
    const person = [{ label: '[PERSON_2]', original: 'Jan Kos' }];
    expect(leftoversIn(['Person 2 signs'], [], { ...none, tableLabels: person }).unresolved).toEqual(['Person 2']);
    expect(leftoversIn(['Person 2 signs'], [], { ...none, tableLabels: person, documentText: 'Form: Person 2 signs here.' }).unresolved).toEqual([]);
  });
});
