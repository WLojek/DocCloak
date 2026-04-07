import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{9}\s?[A-Z]{2}\d\b/gi,
    type: 'SSN',
    detector: 'regex:pt:cc',
    confidence: 0.85,
    region: 'pt',
    domains: ['identity'],
    description: 'Portuguese Cartão de Cidadão number (citizen card)',
    examples: ['123456789 ZZ1'],
  },
  {
    pattern: /\b\d{9}\b/g,
    type: 'SSN',
    detector: 'regex:pt:nif',
    confidence: 0.80,
    region: 'pt',
    domains: ['financial', 'identity'],
    description: 'Portuguese NIF tax number (9 digits)',
    examples: ['123456789'],
    falsePositiveNotes: '9 digits is very broad',
    validate: (match: string) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length !== 9) return false;
      // First digit must not be 0, 3, 4, or 7
      const first = parseInt(digits[0], 10);
      if (first === 0 || first === 3 || first === 4 || first === 7) return false;
      const weights = [9, 8, 7, 6, 5, 4, 3, 2];
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += parseInt(digits[i], 10) * weights[i];
      const remainder = sum % 11;
      const checkDigit = remainder < 2 ? 0 : 11 - remainder;
      return checkDigit === parseInt(digits[8], 10);
    },
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?351[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    type: 'PHONE',
    detector: 'regex:pt:phone',
    confidence: 0.80,
    region: 'pt',
    domains: ['contact'],
    description: 'Portuguese phone number (9 digits, optionally with +351)',
    examples: ['+351 912 345 678', '912-345-678'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{4}-\d{3}\s+[\p{L}][\p{L}\s'-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:pt:postal',
    confidence: 0.85,
    region: 'pt',
    domains: ['contact'],
    description: 'Portuguese postal code (XXXX-XXX) followed by city name',
    examples: ['1000-001 Lisboa', '4000-322 Porto'],
  },

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:(?:por\s+)?extenso\s*:\s*|(?:a\s+)?(?:quantia|importância|soma)\s+de\s+)[\p{L}\s-]+(?:euros?|cêntimos?|reais|centavos?)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:pt:currency_words',
    confidence: 0.90,
    region: 'pt',
    domains: ['financial'],
    description: 'Portuguese amount written in words (e.g., "por extenso: oito mil e quinhentos euros")',
    examples: ['por extenso: oito mil e quinhentos euros'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /(?:(?:Rua|R\.|Avenida|Av\.|Praça|Pç\.|Travessa|Tv\.|Largo|Lg\.|Alameda|Al\.|Estrada|Est\.)\s+)[\p{L}][\p{L}\s'-]+(?:,?\s*(?:n\.?º?\s*)?\d+)?/giu,
    type: 'ADDRESS',
    detector: 'regex:pt:street',
    confidence: 0.85,
    region: 'pt',
    domains: ['contact'],
    description: 'Portuguese street address (Rua/Avenida/Praça + name + optional number)',
    examples: ['Rua Augusta 42', 'Av. da Liberdade 10', 'Praça do Comércio'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:\s+)?(?:Lda\.?|S\.A\.?|SGPS)\b/gu,
    type: 'COMPANY',
    detector: 'regex:pt:company',
    confidence: 0.90,
    region: 'pt',
    domains: ['legal', 'financial'],
    description: 'Portuguese company name with legal form (Lda., S.A., SGPS)',
    examples: ['Galp Energia S.A.', 'Construções Silva Lda.', 'EDP SGPS'],
  },
];
