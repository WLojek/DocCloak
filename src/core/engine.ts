import type { DetectedEntity, ProgressCallback } from './types.ts';
import { GlinerProvider } from './detectors/ner/index.ts';

// ── Active provider ─────────────────────────────────────────
const provider: GlinerProvider = new GlinerProvider();
// ─────────────────────────────────────────────────────────────

// ── Regex fallback for structured patterns the ML model often misses ───
import { ALL_REGEX_RULES } from './regex/index.ts';

function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  for (const rule of ALL_REGEX_RULES) {
    rule.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.pattern.exec(text)) !== null) {
      if (rule.validate && !rule.validate(match[0])) continue;
      entities.push({
        type: rule.type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
        confidence: rule.confidence,
        detector: rule.detector,
      });
    }
  }
  return entities;
}

function resolveOverlaps(entities: DetectedEntity[]): DetectedEntity[] {
  const sorted = [...entities].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const aLen = a.end - a.start;
    const bLen = b.end - b.start;
    if (aLen !== bLen) return bLen - aLen;
    return b.confidence - a.confidence;
  });

  const resolved: DetectedEntity[] = [];
  for (const entity of sorted) {
    const overlaps = resolved.some(
      (existing) => entity.start < existing.end && entity.end > existing.start
    );
    if (!overlaps) {
      resolved.push(entity);
    }
  }

  return resolved;
}

/**
 * Filter out the most obvious ML false positives.
 * Biased toward keeping detections — better to over-redact than miss real PII.
 */
function filterFalsePositives(entities: DetectedEntity[]): DetectedEntity[] {
  return entities.filter((e) => {
    // Drop very short detections (1-2 chars) — always noise
    if (e.value.trim().length < 3) return false;
    return true;
  });
}

/**
 * Detect entities in text using the active provider.
 */
export async function detectEntities(text: string): Promise<DetectedEntity[]> {
  if (!text.trim()) return [];

  const mlResults = filterFalsePositives(await provider.detect(text));
  const regexResults = detectWithRegex(text);
  return resolveOverlaps([...mlResults, ...regexResults]);
}

/**
 * Preload the detection model in the background.
 * Restores custom labels if previously saved.
 */
export async function preloadModel(): Promise<void> {
  provider.restoreCustomLabels();
  await provider.load();
}

/**
 * Register a download progress callback.
 */
export function onDownloadProgress(callback: ProgressCallback): void {
  provider.onProgress(callback);
}

/**
 * Whether the detection model is loaded and ready.
 */
export function isModelLoaded(): boolean {
  return provider.isLoaded();
}

/**
 * Whether the detection model is currently loading.
 */
export function isModelLoading(): boolean {
  return provider.isLoading();
}

/**
 * Name of the active detection provider.
 */
export function getProviderName(): string {
  return provider.name;
}

/**
 * Set the detection confidence threshold (0.05–0.95).
 */
export function setDetectionThreshold(value: number): void {
  provider.setThreshold(value);
}

/**
 * Get the current detection confidence threshold.
 */
export function getDetectionThreshold(): number {
  return provider.getThreshold();
}

/**
 * Get user-defined custom detection labels.
 */
export function getCustomLabels(): string[] {
  return provider.getCustomLabels();
}

/**
 * Set user-defined custom detection labels.
 */
export function setCustomLabels(labels: string[]): void {
  provider.setCustomLabels(labels);
}
