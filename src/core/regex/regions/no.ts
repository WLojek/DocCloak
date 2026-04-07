import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{6}\s?\d{5}\b/g,
    type: 'SSN',
    detector: 'regex:no:fodselsnummer',
    confidence: 0.80,
    region: 'no',
    domains: ['identity', 'hr', 'medical'],
    description: 'Norwegian fødselsnummer (birth number, 11 digits, DDMMYY + 5)',
    examples: ['01019912368'],
    falsePositiveNotes: '11-digit sequences are common in other contexts',
    validate: (match: string) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length !== 11) return false;
      const day = parseInt(digits.substring(0, 2), 10);
      // Fødselsnummer has day 01-31; D-nummer has day 41-71
      if (day >= 41) return false;
      const d = digits.split('').map(Number);
      // Control digit 1
      const k1 = 11 - ((3*d[0] + 7*d[1] + 6*d[2] + 1*d[3] + 8*d[4] + 9*d[5] + 4*d[6] + 5*d[7] + 2*d[8]) % 11);
      const c1 = k1 === 11 ? 0 : k1;
      if (c1 === 10 || c1 !== d[9]) return false;
      // Control digit 2
      const k2 = 11 - ((5*d[0] + 4*d[1] + 3*d[2] + 2*d[3] + 7*d[4] + 6*d[5] + 5*d[6] + 4*d[7] + 3*d[8] + 2*d[9]) % 11);
      const c2 = k2 === 11 ? 0 : k2;
      if (c2 === 10 || c2 !== d[10]) return false;
      return true;
    },
  },
  {
    pattern: /\b\d{6}\s?\d{5}\b/g,
    type: 'SSN',
    detector: 'regex:no:d_nummer',
    confidence: 0.40,
    region: 'no',
    domains: ['identity'],
    description: 'Norwegian D-nummer (temporary ID for foreigners, 11 digits, day +40)',
    examples: ['41019912345'],
    falsePositiveNotes: 'Very broad match — 9 digits',
    validate: (match: string) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length !== 11) return false;
      const day = parseInt(digits.substring(0, 2), 10);
      // D-nummer: first digit has 4 added, so day is 41-71
      if (day < 41 || day > 71) return false;
      return true;
    },
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b\d{9}\s?(?:MVA)?\b/g,
    type: 'SSN',
    detector: 'regex:no:orgnr',
    confidence: 0.60,
    region: 'no',
    domains: ['financial', 'legal'],
    description: 'Norwegian organization number (9 digits, optionally followed by MVA)',
    examples: ['123456789', '123456789 MVA'],
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?47[\s-]?)?\d{2}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{2}\b/g,
    type: 'PHONE',
    detector: 'regex:no:phone',
    confidence: 0.80,
    region: 'no',
    domains: ['contact'],
    description: 'Norwegian phone number (8 digits, optionally with +47)',
    examples: ['+47 12 34 56 78', '12345678'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{4}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:no:postal',
    confidence: 0.80,
    region: 'no',
    domains: ['contact'],
    description: 'Norwegian postal code (4 digits) followed by city name',
    examples: ['0001 Oslo', '5003 Bergen'],
  },

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:(?:med\s+)?(?:bokstaver|ord)\s*:\s*|(?:summen|beløpet)\s+)[\p{L}\s-]+(?:kroner|øre)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:no:currency_words',
    confidence: 0.90,
    region: 'no',
    domains: ['financial'],
    description: 'Norwegian amount written in words (e.g., "med bokstaver: åtte tusen fem hundre kroner")',
    examples: ['med bokstaver: åtte tusen fem hundre kroner'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s-]*(?:gata|gaten|gate|veien|vegen|vei|veg|stien|torget|plassen|plass|allé|alleen)\s+\d+[\p{L}]?/giu,
    type: 'ADDRESS',
    detector: 'regex:no:street',
    confidence: 0.90,
    region: 'no',
    domains: ['contact'],
    description: 'Norwegian street address (name + gate/veien/vei/etc. + number)',
    examples: ['Karl Johans gate 22', 'Storgata 15', 'Bygdøy allé 3'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:\s+)?(?:AS|ASA|ANS|DA)\b/gu,
    type: 'COMPANY',
    detector: 'regex:no:company',
    confidence: 0.80,
    region: 'no',
    domains: ['legal', 'financial'],
    description: 'Norwegian company name with legal form (AS, ASA, ANS, DA)',
    examples: ['Equinor ASA', 'Telenor ASA', 'Nordea Bank ASA'],
  },
];
