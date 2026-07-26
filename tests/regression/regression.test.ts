/**
 * Detection regression corpus replay (T029).
 *
 * Replays tests/regression/corpus/*.json through the CURRENT engine:
 * the real detection worker pipeline (regex rules, overlap resolution,
 * false-positive filter, propagation) plus the real AnonymizationSession,
 * with ONLY the ML providers replaced by a deterministic stub that returns
 * a fixed entity list per case. No model is ever downloaded; the network
 * is hard-disabled for the whole suite.
 *
 * The suite fails on ANY diff: span, type, rounded confidence, detector id,
 * placeholder text, restored text or replacement table.
 *
 * Recapture goldens intentionally with:
 *   DOCCLOAK_CAPTURE=1 npm test -- tests/regression/regression.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { DetectedEntity, EntityType } from '../../src/core/types.ts';
import {
  loadCorpus,
  resolveStubEntities,
  normalizeEntities,
  runSessionStage,
  type GoldenExpected,
} from './harness.ts';
import { CAPTURE_MODE, writeGolden } from './capture.ts';

// ── Deterministic ML provider stub ─────────────────────────
// Replaces both real providers so importing the worker never pulls in
// @huggingface/transformers or onnxruntime-web.

const stub = vi.hoisted(() => {
  const state = {
    entities: [] as Array<{
      type: string; value: string; start: number; end: number;
      confidence: number; detector: string;
    }>,
    threshold: 0.35,
  };

  class StubNerProvider {
    readonly name = 'Stub NER (fixed entities)';
    load(): Promise<void> { return Promise.resolve(); }
    isLoaded(): boolean { return true; }
    isLoading(): boolean { return false; }
    onProgress(): void { /* no download to report */ }
    detect(): Promise<typeof state.entities> {
      // Mirror the real providers: spans scoring below the confidence
      // threshold never leave the provider (gliner keeps score >= threshold).
      return Promise.resolve(state.entities.filter((e) => e.confidence >= state.threshold));
    }
    setThreshold(value: number): void {
      state.threshold = Math.max(0.05, Math.min(0.95, value));
    }
    getThreshold(): number { return state.threshold; }
    release(): void { /* nothing to free */ }
  }

  return { state, StubNerProvider };
});

vi.mock('../../src/core/detectors/ner/index.ts', () => ({
  GlinerProvider: stub.StubNerProvider,
  BardsaiProvider: stub.StubNerProvider,
}));

// ── Worker driver ──────────────────────────────────────────
// The worker module assigns self.onmessage at import time (jsdom provides
// self); we call the handler directly and capture self.postMessage output.

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

// ── Coverage bookkeeping (guards corpus completeness) ─────

const seenTypes = new Set<string>();
const seenDetectors = new Set<string>();

const ALL_ENTITY_TYPES: EntityType[] = [
  'PERSON', 'EMAIL', 'PHONE', 'SSN', 'CREDIT_CARD', 'DATE', 'CURRENCY',
  'IP_ADDRESS', 'IBAN', 'ADDRESS', 'COMPANY', 'OTHER',
];

const ALL_REGION_PREFIXES = [
  'regex:universal:', 'regex:gb:', 'regex:pl:', 'regex:de:', 'regex:fr:',
  'regex:es:', 'regex:pt:', 'regex:se:', 'regex:no:', 'regex:it:',
  'regex:nl:', 'regex:be:', 'regex:at:', 'regex:ch:', 'regex:ie:',
  'regex:dk:', 'regex:fi:', 'regex:us:',
];

const CHECKSUM_DETECTORS = [
  'regex:pl:pesel',            // PESEL weighted checksum
  'regex:pl:nip',              // NIP weighted checksum
  'regex:universal:iban',      // IBAN mod-97
  'regex:universal:credit_card', // Luhn
];

// ── Suite ──────────────────────────────────────────────────

const corpus = loadCorpus();

beforeAll(async () => {
  // Capture worker replies instead of letting jsdom's postMessage run.
  vi.stubGlobal('postMessage', (msg: WorkerReply) => { posted.push(msg); });
  // Hard-disable the network: the deterministic suite must never download
  // a model or anything else.
  vi.stubGlobal('fetch', () => {
    throw new Error('Network access is forbidden in the deterministic regression suite');
  });

  await import('../../src/core/detection.worker.ts');
  await send({
    type: 'init',
    providerId: 'gliner',
    customLabels: [],
    regexEnabled: false,
    regexRegion: 'all',
  });
  const loaded = posted.find((m) => m.type === 'loaded');
  if (!loaded) throw new Error('Stubbed provider failed to initialize');
});

afterAll(() => {
  vi.unstubAllGlobals();
});

for (const { fileName, filePath, doc } of corpus) {
  describe(`corpus: ${fileName}`, () => {
    for (const testCase of doc.cases) {
      it(`${testCase.id}: ${testCase.description}`, async () => {
        const { input, settings } = testCase;

        stub.state.entities = resolveStubEntities(input, testCase.mlEntities);
        await send({ type: 'setRegex', enabled: settings.regexEnabled, region: settings.regexRegion });
        await send({ type: 'setThreshold', value: settings.threshold });

        const rawEntities = await detect(input);
        const entities = normalizeEntities(rawEntities);
        const sessionResult = runSessionStage(input, rawEntities, settings);
        const actual: GoldenExpected = { entities, ...sessionResult };

        for (const e of entities) {
          seenTypes.add(e.type);
          seenDetectors.add(e.detector);
        }

        if (CAPTURE_MODE) {
          testCase.expected = actual;
          expect(actual.entities.length).toBeGreaterThan(0);
        } else {
          expect(testCase.expected, `Missing golden for ${fileName}/${testCase.id}; run the capture command from tests/regression/README.md`).not.toBeNull();
          // Single deep equality: any diff in span, type, rounded confidence,
          // detector id, placeholder text, restored text or replacement table
          // fails the case.
          expect(actual).toEqual(testCase.expected);
        }
      });
    }

    afterAll(() => {
      if (CAPTURE_MODE) writeGolden(filePath, doc);
    });
  });
}

describe('corpus coverage', () => {
  it('covers all 12 entity types', () => {
    for (const type of ALL_ENTITY_TYPES) {
      expect(seenTypes.has(type), `No corpus case produced an entity of type ${type}`).toBe(true);
    }
  });

  it('covers all 18 regex regions (universal + 17 countries)', () => {
    for (const prefix of ALL_REGION_PREFIXES) {
      const hit = [...seenDetectors].some((d) => d.startsWith(prefix));
      expect(hit, `No corpus case produced a detector from region ${prefix}`).toBe(true);
    }
  });

  it('covers the checksum validators (PESEL, NIP, IBAN, Luhn)', () => {
    for (const detector of CHECKSUM_DETECTORS) {
      expect(seenDetectors.has(detector), `No corpus case produced ${detector}`).toBe(true);
    }
  });

  it('covers propagation and stubbed ML detections', () => {
    expect(seenDetectors.has('propagated'), 'No corpus case exercised propagation').toBe(true);
    const mlHit = [...seenDetectors].some((d) => d.startsWith('gliner:'));
    expect(mlHit, 'No corpus case produced a (stubbed) ML detection').toBe(true);
  });
});
