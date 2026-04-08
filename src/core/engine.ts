import type { DetectedEntity, ProgressCallback } from './types.ts';

// ── Provider registry ──────────────────────────────────────
export type ProviderId = 'gliner' | 'bardsai';

export interface ProviderEntry {
  id: ProviderId;
  label: string;
  description: string;
}

export const PROVIDERS: ProviderEntry[] = [
  {
    id: 'gliner',
    label: 'GLiNER PII Edge',
    description: 'Lightweight, multi-language, supports custom labels (~65 MB)',
  },
  {
    id: 'bardsai',
    label: 'BardS.ai EU PII',
    description: 'Multilingual EU languages, 35 PII types, high accuracy (~279 MB)',
  },
];

const PROVIDER_STORAGE_KEY = 'doccloak-active-provider';
const CUSTOM_LABELS_STORAGE_KEY = 'doccloak-custom-labels';

// ── Acceleration setting ───────────────────────────────────
export type AccelMode = 'auto' | 'webgpu' | 'wasm';

export function getAccelMode(): AccelMode {
  const saved = localStorage.getItem('doccloak-acceleration');
  if (saved === 'webgpu' || saved === 'wasm') return saved;
  return 'auto';
}

export function setAccelMode(mode: AccelMode): void {
  localStorage.setItem('doccloak-acceleration', mode);
}

export function getExecutionProviders(): { providers: string[]; isExplicit: boolean } {
  const mode = getAccelMode();
  if (mode === 'webgpu') return { providers: ['webgpu'], isExplicit: true };
  if (mode === 'wasm') return { providers: ['wasm'], isExplicit: true };
  return { providers: ['webgpu', 'wasm'], isExplicit: false };
}

// ── Saved provider ─────────────────────────────────────────
function loadSavedProviderId(): ProviderId {
  const saved = localStorage.getItem(PROVIDER_STORAGE_KEY);
  if (saved && PROVIDERS.some((p) => p.id === saved)) return saved as ProviderId;
  return 'gliner';
}

// ── Worker singleton ───────────────────────────────────────
let worker: Worker | null = null;
let activeId: ProviderId = loadSavedProviderId();
let loaded = false;
let loading = false;
let threshold = activeId === 'bardsai' ? 0.5 : 0.35;
let customLabels: string[] = [];
let regexEnabled = loadRegexSetting();
let regexRegion = loadRegexRegion();

// Callbacks
let downloadProgressCallback: ProgressCallback | null = null;
let loadResolve: (() => void) | null = null;
let loadReject: ((err: Error) => void) | null = null;

// Release tracking
let releaseResolve: (() => void) | null = null;

// Detection request tracking
let requestCounter = 0;
const pendingDetections = new Map<number, {
  resolve: (entities: DetectedEntity[]) => void;
  reject: (err: Error) => void;
  onProgress?: (progress: number) => void;
}>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('./detection.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = handleWorkerMessage;
    worker.onerror = (e) => {
      console.error('[DocCloak] Worker error:', e);
    };
  }
  return worker;
}

function handleWorkerMessage(e: MessageEvent) {
  const msg = e.data;

  switch (msg.type) {
    case 'downloadProgress': {
      downloadProgressCallback?.(msg.downloaded, msg.total);
      break;
    }

    case 'loaded': {
      loaded = true;
      loading = false;
      activeId = msg.providerId;
      threshold = msg.threshold;
      customLabels = msg.customLabels ?? [];
      loadResolve?.();
      loadResolve = null;
      loadReject = null;
      break;
    }

    case 'loadError': {
      loaded = false;
      loading = false;
      loadReject?.(new Error(msg.error));
      loadResolve = null;
      loadReject = null;
      break;
    }

    case 'detectionProgress': {
      const pending = pendingDetections.get(msg.requestId);
      pending?.onProgress?.(msg.progress);
      break;
    }

    case 'detected': {
      const pending = pendingDetections.get(msg.requestId);
      if (pending) {
        pendingDetections.delete(msg.requestId);
        pending.resolve(msg.entities);
      }
      break;
    }

    case 'detectError': {
      const pending = pendingDetections.get(msg.requestId);
      if (pending) {
        pendingDetections.delete(msg.requestId);
        pending.reject(new Error(msg.error));
      }
      break;
    }

    case 'released': {
      loaded = false;
      releaseResolve?.();
      releaseResolve = null;
      break;
    }
  }
}

// ── Public API (same signatures as before) ─────────────────

/**
 * Detect entities in text using the active provider (runs in Web Worker).
 */
export function detectEntities(
  text: string,
  onProgress?: (progress: number) => void,
): Promise<DetectedEntity[]> {
  const requestId = ++requestCounter;
  const w = getWorker();

  return new Promise<DetectedEntity[]>((resolve, reject) => {
    pendingDetections.set(requestId, { resolve, reject, onProgress });
    w.postMessage({ type: 'detect', requestId, text });
  });
}

/**
 * Preload the detection model in the background.
 */
export function preloadModel(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) {
    return new Promise<void>((resolve, reject) => {
      loadResolve = resolve;
      loadReject = reject;
    });
  }

  loading = true;
  const savedLabels = loadCustomLabelsFromStorage();

  return new Promise<void>((resolve, reject) => {
    loadResolve = resolve;
    loadReject = reject;
    getWorker().postMessage({
      type: 'init',
      providerId: activeId,
      customLabels: savedLabels,
      regexEnabled,
      regexRegion,
    });
  });
}

/**
 * Register a download progress callback.
 */
export function onDownloadProgress(callback: ProgressCallback): void {
  downloadProgressCallback = callback;
}

/**
 * Whether the detection model is loaded and ready.
 */
export function isModelLoaded(): boolean {
  return loaded;
}

/**
 * Whether the detection model is currently loading.
 */
export function isModelLoading(): boolean {
  return loading;
}

/**
 * Name of the active detection provider.
 */
export function getProviderName(): string {
  return PROVIDERS.find((p) => p.id === activeId)?.label ?? activeId;
}

/**
 * ID of the active detection provider.
 */
export function getActiveProviderId(): ProviderId {
  return activeId;
}

/**
 * Switch to a different detection provider.
 */
export async function switchProvider(
  id: ProviderId,
  progressCallback?: ProgressCallback,
): Promise<void> {
  if (id === activeId && loaded) return;

  const entry = PROVIDERS.find((p) => p.id === id);
  if (!entry) throw new Error(`Unknown provider: ${id}`);

  loaded = false;
  loading = true;

  if (progressCallback) {
    downloadProgressCallback = progressCallback;
  }

  localStorage.setItem(PROVIDER_STORAGE_KEY, id);
  const savedLabels = loadCustomLabelsFromStorage();

  return new Promise<void>((resolve, reject) => {
    loadResolve = resolve;
    loadReject = reject;
    getWorker().postMessage({
      type: 'switchProvider',
      providerId: id,
      customLabels: savedLabels,
    });
  });
}

/**
 * Set the detection confidence threshold (0.05–0.95).
 */
export function setDetectionThreshold(value: number): void {
  threshold = Math.max(0.05, Math.min(0.95, value));
  if (worker) {
    worker.postMessage({ type: 'setThreshold', value: threshold });
  }
}

/**
 * Get the current detection confidence threshold.
 */
export function getDetectionThreshold(): number {
  return threshold;
}

/**
 * Get user-defined custom detection labels.
 */
export function getCustomLabels(): string[] {
  return [...customLabels];
}

/**
 * Set user-defined custom detection labels.
 */
export function setCustomLabels(labels: string[]): void {
  customLabels = labels.filter((l) => l.trim().length > 0);
  localStorage.setItem(CUSTOM_LABELS_STORAGE_KEY, JSON.stringify(customLabels));
  if (worker) {
    worker.postMessage({ type: 'setCustomLabels', labels: customLabels });
  }
}

/**
 * Release the ONNX session to free memory. The model will be re-loaded on next detection.
 */
export function releaseModel(): Promise<void> {
  if (!worker || !loaded) return Promise.resolve();
  return new Promise<void>((resolve) => {
    releaseResolve = resolve;
    worker!.postMessage({ type: 'releaseModel' });
  });
}

const REGEX_STORAGE_KEY = 'doccloak-regex-enabled';
const REGEX_REGION_STORAGE_KEY = 'doccloak-regex-region';

export const REGEX_REGIONS = [
  'all', 'gb', 'us', 'pl', 'de', 'fr', 'es', 'pt', 'se', 'no',
  'it', 'nl', 'be', 'at', 'ch', 'ie', 'dk', 'fi',
] as const;

export type RegexRegionId = typeof REGEX_REGIONS[number];

/**
 * Whether regex pattern detection is enabled.
 */
export function isRegexEnabled(): boolean {
  return regexEnabled;
}

/**
 * Enable or disable regex pattern detection.
 */
export function setRegexEnabled(enabled: boolean): void {
  regexEnabled = enabled;
  localStorage.setItem(REGEX_STORAGE_KEY, JSON.stringify(enabled));
  if (worker) {
    worker.postMessage({ type: 'setRegex', enabled, region: regexRegion });
  }
}

/**
 * Get the active regex region.
 */
export function getRegexRegion(): RegexRegionId {
  return regexRegion;
}

/**
 * Set the regex region filter.
 */
export function setRegexRegionSetting(region: RegexRegionId): void {
  regexRegion = region;
  localStorage.setItem(REGEX_REGION_STORAGE_KEY, region);
  if (worker) {
    worker.postMessage({ type: 'setRegexRegion', region });
  }
}

// ── Helpers ────────────────────────────────────────────────

function loadRegexRegion(): RegexRegionId {
  try {
    const saved = localStorage.getItem(REGEX_REGION_STORAGE_KEY);
    if (saved && REGEX_REGIONS.includes(saved as RegexRegionId)) return saved as RegexRegionId;
  } catch { /* ignore */ }
  return 'all';
}

function loadRegexSetting(): boolean {
  try {
    const saved = localStorage.getItem(REGEX_STORAGE_KEY);
    if (saved !== null) return JSON.parse(saved);
  } catch { /* ignore */ }
  return false;
}

function loadCustomLabelsFromStorage(): string[] {
  try {
    const saved = localStorage.getItem(CUSTOM_LABELS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return [];
}
