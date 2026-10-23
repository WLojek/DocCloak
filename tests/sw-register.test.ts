import { describe, it, expect, vi } from 'vitest';
import { watchFirstInstall } from '../src/sw-register';

/**
 * A first install that fails (a shell file did not download) is registered
 * again, so one dropped request on a first visit does not leave the app
 * without offline use until the next visit.
 */

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  set(state: ServiceWorkerState): void {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

function registration(installing: FakeWorker | null, active: FakeWorker | null = null) {
  const reg = new EventTarget() as EventTarget & { installing: FakeWorker | null; waiting: null; active: FakeWorker | null };
  reg.installing = installing;
  reg.waiting = null;
  reg.active = active;
  return reg;
}

function setup() {
  const scheduled: Array<{ ms: number; run: () => void }> = [];
  const regs: ReturnType<typeof registration>[] = [];
  const container = {
    register: vi.fn(async () => {
      const reg = registration(new FakeWorker());
      regs.push(reg);
      return reg as unknown as ServiceWorkerRegistration;
    }),
  };
  const schedule = (run: () => void, ms: number) => { scheduled.push({ run, ms }); };
  return { container, schedule, scheduled, regs };
}

describe('watchFirstInstall', () => {
  it('registers again after a first install fails, with growing delays, at most three times', async () => {
    const { container, schedule, scheduled, regs } = setup();
    const first = new FakeWorker();
    watchFirstInstall(container, registration(first) as unknown as ServiceWorkerRegistration, schedule);
    first.set('redundant');
    expect(scheduled.map((s) => s.ms)).toEqual([2_000]);
    // Every retry's install fails too: each runs once, until no new retry is scheduled.
    for (let ran = 0; ran < scheduled.length; ran++) {
      scheduled[ran].run();
      await Promise.resolve();
      await Promise.resolve();
      regs[regs.length - 1].installing?.set('redundant');
    }
    expect(container.register).toHaveBeenCalledTimes(3);
    expect(scheduled.map((s) => s.ms)).toEqual([2_000, 15_000, 60_000]);
  });

  it('does nothing when the install succeeds', () => {
    const { container, schedule, scheduled } = setup();
    const worker = new FakeWorker();
    watchFirstInstall(container, registration(worker) as unknown as ServiceWorkerRegistration, schedule);
    worker.set('installed');
    worker.set('activated');
    expect(scheduled).toEqual([]);
  });

  it('leaves a failed update of an active worker to the browser', () => {
    const { container, schedule, scheduled } = setup();
    const update = new FakeWorker();
    watchFirstInstall(container, registration(update, new FakeWorker()) as unknown as ServiceWorkerRegistration, schedule);
    update.set('redundant');
    expect(scheduled).toEqual([]);
  });

  it('a registration with no worker at all (the install failed before the page saw it) is registered again', () => {
    const { container, schedule, scheduled } = setup();
    watchFirstInstall(container, registration(null) as unknown as ServiceWorkerRegistration, schedule);
    expect(scheduled.map((s) => s.ms)).toEqual([2_000]);
  });
});
