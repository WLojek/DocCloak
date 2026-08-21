import { describe, it, expect, beforeEach } from 'vitest';
import type { DetectedEntity } from '@doccloak/core';
import {
  findDictionaryMatches,
  mergeDictionaryEntities,
  loadDictionary,
  saveDictionary,
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

describe('dictionary persistence', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips entries through localStorage', () => {
    saveDictionary([{ word: 'Acme', caseSensitive: true }]);
    expect(loadDictionary()).toEqual([{ word: 'Acme', caseSensitive: true }]);
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
