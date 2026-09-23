import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { GdprPage } from '../../src/ui/pages/GdprPage.tsx';
import { UseCasePage } from '../../src/ui/pages/UseCasePage.tsx';
import { PolishLanding } from '../../src/ui/pages/PolishLanding.tsx';
import { getPagesTranslations, plLanding } from '../../src/i18n/pages/index.ts';
import { pagesEn } from '../../src/i18n/pages/en.ts';
import { pagesPl } from '../../src/i18n/pages/pl.ts';

function renderWithLang(ui: ReactElement, lang: string) {
  localStorage.setItem('doccloak-lang', lang);
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  // jsdom has no scrollTo implementation
  window.scrollTo = vi.fn();
});

describe('content pages i18n', () => {
  it('falls back to English for locales without native page content', () => {
    expect(getPagesTranslations('de')).toBe(pagesEn);
    expect(getPagesTranslations('xx')).toBe(pagesEn);
    expect(getPagesTranslations('pl')).toBe(pagesPl);
  });

  it('contains no em dashes anywhere (project-wide ban)', () => {
    const all = JSON.stringify(pagesEn) + JSON.stringify(pagesPl) + JSON.stringify(plLanding);
    expect(all.includes('\u2014')).toBe(false);
  });

  it('cites EDPB Guidelines 4/2019 and Art. 25 precisely in both locales', () => {
    for (const t of [pagesEn, pagesPl]) {
      const refs = t.gdpr.refs.join(' ');
      expect(refs).toContain('4/2019');
      expect(refs).toContain('20');
      expect(refs).toMatch(/Art\.? ?25|artykułu 25/i);
    }
  });

  it('quotes only measured benchmark numbers on the Polish landing', () => {
    const all = JSON.stringify(plLanding);
    expect(all).toContain('98,6%');
    // The claim must carry its methodology context
    expect(plLanding.benchmark.body).toContain('14');
    expect(plLanding.benchmark.footnote.length).toBeGreaterThan(0);
  });
});

describe('content pages render', () => {
  it('renders the GDPR page in English with disclaimer', () => {
    renderWithLang(<GdprPage />, 'en');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(pagesEn.gdpr.title);
    expect(screen.getByText(pagesEn.gdpr.disclaimerTitle)).toBeInTheDocument();
  });

  it('renders the GDPR page in Polish', () => {
    renderWithLang(<GdprPage />, 'pl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(pagesPl.gdpr.title);
  });

  it('renders each use-case page', () => {
    for (const useCase of ['lawyers', 'accountants', 'hr', 'researchers'] as const) {
      cleanup();
      renderWithLang(<UseCasePage useCase={useCase} />, 'en');
      const c = pagesEn.useCases[useCase];
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(c.title);
      expect(screen.getByText(c.proofHeading)).toBeInTheDocument();
    }
  });

  it('renders the Polish landing with the measured PL number', () => {
    renderWithLang(<PolishLanding />, 'en'); // body is Polish regardless of UI language
    expect(screen.getByText('98,6%')).toBeInTheDocument();
    expect(screen.getByText(plLanding.hero.emphasis)).toBeInTheDocument();
  });
});
