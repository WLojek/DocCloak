import { describe, it, expect } from 'vitest';
import { AnonymizationSession } from '@doccloak/core';
import type { DetectedEntity } from '@doccloak/core';

describe('engine: overlap resolution via session', () => {
  it('anonymizes non-overlapping entities correctly', () => {
    const session = new AnonymizationSession();
    const text = 'Contact john@acme.com or call 555-123-4567.';
    const entities: DetectedEntity[] = [
      { type: 'EMAIL', value: 'john@acme.com', start: 8, end: 21, confidence: 0.95, detector: 'gliner:email address' },
      { type: 'PHONE', value: '555-123-4567', start: 30, end: 42, confidence: 0.9, detector: 'gliner:phone number' },
    ];

    const result = session.anonymizeText(text, entities);
    // 0.9.0 issues typed placeholders with a per-type counter, so each of
    // these single-occurrence types gets _1 regardless of processing order.
    expect(result).toContain('[EMAIL_');
    expect(result).toContain('[PHONE_');
    expect(result).not.toContain('john@acme.com');
    expect(result).not.toContain('555-123-4567');
    expect(result).toBe('Contact [EMAIL_1] or call [PHONE_1].');
  });

  it('handles multiple entity types', () => {
    const session = new AnonymizationSession();
    const entities: DetectedEntity[] = [
      { type: 'PERSON', value: 'John Smith', start: 0, end: 10, confidence: 0.9, detector: 'gliner:person name' },
      { type: 'EMAIL', value: 'john@test.com', start: 18, end: 31, confidence: 0.95, detector: 'gliner:email address' },
      { type: 'SSN', value: '123-45-6789', start: 36, end: 47, confidence: 0.85, detector: 'gliner:social security number' },
    ];

    const text = 'John Smith called john@test.com SSN 123-45-6789';
    const result = session.anonymizeText(text, entities);
    // Typed placeholders (0.9.0): counters are per entity type, so each
    // distinct type here gets its own _1.
    expect(result).toBe('[PERSON_1] called [EMAIL_1] SSN [SSN_1]');
    expect(result).not.toContain('John Smith');
    expect(result).not.toContain('john@test.com');
    expect(result).not.toContain('123-45-6789');
  });
});
