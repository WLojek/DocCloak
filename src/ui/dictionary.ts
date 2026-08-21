// Custom dictionary: user-provided words and phrases that must always be
// redacted, everywhere they appear in the text. Matching runs locally after
// ML/regex detection and merges into the same entity list, so dictionary
// hits behave exactly like detected entities (labels, toggling, export).
import type { DetectedEntity } from '@doccloak/core';

export interface DictionaryEntry {
  word: string;
  caseSensitive: boolean;
}

const STORAGE_KEY = 'doccloak-dictionary';

export function loadDictionary(): DictionaryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

export function saveDictionary(entries: DictionaryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Private browsing / storage denied: the dictionary still works for the
    // current session, it just does not persist.
  }
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Find every occurrence of every dictionary entry in the text.
 * Matches are whole-word: an entry whose edge is a letter or digit will not
 * match inside a longer word ("Ann" does not match "Anna"), while entries
 * with non-word edges (e.g. "C++") skip that boundary requirement.
 */
export function findDictionaryMatches(text: string, entries: DictionaryEntry[]): DetectedEntity[] {
  const matches: DetectedEntity[] = [];
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
      matches.push({
        type: 'OTHER',
        value: text.slice(start, end),
        start,
        end,
        confidence: 1.0,
        detector: 'dictionary',
      });
    }
  }
  return matches;
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
