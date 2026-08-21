import { useState, useCallback, useRef, useEffect } from 'react';
import type { DetectedEntity, EntityType, ReplacementEntry } from '@doccloak/core';
import { detectEntities, preloadModel, onDownloadProgress, setDetectionThreshold, getDetectionThreshold, getCustomLabels, setCustomLabels, switchProvider as engineSwitchProvider, getActiveProviderId, isRegexEnabled, setRegexEnabled, getRegexRegion, setRegexRegionSetting } from '../../engine.ts';
import type { RegexRegionId } from '@doccloak/core';
import type { ProviderId } from '@doccloak/core';
import { AnonymizationSession } from '@doccloak/core';
import type { ReplacementMode } from '@doccloak/core';
import { readDocx, writeAnonymizedDocx, isLegacyDoc, isSupportedFile } from '@doccloak/core/dom';
import { readDocText, writeAnonymizedDoc } from '@doccloak/core';
import { isImageFile, renderRedactedImage } from '@doccloak/core/dom';
import { loadImageToCanvas, recognizeCanvas } from '../../ocr.web.ts';
import type { OcrWord } from '@doccloak/core/dom';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { loadDictionary, saveDictionary, mergeDictionaryEntities } from '../dictionary.ts';
import type { DictionaryEntry } from '../dictionary.ts';

export function useAnonymizer() {
  const { language } = useTranslation();
  const [inputText, setInputText] = useState('');
  const [anonymizedText, setAnonymizedText] = useState('');
  const [entities, setEntities] = useState<DetectedEntity[]>([]);
  const [entries, setEntries] = useState<ReplacementEntry[]>([]);
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  // First-visit gate: the ~46 MB model download starts only after the user accepts.
  // Once accepted, later visits load (from cache) without asking again.
  const [modelConsented, setModelConsented] = useState(
    () => localStorage.getItem('doccloak-model-consented') === '1',
  );
  const [modelError, setModelError] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [detectionProgress, setDetectionProgress] = useState<number | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(getDetectionThreshold());
  const [replacementMode, setReplacementModeState] = useState<ReplacementMode>('labeled');
  const [customLabels, setCustomLabelsState] = useState<string[]>(getCustomLabels());
  const [activeProvider, setActiveProvider] = useState<ProviderId>(getActiveProviderId());
  const [regexRules, setRegexRulesState] = useState(isRegexEnabled());
  const [regexRegion, setRegexRegionState] = useState<RegexRegionId>(getRegexRegion());
  const [dictionary, setDictionaryState] = useState<DictionaryEntry[]>(loadDictionary);
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [docxFileName, setDocxFileName] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ocrWordsRef = useRef<OcrWord[]>([]);
  const sessionRef = useRef(new AnonymizationSession());
  const latestRequestRef = useRef(0);

  // Load (or retry loading) the detection model with progress tracking
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
      .catch((err) => {
        console.error('Model loading failed:', err);
        setModelLoading(false);
        setModelError(true);
        setDownloadProgress(null);
      });
  }, []);

  // Preload detection model in the background on mount, but only after the
  // user has accepted the first-time download.
  useEffect(() => {
    if (modelConsented) startModelLoad();
  }, [modelConsented, startModelLoad]);

  // First-visit accept: persist the choice and start the download immediately.
  const acceptModelDownload = useCallback(() => {
    localStorage.setItem('doccloak-model-consented', '1');
    setModelConsented(true);
  }, []);

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

    setAnonymizing(true);
    setDetectionError(null);
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
          // Dictionary words are always redacted; detected entities win overlaps
          const withDictionary = mergeDictionaryEntities(text, results, dictionary);
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
      .catch((err) => {
        console.error('[DocCloak] Detection failed:', err);
        if (requestId === latestRequestRef.current) {
          setAnonymizing(false);
          setDetectionProgress(null);
          setDetectionError(err instanceof Error ? err.message : String(err));
        }
      });
  }, [inputText, dictionary, rebuildAnonymization]);

  const handleDictionaryChange = useCallback((entries: DictionaryEntry[]) => {
    saveDictionary(entries);
    setDictionaryState(entries);
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
    const oldLabel = sessionRef.current.getForward(original);
    if (!oldLabel) return;
    sessionRef.current.renameLabel(original, newLabel);
    setAnonymizedText((prev) => prev.replaceAll(oldLabel, () => newLabel));
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

  const handleSwitchProvider = useCallback(async (id: ProviderId) => {
    if (id === activeProvider) return;
    setModelLoading(true);
    setModelLoaded(false);
    setModelError(false);
    setDownloadProgress(null);
    try {
      await engineSwitchProvider(id, (downloaded, total) => {
        setDownloadProgress({ downloaded, total });
      });
      setActiveProvider(id);
      setModelLoaded(true);
      setModelLoading(false);
      setDownloadProgress(null);
      setCustomLabelsState(getCustomLabels());
      setThreshold(getDetectionThreshold());
    } catch (err) {
      console.error('Model switch failed:', err);
      setModelLoading(false);
      setModelError(true);
      setDownloadProgress(null);
    }
  }, [activeProvider]);

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

  const loadDocxFile = useCallback(async (file: File): Promise<{ success: boolean; error?: string }> => {
    if (!isSupportedFile(file.name)) {
      return { success: false, error: 'unsupported' };
    }
    try {
      let plainText: string;

      if (isLegacyDoc(file.name)) {
        // Legacy .doc: try as .docx first (some .doc files are renamed .docx)
        try {
          const extraction = await readDocx(file);
          plainText = extraction.plainText;
        } catch {
          // Not a .docx in disguise - parse as real .doc binary
          const buffer = await file.arrayBuffer();
          plainText = readDocText(buffer);
        }
      } else {
        // Standard .docx
        const extraction = await readDocx(file);
        plainText = extraction.plainText;
      }

      resetImageState();
      setDocxFile(file);
      setDocxFileName(file.name);
      setInputText(plainText);
      setAnonymizedText('');
      setEntities([]);
      setEntries([]);
      setExcludedIndices(new Set());
      sessionRef.current.clear();
      return { success: true };
    } catch (err) {
      console.error('[DocCloak] Failed to read file:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [resetImageState]);

  const loadImageFile = useCallback(async (file: File): Promise<{ success: boolean; error?: string }> => {
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
  }, [language]);

  // Route uploads by type: images go through OCR, documents through the docx reader
  const loadFile = useCallback(async (file: File): Promise<{ success: boolean; error?: string }> => {
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
    if (!docxFile || entities.length === 0) {
      throw new Error('No document or entities to export');
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

    if (isLegacyDoc(docxFile.name)) {
      // Legacy .doc: try .docx first (renamed files), fall back to .doc binary export
      try {
        const extraction = await readDocx(docxFile);
        return await writeAnonymizedDocx(extraction, replacements, valueReplacements);
      } catch {
        const buffer = await docxFile.arrayBuffer();
        return await writeAnonymizedDoc(buffer, replacements);
      }
    } else {
      // Standard .docx
      const extraction = await readDocx(docxFile);
      return await writeAnonymizedDocx(extraction, replacements, valueReplacements);
    }
  }, [docxFile, entities, excludedIndices]);

  const removeFile = useCallback(() => {
    setDocxFile(null);
    setDocxFileName(null);
    resetImageState();
    setInputText('');
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    sessionRef.current.clear();
  }, [resetImageState]);

  const clear = useCallback(() => {
    setInputText('');
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    setDocxFile(null);
    setDocxFileName(null);
    resetImageState();
    sessionRef.current.clear();
  }, [resetImageState]);

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
    handleSwitchProvider,
    regexRules,
    handleRegexChange,
    regexRegion,
    handleRegexRegionChange,
    dictionary,
    handleDictionaryChange,
    loadFile,
    exportDocx,
    exportRedactedImage,
    removeFile,
    retryModelLoad: startModelLoad,
    modelConsented,
    acceptModelDownload,
  };
}
