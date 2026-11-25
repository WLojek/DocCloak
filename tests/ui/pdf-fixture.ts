// A PdfExtraction made by hand, for tests of hand edits in the web app (T284). pdf.js does not run
// in jsdom, so Core's reader is mocked; everything after the reader is Core's own code, and it
// needs what a real extraction holds: the flat text, the page ranges, and every glyph with its
// place on the page. This builds exactly that for pages of plain lines:
//   - a page is 400 x 300 pt; line n of a page has its baseline at y = 250 - 20 n;
//   - every character is one glyph, 6 pt wide, the first of a line at x = 40;
//   - lines are joined with "\n", pages with "\n\n".
// With it Core's applyPdfEdits and mapKeptRange run unmocked: leaving a page out takes its text,
// and a rectangle over a word takes exactly that word.
import type { GlyphRun, PdfExtraction, PdfPageInfo, Rect } from '@doccloak/core/pdf';
import type { UnredactablePart } from '@doccloak/core/dom';

const LEFT = 40;
const TOP = 250;
const LINE = 20;
const GLYPH = 6;
const SIZE = 12;

export interface FakePdfOptions {
  /** 0-based pages that are pictures nobody could read (the "cannot be redacted" card lists them). */
  scannedPages?: number[];
  /** 0-based pages that are scans with an OCR text layer (a note says so). */
  ocrPages?: number[];
  extra?: Partial<PdfExtraction>;
}

export function fakePdf(pages: string[][], options: FakePdfOptions = {}): PdfExtraction {
  const runs: GlyphRun[] = [];
  const infos: PdfPageInfo[] = [];
  let text = '';
  pages.forEach((lines, page) => {
    if (page > 0) text += '\n\n';
    const textStart = text.length;
    lines.forEach((line, row) => {
      if (row > 0) text += '\n';
      const at = text.length;
      const y = TOP - row * LINE;
      runs.push({
        page,
        streamKey: `p${page}:c0`,
        opIndex: row,
        fontName: 'F1',
        fontKey: 'F1',
        glyphs: [...line].map((unicode, i) => ({ code: unicode.charCodeAt(0), codeLength: 1, unicode, width: 500, advance: GLYPH, x: LEFT + i * GLYPH, y, fontSize: SIZE, item: 0, byteOffset: i })),
        renderMode: 0,
        hidden: false,
        ocr: options.ocrPages?.includes(page) ? true : undefined,
        textOffsets: [...line].map((_, i) => at + i),
        emX: [SIZE, 0],
        emY: [0, SIZE],
        local: {
          ctm: [1, 0, 0, 1, 0, 0],
          tm: [1, 0, 0, 1, LEFT, y],
          tlm: [1, 0, 0, 1, LEFT, y],
          fontSize: SIZE,
          charSpacing: 0,
          wordSpacing: 0,
          hscale: 1,
          leading: 0,
          rise: 0,
          advances: [...line].map((_, i) => i * GLYPH),
        },
        textStart: at,
        textEnd: at + line.length,
      });
      text += line;
    });
    infos.push({
      index: page,
      width: 400,
      height: 300,
      rotate: 0,
      hasImages: Boolean(options.scannedPages?.includes(page) || options.ocrPages?.includes(page)),
      imageOnly: Boolean(options.scannedPages?.includes(page)),
      ocrText: Boolean(options.ocrPages?.includes(page)),
      textStart,
      textEnd: text.length,
    });
  });
  const unredactablePages: UnredactablePart[] = (options.scannedPages ?? []).map((page) => ({
    part: `page ${page + 1}`,
    kind: 'scanned-page',
    label: `page ${page + 1} is a scanned image without readable text`,
  }));
  return {
    plainText: text,
    pageCount: pages.length,
    pages: infos,
    runs,
    unredactable: unredactablePages.map((part) => ({ ...part })),
    unredactablePages,
    removed: [],
    warnings: [],
    empty: text.trim() === '',
    rasterOnlyPages: [],
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, pages.length]),
    ...options.extra,
  };
}

/**
 * The rectangle a user would draw around `word` (its `nth` place in the text of the file as read):
 * inside the letters' boxes, so it takes the word and nothing beside it or on the next line.
 */
export function rectAround(extraction: PdfExtraction, word: string, nth = 0): { page: number; rect: Rect } {
  const base = extraction.unedited ?? extraction;
  let at = -1;
  for (let i = 0; i <= nth; i++) {
    at = base.plainText.indexOf(word, at + 1);
    if (at < 0) throw new Error(`"${word}" (${nth}) is not in the text of the file`);
  }
  const run = base.runs.find((r) => r.textStart <= at && at + word.length <= r.textEnd);
  if (!run) throw new Error(`"${word}" does not lie in one line`);
  const first = run.glyphs[at - run.textStart];
  return { page: run.page, rect: { x0: first.x + 1, y0: first.y - 1, x1: first.x + word.length * GLYPH - 1, y1: first.y + 8 } };
}

/** A rectangle where the pages of fakePdf have no text (the foot of the page): what a signature in a picture is. */
export const EMPTY_SPOT: Rect = { x0: 200, y0: 20, x1: 320, y1: 60 };
