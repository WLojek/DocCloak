import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw, Copy, Check, FileText, Download, Upload, AlertTriangle, Info } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { useToast } from './Toast.tsx';
import type { ImportedMapping, MappingSample, RestoreDocxResult, RestoreTextResult } from '../hooks/useAnonymizer.ts';
import type { KnownLabel } from '../restoreReport.ts';

/** Labels that stayed, listed by name before the rest is summed up. */
const LEFTOVER_SHOWN = 12;

/** Longest original shown in the example pair of a table. */
const SAMPLE_LENGTH = 48;

interface DeAnonymizeProps {
  /** Pasted text with the originals back, how many places changed and which labels stayed. */
  onRestoreText: (text: string) => RestoreTextResult;
  /** The current document has a replacement table. */
  hasMapping: boolean;
  /** Values in the current document's table. */
  mappingCount: number;
  /** One pair of the current document's table, shown as the example of what a table is. */
  mappingSample: MappingSample | null;
  /** WLojek/DocCloak#3: originals back into a docx an assistant edited. */
  onRestoreDocx: (file: File) => Promise<RestoreDocxResult>;
  /** The current document's table as a file, or null when there is none. */
  onExportMapping: () => { blob: Blob; count: number; downloadName: string } | null;
  /** Load a table saved earlier; null when the file is not one. */
  onImportMapping: (file: File) => Promise<ImportedMapping | null>;
  /** The table loaded from a file, while it drives the restore. */
  importedMapping: ImportedMapping | null;
  onClearImportedMapping: () => void;
  onDownload: (blob: Blob, downloadName: string) => void;
  /** Counts the changes of the document's table: what was restored with an older one is put away. */
  tableVersion?: number;
  /** The protected text of the open document was copied or downloaded in this tab. */
  resultTakenOut?: boolean;
}

type DocxState =
  | { kind: 'idle' }
  | { kind: 'working'; fileName: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; fileName: string; restored: number; unresolved: string[]; stale: KnownLabel[]; others: string[]; fileOverDocument?: boolean; blob: Blob | null; downloadName: string };

/** Outline button, compact with a mouse and 44 px tall under a finger. */
const ACTION = 'gap-2 h-11 md:h-8 text-xs';

/**
 * Labels the restore left in the result, with why that happens and what to
 * do. Shared by the pasted-text and the Word routes so both answer the same
 * question the same way: did every name come back?
 */
function LeftoverLabels({ labels, stale = [], others = [], testId }: { labels: string[]; stale?: KnownLabel[]; others?: string[]; testId: string }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  // Text in brackets that is not known to be a label: listed without a verdict, so nobody reads
  // "no labels are left" over a "[PERSON]" or a "[NAME_1]" the assistant wrote.
  const otherNote = others.length > 0 && (
    <div className="mt-3 flex items-start gap-2 border border-[#C8C5BC] bg-white px-3 py-2.5" data-testid={`${testId}-others`}>
      <Info className="w-3.5 h-3.5 text-[#525252] shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-[#111111] leading-relaxed">{t.deAnonymize.otherBrackets}</p>
        <p className="text-xs font-mono text-[#111111] mt-1 [overflow-wrap:anywhere]">
          {others.slice(0, LEFTOVER_SHOWN).join('  ')}
          {others.length > LEFTOVER_SHOWN && <span className="font-sans text-[#525252]"> {t.deAnonymize.andMore(others.length - LEFTOVER_SHOWN)}</span>}
        </p>
      </div>
    </div>
  );
  if (labels.length === 0) return otherNote || null;
  const staleLabels = new Set(stale.map((item) => item.label));
  return (<>
    <div className="mt-3 flex items-start gap-2 border border-[#8A6508] bg-[#F6EFD9] px-3 py-2.5" data-testid={testId}>
      <AlertTriangle className="w-3.5 h-3.5 text-[#8A6508] shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-[#111111] font-medium leading-relaxed">{t.deAnonymize.leftover(labels.length)}</p>
        <p className="text-xs font-mono text-[#111111] mt-1 break-words">
          {(all ? labels : labels.slice(0, LEFTOVER_SHOWN)).join('  ')}
          {labels.length > LEFTOVER_SHOWN && !all && (
            <>
              <span className="font-sans text-[#525252]"> {t.deAnonymize.andMore(labels.length - LEFTOVER_SHOWN)}</span>{' '}
              <button type="button" onClick={() => setAll(true)} className="font-sans underline underline-offset-2 cursor-pointer py-2 md:py-0">
                {t.deAnonymize.showAll}
              </button>
            </>
          )}
        </p>
        {/* A label this tab issued itself: the cause is known, and so is the value it stood for. */}
        {stale.length > 0 && (
          <ul className="mt-1.5 space-y-1" data-testid={`${testId}-stale`}>
            {stale.slice(0, LEFTOVER_SHOWN).map((item) => (
              <li key={item.label} className="text-xs text-[#111111] leading-relaxed [overflow-wrap:anywhere]" data-reason={item.reason ?? 'gone'}>
                {item.reason === 'text'
                  ? t.deAnonymize.inTextOnly(item.label)
                  : item.reason === 'textlabel'
                  ? t.deAnonymize.inTextAndLabel(item.label)
                  : item.reason === 'two'
                  ? t.deAnonymize.staleTwo(item.label, item.original)
                  : item.reason === 'unread'
                  ? t.deAnonymize.unreadLabel(item.label, item.original)
                  : item.reason === 'elsewhere'
                    ? t.deAnonymize.staleElsewhere(item.label)
                    : t.deAnonymize.staleLabel(item.label, item.original)}
              </li>
            ))}
          </ul>
        )}
        {labels.some((label) => !staleLabels.has(label)) && (
          <p className="text-xs text-[#525252] mt-1.5 leading-relaxed">{t.deAnonymize.leftoverHelp}</p>
        )}
      </div>
    </div>
    {otherNote}
  </>);
}

export function DeAnonymize({
  onRestoreText,
  hasMapping,
  mappingCount,
  mappingSample,
  onRestoreDocx,
  onExportMapping,
  onImportMapping,
  importedMapping,
  onClearImportedMapping,
  onDownload,
  tableVersion,
  resultTakenOut = true,
}: DeAnonymizeProps) {
  const { t } = useTranslation();
  const [aiResponse, setAiResponse] = useState('');
  const [result, setResult] = useState<RestoreTextResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [docx, setDocx] = useState<DocxState>({ kind: 'idle' });
  const [tableError, setTableError] = useState(false);
  /** Name of the table file just saved: said next to the button, where a toast would cover it. */
  const [savedAs, setSavedAs] = useState<string | null>(null);
  const docxInputRef = useRef<HTMLInputElement>(null);
  const tableInputRef = useRef<HTMLInputElement>(null);
  const loadButtonRef = useRef<HTMLButtonElement>(null);
  // The report of a text restore, brought into view when the button is pressed.
  const statusRef = useRef<HTMLDivElement>(null);
  // The button that put a loaded table away is gone after the click: focus moves to "Load", not to nowhere.
  const focusLoad = useRef(false);
  useEffect(() => {
    if (!focusLoad.current) return;
    focusLoad.current = false;
    loadButtonRef.current?.focus({ preventScroll: true });
  });

  const { showToast } = useToast();

  // What was restored with one table says nothing about another.
  const forgetResults = () => {
    setResult(null);
    setDocx({ kind: 'idle' });
  };

  // The table in use changed (another document, a change in the list, a table from a file): what is
  // on screen was restored with the old one. It used to stay, with its Copy button, also after
  // "Clear" and a new document.
  const tableKey = `${tableVersion ?? ''}|${hasMapping}|${mappingCount}|${mappingSample?.replacement ?? ''}|${mappingSample?.original ?? ''}|${importedMapping?.fileName ?? ''}`;
  const shownFor = useRef(tableKey);
  useEffect(() => {
    if (shownFor.current === tableKey) return;
    shownFor.current = tableKey;
    setResult(null);
    setDocx({ kind: 'idle' });
    // The file named here holds the table as it was: a renamed label is not in it.
    setSavedAs(null);
  }, [tableKey]);

  const handleTableFile = async (file: File | undefined) => {
    if (tableInputRef.current) tableInputRef.current.value = '';
    if (!file) return;
    const imported = await onImportMapping(file);
    setTableError(imported === null);
    if (imported) {
      // The strip above changes colour and names the file: that is the confirmation.
      forgetResults();
      setSavedAs(null);
    }
  };

  const tableInput = (
    <input
      ref={tableInputRef}
      type="file"
      accept=".json,application/json"
      className="hidden"
      tabIndex={-1}
      aria-label={t.deAnonymize.tableImport}
      data-testid="mapping-file-input"
      onChange={(e) => void handleTableFile(e.target.files?.[0])}
    />
  );

  const loadButton = (
    <Button ref={loadButtonRef} variant="outline" className={`${ACTION} shrink-0`} onClick={() => tableInputRef.current?.click()} data-testid="mapping-import">
      <Upload className="w-3 h-3" />
      {t.deAnonymize.tableImport}
    </Button>
  );

  const tableErrorNote = tableError && (
    <p role="alert" className="text-xs text-[#CC0000] mt-2 leading-relaxed max-w-[80ch]" data-testid="mapping-error">{t.deAnonymize.tableInvalid}</p>
  );

  // Nothing to restore with: only the way in for a table saved earlier.
  if (!hasMapping && importedMapping === null) {
    return (
      <div className="border border-[#C8C5BC] bg-[#F4F3EE] px-4 py-3" data-testid="restore-load-table">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-xs text-[#525252] leading-relaxed max-w-2xl">{t.deAnonymize.loadEarlier}</p>
          {tableInput}
          {loadButton}
        </div>
        {tableErrorNote}
      </div>
    );
  }

  const fromFile = importedMapping !== null;
  const sample = fromFile ? importedMapping.sample : mappingSample;
  const sampleOriginal = sample ? sample.original.replace(/\s+/g, ' ').trim() : '';

  const handleRestoreText = () => {
    if (!aiResponse.trim()) return;
    setResult(onRestoreText(aiResponse));
    // The report is brought into view when it is not (a phone, a long reply): it says whether
    // every name came back.
    requestAnimationFrame(() => statusRef.current?.scrollIntoView?.({ block: 'nearest' }));
  };

  // Which table did the restoring: said in the report itself when it is not the document's own
  // (the strip that warns about it is above the text box, off screen on a phone).
  // The document's own table is named too, with one of its pairs: labels repeat from one document
  // to the next ("[PERSON_1]" is in every one), and a reply of another document, pasted here by
  // mistake, would otherwise come back with this document's names and nothing to tell.
  const fileTableLine = importedMapping ? (
    <p className="text-xs text-[#111111] font-medium leading-relaxed bg-[#F6EFD9] border border-[#8A6508] px-2 py-1 mb-1.5 [overflow-wrap:anywhere]" data-testid="restore-file-table">
      {t.deAnonymize.usedFileTable(importedMapping.fileName)}
    </p>
  ) : mappingSample ? (<>
    <p className="text-xs text-[#525252] leading-relaxed mb-1 [overflow-wrap:anywhere]" data-testid="restore-document-table">
      {t.deAnonymize.usedDocumentTable(mappingSample.replacement, mappingSample.original)}
    </p>
    {/* A reply cannot belong to a text that never left this page: the one case the tab can see of
        a reply from another document meeting this document's table. */}
    {!resultTakenOut && (
      <p className="text-xs text-[#111111] font-medium leading-relaxed bg-[#F6EFD9] border border-[#8A6508] px-2 py-1 mb-1.5" data-testid="restore-not-taken-out">
        {t.deAnonymize.notTakenOut}
      </p>
    )}
  </>) : null;
  const crossNote = (
    <p className="text-xs text-[#111111] font-medium leading-relaxed bg-[#F6EFD9] border border-[#8A6508] px-2 py-1 mb-1.5" data-testid="restore-file-over-document">
      {t.deAnonymize.fileOverDocument}
    </p>
  );

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    // A text that still holds labels is not finished: said when it is taken.
    showToast(result.unresolved.length > 0 ? t.deAnonymize.copiedWithLabels(result.unresolved.length) : t.toast.copiedToClipboard);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDocxFile = async (file: File | undefined) => {
    if (docxInputRef.current) docxInputRef.current.value = '';
    if (!file) return;
    setDocx({ kind: 'working', fileName: file.name });
    const outcome = await onRestoreDocx(file);
    if (!outcome.success) {
      setDocx({ kind: 'error', message: outcome.message });
      return;
    }
    setDocx({ kind: 'done', fileName: file.name, ...outcome, stale: outcome.stale ?? [], others: outcome.others ?? [] });
    if (outcome.blob) onDownload(outcome.blob, outcome.downloadName);
  };

  const handleExport = () => {
    const table = onExportMapping();
    if (!table) return;
    onDownload(table.blob, table.downloadName);
    setSavedAs(table.downloadName);
  };

  return (
    <div>
      {/* The table in use, with its two actions. First, and tinted when it comes from a file: a wrong
          table would write wrong names and nothing else on the page could tell. */}
      <section
        aria-label={t.deAnonymize.tableTitle}
        data-testid="restore-source"
        data-source={fromFile ? 'file' : 'document'}
        className={`border-2 border-b-0 border-[#111111] px-4 py-3.5 ${fromFile ? 'bg-[#F6EFD9]' : 'bg-[#F4F3EE]'}`}
      >
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="min-w-0" role="status" aria-live="polite">
            <p className="text-sm text-[#111111] font-semibold leading-snug break-words" data-testid="restore-source-line">
              {fromFile
                ? t.deAnonymize.tableFromFile(importedMapping.fileName, importedMapping.count)
                : t.deAnonymize.tableCurrent(mappingCount)}
            </p>
            {sample && (
              <p className="text-xs text-[#111111] mt-1 break-words" data-testid="restore-source-sample">
                {t.deAnonymize.tableExample}{' '}
                <span className="font-mono">
                  {sample.replacement} = {sampleOriginal.length > SAMPLE_LENGTH ? `${sampleOriginal.slice(0, SAMPLE_LENGTH)}...` : sampleOriginal}
                </span>
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {tableInput}
            {fromFile ? (
              <Button
                variant="outline"
                className={ACTION}
                data-testid="mapping-unload"
                onClick={() => {
                  onClearImportedMapping();
                  setTableError(false);
                  forgetResults();
                  focusLoad.current = true;
                }}
              >
                {hasMapping ? t.deAnonymize.tableUseCurrent : t.deAnonymize.tableRemove}
              </Button>
            ) : (
              <Button variant="outline" className={ACTION} onClick={handleExport} data-testid="mapping-export">
                <Download className="w-3 h-3" />
                {t.textOutput.saveTable}
              </Button>
            )}
            {loadButton}
          </div>
        </div>
        <p className="text-xs text-[#525252] mt-2.5 leading-relaxed max-w-[80ch]">
          {fromFile
            ? (hasMapping ? t.deAnonymize.tableFromFileNote : t.deAnonymize.tableFromFileNoteAlone)
            : t.deAnonymize.tableBody}
        </p>
        {!fromFile && (
          <p className="text-xs text-[#525252] mt-1 leading-relaxed max-w-[80ch]">{t.deAnonymize.tableSaveHint}</p>
        )}
        {!fromFile && savedAs && (
          <p role="status" className="text-xs text-[#111111] font-medium mt-2 break-words" data-testid="mapping-saved">{t.deAnonymize.docxDownloaded(savedAs)}</p>
        )}
        {tableErrorNote}
      </section>

      {/* Route 1: pasted text */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-2 border-[#111111]">
        <div className="flex flex-col md:border-r-2 border-[#111111]">
          <div className="flex items-center justify-center h-11 bg-[#111111] px-3">
            <label htmlFor="restore-paste" className="label-meta text-[#F9F9F7] tracking-[0.15em]">{t.deAnonymize.pasteLabel}</label>
          </div>
          <div className="min-h-[200px] flex-1">
            <textarea
              id="restore-paste"
              value={aiResponse}
              onChange={(e) => { setAiResponse(e.target.value); setResult(null); }}
              placeholder={t.deAnonymize.inputPlaceholder}
              className="w-full bg-transparent p-4 text-foreground placeholder-muted-foreground resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#111111] text-sm leading-relaxed min-h-[200px]"
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
          </div>
          <div className="border-t border-[#E5E5E0] px-4 py-2 bg-[#F5F5F3]">
            <Button
              onClick={handleRestoreText}
              disabled={!aiResponse.trim()}
              variant="outline"
              className={ACTION}
            >
              <RotateCcw className="w-3 h-3" />
              {t.deAnonymize.restoreButton}
            </Button>
          </div>
        </div>
        <div className="flex flex-col border-t-2 md:border-t-0 border-[#111111]">
          <div className="flex items-center justify-center h-11 relative bg-[#111111] px-3">
            <p className="label-meta text-[#F9F9F7] tracking-[0.15em]">{t.deAnonymize.restoredLabel}</p>
            {result && (
              <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5 h-11 md:h-7 absolute right-0 md:right-2 text-[#F9F9F7] hover:bg-[#F9F9F7]/10 hover:text-[#F9F9F7]">
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? t.deAnonymize.copied : t.deAnonymize.copy}
              </Button>
            )}
          </div>
          {/* The answer to "did every name come back" stands above the text: under a reply of
              several pages it was a screen or more below what the button showed, and a label that
              stayed went unseen. */}
          <div ref={statusRef} className={result ? 'border-b border-[#E5E5E0] px-4 py-2.5 bg-[#F5F5F3] scroll-mt-24' : 'hidden'} aria-live="polite" data-testid="restore-text-status">
            {result ? (
              <>
                {fileTableLine}
                {result.fileOverDocument && crossNote}
                <p className="text-xs text-[#111111] leading-relaxed">
                  {t.deAnonymize.restoredCount(result.restored)}
                  {result.restored > 0 && result.unresolved.length === 0 && (result.others ?? []).length === 0 && !result.fileOverDocument && (resultTakenOut || importedMapping !== null) && ` ${t.deAnonymize.allClear}`}
                </p>
                <LeftoverLabels labels={result.unresolved} stale={result.stale} others={result.others} testId="restore-text-unresolved" />
              </>
            ) : (
              <p className="text-xs text-[#525252]">&nbsp;</p>
            )}
          </div>
          <div className="flex-1 min-h-[200px] p-4 text-foreground text-sm leading-relaxed whitespace-pre-wrap break-words min-w-0">
            {result ? (
              /* Keyed so every restore replays the rise: the round-trip's final frame */
              <div key={result.text} className="animate-content-reveal-rise" data-testid="restore-text-result">
                {/* What came back is tinted, a label that stayed is marked: nobody should have to
                    hunt through the text for either. */}
                {result.segments.map((segment, i) => (
                  segment.kind === 'plain'
                    ? <span key={i}>{segment.text}</span>
                    : (
                      <mark
                        key={i}
                        data-kind={segment.kind}
                        className={segment.kind === 'restored'
                          ? 'bg-[#2D6A4F]/15 text-inherit px-0.5'
                          : 'bg-[#F6EFD9] text-[#111111] font-mono border-b-2 border-[#8A6508] px-0.5'}
                      >
                        {segment.text}
                      </mark>
                    )
                ))}
              </div>
            ) : (
              <span className="text-muted-foreground">
                {t.deAnonymize.outputPlaceholder}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Route 2 (WLojek/DocCloak#3): the whole Word document. Same weight as route 1. */}
      <section
        aria-labelledby="restore-docx-title"
        className="border-2 border-t-0 border-[#111111]"
        data-testid="restore-docx"
      >
        <div className="flex items-center justify-center h-11 bg-[#111111] px-3">
          <h3 id="restore-docx-title" className="label-meta text-[#F9F9F7] tracking-[0.15em]">{t.deAnonymize.docxTitle}</h3>
        </div>
        <div className="px-4 py-4 flex flex-col md:flex-row md:items-start gap-3 md:gap-6">
          <div className="md:w-1/2 min-w-0">
            <p className="text-sm text-[#111111] leading-relaxed">{t.deAnonymize.docxBody}</p>
            <input
              ref={docxInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              tabIndex={-1}
              aria-label={t.deAnonymize.docxButton}
              data-testid="restore-docx-input"
              onChange={(e) => void handleDocxFile(e.target.files?.[0])}
            />
            <Button
              variant="outline"
              className={`${ACTION} mt-3`}
              disabled={docx.kind === 'working'}
              onClick={() => docxInputRef.current?.click()}
            >
              <FileText className="w-3 h-3" />
              {docx.kind === 'working' ? t.deAnonymize.docxWorking : t.deAnonymize.docxButton}
            </Button>
          </div>
          <div className="md:w-1/2 min-w-0" aria-live="polite" data-testid="restore-docx-status">
            {docx.kind === 'error' && (
              <p role="alert" className="text-xs text-[#CC0000] leading-relaxed">{docx.message}</p>
            )}
            {docx.kind === 'done' && docx.blob === null && (
              <p className="text-xs text-[#111111] leading-relaxed">{t.deAnonymize.docxNothing(docx.fileName)}</p>
            )}
            {docx.kind === 'done' && docx.blob !== null && fileTableLine}
            {docx.kind === 'done' && docx.blob !== null && docx.fileOverDocument && crossNote}
            {docx.kind === 'done' && docx.blob !== null && (
              <p className="text-xs text-[#111111] leading-relaxed">
                {t.deAnonymize.restoredCount(docx.restored)}
                {docx.unresolved.length === 0 && docx.others.length === 0 && !docx.fileOverDocument && (resultTakenOut || importedMapping !== null) && ` ${t.deAnonymize.allClear}`}{' '}
                {t.deAnonymize.docxDownloaded(docx.downloadName)}{' '}
                <button
                  type="button"
                  onClick={() => onDownload(docx.blob as Blob, docx.downloadName)}
                  className="inline-flex items-center min-h-11 md:min-h-6 underline underline-offset-2 cursor-pointer"
                >
                  {t.deAnonymize.docxDownloadAgain}
                </button>
              </p>
            )}
            {docx.kind === 'done' && <LeftoverLabels labels={docx.unresolved} stale={docx.stale} others={docx.others} testId="restore-docx-unresolved" />}
          </div>
        </div>
      </section>
    </div>
  );
}
