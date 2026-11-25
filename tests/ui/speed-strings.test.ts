// T280: the strings of the speed work exist in every interface language, name the Chrome switch
// and policy exactly as Chrome spells them, and carry no em dash.
import { describe, it, expect } from 'vitest';
import { languages } from '../../src/i18n/translations/index.ts';
import { speedStrings } from '../../src/i18n/features/speed.ts';
import type { FeatureLanguage } from '../../src/i18n/features/index.ts';

describe('speed strings', () => {
  for (const { code } of languages) {
    it(`${code}: hint, large-model mark and the FAQ entry`, () => {
      const s = speedStrings[code as FeatureLanguage];
      expect(s, code).toBeDefined();
      expect(s.visibleTabHint.length).toBeGreaterThan(20);
      expect(s.visibleTabHint.length).toBeLessThanOrEqual(70);
      expect(s.largeDownload('1.27 GB')).toContain('1.27 GB');
      expect(s.largeDownloadLabel.length).toBeGreaterThan(5);
      expect(s.faqQuestion.trim().endsWith('?')).toBe(true);
      expect(s.faqAnswer).toContain('--disable-renderer-backgrounding');
      expect(s.faqAnswer).toContain('ForceForegroundPriorityForUrls');
      expect(s.faqAnswer).toContain('WebGPU');
      for (const text of [s.visibleTabHint, s.largeDownload('x'), s.largeDownloadLabel, s.faqQuestion, s.faqAnswer]) {
        expect(text).not.toContain('\u2014');
      }
    });
  }
});
