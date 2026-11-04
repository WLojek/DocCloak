// T249: every language describes every detection model with a short line and a full
// description (strengths, weaknesses, when to choose it) behind "More".
import { describe, it, expect } from 'vitest';
import { languages, getLanguage } from '../../src/i18n/translations/index.ts';
import { PROVIDERS } from '../../src/engine.ts';

describe('model descriptions in the settings picker', () => {
  for (const { code, translations: t } of languages) {
    it(`${code}: a short line and a full description for every model`, () => {
      for (const p of PROVIDERS) {
        const m = t.settings.models[p.id as keyof typeof t.settings.models];
        expect(m, p.id).toBeDefined();
        expect(m.description.length, `${p.id} short line`).toBeGreaterThan(20);
        expect(m.description.length, `${p.id} short line`).toBeLessThanOrEqual(110);
        // The size is shown next to the name, from PROVIDER_SIZE_MB; the copy no longer repeats it.
        expect(m.description, p.id).not.toMatch(/\d+\s*(MB|Mo)\b/);
        expect(m.strengths.length, `${p.id} strengths`).toBeGreaterThanOrEqual(2);
        expect(m.weaknesses.length, `${p.id} weaknesses`).toBeGreaterThanOrEqual(2);
        expect(m.bestFor.length, `${p.id} bestFor`).toBeGreaterThan(20);
        for (const s of [m.label, m.description, ...m.strengths, ...m.weaknesses, m.bestFor]) expect(s).not.toContain('—');
      }
      expect(t.settings.modelSize(279)).toContain('279');
      // T250: saved on this device, removing one, feedback.
      expect(t.settings.modelRemoveLabel('X model')).toContain('X model');
      expect(t.settings.modelRemoved('X model', t.settings.modelSize(279))).toMatch(/X model.*279/);
      for (const s of [t.settings.modelSaved, t.settings.modelNotSaved, t.settings.modelRemove, t.settings.modelRemoveFailed, t.settings.modelsFeedback, t.settings.modelFeedback]) {
        expect(s.length).toBeGreaterThan(1);
      }
      expect(t.settings.modelsTestingNote.length).toBeGreaterThan(80);
      // T253: pages read at a time.
      expect(t.settings.ocrWorkersAuto(5)).toContain('5');
      expect(t.settings.ocrWorkersTitle.length).toBeGreaterThan(5);
      expect(t.settings.ocrWorkersHint).toMatch(/0[.,]25/);
      expect(t.settings.modelsTestingNote).not.toContain('\u2014');
      for (const s of [t.settings.modelMore, t.settings.modelLess, t.settings.modelStrengths, t.settings.modelWeaknesses, t.settings.modelBestFor, t.settings.modelTestNote]) {
        expect(s.length).toBeGreaterThan(1);
      }
    });
  }

  it('the same number of points in every language as in English', () => {
    const en = getLanguage('en').translations.settings.models;
    for (const { code, translations: t } of languages) {
      for (const p of PROVIDERS) {
        const id = p.id as keyof typeof en;
        expect(t.settings.models[id].strengths.length, `${code} ${p.id}`).toBe(en[id].strengths.length);
        expect(t.settings.models[id].weaknesses.length, `${code} ${p.id}`).toBe(en[id].weaknesses.length);
      }
    }
  });
});
