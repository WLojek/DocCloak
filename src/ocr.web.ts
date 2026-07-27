/**
 * Web OCR adapter over @doccloak/core/dom.
 *
 * Keeps the web-specific pieces of the OCR flow out of core:
 * - the tesseract.js asset locations derived from Vite's BASE_URL (core takes
 *   them as a parameter; per architecture 4.1 principle 1, core never reads
 *   import.meta.env)
 * - the HTMLCanvasElement-typed loadImageToCanvas the UI expects (in a DOM
 *   window core's feature detection always yields an HTMLCanvasElement)
 * Pure OCR helpers (isImageFile, renderRedactedImage, OcrWord, ...) are
 * imported from '@doccloak/core/dom' directly.
 */

import {
  loadImageToCanvas as coreLoadImageToCanvas,
  recognizeCanvas as coreRecognizeCanvas,
} from '@doccloak/core/dom';
import type { OcrExtraction, TesseractAssetPaths } from '@doccloak/core/dom';

/**
 * Worker, core and language data are all self-hosted (copied by
 * scripts/copy-assets.mjs): the production CSP only allows scripts and
 * connections from our own origin plus the HuggingFace model CDN.
 * langPath must be an absolute URL - relative paths are treated as cache
 * keys by the tesseract.js worker, not fetched.
 */
function tesseractAssets(): TesseractAssetPaths {
  const base = import.meta.env.BASE_URL;
  return {
    workerPath: `${base}tesseract/worker.min.js`,
    corePath: `${base}tesseract/core`,
    langPath: new URL(`${base}tesseract/lang`, self.location.origin).href,
  };
}

export async function loadImageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  return (await coreLoadImageToCanvas(file)) as HTMLCanvasElement;
}

export function recognizeCanvas(
  canvas: HTMLCanvasElement,
  uiLanguage: string,
  onProgress?: (progress: number) => void,
): Promise<OcrExtraction> {
  return coreRecognizeCanvas(canvas, uiLanguage, tesseractAssets(), onProgress);
}
