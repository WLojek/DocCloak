/**
 * Detection regression corpus replay (T029).
 *
 * Replays tests/regression/corpus/*.json through the CURRENT engine:
 * the real @doccloak/core engine served over the real worker protocol
 * (regex rules, overlap resolution, false-positive filter, propagation)
 * plus the real AnonymizationSession, with ONLY the ML providers replaced
 * by a deterministic stub that returns a fixed entity list per case.
 * No model is ever downloaded; the env's fetch is hard-disabled.
 *
 * The suite fails on ANY diff: span, type, rounded confidence, detector id,
 * placeholder text, restored text or replacement table.
 *
 * Recapture goldens intentionally with:
 *   DOCCLOAK_CAPTURE=1 npm test -- tests/regression/regression.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEngine, serveEngine, memoryKV, memoryBlobCache } from '@doccloak/core';
import type { CoreEnv, PortLike } from '@doccloak/core';
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
// Injected through the engine's provider factory override so the suite
// never pulls in @huggingface/transformers or downloads a model.

const state = {
  entities: [] as DetectedEntity[],
  threshold: 0.35,
};

class StubNerProvider {
  readonly name = 'Stub NER (fixed entities)';
  load(): Promise<void> { return Promise.resolve(); }
  isLoaded(): boolean { return true; }
  isLoading(): boolean { return false; }
  onProgress(): void { /* no download to report */ }
  detect(): Promise<DetectedEntity[]> {
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

// ── Protocol driver ────────────────────────────────────────
// serveEngine registers its handler on this in-memory port; we send the
// same raw messages the old worker received and capture every reply.

interface WorkerReply {
  type: string;
  requestId?: number;
  entities?: DetectedEntity[];
  error?: string;
}

const posted: WorkerReply[] = [];
let requestId = 0;
let handleRequest: ((msg: unknown) => void | Promise<void>) | null = null;

const port: PortLike = {
  postMessage: (msg) => { posted.push(msg as WorkerReply); },
  onMessage: (cb) => {
    handleRequest = cb;
    return () => { handleRequest = null; };
  },
};

async function send(msg: Record<string, unknown>): Promise<void> {
  if (!handleRequest) throw new Error('serveEngine registered no message handler');
  await handleRequest(msg);
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
  // In-memory env with the network hard-disabled: the deterministic suite
  // must never download a model or anything else.
  const env: CoreEnv = {
    kv: memoryKV(),
    modelCache: memoryBlobCache(),
    fetch: (() => {
      throw new Error('Network access is forbidden in the deterministic regression suite');
    }) as unknown as typeof fetch,
    wasm: { paths: '/' },
    loadTokenizer: async () => {
      throw new Error('Network access is forbidden in the deterministic regression suite');
    },
  };
  const engine = createEngine(env, undefined, {
    providers: {
      gliner: () => new StubNerProvider(),
      bardsai: () => new StubNerProvider(),
    },
  });
  serveEngine(engine, port);

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

for (const { fileName, filePath, doc } of corpus) {
  describe(`corpus: ${fileName}`, () => {
    for (const testCase of doc.cases) {
      it(`${testCase.id}: ${testCase.description}`, async () => {
        const { input, settings } = testCase;

        state.entities = resolveStubEntities(input, testCase.mlEntities);
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
