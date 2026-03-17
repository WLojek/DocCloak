import { describe, it, expect } from 'vitest';
import { ALL_REGEX_RULES } from '../../../src/core/regex/index.ts';

describe('regex rules: all examples match their pattern', () => {
  for (const rule of ALL_REGEX_RULES) {
    if (!rule.examples?.length) continue;
    for (const example of rule.examples) {
      it(`${rule.detector}: matches "${example}"`, () => {
        rule.pattern.lastIndex = 0;
        const match = rule.pattern.exec(example);
        expect(match, `Pattern ${rule.pattern} should match "${example}"`).not.toBeNull();
        if (rule.validate && match) {
          expect(rule.validate(match[0]), `Validation failed for "${match[0]}"`).toBe(true);
        }
      });
    }
  }
});

describe('regex rules: metadata is valid', () => {
  for (const rule of ALL_REGEX_RULES) {
    it(`${rule.detector}: has required metadata`, () => {
      expect(rule.pattern.flags).toContain('g');
      expect(rule.confidence).toBeGreaterThan(0);
      expect(rule.confidence).toBeLessThanOrEqual(1);
      expect(rule.region).toBeTruthy();
      expect(rule.domains.length).toBeGreaterThan(0);
      expect(rule.description).toBeTruthy();
    });
  }
});
