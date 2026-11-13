import { useState, useMemo } from 'react';
import { ENTITY_COLORS } from '@doccloak/core';
import type { ReplacementEntry } from '@doccloak/core';
import { Button } from '@/components/ui/button';
import { Copy, Check, Info, Shield, X } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import type { TextRange } from '../keptRanges.ts';
import { useToast } from './Toast.tsx';

interface TextOutputProps {
  value: string;
  entries: ReplacementEntry[];
  /** Places in the text where a value was replaced (the redacted rows of the list). */
  replacedPlaces: number;
  loading?: boolean;
  /** The protected text was copied: it is leaving the page (T261). */
  onCopied?: () => void;
  /** Every place found in the text, redacted or not. */
  foundPlaces?: number;
  /** Jump to the list of detections; `kept` asks for the places that are not redacted. */
  onReviewList?: (kept: boolean) => void;
  /** Why the readable places are readable, when there is one reason for all of them (a type setting). */
  keptReason?: string;
  /** Number cells of a workbook that were not checked and stay readable in the export (not in this text). */
  uncheckedCells?: number;
  /** Where the places that are found but not redacted stand in `value` (sorted, not overlapping). */
  keptRanges?: TextRange[];
  /** A file is loaded: "nothing was detected" is said next to the file, not here. */
  fileLoaded?: boolean;
  /** Places that were redacted before the last run of this text and are not found by it: readable now. */
  droppedCount?: number;
  onKeepDropped?: () => void;
  onDismissDropped?: () => void;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function TextOutput({ value, entries, replacedPlaces, loading, onCopied, foundPlaces = replacedPlaces, onReviewList, keptReason, uncheckedCells = 0, keptRanges, fileLoaded = false, droppedCount = 0, onKeepDropped, onDismissDropped }: TextOutputProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const labelColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      map.set(entry.replacement, ENTITY_COLORS[entry.entityType] ?? '#B6A596');
    }
    return map;
  }, [entries]);

  // Highlight the session's actual replacement tokens, whatever their format
  // (typed [PERSON_1], legacy <<REDACTED_1>>, or user-renamed labels). Longer
  // tokens first so [PERSON_10] is not shadowed by [PERSON_1].
  const tokenRe = useMemo(() => {
    if (entries.length === 0) return null;
    const tokens = [...new Set(entries.map((e) => e.replacement))]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp);
    return new RegExp(tokens.join('|'), 'g');
  }, [entries]);

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    onCopied?.();
    setCopied(true);
    // What leaves with the copy is said at the moment it leaves.
    showToast(foundPlaces > replacedPlaces ? t.textOutput.copiedKept(foundPlaces - replacedPlaces) : t.toast.copiedToClipboard);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderHighlighted = () => {
    if (!value) return null;
    const kept = keptRanges ?? [];
    if (!tokenRe && kept.length === 0) return value;
    const segments: Array<{ text: string; color?: string; markIndex?: number; kept?: boolean }> = [];
    let lastIndex = 0;
    let markCount = 0;
    let match: RegExpExecArray | null;
    // Text between two labels: the places that are found but not redacted are cut out of it and
    // marked, so what stays readable is seen where it stands (it used to look like any other text).
    let nextKept = 0;
    const pushPlain = (from: number, to: number) => {
      let at = from;
      while (nextKept < kept.length && kept[nextKept].end <= at) nextKept++;
      while (nextKept < kept.length && kept[nextKept].start < to) {
        const start = Math.max(kept[nextKept].start, at);
        const end = Math.min(kept[nextKept].end, to);
        if (start > at) segments.push({ text: value.slice(at, start) });
        if (end > start) segments.push({ text: value.slice(start, end), kept: true });
        at = end;
        if (kept[nextKept].end > to) break;
        nextKept++;
      }
      if (at < to) segments.push({ text: value.slice(at, to) });
    };
    if (tokenRe) {
      tokenRe.lastIndex = 0;
      while ((match = tokenRe.exec(value)) !== null) {
        if (match.index > lastIndex) pushPlain(lastIndex, match.index);
        const color = labelColorMap.get(match[0]) ?? '#B6A596';
        segments.push({ text: match[0], color, markIndex: markCount++ });
        lastIndex = match.index + match[0].length;
      }
    }
    if (lastIndex < value.length) pushPlain(lastIndex, value.length);

    return segments.map((seg, i) =>
      seg.kept ? (
        <mark
          key={i}
          data-kept="true"
          title={t.entityTable.keptChip}
          style={{ backgroundColor: 'transparent', color: 'inherit', borderBottom: '2px dashed #8A6508' }}
        >
          {seg.text}
        </mark>
      ) : seg.color ? (
        <mark
          key={i}
          className="entity-highlight-animate"
          style={{
            // Same tinted-block language as the input marks. The type's colour is carried by the tint
            // and the underline; the label itself is dark (the coloured word measured 3.45 to 4.35:1).
            backgroundColor: seg.color + '30',
            borderBottom: `2px solid ${seg.color}`,
            color: '#111111',
            padding: '1px 3px',
            fontWeight: 500,
            '--mark-color': seg.color + '70',
            // Stamped in sequence; the stagger caps so long documents finish fast.
            animationDelay: `${Math.min(seg.markIndex ?? 0, 15) * 40}ms`,
            animationFillMode: 'backwards',
          } as React.CSSProperties}
        >
          {seg.text}
        </mark>
      ) : (
        <span key={i}>{seg.text}</span>
      )
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between h-11 relative border-b border-[#C8C5BC] px-4 bg-[#F4F3EE]">
        <h3 className="font-serif text-sm text-[#111111] font-medium">
          {t.textOutput.title}
        </h3>
        {value && (
          <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5 h-11 md:h-7 -mr-2 md:mr-0 text-[#525252] hover:bg-[#E5E5E0] hover:text-[#111111]">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? t.textOutput.copied : t.textOutput.copy}
          </Button>
        )}
      </div>
      {/* What leaves the page with this text, said where the text is taken (Copy above, Download in
          the file bar), with the way to the list. Before, the only word here was an unconditional
          "safe to share" under the text, also when places had been left readable. */}
      {value && !loading && foundPlaces > 0 && (
        <div
          role="status"
          data-testid="result-review"
          data-kept={foundPlaces - replacedPlaces}
          className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-[#E5E5E0] text-xs leading-relaxed ${
            foundPlaces > replacedPlaces ? 'bg-[#F6EFD9] text-[#111111] font-medium' : 'bg-[#F5F5F3] text-[#525252]'
          }`}
        >
          <span>
            {foundPlaces > replacedPlaces
              ? t.textOutput.reviewKept(foundPlaces, replacedPlaces, foundPlaces - replacedPlaces)
              : t.textOutput.reviewAll(foundPlaces)}
            {foundPlaces > replacedPlaces && keptReason ? ` ${keptReason}` : ''}
          </span>
          {onReviewList && (
            <button
              type="button"
              onClick={() => onReviewList(foundPlaces > replacedPlaces)}
              className="inline-flex items-center min-h-11 md:min-h-0 text-[#111111] font-medium underline underline-offset-2 cursor-pointer"
            >
              {foundPlaces > replacedPlaces ? t.textOutput.showKeptLink : t.textOutput.reviewLink}
            </button>
          )}
        </div>
      )}
      {/* A re-run that found less (lower sensitivity, another model): what it no longer finds is
          readable now. It stays here until it is answered; the line above cannot know about it. */}
      {value && !loading && droppedCount > 0 && (
        <div role="status" data-testid="result-dropped" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-b border-[#E5E5E0] bg-[#F6EFD9] text-xs text-[#111111] font-medium leading-relaxed">
          <span className="min-w-[60%] flex-1">{t.entityTable.droppedToast(droppedCount)}</span>
          {onKeepDropped && (
            <button
              type="button"
              onClick={onKeepDropped}
              data-testid="result-dropped-keep"
              className="pressable inline-flex items-center min-h-11 md:min-h-8 px-3 border border-[#111111] bg-white text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] transition-colors cursor-pointer"
            >
              {t.entityTable.keepRedacted}
            </button>
          )}
          {onDismissDropped && (
            <button
              type="button"
              onClick={onDismissDropped}
              aria-label={t.toast.dismiss}
              data-testid="result-dropped-dismiss"
              className="inline-flex items-center justify-center w-11 h-11 md:w-8 md:h-8 text-[#525252] hover:text-[#111111] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {/* A workbook: the number cells that were not checked are not in this text at all, so the
          line above cannot speak for the file. Said here, where the text is taken. */}
      {value && !loading && uncheckedCells > 0 && (
        <p role="status" data-testid="result-unchecked" className="px-4 py-2 border-b border-[#E5E5E0] bg-[#F6EFD9] text-xs text-[#111111] font-medium leading-relaxed">
          {t.xlsx.resultWarning(uncheckedCells)}
        </p>
      )}
      <div className="flex-1 min-h-[200px] p-4 text-foreground text-sm leading-relaxed whitespace-pre-wrap break-words min-w-0">
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton-line h-3 w-full" />
            <div className="skeleton-line h-3 w-[90%]" />
            <div className="skeleton-line h-3 w-[75%]" />
            <div className="skeleton-line h-3 w-[85%]" />
            <div className="skeleton-line h-3 w-[60%]" />
          </div>
        ) : value ? (
          /* Keyed by value so each new redaction replays the reveal */
          <div key={value} className="animate-content-reveal" onCopy={() => onCopied?.()}>
            {renderHighlighted()}
            {/* Post-redaction hint */}
            {/* Not part of the text: a selection made by hand must not take it along. */}
            <div className={`select-none ${(foundPlaces > replacedPlaces || uncheckedCells === 0) && !(foundPlaces === 0 && fileLoaded) ? 'mt-6 pt-4 border-t border-[#E5E5E0]' : 'hidden'}`}>
              {foundPlaces === 0 ? (
                // Nothing was found: that is not "everything is replaced", and no proof that the text is clean.
                <p className="text-xs text-[#111111] leading-relaxed flex items-start gap-1.5" data-testid="result-nothing-found">
                  <Info className="w-3 h-3 shrink-0 mt-0.5 text-[#525252]" aria-hidden="true" />
                  {t.textOutput.noDetectionsText}
                </p>
              ) : foundPlaces > replacedPlaces ? (
                <p className="text-xs text-[#111111] font-medium leading-relaxed" data-testid="result-kept-hint">
                  {t.textOutput.keptHint(foundPlaces - replacedPlaces)}
                </p>
              ) : uncheckedCells > 0 || droppedCount > 0 ? null : (
                <p className="text-xs text-[#2D6A4F] flex items-start gap-1.5 leading-relaxed" data-testid="result-all-replaced-hint">
                  <Shield className="w-3 h-3 shrink-0 mt-0.5" />
                  {t.textOutput.nextStepHint}
                </p>
              )}
            </div>
          </div>
        ) : (
          /* Empty state: numbered guide */
          <div className="flex flex-col items-center justify-center h-full min-h-[160px] text-center px-4">
            <div className="w-10 h-10 bg-[#F4F3EE] border border-[#C8C5BC] flex items-center justify-center mb-4">
              <Shield className="w-5 h-5 text-[#525252]" />
            </div>
            <p className="text-sm text-[#111111] font-medium mb-4 font-serif">{t.textOutput.emptyStateHint}</p>
            <div className="space-y-2 text-left w-full max-w-[220px]">
              {[t.textOutput.emptyStateStep1, t.textOutput.emptyStateStep2, t.textOutput.emptyStateStep3].map((step, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="w-4 h-4 bg-[#111111] text-[#F9F9F7] flex items-center justify-center flex-shrink-0 text-[9px] font-bold mt-0.5">{i + 1}</span>
                  <p className="text-xs text-[#525252] leading-relaxed">{step}</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-[#525252] leading-relaxed mt-4 max-w-[260px]">{t.textOutput.emptyStateTip}</p>
          </div>
        )}
      </div>
      <div className="mt-auto border-t border-[#E5E5E0] px-4 py-2 bg-[#F5F5F3]">
        {/* What was replaced, in its own words: different values and places. The list below counts
            every place found, redacted or not, so the two numbers must not share a name. */}
        <p className="text-xs text-[#525252] font-medium tabular-nums" data-testid="replaced-summary">
          {value && entries.length > 0 ? t.textOutput.replacedSummary(entries.length, replacedPlaces) : ' '}
        </p>
      </div>
    </div>
  );
}
