import { useEffect, useRef } from 'react';
import type { EntityType } from '@doccloak/core';
import { ENTITY_COLORS } from '@doccloak/core';
import { Card } from '@/components/ui/card';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

// Everyday types first, the long tail behind a divider.
const COMMON_TYPES: EntityType[] = ['PERSON', 'EMAIL', 'PHONE', 'ADDRESS'];
const OTHER_TYPES: EntityType[] = [
  'COMPANY', 'DATE', 'SSN', 'CREDIT_CARD', 'CURRENCY', 'IP_ADDRESS', 'IBAN', 'OTHER',
];

interface EntityTypePickerProps {
  word: string;
  x: number;
  y: number;
  onSelect: (type: EntityType) => void;
  onClose: () => void;
}

export function EntityTypePicker({ word, x, y, onSelect, onClose }: EntityTypePickerProps) {
  const { t } = useTranslation();
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  // Escape closes; initial focus lands on the first option so keyboard users
  // can arrow/tab through the list.
  useEffect(() => {
    firstOptionRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickerHeight = 460; // approximate height of the full picker
  const pickerWidth = 220;
  const margin = 8;
  const fitsBelow = y + pickerHeight + margin < window.innerHeight;
  const left = Math.min(x, window.innerWidth - pickerWidth - margin);
  const top = fitsBelow ? y : Math.max(margin, y - pickerHeight);

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <Card
        role="dialog"
        aria-label={`${t.entityTable.markAs}: ${word}`}
        className="fixed z-[61] py-1 w-52 shadow-[4px_4px_0px_0px_#111111] max-h-[70vh] overflow-auto animate-picker-in"
        style={{ left, top, transformOrigin: fitsBelow ? 'top left' : 'bottom left' }}
      >
        <div className="px-3 py-2.5 border-b border-[#E5E5E0]">
          <p className="label-meta text-muted-foreground">{t.entityTable.markAs}</p>
          <p className="text-sm font-medium text-foreground truncate mt-0.5">{word}</p>
        </div>
        {COMMON_TYPES.map((type, i) => (
          <button
            key={type}
            ref={i === 0 ? firstOptionRef : undefined}
            onClick={() => onSelect(type)}
            className="w-full text-left px-3 py-2 text-sm hover:bg-[#E5E5E0] focus:bg-[#E5E5E0] focus:outline-none transition-colors flex items-center gap-2.5 cursor-pointer"
          >
            <div
              className="w-2 h-2 shrink-0"
              style={{ backgroundColor: ENTITY_COLORS[type] }}
            />
            <span className="text-foreground/80">{t.entityLabels[type]}</span>
          </button>
        ))}
        <div className="border-t border-[#E5E5E0] my-1" />
        {OTHER_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className="w-full text-left px-3 py-2 text-sm hover:bg-[#E5E5E0] focus:bg-[#E5E5E0] focus:outline-none transition-colors flex items-center gap-2.5 cursor-pointer"
          >
            <div
              className="w-2 h-2 shrink-0"
              style={{ backgroundColor: ENTITY_COLORS[type] }}
            />
            <span className="text-foreground/80">{t.entityLabels[type]}</span>
          </button>
        ))}
      </Card>
    </>
  );
}
