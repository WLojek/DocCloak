import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  {
    pattern: /\b756[.\s]?\d{4}[.\s]?\d{4}[.\s]?\d{2}\b/g,
    type: 'SSN',
    detector: 'regex:ch:ahv-avs-number',
    confidence: 0.95,
    region: 'ch',
    domains: ['identity', 'hr', 'medical'],
    description: 'Swiss AHV/AVS social security number (new format, EAN-13 based)',
    examples: ['756.1234.5678.97'],
    validate: (match: string) => {
      const digits = match.replace(/[\s.]/g, '');
      if (digits.length !== 13 || !digits.startsWith('756')) return false;
      const weights = [1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3];
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        sum += parseInt(digits[i], 10) * weights[i];
      }
      const check = (10 - (sum % 10)) % 10;
      return check === parseInt(digits[12], 10);
    },
  },
  {
    pattern: /\b(?:\+?41[\s-]?|0)[1-9]\d[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
    type: 'PHONE',
    detector: 'regex:ch:phone',
    confidence: 0.80,
    region: 'ch',
    domains: ['contact'],
    description: 'Swiss phone number',
  },
  {
    pattern: /\b\d{4}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:ch:postal-city',
    confidence: 0.80,
    region: 'ch',
    domains: ['contact'],
    description: 'Swiss postal code followed by city name',
  },
  {
    pattern: /[\p{L}][\p{L}\s-]*(?:strasse|str\.|weg|gasse|platz|allee|rain|matte)\s+\d+[\p{L}]?/giu,
    type: 'ADDRESS',
    detector: 'regex:ch:street-german',
    confidence: 0.85,
    region: 'ch',
    domains: ['contact'],
    description: 'Swiss street address in German (e.g. Bahnhofstrasse 10)',
  },
  {
    pattern: /(?:rue|avenue|chemin|route|place|boulevard)\s+[\p{L}][\p{L}\s'-]+\s*\d+/giu,
    type: 'ADDRESS',
    detector: 'regex:ch:street-french',
    confidence: 0.85,
    region: 'ch',
    domains: ['contact'],
    description: 'Swiss street address in French (e.g. rue de Lausanne 12)',
  },
];
