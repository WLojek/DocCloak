import type { RegexRule } from '../types.ts';

function validateNir(match: string): boolean {
  const digits = match.replace(/\s/g, '');
  if (digits.length < 13) return false;
  // First digit: 1 (male) or 2 (female)
  if (!/^[12]/.test(digits)) return false;
  return true;
}

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}(?:\s?\d{2})?\b/g,
    type: 'SSN',
    detector: 'regex:fr:nir',
    confidence: 0.90,
    region: 'fr',
    domains: ['identity', 'medical', 'hr'],
    description: 'French NIR / INSEE number (numéro de sécurité sociale, 13+2 digits)',
    examples: ['1 85 05 78 049 013 28', '2 99 12 75 115 001'],
    validate: validateNir,
  },
  {
    pattern: /\b\d{2}[A-Z]{2}\d{5}\b/g,
    type: 'SSN',
    detector: 'regex:fr:passport',
    confidence: 0.75,
    region: 'fr',
    domains: ['identity'],
    description: 'French passport number (2 digits + 2 letters + 5 digits)',
    examples: ['12AB34567'],
  },
  {
    pattern: /\b\d{12}\b/g,
    type: 'SSN',
    detector: 'regex:fr:cni',
    confidence: 0.40,
    region: 'fr',
    domains: ['identity'],
    description: 'French national ID card number (12 digits, new format)',
    examples: ['123456789012'],
    falsePositiveNotes: 'Very broad — 12 digits matches many things',
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b\d{3}\s?\d{3}\s?\d{3}(?:\s?\d{5})?\b/g,
    type: 'SSN',
    detector: 'regex:fr:siret',
    confidence: 0.65,
    region: 'fr',
    domains: ['financial', 'legal'],
    description: 'French SIRET (14 digits) or SIREN (9 digits) business number',
    examples: ['362 521 879 00034', '362 521 879'],
    falsePositiveNotes: '9-digit SIREN overlaps with many formats',
  },
  {
    pattern: /\b(?:FR)?\d{2}\s?\d{9}\b/gi,
    type: 'SSN',
    detector: 'regex:fr:vat',
    confidence: 0.75,
    region: 'fr',
    domains: ['financial', 'legal'],
    description: 'French VAT number (FR + 2 digits + 9 digits SIREN)',
    examples: ['FR12 362521879', 'FR 12362521879'],
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b0[1-9](?:\s?\d{2}){4}\b/g,
    type: 'PHONE',
    detector: 'regex:fr:phone',
    confidence: 0.85,
    region: 'fr',
    domains: ['contact'],
    description: 'French phone number (0X XX XX XX XX)',
    examples: ['01 23 45 67 89', '06 12 34 56 78', '0612345678'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{5}\s+[\p{L}][\p{L}\s'-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:fr:postal',
    confidence: 0.80,
    region: 'fr',
    domains: ['contact'],
    description: 'French postal code (5 digits) followed by city name',
    examples: ['75008 Paris', '69001 Lyon', "13001 Marseille"],
  },

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:(?:soit|montant)\s+(?:en\s+)?(?:lettres?|toutes?\s+lettres?)\s*:\s*|(?:la\s+)?somme\s+de\s+)[\p{L}\s'-]+(?:euros?|centimes?)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:fr:currency_words',
    confidence: 0.90,
    region: 'fr',
    domains: ['financial'],
    description: 'French amount written in words (e.g., "soit en lettres: huit mille cinq cents euros")',
    examples: ['soit en lettres: huit mille cinq cents euros'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /\b\d{1,5}(?:\s*(?:bis|ter))?\s*,?\s*(?:rue|avenue|av\.|boulevard|bd\.?|place|pl\.|impasse|allée|passage|chemin|route|quai|cours|square|voie|sentier|résidence)\s+[\p{L}][\p{L}\s'-]+/giu,
    type: 'ADDRESS',
    detector: 'regex:fr:street',
    confidence: 0.90,
    region: 'fr',
    domains: ['contact'],
    description: 'French street address (number + rue/avenue/boulevard + name)',
    examples: ['12 rue de Rivoli', '42 avenue des Champs-Élysées', '8 bis boulevard Haussmann'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:\s+)?(?:SARL|SAS|SA|EURL|SCI|SNC|SASU)\b/gu,
    type: 'COMPANY',
    detector: 'regex:fr:company',
    confidence: 0.90,
    region: 'fr',
    domains: ['legal', 'financial'],
    description: 'French company name with legal form (SARL, SAS, SA, EURL, SCI, SNC)',
    examples: ['Total SA', 'Capgemini SAS', 'Dupont et Fils SARL'],
  },

  // ── Medical ─────────────────────────────────────────────
  {
    pattern: /\b\d{1}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\b/g,
    type: 'OTHER',
    detector: 'regex:fr:carte_vitale',
    confidence: 0.70,
    region: 'fr',
    domains: ['medical'],
    description: 'French Carte Vitale number (same as NIR, 13 digits)',
    examples: ['1 85 05 780 490'],
    falsePositiveNotes: 'Duplicate of NIR — overlap resolution will keep one',
  },
];
