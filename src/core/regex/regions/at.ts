import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b[1-9]\d{3}\s?(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}\b/g,
    type: 'SSN',
    detector: 'regex:at:svnr',
    confidence: 0.85,
    region: 'at',
    domains: ['identity', 'hr', 'medical'],
    description: 'Austrian social insurance number (SVNR / Sozialversicherungsnummer, 10 digits)',
    examples: ['1237 010180'],
    validate: (match: string) => {
      const digits = match.replace(/\s/g, '');
      if (digits.length !== 10 || !/^\d{10}$/.test(digits)) return false;

      const serial = parseInt(digits.substring(0, 3), 10);
      if (serial < 100) return false;

      const weights = [3, 7, 9, 0, 5, 8, 4, 2, 1, 6];
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        if (i === 3) continue; // skip check digit position for sum
        sum += parseInt(digits[i], 10) * weights[i];
      }
      const check = sum % 11;
      if (check === 10) return false;
      return check === parseInt(digits[3], 10);
    },
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?43[\s-]?|0)\d{1,4}[\s-]?\d{4,10}\b/g,
    type: 'PHONE',
    detector: 'regex:at:phone',
    confidence: 0.75,
    region: 'at',
    domains: ['contact'],
    description: 'Austrian phone number (variable-length area codes)',
    examples: ['+43 1 12345678', '0664 1234567'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{4}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:at:postal',
    confidence: 0.80,
    region: 'at',
    domains: ['contact'],
    description: 'Austrian postal code (4 digits) followed by city name',
    examples: ['1010 Wien', '5020 Salzburg', '8010 Graz'],
  },
  {
    pattern: /[\p{L}][\p{L}\s-]*(?:straße|strasse|str\.|gasse|weg|platz|ring|allee)\s+\d+[\p{L}]?(?:\s*[/\\]\s*\d+)?/giu,
    type: 'ADDRESS',
    detector: 'regex:at:street',
    confidence: 0.85,
    region: 'at',
    domains: ['contact'],
    description: 'Austrian street address (name + Straße/Gasse/Weg/Platz + number)',
    examples: ['Mariahilfer Straße 45', 'Währinger Str. 12', 'Hauptplatz 1', 'Neubaugasse 7/3'],
  },
];
