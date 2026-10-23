/**
 * Core reports its readers' and writers' notes as English sentences (they double as developer
 * diagnostics). The file card shows them in the interface language: each note Core is known to
 * write is translated, the notes the card already gives another way (scan pages, rasterized
 * pages, the OCR reading, the parts listed on the card) are left out, and anything else is
 * counted under one translated line and logged in full to the console, so the card never mixes
 * languages.
 */
import type { Translations } from '../i18n/types.ts';

/** 1-based page numbers as a short list: [1, 2, 3, 5] -> "1-3, 5". */
export function pageList(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i + 1 ? `${sorted[i]}-${sorted[j]}` : j === i + 1 ? `${sorted[i]}, ${sorted[j]}` : `${sorted[i]}`);
    i = j;
  }
  return parts.join(', ');
}

/** Notes the card already gives in the interface language, from the reader's or writer's structured results. */
const SAID_ELSEWHERE = [
  /^page \d+: the reference extractor (could not read it|read less than our decoder)/, // rasterized on export: pdf.rasterizedPages
  /^page \d+: the picture shows text its OCR layer does not have/, // pdf.ocrRead / pdf.ocrMissing
  /^page \d+: an image on the page shows text its text layer does not have/, // pdf.ocrInImages / pdf.imagesTextUnread
  /^page \d+: no text layer; DocCloak read the page with its own OCR/, // pdf.ocrWholePage
  /\(exported as is\)$/, // the parts listed on the card
  /^page \d+: scan with an OCR text layer;/, // pdf.scanPages
  /^page \d+: rasterized \(/, // pdf.rasterizedPages
];

/** Core's notes in the interface language, in their order, without repeats. */
export function localizeCoreNotes(t: Translations, notes: readonly string[]): string[] {
  const out: string[] = [];
  const imagePages: number[] = [];
  const metadataPages: number[] = [];
  let fallbackFont = 0;
  let unknown = 0;
  let m: RegExpMatchArray | null;
  for (const note of notes) {
    if (SAID_ELSEWHERE.some((re) => re.test(note))) continue;
    if ((m = note.match(/^page (\d+): contains images; text inside images is not scanned$/))) imagePages.push(Number(m[1]));
    else if ((m = note.match(/^page (\d+): page-level XMP metadata removed$/))) metadataPages.push(Number(m[1]));
    else if ((m = note.match(/^placeholder "(.+)" holds characters the replacement font cannot show/))) out.push(t.coreNotes.placeholderUnshowable(m[1]));
    else if ((m = note.match(/^placeholder "(.+)" on page (\d+) is wider than the room before the next column$/))) out.push(t.coreNotes.placeholderTooWide(m[1], m[2]));
    else if (/^placeholder for a run without a loaded font/.test(note)) fallbackFont++;
    else if ((m = note.match(/^font (.+): unreadable ToUnicode map removed$/))) out.push(t.coreNotes.fontMapRemoved(m[1]));
    else if ((m = note.match(/^(.+): not well-formed XML, left untouched by the value scrub$/))) out.push(t.coreNotes.partNotXml(m[1]));
    else if ((m = note.match(/^(.+): not well-formed XML, skipped by the text extractor$/))) out.push(t.coreNotes.partSkipped(m[1]));
    else {
      unknown++;
      console.info('[DocCloak] File note:', note);
    }
  }
  if (imagePages.length > 0) out.push(t.coreNotes.imagesNotScanned(pageList(imagePages), new Set(imagePages).size));
  if (metadataPages.length > 0) out.push(t.coreNotes.pageMetadataRemoved(pageList(metadataPages), new Set(metadataPages).size));
  if (fallbackFont > 0) out.push(t.coreNotes.placeholderFallbackFont(fallbackFont));
  if (unknown > 0) out.push(t.coreNotes.other(unknown));
  return [...new Set(out)];
}

/** A part on the card's list in the interface language: Core names PDF pages "page 2" / "pages 2-17"; other parts are paths, shown as they are. */
export function localizePart(t: Translations, part: string): string {
  const m = part.match(/^(pages?) (\d[\d, -]*)$/);
  if (!m) return part;
  return t.coreNotes.page(m[2], m[1] === 'page' ? 1 : 2);
}
