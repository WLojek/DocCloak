import type { DetectedEntity, DetectionProvider, ProgressCallback } from './types.ts';
import { GlinerProvider, BardsaiProvider } from './detectors/ner/index.ts';

// ── Provider registry ──────────────────────────────────────
export type ProviderId = 'gliner' | 'bardsai';

interface ProviderEntry {
  id: ProviderId;
  label: string;
  description: string;
  create: () => DetectionProvider;
}

export const PROVIDERS: ProviderEntry[] = [
  {
    id: 'gliner',
    label: 'GLiNER PII Edge',
    description: 'Lightweight, multi-language, supports custom labels (~65 MB)',
    create: () => new GlinerProvider(),
  },
  {
    id: 'bardsai',
    label: 'BardS.ai EU PII',
    description: 'Best for Polish, 35 PII types, high accuracy (~279 MB)',
    create: () => new BardsaiProvider(),
  },
];

const PROVIDER_STORAGE_KEY = 'doccloak-active-provider';
const ACCEL_STORAGE_KEY = 'doccloak-acceleration';

// ── Acceleration setting ───────────────────────────────────
export type AccelMode = 'auto' | 'webgpu' | 'wasm';

export function getAccelMode(): AccelMode {
  const saved = localStorage.getItem(ACCEL_STORAGE_KEY);
  if (saved === 'webgpu' || saved === 'wasm') return saved;
  return 'auto';
}

export function setAccelMode(mode: AccelMode): void {
  localStorage.setItem(ACCEL_STORAGE_KEY, mode);
}

export function getExecutionProviders(): { providers: string[]; isExplicit: boolean } {
  const mode = getAccelMode();
  if (mode === 'webgpu') return { providers: ['webgpu'], isExplicit: true };
  if (mode === 'wasm') return { providers: ['wasm'], isExplicit: true };
  return { providers: ['webgpu', 'wasm'], isExplicit: false }; // auto
}

function loadSavedProviderId(): ProviderId {
  const saved = localStorage.getItem(PROVIDER_STORAGE_KEY);
  if (saved && PROVIDERS.some((p) => p.id === saved)) return saved as ProviderId;
  return 'gliner';
}

let activeId: ProviderId = loadSavedProviderId();
let provider: DetectionProvider = PROVIDERS.find((p) => p.id === activeId)!.create();

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
 * Propagate detected entities: for each detected value, find all other
 * occurrences in the text (exact match + significant individual words from
 * multi-word entities).
 */
function propagateEntities(text: string, entities: DetectedEntity[]): DetectedEntity[] {
  const propagated: DetectedEntity[] = [];
  const seen = new Set<string>(); // "start:end" keys already covered

  for (const e of entities) {
    seen.add(`${e.start}:${e.end}`);
  }

  // Collect unique search terms: full entity values + significant words
  const terms: { term: string; type: DetectedEntity['type'] }[] = [];
  const addedTerms = new Set<string>();

  for (const e of entities) {
    const val = e.value.trim();
    if (val.length >= 3 && !addedTerms.has(val.toLowerCase())) {
      addedTerms.add(val.toLowerCase());
      terms.push({ term: val, type: e.type });
    }
    // For multi-word entities, also propagate significant individual words
    if (val.includes(' ')) {
      for (const word of val.split(/\s+/)) {
        const w = word.replace(/[.,;:!?()]+$/, '');
        // Only propagate words >= 4 chars that look like proper nouns or identifiers
        if (w.length >= 4 && !addedTerms.has(w.toLowerCase())) {
          addedTerms.add(w.toLowerCase());
          terms.push({ term: w, type: e.type });
        }
      }
    }
  }

  for (const { term, type } of terms) {
    let searchFrom = 0;
    const lowerText = text.toLowerCase();
    const lowerTerm = term.toLowerCase();
    while (searchFrom < text.length) {
      const idx = lowerText.indexOf(lowerTerm, searchFrom);
      if (idx === -1) break;
      const end = idx + term.length;
      const key = `${idx}:${end}`;
      if (!seen.has(key)) {
        // Check word boundaries to avoid matching inside longer words
        const charBefore = idx > 0 ? text[idx - 1] : ' ';
        const charAfter = end < text.length ? text[end] : ' ';
        const isBoundaryBefore = /[\s.,;:!?()"'„"\-–—/]/.test(charBefore);
        const isBoundaryAfter = /[\s.,;:!?()"'„"\-–—/]/.test(charAfter);
        if (isBoundaryBefore && isBoundaryAfter) {
          seen.add(key);
          propagated.push({
            type,
            value: text.slice(idx, end),
            start: idx,
            end,
            confidence: 0.95,
            detector: 'propagated',
          });
        }
      }
      searchFrom = idx + 1;
    }
  }

  return propagated;
}

/**
 * Detect entities in text using the active provider.
 */
export async function detectEntities(
  text: string,
  onProgress?: (progress: number) => void,
): Promise<DetectedEntity[]> {
  if (!text.trim()) return [];

  const mlResults = filterFalsePositives(await provider.detect(text, onProgress));
  // const regexResults = detectWithRegex(text);
  const initial = resolveOverlaps([...mlResults]);
  const propagated = propagateEntities(text, initial);
  return resolveOverlaps([...initial, ...propagated]);
}

/**
 * Preload the detection model in the background.
 * Restores custom labels if previously saved.
 */
export async function preloadModel(): Promise<void> {
  if ('restoreCustomLabels' in provider) {
    (provider as any).restoreCustomLabels();
  }
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
 * ID of the active detection provider.
 */
export function getActiveProviderId(): ProviderId {
  return activeId;
}

/**
 * Switch to a different detection provider.
 * Returns a promise that resolves when the new provider is loaded.
 */
export async function switchProvider(
  id: ProviderId,
  progressCallback?: ProgressCallback,
): Promise<void> {
  if (id === activeId && provider.isLoaded()) return;

  const entry = PROVIDERS.find((p) => p.id === id);
  if (!entry) throw new Error(`Unknown provider: ${id}`);

  // Clear cached model from previous provider to save storage
  try {
    await caches.delete('doccloak-models');
  } catch { /* ignore */ }

  activeId = id;
  provider = entry.create();
  localStorage.setItem(PROVIDER_STORAGE_KEY, id);

  if (progressCallback) {
    provider.onProgress(progressCallback);
  }
  if ('restoreCustomLabels' in provider) {
    (provider as any).restoreCustomLabels();
  }
  await provider.load();
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
  if ('getCustomLabels' in provider) {
    return (provider as any).getCustomLabels();
  }
  return [];
}

/**
 * Set user-defined custom detection labels.
 */
export function setCustomLabels(labels: string[]): void {
  if ('setCustomLabels' in provider) {
    (provider as any).setCustomLabels(labels);
  }
}
