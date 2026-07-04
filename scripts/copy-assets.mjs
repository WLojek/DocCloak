/**
 * Copies runtime WASM assets from node_modules into public/ so they are
 * served from our own origin. This is required by the production CSP
 * (script-src 'self'): neither ONNX Runtime nor Tesseract may be loaded
 * from a third-party CDN.
 *
 * Runs on postinstall. All copied files are gitignored.
 */
import { copyFileSync, mkdirSync } from 'fs';

// ONNX Runtime WASM (PII detection models)
const ORT_FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.mjs',
];
for (const f of ORT_FILES) {
  copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `public/${f}`);
}

// Tesseract OCR worker + core (single-file builds with embedded WASM).
// Only the LSTM variants are copied - DocCloak always runs OEM 1 (LSTM only).
// The worker picks relaxedsimd/simd/baseline based on device capabilities.
mkdirSync('public/tesseract/core', { recursive: true });
copyFileSync('node_modules/tesseract.js/dist/worker.min.js', 'public/tesseract/worker.min.js');
const TESSERACT_CORES = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];
for (const f of TESSERACT_CORES) {
  copyFileSync(`node_modules/tesseract.js-core/${f}`, `public/tesseract/core/${f}`);
}

// Tesseract language data, one per supported UI language.
// best_int = best-quality LSTM models quantized to int (small AND accurate).
mkdirSync('public/tesseract/lang', { recursive: true });
const TESSERACT_LANGS = ['eng', 'pol', 'deu', 'fra', 'spa', 'por', 'swe', 'nor'];
for (const lang of TESSERACT_LANGS) {
  copyFileSync(
    `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`,
    `public/tesseract/lang/${lang}.traineddata.gz`,
  );
}

console.log('[copy-assets] ONNX Runtime and Tesseract assets copied to public/');
