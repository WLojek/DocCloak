/**
 * Where the places that were found but are NOT redacted stand in the protected
 * text (T269). The result panel marks them, so what stays readable is seen in
 * the text that leaves the page and not only counted above it.
 *
 * The protected text is the source with every redacted place replaced by its
 * label, so a readable place moves by the length changes of the replacements
 * before it. The replacements are walked the way the session makes them (end
 * to start, a later one never reaching into an earlier one). Every range is
 * checked against the text: one that does not hold the place's own characters
 * is dropped, so a mismatch can only cost a mark, never put one in the wrong
 * spot.
 */
import type { DetectedEntity, ReplacementEntry } from '@doccloak/core';

export interface TextRange {
  start: number;
  end: number;
}

export function keptRangesInOutput(
  text: string,
  entities: DetectedEntity[],
  excluded: ReadonlySet<number>,
  entries: ReplacementEntry[],
  output: string,
): TextRange[] {
  if (excluded.size === 0 || output.length === 0) return [];
  const labelOf = new Map(entries.map((entry) => [entry.original, entry.replacement]));
  const replaced: Array<{ start: number; end: number; delta: number }> = [];
  let minStart = text.length;
  const redacted = entities.filter((_, index) => !excluded.has(index)).sort((a, b) => b.start - a.start);
  for (const entity of redacted) {
    const end = Math.min(entity.end, minStart);
    if (end <= entity.start) continue;
    const label = labelOf.get(entity.value);
    if (label === undefined) return [];
    replaced.push({ start: entity.start, end, delta: label.length - (end - entity.start) });
    minStart = entity.start;
  }
  replaced.reverse();

  const kept = entities.filter((_, index) => excluded.has(index)).sort((a, b) => a.start - b.start);
  const ranges: TextRange[] = [];
  let shift = 0;
  let next = 0;
  for (const entity of kept) {
    while (next < replaced.length && replaced[next].end <= entity.start) shift += replaced[next++].delta;
    // A replacement that reaches into this place took part of it: nothing whole to mark.
    if (next < replaced.length && replaced[next].start < entity.end) continue;
    const start = entity.start + shift;
    const end = entity.end + shift;
    if (output.slice(start, end) !== text.slice(entity.start, entity.end)) continue;
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  return ranges;
}
