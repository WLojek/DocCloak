// @vitest-environment node
/**
 * T250: which models are saved on this device (Cache Storage 'doccloak-models', seen from the
 * page), removing one, and the GitHub feedback link.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { providerFileSets, verificationMarkerKey, type ProviderId } from '@doccloak/core';
import { MODEL_CACHE_NAME, removeSavedProvider, savedProviderIds } from '../../src/model-cache.ts';
import { PROVIDERS } from '../../src/engine.ts';
import { modelFeedbackUrl } from '../../src/feedback.ts';

const ORIGIN = 'https://doccloak.example';
const g = globalThis as { caches?: unknown; location?: unknown };
let buckets: Map<string, Map<string, Response>>;
let opened: string[];

function fakeCaches() {
  buckets = new Map();
  opened = [];
  return {
    open: async (name: string) => {
      opened.push(name);
      if (!buckets.has(name)) buckets.set(name, new Map());
      const entries = buckets.get(name)!;
      return {
        match: async (url: string) => entries.get(url),
        delete: async (url: string) => entries.delete(url),
      };
    },
  };
}

function download(id: ProviderId): void {
  const entries = buckets.get(MODEL_CACHE_NAME) ?? new Map<string, Response>();
  buckets.set(MODEL_CACHE_NAME, entries);
  for (const f of providerFileSets(id, `${ORIGIN}/`)[0]) {
    entries.set(f.url, new Response('x'));
    entries.set(verificationMarkerKey(f.url, f.sha256), new Response(`${f.sha256}:1`));
  }
}

const ids = PROVIDERS.map((p) => p.id);

beforeEach(() => {
  g.caches = fakeCaches();
  g.location = { origin: ORIGIN, href: `${ORIGIN}/` };
});

afterEach(() => {
  delete g.caches;
  delete g.location;
});

describe('models saved on this device (T250)', () => {
  it('lists the models whose files are all in the model bucket', async () => {
    expect(await savedProviderIds(ids)).toEqual(new Set());
    download('bardsai');
    download('gliner2-pii');
    expect(await savedProviderIds(ids)).toEqual(new Set(['bardsai', 'gliner2-pii']));
    expect(new Set(opened)).toEqual(new Set([MODEL_CACHE_NAME]));
  });

  it('removing a model frees its entries and leaves the others saved', async () => {
    download('bardsai');
    download('gliner2-pii');
    download('gliner2-pii-yethdev');
    await removeSavedProvider('gliner2-pii');
    expect(await savedProviderIds(ids)).toEqual(new Set(['bardsai', 'gliner2-pii-yethdev']));
    await removeSavedProvider('gliner2-pii-yethdev');
    await removeSavedProvider('bardsai');
    expect(buckets.get(MODEL_CACHE_NAME)!.size).toBe(0);
  });

  it('without Cache Storage the state is unknown and a removal fails', async () => {
    delete g.caches;
    expect(await savedProviderIds(ids)).toBeNull();
    await expect(removeSavedProvider('bardsai')).rejects.toThrow();
  });
});

describe('model feedback link (T250)', () => {
  it('opens the issue form, with the model and version filled in when given', () => {
    const general = new URL(modelFeedbackUrl());
    expect(`${general.origin}${general.pathname}`).toBe('https://github.com/WLojek/DocCloak/issues/new');
    expect(general.searchParams.get('template')).toBe('model-feedback.yml');
    expect(general.searchParams.has('model')).toBe(false);
    const one = new URL(modelFeedbackUrl('GLiNER2 Privacy Filter (yethdev)', 'DocCloak 0.16.0, core 0.16.0'));
    expect(one.searchParams.get('model')).toBe('GLiNER2 Privacy Filter (yethdev)');
    expect(one.searchParams.get('title')).toBe('Model feedback: GLiNER2 Privacy Filter (yethdev)');
    expect(one.searchParams.get('version')).toBe('DocCloak 0.16.0, core 0.16.0');
  });

  it('the issue form has a field for every prefilled parameter', async () => {
    const { readFile } = await import('node:fs/promises');
    const form = await readFile(new URL('../../.github/ISSUE_TEMPLATE/model-feedback.yml', import.meta.url), 'utf8');
    for (const id of ['model', 'version']) expect(form).toMatch(new RegExp(`\\n    id: ${id}\\n`));
    expect(form).toContain('do not paste real personal data');
  });
});
