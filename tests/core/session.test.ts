import { describe, it, expect } from 'vitest';
import { AnonymizationSession } from '../../src/core/session.ts';

describe('AnonymizationSession', () => {
  it('creates consistent placeholders for the same entity', () => {
    const session = new AnonymizationSession();
    const p1 = session.anonymize('John Smith', 'PERSON');
    const p2 = session.anonymize('John Smith', 'PERSON');
    expect(p1).toBe(p2);
    expect(p1).toBe('<<REDACTED_1>>');
  });

  it('creates incrementing placeholders for different entities', () => {
    const session = new AnonymizationSession();
    const p1 = session.anonymize('John', 'PERSON');
    const p2 = session.anonymize('Jane', 'PERSON');
    expect(p1).toBe('<<REDACTED_1>>');
    expect(p2).toBe('<<REDACTED_2>>');
  });

  it('deanonymizes text correctly', () => {
    const session = new AnonymizationSession();
    session.anonymize('John Smith', 'PERSON');
    session.anonymize('jane@acme.com', 'EMAIL');

    const anonymized = '<<REDACTED_1>> sent an email from <<REDACTED_2>>.';
    const restored = session.deanonymize(anonymized);
    expect(restored).toBe('John Smith sent an email from jane@acme.com.');
  });

  it('round-trips correctly', () => {
    const session = new AnonymizationSession();
    session.anonymize('Sarah Connor', 'PERSON');
    session.anonymize('sarah@law.com', 'EMAIL');
    session.anonymize('(555) 123-4567', 'PHONE');

    // Simulate AI response with placeholders
    const aiResponse = 'You should contact <<REDACTED_1>> at <<REDACTED_2>> or call <<REDACTED_3>>.';
    const restored = session.deanonymize(aiResponse);
    expect(restored).toBe('You should contact Sarah Connor at sarah@law.com or call (555) 123-4567.');
  });

  it('handles multiple entities of the same type', () => {
    const session = new AnonymizationSession();
    session.anonymize('John', 'PERSON');
    session.anonymize('Jane', 'PERSON');
    session.anonymize('Bob', 'PERSON');

    const text = '<<REDACTED_1>> met <<REDACTED_2>> and <<REDACTED_3>>';
    const restored = session.deanonymize(text);
    expect(restored).toBe('John met Jane and Bob');
  });

  it('clears all mappings', () => {
    const session = new AnonymizationSession();
    session.anonymize('John', 'PERSON');
    session.clear();
    expect(session.getEntries()).toHaveLength(0);
    const p = session.anonymize('Jane', 'PERSON');
    expect(p).toBe('<<REDACTED_1>>');
  });

  it('anonymizeText replaces entities in correct positions', () => {
    const session = new AnonymizationSession();
    const text = 'Call John at john@test.com';
    const entities = [
      { type: 'PERSON' as const, value: 'John', start: 5, end: 9, confidence: 0.9, detector: 'test' },
      { type: 'EMAIL' as const, value: 'john@test.com', start: 13, end: 26, confidence: 0.95, detector: 'test' },
    ];
    const result = session.anonymizeText(text, entities);
    // anonymizeText sorts end-to-start: email (pos 13-26) processed first → REDACTED_1, person (pos 5-9) → REDACTED_2
    expect(result).toBe('Call <<REDACTED_2>> at <<REDACTED_1>>');
  });

  it('getEntries returns all mappings', () => {
    const session = new AnonymizationSession();
    session.anonymize('John', 'PERSON');
    session.anonymize('test@test.com', 'EMAIL');
    const entries = session.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].original).toBe('John');
    expect(entries[0].entityType).toBe('PERSON');
    expect(entries[1].original).toBe('test@test.com');
    expect(entries[1].entityType).toBe('EMAIL');
  });

  it('uses blanked mode when set', () => {
    const session = new AnonymizationSession();
    session.setMode('blanked');
    const p = session.anonymize('John', 'PERSON');
    expect(p).toBe('________');
  });

  it('renames labels and updates mappings', () => {
    const session = new AnonymizationSession();
    session.anonymize('John', 'PERSON');
    session.renameLabel('John', '<<CLIENT_NAME>>');
    expect(session.getForward('John')).toBe('<<CLIENT_NAME>>');
    const restored = session.deanonymize('Hello <<CLIENT_NAME>>');
    expect(restored).toBe('Hello John');
  });
});
