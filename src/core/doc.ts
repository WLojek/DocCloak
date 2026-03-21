import CFB from 'cfb';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DocPiece {
  cpStart: number;
  cpEnd: number;
  fc: number;          // raw 4-byte PCD fc value (includes compression flag)
  isCompressed: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toUint8Array(content: CFB.CFB$Blob): Uint8Array {
  return content instanceof Uint8Array
    ? content
    : new Uint8Array(content);
}

function align512(n: number): number {
  return Math.ceil(n / 512) * 512;
}

// ─── Piece table parsing ─────────────────────────────────────────────────────

function parsePieces(
  tableStream: Uint8Array,
  fcClx: number,
  lcbClx: number,
): DocPiece[] {
  const view = new DataView(tableStream.buffer, tableStream.byteOffset, tableStream.byteLength);
  let offset = fcClx;
  const end = fcClx + lcbClx;

  // Skip Prc (type 0x01) entries
  while (offset < end && view.getUint8(offset) !== 0x02) {
    if (view.getUint8(offset) === 0x01) {
      const cb = view.getInt16(offset + 1, true);
      offset += 3 + cb;
    } else {
      throw new Error('Invalid CLX');
    }
  }
  if (offset >= end || view.getUint8(offset) !== 0x02) {
    throw new Error('Missing piece table');
  }
  offset++; // type byte
  const lcbPcd = view.getUint32(offset, true);
  offset += 4;

  const nPieces = (lcbPcd - 4) / 12;
  if (nPieces !== Math.floor(nPieces) || nPieces <= 0) {
    throw new Error('Bad piece table');
  }

  const cps: number[] = [];
  for (let i = 0; i <= nPieces; i++) {
    cps.push(view.getInt32(offset + i * 4, true));
  }
  const pcdOff = offset + (nPieces + 1) * 4;
  const pieces: DocPiece[] = [];
  for (let i = 0; i < nPieces; i++) {
    const fc = view.getUint32(pcdOff + i * 8 + 2, true);
    pieces.push({
      cpStart: cps[i],
      cpEnd: cps[i + 1],
      fc,
      isCompressed: (fc & 0x40000000) !== 0,
    });
  }
  return pieces;
}

// ─── Build new piece entries from original pieces for a CP range ─────────────

function extractOriginalPieces(
  originalPieces: DocPiece[],
  cpStart: number,
  cpEnd: number,
  newCpStart: number,
): DocPiece[] {
  const result: DocPiece[] = [];
  for (const piece of originalPieces) {
    const oStart = Math.max(cpStart, piece.cpStart);
    const oEnd = Math.min(cpEnd, piece.cpEnd);
    if (oStart >= oEnd) continue;

    const cpDelta = oStart - piece.cpStart;
    // FC formula: (original_raw_fc & 0x3FFFFFFF) + 2*cpDelta, preserving compression flag
    const rawBase = piece.fc & 0x3fffffff;
    const fc = (rawBase + 2 * cpDelta) | (piece.isCompressed ? 0x40000000 : 0);

    result.push({
      cpStart: newCpStart + (oStart - cpStart),
      cpEnd: newCpStart + (oEnd - cpStart),
      fc,
      isCompressed: piece.isCompressed,
    });
  }
  return result;
}

// ─── Build CLX binary from pieces ────────────────────────────────────────────

function buildClx(pieces: DocPiece[]): Uint8Array {
  const n = pieces.length;
  const plcPcdSize = (n + 1) * 4 + n * 8;
  const buf = new Uint8Array(1 + 4 + plcPcdSize);
  const v = new DataView(buf.buffer);

  buf[0] = 0x02; // Pcdt type
  v.setUint32(1, plcPcdSize, true);

  let off = 5;
  // CPs
  for (let i = 0; i <= n; i++) {
    v.setInt32(off, i < n ? pieces[i].cpStart : pieces[n - 1].cpEnd, true);
    off += 4;
  }
  // PCDs: 2 bytes flags + 4 bytes fc + 2 bytes prm
  for (let i = 0; i < n; i++) {
    v.setUint16(off, 0, true); off += 2;       // flags
    v.setUint32(off, pieces[i].fc, true); off += 4; // fc
    v.setUint16(off, 0, true); off += 2;       // prm
  }
  return buf;
}

// ─── Build default FKP pages for replacement text ────────────────────────────

function buildDefaultChpxFkp(fcStart: number, fcEnd: number): Uint8Array {
  const page = new Uint8Array(512);
  const v = new DataView(page.buffer);
  v.setUint32(0, fcStart, true);
  v.setUint32(4, fcEnd, true);
  page[8] = 0;    // rgb[0] = 0 → no CHPX, default formatting
  page[511] = 1;  // crun = 1
  return page;
}

function buildDefaultPapxFkp(fcStart: number, fcEnd: number): Uint8Array {
  const page = new Uint8Array(512);
  const v = new DataView(page.buffer);
  v.setUint32(0, fcStart, true);
  v.setUint32(4, fcEnd, true);
  // rgbx[0]: bOffset=253 (byte pos 506), + 12 bytes PHE (zeros)
  page[8] = 253;
  // PAPX at byte 506: cb2=1 (2 bytes of data = istd only), istd=0 (Normal)
  page[506] = 1;
  page[507] = 0;
  page[508] = 0;
  page[511] = 1;  // cpara = 1
  return page;
}

// ─── Extend PlcBte (chpx or papx) with a new FKP page entry ─────────────────

function extendPlcBte(
  original: Uint8Array,
  newFcStart: number,
  newFcEnd: number,
  newPageNum: number,
): Uint8Array {
  const origLen = original.length;
  const n = (origLen - 4) / 8; // number of original ranges
  const ov = new DataView(original.buffer, original.byteOffset, original.byteLength);

  // New: n+1 ranges → (n+2) FCs + (n+1) page numbers
  const newLen = origLen + 8;
  const buf = new Uint8Array(newLen);
  const bv = new DataView(buf.buffer);

  // Copy original FCs [0..n-1], replace sentinel [n] with newFcStart, add newFcEnd
  for (let i = 0; i < n; i++) {
    bv.setUint32(i * 4, ov.getUint32(i * 4, true), true);
  }
  bv.setUint32(n * 4, newFcStart, true);
  bv.setUint32((n + 1) * 4, newFcEnd, true);

  // Copy original page numbers, add new one
  const origPgOff = (n + 1) * 4;
  const newPgOff = (n + 2) * 4;
  for (let i = 0; i < n; i++) {
    bv.setUint32(newPgOff + i * 4, ov.getUint32(origPgOff + i * 4, true), true);
  }
  bv.setUint32(newPgOff + n * 4, newPageNum, true);

  return buf;
}

// ─── Adjust CPs in a generic PLC structure ───────────────────────────────────

function adjustPlcCPs(
  original: Uint8Array,
  entrySize: number,
  ccpText: number,
  sortedRepls: Array<{ start: number; end: number; replacement: string }>,
  totalDelta: number,
): Uint8Array {
  if (original.length === 0) return original;

  const n = (original.length - 4) / (4 + entrySize);
  if (n !== Math.floor(n) || n <= 0) return original;

  const result = new Uint8Array(original);
  const v = new DataView(result.buffer, result.byteOffset, result.byteLength);

  for (let i = 0; i <= n; i++) {
    const cp = v.getInt32(i * 4, true);
    if (cp >= ccpText) {
      v.setInt32(i * 4, cp + totalDelta, true);
    } else {
      // Adjust by cumulative delta of replacements before this CP
      let delta = 0;
      for (const repl of sortedRepls) {
        if (repl.start >= cp) break;
        if (repl.end <= cp) {
          delta += repl.replacement.length - (repl.end - repl.start);
        }
      }
      if (delta !== 0) {
        v.setInt32(i * 4, cp + delta, true);
      }
    }
  }
  return result;
}

// ─── Read a PLC blob from the table stream ───────────────────────────────────

function readPlcBlob(tableStream: Uint8Array, fc: number, lcb: number): Uint8Array {
  if (lcb <= 0 || fc < 0) return new Uint8Array(0);
  return tableStream.slice(fc, fc + lcb);
}

// ─── Main: write anonymized .doc ─────────────────────────────────────────────

export async function writeAnonymizedDoc(
  buffer: ArrayBuffer,
  replacements: Array<{ start: number; end: number; replacement: string }>,
): Promise<Blob> {
  if (replacements.length === 0) {
    return new Blob([buffer], { type: 'application/msword' });
  }

  const data = new Uint8Array(buffer);
  const container = CFB.parse(data);

  // ── Get streams ──
  const wordDocEntry = CFB.find(container, '/WordDocument') ?? CFB.find(container, 'WordDocument');
  if (!wordDocEntry?.content) throw new Error('Missing WordDocument stream');
  const origWordDoc = toUint8Array(wordDocEntry.content);
  const wv = new DataView(origWordDoc.buffer, origWordDoc.byteOffset, origWordDoc.byteLength);

  const flags = wv.getUint16(0x000a, true);
  const whichTbl = (flags >> 9) & 1;
  const tblName = whichTbl ? '1Table' : '0Table';
  const tableEntry = CFB.find(container, '/' + tblName) ?? CFB.find(container, tblName);
  if (!tableEntry?.content) throw new Error(`Missing ${tblName} stream`);
  const origTable = toUint8Array(tableEntry.content);

  // ── Read FIB ──
  const ccpText = wv.getInt32(0x004c, true);
  const fcClx = wv.getInt32(0x01a2, true);
  const lcbClx = wv.getInt32(0x01a6, true);
  const fcPlcfBteChpx = wv.getInt32(0x00fa, true);
  const lcbPlcfBteChpx = wv.getInt32(0x00fe, true);
  const fcPlcfBtePapx = wv.getInt32(0x0102, true);
  const lcbPlcfBtePapx = wv.getInt32(0x0106, true);
  const fcPlcfSed = wv.getInt32(0x00ca, true);
  const lcbPlcfSed = wv.getInt32(0x00ce, true);

  // ── Parse piece table ──
  const pieces = parsePieces(origTable, fcClx, lcbClx);
  const sorted = [...replacements].sort((a, b) => a.start - b.start);

  // ── Build new pieces ──
  const appendStart = align512(origWordDoc.length);
  let appendPos = appendStart;
  const newPieces: DocPiece[] = [];
  let newCp = 0;
  let prevEnd = 0;
  const appendedBytes: number[] = [];

  for (const repl of sorted) {
    // Unchanged text before replacement
    if (repl.start > prevEnd) {
      const unchanged = extractOriginalPieces(pieces, prevEnd, repl.start, newCp);
      newPieces.push(...unchanged);
      newCp += repl.start - prevEnd;
    }

    // Replacement text (appended as UTF-16LE, no compression flag)
    const replText = repl.replacement;
    if (replText.length > 0) {
      newPieces.push({
        cpStart: newCp,
        cpEnd: newCp + replText.length,
        fc: appendPos, // Unicode: fc = byte offset directly
        isCompressed: false,
      });
      for (let i = 0; i < replText.length; i++) {
        const code = replText.charCodeAt(i);
        appendedBytes.push(code & 0xff, (code >> 8) & 0xff);
      }
      appendPos += replText.length * 2;
      newCp += replText.length;
    }
    prevEnd = repl.end;
  }

  // Remaining unchanged main text
  if (prevEnd < ccpText) {
    const unchanged = extractOriginalPieces(pieces, prevEnd, ccpText, newCp);
    newPieces.push(...unchanged);
    newCp += ccpText - prevEnd;
  }

  const newCcpText = newCp;
  const totalDelta = newCcpText - ccpText;

  // Non-main-text pieces (footnotes, headers, etc.) — keep original FCs, shift CPs
  for (const piece of pieces) {
    if (piece.cpEnd <= ccpText) continue;
    const clampStart = Math.max(piece.cpStart, ccpText);
    const cpDelta = clampStart - piece.cpStart;
    const rawBase = piece.fc & 0x3fffffff;
    const fc = (rawBase + 2 * cpDelta) | (piece.isCompressed ? 0x40000000 : 0);

    newPieces.push({
      cpStart: clampStart + totalDelta,
      cpEnd: piece.cpEnd + totalDelta,
      fc,
      isCompressed: piece.isCompressed,
    });
  }

  // ── Build new CLX ──
  const newClx = buildClx(newPieces);

  // ── Build extended WordDocument stream ──
  const hasAppendedText = appendedBytes.length > 0;
  const appendedData = new Uint8Array(appendedBytes);
  const fkpStart = align512(appendStart + appendedData.length);
  const chpxPageOff = fkpStart;
  const papxPageOff = fkpStart + 512;
  const newWordDocLen = hasAppendedText ? papxPageOff + 512 : origWordDoc.length;

  const newWordDoc = new Uint8Array(newWordDocLen);
  newWordDoc.set(origWordDoc);
  if (hasAppendedText) {
    newWordDoc.set(appendedData, appendStart);
    newWordDoc.set(buildDefaultChpxFkp(appendStart, appendStart + appendedData.length), chpxPageOff);
    newWordDoc.set(buildDefaultPapxFkp(appendStart, appendStart + appendedData.length), papxPageOff);
  }

  // ── Build extended PlcBteChpx / PlcBtePapx ──
  let origPlcChpx = readPlcBlob(origTable, fcPlcfBteChpx, lcbPlcfBteChpx);
  let origPlcPapx = readPlcBlob(origTable, fcPlcfBtePapx, lcbPlcfBtePapx);

  let newPlcChpx: Uint8Array;
  let newPlcPapx: Uint8Array;
  if (hasAppendedText) {
    const chpxPageNum = chpxPageOff / 512;
    const papxPageNum = papxPageOff / 512;
    newPlcChpx = extendPlcBte(origPlcChpx, appendStart, appendStart + appendedData.length, chpxPageNum);
    newPlcPapx = extendPlcBte(origPlcPapx, appendStart, appendStart + appendedData.length, papxPageNum);
  } else {
    newPlcChpx = origPlcChpx;
    newPlcPapx = origPlcPapx;
  }

  // ── Adjust PlcfSed CPs ──
  let newPlcfSed = readPlcBlob(origTable, fcPlcfSed, lcbPlcfSed);
  if (newPlcfSed.length > 0 && totalDelta !== 0) {
    newPlcfSed = adjustPlcCPs(newPlcfSed, 12, ccpText, sorted, totalDelta);
  }

  // ── Build new Table stream ──
  // Append modified structures at the end; update FIB pointers
  const newTableLen = origTable.length + newClx.length + newPlcChpx.length + newPlcPapx.length + newPlcfSed.length;
  const newTable = new Uint8Array(newTableLen);
  newTable.set(origTable);

  let tblOff = origTable.length;
  const newFcClx = tblOff;
  newTable.set(newClx, tblOff); tblOff += newClx.length;

  const newFcPlcChpx = tblOff;
  newTable.set(newPlcChpx, tblOff); tblOff += newPlcChpx.length;

  const newFcPlcPapx = tblOff;
  newTable.set(newPlcPapx, tblOff); tblOff += newPlcPapx.length;

  const newFcPlcfSed = tblOff;
  newTable.set(newPlcfSed, tblOff); tblOff += newPlcfSed.length;

  // ── Update FIB in the new WordDocument stream ──
  const fv = new DataView(newWordDoc.buffer, newWordDoc.byteOffset, newWordDoc.byteLength);
  fv.setInt32(0x004c, newCcpText, true);
  fv.setInt32(0x01a2, newFcClx, true);
  fv.setInt32(0x01a6, newClx.length, true);
  fv.setInt32(0x00fa, newFcPlcChpx, true);
  fv.setInt32(0x00fe, newPlcChpx.length, true);
  fv.setInt32(0x0102, newFcPlcPapx, true);
  fv.setInt32(0x0106, newPlcPapx.length, true);
  if (newPlcfSed.length > 0) {
    fv.setInt32(0x00ca, newFcPlcfSed, true);
    fv.setInt32(0x00ce, newPlcfSed.length, true);
  }

  // ── Write back to OLE2 container ──
  wordDocEntry.content = newWordDoc;
  tableEntry.content = newTable;

  const output = CFB.write(container, { type: 'array' }) as number[];
  return new Blob([new Uint8Array(output)], { type: 'application/msword' });
}

// ─── Text extraction (read-only) ────────────────────────────────────────────

/**
 * Extract plain text from a legacy .doc (OLE2/Compound File Binary) file.
 * Parses the FIB and piece table to correctly extract text from both
 * compressed (CP1252) and Unicode pieces.
 */
export function readDocText(buffer: ArrayBuffer): string {
  const data = new Uint8Array(buffer);
  const cfb = CFB.parse(data);

  const wordDocEntry = CFB.find(cfb, '/WordDocument') ?? CFB.find(cfb, 'WordDocument');
  if (!wordDocEntry || !wordDocEntry.content) {
    throw new Error('Invalid .doc file: missing WordDocument stream');
  }

  const wordDoc = toUint8Array(wordDocEntry.content);
  const wordView = new DataView(wordDoc.buffer, wordDoc.byteOffset, wordDoc.byteLength);

  const wIdent = wordView.getUint16(0, true);
  if (wIdent !== 0xa5ec) {
    throw new Error('Invalid .doc file: bad magic number');
  }

  const flags = wordView.getUint16(0x000a, true);
  const whichTblStm = (flags >> 9) & 1;
  const tableName = whichTblStm ? '1Table' : '0Table';

  const tableEntry = CFB.find(cfb, '/' + tableName) ?? CFB.find(cfb, tableName);
  if (!tableEntry || !tableEntry.content) {
    throw new Error(`Invalid .doc file: missing ${tableName} stream`);
  }

  const tableDoc = toUint8Array(tableEntry.content);
  const ccpText = wordView.getInt32(0x004c, true);
  const fcClx = wordView.getInt32(0x01a2, true);
  const lcbClx = wordView.getInt32(0x01a6, true);

  if (lcbClx <= 0 || fcClx < 0) {
    throw new Error('Invalid .doc file: missing CLX data');
  }

  const pieces = parsePieces(tableDoc, fcClx, lcbClx);

  let text = '';
  for (const piece of pieces) {
    const charCount = piece.cpEnd - piece.cpStart;
    if (charCount <= 0) continue;
    if (piece.cpStart >= ccpText) continue; // only main text

    const charsToRead = Math.min(charCount, ccpText - piece.cpStart);
    const rawOffset = piece.fc & 0x3fffffff;

    if (piece.isCompressed) {
      const byteOffset = rawOffset / 2;
      for (let j = 0; j < charsToRead; j++) {
        const bytePos = byteOffset + j;
        if (bytePos >= wordDoc.length) break;
        text += cp1252ToChar(wordDoc[bytePos]);
      }
    } else {
      const byteOffset = rawOffset;
      for (let j = 0; j < charsToRead; j++) {
        const pos = byteOffset + j * 2;
        if (pos + 1 >= wordDoc.length) break;
        text += String.fromCharCode(wordView.getUint16(pos, true));
      }
    }
  }

  return text.slice(0, ccpText)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\x07/g, '\t')
    .replace(/[\x00-\x06\x08\x0e-\x1f]/g, '')
    .replace(/\x0b/g, '\n')
    .replace(/\x0c/g, '\n');
}

// ─── CP1252 decoding ─────────────────────────────────────────────────────────

const CP1252_MAP: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
  0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

function cp1252ToChar(byte: number): string {
  if (byte >= 0x80 && byte <= 0x9f) {
    const mapped = CP1252_MAP[byte];
    return mapped ? String.fromCharCode(mapped) : '';
  }
  return String.fromCharCode(byte);
}
