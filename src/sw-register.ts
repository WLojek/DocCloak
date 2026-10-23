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
/**
 * A first install that fails (a shell file did not download even after the
 * worker's own retries) is registered again after each of these delays (ms).
 * Without it the page had no worker, and the app no offline use, until the
 * user's next online visit.
 */
const INSTALL_RETRY_DELAYS = [2_000, 15_000, 60_000];

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
      watchFirstInstall(container, registration, (retry, ms) => window.setTimeout(retry, ms));
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
 * Register again when the worker installing for a page that has no active
 * worker becomes redundant (its install failed), after INSTALL_RETRY_DELAYS;
 * a failed update of an active worker is left to the browser's own checks.
 * `schedule` runs the retry after `ms` (setTimeout in the page).
 */
export function watchFirstInstall(
  container: Pick<ServiceWorkerContainer, 'register'>,
  registration: ServiceWorkerRegistration,
  schedule: (retry: () => void, ms: number) => void,
  attempt = 0,
): void {
  const retry = (): void => {
    const delay = INSTALL_RETRY_DELAYS[attempt];
    if (delay === undefined) return;
    schedule(() => {
      container
        .register(SW_URL, { scope: '/' })
        .then((next) => watchFirstInstall(container, next, schedule, attempt + 1))
        .catch(() => { /* offline: the next visit registers again */ });
    }, delay);
  };
  const track = (worker: ServiceWorker | null): void => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'redundant' && !registration.active) retry();
    });
  };
  // The install can fail before the page sees the registration: no worker at all is a failed install too.
  if (!registration.installing && !registration.waiting && !registration.active) {
    retry();
    return;
  }
  track(registration.installing);
  registration.addEventListener('updatefound', () => track(registration.installing));
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
 * Make sure the service worker holds `paths` in its runtime cache: fetch each through the worker
 * once it controls the page (cache-first: a file it already holds is served from the cache, no
 * download). On a first visit the detection worker can start before the service worker takes
 * control, and its ONNX Runtime fetch then bypasses the cache, so the app would not start offline
 * later. Called after the model has loaded, so nothing is fetched before the user's consent.
 * Production only, best effort.
 */
export function warmRuntimeCache(paths: string[]): void {
  if (!import.meta.env.PROD || !isServiceWorkerSupported() || paths.length === 0) return;
  const container = navigator.serviceWorker;
  const warm = (): void => {
    for (const path of paths) {
      fetch(path, { credentials: 'same-origin' })
        .then((response) => (response.ok ? response.blob() : null))
        .catch(() => { /* offline or transient: the next visit tries again */ });
    }
  };
  if (container.controller) warm();
  else container.addEventListener('controllerchange', warm, { once: true });
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
