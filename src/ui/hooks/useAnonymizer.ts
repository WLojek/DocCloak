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
  writeRestoredDocx,
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
import type { PdfExtraction, RemovedPart } from '@doccloak/core/pdf';
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
import { leftoversIn, type KnownLabel, type RestoreContext } from '../restoreReport.ts';

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

// 1-based page numbers as a short list for notes (T236); lives with the other note helpers.
export { pageList };

/** Download name of the redacted PDF: `<base>_redacted.pdf` (T216). */
export function pdfDownloadName(fileName: string | null | undefined): string {
  const base = fileName?.replace(/\.pdf$/i, '').trim() || 'document';
  return `${base}_redacted.pdf`;
}

/** Download name of a docx with the names restored: `<base>_restored.docx` (WLojek/DocCloak#3). */
export function restoredDownloadName(fileName: string | null | undefined): string {
  const base = fileName?.replace(/\.docx$/i, '').replace(/[_-]redacted$/i, '').trim() || 'document';
  return `${base}_restored.docx`;
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
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}${two(now.getMinutes())}`;
  return `${base}_replacement-table_${stamp}.json`;
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

export function useAnonymizer() {
  const { language, t } = useTranslation();
  const { showToast } = useToast();
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
  const rememberLabels = useCallback(() => {
    for (const entry of [...issuedLabelsRef.current, ...sessionRef.current.getEntries()]) {
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

  const unredactablePending = unredactableItems.length > 0 && !allowUnredactable;

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

  const rebuildAnonymization = useCallback(
    (text: string, allEntities: DetectedEntity[], excluded: Set<number>) => {
      sessionRef.current.clear();
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
          sessionRef.current.importEntries(issuedLabelsRef.current.filter((entry) => redactedNow.has(entry.original)));
        } catch (err) {
          // More values than a table may hold: number them as before rather than fail, and say
          // that labels can move now (once per document).
          console.error('[DocCloak] Stable labels unavailable for this document:', err);
          issuedLabelsRef.current = [];
          sessionRef.current.clear();
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
      if (replacementModeRef.current === 'labeled') {
        const numberedLabel = new Map(issuedLabelsRef.current.map((entry) => [entry.original, entry.replacement]));
        for (let round = 0; round < 4; round++) {
          let changed = false;
          for (const [original, label] of labelRenamesRef.current) {
            if (sessionRef.current.getForward(original) === label) continue;
            if (sessionRef.current.renameLabel(original, label).length > 0) changed = true;
          }
          // A typed label, or one that follows from it, that the document's own text reads as
          // ("Case code CLIENT_2", "[CHIEF_LAST]" in a clause) gives way too.
          const inText = new Set(sessionRef.current.restoreSpans(text).map((span) => span.token));
          for (const entry of sessionRef.current.getEntries()) {
            const form = canonicalPlaceholderForm(entry.replacement);
            const first = form === null ? undefined : everLabelsRef.current.get(form);
            const takenByAnother = first !== undefined && first.original !== entry.original;
            if (!takenByAnother && !inText.has(entry.replacement)) continue;
            const own = numberedLabel.get(entry.original);
            if (own && own !== entry.replacement && sessionRef.current.renameLabel(entry.original, own).length > 0) changed = true;
          }
          if (!changed) break;
        }
        // A rename that could not be kept (its label is another value's now) is said, not dropped in silence.
        for (const [original, label] of [...labelRenamesRef.current]) {
          const now = sessionRef.current.getForward(original);
          if (now === undefined || now === label) continue;
          labelRenamesRef.current.delete(original);
          const holder = sessionRef.current.getEntries().find((entry) => entry.replacement === label);
          sayRenameDroppedRef.current(label, holder?.original ?? null);
        }
        setRenamedOriginals(new Set(labelRenamesRef.current.keys()));
      }
      // The text is made once, from the labels as they are in the end.
      const result = sessionRef.current.anonymizeText(text, activeEntities);
      setAnonymizedText(result);
      setEntries(sessionRef.current.getEntries());
      rememberLabels();
      // A different table than the one a saved file holds.
      setTableSaved(false);
      setTableVersion((version) => version + 1);
      // The result already left the page: the copy that is out does not follow this change.
      if (resultTakenOutRef.current && !changeNoticedRef.current) {
        changeNoticedRef.current = true;
        sayChangedRef.current();
      }
    },
    [rememberLabels]
  );

  /** Drop the table loaded from a file: the current document's table restores again. */
  const clearImportedMapping = useCallback(() => {
    importedSessionRef.current = null;
    setImportedMapping(null);
  }, []);

  const anonymize = useCallback(() => {
    const text = inputText;
    if (!text.trim()) return;
    // The user has not yet decided what to do with parts we cannot redact.
    if (unredactablePending) return;

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
      labelRenamesRef.current.clear();
      setRenamedOriginals(new Set());
      setExcludedIndices(new Set());
    }
    // A copy that is out stays out when the same text is redacted again: the reminder and the
    // question before "Clear" must not go away with a second press of the button.
    // A text whose result already left the page in this tab (cleared and brought back since) is
    // still out.
    if (!sameText) setResultTakenOut(takenOutTextsRef.current.has(text));
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
          // Dictionary words are always redacted; detected entities win overlaps.
          // The ignore list is applied last so a listed term is never
          // anonymized, whichever tier found it.
          const detected = filterIgnoredEntities(
            text,
            mergeDictionaryEntities(text, results, dictionary),
            ignoreList,
          );
          // Values the user marked by hand come back where nothing detected now covers them.
          const manual = previousManual.filter((m) => !detected.some((e) => e.start < m.end && e.end > m.start));
          const withDictionary = manual.length > 0 ? [...detected, ...manual].sort((a, b) => a.start - b.start) : detected;
          // Not redacted: what the user kept in the previous run of this text; for anything new,
          // the types set to never be anonymized (T263). A dictionary word or a hand-marked value is
          // an explicit "redact this" and is never switched off by the type setting.
          const neverTypes = new Set(keepTypesRef.current);
          const excluded = new Set<number>();
          withDictionary.forEach((entity, index) => {
            const key = placeKey(entity);
            if (previousPlaces?.has(key)) {
              if (previousKept?.has(key)) excluded.add(index);
            } else if (neverTypes.has(entity.type) && entity.detector !== 'dictionary' && entity.detector !== 'manual') {
              excluded.add(index);
            }
          });
          lastRunTextRef.current = text;
          setEntities(withDictionary);
          setExcludedIndices(excluded);
          rebuildAnonymization(text, withDictionary, excluded);
          const carried = previousKept ? [...excluded].filter((i) => previousKept.has(placeKey(withDictionary[i]))).length : 0;
          if (carried > 0 || (sameText && labelRenamesRef.current.size > 0)) showToast(t.entityTable.choicesKeptToast);
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
  }, [inputText, entities, excludedIndices, dictionary, ignoreList, rebuildAnonymization, unredactablePending, showToast, t, clearImportedMapping]);

  /**
   * T222: stop the running detection. The overlay closes at once; the worker
   * stops at its next inference chunk (or is replaced if it does not
   * acknowledge in time), and no result of this run is applied.
   */
  const cancelAnonymize = useCallback(() => {
    const controller = abortRef.current;
    if (!controller || controller.signal.aborted) return;
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
    setInputText(text);
    setDroppedPlaces([]);
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    labelRenamesRef.current.clear();
    setRenamedOriginals(new Set());
    lastRunTextRef.current = null;
    setResultTakenOut(false);
  }, []);

  /** Add places to the list (marked by hand, or kept from an earlier run). */
  const addEntities = useCallback(
    (added: DetectedEntity[]) => {
      setEntities((prev) => {
        const next = [...prev, ...added].sort((a, b) => a.start - b.start);
        // "Not redacted" is kept by position in the list: every place moves to where it stands
        // in the new list. (They used to keep their old numbers, so after a value was marked by
        // hand a different place than the one the user chose was left readable.)
        const position = new Map(next.map((entity, index) => [entity, index]));
        setExcludedIndices((excl) => {
          const moved = new Set<number>();
          for (const i of excl) {
            const at = position.get(prev[i]);
            if (at !== undefined) moved.add(at);
          }
          rebuildAnonymization(inputTextLiveRef.current, next, moved);
          return moved;
        });
        return next;
      });
    },
    [rebuildAnonymization]
  );
  addEntitiesRef.current = addEntities;

  /** Mark ranges of the text by hand. */
  const addManualRanges = useCallback(
    (ranges: Array<[number, number]>, type: EntityType) => {
      addEntities(ranges.map(([start, end]) => (
        { type, value: inputText.slice(start, end), start, end, confidence: 1.0, detector: 'manual' }
      )));
    },
    [inputText, addEntities]
  );

  const addManualEntity = useCallback(
    (from: number, to: number, type: EntityType) => {
      // A selection made with a double click or a drag takes the comma or the full stop along:
      // "weekly." became a value that matched nowhere else, and the full stop left the text.
      let start = from;
      let end = to;
      while (start < end && SELECTION_EDGE.test(inputText[start])) start++;
      while (end > start && SELECTION_EDGE.test(inputText[end - 1])) end--;
      if (end <= start) return;
      addManualRanges([[start, end]], type);
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
    [inputText, entities, addManualRanges, showToast, t]
  );

  const removeEntity = useCallback(
    (index: number) => {
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
    [inputText, rebuildAnonymization]
  );

  const toggleEntity = useCallback(
    (index: number) => {
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
    [rebuildAnonymization]
  );

  /**
   * WLojek/DocCloak#4: keep (excluded = true) or redact (false) many items in one step, with
   * one rebuild. The table uses it for "everything shown" after a filter by type or text.
   */
  const setEntitiesExcluded = useCallback(
    (indices: number[], excluded: boolean) => {
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
    [rebuildAnonymization]
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
    takenOutTextsRef.current.add(inputTextLiveRef.current);
    // From this copy on, the next change of the result is worth one word.
    changeNoticedRef.current = false;
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

  /** The table the restore uses: the one loaded from a file, else the current document's. */
  const restoreSession = useCallback(
    (): AnonymizationSession => importedSessionRef.current ?? sessionRef.current,
    [],
  );

  const deanonymize = useCallback((aiResponse: string): string => {
    return restoreSession().deanonymize(aiResponse);
  }, [restoreSession]);

  /** What this tab knows about labels it issued; nothing when a table from a file does the restoring. */
  const knownLabelsForRestore = useCallback((): RestoreContext => {
    if (importedSessionRef.current) return { ever: new Map(), documentValues: new Set(), tableForms: new Set() };
    const tableForms = new Set<string>();
    for (const entry of sessionRef.current.getEntries()) {
      const form = canonicalPlaceholderForm(entry.replacement);
      if (form !== null) tableForms.add(form);
    }
    return {
      ever: everLabelsRef.current,
      documentValues: new Set(entitiesLiveRef.current.map((entity) => entity.value)),
      tableForms,
      documentText: inputTextLiveRef.current,
    };
  }, []);

  /**
   * The net under everything above: a label is restored only when the value it stands for now is
   * the first value it stood for in this tab. A label that changed hands (however that came
   * about) is left in the text and reported, never written out as someone else.
   */
  const guardSpans = useCallback((text: string, spans: RestoreSpan[]): { spans: RestoreSpan[]; refused: KnownLabel[] } => {
    if (importedSessionRef.current) return { spans, refused: [] };
    const safe: RestoreSpan[] = [];
    const refused: KnownLabel[] = [];
    // Labels that the open document's own text reads as ("{PERSON_1}" as a template field,
    // "ADDRESS_1" as a column name, next to a value that holds that label from an earlier text):
    // in a reply nobody can tell the field from the label, so it is not restored.
    const inText = new Set(sessionRef.current.restoreSpans(inputTextLiveRef.current).map((span) => span.token));
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
  const fileCrossesDocument = useCallback((spans: RestoreSpan[]): boolean => {
    if (!importedSessionRef.current) return false;
    const values = new Set(entitiesLiveRef.current.map((entity) => entity.value));
    return spans.some((span) => {
      const form = canonicalPlaceholderForm(span.token);
      const mine = form === null ? undefined : everLabelsRef.current.get(form);
      return mine !== undefined && mine.original !== span.replacement && values.has(mine.original);
    });
  }, []);

  /** Pasted text with the originals back, plus what the docx route also reports: how many places, what stayed. */
  const restoreText = useCallback((aiResponse: string): RestoreTextResult => {
    const session = restoreSession();
    const { spans, refused } = guardSpans(aiResponse, session.restoreSpans(aiResponse));
    const unresolved = session.unresolvedTokens(aiResponse);
    // The pieces between the restores keep the reply's own text: that is where a label can have stayed.
    const pieces: string[] = [];
    let last = 0;
    for (const span of spans) {
      pieces.push(aiResponse.slice(last, span.start));
      last = span.end;
    }
    pieces.push(aiResponse.slice(last));
    const left = leftoversIn(pieces, unresolved, { ...knownLabelsForRestore(), refused });
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
      fileOverDocument: fileCrossesDocument(spans),
    };
  }, [restoreSession, knownLabelsForRestore, guardSpans, fileCrossesDocument]);

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
      const session = restoreSession();
      const { spans, refused } = guardSpans(extraction.plainText, session.restoreSpans(extraction.plainText));
      const pieces: string[] = [];
      let last = 0;
      for (const span of spans) {
        pieces.push(extraction.plainText.slice(last, span.start));
        last = span.end;
      }
      pieces.push(extraction.plainText.slice(last));
      const { unresolved, stale, others } = leftoversIn(pieces, session.unresolvedTokens(extraction.plainText), { ...knownLabelsForRestore(), refused });
      const downloadName = restoredDownloadName(file.name);
      if (spans.length === 0) {
        return { success: true, restored: 0, unresolved, stale, others, blob: null, downloadName };
      }
      const blob = await writeRestoredDocx(extraction, spans);
      return { success: true, restored: spans.length, unresolved, stale, others, fileOverDocument: fileCrossesDocument(spans), blob, downloadName };
    } catch (err) {
      console.error('[DocCloak] Failed to restore the document:', err);
      if (isUnsupportedDocumentError(err)) {
        return { success: false, message: fileErrorMessage(t, err.code) };
      }
      return { success: false, message: t.deAnonymize.docxFailed };
    }
  }, [restoreSession, knownLabelsForRestore, guardSpans, fileCrossesDocument, t]);

  /**
   * WLojek/DocCloak#3: the current document's replacement table as a file (the JSON the
   * DocCloak command line reads). Only on the user's request: it holds every original value.
   * Null when there is nothing to save.
   */
  const exportMapping = useCallback((): { blob: Blob; count: number; downloadName: string } | null => {
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
  }, [docxFileName, xlsxFile, pdfFileName, imageFileName]);

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

  const renameLabel = useCallback((original: string, newLabel: string) => {
    if (replacementModeRef.current !== 'labeled') return;
    const current = sessionRef.current.getForward(original);
    if (current === undefined || current === newLabel) return;
    // What a label may be: a letter or a digit in it (a label of signs only has no form restore
    // could compare, so nothing could keep it from passing to another value), and no brackets
    // inside ("[CLIENT][BOSS]" would be read as two labels).
    const inner = newLabel.replace(/^\[|\]$/g, '');
    const form = canonicalPlaceholderForm(newLabel);
    if (form === null || !/[\p{L}\p{N}]/u.test(inner) || /[[\]<>{}]/.test(inner)) {
      showToast(t.entityTable.labelInvalid);
      return;
    }
    // Bracketed text the document itself holds ("[Client]" in a contract template, "[Fee]") would
    // be taken for the label when a reply is restored, and replaced by the value.
    for (const match of inputText.matchAll(BRACKETED_IN_TEXT)) {
      if (canonicalPlaceholderForm(match[0]) === form) {
        showToast(t.entityTable.labelInText(match[0]));
        return;
      }
    }
    // A label issued to another value in this tab is taken, also while that value is not
    // redacted: a reply written from an earlier copy must never restore to someone else.
    // Compared the way restore compares: "Person 2" is "[PERSON_2]" to it, so it is taken as well.
    const holder = everLabelsRef.current.get(form);
    if (holder && holder.original !== original) {
      // Refused: say so, and for which value, instead of doing nothing.
      showToast(t.entityTable.labelTaken(newLabel, holder.original));
      return;
    }
    // The numbered shape is DocCloak's own (unless it is this value's own label coming back).
    if (!holder && OWN_LABEL_SHAPE.test(labelSkeleton(newLabel))) {
      showToast(t.entityTable.labelOwnShape(newLabel));
      return;
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
          showToast(t.entityTable.labelDerivedTaken(newLabel, derived, owner.original));
          return;
        }
      }
    }
    // Remembered, then everything is made again in one place (the same path a change of the list
    // takes): a later rename of the same value moves last.
    labelRenamesRef.current.delete(original);
    labelRenamesRef.current.set(original, newLabel);
    rebuildAnonymization(inputText, entities, excludedIndices);
  }, [showToast, t, inputText, entities, excludedIndices, rebuildAnonymization]);

  /** Redact again the places an earlier run had found and the last one did not. */
  const keepDroppedRedacted = useCallback(() => {
    if (droppedPlaces.length === 0) return;
    addEntitiesRef.current(droppedPlaces.map((entity) => ({ ...entity, detector: 'manual' })));
    setDroppedPlaces([]);
  }, [droppedPlaces]);
  const dismissDropped = useCallback(() => setDroppedPlaces([]), []);

  /** Back to the numbered label of a renamed value (and of the variants that followed it). */
  const resetLabel = useCallback((original: string) => {
    if (!labelRenamesRef.current.delete(original)) return;
    rebuildAnonymization(inputText, entities, excludedIndices);
  }, [inputText, entities, excludedIndices, rebuildAnonymization]);

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
    pdfExtractionRef.current = null;
  }, []);

  /** Resets every input-side state before a newly loaded file's text replaces it. */
  const resetTextState = useCallback(() => {
    setDroppedPlaces([]);
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    sessionRef.current.clear();
    labelRenamesRef.current.clear();
    setRenamedOriginals(new Set());
    lastRunTextRef.current = null;
    setResultTakenOut(false);
    setTableSaved(false);
  }, []);

  const loadDocxFile = useCallback(async (file: File): Promise<LoadFileResult> => {
    if (!isSupportedFile(file.name)) {
      return { success: false, error: 'unsupported' };
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
          success: false,
          error: 'empty-document',
          code: 'empty-document',
          message: fileErrorMessage(t, 'empty-document'),
        };
      }

      resetImageState();
      resetPdfState();
      setXlsxFile(null);
      setDocxFile(file);
      setDocxFileName(file.name);
      setInputText(plainText);
      resetTextState();
      setUnredactableItems(items);
      setFileWarnings(localizeCoreNotes(t, warnings));
      setAllowUnredactable(false);
      return { success: true };
    } catch (err) {
      console.error('[DocCloak] Failed to read file:', err);
      if (isUnsupportedDocumentError(err)) {
        return { success: false, error: err.message, code: err.code, message: fileErrorMessage(t, err.code) };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [resetImageState, resetPdfState, resetTextState, t, setXlsxFile]);

  // Spreadsheet (T265): Core reads text cells, comments, headers and footers, text boxes, cells
  // shown as dates and long integers; the other numbers stay out. The notes say what was read.
  const loadXlsxFile = useCallback(async (file: File): Promise<LoadFileResult> => {
    try {
      const extraction = await readXlsx(file);
      if (extraction.empty) {
        return { success: false, error: 'empty-document', code: 'empty-document', message: fileErrorMessage(t, 'empty-document') };
      }
      resetImageState();
      resetPdfState();
      setDocxFile(null);
      setDocxFileName(null);
      setXlsxFile(file);
      // What was checked and what was not has its own notice (SpreadsheetNotice), shown before the export.
      setXlsxInfo({ ...extraction.stats, renamedSheets: [], unchecked: extraction.uncheckedCells });
      setInputText(extraction.plainText);
      resetTextState();
      setUnredactableItems(extraction.unredactable);
      setFileWarnings(localizeCoreNotes(t, extraction.warnings));
      setAllowUnredactable(false);
      return { success: true };
    } catch (err) {
      console.error('[DocCloak] Failed to read the workbook:', err);
      if (isUnsupportedDocumentError(err)) {
        return { success: false, error: err.message, code: err.code, message: fileErrorMessage(t, err.code) };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err), code: 'invalid-package', message: t.xlsx.invalid };
    }
  }, [resetImageState, resetPdfState, resetTextState, setXlsxFile, t]);

  // PDF (T216): the reader keeps the text layer's geometry; detection runs on
  // its plainText like any other document. Scanned pages and undecodable
  // text arrive as unredactable parts and go through the same
  // Continue/Cancel notice as docx; the parts the writer will drop are
  // listed for information.
  const loadPdfFile = useCallback(async (file: File): Promise<LoadFileResult> => {
    // Refuse oversized files before the PDF chunk is even downloaded (Core re-checks the cap).
    if (file.size > PDF_MAX_BYTES) {
      return { success: false, error: `PDF is ${file.size} bytes; the limit is ${PDF_MAX_BYTES}`, code: 'too-large', message: fileErrorMessage(t, 'too-large', 'pdf') };
    }
    try {
      const { readPdf } = await import('@doccloak/core/pdf');
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
          success: false,
          error: 'empty-document',
          code: 'empty-document',
          message: scan ? t.fileErrors[readByOcr ? 'pdf-scan-ocr-nothing' : 'pdf-scan-no-text'] : fileErrorMessage(t, 'empty-document'),
        };
      }
      const pagesWhere = (keep: (p: (typeof extraction.pages)[number]) => boolean): number[] => extraction.pages.filter(keep).map((p) => p.index + 1);
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

      resetImageState();
      setDocxFile(null);
      setDocxFileName(null);
      setXlsxFile(null);
      pdfExtractionRef.current = extraction;
      setPdfFileName(file.name);
      setPdfRemoved(extraction.removed);
      setInputText(extraction.plainText);
      resetTextState();
      setUnredactableItems(extraction.unredactable);
      setFileWarnings([...notes, ...localizeCoreNotes(t, extraction.warnings)]);
      setAllowUnredactable(false);
      return { success: true };
    } catch (err) {
      console.error('[DocCloak] Failed to read PDF:', err);
      if (isUnsupportedDocumentError(err)) {
        return { success: false, error: err.message, code: err.code, message: fileErrorMessage(t, err.code, 'pdf') };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [resetImageState, resetTextState, t, language, setXlsxFile]);

  const loadImageFile = useCallback(async (file: File): Promise<LoadFileResult> => {
    try {
      setOcrProgress(0);
      const canvas = await loadImageToCanvas(file);
      const { text, words } = await recognizeCanvas(canvas, language, (p) => setOcrProgress(p));
      if (!text.trim()) {
        return { success: false, error: 'no-text' };
      }

      imageCanvasRef.current = canvas;
      ocrWordsRef.current = words;
      setImageFileName(file.name);
      setDocxFile(null);
      setDocxFileName(null);
      setXlsxFile(null);
      resetPdfState();
      resetUnredactableState();
      setInputText(text);
      resetTextState();
      return { success: true };
    } catch (err) {
      console.error('[DocCloak] OCR failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      setOcrProgress(null);
    }
  }, [language, resetPdfState, resetTextState, resetUnredactableState, setXlsxFile]);

  // Route uploads by type: images go through OCR, PDFs through the PDF
  // reader, everything else through the docx reader.
  const loadFile = useCallback(async (file: File): Promise<LoadFileResult> => {
    if (isImageFile(file.name)) return loadImageFile(file);
    if (isPdfFile(file.name)) return loadPdfFile(file);
    if (isExcelFile(file.name)) return loadXlsxFile(file);
    return loadDocxFile(file);
  }, [loadImageFile, loadPdfFile, loadXlsxFile, loadDocxFile]);

  const exportRedactedImage = useCallback(async (): Promise<Blob> => {
    const canvas = imageCanvasRef.current;
    if (!canvas || entities.length === 0) {
      throw new Error('No image or entities to export');
    }
    const activeEntities = entities.filter((_, i) => !excludedIndices.has(i));
    return renderRedactedImage(canvas, ocrWordsRef.current, activeEntities);
  }, [entities, excludedIndices]);

  const exportDocx = useCallback(async (): Promise<Blob> => {
    // A file with no detections can still be exported (T205): the writer
    // scrubs metadata and revision fingerprints, and a user who added nothing
    // to the dictionary gets the same file back with those cleaned.
    if (!docxFile) {
      throw new Error('No document to export');
    }
    if (unredactablePending) {
      // Fail closed: the user has not confirmed the unredactable parts.
      throw new Error('Unredactable parts have not been confirmed');
    }

    const { replacements, valueReplacements } = replacementsFor(entities, excludedIndices, sessionRef.current);

    // The writer stays fail-closed by default; allowUnredactable is true only
    // after the user chose Continue on the notice.
    const writeOptions: DocxWriteOptions = { allowUnredactable };

    const writeDocx = async (extraction: DocxExtraction): Promise<Blob> => {
      try {
        const result = await writeAnonymizedDocxWithReport(extraction, replacements, valueReplacements, writeOptions);
        const notes = localizeCoreNotes(t, result.warnings);
        if (notes.length > 0) {
          setFileWarnings((prev) => Array.from(new Set([...prev, ...notes])));
        }
        return result.blob;
      } catch (err) {
        if (isUnsupportedDocumentError(err) && err.code === 'unredactable-parts') {
          // Only reachable when the writer knows about parts the reader did
          // not report: surface the notice so the user can decide.
          const parts = err.details.length > 0 ? err.details : ['?'];
          setUnredactableItems(parts.map((part) => ({ part, kind: 'unknown' as const })));
          setAllowUnredactable(false);
        }
        throw err;
      }
    };

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
  }, [docxFile, entities, excludedIndices, allowUnredactable, unredactablePending, t]);

  // Spreadsheet export (T265), mirroring exportDocx: the file is read again, the detected places
  // are replaced in the cells, a sheet named after a replaced value gets a valid new name.
  const exportXlsx = useCallback(async (): Promise<Blob> => {
    if (!xlsxFile) throw new Error('No workbook to export');
    if (unredactablePending) throw new Error('Unredactable parts have not been confirmed');
    const { replacements, valueReplacements } = replacementsFor(entities, excludedIndices, sessionRef.current);
    const extraction = await readXlsx(xlsxFile);
    // Fail closed: the offsets belong to the text that was analysed.
    if (extraction.plainText !== inputText) throw new Error('The workbook no longer matches the analysed text');
    try {
      const result = await writeAnonymizedXlsxWithReport(extraction, replacements, valueReplacements, { allowUnredactable });
      const notes = localizeCoreNotes(t, result.warnings);
      if (notes.length > 0) setFileWarnings((prev) => Array.from(new Set([...prev, ...notes])));
      setXlsxInfo((prev) => (prev ? { ...prev, renamedSheets: result.renamedSheets } : prev));
      return result.blob;
    } catch (err) {
      if (isUnsupportedDocumentError(err) && err.code === 'unredactable-parts') {
        const parts = err.details.length > 0 ? err.details : ['?'];
        setUnredactableItems(parts.map((part) => ({ part, kind: 'unknown' as const })));
        setAllowUnredactable(false);
      }
      throw err;
    }
  }, [xlsxFile, entities, excludedIndices, inputText, allowUnredactable, unredactablePending, t]);

  // PDF export (T216), mirroring exportDocx. The writer re-extracts from the
  // bytes kept in the extraction, verifies its own output and throws
  // PdfVerifyError rather than ship a file with a trace of an original value;
  // StalePdfExtractionError means the bytes changed under us. Both map to
  // fileErrors through fileErrorCode(). A PDF with no detections may still be
  // downloaded (T205): metadata, annotations and the other dropped parts are
  // still cleaned.
  const exportPdf = useCallback(async (): Promise<Blob> => {
    const extraction = pdfExtractionRef.current;
    if (!extraction) {
      throw new Error('No PDF to export');
    }
    if (unredactablePending) {
      // Fail closed: the user has not confirmed the unredactable parts.
      throw new Error('Unredactable parts have not been confirmed');
    }
    const { replacements, valueReplacements } = replacementsFor(entities, excludedIndices, sessionRef.current);
    const { writeAnonymizedPdfWithReport } = await import('@doccloak/core/pdf');
    try {
      const result = await writeAnonymizedPdfWithReport(extraction, replacements, valueReplacements, {
        assets: pdfAssets(),
        allowUnredactable,
      });
      const notes = localizeCoreNotes(t, result.warnings);
      if (result.rasterizedPages.length > 0) {
        const pages = pageList(result.rasterizedPages.map((p) => p + 1));
        notes.push(t.pdf.rasterizedPages(pages, result.rasterizedPages.length));
      }
      if (result.scanPages.length > 0) {
        notes.push(t.pdf.scanPages(pageList(result.scanPages.map((p) => p + 1)), result.scanPages.length));
      }
      if (notes.length > 0) {
        setFileWarnings((prev) => Array.from(new Set([...prev, ...notes])));
      }
      if (result.removed.length > 0) setPdfRemoved(result.removed);
      return result.blob;
    } catch (err) {
      if (isUnsupportedDocumentError(err) && err.code === 'unredactable-parts') {
        // Only reachable when the writer knows about parts the reader did
        // not report: surface the notice so the user can decide.
        const parts = err.details.length > 0 ? err.details : ['?'];
        setUnredactableItems(parts.map((part) => ({ part, kind: 'unknown' as const })));
        setAllowUnredactable(false);
      }
      throw err;
    }
  }, [entities, excludedIndices, allowUnredactable, unredactablePending, t]);

  const removeFile = useCallback(() => {
    setDocxFile(null);
    setDocxFileName(null);
    setXlsxFile(null);
    resetPdfState();
    resetImageState();
    resetUnredactableState();
    setInputText('');
    resetTextState();
  }, [resetImageState, resetPdfState, resetTextState, resetUnredactableState, setXlsxFile]);

  // Informed-consent export: the user accepts that the listed parts stay
  // exactly as they are in the exported file.
  const continueWithUnredactable = useCallback(() => {
    setAllowUnredactable(true);
  }, []);

  const clear = useCallback(() => {
    setInputText('');
    resetTextState();
    setDocxFile(null);
    setDocxFileName(null);
    setXlsxFile(null);
    resetPdfState();
    resetImageState();
    resetUnredactableState();
  }, [resetImageState, resetPdfState, resetTextState, resetUnredactableState, setXlsxFile]);

  // T261: closing the tab now would lose the only way back to the names. The browser shows its own
  // generic question; the reminder on the page says what is at stake and offers the way out.
  // Where the places that are found but not redacted stand in the protected text.
  const keptRanges = useMemo(
    () => keptRangesInOutput(inputText, entities, excludedIndices, entries, anonymizedText),
    [inputText, entities, excludedIndices, entries, anonymizedText],
  );

  const tableAtRisk = replacementMode === 'labeled' && entries.length > 0 && resultTakenOut && !tableSaved && !reminderDismissed && !reminderOff;
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
    hasImage: imageFileName !== null,
    ocrProgress,
    ocrPages,
    handleInputChange,
    anonymize,
    cancelAnonymize,
    addManualEntity,
    removeEntity,
    renameLabel,
    droppedCount: droppedPlaces.length,
    keepDroppedRedacted,
    dismissDropped,
    tableVersion,
    resetLabel,
    renamedOriginals,
    keptRanges,
    toggleEntity,
    setEntitiesExcluded,
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
    /** The result left the page and its table was never saved: clearing now loses the way back. */
    resultTakenOut,
    tableUnsaved: replacementMode === 'labeled' && entries.length > 0 && resultTakenOut && !tableSaved,
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
