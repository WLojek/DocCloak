import { useRef, useCallback, useState } from 'react';
import type { DetectedEntity, EntityType } from '../../core/types.ts';
import { ENTITY_COLORS } from '../../core/types.ts';
import { EntityTypePicker } from './EntityTypePicker.tsx';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

interface TextInputProps {
  value: string;
  onChange: (text: string) => void;
  onClear: () => void;
  entities: DetectedEntity[];
  onAddEntity?: (start: number, end: number, type: EntityType) => void;
  onRemoveEntity?: (index: number) => void;
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

export function TextInput({ value, onChange, onClear, entities, onAddEntity, onRemoveEntity }: TextInputProps) {
  const { t } = useTranslation();
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [picker, setPicker] = useState<{ word: string; start: number; end: number; x: number; y: number } | null>(null);
  const hasEntities = entities.length > 0;

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

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-center h-11 relative border-b-2 border-[#111111] bg-[#111111] px-3">
        <h3 className="label-meta text-[#F9F9F7] tracking-[0.15em]">
          {t.textInput.title}
        </h3>
        {value && (
          <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5 h-7 absolute right-2 text-[#F9F9F7] hover:bg-[#F9F9F7]/10 hover:text-[#F9F9F7]">
            <X className="w-3 h-3" />
            {t.textInput.clear}
          </Button>
        )}
      </div>
      <div className="min-h-[200px] relative">
        {hasEntities ? (
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
        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t.textInput.placeholder}
            className="w-full bg-transparent p-4 text-foreground placeholder-muted-foreground resize-none focus:outline-none text-sm leading-relaxed font-light min-h-[200px]"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
        )}
      </div>
      <div className="border-t border-[#E5E5E0] px-4 py-2 bg-[#F5F5F3] flex items-center justify-between">
        <p className="label-meta text-muted-foreground">
          {value ? t.textInput.wordCount(wordCount) : '\u00A0'}
        </p>
        {hasEntities && (
          <p className="label-meta text-muted-foreground/60">{t.textInput.selectToTag}</p>
        )}
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
