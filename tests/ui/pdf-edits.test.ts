// T284 (WLojek/DocCloak.Core#6): the pure part of editing a PDF by hand. The set of edits (pages
// left out, areas hidden), what was found before an edit moved to the edited text, the geometry
// between the shown page and the page's user space, and the strings in every language.
import { describe, it, expect } from 'vitest';
import type { DetectedEntity } from '@doccloak/core';
import { mapKeptRange, pixelRectToUserRect, userRectToPixelRect } from '@doccloak/core/pdf';
import type { KeptStretch, PdfEdits } from '@doccloak/core/pdf';
import {
  addRegion, addedRealText, canRemovePage, countEdits, hasNewUnredactable, isEmptyEdits, isPageRemoved, keepsAPage, regionsOnPage, remapAfterEdit, removeRegion,
  removedPagesOf, replaceRegion, sameEdits, takeEditNotes, togglePage, unredactableKeys,
} from '../../src/ui/pdfEdits.ts';
import {
  KEY_STEP, MIN_BOX_SIDE, boxFromPoints, boxToUserRect, centerBox, fitInto, moveBox, pointInBox, resizeBox, userRectToBox,
} from '../../src/ui/components/pdf/geometry.ts';
import { languages } from '../../src/i18n/translations/index.ts';
import { pdfEditStrings } from '../../src/i18n/features/pdfEdit.ts';
import type { FeatureLanguage } from '../../src/i18n/features/index.ts';

const RECT = { x0: 10, y0: 20, x1: 110, y1: 60 };
const convert = { pixelRectToUserRect, userRectToPixelRect };

function entity(text: string, value: string, type: DetectedEntity['type'] = 'PERSON', from = 0): DetectedEntity {
  const start = text.indexOf(value, from);
  if (start < 0) throw new Error(`"${value}" is not in the text`);
  return { type, value, start, end: start + value.length, confidence: 0.9, detector: 'test' };
}

/** The stretches an edit keeps when the given pieces are cut out of `text` (as Core builds them, one space where words would join). */
function cut(text: string, pieces: string[]): { kept: KeptStretch[]; text: string } {
  const drop = new Uint8Array(text.length);
  for (const piece of pieces) {
    const at = text.indexOf(piece);
    if (at < 0) throw new Error(`"${piece}" is not in the text`);
    drop.fill(1, at, at + piece.length);
  }
  const kept: KeptStretch[] = [];
  let out = '';
  for (let i = 0; i < text.length;) {
    if (drop[i]) { i++; continue; }
    let j = i + 1;
    while (j < text.length && !drop[j]) j++;
    if (out.length > 0 && !/\s$/.test(out) && !/^\s/.test(text.slice(i))) out += ' ';
    kept.push({ from: i, to: out.length, length: j - i });
    out += text.slice(i, j);
    i = j;
  }
  return { kept, text: out };
}

describe('the set of edits', () => {
  it('knows an empty set, in every spelling', () => {
    expect(isEmptyEdits({})).toBe(true);
    expect(isEmptyEdits(undefined)).toBe(true);
    expect(isEmptyEdits({ removedPages: [], regions: [] })).toBe(true);
    expect(isEmptyEdits({ removedPages: [0] })).toBe(false);
    expect(isEmptyEdits({ regions: [{ page: 0, rect: RECT }] })).toBe(false);
  });

  it('leaves a page out and brings it back, keeping the areas', () => {
    const start: PdfEdits = { regions: [{ page: 2, rect: RECT }] };
    const out = togglePage(start, 1, 3);
    expect(out).toEqual({ removedPages: [1], regions: [{ page: 2, rect: RECT }] });
    expect(isPageRemoved(out, 1)).toBe(true);
    const two = togglePage(out, 0, 3);
    expect(two.removedPages).toEqual([0, 1]);
    const back = togglePage(two, 1, 3);
    expect(back).toEqual({ removedPages: [0], regions: [{ page: 2, rect: RECT }] });
    // The input is never changed.
    expect(start).toEqual({ regions: [{ page: 2, rect: RECT }] });
  });

  it('never leaves every page out', () => {
    const one: PdfEdits = { removedPages: [0, 1] };
    expect(canRemovePage(one, 2, 3)).toBe(false);
    expect(togglePage(one, 2, 3)).toBe(one);
    expect(canRemovePage({}, 0, 1)).toBe(false);
    const none: PdfEdits = {};
    expect(togglePage(none, 0, 1)).toBe(none);
    expect(canRemovePage({}, 0, 2)).toBe(true);
    // A page that does not exist, or is out already.
    expect(canRemovePage({}, 5, 3)).toBe(false);
    expect(canRemovePage({}, -1, 3)).toBe(false);
    expect(canRemovePage({ removedPages: [1] }, 1, 3)).toBe(false);
    expect(togglePage(none, 7, 3)).toBe(none);
    // The check for a whole set.
    expect(keepsAPage({ removedPages: [0, 1] }, 3)).toBe(true);
    expect(keepsAPage({ removedPages: [0, 1, 2] }, 3)).toBe(false);
    expect(keepsAPage({ removedPages: [0, 0, 1, 1] }, 3)).toBe(true);
    expect(keepsAPage({ removedPages: [3] }, 3)).toBe(false);
    expect(keepsAPage({}, 1)).toBe(true);
    expect(removedPagesOf({ removedPages: [2, 0, 2] })).toEqual([0, 2]);
  });

  it('adds, replaces and removes an area by its index', () => {
    const a = addRegion({}, 0, RECT);
    const b = addRegion(a, 2, { x0: 1, y0: 2, x1: 3, y1: 4 });
    expect(b.regions).toEqual([{ page: 0, rect: RECT }, { page: 2, rect: { x0: 1, y0: 2, x1: 3, y1: 4 } }]);
    expect(b.regions![0].rect).not.toBe(RECT);
    expect(regionsOnPage(b, 2)).toEqual([{ index: 1, rect: { x0: 1, y0: 2, x1: 3, y1: 4 } }]);
    expect(regionsOnPage(b, 1)).toEqual([]);
    const moved = replaceRegion(b, 1, { x0: 5, y0: 6, x1: 7, y1: 8 });
    expect(moved.regions![1]).toEqual({ page: 2, rect: { x0: 5, y0: 6, x1: 7, y1: 8 } });
    expect(moved.regions![0]).toEqual({ page: 0, rect: RECT });
    expect(removeRegion(moved, 0).regions).toEqual([{ page: 2, rect: { x0: 5, y0: 6, x1: 7, y1: 8 } }]);
    expect(removeRegion(b, 9)).toBe(b);
    expect(replaceRegion(b, -1, RECT)).toBe(b);
  });

  it('compares two sets whatever their order', () => {
    const r2 = { x0: 1, y0: 2, x1: 3, y1: 4 };
    expect(sameEdits({}, { removedPages: [], regions: [] })).toBe(true);
    expect(sameEdits(undefined, {})).toBe(true);
    expect(sameEdits({ removedPages: [2, 0] }, { removedPages: [0, 2] })).toBe(true);
    expect(sameEdits({ removedPages: [0] }, { removedPages: [1] })).toBe(false);
    expect(sameEdits({ regions: [{ page: 0, rect: RECT }, { page: 1, rect: r2 }] }, { regions: [{ page: 1, rect: r2 }, { page: 0, rect: { ...RECT } }] })).toBe(true);
    expect(sameEdits({ regions: [{ page: 0, rect: RECT }] }, { regions: [{ page: 1, rect: RECT }] })).toBe(false);
    expect(sameEdits({ regions: [{ page: 0, rect: RECT }] }, { regions: [{ page: 0, rect: { ...RECT, x1: 111 } }] })).toBe(false);
    expect(sameEdits({ regions: [{ page: 0, rect: RECT }] }, { regions: [{ page: 0, rect: RECT }, { page: 0, rect: RECT }] })).toBe(false);
  });

  it('counts for the summary: an area on a page left out does not count', () => {
    const edits: PdfEdits = { removedPages: [1, 4], regions: [{ page: 0, rect: RECT }, { page: 0, rect: RECT }, { page: 1, rect: RECT }, { page: 3, rect: RECT }] };
    const counts = countEdits(edits);
    expect(counts.pages).toBe(2);
    expect(counts.areas).toBe(3);
    expect([...counts.areasByPage]).toEqual([[0, 2], [1, 1], [3, 1]]);
    expect(countEdits({})).toEqual({ pages: 0, areas: 0, areasByPage: new Map() });
  });
});

describe('remapAfterEdit', () => {
  const TEXT = 'Umowa: Jan Kowalski, Warszawa.\n\nAneks: Maria Wozniak, Gdansk.\n\nPodpis: Anna Nowak, tel. 600 100 200.';

  it('moves what is still there and drops what left with a page', () => {
    const entities = [entity(TEXT, 'Jan Kowalski'), entity(TEXT, 'Maria Wozniak'), entity(TEXT, 'Anna Nowak'), entity(TEXT, '600 100 200', 'PHONE')];
    // The second page is left out: its text and the break after it.
    const edit = cut(TEXT, ['Aneks: Maria Wozniak, Gdansk.\n\n']);
    const result = remapAfterEdit(entities, new Set(), edit.kept, edit.text, mapKeptRange);
    expect(result.entities.map((e) => e.value)).toEqual(['Jan Kowalski', 'Anna Nowak', '600 100 200']);
    expect(result.gone.map((e) => e.value)).toEqual(['Maria Wozniak']);
    for (const e of result.entities) expect(edit.text.slice(e.start, e.end)).toBe(e.value);
    // Before the cut nothing moved: the same object stays; after it the place is new.
    expect(result.entities[0]).toBe(entities[0]);
    expect(result.entities[1].start).toBe(entities[2].start - 'Aneks: Maria Wozniak, Gdansk.\n\n'.length);
    expect(result.entities[1]).toMatchObject({ type: 'PERSON', confidence: 0.9, detector: 'test' });
    // The input is not changed.
    expect(entities[2].start).toBe(TEXT.indexOf('Anna Nowak'));
  });

  it('drops an item an area cuts into, also when only a part of it is gone', () => {
    const entities = [entity(TEXT, 'Jan Kowalski'), entity(TEXT, 'Anna Nowak'), entity(TEXT, '600 100 200', 'PHONE')];
    // An area over "Nowak" and over the middle of the number.
    const edit = cut(TEXT, ['Nowak', '100']);
    expect(edit.text).toContain('Anna , tel. 600  200.');
    const result = remapAfterEdit(entities, new Set(), edit.kept, edit.text, mapKeptRange);
    expect(result.entities.map((e) => e.value)).toEqual(['Jan Kowalski']);
    expect(result.gone.map((e) => e.value)).toEqual(['Anna Nowak', '600 100 200']);
  });

  it('gives the "kept visible" set the indexes of the new list', () => {
    const entities = [entity(TEXT, 'Jan Kowalski'), entity(TEXT, 'Warszawa', 'ADDRESS'), entity(TEXT, 'Maria Wozniak'), entity(TEXT, 'Gdansk', 'ADDRESS'), entity(TEXT, 'Anna Nowak')];
    // Kept visible: Warszawa (1), Maria Wozniak (2, goes with its text), Anna Nowak (4).
    const edit = cut(TEXT, ['Maria Wozniak']);
    const result = remapAfterEdit(entities, new Set([1, 2, 4]), edit.kept, edit.text, mapKeptRange);
    expect(result.entities.map((e) => e.value)).toEqual(['Jan Kowalski', 'Warszawa', 'Gdansk', 'Anna Nowak']);
    expect([...result.excluded].sort()).toEqual([1, 3]);
    expect(result.entities[3].value).toBe('Anna Nowak');
    expect(result.gone).toEqual([entities[2]]);
  });

  it('treats a range that maps to other characters as gone', () => {
    const entities = [entity(TEXT, 'Jan Kowalski'), entity(TEXT, 'Anna Nowak')];
    // A mapping that claims everything stayed, over a text where the first name is not the same.
    const other = TEXT.replace('Jan Kowalski', 'Jan Kowalsky');
    const result = remapAfterEdit(entities, new Set([0]), [{ from: 0, to: 0, length: TEXT.length }], other, mapKeptRange);
    expect(result.entities.map((e) => e.value)).toEqual(['Anna Nowak']);
    expect(result.gone.map((e) => e.value)).toEqual(['Jan Kowalski']);
    expect(result.excluded.size).toBe(0);
    // And an item whose value never was its slice of the text does not survive an edit either.
    const odd = { ...entities[1], value: 'anna nowak' };
    expect(remapAfterEdit([odd], new Set(), [{ from: 0, to: 0, length: TEXT.length }], TEXT, mapKeptRange).gone).toEqual([odd]);
  });

  it('tells text that came back from a break that came back', () => {
    const base = 'Umowa: Jan Kowalski\n\n\n\nPodpis: Anna Nowak';
    const without = 'Umowa: Jan Kowalski\n\nPodpis: Anna Nowak';
    // An empty page comes back: the new text has one break more, and nothing to read in it.
    const emptyBack: KeptStretch[] = [{ from: 0, to: 0, length: 21 }, { from: 21, to: 23, length: 18 }];
    expect(base.slice(23)).toBe(without.slice(21));
    expect(addedRealText(emptyBack, base)).toBe(false);
    // A page with text comes back, in the middle and at either end.
    const full = 'Umowa: Jan Kowalski\n\nAneks: Maria\n\nPodpis: Anna Nowak';
    expect(addedRealText([{ from: 0, to: 0, length: 21 }, { from: 21, to: 35, length: 18 }], full)).toBe(true);
    expect(addedRealText([{ from: 0, to: 21, length: 32 }], full)).toBe(true);
    expect(addedRealText([{ from: 0, to: 0, length: 33 }], full)).toBe(true);
    // Nothing came back at all.
    expect(addedRealText([{ from: 0, to: 0, length: full.length }], full)).toBe(false);
    expect(addedRealText([], '')).toBe(false);
    expect(addedRealText([], ' \n')).toBe(false);
    expect(addedRealText([], 'x')).toBe(true);
  });

  it('keeps everything when the edit took no text, and nothing when it took all', () => {
    const entities = [entity(TEXT, 'Jan Kowalski'), entity(TEXT, 'Anna Nowak')];
    const same = remapAfterEdit(entities, new Set([1]), [{ from: 0, to: 0, length: TEXT.length }], TEXT, mapKeptRange);
    expect(same.entities).toEqual(entities);
    expect([...same.excluded]).toEqual([1]);
    expect(same.gone).toEqual([]);
    const none = remapAfterEdit(entities, new Set([1]), [], '', mapKeptRange);
    expect(none.entities).toEqual([]);
    expect(none.excluded.size).toBe(0);
    expect(none.gone).toEqual(entities);
  });
});

describe('parts that cannot be redacted, and notes, after an edit', () => {
  const part = (name: string) => ({ part: name });

  it('reads a range of pages as its pages', () => {
    expect([...unredactableKeys([part('pages 2-4'), part('page 7'), part('page 4 font F3'), part('word/embeddings/a.bin')])])
      .toEqual(['page 2', 'page 3', 'page 4', 'page 7', 'page 4 font F3', 'word/embeddings/a.bin']);
    expect(unredactableKeys([]).size).toBe(0);
  });

  it('asks again only for a part that was not there before', () => {
    // Page 5 of "pages 2-8" is left out: Core names the rest in two ranges, and nothing is new.
    expect(hasNewUnredactable([part('pages 2-8')], [part('pages 2-4'), part('pages 6-8')])).toBe(false);
    expect(hasNewUnredactable([part('pages 2-8')], [])).toBe(false);
    // It is brought back: page 5 is a part the user has not decided about in this state.
    expect(hasNewUnredactable([part('pages 2-4'), part('pages 6-8')], [part('pages 2-8')])).toBe(true);
    expect(hasNewUnredactable([], [part('page 2')])).toBe(true);
    expect(hasNewUnredactable([part('page 2')], [part('page 2'), part('page 4 font F3')])).toBe(true);
    expect(hasNewUnredactable([part('page 2')], [part('page 2')])).toBe(false);
  });

  it("takes Core's notes about hand edits out of a list of notes", () => {
    const notes = [
      'page 1: contains images; text inside images is not scanned',
      'page 3: 2 areas hidden by hand, painted black in the picture; the page is exported as an image, with its text (placeholders in place of the values) as an invisible layer',
      'page 4: 1 area hidden by hand, painted black in the picture',
      'page 6: text inside a pattern or a soft mask has no place on the page; a hidden area does not take it out of the text',
      'font ABC: unreadable ToUnicode map removed',
    ];
    expect(takeEditNotes(notes)).toEqual({
      rest: ['page 1: contains images; text inside images is not scanned', 'font ABC: unreadable ToUnicode map removed'],
      textStaysPages: [6],
    });
    expect(takeEditNotes([])).toEqual({ rest: [], textStaysPages: [] });
  });
});

describe('geometry of the page view', () => {
  // pdf.js viewport transforms of a 400 x 300 pt page at scale 2: as it is, and with /Rotate 90
  // (shown 300 x 400 pt, the page's bottom-left corner at the top-left of the picture).
  const upright = { transform: [2, 0, 0, -2, 0, 600], widthPx: 800, heightPx: 600 };
  const turned = { transform: [0, 2, 2, 0, 0, 0], widthPx: 600, heightPx: 800 };

  it('turns a pointer position into a fraction of the shown page', () => {
    const bounds = { left: 100, top: 50, width: 400, height: 300 };
    expect(pointInBox(100, 50, bounds)).toEqual({ x: 0, y: 0 });
    expect(pointInBox(300, 125, bounds)).toEqual({ x: 0.5, y: 0.25 });
    // Outside the page: the edge.
    expect(pointInBox(900, -20, bounds)).toEqual({ x: 1, y: 0 });
    // A page that has no size on screen gives no point.
    expect(pointInBox(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
    expect(boxFromPoints({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 })).toEqual({ x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.5 });
  });

  it('maps a box of an upright page to user space (y flipped) and back', () => {
    const rect = boxToUserRect(convert, upright, { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.3 });
    expect(rect.x0).toBeCloseTo(40);
    expect(rect.x1).toBeCloseTo(200);
    expect(rect.y0).toBeCloseTo(210);
    expect(rect.y1).toBeCloseTo(270);
    const box = userRectToBox(convert, upright, rect);
    expect(box.x0).toBeCloseTo(0.1);
    expect(box.y0).toBeCloseTo(0.1);
    expect(box.x1).toBeCloseTo(0.5);
    expect(box.y1).toBeCloseTo(0.3);
    // The same box on a render of the same page at another scale is the same rectangle.
    const small = { transform: [0.24, 0, 0, -0.24, 0, 72], widthPx: 96, heightPx: 72 };
    const again = boxToUserRect(convert, small, { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.3 });
    expect(again.x0).toBeCloseTo(40);
    expect(again.y1).toBeCloseTo(270);
  });

  it('maps a box of a page with /Rotate 90: the axes swap', () => {
    const rect = boxToUserRect(convert, turned, { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.5 });
    expect(rect.x0).toBeCloseTo(40);
    expect(rect.x1).toBeCloseTo(200);
    expect(rect.y0).toBeCloseTo(30);
    expect(rect.y1).toBeCloseTo(90);
    const box = userRectToBox(convert, turned, rect);
    expect(box.x0).toBeCloseTo(0.1);
    expect(box.y0).toBeCloseTo(0.1);
    expect(box.x1).toBeCloseTo(0.3);
    expect(box.y1).toBeCloseTo(0.5);
  });

  it('cuts a rectangle that reaches past the page to the page', () => {
    expect(userRectToBox(convert, upright, { x0: -50, y0: 250, x1: 500, y1: 400 })).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 / 6 });
  });

  it('moves and resizes a box inside the page', () => {
    const box = { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.5 };
    const right = moveBox(box, KEY_STEP, 0);
    expect(right.x0).toBeCloseTo(0.405);
    expect(right.x1 - right.x0).toBeCloseTo(0.2);
    // At the edge it stays whole.
    const far = moveBox(box, 5, 5);
    expect(far.x1).toBeCloseTo(1);
    expect(far.y1).toBeCloseTo(1);
    expect(far.x1 - far.x0).toBeCloseTo(0.2);
    expect(moveBox(box, -5, -5)).toMatchObject({ x0: 0, y0: 0 });
    const wider = resizeBox(box, KEY_STEP, KEY_STEP);
    expect(wider.x1).toBeCloseTo(0.605);
    expect(wider.y1).toBeCloseTo(0.505);
    expect(wider.x0).toBe(0.4);
    // Never thinner than the least side, never past the page.
    const thin = resizeBox(box, -5, -5);
    expect(thin.x1 - thin.x0).toBeCloseTo(MIN_BOX_SIDE);
    expect(thin.y1 - thin.y0).toBeCloseTo(MIN_BOX_SIDE);
    expect(resizeBox(box, 5, 5)).toMatchObject({ x1: 1, y1: 1 });
    const middle = centerBox();
    expect((middle.x0 + middle.x1) / 2).toBeCloseTo(0.5);
    expect((middle.y0 + middle.y1) / 2).toBeCloseTo(0.5);
  });

  it('fits a page whole into a box', () => {
    expect(fitInto(400, 300, { width: 96, height: 128 })).toEqual({ width: 96, height: 72 });
    expect(fitInto(300, 400, { width: 96, height: 128 })).toEqual({ width: 96, height: 128 });
    expect(fitInto(0, 400, { width: 96, height: 128 })).toEqual({ width: 0, height: 0 });
  });
});

describe('pdf edit strings', () => {
  for (const { code } of languages) {
    it(`${code}: every string is there, without an em dash`, () => {
      const s = pdfEditStrings[code as FeatureLanguage];
      expect(s, code).toBeDefined();
      // Every string, by its key; a string that takes a number is made for one, for a few and for many.
      const made: Record<string, string[]> = {
        title: [s.title], hint: [s.hint], undoAll: [s.undoAll], note: [s.note], loading: [s.loading], failed: [s.failed],
        pagesLeftOut: [1, 2, 5, 22].map(s.pagesLeftOut), areasHidden: [1, 3, 12].map(s.areasHidden),
        pageOf: [s.pageOf(3, 12)], openPage: [s.openPage(3)], leaveOut: [s.leaveOut], bringBack: [s.bringBack],
        leaveOutPage: [s.leaveOutPage(3)], bringBackPage: [s.bringBackPage(3)], leftOut: [s.leftOut], lastPage: [s.lastPage],
        areaHelp: [s.areaHelp], leftOutHelp: [s.leftOutHelp], addArea: [s.addArea], area: [s.area(2, 3)], removeArea: [s.removeArea(2)],
        keysHint: [s.keysHint], previous: [s.previous], next: [s.next], close: [s.close], done: [s.done],
        redactAgain: [s.redactAgain('REDACT-BUTTON')], itemsGone: [1, 3, 12, 22].map(s.itemsGone), editFailed: [s.editFailed],
        exportLeftOut: [s.exportLeftOut('4', 1), s.exportLeftOut('2, 5-7', 4)],
        exportAreas: [s.exportAreas('4', 1), s.exportAreas('2, 5-7', 4)],
        exportAreasNoText: [s.exportAreasNoText('4', 1), s.exportAreasNoText('2, 5-7', 4)],
        areaRefused: [s.areaRefused('4', 1), s.areaRefused('2, 5-7', 4)],
        areaTextStays: [s.areaTextStays('4', 1), s.areaTextStays('2, 5-7', 4)],
      };
      expect(Object.keys(made).sort()).toEqual(Object.keys(pdfEditStrings.en).sort());
      expect(Object.keys(s).sort()).toEqual(Object.keys(pdfEditStrings.en).sort());
      const texts = Object.values(made).flat();
      for (const text of texts) {
        expect(typeof text).toBe('string');
        expect(text.trim().length).toBeGreaterThan(1);
        expect(text).not.toContain('\u2014');
        expect(text).not.toContain('undefined');
      }
      // The numbers a string is given are in it.
      expect(s.pagesLeftOut(7)).toContain('7');
      expect(s.areasHidden(4)).toContain('4');
      expect(s.pageOf(3, 12)).toMatch(/3.*12/);
      for (const text of [s.openPage(41), s.leaveOutPage(41), s.bringBackPage(41), s.removeArea(41)]) expect(text).toContain('41');
      expect(s.area(2, 9)).toMatch(/2.*9/);
      // What a note is given is in it: the name of the button, the count, the pages.
      expect(s.redactAgain('REDACT-BUTTON')).toContain('REDACT-BUTTON');
      expect(s.itemsGone(7)).toContain('7');
      for (const note of [s.exportLeftOut, s.exportAreas, s.exportAreasNoText, s.areaRefused, s.areaTextStays]) {
        expect(note('4', 1)).toContain('4');
        expect(note('2, 5-7', 4)).toContain('2, 5-7');
        expect(note('4', 1).replace('4', '')).not.toBe(note('2, 5-7', 4).replace('2, 5-7', ''));
      }
      // A refusal says that nothing left the page; the two kinds of picture pages are told apart.
      expect(s.exportAreas('4', 1)).not.toBe(s.exportAreasNoText('4', 1));
      if (code !== 'en') {
        expect(s.redactAgain('X')).not.toBe(pdfEditStrings.en.redactAgain('X'));
        expect(s.areaRefused('4', 1)).not.toBe(pdfEditStrings.en.areaRefused('4', 1));
        expect(s.exportLeftOut('4', 1)).not.toBe(pdfEditStrings.en.exportLeftOut('4', 1));
      }
      // The two switches under a page are short and differ; a page is "left out" and an area "hidden" in different words.
      expect(s.leaveOut.length).toBeLessThanOrEqual(14);
      expect(s.bringBack.length).toBeLessThanOrEqual(14);
      expect(s.leftOut.length).toBeLessThanOrEqual(12);
      expect(s.leaveOut).not.toBe(s.bringBack);
      expect(s.leaveOutPage(1)).not.toBe(s.bringBackPage(1));
      expect(s.pagesLeftOut(2)).not.toBe(s.areasHidden(2));
      // The help says what happens to the downloaded file, in the user's language.
      expect(s.areaHelp.length).toBeGreaterThan(80);
      if (code !== 'en') {
        expect(s.areaHelp).not.toBe(pdfEditStrings.en.areaHelp);
        expect(s.note).not.toBe(pdfEditStrings.en.note);
        expect(s.keysHint).not.toBe(pdfEditStrings.en.keysHint);
      }
    });
  }

  it('covers exactly the interface languages', () => {
    expect(Object.keys(pdfEditStrings).sort()).toEqual(languages.map((l) => l.code).sort());
  });

  it('Polish counts pages and areas in the right form', () => {
    const s = pdfEditStrings.pl;
    expect(s.pagesLeftOut(1)).toBe('1 strona pominięta');
    expect(s.pagesLeftOut(3)).toBe('3 strony pominięte');
    expect(s.pagesLeftOut(5)).toBe('5 stron pominiętych');
    expect(s.pagesLeftOut(12)).toBe('12 stron pominiętych');
    expect(s.pagesLeftOut(22)).toBe('22 strony pominięte');
    expect(s.areasHidden(1)).toBe('1 obszar zakryty');
    expect(s.areasHidden(4)).toBe('4 obszary zakryte');
    expect(s.areasHidden(11)).toBe('11 obszarów zakrytych');
    expect(s.itemsGone(1)).toBe('1 znaleziona pozycja zniknęła razem z usuniętym tekstem.');
    expect(s.itemsGone(3)).toBe('3 znalezione pozycje zniknęły razem z usuniętym tekstem.');
    expect(s.itemsGone(15)).toBe('15 znalezionych pozycji zniknęło razem z usuniętym tekstem.');
  });
});
