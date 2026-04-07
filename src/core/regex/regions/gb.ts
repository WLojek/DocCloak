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
    validate: (match: string) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length !== 10) return false;
      const weights = [10, 9, 8, 7, 6, 5, 4, 3, 2];
      let sum = 0;
      for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * weights[i];
      const checkDigit = 11 - (sum % 11);
      if (checkDigit === 11) return parseInt(digits[9], 10) === 0;
      if (checkDigit === 10) return false; // invalid
      return checkDigit === parseInt(digits[9], 10);
    },
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

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:in\s+(?:the\s+)?(?:amount|sum)\s+of|pay(?:able)?(?:\s+the\s+(?:amount|sum))?\s+of)\s+[\p{L}\s-]+(?:pounds?|pence|sterling)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:gb:currency_words',
    confidence: 0.90,
    region: 'gb',
    domains: ['financial'],
    description: 'English (UK) amount written in words (e.g., "in the amount of eight thousand five hundred pounds")',
    examples: ['in the amount of eight thousand five hundred pounds'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /\b\d{1,4}[A-Z]?\s+[A-Z][\w]+(?:\s+[A-Z][\w]+)*\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Close|Cl|Crescent|Cres|Terrace|Terr|Place|Pl|Gardens|Gdns|Grove|Way|Court|Ct|Square|Sq|Mews|Row|Rise|Hill|Park|Gate|Walk|Green|Parade|Wharf)\.?\b/gi,
    type: 'ADDRESS',
    detector: 'regex:gb:street',
    confidence: 0.85,
    region: 'gb',
    domains: ['contact'],
    description: 'UK street address (number + street name + type)',
    examples: ['10 Downing Street', '221B Baker Street', '42 Oxford Road'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:,?\s+)?(?:Ltd\.?|PLC|LLP|L\.L\.P\.)\b/gu,
    type: 'COMPANY',
    detector: 'regex:gb:company',
    confidence: 0.85,
    region: 'gb',
    domains: ['legal', 'financial'],
    description: 'UK company name with legal suffix (Ltd, PLC, LLP)',
    examples: ['Barclays PLC', 'Tesco Ltd', 'Deloitte LLP'],
  },
];
