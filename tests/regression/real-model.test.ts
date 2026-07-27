/**
 * OPTIONAL end-to-end suite against the REAL GLiNER model (T010 manual gate).
 *
 * Skipped by default and in CI. Run manually with:
 *
 *   DOCCLOAK_REAL_MODEL=1 npm test -- tests/regression/real-model.test.ts
 *
 * Requirements: network access (downloads the ~65 MB quantized GLiNER model
 * on first run; afterwards it may be served from the Cache API where
 * available) and several minutes of patience on the first download.
 *
 * Model output can legitimately shift between model or runtime versions, so
 * this suite asserts structural invariants (regex spans are exact, the model
 * produces gliner-tagged detections) rather than byte-exact goldens. The
 * byte-exact contract lives in regression.test.ts with the stubbed provider.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import process from 'node:process';
import type { DetectedEntity } from '@doccloak/core';

const RUN_REAL_MODEL = process.env.DOCCLOAK_REAL_MODEL === '1';
const describeReal = RUN_REAL_MODEL ? describe : describe.skip;

const LOAD_TIMEOUT_MS = 600_000;

interface WorkerReply {
  type: string;
  requestId?: number;
  entities?: DetectedEntity[];
  error?: string;
}

const posted: WorkerReply[] = [];
let requestId = 0;

async function send(msg: Record<string, unknown>): Promise<void> {
  const handler = (globalThis as unknown as {
    onmessage: ((e: { data: unknown }) => Promise<void>) | null;
  }).onmessage;
  if (!handler) throw new Error('Detection worker registered no onmessage handler');
  await handler({ data: msg });
}

async function detect(text: string): Promise<DetectedEntity[]> {
  posted.length = 0;
  const id = ++requestId;
  await send({ type: 'detect', requestId: id, text });
  const reply = posted.find((m) => m.type === 'detected' && m.requestId === id);
  if (!reply) {
    const err = posted.find((m) => m.type === 'detectError');
    throw new Error(`Detection failed: ${err?.error ?? 'no reply from worker'}`);
  }
  return reply.entities ?? [];
}

describeReal('regression: real GLiNER model end to end (manual gate)', () => {
  beforeAll(async () => {
    vi.stubGlobal('postMessage', (msg: WorkerReply) => { posted.push(msg); });
    await import('../../src/detection.worker.ts');
    await send({
      type: 'init',
      providerId: 'gliner',
      customLabels: [],
      regexEnabled: true,
      regexRegion: 'all',
    });
    const loaded = posted.find((m) => m.type === 'loaded');
    const loadError = posted.find((m) => m.type === 'loadError');
    if (!loaded) {
      throw new Error(`Real GLiNER model failed to load: ${loadError?.error ?? 'unknown error'}`);
    }
  }, LOAD_TIMEOUT_MS);

  it('detects PII in an English smoke document', async () => {
    const text = 'Contact Jan Kowalski at jan.kowalski@example.com or +48 600 123 456 about invoice 2025-03-15.';
    const entities = await detect(text);

    expect(entities.length).toBeGreaterThan(0);
    // The regex path must still land the exact email span.
    const email = entities.find((e) => e.detector === 'regex:universal:email');
    expect(email).toBeDefined();
    expect(email!.value).toBe('jan.kowalski@example.com');
    expect(text.slice(email!.start, email!.end)).toBe(email!.value);
    // The real model must contribute at least one detection of its own
    // (a person name or similar), tagged with the gliner detector prefix.
    const fromModel = entities.filter((e) => e.detector.startsWith('gliner:'));
    expect(fromModel.length).toBeGreaterThan(0);
    // Every span must be internally consistent.
    for (const e of entities) {
      expect(text.slice(e.start, e.end)).toBe(e.value);
      expect(e.confidence).toBeGreaterThan(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }
  }, LOAD_TIMEOUT_MS);

  it('detects PII in a Polish smoke document', async () => {
    const text = 'Pani Anna Nowak, PESEL 89052310002, zamieszkała ul. Floriańska 27/3, 31-501 Kraków.';
    const entities = await detect(text);

    expect(entities.length).toBeGreaterThan(0);
    const pesel = entities.find((e) => e.value === '89052310002');
    expect(pesel, 'PESEL should be detected by regex or the model').toBeDefined();
    for (const e of entities) {
      expect(text.slice(e.start, e.end)).toBe(e.value);
    }
  }, LOAD_TIMEOUT_MS);
});

if (!RUN_REAL_MODEL) {
  it('real-model suite is skipped (set DOCCLOAK_REAL_MODEL=1 to run it)', () => {
    expect(RUN_REAL_MODEL).toBe(false);
  });
}
