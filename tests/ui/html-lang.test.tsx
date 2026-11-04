// The page's lang attribute follows the interface language (screen readers read Polish as Polish).
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { LanguageProvider, useTranslation } from '../../src/i18n/LanguageContext.tsx';

const wrapper = ({ children }: { children: ReactNode }) => createElement(LanguageProvider, null, children);

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
});

describe('html lang', () => {
  it('starts on the stored language and follows a switch', () => {
    localStorage.setItem('doccloak-lang', 'pl');
    const { result } = renderHook(useTranslation, { wrapper });
    expect(document.documentElement.lang).toBe('pl');
    act(() => result.current.setLanguage('fr'));
    expect(document.documentElement.lang).toBe('fr');
  });
});
