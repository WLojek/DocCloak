import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{9}\b/g,
    type: 'SSN',
    detector: 'regex:nl:bsn',
    confidence: 0.85,
    region: 'nl',
    domains: ['identity', 'hr'],
    description: 'Dutch citizen service number (BSN, 9 digits with elfproef validation)',
    examples: ['123456782'],
    falsePositiveNotes: '9 bare digits match many formats; elfproef validation essential',
    validate: (match: string) => {
      if (match.length !== 9 || !/^\d{9}$/.test(match)) return false;

      const weights = [9, 8, 7, 6, 5, 4, 3, 2, -1];
      let sum = 0;
      for (let i = 0; i < 9; i++) {
        sum += parseInt(match[i], 10) * weights[i];
      }
      return sum > 0 && sum % 11 === 0;
    },
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?31[\s-]?|0)6[\s-]?\d{4}[\s-]?\d{4}\b/g,
    type: 'PHONE',
    detector: 'regex:nl:phone_mobile',
    confidence: 0.85,
    region: 'nl',
    domains: ['contact'],
    description: 'Dutch mobile phone number (06 prefix)',
    examples: ['+31 6 1234 5678', '06 12345678'],
  },
  {
    pattern: /\b(?:\+?31[\s-]?|0)[1-5]\d[\s-]?\d{3}[\s-]?\d{4}\b/g,
    type: 'PHONE',
    detector: 'regex:nl:phone_landline',
    confidence: 0.75,
    region: 'nl',
    domains: ['contact'],
    description: 'Dutch landline phone number (area code prefix)',
    examples: ['+31 20 123 4567', '020 1234567'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{4}\s?[A-Z]{2}\b/g,
    type: 'ADDRESS',
    detector: 'regex:nl:postal',
    confidence: 0.80,
    region: 'nl',
    domains: ['contact'],
    description: 'Dutch postal code (4 digits + 2 letters)',
    examples: ['1012 AB', '3511XA'],
  },
  {
    pattern: /[\p{L}][\p{L}\s'-]*(?:straat|weg|laan|plein|gracht|kade|singel|dijk|steeg|dreef|hof|markt)\s+\d{1,5}[\p{L}]?/giu,
    type: 'ADDRESS',
    detector: 'regex:nl:street',
    confidence: 0.85,
    region: 'nl',
    domains: ['contact'],
    description: 'Dutch street address (name + straat/weg/laan/gracht + number)',
    examples: ['Keizersgracht 123', 'Dorpsstraat 45a', 'Marktplein 7'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:\s+)?(?:B\.?V\.?|N\.?V\.?|V\.?O\.?F\.?|C\.?V\.?)\b/gu,
    type: 'COMPANY',
    detector: 'regex:nl:company',
    confidence: 0.90,
    region: 'nl',
    domains: ['legal', 'financial'],
    description: 'Dutch company name with legal form (B.V., N.V., V.O.F., C.V.)',
    examples: ['Philips N.V.', 'Shell Nederland B.V.'],
  },
];
