/**
 * Golden capture for the regression corpus.
 *
 * Goldens are never hand-written: regression.test.ts replays every corpus
 * case through the real engine code and, when DOCCLOAK_CAPTURE=1 is set,
 * calls writeGolden() to persist what the engine actually produced.
 *
 * Recapture (only after an INTENTIONAL behavior change, then review the diff):
 *
 *   DOCCLOAK_CAPTURE=1 npm test -- tests/regression/regression.test.ts
 */
import { writeFileSync } from 'node:fs';
import process from 'node:process';
import type { CorpusFile } from './harness.ts';

export const CAPTURE_MODE = process.env.DOCCLOAK_CAPTURE === '1';

export function writeGolden(filePath: string, doc: CorpusFile): void {
  writeFileSync(filePath, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}
