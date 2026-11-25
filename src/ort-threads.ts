/**
 * How many WASM threads ONNX Runtime gets for detection (T280, WLojek/DocCloak.Core#5).
 *
 * Measured 2026-11-25 (BardS.ai v3, one 512-token window, Chrome 158, M4 Pro): 2.65 s on one
 * thread, 1.30 s on two, 0.68 s on four, the same output to the last bit. Threads need
 * SharedArrayBuffer, so the page must be cross-origin isolated (production is: COOP and COEP in
 * DocCloak.Hosting); without it the count stays 1 and nothing changes.
 *
 * Shared by the page (which decides and starts the worker) and the detection worker (which reads
 * the decision from its name), so this module imports nothing.
 */

/** At most this many: the gain flattens, and the machine stays usable while a long document runs. */
export const MAX_ORT_THREADS = 4;

/**
 * Set when a model load with several threads made no progress (see engine.ts): this browser
 * profile then stays on one thread, the way the app ran before threads.
 */
export const SINGLE_THREAD_STORAGE_KEY = 'doccloak-ort-single-thread';

export interface ThreadFacts {
  /** `crossOriginIsolated` of the page. */
  isolated: boolean;
  /** `navigator.hardwareConcurrency`. */
  cores: number | undefined;
  /** A phone or tablet: memory is tight there and the count was never measured. */
  mobile: boolean;
  /** The single-thread fallback is stored for this profile. */
  singleThreadStored: boolean;
}

/** Half the logical cores (the other half stays for the page, OCR and the rest of the machine), 1 to MAX_ORT_THREADS. */
export function ortThreadsFor(facts: ThreadFacts): number {
  if (!facts.isolated || facts.mobile || facts.singleThreadStored) return 1;
  const cores = typeof facts.cores === 'number' && Number.isFinite(facts.cores) ? facts.cores : 1;
  return Math.max(1, Math.min(MAX_ORT_THREADS, Math.floor(cores / 2)));
}

const WORKER_NAME = 'doccloak-detection';

/** Name of the detection worker: the page's thread decision travels in it (a worker cannot read localStorage). */
export function detectionWorkerName(threads: number): string {
  return `${WORKER_NAME}:threads=${threads}`;
}

/** The thread count a worker name carries; 1 for any other name. */
export function threadsFromWorkerName(name: string | undefined): number {
  const match = /^doccloak-detection:threads=(\d+)$/.exec(name ?? '');
  if (!match) return 1;
  const threads = Number(match[1]);
  return threads >= 1 && threads <= MAX_ORT_THREADS ? threads : 1;
}
