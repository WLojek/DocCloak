import type { RegexRule } from './types.ts';

// ── Validation helpers ──────────────────────────────────────

function luhnCheck(num: string): boolean {
  const digits = num.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function isValidIpOctet(ip: string): boolean {
  return ip.split('.').every(octet => {
    const n = parseInt(octet, 10);
    return n >= 0 && n <= 255;
  });
}

// ── Rules ───────────────────────────────────────────────────

export const rules: RegexRule[] = [
  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    type: 'EMAIL',
    detector: 'regex:universal:email',
    confidence: 0.95,
    region: 'universal',
    domains: ['contact'],
    description: 'Email address',
    examples: ['john@example.com', 'user.name+tag@domain.co.uk'],
  },
  {
    pattern: /\+\d[\d\s()-]{7,18}\d/g,
    type: 'PHONE',
    detector: 'regex:universal:phone_intl',
    confidence: 0.85,
    region: 'universal',
    domains: ['contact'],
    description: 'International phone number with + prefix',
    examples: ['+1 (555) 123-4567', '+48 600 123 456', '+44 20 7946 0958'],
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b[A-Z]{2}\s?\d{2}[\s]?[A-Z\d\s]{10,30}\b/g,
    type: 'IBAN',
    detector: 'regex:universal:iban',
    confidence: 0.90,
    region: 'universal',
    domains: ['financial'],
    description: 'IBAN (2-letter country code + 2 check digits + up to 30 alphanumeric)',
    examples: ['GB29 NWBK 6016 1331 9268 19', 'DE89 3704 0044 0532 0130 00', 'PL61 1090 1014 0000 0712 1981 2874'],
  },
  {
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/g,
    type: 'CREDIT_CARD',
    detector: 'regex:universal:credit_card',
    confidence: 0.90,
    region: 'universal',
    domains: ['financial'],
    description: 'Credit/debit card number (13-19 digits, possibly spaced/dashed)',
    examples: ['4532 0151 1283 0366', '5425-2334-3010-9903'],
    validate: luhnCheck,
    falsePositiveNotes: 'Luhn validation reduces false positives from random digit sequences',
  },
  {
    pattern: /[$€£¥₹₽₩₺₴]\s?\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?\b/g,
    type: 'CURRENCY',
    detector: 'regex:universal:currency_symbol_prefix',
    confidence: 0.80,
    region: 'universal',
    domains: ['financial'],
    description: 'Currency amount with leading symbol ($, €, £, ¥, ₹, ₽, ₩, ₺, ₴)',
    examples: ['$45,000', '€1.234,56', '£100.00', '¥50,000'],
  },
  {
    pattern: /\b\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?\s?(?:USD|EUR|GBP|CHF|JPY|PLN|SEK|NOK|DKK|CZK|HUF|RON|BGN|HRK|RUB|UAH|TRY|BRL|ARS|MXN|COP|CLP|PEN|INR|CNY|KRW|AUD|CAD|NZD|ZAR|SGD|HKD|TWD|THB|MYR|IDR|PHP|VND|AED|SAR|QAR|KWD|BHD|OMR|ILS|EGP|NGN|KES|GHS|TZS|UGX)\b/g,
    type: 'CURRENCY',
    detector: 'regex:universal:currency_code_suffix',
    confidence: 0.80,
    region: 'universal',
    domains: ['financial'],
    description: 'Currency amount with trailing ISO code (e.g., "1,000.00 USD")',
    examples: ['1,000.00 USD', '45 000 PLN', '100.50 EUR'],
  },
  {
    pattern: /\b\d{1,3}(?:[,.\s]\d{3})*(?:[.,]\d{1,2})?\s?(?:zł|kr|Kč|lei|лв|Ft|kn|₽|грн|₺|R\$|S\/\.|руб|₹|元|圆|円|원|ر\.س|ر\.ق|د\.إ|₪|₦|₵|₱|₫|₸|₼|₾|฿|RM|Rp|đ)(?=\s|$|[.,;:!?)}\]])/g,
    type: 'CURRENCY',
    detector: 'regex:universal:currency_symbol_suffix',
    confidence: 0.85,
    region: 'universal',
    domains: ['financial'],
    description: 'Currency amount with trailing local symbol (zł, kr, Kč, lei, etc.)',
    examples: ['8 500,00 zł', '1 200 kr', '3.500 Kč', '10 000 lei', '5 000 Ft'],
  },

  // ── Technical ───────────────────────────────────────────
  {
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    type: 'IP_ADDRESS',
    detector: 'regex:universal:ipv4',
    confidence: 0.90,
    region: 'universal',
    domains: ['technical'],
    description: 'IPv4 address',
    examples: ['192.168.1.1', '10.0.0.255', '172.16.0.1'],
    validate: isValidIpOctet,
  },
  {
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    type: 'IP_ADDRESS',
    detector: 'regex:universal:ipv6',
    confidence: 0.90,
    region: 'universal',
    domains: ['technical'],
    description: 'IPv6 address (full form)',
    examples: ['2001:0db8:85a3:0000:0000:8a2e:0370:7334'],
  },
  {
    pattern: /\b[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}\b/g,
    type: 'OTHER',
    detector: 'regex:universal:mac_address',
    confidence: 0.85,
    region: 'universal',
    domains: ['technical'],
    description: 'MAC address (colon-separated)',
    examples: ['00:1B:44:11:3A:B7'],
  },

  // ── Dates ───────────────────────────────────────────────
  {
    pattern: /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g,
    type: 'DATE',
    detector: 'regex:universal:date_numeric',
    confidence: 0.75,
    region: 'universal',
    domains: ['general'],
    description: 'Numeric date (dd.mm.yyyy, dd/mm/yyyy, mm/dd/yyyy)',
    examples: ['15.03.2025', '03/15/2025', '1.1.2024'],
    falsePositiveNotes: 'Cannot distinguish dd/mm/yyyy from mm/dd/yyyy — both valid',
  },
  {
    pattern: /\b\d{4}-\d{2}-\d{2}\b/g,
    type: 'DATE',
    detector: 'regex:universal:date_iso',
    confidence: 0.80,
    region: 'universal',
    domains: ['general'],
    description: 'ISO 8601 date (yyyy-mm-dd)',
    examples: ['2025-03-15', '1990-01-01'],
  },
  {
    pattern: /\b\d{1,2}\s+[\p{L}]{3,}\s+\d{4}\b/gu,
    type: 'DATE',
    detector: 'regex:universal:date_word',
    confidence: 0.80,
    region: 'universal',
    domains: ['general'],
    description: 'Date with month name in any language (e.g., "10 marca 2025", "15 March 2025")',
    examples: ['10 March 2025', '15 marca 2025', '1 janvier 2024'],
  },
  {
    pattern: /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/gi,
    type: 'DATE',
    detector: 'regex:universal:date_month_first',
    confidence: 0.85,
    region: 'universal',
    domains: ['general'],
    description: 'English date with month name first (e.g., "March 15, 2025")',
    examples: ['March 15, 2025', 'Jan 1 2024', 'December 25, 2023'],
  },

  // ── Identity (generic) ─────────────────────────────────
  {
    pattern: /(?<=[\p{L}][\p{L}\s]{0,30}[:#]\s?)[A-Z0-9]{2,4}[\s-]?[\d]{4,}(?:[\s-][\d]+)*/giu,
    type: 'SSN',
    detector: 'regex:universal:labeled_id',
    confidence: 0.70,
    region: 'universal',
    domains: ['identity', 'general'],
    description: 'Labeled identifier (Key: Value pattern, e.g., "ID: ABC12345", "Ref: 987654")',
    examples: ['ID: ABC12345'],
    falsePositiveNotes: 'Broad pattern — catches many key:value pairs that may not be PII',
  },
  {
    pattern: /(?<![.\d])\b\d[\d\s-]{7,}\d\b(?![.\d])/g,
    type: 'SSN',
    detector: 'regex:universal:long_number',
    confidence: 0.50,
    region: 'universal',
    domains: ['identity', 'financial'],
    description: 'Standalone long digit sequence (8+ digits) — likely IDs, account numbers, case numbers',
    examples: ['123456789', '123-456-789-00'],
    falsePositiveNotes: 'Low confidence — many non-PII numbers match. Overlap resolution with specific patterns prevents double-detection.',
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{2,5}[-\s]?\d{2,4}\s+[\p{L}][\p{L}]+\b/gu,
    type: 'ADDRESS',
    detector: 'regex:universal:postal_city',
    confidence: 0.65,
    region: 'universal',
    domains: ['contact'],
    description: 'Postal/zip code followed by city name (various country formats)',
    examples: ['00-950 Warszawa', '75008 Paris'],
    falsePositiveNotes: 'May match non-address number+word sequences',
  },
];
