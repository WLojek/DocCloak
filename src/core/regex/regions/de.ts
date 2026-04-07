import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b[CFGHJKLMNPRTVWXYZ]\d{2}[CFGHJKLMNPRTVWXYZ0-9]{6}\d\b/g,
    type: 'SSN',
    detector: 'regex:de:personalausweis',
    confidence: 0.75,
    region: 'de',
    domains: ['identity'],
    description: 'German ID card number (Personalausweisnummer)',
    examples: ['T220001297'],
  },
  {
    pattern: /\b[CFGHJKLMNPRTVWXYZ]\d{2}[CFGHJKLMNPRTVWXYZ0-9]{5}\d[A-Z]\d{7}\b/g,
    type: 'SSN',
    detector: 'regex:de:passport',
    confidence: 0.75,
    region: 'de',
    domains: ['identity'],
    description: 'German passport number',
    examples: ['C01X00T47D1234567'],
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b\d{2,3}\/?\d{3}\/?\d{4,5}\b/g,
    type: 'SSN',
    detector: 'regex:de:steuernummer',
    confidence: 0.60,
    region: 'de',
    domains: ['financial'],
    description: 'German tax number (Steuernummer, 10-11 digits, format varies by state)',
    examples: ['93/815/08152', '2181508152'],
    falsePositiveNotes: 'Format varies by Bundesland — hard to validate precisely',
  },
  {
    pattern: /\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/g,
    type: 'SSN',
    detector: 'regex:de:steuerid',
    confidence: 0.80,
    region: 'de',
    domains: ['financial', 'identity'],
    description: 'German tax ID (Steuerliche Identifikationsnummer, 11 digits)',
    examples: ['12 345 678 903'],
    validate: (match: string) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length !== 11) return false;
      if (digits[0] === '0') return false;
      // Check digit validation (ISO 7064 Mod 11,10)
      let product = 10;
      for (let i = 0; i < 10; i++) {
        let sum = (parseInt(digits[i], 10) + product) % 10;
        if (sum === 0) sum = 10;
        product = (sum * 2) % 11;
      }
      const checkDigit = (11 - product) % 10;
      return checkDigit === parseInt(digits[10], 10);
    },
  },
  {
    pattern: /\b(?:DE)?\d{9}\b/gi,
    type: 'SSN',
    detector: 'regex:de:vat',
    confidence: 0.65,
    region: 'de',
    domains: ['financial', 'legal'],
    description: 'German VAT number (USt-IdNr., DE + 9 digits)',
    examples: ['DE123456789'],
    falsePositiveNotes: 'Without DE prefix, 9 digits alone has many false positives',
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?49[\s-]?)?\(?\d{2,5}\)?[\s-]?\d{3,10}\b/g,
    type: 'PHONE',
    detector: 'regex:de:phone',
    confidence: 0.70,
    region: 'de',
    domains: ['contact'],
    description: 'German phone number (variable-length area codes)',
    examples: ['+49 30 12345678', '089/12345678', '(030) 12345678'],
    falsePositiveNotes: 'Variable-length area codes make this pattern broad',
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{5}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:de:postal',
    confidence: 0.80,
    region: 'de',
    domains: ['contact'],
    description: 'German postal code (5 digits) followed by city name',
    examples: ['10115 Berlin', '80331 München'],
  },

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:in\s+(?:Höhe|Worten?)\s+(?:von\s+)?|(?:Betrag|Summe)\s+von\s+)[\p{L}\s-]+(?:Euro|Cent)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:de:currency_words',
    confidence: 0.90,
    region: 'de',
    domains: ['financial'],
    description: 'German amount written in words (e.g., "in Höhe von achttausendfünfhundert Euro")',
    examples: ['in Höhe von achttausendfünfhundert Euro'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s-]*(?:straße|strasse|str\.|weg|gasse|platz|allee|ring|damm|ufer|chaussee)\s+\d+[\p{L}]?(?:\s*[/\\]\s*\d+)?/giu,
    type: 'ADDRESS',
    detector: 'regex:de:street',
    confidence: 0.90,
    region: 'de',
    domains: ['contact'],
    description: 'German street address (name + straße/str./weg/gasse/platz + number)',
    examples: ['Friedrichstraße 43', 'Berliner Str. 12', 'Hauptplatz 1', 'Am Damm 7a'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.]+(?:\s+)?(?:GmbH|AG|KG|OHG|e\.?\s?V\.?|GbR|UG|mbH|KGaA)\b/gu,
    type: 'COMPANY',
    detector: 'regex:de:company',
    confidence: 0.90,
    region: 'de',
    domains: ['legal', 'financial'],
    description: 'German company name with legal form (GmbH, AG, KG, OHG, e.V., GbR, UG)',
    examples: ['Deutsche Bank AG', 'Siemens GmbH', 'Bosch KG'],
  },

  // ── Medical ─────────────────────────────────────────────
  {
    pattern: /\b[A-Z]\d{2}(?:\.\d{1,2})?(?:\s?[GLRAZ])?\b/g,
    type: 'OTHER',
    detector: 'regex:de:icd10gm',
    confidence: 0.55,
    region: 'de',
    domains: ['medical'],
    description: 'ICD-10-GM diagnosis code (German modification)',
    examples: ['J18.9 G', 'E11.65'],
    falsePositiveNotes: 'Very short codes — high false positive risk',
  },

  // ── Insurance ───────────────────────────────────────────
  {
    pattern: /\b\d{2}(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}[A-Z]\d{2}\d\b/gi,
    type: 'SSN',
    detector: 'regex:de:sozialversicherung',
    confidence: 0.75,
    region: 'de',
    domains: ['hr', 'identity'],
    description: 'German social insurance number (Sozialversicherungsnummer, 12 chars: area + DDMMYY birth date + letter + serial + check digit)',
    examples: ['12010182A056'],
  },
];
