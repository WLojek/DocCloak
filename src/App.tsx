import { TextInput } from './ui/components/TextInput.tsx';
import { TextOutput } from './ui/components/TextOutput.tsx';
import { EntityTable } from './ui/components/EntityTable.tsx';
import { DeAnonymize } from './ui/components/DeAnonymize.tsx';
import { useAnonymizer } from './ui/hooks/useAnonymizer.ts';
import { useTranslation } from './i18n/LanguageContext.tsx';
import { languages } from './i18n/translations/index.ts';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Lock, Settings, ArrowRight, Languages, Check, Plus, X, ChevronDown, Info, FileText, Image as ImageIcon, Download, Github, RotateCw } from 'lucide-react';
import { isImageFile } from '@doccloak/core/dom';
import logoSrc from './ui/assets/doc-cloak-logo-light.png';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from './ui/components/Toast.tsx';
import { Hero, TrustBand, Audience, HowItWorks, FAQ } from './ui/components/Landing.tsx';
import { PROVIDERS, REGEX_REGIONS } from '@doccloak/core';
import { PROVIDER_SIZES, getRecommendedProviderId } from './engine.ts';
import type { RegexRegionId } from '@doccloak/core';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export default function App() {
  const { t, language, setLanguage } = useTranslation();
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
    detectionError,
    modelError,
    downloadProgress,
    handleInputChange,
    anonymize,
    addManualEntity,
    removeEntity,
    renameLabel,
    toggleEntity,
    deanonymize,
    clear,
    threshold,
    replacementMode,
    customLabels,
    handleThresholdChange,
    handleReplacementModeChange,
    handleCustomLabelsChange,
    activeProvider,
    handleSwitchProvider,
    regexRules,
    handleRegexChange,
    regexRegion,
    handleRegexRegionChange,
    docxFileName,
    fileName,
    hasDocxExtraction,
    hasImage,
    ocrProgress,
    loadFile,
    exportDocx,
    exportRedactedImage,
    removeFile,
    retryModelLoad,
    modelConsented,
    acceptModelDownload,
  } = useAnonymizer();

  const { showToast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newLabelInput, setNewLabelInput] = useState('');
  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const [footerTooltipOpen, setFooterTooltipOpen] = useState(false);
  const clearSnapshotRef = useRef<{ text: string; anonymized: string; entities: typeof entities; entries: typeof entries } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const toolRef = useRef<HTMLElement>(null);
  const scrollToTool = useCallback(() => {
    toolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      showToast(t.textOutput.downloaded);
    } catch (err) {
      console.error('[DocCloak] Export failed:', err);
      showToast(t.textOutput.exportFailed ?? 'Export failed.');
    } finally {
      setDownloading(false);
    }
  }, [exportDocx, docxFileName, triggerBlobDownload, showToast, t]);

  const handleDownloadImage = useCallback(async () => {
    if (!exportRedactedImage) return;
    setDownloading(true);
    try {
      const blob = await exportRedactedImage();
      const baseName = fileName?.replace(/\.[^.]+$/, '') ?? 'image';
      triggerBlobDownload(blob, `${baseName}_redacted.png`);
      showToast(t.textOutput.downloaded);
    } catch (err) {
      console.error('[DocCloak] Image export failed:', err);
      showToast(t.textOutput.exportFailed ?? 'Export failed.');
    } finally {
      setDownloading(false);
    }
  }, [exportRedactedImage, fileName, triggerBlobDownload, showToast, t]);

  // Keyboard shortcut: Cmd+Enter / Ctrl+Enter to redact
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (inputText.trim() && modelLoaded && !anonymizing) {
          anonymize();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [inputText, modelLoaded, anonymizing, anonymize]);

  // Clear with undo
  const handleClear = useCallback(() => {
    if (!inputText) return;
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
  }, [inputText, anonymizedText, entities, entries, clear, handleInputChange, showToast, t]);

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
                <p className="text-[10px] text-muted-foreground mt-1">{Math.round(ocrProgress * 100)}%</p>
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
                <div className="w-48 mx-auto mt-3 mb-2">
                  <Progress value={Math.round(detectionProgress * 100)} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground mt-1">{Math.round(detectionProgress * 100)}%</p>
                </div>
              )}
              <p className="text-sm text-[#525252]">{t.anonymizing.description}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <header className={`sticky top-0 z-30 px-6 transition-all duration-200 chrome-material ${scrolled ? 'py-2 border-b border-[#E5E5E0] shadow-[0_1px_0_0_rgba(17,17,17,0.04)]' : 'py-3 border-b border-transparent'}`}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoSrc} alt="DocCloak" className={`transition-all duration-200 ${scrolled ? 'h-7' : 'h-9'}`} />
            <span className={`font-serif tracking-tight leading-none text-[#111111] font-medium transition-all duration-200 ${scrolled ? 'text-xl' : 'text-2xl'}`}>
              DocCloak
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* Language switcher */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label={t.header.language}>
                  <Languages className="w-4 h-4" />
                  <span className="text-[10px] font-mono uppercase text-[#525252]">{language}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-48 p-1 max-h-[70vh] overflow-auto">
                {languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => setLanguage(lang.code)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#E5E5E0] transition-colors duration-200 flex items-center justify-between cursor-pointer"
                  >
                    <span className="text-[#111111]/80">{lang.nativeName}</span>
                    {language === lang.code && <Check className="w-3.5 h-3.5 text-[#111111]" />}
                  </button>
                ))}
              </PopoverContent>
            </Popover>

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
                        return (
                          <button
                            key={p.id}
                            onClick={() => { setSettingsOpen(false); handleSwitchProvider(p.id); }}
                            disabled={modelLoading}
                            className={`w-full text-left px-3 py-2 border transition-colors cursor-pointer ${
                              activeProvider === p.id
                                ? 'border-[#111111] bg-[#111111]/5 text-[#111111]'
                                : 'border-[#E5E5E0] text-[#525252] hover:border-[#111111]'
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <p className="text-xs font-medium">{modelT?.label ?? p.label}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{modelT?.description ?? p.description}</p>
                          </button>
                        );
                      })}
                    </div>
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
                    {regexRules && (
                      <div className="mt-2">
                        <span className="label-meta text-muted-foreground">{t.settings.regexRegion}</span>
                        <select
                          value={regexRegion}
                          onChange={(e) => handleRegexRegionChange(e.target.value as RegexRegionId)}
                          className="mt-1 w-full px-2 py-1.5 text-xs border border-[#C8C5BC] bg-white text-[#111111] cursor-pointer focus:outline-none focus:border-[#111111]"
                        >
                          {REGEX_REGIONS.map((r) => (
                            <option key={r} value={r}>
                              {t.settings.regexRegions[r] ?? r}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
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
                </div>
              </PopoverContent>
            </Popover>

            {/* The pill is the always-visible engine status: it names the real state
                (setup pending vs downloading vs ready), carries the live percent, and
                clicking it jumps to the setup card / progress strip in the tool. */}
            <button type="button" onClick={scrollToTool} className="cursor-pointer">
              <Badge variant="outline" className="gap-2 tabular-nums hover:bg-[#111111]/5 transition-colors">
                <span className={`w-2 h-2 inline-block transition-colors duration-200 ${modelLoaded ? 'bg-[#2D6A4F]' : modelError ? 'bg-[#CC0000]' : 'bg-[#B8860B]'}`} />
                {modelLoaded
                  ? t.header.ready
                  : modelError
                    ? t.header.error
                    : modelConsented
                      ? `${t.header.notReady}${downloadProgress && downloadProgress.total > 0 ? ` ${progressPercent}%` : ''}`
                      : t.header.setupRequired}
              </Badge>
            </button>
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
            The size shown is the active provider's real download (desktop defaults to
            the large high-accuracy model, constrained devices to the lightweight one). */}
        {!modelConsented && !modelLoaded && !modelLoading && !modelError && (
          <div className="mb-4 border border-[#111111] bg-[#F4F3EE] px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <p className="text-sm text-[#111111] font-semibold">{t.loading.setupTitle}</p>
              <p className="text-xs text-[#525252] mt-1 leading-relaxed max-w-xl">{t.loading.setupBody(PROVIDER_SIZES[activeProvider])}</p>
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
        )}
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
              <p className="text-sm font-semibold text-[#CC0000]">{t.loading.failedTitle}</p>
              <p className="text-xs text-[#525252] mt-0.5 leading-relaxed">{t.loading.failedBody}</p>
            </div>
            <Button
              onClick={retryModelLoad}
              variant="solid"
              className="gap-2 shrink-0 text-xs font-semibold"
            >
              <RotateCw className="w-3.5 h-3.5" />
              {t.loading.retry}
            </Button>
          </div>
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
            <div className="flex items-center justify-end px-4 py-2">
              {hasDocxExtraction && entries.length > 0 && (
                <button
                  onClick={handleDownloadDocx}
                  disabled={downloading}
                  className="pressable flex items-center gap-2 px-3 py-1.5 border border-[#C8C5BC] bg-[#FFFFFF] text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] hover:border-[#111111] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  {t.textOutput.downloadDocx}
                </button>
              )}
              {hasImage && entries.length > 0 && (
                <button
                  onClick={handleDownloadImage}
                  disabled={downloading}
                  className="pressable flex items-center gap-2 px-3 py-1.5 border border-[#C8C5BC] bg-[#FFFFFF] text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] hover:border-[#111111] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  {t.textOutput.downloadImage}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Document panels */}
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-0 border border-[#C8C5BC] bg-[#FFFFFF] ${fileName && anonymizedText ? 'border-t-0' : ''}`}>
          <div className="md:border-r border-[#C8C5BC] bg-[#FFFFFF] flex flex-col">
            <TextInput value={inputText} onChange={handleInputChange} onClear={handleClear} entities={entities} onAddEntity={addManualEntity} onRemoveEntity={removeEntity} fileName={fileName} onLoadFile={loadFile} onRemoveFile={removeFile} />
          </div>
          <div className="bg-[#FFFFFF] border-t md:border-t-0 border-[#C8C5BC] flex flex-col">
            <TextOutput value={anonymizedText} entries={entries} loading={anonymizing} />
          </div>
        </div>

        {/* Redact button */}
        <div className="sticky bottom-0 z-30 chrome-material py-4 -mx-6 px-6">
          <div className="flex flex-col items-center gap-2 border-t border-[#E5E5E0] pt-4">
            <Button
              onClick={anonymize}
              disabled={!inputText.trim() || !modelLoaded || anonymizing}
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
            {/* Keyboard notation needs no translation; hidden on touch-only devices */}
            <p className="label-meta text-muted-foreground/50 hidden [@media(pointer:fine)]:block">
              {isMac ? '⌘Enter' : 'Ctrl+Enter'}
            </p>
            {detectionError && (
              <div className="animate-content-reveal-rise max-w-lg w-full border border-[#CC0000] bg-[#CC0000]/5 p-4 text-center">
                <p className="text-sm font-semibold text-[#CC0000]">{t.redactButton.detectionFailedTitle}</p>
                <p className="text-xs text-[#525252] mt-1.5">{t.redactButton.detectionFailedBody}</p>
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
            onToggle={toggleEntity}
            onRenameLabel={renameLabel}
          />
        )}

        {/* Custom detection labels - only supported by GLiNER (zero-shot). BardS.ai has a fixed label set. */}
        {activeProvider !== 'bardsai' && (
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

        {/* Step 2: De-anonymize (only in labeled mode) */}
        {replacementMode === 'labeled' && entries.length > 0 && (
          <div className="mt-16">
            <div className="mb-6 border-b border-[#E5E5E0] pb-4">
              <h2 className="font-serif text-2xl font-medium text-[#111111] tracking-tight leading-tight">{t.step2.title}</h2>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-2xl">{t.step2.description}</p>
              <p className="text-xs text-muted-foreground/70 mt-1 leading-relaxed max-w-2xl">{t.step2.example}</p>
            </div>

            <DeAnonymize
              onDeanonymize={deanonymize}
              hasMapping={entries.length > 0}
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
                <div className="absolute bottom-full right-0 mb-2 z-50 bg-[#111111] text-[#F9F9F7] p-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] max-w-xs">
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
