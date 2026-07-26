/**
 * Detection Web Worker
 *
 * Runs NER model loading, inference, and entity detection entirely off the
 * main thread so the UI stays responsive even when the browser tab is in the
 * background (Web Workers are not throttled like setTimeout).
 */

import type { DetectedEntity, DetectionProvider } from './types.ts';
import { GlinerProvider, BardsaiProvider } from './detectors/ner/index.ts';
import { detectWithRegex, detectEntities } from '@doccloak/core';

// ── Provider registry (mirrors engine.ts) ────────────────
type ProviderId = 'gliner' | 'bardsai';

function createProvider(id: ProviderId): DetectionProvider {
  if (id === 'bardsai') return new BardsaiProvider();
  return new GlinerProvider();
}

interface CustomLabelCapable {
  setCustomLabels(labels: string[]): void;
  getCustomLabels(): string[];
  restoreCustomLabels(): void;
}

function supportsCustomLabels(p: DetectionProvider): p is DetectionProvider & CustomLabelCapable {
  return 'setCustomLabels' in p;
}

let activeId: ProviderId = 'bardsai';
let provider: DetectionProvider = createProvider(activeId);
let regexEnabled = false;
let regexRegion = 'all';

// ── Detection (pure pipeline lives in @doccloak/core) ────

async function runDetection(
  text: string,
  requestId: number,
): Promise<DetectedEntity[]> {
  if (!text.trim()) return [];

  const mlResults = await provider.detect(text, (progress: number) => {
    self.postMessage({ type: 'detectionProgress', requestId, progress });
  });
  const regexResults = regexEnabled ? detectWithRegex(text, regexRegion) : [];
  return detectEntities(text, mlResults, regexResults);
}

// ── Message handling ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.onmessage = async (e: MessageEvent<any>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init': {
      const { providerId, customLabels } = msg;
      if (activeId === providerId && provider.isLoaded()) {
        // Already initialized (e.g. duplicate init after a UI remount).
        // Keep the loaded session instead of re-downloading.
      } else if (activeId === providerId) {
        // Same provider, not loaded - a previous attempt may have failed.
        // release() clears the cached load error so load() can retry
        // (the model itself is served from the Cache API when available).
        provider.release();
      } else {
        activeId = providerId;
        provider = createProvider(activeId);
      }
      if (msg.regexEnabled !== undefined) regexEnabled = msg.regexEnabled;
      if (msg.regexRegion !== undefined) regexRegion = msg.regexRegion;

      provider.onProgress((downloaded: number, total: number) => {
        self.postMessage({ type: 'downloadProgress', downloaded, total });
      });

      if (supportsCustomLabels(provider)) {
        if (customLabels) provider.setCustomLabels(customLabels);
        provider.restoreCustomLabels();
      }

      try {
        await provider.load();
        const threshold = provider.getThreshold();
        const labels = supportsCustomLabels(provider) ? provider.getCustomLabels() : [];
        self.postMessage({ type: 'loaded', providerId: activeId, threshold, customLabels: labels });
      } catch (err) {
        self.postMessage({
          type: 'loadError',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'detect': {
      const { requestId, text } = msg;
      try {
        const entities = await runDetection(text, requestId);
        self.postMessage({ type: 'detected', requestId, entities });
      } catch (err) {
        self.postMessage({
          type: 'detectError',
          requestId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'switchProvider': {
      const { providerId, customLabels } = msg;

      // Release previous provider's ONNX session to free WASM heap.
      // Cached model files are kept so switching back does not re-download
      // hundreds of megabytes; the browser evicts them under quota pressure.
      provider.release();

      activeId = providerId;
      provider = createProvider(activeId);

      provider.onProgress((downloaded: number, total: number) => {
        self.postMessage({ type: 'downloadProgress', downloaded, total });
      });

      if (supportsCustomLabels(provider)) {
        if (customLabels) provider.setCustomLabels(customLabels);
        provider.restoreCustomLabels();
      }

      try {
        await provider.load();
        const threshold = provider.getThreshold();
        const labels = supportsCustomLabels(provider) ? provider.getCustomLabels() : [];
        self.postMessage({ type: 'loaded', providerId: activeId, threshold, customLabels: labels });
      } catch (err) {
        self.postMessage({
          type: 'loadError',
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }

    case 'setThreshold': {
      provider.setThreshold(msg.value);
      break;
    }

    case 'setCustomLabels': {
      if (supportsCustomLabels(provider)) {
        provider.setCustomLabels(msg.labels);
      }
      break;
    }

    case 'setRegex': {
      regexEnabled = msg.enabled;
      if (msg.region !== undefined) regexRegion = msg.region;
      break;
    }

    case 'setRegexRegion': {
      regexRegion = msg.region;
      break;
    }

    case 'releaseModel': {
      provider.release();
      self.postMessage({ type: 'released' });
      break;
    }
  }
};
