// @vitest-environment node
/**
 * public/sw.js install, run in a sandbox (WLojek/DocCloak#2): the shell precache refuses a script
 * served under a wrong MIME type (the install fails, so no worker serves a broken app) and stores
 * one served correctly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SW = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const LOGIC = readFileSync(new URL('../public/sw-logic.js', import.meta.url), 'utf8');
const ORIGIN = 'https://doccloak.example';

function install(types: Record<string, string>) {
  const caches = new Map<string, Map<string, Response>>();
  const handlers: Record<string, (event: unknown) => void> = {};
  const self = {
    location: { origin: ORIGIN },
    __DOCCLOAK_SW_MANIFEST__: { buildId: 'b1', precache: Object.keys(types) },
    caches: {
      open: async (name: string) => {
        if (!caches.has(name)) caches.set(name, new Map());
        const store = caches.get(name)!;
        return { put: async (key: string, res: Response) => { store.set(key, res); }, match: async (key: string) => store.get(key) };
      },
      keys: async () => [...caches.keys()],
      delete: async (name: string) => caches.delete(name),
    },
    fetch: async (request: Request) => {
      const path = new URL(request.url, ORIGIN).pathname;
      return new Response('body', { status: 200, headers: { 'Content-Type': types[path] } });
    },
    addEventListener: (type: string, fn: (event: unknown) => void) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  } as Record<string, unknown>;
  const context = vm.createContext({ self, Response, Request: class extends Request { constructor(url: string, init?: RequestInit) { super(new URL(url, ORIGIN), init); } },
    Headers, URL, Set, Map, Promise, Error, setTimeout, String, Array });
  (context as Record<string, unknown>).importScripts = () => vm.runInContext(LOGIC, context);
  vm.runInContext(SW, context);
  let done: Promise<unknown> = Promise.resolve();
  handlers.install({ waitUntil: (p: Promise<unknown>) => { done = p; } });
  return { done, caches };
}

describe('sw.js install (WLojek/DocCloak#2)', () => {
  it('stores the shell when every script has a JavaScript type', async () => {
    const { done, caches } = install({ '/index.html': 'text/html', '/assets/index-abc.js': 'application/javascript; charset=utf-8', '/fonts/a.woff2': 'font/woff2' });
    await expect(done).resolves.toBeUndefined();
    expect([...caches.get('doccloak-shell-b1')!.keys()].sort()).toEqual(['/assets/index-abc.js', '/fonts/a.woff2', '/index.html']);
  });

  it('refuses the install when a shell script comes under a wrong type', async () => {
    const { done } = install({ '/index.html': 'text/html', '/assets/index-abc.js': 'application/octet-stream' });
    await expect(done).rejects.toThrow(/precache refused \/assets\/index-abc\.js: served as application\/octet-stream/);
  });
});
