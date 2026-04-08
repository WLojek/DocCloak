import { useState, useMemo } from 'react';
import { ENTITY_COLORS } from '../../core/types.ts';
import type { ReplacementEntry } from '../../core/types.ts';
import { Button } from '@/components/ui/button';
import { Copy, Check, Shield } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { useToast } from './Toast.tsx';

interface TextOutputProps {
  value: string;
  entries: ReplacementEntry[];
  loading?: boolean;
}

const CUSTOM_PLACEHOLDER_RE = /<<[^<>]+>>/g;

export function TextOutput({ value, entries, loading }: TextOutputProps) {
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

  const handleCopy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    showToast(t.toast.copiedToClipboard);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderHighlighted = () => {
    if (!value) return null;
    const segments: Array<{ text: string; color?: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    CUSTOM_PLACEHOLDER_RE.lastIndex = 0;

    while ((match = CUSTOM_PLACEHOLDER_RE.exec(value)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ text: value.slice(lastIndex, match.index) });
      }
      const color = labelColorMap.get(match[0]) ?? '#B6A596';
      segments.push({ text: match[0], color });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < value.length) {
      segments.push({ text: value.slice(lastIndex) });
    }

    return segments.map((seg, i) =>
      seg.color ? (
        <mark
          key={i}
          style={{
            backgroundColor: seg.color + '30',
            borderBottom: `2px solid ${seg.color}`,
            color: seg.color,
            padding: '1px 3px',
            fontWeight: 500,
          }}
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
      <div className="flex items-center justify-center h-11 relative border-b-2 border-[#111111] bg-[#111111] px-3">
        <h3 className="label-meta text-[#F9F9F7] tracking-[0.15em]">
          {t.textOutput.title}
        </h3>
        {value && (
          <div className="absolute right-2 flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5 h-7 text-[#F9F9F7] hover:bg-[#F9F9F7]/10 hover:text-[#F9F9F7]">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? t.textOutput.copied : t.textOutput.copy}
            </Button>
          </div>
        )}
      </div>
      <div className="flex-1 min-h-[200px] p-4 text-foreground text-sm leading-relaxed whitespace-pre-wrap font-light">
        {loading ? (
          <div className="space-y-3">
            <div className="skeleton-line h-3 w-full" />
            <div className="skeleton-line h-3 w-[90%]" />
            <div className="skeleton-line h-3 w-[75%]" />
            <div className="skeleton-line h-3 w-[85%]" />
            <div className="skeleton-line h-3 w-[60%]" />
          </div>
        ) : value ? (
          <>
            {renderHighlighted()}
            {/* Post-redaction hint */}
            <div className="mt-6 pt-4 border-t border-[#E5E5E0]">
              <p className="text-[10px] text-[#2D6A4F]/70 flex items-center gap-1.5">
                <Shield className="w-3 h-3" />
                {t.textOutput.nextStepHint}
              </p>
            </div>
          </>
        ) : (
          /* Empty state: numbered guide */
          <div className="flex flex-col items-center justify-center h-full min-h-[160px] text-center px-4">
            <div className="w-10 h-10 bg-[#E5E5E0]/50 flex items-center justify-center mb-4">
              <Shield className="w-5 h-5 text-muted-foreground/40" />
            </div>
            <p className="text-xs text-muted-foreground font-medium mb-4">{t.textOutput.emptyStateHint}</p>
            <div className="space-y-2 text-left w-full max-w-[200px]">
              {[t.textOutput.emptyStateStep1, t.textOutput.emptyStateStep2, t.textOutput.emptyStateStep3].map((step, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="w-4 h-4 bg-[#E5E5E0] text-muted-foreground flex items-center justify-center flex-shrink-0 text-[9px] font-bold mt-0.5">{i + 1}</span>
                  <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{step}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60 leading-relaxed mt-4 max-w-[220px] italic">{t.textOutput.emptyStateTip}</p>
          </div>
        )}
      </div>
      {/* Footer spacer */}
      <div className="mt-auto border-t border-[#E5E5E0] px-4 py-2 bg-[#F5F5F3]">
        <p className="label-meta text-muted-foreground">&nbsp;</p>
      </div>
    </div>
  );
}
