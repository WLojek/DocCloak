import type { RegexRule } from '../types.ts';

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:us:ssn',
    confidence: 0.95,
    region: 'us',
    domains: ['identity', 'hr', 'financial'],
    description: 'US Social Security Number (XXX-XX-XXXX)',
    examples: ['123-45-6789', '001-01-0001'],
  },
  {
    pattern: /\b\d{9}\b/g,
    type: 'SSN',
    detector: 'regex:us:ssn_nodash',
    confidence: 0.40,
    region: 'us',
    domains: ['identity', 'hr'],
    description: 'US SSN without dashes (9 digits) — low confidence due to false positives',
    examples: ['123456789'],
    falsePositiveNotes: 'Many 9-digit numbers are not SSNs (zip+4, phone without area, etc.)',
  },
  {
    pattern: /\b\d{2}-\d{7}\b/g,
    type: 'SSN',
    detector: 'regex:us:ein',
    confidence: 0.85,
    region: 'us',
    domains: ['financial', 'legal'],
    description: 'US Employer Identification Number (XX-XXXXXXX)',
    examples: ['12-3456789'],
  },
  {
    pattern: /\b[A-Z]\d{8}\b/g,
    type: 'SSN',
    detector: 'regex:us:passport',
    confidence: 0.70,
    region: 'us',
    domains: ['identity'],
    description: 'US passport number (1 letter + 8 digits)',
    examples: ['C12345678'],
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g,
    type: 'PHONE',
    detector: 'regex:us:phone',
    confidence: 0.85,
    region: 'us',
    domains: ['contact'],
    description: 'US phone number ((XXX) XXX-XXXX, XXX-XXX-XXXX, XXX.XXX.XXXX)',
    examples: ['(555) 123-4567', '555-123-4567', '555.123.4567'],
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b\d{9,18}\b/g,
    type: 'OTHER',
    detector: 'regex:us:bank_routing',
    confidence: 0.30,
    region: 'us',
    domains: ['financial'],
    description: 'US bank routing/account number (9-18 digits) — very low confidence',
    examples: ['021000021'],
    falsePositiveNotes: 'Extremely broad — only useful as a last-resort catch combined with context',
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{5}(?:-\d{4})?\b/g,
    type: 'ADDRESS',
    detector: 'regex:us:zip',
    confidence: 0.50,
    region: 'us',
    domains: ['contact'],
    description: 'US ZIP code (XXXXX or XXXXX-XXXX)',
    examples: ['10001', '90210-1234'],
    falsePositiveNotes: 'Many 5-digit numbers are not ZIP codes',
  },

  // ── Currency (written-out amounts) ────────────────────────
  {
    pattern: /(?:in\s+(?:the\s+)?(?:amount|sum)\s+of|pay(?:able)?(?:\s+the\s+(?:amount|sum))?\s+of)\s+[\p{L}\s-]+(?:dollars?|cents?|pounds?|pence)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:us:currency_words',
    confidence: 0.90,
    region: 'us',
    domains: ['financial'],
    description: 'English amount written in words (e.g., "in the amount of eight thousand five hundred dollars")',
    examples: ['in the amount of eight thousand five hundred dollars'],
  },

  // ── Address (street) ──────────────────────────────────────
  {
    pattern: /\b\d{1,5}\s+(?:(?:N(?:orth)?|S(?:outh)?|E(?:ast)?|W(?:est)?)\.?\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Ct|Court|Pl(?:ace)?|Way|Cir(?:cle)?|Pkwy|Parkway|Terr?(?:ace)?|Hwy|Highway)\.?\b/g,
    type: 'ADDRESS',
    detector: 'regex:us:street',
    confidence: 0.85,
    region: 'us',
    domains: ['contact'],
    description: 'US street address (number + street name + type)',
    examples: ['123 Main Street', '456 N Oak Ave', '7890 West Broadway Blvd'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:,?\s+)?(?:Inc\.?|Corp(?:oration)?\.?|LLC|L\.L\.C\.|Ltd\.?|LLP|L\.L\.P\.|Co\.)\b/gu,
    type: 'COMPANY',
    detector: 'regex:us:company',
    confidence: 0.85,
    region: 'us',
    domains: ['legal', 'financial'],
    description: 'US company name with legal suffix (Inc., Corp., LLC, Ltd., LLP, Co.)',
    examples: ['Acme Corp.', 'Smith & Associates, LLC', 'Global Solutions Inc'],
  },

  // ── Medical ─────────────────────────────────────────────
  {
    pattern: /\b[A-Z]\d{2}(?:\.\d{1,2})?\b/g,
    type: 'OTHER',
    detector: 'regex:us:icd10',
    confidence: 0.60,
    region: 'us',
    domains: ['medical'],
    description: 'ICD-10 diagnosis code (e.g., J18.9, E11.65)',
    examples: ['J18.9', 'E11.65', 'M54.5'],
    falsePositiveNotes: 'Short codes like A01 match many non-medical strings',
  },

  // ── Legal ───────────────────────────────────────────────
  {
    pattern: /\b\d{1,2}:\d{2}-(?:cv|cr|mc|mj|po|ml)-\d{4,6}(?:-[A-Z]+)?\b/gi,
    type: 'OTHER',
    detector: 'regex:us:court_case',
    confidence: 0.90,
    region: 'us',
    domains: ['legal'],
    description: 'US federal court case number (e.g., 1:23-cv-01234-ABC)',
    examples: ['1:23-cv-01234', '2:22-cr-00567-XYZ'],
  },
];
