import { describe, it, expect, beforeEach } from 'vitest';
import type { DetectedEntity } from '@doccloak/core';
import {
  findDictionaryMatches,
  mergeDictionaryEntities,
  filterIgnoredEntities,
  loadDictionary,
  saveDictionary,
  loadIgnoreList,
  saveIgnoreList,
} from '../../src/ui/dictionary.ts';

const spans = (entities: DetectedEntity[]) => entities.map((e) => [e.start, e.end, e.value]);

describe('findDictionaryMatches', () => {
  it('finds every occurrence, case-insensitive by default', () => {
    const text = 'Acme hired acme. ACME won.';
    const result = findDictionaryMatches(text, [{ word: 'acme', caseSensitive: false }]);
    expect(spans(result)).toEqual([
      [0, 4, 'Acme'],
      [11, 15, 'acme'],
      [17, 21, 'ACME'],
    ]);
    expect(result.every((e) => e.detector === 'dictionary' && e.type === 'OTHER')).toBe(true);
  });

  it('respects case sensitivity when enabled', () => {
    const text = 'Acme hired acme. ACME won.';
    const result = findDictionaryMatches(text, [{ word: 'Acme', caseSensitive: true }]);
    expect(spans(result)).toEqual([[0, 4, 'Acme']]);
  });

  it('matches whole words only', () => {
    const text = 'Ann met Anna and Joanna.';
    const result = findDictionaryMatches(text, [{ word: 'Ann', caseSensitive: false }]);
    expect(spans(result)).toEqual([[0, 3, 'Ann']]);
  });

  it('handles multi-word phrases and regex special characters', () => {
    const text = 'The Project Falcon (v2.0) launch. project falcon files.';
    const result = findDictionaryMatches(text, [
      { word: 'Project Falcon', caseSensitive: false },
      { word: '(v2.0)', caseSensitive: false },
    ]);
    expect(spans(result)).toEqual(expect.arrayContaining([
      [4, 18, 'Project Falcon'],
      [19, 25, '(v2.0)'],
      [34, 48, 'project falcon'],
    ]));
    expect(result).toHaveLength(3);
  });

  it('matches words with diacritics case-insensitively', () => {
    const text = 'Firma Żółć oraz żółć sp. z o.o.';
    const result = findDictionaryMatches(text, [{ word: 'żółć', caseSensitive: false }]);
    expect(result).toHaveLength(2);
  });
});

describe('mergeDictionaryEntities', () => {
  const detected: DetectedEntity[] = [
    { type: 'PERSON', value: 'Jan Kowalski', start: 0, end: 12, confidence: 0.9, detector: 'ml' },
  ];

  it('adds dictionary matches alongside detected entities, sorted by position', () => {
    const text = 'Jan Kowalski joined Acme today';
    const merged = mergeDictionaryEntities(text, detected, [{ word: 'Acme', caseSensitive: false }]);
    expect(spans(merged)).toEqual([
      [0, 12, 'Jan Kowalski'],
      [20, 24, 'Acme'],
    ]);
  });

  it('lets detected entities win overlaps', () => {
    const text = 'Jan Kowalski joined Acme today';
    const merged = mergeDictionaryEntities(text, detected, [{ word: 'Kowalski', caseSensitive: false }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].detector).toBe('ml');
  });

  it('prefers the longer dictionary match when entries overlap', () => {
    const text = 'See Project Falcon notes';
    const merged = mergeDictionaryEntities(text, [], [
      { word: 'Falcon', caseSensitive: false },
      { word: 'Project Falcon', caseSensitive: false },
    ]);
    expect(spans(merged)).toEqual([[4, 18, 'Project Falcon']]);
  });

  it('returns detected entities untouched for an empty dictionary', () => {
    expect(mergeDictionaryEntities('Jan Kowalski', detected, [])).toBe(detected);
  });
});

describe('filterIgnoredEntities', () => {
  const text = 'Jan Sokół from Sokół Sp. z o.o. met Anna Nowak in Warszawa; sokół flew.';
  const detected: DetectedEntity[] = [
    { type: 'PERSON', value: 'Jan Sokół', start: 0, end: 9, confidence: 0.9, detector: 'ml' },
    { type: 'COMPANY', value: 'Sokół Sp. z o.o.', start: 15, end: 31, confidence: 0.8, detector: 'ml' },
    { type: 'PERSON', value: 'Anna Nowak', start: 36, end: 46, confidence: 0.9, detector: 'ml' },
    { type: 'ADDRESS', value: 'Warszawa', start: 50, end: 58, confidence: 0.7, detector: 'ml' },
    { type: 'OTHER', value: 'sokół', start: 60, end: 65, confidence: 1.0, detector: 'dictionary' },
  ];

  it('carves ignored words out of entities, case-insensitive by default', () => {
    const kept = filterIgnoredEntities(text, detected, [
      { word: 'Warszawa', caseSensitive: false },
      { word: 'Sokół', caseSensitive: false },
    ]);
    // 'Warszawa' and the bare dictionary 'sokół' hit disappear entirely;
    // 'Jan Sokół' shrinks to 'Jan' and the company keeps its legal suffix,
    // so the ignored word stays visible while the rest stays protected
    expect(spans(kept)).toEqual([
      [0, 3, 'Jan'],
      [21, 31, 'Sp. z o.o.'],
      [36, 46, 'Anna Nowak'],
    ]);
    expect(kept[0]).toMatchObject({ type: 'PERSON', detector: 'ml', confidence: 0.9 });
  });

  it('produces "[PERSON_1] Smith" style output for a surname on the list', () => {
    const t = 'John Smith went to the store';
    const kept = filterIgnoredEntities(t, [
      { type: 'PERSON', value: 'John Smith', start: 0, end: 10, confidence: 0.9, detector: 'ml' },
    ], [{ word: 'Smith', caseSensitive: false }]);
    expect(spans(kept)).toEqual([[0, 4, 'John']]);
  });

  it('splits an entity around an ignored word in the middle', () => {
    const t = 'Anna Maria Nowak';
    const kept = filterIgnoredEntities(t, [
      { type: 'PERSON', value: 'Anna Maria Nowak', start: 0, end: 16, confidence: 0.9, detector: 'ml' },
    ], [{ word: 'Maria', caseSensitive: false }]);
    expect(spans(kept)).toEqual([[0, 4, 'Anna'], [11, 16, 'Nowak']]);
  });

  it('removes a longer entity entirely when the full phrase is ignored', () => {
    const kept = filterIgnoredEntities(text, detected, [{ word: 'Sokół Sp. z o.o.', caseSensitive: false }]);
    expect(kept.map((e) => e.value)).not.toContain('Sokół Sp. z o.o.');
    expect(kept).toHaveLength(4);
  });

  it('respects case sensitivity', () => {
    const kept = filterIgnoredEntities(text, detected, [{ word: 'Sokół', caseSensitive: true }]);
    // Only the capitalised occurrences match; the lowercase dictionary hit stays
    expect(kept.map((e) => e.value)).toContain('sokół');
    expect(kept.map((e) => e.value)).toContain('Jan');
  });

  it('matches whole words only', () => {
    const kept = filterIgnoredEntities('Ann met Anna.', [
      { type: 'PERSON', value: 'Anna', start: 8, end: 12, confidence: 0.9, detector: 'ml' },
    ], [{ word: 'Ann', caseSensitive: false }]);
    expect(kept).toHaveLength(1);
  });

  it('returns the same array when nothing applies', () => {
    expect(filterIgnoredEntities(text, detected, [])).toBe(detected);
    expect(filterIgnoredEntities(text, detected, [{ word: 'Kraków', caseSensitive: false }])).toEqual(detected);
  });
});

describe('dictionary persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips entries through localStorage', () => {
    saveDictionary([{ word: 'Acme', caseSensitive: true }]);
    expect(loadDictionary()).toEqual([{ word: 'Acme', caseSensitive: true }]);
  });

  it('keeps the ignore list in its own storage slot', () => {
    saveDictionary([{ word: 'Acme', caseSensitive: false }]);
    saveIgnoreList([{ word: 'Warszawa', caseSensitive: false }]);
    expect(loadDictionary()).toEqual([{ word: 'Acme', caseSensitive: false }]);
    expect(loadIgnoreList()).toEqual([{ word: 'Warszawa', caseSensitive: false }]);
    expect(localStorage.getItem('doccloak-ignore-list')).not.toBeNull();
  });

  it('drops malformed stored data instead of crashing', () => {
    localStorage.setItem('doccloak-dictionary', '{"not":"an array"}');
    expect(loadDictionary()).toEqual([]);
    localStorage.setItem('doccloak-dictionary', 'not json');
    expect(loadDictionary()).toEqual([]);
    localStorage.setItem('doccloak-dictionary', JSON.stringify([{ word: '  ' , caseSensitive: false }, { word: 'ok', caseSensitive: false }, 5]));
    expect(loadDictionary()).toEqual([{ word: 'ok', caseSensitive: false }]);
  });
});
