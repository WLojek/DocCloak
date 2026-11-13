/**
 * Places marked by hand, put into the list of what was found (T274).
 *
 * The list must never hold two places that overlap. It did: a selection that
 * reached into a found value ("adviser is Dr Helena" over a found "Dr Helena
 * Vasquez-Moreno") was added next to it, the text got two labels side by side,
 * the restore wrote part of the value twice, the list counted one place as two
 * and the result line said that everything found was replaced while part of
 * the selection stayed readable. Found by the independent review of 0.17.0.
 *
 * The rule: a hand mark takes the place of what it touches.
 * - It grows to the whole of every redacted place it overlaps (what is redacted
 *   stays redacted), and those places leave the list: one place, one label.
 * - A place that is not redacted and is touched by the mark leaves the list:
 *   the user has now said what they want redacted there.
 * - A mark that lies inside one redacted place changes nothing, and is
 *   reported so the caller can say so. The same range under another type
 *   changes the type.
 */
import type { DetectedEntity } from '@doccloak/core';

export interface HandMarkResult {
  /** The list with the marks in it, sorted by position; the same array when nothing changed. */
  entities: DetectedEntity[];
  /** Marks that changed nothing: each lies inside a place that is redacted already. */
  inside: Array<{ mark: DetectedEntity; holder: DetectedEntity }>;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && a.end > b.start;

export function addHandMarks(
  text: string,
  existing: DetectedEntity[],
  isKept: (entity: DetectedEntity) => boolean,
  marks: DetectedEntity[],
): HandMarkResult {
  let list = existing;
  const inside: HandMarkResult['inside'] = [];
  for (const mark of marks) {
    if (mark.end <= mark.start) continue;
    let merged = mark;
    let touched = list.filter((entity) => overlaps(entity, merged));
    const redacted = touched.filter((entity) => !isKept(entity));
    if (redacted.length === 1 && redacted[0].start <= mark.start && mark.end <= redacted[0].end) {
      const holder = redacted[0];
      const sameRange = holder.start === mark.start && holder.end === mark.end;
      if (!sameRange || holder.type === mark.type) {
        inside.push({ mark, holder });
        continue;
      }
    }
    // Grow to the redacted places it touches, until nothing new is touched.
    for (;;) {
      const start = Math.min(merged.start, ...touched.filter((entity) => !isKept(entity)).map((entity) => entity.start));
      const end = Math.max(merged.end, ...touched.filter((entity) => !isKept(entity)).map((entity) => entity.end));
      if (start === merged.start && end === merged.end) break;
      merged = { ...merged, start, end, value: text.slice(start, end) };
      touched = list.filter((entity) => overlaps(entity, merged));
    }
    const gone = new Set(touched);
    list = [...list.filter((entity) => !gone.has(entity)), merged];
  }
  if (list === existing) return { entities: existing, inside };
  return { entities: [...list].sort((a, b) => a.start - b.start), inside };
}
