/**
 * What is still in a text after the restore (T269). The session reports the
 * tokens that look like its numbered labels. Two more kinds matter to the
 * person reading the result:
 *
 * - a label this tab issued earlier that is not in the table now (the value
 *   was un-redacted, or its label was renamed or taken back, after the text
 *   was copied): it is a label, the cause is known and so is the value;
 * - any other text in brackets ("[PERSON]", "[NAME_1]", "[Table 1]"): it may
 *   or may not be a label, so it is listed without a verdict and no all-clear
 *   is given over it.
 */
import { canonicalPlaceholderForm } from '@doccloak/core';

/** A label issued in this tab, and the value it stood for. */
export interface KnownLabel {
  label: string;
  original: string;
  /**
   * Why a label left in a reply was not restored (set by leftoversIn):
   * - 'gone': it stood for a value of the open document that is not in the table now;
   * - 'elsewhere': it belongs to another document or an earlier version of the text (the value is
   *   not named: it is not part of what is on screen);
   * - 'unread': its value is in the table, but the label is written in a form restore does not read;
   * - 'two': the label stood for another value earlier in this tab than it does now (`original` is
   *   the value now); it is not restored, whatever the reply meant;
   * - 'text': the token stands in the open document itself as text (a column name, a template field);
   * - 'textlabel': a label of the table that the open document also holds as text; it is not restored.
   */
  reason?: 'gone' | 'elsewhere' | 'unread' | 'two' | 'text' | 'textlabel';
}

/** What decides the reason: the values of the open document and the labels in its table now. */
export interface RestoreContext {
  /** Labels issued in this tab, by comparison form. */
  ever: ReadonlyMap<string, KnownLabel>;
  /** Every value found in the open document, redacted or not. */
  documentValues: ReadonlySet<string>;
  /** Comparison forms of the labels in the table now. */
  tableForms: ReadonlySet<string>;
  /** Labels the restore refused (reasons 'two' and 'textlabel'), as written in the text. */
  refused?: KnownLabel[];
  /** The source text of the open document: a token that stands in it is the document's own text. */
  documentText?: string;
  /**
   * The labels of the table that did the restoring, with their values (the document's own table or
   * one loaded from a file). A label of it that is still in the text in a spelling restore does not
   * read ("Person 2", "PERSON-3", "[PERSON_" broken over two lines) is found by these.
   */
  tableLabels?: KnownLabel[];
}

export interface Leftovers {
  /** Tokens that are labels and were not restored (the session's list plus the stale ones). */
  unresolved: string[];
  /** Of those, the labels this tab once issued: what they stood for. */
  stale: KnownLabel[];
  /** Other bracketed text that remains; not known to be a label. */
  others: string[];
}

/**
 * Square brackets with anything short inside; double angle brackets (the
 * legacy label form); single angle or curly brackets only around text shaped
 * like a label, so HTML tags and code are left alone.
 */
const BRACKETED = /\[[^[\]\n]{1,60}\]|<<[^<>\n]{1,60}>>|[<{][A-Z][A-Z0-9_ -]{1,40}[>}]/g;

/** Bracketed text that is certainly not a label: a footnote number, a checkbox, an ellipsis. */
const NOT_A_LABEL = /^\[(\s*|\d{1,3}|x|X|\.\.\.|…)\]$/;

function bracketedIn(piece: string): string[] {
  const found: string[] = [];
  for (const match of piece.matchAll(BRACKETED)) {
    const token = match[0];
    if (NOT_A_LABEL.test(token)) continue;
    // "[text](url)": a markdown link, not a label.
    if (token.startsWith('[') && piece[match.index + token.length] === '(') continue;
    found.push(token);
  }
  return found;
}

/** Regex source of a literal. */
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Dashes an editor or an assistant puts where a hyphen stood.
const DASHES = '\\-\\u2010-\\u2015\\u2212';
// Characters that take no room: soft hyphen, zero-width space and joiners, word joiner, BOM.
const INVISIBLE = '[\\u00AD\\u200B-\\u200D\\u2060\\uFEFF]';
// Inside one word: invisible characters, or the word cut at a line end ("PER-" / "SON").
const INSIDE_WORD = `(?:${INVISIBLE}|[${DASHES}]?\\r?\\n[ \\t]*)*`;
// Between the words of a label: space, underscore, dot, dash, a markdown or escape sign, the same
// as an HTML entity or URL-encoded, "#", "No.".
const BETWEEN = `(?:[\\s_.\\\\*#${DASHES}]|${INVISIBLE}|&nbsp;|&#95;|&#x5f;|&lowbar;|%5f|%20|no\\.?|nr\\.?)`;
// Around a label: brackets (escaped or not), markdown emphasis or code marks.
const OPEN = '(?:\\\\?[\\[<{]{1,2}[\\s*_~`]{0,3}|[*_~`]{1,3})?';
const CLOSE = '(?:[\\s*_~`]{0,3}\\\\?[\\]>}]{1,2}|[*_~`]{1,3})?';

const isNumber = (word: string) => /^\p{N}+$/u.test(word);

/** One word of a label, letter by letter: a digit also in its full-width form. */
function looseWord(word: string): string {
  return [...word]
    .map((char) => (/[0-9]/.test(char) ? `[${char}${String.fromCharCode(0xff10 + Number(char))}]` : literal(char)))
    .join(INSIDE_WORD);
}

/**
 * A known label in any spelling: its words in any case, with other separators between them (a
 * space, any dash, a dot, an escaped or encoded underscore, a line break, "#", "No."), cut at a
 * line end, with invisible characters or a full-width digit inside, in the plural, with or without
 * brackets or markdown marks around it, also as the start of a longer name ("PERSON_5_file.pdf").
 * Restore reads only some of these ("[person 2]", "PERSON_2") and leaves the rest in the text on
 * purpose: "Person 2" can be prose. The report must still not say that no label is left over them
 * (it did: found by the independent reviews of 0.17.0 and 0.17.1).
 *
 * Without brackets a label with no number in it is looked for only in capitals ("THE_SELLER"):
 * "the seller" for a label renamed to [THE SELLER] is ordinary text.
 */
function looseLabel(form: string): { pattern: RegExp; numbered: boolean } | null {
  const words = form.split('_').filter((word) => word.length > 0);
  if (words.length === 0) return null;
  const numbered = words.some(isNumber);
  let body = '';
  words.forEach((word, i) => {
    if (i > 0) {
      // Between two words at least one separator; a number may follow its word directly ("PERSON2").
      const close = isNumber(word) || isNumber(words[i - 1]);
      body += `${BETWEEN}${close ? '{0,6}' : '{1,6}'}`;
    }
    // "Persons 2", "PERSON_2s".
    body += `${looseWord(word)}s?`;
  });
  return { pattern: new RegExp(`(?<![\\p{L}\\p{N}])${OPEN}${body}${CLOSE}(?![\\p{L}\\p{N}])`, 'giu'), numbered };
}

/**
 * @param pieces the parts of the text that the restore left as they were
 * @param unresolved the session's own list of label-like tokens it could not restore
 * @param context what this tab knows about its labels; `ever` is empty when a table from a file is in use
 */
export function leftoversIn(pieces: string[], unresolved: string[], context: RestoreContext): Leftovers {
  const { ever, documentValues, tableForms } = context;
  const listed = [...unresolved];
  const seen = new Set(listed);
  const stale: KnownLabel[] = [];
  const others: string[] = [];
  const staleSeen = new Set<string>();
  // A refused label can stand in the text in more than one spelling ("PERSON_1" inside
  // "{PERSON_1}"): every spelling of it carries the reason it was refused for.
  const refusedByForm = new Map<string, KnownLabel>();
  for (const item of context.refused ?? []) {
    const form = canonicalPlaceholderForm(item.label);
    if (form !== null && !refusedByForm.has(form)) refusedByForm.set(form, item);
    if (staleSeen.has(item.label)) continue;
    staleSeen.add(item.label);
    stale.push(item);
    if (!seen.has(item.label)) { seen.add(item.label); listed.push(item.label); }
  }
  // The table that restored, by comparison form: its own labels are known with their values also
  // when the table came from a file (this tab then knows nothing else about them).
  const tableByForm = new Map<string, KnownLabel>();
  for (const item of context.tableLabels ?? []) {
    const form = canonicalPlaceholderForm(item.label);
    if (form !== null && !tableByForm.has(form)) tableByForm.set(form, item);
  }
  const noteStale = (token: string, asForm?: string): boolean => {
    const form = asForm ?? canonicalPlaceholderForm(token);
    const known = form === null ? undefined : ever.get(form);
    if (staleSeen.has(token)) return true;
    const refusedAs = form === null ? undefined : refusedByForm.get(form);
    if (refusedAs) {
      staleSeen.add(token);
      stale.push({ ...refusedAs, label: token });
      return true;
    }
    const inTable = form === null ? undefined : tableByForm.get(form);
    if (!known && inTable) {
      staleSeen.add(token);
      stale.push({ label: token, original: inTable.original, reason: 'unread' });
      return true;
    }
    if (!known) return false;
    if (!staleSeen.has(token)) {
      staleSeen.add(token);
      const reason = form !== null && tableForms.has(form) ? 'unread' : documentValues.has(known.original) ? 'gone' : 'elsewhere';
      stale.push({ label: token, original: reason === 'elsewhere' ? '' : known.original, reason });
    }
    return true;
  };
  for (const token of unresolved) {
    if (noteStale(token)) continue;
    // Not a label of this tab, but text the document itself holds: the cause is not the assistant.
    if (context.documentText && context.documentText.includes(token) && !staleSeen.has(token)) {
      staleSeen.add(token);
      stale.push({ label: token, original: '', reason: 'text' });
    }
  }
  for (const piece of pieces) {
    for (const token of bracketedIn(piece)) {
      if (seen.has(token)) continue;
      seen.add(token);
      if (noteStale(token)) listed.push(token);
      else others.push(token);
    }
  }
  // Known labels in a spelling nothing above reads: without brackets ("Person 2", "PERSON-3"),
  // cut at a line end, with an escaped underscore, inside a file name. Each is a label that stayed.
  // The pieces are searched as one text; the separator is a character no pattern takes.
  const joined = pieces.join('\u0000');
  // What is listed already keeps its place: "[PERSON_1_FIRST]" is not also reported as "[PERSON_1".
  const claimed: Array<{ from: number; to: number; token: string }> = [];
  for (const token of seen) {
    if (token.length === 0) continue;
    for (let at = joined.indexOf(token); at !== -1; at = joined.indexOf(token, at + token.length)) {
      claimed.push({ from: at, to: at + token.length, token });
    }
  }
  // The longest label first: "Person 2 last" is the label of the surname, not "Person 2" and a word.
  const forms = [...new Set<string>([...tableByForm.keys(), ...tableForms, ...ever.keys()])].sort((a, b) => b.length - a.length);
  for (const form of forms) {
    const loose = looseLabel(form);
    if (loose === null) continue;
    for (const match of joined.matchAll(loose.pattern)) {
      const token = match[0];
      const from = match.index;
      const to = from + token.length;
      const bracketed = /^\\?[[<{]/.test(token) && /[\]>}]$/.test(token);
      // No number and no brackets: only in capitals, and not a short word.
      if (!loose.numbered && !bracketed && (/\p{Ll}/u.test(token) || [...token].filter((char) => /\p{L}/u.test(char)).length < 4)) continue;
      const over = claimed.filter((range) => from < range.to && to > range.from);
      // Inside or across something listed as a label: left to that entry. Text listed only as
      // "other text in brackets" gives way: it is known to be a label now.
      if (over.some((range) => !others.includes(range.token))) continue;
      for (const range of over) {
        const at = others.indexOf(range.token);
        if (at !== -1) others.splice(at, 1);
      }
      claimed.push({ from, to, token });
      if (seen.has(token) && listed.includes(token)) continue;
      // The document's own words ("Person 2" in a form it holds itself) are not the assistant's.
      if (!bracketed && context.documentText && context.documentText.includes(token)) continue;
      if (!noteStale(token, form)) continue;
      seen.add(token);
      if (!listed.includes(token)) listed.push(token);
      const listedAt = others.indexOf(token);
      if (listedAt !== -1) others.splice(listedAt, 1);
    }
  }
  return { unresolved: listed, stale, others };
}
