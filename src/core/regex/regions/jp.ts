import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:jp:my_number',
    confidence: 0.70,
    region: 'jp',
    domains: ['identity', 'financial'],
    description: 'Japanese My Number (個人番号, 12 digits)',
    examples: ['1234 5678 9012'],
    falsePositiveNotes: '12 digits overlaps with credit card fragments and other IDs',
  },
  {
    pattern: /\b[A-Z]{2}\d{7}\b/g,
    type: 'SSN',
    detector: 'regex:jp:passport',
    confidence: 0.70,
    region: 'jp',
    domains: ['identity'],
    description: 'Japanese passport number (2 letters + 7 digits)',
    examples: ['TK1234567'],
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b\d{13}\b/g,
    type: 'SSN',
    detector: 'regex:jp:corporate_number',
    confidence: 0.50,
    region: 'jp',
    domains: ['financial', 'legal'],
    description: 'Japanese corporate number (法人番号, 13 digits)',
    examples: ['1234567890123'],
    falsePositiveNotes: '13-digit numbers are rare but not exclusively corporate numbers',
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b0\d{1,4}[\s-]?\d{1,4}[\s-]?\d{3,4}\b/g,
    type: 'PHONE',
    detector: 'regex:jp:phone',
    confidence: 0.80,
    region: 'jp',
    domains: ['contact'],
    description: 'Japanese phone number (0X-XXXX-XXXX, variable area code length)',
    examples: ['03-1234-5678', '090-1234-5678', '0120-123-456'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{3}-?\d{4}\b/g,
    type: 'ADDRESS',
    detector: 'regex:jp:postal',
    confidence: 0.65,
    region: 'jp',
    domains: ['contact'],
    description: 'Japanese postal code (〒XXX-XXXX or XXX-XXXX)',
    examples: ['100-0001', '1600023'],
    falsePositiveNotes: '7-digit format is very common — can match phone fragments',
  },
];
