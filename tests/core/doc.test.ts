import { describe, it, expect } from 'vitest';
import CFB from 'cfb';
import { readDocText, writeAnonymizedDoc } from '../../src/core/doc.ts';

// Builds a minimal but structurally valid legacy .doc:
// - main text as a compressed (CP1252) piece, containing field control chars
// - footnote text as a Unicode (UTF-16LE) piece beyond ccpText
// - SttbfAssoc with an author string
// - \x05SummaryInformation property set with an author string

const MAIN_TEXT = 'Call John Smith now.\r';
// \x13 \x14 \x15 are field begin/separator/end marks; they are stripped from
// the normalized text, shifting offsets of everything after them.
const FIELD_MAIN_TEXT = '\x13 HYPERLINK \x14link\x15 Call John Smith now.\r';
const FOOTNOTE_TEXT = 'Note SecretName end.\r';

const TEXT_OFFSET = 0x400; // main text bytes in WordDocument stream
const FOOTNOTE_OFFSET = 0x500; // footnote bytes (UTF-16LE)
const CLX_OFFSET = 0; // CLX in table stream
const PLC_CHPX_OFFSET = 0x100;
const PLC_PAPX_OFFSET = 0x110;
const STTBF_OFFSET = 0x120;

function buildDoc(mainText: string): ArrayBuffer {
  const wordDoc = new Uint8Array(0x600);
  const wv = new DataView(wordDoc.buffer);

  wv.setUint16(0x0000, 0xa5ec, true); // magic
  wv.setUint16(0x000a, 0, true); // flags: 0Table
  wv.setInt32(0x004c, mainText.length, true); // ccpText
  wv.setInt32(0x00fa, PLC_CHPX_OFFSET, true);
  wv.setInt32(0x00fe, 12, true);
  wv.setInt32(0x0102, PLC_PAPX_OFFSET, true);
  wv.setInt32(0x0106, 12, true);

  // main text: CP1252 bytes
  for (let i = 0; i < mainText.length; i++) {
    wordDoc[TEXT_OFFSET + i] = mainText.charCodeAt(i);
  }
  // footnote text: UTF-16LE
  for (let i = 0; i < FOOTNOTE_TEXT.length; i++) {
    wv.setUint16(FOOTNOTE_OFFSET + i * 2, FOOTNOTE_TEXT.charCodeAt(i), true);
  }

  // Table stream with CLX (two pieces)
  const table = new Uint8Array(0x200);
  const tv = new DataView(table.buffer);
  const nPieces = 2;
  const lcbPcd = (nPieces + 1) * 4 + nPieces * 8;
  table[CLX_OFFSET] = 0x02;
  tv.setUint32(CLX_OFFSET + 1, lcbPcd, true);
  let off = CLX_OFFSET + 5;
  const cp0 = 0;
  const cp1 = mainText.length;
  const cp2 = mainText.length + FOOTNOTE_TEXT.length;
  for (const cp of [cp0, cp1, cp2]) {
    tv.setInt32(off, cp, true);
    off += 4;
  }
  // PCD 1: compressed -> raw fc = 2*byteOffset | 0x40000000
  tv.setUint16(off, 0, true); off += 2;
  tv.setUint32(off, (TEXT_OFFSET * 2) | 0x40000000, true); off += 4;
  tv.setUint16(off, 0, true); off += 2;
  // PCD 2: unicode -> fc = byte offset
  tv.setUint16(off, 0, true); off += 2;
  tv.setUint32(off, FOOTNOTE_OFFSET, true); off += 4;
  tv.setUint16(off, 0, true); off += 2;

  wv.setInt32(0x01a2, CLX_OFFSET, true);
  wv.setInt32(0x01a6, 5 + lcbPcd, true);

  // Minimal PlcfBteChpx/Papx: one FC range + one page number
  for (const plcOff of [PLC_CHPX_OFFSET, PLC_PAPX_OFFSET]) {
    tv.setUint32(plcOff, TEXT_OFFSET, true);
    tv.setUint32(plcOff + 4, FOOTNOTE_OFFSET + FOOTNOTE_TEXT.length * 2, true);
    tv.setUint32(plcOff + 8, 1, true);
  }

  // SttbfAssoc (extended): 2 strings, second is the author name
  const sttb = STTBF_OFFSET;
  tv.setUint16(sttb, 0xffff, true);
  tv.setUint16(sttb + 2, 2, true); // cData
  tv.setUint16(sttb + 4, 0, true); // cbExtra
  let soff = sttb + 6;
  const strings = ['x', 'AuthorName'];
  for (const s of strings) {
    tv.setUint16(soff, s.length, true);
    soff += 2;
    for (let i = 0; i < s.length; i++) {
      tv.setUint16(soff, s.charCodeAt(i), true);
      soff += 2;
    }
  }
  wv.setInt32(0x019a, sttb, true);
  wv.setInt32(0x019e, soff - sttb, true);

  // SummaryInformation property set with VT_LPSTR author (propId 4)
  const author = 'OleAuthor';
  const si = new Uint8Array(96);
  const sv = new DataView(si.buffer);
  sv.setUint16(0, 0xfffe, true); // byte order
  sv.setUint32(24, 1, true); // one section
  sv.setUint32(28 + 16, 48, true); // section offset
  sv.setUint32(48, 40, true); // cbSection
  sv.setUint32(52, 1, true); // one property
  sv.setUint32(56, 4, true); // propId: author
  sv.setUint32(60, 16, true); // offset within section
  sv.setUint32(64, 30, true); // VT_LPSTR
  sv.setUint32(68, author.length + 1, true);
  for (let i = 0; i < author.length; i++) si[72 + i] = author.charCodeAt(i);

  const container = CFB.utils.cfb_new();
  CFB.utils.cfb_add(container, '/WordDocument', wordDoc);
  CFB.utils.cfb_add(container, '/0Table', table);
  CFB.utils.cfb_add(container, '/SummaryInformation', si);
  const out = CFB.write(container, { type: 'array' }) as number[];
  return new Uint8Array(out).buffer;
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function bytesContain(buffer: ArrayBuffer, needle: string, utf16: boolean): boolean {
  const haystack = new Uint8Array(buffer);
  const target: number[] = [];
  for (let i = 0; i < needle.length; i++) {
    target.push(needle.charCodeAt(i));
    if (utf16) target.push(0);
  }
  outer: for (let i = 0; i + target.length <= haystack.length; i++) {
    for (let j = 0; j < target.length; j++) {
      if (haystack[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe('readDocText', () => {
  it('extracts main text and subdocument (footnote) text', () => {
    const text = readDocText(buildDoc(MAIN_TEXT));
    expect(text).toContain('Call John Smith now.');
    expect(text).toContain('Note SecretName end.');
  });

  it('strips field control characters', () => {
    const text = readDocText(buildDoc(FIELD_MAIN_TEXT));
    expect(text).toContain(' HYPERLINK link Call John Smith now.');
    expect(text).not.toContain('\x13');
  });
});

describe('writeAnonymizedDoc', () => {
  it('replaces main text and leaves no recoverable original bytes', async () => {
    const buffer = buildDoc(MAIN_TEXT);
    const text = readDocText(buffer);
    const start = text.indexOf('John Smith');
    const blob = await writeAnonymizedDoc(buffer, [
      { start, end: start + 'John Smith'.length, replacement: '<<REDACTED_1>>' },
    ]);
    const out = await blobToArrayBuffer(blob);

    const outText = readDocText(out);
    expect(outText).toContain('Call <<REDACTED_1>> now.');
    expect(outText).not.toContain('John Smith');

    // Data remanence: the original bytes must be destroyed, not just unreferenced
    expect(bytesContain(out, 'John Smith', false)).toBe(false);
    expect(bytesContain(out, 'John Smith', true)).toBe(false);
  });

  it('places replacements correctly when control chars shift offsets', async () => {
    const buffer = buildDoc(FIELD_MAIN_TEXT);
    const text = readDocText(buffer);
    const start = text.indexOf('John Smith');
    const blob = await writeAnonymizedDoc(buffer, [
      { start, end: start + 'John Smith'.length, replacement: '<<REDACTED_1>>' },
    ]);
    const outText = readDocText(await blobToArrayBuffer(blob));
    expect(outText).toContain('Call <<REDACTED_1>> now.');
    expect(outText).not.toContain('John Smith');
  });

  it('redacts footnote text in place and destroys its bytes', async () => {
    const buffer = buildDoc(MAIN_TEXT);
    const text = readDocText(buffer);
    const start = text.indexOf('SecretName');
    const blob = await writeAnonymizedDoc(buffer, [
      { start, end: start + 'SecretName'.length, replacement: '<<REDACTED_1>>' },
    ]);
    const out = await blobToArrayBuffer(blob);

    const outText = readDocText(out);
    expect(outText).toContain('Note XXXXXXXXXX end.');
    expect(outText).not.toContain('SecretName');
    expect(bytesContain(out, 'SecretName', false)).toBe(false);
    expect(bytesContain(out, 'SecretName', true)).toBe(false);
  });

  it('scrubs SttbfAssoc and OLE property-set metadata', async () => {
    const buffer = buildDoc(MAIN_TEXT);
    const text = readDocText(buffer);
    const start = text.indexOf('John Smith');
    const blob = await writeAnonymizedDoc(buffer, [
      { start, end: start + 'John Smith'.length, replacement: '<<REDACTED_1>>' },
    ]);
    const out = await blobToArrayBuffer(blob);
    expect(bytesContain(out, 'AuthorName', true)).toBe(false);
    expect(bytesContain(out, 'OleAuthor', false)).toBe(false);
  });

  it('scrubs metadata even when there are no replacements', async () => {
    const blob = await writeAnonymizedDoc(buildDoc(MAIN_TEXT), []);
    const out = await blobToArrayBuffer(blob);
    expect(bytesContain(out, 'AuthorName', true)).toBe(false);
    expect(bytesContain(out, 'OleAuthor', false)).toBe(false);
    // Text is untouched
    expect(readDocText(out)).toContain('Call John Smith now.');
  });

  it('fails closed on offsets that do not match the text', async () => {
    const buffer = buildDoc(MAIN_TEXT);
    await expect(
      writeAnonymizedDoc(buffer, [{ start: 0, end: 10_000, replacement: 'X' }])
    ).rejects.toThrow(/do not match/);
  });
});
