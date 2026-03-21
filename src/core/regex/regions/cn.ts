import type { RegexRule } from '../types.ts';

function validateResidentId(match: string): boolean {
  const digits = match.replace(/\s/g, '');
  if (digits.length !== 18) return false;
  // Weights for checksum
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkChars = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(digits[i], 10) * weights[i];
  }
  const expected = checkChars[sum % 11];
  return digits[17].toUpperCase() === expected;
}

export const rules: RegexRule[] = [
  // ── Identity ────────────────────────────────────────────
  {
    pattern: /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    type: 'SSN',
    detector: 'regex:cn:resident_id',
    confidence: 0.90,
    region: 'cn',
    domains: ['identity'],
    description: 'Chinese Resident Identity Card number (居民身份证, 18 digits)',
    examples: ['110101199003070003'],
    validate: validateResidentId,
  },
  {
    pattern: /\b[GDE]\d{8}\b/gi,
    type: 'SSN',
    detector: 'regex:cn:passport',
    confidence: 0.75,
    region: 'cn',
    domains: ['identity'],
    description: 'Chinese passport number (G/D/E + 8 digits)',
    examples: ['G12345678', 'E00000001'],
  },

  // ── Financial ───────────────────────────────────────────
  {
    pattern: /\b\d{15,19}\b/g,
    type: 'OTHER',
    detector: 'regex:cn:bank_card',
    confidence: 0.40,
    region: 'cn',
    domains: ['financial'],
    description: 'Chinese bank card number (15-19 digits)',
    examples: ['6222021234567890123'],
    falsePositiveNotes: 'Very broad — overlaps with credit cards and other long numbers',
  },
  {
    pattern: /\b[0-9A-Z]{18}\b/g,
    type: 'SSN',
    detector: 'regex:cn:uscc',
    confidence: 0.60,
    region: 'cn',
    domains: ['financial', 'legal'],
    description: 'Chinese Unified Social Credit Code (统一社会信用代码, 18 alphanumeric)',
    examples: ['91110000710921000K'],
    falsePositiveNotes: '18 alphanumeric chars is broad',
  },

  // ── Contact ─────────────────────────────────────────────
  {
    pattern: /\b(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}\b/g,
    type: 'PHONE',
    detector: 'regex:cn:phone_mobile',
    confidence: 0.85,
    region: 'cn',
    domains: ['contact'],
    description: 'Chinese mobile phone number (1XX-XXXX-XXXX, optionally with +86)',
    examples: ['+86 138 1234 5678', '13812345678'],
  },
  {
    pattern: /\b0\d{2,3}[\s-]?\d{7,8}\b/g,
    type: 'PHONE',
    detector: 'regex:cn:phone_landline',
    confidence: 0.80,
    region: 'cn',
    domains: ['contact'],
    description: 'Chinese landline phone number (0XX-XXXXXXXX)',
    examples: ['010-12345678', '021-87654321'],
  },

  // ── Address ─────────────────────────────────────────────
  {
    pattern: /\b\d{6}\b/g,
    type: 'ADDRESS',
    detector: 'regex:cn:postal',
    confidence: 0.35,
    region: 'cn',
    domains: ['contact'],
    description: 'Chinese postal code (6 digits)',
    examples: ['100000', '200000'],
    falsePositiveNotes: '6 digits is extremely broad — only useful with context',
  },

  // ── Currency (Chinese amounts) ──────────────────────────
  {
    pattern: /[零壹贰叁肆伍陆柒捌玖拾佰仟萬億一二三四五六七八九十百千万亿]+\s*(?:元|圆|块)/gu,
    type: 'CURRENCY',
    detector: 'regex:cn:currency_hanzi',
    confidence: 0.90,
    region: 'cn',
    domains: ['financial'],
    description: 'Chinese amount in hanzi numerals + 元/圆 (e.g., "捌仟伍佰元", "八千五百元")',
    examples: ['捌仟伍佰元', '八千五百元'],
  },

  // ── Address (Chinese) ──────────────────────────────────
  {
    pattern: /[\u4E00-\u9FFF]+[省市][\u4E00-\u9FFF]+[市区县][\u4E00-\u9FFF\d\-]+/gu,
    type: 'ADDRESS',
    detector: 'regex:cn:address',
    confidence: 0.85,
    region: 'cn',
    domains: ['contact'],
    description: 'Chinese address (province/city + district + street)',
    examples: ['北京市朝阳区建国路1号'],
  },

  // ── Company ──────────────────────────────────────────────
  {
    pattern: /[\u4E00-\u9FFF][\u4E00-\u9FFF\s]+(?:有限公司|股份有限公司|集团|有限责任公司)/gu,
    type: 'COMPANY',
    detector: 'regex:cn:company',
    confidence: 0.90,
    region: 'cn',
    domains: ['legal', 'financial'],
    description: 'Chinese company name with legal form (有限公司, 股份有限公司, 集团)',
    examples: ['阿里巴巴集团', '华为技术有限公司', '腾讯科技股份有限公司'],
  },
];
