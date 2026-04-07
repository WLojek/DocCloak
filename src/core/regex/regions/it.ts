import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b[A-Z]{6}\d{2}[A-EHLMPRST]\d{2}[A-Z]\d{3}[A-Z]\b/gi,
    type: 'SSN',
    detector: 'regex:it:codice_fiscale',
    confidence: 0.90,
    region: 'it',
    domains: ['identity', 'hr', 'medical'],
    description: 'Italian fiscal code (Codice Fiscale, 16 alphanumeric characters)',
    examples: ['RSSMRA85M01H501Q'],
    validate: (match: string) => {
      const code = match.toUpperCase();
      if (code.length !== 16) return false;

      const oddValues: Record<string, number> = {
        '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
        A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
        K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
        U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
      };
      const evenValues: Record<string, number> = {
        '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
        A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
        K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19,
        U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
      };

      let sum = 0;
      for (let i = 0; i < 15; i++) {
        const ch = code[i];
        // Positions are 1-based: odd positions use oddValues, even use evenValues
        sum += (i % 2 === 0) ? oddValues[ch] : evenValues[ch];
      }
      const expectedCheck = String.fromCharCode('A'.charCodeAt(0) + (sum % 26));
      return code[15] === expectedCheck;
    },
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\bIT\d{11}\b/gi,
    type: 'SSN',
    detector: 'regex:it:partita_iva',
    confidence: 0.75,
    region: 'it',
    domains: ['financial', 'legal'],
    description: 'Italian VAT number (Partita IVA, IT + 11 digits)',
    examples: ['IT12345678903'],
    validate: (match: string) => {
      const digits = match.toUpperCase().replace(/^IT/, '');
      if (digits.length !== 11 || !/^\d{11}$/.test(digits)) return false;

      let sum = 0;
      for (let i = 0; i < 11; i++) {
        let n = parseInt(digits[i], 10);
        if (i % 2 === 1) {
          n *= 2;
          if (n > 9) n -= 9;
        }
        sum += n;
      }
      return sum % 10 === 0;
    },
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?39[\s-]?)?3[0-9]{2}[\s-]?\d{3}[\s-]?\d{4}\b/g,
    type: 'PHONE',
    detector: 'regex:it:phone_mobile',
    confidence: 0.80,
    region: 'it',
    domains: ['contact'],
    description: 'Italian mobile phone number (3xx prefix)',
    examples: ['+39 345 123 4567', '3451234567'],
  },
  {
    pattern: /\b(?:\+?39[\s-]?)?0\d{1,3}[\s-]?\d{4,8}\b/g,
    type: 'PHONE',
    detector: 'regex:it:phone_landline',
    confidence: 0.70,
    region: 'it',
    domains: ['contact'],
    description: 'Italian landline phone number (0x prefix)',
    examples: ['+39 06 12345678', '02 12345678'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /(?:via|viale|v\.le|piazza|p\.zza|piazzale|corso|c\.so|largo|vicolo|borgo|salita)\s+[\p{L}][\p{L}\s'.,-]+\s*(?:,?\s*n[°.]?\s*)?\d{1,5}[\p{L}]?/giu,
    type: 'ADDRESS',
    detector: 'regex:it:street',
    confidence: 0.90,
    region: 'it',
    domains: ['contact'],
    description: 'Italian street address (Via/Piazza/Corso + name + number)',
    examples: ['Via Roma, 42', 'Piazza Navona 1', 'Corso Vittorio Emanuele II, n. 23'],
  },
  {
    pattern: /\b\d{5}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:it:postal',
    confidence: 0.80,
    region: 'it',
    domains: ['contact'],
    description: 'Italian postal code (CAP, 5 digits) followed by city name',
    examples: ['00100 Roma', '20121 Milano'],
    falsePositiveNotes: '5-digit postal codes overlap with US ZIP codes and other number formats',
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:\s+)?(?:S\.?r\.?l\.?|S\.?p\.?A\.?|S\.?a\.?s\.?|S\.?n\.?c\.?|S\.?a\.?p\.?a\.?)\b/gu,
    type: 'COMPANY',
    detector: 'regex:it:company',
    confidence: 0.90,
    region: 'it',
    domains: ['legal', 'financial'],
    description: 'Italian company name with legal form (S.r.l., S.p.A., S.a.s., S.n.c., S.a.p.a.)',
    examples: ['Fiat Chrysler S.p.A.', 'Ristorante Da Mario S.r.l.'],
  },
];
