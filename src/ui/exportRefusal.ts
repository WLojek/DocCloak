/**
 * What a refused export found (T288). The writer of a PDF checks its own output and refuses to
 * hand over a file in which a replaced value can still be found (PdfVerifyError). The message
 * used to stop at "found a trace of the original data": the user could not tell which value, and
 * so had no way out. The values are the user's own, already shown in the list on this page.
 */

/** Checks of the writer that look for a replaced value; the others are about pages and hidden areas. */
const VALUE_PASSES = new Set(['own-extractor', 'oracle', 'stream-bytes', 'string-bytes']);

/** At most this many values are named; a long value is shortened. */
const MAX_VALUES = 5;
const MAX_VALUE_LENGTH = 40;

/** The values a PdfVerifyError found again in the output, each once, in the order found. */
export function traceValues(err: unknown): string[] {
  if (typeof err !== 'object' || err === null || (err as { name?: unknown }).name !== 'PdfVerifyError') return [];
  const findings = (err as { findings?: unknown }).findings;
  if (!Array.isArray(findings)) return [];
  const values: string[] = [];
  for (const finding of findings) {
    if (typeof finding !== 'object' || finding === null) continue;
    const { pass, needle } = finding as { pass?: unknown; needle?: unknown };
    if (typeof pass !== 'string' || !VALUE_PASSES.has(pass) || typeof needle !== 'string') continue;
    const value = needle.replace(/\s+/g, ' ').trim();
    if (value.length === 0) continue;
    const shown = value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH - 3)}...` : value;
    if (!values.includes(shown)) values.push(shown);
  }
  return values.slice(0, MAX_VALUES);
}

/** The values in quotes, as one list for a sentence. */
export function quotedValues(values: string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}
