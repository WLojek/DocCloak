// T228: the regex region defaults to the region of the UI language while the
// user has not picked one; an explicit pick is persisted and wins over any
// later language switch.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ENGINE_SETTINGS_KEYS } from '@doccloak/core';
import {
  _resetEngineStateForTests,
  applyUiLanguage,
  getRegexRegion,
  hasExplicitRegexRegion,
  regexRegionForLanguage,
  setRegexRegionSetting,
} from '../../src/engine.ts';
import { LANGUAGE_STORAGE_KEY } from '../../src/i18n/storage.ts';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  _resetEngineStateForTests();
});

describe('regexRegionForLanguage', () => {
  it('maps every UI language to its region pack, English to all', () => {
    expect(regexRegionForLanguage('pl')).toBe('pl');
    expect(regexRegionForLanguage('de')).toBe('de');
    expect(regexRegionForLanguage('fr')).toBe('fr');
    expect(regexRegionForLanguage('es')).toBe('es');
    expect(regexRegionForLanguage('pt')).toBe('pt');
    expect(regexRegionForLanguage('no')).toBe('no');
    expect(regexRegionForLanguage('sv')).toBe('se');
    expect(regexRegionForLanguage('en')).toBe('all');
  });

  it('accepts BCP 47 tags and falls back to all for unknown languages', () => {
    expect(regexRegionForLanguage('pl-PL')).toBe('pl');
    expect(regexRegionForLanguage('SV')).toBe('se');
    expect(regexRegionForLanguage('ja')).toBe('all');
    expect(regexRegionForLanguage('')).toBe('all');
  });
});

describe('default region on a fresh profile', () => {
  it('follows the stored UI language when no region was picked', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'pl');
    _resetEngineStateForTests();
    expect(getRegexRegion()).toBe('pl');
    expect(hasExplicitRegexRegion()).toBe(false);
    expect(localStorage.getItem(ENGINE_SETTINGS_KEYS.regexRegion)).toBeNull();
  });

  it('keeps a saved region over the UI language', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'pl');
    localStorage.setItem(ENGINE_SETTINGS_KEYS.regexRegion, 'fr');
    _resetEngineStateForTests();
    expect(getRegexRegion()).toBe('fr');
    expect(hasExplicitRegexRegion()).toBe(true);
  });

  it('ignores an unknown saved region and derives from the language', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    localStorage.setItem(ENGINE_SETTINGS_KEYS.regexRegion, 'mars');
    _resetEngineStateForTests();
    expect(getRegexRegion()).toBe('de');
    expect(hasExplicitRegexRegion()).toBe(false);
  });
});

describe('applyUiLanguage', () => {
  it('moves the region with the language while nothing is picked, without persisting', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'pl');
    _resetEngineStateForTests();
    expect(applyUiLanguage('de')).toBe('de');
    expect(getRegexRegion()).toBe('de');
    expect(applyUiLanguage('sv')).toBe('se');
    expect(applyUiLanguage('en')).toBe('all');
    expect(localStorage.getItem(ENGINE_SETTINGS_KEYS.regexRegion)).toBeNull();
  });

  it('never overrides an explicit pick', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'pl');
    _resetEngineStateForTests();
    setRegexRegionSetting('fr');
    expect(localStorage.getItem(ENGINE_SETTINGS_KEYS.regexRegion)).toBe('fr');
    expect(applyUiLanguage('de')).toBe('fr');
    expect(getRegexRegion()).toBe('fr');
    // ...and the pick survives a reload with a different UI language
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'de');
    _resetEngineStateForTests();
    expect(getRegexRegion()).toBe('fr');
  });
});
