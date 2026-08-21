import { useState } from 'react';
import { Plus, X, BookMarked } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import type { DictionaryEntry } from '../dictionary.ts';

interface DictionaryBarProps {
  dictionary: DictionaryEntry[];
  onChange: (entries: DictionaryEntry[]) => void;
}

// Always-visible strip attached under the document panels: the dictionary is
// a detection input, so it lives with the documents, on the way to the Redact
// button - not in a collapsed section below the results.
export function DictionaryBar({ dictionary, onChange }: DictionaryBarProps) {
  const { t } = useTranslation();
  const [word, setWord] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  const addWord = () => {
    const trimmed = word.trim();
    if (!trimmed) return;
    const duplicate = dictionary.some((e) =>
      e.caseSensitive === caseSensitive &&
      (caseSensitive ? e.word === trimmed : e.word.toLowerCase() === trimmed.toLowerCase()),
    );
    if (!duplicate) {
      onChange([...dictionary, { word: trimmed, caseSensitive }]);
    }
    setWord('');
  };

  const removeWord = (index: number) => {
    onChange(dictionary.filter((_, i) => i !== index));
  };

  return (
    <div className="border border-t-0 border-[#C8C5BC] bg-[#F4F3EE] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 shrink-0">
          <BookMarked className="w-3.5 h-3.5 text-[#111111]" strokeWidth={1.5} />
          <span className="label-meta text-[#111111]">{t.dictionary.title}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addWord(); }}
            placeholder={t.dictionary.placeholder}
            aria-label={t.dictionary.title}
            className="w-44 text-xs px-2 py-1.5 border-b-2 border-[#111111] bg-transparent text-[#111111] font-mono placeholder:text-muted-foreground focus:outline-none focus:bg-[#FFFFFF]"
            style={{ borderRadius: 0 }}
          />
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <Checkbox
              checked={caseSensitive}
              onCheckedChange={(checked) => setCaseSensitive(checked === true)}
            />
            <span className="text-xs text-[#111111] whitespace-nowrap">{t.dictionary.caseSensitive}</span>
          </label>
          <button
            onClick={addWord}
            disabled={!word.trim()}
            className="pressable text-xs px-3 py-1.5 bg-[#111111] text-[#F9F9F7] hover:bg-[#F9F9F7] hover:text-[#111111] border border-[#111111] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer font-medium flex items-center gap-1.5"
          >
            <Plus className="w-3 h-3" />
            {t.dictionary.add}
          </button>
        </div>
        {dictionary.map((entry, index) => (
          <span
            key={`${entry.word}-${entry.caseSensitive}`}
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-[#111111] text-[#F9F9F7] font-mono"
          >
            {entry.word}
            {entry.caseSensitive && (
              <span
                className="text-[9px] px-1 py-px border border-[#F9F9F7]/40 text-[#F9F9F7]/80 leading-none"
                title={t.dictionary.matchesCase}
                aria-label={t.dictionary.matchesCase}
              >
                Aa
              </span>
            )}
            <button
              onClick={() => removeWord(index)}
              className="text-[#F9F9F7]/60 hover:text-[#FF3333] transition-colors cursor-pointer"
              aria-label={`${t.dictionary.removeWord}: ${entry.word}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground mt-2">{t.dictionary.description}</p>
    </div>
  );
}
