import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  {
    pattern: /\b(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}[-\s]?\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:dk:cpr-number',
    confidence: 0.80,
    region: 'dk',
    domains: ['identity', 'hr'],
    description: 'Danish CPR (Central Person Register) number',
    examples: ['010190-1234'],
    falsePositiveNotes: 'Post-2007 CPR numbers may not satisfy modulo-11 check',
  },
  {
    pattern: /\b(?:\+?45[\s-]?)?\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}\b/g,
    type: 'PHONE',
    detector: 'regex:dk:phone',
    confidence: 0.75,
    region: 'dk',
    domains: ['contact'],
    description: 'Danish phone number',
  },
  {
    pattern: /\b\d{4}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:dk:postal-city',
    confidence: 0.80,
    region: 'dk',
    domains: ['contact'],
    description: 'Danish postal code followed by city name',
  },
];
