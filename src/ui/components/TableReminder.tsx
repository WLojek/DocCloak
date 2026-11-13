/**
 * Reminder to save the replacement table (T261). Shown once the protected
 * result left the page (download or copy) while its table exists only in
 * this tab: closing the tab would lose the only way back to the names. It
 * says what is at stake and offers the three ways on: save the table, say
 * it is not needed for this document, or never be reminded again.
 */
import { useEffect, useRef } from 'react';
import { Download, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '../../i18n/LanguageContext.tsx';

interface TableReminderProps {
  onSave: () => void;
  /** Close it for this document, or for good. */
  onDismiss: (forever: boolean) => void;
}

export function TableReminder({ onSave, onDismiss }: TableReminderProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLElement>(null);
  // It appears under the file bar. On a phone that can be below the fold or under the sticky
  // Redact bar (measured: title and two of three buttons out of reach), so it is brought into
  // view when it is not; the scroll margins keep it clear of the header and of that bar.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const bottomBar = window.innerWidth < 768 ? 176 : 112;
    if (box.top < 64 || box.bottom > window.innerHeight - bottomBar) {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, []);
  return (
    <section
      ref={ref}
      aria-label={t.tableReminder.title}
      role="status"
      data-testid="table-reminder"
      className="animate-content-reveal border border-[#C8C5BC] bg-[#F6EFD9] px-4 py-3.5 scroll-mt-20 scroll-mb-48 md:scroll-mb-32"
    >
      <div className="flex items-start gap-3">
        <Info className="w-4 h-4 text-[#8A6508] shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm text-[#111111] font-semibold">{t.tableReminder.title}</p>
          <p className="text-xs text-[#111111] mt-1 leading-relaxed max-w-[80ch]">{t.tableReminder.body}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-3">
            <Button variant="solid" className="gap-2 h-11 md:h-8 text-xs" onClick={onSave} data-testid="table-reminder-save">
              <Download className="w-3 h-3" />
              {t.textOutput.saveTable}
            </Button>
            <Button variant="outline" className="h-11 md:h-8 text-xs" onClick={() => onDismiss(false)} data-testid="table-reminder-dismiss">
              {t.tableReminder.dismiss}
            </Button>
            <button
              type="button"
              onClick={() => onDismiss(true)}
              data-testid="table-reminder-never"
              className="inline-flex items-center min-h-11 md:min-h-8 px-2 text-xs text-[#111111] underline underline-offset-2 cursor-pointer"
            >
              {t.tableReminder.never}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
