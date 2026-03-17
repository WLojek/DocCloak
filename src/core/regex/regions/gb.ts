import type { RegexRule } from '../types.ts';

function validateNino(match: string): boolean {
  const clean = match.replace(/\s/g, '').toUpperCase();
  // NINO cannot start with D, F, I, Q, U, V; second letter cannot be D, F, I, O, Q, U, V
  if (/^[DFIQUV]/.test(clean)) return false;
  if (/^.[DFIOQU]/.test(clean)) return false;
  // Cannot be BG, GB, NK, KN, TN, NT, ZZ prefix
  if (/^(?:BG|GB|NK|KN|TN|NT|ZZ)/.test(clean)) return false;
  return true;
}

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b[A-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/gi,
    type: 'SSN',
    detector: 'regex:gb:nino',
    confidence: 0.90,
    region: 'gb',
    domains: ['identity', 'hr', 'financial'],
    description: 'UK National Insurance Number (NINO, e.g., AB 12 34 56 C)',
    examples: ['AB 12 34 56 C', 'CE123456C'],
    validate: validateNino,
  },
  {
    pattern: /\b\d{3}\s?\d{3}\s?\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:gb:nhs',
    confidence: 0.60,
    region: 'gb',
    domains: ['medical', 'identity'],
    description: 'UK NHS number (10 digits)',
    examples: ['943 476 5919'],
    falsePositiveNotes: '10-digit format overlaps with many phone numbers',
  },
  {
    pattern: /\b\d{9}\b/g,
    type: 'SSN',
    detector: 'regex:gb:passport',
    confidence: 0.40,
    region: 'gb',
    domains: ['identity'],
    description: 'UK passport number (9 digits)',
    examples: ['123456789'],
    falsePositiveNotes: 'Very broad — 9 digits matches many things. Best paired with context clues.',
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b\d{2}-\d{2}-\d{2}\b/g,
    type: 'OTHER',
    detector: 'regex:gb:sort_code',
    confidence: 0.65,
    region: 'gb',
    domains: ['financial'],
    description: 'UK bank sort code (XX-XX-XX)',
    examples: ['12-34-56'],
    falsePositiveNotes: 'Also matches dates in dd-mm-yy format',
  },
  {
    pattern: /\b\d{7,8}\b/g,
    type: 'OTHER',
    detector: 'regex:gb:bank_account',
    confidence: 0.30,
    region: 'gb',
    domains: ['financial'],
    description: 'UK bank account number (7-8 digits)',
    examples: ['12345678'],
    falsePositiveNotes: 'Extremely broad — disabled by default in low-sensitivity mode',
  },
  {
    pattern: /\b(?:GB)?\d{3}\s?\d{4}\s?\d{2}(?:\s?\d{3})?\b/gi,
    type: 'SSN',
    detector: 'regex:gb:vat',
    confidence: 0.75,
    region: 'gb',
    domains: ['financial', 'legal'],
    description: 'UK VAT number (GB + 9 or 12 digits)',
    examples: ['GB123 4567 89', 'GB123456789'],
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b0\d{4}\s?\d{6}\b/g,
    type: 'PHONE',
    detector: 'regex:gb:phone_landline',
    confidence: 0.80,
    region: 'gb',
    domains: ['contact'],
    description: 'UK landline phone number (e.g., 020 7946 0958)',
    examples: ['01234 567890', '02079 460958'],
  },
  {
    pattern: /\b07\d{3}\s?\d{6}\b/g,
    type: 'PHONE',
    detector: 'regex:gb:phone_mobile',
    confidence: 0.85,
    region: 'gb',
    domains: ['contact'],
    description: 'UK mobile phone number (07XXX XXXXXX)',
    examples: ['07911 123456'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi,
    type: 'ADDRESS',
    detector: 'regex:gb:postcode',
    confidence: 0.80,
    region: 'gb',
    domains: ['contact'],
    description: 'UK postcode (e.g., SW1A 1AA, EC2A 1NT, M1 1AA)',
    examples: ['SW1A 1AA', 'EC2A 1NT', 'M1 1AA', 'B33 8TH'],
  },
];
