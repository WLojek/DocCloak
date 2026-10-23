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
  recognizeCanvasLines,
  releaseOcrWorker,
} from '@doccloak/core/dom';
import type { OcrExtraction, OcrLine, TesseractAssetPaths } from '@doccloak/core/dom';

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

/**
 * PDF pages (T238, T239): read `region` of a rendered page (pixels of `page`) with Tesseract: text
 * a scan's OCR layer does not have, text inside an image on a text page, or (the region is the
 * whole page) a page without any text layer. Lines come back relative to the region, as core
 * expects. The worker is kept between calls; release it with releasePdfOcr when the file is read.
 */
export async function recognizePdfRegion(
  page: unknown,
  region: { x0: number; y0: number; x1: number; y1: number },
  dpi: number,
  uiLanguage: string,
): Promise<OcrLine[]> {
  const w = Math.max(1, Math.round(region.x1 - region.x0));
  const h = Math.max(1, Math.round(region.y1 - region.y0));
  const crop = document.createElement('canvas');
  crop.width = w;
  crop.height = h;
  const ctx = crop.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(page as CanvasImageSource, region.x0, region.y0, w, h, 0, 0, w, h);
  const source = page as { width?: number; height?: number };
  const wholePage = region.x0 <= 0 && region.y0 <= 0 && w >= (source.width ?? Infinity) - 1 && h >= (source.height ?? Infinity) - 1;
  return recognizeCanvasLines(crop, uiLanguage, tesseractAssets(), dpi, { wholePage });
}

/** Free the OCR worker recognizePdfRegion keeps between the pages of a file. */
export function releasePdfOcr(): Promise<void> {
  return releaseOcrWorker();
}
