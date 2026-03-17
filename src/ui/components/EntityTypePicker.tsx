import type { EntityType } from '../../core/types.ts';
import { ENTITY_COLORS } from '../../core/types.ts';
import { Card } from '@/components/ui/card';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

const ENTITY_TYPES: EntityType[] = [
  'PERSON', 'EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD',
  'DATE', 'CURRENCY', 'IP_ADDRESS', 'IBAN', 'ADDRESS', 'COMPANY', 'OTHER',
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
        className="fixed z-[61] py-1 w-52 shadow-[4px_4px_0px_0px_#111111] max-h-[70vh] overflow-auto"
        style={{ left, top }}
      >
        <div className="px-3 py-2.5 border-b border-[#E5E5E0]">
          <p className="label-meta text-muted-foreground">{t.entityTable.markAs}</p>
          <p className="text-sm font-medium text-foreground truncate mt-0.5">{word}</p>
        </div>
        {ENTITY_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => onSelect(type)}
            className="w-full text-left px-3 py-2 text-sm hover:bg-[#E5E5E0] transition-colors flex items-center gap-2.5 cursor-pointer"
          >
            <div
              className="w-2 h-2  shrink-0"
              style={{ backgroundColor: ENTITY_COLORS[type] }}
            />
            <span className="text-foreground/80">{t.entityLabels[type]}</span>
          </button>
        ))}
      </Card>
    </>
  );
}
