/**
 * Page pictures for the page view (T284): one pdf.js document per file, pages rendered when they
 * are shown, and no more canvases kept than the view needs.
 *
 * - `usePdfPreview` opens Core's preview for the bytes of an extraction while the view is open and
 *   closes it when the view closes, the component unmounts or another file comes. Core's PDF chunk
 *   is loaded with a dynamic import, so pdf.js stays out of the main chunk.
 * - `PageRenderer` renders one page at a time (the large view first, thumbnails after it) into DOM
 *   canvases the view shows directly.
 * - `usePageThumbs` renders the thumbnails that are in sight (IntersectionObserver) and lets go of
 *   the oldest ones out of sight above a cap: a 200-page file never holds 200 canvases.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { CanvasFactory, PdfExtraction, PdfPreview } from '@doccloak/core/pdf';
import { pdfAssets } from '../../../pdf.web.ts';
import type { PageView } from './geometry.ts';

export type PdfModule = typeof import('@doccloak/core/pdf');

/** What the preview needs of an extraction (the bytes are the same object before and after an edit). */
export type PreviewSource = Pick<PdfExtraction, 'bytes' | 'assets' | 'password'>;

/** A rendered page: the canvas to show and how its pixels map to the page's user space. */
export interface PageImage extends PageView {
  page: number;
  canvas: HTMLCanvasElement;
  /** Size of the page as shown, in points (/Rotate applied). */
  widthPt: number;
  heightPt: number;
}

/** pdf.js draws on canvases of the document, so a rendered page is shown without a copy. */
const domCanvasFactory: CanvasFactory = {
  create(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    return {
      canvas,
      context,
      toPng() {
        return new Promise<Uint8Array>((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('canvas.toBlob returned null'));
              return;
            }
            blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
          }, 'image/png');
        });
      },
      getImageData() {
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      },
    };
  },
};

/** Give the pixels of a canvas back now (a canvas waiting for the garbage collector keeps them). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/** Sharper than this the screen does not show, and a phone pays for every pixel. */
const MAX_PIXEL_RATIO = 2;

export interface RenderRequest {
  /** The box (CSS pixels) the page has to fit into. */
  box: { width: number; height: number };
  /** Cap on the pixels of the canvas. */
  maxPixels: number;
  /** Before everything that waits (the page the user opened). */
  urgent?: boolean;
}

/**
 * Renders pages of one preview, one at a time. A render resolves with null when the renderer was
 * closed before its turn, and rejects when pdf.js could not render the page.
 */
export class PageRenderer {
  private readonly preview: PdfPreview;
  private waiting: Array<{ urgent: boolean; run: () => Promise<void> }> = [];
  private running = false;
  private closed = false;

  constructor(preview: PdfPreview) {
    this.preview = preview;
  }

  render(page: number, request: RenderRequest): Promise<PageImage | null> {
    return new Promise<PageImage | null>((resolve, reject) => {
      const run = async (): Promise<void> => {
        if (this.closed) {
          resolve(null);
          return;
        }
        try {
          const image = await this.draw(page, request);
          if (this.closed) {
            releaseCanvas(image.canvas);
            resolve(null);
          } else {
            resolve(image);
          }
        } catch (err) {
          if (this.closed) resolve(null);
          else reject(err);
        }
      };
      const urgent = request.urgent === true;
      const at = urgent ? this.waiting.findIndex((task) => !task.urgent) : -1;
      if (at >= 0) this.waiting.splice(at, 0, { urgent, run });
      else this.waiting.push({ urgent, run });
      void this.pump();
    });
  }

  /** Stop: renders that wait resolve with null. Closing the preview itself is the owner's job. */
  close(): void {
    this.closed = true;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let task = this.waiting.shift(); task; task = this.waiting.shift()) await task.run();
    } finally {
      this.running = false;
    }
  }

  private async draw(page: number, request: RenderRequest): Promise<PageImage> {
    const size = await this.preview.pageSize(page);
    const fit = Math.min(request.box.width / size.width, request.box.height / size.height);
    const ratio = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), MAX_PIXEL_RATIO);
    let scale = fit * ratio;
    const pixels = size.width * scale * size.height * scale;
    if (pixels > request.maxPixels) scale *= Math.sqrt(request.maxPixels / pixels);
    if (!(scale > 0) || !Number.isFinite(scale)) throw new RangeError(`page ${page + 1} has no size to render at`);
    const rendered = await this.preview.render(page, scale, domCanvasFactory);
    const canvas = rendered.canvas.canvas;
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('the page was not rendered into a canvas of the document');
    return {
      page,
      canvas,
      widthPx: rendered.widthPx,
      heightPx: rendered.heightPx,
      widthPt: rendered.widthPt,
      heightPt: rendered.heightPt,
      transform: rendered.transform,
    };
  }
}

export interface PreviewState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Core's PDF module once it is loaded (the rectangle converters come from it). */
  pdf: PdfModule | null;
  renderer: PageRenderer | null;
}

const IDLE: PreviewState = { status: 'idle', pdf: null, renderer: null };

/**
 * The preview of a file while `enabled`: opened once per bytes, closed when `enabled` turns false,
 * on unmount, and when the bytes change (another file).
 */
export function usePdfPreview(source: PreviewSource, enabled: boolean): PreviewState {
  const [state, setState] = useState<PreviewState>(IDLE);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const { bytes, password } = source;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let opened: { preview: PdfPreview; renderer: PageRenderer } | null = null;
    setState({ status: 'loading', pdf: null, renderer: null });
    void (async () => {
      try {
        const pdf = await import('@doccloak/core/pdf');
        if (cancelled) return;
        const preview = await pdf.openPdfPreview({ bytes, password, assets: sourceRef.current.assets ?? pdfAssets() });
        if (cancelled) {
          void preview.close().catch(() => undefined);
          return;
        }
        opened = { preview, renderer: new PageRenderer(preview) };
        setState({ status: 'ready', pdf, renderer: opened.renderer });
      } catch (err) {
        console.error('[DocCloak] Failed to open the PDF page view:', err);
        if (!cancelled) setState({ status: 'error', pdf: null, renderer: null });
      }
    })();
    return () => {
      cancelled = true;
      if (opened) {
        opened.renderer.close();
        void opened.preview.close().catch(() => undefined);
      }
      setState(IDLE);
    };
  }, [bytes, password, enabled]);

  return state;
}

/** The frame a thumbnail is fitted into (CSS pixels). */
export const THUMB_BOX = { width: 96, height: 128 };
/** Thumbnails kept at most, unless more than that are in sight. */
export const THUMB_CACHE = 60;
/** Without IntersectionObserver (old browsers): the first pages only. */
const THUMBS_WITHOUT_OBSERVER = 24;
const THUMB_MAX_PIXELS = 160_000;

export interface PageThumbs {
  thumbs: ReadonlyMap<number, PageImage>;
  /** Pages pdf.js could not render: they keep their empty frame. */
  failed: ReadonlySet<number>;
}

const NO_THUMBS: PageThumbs = { thumbs: new Map(), failed: new Set() };

/**
 * Thumbnails of the pages in sight. `root` is the scrolling box of the grid; every cell inside it
 * carries `data-pdf-page` (its 0-based page). A thumbnail is rendered when its cell comes into
 * sight, and the ones longest out of sight are let go above THUMB_CACHE.
 */
export function usePageThumbs(renderer: PageRenderer | null, root: RefObject<HTMLElement | null>, pageCount: number): PageThumbs {
  const [state, setState] = useState<PageThumbs>(NO_THUMBS);

  useEffect(() => {
    const container = root.current;
    if (!renderer || !container) return;
    const live = new Map<number, PageImage>();
    const failed = new Set<number>();
    const visible = new Set<number>();
    /** Pages by when they were last in sight, oldest first. */
    let recent: number[] = [];
    let stopped = false;
    let rendering = false;

    const seen = (page: number): void => {
      recent = recent.filter((p) => p !== page);
      recent.push(page);
    };
    const publish = (): void => {
      if (!stopped) setState({ thumbs: new Map(live), failed: new Set(failed) });
    };
    const evict = (): void => {
      for (const page of [...recent]) {
        if (live.size <= THUMB_CACHE) break;
        if (visible.has(page) || !live.has(page)) continue;
        releaseCanvas(live.get(page)!.canvas);
        live.delete(page);
        recent = recent.filter((p) => p !== page);
      }
    };
    const pump = async (): Promise<void> => {
      if (rendering || stopped) return;
      rendering = true;
      try {
        for (;;) {
          const next = [...visible].sort((a, b) => a - b).find((p) => !live.has(p) && !failed.has(p));
          if (next === undefined || stopped) break;
          try {
            const image = await renderer.render(next, { box: THUMB_BOX, maxPixels: THUMB_MAX_PIXELS });
            if (!image) break;
            if (stopped) {
              releaseCanvas(image.canvas);
              break;
            }
            live.set(next, image);
            seen(next);
            evict();
          } catch (err) {
            console.error(`[DocCloak] Failed to render the thumbnail of page ${next + 1}:`, err);
            failed.add(next);
          }
          publish();
        }
      } finally {
        rendering = false;
      }
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.pdfPage);
          if (!Number.isInteger(page)) continue;
          if (entry.isIntersecting) {
            visible.add(page);
            seen(page);
          } else {
            visible.delete(page);
          }
        }
        void pump();
      }, { root: container, rootMargin: '160px 0px' });
      container.querySelectorAll<HTMLElement>('[data-pdf-page]').forEach((cell) => observer!.observe(cell));
    } else {
      for (let page = 0; page < Math.min(pageCount, THUMBS_WITHOUT_OBSERVER); page++) visible.add(page);
      void pump();
    }

    return () => {
      stopped = true;
      observer?.disconnect();
      for (const image of live.values()) releaseCanvas(image.canvas);
      live.clear();
      setState(NO_THUMBS);
    };
  }, [renderer, root, pageCount]);

  return state;
}
