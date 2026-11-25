import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { DetectedEntity, EntityType, ReplacementEntry } from '@doccloak/core';
import {
  restartDetectionWorker,
  detectEntities,
  preloadModel,
  onDownloadProgress,
  setDetectionThreshold,
  getDetectionThreshold,
  getCustomLabels,
  setCustomLabels,
  switchProvider as engineSwitchProvider,
  getActiveProviderId,
  isRegexEnabled,
  setRegexEnabled,
  getRegexRegion,
  setRegexRegionSetting,
  applyUiLanguage,
  hasModelConsent,
  grantModelConsent,
  ConsentRequiredError,
  DetectionTimeoutError,
  DetectionAbortedError,
} from '../../engine.ts';
import { refreshRuntimeScripts } from '../../sw-register.ts';
import { appendEtaSample, etaSeconds, type EtaSample } from '../../lib/detection-eta.ts';
import type { RegexRegionId } from '@doccloak/core';
import type { ProviderId } from '@doccloak/core';
import { AnonymizationSession, canonicalPlaceholderForm, ENTITY_COLORS } from '@doccloak/core';
import type { RestoreSpan } from '@doccloak/core';
import type { ReplacementMode } from '@doccloak/core';
import {
  readDocx,
  writeAnonymizedDocxWithReport,
  writeRestoredDocxWithReport,
  readXlsx,
  writeAnonymizedXlsxWithReport,
  isExcelFile,
  isLegacyDoc,
  isSupportedFile,
  isUnsupportedDocumentError,
} from '@doccloak/core/dom';
import type { DocxExtraction, DocxWriteOptions, UnsupportedDocumentCode } from '@doccloak/core/dom';
import { readDocText, writeAnonymizedDoc, inspectDoc } from '@doccloak/core';
import { isImageFile, renderRedactedImage } from '@doccloak/core/dom';
import { loadImageToCanvas, ocrWorkersInEffect, recognizeCanvas, recognizePdfRegion, releasePdfOcr } from '../../ocr.web.ts';
// Type-only: '@doccloak/core/pdf' (pdf.js, pdf-lib, fontkit) is loaded with a
// dynamic import where it is needed so it stays out of the main chunk.
import type { PdfEdits, PdfExtraction, PdfRegion, RemovedPart } from '@doccloak/core/pdf';
import { isPdfFile, pdfAssets } from '../../pdf.web.ts';
import type { OcrWord } from '@doccloak/core/dom';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import type { Translations } from '../../i18n/types.ts';
import { useToast } from '../components/Toast.tsx';
import type { UnredactableItem } from '../components/UnredactableNotice.tsx';
import { localizeCoreNotes, pageList } from '../coreNotes.ts';
import { loadDictionary, saveDictionary, mergeDictionaryEntities, loadIgnoreList, saveIgnoreList, filterIgnoredEntities } from '../dictionary.ts';
import type { DictionaryEntry } from '../dictionary.ts';
import { loadKeepTypes, saveKeepTypes, isTableReminderOff, setTableReminderOff } from '../keepTypes.ts';
import { keptRangesInOutput } from '../keptRanges.ts';
import { addHandMarks, type HandMarkResult } from '../handMarks.ts';
import { leftoversIn, type KnownLabel, type RestoreContext } from '../restoreReport.ts';
import { useFeatureStrings } from '../../i18n/features/index.ts';
import { batchStrings } from '../../i18n/features/batch.ts';
import { pdfEditStrings } from '../../i18n/features/pdfEdit.ts';
import { exportRefusalStrings, type ExportRefusalStrings } from '../../i18n/features/exportRefusal.ts';
import { quotedValues, traceValues } from '../exportRefusal.ts';
import { addedRealText, hasNewUnredactable, keepsAPage, regionsOf, remapAfterEdit, takeEditNotes } from '../pdfEdits.ts';
import type { PdfEditStrings } from '../../i18n/features/pdfEdit.ts';
import {
  BATCH_MAX_FILES,
  TABLE_MAX_PAIRS,
  countValues,
  emptyDocument,
  mergePairs,
  setTableBaseName,
  summarise,
  tableJson,
  tablePairsOf,
  viewOf,
  type BatchFileRecord,
  type DocumentSnapshot,
  type QueuePosition,
} from '../batch.ts';

/**
 * Unpacked-size limit Core enforces on Office packages (T177, zip-bomb
 * guard). Quoted in the 'too-large' message; keep in sync with Core.
 */
export const UNPACKED_SIZE_LIMIT_LABEL = '200 MB';

/** Core's PDF caps (src/pdf/extract.ts DEFAULT_MAX_BYTES / DEFAULT_MAX_PAGES); keep in sync with Core. */
export const PDF_MAX_BYTES = 50 * 1024 * 1024;
export const PDF_SIZE_LIMIT_LABEL = '50 MB / 500 pages';

/** Stable file-refusal codes the UI can translate (Core codes + our own). */
export type FileErrorCode = UnsupportedDocumentCode | 'empty-document' | 'verify-failed' | 'stale-extraction';

/** Translated message with a one-line remedy for a refusal code. */
export function fileErrorMessage(t: Translations, code: FileErrorCode, kind: 'office' | 'pdf' = 'office'): string {
  if (code === 'too-large') {
    return kind === 'pdf' ? t.fileErrors['pdf-too-large'](PDF_SIZE_LIMIT_LABEL) : t.fileErrors['too-large'](UNPACKED_SIZE_LIMIT_LABEL);
  }
  if (code === 'invalid-package' && kind === 'pdf') return t.fileErrors['pdf-invalid'];
  return t.fileErrors[code];
}

/**
 * Refusal code of a reader/writer error, or null for untyped failures.
 * Core's typed errors are matched by name as well as instance so the check
 * works across the lazily loaded PDF chunk and mocked modules:
 * - UnsupportedDocumentError -> its code
 * - PdfVerifyError (T216): the post-write verification found a trace of an
 *   original value; the file is never shipped
 * - StalePdfExtractionError (T216): the bytes no longer produce the analysed
 *   text; the remedy is to upload the file again
 */
export function fileErrorCode(err: unknown): FileErrorCode | null {
  if (isUnsupportedDocumentError(err)) return err.code;
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
  if (name === 'PdfVerifyError') return 'verify-failed';
  if (name === 'StalePdfExtractionError') return 'stale-extraction';
  return null;
}

/**
 * A refusal the hook has already put into the user's language (T284: a page with a hidden area
 * that cannot be exported as a picture). It has no code of its own in fileErrors; its message is
 * what the user reads.
 */
export class TranslatedRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranslatedRefusal';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * What to tell the user when reading or writing a file was refused: the hook's own words for a
 * TranslatedRefusal, the translated message of a refusal code, or null for a failure nobody typed.
 */
export function refusalMessage(t: Translations, err: unknown, kind: 'office' | 'pdf' = 'office', refusalText?: ExportRefusalStrings): string | null {
  const name = typeof err === 'object' && err !== null ? (err as { name?: unknown }).name : undefined;
  if (name === 'TranslatedRefusal') return (err as Error).message;
  const code = fileErrorCode(err);
  if (!code) return null;
  const message = fileErrorMessage(t, code, kind);
  // T288: a refusal of the writer's own check names the values it found again, and the way out.
  const values = refusalText ? traceValues(err) : [];
  return values.length > 0 ? `${message} ${refusalText!.traceValues(quotedValues(values), values.length)}` : message;
}

// 1-based page numbers as a short list for notes (T236); lives with the other note helpers.
export { pageList };

/** Core's PDF module, loaded with a dynamic import (see the type-only import above). */
type PdfModule = typeof import('@doccloak/core/pdf');

/** A PDF as it was read: no page left out, no area hidden. */
const NO_PDF_EDITS: PdfEdits = {};

/**
 * The notes of a PDF as it is now: what its pages are (scans, pages read by DocCloak's own OCR,
 * text that could not be read) and the reader's own notes. Made when the file is read and again
 * after every hand edit (T284): a page that is left out is not spoken of. `pdfText`: the strings
 * of the page view, for the notes hand edits bring.
 */
export function pdfReadNotes(t: Translations, extraction: PdfExtraction, pdfText?: PdfEditStrings): string[] {
  const pagesWhere = (keep: (p: PdfExtraction['pages'][number]) => boolean): number[] =>
    extraction.pages.filter((p) => !p.removed && keep(p)).map((p) => p.index + 1);
  // Scan pages with an OCR text layer (T236): their values are painted over in the picture on export.
  const scanned = pagesWhere((p) => p.ocrText && !p.ocrWholePage);
  const notes = scanned.length > 0 ? [t.pdf.scanPagesFound(pageList(scanned), scanned.length)] : [];
  // T239: pages without any text layer, read whole by DocCloak's own OCR.
  const whole = pagesWhere((p) => (p.ocrWholePage ?? 0) > 0);
  if (whole.length > 0) notes.push(t.pdf.ocrWholePage(pageList(whole), whole.length));
  // T238: text in a scan's picture its OCR layer does not have: read by DocCloak's own OCR, or left as it is.
  const readByUs = pagesWhere((p) => p.ocrText && !p.ocrWholePage && (p.ocrReadWords ?? 0) > 0);
  if (readByUs.length > 0) notes.push(t.pdf.ocrRead(pageList(readByUs), readByUs.length));
  const unread = pagesWhere((p) => p.ocrText && !p.ocrWholePage && (p.ocrMissingLines ?? 0) > 0 && !p.ocrReadWords);
  if (unread.length > 0) notes.push(t.pdf.ocrMissing(pageList(unread), unread.length));
  // T239: text inside images on text pages: read by DocCloak's own OCR, or left as it is.
  const inImages = pagesWhere((p) => !p.imageOnly && (p.ocrReadWords ?? 0) > 0);
  if (inImages.length > 0) notes.push(t.pdf.ocrInImages(pageList(inImages), inImages.length));
  const imagesUnread = pagesWhere((p) => !p.imageOnly && (p.ocrMissingLines ?? 0) > 0 && !p.ocrReadWords);
  if (imagesUnread.length > 0) notes.push(t.pdf.imagesTextUnread(pageList(imagesUnread), imagesUnread.length));
  // Core's own notes; those about hand edits are said in the page view's words.
  const core = takeEditNotes(extraction.warnings);
  if (pdfText && core.textStaysPages.length > 0) notes.push(pdfText.areaTextStays(pageList(core.textStaysPages), new Set(core.textStaysPages).size));
  return [...notes, ...localizeCoreNotes(t, core.rest)];
}

/** 1-based pages named by the details of a writer refusal ("page 3"), or null when one of them is not a page. */
function refusedPages(details: string[]): number[] | null {
  const pages: number[] = [];
  for (const detail of details) {
    const m = /^page (\d+)$/.exec(detail);
    if (!m) return null;
    pages.push(Number(m[1]));
  }
  return pages.length > 0 ? pages : null;
}

/** Download name of the redacted PDF: `<base>_redacted.pdf` (T216). */
export function pdfDownloadName(fileName: string | null | undefined): string {
  const base = fileName?.replace(/\.pdf$/i, '').trim() || 'document';
  return `${base}_redacted.pdf`;
}

/**
 * Download name of a docx with the names restored: `<base>_restored.docx`, or
 * `<base>_partly-restored.docx` when labels stayed in it (WLojek/DocCloak#3).
 */
export function restoredDownloadName(fileName: string | null | undefined, labelsLeft = false): string {
  const base = fileName?.replace(/\.docx$/i, '').replace(/[_-]redacted$/i, '').trim() || 'document';
  // A file that still holds labels says so in its name: "_restored" on it reads as finished.
  return `${base}_${labelsLeft ? 'partly-restored' : 'restored'}.docx`;
}

/**
 * Download name of the replacement table of a document (WLojek/DocCloak#3):
 * `<document>_replacement-table_<date>_<time>.json`. The document and the
 * moment are in the name because every table holds a [PERSON_1]: the name is
 * how the user tells two tables apart months later.
 */
export function mappingDownloadName(fileName: string | null | undefined, now: Date = new Date()): string {
  const base = fileName?.replace(/\.[^.]+$/, '').trim() || 'doccloak';
  const two = (n: number) => String(n).padStart(2, '0');
  // To the second: two tables saved within a minute (before and after a rename) are two files.
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return `${base}_replacement-table_${stamp}.json`;
}

/** The state of a pasted text that "Clear" takes away and its Undo brings back. */
export interface TextSnapshot {
  text: string;
  entities: DetectedEntity[];
  excluded: Set<number>;
  renames: Map<string, string>;
  /** The categories the user chose for values of this text. */
  types: Map<string, EntityType>;
  lastRunText: string | null;
  dropped: DetectedEntity[];
  tableSaved: boolean;
  /**
   * Which document was on the page when this was taken (see docEpoch in the hook). Undo brings the
   * text back only while no other document was put on the page since: its list would otherwise
   * land on a file it was not made for.
   */
  epoch?: number;
}

/** One pair of a table, shown next to its name so the user can tell whose table it is. */
export interface MappingSample {
  replacement: string;
  original: string;
}

/** A stretch of restored text: as it was, an original that was put back, or a label that stayed. */
export interface RestoredSegment {
  text: string;
  kind: 'plain' | 'restored' | 'leftover';
}

/** Result of restoring pasted text: the text, how many places changed, and the labels that stayed. */
export interface RestoreTextResult {
  text: string;
  restored: number;
  unresolved: string[];
  /** The same text in pieces, so the panel can mark what came back and what stayed. */
  segments: RestoredSegment[];
  /** Labels left that this tab issued earlier and that are not in the table now: what they stood for. */
  stale?: KnownLabel[];
  /** Other text in brackets that remains; not known to be a label. */
  others?: string[];
  /** A table from a file restored labels that also stand for other values of the open document. */
  fileOverDocument?: boolean;
}

/** What the reader did with a workbook, and what the export changed (T265). */
export interface XlsxInfo {
  dateCells: number;
  identifierCells: number;
  otherNumberCells: number;
  /** New names of sheets renamed by the last export. */
  renamedSheets: string[];
  /** The number cells that were not checked: sheet, address, value (the first 200). */
  unchecked: Array<{ sheet: string; cell: string; value: string }>;
}

/** Split `text` at every occurrence of the given tokens (longest first), marking them as leftovers. */
function markLeftovers(text: string, tokens: string[]): RestoredSegment[] {
  if (tokens.length === 0 || text.length === 0) return text.length > 0 ? [{ text, kind: 'plain' }] : [];
  const ordered = [...tokens].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(ordered.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const out: RestoredSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push({ text: text.slice(last, match.index), kind: 'plain' });
    out.push({ text: match[0], kind: 'leftover' });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain' });
  return out;
}

/**
 * Letters and digits of the numbered labels DocCloak issues ("person4", "creditcard2",
 * "person1last", "person3last2"), whatever is written between them. A label typed by hand in
 * that shape is refused: an assistant that tidies "[PERSON.4]" writes "[PERSON_4]", and that is
 * the next person's label.
 */
const OWN_LABEL_SHAPE = new RegExp(
  `^(${[...Object.keys(ENTITY_COLORS), 'REDACTED'].map((type) => type.toLowerCase().replace(/[^a-z0-9]/g, '')).join('|')})\\d+((first|last|middle|short|full|alt)\\d*)*$`,
);
const labelSkeleton = (label: string) => label.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Short text in square or double angle brackets, as a document can hold it: the two forms in which
 * restore reads a renamed label ("(Client)", "{Client}" and a bare word are left alone by it).
 * A typed label must not be one of these.
 */
const BRACKETED_IN_TEXT = /\[[^[\]\n]{1,60}\]|<<[^<>\n]{1,60}>>/g;

/** Characters a selection made by hand is trimmed of at both ends. */
const SELECTION_EDGE = /[\s.,;:!?()[\]{}"'„”“«»]/;
/** A letter or digit: an occurrence of a marked text inside a longer word is not one. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Marks a placeholder entry that only reserves a label while the numbers are issued; no value starts with it. */
const RESERVED_PREFIX = '\u0000reserved:';

/** A replacement table is a few kilobytes; anything near this is not one. */
export const MAPPING_MAX_BYTES = 5 * 1024 * 1024;

/** Result of restoring the names in an uploaded docx (WLojek/DocCloak#3). */
export type RestoreDocxResult =
  | {
      success: true;
      /** Placeholders replaced with their original value. */
      restored: number;
      /** Placeholder-like tokens the table does not know; they stay in the file. */
      unresolved: string[];
      /** As in RestoreTextResult. */
      stale?: KnownLabel[];
      others?: string[];
      fileOverDocument?: boolean;
      /** The restored file; null when the file held no placeholder of the table (nothing to download). */
      blob: Blob | null;
      downloadName: string;
    }
  | { success: false; message: string };

/** A replacement table loaded from a file: it drives the restore until removed or the next redaction. */
export interface ImportedMapping {
  fileName: string;
  count: number;
  /** The first pair of the file. */
  sample: MappingSample | null;
}

interface OffsetReplacement { start: number; end: number; replacement: string }
interface ValueReplacement { value: string; replacement: string }

/**
 * Offset replacements (from the detected spans) and value-level pairs (for
 * places offsets cannot reach: hyperlink targets, field instructions, PDF
 * metadata) for the active entities. Fails closed: an entity without a
 * mapping aborts the export instead of writing its original value.
 */
function replacementsFor(
  entities: DetectedEntity[],
  excluded: Set<number>,
  session: AnonymizationSession,
): { replacements: OffsetReplacement[]; valueReplacements: ValueReplacement[] } {
  const activeEntities = entities.filter((_, i) => !excluded.has(i));
  const replacements = activeEntities.map((entity) => {
    const replacement = session.getForward(entity.value);
    if (replacement === undefined) {
      // Fail closed: never write an original value into a redacted export
      throw new Error('Missing replacement mapping for a detected entity');
    }
    return { start: entity.start, end: entity.end, replacement };
  });
  const valueReplacements = activeEntities.map((entity) => ({
    value: entity.value,
    replacement: session.getForward(entity.value) ?? '',
  }));
  return { replacements, valueReplacements };
}

/** Download name of the redacted workbook: `<base>_redacted.xlsx` (T265). */
export function xlsxDownloadName(fileName: string | null | undefined): string {
  const base = fileName?.replace(/\.xlsx$/i, '').trim() || 'workbook';
  return `${base}_redacted.xlsx`;
}

/** Where a value stands in the text: what a re-run of the same text uses to find the user's choices again. */
function placeKey(entity: DetectedEntity): string {
  return `${entity.start}:${entity.end}:${entity.value}`;
}

/**
 * The numbered labels of one category, as the session issues them: "[PHONE_2]", and for a person
 * also the label of a part of the name ("[PERSON_2_LAST]", "[PERSON_2_LAST_2]").
 */
function numberedLabelOf(type: EntityType): RegExp {
  return new RegExp(`^\\[${type}_\\d+${type === 'PERSON' ? '(?:_(?:FIRST|LAST|MIDDLE|SHORT|FULL|ALT)(?:_\\d+)?)?' : ''}\\]$`);
}

/** What the user had decided in the previous run of the same text, found again by place. */
interface EarlierRun {
  /** Every place of the previous list. */
  places: Set<string>;
  /** The places that were found and not redacted. */
  kept: Set<string>;
  /** The values marked by hand. */
  manual: DetectedEntity[];
}

/**
 * The list of a finished detection: what the detector found, with the dictionary, the ignore list,
 * the types set to never be anonymized, the categories the user chose and (for a re-run of the same
 * text) the earlier choices worked in. One function for the Redact button and for the queue of a
 * set, so a file analysed in the queue gets exactly the list it would get on its own.
 */
function mergeDetection(
  text: string,
  results: DetectedEntity[],
  options: {
    dictionary: DictionaryEntry[];
    ignoreList: DictionaryEntry[];
    neverTypes: ReadonlySet<EntityType>;
    typeChoices: ReadonlyMap<string, EntityType>;
    earlier: EarlierRun | null;
  },
): { entities: DetectedEntity[]; excluded: Set<number>; retyped: number } {
  const { dictionary, ignoreList, neverTypes, typeChoices, earlier } = options;
  // The categories the user chose (WLojek/DocCloak#5) come back before anything
  // else looks at a type: the detector reports its own category again, and the value would
  // stand in the list under the category the user had corrected, next to its new label.
  let retyped = 0;
  const withChosenTypes = (list: DetectedEntity[]): DetectedEntity[] => {
    if (typeChoices.size === 0) return list;
    return list.map((entity) => {
      const type = typeChoices.get(entity.value);
      if (type === undefined || type === entity.type) return entity;
      retyped++;
      return { ...entity, type };
    });
  };
  // Not redacted: what the user kept in the previous run of this text; for anything new,
  // the types set to never be anonymized (T263). A dictionary word or a hand-marked value is
  // an explicit "redact this" and is never switched off by the type setting.
  const keptNow = (entity: DetectedEntity): boolean => {
    const key = placeKey(entity);
    if (earlier?.places.has(key)) return earlier.kept.has(key);
    return neverTypes.has(entity.type) && entity.detector !== 'dictionary' && entity.detector !== 'manual';
  };
  // Dictionary words are always redacted: a term takes the place of the finds it touches
  // (it used to lose every overlap, and the part only the term covered stayed readable).
  // The ignore list is applied last so a listed term is never
  // anonymized, whichever tier found it.
  // A dictionary word comes with the category of the dictionary: the choice made in this
  // text holds for it as well. Marks made by hand are left as they are: each carries the
  // category the user gave it last.
  const detected = withChosenTypes(filterIgnoredEntities(
    text,
    mergeDictionaryEntities(text, withChosenTypes(results), dictionary, keptNow),
    ignoreList,
  ));
  // Values the user marked by hand come back. A mark that is redacted takes the place of
  // what this run found under it, as it did when it was made (it used to be dropped when a
  // find touched it, and the part only the mark covered became readable without a word).
  // A mark the user had set to not redact comes back only where nothing found covers it.
  const previousManual = earlier?.manual ?? [];
  const wasKept = (mark: DetectedEntity): boolean => earlier?.kept.has(placeKey(mark)) ?? false;
  const marks = previousManual.filter((m) => !wasKept(m));
  const merged = addHandMarks(text, detected, keptNow, marks).entities;
  const idle = previousManual.filter((m) => wasKept(m) && !merged.some((e) => e.start < m.end && e.end > m.start));
  const entities = idle.length > 0 ? [...merged, ...idle].sort((a, b) => a.start - b.start) : merged;
  const excluded = new Set<number>();
  entities.forEach((entity, index) => {
    if (keptNow(entity)) excluded.add(index);
  });
  return { entities, excluded, retyped };
}

/** A document that was read: what goes on the page. Or the reason it could not be read. */
type ReadResult = { ok: true; doc: DocumentSnapshot } | { ok: false; result: LoadFileResult };

/** The table that restores, with what the report of leftovers needs to know about the documents. */
interface RestoreScope {
  session: AnonymizationSession;
  /** The table came from a file: this tab knows nothing else about its labels. */
  fromFile: boolean;
  /** The source text of every document the table belongs to (one, or the files of the set). */
  texts: string[];
  /** Every value found in those documents, redacted or not. */
  values: Set<string>;
  /** Set when the table of a set could not be made: nothing is restored, and this is said. */
  refusal?: string;
}

/** Limits a test can lower (the real ones would need thousands of values to reach). */
export interface AnonymizerOptions {
  /** Pairs one table may hold; Core's limit by default. */
  maxTablePairs?: number;
  /** Files one set may hold. */
  maxBatchFiles?: number;
}

/** Result of loadFile: `code` + `message` are set for typed refusals. */
export interface LoadFileResult {
  success: boolean;
  /** Raw error text or a legacy sentinel ('unsupported', 'no-text'). */
  error?: string;
  code?: FileErrorCode;
  /** Translated, user-facing message when `code` is set. */
  message?: string;
}

export type DetectionErrorKind = 'failed' | 'timeout';

/** Core's WebGpuUnavailableError, which reaches the page as its message through the worker. */
function needsWebGpu(err: unknown): boolean {
  return /needs WebGPU/.test(err instanceof Error ? err.message : String(err));
}

/** A model load that failed because the browser refused a runtime script (ONNX Runtime's .mjs). */
export function isRuntimeImportError(err: unknown): boolean {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return /import(ing)? a module script failed|dynamically imported module|module script|MIME type|no available backend/i.test(message);
}

export function useAnonymizer(options: AnonymizerOptions = {}) {
  const { language, t } = useTranslation();
  const batchText = useFeatureStrings(batchStrings);
  const pdfText = useFeatureStrings(pdfEditStrings);
  const refusalText = useFeatureStrings(exportRefusalStrings);
  const { showToast } = useToast();
  const maxTablePairs = options.maxTablePairs ?? TABLE_MAX_PAIRS;
  const maxBatchFiles = options.maxBatchFiles ?? BATCH_MAX_FILES;
  const [inputText, setInputText] = useState('');
  const [anonymizedText, setAnonymizedText] = useState('');
  const [entities, setEntities] = useState<DetectedEntity[]>([]);
  const [entries, setEntries] = useState<ReplacementEntry[]>([]);
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  // First-visit gate: the model download starts only after the user accepts.
  // Once accepted, later visits load (from cache) without asking again. The
  // engine enforces the same flag (ConsentRequiredError), this mirror only
  // drives the UI.
  const [modelConsented, setModelConsented] = useState(hasModelConsent);
  // Model chosen before consent (preselection): the consent card names it and
  // Accept switches to it instead of loading the saved default.
  const [pendingProvider, setPendingProvider] = useState<ProviderId | null>(null);
  const [modelError, setModelError] = useState(false);
  // The active model runs only on WebGPU and this browser has no usable adapter (T242).
  const [modelNeedsWebGpu, setModelNeedsWebGpu] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [detectionProgress, setDetectionProgress] = useState<number | null>(null);
  /** T222: seconds left in the running detection, once the rate is measurable. */
  const [detectionEta, setDetectionEta] = useState<number | null>(null);
  /** T222: controller of the running detection; cancelAnonymize aborts it. */
  const abortRef = useRef<AbortController | null>(null);
  const etaSamplesRef = useRef<EtaSample[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [detectionErrorKind, setDetectionErrorKind] = useState<DetectionErrorKind | null>(null);
  const [threshold, setThreshold] = useState(getDetectionThreshold());
  const [replacementMode, setReplacementModeState] = useState<ReplacementMode>('labeled');
  const [customLabels, setCustomLabelsState] = useState<string[]>(getCustomLabels());
  const [activeProvider, setActiveProvider] = useState<ProviderId>(getActiveProviderId());
  const [regexRules, setRegexRulesState] = useState(isRegexEnabled());
  const [regexRegion, setRegexRegionState] = useState<RegexRegionId>(getRegexRegion());
  const [dictionary, setDictionaryState] = useState<DictionaryEntry[]>(loadDictionary);
  const [ignoreList, setIgnoreListState] = useState<DictionaryEntry[]>(loadIgnoreList);
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [docxFileName, setDocxFileName] = useState<string | null>(null);
  // Spreadsheet (T265): the File is kept, the writer reads it again (same as docx).
  const [xlsxFile, setXlsxFileState] = useState<File | null>(null);
  const [xlsxInfo, setXlsxInfo] = useState<XlsxInfo | null>(null);
  const setXlsxFile = useCallback((file: File | null) => {
    setXlsxFileState(file);
    if (file === null) setXlsxInfo(null);
  }, []);
  // Types that are never anonymized (T263): stored on this device, applied after every detection.
  const [keepTypes, setKeepTypesState] = useState<EntityType[]>(loadKeepTypes);
  const keepTypesRef = useRef(keepTypes);
  keepTypesRef.current = keepTypes;
  // The list of detections as it is now, for callbacks that outlive a render (toast buttons).
  const entitiesLiveRef = useRef(entities);
  entitiesLiveRef.current = entities;
  const excludedLiveRef = useRef(excludedIndices);
  excludedLiveRef.current = excludedIndices;
  const inputTextLiveRef = useRef(inputText);
  inputTextLiveRef.current = inputText;
  const addEntitiesRef = useRef<(added: DetectedEntity[]) => void>(() => {});
  // Places that were redacted before the last run of the same text and are not found by it.
  const [droppedPlaces, setDroppedPlaces] = useState<DetectedEntity[]>([]);
  // Source texts whose protected result was copied or downloaded in this tab.
  const takenOutTextsRef = useRef(new Set<string>());
  // The text of the last finished detection: a re-run on the same text keeps what the user chose (T261).
  const lastRunTextRef = useRef<string | null>(null);
  // Replacement table reminder (T261): once the protected result left the page (download or copy),
  // closing the tab loses the only way back to the names unless the table was saved.
  const [resultTakenOut, setResultTakenOut] = useState(false);
  const resultTakenOutRef = useRef(false);
  resultTakenOutRef.current = resultTakenOut;
  // One word, once per copy, when the result changes after it left the page.
  const changeNoticedRef = useRef(false);
  const sayChangedRef = useRef<() => void>(() => {});
  sayChangedRef.current = () => showToast(t.textOutput.changedAfterTaken);
  const sayRenameDroppedRef = useRef<(label: string, holder: string | null) => void>(() => {});
  // Held by another value, or (no holder) standing in the document's own text.
  sayRenameDroppedRef.current = (label, holder) => showToast(holder === null ? t.entityTable.labelInText(label) : t.entityTable.labelTaken(label, holder));
  const unstableNoticedRef = useRef(false);
  const sayUnstableRef = useRef<() => void>(() => {});
  sayUnstableRef.current = () => showToast(t.entityTable.labelsNotStable);
  const [tableSaved, setTableSaved] = useState(false);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [reminderOff, setReminderOff] = useState(isTableReminderOff);
  // PDF (T216): the parsed extraction lives in a ref (the writer re-extracts
  // from its bytes, so the File is not needed again); the name and the parts
  // the writer drops are state because the UI shows them.
  const [pdfFileName, setPdfFileName] = useState<string | null>(null);
  const [pdfRemoved, setPdfRemoved] = useState<RemovedPart[]>([]);
  const pdfExtractionRef = useRef<PdfExtraction | null>(null);
  // Hand edits (T284, WLojek/DocCloak.Core#6): pages left out and areas hidden. The extraction on
  // the page carries them (it is the EDITED one, with the file as read inside it); the page view
  // needs it as state, with what the edits paint over (Core's `covered`). The ref above stays the
  // truth for everything that runs between two renders.
  const [pdfView, setPdfView] = useState<{ extraction: PdfExtraction; covered: PdfRegion[] } | null>(null);
  const pdfCoveredRef = useRef<PdfRegion[]>([]);
  const pdfModuleRef = useRef<PdfModule | null>(null);
  /** Put a PDF (or none) on the page: the ref, what its edits cover, and the state the page view shows. */
  const showPdf = useCallback((extraction: PdfExtraction | null, covered: PdfRegion[]) => {
    pdfExtractionRef.current = extraction;
    pdfCoveredRef.current = extraction ? covered : [];
    setPdfView(extraction ? { extraction, covered } : null);
  }, []);
  // PDF exports that are running, also outside a set: the pages are not edited under them.
  const [pdfExports, setPdfExports] = useState(0);
  const pdfExportsRef = useRef(0);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  // T239: while DocCloak's OCR reads the pages of a PDF, how far it is.
  const [ocrPages, setOcrPages] = useState<{ done: number; total: number } | null>(null);
  // Informed-consent export (T177): parts the writer cannot redact, reader
  // warnings, and whether the user chose Continue for this file.
  const [unredactableItems, setUnredactableItems] = useState<UnredactableItem[]>([]);
  const [fileWarnings, setFileWarnings] = useState<string[]>([]);
  const [allowUnredactable, setAllowUnredactable] = useState(false);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ocrWordsRef = useRef<OcrWord[]>([]);
  const sessionRef = useRef(new AnonymizationSession());
  const latestRequestRef = useRef(0);
  // Labels the user renamed, by original value, in the order they were set. A rebuild issues the
  // numbered placeholders again, so they are applied again after it (a rename used to be lost on
  // the next checkbox).
  const labelRenamesRef = useRef(new Map<string, string>());
  // WLojek/DocCloak#5: the category the user chose for a value of this text, by value. The detector
  // reports its own category again on every run; a re-run on the same text puts the choice back.
  // It lives and dies with the renamed labels: one text, one set of choices.
  const typeChoicesRef = useRef(new Map<string, EntityType>());
  // Values whose label the user renamed: the list offers the way back to the numbered one.
  const [renamedOriginals, setRenamedOriginals] = useState<ReadonlySet<string>>(new Set());
  // Every numbered label issued in this tab, also for values that are not redacted now: a value
  // keeps its label whatever else changes in the list, in the text, or when the text is cleared and
  // redacted again (emptied on a new text, it gave a corrected text new numbers, and a reply written
  // from the earlier copy came back with other people's names). New values take the next numbers.
  const issuedLabelsRef = useRef<ReplacementEntry[]>([]);
  // Every label this tab has shown, numbered or typed by hand, by the form restore compares labels
  // in ("[PERSON_2]", "[person 2]" and "Person-2" are one). It answers two questions: may this
  // label be given to that value (never, if it stood for another one), and what did a label left
  // in a reply stand for.
  const everLabelsRef = useRef(new Map<string, KnownLabel>());
  const rememberLabels = useCallback((session: AnonymizationSession) => {
    for (const entry of [...issuedLabelsRef.current, ...session.getEntries()]) {
      const form = canonicalPlaceholderForm(entry.replacement);
      // The first value a label stood for keeps it: nothing may change what a copy already out means.
      if (form !== null && entry.replacement !== '________' && !everLabelsRef.current.has(form)) {
        everLabelsRef.current.set(form, { label: entry.replacement, original: entry.original });
      }
    }
  }, []);
  // Counts the changes of the document's table, so views of an older table can let go of it.
  const [tableVersion, setTableVersion] = useState(0);
  const replacementModeRef = useRef<ReplacementMode>('labeled');
  // WLojek/DocCloak#3: a replacement table loaded from a file. While it is set the restore
  // (pasted text and docx) uses it instead of the current document's table; it never touches the
  // session that anonymizes.
  const importedSessionRef = useRef<AnonymizationSession | null>(null);
  const [importedMapping, setImportedMapping] = useState<ImportedMapping | null>(null);

  // --- A set of files (WLojek/DocCloak#6) ---
  // The list of the set. The ref is the truth (the queue reads it between two renders); the state
  // follows it for the page.
  const [batchFiles, setBatchFiles] = useState<BatchFileRecord[]>([]);
  const batchFilesRef = useRef<BatchFileRecord[]>([]);
  const updateBatchFiles = useCallback((change: (files: BatchFileRecord[]) => BatchFileRecord[]) => {
    batchFilesRef.current = change(batchFilesRef.current);
    setBatchFiles(batchFilesRef.current);
  }, []);
  // The documents of the set that are NOT on the page, by file id. The one on the page lives in the
  // state of this hook and nowhere else, so there is never a second, older copy of it to use by mistake.
  const batchDocsRef = useRef(new Map<string, DocumentSnapshot>());
  // The files that are still to be read.
  const batchSourcesRef = useRef(new Map<string, File>());
  const batchSeqRef = useRef(0);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef<string | null>(null);
  // The queue: one file after another, read and then analysed.
  const [queueRunning, setQueueRunning] = useState(false);
  const queueRunningRef = useRef(false);
  const queueStopRef = useRef(false);
  const [queuePaused, setQueuePaused] = useState(false);
  const [queuePosition, setQueuePosition] = useState<QueuePosition | null>(null);
  // Exports of the open file that are running: a file is not switched or removed under them.
  const [exportsRunning, setExportsRunning] = useState(0);
  const exportsRunningRef = useRef(0);
  // Counts the documents that were put on the page. A callback made for one document does nothing
  // (an export: fails) once another document is there: its indices and offsets are not that
  // document's.
  const [docEpoch, setDocEpoch] = useState(0);
  const docEpochRef = useRef(0);
  // A label typed in one file of the set that another file cannot use: said once per file.
  const saidNotKeptRef = useRef(new Set<string>());
  // The label being typed now: if the open file cannot take it, it is refused as a whole.
  const renameInHandRef = useRef<string | null>(null);
  // The labels of the set could not be kept stable (more values than a table holds): no table of the set.
  const setUnstableRef = useRef(false);
  // Said once after a file was taken out: a label or type changed for the whole set.
  const setChangeNoticedRef = useRef(false);
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);

  const unredactablePending = unredactableItems.length > 0 && !allowUnredactable;
  // The document on the page as the last render knew it, in one object (see takeDocument).
  const docStateRef = useRef({ docxFile, xlsxFile, xlsxInfo, pdfFileName, pdfRemoved, imageFileName, unredactableItems, fileWarnings, allowUnredactable, droppedPlaces });
  docStateRef.current = { docxFile, xlsxFile, xlsxInfo, pdfFileName, pdfRemoved, imageFileName, unredactableItems, fileWarnings, allowUnredactable, droppedPlaces };
  // What the queue needs as it is now, not as it was when the queue started.
  const liveRef = useRef({ t, batchText, pdfText, dictionary, ignoreList, language });
  liveRef.current = { t, batchText, pdfText, dictionary, ignoreList, language };

  // Set once the runtime scripts were fetched again after a failed load (at most once a session).
  const runtimeRecoveryRef = useRef(false);
  const startModelLoadRef = useRef<(() => void) | null>(null);

  // Load (or retry loading) the detection model with progress tracking.
  // Goes through the engine's consent gate: without the stored flag the
  // engine refuses, and the UI falls back to the consent card.
  const startModelLoad = useCallback(() => {
    setModelLoading(true);
    setModelError(false);

    onDownloadProgress((downloaded, total) => {
      setDownloadProgress({ downloaded, total });
    });

    preloadModel()
      .then(() => {
        setModelLoaded(true);
        setModelLoading(false);
        setDownloadProgress(null);
        setCustomLabelsState(getCustomLabels());
      })
      .catch((err: unknown) => {
        setModelLoading(false);
        setDownloadProgress(null);
        if (err instanceof ConsentRequiredError) {
          setModelConsented(false);
          setPendingProvider(err.providerId);
          return;
        }
        // T251 (WLojek/DocCloak#2): a runtime script the browser refused (kept in its HTTP cache
        // under a wrong type, a 304 does not bring the type back) is fetched again once per
        // session, past that cache, and the model loaded again in a fresh worker. Nothing is
        // deleted, so offline this only costs a failed fetch.
        if (!runtimeRecoveryRef.current && isRuntimeImportError(err) && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
          runtimeRecoveryRef.current = true;
          console.warn('[DocCloak] The model runtime failed to load; fetching it again:', err);
          void refreshRuntimeScripts().then(() => {
            restartDetectionWorker();
            startModelLoadRef.current?.();
          });
          setModelLoading(true);
          return;
        }
        console.error('Model loading failed:', err);
        setModelNeedsWebGpu(needsWebGpu(err));
        setModelError(true);
      });
  }, []);
  startModelLoadRef.current = startModelLoad;

  // Preload the detection model on mount, but only when the user has already
  // accepted the one-time download on an earlier visit.
  useEffect(() => {
    if (hasModelConsent()) startModelLoad();
  }, [startModelLoad]);

  // Switch the engine to `id` (download or cache read). Shared by the
  // settings selector (after consent) and the Accept button (preselection).
  const switchTo = useCallback(async (id: ProviderId) => {
    setModelLoading(true);
    setModelLoaded(false);
    setModelError(false);
    setDownloadProgress(null);
    try {
      await engineSwitchProvider(id, (downloaded, total) => {
        setDownloadProgress({ downloaded, total });
      });
      setActiveProvider(id);
      setPendingProvider(null);
      setModelLoaded(true);
      setModelLoading(false);
      setDownloadProgress(null);
      setCustomLabelsState(getCustomLabels());
      setThreshold(getDetectionThreshold());
    } catch (err) {
      setModelLoading(false);
      setDownloadProgress(null);
      if (err instanceof ConsentRequiredError) {
        setModelConsented(false);
        setPendingProvider(id);
        return;
      }
      console.error('Model switch failed:', err);
      setModelNeedsWebGpu(needsWebGpu(err));
      setModelError(true);
    }
  }, []);

  // First-visit accept: persist the choice, then load the preselected model
  // (switch) or the saved default (preload). Exactly one engine call.
  const acceptModelDownload = useCallback(() => {
    grantModelConsent();
    setModelConsented(true);
    const target = pendingProvider;
    setPendingProvider(null);
    if (target && target !== activeProvider) {
      void switchTo(target);
    } else {
      startModelLoad();
    }
  }, [pendingProvider, activeProvider, switchTo, startModelLoad]);

  /** The entities of a document with the categories the user chose for their values (set-wide in a set). */
  const withTypeChoices = useCallback((list: DetectedEntity[]): DetectedEntity[] => {
    const choices = typeChoicesRef.current;
    if (choices.size === 0) return list;
    let changed = false;
    const next = list.map((entity) => {
      const type = choices.get(entity.value);
      if (type === undefined || type === entity.type) return entity;
      changed = true;
      return { ...entity, type };
    });
    return changed ? next : list;
  }, []);

  /**
   * The labels of one document, made in `session` from the labels of the tab: the part of a
   * rebuild that touches no state of the page. It is what the page runs for the open document
   * (with its own session), and what a file of a set that is NOT open is run through to get its
   * table and its labels as they would be if it were opened now (with a session of its own).
   *
   * Returns the protected text and the hand-typed labels this document could not take.
   * `background`: the document is not on the page. Then a failure of the stable labels is thrown to
   * the caller instead of being worked around, and nothing is said.
   */
  const buildLabels = useCallback(
    (session: AnonymizationSession, text: string, allEntities: DetectedEntity[], excluded: Set<number>, background: boolean): { text: string; notKept: Array<{ original: string; label: string; holder: string | null }> } => {
      const inSet = batchFilesRef.current.length > 0;
      session.clear();
      const activeEntities = allEntities.filter((_, i) => !excluded.has(i));
      // A label belongs to its value for the life of the document. The numbers used to be issued
      // again on every change, so un-redacting one person renumbered the people after it: a reply
      // written from a text copied before the change was restored with other people's names, under
      // an all-clear. The labels are now issued over the whole list (what is not redacted keeps its
      // number reserved) and the table of the document takes only what is redacted now, with those
      // labels. A label of a value that is no longer redacted is reported as left over.
      if (replacementModeRef.current === 'labeled') {
        try {
          // Every label this tab ever showed is taken, also one typed by hand and since taken back
          // or replaced: "[PERSON_4]" typed for a client and copied must never become the label of
          // the next person found (it did, and the reply came back with that person's name).
          // Taken means taken in the form restore compares labels in: "[person 4]" typed by hand
          // takes "[PERSON_4]", the only spelling the numbering issues for that form.
          const issued = new Set(issuedLabelsRef.current.map((entry) => entry.replacement));
          const reserved = new Set<string>();
          for (const [form, known] of everLabelsRef.current) {
            if (!issued.has(known.label)) reserved.add(known.label);
            const asIssued = `[${form.toUpperCase()}]`;
            if (!issued.has(asIssued)) reserved.add(asIssued);
          }
          const ownerOf = (label: string): string | undefined => {
            const form = canonicalPlaceholderForm(label);
            return form === null ? undefined : everLabelsRef.current.get(form)?.original;
          };
          let numbered: ReplacementEntry[] = [];
          // The net under the reservation: a label that came out for one value while its form
          // belongs to another is reserved as well and the numbers are issued again.
          for (let round = 0; ; round++) {
            const numbering = new AnonymizationSession();
            numbering.importEntries([
              ...issuedLabelsRef.current,
              ...[...reserved].map((label) => ({ original: `${RESERVED_PREFIX}${label}`, replacement: label, entityType: 'OTHER' as EntityType })),
            ]);
            // People first, as the session orders them (the fullest name leads its group); every other
            // value in reading order, so the first company in the text is [COMPANY_1] (they used to be
            // numbered from the end of the text).
            numbering.anonymizeText(text, allEntities.filter((entity) => entity.type === 'PERSON'));
            for (const entity of [...allEntities].sort((a, b) => a.start - b.start)) {
              if (entity.type !== 'PERSON') numbering.anonymize(entity.value, entity.type);
            }
            numbered = numbering.getEntries().filter((entry) => !entry.original.startsWith(RESERVED_PREFIX));
            // Text of the document that restore would read as one of these labels ("ADDRESS_1" as a
            // column name, "{PERSON_1}" as a template field): a reply quoting it came back with the
            // value in its place. Restore itself is asked, so every form it reads is covered.
            const inText = new Set(numbering.restoreSpans(text).map((span) => span.token));
            const known = new Set(issuedLabelsRef.current.map((entry) => entry.original));
            const clashes = numbered.filter((entry) => {
              const owner = ownerOf(entry.replacement);
              return (owner !== undefined && owner !== entry.original) || (inText.has(entry.replacement) && !known.has(entry.original));
            });
            if (clashes.length === 0) break;
            if (round >= 25) throw new Error('labels that belong to other values keep coming out');
            // A value that is already in the registry holds its label from before; only a new
            // value can be moved to another number.
            if (clashes.some((entry) => known.has(entry.original))) throw new Error('a registered label belongs to another value');
            for (const entry of clashes) reserved.add(entry.replacement);
          }
          issuedLabelsRef.current = numbered;
          const redactedNow = new Set(activeEntities.map((entity) => entity.value));
          session.importEntries(issuedLabelsRef.current.filter((entry) => redactedNow.has(entry.original)));
        } catch (err) {
          // A file that is not on the page fails as a whole: the caller says so. Working around it
          // here would give this file numbers of its own, and nobody would be told.
          if (background) throw err;
          // More values than a table may hold: number them as before rather than fail, and say
          // that labels can move now (once per document).
          console.error('[DocCloak] Stable labels unavailable for this document:', err);
          // In a set the labels of the other files stay as they are; the set gets no table (see buildSetTable).
          if (inSet) setUnstableRef.current = true;
          else issuedLabelsRef.current = [];
          session.clear();
          if (!unstableNoticedRef.current) {
            unstableNoticedRef.current = true;
            sayUnstableRef.current();
          }
        }
      }
      // Renamed labels come back: each rename is applied to the fresh session. A value that is not
      // in the map now (kept visible) is skipped and gets its label again when it is redacted again.
      // A label that follows a renamed one ("[X_LAST]" for the surname of "[X]") can land on a label
      // that stood for another value: that surname goes back to its numbered label, and the renames
      // are tried once more (the other value may have been waiting for exactly that label).
      const notKept: Array<{ original: string; label: string; holder: string | null }> = [];
      if (replacementModeRef.current === 'labeled') {
        const numberedLabel = new Map(issuedLabelsRef.current.map((entry) => [entry.original, entry.replacement]));
        for (let round = 0; round < 4; round++) {
          let changed = false;
          for (const [original, label] of labelRenamesRef.current) {
            if (session.getForward(original) === label) continue;
            if (session.renameLabel(original, label).length > 0) changed = true;
          }
          // A typed label, or one that follows from it, that the document's own text reads as
          // ("Case code CLIENT_2", "[CHIEF_LAST]" in a clause) gives way too.
          const inText = new Set(session.restoreSpans(text).map((span) => span.token));
          for (const entry of session.getEntries()) {
            const form = canonicalPlaceholderForm(entry.replacement);
            const first = form === null ? undefined : everLabelsRef.current.get(form);
            const takenByAnother = first !== undefined && first.original !== entry.original;
            if (!takenByAnother && !inText.has(entry.replacement)) continue;
            const own = numberedLabel.get(entry.original);
            if (own && own !== entry.replacement && session.renameLabel(entry.original, own).length > 0) changed = true;
          }
          if (!changed) break;
        }
        // A rename that could not be kept (its label is another value's now, or the text reads as it).
        for (const [original, label] of labelRenamesRef.current) {
          const now = session.getForward(original);
          if (now === undefined || now === label) continue;
          const holder = session.getEntries().find((entry) => entry.replacement === label);
          notKept.push({ original, label, holder: holder?.original ?? null });
        }
      }
      // The text is made once, from the labels as they are in the end.
      const result = session.anonymizeText(text, activeEntities);
      rememberLabels(session);
      return { text: result, notKept };
    },
    [rememberLabels],
  );

  /**
   * Make the protected text, the table and the labels of the document on the page again.
   * `quiet`: nothing about the document changed, it was only put on the page (a file of a set was
   * opened). Then the table is not marked as changed and nothing is said.
   */
  const rebuildAnonymization = useCallback(
    (text: string, allEntities: DetectedEntity[], excluded: Set<number>, quiet = false) => {
      const session = sessionRef.current;
      const inSet = batchFilesRef.current.length > 0;
      const built = buildLabels(session, text, allEntities, excluded, false);
      if (replacementModeRef.current === 'labeled') {
        for (const { original, label, holder } of built.notKept) {
          // One document: a rename that could not be kept is said, not dropped in silence. In a set
          // the label still holds in the files that can take it, so it stays; only a label that is
          // being typed right now is refused as a whole (the field shows why).
          if (!inSet || renameInHandRef.current === original) {
            labelRenamesRef.current.delete(original);
            sayRenameDroppedRef.current(label, holder);
            continue;
          }
          // Said once per file, and never for merely opening it.
          const key = `${activeFileIdRef.current ?? ''}\u0000${original}\u0000${label}`;
          if (quiet || saidNotKeptRef.current.has(key)) continue;
          saidNotKeptRef.current.add(key);
          sayRenameDroppedRef.current(label, holder);
        }
        // The values whose typed label is in effect here (or waits for the value to be redacted again).
        setRenamedOriginals(new Set([...labelRenamesRef.current].filter(([original, label]) => {
          const now = session.getForward(original);
          return now === undefined || now === label;
        }).map(([original]) => original)));
      }
      setAnonymizedText(built.text);
      setEntries(session.getEntries());
      if (quiet) return;
      // A different table than the one a saved file holds.
      setTableSaved(false);
      setTableVersion((version) => version + 1);
      // The result already left the page: the copy that is out does not follow this change.
      if (resultTakenOutRef.current && !changeNoticedRef.current) {
        changeNoticedRef.current = true;
        sayChangedRef.current();
      }
    },
    [buildLabels]
  );

  /** Drop the table loaded from a file: the current document's table restores again. */
  const clearImportedMapping = useCallback(() => {
    importedSessionRef.current = null;
    setImportedMapping(null);
  }, []);

  /**
   * A typed label or a chosen category changed for the whole set: the copies of the OTHER files
   * that already left the page do not follow. Said once after each time a result is taken out
   * (the open file has its own word for it, see rebuildAnonymization).
   */
  const noteSetWideChange = useCallback(() => {
    if (setChangeNoticedRef.current) return;
    const open = activeFileIdRef.current;
    if (!batchFilesRef.current.some((file) => file.id !== open && file.summary?.takenOut)) return;
    setChangeNoticedRef.current = true;
    sayChangedRef.current();
  }, []);

  const anonymize = useCallback(() => {
    const text = inputText;
    if (!text.trim()) return;
    // The user has not yet decided what to do with parts we cannot redact.
    if (unredactablePending) return;
    // The queue of a set is at work: one detection at a time.
    if (queueRunningRef.current) return;
    // Made for a document that is not on the page any more (see docEpoch).
    if (docEpoch !== docEpochRef.current) return;
    const inSet = batchFilesRef.current.length > 0;

    setAnonymizing(true);
    setDetectionError(null);
    setDetectionErrorKind(null);
    setDetectionProgress(0);
    setDetectionEta(null);
    const requestId = ++latestRequestRef.current;
    // A re-run on the same text (after a dictionary word, another model or sensitivity) keeps what
    // the user decided: what is not redacted, the labels they renamed and the values they marked by
    // hand. A different text starts clean. The choices are found again by place (start, end, value).
    const sameText = lastRunTextRef.current === text && entities.length > 0;
    const previousPlaces = sameText ? new Set(entities.map(placeKey)) : null;
    const previousKept = sameText
      ? new Set([...excludedIndices].filter((i) => i < entities.length).map((i) => placeKey(entities[i])))
      : null;
    const previousManual = sameText ? entities.filter((e) => e.detector === 'manual') : [];
    // What was redacted before this run of the same text (found by the detectors): if this run
    // no longer finds a place (lower sensitivity, another model), it becomes readable, and that is said.
    const previousRedacted = sameText
      ? entities.filter((e, i) => !excludedIndices.has(i) && e.detector !== 'manual' && e.detector !== 'dictionary')
      : [];
    setDroppedPlaces([]);
    if (!sameText) {
      // In a set the typed labels and the chosen categories belong to the set, not to one text.
      if (!inSet) {
        labelRenamesRef.current.clear();
        typeChoicesRef.current.clear();
        setRenamedOriginals(new Set());
      }
      setExcludedIndices(new Set());
    }
    // A copy that is out stays out when the same text is redacted again: the reminder and the
    // question before "Clear" must not go away with a second press of the button.
    // A text whose result already left the page in this tab (cleared and brought back since) is
    // still out.
    // (A file of a set carries this with it, see DocumentSnapshot.)
    if (!sameText && !inSet) setResultTakenOut(takenOutTextsRef.current.has(text));
    setReminderDismissed(false);
    if (importedSessionRef.current !== null) {
      // Said out loud: from here on the restore uses another table than a moment ago.
      clearImportedMapping();
      showToast(t.deAnonymize.tableDroppedToast);
    }
    // T222: one controller per run; a run superseded by a new one is
    // cancelled so the worker does not keep computing for nobody.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    etaSamplesRef.current = [{ progress: 0, at: Date.now() }];

    // Detection runs in a Web Worker - no need to yield to the browser
    detectEntities(text, (progress) => {
      if (requestId === latestRequestRef.current) {
        setDetectionProgress(progress);
        etaSamplesRef.current = appendEtaSample(etaSamplesRef.current, progress, Date.now());
        setDetectionEta(etaSeconds(etaSamplesRef.current));
      }
    }, controller.signal)
      .then((results) => {
        if (requestId === latestRequestRef.current) {
          abortRef.current = null;
          // What the detector found, with the dictionary, the ignore list, the types that are never
          // anonymized, the chosen categories and the choices of the previous run (see mergeDetection).
          const { entities: withDictionary, excluded, retyped } = mergeDetection(text, results, {
            dictionary,
            ignoreList,
            neverTypes: new Set(keepTypesRef.current),
            typeChoices: typeChoicesRef.current,
            earlier: previousPlaces && previousKept ? { places: previousPlaces, kept: previousKept, manual: previousManual } : null,
          });
          lastRunTextRef.current = text;
          setEntities(withDictionary);
          setExcludedIndices(excluded);
          rebuildAnonymization(text, withDictionary, excluded);
          const carried = previousKept ? [...excluded].filter((i) => previousKept.has(placeKey(withDictionary[i]))).length : 0;
          if (carried > 0 || retyped > 0 || (sameText && labelRenamesRef.current.size > 0)) showToast(t.entityTable.choicesKeptToast);
          // A place counts as lost also when it is found shorter now ("Lead consultant" as
          // "consultant"): what the new find does not cover is readable.
          const covered = (before: DetectedEntity) => {
            let at = before.start;
            for (const e of withDictionary) {
              if (e.end <= at || e.start >= before.end) continue;
              if (e.start > at && text.slice(at, e.start).trim() !== '') return false;
              at = Math.max(at, e.end);
              if (at >= before.end) return true;
            }
            return at >= before.end || text.slice(at, before.end).trim() === '';
          };
          // Kept on screen until it is answered: a toast was gone after ten seconds, and then the
          // page said "all places found are replaced" over text that had been hidden a minute ago.
          setDroppedPlaces(previousRedacted.filter((before) => !covered(before)));
          setAnonymizing(false);
          setDetectionProgress(null);
          setDetectionEta(null);
          // Scroll the tool back into view in case the page has drifted.
          // We target <main> which wraps the tool; falls back to no-op if not found.
          const toolEl = document.querySelector('main');
          if (toolEl) {
            toolEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DetectionAbortedError) {
          // Cancelled by the user (cancelAnonymize already reset the UI) or
          // superseded by a newer run: nothing to report.
          if (abortRef.current === controller) abortRef.current = null;
          return;
        }
        console.error('[DocCloak] Detection failed:', err);
        if (requestId !== latestRequestRef.current) return;
        abortRef.current = null;
        setAnonymizing(false);
        setDetectionProgress(null);
        setDetectionEta(null);
        if (err instanceof ConsentRequiredError) {
          // Consent flag gone (storage cleared): back to the card, no error.
          setModelLoaded(false);
          setModelConsented(false);
          setPendingProvider(err.providerId);
          return;
        }
        if (err instanceof DetectionTimeoutError) {
          // Watchdog: the worker reported no progress for DETECTION_STALL_MS
          // and was restarted. The remedy is to split the document.
          setDetectionErrorKind('timeout');
          setDetectionError(t.detect.timeout);
          showToast(t.detect.timeout);
          return;
        }
        setDetectionErrorKind('failed');
        setDetectionError(err instanceof Error ? err.message : String(err));
      });
  }, [inputText, entities, excludedIndices, dictionary, ignoreList, rebuildAnonymization, unredactablePending, showToast, t, clearImportedMapping, docEpoch]);

  /**
   * T222: stop the running detection. The overlay closes at once; the worker
   * stops at its next inference chunk (or is replaced if it does not
   * acknowledge in time), and no result of this run is applied.
   */
  const cancelAnonymize = useCallback(() => {
    const controller = abortRef.current;
    // The queue of a set stops with the file that is running: the files that are done stay, the
    // rest wait until the user continues.
    const stopsQueue = queueRunningRef.current && !queueStopRef.current;
    if (stopsQueue) queueStopRef.current = true;
    if (!controller || controller.signal.aborted) {
      // Between two analyses (a file is being read): the queue ends when the read returns.
      if (stopsQueue) showToast(t.detect.cancelled);
      return;
    }
    abortRef.current = null;
    // Retire the request id so a late result or error of this run is ignored.
    latestRequestRef.current += 1;
    controller.abort();
    setAnonymizing(false);
    setDetectionProgress(null);
    setDetectionEta(null);
    showToast(t.detect.cancelled);
  }, [showToast, t]);

  const handleDictionaryChange = useCallback((entries: DictionaryEntry[]) => {
    saveDictionary(entries);
    setDictionaryState(entries);
  }, []);

  const handleIgnoreListChange = useCallback((entries: DictionaryEntry[]) => {
    saveIgnoreList(entries);
    setIgnoreListState(entries);
  }, []);

  const handleInputChange = useCallback((text: string) => {
    // A set holds files; there is no text field to type into while one is open.
    if (batchFilesRef.current.length > 0) return;
    setInputText(text);
    setDroppedPlaces([]);
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    labelRenamesRef.current.clear();
    typeChoicesRef.current.clear();
    setRenamedOriginals(new Set());
    lastRunTextRef.current = null;
    setResultTakenOut(false);
  }, []);

  /**
   * Add places to the list (marked by hand, or kept from an earlier run). The list never holds two
   * places that overlap: a mark takes the place of what it touches (see handMarks.ts). Returns the
   * marks that changed nothing because they lie inside a place that is redacted already.
   */
  const addEntities = useCallback(
    (added: DetectedEntity[]): HandMarkResult['inside'] => {
      const prev = entitiesLiveRef.current;
      const excl = excludedLiveRef.current;
      const keptPlaces = new Set([...excl].filter((i) => i < prev.length).map((i) => prev[i]));
      const { entities: next, inside } = addHandMarks(inputTextLiveRef.current, prev, (entity) => keptPlaces.has(entity), added);
      if (next === prev) return inside;
      // "Not redacted" is kept by position in the list: every place moves to where it stands
      // in the new list. (They used to keep their old numbers, so after a value was marked by
      // hand a different place than the one the user chose was left readable.)
      const position = new Map(next.map((entity, index) => [entity, index]));
      const moved = new Set<number>();
      for (const i of excl) {
        const at = position.get(prev[i]);
        if (at !== undefined) moved.add(at);
      }
      // A second call in the same turn (a mark, then "the same text elsewhere") builds on this one.
      entitiesLiveRef.current = next;
      excludedLiveRef.current = moved;
      setEntities(next);
      setExcludedIndices(moved);
      rebuildAnonymization(inputTextLiveRef.current, next, moved);
      return inside;
    },
    [rebuildAnonymization]
  );
  addEntitiesRef.current = addEntities;

  /** Mark ranges of the text by hand. */
  const addManualRanges = useCallback(
    (ranges: Array<[number, number]>, type: EntityType) => {
      // Offsets of a document that is not on the page any more are not places of this one.
      if (docEpoch !== docEpochRef.current) return [];
      return addEntities(ranges.map(([start, end]) => (
        { type, value: inputText.slice(start, end), start, end, confidence: 1.0, detector: 'manual' }
      )));
    },
    [inputText, addEntities, docEpoch]
  );

  const addManualEntity = useCallback(
    (from: number, to: number, type: EntityType) => {
      if (docEpoch !== docEpochRef.current) return;
      // A selection made with a double click or a drag takes the comma or the full stop along:
      // "weekly." became a value that matched nowhere else, and the full stop left the text.
      let start = from;
      let end = to;
      while (start < end && SELECTION_EDGE.test(inputText[start])) start++;
      while (end > start && SELECTION_EDGE.test(inputText[end - 1])) end--;
      if (end <= start) return;
      const inside = addManualRanges([[start, end]], type);
      // Nothing changed: the selection lies in a value that is redacted as a whole. Said, because a
      // mark that seems to do nothing reads as a failure.
      if (inside.length > 0) showToast(t.textInput.alreadyRedacted(inside[0].holder.value));
      // The same text elsewhere: a name missed once is usually missed everywhere.
      const value = inputText.slice(start, end);
      if (value.length < 2) return;
      const taken = [...entities.map((entity) => [entity.start, entity.end] as [number, number]), [start, end] as [number, number]];
      const others: Array<[number, number]> = [];
      for (let at = inputText.indexOf(value); at !== -1; at = inputText.indexOf(value, at + value.length)) {
        const stop = at + value.length;
        const insideWord = WORD_CHAR.test(inputText[at - 1] ?? '') || WORD_CHAR.test(inputText[stop] ?? '');
        if (!insideWord && !taken.some(([s, e]) => at < e && stop > s)) others.push([at, stop]);
      }
      if (others.length === 0) return;
      const text = inputText;
      showToast(t.textInput.alsoElsewhere(others.length), {
        label: t.textInput.redactThemToo,
        onClick: () => { if (inputTextLiveRef.current === text) addManualRanges(others, type); },
      });
    },
    [inputText, entities, addManualRanges, showToast, t, docEpoch]
  );

  const removeEntity = useCallback(
    (index: number) => {
      // Made for another document than the one on the page (a button of an old message): its
      // index is not a place of this one.
      if (docEpoch !== docEpochRef.current) return;
      setEntities((prev) => {
        const next = prev.filter((_, i) => i !== index);
        setExcludedIndices((excl) => {
          // Rebuild excluded indices: shift down indices above the removed one
          const newExcl = new Set<number>();
          for (const i of excl) {
            if (i < index) newExcl.add(i);
            else if (i > index) newExcl.add(i - 1);
          }
          rebuildAnonymization(inputText, next, newExcl);
          return newExcl;
        });
        return next;
      });
    },
    [inputText, rebuildAnonymization, docEpoch]
  );

  const toggleEntity = useCallback(
    (index: number) => {
      if (docEpoch !== docEpochRef.current) return;
      setExcludedIndices((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        // The text and the list as they are now: this can be called from a toast that was made
        // before a value was marked by hand, and the list of that moment would drop that value.
        rebuildAnonymization(inputTextLiveRef.current, entitiesLiveRef.current, next);
        return next;
      });
    },
    [rebuildAnonymization, docEpoch]
  );

  /**
   * WLojek/DocCloak#4: keep (excluded = true) or redact (false) many items in one step, with
   * one rebuild. The table uses it for "everything shown" after a filter by type or text.
   */
  const setEntitiesExcluded = useCallback(
    (indices: number[], excluded: boolean) => {
      if (docEpoch !== docEpochRef.current) return;
      setExcludedIndices((prev) => {
        // The list as it is now (see toggleEntity): a button of an older toast must reach it.
        const list = entitiesLiveRef.current;
        const next = new Set(prev);
        for (const index of indices) {
          if (index < 0 || index >= list.length) continue;
          if (excluded) next.add(index);
          else next.delete(index);
        }
        rebuildAnonymization(inputTextLiveRef.current, list, next);
        return next;
      });
    },
    [rebuildAnonymization, docEpoch]
  );

  /**
   * WLojek/DocCloak#5: the category of a value, chosen by the user ("this is not a phone number").
   * Every place of the value takes it: a label belongs to a value, so one value cannot stand under
   * two categories. What is redacted and what is not stays as it is.
   *
   * The label follows the category. The value used to keep the label of the category it was found
   * under ("[PHONE_1]" on a decision number), which is the very thing the user wants gone from the
   * protected text. It now leaves the registry of issued labels and the rebuild gives it the next
   * free label of the new category. The old label stays in everLabelsRef, so the rebuild reserves
   * it: it is never given to another value in this tab, and a reply that still holds it is reported
   * with what it stood for instead of being restored. A label typed by hand stays (it is applied
   * after the numbers are issued), and a value that goes back to a category it had before gets its
   * own label of that time back, so Undo is exact.
   */
  const changeEntityType = useCallback(
    (value: string, type: EntityType) => {
      // The list as it is now (see toggleEntity): the Undo of a toast must reach it.
      const list = entitiesLiveRef.current;
      if (!list.some((entity) => entity.value === value && entity.type !== type)) {
        // In a set the choice holds for every file. The Undo of a choice made in another file
        // (the value is not in the list on the page) still takes the choice back for the set.
        const chosen = typeChoicesRef.current.get(value);
        if (batchFilesRef.current.length === 0 || chosen === undefined || chosen === type) return;
      }
      const next = list.map((entity) => (entity.value === value && entity.type !== type ? { ...entity, type } : entity));
      typeChoicesRef.current.set(value, type);
      const held = issuedLabelsRef.current.find((entry) => entry.original === value);
      if (held !== undefined && held.entityType !== type) {
        // Its own label of this category from earlier in this tab, if it had one. Only a label
        // whose first value was this one: such a label can never be read as another value.
        const shape = numberedLabelOf(type);
        const taken = new Set(issuedLabelsRef.current.map((entry) => entry.replacement));
        const own = [...everLabelsRef.current.values()]
          .find((known) => known.original === value && shape.test(known.label) && !taken.has(known.label));
        issuedLabelsRef.current = [
          ...issuedLabelsRef.current.filter((entry) => entry.original !== value),
          ...(own ? [{ original: value, replacement: own.label, entityType: type }] : []),
        ];
      }
      // A second call in the same turn (the category, then "redact it again") builds on this one.
      entitiesLiveRef.current = next;
      setEntities(next);
      // Rebuilt with what is not redacted as it is by then (see toggleEntity): a change of it made
      // in the same turn, before or after this call, must not be lost to a set read too early.
      setExcludedIndices((excluded) => {
        rebuildAnonymization(inputTextLiveRef.current, entitiesLiveRef.current, excluded);
        return excluded;
      });
      noteSetWideChange();
    },
    [rebuildAnonymization, noteSetWideChange]
  );

  /**
   * T263: the types that are never anonymized. Stored on this device; a type that was just added
   * also takes effect on the document that is open (its items become "not redacted"). Removing a
   * type changes nothing in the open document: the user decides there item by item.
   */
  const handleKeepTypesChange = useCallback((types: EntityType[]) => {
    // The buttons of the toasts below act on these places of this text, wherever they stand in the
    // list by then (a value marked by hand in between gives every later place a new number; the
    // buttons used to do nothing then, without a word). In another text they do nothing.
    const source = inputText;
    const nowAt = (indices: number[]): number[] => {
      if (inputTextLiveRef.current !== source) return [];
      const places = new Set(indices.map((index) => placeKey(entities[index])));
      return entitiesLiveRef.current.map((entity, index) => (places.has(placeKey(entity)) ? index : -1)).filter((index) => index >= 0);
    };
    const before = keepTypesRef.current;
    const added = types.filter((type) => !before.includes(type));
    const removed = before.filter((type) => !types.includes(type));
    saveKeepTypes(types);
    setKeepTypesState(loadKeepTypes());
    const placesOf = (kinds: EntityType[], kept: boolean) => entities
      .map((entity, index) => (kinds.includes(entity.type) && entity.detector !== 'dictionary' && entity.detector !== 'manual'
        && excludedIndices.has(index) === kept ? index : -1))
      .filter((index) => index >= 0);
    // A lasting choice that leaves data readable is never silent: it says what it did here, how
    // long it holds, and can be undone on the spot.
    for (const type of added) {
      const indices = placesOf([type], false);
      if (indices.length > 0) setEntitiesExcluded(indices, true);
      showToast(t.entityTable.neverOnToast(t.entityLabels[type], indices.length), {
        label: t.toast.undo,
        onClick: () => {
          saveKeepTypes(loadKeepTypes().filter((kept) => kept !== type));
          setKeepTypesState(loadKeepTypes());
          const now = nowAt(indices);
          if (now.length > 0) setEntitiesExcluded(now, false);
        },
      });
    }
    // Taking a type off the list holds from the next document; the open one is the user's to decide.
    for (const type of removed) {
      const indices = placesOf([type], true);
      if (indices.length === 0) {
        showToast(t.entityTable.neverOffToast(t.entityLabels[type], 0));
      } else {
        showToast(t.entityTable.neverOffToast(t.entityLabels[type], indices.length), {
          label: t.entityTable.redactThemNow,
          onClick: () => {
            const now = nowAt(indices);
            if (now.length > 0) setEntitiesExcluded(now, false);
          },
        });
      }
    }
  }, [entities, excludedIndices, inputText, setEntitiesExcluded, showToast, t]);

  /** Settings: switch the reminder to save the replacement table back on, or off. */
  const setTableReminderEnabled = useCallback((enabled: boolean) => {
    setTableReminderOff(!enabled);
    setReminderOff(!enabled);
    if (enabled) setReminderDismissed(false);
  }, []);

  /** The protected result left the page (download or copy): from now on the table is worth saving. */
  const markResultTakenOut = useCallback(() => {
    setResultTakenOut(true);
    // A file of a set carries this with it (DocumentSnapshot.resultTakenOut), so its text is not
    // kept here: when the file is removed from the set, nothing of its text stays behind.
    if (batchFilesRef.current.length === 0) takenOutTextsRef.current.add(inputTextLiveRef.current);
    // From this copy on, the next change of the result is worth one word.
    changeNoticedRef.current = false;
    setChangeNoticedRef.current = false;
  }, []);

  /** Close the reminder for this table, or for good ("do not remind me again"). */
  const dismissTableReminder = useCallback((forever = false) => {
    setReminderDismissed(true);
    if (forever) {
      setTableReminderOff(true);
      setReminderOff(true);
      // Say where it can be switched back on: a lasting choice is never a dead end.
      showToast(t.tableReminder.offToast);
    }
  }, [showToast, t]);

  /**
   * The one table of a set (WLojek/DocCloak#6): the pairs of every file, made now. The open file
   * gives the table that is on the page; every other file is run through the same label building
   * the page uses (buildLabels), so it gives the pairs it would give if it were opened this moment:
   * a label typed or a category chosen in another file since is in them. Nothing is taken from an
   * earlier copy. Refused as a whole when one table cannot hold or serve the set; never cut.
   */
  const buildSetTable = useCallback((): { ok: true; pairs: ReplacementEntry[]; session: AnonymizationSession; texts: string[]; values: Set<string> } | { ok: false; message: string } => {
    const { batchText: text } = liveRef.current;
    const tooMany = text.tooManyPairs(new Intl.NumberFormat(liveRef.current.language).format(maxTablePairs));
    const perFile: ReplacementEntry[][] = [];
    const texts: string[] = [];
    const values = new Set<string>();
    try {
      for (const file of batchFilesRef.current) {
        if (file.id === activeFileIdRef.current) {
          texts.push(inputTextLiveRef.current);
          for (const entity of entitiesLiveRef.current) values.add(entity.value);
          perFile.push(tablePairsOf(sessionRef.current));
          continue;
        }
        const doc = batchDocsRef.current.get(file.id);
        if (!doc) continue;
        texts.push(doc.text);
        // Read, never analysed: it has no table.
        if (doc.lastRunText !== doc.text) continue;
        const entities = withTypeChoices(doc.entities);
        for (const entity of entities) values.add(entity.value);
        const session = new AnonymizationSession({ mode: replacementModeRef.current });
        buildLabels(session, doc.text, entities, doc.excluded, true);
        perFile.push(tablePairsOf(session));
      }
    } catch (err) {
      console.error('[DocCloak] The table of the set could not be made:', err);
      return { ok: false, message: tooMany };
    }
    // A file of the set was numbered on its own (see buildLabels): its labels are not the set's.
    if (setUnstableRef.current) return { ok: false, message: tooMany };
    const merged = mergePairs(perFile, maxTablePairs);
    if (!merged.ok) return { ok: false, message: merged.reason === 'conflict' ? text.tableConflict : tooMany };
    const session = new AnonymizationSession();
    try {
      session.importEntries(merged.pairs);
    } catch (err) {
      console.error('[DocCloak] The table of the set could not be made:', err);
      return { ok: false, message: tooMany };
    }
    return { ok: true, pairs: merged.pairs, session, texts, values };
  }, [buildLabels, withTypeChoices, maxTablePairs]);

  /**
   * The table the restore uses, with the documents it belongs to: the one loaded from a file, else
   * the open document's, else (in a set) the one table of every file of the set.
   */
  const restoreScope = useCallback((): RestoreScope => {
    const inSet = batchFilesRef.current.length > 0;
    if (!inSet) {
      return {
        session: importedSessionRef.current ?? sessionRef.current,
        fromFile: importedSessionRef.current !== null,
        texts: [inputTextLiveRef.current],
        values: new Set(entitiesLiveRef.current.map((entity) => entity.value)),
      };
    }
    if (importedSessionRef.current) {
      // The values of every file of the set: a table from a file may cross any of them.
      const values = new Set(entitiesLiveRef.current.map((entity) => entity.value));
      for (const doc of batchDocsRef.current.values()) {
        for (const entity of doc.entities) values.add(entity.value);
      }
      return { session: importedSessionRef.current, fromFile: true, texts: [inputTextLiveRef.current], values };
    }
    const table = buildSetTable();
    if (!table.ok) return { session: new AnonymizationSession(), fromFile: false, texts: [], values: new Set(), refusal: table.message };
    return { session: table.session, fromFile: false, texts: table.texts, values: table.values };
  }, [buildSetTable]);

  /** The table the restore uses: the one loaded from a file, else the current document's (in a set: the set's). */
  const restoreSession = useCallback(
    (): AnonymizationSession => restoreScope().session,
    [restoreScope],
  );

  const deanonymize = useCallback((aiResponse: string): string => {
    return restoreSession().deanonymize(aiResponse);
  }, [restoreSession]);

  /** What this tab knows about labels it issued; nothing when a table from a file does the restoring. */
  const knownLabelsForRestore = useCallback((scope: RestoreScope): RestoreContext => {
    // The table that restores, with its values: a label of it left in a spelling restore does not
    // read is then named with what it stands for, also when the table came from a file.
    const tableLabels = scope.session.getEntries()
      .map((entry) => ({ label: entry.replacement, original: entry.original }));
    if (scope.fromFile) return { ever: new Map(), documentValues: new Set(), tableForms: new Set(), tableLabels };
    const tableForms = new Set<string>();
    for (const entry of scope.session.getEntries()) {
      const form = canonicalPlaceholderForm(entry.replacement);
      if (form !== null) tableForms.add(form);
    }
    return {
      ever: everLabelsRef.current,
      documentValues: scope.values,
      tableForms,
      // The texts of a set as one: a token is only looked for in it, and no token holds the separator.
      documentText: scope.texts.length === 1 ? scope.texts[0] : scope.texts.join('\n\u0000\n'),
      tableLabels,
    };
  }, []);

  /**
   * The net under everything above: a label is restored only when the value it stands for now is
   * the first value it stood for in this tab. A label that changed hands (however that came
   * about) is left in the text and reported, never written out as someone else.
   */
  const guardSpans = useCallback((scope: RestoreScope, text: string, spans: RestoreSpan[]): { spans: RestoreSpan[]; refused: KnownLabel[] } => {
    if (scope.fromFile) return { spans, refused: [] };
    const safe: RestoreSpan[] = [];
    const refused: KnownLabel[] = [];
    // Labels that the open document's own text reads as ("{PERSON_1}" as a template field,
    // "ADDRESS_1" as a column name, next to a value that holds that label from an earlier text):
    // in a reply nobody can tell the field from the label, so it is not restored. In a set: the
    // text of any of its files.
    const inText = new Set<string>();
    for (const source of scope.texts) {
      for (const span of scope.session.restoreSpans(source)) inText.add(span.token);
    }
    for (const span of spans) {
      const form = canonicalPlaceholderForm(span.token);
      const first = form === null ? undefined : everLabelsRef.current.get(form);
      if (inText.has(span.token)) {
        refused.push({ label: text.slice(span.start, span.end), original: '', reason: 'textlabel' });
      } else if (first && first.original !== span.replacement) {
        refused.push({ label: text.slice(span.start, span.end), original: span.replacement, reason: 'two' });
      } else {
        safe.push(span);
      }
    }
    return { spans: safe, refused };
  }, []);

  /**
   * With a table from a file in use: did it restore a label that the open document also uses,
   * for another value? Then the reply may belong to the document, not to the file.
   */
  const fileCrossesDocument = useCallback((scope: RestoreScope, spans: RestoreSpan[]): boolean => {
    if (!scope.fromFile) return false;
    return spans.some((span) => {
      const form = canonicalPlaceholderForm(span.token);
      const mine = form === null ? undefined : everLabelsRef.current.get(form);
      return mine !== undefined && mine.original !== span.replacement && scope.values.has(mine.original);
    });
  }, []);

  /** Pasted text with the originals back, plus what the docx route also reports: how many places, what stayed. */
  const restoreText = useCallback((aiResponse: string): RestoreTextResult => {
    const scope = restoreScope();
    // The set has no table (too many values for one): nothing is restored, and that is said.
    if (scope.refusal) showToast(scope.refusal);
    const session = scope.session;
    const { spans, refused } = guardSpans(scope, aiResponse, session.restoreSpans(aiResponse));
    const unresolved = session.unresolvedTokens(aiResponse);
    // The pieces between the restores keep the reply's own text: that is where a label can have stayed.
    const pieces: string[] = [];
    let last = 0;
    for (const span of spans) {
      pieces.push(aiResponse.slice(last, span.start));
      last = span.end;
    }
    pieces.push(aiResponse.slice(last));
    const left = leftoversIn(pieces, unresolved, { ...knownLabelsForRestore(scope), refused });
    const segments: RestoredSegment[] = [];
    spans.forEach((span, index) => {
      segments.push(...markLeftovers(pieces[index], left.unresolved));
      segments.push({ text: span.replacement, kind: 'restored' });
    });
    segments.push(...markLeftovers(pieces[spans.length], left.unresolved));
    return {
      text: segments.map((segment) => segment.text).join(''),
      restored: spans.length,
      unresolved: left.unresolved,
      segments,
      stale: left.stale,
      others: left.others,
      fileOverDocument: fileCrossesDocument(scope, spans),
    };
  }, [restoreScope, knownLabelsForRestore, guardSpans, fileCrossesDocument, showToast]);

  /**
   * WLojek/DocCloak#3: put the original names back into a docx an assistant edited. The
   * placeholders are replaced in the document's own text runs, so formatting stays; tokens the
   * table does not know stay as written and are listed. The file is read here and never becomes
   * the working document: the loaded text, the detections and the table are untouched.
   */
  const restoreDocx = useCallback(async (file: File): Promise<RestoreDocxResult> => {
    if (!/\.docx$/i.test(file.name)) {
      return { success: false, message: t.deAnonymize.docxOnlyDocx };
    }
    try {
      const extraction = await readDocx(file);
      // The table as it is when the file has been read, from every file of a set.
      const scope = restoreScope();
      if (scope.refusal) return { success: false, message: scope.refusal };
      const session = scope.session;
      const { spans, refused } = guardSpans(scope, extraction.plainText, session.restoreSpans(extraction.plainText));
      const pieces: string[] = [];
      let last = 0;
      for (const span of spans) {
        pieces.push(extraction.plainText.slice(last, span.start));
        last = span.end;
      }
      pieces.push(extraction.plainText.slice(last));
      // Labels also stand outside the text of the document: in its properties (the title of a
      // redacted document holds the label of the name it had) and in link targets an assistant
      // added. They are restored by the same rules, and what stays there is reported with the
      // rest (it used to stay unrestored and unsaid: the review of 0.17.1).
      const outside = { pieces: [] as string[], tokens: [] as string[], refused: [] as KnownLabel[], spans: [] as RestoreSpan[] };
      const restoreOutside = (text: string): string => {
        const guarded = guardSpans(scope, text, session.restoreSpans(text));
        outside.refused.push(...guarded.refused);
        outside.tokens.push(...session.unresolvedTokens(text));
        outside.spans.push(...guarded.spans);
        let restoredText = '';
        let at = 0;
        for (const span of guarded.spans) {
          const piece = text.slice(at, span.start);
          outside.pieces.push(piece);
          restoredText += piece + span.replacement;
          at = span.end;
        }
        outside.pieces.push(text.slice(at));
        return restoredText + text.slice(at);
      };
      const { blob } = await writeRestoredDocxWithReport(extraction, spans, { restoreText: restoreOutside });
      const { unresolved, stale, others } = leftoversIn(
        [...pieces, ...outside.pieces],
        [...new Set([...session.unresolvedTokens(extraction.plainText), ...outside.tokens])],
        { ...knownLabelsForRestore(scope), refused: [...refused, ...outside.refused] },
      );
      const downloadName = restoredDownloadName(file.name, unresolved.length + stale.length > 0);
      const restored = spans.length + outside.spans.length;
      if (restored === 0) {
        return { success: true, restored: 0, unresolved, stale, others, blob: null, downloadName };
      }
      return { success: true, restored, unresolved, stale, others, fileOverDocument: fileCrossesDocument(scope, [...spans, ...outside.spans]), blob, downloadName };
    } catch (err) {
      console.error('[DocCloak] Failed to restore the document:', err);
      if (isUnsupportedDocumentError(err)) {
        return { success: false, message: fileErrorMessage(t, err.code) };
      }
      return { success: false, message: t.deAnonymize.docxFailed };
    }
  }, [restoreScope, knownLabelsForRestore, guardSpans, fileCrossesDocument, t]);

  /**
   * WLojek/DocCloak#3: the current document's replacement table as a file (the JSON the
   * DocCloak command line reads). Only on the user's request: it holds every original value.
   * Null when there is nothing to save.
   */
  const exportMapping = useCallback((): { blob: Blob; count: number; downloadName: string } | null => {
    // A set has one table: the pairs of every file, as they are now.
    if (batchFilesRef.current.length > 0) {
      const table = buildSetTable();
      if (!table.ok) {
        // Refused aloud: a table with pairs missing would leave labels in a reply without a word.
        showToast(table.message);
        return null;
      }
      if (table.pairs.length === 0) return null;
      setTableSaved(true);
      return {
        blob: new Blob([tableJson(table.pairs)], { type: 'application/json' }),
        count: table.pairs.length,
        // Named after the files that were read: the first one and how many more.
        downloadName: mappingDownloadName(`${setTableBaseName(batchFilesRef.current.filter((file) => file.stage === 'done').map((file) => file.name))}.set`),
      };
    }
    const json = sessionRef.current.serialize();
    let count = 0;
    try {
      const parsed: unknown = JSON.parse(json);
      count = Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      count = 0;
    }
    if (count === 0) return null;
    // Called from a click on "Save": the table is on disk from here on.
    setTableSaved(true);
    return {
      blob: new Blob([json], { type: 'application/json' }),
      count,
      downloadName: mappingDownloadName(docxFileName ?? xlsxFile?.name ?? pdfFileName ?? imageFileName),
    };
  }, [docxFileName, xlsxFile, pdfFileName, imageFileName, buildSetTable, showToast]);

  /**
   * WLojek/DocCloak#3: load a replacement table saved earlier, so names can be restored after
   * the tab that made it was closed. Core validates every entry; anything else is refused.
   */
  const importMapping = useCallback(async (file: File): Promise<ImportedMapping | null> => {
    if (file.size > MAPPING_MAX_BYTES) return null;
    try {
      const session = AnonymizationSession.deserialize(await file.text());
      const loaded = session.getEntries();
      const count = loaded.length;
      if (count === 0) return null;
      importedSessionRef.current = session;
      // The labels of the file are taken from now on: a document redacted after this gets other
      // numbers, so a reply that belongs to the file's document is never restored with the new
      // document's values once the file table is put away.
      for (const entry of loaded) {
        const form = canonicalPlaceholderForm(entry.replacement);
        if (form !== null && entry.replacement !== '________' && !everLabelsRef.current.has(form)) {
          everLabelsRef.current.set(form, { label: entry.replacement, original: entry.original });
        }
      }
      const imported: ImportedMapping = {
        fileName: file.name,
        count,
        sample: { replacement: loaded[0].replacement, original: loaded[0].original },
      };
      setImportedMapping(imported);
      return imported;
    } catch (err) {
      console.error('[DocCloak] Not a replacement table:', err);
      return null;
    }
  }, []);

  /**
   * Gives a value another label. Returns null when the label was taken, or the reason it was
   * refused: the list shows it at the field, which stays open with what was typed (it used to be
   * a passing message over a field that had already closed).
   */
  const renameLabel = useCallback((original: string, newLabel: string): string | null => {
    if (replacementModeRef.current !== 'labeled') return null;
    // Made for a document that is not on the page any more: its text and list are not this one's.
    if (docEpoch !== docEpochRef.current) return null;
    const current = sessionRef.current.getForward(original);
    if (current === undefined || current === newLabel) return null;
    // What a label may be: a letter or a digit in it (a label of signs only has no form restore
    // could compare, so nothing could keep it from passing to another value), and no brackets
    // inside ("[CLIENT][BOSS]" would be read as two labels).
    const inner = newLabel.replace(/^\[|\]$/g, '');
    const form = canonicalPlaceholderForm(newLabel);
    if (form === null || !/[\p{L}\p{N}]/u.test(inner) || /[[\]<>{}]/.test(inner)) {
      return t.entityTable.labelInvalid;
    }
    // Bracketed text the document itself holds ("[Client]" in a contract template, "[Fee]") would
    // be taken for the label when a reply is restored, and replaced by the value.
    // In a set the label holds for every file, so the text of every file that was read is looked at.
    const texts = [inputText, ...[...batchDocsRef.current.values()].map((doc) => doc.text)];
    for (const source of texts) {
      for (const match of source.matchAll(BRACKETED_IN_TEXT)) {
        if (canonicalPlaceholderForm(match[0]) === form) {
          return t.entityTable.labelInText(match[0]);
        }
      }
    }
    // A label issued to another value in this tab is taken, also while that value is not
    // redacted: a reply written from an earlier copy must never restore to someone else.
    // Compared the way restore compares: "Person 2" is "[PERSON_2]" to it, so it is taken as well.
    const holder = everLabelsRef.current.get(form);
    if (holder && holder.original !== original) {
      // Refused: say so, and for which value, instead of doing nothing.
      return t.entityTable.labelTaken(newLabel, holder.original);
    }
    // The numbered shape is DocCloak's own (unless it is this value's own label coming back).
    if (!holder && OWN_LABEL_SHAPE.test(labelSkeleton(newLabel))) {
      return t.entityTable.labelOwnShape(newLabel);
    }
    // The labels that follow this one ("[PERSON_1_LAST]" becomes "[CLIENT_LAST]") are checked the
    // same way: a derived label must not be one that stood for another value.
    if (current.endsWith(']') && newLabel.endsWith(']')) {
      const stem = `${current.slice(0, -1)}_`;
      for (const entry of sessionRef.current.getEntries()) {
        if (!entry.replacement.startsWith(stem)) continue;
        const derived = `${newLabel.slice(0, -1)}${entry.replacement.slice(current.length - 1)}`;
        const derivedForm = canonicalPlaceholderForm(derived);
        const owner = derivedForm === null ? undefined : everLabelsRef.current.get(derivedForm);
        if (owner && owner.original !== entry.original) {
          return t.entityTable.labelDerivedTaken(newLabel, derived, owner.original);
        }
      }
    }
    // Remembered, then everything is made again in one place (the same path a change of the list
    // takes): a later rename of the same value moves last.
    labelRenamesRef.current.delete(original);
    labelRenamesRef.current.set(original, newLabel);
    // The rebuild can still give this label up (text of the document reads as it, or a label that
    // follows from it is another value's). That is a refusal of this rename like the ones above,
    // so it goes back to the field too; a rename of another value dropped on the way stays a message.
    let dropped: string | null = null;
    const say = sayRenameDroppedRef.current;
    sayRenameDroppedRef.current = (label, holder) => {
      if (label !== newLabel) { say(label, holder); return; }
      dropped = holder === null ? t.entityTable.labelInText(label) : t.entityTable.labelTaken(label, holder);
    };
    renameInHandRef.current = original;
    try {
      rebuildAnonymization(inputText, entities, excludedIndices);
    } finally {
      sayRenameDroppedRef.current = say;
      renameInHandRef.current = null;
    }
    if (dropped === null) noteSetWideChange();
    return dropped;
  }, [t, inputText, entities, excludedIndices, rebuildAnonymization, noteSetWideChange, docEpoch]);

  /** Redact again the places an earlier run had found and the last one did not. */
  const keepDroppedRedacted = useCallback(() => {
    if (droppedPlaces.length === 0 || docEpoch !== docEpochRef.current) return;
    addEntitiesRef.current(droppedPlaces.map((entity) => ({ ...entity, detector: 'manual' })));
    setDroppedPlaces([]);
  }, [droppedPlaces, docEpoch]);
  const dismissDropped = useCallback(() => setDroppedPlaces([]), []);

  /** Back to the numbered label of a renamed value (and of the variants that followed it). */
  const resetLabel = useCallback((original: string) => {
    if (docEpoch !== docEpochRef.current) return;
    if (!labelRenamesRef.current.delete(original)) return;
    rebuildAnonymization(inputText, entities, excludedIndices);
    noteSetWideChange();
  }, [inputText, entities, excludedIndices, rebuildAnonymization, noteSetWideChange, docEpoch]);

  const handleThresholdChange = useCallback((value: number) => {
    setThreshold(value);
    setDetectionThreshold(value);
  }, []);

  const handleCustomLabelsChange = useCallback((labels: string[]) => {
    setCustomLabels(labels);
    setCustomLabelsState(labels);
  }, []);

  const handleRegexChange = useCallback((enabled: boolean) => {
    setRegexRulesState(enabled);
    setRegexEnabled(enabled);
  }, []);

  const handleRegexRegionChange = useCallback((region: RegexRegionId) => {
    setRegexRegionState(region);
    setRegexRegionSetting(region);
  }, []);

  // T228: without an explicit choice the regex region follows the UI language
  // (a Polish interface runs the Polish + universal rules, not every country's).
  useEffect(() => {
    setRegexRegionState(applyUiLanguage(language));
  }, [language]);

  // Settings selector. Before consent a click is a preselection: nothing is
  // downloaded, the consent card names the chosen model instead.
  const handleSwitchProvider = useCallback(async (id: ProviderId) => {
    if (!hasModelConsent()) {
      setModelConsented(false);
      setPendingProvider(id);
      return;
    }
    if (id === activeProvider) return;
    await switchTo(id);
  }, [activeProvider, switchTo]);

  const handleReplacementModeChange = useCallback((mode: ReplacementMode) => {
    setReplacementModeState(mode);
    replacementModeRef.current = mode;
    sessionRef.current.setMode(mode);
    if (entities.length > 0) {
      rebuildAnonymization(inputText, entities, excludedIndices);
    }
  }, [entities, inputText, excludedIndices, rebuildAnonymization]);

  const resetImageState = useCallback(() => {
    setImageFileName(null);
    imageCanvasRef.current = null;
    ocrWordsRef.current = [];
  }, []);

  const resetUnredactableState = useCallback(() => {
    setUnredactableItems([]);
    setFileWarnings([]);
    setAllowUnredactable(false);
  }, []);

  const resetPdfState = useCallback(() => {
    setPdfFileName(null);
    setPdfRemoved([]);
    showPdf(null, []);
  }, [showPdf]);

  /** Resets every input-side state before a newly loaded file's text replaces it. */
  const resetTextState = useCallback(() => {
    setDroppedPlaces([]);
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    sessionRef.current.clear();
    labelRenamesRef.current.clear();
    typeChoicesRef.current.clear();
    setRenamedOriginals(new Set());
    lastRunTextRef.current = null;
    setResultTakenOut(false);
    setTableSaved(false);
  }, []);

  /**
   * The document on the page as ONE object (DocumentSnapshot, ../batch.ts). takeDocument and
   * putDocument are the only pair that takes a whole document off the page or puts one on it: a
   * file that was just read, a file of a set that is opened. State that belongs to one document
   * and is added later goes into DocumentSnapshot and into these two functions.
   */
  const takeDocument = useCallback((): DocumentSnapshot => {
    const state = docStateRef.current;
    return {
      text: inputTextLiveRef.current,
      entities: entitiesLiveRef.current,
      excluded: new Set(excludedLiveRef.current),
      lastRunText: lastRunTextRef.current,
      dropped: state.droppedPlaces,
      resultTakenOut: resultTakenOutRef.current,
      changeNoticed: changeNoticedRef.current,
      docxFile: state.docxFile,
      xlsxFile: state.xlsxFile,
      xlsxInfo: state.xlsxInfo,
      pdfFileName: state.pdfFileName,
      pdfExtraction: pdfExtractionRef.current,
      pdfCovered: pdfCoveredRef.current,
      pdfRemoved: state.pdfRemoved,
      imageFileName: state.imageFileName,
      imageCanvas: imageCanvasRef.current,
      ocrWords: ocrWordsRef.current,
      unredactableItems: state.unredactableItems,
      fileWarnings: state.fileWarnings,
      allowUnredactable: state.allowUnredactable,
    };
  }, []);

  const putDocument = useCallback((doc: DocumentSnapshot) => {
    // A detection that is still running belongs to the document that leaves: it is stopped and
    // its result is never applied to the one that comes.
    const controller = abortRef.current;
    if (controller !== null) {
      abortRef.current = null;
      latestRequestRef.current += 1;
      controller.abort();
      setAnonymizing(false);
      setDetectionProgress(null);
      setDetectionEta(null);
    }
    // From here on the callbacks made for the document that leaves do nothing (see docEpoch).
    docEpochRef.current += 1;
    setDocEpoch(docEpochRef.current);
    // The categories chosen for the set since this document was last on the page.
    const entities = withTypeChoices(doc.entities);
    const excluded = new Set(doc.excluded);
    setInputText(doc.text);
    inputTextLiveRef.current = doc.text;
    setEntities(entities);
    entitiesLiveRef.current = entities;
    setExcludedIndices(excluded);
    excludedLiveRef.current = excluded;
    lastRunTextRef.current = doc.lastRunText;
    setDroppedPlaces(doc.dropped);
    setResultTakenOut(doc.resultTakenOut);
    resultTakenOutRef.current = doc.resultTakenOut;
    changeNoticedRef.current = doc.changeNoticed;
    setDocxFile(doc.docxFile);
    setDocxFileName(doc.docxFile?.name ?? null);
    setXlsxFileState(doc.xlsxFile);
    setXlsxInfo(doc.xlsxInfo);
    setPdfFileName(doc.pdfFileName);
    showPdf(doc.pdfExtraction, doc.pdfCovered);
    setPdfRemoved(doc.pdfRemoved);
    setImageFileName(doc.imageFileName);
    imageCanvasRef.current = doc.imageCanvas;
    ocrWordsRef.current = doc.ocrWords;
    setUnredactableItems(doc.unredactableItems);
    setFileWarnings(doc.fileWarnings);
    setAllowUnredactable(doc.allowUnredactable);
    docStateRef.current = {
      docxFile: doc.docxFile,
      xlsxFile: doc.xlsxFile,
      xlsxInfo: doc.xlsxInfo,
      pdfFileName: doc.pdfFileName,
      pdfRemoved: doc.pdfRemoved,
      imageFileName: doc.imageFileName,
      unredactableItems: doc.unredactableItems,
      fileWarnings: doc.fileWarnings,
      allowUnredactable: doc.allowUnredactable,
      droppedPlaces: doc.dropped,
    };
    if (doc.lastRunText !== null && doc.lastRunText === doc.text) {
      // It was analysed: its protected text and its table are made from the labels of the tab as
      // they are now. Quietly: putting a document on the page changes nothing about it.
      rebuildAnonymization(doc.text, entities, excluded, true);
    } else {
      sessionRef.current.clear();
      setAnonymizedText('');
      setEntries([]);
      setRenamedOriginals(new Set());
    }
  }, [rebuildAnonymization, withTypeChoices, showPdf]);

  const readDocxFile = useCallback(async (file: File): Promise<ReadResult> => {
    if (!isSupportedFile(file.name)) {
      return { ok: false, result: { success: false, error: 'unsupported' } };
    }
    try {
      let plainText: string;
      let items: UnredactableItem[] = [];
      let warnings: string[] = [];
      let empty = false;

      if (isLegacyDoc(file.name)) {
        // Legacy .doc: try as .docx first (some .doc files are renamed .docx).
        // Only the reader's failure is swallowed; readDocText's typed refusals
        // (fast-saved, encrypted) reach the outer catch and get translated.
        let extraction: DocxExtraction | null = null;
        try {
          extraction = await readDocx(file);
        } catch {
          extraction = null;
        }
        if (extraction) {
          plainText = extraction.plainText;
          items = extraction.unredactable;
          warnings = extraction.warnings;
          empty = extraction.empty;
        } else {
          const buffer = await file.arrayBuffer();
          plainText = readDocText(buffer);
          empty = plainText.trim().length === 0;
          // ObjectPool (embedded OLE objects) and Macros (VBA) are copied
          // through the .doc export unchanged: same informed-consent card.
          const inspection = inspectDoc(buffer);
          if (inspection.streams.objectPool) {
            items.push({ part: 'ObjectPool', kind: 'embedded-object', label: 'embedded OLE objects' });
          }
          if (inspection.streams.macros) {
            items.push({ part: 'Macros', kind: 'macros', label: 'VBA macros' });
          }
        }
      } else {
        // Standard .docx
        const extraction = await readDocx(file);
        plainText = extraction.plainText;
        items = extraction.unredactable;
        warnings = extraction.warnings;
        empty = extraction.empty;
      }

      if (empty) {
        return {
          ok: false,
          result: {
            success: false,
            error: 'empty-document',
            code: 'empty-document',
            message: fileErrorMessage(t, 'empty-document'),
          },
        };
      }

      return {
        ok: true,
        doc: { ...emptyDocument(), text: plainText, docxFile: file, unredactableItems: items, fileWarnings: localizeCoreNotes(t, warnings) },
      };
    } catch (err) {
      console.error('[DocCloak] Failed to read file:', err);
      if (isUnsupportedDocumentError(err)) {
        return { ok: false, result: { success: false, error: err.message, code: err.code, message: fileErrorMessage(t, err.code) } };
      }
      return { ok: false, result: { success: false, error: err instanceof Error ? err.message : String(err) } };
    }
  }, [t]);

  // Spreadsheet (T265): Core reads text cells, comments, headers and footers, text boxes, cells
  // shown as dates and long integers; the other numbers stay out. The notes say what was read.
  const readXlsxFile = useCallback(async (file: File): Promise<ReadResult> => {
    try {
      const extraction = await readXlsx(file);
      if (extraction.empty) {
        return { ok: false, result: { success: false, error: 'empty-document', code: 'empty-document', message: fileErrorMessage(t, 'empty-document') } };
      }
      return {
        ok: true,
        doc: {
          ...emptyDocument(),
          text: extraction.plainText,
          xlsxFile: file,
          // What was checked and what was not has its own notice (SpreadsheetNotice), shown before the export.
          xlsxInfo: { ...extraction.stats, renamedSheets: [], unchecked: extraction.uncheckedCells },
          unredactableItems: extraction.unredactable,
          fileWarnings: localizeCoreNotes(t, extraction.warnings),
        },
      };
    } catch (err) {
      console.error('[DocCloak] Failed to read the workbook:', err);
      if (isUnsupportedDocumentError(err)) {
        return { ok: false, result: { success: false, error: err.message, code: err.code, message: fileErrorMessage(t, err.code) } };
      }
      return { ok: false, result: { success: false, error: err instanceof Error ? err.message : String(err), code: 'invalid-package', message: t.xlsx.invalid } };
    }
  }, [t]);

  // PDF (T216): the reader keeps the text layer's geometry; detection runs on
  // its plainText like any other document. Scanned pages and undecodable
  // text arrive as unredactable parts and go through the same
  // Continue/Cancel notice as docx; the parts the writer will drop are
  // listed for information.
  const readPdfFile = useCallback(async (file: File): Promise<ReadResult> => {
    // Refuse oversized files before the PDF chunk is even downloaded (Core re-checks the cap).
    if (file.size > PDF_MAX_BYTES) {
      return { ok: false, result: { success: false, error: `PDF is ${file.size} bytes; the limit is ${PDF_MAX_BYTES}`, code: 'too-large', message: fileErrorMessage(t, 'too-large', 'pdf') } };
    }
    try {
      const pdf = await import('@doccloak/core/pdf');
      // Hand edits (T284) are applied without waiting: the module stays at hand once a PDF was read.
      pdfModuleRef.current = pdf;
      const { readPdf } = pdf;
      // Each page by what it holds (T238, T239): DocCloak's own OCR reads the pages without any text
      // layer, the text a scan's OCR layer missed and the text inside images on text pages; several
      // pages at a time, each with its own Tesseract worker (T248): the number set in the settings,
      // or by default the one for this device (T253).
      const workers = ocrWorkersInEffect();
      let extraction: Awaited<ReturnType<typeof readPdf>>;
      try {
        extraction = await readPdf(file, {
          assets: pdfAssets(),
          recognizeText: (page, region, dpi) => recognizePdfRegion(page, region, dpi, language, workers),
          ocrConcurrency: workers,
          onOcrProgress: (done, total) => {
            setOcrProgress(total > 0 ? done / total : 0);
            setOcrPages({ done, total });
          },
        });
      } finally {
        setOcrProgress(null);
        setOcrPages(null);
        void releasePdfOcr();
      }
      if (extraction.empty) {
        // A scan without text: say so, with the remedies. DocCloak's own OCR found nothing either when it read the pages.
        const scan = extraction.pages.some((p) => p.imageOnly);
        const readByOcr = extraction.pages.some((p) => p.ocrWholePage !== undefined);
        return {
          ok: false,
          result: {
            success: false,
            error: 'empty-document',
            code: 'empty-document',
            message: scan ? t.fileErrors[readByOcr ? 'pdf-scan-ocr-nothing' : 'pdf-scan-no-text'] : fileErrorMessage(t, 'empty-document'),
          },
        };
      }
      return {
        ok: true,
        doc: {
          ...emptyDocument(),
          text: extraction.plainText,
          pdfFileName: file.name,
          pdfExtraction: extraction,
          pdfRemoved: extraction.removed,
          unredactableItems: extraction.unredactable,
          fileWarnings: pdfReadNotes(t, extraction),
        },
      };
    } catch (err) {
      console.error('[DocCloak] Failed to read PDF:', err);
      if (isUnsupportedDocumentError(err)) {
        return { ok: false, result: { success: false, error: err.message, code: err.code, message: fileErrorMessage(t, err.code, 'pdf') } };
      }
      return { ok: false, result: { success: false, error: err instanceof Error ? err.message : String(err) } };
    }
  }, [t, language]);

  const readImageFile = useCallback(async (file: File): Promise<ReadResult> => {
    try {
      setOcrProgress(0);
      const canvas = await loadImageToCanvas(file);
      const { text, words } = await recognizeCanvas(canvas, language, (p) => setOcrProgress(p));
      if (!text.trim()) {
        return { ok: false, result: { success: false, error: 'no-text' } };
      }
      return { ok: true, doc: { ...emptyDocument(), text, imageFileName: file.name, imageCanvas: canvas, ocrWords: words } };
    } catch (err) {
      console.error('[DocCloak] OCR failed:', err);
      return { ok: false, result: { success: false, error: err instanceof Error ? err.message : String(err) } };
    } finally {
      setOcrProgress(null);
    }
  }, [language]);

  // Route uploads by type: images go through OCR, PDFs through the PDF
  // reader, everything else through the docx reader. Reading puts nothing on the page.
  const readDocument = useCallback(async (file: File): Promise<ReadResult> => {
    if (isImageFile(file.name)) return readImageFile(file);
    if (isPdfFile(file.name)) return readPdfFile(file);
    if (isExcelFile(file.name)) return readXlsxFile(file);
    return readDocxFile(file);
  }, [readImageFile, readPdfFile, readXlsxFile, readDocxFile]);
  // The queue of a set reads with the reader of the moment (the interface language can change).
  const readDocumentRef = useRef(readDocument);
  readDocumentRef.current = readDocument;
  const loadFilesRef = useRef<(files: File[]) => Promise<LoadFileResult>>(() => Promise.resolve({ success: false }));

  /** One file, as before there were sets: it is read and takes the place of what is on the page. */
  const loadFile = useCallback(async (file: File): Promise<LoadFileResult> => {
    // While a set is open a file joins the set.
    if (batchFilesRef.current.length > 0) return loadFilesRef.current([file]);
    const read = await readDocument(file);
    if (!read.ok) return read.result;
    // A set was started while this file was read: the page is the set's now.
    if (batchFilesRef.current.length > 0) return { success: true };
    // A new document: the labels typed and the categories chosen for the one before are not its own,
    // and its table is not the one a saved file holds.
    labelRenamesRef.current.clear();
    typeChoicesRef.current.clear();
    setTableSaved(false);
    putDocument(read.doc);
    return { success: true };
  }, [readDocument, putDocument]);

  // --- A set of files: opening, removing, adding, and the queue (WLojek/DocCloak#6) ---

  /**
   * A detection, the queue or an export is at work. The file on the page then stays where it is:
   * a result that comes back must find the document it was made for.
   */
  const isBusy = useCallback(
    (): boolean => queueRunningRef.current || abortRef.current !== null || exportsRunningRef.current > 0,
    [],
  );

  const patchBatchFile = useCallback((id: string, patch: Partial<BatchFileRecord>) => {
    updateBatchFiles((files) => files.map((file) => (file.id === id ? { ...file, ...patch } : file)));
  }, [updateBatchFiles]);

  /** Put a file of the set on the page. What was there has been stored or dropped by the caller. */
  const activateBatchFile = useCallback((id: string): boolean => {
    const doc = batchDocsRef.current.get(id);
    if (!doc) return false;
    // The document is on the page from here on, and only there.
    batchDocsRef.current.delete(id);
    activeFileIdRef.current = id;
    setActiveFileId(id);
    putDocument(doc);
    patchBatchFile(id, { opened: true });
    return true;
  }, [putDocument, patchBatchFile]);

  /** Take the open file off the page into its snapshot (the page itself is changed by what comes next). */
  const storeOpenFile = useCallback(() => {
    const id = activeFileIdRef.current;
    if (id === null) return;
    const doc = takeDocument();
    batchDocsRef.current.set(id, doc);
    patchBatchFile(id, { summary: summarise(doc, tablePairsOf(sessionRef.current)) });
    activeFileIdRef.current = null;
    setActiveFileId(null);
  }, [takeDocument, patchBatchFile]);

  /**
   * Open a file of the set: the one on the page goes into its snapshot, this one comes back as it
   * was left. Refused (false) while something is at work, and for a file that was not read.
   */
  const openBatchFile = useCallback((id: string): boolean => {
    if (isBusy()) return false;
    if (id === activeFileIdRef.current) return true;
    const file = batchFilesRef.current.find((item) => item.id === id);
    if (!file || file.stage !== 'done' || !batchDocsRef.current.has(id)) return false;
    storeOpenFile();
    // A failed analysis shown under the button belongs to the file that leaves.
    setDetectionError(null);
    setDetectionErrorKind(null);
    return activateBatchFile(id);
  }, [isBusy, storeOpenFile, activateBatchFile]);

  /** Remove every file of the set: their documents, and the labels typed and categories chosen for the set. */
  const clearBatch = useCallback((): boolean => {
    if (batchFilesRef.current.length === 0) return false;
    if (isBusy()) return false;
    batchDocsRef.current.clear();
    batchSourcesRef.current.clear();
    updateBatchFiles(() => []);
    activeFileIdRef.current = null;
    setActiveFileId(null);
    setQueuePaused(false);
    saidNotKeptRef.current.clear();
    setUnstableRef.current = false;
    setChangeNoticedRef.current = false;
    labelRenamesRef.current.clear();
    typeChoicesRef.current.clear();
    setDetectionError(null);
    setDetectionErrorKind(null);
    putDocument(emptyDocument());
    setTableSaved(false);
    return true;
  }, [isBusy, updateBatchFiles, putDocument]);

  /**
   * Remove one file from the set: its document is let go. If it was on the page, the file after
   * it (else the one before) comes on the page. The last file takes the set with it.
   */
  const removeBatchFile = useCallback((id: string): boolean => {
    if (isBusy()) return false;
    const at = batchFilesRef.current.findIndex((file) => file.id === id);
    if (at === -1) return false;
    if (batchFilesRef.current.length === 1) return clearBatch();
    const wasOpen = id === activeFileIdRef.current;
    batchDocsRef.current.delete(id);
    batchSourcesRef.current.delete(id);
    updateBatchFiles((files) => files.filter((file) => file.id !== id));
    // Its pairs are not in the table of the set any more.
    setTableVersion((version) => version + 1);
    if (!wasOpen) return true;
    activeFileIdRef.current = null;
    setActiveFileId(null);
    setDetectionError(null);
    setDetectionErrorKind(null);
    const rest = batchFilesRef.current;
    const next = [...rest.slice(at), ...rest.slice(0, at).reverse()]
      .find((file) => file.stage === 'done' && batchDocsRef.current.has(file.id));
    // Either way the removed document leaves the page with everything it held.
    if (!next || !activateBatchFile(next.id)) putDocument(emptyDocument());
    return true;
  }, [isBusy, clearBatch, updateBatchFiles, activateBatchFile, putDocument]);

  /** Add files to the open set, up to its limit. What does not fit is said, not dropped in silence. */
  const addBatchFiles = useCallback((incoming: File[]): { added: number; skipped: number } => {
    const room = Math.max(0, maxBatchFiles - batchFilesRef.current.length);
    const taken = incoming.slice(0, room);
    const skipped = incoming.length - taken.length;
    if (taken.length > 0) {
      const records = taken.map((file): BatchFileRecord => {
        const id = `file-${++batchSeqRef.current}`;
        batchSourcesRef.current.set(id, file);
        return { id, name: file.name, stage: 'waiting', opened: false, summary: null };
      });
      updateBatchFiles((files) => [...files, ...records]);
      // Adding files asks for work: a queue the user had stopped goes on.
      setQueuePaused(false);
    }
    if (skipped > 0) showToast(batchText.capReached(maxBatchFiles, skipped));
    return { added: taken.length, skipped };
  }, [maxBatchFiles, updateBatchFiles, showToast, batchText]);

  /**
   * Files picked or dropped. One file with no set open is loaded as before there were sets.
   * Several at once start a set; with a set open, any number joins it.
   */
  const loadFiles = useCallback(async (files: File[]): Promise<LoadFileResult> => {
    if (files.length === 0) return { success: true };
    const inSet = batchFilesRef.current.length > 0;
    if (!inSet && files.length === 1) return loadFile(files[0]);
    if (!inSet) {
      // What is on the page makes room, as it does for one file. The labels typed and the
      // categories chosen from here on belong to the set.
      labelRenamesRef.current.clear();
      typeChoicesRef.current.clear();
      saidNotKeptRef.current.clear();
      setUnstableRef.current = false;
      setChangeNoticedRef.current = false;
      setQueuePaused(false);
      setDetectionError(null);
      setDetectionErrorKind(null);
      putDocument(emptyDocument());
      setTableSaved(false);
    }
    const { added, skipped } = addBatchFiles(files);
    if (added === 0) return { success: false, error: 'set-full', message: batchText.capReached(maxBatchFiles, skipped) };
    return { success: true };
  }, [loadFile, putDocument, addBatchFiles, batchText, maxBatchFiles]);
  loadFilesRef.current = loadFiles;

  /**
   * The queue: the waiting files one after another, each read (with OCR where it needs it) and
   * then analysed. Nothing of it touches the document on the page: every result is written to the
   * file it was made for, by id. A file with parts that cannot be redacted is read and left for
   * the user's decision; a file that fails is marked and the queue goes on.
   */
  const runQueue = useCallback(async () => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    queueStopRef.current = false;
    setQueueRunning(true);
    try {
      for (;;) {
        if (queueStopRef.current || unmountedRef.current) break;
        const next = batchFilesRef.current.find((file) => file.stage === 'waiting');
        if (!next) break;
        const { id, name } = next;
        const position = (phase: QueuePosition['phase']): QueuePosition => {
          const files = batchFilesRef.current;
          return { index: files.findIndex((file) => file.id === id) + 1, total: files.length, name, phase };
        };
        const stillInSet = () => batchFilesRef.current.some((file) => file.id === id);

        // 1. Read it, unless a run of the queue that was stopped already has.
        let doc = batchDocsRef.current.get(id);
        if (!doc) {
          const source = batchSourcesRef.current.get(id);
          patchBatchFile(id, { stage: 'reading' });
          setQueuePosition(position('reading'));
          const read: ReadResult = source
            ? await readDocumentRef.current(source)
            : { ok: false, result: { success: false } };
          if (unmountedRef.current) break;
          if (!stillInSet()) continue;
          batchSourcesRef.current.delete(id);
          if (!read.ok) {
            const { t: now, batchText: text } = liveRef.current;
            const reason = read.result.error === 'unsupported'
              ? now.textInput.unsupportedFormat
              : read.result.error === 'no-text'
                ? now.textInput.ocrNoText
                : (read.result.message ?? text.failedFallback);
            patchBatchFile(id, { stage: 'failed', reason, summary: null });
            continue;
          }
          doc = read.doc;
          batchDocsRef.current.set(id, doc);
          if (queueStopRef.current) {
            patchBatchFile(id, { stage: 'waiting' });
            break;
          }
        }

        // 2. Parts that cannot be redacted: the analysis waits for the user's decision.
        if (doc.unredactableItems.length > 0 && !doc.allowUnredactable) {
          patchBatchFile(id, { stage: 'done', reason: undefined, summary: summarise(doc, []) });
          continue;
        }

        // 3. Analyse it.
        patchBatchFile(id, { stage: 'analysing' });
        setQueuePosition(position('analysing'));
        if (importedSessionRef.current !== null) {
          // As the Redact button does: from here on the restore uses the table of the files.
          clearImportedMapping();
          showToast(liveRef.current.t.deAnonymize.tableDroppedToast);
        }
        const controller = new AbortController();
        abortRef.current = controller;
        const requestId = ++latestRequestRef.current;
        etaSamplesRef.current = [{ progress: 0, at: Date.now() }];
        setAnonymizing(true);
        setDetectionError(null);
        setDetectionErrorKind(null);
        setDetectionProgress(0);
        setDetectionEta(null);
        let stopped = false;
        let paused = true;
        try {
          const text = doc.text;
          const results = await detectEntities(text, (progress) => {
            if (requestId !== latestRequestRef.current) return;
            setDetectionProgress(progress);
            etaSamplesRef.current = appendEtaSample(etaSamplesRef.current, progress, Date.now());
            setDetectionEta(etaSeconds(etaSamplesRef.current));
          }, controller.signal);
          if (requestId !== latestRequestRef.current || queueStopRef.current || unmountedRef.current) {
            // Cancelled while the answer was on its way: it is not applied.
            stopped = true;
          } else if (stillInSet()) {
            const merged = mergeDetection(text, results, {
              dictionary: liveRef.current.dictionary,
              ignoreList: liveRef.current.ignoreList,
              neverTypes: new Set(keepTypesRef.current),
              typeChoices: typeChoicesRef.current,
              earlier: null,
            });
            const analysed: DocumentSnapshot = { ...doc, entities: merged.entities, excluded: merged.excluded, lastRunText: text, dropped: [] };
            // Its labels are issued now, in the order of the queue: the first file has the first numbers.
            const session = new AnonymizationSession({ mode: replacementModeRef.current });
            let labelled = true;
            try {
              buildLabels(session, analysed.text, analysed.entities, analysed.excluded, true);
            } catch (err) {
              console.error('[DocCloak] Stable labels unavailable for a file of the set:', err);
              labelled = false;
            }
            if (labelled) {
              batchDocsRef.current.set(id, analysed);
              patchBatchFile(id, { stage: 'done', reason: undefined, summary: summarise(analysed, tablePairsOf(session)) });
              // The table of the set has new pairs: it is not the one a saved file holds.
              setTableSaved(false);
              setTableVersion((version) => version + 1);
            } else {
              // More values than one table keeps stable labels for: the file is not part of the
              // set's work, and its document is let go.
              batchDocsRef.current.delete(id);
              const max = new Intl.NumberFormat(liveRef.current.language).format(maxTablePairs);
              patchBatchFile(id, { stage: 'failed', reason: liveRef.current.batchText.tooManyPairs(max), summary: null });
            }
          }
        } catch (err) {
          if (err instanceof DetectionAbortedError || queueStopRef.current) {
            stopped = true;
          } else if (err instanceof ConsentRequiredError) {
            // Consent flag gone (storage cleared): back to the card; the queue goes on when the model is there again.
            setModelLoaded(false);
            setModelConsented(false);
            setPendingProvider(err.providerId);
            stopped = true;
            paused = false;
          } else {
            console.error('[DocCloak] Detection failed for a file of the set:', err);
            const { t: now, batchText: text } = liveRef.current;
            // It was read: the user can open it and press Redact.
            patchBatchFile(id, {
              stage: 'done',
              reason: err instanceof DetectionTimeoutError ? now.detect.timeout : text.detectionFailed(now.redactButton.redact),
              summary: summarise(doc, []),
            });
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          setAnonymizing(false);
          setDetectionProgress(null);
          setDetectionEta(null);
        }
        if (stopped) {
          if (stillInSet()) patchBatchFile(id, { stage: 'waiting' });
          queueStopRef.current = paused;
          break;
        }
      }
    } finally {
      queueRunningRef.current = false;
      if (!unmountedRef.current) {
        setQueueRunning(false);
        setQueuePosition(null);
        if (queueStopRef.current && batchFilesRef.current.some((file) => file.stage === 'waiting')) setQueuePaused(true);
        // Nothing on the page yet: the first file that was read comes on it.
        if (activeFileIdRef.current === null) {
          const first = batchFilesRef.current.find((file) => file.stage === 'done' && batchDocsRef.current.has(file.id));
          if (first) activateBatchFile(first.id);
        }
      }
    }
  }, [patchBatchFile, buildLabels, clearImportedMapping, showToast, activateBatchFile, maxTablePairs]);

  // The queue starts on its own: when files wait, the model is ready and nothing else is analysed.
  // Without the model (not downloaded yet, still loading) the files wait for it.
  useEffect(() => {
    if (queueRunning || queuePaused || !modelLoaded || anonymizing) return;
    if (!batchFiles.some((file) => file.stage === 'waiting')) return;
    void runQueue();
  }, [batchFiles, queueRunning, queuePaused, modelLoaded, anonymizing, runQueue]);

  const documentsHeld = useCallback(
    (): number => batchDocsRef.current.size + batchSourcesRef.current.size + (activeFileIdRef.current !== null ? 1 : 0),
    [],
  );

  /** Go on with the files that wait after the queue was stopped. */
  const resumeQueue = useCallback(() => setQueuePaused(false), []);

  /**
   * An export is the open document's own, or it is refused. It was made for the document that was
   * on the page when this function was made (docEpoch): the list, the file and the offsets it
   * holds are that document's. In a set only a file whose analysis has finished is exported.
   */
  const exportGuard = useCallback(() => {
    if (docEpoch !== docEpochRef.current) throw new Error('The document on the page has changed');
    if (batchFilesRef.current.length > 0 && (lastRunTextRef.current === null || lastRunTextRef.current !== inputTextLiveRef.current)) {
      throw new Error('This file has not been analysed');
    }
  }, [docEpoch]);

  /** In a set: while an export runs, the file on the page is not switched or removed (see isBusy). */
  const duringExport = useCallback(async <T>(work: () => Promise<T>): Promise<T> => {
    if (batchFilesRef.current.length === 0) return work();
    exportsRunningRef.current += 1;
    setExportsRunning((count) => count + 1);
    try {
      return await work();
    } finally {
      exportsRunningRef.current -= 1;
      setExportsRunning((count) => count - 1);
    }
  }, []);

  const exportRedactedImage = useCallback(async (): Promise<Blob> => {
    // The picture is read from the page when this runs; the list is the one this function was made
    // with. The guard makes sure both belong to the same document.
    exportGuard();
    const canvas = imageCanvasRef.current;
    if (!canvas || entities.length === 0) {
      throw new Error('No image or entities to export');
    }
    const activeEntities = entities.filter((_, i) => !excludedIndices.has(i));
    const words = ocrWordsRef.current;
    return duringExport(() => renderRedactedImage(canvas, words, activeEntities));
  }, [entities, excludedIndices, exportGuard, duringExport]);

  const exportDocx = useCallback(async (): Promise<Blob> => {
    // A file with no detections can still be exported (T205): the writer
    // scrubs metadata and revision fingerprints, and a user who added nothing
    // to the dictionary gets the same file back with those cleaned.
    exportGuard();
    if (!docxFile) {
      throw new Error('No document to export');
    }
    if (unredactablePending) {
      // Fail closed: the user has not confirmed the unredactable parts.
      throw new Error('Unredactable parts have not been confirmed');
    }

    const { replacements, valueReplacements } = replacementsFor(entities, excludedIndices, sessionRef.current);
    // What the writer reports is written to the page only while this document is still on it.
    const epoch = docEpochRef.current;
    const stillHere = () => docEpochRef.current === epoch;

    // The writer stays fail-closed by default; allowUnredactable is true only
    // after the user chose Continue on the notice.
    const writeOptions: DocxWriteOptions = { allowUnredactable };

    const writeDocx = async (extraction: DocxExtraction): Promise<Blob> => {
      try {
        const result = await writeAnonymizedDocxWithReport(extraction, replacements, valueReplacements, writeOptions);
        const notes = localizeCoreNotes(t, result.warnings);
        if (notes.length > 0 && stillHere()) {
          setFileWarnings((prev) => Array.from(new Set([...prev, ...notes])));
        }
        return result.blob;
      } catch (err) {
        if (isUnsupportedDocumentError(err) && err.code === 'unredactable-parts' && stillHere()) {
          // Only reachable when the writer knows about parts the reader did
          // not report: surface the notice so the user can decide.
          const parts = err.details.length > 0 ? err.details : ['?'];
          setUnredactableItems(parts.map((part) => ({ part, kind: 'unknown' as const })));
          setAllowUnredactable(false);
        }
        throw err;
      }
    };

    return duringExport(async () => {
      if (isLegacyDoc(docxFile.name)) {
        // Legacy .doc: .docx first (renamed files), else the .doc binary writer.
        let extraction: DocxExtraction | null = null;
        try {
          extraction = await readDocx(docxFile);
        } catch {
          extraction = null;
        }
        if (extraction) return writeDocx(extraction);
        const buffer = await docxFile.arrayBuffer();
        return writeAnonymizedDoc(buffer, replacements, valueReplacements);
      }
      // Standard .docx
      const extraction = await readDocx(docxFile);
      return writeDocx(extraction);
    });
  }, [docxFile, entities, excludedIndices, allowUnredactable, unredactablePending, t, exportGuard, duringExport]);

  // Spreadsheet export (T265), mirroring exportDocx: the file is read again, the detected places
  // are replaced in the cells, a sheet named after a replaced value gets a valid new name.
  const exportXlsx = useCallback(async (): Promise<Blob> => {
    exportGuard();
    if (!xlsxFile) throw new Error('No workbook to export');
    if (unredactablePending) throw new Error('Unredactable parts have not been confirmed');
    const { replacements, valueReplacements } = replacementsFor(entities, excludedIndices, sessionRef.current);
    const epoch = docEpochRef.current;
    const stillHere = () => docEpochRef.current === epoch;
    return duringExport(async () => {
      const extraction = await readXlsx(xlsxFile);
      // Fail closed: the offsets belong to the text that was analysed.
      if (extraction.plainText !== inputText) throw new Error('The workbook no longer matches the analysed text');
      try {
        const result = await writeAnonymizedXlsxWithReport(extraction, replacements, valueReplacements, { allowUnredactable });
        const notes = localizeCoreNotes(t, result.warnings);
        if (stillHere()) {
          if (notes.length > 0) setFileWarnings((prev) => Array.from(new Set([...prev, ...notes])));
          setXlsxInfo((prev) => (prev ? { ...prev, renamedSheets: result.renamedSheets } : prev));
        }
        return result.blob;
      } catch (err) {
        if (isUnsupportedDocumentError(err) && err.code === 'unredactable-parts' && stillHere()) {
          const parts = err.details.length > 0 ? err.details : ['?'];
          setUnredactableItems(parts.map((part) => ({ part, kind: 'unknown' as const })));
          setAllowUnredactable(false);
        }
        throw err;
      }
    });
  }, [xlsxFile, entities, excludedIndices, inputText, allowUnredactable, unredactablePending, t, exportGuard, duringExport]);

  /**
   * Hand edits of the PDF on the page (T284, WLojek/DocCloak.Core#6): pages left out, areas hidden.
   * `next` is the FULL set of edits; Core applies it to the file as read, and the extraction that
   * comes back takes the place of the one on the page with everything that hangs on it, in one
   * step: the text, the parts that cannot be redacted, the notes, and what was found.
   *
   * What was found before the edit:
   * - The edit only took text away (a page left out, an area hidden): every item is either still
   *   whole in the text, and moves to its new place with its choices and its label, or it is gone
   *   with its text, and that is said.
   * - The edit brought text back (a page brought back, an area taken away) into a document that
   *   was analysed: that text was never looked at, so the result is cleared and the user is asked
   *   to redact again. A result must never look finished over text no detector has read. (A page
   *   without text that comes back brings only its break: nothing to read, the result stays.)
   * - Marks made by hand in a document that was never analysed promise nothing about the rest of
   *   the text: they move with their text either way.
   *
   * Refused (false, nothing changes) while a detection, the queue or an export is at work, and for
   * a set that would leave no page (Core throws for it; the page view never asks).
   */
  const editPdf = useCallback((next: PdfEdits): boolean => {
    const pdf = pdfModuleRef.current;
    const extraction = pdfExtractionRef.current;
    if (!pdf || !extraction) return false;
    if (isBusy() || pdfExportsRef.current > 0) return false;
    if (!keepsAPage(next, extraction.pageCount)) return false;
    const { t: now, pdfText: text } = liveRef.current;
    let result: ReturnType<PdfModule['applyPdfEdits']>;
    try {
      result = pdf.applyPdfEdits(extraction, next);
    } catch (err) {
      console.error('[DocCloak] The PDF edits could not be applied:', err);
      showToast(text.editFailed);
      return false;
    }
    const before = extraction.plainText;
    const edited = result.extraction;
    const newText = edited.plainText;
    const state = docStateRef.current;

    // 1. The file: from here on the edited extraction is the PDF on the page (and what a set stores).
    showPdf(edited, result.covered);

    // 2. What hangs on the pages. A page left out takes its "cannot be redacted" part and its
    //    notes with it; a page brought back brings a part the user has not decided about, and
    //    the decision is asked again. Notes of an earlier export described another file: they go.
    const items: UnredactableItem[] = edited.unredactable;
    const allow = state.allowUnredactable && !hasNewUnredactable(state.unredactableItems, items);
    const warnings = pdfReadNotes(now, edited, text);
    setUnredactableItems(items);
    setAllowUnredactable(allow);
    setFileWarnings(warnings);

    // 3. The text, and what was found in it.
    const entities = entitiesLiveRef.current;
    const excluded = excludedLiveRef.current;
    // The text on the page is the PDF's (it always is from the page; the hook itself can be told otherwise).
    const inStep = inputTextLiveRef.current === before;
    const analysed = inStep && lastRunTextRef.current === before;
    setInputText(newText);
    inputTextLiveRef.current = newText;
    let dropped = state.droppedPlaces;
    if (analysed || entities.length > 0) {
      // Text to read came back, not just the break of an empty page (a scan nobody could read).
      const unread = result.addedText && addedRealText(result.kept, newText);
      if (!inStep || (analysed && unread)) {
        dropped = [];
        setEntities([]);
        entitiesLiveRef.current = [];
        const none = new Set<number>();
        setExcludedIndices(none);
        excludedLiveRef.current = none;
        setDroppedPlaces(dropped);
        lastRunTextRef.current = null;
        sessionRef.current.clear();
        setAnonymizedText('');
        setEntries([]);
        setRenamedOriginals(new Set());
        setTableSaved(false);
        setTableVersion((version) => version + 1);
        showToast(text.redactAgain(now.redactButton.redact));
      } else {
        const moved = remapAfterEdit(entities, excluded, result.kept, newText, pdf.mapKeptRange);
        if (newText !== before || moved.gone.length > 0) {
          dropped = remapAfterEdit(dropped, new Set(), result.kept, newText, pdf.mapKeptRange).entities;
          setEntities(moved.entities);
          entitiesLiveRef.current = moved.entities;
          setExcludedIndices(moved.excluded);
          excludedLiveRef.current = moved.excluded;
          setDroppedPlaces(dropped);
          // Still analysed: nothing is in the text that the last run did not see.
          if (analysed) lastRunTextRef.current = newText;
          rebuildAnonymization(newText, moved.entities, moved.excluded);
          if (moved.gone.length > 0) showToast(text.itemsGone(moved.gone.length));
        }
      }
    }
    docStateRef.current = { ...state, unredactableItems: items, allowUnredactable: allow, fileWarnings: warnings, droppedPlaces: dropped };
    return true;
  }, [isBusy, showPdf, showToast, rebuildAnonymization]);

  // PDF export (T216), mirroring exportDocx. The writer re-extracts from the
  // bytes kept in the extraction, verifies its own output and throws
  // PdfVerifyError rather than ship a file with a trace of an original value;
  // StalePdfExtractionError means the bytes changed under us. Both map to
  // fileErrors through fileErrorCode(). A PDF with no detections may still be
  // downloaded (T205): metadata, annotations and the other dropped parts are
  // still cleaned.
  const exportPdf = useCallback(async (): Promise<Blob> => {
    // The parsed file is read from the page when this runs; the list is the one this function
    // was made with. The guard makes sure both belong to the same document.
    exportGuard();
    const extraction = pdfExtractionRef.current;
    if (!extraction) {
      throw new Error('No PDF to export');
    }
    if (unredactablePending) {
      // Fail closed: the user has not confirmed the unredactable parts.
      throw new Error('Unredactable parts have not been confirmed');
    }
    // Fail closed, as for a workbook: the offsets belong to the text that was analysed.
    if (extraction.plainText !== inputText) throw new Error('The PDF no longer matches the analysed text');
    const { replacements, valueReplacements } = replacementsFor(entities, excludedIndices, sessionRef.current);
    const epoch = docEpochRef.current;
    const stillHere = () => docEpochRef.current === epoch;
    // The pages are not edited while this runs (see editPdf), in a set and outside one.
    pdfExportsRef.current += 1;
    setPdfExports((count) => count + 1);
    try {
      return await duringExport(async () => {
        const { writeAnonymizedPdfWithReport } = await import('@doccloak/core/pdf');
        try {
          const result = await writeAnonymizedPdfWithReport(extraction, replacements, valueReplacements, {
            assets: pdfAssets(),
            allowUnredactable,
          });
          // T284: pages left out and pages with hidden areas. A page with a hidden area is written
          // as a picture; the writer lists it with the scans or the rasterized pages as well, but
          // it is neither to the user: it gets a note of its own.
          const leftOut = result.removedPages ?? [];
          const withAreas = result.regionPages ?? [];
          const byHand = new Set(withAreas);
          const lostText = new Set(result.rasterizedPages);
          const core = takeEditNotes(result.warnings);
          const notes = localizeCoreNotes(t, core.rest);
          const numbered = (pages: number[]): string => pageList(pages.map((p) => p + 1));
          const rasterized = result.rasterizedPages.filter((p) => !byHand.has(p));
          if (rasterized.length > 0) notes.push(t.pdf.rasterizedPages(numbered(rasterized), rasterized.length));
          const scans = result.scanPages.filter((p) => !byHand.has(p));
          if (scans.length > 0) notes.push(t.pdf.scanPages(numbered(scans), scans.length));
          if (leftOut.length > 0) notes.push(pdfText.exportLeftOut(numbered(leftOut), leftOut.length));
          const areasWithText = withAreas.filter((p) => !lostText.has(p));
          if (areasWithText.length > 0) notes.push(pdfText.exportAreas(numbered(areasWithText), areasWithText.length));
          const areasWithoutText = withAreas.filter((p) => lostText.has(p));
          if (areasWithoutText.length > 0) notes.push(pdfText.exportAreasNoText(numbered(areasWithoutText), areasWithoutText.length));
          if (core.textStaysPages.length > 0) notes.push(pdfText.areaTextStays(pageList(core.textStaysPages), new Set(core.textStaysPages).size));
          if (stillHere()) {
            if (notes.length > 0) {
              setFileWarnings((prev) => Array.from(new Set([...prev, ...notes])));
            }
            if (result.removed.length > 0) setPdfRemoved(result.removed);
          }
          return result.blob;
        } catch (err) {
          // T288: the values the writer's own check found again stay on the page as a note (the
          // toast that says the same is gone after a few seconds, and the user needs them to act).
          const found = traceValues(err);
          if (found.length > 0 && stillHere()) {
            const note = refusalText.traceValues(quotedValues(found), found.length);
            setFileWarnings((prev) => Array.from(new Set([...prev, note])));
          }
          if (isUnsupportedDocumentError(err) && err.code === 'unredactable-parts') {
            // T284: the writer cannot make a picture of a page (a viewer could not render it safely),
            // and the page has to be a picture because an area on it is hidden. There is nothing to
            // consent to: the way out is to leave the page out or to take the area away, and that is
            // what the user is told. Nothing is exported.
            const pages = refusedPages(err.details);
            const hidden = new Set(regionsOf(extraction.edits).map((region) => region.page + 1));
            if (pages && pages.every((page) => hidden.has(page))) {
              throw new TranslatedRefusal(pdfText.areaRefused(pageList(pages), pages.length));
            }
            if (stillHere()) {
              // Only reachable when the writer knows about parts the reader did
              // not report: surface the notice so the user can decide.
              const parts = err.details.length > 0 ? err.details : ['?'];
              setUnredactableItems(parts.map((part) => ({ part, kind: 'unknown' as const })));
              setAllowUnredactable(false);
            }
          }
          throw err;
        }
      });
    } finally {
      pdfExportsRef.current -= 1;
      setPdfExports((count) => count - 1);
    }
  }, [entities, excludedIndices, inputText, allowUnredactable, unredactablePending, t, pdfText, refusalText, exportGuard, duringExport]);

  const removeFile = useCallback(() => {
    // In a set the open file leaves the set; the other files stay.
    if (batchFilesRef.current.length > 0) {
      if (activeFileIdRef.current !== null) removeBatchFile(activeFileIdRef.current);
      return;
    }
    setDocxFile(null);
    setDocxFileName(null);
    setXlsxFile(null);
    resetPdfState();
    resetImageState();
    resetUnredactableState();
    setInputText('');
    resetTextState();
  }, [resetImageState, resetPdfState, resetTextState, resetUnredactableState, setXlsxFile, removeBatchFile]);

  // Informed-consent export: the user accepts that the listed parts stay
  // exactly as they are in the exported file.
  const continueWithUnredactable = useCallback(() => {
    setAllowUnredactable(true);
  }, []);

  /**
   * What "Clear" takes away, kept for its Undo: the text with the list, what is not redacted and
   * the renamed labels. (Undo used to bring back the text alone: the list, the choices and the
   * table were gone, and the user had to redact and decide again.)
   */
  const snapshotText = useCallback((): TextSnapshot => ({
    text: inputText,
    entities,
    excluded: new Set(excludedIndices),
    renames: new Map(labelRenamesRef.current),
    types: new Map(typeChoicesRef.current),
    lastRunText: lastRunTextRef.current,
    dropped: droppedPlaces,
    tableSaved,
    epoch: docEpochRef.current,
  }), [inputText, entities, excludedIndices, droppedPlaces, tableSaved]);

  const restoreSnapshot = useCallback((snapshot: TextSnapshot) => {
    // A file was loaded, or a set of files opened, since the text was cleared: the page is that
    // document's now. The list of the cleared text must not land on it (a download would apply
    // offsets of one text to the file of another).
    if (batchFilesRef.current.length > 0) return;
    if (snapshot.epoch !== undefined && snapshot.epoch !== docEpochRef.current) return;
    setInputText(snapshot.text);
    setEntities(snapshot.entities);
    setExcludedIndices(new Set(snapshot.excluded));
    labelRenamesRef.current.clear();
    for (const [original, label] of snapshot.renames) labelRenamesRef.current.set(original, label);
    typeChoicesRef.current = new Map(snapshot.types);
    lastRunTextRef.current = snapshot.lastRunText;
    setDroppedPlaces(snapshot.dropped);
    if (snapshot.entities.length === 0) return;
    // The labels are the ones the values had: they belong to their values for the life of the tab.
    rebuildAnonymization(snapshot.text, snapshot.entities, snapshot.excluded);
    setResultTakenOut(takenOutTextsRef.current.has(snapshot.text));
    setTableSaved(snapshot.tableSaved);
  }, [rebuildAnonymization]);

  const clear = useCallback(() => {
    // A set goes as a whole: its files, their documents, its labels.
    if (batchFilesRef.current.length > 0) {
      clearBatch();
      return;
    }
    setInputText('');
    resetTextState();
    setDocxFile(null);
    setDocxFileName(null);
    setXlsxFile(null);
    resetPdfState();
    resetImageState();
    resetUnredactableState();
  }, [resetImageState, resetPdfState, resetTextState, resetUnredactableState, setXlsxFile, clearBatch]);

  // T261: closing the tab now would lose the only way back to the names. The browser shows its own
  // generic question; the reminder on the page says what is at stake and offers the way out.
  // Where the places that are found but not redacted stand in the protected text.
  const keptRanges = useMemo(
    () => keptRangesInOutput(inputText, entities, excludedIndices, entries, anonymizedText),
    [inputText, entities, excludedIndices, entries, anonymizedText],
  );

  // --- What the page shows of a set ---
  const inSet = batchFiles.length > 0;
  // The open file is shown as it is on the page now; the others as they were when they left it.
  const fileViews = useMemo(() => {
    // A document has a protected text exactly when its analysis has finished (see putDocument).
    const analysed = anonymizedText !== '';
    return batchFiles.map((file) => viewOf(
      file.id === activeFileId
        ? { ...file, summary: { analysed, pending: unredactablePending, found: entities.length, takenOut: resultTakenOut, pairs: entries } }
        : file,
      activeFileId,
    ));
  }, [batchFiles, activeFileId, anonymizedText, unredactablePending, entities, resultTakenOut, entries]);
  // The table of the set as the page counts it: the open file's pairs and the other files' pairs
  // of the moment they were last made, in the order of the list. (A save or a restore makes every
  // file's pairs anew.) Opening another file changes neither the count nor the pair shown as a
  // sample: the restore panel takes a change of either for another table.
  const setPairs = useMemo(
    () => batchFiles.map((file) => (file.id === activeFileId ? entries : file.summary?.pairs ?? [])),
    [batchFiles, activeFileId, entries],
  );
  const mappingCount = useMemo(
    () => (inSet ? countValues(setPairs) : entries.length),
    [inSet, entries, setPairs],
  );
  const firstPair = inSet ? setPairs.find((pairs) => pairs.length > 0)?.[0] : entries[0];
  const mappingSample: MappingSample | null = firstPair ? { replacement: firstPair.replacement, original: firstPair.original } : null;
  const hasMapping = mappingCount > 0;
  // One table for the set: it is at risk once the result of ANY of its files left the page.
  const anyTakenOut = resultTakenOut || batchFiles.some((file) => file.id !== activeFileId && file.summary?.takenOut === true);
  const waitingFiles = batchFiles.filter((file) => file.stage === 'waiting').length;

  const tableAtRisk = replacementMode === 'labeled' && hasMapping && anyTakenOut && !tableSaved && !reminderDismissed && !reminderOff;
  useEffect(() => {
    if (!tableAtRisk) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [tableAtRisk]);

  return {
    inputText,
    anonymizedText,
    entities,
    entries,
    excludedIndices,
    modelLoaded,
    modelLoading,
    modelError,
    modelNeedsWebGpu,
    anonymizing,
    detectionProgress,
    detectionEta,
    detectionError,
    detectionErrorKind,
    downloadProgress,
    threshold,
    replacementMode,
    customLabels,
    docxFileName,
    pdfFileName,
    imageFileName,
    fileName: docxFileName ?? xlsxFile?.name ?? pdfFileName ?? imageFileName,
    hasDocxExtraction: docxFile !== null,
    hasXlsxExtraction: xlsxFile !== null,
    hasPdfExtraction: pdfFileName !== null,
    /** A document (.doc, .docx, .xlsx or .pdf) is loaded: the export buttons and the unredactable notice apply. */
    hasDocumentExtraction: docxFile !== null || xlsxFile !== null || pdfFileName !== null,
    /** Parts the PDF writer drops from the export (annotations, forms, ...), for the information card. */
    pdfRemoved,
    /**
     * The pages of the PDF on the page, to leave pages out and hide areas by hand (T284); null
     * without a PDF. `apply` takes the full new set of edits; nothing is changed while `busy`.
     */
    pdfPages: pdfView
      ? {
          extraction: pdfView.extraction,
          edits: pdfView.extraction.edits ?? NO_PDF_EDITS,
          covered: pdfView.covered,
          busy: anonymizing || queueRunning || exportsRunning > 0 || pdfExports > 0,
          apply: editPdf,
        }
      : null,
    hasImage: imageFileName !== null,
    ocrProgress,
    ocrPages,
    handleInputChange,
    anonymize,
    cancelAnonymize,
    addManualEntity,
    removeEntity,
    renameLabel,
    snapshotText,
    restoreSnapshot,
    droppedCount: droppedPlaces.length,
    keepDroppedRedacted,
    dismissDropped,
    tableVersion,
    resetLabel,
    renamedOriginals,
    keptRanges,
    toggleEntity,
    setEntitiesExcluded,
    changeEntityType,
    deanonymize,
    restoreText,
    restoreDocx,
    exportMapping,
    importMapping,
    importedMapping,
    clearImportedMapping,
    clear,
    handleThresholdChange,
    handleReplacementModeChange,
    handleCustomLabelsChange,
    activeProvider,
    /** Model the settings selector highlights: the preselection before consent, else the active one. */
    selectedProvider: pendingProvider ?? activeProvider,
    pendingProvider,
    handleSwitchProvider,
    regexRules,
    handleRegexChange,
    regexRegion,
    handleRegexRegionChange,
    dictionary,
    handleDictionaryChange,
    ignoreList,
    handleIgnoreListChange,
    loadFile,
    exportDocx,
    exportXlsx,
    exportPdf,
    keepTypes,
    handleKeepTypesChange,
    xlsxInfo,
    /** False when the user chose not to be reminded to save the replacement table. */
    tableReminderEnabled: !reminderOff,
    /** The result left the page (in a set: the result of any of its files). */
    resultTakenOut: anyTakenOut,
    /** The result left the page and its table was never saved: clearing now loses the way back. */
    tableUnsaved: replacementMode === 'labeled' && hasMapping && anyTakenOut && !tableSaved,
    /** The table that restores when none is loaded from a file: the document's, or the one of the set. */
    hasMapping,
    mappingCount,
    mappingSample,
    /** One file or several, picked or dropped: one is loaded as before, several become a set. */
    loadFiles,
    /** The set of files (WLojek/DocCloak#6). `files` is empty when no set is open. */
    batch: {
      files: fileViews,
      activeId: activeFileId,
      /** The file the queue is working on. */
      current: queuePosition,
      running: queueRunning,
      /** The user stopped the queue and files still wait. */
      paused: queuePaused && waitingFiles > 0,
      waiting: waitingFiles,
      /** Files wait for the model (not downloaded, loading, or failed to load). */
      waitingForModel: waitingFiles > 0 && !modelLoaded,
      /** A detection, the queue or an export is at work: a file is not opened or removed now. */
      busy: anonymizing || queueRunning || exportsRunning > 0,
      maxFiles: maxBatchFiles,
      /** How many files of the set are held in memory now: the open document, the ones read and put aside, the ones still to be read. */
      documentsHeld,
      add: addBatchFiles,
      open: openBatchFile,
      remove: removeBatchFile,
      resume: resumeQueue,
      clear: clearBatch,
    },
    setTableReminderEnabled,
    markResultTakenOut,
    dismissTableReminder,
    /** The protected result left the page and its replacement table exists only in this tab. */
    tableReminder: tableAtRisk,
    exportRedactedImage,
    removeFile,
    retryModelLoad: startModelLoad,
    modelConsented,
    acceptModelDownload,
    unredactableItems,
    fileWarnings,
    allowUnredactable,
    unredactablePending,
    continueWithUnredactable,
  };
}
