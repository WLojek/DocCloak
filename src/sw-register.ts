/**
 * Service Worker registration (T195).
 *
 * Registers /sw.js in production builds only, and only where the API exists.
 * When a new worker takes control of a page that already had one (an update,
 * not the first install), every listener registered through
 * onServiceWorkerUpdate() is notified; main.tsx turns that into the
 * "new version available, reload" toast. Keeping the event bus here means
 * App.tsx and the engine never learn about the worker.
 */

type UpdateListener = () => void;

const listeners = new Set<UpdateListener>();
let registered = false;

const SW_URL = '/sw.js';
const OWN_CACHE_PREFIXES = ['doccloak-shell-', 'doccloak-runtime-'];

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* a broken listener must not break the others */
    }
  }
}

/** Subscribe to "a new version took control"; returns the unsubscribe function. */
export function onServiceWorkerUpdate(listener: UpdateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

function register(): void {
  const container = navigator.serviceWorker;
  // A controller at this point means the page was loaded through an existing
  // worker, so the next controllerchange is an update rather than the first
  // install (clients.claim fires controllerchange on first install too).
  let hadController = container.controller !== null;
  container.addEventListener('controllerchange', () => {
    if (hadController) notify();
    hadController = true;
  });

  container
    .register(SW_URL, { scope: '/' })
    .then((registration) => {
      // Long-lived tabs: re-check for a new build when the tab becomes
      // visible again, in addition to the browser's own navigation-time check.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => { /* offline or transient */ });
        }
      });
    })
    .catch((err: unknown) => {
      console.warn('[sw] registration failed', err);
    });
}

/**
 * Register the worker. Production only, once per page, after `load` so the
 * registration never competes with the first paint for bandwidth.
 */
export function registerServiceWorker(): void {
  if (registered) return;
  if (!import.meta.env.PROD) return;
  if (!isServiceWorkerSupported()) return;
  registered = true;

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}

/**
 * Kill switch from the page: unregister every worker for this origin and
 * drop the caches the worker owns. 'doccloak-models' (the app's own model
 * cache) and every other cache are left alone. Resolves true when at least
 * one registration was removed.
 */
export async function unregisterServiceWorker(): Promise<boolean> {
  if (!isServiceWorkerSupported()) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const results = await Promise.all(registrations.map((r) => r.unregister()));
  if (typeof caches !== 'undefined') {
    try {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => OWN_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
          .map((name) => caches.delete(name)),
      );
    } catch {
      /* storage blocked: nothing to clean */
    }
  }
  return results.some(Boolean);
}
