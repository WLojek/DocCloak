import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Translations } from './types.ts';
import { getLanguage, languages } from './translations/index.ts';
import { LANGUAGE_STORAGE_KEY, detectUiLanguage } from './storage.ts';

interface LanguageContextValue {
  t: Translations;
  language: string;
  setLanguage: (code: string) => void;
}

const LANGUAGE_CODES = languages.map((l) => l.code);

function detectLanguage(): string {
  return detectUiLanguage(LANGUAGE_CODES);
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState(detectLanguage);

  const setLanguage = (code: string) => {
    setLanguageState(code);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  };

  const t = getLanguage(language).translations;

  return (
    <LanguageContext.Provider value={{ t, language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useTranslation must be used within LanguageProvider');
  return ctx;
}
