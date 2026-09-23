import type { PagesTranslations } from './types.ts';
import { pagesEn } from './en.ts';
import { pagesPl } from './pl.ts';

/**
 * Page translations by UI locale. en and pl are written natively; the
 * remaining UI locales (de, fr, es, pt, sv, no) fall back to English until
 * native versions are written (tracked as a follow-up in tasks/T161).
 */
const pagesByLocale: Record<string, PagesTranslations> = {
  en: pagesEn,
  pl: pagesPl,
};

export function getPagesTranslations(code: string): PagesTranslations {
  return pagesByLocale[code] ?? pagesEn;
}

export type { PagesTranslations, UseCaseContent } from './types.ts';
export { plLanding } from './pl.ts';
export type { PlLandingContent } from './pl.ts';
