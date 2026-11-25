import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EntityType } from '@doccloak/core';
import { ENTITY_COLORS } from '@doccloak/core';
import { Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

// Everyday types first, the long tail behind a divider.
const COMMON_TYPES: EntityType[] = ['PERSON', 'EMAIL', 'PHONE', 'ADDRESS'];
const OTHER_TYPES: EntityType[] = [
  'COMPANY', 'DATE', 'SSN', 'CREDIT_CARD', 'CURRENCY', 'IP_ADDRESS', 'IBAN', 'OTHER',
];

// One choice of the list: 44 px tall under a finger, compact with a mouse.
const OPTION = 'w-full text-left px-3 py-2 min-h-11 md:min-h-0 text-sm hover:bg-[#E5E5E0] focus:bg-[#E5E5E0] focus:outline-none transition-colors flex items-center gap-2.5 cursor-pointer';

interface EntityTypePickerProps {
  word: string;
  x: number;
  y: number;
  /**
   * Where the list ends when it has to open upwards. For a list opened from a control: the top
   * of that control, so the list stands above it instead of over it. The same as `y` when not given.
   */
  yAbove?: number;
  onSelect: (type: EntityType) => void;
  onClose: () => void;
  /** What the list is for, over the word. "Mark as" (a new selection) when not given. */
  heading?: string;
  /** A second line under the word (how far the choice reaches). */
  note?: string;
  /**
   * The type the value has now (WLojek/DocCloak#5): shown as the chosen one, and the focus starts
   * on it. Null when the value is not redacted at all: then the last choice is the chosen one.
   */
  current?: EntityType | null;
  /**
   * One more choice at the end, apart from the types: leave the value readable. `chosen` when that
   * is its state now.
   */
  keep?: { label: string; chosen: boolean; onChoose: () => void };
  /** Gets the focus back when the list closes without a choice (Escape, a click beside it). */
  returnFocus?: HTMLElement | null;
}

export function EntityTypePicker({ word, x, y, yAbove, onSelect, onClose, heading, note, current, keep, returnFocus }: EntityTypePickerProps) {
  const { t } = useTranslation();
  const cardRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  // With a type to show as chosen the options say whether they are it; a new selection has none.
  const choosing = current !== undefined;
  const title = heading ?? t.entityTable.markAs;

  const dismiss = () => {
    onClose();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  };
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  // Escape closes; initial focus lands on the chosen option, or on the first one, so keyboard
  // users can arrow/tab through the list.
  useEffect(() => {
    const chosen = cardRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    (chosen ?? firstOptionRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The arrows walk the choices, and Tab stays among them: the list lies over the page, and a
  // focus that left it went on behind it, with the list still open.
  const onKeys = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Tab') return;
    const options = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button') ?? []);
    if (options.length === 0) return;
    const at = options.indexOf(document.activeElement as HTMLElement);
    const back = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
    // Tab moves by itself; it is only turned around at the two ends.
    if (e.key === 'Tab' && at !== -1 && at !== (back ? 0 : options.length - 1)) return;
    e.preventDefault();
    options[back ? (at <= 0 ? options.length - 1 : at - 1) : (at + 1) % options.length].focus();
  };

  // Placed by its real height once it is laid out: the estimate put the end of a longer list (the
  // extra choice, taller rows on a phone) below the edge of the window.
  const [height, setHeight] = useState(keep ? 510 : 460);
  useLayoutEffect(() => {
    const measured = cardRef.current?.offsetHeight ?? 0;
    if (measured > 0) setHeight(measured);
  }, []);
  const pickerWidth = 220;
  const margin = 8;
  const fitsBelow = y + height + margin < window.innerHeight;
  const left = Math.max(margin, Math.min(x, window.innerWidth - pickerWidth - margin));
  const top = fitsBelow ? y : Math.max(margin, (yAbove ?? y) - height);

  const option = (type: EntityType, first: boolean) => {
    const chosen = choosing && type === current;
    return (
      <button
        key={type}
        type="button"
        ref={first ? firstOptionRef : undefined}
        onClick={() => onSelect(type)}
        aria-pressed={choosing ? chosen : undefined}
        className={OPTION}
      >
        <div
          className="w-2 h-2 shrink-0"
          style={{ backgroundColor: ENTITY_COLORS[type] }}
        />
        {/* A long name (the German one for SSN) breaks instead of pushing the check mark out. */}
        <span className={`min-w-0 [overflow-wrap:anywhere] ${chosen ? 'text-[#111111] font-medium' : 'text-foreground/80'}`}>{t.entityLabels[type]}</span>
        {chosen && <Check className="w-3.5 h-3.5 ml-auto shrink-0 text-[#111111]" aria-hidden="true" />}
      </button>
    );
  };

  return (
    <>
      {/* A right click beside the list closes it, as a click does; inside it the browser's own menu stays away. */}
      <div className="fixed inset-0 z-[60]" onClick={dismiss} onContextMenu={(e) => { e.preventDefault(); dismiss(); }} />
      <Card
        ref={cardRef}
        role="dialog"
        aria-label={`${title}: ${word}`}
        onKeyDown={onKeys}
        onContextMenu={(e) => e.preventDefault()}
        className="fixed z-[61] w-52 flex flex-col shadow-[4px_4px_0px_0px_#111111] max-h-[70vh] animate-picker-in"
        style={{ left, top, transformOrigin: fitsBelow ? 'top left' : 'bottom left' }}
      >
        <div className="shrink-0 px-3 pt-3.5 pb-2.5 border-b border-[#E5E5E0]">
          <p className="label-meta text-muted-foreground">{title}</p>
          <p className="text-sm font-medium text-foreground truncate mt-0.5">{word}</p>
          {note && <p className="text-xs text-[#525252] mt-0.5">{note}</p>}
        </div>
        {/* The types scroll between the heading and the last choice, which both stay in view. */}
        <div className="min-h-0 overflow-auto pb-1">
          {COMMON_TYPES.map((type, i) => option(type, i === 0))}
          <div className="border-t border-[#E5E5E0] my-1" />
          {OTHER_TYPES.map((type) => option(type, false))}
        </div>
        {keep && (
          <div className="shrink-0 border-t border-[#111111] bg-[#F4F3EE]">
            <button
              type="button"
              onClick={keep.onChoose}
              aria-pressed={keep.chosen}
              data-testid="type-picker-keep"
              className={OPTION}
            >
              {/* The sign of a place that stays readable, as in the source text: no tint, a dashed amber line. */}
              <div className="w-2 h-2 shrink-0 border border-dashed border-[#8A6508]" />
              <span className={`min-w-0 [overflow-wrap:anywhere] text-[#111111] ${keep.chosen ? 'font-medium' : ''}`}>{keep.label}</span>
              {keep.chosen && <Check className="w-3.5 h-3.5 ml-auto shrink-0 text-[#111111]" aria-hidden="true" />}
            </button>
          </div>
        )}
      </Card>
    </>
  );
}
