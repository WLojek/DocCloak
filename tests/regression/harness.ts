/**
 * Shared plumbing for the detection regression corpus.
 *
 * The corpus lives in ./corpus/*.json. Each file holds cases with an input
 * text, pipeline settings, a fixed list of stub ML entities (so CI never
 * downloads a model) and a golden `expected` block captured from the engine.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnonymizationSession, type ReplacementMode } from '../../src/core/session.ts';
import type { DetectedEntity, EntityType, ReplacementEntry } from '../../src/core/types.ts';

export const CORPUS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'corpus',
);

// ── Corpus schema ──────────────────────────────────────────

export interface StubMlEntitySpec {
  /** Exact substring of the input text */
  value: string;
  type: EntityType;
  confidence: number;
  detector: string;
  /** Which occurrence of `value` in the input (0-based, default 0) */
  occurrence?: number;
}

export interface CaseSettings {
  regexEnabled: boolean;
  regexRegion: string;
  threshold: number;
  mode: ReplacementMode;
  renames: Array<{ original: string; newLabel: string }>;
}

export interface GoldenExpected {
  entities: DetectedEntity[];
  anonymized: string;
  anonymizedAfterRename: string | null;
  restored: string;
  replacements: ReplacementEntry[];
}

export interface CorpusCase {
  id: string;
  description: string;
  settings: CaseSettings;
  input: string;
  mlEntities: StubMlEntitySpec[];
  expected: GoldenExpected | null;
}

export interface CorpusFile {
  description: string;
  cases: CorpusCase[];
}

export interface LoadedCorpusFile {
  fileName: string;
  filePath: string;
  doc: CorpusFile;
}

export function loadCorpus(): LoadedCorpusFile[] {
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((fileName) => {
      const filePath = path.join(CORPUS_DIR, fileName);
      const doc = JSON.parse(readFileSync(filePath, 'utf8')) as CorpusFile;
      return { fileName, filePath, doc };
    });
}

// ── Stub entity resolution ─────────────────────────────────

/**
 * Turn value/occurrence specs into positioned DetectedEntity objects so the
 * corpus JSON never contains hand-maintained character offsets.
 */
export function resolveStubEntities(
  input: string,
  specs: StubMlEntitySpec[],
): DetectedEntity[] {
  return specs.map((spec) => {
    let idx = -1;
    let from = 0;
    for (let n = 0; n <= (spec.occurrence ?? 0); n++) {
      idx = input.indexOf(spec.value, from);
      if (idx === -1) {
        throw new Error(`Stub entity value not found in input: "${spec.value}"`);
      }
      from = idx + 1;
    }
    return {
      type: spec.type,
      value: spec.value,
      start: idx,
      end: idx + spec.value.length,
      confidence: spec.confidence,
      detector: spec.detector,
    };
  });
}

// ── Result shaping ─────────────────────────────────────────

export function roundConfidence(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function normalizeEntities(entities: DetectedEntity[]): DetectedEntity[] {
  return entities.map((e) => ({
    type: e.type,
    value: e.value,
    start: e.start,
    end: e.end,
    confidence: roundConfidence(e.confidence),
    detector: e.detector,
  }));
}

/**
 * Run the anonymize / rename / restore stage on the detected entities,
 * exactly as the app drives AnonymizationSession.
 */
export function runSessionStage(
  input: string,
  entities: DetectedEntity[],
  settings: CaseSettings,
): Omit<GoldenExpected, 'entities'> {
  const session = new AnonymizationSession();
  session.setMode(settings.mode);

  const anonymized = session.anonymizeText(input, entities);

  let anonymizedAfterRename: string | null = null;
  if (settings.renames.length > 0) {
    for (const r of settings.renames) {
      session.renameLabel(r.original, r.newLabel);
    }
    // Re-running anonymizeText reuses the forward map, so renamed labels
    // land in the text (this mirrors how the UI refreshes the output).
    anonymizedAfterRename = session.anonymizeText(input, entities);
  }

  const restored = session.deanonymize(anonymizedAfterRename ?? anonymized);
  const replacements = session.getEntries();

  return { anonymized, anonymizedAfterRename, restored, replacements };
}
