import { TextInput } from './ui/components/TextInput.tsx';
import { TextOutput } from './ui/components/TextOutput.tsx';
import { EntityTable } from './ui/components/EntityTable.tsx';
import { DeAnonymize } from './ui/components/DeAnonymize.tsx';
import { useAnonymizer } from './ui/hooks/useAnonymizer.ts';
import { useTranslation } from './i18n/LanguageContext.tsx';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { LanguageSwitcher } from './ui/components/LanguageSwitcher.tsx';
import { DictionaryBar } from './ui/components/DictionaryBar.tsx';
import { Lock, Settings, ArrowRight, Plus, X, ChevronDown, Check, Info, FileText, Image as ImageIcon, Download, Github, RotateCw } from 'lucide-react';
import { isImageFile } from '@doccloak/core/dom';
import { UnredactableNotice } from './ui/components/UnredactableNotice.tsx';
import { TableReminder } from './ui/components/TableReminder.tsx';
import { SpreadsheetNotice } from './ui/components/SpreadsheetNotice.tsx';
import { ALL_ENTITY_TYPES } from './ui/keepTypes.ts';
import { ENTITY_COLORS } from '@doccloak/core';
import { fileErrorCode, fileErrorMessage, pdfDownloadName, xlsxDownloadName } from './ui/hooks/useAnonymizer.ts';
import logoSrc from './ui/assets/doc-cloak-logo-light.png';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from './ui/components/Toast.tsx';
import { Hero, TrustBand, Audience, HowItWorks, FAQ } from './ui/components/Landing.tsx';
import { REGEX_REGIONS } from '@doccloak/core';
import { PROVIDERS, getRecommendedProviderId, hasWebGpu } from './engine.ts';
import { formatEta } from './lib/detection-eta.ts';
import { clearOfflineData, warmRuntimeCache } from './sw-register.ts';
import { OfflineDataReset } from './ui/components/OfflineDataReset.tsx';
import { OcrWorkersSetting } from './ui/components/OcrWorkersSetting.tsx';
import type { ProviderId, RegexRegionId } from '@doccloak/core';
import { useModelStorage } from './ui/hooks/useModelStorage.ts';
import { modelFeedbackUrl } from './feedback.ts';

/** Filled into the GitHub feedback form (T250). */
const APP_VERSION_LINE = `DocCloak ${__APP_VERSION__}, core ${__CORE_VERSION__}`;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export default function App() {
  const { t } = useTranslation();
  const {
    inputText,
    anonymizedText,
    entities,
    entries,
    excludedIndices,
    modelLoaded,
    modelLoading,
    anonymizing,
    detectionProgress,
    detectionEta,
    detectionError,
    detectionErrorKind,
    modelError,
    modelNeedsWebGpu,
    downloadProgress,
    handleInputChange,
    anonymize,
    cancelAnonymize,
    addManualEntity,
    removeEntity,
    renameLabel,
    resetLabel,
    renamedOriginals,
    keptRanges,
    toggleEntity,
    setEntitiesExcluded,
    restoreText,
    restoreDocx,
    exportMapping,
    importMapping,
    importedMapping,
    clearImportedMapping,
    clear,
    threshold,
    replacementMode,
    customLabels,
    handleThresholdChange,
    handleReplacementModeChange,
    handleCustomLabelsChange,
    activeProvider,
    selectedProvider,
    handleSwitchProvider,
    regexRules,
    handleRegexChange,
    regexRegion,
    handleRegexRegionChange,
    dictionary,
    handleDictionaryChange,
    ignoreList,
    handleIgnoreListChange,
    docxFileName,
    fileName,
    hasDocxExtraction,
    hasXlsxExtraction,
    hasPdfExtraction,
    hasDocumentExtraction,
    pdfRemoved,
    hasImage,
    ocrProgress,
    ocrPages,
    loadFile,
    exportDocx,
    exportXlsx,
    exportPdf,
    exportRedactedImage,
    keepTypes,
    handleKeepTypesChange,
    markResultTakenOut,
    dismissTableReminder,
    tableReminder,
    tableReminderEnabled,
    setTableReminderEnabled,
    tableUnsaved,
    tableVersion,
    resultTakenOut,
    droppedCount,
    keepDroppedRedacted,
    dismissDropped,
    xlsxInfo,
    removeFile,
    retryModelLoad,
    modelConsented,
    acceptModelDownload,
    unredactableItems,
    fileWarnings,
    allowUnredactable,
    unredactablePending,
    continueWithUnredactable,
  } = useAnonymizer();

  const { showToast } = useToast();

  // Places found that are not redacted: they leave the page readable with every copy and download.
  const keptPlaces = [...excludedIndices].filter((index) => index < entities.length);
  const keptCount = keptPlaces.length;
  // One reason for all of them (a type set to never be redacted) is said with the count.
  const keptTypes = [...new Set(keptPlaces.map((index) => entities[index].type))];
  const keptReason = keptCount > 0 && keptTypes.every((type) => keepTypes.includes(type))
    ? t.textOutput.keptBySetting(keptTypes.map((type) => t.entityLabels[type]).join(', '))
    : undefined;
  const uncheckedCells = xlsxInfo?.otherNumberCells ?? 0;
  const keptCountRef = useRef(keptCount);
  keptCountRef.current = keptCount;
  const downloadedMessage = useCallback(
    () => (keptCountRef.current > 0 ? t.textOutput.downloadedKept(keptCountRef.current) : t.textOutput.downloaded),
    [t],
  );

  // The line at the result ("Review the list" / "Show what stays readable") opens the list below.
  const [listReveal, setListReveal] = useState<{ kept: boolean; nonce: number }>();
  const revealList = useCallback((kept: boolean) => {
    setListReveal((previous) => ({ kept, nonce: (previous?.nonce ?? 0) + 1 }));
  }, []);

  // T222: Escape cancels the running detection (the overlay is modal).
  // Offline start (T238): once the model has loaded, the service worker must hold the ONNX Runtime files.
  useEffect(() => {
    if (modelLoaded) warmRuntimeCache(__ORT_RUNTIME_FILES__);
  }, [modelLoaded]);

  useEffect(() => {
    if (!anonymizing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelAnonymize();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anonymizing, cancelAnonymize]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelInfoOpen, setModelInfoOpen] = useState<string | null>(null);
  // T250: which models are on this device; read again when the settings open and when a model has loaded.
  const { saved: savedModels, removing: removingModel, remove: removeModel } = useModelStorage(`${settingsOpen}:${modelLoaded}:${selectedProvider}`);
  const handleRemoveModel = useCallback(async (id: ProviderId, label: string, sizeMB: number) => {
    const removed = await removeModel(id);
    showToast(removed ? t.settings.modelRemoved(label, t.settings.modelSize(sizeMB)) : t.settings.modelRemoveFailed);
  }, [removeModel, showToast, t]);
  const [newLabelInput, setNewLabelInput] = useState('');
  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const [footerTooltipOpen, setFooterTooltipOpen] = useState(false);
  const clearSnapshotRef = useRef<{ text: string; anonymized: string; entities: typeof entities; entries: typeof entries } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const toolRef = useRef<HTMLElement>(null);
  const scrollToTool = useCallback(() => {
    toolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  // Consent card: a model picked before consent is a preselection, and the
  // card (which names it) is where the download actually starts.
  const consentRef = useRef<HTMLDivElement>(null);
  const scrollToConsent = useCallback(() => {
    (consentRef.current ?? toolRef.current)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);
  const [scrolled, setScrolled] = useState(false);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { rootMargin: '0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const triggerBlobDownload = useCallback((blob: Blob, downloadName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadDocx = useCallback(async () => {
    if (!exportDocx) return;
    setDownloading(true);
    try {
      const blob = await exportDocx();
      const ext = docxFileName?.match(/\.(docx?)$/i)?.[1] ?? 'docx';
      const baseName = docxFileName?.replace(/\.(docx?)$/i, '') ?? 'document';
      triggerBlobDownload(blob, `${baseName}_redacted.${ext}`);
      markResultTakenOut();
      showToast(downloadedMessage());
    } catch (err) {
      console.error('[DocCloak] Export failed:', err);
      const code = fileErrorCode(err);
      showToast(code ? fileErrorMessage(t, code) : (t.textOutput.exportFailed ?? 'Export failed.'));
    } finally {
      setDownloading(false);
    }
  }, [exportDocx, docxFileName, triggerBlobDownload, markResultTakenOut, showToast, t, downloadedMessage]);

  // Spreadsheet (T265): same flow as docx.
  const handleDownloadXlsx = useCallback(async () => {
    setDownloading(true);
    try {
      const blob = await exportXlsx();
      triggerBlobDownload(blob, xlsxDownloadName(fileName));
      markResultTakenOut();
      // A workbook can carry number cells nobody checked: said with the download when nothing else is.
      // Both, when both are true: places left readable, and number cells nobody checked.
      showToast(uncheckedCells === 0
        ? downloadedMessage()
        : keptCountRef.current === 0
          ? t.xlsx.downloadedUnchecked(uncheckedCells)
          : `${downloadedMessage()} ${t.xlsx.notChecked(uncheckedCells)}`);
    } catch (err) {
      console.error('[DocCloak] Workbook export failed:', err);
      const code = fileErrorCode(err);
      showToast(code ? fileErrorMessage(t, code) : (t.textOutput.exportFailed ?? 'Export failed.'));
    } finally {
      setDownloading(false);
    }
  }, [exportXlsx, fileName, triggerBlobDownload, markResultTakenOut, showToast, t, downloadedMessage, uncheckedCells]);

  // T261: the replacement table as a file, from where the protected file is taken (and from the reminder).
  const [tableJustSaved, setTableJustSaved] = useState(false);
  const handleSaveTable = useCallback(() => {
    const table = exportMapping();
    if (!table) return;
    triggerBlobDownload(table.blob, table.downloadName);
    setTableJustSaved(true);
    // Said every time: pasted text has no file bar whose button could change, and the reminder just goes away.
    showToast(t.textOutput.tableSaved);
  }, [exportMapping, triggerBlobDownload, showToast, t]);
  // A changed table is not the saved one any more.
  useEffect(() => setTableJustSaved(false), [entries]);

  // PDF (T216): same flow as docx; a verify-failed or stale-extraction error
  // from the writer maps to its own translated message and nothing is saved.
  const handleDownloadPdf = useCallback(async () => {
    if (!exportPdf) return;
    setDownloading(true);
    try {
      const blob = await exportPdf();
      triggerBlobDownload(blob, pdfDownloadName(fileName));
      markResultTakenOut();
      showToast(downloadedMessage());
    } catch (err) {
      console.error('[DocCloak] PDF export failed:', err);
      const code = fileErrorCode(err);
      showToast(code ? fileErrorMessage(t, code) : (t.textOutput.exportFailed ?? 'Export failed.'));
    } finally {
      setDownloading(false);
    }
  }, [exportPdf, fileName, triggerBlobDownload, markResultTakenOut, showToast, t, downloadedMessage]);

  const handleDownloadImage = useCallback(async () => {
    if (!exportRedactedImage) return;
    setDownloading(true);
    try {
      const blob = await exportRedactedImage();
      const baseName = fileName?.replace(/\.[^.]+$/, '') ?? 'image';
      triggerBlobDownload(blob, `${baseName}_redacted.png`);
      markResultTakenOut();
      showToast(downloadedMessage());
    } catch (err) {
      console.error('[DocCloak] Image export failed:', err);
      showToast(t.textOutput.exportFailed ?? 'Export failed.');
    } finally {
      setDownloading(false);
    }
  }, [exportRedactedImage, fileName, triggerBlobDownload, markResultTakenOut, showToast, t, downloadedMessage]);

  // Keyboard shortcut: Cmd+Enter / Ctrl+Enter to redact
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (inputText.trim() && modelLoaded && !anonymizing && !unredactablePending) {
          anonymize();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [inputText, modelLoaded, anonymizing, anonymize, unredactablePending]);

  // Clear with undo
  // "Clear" and removing the file throw the table away. When the result is already out and the
  // table was never saved, that is the only way back to the original data: ask first.
  const mayLoseTable = useCallback(() => !tableUnsaved || window.confirm(t.tableReminder.clearConfirm), [tableUnsaved, t]);
  const handleRemoveFile = useCallback(() => {
    if (mayLoseTable()) removeFile();
  }, [mayLoseTable, removeFile]);

  const handleClear = useCallback(() => {
    if (!inputText) return;
    if (!mayLoseTable()) return;
    clearSnapshotRef.current = { text: inputText, anonymized: anonymizedText, entities, entries };
    clear();
    showToast(t.toast.cleared, {
      label: t.toast.undo,
      onClick: () => {
        const snap = clearSnapshotRef.current;
        if (snap) {
          handleInputChange(snap.text);
          clearSnapshotRef.current = null;
        }
      },
    });
  }, [inputText, anonymizedText, entities, entries, clear, handleInputChange, showToast, t, mayLoseTable]);

  const handleAddLabel = () => {
    const label = newLabelInput.trim().toLowerCase();
    if (!label || customLabels.includes(label)) return;
    handleCustomLabelsChange([...customLabels, label]);
    setNewLabelInput('');
  };

  const handleRemoveLabel = (label: string) => {
    handleCustomLabelsChange(customLabels.filter((l) => l !== label));
  };

  const progressPercent = downloadProgress
    ? (downloadProgress.total > 0 ? Math.min(100, Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)) : 0)
    : 0;

  // A big download only deserves a warning where the big model is NOT the
  // intended default (mobile/low-memory devices). Device class never changes
  // mid-session, so compute once.
  const [constrainedDevice] = useState(() => getRecommendedProviderId() === 'gliner');

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <a
        href="#tool"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-[#111111] focus:text-[#F9F9F7] focus:px-4 focus:py-2 focus:text-sm"
      >
        {t.header.skipToTool}
      </a>
      {/* Engine state announcements for assistive tech */}
      <div className="sr-only" role="status" aria-live="polite">
        {modelLoading ? t.loading.preparingEngine : anonymizing ? t.anonymizing.title : modelLoaded ? t.header.ready : ''}
      </div>
      {/* Header-shrink sentinel: observed instead of a scroll listener */}
      <div ref={scrollSentinelRef} className="absolute top-[50px] left-0 h-px w-px" aria-hidden="true" />
      {/* OCR overlay */}
      {ocrProgress !== null && (
        <div role="dialog" aria-modal="true" aria-label={t.ocr.processingTitle} className="fixed inset-0 z-40 bg-[#F9F9F7]/80 flex items-center justify-center">
          <Card className="border-[#111111] shadow-[4px_4px_0px_0px_#111111]">
            <CardContent className="pt-8 pb-8 px-10 text-center">
              <div className="w-12 h-12 border border-[#111111] flex items-center justify-center mx-auto mb-5">
                <ImageIcon className="w-6 h-6 text-[#111111]" />
              </div>
              <p className="font-serif text-lg font-medium tracking-tight mb-1">{t.ocr.processingTitle}</p>
              <div className="w-48 mx-auto mt-3 mb-2">
                <Progress value={Math.round(ocrProgress * 100)} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground mt-1">{ocrPages && ocrPages.total > 0 ? `${t.ocr.pdfPages(ocrPages.done, ocrPages.total)} · ` : ''}{Math.round(ocrProgress * 100)}%</p>
              </div>
              <p className="text-sm text-[#525252]">{t.ocr.processingDescription}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Anonymizing overlay */}
      {anonymizing && (
        <div role="dialog" aria-modal="true" aria-label={t.anonymizing.title} className="fixed inset-0 z-40 bg-[#F9F9F7]/80 flex items-center justify-center">
          <Card className="border-[#111111] shadow-[4px_4px_0px_0px_#111111]">
            <CardContent className="pt-8 pb-8 px-10 text-center">
              <div className="flex justify-center gap-[6px] mb-6">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-8 bg-[#111111]/30"
                    style={{
                      animation: 'redact-bar 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite',
                      animationDelay: `${i * 0.15}s`,
                    }}
                  />
                ))}
              </div>
              <p className="font-serif text-lg font-medium tracking-tight mb-1">{t.anonymizing.title}</p>
              {detectionProgress !== null && (
                <div className="w-56 mx-auto mt-3 mb-2">
                  <Progress value={Math.round(detectionProgress * 100)} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground mt-1" aria-live="polite">
                    {Math.round(detectionProgress * 100)}%
                    {detectionEta !== null && (
                      <span data-testid="detection-eta"> · {t.anonymizing.remaining(formatEta(detectionEta, t.anonymizing))}</span>
                    )}
                  </p>
                </div>
              )}
              <p className="text-sm text-[#525252]">{t.anonymizing.description}</p>
              <Button variant="outline" size="sm" className="mt-5" onClick={cancelAnonymize} autoFocus>
                {t.anonymizing.cancel}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <header className={`sticky top-0 z-30 px-6 transition-all duration-200 chrome-material ${scrolled ? 'py-2 border-b border-[#E5E5E0] shadow-[0_1px_0_0_rgba(17,17,17,0.04)]' : 'py-3 border-b border-transparent'}`}>
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src={logoSrc} alt="DocCloak" className={`transition-all duration-200 ${scrolled ? 'h-7' : 'h-9'}`} />
            <span className={`font-serif tracking-tight leading-none text-[#111111] font-medium transition-all duration-200 ${scrolled ? 'text-xl' : 'text-2xl'}`}>
              DocCloak
            </span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Language switcher */}
            <LanguageSwitcher ariaLabel={t.header.language} />

            {/* Settings */}
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t.header.settings}>
                  <Settings className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 max-h-[calc(100vh-5rem)] overflow-auto">
                <div className="space-y-3">
                  {/* Model selector */}
                  <div>
                    <span className="label-meta text-muted-foreground">{t.settings.detectionModel}</span>
                    <div className="mt-2 space-y-2">
                      {PROVIDERS.map((p) => {
                        const modelT = t.settings.models[p.id as keyof typeof t.settings.models];
                        const noGpu = p.requiresWebGpu === true && !hasWebGpu();
                        const label = modelT?.label ?? p.label;
                        // T249: the full description opens under the card without selecting the model, also when it cannot run here.
                        const infoOpen = modelInfoOpen === p.id;
                        const infoId = `model-info-${p.id}`;
                        return (
                          <div
                            key={p.id}
                            className={`border transition-colors ${
                              selectedProvider === p.id ? 'border-[#111111] bg-[#111111]/5' : 'border-[#E5E5E0] hover:border-[#111111]'
                            }`}
                          >
                            <button
                              onClick={() => {
                                setSettingsOpen(false);
                                void handleSwitchProvider(p.id);
                                // Before consent this is a preselection: take the user to the card that starts the download.
                                if (!modelConsented) scrollToConsent();
                              }}
                              disabled={modelLoading || noGpu}
                              aria-pressed={selectedProvider === p.id}
                              className={`w-full text-left px-3 pt-2 pb-1 cursor-pointer ${
                                selectedProvider === p.id ? 'text-[#111111]' : 'text-[#525252]'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-medium">{label}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">{t.settings.modelSize(p.sizeMB)}</span>
                              </span>
                              <span className="block text-[10px] text-muted-foreground mt-0.5">{modelT?.description ?? p.description}</span>
                              {noGpu && <span className="block text-[10px] text-[#CC0000] mt-0.5">{t.settings.modelNeedsWebGpu}</span>}
                            </button>
                            <div className="flex items-center justify-between gap-2 px-3 pb-2 text-[10px]">
                              {modelT && (
                                <button
                                  type="button"
                                  onClick={() => setModelInfoOpen(infoOpen ? null : p.id)}
                                  aria-expanded={infoOpen}
                                  aria-controls={infoId}
                                  aria-label={`${infoOpen ? t.settings.modelLess : t.settings.modelMore}: ${label}`}
                                  className="flex items-center gap-0.5 text-[#111111] underline underline-offset-2 cursor-pointer"
                                >
                                  {infoOpen ? t.settings.modelLess : t.settings.modelMore}
                                  <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${infoOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                                </button>
                              )}
                              {savedModels && (
                                <span className="flex items-center gap-2 text-muted-foreground">
                                  <span className="flex items-center gap-0.5">
                                    {savedModels.has(p.id)
                                      ? <Check className="w-3 h-3" aria-hidden="true" />
                                      : <Download className="w-3 h-3" aria-hidden="true" />}
                                    {savedModels.has(p.id) ? t.settings.modelSaved : t.settings.modelNotSaved}
                                  </span>
                                  {/* The selected model stays: removing it would start its download again on the next visit. */}
                                  {savedModels.has(p.id) && selectedProvider !== p.id && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRemoveModel(p.id, label, p.sizeMB)}
                                      disabled={modelLoading || removingModel !== null}
                                      aria-label={t.settings.modelRemoveLabel(label)}
                                      className="text-[#111111] underline underline-offset-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      {t.settings.modelRemove}
                                    </button>
                                  )}
                                </span>
                              )}
                            </div>
                            {modelT && (
                              <>
                                {infoOpen && (
                                  <div id={infoId} className="px-3 pb-2.5 space-y-2 text-[10px] leading-snug text-[#525252]">
                                    <div>
                                      <p className="font-medium text-[#111111]">{t.settings.modelStrengths}</p>
                                      <ul className="mt-0.5 space-y-0.5 list-disc pl-3.5">
                                        {modelT.strengths.map((s) => <li key={s}>{s}</li>)}
                                      </ul>
                                    </div>
                                    <div>
                                      <p className="font-medium text-[#111111]">{t.settings.modelWeaknesses}</p>
                                      <ul className="mt-0.5 space-y-0.5 list-disc pl-3.5">
                                        {modelT.weaknesses.map((s) => <li key={s}>{s}</li>)}
                                      </ul>
                                    </div>
                                    <div>
                                      <p className="font-medium text-[#111111]">{t.settings.modelBestFor}</p>
                                      <p className="mt-0.5">{modelT.bestFor}</p>
                                    </div>
                                    <p className="text-muted-foreground">{t.settings.modelTestNote}</p>
                                    <a
                                      href={modelFeedbackUrl(label, APP_VERSION_LINE)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-block text-[#111111] underline underline-offset-2"
                                    >
                                      {t.settings.modelFeedback}
                                    </a>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground leading-snug">
                      {t.settings.modelsTestingNote}{' '}
                      <a
                        href={modelFeedbackUrl(undefined, APP_VERSION_LINE)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#111111] underline underline-offset-2"
                      >
                        {t.settings.modelsFeedback}
                      </a>
                    </p>
                  </div>
                  <div className="border-t border-[#E5E5E0] pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="label-meta text-muted-foreground">{t.settings.detectionSensitivity}</span>
                      <span className="label-meta text-[#111111]">{Math.round((1 - threshold) * 100)}%</span>
                    </div>
                    <Slider
                      min={5}
                      max={95}
                      step={1}
                      value={[Math.round((1 - threshold) * 100)]}
                      onValueChange={([v]) => handleThresholdChange(1 - v / 100)}
                    />
                    <div className="flex justify-between mt-1.5">
                      <span className="label-meta text-muted-foreground">{t.settings.fewerMatches}</span>
                      <span className="label-meta text-muted-foreground">{t.settings.moreMatches}</span>
                    </div>
                  </div>
                  <div className="border-t border-[#E5E5E0] pt-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t.settings.sensitivityExplanation}
                    </p>
                  </div>
                  <div className="border-t border-[#E5E5E0] pt-3">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-xs font-medium text-[#111111]">{t.settings.regexRules}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t.settings.regexRulesDescription}</p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={regexRules}
                        onClick={() => handleRegexChange(!regexRules)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer border-2 border-transparent transition-colors ${
                          regexRules ? 'bg-[#111111]' : 'bg-[#C8C5BC]'
                        }`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 bg-white shadow-sm transition-transform ${
                          regexRules ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </button>
                    </label>
                    {/* T228: the text language itself is picked next to the Redact button */}
                    {regexRules && (
                      <p className="text-[10px] text-muted-foreground mt-2 leading-snug">{t.settings.regexRegionHint}</p>
                    )}
                  </div>
                  {/* T263: types that are never anonymized. The same list as in the bar of detections,
                      reachable before any document is open. */}
                  <div className="border-t border-[#E5E5E0] pt-3" data-testid="settings-never">
                    <p className="text-xs font-medium text-[#111111]">{t.settings.neverTitle}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{t.settings.neverDescription}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {ALL_ENTITY_TYPES.map((type) => {
                        const on = keepTypes.includes(type);
                        return (
                          <button
                            key={type}
                            type="button"
                            aria-pressed={on}
                            onClick={() => handleKeepTypesChange(on ? keepTypes.filter((kept) => kept !== type) : [...keepTypes, type])}
                            className={`inline-flex items-center gap-1.5 px-2.5 md:px-2 min-h-11 md:min-h-6 text-xs font-medium border cursor-pointer transition-colors ${
                              on ? 'border-[#111111] bg-[#111111] text-[#F9F9F7]' : 'border-[#C8C5BC] bg-white text-[#525252] hover:border-[#111111] hover:text-[#111111]'
                            }`}
                          >
                            <span className="w-2 h-2" style={{ backgroundColor: ENTITY_COLORS[type] }} aria-hidden="true" />
                            {t.entityLabels[type]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {/* The reminder can be switched off in the reminder itself; this is the way back. */}
                  <div className="border-t border-[#E5E5E0] pt-3">
                    <label className="flex items-center justify-between gap-3 cursor-pointer">
                      <div>
                        <p className="text-xs font-medium text-[#111111]">{t.settings.reminderTitle}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{t.settings.reminderDescription}</p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={tableReminderEnabled}
                        aria-label={t.settings.reminderTitle}
                        data-testid="settings-reminder"
                        onClick={() => setTableReminderEnabled(!tableReminderEnabled)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer border-2 border-transparent transition-colors ${
                          tableReminderEnabled ? 'bg-[#111111]' : 'bg-[#C8C5BC]'
                        }`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 bg-white shadow-sm transition-transform ${
                          tableReminderEnabled ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </button>
                    </label>
                  </div>
                  <OcrWorkersSetting />
                  {/* Heavier rule: detection settings above, output settings below */}
                  <div className="border-t-2 border-[#111111] pt-3">
                    <span className="label-meta text-muted-foreground">{t.settings.replacementStyle}</span>
                    <div className="mt-2 space-y-2">
                      <button
                        onClick={() => handleReplacementModeChange('labeled')}
                        className={`w-full text-left px-3 py-2  border transition-colors cursor-pointer ${
                          replacementMode === 'labeled'
                            ? 'border-[#111111] bg-[#111111]/5 text-[#111111]'
                            : 'border-[#E5E5E0] text-[#525252] hover:border-[#111111]'
                        }`}
                      >
                        <p className="text-xs font-medium">{t.settings.labeledPlaceholders}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t.settings.labeledDescription}</p>
                      </button>
                      <button
                        onClick={() => handleReplacementModeChange('blanked')}
                        className={`w-full text-left px-3 py-2  border transition-colors cursor-pointer ${
                          replacementMode === 'blanked'
                            ? 'border-[#111111] bg-[#111111]/5 text-[#111111]'
                            : 'border-[#E5E5E0] text-[#525252] hover:border-[#111111]'
                        }`}
                      >
                        <p className="text-xs font-medium">{t.settings.blankedOut}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{t.settings.blankedDescription}</p>
                      </button>
                    </div>
                  </div>
                  <OfflineDataReset onClear={async () => { await clearOfflineData(__RUNTIME_SCRIPTS__); window.location.reload(); }} />
                </div>
              </PopoverContent>
            </Popover>

            {/* The pill is the always-visible engine status: it names the real state
                (setup pending vs downloading vs ready), carries the live percent, and
                clicking it jumps to the setup card / progress strip in the tool. On
                phones the label would not fit next to the wordmark and controls, so
                only the colored dot (plus the live percent while downloading) stays
                visible; the full label remains for assistive tech and on hover. */}
            {(() => {
              const statusLabel = modelLoaded
                ? t.header.ready
                : modelError
                  ? t.header.error
                  : modelConsented
                    ? `${t.header.notReady}${downloadProgress && downloadProgress.total > 0 ? ` ${progressPercent}%` : ''}`
                    : t.header.setupRequired;
              const mobileLabel =
                !modelLoaded && !modelError && modelConsented && downloadProgress && downloadProgress.total > 0
                  ? `${progressPercent}%`
                  : null;
              return (
                <button type="button" onClick={scrollToTool} className="cursor-pointer shrink-0" title={statusLabel} aria-label={statusLabel}>
                  <Badge variant="outline" className="gap-2 tabular-nums hover:bg-[#111111]/5 transition-colors">
                    <span className={`w-2 h-2 inline-block transition-colors duration-200 ${modelLoaded ? 'bg-[#2D6A4F]' : modelError ? 'bg-[#CC0000]' : 'bg-[#B8860B]'}`} />
                    {mobileLabel && <span className="sm:hidden">{mobileLabel}</span>}
                    <span className="hidden sm:inline">{statusLabel}</span>
                  </Badge>
                </button>
              );
            })()}
          </div>
        </div>
      </header>

      {/* Landing: hero + trust band + audience */}
      <Hero onScrollToTool={scrollToTool} />
      <TrustBand />
      <Audience />

      {/* Main content (the tool) */}
      <main id="tool" ref={toolRef} className="max-w-6xl mx-auto px-6 py-16 scroll-mt-4">
        {/* First-visit consent: the model download starts only when the user says so.
            The card names the model that will be fetched (the preselection from settings,
            else this device's default) with its real download size. Nothing is spawned
            or fetched until Accept: the engine refuses without the stored flag. */}
        {!modelConsented && !modelLoaded && !modelLoading && !modelError && (() => {
          const consentEntry = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];
          const consentLabel = t.settings.models[consentEntry.id as keyof typeof t.settings.models]?.label ?? consentEntry.label;
          return (
          <div ref={consentRef} className="mb-4 border border-[#111111] bg-[#F4F3EE] px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4 justify-between scroll-mt-20" data-testid="consent-card">
            <div>
              <p className="label-meta text-muted-foreground">{t.loading.setupTitle}</p>
              <p className="text-sm text-[#111111] font-semibold mt-1">{t.consent.forModel(consentLabel, consentEntry.sizeMB)}</p>
              <p className="text-xs text-[#525252] mt-1 leading-relaxed max-w-xl">{t.consent.body}</p>
            </div>
            <Button
              onClick={acceptModelDownload}
              variant="solid"
              className="gap-2 shrink-0 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" />
              {t.loading.setupAction}
            </Button>
          </div>
          );
        })()}
        {/* Engine status strip: setup happens here, the rest of the page stays readable */}
        {modelLoading && (
          <div className="animate-content-reveal-rise mb-4 border border-[#C8C5BC] bg-[#F4F3EE] px-4 py-3" role="status">
            <div className="flex items-center justify-between gap-4 mb-2">
              {/* Name the phase: "downloading" while bytes flow, "preparing" before and after
                  (cache reads, WASM compile). The bar sweeps whenever no amount is knowable. */}
              <p className="text-sm text-[#111111] font-medium">
                {downloadProgress && (downloadProgress.total === 0 || progressPercent < 100)
                  ? t.loading.downloadingModel
                  : t.loading.preparingEngine}
              </p>
              <p className="label-meta text-[#111111] tabular-nums shrink-0">
                {downloadProgress
                  ? downloadProgress.total > 0
                    ? t.loading.progress(formatBytes(downloadProgress.downloaded), formatBytes(downloadProgress.total), progressPercent)
                    : formatBytes(downloadProgress.downloaded)
                  : t.loading.initializing}
              </p>
            </div>
            <Progress
              value={downloadProgress && downloadProgress.total > 0 && progressPercent < 100 ? progressPercent : null}
              className="h-2"
            />
            <p className="label-meta text-[#525252] mt-2">
              {downloadProgress && downloadProgress.total > 0
                ? t.loading.oneTimeSetupWithSize(formatBytes(downloadProgress.total))
                : t.loading.oneTimeSetup}
            </p>
            {constrainedDevice && downloadProgress && downloadProgress.total > 100 * 1024 * 1024 && (
              <p className="text-xs text-[#CC0000] mt-1 font-medium">{t.loading.largeModelWarning}</p>
            )}
          </div>
        )}
        {modelError && !modelLoading && (
          <div className="animate-content-reveal-rise mb-4 border border-[#CC0000] bg-[#CC0000]/5 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div>
              <p className="text-sm font-semibold text-[#CC0000]">{modelNeedsWebGpu ? t.loading.webGpuTitle : t.loading.failedTitle}</p>
              <p className="text-xs text-[#525252] mt-0.5 leading-relaxed">{modelNeedsWebGpu ? t.loading.webGpuBody : t.loading.failedBody}</p>
            </div>
            {!modelNeedsWebGpu && <Button
              onClick={retryModelLoad}
              variant="solid"
              className="gap-2 shrink-0 text-xs font-semibold"
            >
              <RotateCw className="w-3.5 h-3.5" />
              {t.loading.retry}
            </Button>}
          </div>
        )}

        {/* Informed-consent export (T177): parts the writer cannot redact. Redact and
            Download stay disabled for this file until the user chooses Continue or Cancel. */}
        {hasDocumentExtraction && (
          <UnredactableNotice
            items={unredactableItems}
            warnings={fileWarnings}
            decided={allowUnredactable}
            onContinue={continueWithUnredactable}
            onCancel={removeFile}
          />
        )}

        {/* Workbook (T265): what was checked and what was not, shown as soon as the file is read. */}
        {hasXlsxExtraction && xlsxInfo && <SpreadsheetNotice info={xlsxInfo} />}

        {/* PDF (T216): parts the writer drops from the export instead of redacting them
            (annotations, forms, bookmarks, ...). Informational: nothing to decide. */}
        {hasPdfExtraction && pdfRemoved.length > 0 && (
          <section
            aria-label={t.pdf.removedTitle}
            data-testid="pdf-removed"
            className="animate-content-reveal mb-4 border border-[#C8C5BC] bg-[#F4F3EE] px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <Info className="w-4 h-4 text-[#525252] shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm text-[#111111] font-semibold">{t.pdf.removedTitle}</p>
                <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#111111]">
                  {pdfRemoved.map((part, i) => (
                    <li key={`${part.kind}-${i}`}>
                      {t.pdf.removed[part.kind]}
                      {part.count ? ` (${part.count})` : ''}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-[#525252] mt-2 leading-relaxed max-w-xl">{t.pdf.removedBody}</p>
              </div>
            </div>
          </section>
        )}

        {/* File bar - input file (left) + download (right) */}
        {fileName && anonymizedText && (
          <div className="animate-content-reveal grid grid-cols-1 md:grid-cols-2 gap-0 border border-b-0 border-[#C8C5BC] bg-[#F4F3EE]">
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-r-0 md:border-r border-[#C8C5BC]">
              <div className="w-7 h-7 bg-[#FFFFFF] border border-[#C8C5BC] flex items-center justify-center flex-shrink-0">
                {isImageFile(fileName)
                  ? <ImageIcon className="w-3.5 h-3.5 text-[#525252]" />
                  : <FileText className="w-3.5 h-3.5 text-[#525252]" />}
              </div>
              <p className="text-xs text-[#111111] truncate font-medium">{fileName}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2">
              {/* Next to the download, not a document away from it: what the file will carry readable. */}
              {keptCount > 0 && !anonymizing && (
                <button
                  onClick={() => revealList(true)}
                  data-testid="filebar-kept"
                  className="pressable flex items-center px-3 py-1.5 min-h-11 md:min-h-0 border border-[#8A6508] bg-[#F6EFD9] text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] hover:border-[#111111] transition-colors cursor-pointer text-xs font-medium text-left"
                >
                  {t.textOutput.filebarKept(keptCount)}
                </button>
              )}
              {/* T261: the table goes out where the protected file goes out. */}
              {replacementMode === 'labeled' && entries.length > 0 && (
                <button
                  onClick={handleSaveTable}
                  data-testid="filebar-save-table"
                  className="pressable flex items-center gap-2 px-3 py-1.5 min-h-11 md:min-h-0 border border-transparent text-[#111111] underline underline-offset-2 hover:border-[#C8C5BC] hover:no-underline transition-colors cursor-pointer text-xs font-medium"
                >
                  {tableJustSaved ? <Check className="w-3 h-3" /> : <Download className="w-3 h-3" />}
                  {tableJustSaved ? t.textOutput.tableSaved : t.textOutput.saveTable}
                </button>
              )}
              {hasXlsxExtraction && (
                <button
                  onClick={handleDownloadXlsx}
                  disabled={downloading || unredactablePending}
                  className="pressable flex items-center gap-2 px-3 py-1.5 min-h-11 md:min-h-0 border border-[#C8C5BC] bg-[#FFFFFF] text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] hover:border-[#111111] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  {t.textOutput.downloadDocx}
                </button>
              )}
              {hasDocxExtraction && (
                <button
                  onClick={handleDownloadDocx}
                  disabled={downloading || unredactablePending}
                  className="pressable flex items-center gap-2 px-3 py-1.5 min-h-11 md:min-h-0 border border-[#C8C5BC] bg-[#FFFFFF] text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] hover:border-[#111111] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  {t.textOutput.downloadDocx}
                </button>
              )}
              {hasPdfExtraction && (
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloading || unredactablePending}
                  className="pressable flex items-center gap-2 px-3 py-1.5 min-h-11 md:min-h-0 border border-[#C8C5BC] bg-[#FFFFFF] text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] hover:border-[#111111] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  {t.textOutput.downloadPdf}
                </button>
              )}
              {hasImage && entries.length > 0 && (
                <button
                  onClick={handleDownloadImage}
                  disabled={downloading}
                  className="pressable flex items-center gap-2 px-3 py-1.5 min-h-11 md:min-h-0 border border-[#C8C5BC] bg-[#FFFFFF] text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] hover:border-[#111111] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  {t.textOutput.downloadImage}
                </button>
              )}
            </div>
          </div>
        )}
        {/* Nothing detected in a file (T205): say so instead of a bare file bar. */}
        {fileName && anonymizedText && !anonymizing && entities.length === 0 && (
          <div role="status" className="animate-content-reveal border border-b-0 border-[#C8C5BC] bg-[#F4F3EE] px-4 py-2.5 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-[#525252] shrink-0 mt-0.5" />
            <p className="text-xs text-[#525252] leading-relaxed">{t.textOutput.noDetections}</p>
          </div>
        )}

        {/* T261: the protected result left the page, its table exists only in this tab. Right under
            the download and above the text, where the eye is after the click (under a long document
            it would never be seen). */}
        {tableReminder && <TableReminder onSave={handleSaveTable} onDismiss={dismissTableReminder} />}

        {/* Document panels */}
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-0 border border-[#C8C5BC] bg-[#FFFFFF] ${(fileName && anonymizedText) || tableReminder ? 'border-t-0' : ''}`}>
          <div className="md:border-r border-[#C8C5BC] bg-[#FFFFFF] flex flex-col">
            <TextInput value={inputText} onChange={handleInputChange} onClear={handleClear} entities={entities} onAddEntity={addManualEntity} onRemoveEntity={removeEntity} onToggleEntity={toggleEntity} keptIndices={excludedIndices} hasResult={anonymizedText !== ''} fileName={fileName} onLoadFile={loadFile} onRemoveFile={handleRemoveFile} />
          </div>
          <div className="bg-[#FFFFFF] border-t md:border-t-0 border-[#C8C5BC] flex flex-col">
            <TextOutput value={anonymizedText} entries={entries} replacedPlaces={entities.length - keptCount} foundPlaces={entities.length} onReviewList={revealList} keptReason={keptReason} keptRanges={keptRanges} fileLoaded={Boolean(fileName)} droppedCount={droppedCount} onKeepDropped={keepDroppedRedacted} onDismissDropped={dismissDropped} uncheckedCells={hasXlsxExtraction ? xlsxInfo?.otherNumberCells ?? 0 : 0} loading={anonymizing} onCopied={markResultTakenOut} />
          </div>
        </div>

        {/* Custom dictionary - attached to the workspace, on the way to the Redact button */}
        <DictionaryBar dictionary={dictionary} onChange={handleDictionaryChange} />
        {/* Ignore list - the dictionary's opposite: listed words are never anonymized */}
        <DictionaryBar kind="ignore" dictionary={ignoreList} onChange={handleIgnoreListChange} />

        {/* Redact button */}
        <div className="sticky bottom-0 z-30 chrome-material py-4 -mx-6 px-6">
          <div className="flex flex-col items-center gap-2 border-t border-[#E5E5E0] pt-4">
            <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5">
              {/* T228: the text language (which country's rules apply) sits with the
                  action it changes, not in the settings popover. Hidden when regex rules
                  are off: the ML models are language-agnostic. */}
              {regexRules && (
                <label className="flex items-center gap-2" data-testid="text-language">
                  <span className="label-meta text-muted-foreground whitespace-nowrap">{t.settings.regexRegion}</span>
                  <select
                    value={regexRegion}
                    onChange={(e) => handleRegexRegionChange(e.target.value as RegexRegionId)}
                    aria-label={t.settings.regexRegion}
                    className="h-9 px-2 text-xs border border-[#C8C5BC] bg-white text-[#111111] cursor-pointer focus:outline-none focus:border-[#111111]"
                  >
                    {REGEX_REGIONS.map((r) => (
                      <option key={r} value={r}>
                        {t.settings.regexRegions[r] ?? r}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button
                onClick={anonymize}
                disabled={!inputText.trim() || !modelLoaded || anonymizing || unredactablePending}
                size="lg"
                variant="solid"
                className="gap-2 px-12 py-4 text-sm font-semibold disabled:opacity-100 disabled:bg-[#111111]/55 disabled:text-[#F9F9F7] disabled:cursor-not-allowed"
              >
                {modelLoading
                  ? `${t.header.notReady}... ${downloadProgress && downloadProgress.total > 0 ? `${progressPercent}%` : ''}`
                  : anonymizing
                    ? t.redactButton.redacting
                    : <>{t.redactButton.redact} <ArrowRight className="w-4 h-4" /></>}
              </Button>
            </div>
            {/* Keyboard notation needs no translation; hidden on touch-only devices */}
            <p className="label-meta text-muted-foreground/50 hidden [@media(pointer:fine)]:block">
              {isMac ? '⌘Enter' : 'Ctrl+Enter'}
            </p>
            {detectionError && (
              <div className="animate-content-reveal-rise max-w-lg w-full border border-[#CC0000] bg-[#CC0000]/5 p-4 text-center">
                <p className="text-sm font-semibold text-[#CC0000]">{t.redactButton.detectionFailedTitle}</p>
                <p className="text-xs text-[#525252] mt-1.5">
                  {detectionErrorKind === 'timeout' ? t.detect.timeout : t.redactButton.detectionFailedBody}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Entity table (only in labeled mode) */}
        {replacementMode === 'labeled' && (
          <EntityTable
            entities={entities}
            entries={entries}
            excludedIndices={excludedIndices}
            text={inputText}
            onToggle={toggleEntity}
            onSetExcluded={setEntitiesExcluded}
            onRenameLabel={renameLabel}
            renamedValues={renamedOriginals}
            onResetLabel={resetLabel}
            keepTypes={keepTypes}
            onKeepTypesChange={handleKeepTypesChange}
            reveal={listReveal}
          />
        )}

        {/* Custom detection labels - only zero-shot models (GLiNER, GLiNER2) take them; the others have a fixed label set. */}
        {PROVIDERS.find((p) => p.id === activeProvider)?.customLabels && (
        <div className="mt-6">
          <button
            onClick={() => setLabelsExpanded(!labelsExpanded)}
            aria-expanded={labelsExpanded}
            className="w-full flex items-center justify-between px-4 py-3 bg-[#111111] text-[#F9F9F7] cursor-pointer hover:bg-[#222222] transition-colors duration-150"
          >
            <div className="flex items-baseline gap-2">
              <span className="label-meta text-[#F9F9F7] tracking-[0.15em]">{t.settings.customLabels}</span>
              {!labelsExpanded && customLabels.length > 0 && (
                <span className="text-[10px] text-[#F9F9F7]/60 font-mono">{customLabels.join(', ')}</span>
              )}
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#F9F9F7] transition-transform duration-200 ${labelsExpanded ? 'rotate-180' : ''}`}
            />
          </button>
          <div
            className="grid transition-all duration-300 ease-in-out"
            style={{ gridTemplateRows: labelsExpanded ? '1fr' : '0fr' }}
          >
            <div className="overflow-hidden">
              <div className="border border-t-0 border-[#E5E5E0] p-4">
                <p className="text-xs text-muted-foreground mb-3">{t.settings.customLabelsDescription}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    value={newLabelInput}
                    onChange={(e) => setNewLabelInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAddLabel(); }}
                    placeholder={t.settings.customLabelsPlaceholder}
                    className="w-52 text-xs px-3 py-2 border-b-2 border-[#111111] bg-transparent text-[#111111] font-mono placeholder:text-muted-foreground focus:outline-none focus:bg-[#F0F0F0]"
                    style={{ borderRadius: 0 }}
                  />
                  <button
                    onClick={handleAddLabel}
                    disabled={!newLabelInput.trim()}
                    className="pressable text-xs px-4 py-2 bg-[#111111] text-[#F9F9F7] hover:bg-[#F9F9F7] hover:text-[#111111] border border-[#111111] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer font-medium flex items-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" />
                    {t.settings.addLabel}
                  </button>
                  {customLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-[#111111] text-[#F9F9F7] font-mono"
                    >
                      {label}
                      <button
                        onClick={() => handleRemoveLabel(label)}
                        className="text-[#F9F9F7]/60 hover:text-[#FF3333] transition-colors cursor-pointer"
                        aria-label={`Remove ${label}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Step 2: De-anonymize (only in labeled mode). With a replacement table (the current
            document's, or one loaded from a file) the whole panel shows; without one only the
            way in for a table saved earlier (WLojek/DocCloak#3). */}
        {replacementMode === 'labeled' && (
          <div className={entries.length > 0 || importedMapping ? 'mt-16' : 'mt-6'}>
            {(entries.length > 0 || importedMapping) && (
              <div className="mb-6 border-b border-[#E5E5E0] pb-4">
                <h2 className="font-serif text-2xl font-medium text-[#111111] tracking-tight leading-tight">{t.step2.title}</h2>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">{t.step2.description}</p>
                <p className="text-xs text-muted-foreground/70 mt-1 leading-relaxed max-w-2xl">{t.step2.example}</p>
              </div>
            )}

            <DeAnonymize
              onRestoreText={restoreText}
              hasMapping={entries.length > 0}
              mappingCount={entries.length}
              mappingSample={entries.length > 0 ? { replacement: entries[0].replacement, original: entries[0].original } : null}
              onRestoreDocx={restoreDocx}
              onExportMapping={exportMapping}
              onImportMapping={importMapping}
              importedMapping={importedMapping}
              onClearImportedMapping={clearImportedMapping}
              onDownload={triggerBlobDownload}
              tableVersion={tableVersion}
              resultTakenOut={resultTakenOut}
            />
          </div>
        )}
      </main>

      {/* Landing: how it works + FAQ */}
      <HowItWorks />
      <FAQ />

      {/* Footer */}
      <footer className="border-t-2 border-[#111111] bg-[#F9F9F7] px-6 py-5">
        <div className="max-w-6xl mx-auto flex flex-col items-start gap-3">
          <div className="flex items-start gap-2.5">
            <Lock className="w-3.5 h-3.5 text-[#111111] shrink-0 -translate-y-px" />
            <p className="label-meta text-[#111111] leading-tight">{t.footer.offlineMessage}</p>
          </div>
          <a
            href="https://github.com/WLojek/DocCloak"
            target="_blank"
            rel="noopener noreferrer"
            className="label-meta text-[#111111] hover:underline flex items-center gap-2.5 leading-none"
          >
            <Github className="w-3.5 h-3.5 shrink-0 -translate-y-px" />
            <span>Open source on GitHub · AGPL-3.0</span>
          </a>
          <div className="relative">
            <button
              onClick={() => setFooterTooltipOpen(!footerTooltipOpen)}
              className="label-meta text-[#111111] hover:underline cursor-pointer flex items-center gap-2.5 leading-none text-left"
            >
              <Info className="w-3.5 h-3.5 shrink-0 -translate-y-px" />
              {t.footer.verifyText}
            </button>
            {footerTooltipOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFooterTooltipOpen(false)} />
                <div className="absolute bottom-full left-0 mb-2 z-50 bg-[#111111] text-[#F9F9F7] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] w-80 max-w-[calc(100vw-3rem)]">
                  <p className="text-xs font-sans leading-relaxed">{t.footer.verifyTooltip}</p>
                </div>
              </>
            )}
          </div>
          <p className="label-meta text-muted-foreground/80 leading-none mt-2 pt-3 border-t border-[#E5E5E0] w-full">
            © {new Date().getFullYear()} DocCloak v{__APP_VERSION__} · core {__CORE_VERSION__} · Built by Witold Łojek
          </p>
        </div>
      </footer>
    </div>
  );
}
