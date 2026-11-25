/**
 * One page, large, to hide areas on it by hand (T284, WLojek/DocCloak.Core#6).
 *
 * A modal dialog over the app: the page as the file has it, the hidden areas as black boxes over
 * it, and three ways to work on them.
 * - Pointer (mouse, pen, finger): drag over the page to hide an area; the cross at an area's
 *   corner takes it away (a tap on the area gives it the focus and makes the cross larger).
 * - Keyboard: "Add an area" puts one in the middle of the page with the focus on it; the arrow
 *   keys move it, Shift with the arrow keys resizes it, Delete removes it.
 * - The page itself can be left out or brought back from here too.
 *
 * Every finished action goes to the host at once (the full set of edits), so what is black here
 * is what Core will paint: the host answers with `covered`, the boxes of the letters an area
 * touches, and they are drawn black as well. Moves with the keyboard are gathered for a moment
 * (NUDGE_DELAY) so that a held arrow key is one change for the host, not thirty.
 *
 * Positions are kept as fractions of the shown page (see geometry.ts), so the size of the page on
 * screen, the pixels of its canvas and the device pixel ratio never mix.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileMinus, Plus, Undo2, X } from 'lucide-react';
import type { PdfEdits, PdfRegion } from '@doccloak/core/pdf';
import { useFeatureStrings } from '../../../i18n/features/index.ts';
import { pdfEditStrings } from '../../../i18n/features/pdfEdit.ts';
import { addRegion, canRemovePage, isPageRemoved, regionsOnPage, removeRegion, replaceRegion, togglePage } from '../../pdfEdits.ts';
import { KEY_STEP, boxFromPoints, boxToUserRect, centerBox, fitInto, moveBox, pointInBox, resizeBox, userRectToBox, type Box } from './geometry.ts';
import { releaseCanvas, type PageImage, type PageRenderer, type PdfModule } from './preview.ts';

/** A drag that stays under this (CSS pixels, both ways) is a click, not an area. */
const MIN_DRAG = 6;
/** And one thinner than this is a line: on a phone a line of text is only some pixels high, so the bar is low. */
const MIN_DRAG_SIDE = 2;
/** How long after the last arrow key a moved area is sent to the host. */
export const NUDGE_DELAY = 400;
/** Cap on the pixels of the large view (about 24 MB of canvas). */
const LARGE_MAX_PIXELS = 6_000_000;
/** Room around the page inside the stage (CSS pixels each side): the crosses at the corners need it. */
const STAGE_PAD = 16;
/** The stage when it cannot be measured (no layout). */
const DEFAULT_STAGE = { width: 640, height: 800 };

const ICON_BUTTON = 'pressable inline-flex items-center justify-center min-h-11 min-w-11 md:min-h-8 md:min-w-8 border border-transparent text-[#111111] hover:border-[#111111] transition-colors cursor-pointer aria-disabled:opacity-40 aria-disabled:cursor-not-allowed aria-disabled:hover:border-transparent';
const TOOL_BUTTON = 'pressable inline-flex items-center gap-2 px-3 min-h-11 md:min-h-8 border border-[#C8C5BC] bg-white text-[#111111] text-xs font-medium text-left hover:bg-[#111111] hover:text-[#F9F9F7] hover:border-[#111111] transition-colors cursor-pointer aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-white aria-disabled:hover:text-[#111111] aria-disabled:hover:border-[#C8C5BC]';

const percent = (box: Box): React.CSSProperties => ({
  left: `${box.x0 * 100}%`,
  top: `${box.y0 * 100}%`,
  width: `${(box.x1 - box.x0) * 100}%`,
  height: `${(box.y1 - box.y0) * 100}%`,
});

/** Shows a canvas pdf.js drew on, stretched over its parent. */
export function CanvasHost({ canvas, className }: { canvas: HTMLCanvasElement; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    host.replaceChildren(canvas);
    return () => {
      if (canvas.parentNode === host) host.removeChild(canvas);
    };
  }, [canvas]);
  return <div ref={hostRef} className={className} aria-hidden="true" />;
}

interface PdfPageEditorProps {
  /** 0-based page shown. */
  page: number;
  pageCount: number;
  /** The full set of edits as the view shows it now. */
  edits: PdfEdits;
  /** What the applied edits really paint (Core's `covered`). */
  covered: PdfRegion[];
  busy: boolean;
  pdf: PdfModule | null;
  renderer: PageRenderer | null;
  /** The file could not be opened for pictures. */
  failed: boolean;
  /** Send the full new set to the host. */
  onSend: (next: PdfEdits) => void;
  onPage: (page: number) => void;
  onClose: () => void;
}

export function PdfPageEditor({ page, pageCount, edits, covered, busy, pdf, renderer, failed, onSend, onPage, onClose }: PdfPageEditorProps) {
  const s = useFeatureStrings(pdfEditStrings);
  const titleId = useId();
  const helpId = useId();
  const keysId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const [image, setImage] = useState<PageImage | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const [stage, setStage] = useState(DEFAULT_STAGE);
  const stageNow = useRef(stage);
  stageNow.current = stage;
  /** The area being drawn with the pointer. */
  const [draft, setDraft] = useState<Box | null>(null);
  const dragRef = useRef<{ pointerId: number; from: { x: number; y: number } } | null>(null);
  /** An area moved with the keyboard and not sent yet. */
  const [nudge, setNudge] = useState<{ index: number; box: Box } | null>(null);
  const nudgeRef = useRef(nudge);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Set by "Add an area": the number of areas before, so the new one gets the focus when it is there. */
  const focusNewRef = useRef<number | null>(null);

  const shown = image && image.page === page ? image : null;
  const removed = isPageRemoved(edits, page);
  const areas = regionsOnPage(edits, page);
  const canEdit = !busy && !removed && shown !== null && pdf !== null;

  const live = useRef({ edits, shown, pdf, page, onSend });
  live.current = { edits, shown, pdf, page, onSend };

  /* ---------------- the stage and the page picture ---------------- */

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = (): void => {
      const width = el.clientWidth - 2 * STAGE_PAD;
      const height = el.clientHeight - 2 * STAGE_PAD;
      if (width > 0 && height > 0) {
        stageNow.current = { width, height };
        setStage((now) => (now.width === width && now.height === height ? now : { width, height }));
      }
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setRenderFailed(false);
    if (!renderer) return;
    let cancelled = false;
    let got: PageImage | null = null;
    renderer.render(page, { box: stageNow.current, maxPixels: LARGE_MAX_PIXELS, urgent: true }).then(
      (rendered) => {
        if (!rendered) return;
        if (cancelled) {
          releaseCanvas(rendered.canvas);
          return;
        }
        got = rendered;
        setImage(rendered);
      },
      (err) => {
        console.error(`[DocCloak] Failed to render page ${page + 1}:`, err);
        if (!cancelled) setRenderFailed(true);
      },
    );
    return () => {
      cancelled = true;
      setImage(null);
      if (got) releaseCanvas(got.canvas);
    };
  }, [page, renderer]);

  /* ---------------- areas moved with the keyboard ---------------- */

  /** The edits with the area that is being moved at its new place; the move is then no longer pending. */
  const takeNudge = useCallback((): PdfEdits => {
    clearTimeout(nudgeTimer.current);
    const pending = nudgeRef.current;
    const { edits: now, shown: view, pdf: convert } = live.current;
    if (!pending) return now;
    nudgeRef.current = null;
    setNudge(null);
    if (!view || !convert) return now;
    return replaceRegion(now, pending.index, boxToUserRect(convert, view, pending.box));
  }, []);

  const sendNudge = useCallback(() => {
    if (!nudgeRef.current) return;
    live.current.onSend(takeNudge());
  }, [takeNudge]);

  useEffect(() => () => clearTimeout(nudgeTimer.current), []);

  const requestClose = useCallback(() => {
    sendNudge();
    onClose();
  }, [sendNudge, onClose]);

  const goTo = (next: number): void => {
    if (next < 0 || next >= pageCount || next === page) return;
    sendNudge();
    dragRef.current = null;
    setDraft(null);
    onPage(next);
  };

  /* ---------------- the dialog: focus stays inside, Escape closes ---------------- */

  useLayoutEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeRef.current();
    };
    // Focus that got out (a control that went away, a click on the page behind) comes back in.
    const onFocus = (e: FocusEvent): void => {
      const panel = panelRef.current;
      if (!panel || !panel.isConnected) return;
      if (e.target instanceof Node && !panel.contains(e.target)) panel.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };
  }, []);

  const onPanelKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const stops = Array.from(panel.querySelectorAll<HTMLElement>('button, [tabindex="0"]')).filter((el) => !el.hasAttribute('disabled'));
    if (stops.length === 0) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  /* ---------------- the actions ---------------- */

  const remove = (index: number): void => {
    if (busy) return;
    const pending = nudgeRef.current;
    // The area being moved is the one that goes: its move goes with it.
    if (pending && pending.index === index) {
      clearTimeout(nudgeTimer.current);
      nudgeRef.current = null;
      setNudge(null);
    }
    onSend(removeRegion(takeNudge(), index));
    // The control that had the focus is gone with the area.
    addRef.current?.focus({ preventScroll: true });
  };

  const add = (): void => {
    if (!canEdit || !shown || !pdf) return;
    const base = takeNudge();
    // A second one does not land exactly on the first.
    const step = 0.02 * (areas.length % 8);
    focusNewRef.current = areas.length;
    onSend(addRegion(base, page, boxToUserRect(pdf, shown, moveBox(centerBox(), step, step))));
  };

  // The area "Add an area" made is there: it takes the focus, so the arrow keys work on it at once.
  useLayoutEffect(() => {
    const before = focusNewRef.current;
    if (before === null || areas.length <= before) return;
    focusNewRef.current = null;
    const all = surfaceRef.current?.querySelectorAll<HTMLElement>('[data-pdf-area]');
    all?.[all.length - 1]?.focus({ preventScroll: true });
  }, [areas.length]);

  const canLeaveOut = canRemovePage(edits, page, pageCount);
  const toggle = (): void => {
    if (busy || (!removed && !canLeaveOut)) return;
    onSend(togglePage(takeNudge(), page, pageCount));
  };

  const onAreaKeyDown = (e: React.KeyboardEvent, index: number, box: Box): void => {
    if (e.target !== e.currentTarget) return;
    const by = e.shiftKey ? resizeBox : moveBox;
    let next: Box;
    switch (e.key) {
      case 'ArrowLeft': next = by(box, -KEY_STEP, 0); break;
      case 'ArrowRight': next = by(box, KEY_STEP, 0); break;
      case 'ArrowUp': next = by(box, 0, -KEY_STEP); break;
      case 'ArrowDown': next = by(box, 0, KEY_STEP); break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        remove(index);
        return;
      case 'Enter':
        e.preventDefault();
        sendNudge();
        return;
      default:
        return;
    }
    e.preventDefault();
    if (!canEdit) return;
    nudgeRef.current = { index, box: next };
    setNudge(nudgeRef.current);
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(sendNudge, NUDGE_DELAY);
  };

  /* ---------------- drawing with the pointer ---------------- */

  const pointOf = (e: React.PointerEvent): { x: number; y: number } | null => {
    const surface = surfaceRef.current;
    return surface ? pointInBox(e.clientX, e.clientY, surface.getBoundingClientRect()) : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Only on the page itself: an area and its cross keep their own clicks.
    if (!canEdit || dragRef.current || e.target !== e.currentTarget) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const from = pointOf(e);
    if (!from) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // No capture (the pointer is gone already): the drag still ends on pointerup over the page.
    }
    dragRef.current = { pointerId: e.pointerId, from };
    setDraft({ x0: from.x, y0: from.y, x1: from.x, y1: from.y });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const to = pointOf(e);
    if (to) setDraft(boxFromPoints(drag.from, to));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDraft(null);
    const surface = surfaceRef.current;
    const to = pointOf(e);
    if (!surface || !to || !canEdit || !shown || !pdf) return;
    const box = boxFromPoints(drag.from, to);
    const bounds = surface.getBoundingClientRect();
    const width = (box.x1 - box.x0) * bounds.width;
    const height = (box.y1 - box.y0) * bounds.height;
    if (Math.max(width, height) < MIN_DRAG || Math.min(width, height) < MIN_DRAG_SIDE) return;
    onSend(addRegion(takeNudge(), page, boxToUserRect(pdf, shown, box)));
  };

  const onPointerCancel = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDraft(null);
  };

  /* ---------------- the picture ---------------- */

  const size = shown ? fitInto(shown.widthPt, shown.heightPt, stage) : null;
  const areaBoxes = shown && pdf
    ? areas.map(({ index, rect }) => ({ index, box: nudge && nudge.index === index ? nudge.box : userRectToBox(pdf, shown, rect) }))
    : [];
  const coveredBoxes = shown && pdf && !removed
    ? covered.filter((c) => c.page === page).map((c) => userRectToBox(pdf, shown, c.rect))
    : [];
  const number = page + 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-[#111111]/70 md:items-center md:p-6"
      data-testid="pdf-page-editor"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        tabIndex={-1}
        onKeyDown={onPanelKeyDown}
        className="flex h-full w-full flex-col border border-[#111111] bg-[#F9F9F7] outline-none md:h-[min(94vh,64rem)] md:max-w-4xl"
      >
        <header className="flex items-center gap-1 border-b border-[#C8C5BC] py-1 pl-4 pr-1 md:py-1.5 md:pr-2">
          <h2 id={titleId} className="label-meta flex-1 text-[#111111] tabular-nums">{s.pageOf(number, pageCount)}</h2>
          <button type="button" className={ICON_BUTTON} aria-label={s.previous} title={s.previous} aria-disabled={page === 0} onClick={() => goTo(page - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={ICON_BUTTON} aria-label={s.next} title={s.next} aria-disabled={page >= pageCount - 1} onClick={() => goTo(page + 1)}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={ICON_BUTTON} aria-label={s.close} title={s.close} onClick={requestClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <p id={helpId} className="px-4 py-2 text-xs leading-relaxed text-[#525252]" data-testid="pdf-page-help">
          {removed ? s.leftOutHelp : s.areaHelp}
        </p>
        <p id={keysId} hidden>{s.keysHint}</p>
        <p role="status" className="sr-only">{removed ? s.leftOut : s.areasHidden(areas.length)}</p>

        <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#E5E5E0]" style={{ padding: STAGE_PAD }}>
          {!shown && (
            <p className="text-xs text-[#525252]">{failed || renderFailed ? s.failed : s.loading}</p>
          )}
          {shown && size && (
            <div className="relative shrink-0 bg-white outline outline-1 outline-[#C8C5BC]" style={{ width: size.width, height: size.height }}>
              <CanvasHost canvas={shown.canvas} className={`absolute inset-0 ${removed ? 'opacity-30' : ''}`} />
              <div
                ref={surfaceRef}
                data-testid="pdf-page-surface"
                className={`absolute inset-0 touch-none select-none ${canEdit ? 'cursor-crosshair' : ''}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
              >
                {coveredBoxes.map((box, i) => (
                  <span key={`c${i}`} data-testid="pdf-covered" className="pointer-events-none absolute bg-[#111111]" style={percent(box)} />
                ))}
                {removed && areaBoxes.map(({ index, box }) => (
                  <span key={index} className="pointer-events-none absolute bg-[#111111] opacity-30" style={percent(box)} />
                ))}
                {!removed && areaBoxes.map(({ index, box }, i) => (
                  <div
                    key={index}
                    data-pdf-area={index}
                    data-testid="pdf-area"
                    role="group"
                    tabIndex={0}
                    aria-label={s.area(i + 1, areaBoxes.length)}
                    aria-describedby={keysId}
                    className="group absolute cursor-default bg-[#111111] outline-none focus:outline-2 focus:outline-offset-2 focus:outline-[#111111]"
                    style={percent(box)}
                    onKeyDown={(e) => onAreaKeyDown(e, index, box)}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) sendNudge();
                    }}
                  >
                    {/* The cross is as large as it looks, so it never stands in the way of the next drag beside
                        it; on the area that has the focus (tapped, or reached with Tab) it is 44 px under a finger. */}
                    <button
                      type="button"
                      aria-label={s.removeArea(i + 1)}
                      title={s.removeArea(i + 1)}
                      aria-disabled={busy}
                      onClick={() => remove(index)}
                      className="absolute right-0 top-0 inline-flex h-5 w-5 -translate-y-1/2 translate-x-1/2 cursor-pointer items-center justify-center border border-[#111111] bg-[#F9F9F7] text-[#111111] group-focus-within:after:absolute group-focus-within:after:-inset-3 group-focus-within:after:content-[''] md:h-4 md:w-4"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                {draft && (
                  <span data-testid="pdf-area-draft" className="pointer-events-none absolute border border-[#111111] bg-[#111111]/50" style={percent(draft)} />
                )}
              </div>
              {removed && (
                <span className="label-meta pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-[#111111] px-3 py-1 text-[#F9F9F7]">
                  {s.leftOut}
                </span>
              )}
            </div>
          )}
        </div>

        <p className="hidden border-t border-[#C8C5BC] px-4 pt-2 text-[11px] leading-relaxed text-[#525252] md:block" aria-hidden="true">{s.keysHint}</p>
        <footer className="flex flex-wrap items-center gap-2 border-t border-[#C8C5BC] px-3 py-2 md:border-t-0 md:px-4 md:pb-3">
          <button ref={addRef} type="button" className={TOOL_BUTTON} aria-disabled={!canEdit} onClick={add} data-testid="pdf-add-area">
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {s.addArea}
          </button>
          <button
            type="button"
            className={TOOL_BUTTON}
            aria-disabled={busy || (!removed && !canLeaveOut)}
            title={!removed && !canLeaveOut ? s.lastPage : undefined}
            onClick={toggle}
            data-testid="pdf-editor-toggle-page"
          >
            {removed ? <Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <FileMinus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            {removed ? s.bringBackPage(number) : s.leaveOutPage(number)}
          </button>
          <button
            type="button"
            onClick={requestClose}
            data-testid="pdf-editor-done"
            className="pressable ml-auto inline-flex min-h-11 items-center border border-[#111111] bg-[#111111] px-5 text-xs font-semibold text-[#F9F9F7] transition-colors hover:bg-[#222222] cursor-pointer md:min-h-8"
          >
            {s.done}
          </button>
        </footer>
      </div>
    </div>
  );
}
