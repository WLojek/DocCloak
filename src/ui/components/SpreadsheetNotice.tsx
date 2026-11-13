/**
 * What was checked in a workbook and what was not (T265). Shown as soon as
 * the file is read, before any download: two groups in plain sentences, the
 * "not checked" one with a warning mark, because the one thing a user of a
 * staff list must know is that amounts stay as they are.
 */
import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Info } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import type { XlsxInfo } from '../hooks/useAnonymizer.ts';

export function SpreadsheetNotice({ info }: { info: XlsxInfo }) {
  const { t } = useTranslation();
  const [cellsOpen, setCellsOpen] = useState(false);
  return (
    <section
      aria-label={t.xlsx.title}
      data-testid="spreadsheet-notice"
      className="animate-content-reveal mb-4 border border-[#111111] bg-[#F4F3EE] px-4 py-3.5"
    >
      <p className="text-sm text-[#111111] font-semibold">{t.xlsx.title}</p>
      <ul className="mt-2 space-y-2 text-xs text-[#111111] leading-relaxed max-w-[90ch]">
        <li className="flex items-start gap-2.5">
          <Check className="w-3.5 h-3.5 text-[#2D6A4F] shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            {t.xlsx.checked(info.dateCells, info.identifierCells)}{' '}
            <span className="text-[#525252]">{t.xlsx.sheetNames}</span>
          </span>
        </li>
        {info.otherNumberCells > 0 && (
          <li className="flex items-start gap-2.5" data-testid="spreadsheet-not-checked">
            <AlertTriangle className="w-3.5 h-3.5 text-[#8A6508] shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <span className="font-medium">{t.xlsx.notChecked(info.otherNumberCells)}</span>{' '}
              {/* Which cells: they are not in the text below, so this is the only place to see them
                  before the file is opened somewhere else. */}
              {info.unchecked.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCellsOpen((open) => !open)}
                  aria-expanded={cellsOpen}
                  data-testid="spreadsheet-cells-toggle"
                  className="inline-flex items-center gap-1 min-h-11 md:min-h-6 underline underline-offset-2 cursor-pointer"
                >
                  {t.xlsx.showCells}
                  <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${cellsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              )}
              {cellsOpen && (
                <ul className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0.5 tabular-nums" data-testid="spreadsheet-cells">
                  {info.unchecked.map((cell, i) => (
                    <li key={i} className="[overflow-wrap:anywhere]">
                      <span className="text-[#525252]">{cell.sheet}{cell.cell ? `!${cell.cell}` : ''}:</span> {cell.value}
                    </li>
                  ))}
                  {info.otherNumberCells > info.unchecked.length && (
                    <li className="text-[#525252]">{t.deAnonymize.andMore(info.otherNumberCells - info.unchecked.length)}</li>
                  )}
                </ul>
              )}
            </div>
          </li>
        )}
        <li className="flex items-start gap-2.5">
          <Info className="w-3.5 h-3.5 text-[#525252] shrink-0 mt-0.5" aria-hidden="true" />
          <span>{t.xlsx.formulasNote}</span>
        </li>
        {info.renamedSheets.length > 0 && (
          <li className="flex items-start gap-2.5" data-testid="spreadsheet-renamed">
            <Info className="w-3.5 h-3.5 text-[#525252] shrink-0 mt-0.5" aria-hidden="true" />
            <span>{t.xlsx.sheetsRenamed(info.renamedSheets.join(', '), info.renamedSheets.length)}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
