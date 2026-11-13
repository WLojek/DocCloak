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
  const noteStale = (token: string): boolean => {
    const form = canonicalPlaceholderForm(token);
    const known = form === null ? undefined : ever.get(form);
    if (staleSeen.has(token)) return true;
    const refusedAs = form === null ? undefined : refusedByForm.get(form);
    if (refusedAs) {
      staleSeen.add(token);
      stale.push({ ...refusedAs, label: token });
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
  return { unresolved: listed, stale, others };
}
