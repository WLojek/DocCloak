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
    confidence: 0.50,
    region: 'pt',
    domains: ['financial', 'identity'],
    description: 'Portuguese NIF tax number (9 digits)',
    examples: ['123456789'],
    falsePositiveNotes: '9 digits is very broad',
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
];
