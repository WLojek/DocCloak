import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  {
    pattern: /\b\d{7}[A-W][ABWTXZ]?\b/gi,
    type: 'SSN',
    detector: 'regex:ie:pps-number',
    confidence: 0.90,
    region: 'ie',
    domains: ['identity', 'hr'],
    description: 'Irish PPS (Personal Public Service) number',
    examples: ['1234567T', '1234567TW'],
    validate: (match: string) => {
      const upper = match.toUpperCase();
      const digits = upper.slice(0, 7);
      const checkChar = upper[7];
      const suffix = upper.length > 8 ? upper[8] : undefined;
      const weights = [8, 7, 6, 5, 4, 3, 2];
      let sum = 0;
      for (let i = 0; i < 7; i++) {
        sum += parseInt(digits[i], 10) * weights[i];
      }
      if (suffix && suffix !== 'W') {
        sum += (suffix.charCodeAt(0) - 64) * 9;
      }
      const remainder = sum % 23;
      const expected = remainder === 0 ? 'W' : String.fromCharCode(64 + remainder);
      return checkChar === expected;
    },
  },
  {
    pattern: /\b(?:\+?353[\s-]?|0)[1-9]\d?[\s-]?\d{3}[\s-]?\d{3,4}\b/g,
    type: 'PHONE',
    detector: 'regex:ie:phone',
    confidence: 0.80,
    region: 'ie',
    domains: ['contact'],
    description: 'Irish phone number',
  },
  {
    pattern: /\b[A-Z]\d{2}\s?[A-Z0-9]{4}\b/gi,
    type: 'ADDRESS',
    detector: 'regex:ie:eircode',
    confidence: 0.80,
    region: 'ie',
    domains: ['contact'],
    description: 'Irish Eircode postal code',
    examples: ['A65 F4E2', 'D08YX4T'],
  },
];
