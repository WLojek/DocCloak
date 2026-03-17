import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Translations } from './types.ts';
import { getLanguage, languages } from './translations/index.ts';

interface LanguageContextValue {
  t: Translations;
  language: string;
  setLanguage: (code: string) => void;
}

const STORAGE_KEY = 'doccloak-lang';

function detectLanguage(): string {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && languages.some((l) => l.code === stored)) return stored;

  const browserLang = navigator.language.slice(0, 2);
  if (languages.some((l) => l.code === browserLang)) return browserLang;

  return 'en';
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState(detectLanguage);

  const setLanguage = (code: string) => {
    setLanguageState(code);
    localStorage.setItem(STORAGE_KEY, code);
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
