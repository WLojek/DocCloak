import type { RegexRule } from '../types.ts';

function validatePersonnummer(match: string): boolean {
  const digits = match.replace(/[\s-]/g, '');
  if (digits.length < 10) return false;
  // Use last 10 digits for Luhn check
  const last10 = digits.slice(-10);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let n = parseInt(last10[i], 10) * (i % 2 === 0 ? 2 : 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(last10[9], 10);
}

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{6}[-+]?\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:se:personnummer',
    confidence: 0.85,
    region: 'se',
    domains: ['identity', 'hr', 'medical'],
    description: 'Swedish personnummer (YYMMDD-XXXX or YYMMDDXXXX)',
    examples: ['850523-0006', '8505230006'],
    validate: validatePersonnummer,
  },
  {
    pattern: /\b(?:19|20)\d{6}[-+]?\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:se:personnummer_12',
    confidence: 0.90,
    region: 'se',
    domains: ['identity', 'hr', 'medical'],
    description: 'Swedish personnummer 12-digit format (YYYYMMDD-XXXX)',
    examples: ['19850523-1478', '198505231478'],
  },
  {
    pattern: /\b\d{6}[-+]?\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:se:samordningsnummer',
    confidence: 0.70,
    region: 'se',
    domains: ['identity'],
    description: 'Swedish samordningsnummer (coordination number, day +60)',
    examples: ['850583-1478'],
    falsePositiveNotes: 'Same format as personnummer — differentiated by day > 60',
  },
  {
    pattern: /\b\d{6}-?\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:se:organisationsnummer',
    confidence: 0.60,
    region: 'se',
    domains: ['financial', 'legal'],
    description: 'Swedish organisationsnummer (company number, 10 digits)',
    examples: ['556036-0793'],
    falsePositiveNotes: 'Same 10-digit format as personnummer',
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?46[\s-]?)?0?\d{1,3}[\s-]?\d{2,3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
    type: 'PHONE',
    detector: 'regex:se:phone',
    confidence: 0.75,
    region: 'se',
    domains: ['contact'],
    description: 'Swedish phone number (variable-length area code)',
    examples: ['+46 8 123 45 67', '070-123 45 67'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{3}\s?\d{2}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:se:postal',
    confidence: 0.80,
    region: 'se',
    domains: ['contact'],
    description: 'Swedish postal code (XXX XX) followed by city name',
    examples: ['111 22 Stockholm', '41301 Göteborg'],
  },

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:(?:med\s+)?(?:bokstäver|ord)\s*:\s*|(?:summan|beloppet)\s+)[\p{L}\s-]+(?:kronor|öre)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:se:currency_words',
    confidence: 0.90,
    region: 'se',
    domains: ['financial'],
    description: 'Swedish amount written in words (e.g., "med bokstäver: åttatusen femhundra kronor")',
    examples: ['med bokstäver: åttatusen femhundra kronor'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s-]*(?:gatan|vägen|stigen|torget|platsen|gränd|backen|liden|ängen)\s+\d+[\p{L}]?/giu,
    type: 'ADDRESS',
    detector: 'regex:se:street',
    confidence: 0.90,
    region: 'se',
    domains: ['contact'],
    description: 'Swedish street address (name + gatan/vägen/etc. + number)',
    examples: ['Drottninggatan 42', 'Sveavägen 15', 'Stortorget 3'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:\s+)?(?:AB|HB|KB)\b/gu,
    type: 'COMPANY',
    detector: 'regex:se:company',
    confidence: 0.80,
    region: 'se',
    domains: ['legal', 'financial'],
    description: 'Swedish company name with legal form (AB, HB, KB)',
    examples: ['Volvo AB', 'Handelsbanken AB', 'Ericsson AB'],
  },
];
