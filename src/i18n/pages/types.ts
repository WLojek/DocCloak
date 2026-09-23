/**
 * Translations for the static content pages (GDPR/trust page and the
 * per-profession use-case pages), kept separate from the main app
 * translations on purpose: these pages are long-form marketing/compliance
 * copy owned by a different workflow than the tool UI strings.
 *
 * Locale coverage: en and pl are written natively; every other UI locale
 * falls back to en (see index.ts). Adding a locale means adding a file
 * that implements this interface, exactly like src/i18n/translations/.
 */

export interface UseCaseContent {
  /** e.g. "DocCloak for lawyers" */
  eyebrow: string;
  title: string;
  intro: string;
  workflowHeading: string;
  steps: { title: string; body: string }[];
  catchesHeading: string;
  catchesIntro: string;
  catches: string[];
  scopeHeading: string;
  scopeIntro: string;
  scope: string[];
  proofHeading: string;
  proofBody: string;
  proofNote: string;
}

export interface PagesTranslations {
  nav: {
    openApp: string;
    backHome: string;
    gdprLink: string;
    useCasesLabel: string;
    lawyersLink: string;
    accountantsLink: string;
    hrLink: string;
    researchersLink: string;
    plLandingLink: string;
    footerDisclaimer: string;
    language: string;
  };
  gdpr: {
    eyebrow: string;
    title: string;
    intro: string;
    disclaimerTitle: string;
    disclaimerBody: string;
    archHeading: string;
    archBody: string;
    verifyHeading: string;
    verifySteps: string[];
    mapHeading: string;
    mapIntro: string;
    mappings: { fact: string; concept: string; explanation: string }[];
    dpiaHeading: string;
    dpiaIntro: string;
    dpiaPoints: string[];
    dpiaOutro: string;
    limitsHeading: string;
    limitsIntro: string;
    limits: string[];
    refsHeading: string;
    refsIntro: string;
    refs: string[];
    ctaHeading: string;
    ctaBody: string;
    ctaApp: string;
    ctaUseCases: string;
  };
  useCases: {
    lawyers: UseCaseContent;
    accountants: UseCaseContent;
    hr: UseCaseContent;
    researchers: UseCaseContent;
  };
}
