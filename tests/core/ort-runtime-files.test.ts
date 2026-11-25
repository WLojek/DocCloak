// T289: the service worker keeps, for an offline start, the ONNX Runtime pair the loaded model
// uses: the plain build for a model on the WASM execution provider, the WebGPU build otherwise.
import { describe, it, expect } from 'vitest';
import { ortRuntimeFilesFor } from '../../src/ort-runtime-files.ts';

const FILES = ['/ort-wasm-simd-threaded.asyncify.mjs', '/ort-wasm-simd-threaded.asyncify.wasm', '/ort-wasm-simd-threaded.mjs', '/ort-wasm-simd-threaded.wasm'];

describe('ONNX Runtime files of a model', () => {
  it('a model on the processor needs the plain pair only', () => {
    expect(ortRuntimeFilesFor(FILES, false)).toEqual(['/ort-wasm-simd-threaded.mjs', '/ort-wasm-simd-threaded.wasm']);
  });

  it('a model on the graphics card needs the WebGPU pair only', () => {
    expect(ortRuntimeFilesFor(FILES, true)).toEqual(['/ort-wasm-simd-threaded.asyncify.mjs', '/ort-wasm-simd-threaded.asyncify.wasm']);
  });

  it('keeps every file when the names are not the ones it knows', () => {
    const one = ['/ort-wasm-simd-threaded.asyncify.wasm'];
    expect(ortRuntimeFilesFor(one, false)).toEqual(one);
    expect(ortRuntimeFilesFor([], true)).toEqual([]);
  });
});
