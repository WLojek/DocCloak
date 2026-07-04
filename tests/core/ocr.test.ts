import { describe, it, expect } from 'vitest';
import { buildTextFromBlocks, selectRedactionBoxes, isImageFile } from '../../src/core/ocr.ts';
import type { OcrWord } from '../../src/core/ocr.ts';

const bbox = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });

function block(lines: { words: { text: string; bbox: ReturnType<typeof bbox> }[] }[]) {
  return { paragraphs: [{ lines }] };
}

describe('buildTextFromBlocks', () => {
  it('reconstructs text with exact per-word character offsets', () => {
    const { text, words } = buildTextFromBlocks([
      block([
        { words: [{ text: 'John', bbox: bbox(0, 0, 40, 10) }, { text: 'Smith', bbox: bbox(45, 0, 90, 10) }] },
        { words: [{ text: 'john@example.com', bbox: bbox(0, 20, 120, 30) }] },
      ]),
    ]);

    expect(text).toBe('John Smith\njohn@example.com');
    for (const word of words) {
      expect(text.slice(word.start, word.end)).toBe(word.text);
    }
  });

  it('separates blocks with a blank line and skips empty words', () => {
    const { text, words } = buildTextFromBlocks([
      block([{ words: [{ text: 'Invoice', bbox: bbox(0, 0, 50, 10) }, { text: '  ', bbox: bbox(55, 0, 60, 10) }] }]),
      block([{ words: [{ text: '42', bbox: bbox(0, 40, 20, 50) }] }]),
    ]);

    expect(text).toBe('Invoice\n\n42');
    expect(words.map((w) => w.text)).toEqual(['Invoice', '42']);
    expect(text.slice(words[1].start, words[1].end)).toBe('42');
  });

  it('returns empty extraction for no blocks', () => {
    expect(buildTextFromBlocks([])).toEqual({ text: '', words: [] });
  });
});

describe('selectRedactionBoxes', () => {
  const words: OcrWord[] = [
    { text: 'Contact', start: 0, end: 7, bbox: bbox(0, 0, 70, 10) },
    { text: 'John', start: 8, end: 12, bbox: bbox(80, 0, 120, 10) },
    { text: 'Smith', start: 13, end: 18, bbox: bbox(130, 0, 180, 10) },
    { text: 'today', start: 19, end: 24, bbox: bbox(190, 0, 240, 10) },
  ];

  it('selects every word overlapping an entity range', () => {
    // Entity "John Smith" spans chars 8-18
    const boxes = selectRedactionBoxes(words, [{ start: 8, end: 18 }]);
    expect(boxes).toEqual([bbox(80, 0, 120, 10), bbox(130, 0, 180, 10)]);
  });

  it('redacts a word even when the range covers it only partially', () => {
    const boxes = selectRedactionBoxes(words, [{ start: 10, end: 15 }]);
    expect(boxes).toEqual([bbox(80, 0, 120, 10), bbox(130, 0, 180, 10)]);
  });

  it('returns nothing when ranges do not overlap any word', () => {
    expect(selectRedactionBoxes(words, [{ start: 7, end: 8 }])).toEqual([]);
  });
});

describe('isImageFile', () => {
  it('accepts common image extensions', () => {
    for (const name of ['a.png', 'b.JPG', 'c.jpeg', 'd.webp', 'e.bmp', 'f.gif']) {
      expect(isImageFile(name)).toBe(true);
    }
  });

  it('rejects documents and unknown extensions', () => {
    for (const name of ['a.docx', 'b.doc', 'c.pdf', 'd.txt', 'e.png.docx']) {
      expect(isImageFile(name)).toBe(false);
    }
  });
});
