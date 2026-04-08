import type { RegexRule } from '../types.ts';

// ── Validators ────────────────────────────────────────────

/**
 * ABA routing number checksum.
 * (3*(d1+d4+d7) + 7*(d2+d5+d8) + (d3+d6+d9)) mod 10 == 0
 */
function validateAba(match: string): boolean {
  const d = match.replace(/\D/g, '');
  if (d.length !== 9) return false;
  const n = d.split('').map(Number);
  const sum = 3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8]);
  return sum % 10 === 0;
}

/**
 * NPI Luhn check with the CMS-mandated 80840 prefix.
 * The NPI is 10 digits; Luhn is computed over "80840" + first 9 digits,
 * and the 10th digit must equal the resulting Luhn check digit.
 */
function validateNpi(match: string): boolean {
  const d = match.replace(/\D/g, '');
  if (d.length !== 10) return false;
  const payload = '80840' + d.slice(0, 9);
  let sum = 0;
  let alt = true; // rightmost digit (excluding the check digit) is doubled
  for (let i = payload.length - 1; i >= 0; i--) {
    let n = parseInt(payload[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(d[9], 10);
}

/**
 * DEA number checksum.
 * (d1+d3+d5) + 2*(d2+d4+d6) mod 10 == d7
 * Plus: first letter must be a valid registrant type, second letter is the
 * first letter of the registrant's last name (so any A–Z is allowed there).
 */
function validateDea(match: string): boolean {
  const m = match.toUpperCase();
  if (!/^[ABCDEFGHJKLMPRSTUX][A-Z]\d{7}$/.test(m)) return false;
  const digits = m.slice(2).split('').map(Number);
  const sum = digits[0] + digits[2] + digits[4] + 2 * (digits[1] + digits[3] + digits[5]);
  return sum % 10 === digits[6];
}

// ── Rules ─────────────────────────────────────────────────

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    // SSA structural exclusions: area 000/666/9XX, group 00, serial 0000.
    // Hyphen required for high confidence — bare 9-digit runs collide with
    // phone numbers and account numbers.
    pattern: /\b(?!000|666|9\d{2})[0-8]\d{2}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:us:ssn',
    confidence: 0.92,
    region: 'us',
    domains: ['identity', 'hr', 'financial'],
    description: 'US Social Security Number (SSA-valid ranges, hyphenated)',
    examples: ['123-45-6789', '078-05-1120'],
    falsePositiveNotes: 'Hyphenated form only — un-hyphenated SSNs are indistinguishable from other 9-digit IDs.',
  },
  {
    // ITIN: area always 9, group 50–65, 70–88, 90–92, 94–99 (per IRS).
    pattern: /\b9\d{2}-(?:5\d|6[0-5]|7\d|8[0-8]|9[0-24-9])-\d{4}\b/g,
    type: 'SSN',
    detector: 'regex:us:itin',
    confidence: 0.85,
    region: 'us',
    domains: ['identity', 'financial'],
    description: 'US IRS Individual Taxpayer Identification Number (ITIN)',
    examples: ['912-70-1234', '987-88-4321'],
  },
  {
    // EIN: 2-digit IRS campus prefix + 7 digits. Prefix list per IRS.
    pattern: /\b(?:0[1-6]|1[0-6]|2[0-7]|[35]\d|[468][0-8]|7[1-7]|9[0-58-9])-\d{7}\b/g,
    type: 'SSN',
    detector: 'regex:us:ein',
    confidence: 0.80,
    region: 'us',
    domains: ['financial', 'legal'],
    description: 'US IRS Employer Identification Number (EIN)',
    examples: ['12-3456789', '87-6543210'],
  },
  {
    // US Passport: legacy 9 digits, post-2021 books prefix one letter.
    pattern: /\b[A-Z]?\d{8,9}\b/g,
    type: 'SSN',
    detector: 'regex:us:passport',
    confidence: 0.35,
    region: 'us',
    domains: ['identity'],
    description: 'US passport number (9 alphanumerics)',
    examples: ['123456789', 'A12345678'],
    falsePositiveNotes: 'Very broad — best paired with the word "passport" in context.',
  },

  // ── Healthcare ──────────────────────────────────────────
  {
    // CMS Medicare Beneficiary Identifier: 11 chars, no S/L/O/I/B/Z letters.
    pattern: /\b[1-9][A-HJ-NP-Z][A-HJ-NP-Z0-9]\d[A-HJ-NP-Z][A-HJ-NP-Z0-9]\d[A-HJ-NP-Z]{2}\d{2}\b/g,
    type: 'SSN',
    detector: 'regex:us:mbi',
    confidence: 0.95,
    region: 'us',
    domains: ['medical', 'identity'],
    description: 'Medicare Beneficiary Identifier (MBI, replaces SSN-based HICN)',
    examples: ['1EG4-TE5-MK73', '1AB2CD3EF45'],
  },
  {
    pattern: /\b[ABCDEFGHJKLMPRSTUX][A-Z]\d{7}\b/g,
    type: 'SSN',
    detector: 'regex:us:dea',
    confidence: 0.92,
    region: 'us',
    domains: ['medical'],
    description: 'US DEA registration number (prescriber identifier, with checksum)',
    examples: ['BJ1234563', 'AS9876543'],
    validate: validateDea,
  },
  {
    pattern: /\b\d{10}\b/g,
    type: 'SSN',
    detector: 'regex:us:npi',
    confidence: 0.90,
    region: 'us',
    domains: ['medical'],
    description: 'US National Provider Identifier (NPI, Luhn-validated with 80840 prefix)',
    examples: ['1234567893'],
    falsePositiveNotes: 'Raw 10 digits is broad — Luhn check makes the false-positive rate negligible.',
    validate: validateNpi,
  },

  // ── Financial ───────────────────────────────────────────
  {
    // Federal Reserve valid first-two-digit ranges + ABA mod-10 checksum.
    pattern: /\b(?:0\d|1[0-2]|2[1-9]|3[0-2]|6[1-9]|7[0-2]|80)\d{7}\b/g,
    type: 'OTHER',
    detector: 'regex:us:routing',
    confidence: 0.90,
    region: 'us',
    domains: ['financial'],
    description: 'US ABA bank routing number (9 digits, valid prefix + mod-10 checksum)',
    examples: ['021000021', '011000015'],
    validate: validateAba,
  },

  // ── Contact ─────────────────────────────────────────────
  {
    // NANP: optional +1, area + exchange both 2-9 first digit.
    // Requires at least one separator OR a +1 prefix to keep precision up.
    pattern: /(?:\+1[-.\s]?)?(?:\(([2-9]\d{2})\)[-.\s]?|([2-9]\d{2})[-.\s])([2-9]\d{2})[-.\s](\d{4})\b/g,
    type: 'PHONE',
    detector: 'regex:us:phone',
    confidence: 0.85,
    region: 'us',
    domains: ['contact'],
    description: 'US/NANP phone number (e.g., (555) 555-1234, 555-555-1234, +1 555.555.1234)',
    examples: ['(415) 555-2671', '415-555-2671', '+1 415 555 2671', '415.555.2671'],
    falsePositiveNotes: 'Bare 10-digit runs are excluded to avoid colliding with SSN/account numbers.',
  },

  // ── Address ─────────────────────────────────────────────
  {
    // ZIP+4 only — bare 5-digit ZIP is too noisy without context, so we only
    // ship the high-confidence ZIP+4 form here. Plain 5-digit ZIPs are picked
    // up by the street-address rule when they appear in a real address.
    pattern: /\b\d{5}-\d{4}\b/g,
    type: 'ADDRESS',
    detector: 'regex:us:zip_plus4',
    confidence: 0.80,
    region: 'us',
    domains: ['contact'],
    description: 'US ZIP+4 postal code',
    examples: ['94103-1741', '10001-2345'],
  },
  {
    // US street address: number + street name + USPS street suffix.
    // Common USPS Publication 28 suffixes covered.
    pattern: /\b\d{1,5}[A-Z]?\s+(?:[NSEW]\.?\s+|North\s+|South\s+|East\s+|West\s+)?[A-Z][\w]*(?:\s+[A-Z][\w]*)*\s+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Place|Pl|Square|Sq|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Highway|Hwy|Way|Plaza|Plz|Loop|Alley|Aly|Crossing|Xing|Expressway|Expy|Freeway|Fwy)\b\.?/gi,
    type: 'ADDRESS',
    detector: 'regex:us:street',
    confidence: 0.85,
    region: 'us',
    domains: ['contact'],
    description: 'US street address (number + name + USPS suffix)',
    examples: ['1600 Pennsylvania Ave', '350 5th Avenue', '1 Infinite Loop', '742 Evergreen Terrace'],
  },

  // ── Currency (written-out amounts) ───────────────────────
  {
    pattern: /(?:in\s+(?:the\s+)?(?:amount|sum)\s+of|pay(?:able)?(?:\s+the\s+(?:amount|sum))?\s+of)\s+[\p{L}\s-]+(?:dollars?|cents?)\b/giu,
    type: 'CURRENCY',
    detector: 'regex:us:currency_words',
    confidence: 0.90,
    region: 'us',
    domains: ['financial'],
    description: 'US dollar amount written in words (e.g., "in the amount of eight thousand five hundred dollars")',
    examples: ['in the amount of five thousand dollars', 'payable the sum of two hundred fifty dollars'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\p{L}][\p{L}\s&.']+(?:,?\s+)?(?:Inc\.?|LLC|L\.L\.C\.|Corp\.?|Corporation|Co\.|Company|Ltd\.?|LP|L\.P\.|LLP|L\.L\.P\.|PLLC|P\.C\.)\b/gu,
    type: 'COMPANY',
    detector: 'regex:us:company',
    confidence: 0.85,
    region: 'us',
    domains: ['legal', 'financial'],
    description: 'US company name with legal suffix (Inc, LLC, Corp, etc.)',
    examples: ['Apple Inc.', 'Acme LLC', 'Stark Industries Corp', 'Wayne Enterprises, Inc.'],
  },
];
