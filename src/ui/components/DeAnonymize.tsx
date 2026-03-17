import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw, Copy, Check } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { useToast } from './Toast.tsx';

interface DeAnonymizeProps {
  onDeanonymize: (text: string) => string;
  hasMapping: boolean;
}

export function DeAnonymize({ onDeanonymize, hasMapping }: DeAnonymizeProps) {
  const { t } = useTranslation();
  const [aiResponse, setAiResponse] = useState('');
  const [result, setResult] = useState('');
  const [copied, setCopied] = useState(false);

  const { showToast } = useToast();

  if (!hasMapping) return null;

  const handleDeanonymize = () => {
    if (!aiResponse.trim()) return;
    setResult(onDeanonymize(aiResponse));
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    setCopied(true);
    showToast(t.toast.copiedToClipboard);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-2 border-[#111111]">
      <div className="flex flex-col border-r-2 border-[#111111]">
        <div className="flex items-center justify-center h-11 bg-[#111111] px-3">
          <label className="label-meta text-[#F9F9F7] tracking-[0.15em]">{t.deAnonymize.pasteLabel}</label>
        </div>
        <div className="min-h-[200px]">
          <textarea
            value={aiResponse}
            onChange={(e) => setAiResponse(e.target.value)}
            placeholder={t.deAnonymize.inputPlaceholder}
            className="w-full bg-transparent p-4 text-foreground placeholder-muted-foreground resize-none focus:outline-none text-sm leading-relaxed font-light min-h-[200px]"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
        </div>
        <div className="border-t border-[#E5E5E0] px-4 py-2 bg-[#F5F5F3]">
          <Button
            onClick={handleDeanonymize}
            disabled={!aiResponse.trim()}
            variant="outline"
            className="gap-2 h-8 text-xs uppercase tracking-wider"
          >
            <RotateCcw className="w-3 h-3" />
            {t.deAnonymize.restoreButton}
          </Button>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="flex items-center justify-center h-11 relative bg-[#111111] px-3">
          <label className="label-meta text-[#F9F9F7] tracking-[0.15em]">{t.deAnonymize.restoredLabel}</label>
          {result && (
            <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5 h-7 absolute right-2 text-[#F9F9F7] hover:bg-[#F9F9F7]/10 hover:text-[#F9F9F7]">
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? t.deAnonymize.copied : t.deAnonymize.copy}
            </Button>
          )}
        </div>
        <div className="flex-1 min-h-[200px] p-4 text-foreground text-sm leading-relaxed whitespace-pre-wrap font-light">
          {result || (
            <span className="text-muted-foreground">
              {t.deAnonymize.outputPlaceholder}
            </span>
          )}
        </div>
        <div className="mt-auto border-t border-[#E5E5E0] px-4 py-2 bg-[#F5F5F3]">
          <p className="label-meta text-muted-foreground">&nbsp;</p>
        </div>
      </div>
    </div>
  );
}
