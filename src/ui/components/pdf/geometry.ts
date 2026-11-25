/**
 * Geometry of the page view (T284): between where the user points and what Core stores.
 *
 * Three spaces meet here. The pointer lives in CSS pixels of the shown page; the page was
 * rendered into a canvas of other pixels (scale, device pixel ratio); a hidden area is stored in
 * the page's user space (points, origin bottom-left, /Rotate not applied). To keep the first two
 * apart for good, the page view works in FRACTIONS of the shown page (0..1 from its top-left
 * corner): a pointer position divided by the size of the box it is in, whatever that size is.
 * A fraction times the canvas size is a canvas pixel, and Core's `pixelRectToUserRect` /
 * `userRectToPixelRect` go from there to user space through the transform of that render (scale,
 * y flip, crop box and /Rotate).
 */
import type { Rect } from '@doccloak/core/pdf';

/** A rectangle on the shown page in fractions of its width and height, origin top-left, x0 < x1 and y0 < y1. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What a render tells about its pixels: Core's `RenderedPage.transform` and the canvas size. */
export interface PageView {
  transform: number[];
  widthPx: number;
  heightPx: number;
}

/** Core's two converters ('@doccloak/core/pdf' is loaded lazily, so they are handed in). */
export interface RectConverters {
  pixelRectToUserRect: (transform: number[], rect: Box) => Rect;
  userRectToPixelRect: (transform: number[], rect: Rect) => Box;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** A point of the shown page as fractions, from a pointer position and the box of the page on screen. */
export function pointInBox(clientX: number, clientY: number, bounds: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  if (!(bounds.width > 0) || !(bounds.height > 0)) return null;
  return { x: clamp01((clientX - bounds.left) / bounds.width), y: clamp01((clientY - bounds.top) / bounds.height) };
}

/** The box between two points (a drag from `a` to `b`, in any direction), inside the page. */
export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Box {
  return {
    x0: clamp01(Math.min(a.x, b.x)),
    y0: clamp01(Math.min(a.y, b.y)),
    x1: clamp01(Math.max(a.x, b.x)),
    y1: clamp01(Math.max(a.y, b.y)),
  };
}

/** A box of the shown page in the page's user space (what `PdfEdits.regions` holds). */
export function boxToUserRect(convert: RectConverters, view: PageView, box: Box): Rect {
  return convert.pixelRectToUserRect(view.transform, {
    x0: box.x0 * view.widthPx,
    y0: box.y0 * view.heightPx,
    x1: box.x1 * view.widthPx,
    y1: box.y1 * view.heightPx,
  });
}

/** A user-space rectangle on the shown page, cut to the page. */
export function userRectToBox(convert: RectConverters, view: PageView, rect: Rect): Box {
  const px = convert.userRectToPixelRect(view.transform, rect);
  return {
    x0: clamp01(px.x0 / view.widthPx),
    y0: clamp01(px.y0 / view.heightPx),
    x1: clamp01(px.x1 / view.widthPx),
    y1: clamp01(px.y1 / view.heightPx),
  };
}

/** The smallest side a box is resized down to. */
export const MIN_BOX_SIDE = 0.01;
/** One press of an arrow key. */
export const KEY_STEP = 0.005;

/** The box an "add an area" starts with: in the middle of the page, about a signature wide. */
export function centerBox(): Box {
  return { x0: 0.3, y0: 0.45, x1: 0.7, y1: 0.55 };
}

/** The box moved by (dx, dy), kept whole inside the page. */
export function moveBox(box: Box, dx: number, dy: number): Box {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const x0 = Math.min(1 - w, Math.max(0, box.x0 + dx));
  const y0 = Math.min(1 - h, Math.max(0, box.y0 + dy));
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** The box with its right and bottom edges moved by (dw, dh): never smaller than MIN_BOX_SIDE, never past the page. */
export function resizeBox(box: Box, dw: number, dh: number): Box {
  return {
    x0: box.x0,
    y0: box.y0,
    x1: Math.min(1, Math.max(box.x0 + MIN_BOX_SIDE, box.x1 + dw)),
    y1: Math.min(1, Math.max(box.y0 + MIN_BOX_SIDE, box.y1 + dh)),
  };
}

/** The size at which a page of `width` x `height` fits whole into a box (CSS pixels in, CSS pixels out). */
export function fitInto(width: number, height: number, box: { width: number; height: number }): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !(box.width > 0) || !(box.height > 0)) return { width: 0, height: 0 };
  const k = Math.min(box.width / width, box.height / height);
  return { width: width * k, height: height * k };
}
