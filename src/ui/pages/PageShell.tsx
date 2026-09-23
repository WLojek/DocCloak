import { useEffect, type ReactNode } from 'react';
import { ArrowRight, Github, Lock } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { getPagesTranslations } from '../../i18n/pages/index.ts';
import { languages } from '../../i18n/translations/index.ts';
import logoSrc from '../assets/doc-cloak-logo-light.png';

const DEFAULT_TITLE = typeof document !== 'undefined' ? document.title : 'DocCloak';

/**
 * Shared chrome for the static content pages (GDPR, use cases, PL landing).
 * Deliberately independent of App.tsx: these pages never spin up the
 * detection engine, so a visit to a content page costs only text.
 */
export function PageShell({
  children,
  title,
  forceLang,
}: {
  children: ReactNode;
  title: string;
  /** Pin the chrome to one locale (the Polish landing is Polish-only). */
  forceLang?: string;
}) {
  const { language, setLanguage } = useTranslation();
  const pt = getPagesTranslations(forceLang ?? language);

  useEffect(() => {
    document.title = title;
    window.scrollTo(0, 0);
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [title]);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-30 px-6 py-3 border-b border-[#E5E5E0] chrome-material">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <a href="#/" className="flex items-center gap-3 shrink-0" aria-label={pt.nav.backHome}>
            <img src={logoSrc} alt="DocCloak" className="h-7" />
            <span className="font-serif tracking-tight leading-none text-[#111111] font-medium text-xl">
              DocCloak
            </span>
          </a>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            {!forceLang && (
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                aria-label={pt.nav.language}
                className="px-2 py-1.5 text-xs border border-[#C8C5BC] bg-white text-[#111111] cursor-pointer focus:outline-none focus:border-[#111111]"
              >
                {languages.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.nativeName}
                  </option>
                ))}
              </select>
            )}
            <a
              href="#/"
              className="pressable inline-flex items-center gap-2 px-4 py-2 bg-[#111111] text-[#F9F9F7] text-xs font-semibold hover:bg-[#222222] transition-colors"
            >
              {pt.nav.openApp}
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </header>

      <main>{children}</main>

      {/* Footer */}
      <footer className="border-t-2 border-[#111111] bg-[#F9F9F7] px-6 py-6">
        <div className="max-w-6xl mx-auto flex flex-col items-start gap-4">
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label={pt.nav.useCasesLabel}>
            <a href="#/gdpr" className="label-meta text-[#111111] hover:underline">{pt.nav.gdprLink}</a>
            <a href="#/for/lawyers" className="label-meta text-[#111111] hover:underline">{pt.nav.lawyersLink}</a>
            <a href="#/for/accountants" className="label-meta text-[#111111] hover:underline">{pt.nav.accountantsLink}</a>
            <a href="#/for/hr" className="label-meta text-[#111111] hover:underline">{pt.nav.hrLink}</a>
            <a href="#/for/researchers" className="label-meta text-[#111111] hover:underline">{pt.nav.researchersLink}</a>
            <a href="#/pl" className="label-meta text-[#111111] hover:underline">{pt.nav.plLandingLink}</a>
          </nav>
          <p className="text-xs text-[#525252] leading-relaxed max-w-2xl">{pt.nav.footerDisclaimer}</p>
          <a
            href="https://github.com/WLojek/DocCloak"
            target="_blank"
            rel="noopener noreferrer"
            className="label-meta text-[#111111] hover:underline flex items-center gap-2.5 leading-none"
          >
            <Github className="w-3.5 h-3.5 shrink-0 -translate-y-px" />
            <span>Open source on GitHub · AGPL-3.0</span>
          </a>
          <p className="label-meta text-muted-foreground/80 leading-none pt-3 border-t border-[#E5E5E0] w-full flex items-center gap-2.5">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            © {new Date().getFullYear()} DocCloak · Built by Witold Łojek
          </p>
        </div>
      </footer>
    </div>
  );
}
