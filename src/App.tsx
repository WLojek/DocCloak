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
import { Lock, Settings, ArrowRight, Languages, Check, Plus, X, ChevronDown, Info, FileText, Download } from 'lucide-react';
import logoSrc from './ui/assets/doc-cloak-logo-light.png';
import { version } from '../package.json';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from './ui/components/Toast.tsx';
import { PROVIDERS, REGEX_REGIONS } from './core/engine.ts';
import type { RegexRegionId } from './core/engine.ts';

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
    hasDocxExtraction,
    loadDocxFile,
    exportDocx,
    removeDocxFile,
  } = useAnonymizer();

  const { showToast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newLabelInput, setNewLabelInput] = useState('');
  const [labelsExpanded, setLabelsExpanded] = useState(false);
  const [footerTooltipOpen, setFooterTooltipOpen] = useState(false);
  const clearSnapshotRef = useRef<{ text: string; anonymized: string; entities: typeof entities; entries: typeof entries } | null>(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownloadDocx = useCallback(async () => {
    if (!exportDocx) return;
    setDownloading(true);
    try {
      const blob = await exportDocx();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ext = docxFileName?.match(/\.(docx?)$/i)?.[1] ?? 'docx';
      const baseName = docxFileName?.replace(/\.(docx?)$/i, '') ?? 'document';
      a.href = url;
      a.download = `${baseName}_redacted.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(t.textOutput.downloaded);
    } catch (err) {
      console.error('[DocCloak] Export failed:', err);
      showToast(t.textOutput.exportFailed ?? 'Export failed.');
    } finally {
      setDownloading(false);
    }
  }, [exportDocx, docxFileName, showToast, t]);

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Model download overlay */}
      {modelLoading && (
        <div className="fixed inset-0 z-40 bg-[#F9F9F7]/95 flex items-center justify-center">
          <Card className="max-w-sm w-full mx-6 border-[#111111] shadow-[4px_4px_0px_0px_#111111]">
            <CardContent className="pt-8 pb-8 text-center">
              <img src={logoSrc} alt="DocCloak" className="h-14 mx-auto mb-4" />
              <h2 className="font-serif text-xl tracking-tight uppercase mb-1">
                <span className="font-bold text-[#111111]">Doc</span>
                <span className="font-normal text-[#525252]">Cloak</span>
              </h2>
              <p className="text-sm text-[#525252] mb-6 font-body">
                {t.loading.preparingEngine}
              </p>

              <Progress value={progressPercent} className="mb-3" />

              {downloadProgress ? (
                <p className="label-meta text-[#525252]">
                  {downloadProgress.total > 0
                    ? t.loading.progress(formatBytes(downloadProgress.downloaded), formatBytes(downloadProgress.total), progressPercent)
                    : formatBytes(downloadProgress.downloaded)}
                </p>
              ) : (
                <p className="label-meta text-[#525252]">{t.loading.initializing}</p>
              )}

              <p className="label-meta text-[#525252] mt-4">
                {downloadProgress && downloadProgress.total > 0
                  ? t.loading.oneTimeSetupWithSize(formatBytes(downloadProgress.total))
                  : t.loading.oneTimeSetup}
              </p>
              {downloadProgress && downloadProgress.total > 100 * 1024 * 1024 && (
                <p className="text-xs text-[#CC0000] mt-2 font-medium">
                  {t.loading.largeModelWarning}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Anonymizing overlay */}
      {anonymizing && (
        <div className="fixed inset-0 z-40 bg-[#F9F9F7]/80 flex items-center justify-center">
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
              <p className="font-serif text-base font-bold mb-1 uppercase tracking-tight">{t.anonymizing.title}</p>
              {detectionProgress !== null && (
                <div className="w-48 mx-auto mt-3 mb-2">
                  <Progress value={Math.round(detectionProgress * 100)} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground mt-1">{Math.round(detectionProgress * 100)}%</p>
                </div>
              )}
              <p className="text-sm text-[#525252] font-body">{t.anonymizing.description}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Header */}
      <header className="bg-[#F9F9F7] border-b-4 border-[#111111] px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src={logoSrc} alt="DocCloak" className="h-9" />
            <div className="flex flex-col">
              <span className="font-serif text-xl tracking-tight uppercase leading-none">
                <span className="font-bold text-[#111111]">Doc</span>
                <span className="font-normal text-[#525252]">Cloak</span>
              </span>
              <span className="label-meta text-muted-foreground mt-0.5 hidden sm:block">
                v{version}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Language switcher */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Languages className="w-4 h-4" />
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
                <Button variant="ghost" size="icon" className="h-8 w-8">
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
                            <p className="text-[10px] text-muted-foreground font-light mt-0.5">{modelT?.description ?? p.description}</p>
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
                  <div className="border-t border-[#E5E5E0] pt-3 space-y-1">
                    <p className="text-xs text-muted-foreground leading-relaxed font-light">
                      {t.settings.sensitivityExplanation}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed font-light">
                      {t.settings.confidenceThreshold(threshold.toFixed(2))}
                    </p>
                  </div>
                  <div className="border-t border-[#E5E5E0] pt-3">
                    <label className="flex items-center justify-between cursor-pointer">
                      <div>
                        <p className="text-xs font-medium text-[#111111]">{t.settings.regexRules}</p>
                        <p className="text-[10px] text-muted-foreground font-light mt-0.5">{t.settings.regexRulesDescription}</p>
                      </div>
                      <button
                        role="switch"
                        aria-checked={regexRules}
                        onClick={() => handleRegexChange(!regexRules)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          regexRules ? 'bg-[#111111]' : 'bg-[#E5E5E0]'
                        }`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
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
                          className="mt-1 w-full px-2 py-1.5 text-xs border border-[#E5E5E0] bg-white text-[#111111] cursor-pointer focus:outline-none focus:border-[#111111]"
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
                  <div className="border-t border-[#E5E5E0] pt-3">
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
                        <p className="text-[10px] text-muted-foreground font-light mt-0.5">{t.settings.labeledDescription}</p>
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
                        <p className="text-[10px] text-muted-foreground font-light mt-0.5">{t.settings.blankedDescription}</p>
                      </button>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Badge variant="outline" className="gap-2">
              <span className={`w-2 h-2 inline-block ${modelLoaded ? 'bg-[#2D6A4F]' : modelError ? 'bg-[#CC0000]' : 'bg-[#B8860B]'}`} />
              {modelLoaded ? t.header.ready : modelError ? t.header.error : t.header.notReady}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-6 py-10 newsprint-texture">
        {/* Custom detection labels — only supported by GLiNER (zero-shot). BardS.ai has a fixed label set. */}
        {activeProvider !== 'bardsai' && (
        <div className="mb-6">
          <button
            onClick={() => setLabelsExpanded(!labelsExpanded)}
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
                <p className="text-xs text-muted-foreground font-light mb-3">{t.settings.customLabelsDescription}</p>
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
                    className="text-xs px-4 py-2 bg-[#111111] text-[#F9F9F7] hover:bg-[#F9F9F7] hover:text-[#111111] border border-[#111111] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer uppercase tracking-wider font-sans font-medium flex items-center gap-1.5"
                  >
                    <Plus className="w-3 h-3" />
                    {t.settings.addLabel}
                  </button>
                  {customLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-[#111111] text-[#F9F9F7] font-mono shadow-[2px_2px_0px_0px_#E5E5E0] hover:shadow-[3px_3px_0px_0px_#CC0000] hover:translate-x-[-1px] hover:translate-y-[-1px] transition-all duration-150"
                    >
                      {label}
                      <button
                        onClick={() => handleRemoveLabel(label)}
                        className="text-[#F9F9F7]/60 hover:text-[#CC0000] transition-colors cursor-pointer"
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

        {/* File bar — input file (left) + download (right) */}
        {docxFileName && anonymizedText && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-2 border-b-0 border-[#111111] bg-[#F5F5F3]">
            <div className="flex items-center gap-2 px-4 py-2.5 border-r-0 md:border-r-2 border-[#111111]">
              <div className="w-7 h-7 bg-[#E5E5E0] flex items-center justify-center flex-shrink-0">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground truncate">{docxFileName}</p>
            </div>
            <div className="flex items-center px-4 py-2.5">
              {hasDocxExtraction && entries.length > 0 && (
                <button
                  onClick={handleDownloadDocx}
                  disabled={downloading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-[#111111] text-[#F9F9F7] hover:bg-[#222222] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                >
                  <Download className="w-3 h-3" />
                  {t.textOutput.downloadDocx}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Document panels */}
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-0 border-2 border-[#111111] ${docxFileName && anonymizedText ? 'border-t-0' : ''}`}>
          <div className="border-r-2 border-[#111111] bg-[#F9F9F7]">
            <TextInput value={inputText} onChange={handleInputChange} onClear={handleClear} entities={entities} onAddEntity={addManualEntity} onRemoveEntity={removeEntity} docxFileName={docxFileName} onLoadDocx={loadDocxFile} onRemoveDocx={removeDocxFile} />
          </div>
          <div className="bg-[#F9F9F7]">
            <TextOutput value={anonymizedText} entries={entries} loading={anonymizing} />
          </div>
        </div>

        {/* Redact button */}
        <div className="sticky bottom-0 z-30 bg-[#F9F9F7] py-4 -mx-6 px-6">
          <div className="flex flex-col items-center gap-2">
            <div className="w-full border-t border-[#E5E5E0]" />
            <Button
              onClick={anonymize}
              disabled={!inputText.trim() || !modelLoaded || anonymizing}
              size="lg"
              className="gap-3 px-16 py-4 text-sm uppercase tracking-[0.25em] font-semibold shadow-[4px_4px_0px_0px_#111111] hover:shadow-[2px_2px_0px_0px_#111111] hover:translate-x-[2px] hover:translate-y-[2px] transition-all duration-150"
            >
              {anonymizing ? t.redactButton.redacting : <>{t.redactButton.redact} <ArrowRight className="w-4 h-4" /></>}
            </Button>
            <p className="label-meta text-muted-foreground/50">{t.redactButton.shortcutHint}</p>
            <div className="w-full border-t border-[#E5E5E0]" />
            {detectionError && (
              <div className="max-w-lg w-full border-2 border-[#CC0000] bg-[#CC0000]/5 p-4 text-center">
                <p className="text-sm font-sans font-semibold text-[#CC0000] uppercase tracking-wider">Detection failed</p>
                <p className="text-xs text-[#525252] mt-1.5">The model could not process this text. Please try again or refresh the page.</p>
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

        {/* Step 2: De-anonymize (only in labeled mode) */}
        {replacementMode === 'labeled' && entries.length > 0 && (
          <div className="mt-12">
            {/* Ornamental divider */}
            <div className="py-6 text-center font-serif text-xl text-[#E5E5E0] tracking-[1em] select-none">&#10043; &#10043; &#10043;</div>

            <div className="mb-2">
              <div className="flex items-baseline gap-3">
                <span className="font-serif text-lg font-bold text-[#111111] uppercase tracking-tight">02</span>
                <div>
                  <h2 className="font-serif text-lg font-bold text-[#111111] uppercase tracking-tight leading-tight">{t.step2.title}</h2>
                  <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{t.step2.description}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1 leading-relaxed italic">{t.step2.example}</p>
                </div>
              </div>
            </div>
            <div className="border-b-2 border-[#111111] mb-6" />

            <DeAnonymize
              onDeanonymize={deanonymize}
              hasMapping={entries.length > 0}
            />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t-2 border-[#111111] bg-[#F9F9F7] px-6 py-5 mt-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Lock className="w-3.5 h-3.5 text-[#111111]" />
            <p className="label-meta text-[#111111]">{t.footer.offlineMessage}</p>
          </div>
          <div className="relative">
            <button
              onClick={() => setFooterTooltipOpen(!footerTooltipOpen)}
              className="label-meta text-muted-foreground hover:text-[#111111] transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Info className="w-3 h-3" />
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
        </div>
      </footer>
    </div>
  );
}
