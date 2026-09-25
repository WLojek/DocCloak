// T228: the hook keeps the regex region in step with the UI language until the
// user picks one, and the hint/label strings exist in every language.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { EngineClient } from '@doccloak/core';
import { ENGINE_SETTINGS_KEYS } from '@doccloak/core';
import { useAnonymizer } from '../../src/ui/hooks/useAnonymizer.ts';
import { LanguageProvider, useTranslation } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';
import { languages } from '../../src/i18n/translations/index.ts';
import { _resetEngineStateForTests, _setClientFactoryForTests, CONSENT_STORAGE_KEY } from '../../src/engine.ts';

function Providers({ children }: { children: ReactNode }) {
  return createElement(LanguageProvider, null, createElement(ToastProvider, null, children));
}

const updateSettings = vi.fn(() => Promise.resolve());

function fakeFactory() {
  const client = {
    preload: () => Promise.resolve(),
    detect: () => Promise.resolve([]),
    switchProvider: () => Promise.resolve(),
    getSettings: () => ({ providerId: 'bardsai', threshold: 0.5, regexEnabled: true, regexRegion: 'all', customLabels: [] }),
    onDownloadProgress: () => () => {},
    onDetectionProgress: () => () => {},
    updateSettings,
    release: () => Promise.resolve(),
    close: () => {},
  } as unknown as EngineClient;
  return { client, terminate: vi.fn() };
}

function useBoth() {
  return { anon: useAnonymizer(), lang: useTranslation() };
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'pl');
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  updateSettings.mockClear();
  _setClientFactoryForTests(fakeFactory);
  _resetEngineStateForTests();
});

afterEach(() => {
  _setClientFactoryForTests(null);
  _resetEngineStateForTests();
});

describe('text language follows the UI language', () => {
  it('starts on the region of the stored UI language', () => {
    const { result } = renderHook(useBoth, { wrapper: Providers });
    expect(result.current.lang.language).toBe('pl');
    expect(result.current.anon.regexRegion).toBe('pl');
  });

  it('moves with a language switch and stops once the user picks a region', () => {
    const { result } = renderHook(useBoth, { wrapper: Providers });
    act(() => result.current.lang.setLanguage('de'));
    expect(result.current.anon.regexRegion).toBe('de');
    expect(localStorage.getItem(ENGINE_SETTINGS_KEYS.regexRegion)).toBeNull();

    act(() => result.current.anon.handleRegexRegionChange('fr'));
    expect(result.current.anon.regexRegion).toBe('fr');
    expect(localStorage.getItem(ENGINE_SETTINGS_KEYS.regexRegion)).toBe('fr');

    act(() => result.current.lang.setLanguage('pl'));
    expect(result.current.anon.regexRegion).toBe('fr');
  });
});

describe('translations', () => {
  it('every language names the picker and the settings hint', () => {
    for (const l of languages) {
      expect(l.translations.settings.regexRegion.trim().length, l.code).toBeGreaterThan(0);
      expect(l.translations.settings.regexRegionHint.trim().length, l.code).toBeGreaterThan(20);
      expect(l.translations.settings.regexRegionHint, l.code).toContain(l.translations.redactButton.redact);
    }
  });
});
