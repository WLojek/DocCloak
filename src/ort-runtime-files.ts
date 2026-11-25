/**
 * Which ONNX Runtime files a model needs (T289, core 0.18.1). The app serves two builds: the plain
 * one for every model that runs on the WASM execution provider, and the WebGPU one (the
 * `.asyncify` pair) for the models that run on the graphics card. The service worker is asked to
 * keep, for an offline start, only the pair the loaded model uses: 13 MB for a WASM model instead
 * of both pairs (38 MB).
 */

/** The files of `files` (paths of `ort-wasm-*` under the site root) the loaded model's build loads. */
export function ortRuntimeFilesFor(files: readonly string[], onWebGpu: boolean): string[] {
  const own = files.filter((file) => file.includes('.asyncify.') === onWebGpu);
  // Names this rule does not know (another ONNX Runtime version): keep all, as before the split.
  return own.length > 0 ? own : [...files];
}
