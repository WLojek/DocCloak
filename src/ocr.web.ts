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
 * expects. Up to `workers` regions are read at the same time (ocrWorkerCount); the workers are kept
 * between calls, release them with releasePdfOcr when the file is read.
 */
export async function recognizePdfRegion(
  page: unknown,
  region: { x0: number; y0: number; x1: number; y1: number },
  dpi: number,
  uiLanguage: string,
  workers = 1,
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
  return recognizeCanvasLines(crop, uiLanguage, tesseractAssets(), dpi, { wholePage, workers });
}

/** Free the OCR workers recognizePdfRegion keeps between the pages of a file. */
export function releasePdfOcr(): Promise<void> {
  return releaseOcrWorker();
}

/** The parts of `navigator` ocrWorkerCount reads (deviceMemory and userAgentData are Chromium only). */
export interface OcrDevice {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  userAgent?: string;
  userAgentData?: { mobile?: boolean };
}

/** Most pages read at the same time on a computer that reports 8 GB of memory or more (Chromium). */
export const OCR_MAX_WORKERS = 6;
/** Most pages read at the same time on other computers (Firefox and Safari do not report memory). */
const OCR_MAX_WORKERS_UNKNOWN = 4;
/** Most pages read at the same time on a phone, a tablet or a device with 4 GB of memory or less. */
const OCR_MAX_WORKERS_SMALL = 2;

/**
 * How many pages of a PDF DocCloak's OCR reads at the same time (T248, Core issue #4). Each page
 * needs a Tesseract worker of its own and keeps a core busy; measured in Chrome on a 17-page scan,
 * 1/2/4/6/8 pages at a time took 51/27/14/12/9 s, and each worker added about 0.25 GB at peak. So
 * one core is left for the page itself, six at most with 8 GB of memory or more, four when the
 * memory is not known, and two on phones, tablets and devices with 4 GB or less.
 */
export function ocrWorkerCount(device: OcrDevice | undefined = typeof navigator === 'undefined' ? undefined : navigator): number {
  if (!device) return 1;
  const cores = device.hardwareConcurrency && device.hardwareConcurrency > 0 ? device.hardwareConcurrency : 2;
  const ua = device.userAgent ?? '';
  // iPadOS reports a Mac; a Mac has no touch screen.
  const handheld = device.userAgentData?.mobile === true || /Android|iPhone|iPad|Mobile/i.test(ua) || (/Macintosh/.test(ua) && (device.maxTouchPoints ?? 0) > 1);
  const memory = device.deviceMemory;
  const cap = handheld || (memory !== undefined && memory <= 4) ? OCR_MAX_WORKERS_SMALL : memory !== undefined && memory >= 8 ? OCR_MAX_WORKERS : OCR_MAX_WORKERS_UNKNOWN;
  return Math.max(1, Math.min(cores - 1, cap));
}

/** localStorage key of the pages-at-a-time choice (T253, Core issue #4): absent or 'auto', or a number. */
export const OCR_WORKERS_STORAGE_KEY = 'doccloak-ocr-workers';
/** The most the setting offers, whatever the device: each page costs about 0.25 GB at peak. */
export const OCR_WORKERS_CHOICE_LIMIT = 16;

/** The numbers the setting offers: 1 up to one per core (at least 2, at most OCR_WORKERS_CHOICE_LIMIT). */
export function ocrWorkerChoices(device: OcrDevice | undefined = typeof navigator === 'undefined' ? undefined : navigator): number[] {
  const cores = device?.hardwareConcurrency && device.hardwareConcurrency > 0 ? device.hardwareConcurrency : 4;
  const most = Math.max(2, Math.min(cores, OCR_WORKERS_CHOICE_LIMIT));
  return Array.from({ length: most }, (_, i) => i + 1);
}

/** The stored choice: 'auto' (also for a missing or unreadable value) or a whole number of at least 1. */
export function getOcrWorkerSetting(): number | 'auto' {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OCR_WORKERS_STORAGE_KEY);
  } catch {
    return 'auto';
  }
  const n = raw === null || raw === 'auto' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 'auto';
}

export function setOcrWorkerSetting(value: number | 'auto'): void {
  try {
    if (value === 'auto') localStorage.removeItem(OCR_WORKERS_STORAGE_KEY);
    else localStorage.setItem(OCR_WORKERS_STORAGE_KEY, String(Math.max(1, Math.floor(value))));
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

/** How many pages the next PDF reads at a time: the user's number (within the choices) or ocrWorkerCount. */
export function ocrWorkersInEffect(device: OcrDevice | undefined = typeof navigator === 'undefined' ? undefined : navigator): number {
  const setting = getOcrWorkerSetting();
  if (setting === 'auto') return ocrWorkerCount(device);
  const choices = ocrWorkerChoices(device);
  return Math.min(setting, choices[choices.length - 1]);
}
