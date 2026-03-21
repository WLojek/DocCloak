import { useState, useCallback, useRef, useEffect } from 'react';
import type { DetectedEntity, EntityType, ReplacementEntry } from '../../core/types.ts';
import { detectEntities, preloadModel, onDownloadProgress, setDetectionThreshold, getDetectionThreshold, getCustomLabels, setCustomLabels } from '../../core/engine.ts';
import { AnonymizationSession } from '../../core/session.ts';
import type { ReplacementMode } from '../../core/session.ts';
import { readDocx, writeAnonymizedDocx, isLegacyDoc, isSupportedFile } from '../../core/docx.ts';
import { readDocText, writeAnonymizedDoc } from '../../core/doc.ts';

export function useAnonymizer() {
  const [inputText, setInputText] = useState('');
  const [anonymizedText, setAnonymizedText] = useState('');
  const [entities, setEntities] = useState<DetectedEntity[]>([]);
  const [entries, setEntries] = useState<ReplacementEntry[]>([]);
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set());
  const [modelLoaded, setModelLoaded] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(getDetectionThreshold());
  const [replacementMode, setReplacementModeState] = useState<ReplacementMode>('labeled');
  const [customLabels, setCustomLabelsState] = useState<string[]>(getCustomLabels());
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [docxFileName, setDocxFileName] = useState<string | null>(null);
  const sessionRef = useRef(new AnonymizationSession());
  const latestRequestRef = useRef(0);

  // Preload detection model in the background with progress tracking
  useEffect(() => {
    setModelLoading(true);

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
    const requestId = ++latestRequestRef.current;
    const excluded = new Set<number>();
    setExcludedIndices(excluded);

    // Yield to browser so React can paint the loading overlay before heavy inference blocks the thread
    requestAnimationFrame(() => {
      setTimeout(() => {
        detectEntities(text)
          .then((results) => {
            if (requestId === latestRequestRef.current) {
              setEntities(results);
              rebuildAnonymization(text, results, excluded);
              setAnonymizing(false);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          })
          .catch((err) => {
            console.error('[DocCloak] Detection failed:', err);
            if (requestId === latestRequestRef.current) {
              setAnonymizing(false);
              setDetectionError(err instanceof Error ? err.message : String(err));
            }
          });
      }, 50);
    });
  }, [inputText, rebuildAnonymization]);

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
    setAnonymizedText((prev) => prev.replaceAll(oldLabel, newLabel));
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

  const handleReplacementModeChange = useCallback((mode: ReplacementMode) => {
    setReplacementModeState(mode);
    sessionRef.current.setMode(mode);
    if (entities.length > 0) {
      rebuildAnonymization(inputText, entities, excludedIndices);
    }
  }, [entities, inputText, excludedIndices, rebuildAnonymization]);

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
          // Not a .docx in disguise — parse as real .doc binary
          const buffer = await file.arrayBuffer();
          plainText = readDocText(buffer);
        }
      } else {
        // Standard .docx
        const extraction = await readDocx(file);
        plainText = extraction.plainText;
      }

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
  }, []);

  const exportDocx = useCallback(async (): Promise<Blob> => {
    if (!docxFile || entities.length === 0) {
      throw new Error('No document or entities to export');
    }

    const activeEntities = entities.filter((_, i) => !excludedIndices.has(i));
    const replacements = activeEntities.map((entity) => ({
      start: entity.start,
      end: entity.end,
      replacement: sessionRef.current.getForward(entity.value) ?? entity.value,
    }));

    if (isLegacyDoc(docxFile.name)) {
      // Legacy .doc: try .docx first (renamed files), fall back to .doc binary export
      try {
        const extraction = await readDocx(docxFile);
        return await writeAnonymizedDocx(extraction, replacements);
      } catch {
        const buffer = await docxFile.arrayBuffer();
        return await writeAnonymizedDoc(buffer, replacements);
      }
    } else {
      // Standard .docx
      const extraction = await readDocx(docxFile);
      return await writeAnonymizedDocx(extraction, replacements);
    }
  }, [docxFile, entities, excludedIndices]);

  const removeDocxFile = useCallback(() => {
    setDocxFile(null);
    setDocxFileName(null);
    setInputText('');
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    sessionRef.current.clear();
  }, []);

  const clear = useCallback(() => {
    setInputText('');
    setAnonymizedText('');
    setEntities([]);
    setEntries([]);
    setExcludedIndices(new Set());
    setDocxFile(null);
    setDocxFileName(null);
    sessionRef.current.clear();
  }, []);

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
    detectionError,
    downloadProgress,
    threshold,
    replacementMode,
    customLabels,
    docxFileName,
    hasDocxExtraction: docxFile !== null,
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
    loadDocxFile,
    exportDocx,
    removeDocxFile,
  };
}
