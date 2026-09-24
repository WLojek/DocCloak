/**
 * Informed-consent card for package parts DocCloak cannot redact (T177
 * founder decision, web side). The reader reports them (embedded objects,
 * macros, HTML chunks, external data connections, printer settings); this
 * card names them in plain language and the user decides: Continue keeps
 * them byte-for-byte in the export, Cancel removes the file. Until one of
 * the two is chosen, the host disables Redact and Download for that file.
 */
import { AlertTriangle } from 'lucide-react';
import type { UnredactablePart } from '@doccloak/core/dom';
import { Button } from '@/components/ui/button';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import type { Translations } from '../../i18n/types.ts';

export type UnredactableKind = UnredactablePart['kind'];

/** One item the card lists. `label` is Core's English label, kept for diagnostics only. */
export interface UnredactableItem {
  part: string;
  kind: UnredactableKind;
  label?: string;
}

/** Plain-language label for an item in the current UI language. */
function unredactableLabel(t: Translations, item: UnredactableItem): string {
  if (item.kind === 'unknown') return t.unredactable.kinds.unknown(item.part);
  return t.unredactable.kinds[item.kind] ?? t.unredactable.kinds.unknown(item.part);
}

interface UnredactableNoticeProps {
  items: UnredactableItem[];
  /** Reader warnings (parts skipped because they were not well-formed XML etc.). */
  warnings?: string[];
  /** True once the user chose Continue: the buttons give way to a reminder. */
  decided: boolean;
  onContinue: () => void;
  onCancel: () => void;
}

export function UnredactableNotice({ items, warnings = [], decided, onContinue, onCancel }: UnredactableNoticeProps) {
  const { t } = useTranslation();
  if (items.length === 0 && warnings.length === 0) return null;

  return (
    <section
      aria-label={items.length > 0 ? t.unredactable.title : t.unredactable.warningsTitle}
      className="animate-content-reveal-rise mb-4 border border-[#111111] bg-[#F4F3EE] px-4 py-4"
      data-testid="unredactable-notice"
    >
      {items.length > 0 && (
        <>
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-[#111111] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm text-[#111111] font-semibold">{t.unredactable.title}</p>
              <ul className="mt-2 space-y-1 text-xs text-[#111111]">
                {items.map((item) => (
                  <li key={item.part} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{unredactableLabel(t, item)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground break-all">{item.part}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[#525252] mt-2 leading-relaxed max-w-xl">
                {decided ? t.unredactable.continued : t.unredactable.body}
              </p>
            </div>
          </div>
          {!decided && (
            <div className="mt-3 flex flex-col sm:flex-row gap-2 sm:justify-end">
              <Button onClick={onCancel} variant="outline" size="sm" className="text-xs font-semibold">
                {t.unredactable.cancel}
              </Button>
              <Button onClick={onContinue} variant="solid" size="sm" className="text-xs font-semibold">
                {t.unredactable.continue}
              </Button>
            </div>
          )}
        </>
      )}
      {warnings.length > 0 && (
        <div className={items.length > 0 ? 'mt-3 pt-3 border-t border-[#C8C5BC]' : ''}>
          <p className="label-meta text-muted-foreground">{t.unredactable.warningsTitle}</p>
          <ul className="mt-1 space-y-0.5 text-[11px] text-[#525252] font-mono break-all">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
