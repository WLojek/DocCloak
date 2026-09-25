/**
 * Web adapter over @doccloak/core/pdf.
 *
 * Keeps the web-specific pieces of the PDF flow out of core: the runtime
 * asset locations derived from Vite's BASE_URL (core takes them as a
 * parameter; per architecture 4.1 principle 1, core never reads
 * import.meta.env). Everything is self-hosted (copied by
 * scripts/copy-assets.mjs into public/pdf/): the production CSP only allows
 * scripts, workers and connections from our own origin.
 *
 * '@doccloak/core/pdf' itself is loaded with a dynamic import by the hook
 * so pdf.js, pdf-lib and fontkit stay out of the main chunk; this module
 * must therefore not import it.
 */
import type { PdfAssetPaths } from '@doccloak/core/pdf';

/** True for names ending in .pdf (case-insensitive). Mirrors core's isPdfFile without pulling the chunk in. */
export function isPdfFile(filename: string): boolean {
  return /\.pdf$/i.test(filename.trim());
}

/**
 * pdf.js loads the worker as an ES module worker from a same-origin URL
 * (worker-src 'self'); cMapUrl / standardFontDataUrl / wasmUrl / fontsUrl
 * are base URLs with a trailing slash, as core expects. wasmUrl holds the
 * JPX / JBIG2 / qcms decoders pdf.js fetches when it rasterizes a page.
 *
 * The worker URL carries the bundled pdf.js version (`__PDFJS_VERSION__`,
 * defined in vite.config.ts): /pdf/ is served unhashed with a day of HTTP
 * caching, and pdf.js refuses a worker whose version differs from the API
 * chunk, so a deploy that bumps pdfjs-dist must change the worker URL too.
 */
export function pdfAssets(): PdfAssetPaths {
  const base = import.meta.env.BASE_URL;
  return {
    pdfjsWorkerUrl: `${base}pdf/pdf.worker.mjs?v=${__PDFJS_VERSION__}`,
    cMapUrl: `${base}pdf/cmaps/`,
    standardFontDataUrl: `${base}pdf/standard_fonts/`,
    wasmUrl: `${base}pdf/wasm/`,
    fontsUrl: `${base}pdf/fonts/`,
  };
}
