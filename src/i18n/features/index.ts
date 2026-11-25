/**
 * Strings of one feature in every interface language, kept in the feature's own file
 * (src/i18n/features/<feature>.ts) instead of the eight big translation files, so features built
 * side by side never edit the same file. Read them with useFeatureStrings.
 */
import { useTranslation } from '../LanguageContext.tsx';

export type FeatureLanguage = 'en' | 'pl' | 'de' | 'fr' | 'es' | 'pt' | 'sv' | 'no';

/** One entry per interface language; the compiler refuses a missing one. */
export type FeatureStrings<T> = Record<FeatureLanguage, T>;

/** The feature's strings in the interface language (English when the language is unknown). */
export function useFeatureStrings<T>(strings: FeatureStrings<T>): T {
  const { language } = useTranslation();
  return strings[language as FeatureLanguage] ?? strings.en;
}
