/**
 * Pure helpers for the remaining-time estimate on the redaction overlay
 * (T222). The detector reports progress per inference chunk (0-1); the rate
 * over a sliding window of those samples gives the seconds left. No React.
 */

export interface EtaSample {
  /** Progress reported by the detector, 0-1. */
  progress: number;
  /** Sample timestamp in ms (Date.now()). */
  at: number;
}

/** Sliding window the rate is measured over. */
export const ETA_WINDOW_MS = 30_000;

/** Below this span the rate would be noise. */
export const ETA_MIN_SPAN_MS = 2_000;

/** Samples always kept, however old, so slow chunks (seconds each) still yield a rate. */
export const ETA_MIN_SAMPLES = 3;

/**
 * Append a progress sample. Progress or time going backwards means a new
 * run started: the window resets. Old samples fall out of the window, but
 * the newest ETA_MIN_SAMPLES are always kept.
 */
export function appendEtaSample(
  samples: readonly EtaSample[],
  progress: number,
  at: number,
  windowMs: number = ETA_WINDOW_MS,
): EtaSample[] {
  const last = samples[samples.length - 1];
  const reset = last !== undefined && (progress < last.progress || at < last.at);
  const next = reset ? [] : [...samples];
  next.push({ progress, at });
  let cut = 0;
  while (next.length - cut > ETA_MIN_SAMPLES && at - next[cut].at > windowMs) cut++;
  return cut > 0 ? next.slice(cut) : next;
}

/**
 * Seconds remaining, or null when there is no usable rate yet: fewer than
 * ETA_MIN_SAMPLES samples, a span shorter than ETA_MIN_SPAN_MS, no progress
 * inside the window, or the run already finished.
 *
 * The rate is measured from the first sample that moved past the oldest
 * one, so the step into it is excluded: providers report a preparation
 * jump first (0 twice, then 0.1 after tokenising for bardsai), and counting
 * that jump makes the first estimate wildly optimistic ("25 s" for a run of
 * minutes). The cost is one inference chunk left out of the window.
 */
export function etaSeconds(samples: readonly EtaSample[]): number | null {
  if (samples.length < ETA_MIN_SAMPLES) return null;
  const oldest = samples[0];
  const first = samples.find((s) => s.progress > oldest.progress);
  if (!first) return null;
  const last = samples[samples.length - 1];
  if (last.progress >= 1) return null;
  const spanMs = last.at - first.at;
  if (spanMs < ETA_MIN_SPAN_MS) return null;
  const gained = last.progress - first.progress;
  if (gained <= 0) return null;
  const rate = gained / spanMs; // progress per ms
  return ((1 - last.progress) / rate) / 1000;
}

export interface EtaLabels {
  hours: (n: number) => string;
  minutes: (n: number) => string;
  seconds: (n: number) => string;
}

/**
 * Human wording for an estimate: seconds under a minute (rounded up to 5 s),
 * whole minutes under an hour (rounded up), else hours and minutes.
 */
export function formatEta(seconds: number, labels: EtaLabels): string {
  const s = Math.max(0, seconds);
  if (s < 60) return labels.seconds(Math.max(5, Math.ceil(s / 5) * 5));
  const minutes = Math.ceil(s / 60);
  if (minutes < 60) return labels.minutes(minutes);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? labels.hours(hours) : `${labels.hours(hours)} ${labels.minutes(rest)}`;
}
