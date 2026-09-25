/**
 * Detection engine adapter (web main thread).
 *
 * Thin facade over the @doccloak/core engine that runs inside the detection
 * Web Worker: it keeps the synchronous settings mirrors (loaded from the
 * same localStorage keys as before the extraction), spawns the worker and
 * talks to it through connectEngine. The export surface is unchanged so
 * useAnonymizer.ts and App.tsx compile as-is; engine logic and the message
 * protocol now live in @doccloak/core.
 *
 * Security remediation 2026-09 (T188):
 * - Consent gate (S2): preloadModel() and switchProvider() are the only two
 *   paths that can start a model download, and both refuse with
 *   ConsentRequiredError until localStorage['doccloak-model-consented'] is
 *   '1'. detectEntities() awaits preloadModel() first (the worker runs with
 *   autoLoad: false, so detect() alone never downloads anything).
 * - Watchdog (R1): a detect call that reports no progress for
 *   DETECTION_STALL_MS terminates the worker, spawns a fresh one and rejects
 *   with DetectionTimeoutError. Progress-based on purpose: ML detection on a
 *   phone legitimately takes minutes and reports per chunk; a hung regex
 *   reports nothing. There is no total time budget.
 * - Cancel (T222): detectEntities takes an AbortSignal. Aborting it sends
 *   cancelDetect to the worker, which stops at its next inference chunk and
 *   acknowledges; the call then rejects with DetectionAbortedError and the
 *   worker stays warm. A worker that does not acknowledge within
 *   CANCEL_GRACE_MS (a chunk on a slow phone takes seconds, a hung regex
 *   never returns) is terminated and replaced, like on a watchdog stall.
 */

import {
  DetectionAbortedError,
  PROVIDERS as CORE_PROVIDERS,
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
import { detectUiLanguage } from './i18n/storage.ts';
import { languages as UI_LANGUAGES } from './i18n/translations/index.ts';

const UI_LANGUAGE_CODES: readonly string[] = UI_LANGUAGES.map((l) => l.code);

/**
 * UI language -> regex region used while the user has not picked one (T228).
 * 'all' runs every country's rules on every text, which on Polish documents
 * let the Spanish "C" (Calle) and Portuguese "R." street rules and the
 * 4-digit postal rules of no/be/at/ch/dk swallow parts of e-mails and names.
 * English has no single region, so it keeps 'all'.
 */
const REGION_FOR_LANGUAGE: Record<string, RegexRegionId> = {
  pl: 'pl', de: 'de', fr: 'fr', es: 'es', pt: 'pt', no: 'no', sv: 'se', en: 'all',
};

// Re-export the region catalog (moved to core in T009) so the adapter keeps
// the full legacy engine surface in one module.
export { REGEX_REGIONS };
export type { ProviderId, ProviderEntry, RegexRegionId };

// ── Provider table with download sizes ─────────────────────

/** Approximate download size per provider in MB (consent card, setup copy). */
export const PROVIDER_SIZE_MB: Record<ProviderId, number> = {
  gliner: 83,
  'gliner-base': 197,
  bardsai: 279,
};

/** Core's provider entry plus the download size the consent card quotes. */
export type WebProviderEntry = ProviderEntry & { sizeMB: number };

/**
 * The provider registry with `sizeMB` next to `label`. Same order and ids as
 * core's PROVIDERS; UI code that needs the size reads it from here.
 */
export const PROVIDERS: readonly WebProviderEntry[] = CORE_PROVIDERS.map((p) => ({
  ...p,
  sizeMB: PROVIDER_SIZE_MB[p.id],
}));

/** Approximate download size per provider, formatted for copy ("83 MB"). */
export const PROVIDER_SIZES: Record<ProviderId, string> = Object.fromEntries(
  (Object.keys(PROVIDER_SIZE_MB) as ProviderId[]).map((id) => [id, `${PROVIDER_SIZE_MB[id]} MB`]),
) as Record<ProviderId, string>;

// ── Consent gate (S2) ──────────────────────────────────────

/** localStorage key that records the user's one-time download consent. */
export const CONSENT_STORAGE_KEY = 'doccloak-model-consented';

/**
 * Thrown by preloadModel() / switchProvider() when the consent flag is not
 * stored. The hook catches it, remembers `providerId` as the pending choice
 * and shows the consent card; nothing has been downloaded or spawned.
 */
export class ConsentRequiredError extends Error {
  readonly providerId: ProviderId;
  constructor(providerId: ProviderId) {
    super(`Model download for "${providerId}" requires the user's consent (${CONSENT_STORAGE_KEY} is not set)`);
    this.name = 'ConsentRequiredError';
    this.providerId = providerId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** True when the user has accepted the one-time model download. */
export function hasModelConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the consent flag. Only the Accept button calls this. */
export function grantModelConsent(): void {
  localStorage.setItem(CONSENT_STORAGE_KEY, '1');
}

// ── Watchdog (R1) ──────────────────────────────────────────

/** No progress event for this long during a detect call = hung worker. */
export const DETECTION_STALL_MS = 20_000;

/**
 * T222: after a cancel, how long the worker gets to acknowledge (finish the
 * inference chunk in flight) before it is terminated and replaced.
 */
export const CANCEL_GRACE_MS = 5_000;

export { DetectionAbortedError };

/**
 * Rejection reason for a detect call the watchdog gave up on. The worker has
 * already been terminated and a fresh one is warming up (from cache, through
 * the consent gate); the UI tells the user to split the document.
 */
export class DetectionTimeoutError extends Error {
  readonly stallMs: number;
  constructor(stallMs: number = DETECTION_STALL_MS) {
    super(`Detection reported no progress for ${Math.round(stallMs / 1000)} s; the worker was restarted`);
    this.name = 'DetectionTimeoutError';
    this.stallMs = stallMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

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

/**
 * What getClient() spawns: the engine client plus a way to kill the worker
 * behind it. Tests inject a stub through _setClientFactoryForTests so no
 * Worker (and no network) is ever touched.
 */
export interface ClientHandle {
  client: EngineClient;
  terminate: () => void;
}

type ClientFactory = (initial: {
  providerId: ProviderId;
  threshold: number;
  regexEnabled: boolean;
  regexRegion: RegexRegionId;
  customLabels: string[];
}, onWorkerError: (err: Error) => void) => ClientHandle;

function spawnWorkerClient(
  initial: Parameters<ClientFactory>[0],
  onWorkerError: (err: Error) => void,
): ClientHandle {
  const w = new Worker(
    new URL('./detection.worker.ts', import.meta.url),
    { type: 'module' },
  );
  const c = connectEngine(
    {
      postMessage: (msg) => w.postMessage(msg),
      onMessage: (cb) => {
        w.onmessage = (e) => { void cb(e.data); };
        return () => { w.onmessage = null; };
      },
    },
    initial,
  );
  w.onerror = (e) => {
    // The worker itself crashed (commonly WASM out-of-memory on mobile).
    console.error('[DocCloak] Worker error:', e);
    onWorkerError(new Error(e.message || 'Detection worker crashed'));
  };
  return { client: c, terminate: () => w.terminate() };
}

let clientFactory: ClientFactory = spawnWorkerClient;

let handle: ClientHandle | null = null;
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

/**
 * Drop the current worker: reject every pending promise with `reason`, stop
 * listening, terminate, and forget it so the next call spawns a fresh one.
 * Shared by the crash handler and the watchdog.
 */
function discardWorker(reason: Error): void {
  const h = handle;
  const c = client;
  handle = null;
  client = null;
  loading = false;
  loaded = false;
  inflightLoad = null;
  c?.close(reason);
  h?.terminate();
}

/**
 * Connect to (or spawn) the detection worker. Never triggers a model load:
 * the worker runs createEngine({ autoLoad: false }) and only preloadModel()
 * / switchProvider() ask it to load, both behind the consent gate.
 */
function getClient(): EngineClient {
  if (!client) {
    let h: ClientHandle | null = null;
    h = clientFactory(
      {
        providerId: activeId,
        threshold,
        regexEnabled,
        regexRegion,
        customLabels: loadCustomLabelsFromStorage(),
      },
      (err) => {
        // Fail every pending promise so the UI can surface an error and
        // offer a retry instead of hanging forever, and drop the dead worker
        // so the next call spawns a fresh one.
        if (handle === h) discardWorker(err);
      },
    );
    h.client.onDownloadProgress(({ loaded: downloaded, total }) => {
      downloadProgressCallback?.(downloaded, total);
    });
    handle = h;
    client = h.client;
  }
  return client;
}

// ── Public API (same signatures as before) ─────────────────

/**
 * Detect entities in text using the active provider (runs in Web Worker).
 *
 * Awaits preloadModel() first (consent gate, autoLoad is off in the worker)
 * and runs under the progress watchdog: every progress event re-arms a
 * DETECTION_STALL_MS timer; when it fires, the worker is terminated, a fresh
 * one is spawned and warmed from cache, and the call rejects with
 * DetectionTimeoutError.
 */
export async function detectEntities(
  text: string,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<DetectedEntity[]> {
  if (signal?.aborted) throw new DetectionAbortedError();
  await preloadModel();
  if (signal?.aborted) throw new DetectionAbortedError();
  const c = getClient();

  return new Promise<DetectedEntity[]>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const disarm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const cleanup = () => {
      disarm();
      if (graceTimer !== null) clearTimeout(graceTimer);
      graceTimer = null;
      signal?.removeEventListener('abort', onAbort);
    };
    /** Terminate and replace the worker, then reject with `err` (watchdog and cancel-grace path). */
    const replaceWorker = (err: Error) => {
      if (client === c) {
        discardWorker(err);
        // Warm the replacement in the background so the next attempt starts
        // fast. From cache, through the same consent gate; failures surface
        // on the next detect call.
        preloadModel().catch(() => { /* reported by the next call */ });
      }
      reject(err);
    };
    const onStall = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const err = new DetectionTimeoutError();
      console.error('[DocCloak] Detection watchdog:', err.message);
      replaceWorker(err);
    };
    const arm = () => {
      disarm();
      timer = setTimeout(onStall, DETECTION_STALL_MS);
    };
    const onAbort = () => {
      if (settled) return;
      // The client has sent cancelDetect; the worker answers at its next
      // chunk boundary (rejection below). Progress may still arrive for the
      // chunk in flight, so the stall timer is replaced by the grace timer.
      disarm();
      graceTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        const err = new DetectionAbortedError('Detection cancelled; the worker did not stop in time and was restarted');
        console.warn('[DocCloak] Cancel grace period elapsed:', err.message);
        replaceWorker(err);
      }, CANCEL_GRACE_MS);
    };

    arm();
    signal?.addEventListener('abort', onAbort, { once: true });
    c.detect(text, signal, (progress) => {
      if (settled) return;
      if (graceTimer === null) arm();
      onProgress?.(progress);
    })
      .then((results) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(results);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      });
  });
}

/**
 * Preload the detection model in the background. Refuses with
 * ConsentRequiredError until the consent flag is stored; the worker is not
 * even spawned in that case.
 */
export function preloadModel(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (inflightLoad) return inflightLoad;
  if (!hasModelConsent()) return Promise.reject(new ConsentRequiredError(activeId));

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
 * Switch to a different detection provider. Refuses with
 * ConsentRequiredError until the consent flag is stored: nothing is saved,
 * spawned or downloaded, the caller keeps `id` as a preselection.
 */
export async function switchProvider(
  id: ProviderId,
  progressCallback?: ProgressCallback,
): Promise<void> {
  if (id === activeId && loaded) return;

  const entry = PROVIDERS.find((p) => p.id === id);
  if (!entry) throw new Error(`Unknown provider: ${id}`);
  if (!hasModelConsent()) throw new ConsentRequiredError(id);

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

/**
 * The UI language changed (or mounted): while the user has not picked a
 * region explicitly, the region follows the language. Nothing is persisted,
 * so a later language switch keeps following. Returns the active region.
 */
export function applyUiLanguage(language: string): RegexRegionId {
  if (hasExplicitRegexRegion()) return regexRegion;
  const region = regexRegionForLanguage(language);
  if (region !== regexRegion) {
    regexRegion = region;
    if (client) {
      void client.updateSettings({ regexRegion: region });
    }
  }
  return regexRegion;
}

// ── Test seams ─────────────────────────────────────────────

/**
 * Replace the worker spawner (tests only). Pass null to restore the real
 * one. Also resets the connection state so each test starts cold.
 */
export function _setClientFactoryForTests(factory: ClientFactory | null): void {
  clientFactory = factory ?? spawnWorkerClient;
  _resetEngineStateForTests();
}

/** Forget the current worker and loaded state without terminating (tests only). */
export function _resetEngineStateForTests(): void {
  handle = null;
  client = null;
  loaded = false;
  loading = false;
  inflightLoad = null;
  activeId = loadSavedProviderId();
  threshold = defaultThresholdFor(activeId);
  customLabels = [];
  regexEnabled = loadRegexSetting();
  regexRegion = loadRegexRegion();
  downloadProgressCallback = null;
}

// ── Helpers ────────────────────────────────────────────────

export function regexRegionForLanguage(language: string): RegexRegionId {
  return REGION_FOR_LANGUAGE[language.slice(0, 2).toLowerCase()] ?? 'all';
}

/** True when the user picked a region explicitly (the choice is persisted). */
export function hasExplicitRegexRegion(): boolean {
  try {
    const saved = localStorage.getItem(ENGINE_SETTINGS_KEYS.regexRegion);
    return !!saved && REGEX_REGIONS.includes(saved as RegexRegionId);
  } catch {
    return false;
  }
}

function loadRegexRegion(): RegexRegionId {
  try {
    const saved = localStorage.getItem(ENGINE_SETTINGS_KEYS.regexRegion);
    if (saved && REGEX_REGIONS.includes(saved as RegexRegionId)) return saved as RegexRegionId;
  } catch { /* ignore */ }
  return regexRegionForLanguage(detectUiLanguage(UI_LANGUAGE_CODES));
}

function loadRegexSetting(): boolean {
  try {
    const saved = localStorage.getItem(ENGINE_SETTINGS_KEYS.regexEnabled);
    if (saved !== null) return JSON.parse(saved);
  } catch { /* ignore */ }
  // On by default (T203): a fresh profile gets ML + regex, as the README says.
  return true;
}

function loadCustomLabelsFromStorage(): string[] {
  try {
    const saved = localStorage.getItem(ENGINE_SETTINGS_KEYS.customLabels);
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return [];
}
