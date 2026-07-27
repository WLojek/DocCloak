/**
 * Detection Web Worker bootstrap.
 *
 * All engine logic lives in @doccloak/core; this file only builds the web
 * CoreEnv, creates the engine and serves the worker message protocol over
 * the worker's own message port.
 */

import { createEngine, serveEngine } from '@doccloak/core';
import type { PortLike } from '@doccloak/core';
import { createWebCoreEnv } from '../engine-env.web.ts';

const workerPort: PortLike = {
  postMessage: (msg) => self.postMessage(msg),
  onMessage: (cb) => {
    self.onmessage = (e: MessageEvent) => cb(e.data);
    return () => { self.onmessage = null; };
  },
};

serveEngine(createEngine(createWebCoreEnv()), workerPort);
