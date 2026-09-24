import { useState, useCallback, useRef, useEffect } from 'react';
import type { DetectedEntity, EntityType, ReplacementEntry } from '@doccloak/core';
import {
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
  hasModelConsent,
  grantModelConsent,
  ConsentRequiredError,
  DetectionTimeoutError,
} from '../../engine.ts';
import type { RegexRegionId } from '@doccloak/core';
import type { ProviderId } from '@doccloak/core';
import { AnonymizationSession } from '@doccloak/core';
import type { ReplacementMode } from '@doccloak/core';
import {
  readDocx,
  writeAnonymizedDocxWithReport,
  isLegacyDoc,
  isSupportedFile,
  isUnsupportedDocumentError,
} from '@doccloak/core/dom';
import type { DocxExtraction, DocxWriteOptions, UnsupportedDocumentCode } from '@doccloak/core/dom';
import { readDocText, writeAnonymizedDoc, inspectDoc } from '@doccloak/core';
import { isImageFile, renderRedactedImage } from '@doccloak/core/dom';
import { loadImageToCanvas, recognizeCanvas } from '../../ocr.web.ts';
import type { OcrWord } from '@doccloak/core/dom';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import type { Translations } from '../../i18n/types.ts';
import { useToast } from '../components/Toast.tsx';
import type { UnredactableItem } from '../components/UnredactableNotice.tsx';
import { loadDictionary, saveDictionary, mergeDictionaryEntities, loadIgnoreList, saveIgnoreList, filterIgnoredEntities } from '../dictionary.ts';
import type { DictionaryEntry } from '../dictionary.ts';

/**
 * Unpacked-size limit Core enforces on Office packages (T177, zip-bomb
 * guard). Quoted in the 'too-large' message; keep in sync with Core.
 */
export const UNPACKED_SIZE_LIMIT_LABEL = '200 MB';

/** Stable file-refusal codes the UI can translate (Core codes + our own). */
export type FileErrorCode = UnsupportedDocumentCode | 'empty-document';

/** Translated message with a one-line remedy for a refusal code. */
export function fileErrorMessage(t: Translations, code: FileErrorCode): string {
  if (code === 'too-large') return t.fileErrors['too-large'](UNPACKED_SIZE_LIMIT_LABEL);
  return t.fileErrors[code];
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
  const [anonymizing, setAnonymizing] = useState(false);
  const [detectionProgress, setDetectionProgress] = useState<number | null>(null);
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
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  // Informed-consent export (T177): parts the writer cannot redact, reader
  // warnings, and whether the user chose Continue for this file.
  const [unredactableItems, setUnredactableItems] = useState<UnredactableItem[]>([]);
  const [fileWarnings, setFileWarnings] = useState<string[]>([]);
  const [allowUnredactable, setAllowUnredactable] = useState(false);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ocrWordsRef = useRef<OcrWord[]>([]);
  const sessionRef = useRef(new AnonymizationSession());
  const latestRequestRef = useRef(0);

  const unredactablePending = unredactableItems.length > 0 && !allowUnredactable;

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
        console.error('Model loading failed:', err);
        setModelError(true);
      });
  }, []);

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
      const result = sessionRef.current.anonymizeText(text, activeEntities);
      setAnonymizedText(result);
      setEntries(sessionRef.current.getEntries());
    },
    []
  );

  const anonymize = useCallback(() => {
    const text = inputText;
    if (!text.trim()) return;
    // The user has not yet decided what to do with parts we cannot redact.
    if (unredactablePending) return;

    setAnonymizing(true);
    setDetectionError(null);
    setDetectionErrorKind(null);
    setDetectionProgress(0);
    const requestId = ++latestRequestRef.current;
    const excluded = new Set<number>();
    setExcludedIndices(excluded);

    // Detection runs in a Web Worker - no need to yield to the browser
    detectEntities(text, (progress) => {
      if (requestId === latestRequestRef.current) {
        setDetectionProgress(progress);
      }
    })
      .then((results) => {
        if (requestId === latestRequestRef.current) {
          // Dictionary words are always redacted; detected entities win overlaps.
          // The ignore list is applied last so a listed term is never
          // anonymized, whichever tier found it.
          const withDictionary = filterIgnoredEntities(
            text,
            mergeDictionaryEntities(text, results, dictionary),
            ignoreList,
          );
          setEntities(withDictionary);
          rebuildAnonymization(text, withDictionary, excluded);
          setAnonymizing(false);
          setDetectionProgress(null);
          // Scroll the tool back into view in case the page has drifted.
          // We target <main> which wraps the tool; falls back to no-op if not found.
          const toolEl = document.querySelector('main');
          if (toolEl) {
            toolEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      })
      .catch((err: unknown) => {
        console.error('[DocCloak] Detection failed:', err);
        if (requestId !== latestRequestRef.current) return;
        setAnonymizing(false);
        setDetectionProgress(null);
        if (err instanceof ConsentRequiredError) {
          // Consent flag gone (storage cleared): back to the card, no error.
          setModelLoaded(false);
          setModelConsented(false);
          setPendingProvider(err.providerId);
          return;
        }
        if (err instanceof DetectionTimeoutError) {
          // Watchdog: the worker reported no progress for 20 s and was
          // restarted. The remedy is to split the document.
          setDetectionErrorKind('timeout');
          setDetectionError(t.detect.timeout);
          showToast(t.detect.timeout);
          return;
        }
        setDetectionErrorKind('failed');
        setDetectionError(err instanceof Error ? err.message : String(err));
      });
  }, [inputText, dictionary, ignoreList, rebuildAnonymization, unredactablePending, showToast, t]);

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
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
  }, []);

  const addManualEntity = useCallback(
    (start: number, end: number, type: EntityType) => {
      const value = inputText.slice(start, end);
      const newEntity: DetectedEntity = {
        type,
        value,
        start,
        end,
        confidence: 1.0,
        detector: 'manual',
      };
      setEntities((prev) => {
        const next = [...prev, newEntity].sort((a, b) => a.start - b.start);
        setExcludedIndices((excl) => {
          rebuildAnonymization(inputText, next, excl);
          return excl;
        });
        return next;
      });
    },
    [inputText, rebuildAnonymization]
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
        rebuildAnonymization(inputText, entities, next);
        return next;
      });
    },
    [inputText, entities, rebuildAnonymization]
  );

  const deanonymize = useCallback((aiResponse: string): string => {
    return sessionRef.current.deanonymize(aiResponse);
  }, []);

  const renameLabel = useCallback((original: string, newLabel: string) => {
    // Renaming a group's base label also re-derives its variant tokens
    // (core T171: [PERSON_1] -> [CLIENT] takes [PERSON_1_LAST] along), so
    // apply every pair the session reports, longest old label first so a
    // base token never splices into its own variant tokens.
    const pairs = sessionRef.current.renameLabel(original, newLabel)
      .sort((a, b) => b[0].length - a[0].length);
    if (pairs.length === 0) return;
    setAnonymizedText((prev) => pairs.reduce((text, [from, to]) => text.replaceAll(from, () => to), prev));
    setEntries(sessionRef.current.getEntries());
  }, []);

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
      setDocxFile(file);
      setDocxFileName(file.name);
      setInputText(plainText);
      setAnonymizedText('');
      setEntities([]);
      setEntries([]);
      setExcludedIndices(new Set());
      setUnredactableItems(items);
      setFileWarnings(warnings);
      setAllowUnredactable(false);
      sessionRef.current.clear();
      return { success: true };
    } catch (err) {
      console.error('[DocCloak] Failed to read file:', err);
      if (isUnsupportedDocumentError(err)) {
        return { success: false, error: err.message, code: err.code, message: fileErrorMessage(t, err.code) };
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [resetImageState, t]);

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
      resetUnredactableState();
      setInputText(text);
      setAnonymizedText('');
      setEntities([]);
      setEntries([]);
      setExcludedIndices(new Set());
      sessionRef.current.clear();
      return { success: true };
    } catch (err) {
      console.error('[DocCloak] OCR failed:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      setOcrProgress(null);
    }
  }, [language, resetUnredactableState]);

  // Route uploads by type: images go through OCR, documents through the docx reader
  const loadFile = useCallback(async (file: File): Promise<LoadFileResult> => {
    if (isImageFile(file.name)) return loadImageFile(file);
    return loadDocxFile(file);
  }, [loadImageFile, loadDocxFile]);

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

    const activeEntities = entities.filter((_, i) => !excludedIndices.has(i));
    const replacements = activeEntities.map((entity) => {
      const replacement = sessionRef.current.getForward(entity.value);
      if (replacement === undefined) {
        // Fail closed: never write an original value into a redacted export
        throw new Error('Missing replacement mapping for a detected entity');
      }
      return { start: entity.start, end: entity.end, replacement };
    });
    // Value-level pairs let the writer scrub places offsets cannot reach
    // (hyperlink targets, field instructions)
    const valueReplacements = activeEntities.map((entity) => ({
      value: entity.value,
      replacement: sessionRef.current.getForward(entity.value) ?? '',
    }));

    // The writer stays fail-closed by default; allowUnredactable is true only
    // after the user chose Continue on the notice.
    const writeOptions: DocxWriteOptions = { allowUnredactable };

    const writeDocx = async (extraction: DocxExtraction): Promise<Blob> => {
      try {
        const result = await writeAnonymizedDocxWithReport(extraction, replacements, valueReplacements, writeOptions);
        if (result.warnings.length > 0) {
          setFileWarnings((prev) => Array.from(new Set([...prev, ...result.warnings])));
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
  }, [docxFile, entities, excludedIndices, allowUnredactable, unredactablePending]);

  const removeFile = useCallback(() => {
    setDocxFile(null);
    setDocxFileName(null);
    resetImageState();
    resetUnredactableState();
    setInputText('');
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    sessionRef.current.clear();
  }, [resetImageState, resetUnredactableState]);

  // Informed-consent export: the user accepts that the listed parts stay
  // exactly as they are in the exported file.
  const continueWithUnredactable = useCallback(() => {
    setAllowUnredactable(true);
  }, []);

  const clear = useCallback(() => {
    setInputText('');
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    setDocxFile(null);
    setDocxFileName(null);
    resetImageState();
    resetUnredactableState();
    sessionRef.current.clear();
  }, [resetImageState, resetUnredactableState]);

  return {
    inputText,
    anonymizedText,
    entities,
    entries,
    excludedIndices,
    modelLoaded,
    modelLoading,
    modelError,
    anonymizing,
    detectionProgress,
    detectionError,
    detectionErrorKind,
    downloadProgress,
    threshold,
    replacementMode,
    customLabels,
    docxFileName,
    imageFileName,
    fileName: docxFileName ?? imageFileName,
    hasDocxExtraction: docxFile !== null,
    hasImage: imageFileName !== null,
    ocrProgress,
    handleInputChange,
    anonymize,
    addManualEntity,
    removeEntity,
    renameLabel,
    toggleEntity,
    deanonymize,
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
