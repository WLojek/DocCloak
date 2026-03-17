import { describe, it, expect } from 'vitest';
import { AnonymizationSession } from '../../src/core/session.ts';
import type { DetectedEntity } from '../../src/core/types.ts';

describe('engine: overlap resolution via session', () => {
  it('anonymizes non-overlapping entities correctly', () => {
    const session = new AnonymizationSession();
    const text = 'Contact john@acme.com or call 555-123-4567.';
    const entities: DetectedEntity[] = [
      { type: 'EMAIL', value: 'john@acme.com', start: 8, end: 21, confidence: 0.95, detector: 'gliner:email address' },
      { type: 'PHONE', value: '555-123-4567', start: 30, end: 42, confidence: 0.9, detector: 'gliner:phone number' },
    ];

    const result = session.anonymizeText(text, entities);
    // anonymizeText processes end-to-start, so phone (later position) gets REDACTED_1
    expect(result).toContain('<<REDACTED_');
    expect(result).not.toContain('john@acme.com');
    expect(result).not.toContain('555-123-4567');
    expect(result).toBe('Contact <<REDACTED_2>> or call <<REDACTED_1>>.');
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
    // Processed end-to-start: SSN→REDACTED_1, EMAIL→REDACTED_2, PERSON→REDACTED_3
    expect(result).toBe('<<REDACTED_3>> called <<REDACTED_2>> SSN <<REDACTED_1>>');
    expect(result).not.toContain('John Smith');
    expect(result).not.toContain('john@test.com');
    expect(result).not.toContain('123-45-6789');
  });
});
