import { describe, it, expect, vi } from 'vitest';
import { localizeCoreNotes, localizePart } from '../../src/ui/coreNotes.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { pl } from '../../src/i18n/translations/pl.ts';

// Core's notes, as its readers and writers write them (DocCloak.Core src/pdf/*.ts, src/dom/*.ts).
const CORE_NOTES = [
  'page 1: the reference extractor could not read it; edits on this page are rasterized',
  'page 4: the reference extractor read less than our decoder; the page is rasterized when redacted',
  'page 2: contains images; text inside images is not scanned',
  'page 5: contains images; text inside images is not scanned',
  'page 3: page-level XMP metadata removed',
  'page 2: the picture shows text its OCR layer does not have (17 lines, for example a table); DocCloak read it with its own OCR (62 words), check it before sharing',
  'page 2 is an image without a text layer (scanned page); its content cannot be redacted (exported as is)',
  'placeholder "[名前_1]" holds characters the replacement font cannot show (for example CJK or emoji); they are written as \'?\'. Use Latin letters and digits in placeholders',
  'placeholder for a run without a loaded font (p1:c0#12)',
  'placeholder for a run without a loaded font (p1:c0#40)',
  'placeholder "[ADDRESS_1]" on page 2 is wider than the room before the next column',
  'page 1: scan with an OCR text layer; the values are painted over in the picture with their placeholders and the page is exported as an image, with its text (placeholders in place of the values) as an invisible layer',
  'page 6: rasterized (Type3 font); its text layer is gone',
  'font ABCDEF+Garamond: unreadable ToUnicode map removed',
  'word/settings.xml: not well-formed XML, left untouched by the value scrub',
  'word/header1.xml: not well-formed XML, skipped by the text extractor',
];

describe('Core notes in the interface language', () => {
  it('translates every note Core writes and leaves out the ones the card already gives', () => {
    expect(localizeCoreNotes(pl, CORE_NOTES)).toEqual([
      pl.coreNotes.placeholderUnshowable('[名前_1]'),
      pl.coreNotes.placeholderTooWide('[ADDRESS_1]', '2'),
      pl.coreNotes.fontMapRemoved('ABCDEF+Garamond'),
      pl.coreNotes.partNotXml('word/settings.xml'),
      pl.coreNotes.partSkipped('word/header1.xml'),
      pl.coreNotes.imagesNotScanned('2, 5', 2),
      pl.coreNotes.pageMetadataRemoved('3', 1),
      pl.coreNotes.placeholderFallbackFont(2),
    ]);
  });

  it('the card never shows English in a Polish interface (the issue file after export)', () => {
    const notes = localizeCoreNotes(pl, [
      'page 2 is an image without a text layer (scanned page); its content cannot be redacted (exported as is)',
      'page 1: scan with an OCR text layer; the values are painted over in the picture with their placeholders and the page is exported as an image, with its text (placeholders in place of the values) as an invisible layer',
    ]);
    expect(notes).toEqual([]);
  });

  it('a note without a translation is counted and logged, not shown in English', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(localizeCoreNotes(en, ['page 3 uses a Type3 font', 'something new'])).toEqual([en.coreNotes.other(2)]);
    expect(info).toHaveBeenCalledTimes(2);
    info.mockRestore();
  });

  it('PDF page parts on the card read in the interface language; other parts stay as they are', () => {
    expect(localizePart(pl, 'page 2')).toBe('strona 2');
    expect(localizePart(pl, 'pages 2-17')).toBe('strony 2-17');
    expect(localizePart(en, 'pages 3, 7')).toBe('pages 3, 7');
    expect(localizePart(pl, 'word/embeddings/oleObject1.bin')).toBe('word/embeddings/oleObject1.bin');
  });
});
