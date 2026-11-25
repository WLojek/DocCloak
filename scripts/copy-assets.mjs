/**
 * Copies runtime WASM assets from node_modules into public/ so they are
 * served from our own origin. This is required by the production CSP
 * (script-src 'self'): neither ONNX Runtime nor Tesseract may be loaded
 * from a third-party CDN.
 *
 * Runs on postinstall. All copied files are gitignored.
 */
import { copyFileSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

// ONNX Runtime WASM (PII detection models)
// Two builds since core 0.18.1 (T289):
// - the plain build (onnxruntime-web/wasm) for every model that runs on the
//   WASM execution provider. With the WebGPU build Safari held 6 GB as soon
//   as a model was loaded and grew on; with this one 1.3 GB, flat.
// - the WebGPU build (onnxruntime-web/webgpu, ort.webgpu.bundle.min.mjs: the
//   native WebGPU EP, the unified .asyncify binary) for the two models that
//   run on WebGPU.
// The bare package entry resolves the deprecated JSEP bundle whose wasm
// (26.5 MiB) exceeds Cloudflare Pages' 25 MiB per-file limit; the plain
// (13.3 MiB) and the asyncify (24.6 MiB) binaries fit. The .mjs glue files
// are for the external-wasm / threaded loader paths.
const ORT_FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
];
for (const f of ORT_FILES) {
  copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `public/${f}`);
}
// Stale assets from an earlier ort setup (the jsep pair of the deprecated
// bundle entry).
for (const f of ['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs']) {
  rmSync(`public/${f}`, { force: true });
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

// PDF redaction (@doccloak/core/pdf): the pdf.js worker, its binary CMaps
// and standard fonts, plus the Liberation fallback faces the writer embeds.
// The worker MUST come from the pdfjs-dist instance core itself resolves:
// pdf.js refuses a worker whose version differs from the API, and in a dev
// checkout core is a file: link with its own node_modules.
// Core's exports map does not expose package.json, so take the real path of
// the installed package (a symlink in dev checkouts, a directory in releases).
const require = createRequire(import.meta.url);
const corePackageDir = realpathSync('node_modules/@doccloak/core');
const pdfjsDir = dirname(require.resolve('pdfjs-dist/package.json', { paths: [corePackageDir] }));

function copyDir(from, to, filter = () => true) {
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of readdirSync(from)) {
    if (!filter(name)) continue;
    copyFileSync(join(from, name), join(to, name));
    n++;
  }
  return n;
}

rmSync('public/pdf', { recursive: true, force: true });
mkdirSync('public/pdf', { recursive: true });
copyFileSync(join(pdfjsDir, 'legacy/build/pdf.worker.mjs'), 'public/pdf/pdf.worker.mjs');
const cmaps = copyDir(join(pdfjsDir, 'cmaps'), 'public/pdf/cmaps', (n) => n.endsWith('.bcmap'));
const stdFonts = copyDir(join(pdfjsDir, 'standard_fonts'), 'public/pdf/standard_fonts');
const fonts = copyDir(join(corePackageDir, 'fonts/liberation'), 'public/pdf/fonts', (n) => n.endsWith('.ttf'));
if (fonts !== 12) throw new Error(`[copy-assets] expected 12 Liberation faces, found ${fonts}`);
// Image decoders pdf.js loads on demand when a rasterized page holds JPX
// (openjpeg) or JBIG2 images, plus the qcms colour management module, with
// their no-wasm fallbacks and licences. quickjs-eval (JavaScript actions) is
// never needed: the writer drops document JavaScript.
const wasm = copyDir(join(pdfjsDir, 'wasm'), 'public/pdf/wasm', (n) => !n.startsWith('quickjs-eval'));

console.log(`[copy-assets] ONNX Runtime, Tesseract and PDF assets copied to public/ (pdf.js ${require(join(pdfjsDir, 'package.json')).version}: ${cmaps} cmaps, ${stdFonts} standard fonts, ${wasm} decoder files, ${fonts} fallback fonts)`);
