/**
 * The UI language's storage key and detection, shared by the React language
 * context and the engine (T228: the regex region defaults to the region of
 * the UI language, and the engine reads its settings before React mounts).
 */
export const LANGUAGE_STORAGE_KEY = 'doccloak-lang';

/** Two-letter UI language: the stored choice, else the browser's, else 'en'. */
export function detectUiLanguage(known: readonly string[]): string {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && known.includes(stored)) return stored;
  } catch { /* storage unavailable */ }
  const browserLang = typeof navigator !== 'undefined' && navigator.language
    ? navigator.language.slice(0, 2)
    : 'en';
  if (known.includes(browserLang)) return browserLang;
  return 'en';
}
