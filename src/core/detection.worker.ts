/**
 * Detection Web Worker
 *
 * Runs NER model loading, inference, and entity detection entirely off the
 * main thread so the UI stays responsive even when the browser tab is in the
 * background (Web Workers are not throttled like setTimeout).
 */

import type { DetectedEntity, DetectionProvider } from './types.ts';
import { GlinerProvider, BardsaiProvider } from './detectors/ner/index.ts';
import { ALL_REGEX_RULES } from './regex/index.ts';

// ── Provider registry (mirrors engine.ts) ────────────────
type ProviderId = 'gliner' | 'bardsai';

function createProvider(id: ProviderId): DetectionProvider {
  if (id === 'bardsai') return new BardsaiProvider();
  return new GlinerProvider();
}

let activeId: ProviderId = 'bardsai';
let provider: DetectionProvider = createProvider(activeId);
let regexEnabled = false;
let regexRegion = 'all';

// ── Detection helpers (moved from engine.ts) ─────────────

function detectWithRegex(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  const rules = regexRegion === 'all'
    ? ALL_REGEX_RULES
    : ALL_REGEX_RULES.filter((r) => r.region === 'universal' || r.region === regexRegion);
  for (const rule of rules) {
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

function filterFalsePositives(entities: DetectedEntity[]): DetectedEntity[] {
  return entities.filter((e) => {
    if (e.value.trim().length < 3) return false;
    return true;
  });
}

function propagateEntities(text: string, entities: DetectedEntity[]): DetectedEntity[] {
  const propagated: DetectedEntity[] = [];
  const seen = new Set<string>();

  for (const e of entities) {
    seen.add(`${e.start}:${e.end}`);
  }

  const terms: { term: string; type: DetectedEntity['type'] }[] = [];
  const addedTerms = new Set<string>();

  for (const e of entities) {
    const val = e.value.trim();
    if (val.length >= 3 && !addedTerms.has(val.toLowerCase())) {
      addedTerms.add(val.toLowerCase());
      terms.push({ term: val, type: e.type });
    }
    if (val.includes(' ')) {
      for (const word of val.split(/\s+/)) {
        const w = word.replace(/[.,;:!?()]+$/, '');
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

async function detectEntities(
  text: string,
  requestId: number,
): Promise<DetectedEntity[]> {
  if (!text.trim()) return [];

  const mlResults = filterFalsePositives(
    await provider.detect(text, (progress: number) => {
      self.postMessage({ type: 'detectionProgress', requestId, progress });
    }),
  );
  const regexResults = regexEnabled ? detectWithRegex(text) : [];
  const initial = resolveOverlaps([...mlResults, ...regexResults]);
  const propagated = propagateEntities(text, initial);
  return resolveOverlaps([...initial, ...propagated]);
}

// ── Message handling ─────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
self.onmessage = async (e: MessageEvent<any>) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init': {
      const { providerId, customLabels } = msg;
      activeId = providerId;
      provider = createProvider(activeId);
      if (msg.regexEnabled !== undefined) regexEnabled = msg.regexEnabled;
      if (msg.regexRegion !== undefined) regexRegion = msg.regexRegion;

      provider.onProgress((downloaded: number, total: number) => {
        self.postMessage({ type: 'downloadProgress', downloaded, total });
      });

      if (customLabels && 'setCustomLabels' in provider) {
        (provider as any).setCustomLabels(customLabels);
      }
      if ('restoreCustomLabels' in provider) {
        (provider as any).restoreCustomLabels();
      }

      try {
        await provider.load();
        const threshold = provider.getThreshold();
        const labels = 'getCustomLabels' in provider
          ? (provider as any).getCustomLabels()
          : [];
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
        const entities = await detectEntities(text, requestId);
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

      // Release previous provider's ONNX session to free WASM heap
      provider.release();

      // Clear cached model from previous provider
      try {
        await caches.delete('doccloak-models');
      } catch { /* ignore */ }

      activeId = providerId;
      provider = createProvider(activeId);

      provider.onProgress((downloaded: number, total: number) => {
        self.postMessage({ type: 'downloadProgress', downloaded, total });
      });

      if (customLabels && 'setCustomLabels' in provider) {
        (provider as any).setCustomLabels(customLabels);
      }
      if ('restoreCustomLabels' in provider) {
        (provider as any).restoreCustomLabels();
      }

      try {
        await provider.load();
        const threshold = provider.getThreshold();
        const labels = 'getCustomLabels' in provider
          ? (provider as any).getCustomLabels()
          : [];
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
      if ('setCustomLabels' in provider) {
        (provider as any).setCustomLabels(msg.labels);
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
