import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  {
    pattern: /\b(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])\d{2}[ABCDEFYXWVU+-]\d{3}[\dA-FHJK-NPR-Y]\b/gi,
    type: 'SSN',
    detector: 'regex:fi:hetu',
    confidence: 0.90,
    region: 'fi',
    domains: ['identity', 'hr'],
    description: 'Finnish personal identity code (henkilötunnus / HETU)',
    examples: ['131052-308T'],
    validate: (match: string) => {
      const upper = match.toUpperCase();
      const ddmmyy = upper.slice(0, 6);
      const nnn = upper.slice(7, 10);
      const checkChar = upper[10];
      const number = parseInt(ddmmyy + nnn, 10);
      const checkChars = '0123456789ABCDEFHJKLMNPRSTUVWXY';
      const remainder = number % 31;
      return checkChars[remainder] === checkChar;
    },
  },
  {
    pattern: /\b(?:\+?358[\s-]?|0)[1-9]\d?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g,
    type: 'PHONE',
    detector: 'regex:fi:phone',
    confidence: 0.80,
    region: 'fi',
    domains: ['contact'],
    description: 'Finnish phone number',
  },
  {
    pattern: /\b\d{5}\s+[\p{L}][\p{L}\s-]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:fi:postal-city',
    confidence: 0.80,
    region: 'fi',
    domains: ['contact'],
    description: 'Finnish postal code followed by city name',
  },
];
