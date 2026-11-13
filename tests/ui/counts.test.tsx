// Two numbers used to stand under one name: the list said "Found 296 sensitive items"
// (every place found) and the result panel said "Found 192 sensitive items" (different
// values replaced). Each now says what it counts, and the two can be reconciled:
// places found = places redacted + places not redacted; the result names both the
// different values and the places they were replaced in.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { DetectedEntity, ReplacementEntry } from '@doccloak/core';
import { EntityTable } from '../../src/ui/components/EntityTable.tsx';
import { TextOutput } from '../../src/ui/components/TextOutput.tsx';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { en } from '../../src/i18n/translations/en.ts';
import { pl } from '../../src/i18n/translations/pl.ts';

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

// "Jan Kowalski" twice, "Acme Ltd" twice: 5 places, 3 different values.
const ENTITIES: DetectedEntity[] = [
  { type: 'PERSON', value: 'Jan Kowalski', start: 0, end: 12, confidence: 0.9, detector: 'test' },
  { type: 'COMPANY', value: 'Acme Ltd', start: 16, end: 24, confidence: 0.9, detector: 'test' },
  { type: 'EMAIL', value: 'jan@acme.example', start: 30, end: 46, confidence: 0.9, detector: 'test' },
  { type: 'COMPANY', value: 'Acme Ltd', start: 50, end: 58, confidence: 0.9, detector: 'test' },
  { type: 'PERSON', value: 'Jan Kowalski', start: 64, end: 76, confidence: 0.9, detector: 'test' },
];
const ENTRIES: ReplacementEntry[] = [
  { original: 'Jan Kowalski', replacement: '[PERSON_1]', entityType: 'PERSON' },
  { original: 'Acme Ltd', replacement: '[COMPANY_1]', entityType: 'COMPANY' },
  { original: 'jan@acme.example', replacement: '[EMAIL_1]', entityType: 'EMAIL' },
];

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
});

describe('each count says what it counts', () => {
  it('the list heading counts places, the result counts different values and the places they were replaced in', () => {
    render(
      <Providers>
        <TextOutput value="[PERSON_1] of [COMPANY_1], [EMAIL_1]; [COMPANY_1] pays [PERSON_1]." entries={ENTRIES} replacedPlaces={5} />
        <EntityTable entities={ENTITIES} entries={ENTRIES} excludedIndices={new Set()} onToggle={() => {}} onSetExcluded={() => {}} onRenameLabel={() => {}} text="" keepTypes={[]} onKeepTypesChange={() => {}} />
      </Providers>,
    );
    expect(screen.getByRole('heading', { name: 'Sensitive data found in 5 places' })).toBeInTheDocument();
    expect(screen.getByTestId('replaced-summary')).toHaveTextContent('3 different values replaced in 5 places');
    // The same number never appears under the same words in both places.
    expect(screen.getByTestId('replaced-summary').textContent).not.toMatch(/found/i);
    // The list reconciles with itself: places found = redacted + not redacted.
    expect(screen.getByTestId('entity-filter-status')).toHaveTextContent(en.entityTable.status(5, 0));
  });

  it('after keeping a company visible the numbers still add up', () => {
    render(
      <Providers>
        <TextOutput value="[PERSON_1] of Acme Ltd, [EMAIL_1]; Acme Ltd pays [PERSON_1]." entries={ENTRIES.filter((e) => e.entityType !== 'COMPANY')} replacedPlaces={3} />
        <EntityTable entities={ENTITIES} entries={ENTRIES} excludedIndices={new Set([1, 3])} onToggle={() => {}} onSetExcluded={() => {}} onRenameLabel={() => {}} text="" keepTypes={[]} onKeepTypesChange={() => {}} />
      </Providers>,
    );
    expect(screen.getByRole('heading', { name: 'Sensitive data found in 5 places' })).toBeInTheDocument();
    expect(screen.getByTestId('entity-filter-status')).toHaveTextContent('3 redacted, 2 not redacted');
    expect(screen.getByTestId('replaced-summary')).toHaveTextContent('2 different values replaced in 3 places');
  });

  it('nothing replaced: the result says nothing rather than a zero', () => {
    render(<Providers><TextOutput value="Plain text." entries={[]} replacedPlaces={0} /></Providers>);
    expect(screen.getByTestId('replaced-summary').textContent?.trim()).toBe('');
  });

  it('singular forms read naturally', () => {
    expect(en.entityTable.title(1)).toBe('Sensitive data found in 1 place');
    expect(en.textOutput.replacedSummary(1, 1)).toBe('1 value replaced in 1 place');
    expect(en.textOutput.replacedSummary(1, 4)).toBe('1 value replaced in 4 places');
  });

  it('Polish declines the values and the places', () => {
    expect(pl.entityTable.title(1)).toBe('Dane wrażliwe znaleziono w 1 miejscu');
    expect(pl.entityTable.title(296)).toBe('Dane wrażliwe znaleziono w 296 miejscach');
    expect(pl.textOutput.replacedSummary(1, 1)).toBe('Zamieniono 1 wartość w 1 miejscu');
    expect(pl.textOutput.replacedSummary(3, 5)).toBe('Zamieniono 3 różne wartości w 5 miejscach');
    expect(pl.textOutput.replacedSummary(12, 20)).toBe('Zamieniono 12 różnych wartości w 20 miejscach');
    expect(pl.textOutput.replacedSummary(163, 242)).toBe('Zamieniono 163 różne wartości w 242 miejscach');
    expect(pl.textOutput.replacedSummary(192, 296)).toBe('Zamieniono 192 różne wartości w 296 miejscach');
    expect(pl.textOutput.replacedSummary(25, 25)).toBe('Zamieniono 25 różnych wartości w 25 miejscach');
  });

  it('in every language the two counts are worded differently and each carries its numbers', () => {
    for (const { code, translations: t } of languages) {
      for (const n of [1, 2, 5, 22, 296]) {
        const heading = t.entityTable.title(n);
        const summary = t.textOutput.replacedSummary(n, n);
        expect(heading, code).toContain(String(n));
        expect(summary, code).toContain(String(n));
        expect(summary, `${code} ${n}`).not.toBe(heading);
        expect(`${heading} ${summary}`, code).not.toMatch(/undefined|NaN/);
      }
      const both = t.textOutput.replacedSummary(163, 242);
      expect(both, code).toMatch(/163.*242/);
      // The heading and the summary do not share their opening words (the old defect: one string for both).
      const first = (text: string) => text.replace(/\d+/g, '').trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();
      expect(first(t.entityTable.title(296)), code).not.toBe(first(both));
    }
  });
});
