/**
 * Which detection models are saved on this device, and removing one (T250). Read again whenever
 * `refreshKey` changes (the settings open, a model finishes loading); `saved` is null while
 * unknown or when the browser does not let the page see its cache, and the picker then shows no
 * saved / needs-download line.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderId } from '@doccloak/core';
import { PROVIDERS } from '../../engine.ts';
import { removeSavedProvider, savedProviderIds } from '../../model-cache.ts';

export function useModelStorage(refreshKey: unknown) {
  const [saved, setSaved] = useState<Set<ProviderId> | null>(null);
  const [removing, setRemoving] = useState<ProviderId | null>(null);
  // Only the latest read lands: a slow one started before a removal must not bring the model back.
  const reads = useRef(0);

  const refresh = useCallback(async () => {
    const read = ++reads.current;
    let next: Set<ProviderId> | null = null;
    try {
      next = await savedProviderIds(PROVIDERS.map((p) => p.id));
    } catch {
      next = null;
    }
    if (read === reads.current) setSaved(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  /** Resolves true when the model's files are gone. */
  const remove = useCallback(async (id: ProviderId): Promise<boolean> => {
    setRemoving(id);
    try {
      await removeSavedProvider(id);
      return true;
    } catch {
      return false;
    } finally {
      setRemoving(null);
      await refresh();
    }
  }, [refresh]);

  return { saved, removing, remove };
}
