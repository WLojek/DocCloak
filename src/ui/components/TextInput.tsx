import { useRef, useCallback, useState } from 'react';
import type { DetectedEntity, EntityType } from '../../core/types.ts';
import { ENTITY_COLORS } from '../../core/types.ts';
import { EntityTypePicker } from './EntityTypePicker.tsx';
import { Button } from '@/components/ui/button';
import { X, Upload, FileText } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { useToast } from './Toast.tsx';

interface TextInputProps {
  value: string;
  onChange: (text: string) => void;
  onClear: () => void;
  entities: DetectedEntity[];
  onAddEntity?: (start: number, end: number, type: EntityType) => void;
  onRemoveEntity?: (index: number) => void;
  docxFileName?: string | null;
  onLoadDocx?: (file: File) => Promise<{ success: boolean; error?: string }>;
  onRemoveDocx?: () => void;
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

export function TextInput({ value, onChange, onClear, entities, onAddEntity, onRemoveEntity, docxFileName, onLoadDocx, onRemoveDocx }: TextInputProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const [picker, setPicker] = useState<{ word: string; start: number; end: number; x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const hasEntities = entities.length > 0;

  const processFile = useCallback(async (file: File) => {
    if (!onLoadDocx) return;
    const result = await onLoadDocx(file);
    if (!result.success) {
      showToast(result.error === 'unsupported' ? t.textInput.unsupportedFormat : (result.error ?? 'Failed to load file'));
    }
  }, [onLoadDocx, showToast, t]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFile]);

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
    const file = e.dataTransfer.files[0];
    if (file) {
      await processFile(file);
    }
  }, [processFile]);

  const handleSelectionEnd = useCallback((e: React.MouseEvent) => {
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

    setPicker({
      word: selectedText.length > 40 ? selectedText.slice(0, 37) + '...' : selectedText,
      start: selStart,
      end: selEnd,
      x: e.clientX,
      y: e.clientY,
    });

    selection.removeAllRanges();
  }, [onAddEntity, value]);

  const handlePickerSelect = useCallback((type: EntityType) => {
    if (picker && onAddEntity) {
      onAddEntity(picker.start, picker.end, type);
    }
    setPicker(null);
  }, [picker, onAddEntity]);

  const wordSpans = hasEntities ? buildWordSpans(value, entities) : [];
  const showEmptyState = !value && !docxFileName;

  return (
    <div
      className="flex flex-col"
      onDragEnter={onLoadDocx ? handleDragEnter : undefined}
      onDragLeave={onLoadDocx ? handleDragLeave : undefined}
      onDragOver={onLoadDocx ? handleDragOver : undefined}
      onDrop={onLoadDocx ? handleDrop : undefined}
    >
      {/* Header bar */}
      <div className="flex items-center justify-center h-11 relative border-b-2 border-[#111111] bg-[#111111] px-3">
        <h3 className="label-meta text-[#F9F9F7] tracking-[0.15em]">
          {t.textInput.title}
        </h3>
        {value && (
          <Button variant="ghost" size="sm" onClick={docxFileName ? onRemoveDocx : onClear} className="gap-1.5 h-7 absolute right-2 text-[#F9F9F7] hover:bg-[#F9F9F7]/10 hover:text-[#F9F9F7]">
            <X className="w-3 h-3" />
            {t.textInput.clear}
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".doc,.docx"
          onChange={handleFileUpload}
          className="hidden"
        />
      </div>

      {/* Content area */}
      <div className="min-h-[200px] relative">
        {/* Drag overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-20 bg-[#F9F9F7]/95 border-2 border-dashed border-[#111111] flex flex-col items-center justify-center gap-3 pointer-events-none">
            <div className="w-12 h-12 border-2 border-[#111111] flex items-center justify-center">
              <Upload className="w-6 h-6 text-[#111111]" />
            </div>
            <p className="text-sm font-medium text-[#111111] uppercase tracking-wider">{t.textInput.dragging}</p>
          </div>
        )}

        {hasEntities ? (
          /* Detected entities view */
          <div
            ref={containerRef}
            onMouseUp={handleSelectionEnd}
            className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground select-text cursor-text font-light"
          >
            {wordSpans.map((span, i) => {
              if (/^\s+$/.test(span.text)) {
                return <span key={i} data-start={span.start} data-end={span.end}>{span.text}</span>;
              }
              if (span.entity) {
                const entityIndex = entities.findIndex(
                  (e) => e.start === span.entity!.start && e.end === span.entity!.end
                );
                return (
                  <mark
                    key={i}
                    data-start={span.start}
                    data-end={span.end}
                    className="entity-highlight-animate"
                    onClick={(e) => {
                      if (onRemoveEntity && entityIndex !== -1) {
                        e.stopPropagation();
                        onRemoveEntity(entityIndex);
                      }
                    }}
                    title="Click to remove"
                    style={{
                      backgroundColor: ENTITY_COLORS[span.entity.type] + '30',
                      borderBottom: `2px solid ${ENTITY_COLORS[span.entity.type]}`,
                      color: ENTITY_COLORS[span.entity.type],
                      padding: '1px 3px',
                      cursor: 'pointer',
                    }}
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
        ) : docxFileName ? (
          /* Loaded docx file — read-only text preview */
          <div className="p-4 text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground font-light overflow-auto max-h-[60vh]">
            {/* File loaded banner */}
            <div className="flex items-center gap-3 mb-4 px-3 py-2.5 bg-[#111111]/5 border border-[#E5E5E0]">
              <div className="w-8 h-8 bg-[#111111] flex items-center justify-center flex-shrink-0">
                <FileText className="w-4 h-4 text-[#F9F9F7]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[#111111] truncate">{docxFileName}</p>
                <p className="text-[10px] text-muted-foreground">{t.textInput.wordCount(wordCount)}</p>
              </div>
              <button
                onClick={onRemoveDocx}
                className="text-muted-foreground hover:text-[#CC0000] transition-colors cursor-pointer flex-shrink-0"
                title={t.textInput.removeFile}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {value}
          </div>
        ) : (
          /* Editable text area — same element whether empty or not */
          <div className="flex flex-col">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={t.textInput.placeholder}
              className={`w-full bg-transparent p-4 text-foreground placeholder-muted-foreground resize-none focus:outline-none text-sm leading-relaxed font-light ${showEmptyState ? 'min-h-[140px]' : 'min-h-[200px]'}`}
              style={{ fieldSizing: 'content' } as React.CSSProperties}
            />
            {/* Upload section — only visible when empty */}
            {showEmptyState && onLoadDocx && (
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
          {value && !hasEntities && (
            <p className="label-meta text-[#2D6A4F]/70">{t.textInput.readyToRedact}</p>
          )}
          {hasEntities && (
            <p className="label-meta text-muted-foreground/60">{t.textInput.selectToTag}</p>
          )}
        </div>
      </div>

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
