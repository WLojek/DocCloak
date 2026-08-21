/**
 * Detection engine adapter (web main thread).
 *
 * Thin facade over the @doccloak/core engine that runs inside the detection
 * Web Worker: it keeps the synchronous settings mirrors (loaded from the
 * same localStorage keys as before the extraction), spawns the worker and
 * talks to it through connectEngine. The export surface is unchanged so
 * useAnonymizer.ts and App.tsx compile as-is; engine logic and the message
 * protocol now live in @doccloak/core.
 */

import {
  PROVIDERS,
  REGEX_REGIONS,
  ENGINE_SETTINGS_KEYS,
  clampThreshold,
  defaultThresholdFor,
  pickDefaultProvider,
  connectEngine,
} from '@doccloak/core';
import type {
  DetectedEntity,
  ProgressCallback,
  EngineClient,
  HardwareHints,
  ProviderId,
  ProviderEntry,
  RegexRegionId,
} from '@doccloak/core';

// Re-export the registry and region catalog (moved to core in T009) so the
// adapter keeps the full legacy engine surface in one module.
export { PROVIDERS, REGEX_REGIONS };
export type { ProviderId, ProviderEntry, RegexRegionId };

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

/**
 * Hardware hints for core's default-model heuristic (mobile/low-memory
 * devices default to the lightweight GLiNER model; the decision lives in
 * core's pickDefaultProvider). Twin of webHardwareHints in
 * src/engine-env.web.ts, duplicated here on purpose: that module statically
 * imports @huggingface/transformers, which must stay out of the main bundle.
 */
function mainThreadHardwareHints(): HardwareHints {
  const hints: HardwareHints = {};
  try {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean }; deviceMemory?: number };
    let isMobile = false;
    if (nav.userAgentData?.mobile) isMobile = true;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) isMobile = true;
    // iPadOS 13+ reports itself as macOS; tell it apart via touch support
    if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) isMobile = true;
    hints.isMobile = isMobile;
    if (typeof nav.deviceMemory === 'number') hints.deviceMemoryGB = nav.deviceMemory;
  } catch { /* ignore - assume unconstrained */ }
  return hints;
}

function loadSavedProviderId(): ProviderId {
  try {
    const saved = localStorage.getItem(ENGINE_SETTINGS_KEYS.provider);
    if (saved && PROVIDERS.some((p) => p.id === saved)) return saved as ProviderId;
  } catch { /* localStorage unavailable */ }
  return pickDefaultProvider(mainThreadHardwareHints());
}

/** Approximate download size per provider, for consent/setup copy. */
export const PROVIDER_SIZES: Record<ProviderId, string> = {
  gliner: '65 MB',
  bardsai: '279 MB',
};

/**
 * The provider core would pick for this device, ignoring any saved choice.
 * Desktop gets the large high-accuracy model; mobile/low-memory devices get
 * the lightweight one. Used to decide whether a big download deserves a
 * warning (it does not when it is the intended default for this device).
 */
export function getRecommendedProviderId(): ProviderId {
  return pickDefaultProvider(mainThreadHardwareHints());
}

// ── Worker connection + settings mirrors ──────────────────
let worker: Worker | null = null;
let client: EngineClient | null = null;
let activeId: ProviderId = loadSavedProviderId();
let loaded = false;
let loading = false;
let inflightLoad: Promise<void> | null = null;
let threshold = defaultThresholdFor(activeId);
let customLabels: string[] = [];
let regexEnabled = loadRegexSetting();
let regexRegion = loadRegexRegion();

// Callbacks
let downloadProgressCallback: ProgressCallback | null = null;

function getClient(): EngineClient {
  if (!client) {
    const w = new Worker(
      new URL('./detection.worker.ts', import.meta.url),
      { type: 'module' },
    );
    worker = w;
    const c = connectEngine(
      {
        postMessage: (msg) => w.postMessage(msg),
        onMessage: (cb) => {
          w.onmessage = (e) => { void cb(e.data); };
          return () => { w.onmessage = null; };
        },
      },
      {
        providerId: activeId,
        threshold,
        regexEnabled,
        regexRegion,
        customLabels: loadCustomLabelsFromStorage(),
      },
    );
    c.onDownloadProgress(({ loaded: downloaded, total }) => {
      downloadProgressCallback?.(downloaded, total);
    });
    w.onerror = (e) => {
      // The worker itself crashed (commonly WASM out-of-memory on mobile).
      // Fail every pending promise so the UI can surface an error and offer
      // a retry instead of hanging forever, and drop the dead worker so the
      // next call spawns a fresh one.
      console.error('[DocCloak] Worker error:', e);
      const err = new Error(e.message || 'Detection worker crashed');
      loading = false;
      loaded = false;
      inflightLoad = null;
      c.close(err);
      if (client === c) client = null;
      w.terminate();
      if (worker === w) worker = null;
    };
    client = c;
  }
  return client;
}

// ── Public API (same signatures as before) ─────────────────

/**
 * Detect entities in text using the active provider (runs in Web Worker).
 */
export function detectEntities(
  text: string,
  onProgress?: (progress: number) => void,
): Promise<DetectedEntity[]> {
  return getClient().detect(text, undefined, onProgress);
}

/**
 * Preload the detection model in the background.
 */
export function preloadModel(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (inflightLoad) return inflightLoad;

  loading = true;
  const c = getClient();
  inflightLoad = c.preload()
    .then(() => {
      const s = c.getSettings();
      loaded = true;
      activeId = s.providerId;
      threshold = s.threshold;
      customLabels = [...s.customLabels];
    })
    .catch((err: unknown) => {
      loaded = false;
      throw err;
    })
    .finally(() => {
      loading = false;
      inflightLoad = null;
    });
  return inflightLoad;
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

  localStorage.setItem(ENGINE_SETTINGS_KEYS.provider, id);
  const savedLabels = loadCustomLabelsFromStorage();

  const c = getClient();
  try {
    await c.switchProvider(id, savedLabels);
    const s = c.getSettings();
    activeId = s.providerId;
    threshold = s.threshold;
    customLabels = [...s.customLabels];
    loaded = true;
  } finally {
    loading = false;
  }
}

/**
 * Set the detection confidence threshold (0.05-0.95).
 */
export function setDetectionThreshold(value: number): void {
  threshold = clampThreshold(value);
  if (client) {
    void client.updateSettings({ threshold });
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
  localStorage.setItem(ENGINE_SETTINGS_KEYS.customLabels, JSON.stringify(customLabels));
  if (client) {
    void client.updateSettings({ customLabels });
  }
}

/**
 * Release the ONNX session to free memory. The model will be re-loaded on next detection.
 */
export function releaseModel(): Promise<void> {
  if (!client || !loaded) return Promise.resolve();
  return client.release().then(() => {
    loaded = false;
  });
}

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
  localStorage.setItem(ENGINE_SETTINGS_KEYS.regexEnabled, JSON.stringify(enabled));
  if (client) {
    void client.updateSettings({ regexEnabled: enabled, regexRegion });
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
  localStorage.setItem(ENGINE_SETTINGS_KEYS.regexRegion, region);
  if (client) {
    void client.updateSettings({ regexRegion: region });
  }
}

// ── Helpers ────────────────────────────────────────────────

function loadRegexRegion(): RegexRegionId {
  try {
    const saved = localStorage.getItem(ENGINE_SETTINGS_KEYS.regexRegion);
    if (saved && REGEX_REGIONS.includes(saved as RegexRegionId)) return saved as RegexRegionId;
  } catch { /* ignore */ }
  return 'all';
}

function loadRegexSetting(): boolean {
  try {
    const saved = localStorage.getItem(ENGINE_SETTINGS_KEYS.regexEnabled);
    if (saved !== null) return JSON.parse(saved);
  } catch { /* ignore */ }
  return false;
}

function loadCustomLabelsFromStorage(): string[] {
  try {
    const saved = localStorage.getItem(ENGINE_SETTINGS_KEYS.customLabels);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return [];
}
