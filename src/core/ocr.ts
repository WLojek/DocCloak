/**
 * OCR support: extract text (with word-level bounding boxes) from images
 * so it can flow through the regular PII detection pipeline, and render a
 * redacted copy of the image with detected entities blacked out.
 *
 * Uses tesseract.js, which runs Tesseract compiled to WebAssembly inside its
 * own Web Worker - the image never leaves the browser. Language data is
 * downloaded once and cached by tesseract.js in IndexedDB.
 */

import * as Tesseract from 'tesseract.js';

export interface OcrWord {
  text: string;
  /** Character offsets into the reconstructed OCR text */
  start: number;
  end: number;
  /** Pixel bounding box in the OCR'd image's coordinate space */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrExtraction {
  text: string;
  words: OcrWord[];
}

/** Images above this dimension are downscaled before OCR to bound memory use on mobile */
const MAX_IMAGE_DIMENSION = 2560;

const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|bmp|gif)$/i;

/** Map DocCloak UI languages to Tesseract traineddata codes */
const UI_LANG_TO_TESSERACT: Record<string, string> = {
  en: 'eng',
  pl: 'pol',
  de: 'deu',
  fr: 'fra',
  es: 'spa',
  pt: 'por',
  sv: 'swe',
  no: 'nor',
};

export function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.test(fileName);
}

function buildLangList(uiLanguage: string): string[] {
  const mapped = UI_LANG_TO_TESSERACT[uiLanguage];
  if (mapped && mapped !== 'eng') return [mapped, 'eng'];
  return ['eng'];
}

/**
 * Decode an image file into a canvas, downscaling if it exceeds
 * MAX_IMAGE_DIMENSION. All OCR bounding boxes are relative to the returned
 * canvas, so redaction is drawn on the same coordinate space.
 */
export async function loadImageToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let width: number;
  let height: number;
  let source: CanvasImageSource;

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    source = bitmap;
  } else {
    source = await decodeViaImageElement(file);
    width = (source as HTMLImageElement).naturalWidth;
    height = (source as HTMLImageElement).naturalHeight;
  }

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  if (typeof (source as ImageBitmap).close === 'function') {
    (source as ImageBitmap).close();
  }
  return canvas;
}

function decodeViaImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode image'));
    };
    img.src = url;
  });
}

/**
 * Run OCR on a canvas. Returns the extracted text plus per-word character
 * offsets and pixel bounding boxes. onProgress receives 0..1 during the
 * recognition phase.
 */
export async function recognizeCanvas(
  canvas: HTMLCanvasElement,
  uiLanguage: string,
  onProgress?: (progress: number) => void,
): Promise<OcrExtraction> {
  onProgress?.(0);
  const base = import.meta.env.BASE_URL;
  const worker = await Tesseract.createWorker(
    buildLangList(uiLanguage),
    1, // OEM.LSTM_ONLY
    {
      // Worker, core and language data are all self-hosted (copied by
      // scripts/copy-assets.mjs): the production CSP only allows scripts
      // and connections from our own origin plus the HuggingFace model CDN.
      // langPath must be an absolute URL - relative paths are treated as
      // cache keys by the tesseract.js worker, not fetched.
      workerPath: `${base}tesseract/worker.min.js`,
      corePath: `${base}tesseract/core`,
      langPath: new URL(`${base}tesseract/lang`, self.location.origin).href,
      logger: (m) => {
        if (m.status === 'recognizing text' && typeof m.progress === 'number') {
          onProgress?.(m.progress);
        }
      },
    },
  );

  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
    onProgress?.(1);
    return buildTextFromBlocks(data.blocks ?? []);
  } finally {
    await worker.terminate();
  }
}

interface BlockLike {
  paragraphs: {
    lines: {
      words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[];
    }[];
  }[];
}

/**
 * Reconstruct plain text from Tesseract's block hierarchy while recording
 * each word's character range. The reconstruction (not Tesseract's own
 * `data.text`) is used as the detection input, so entity offsets always map
 * back to word bounding boxes exactly.
 *
 * Exported for tests.
 */
export function buildTextFromBlocks(blocks: BlockLike[]): OcrExtraction {
  const words: OcrWord[] = [];
  let text = '';

  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        let lineHasWords = false;
        for (const word of line.words ?? []) {
          const value = word.text?.trim();
          if (!value) continue;
          if (lineHasWords) text += ' ';
          const start = text.length;
          text += value;
          words.push({ text: value, start, end: text.length, bbox: word.bbox });
          lineHasWords = true;
        }
        if (lineHasWords) text += '\n';
      }
    }
    if (text.length > 0 && !text.endsWith('\n\n')) text += '\n';
  }

  return { text: text.trimEnd(), words };
}

/**
 * Pick the bounding boxes of every OCR word that overlaps one of the given
 * character ranges. A word partially covered by a range is fully redacted
 * (over-redaction is safer than leaking half an identifier).
 *
 * Exported for tests.
 */
export function selectRedactionBoxes(
  words: OcrWord[],
  ranges: { start: number; end: number }[],
): { x0: number; y0: number; x1: number; y1: number }[] {
  return words
    .filter((w) => ranges.some((r) => w.start < r.end && w.end > r.start))
    .map((w) => w.bbox);
}

/**
 * Draw black boxes over the given character ranges and return the redacted
 * image as a PNG blob.
 */
export function renderRedactedImage(
  sourceCanvas: HTMLCanvasElement,
  words: OcrWord[],
  ranges: { start: number; end: number }[],
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas 2D context unavailable'));

  ctx.drawImage(sourceCanvas, 0, 0);
  ctx.fillStyle = '#111111';

  const padding = 2;
  for (const box of selectRedactionBoxes(words, ranges)) {
    ctx.fillRect(
      box.x0 - padding,
      box.y0 - padding,
      (box.x1 - box.x0) + padding * 2,
      (box.y1 - box.y0) + padding * 2,
    );
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode redacted image'));
    }, 'image/png');
  });
}
