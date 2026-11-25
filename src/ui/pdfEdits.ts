/**
 * Hand edits of a PDF, the pure part (T284, WLojek/DocCloak.Core#6).
 *
 * The user leaves pages out and hides areas by hand; Core applies the full set
 * each time (`applyPdfEdits`) and gives back the edited text and how it maps
 * onto the text before (`kept`). This file holds what the page view and the
 * hook need around that, without the DOM and without loading Core's PDF chunk:
 *
 * - the set itself: toggle a page, add / remove / replace an area, compare,
 *   count, and the guard that never lets every page be left out (Core throws a
 *   RangeError for that set);
 * - what was found before the edit, moved to its place in the edited text
 *   (`remapAfterEdit`).
 *
 * '@doccloak/core/pdf' is imported for its types only: the chunk (pdf.js,
 * pdf-lib, fontkit) is loaded with a dynamic import by the caller, who hands
 * `mapKeptRange` in.
 */
import type { DetectedEntity } from '@doccloak/core';
import type { KeptStretch, PdfEdits, PdfRegion, Rect } from '@doccloak/core/pdf';

/* ------------------------------------------------------------------ */
/* The set of edits                                                     */
/* ------------------------------------------------------------------ */

/** Pages left out, sorted, each once. */
export function removedPagesOf(edits: PdfEdits | null | undefined): number[] {
  return [...new Set(edits?.removedPages ?? [])].sort((a, b) => a - b);
}

/** Hidden areas, in the order they were made. */
export function regionsOf(edits: PdfEdits | null | undefined): PdfRegion[] {
  return edits?.regions ?? [];
}

/** True when the edits change nothing. */
export function isEmptyEdits(edits: PdfEdits | null | undefined): boolean {
  return removedPagesOf(edits).length === 0 && regionsOf(edits).length === 0;
}

const regionKey = (r: PdfRegion): string => `${r.page}:${r.rect.x0}:${r.rect.y0}:${r.rect.x1}:${r.rect.y1}`;

/** True when two sets leave the same pages out and hide the same areas (the order does not count). */
export function sameEdits(a: PdfEdits | null | undefined, b: PdfEdits | null | undefined): boolean {
  const pagesA = removedPagesOf(a);
  const pagesB = removedPagesOf(b);
  if (pagesA.length !== pagesB.length || pagesA.some((p, i) => p !== pagesB[i])) return false;
  const regionsA = regionsOf(a).map(regionKey).sort();
  const regionsB = regionsOf(b).map(regionKey).sort();
  return regionsA.length === regionsB.length && regionsA.every((k, i) => k === regionsB[i]);
}

export function isPageRemoved(edits: PdfEdits | null | undefined, page: number): boolean {
  return (edits?.removedPages ?? []).includes(page);
}

/** True when the set leaves at least one of `pageCount` pages in (and names no page that does not exist). */
export function keepsAPage(edits: PdfEdits | null | undefined, pageCount: number): boolean {
  const removed = removedPagesOf(edits);
  if (removed.some((p) => !Number.isInteger(p) || p < 0 || p >= pageCount)) return false;
  return pageCount === 0 ? removed.length === 0 : removed.length < pageCount;
}

/**
 * True when `page` can be left out: it exists, it is still in, and another page stays. The last
 * page of a file can never be left out (Core refuses a file without pages).
 */
export function canRemovePage(edits: PdfEdits | null | undefined, page: number, pageCount: number): boolean {
  if (!Number.isInteger(page) || page < 0 || page >= pageCount) return false;
  if (isPageRemoved(edits, page)) return false;
  const removedInFile = removedPagesOf(edits).filter((p) => p >= 0 && p < pageCount).length;
  return removedInFile + 1 < pageCount;
}

const withPages = (edits: PdfEdits, removedPages: number[]): PdfEdits => ({ removedPages, regions: [...regionsOf(edits)] });
const withRegions = (edits: PdfEdits, regions: PdfRegion[]): PdfEdits => ({ removedPages: removedPagesOf(edits), regions });

/**
 * Leave `page` out, or bring it back when it is out. Returns the SAME object when nothing may
 * change (the page does not exist, or it is the last page that is still in).
 */
export function togglePage(edits: PdfEdits, page: number, pageCount: number): PdfEdits {
  if (isPageRemoved(edits, page)) return withPages(edits, removedPagesOf(edits).filter((p) => p !== page));
  if (!canRemovePage(edits, page, pageCount)) return edits;
  return withPages(edits, [...removedPagesOf(edits), page].sort((a, b) => a - b));
}

/** Hide one more area (`rect` in the page's user space). */
export function addRegion(edits: PdfEdits, page: number, rect: Rect): PdfEdits {
  return withRegions(edits, [...regionsOf(edits), { page, rect: { ...rect } }]);
}

/** Take the area at `index` of `edits.regions` away. The SAME object when there is no such area. */
export function removeRegion(edits: PdfEdits, index: number): PdfEdits {
  const regions = regionsOf(edits);
  if (!Number.isInteger(index) || index < 0 || index >= regions.length) return edits;
  return withRegions(edits, regions.filter((_, i) => i !== index));
}

/** Give the area at `index` another rectangle (it was moved or resized). The SAME object when there is no such area. */
export function replaceRegion(edits: PdfEdits, index: number, rect: Rect): PdfEdits {
  const regions = regionsOf(edits);
  if (!Number.isInteger(index) || index < 0 || index >= regions.length) return edits;
  return withRegions(edits, regions.map((r, i) => (i === index ? { page: r.page, rect: { ...rect } } : r)));
}

/** The areas of one page, each with its index in `edits.regions` (what removeRegion / replaceRegion take). */
export function regionsOnPage(edits: PdfEdits | null | undefined, page: number): Array<{ index: number; rect: Rect }> {
  const out: Array<{ index: number; rect: Rect }> = [];
  regionsOf(edits).forEach((r, index) => {
    if (r.page === page) out.push({ index, rect: r.rect });
  });
  return out;
}

export interface EditCounts {
  /** Pages left out. */
  pages: number;
  /** Areas hidden on pages that stay (an area on a page left out does nothing while the page is out). */
  areas: number;
  /** Areas per page, pages left out included (for the mark on a thumbnail). */
  areasByPage: Map<number, number>;
}

/** The numbers of the summary line. */
export function countEdits(edits: PdfEdits | null | undefined): EditCounts {
  const removed = new Set(removedPagesOf(edits));
  const areasByPage = new Map<number, number>();
  let areas = 0;
  for (const r of regionsOf(edits)) {
    areasByPage.set(r.page, (areasByPage.get(r.page) ?? 0) + 1);
    if (!removed.has(r.page)) areas++;
  }
  return { pages: removed.size, areas, areasByPage };
}

/* ------------------------------------------------------------------ */
/* Parts that cannot be redacted, after an edit                         */
/* ------------------------------------------------------------------ */

/**
 * What a list of unredactable parts names, one key per page: Core joins pages into ranges
 * ("pages 2-22"), and leaving page 5 out turns that into "pages 2-4" and "pages 6-22", which are
 * the same pages as before. Parts that are not whole pages keep their own name.
 */
export function unredactableKeys(items: ReadonlyArray<{ part: string }>): Set<string> {
  const keys = new Set<string>();
  for (const { part } of items) {
    const pages = /^pages? (\d+)(?:-(\d+))?$/.exec(part);
    if (!pages) {
      keys.add(part);
      continue;
    }
    const first = Number(pages[1]);
    const last = Number(pages[2] ?? pages[1]);
    for (let page = first; page <= last && page - first < 100_000; page++) keys.add(`page ${page}`);
  }
  return keys;
}

/**
 * True when `now` names a part `before` did not: a page that was brought back carries a part the
 * user has not decided about, so "Continue" must be asked again. Parts that only went away (a
 * page left out) change nothing about a decision already made.
 */
export function hasNewUnredactable(before: ReadonlyArray<{ part: string }>, now: ReadonlyArray<{ part: string }>): boolean {
  const known = unredactableKeys(before);
  for (const key of unredactableKeys(now)) if (!known.has(key)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Core's notes about hand edits                                        */
/* ------------------------------------------------------------------ */

/**
 * Core's notes (English sentences) without the ones about hand edits. What the page says itself
 * from the writer's structured result (which pages were exported as pictures for their hidden
 * areas) is dropped; the one limit a user must hear of comes back as page numbers: text inside a
 * pattern or a soft mask that a hidden area paints black but cannot take out of the text.
 */
export function takeEditNotes(notes: readonly string[]): { rest: string[]; textStaysPages: number[] } {
  const rest: string[] = [];
  const textStaysPages: number[] = [];
  for (const note of notes) {
    const stays = /^page (\d+): text inside a pattern or a soft mask has no place on the page; a hidden area does not take it out of the text$/.exec(note);
    if (stays) textStaysPages.push(Number(stays[1]));
    else if (!/^page \d+: \d+ areas? hidden by hand, painted black in the picture/.test(note)) rest.push(note);
  }
  return { rest, textStaysPages };
}

/* ------------------------------------------------------------------ */
/* What was found, after an edit                                        */
/* ------------------------------------------------------------------ */

/** Core's `mapKeptRange`: where a range of the text before is in the text after, or null when part of it is gone. */
export type MapKeptRange = (kept: KeptStretch[], start: number, end: number) => { start: number; end: number } | null;

/**
 * True when the edited text holds something to read that the text before did not: a character
 * that is not white space, outside every stretch both texts share. Core's `addedText` is also true
 * when only a break came back (an empty page, a scan nobody could read, is brought back): no
 * detector has anything to find in that, and the result need not be thrown away for it.
 */
export function addedRealText(kept: KeptStretch[], text: string): boolean {
  let at = 0;
  for (const stretch of kept) {
    if (stretch.to > at && text.slice(at, stretch.to).trim() !== '') return true;
    at = Math.max(at, stretch.to + stretch.length);
  }
  return text.slice(at).trim() !== '';
}

export interface RemapResult {
  /** The items whose text is still there, at their places in the edited text. */
  entities: DetectedEntity[];
  /** The "kept visible" set, as indexes of the new list. */
  excluded: Set<number>;
  /** The items that left with their text (a page left out, an area hidden over them). */
  gone: DetectedEntity[];
}

/**
 * Move what was found to the edited text. Use it only when the edit added no text (Core's
 * `addedText` is false): then every item is either still whole in the text (it moves) or gone.
 *
 * `kept` and `text` are those of the edit (`PdfEditResult.kept`, `extraction.plainText`),
 * `mapKeptRange` is Core's. An item stays only when its whole range lies in one kept stretch AND
 * the edited text holds its value there: a range that maps to other characters is dropped, so a
 * mismatch can only cost an item, never mark the wrong text.
 */
export function remapAfterEdit(
  entities: DetectedEntity[],
  excluded: ReadonlySet<number>,
  kept: KeptStretch[],
  text: string,
  mapKeptRange: MapKeptRange,
): RemapResult {
  const out: DetectedEntity[] = [];
  const outExcluded = new Set<number>();
  const gone: DetectedEntity[] = [];
  entities.forEach((entity, index) => {
    const at = mapKeptRange(kept, entity.start, entity.end);
    if (!at || text.slice(at.start, at.end) !== entity.value) {
      gone.push(entity);
      return;
    }
    if (excluded.has(index)) outExcluded.add(out.length);
    out.push(at.start === entity.start && at.end === entity.end ? entity : { ...entity, start: at.start, end: at.end });
  });
  return { entities: out, excluded: outExcluded, gone };
}
