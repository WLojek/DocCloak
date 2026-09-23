import { useState } from 'react';
import { Plus, X, BookMarked, ShieldCheck } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import type { DictionaryEntry } from '../dictionary.ts';

interface DictionaryBarProps {
  /**
   * 'dictionary': words that are always redacted (ink chips).
   * 'ignore': words that are never anonymized (outlined chips), so the two
   * strips read as opposites at a glance.
   */
  kind?: 'dictionary' | 'ignore';
  dictionary: DictionaryEntry[];
  onChange: (entries: DictionaryEntry[]) => void;
}

// Always-visible strip attached under the document panels: both lists are
// detection inputs, so they live with the documents, on the way to the Redact
// button - not in a collapsed section below the results.
export function DictionaryBar({ kind = 'dictionary', dictionary, onChange }: DictionaryBarProps) {
  const { t } = useTranslation();
  const [word, setWord] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const isIgnore = kind === 'ignore';
  // The ignore list reuses the dictionary's control labels (add, case
  // toggle, remove); only the title, description and example differ.
  const copy = isIgnore ? { ...t.dictionary, ...t.ignoreList } : t.dictionary;
  const Icon = isIgnore ? ShieldCheck : BookMarked;

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
    <div className="border border-t-0 border-[#C8C5BC] bg-[#F4F3EE]">
      <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-8 px-4 py-3">
        {/* Shared minimum width so the input groups of stacked strips line up */}
        <div className="shrink-0 md:min-w-[19rem]">
          <div className="flex items-center gap-2">
            <Icon className="w-3.5 h-3.5 text-[#111111]" strokeWidth={1.5} />
            <span className="label-meta text-[#111111]">{copy.title}</span>
          </div>
          <p className="text-[11px] text-[#525252] mt-0.5 leading-snug">{copy.description}</p>
        </div>

        {/* Segmented input group: field, match-case toggle, and Add share hairlines */}
        <div className="flex items-stretch w-full md:w-auto">
          <input
            type="text"
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addWord(); }}
            placeholder={copy.placeholder}
            aria-label={copy.title}
            className="relative flex-1 min-w-0 md:flex-initial md:w-52 text-xs px-3 py-2 border border-[#C8C5BC] bg-[#FFFFFF] text-[#111111] font-mono placeholder:text-[#6B6960] focus:outline-none focus:border-[#111111] focus:z-10"
            style={{ borderRadius: 0 }}
          />
          <button
            type="button"
            onClick={() => setCaseSensitive(!caseSensitive)}
            aria-pressed={caseSensitive}
            aria-label={copy.caseSensitive}
            title={copy.caseSensitive}
            className={`pressable -ml-px px-2.5 border text-[11px] font-mono cursor-pointer transition-colors ${
              caseSensitive
                ? 'z-10 bg-[#111111] text-[#F9F9F7] border-[#111111]'
                : 'bg-[#FFFFFF] text-[#525252] border-[#C8C5BC] hover:text-[#111111]'
            }`}
          >
            Aa
          </button>
          <button
            onClick={addWord}
            disabled={!word.trim()}
            className="pressable -ml-px text-xs px-3.5 py-2 bg-[#111111] text-[#F9F9F7] border border-[#111111] hover:bg-[#FFFFFF] hover:text-[#111111] transition-colors disabled:bg-[#E9E7E0] disabled:text-[#8A887F] disabled:border-[#C8C5BC] disabled:cursor-not-allowed cursor-pointer font-medium flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-3 h-3" />
            {copy.add}
          </button>
        </div>
      </div>

      {dictionary.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {dictionary.map((entry, index) => (
            <span
              key={`${entry.word}-${entry.caseSensitive}`}
              className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 font-mono ${
                isIgnore
                  ? 'bg-[#FFFFFF] text-[#111111] border border-[#111111]'
                  : 'bg-[#111111] text-[#F9F9F7]'
              }`}
            >
              {entry.word}
              {entry.caseSensitive && (
                <span
                  className={`text-[9px] px-1 py-px border leading-none ${
                    isIgnore
                      ? 'border-[#111111]/40 text-[#111111]/80'
                      : 'border-[#F9F9F7]/40 text-[#F9F9F7]/80'
                  }`}
                  title={copy.matchesCase}
                  aria-label={copy.matchesCase}
                >
                  Aa
                </span>
              )}
              <button
                onClick={() => removeWord(index)}
                className={`transition-colors cursor-pointer hover:text-[#FF3333] ${
                  isIgnore ? 'text-[#111111]/50' : 'text-[#F9F9F7]/60'
                }`}
                aria-label={`${copy.removeWord}: ${entry.word}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
