import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{2}[.\s]?\d{2}[.\s]?\d{2}[-.\s]?\d{3}[.\s]?\d{2}\b/g,
    type: 'SSN',
    detector: 'regex:be:national_register',
    confidence: 0.90,
    region: 'be',
    domains: ['identity', 'hr'],
    description: 'Belgian National Register Number (Rijksregisternummer / Numéro de registre national)',
    examples: ['85.07.15-123.97', '85071512397'],
    validate: (match: string) => {
      const digits = match.replace(/[\s.-]/g, '');
      if (digits.length !== 11 || !/^\d{11}$/.test(digits)) return false;

      const first9 = parseInt(digits.substring(0, 9), 10);
      const check = parseInt(digits.substring(9, 11), 10);

      // Born before 2000
      if ((97 - (first9 % 97)) === check) return true;

      // Born 2000+: prepend '2' to the first 9 digits
      const first9with2 = parseInt('2' + digits.substring(0, 9), 10);
      if ((97 - (first9with2 % 97)) === check) return true;

      return false;
    },
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?32[\s-]?|0)(?:4\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}|[1-9]\d?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})\b/g,
    type: 'PHONE',
    detector: 'regex:be:phone',
    confidence: 0.80,
    region: 'be',
    domains: ['contact'],
    description: 'Belgian phone number (mobile 04xx or landline)',
    examples: ['+32 475 12 34 56', '02 123 45 67'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b[1-9]\d{3}\s+[\p{L}][\p{L}\s'-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:be:postal',
    confidence: 0.75,
    region: 'be',
    domains: ['contact'],
    description: 'Belgian postal code (4 digits, 1000-9999) followed by city name',
    examples: ['1000 Bruxelles', '2000 Antwerpen', '9000 Gent'],
    falsePositiveNotes: '4-digit numbers are common',
  },
  {
    pattern: /(?:straat|laan|weg|plein|steenweg|lei|dreef|boulevard|avenue|rue|place|chaussée)[\p{L}\s'-]+\d{1,5}[\p{L}]?|[\p{L}][\p{L}\s'-]*(?:straat|laan|weg|plein|steenweg|lei|dreef)\s+\d{1,5}[\p{L}]?/giu,
    type: 'ADDRESS',
    detector: 'regex:be:street',
    confidence: 0.85,
    region: 'be',
    domains: ['contact'],
    description: 'Belgian street address (Dutch/French street types + number)',
    examples: ['Kerkstraat 12', 'Avenue Louise 54', 'Rue de la Loi 16'],
  },
];
