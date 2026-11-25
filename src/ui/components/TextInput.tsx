import { useRef, useCallback, useState, useEffect } from 'react';
import type { DetectedEntity, EntityType } from '@doccloak/core';
import { ENTITY_COLORS } from '@doccloak/core';
import { isImageFile } from '@doccloak/core/dom';
import { EntityTypePicker } from './EntityTypePicker.tsx';
import { Button } from '@/components/ui/button';
import { X, Upload, FileText, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { useFeatureStrings } from '../../i18n/features/index.ts';
import { retypeStrings } from '../../i18n/features/retype.ts';
import { useRetypeMenu } from '../hooks/useRetypeMenu.tsx';
import { useToast } from './Toast.tsx';
import type { LoadFileResult } from '../hooks/useAnonymizer.ts';

interface TextInputProps {
  value: string;
  onChange: (text: string) => void;
  onClear: () => void;
  entities: DetectedEntity[];
  onAddEntity?: (start: number, end: number, type: EntityType) => void;
  onRemoveEntity?: (index: number) => void;
  /** Places of `entities` that are found but not redacted: drawn differently, they stay readable. */
  keptIndices?: Set<number>;
  /**
   * Redact a place or leave it readable. When given, a click on a detected value does this
   * instead of removing the detection: a removed one left no trace in the list or in any count.
   */
  onToggleEntity?: (index: number) => void;
  /**
   * Give every place of a value another type (WLojek/DocCloak#5). When given, the context menu of
   * a found value (right click, the menu key, a long press) and a selection inside one open the
   * menu of types. A plain click stays what it was.
   */
  onChangeType?: (value: string, type: EntityType) => void;
  /** Redact or leave readable many places in one step: the "do not redact" of the menu of types. */
  onSetExcluded?: (indices: number[], excluded: boolean) => void;
  /** A result exists for this text: the "ready, click Redact" hint is over. */
  hasResult?: boolean;
  fileName?: string | null;
  onLoadFile?: (file: File) => Promise<LoadFileResult>;
  /**
   * Several files picked or dropped at once (WLojek/DocCloak#6). When given, the file field takes
   * more than one file and everything picked or dropped goes here, one file included.
   */
  onLoadFiles?: (files: File[]) => Promise<LoadFileResult>;
  onRemoveFile?: () => void;
  /**
   * Shown in place of the text field while there is no text and no file: a set of files is open
   * and none of them is on the page, so there is nothing to type into.
   */
  emptyNote?: string;
}

interface WordSpan {
  text: string;
  start: number;
  end: number;
  entity?: DetectedEntity;
}

function buildWordSpans(text: string, entities: DetectedEntity[]): WordSpan[] {
  if (!text) return [];

  const spans: WordSpan[] = [];
  const sorted = [...entities].sort((a, b) => a.start - b.start);

  let entityIdx = 0;
  let pos = 0;
  while (pos < text.length) {
    const wsStart = pos;
    while (pos < text.length && /\s/.test(text[pos])) pos++;
    if (pos > wsStart) {
      spans.push({ text: text.slice(wsStart, pos), start: wsStart, end: pos });
    }
    if (pos >= text.length) break;

    while (entityIdx < sorted.length && sorted[entityIdx].end <= pos) entityIdx++;

    if (entityIdx < sorted.length && sorted[entityIdx].start <= pos && sorted[entityIdx].end > pos) {
      const ent = sorted[entityIdx];
      spans.push({ text: text.slice(ent.start, ent.end), start: ent.start, end: ent.end, entity: ent });
      pos = ent.end;
      entityIdx++;
    } else {
      const wordStart = pos;
      while (pos < text.length && !/\s/.test(text[pos])) {
        if (entityIdx < sorted.length && pos >= sorted[entityIdx].start) break;
        pos++;
      }
      spans.push({ text: text.slice(wordStart, pos), start: wordStart, end: pos });
    }
  }

  return spans;
}

export function TextInput({ value, onChange, onClear, entities, onAddEntity, onRemoveEntity, keptIndices, onToggleEntity, onChangeType, onSetExcluded, hasResult, fileName, onLoadFile, onLoadFiles, onRemoveFile, emptyNote }: TextInputProps) {
  const { t } = useTranslation();
  const retypeText = useFeatureStrings(retypeStrings);
  const { showToast } = useToast();
  // WLojek/DocCloak#5: the menu of types for a value that is found already.
  const { enabled: canRetype, open: openRetype, openFor: retypeFor, menu: retypeMenu } = useRetypeMenu({ text: value, entities, excluded: keptIndices, onChangeType, onSetExcluded });
  const retypeOpen = retypeFor !== null;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  // The list as it is now, for the Undo of a click on a value (it outlives the render it was made in).
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const keptRef = useRef(keptIndices);
  keptRef.current = keptIndices;
  // The text as it is now: an Undo made for one document does nothing once another is on the page.
  const valueRef = useRef(value);
  valueRef.current = value;
  // Where the mouse button went down on a found value: a press that moved is a selection.
  const pressAt = useRef<{ x: number; y: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const [picker, setPicker] = useState<{ word: string; start: number; end: number; x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const hasEntities = entities.length > 0;

  const canLoad = Boolean(onLoadFile || onLoadFiles);
  const processFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    let result: LoadFileResult;
    if (onLoadFiles) result = await onLoadFiles(files);
    else if (onLoadFile) result = await onLoadFile(files[0]);
    else return;
    if (!result.success) {
      // Typed refusals (T177/T178) arrive already translated in `message`;
      // the raw error text is only the fallback for untyped failures.
      const message = result.error === 'unsupported'
        ? t.textInput.unsupportedFormat
        : result.error === 'no-text'
          ? t.textInput.ocrNoText
          : (result.message ?? result.error ?? 'Failed to load file');
      // Persist the failure in the panel; the toast alone disappears too fast.
      setFileError(message);
      showToast(message);
    } else {
      setFileError(null);
    }
  }, [onLoadFile, onLoadFiles, showToast, t]);
  const processFile = useCallback((file: File) => processFiles([file]), [processFiles]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    await processFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFiles]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    await processFiles(Array.from(e.dataTransfer.files));
  }, [processFiles]);

  const openPickerFromSelection = useCallback((clientX?: number, clientY?: number) => {
    if (!onAddEntity) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const container = containerRef.current;
    if (!container || !container.contains(range.startContainer) || !container.contains(range.endContainer)) return;

    const findCharOffset = (node: Node, isEnd: boolean): number | null => {
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement);
      if (!el) return null;
      const span = el.closest('[data-start]');
      if (!span) return null;
      const start = parseInt(span.getAttribute('data-start')!, 10);
      const end = parseInt(span.getAttribute('data-end')!, 10);
      return isEnd ? end : start;
    };

    const selStart = findCharOffset(range.startContainer, false);
    const selEnd = findCharOffset(range.endContainer, true);

    if (selStart === null || selEnd === null || selStart >= selEnd) return;

    const selectedText = value.slice(selStart, selEnd).trim();
    if (!selectedText) return;

    // Touch selections come with no pointer position, so anchor the picker
    // to the selected text itself.
    const rect = range.getBoundingClientRect();

    // The menu of types is open already (a long press opens it and selects the word as well).
    if (retypeOpen) {
      selection.removeAllRanges();
      return;
    }
    // A selection inside one found value is a question about that value, not a new mark: it opens
    // the menu of types for it. "Mark as" on a redacted value used to answer that it is redacted
    // already, and on a value that is not redacted it redacted the place under the label of the
    // type it was found as ("[PHONE_1]" for what the user had just marked as something else).
    // The menu does both: the type for the value, and the place redacted when it was not.
    const found = canRetype ? entities.findIndex((entity) => entity.start === selStart && entity.end === selEnd) : -1;
    if (found !== -1 && (onSetExcluded || !(keptIndices?.has(found) ?? false))) {
      openRetype({ value: entities[found].value, type: entities[found].type, place: found, x: clientX ?? rect.left, y: clientY ?? rect.bottom + 8 });
      selection.removeAllRanges();
      return;
    }

    setPicker({
      word: selectedText.length > 40 ? selectedText.slice(0, 37) + '...' : selectedText,
      start: selStart,
      end: selEnd,
      x: clientX ?? rect.left,
      y: clientY ?? rect.bottom + 8,
    });

    selection.removeAllRanges();
  }, [onAddEntity, onSetExcluded, value, entities, keptIndices, canRetype, openRetype, retypeOpen]);

  const handleSelectionEnd = useCallback((e: React.MouseEvent) => {
    openPickerFromSelection(e.clientX, e.clientY);
  }, [openPickerFromSelection]);

  // On touch devices (iOS in particular) selecting text is a long-press
  // gesture that never fires mouseup, so the mouseup path above never runs
  // and only the native copy/look-up callout appears. Instead, watch
  // selectionchange and open the picker once the selection has stayed put
  // for a beat (dragging the selection handles keeps resetting the timer).
  // Coarse-pointer only: desktop keeps its open-at-release-point behavior.
  useEffect(() => {
    if (!hasEntities || !onAddEntity) return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelectionChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => openPickerFromSelection(), 500);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [hasEntities, onAddEntity, openPickerFromSelection]);

  const handlePickerSelect = useCallback((type: EntityType) => {
    if (picker && onAddEntity) {
      onAddEntity(picker.start, picker.end, type);
    }
    setPicker(null);
  }, [picker, onAddEntity]);

  // Pasting a screenshot or copied image runs it through OCR
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!canLoad) return;
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const blob = item.getAsFile();
    if (!blob) return;
    e.preventDefault();
    const ext = item.type.split('/')[1] ?? 'png';
    const file = blob.name ? blob : new File([blob], `pasted-image.${ext}`, { type: item.type });
    void processFile(file);
  }, [canLoad, processFile]);

  const wordSpans = hasEntities ? buildWordSpans(value, entities) : [];
  const showEmptyState = !value && !fileName;
  const isImage = fileName ? isImageFile(fileName) : false;

  return (
    <div
      className="flex flex-col h-full"
      onDragEnter={canLoad ? handleDragEnter : undefined}
      onDragLeave={canLoad ? handleDragLeave : undefined}
      onDragOver={canLoad ? handleDragOver : undefined}
      onDrop={canLoad ? handleDrop : undefined}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between h-11 relative border-b border-[#C8C5BC] px-4 bg-[#F4F3EE]">
        <h3 className="font-serif text-sm text-[#111111] font-medium">
          {t.textInput.title}
        </h3>
        {value && (
          <Button variant="ghost" size="sm" onClick={fileName ? onRemoveFile : onClear} className="gap-1.5 h-7 text-[#525252] hover:bg-[#E5E5E0] hover:text-[#111111]">
            <X className="w-3 h-3" />
            {t.textInput.clear}
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".doc,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.bmp,.gif"
          multiple={Boolean(onLoadFiles)}
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {/* Content area */}
      <div className="min-h-[200px] relative flex-1">
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-20 bg-[#F9F9F7]/95 border border-dashed border-[#525252] flex flex-col items-center justify-center gap-3 pointer-events-none">
            <div className="w-12 h-12 border border-[#525252] flex items-center justify-center">
              <Upload className="w-6 h-6 text-[#111111]" />
            </div>
            <p className="text-sm font-medium text-[#111111]">{t.textInput.dragging}</p>
          </div>
        )}

        {hasEntities ? (
          /* Detected entities view */
          <div
            ref={containerRef}
            onMouseUp={handleSelectionEnd}
            className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground select-text cursor-text"
          >
            {wordSpans.map((span, i) => {
              if (/^\s+$/.test(span.text)) {
                return <span key={i} data-start={span.start} data-end={span.end}>{span.text}</span>;
              }
              if (span.entity) {
                const entityIndex = entities.findIndex(
                  (e) => e.start === span.entity!.start && e.end === span.entity!.end
                );
                const kept = entityIndex !== -1 && (keptIndices?.has(entityIndex) ?? false);
                const removeWithUndo = () => {
                  if (entityIndex === -1) return;
                  if (onToggleEntity) {
                    // Same as the box in the list: the place stays listed, counted and marked.
                    onToggleEntity(entityIndex);
                    const place = span.entity!;
                    const text = value;
                    showToast(kept ? t.entityTable.redactedToast(1) : t.entityTable.keptToast(1), {
                      label: t.toast.undo,
                      // Undo acts on this place, wherever it stands in the list by then (a value
                      // marked by hand in between moves the numbers), and only while the place is
                      // still as this click left it.
                      onClick: () => {
                        // Another document is on the page: this place is not one of its places.
                        if (valueRef.current !== text) return;
                        const now = entitiesRef.current.findIndex((e) => e.start === place.start && e.end === place.end && e.value === place.value);
                        if (now === -1) return;
                        const keptNow = keptRef.current?.has(now) ?? false;
                        if (keptNow === !kept) onToggleEntity(now);
                      },
                    });
                    return;
                  }
                  if (!onRemoveEntity) return;
                  const removed = span.entity!;
                  onRemoveEntity(entityIndex);
                  showToast(t.toast.redactionRemoved, {
                    label: t.toast.undo,
                    onClick: () => onAddEntity?.(removed.start, removed.end, removed.type),
                  });
                };
                const action = kept ? t.entityTable.include : onToggleEntity ? t.entityTable.dontRedactThese(1) : t.textInput.removeRedaction;
                const hint = kept ? `${t.entityTable.keptChip}. ${action}` : action;
                // The menu of types, under the value (the pointer's place is used when there is one).
                const openTypes = (mark: HTMLElement, x?: number, y?: number) => {
                  const box = mark.getBoundingClientRect();
                  const atPointer = x !== undefined && y !== undefined && (x !== 0 || y !== 0);
                  openRetype({
                    value: span.entity!.value,
                    type: span.entity!.type,
                    place: entityIndex === -1 ? undefined : entityIndex,
                    x: atPointer ? x : box.left,
                    y: atPointer ? y : box.bottom + 4,
                    yAbove: atPointer ? undefined : box.top - 4,
                    opener: mark,
                  });
                };
                return (
                  <mark
                    key={i}
                    data-start={span.start}
                    data-end={span.end}
                    className="entity-highlight-animate focus:outline focus:outline-2 focus:outline-[#111111]"
                    role="button"
                    tabIndex={0}
                    aria-label={`${action}: ${span.text}`}
                    onMouseDown={(e) => { pressAt.current = { x: e.clientX, y: e.clientY }; }}
                    // The second action of a found value: its context menu is the menu of types
                    // (right click, the menu key, VoiceOver's menu command, a long press on Android).
                    // With text selected the browser's own menu stays, so the selection can be copied.
                    onContextMenu={canRetype ? (e) => {
                      const selection = window.getSelection();
                      if (selection && !selection.isCollapsed) return;
                      e.preventDefault();
                      openTypes(e.currentTarget, e.clientX, e.clientY);
                    } : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      // A drag that selects part of the value is a selection (the "Mark as" picker
                      // opens for it), not a click: it must not leave the value readable. The
                      // selection itself is gone by now (the picker takes it), so the gesture is
                      // told by where the button went down and where it came up.
                      const down = pressAt.current;
                      pressAt.current = null;
                      if (down && (Math.abs(e.clientX - down.x) > 4 || Math.abs(e.clientY - down.y) > 4)) return;
                      const selection = window.getSelection();
                      if (selection && !selection.isCollapsed) return;
                      removeWithUndo();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Delete' || e.key === 'Backspace') {
                        e.preventDefault();
                        removeWithUndo();
                      }
                      // A keyboard without a menu key (a Mac) has Shift+F10 for the same menu.
                      if (canRetype && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
                        e.preventDefault();
                        openTypes(e.currentTarget);
                      }
                    }}
                    aria-keyshortcuts={canRetype ? 'Shift+F10' : undefined}
                    title={canRetype ? `${hint}. ${retypeText.markHint}` : hint}
                    data-kept={kept ? 'true' : undefined}
                    style={{
                      // Tinted block in the type's own color: more visible than the ink block was.
                      // A place that is found but not redacted has no tint and a dashed amber line:
                      // it used to look exactly like a redacted one.
                      backgroundColor: kept ? 'transparent' : ENTITY_COLORS[span.entity.type] + '30',
                      borderBottom: kept ? '2px dashed #8A6508' : `2px solid ${ENTITY_COLORS[span.entity.type]}`,
                      // The word stays dark: in the type's colour it measured 3.45 to 4.35:1 on the tint.
                      color: '#111111',
                      padding: '1px 3px',
                      cursor: 'pointer',
                      '--mark-color': ENTITY_COLORS[span.entity.type] + '70',
                    } as React.CSSProperties}
                  >
                    {span.text}
                  </mark>
                );
              }
              return (
                <span key={i} data-start={span.start} data-end={span.end}>
                  {span.text}
                </span>
              );
            })}
          </div>
        ) : fileName ? (
          /* Loaded file (document or OCR'd image) - read-only text preview */
          <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground overflow-auto max-h-[60vh]">
            {/* A file dropped while another is loaded can fail too: the message must not stay inside the hidden dropzone. */}
            {fileError && (
              <p className="mb-3 text-xs text-[#CC0000]" role="alert">{fileError}</p>
            )}
            {/* File loaded banner */}
            <div className="flex items-center gap-3 mb-4 px-3 py-2.5 bg-[#111111]/5 border border-[#E5E5E0]">
              <div className="w-8 h-8 bg-[#111111] flex items-center justify-center flex-shrink-0">
                {isImage
                  ? <ImageIcon className="w-4 h-4 text-[#F9F9F7]" />
                  : <FileText className="w-4 h-4 text-[#F9F9F7]" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[#111111] truncate">{fileName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {isImage ? `${t.textInput.ocrExtracted} · ` : ''}{t.textInput.wordCount(wordCount)}
                </p>
              </div>
              <button
                onClick={onRemoveFile}
                className="text-muted-foreground hover:text-[#CC0000] transition-colors cursor-pointer flex-shrink-0"
                title={t.textInput.removeFile}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {value}
          </div>
        ) : emptyNote ? (
          /* A set of files is open and none of them is on the page. */
          <div className="p-4 min-h-[200px] flex flex-col items-center justify-center gap-2 text-center" data-testid="input-empty-note">
            <FileText className="w-5 h-5 text-[#707070]" aria-hidden="true" />
            <p className="text-sm text-[#525252]">{emptyNote}</p>
            {fileError && (
              <p className="text-xs text-[#CC0000]" role="alert">{fileError}</p>
            )}
          </div>
        ) : (
          /* Editable text area - same element whether empty or not */
          <div className="flex flex-col">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onPaste={handlePaste}
              placeholder={t.textInput.placeholder}
              className={`w-full bg-transparent p-4 text-[#111111] placeholder:text-[#707070] resize-none focus:outline-none text-sm leading-relaxed ${showEmptyState ? 'min-h-[140px]' : 'min-h-[200px]'}`}
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            {/* Upload section - only visible when empty */}
            {showEmptyState && canLoad && (
              <>
                <div className="flex items-center gap-3 px-4">
                  <div className="flex-1 border-t border-[#E5E5E0]" />
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-medium">{t.textInput.dropzoneOr}</span>
                  <div className="flex-1 border-t border-[#E5E5E0]" />
                </div>
                <div className="px-4 py-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center gap-4 p-4 border border-dashed border-[#E5E5E0] hover:border-[#111111]/40 transition-all cursor-pointer group"
                  >
                    <div className="w-10 h-10 bg-[#111111]/5 group-hover:bg-[#111111] flex items-center justify-center flex-shrink-0 transition-colors">
                      <FileText className="w-5 h-5 text-muted-foreground group-hover:text-[#F9F9F7] transition-colors" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-medium text-[#111111]">
                        {t.textInput.uploadDocx}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {t.textInput.uploadDocxSub}
                      </p>
                    </div>
                  </button>
                  {fileError && (
                    <p className="mt-2 text-xs text-[#CC0000]" role="alert">{fileError}</p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="border-t border-[#E5E5E0] px-4 py-2 bg-[#F5F5F3] flex items-center justify-between">
        <p className="label-meta text-muted-foreground">
          {value ? t.textInput.wordCount(wordCount) : '\u00A0'}
        </p>
        <div className="flex items-center gap-3">
          {value && !hasEntities && !hasResult && (
            <p className="label-meta text-[#2D6A4F]">{t.textInput.readyToRedact}</p>
          )}
          {hasEntities && (
            <p className="label-meta text-[#525252]">{t.textInput.selectToTag}</p>
          )}
        </div>
      </div>

      {retypeMenu}
      {picker && (
        <EntityTypePicker
          word={picker.word}
          x={picker.x}
          y={picker.y}
          onSelect={handlePickerSelect}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
