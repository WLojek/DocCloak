/**
 * A set of files (WLojek/DocCloak#6): the state one document takes with it when another one is
 * opened, the list of the set, and the one replacement table of the set. Everything here is plain
 * data and plain functions; the hook (useAnonymizer) holds the state and does the work.
 */
import type { AnonymizationSession, DetectedEntity, ReplacementEntry } from '@doccloak/core';
import type { OcrWord } from '@doccloak/core/dom';
import type { PdfExtraction, PdfRegion, RemovedPart } from '@doccloak/core/pdf';
import type { UnredactableItem } from './components/UnredactableNotice.tsx';
import type { XlsxInfo } from './hooks/useAnonymizer.ts';

/** Every file of a set stays in memory until it is removed: the set has a limit. */
export const BATCH_MAX_FILES = 25;

/** Core's limit on the entries of one table (AnonymizationSession.importEntries). Keep in sync with Core. */
export const TABLE_MAX_PAIRS = 10_000;

/**
 * Everything that belongs to ONE document on the page. A file of a set that is not open is kept as
 * this object; opening it puts every field back (useAnonymizer: takeDocument / putDocument).
 * The protected text and the list of labels are not kept: they are made again from the labels of
 * the tab when the document is opened, so a label typed in another file of the set is in them.
 *
 * State that belongs to one document and is added later (edits of PDF pages, ...) goes here, in
 * emptyDocument below, and in takeDocument / putDocument: nowhere else.
 */
export interface DocumentSnapshot {
  /** The text that is analysed. */
  text: string;
  /** Every place found, redacted or not. */
  entities: DetectedEntity[];
  /** Places of `entities` that are found but stay readable. */
  excluded: Set<number>;
  /** The text of the last finished analysis; equal to `text` once the document was analysed. */
  lastRunText: string | null;
  /** Places an earlier run redacted and the last one did not find: the notice that waits for an answer. */
  dropped: DetectedEntity[];
  /** The protected result left the page (download or copy). */
  resultTakenOut: boolean;
  /** "The result changed after it was taken" was said for the copy that is out. */
  changeNoticed: boolean;
  /** Word document: the writer reads the file again. */
  docxFile: File | null;
  /** Workbook: the writer reads the file again. */
  xlsxFile: File | null;
  xlsxInfo: XlsxInfo | null;
  /** PDF: the parsed file with its bytes. */
  pdfFileName: string | null;
  /**
   * With hand edits (T284: pages left out, areas hidden) this is the EDITED extraction: it carries
   * the edits and the file as read, and `text` is its text.
   */
  pdfExtraction: PdfExtraction | null;
  /** What those edits paint over, for the page view (Core's `covered`). */
  pdfCovered: PdfRegion[];
  pdfRemoved: RemovedPart[];
  /** Image: the picture and the words OCR read in it. */
  imageFileName: string | null;
  imageCanvas: HTMLCanvasElement | null;
  ocrWords: OcrWord[];
  /** Parts the writer cannot redact, the notes of the reader, and the user's decision. */
  unredactableItems: UnredactableItem[];
  fileWarnings: string[];
  allowUnredactable: boolean;
}

export function emptyDocument(): DocumentSnapshot {
  return {
    text: '',
    entities: [],
    excluded: new Set(),
    lastRunText: null,
    dropped: [],
    resultTakenOut: false,
    changeNoticed: false,
    docxFile: null,
    xlsxFile: null,
    xlsxInfo: null,
    pdfFileName: null,
    pdfExtraction: null,
    pdfCovered: [],
    pdfRemoved: [],
    imageFileName: null,
    imageCanvas: null,
    ocrWords: [],
    unredactableItems: [],
    fileWarnings: [],
    allowUnredactable: false,
  };
}

/** What the list of the set shows for a file. */
export type BatchFileStatus =
  | 'waiting'
  | 'reading'
  | 'analysing'
  /** Analysed, not opened yet. */
  | 'ready'
  | 'opened'
  /** Its protected file was downloaded or its text copied. */
  | 'downloaded'
  /** It holds parts DocCloak cannot redact: the user opens it, decides and presses Redact. */
  | 'needs-decision'
  | 'failed';

/** What the list needs to know about a document without holding it. */
export interface DocumentSummary {
  /** The analysis of this text has finished. */
  analysed: boolean;
  /** Parts that cannot be redacted wait for the user's decision. */
  pending: boolean;
  /** Places found. */
  found: number;
  takenOut: boolean;
  /** The pairs of its table when it was last made: for the count on the page, never for a restore. */
  pairs: ReplacementEntry[];
}

export function summarise(doc: DocumentSnapshot, pairs: ReplacementEntry[]): DocumentSummary {
  return {
    analysed: doc.lastRunText !== null && doc.lastRunText === doc.text,
    pending: doc.unredactableItems.length > 0 && !doc.allowUnredactable,
    found: doc.entities.length,
    takenOut: doc.resultTakenOut,
    pairs,
  };
}

/** One file of the set, as the hook keeps it. */
export interface BatchFileRecord {
  /** Stable for the life of the set. */
  id: string;
  name: string;
  /** Where the queue is with it. 'done': it was read (see `summary`); 'failed': it could not be read. */
  stage: 'waiting' | 'reading' | 'analysing' | 'done' | 'failed';
  /** Why it failed, in the interface language. */
  reason?: string;
  /** The user has had it open. */
  opened: boolean;
  summary: DocumentSummary | null;
}

export function statusOf(file: BatchFileRecord): BatchFileStatus {
  if (file.stage !== 'done') return file.stage;
  const summary = file.summary;
  if (summary === null) return 'failed';
  if (summary.pending) return 'needs-decision';
  // Read, not analysed: the analysis failed, or the user has decided and has not pressed Redact yet.
  if (!summary.analysed) return file.reason ? 'failed' : 'needs-decision';
  if (summary.takenOut) return 'downloaded';
  return file.opened ? 'opened' : 'ready';
}

/** One row of the list. */
export interface BatchFileView {
  id: string;
  name: string;
  status: BatchFileStatus;
  /** Set for 'failed'. */
  reason?: string;
  /** Places found, once the file was analysed. */
  found: number | null;
  /** It is the document on the page. */
  open: boolean;
  /** It was read: it can be put on the page. */
  canOpen: boolean;
  /** Its protected result left the page. */
  takenOut: boolean;
}

export function viewOf(file: BatchFileRecord, activeId: string | null): BatchFileView {
  const status = statusOf(file);
  return {
    id: file.id,
    name: file.name,
    status,
    reason: status === 'failed' ? file.reason : undefined,
    found: file.stage === 'done' && file.summary?.analysed ? file.summary.found : null,
    open: file.id === activeId,
    canOpen: file.stage === 'done' && file.summary !== null,
    takenOut: file.summary?.takenOut ?? false,
  };
}

/** The file the queue is working on. */
export interface QueuePosition {
  /** 1-based place in the list. */
  index: number;
  total: number;
  name: string;
  phase: 'reading' | 'analysing';
}

/**
 * The pairs a table file of this session holds, exactly as "Save table" writes them for one
 * document (Core's serialize: restorable pairs only, so nothing of the blanked style).
 */
export function tablePairsOf(session: AnonymizationSession): ReplacementEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(session.serialize());
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const pairs: ReplacementEntry[] = [];
  for (const item of parsed as Array<{ original?: unknown; replacement?: unknown; entity_type?: unknown }>) {
    if (typeof item.original !== 'string' || typeof item.replacement !== 'string' || typeof item.entity_type !== 'string') continue;
    pairs.push({ original: item.original, replacement: item.replacement, entityType: item.entity_type as ReplacementEntry['entityType'] });
  }
  return pairs;
}

export type MergedPairs =
  | { ok: true; pairs: ReplacementEntry[] }
  /** More pairs than one table may hold: `count` of them. */
  | { ok: false; reason: 'too-many'; count: number }
  /** One label stands for two values in two files: a table of both would restore one of them wrongly. */
  | { ok: false; reason: 'conflict'; label: string };

/**
 * The tables of the files of a set as one: every pair once, in the order of the files. Refused,
 * never cut: a table with pairs missing would leave labels in a reply without a word.
 */
export function mergePairs(perFile: ReplacementEntry[][], maxPairs: number = TABLE_MAX_PAIRS): MergedPairs {
  const pairs: ReplacementEntry[] = [];
  const seen = new Set<string>();
  for (const entries of perFile) {
    for (const entry of entries) {
      const key = `${entry.original}\u0000${entry.replacement}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(entry);
    }
  }
  // Looked for across files only: what one file's own table holds is that document's business,
  // as it is for a single document.
  const first = new Map<string, { original: string; file: number }>();
  for (let file = 0; file < perFile.length; file++) {
    for (const entry of perFile[file]) {
      const held = first.get(entry.replacement);
      if (held === undefined) first.set(entry.replacement, { original: entry.original, file });
      else if (held.file !== file && held.original !== entry.original) return { ok: false, reason: 'conflict', label: entry.replacement };
    }
  }
  if (pairs.length > maxPairs) return { ok: false, reason: 'too-many', count: pairs.length };
  return { ok: true, pairs };
}

/** A table file of these pairs, in the format Core's serialize writes and its deserialize (and the command line) reads. */
export function tableJson(pairs: ReplacementEntry[]): string {
  return JSON.stringify(
    pairs.map(({ original, replacement, entityType }) => ({ original, replacement, entity_type: entityType })),
    null,
    2,
  );
}

/** The name a table of a set is saved under: the first file and how many more. */
export function setTableBaseName(names: string[]): string {
  const first = names[0]?.replace(/\.[^.]+$/, '').trim() || 'doccloak';
  return names.length > 1 ? `${first}_and_${names.length - 1}_more` : first;
}

/**
 * How many values the tables hold together (for the count shown on the page). Counted by value,
 * not by pair: a value keeps the count it has while a label typed for it reaches the other files.
 */
export function countValues(perFile: ReplacementEntry[][]): number {
  const seen = new Set<string>();
  for (const entries of perFile) {
    for (const entry of entries) seen.add(entry.original);
  }
  return seen.size;
}
