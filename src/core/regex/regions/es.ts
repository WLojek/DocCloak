import type { RegexRule } from '../types.ts';

function validateDni(match: string): boolean {
  const clean = match.replace(/[\s-]/g, '').toUpperCase();
  const letters = 'TRWAGMYFPDXBNJZSQVHLCKE';
  const numPart = clean.slice(0, -1);
  const letter = clean.slice(-1);
  const num = parseInt(numPart, 10);
  if (isNaN(num)) return false;
  return letters[num % 23] === letter;
}

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{8}[\s-]?[A-Z]\b/gi,
    type: 'SSN',
    detector: 'regex:es:dni',
    confidence: 0.90,
    region: 'es',
    domains: ['identity'],
    description: 'Spanish DNI (8 digits + letter)',
    examples: ['12345678Z', '12345678-Z'],
    validate: validateDni,
  },
  {
    pattern: /\b[XYZ][\s-]?\d{7}[\s-]?[A-Z]\b/gi,
    type: 'SSN',
    detector: 'regex:es:nie',
    confidence: 0.90,
    region: 'es',
    domains: ['identity'],
    description: 'Spanish NIE for foreigners (X/Y/Z + 7 digits + letter)',
    examples: ['X1234567L', 'Y-1234567-A'],
  },
  {
    pattern: /\b[A-H]\d{7}[0-9A-J]\b/gi,
    type: 'SSN',
    detector: 'regex:es:cif',
    confidence: 0.80,
    region: 'es',
    domains: ['financial', 'legal'],
    description: 'Spanish CIF company tax ID',
    examples: ['A12345678', 'B87654321'],
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b(?:ES)?\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/gi,
    type: 'SSN',
    detector: 'regex:es:cuenta_bancaria',
    confidence: 0.80,
    region: 'es',
    domains: ['financial'],
    description: 'Spanish bank account number (CCC, 20 digits)',
    examples: ['ES12 1234 5678 9012 3456 7890'],
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?34[\s-]?)?[6789]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    type: 'PHONE',
    detector: 'regex:es:phone',
    confidence: 0.80,
    region: 'es',
    domains: ['contact'],
    description: 'Spanish phone number (9 digits, optionally with +34)',
    examples: ['+34 612 345 678', '912 345 678'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{5}\s+[\p{L}][\p{L}\s'-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:es:postal',
    confidence: 0.75,
    region: 'es',
    domains: ['contact'],
    description: 'Spanish postal code (5 digits) followed by city name',
    examples: ['28001 Madrid', '08001 Barcelona'],
  },

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:(?:en\s+)?(?:letras?|palabras?)\s*:\s*|(?:la\s+)?(?:cantidad|suma)\s+de\s+)[\p{L}\s-]+(?:euros?|céntimos?|pesos?|centavos?)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:es:currency_words',
    confidence: 0.90,
    region: 'es',
    domains: ['financial'],
    description: 'Spanish amount written in words (e.g., "en letras: ocho mil quinientos euros")',
    examples: ['en letras: ocho mil quinientos euros'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /(?:(?:C(?:alle)?|Av(?:enida|da)?|Avda|Pza|Plaza|Pl|Paseo|P\.º|Ronda|Ctra|Carretera|Camino|Travesía|Glorieta)\.?\s+)[\p{L}][\p{L}\s'-]+(?:,?\s*(?:n\.?º?\s*)?\d+)?/giu,
    type: 'ADDRESS',
    detector: 'regex:es:street',
    confidence: 0.85,
    region: 'es',
    domains: ['contact'],
    description: 'Spanish street address (Calle/Avenida/Plaza + name + optional number)',
    examples: ['Calle Mayor 15', 'Av. de la Constitución 3', 'Plaza de España'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:\s+)?(?:S\.L\.U\.|S\.L\.U|S\.L\.|S\.L|S\.A\.U\.|S\.A\.U|S\.A\.|S\.A|S\.C\.)\b/gu,
    type: 'COMPANY',
    detector: 'regex:es:company',
    confidence: 0.90,
    region: 'es',
    domains: ['legal', 'financial'],
    description: 'Spanish company name with legal form (S.L., S.A., S.L.U., S.A.U., S.C.)',
    examples: ['Telefónica S.A.', 'Construcciones García S.L.', 'Inditex S.A.'],
  },

  // ── Medical ─────────────────────────────────────────────
  {
    pattern: /\b[A-Z]{4}\d{10}\b/gi,
    type: 'SSN',
    detector: 'regex:es:nuss',
    confidence: 0.70,
    region: 'es',
    domains: ['medical', 'hr'],
    description: 'Spanish Social Security number (NUSS)',
    examples: ['ABCD1234567890'],
  },
];
