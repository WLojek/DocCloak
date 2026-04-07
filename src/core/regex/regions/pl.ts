import type { RegexRule } from '../types.ts';

function validatePesel(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(digits[10], 10);
}

function validateNip(match: string): boolean {
  const digits = match.replace(/\D/g, '');
  if (digits.length !== 10) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  return (sum % 11) === parseInt(digits[9], 10);
}

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{2}[0-3]\d[0-3]\d{6}\b/g,
    type: 'SSN',
    detector: 'regex:pl:pesel',
    confidence: 0.90,
    region: 'pl',
    domains: ['identity', 'hr', 'medical'],
    description: 'Polish PESEL national identification number (11 digits, YYMMDD + 5)',
    examples: ['89052310002', '02271400004'],
    validate: validatePesel,
  },
  {
    pattern: /\b[A-Z]{3}\s?\d{6}\b/g,
    type: 'SSN',
    detector: 'regex:pl:id_card',
    confidence: 0.80,
    region: 'pl',
    domains: ['identity'],
    description: 'Polish ID card number (3 letters + 6 digits)',
    examples: ['ABC 523456'],
    validate: (match: string) => {
      const clean = match.replace(/\s/g, '').toUpperCase();
      if (clean.length !== 9) return false;
      // First 3 chars are letters (A=10..Z=35), remaining 6 are digits
      // Weights: [7, 3, 1, 0, 7, 3, 1, 7, 3] where position 4 (index 3) is the check digit
      const weights = [7, 3, 1, 0, 7, 3, 1, 7, 3];
      let sum = 0;
      for (let i = 0; i < 9; i++) {
        const ch = clean[i];
        const val = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : parseInt(ch, 10);
        if (i === 3) continue; // skip check digit position
        sum += val * weights[i];
      }
      const checkDigit = sum % 10;
      return checkDigit === parseInt(clean[3], 10);
    },
  },
  {
    pattern: /\b[A-Z]{2}\s?\d{7}\b/g,
    type: 'SSN',
    detector: 'regex:pl:passport',
    confidence: 0.70,
    region: 'pl',
    domains: ['identity'],
    description: 'Polish passport number (2 letters + 7 digits)',
    examples: ['AB 1234567', 'CD1234567'],
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b\d{3}-?\d{3}-?\d{2}-?\d{2}\b/g,
    type: 'SSN',
    detector: 'regex:pl:nip',
    confidence: 0.85,
    region: 'pl',
    domains: ['financial', 'legal'],
    description: 'Polish NIP tax identification number (10 digits, XXX-XXX-XX-XX)',
    examples: ['123-456-78-19', '1234567819'],
    validate: validateNip,
  },
  {
    pattern: /\b\d{9}(?:\d{5})?\b/g,
    type: 'SSN',
    detector: 'regex:pl:regon',
    confidence: 0.60,
    region: 'pl',
    domains: ['financial', 'legal'],
    description: 'Polish REGON business registry number (9 or 14 digits)',
    examples: ['123456785'],
    falsePositiveNotes: '9-digit REGON overlaps with many other number formats',
    validate: (match: string) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length === 9) {
        const weights = [8, 9, 2, 3, 4, 5, 6, 7];
        let sum = 0;
        for (let i = 0; i < 8; i++) sum += parseInt(digits[i], 10) * weights[i];
        const checkDigit = sum % 11 === 10 ? 0 : sum % 11;
        return checkDigit === parseInt(digits[8], 10);
      }
      if (digits.length === 14) {
        const weights = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
        let sum = 0;
        for (let i = 0; i < 13; i++) sum += parseInt(digits[i], 10) * weights[i];
        const checkDigit = sum % 11 === 10 ? 0 : sum % 11;
        return checkDigit === parseInt(digits[13], 10);
      }
      return false;
    },
  },
  {
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}\b/g,
    type: 'OTHER',
    detector: 'regex:pl:bank_account',
    confidence: 0.85,
    region: 'pl',
    domains: ['financial'],
    description: 'Polish bank account number (26 digits, often spaced in groups of 4)',
    examples: ['1234 5678 9012 3456 7890 1234 56'],
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?48[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    type: 'PHONE',
    detector: 'regex:pl:phone',
    confidence: 0.80,
    region: 'pl',
    domains: ['contact'],
    description: 'Polish phone number (9 digits, optionally with +48 prefix)',
    examples: ['+48 600 123 456', '600-123-456', '48 600123456'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{2}-\d{3}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:pl:postal',
    confidence: 0.80,
    region: 'pl',
    domains: ['contact'],
    description: 'Polish postal code (XX-XXX) followed by city name',
    examples: ['00-950 Warszawa', '31-501 Kraków', '80-244 Gdańsk Wrzeszcz'],
  },

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:słownie:\s*)[\p{L}\s]+(?:złot(?:ych|y|e)|groszy|grosz(?:e)?)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:pl:currency_words',
    confidence: 0.90,
    region: 'pl',
    domains: ['financial'],
    description: 'Polish amount written in words after "słownie:" (e.g., "słownie: osiem tysięcy pięćset złotych")',
    examples: ['słownie: osiem tysięcy pięćset złotych'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /(?:ul\.|al\.|pl\.|os\.)\s+[\p{L}][\p{L}\s]+\s+\d+[\p{L}]?(?:\s*[/\\]\s*\d+[\p{L}]?)?/gu,
    type: 'ADDRESS',
    detector: 'regex:pl:street',
    confidence: 0.90,
    region: 'pl',
    domains: ['contact'],
    description: 'Polish street address (ul./al./pl./os. + name + number)',
    examples: ['ul. Floriańska 27/3', 'ul. Juliusza Słowackiego 15/8', 'al. Krakowska 42', 'os. Złotego Wieku 12'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s]+(?:Sp(?:ółka)?\s*z\s*o\.?\s*o\.?|Spółka\s+z\s+ograniczon[\p{L}]+\s+odpowiedzialno[\p{L}]+|Sp\.\s*j\.|S\.A\.|Sp\.\s*k\.)/gu,
    type: 'COMPANY',
    detector: 'regex:pl:company',
    confidence: 0.90,
    region: 'pl',
    domains: ['legal', 'financial'],
    description: 'Polish company name with legal form (Sp. z o.o., S.A., Sp. j., Sp. k.)',
    examples: ['Santander Bank Polska S.A.', 'NOVAMED Spółka z ograniczoną odpowiedzialnością'],
  },

  // ── Legal ───────────────────────────────────────────────
  {
    pattern: /\b[IVXLCDM]+\s+(?:K|C|Ca|Cz|Co|Gz|Ga|GCo|GC)\s+\d+\/\d{2,4}\b/g,
    type: 'OTHER',
    detector: 'regex:pl:court_case',
    confidence: 0.90,
    region: 'pl',
    domains: ['legal'],
    description: 'Polish court case signature (e.g., "III K 123/24", "I C 456/2023")',
    examples: ['III K 123/24', 'I C 456/2023'],
  },
  {
    pattern: /\b\d{4}\/\d{8}\/\d{4}\b/g,
    type: 'OTHER',
    detector: 'regex:pl:krs',
    confidence: 0.90,
    region: 'pl',
    domains: ['legal', 'financial'],
    description: 'Polish KRS company registry number',
    examples: ['0000/12345678/0001'],
  },
];
