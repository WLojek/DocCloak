// Custom dictionary and ignore list: two user-provided word lists that pull
// in opposite directions.
// - Dictionary words must always be redacted, everywhere they appear. Matching
//   runs locally after ML/regex detection and merges into the same entity
//   list, so dictionary hits behave exactly like detected entities (labels,
//   toggling, export).
// - Ignore-list words are never anonymized: any detected entity that falls
//   inside an ignore match is dropped before the user sees it.
// Both lists share the same whole-word matcher and persistence shape.
import type { DetectedEntity } from '@doccloak/core';

export interface DictionaryEntry {
  word: string;
  caseSensitive: boolean;
}

const DICTIONARY_KEY = 'doccloak-dictionary';
const IGNORE_LIST_KEY = 'doccloak-ignore-list';

function loadEntries(key: string): DictionaryEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DictionaryEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as DictionaryEntry).word === 'string' &&
        (e as DictionaryEntry).word.trim().length > 0 &&
        typeof (e as DictionaryEntry).caseSensitive === 'boolean',
    );
  } catch {
    return [];
  }
}

function saveEntries(key: string, entries: DictionaryEntry[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(entries));
  } catch {
    // Private browsing / storage denied: the list still works for the
    // current session, it just does not persist.
  }
}

export function loadDictionary(): DictionaryEntry[] {
  return loadEntries(DICTIONARY_KEY);
}

export function saveDictionary(entries: DictionaryEntry[]): void {
  saveEntries(DICTIONARY_KEY, entries);
}

export function loadIgnoreList(): DictionaryEntry[] {
  return loadEntries(IGNORE_LIST_KEY);
}

export function saveIgnoreList(entries: DictionaryEntry[]): void {
  saveEntries(IGNORE_LIST_KEY, entries);
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Find every whole-word occurrence of every entry in the text, as spans.
 * An entry whose edge is a letter or digit will not match inside a longer
 * word ("Ann" does not match "Anna"), while entries with non-word edges
 * (e.g. "C++") skip that boundary requirement.
 */
function findWordSpans(text: string, entries: DictionaryEntry[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const entry of entries) {
    const word = entry.word.trim();
    if (!word) continue;
    const pattern = new RegExp(word.replace(REGEX_SPECIALS, '\\$&'), entry.caseSensitive ? 'g' : 'gi');
    for (const m of text.matchAll(pattern)) {
      const start = m.index;
      const end = start + m[0].length;
      const startOk = !WORD_CHAR.test(word[0]) || start === 0 || !WORD_CHAR.test(text[start - 1]);
      const endOk = !WORD_CHAR.test(word[word.length - 1]) || end === text.length || !WORD_CHAR.test(text[end]);
      if (!startOk || !endOk) continue;
      spans.push([start, end]);
    }
  }
  return spans;
}

/** Find every occurrence of every dictionary entry in the text as entities. */
export function findDictionaryMatches(text: string, entries: DictionaryEntry[]): DetectedEntity[] {
  return findWordSpans(text, entries).map(([start, end]) => ({
    type: 'OTHER',
    value: text.slice(start, end),
    start,
    end,
    confidence: 1.0,
    detector: 'dictionary',
  }));
}

const EDGE_WHITESPACE = /^\s+|\s+$/g;

/**
 * Cut every ignore-list match out of the detected entities. An ignored word
 * is never anonymized, so it is carved out of any entity that covers it and
 * whatever remains stays protected: with "Smith" ignored, a detected
 * "John Smith" becomes an entity for "John" alone, so the output reads
 * "[PERSON_1] Smith" rather than leaking the first name. Entities fully
 * covered by a match disappear; remainders keep the entity's type, detector
 * and confidence, with edge whitespace trimmed and empty pieces dropped.
 */
export function filterIgnoredEntities(
  text: string,
  entities: DetectedEntity[],
  ignore: DictionaryEntry[],
): DetectedEntity[] {
  if (ignore.length === 0 || entities.length === 0) return entities;
  const spans = findWordSpans(text, ignore).sort((a, b) => a[0] - b[0]);
  if (spans.length === 0) return entities;

  const result: DetectedEntity[] = [];
  for (const entity of entities) {
    const hits = spans.filter(([s, e]) => s < entity.end && e > entity.start);
    if (hits.length === 0) {
      result.push(entity);
      continue;
    }
    // Walk the entity left to right, emitting the gaps between ignored spans
    let cursor = entity.start;
    const pieces: Array<[number, number]> = [];
    for (const [s, e] of hits) {
      if (s > cursor) pieces.push([cursor, s]);
      cursor = Math.max(cursor, e);
    }
    if (cursor < entity.end) pieces.push([cursor, entity.end]);
    for (const [rawStart, rawEnd] of pieces) {
      const raw = text.slice(rawStart, rawEnd);
      const trimmed = raw.replace(EDGE_WHITESPACE, '');
      if (!trimmed) continue;
      const start = rawStart + raw.indexOf(trimmed);
      result.push({ ...entity, value: trimmed, start, end: start + trimmed.length });
    }
  }
  return result;
}

/**
 * Merge dictionary matches into detected entities. Detected entities win any
 * overlap; among dictionary matches, longer matches win over shorter ones so
 * a phrase entry beats a single-word entry contained in it.
 */
export function mergeDictionaryEntities(
  text: string,
  detected: DetectedEntity[],
  entries: DictionaryEntry[],
): DetectedEntity[] {
  if (entries.length === 0) return detected;
  const dictMatches = findDictionaryMatches(text, entries)
    .sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const taken: Array<[number, number]> = detected.map((e) => [e.start, e.end]);
  const merged = [...detected];
  for (const m of dictMatches) {
    if (taken.some(([s, e]) => m.start < e && m.end > s)) continue;
    taken.push([m.start, m.end]);
    merged.push(m);
  }
  return merged.sort((a, b) => a.start - b.start);
}
