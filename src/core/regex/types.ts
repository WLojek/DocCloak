import type { EntityType } from '../types.ts';

/** Domain tags for categorization — a rule can belong to multiple */
export type PiiDomain = 'financial' | 'medical' | 'legal' | 'hr' | 'identity' | 'contact' | 'technical' | 'general';

/** Region code or 'universal' for patterns that apply globally */
export type RegionCode = 'universal' | 'us' | 'gb' | 'pl' | 'de' | 'fr' | 'es' | 'pt' | 'se' | 'no' | 'jp' | 'cn' | (string & {});

export interface RegexRule {
  /** The regex pattern. MUST use the 'g' flag. */
  pattern: RegExp;
  /** Which entity type this detects */
  type: EntityType;
  /** Detector identifier for tracing, e.g. 'regex:us:ssn' */
  detector: string;
  /** Default confidence score (0-1). Structured patterns = high; loose patterns = lower */
  confidence: number;
  /** Region this rule applies to, or 'universal' */
  region: RegionCode;
  /** Domain tags for categorization/filtering */
  domains: PiiDomain[];
  /** Human-readable description for developers maintaining rules */
  description: string;
  /** Example strings that SHOULD match (used in auto-generated tests) */
  examples?: string[];
  /** Known false-positive patterns or notes */
  falsePositiveNotes?: string;
  /** Optional validation function for post-match filtering (e.g., Luhn check, checksum) */
  validate?: (match: string) => boolean;
}
