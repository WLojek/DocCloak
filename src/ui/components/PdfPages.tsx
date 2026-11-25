/**
 * The pages of a loaded PDF, to edit the file by hand (T284, WLojek/DocCloak.Core#6).
 *
 * What no detector finds (a signature, a handwritten name, a stamp, a page the OCR could not
 * read) the user takes out here: a whole page is left out, an area of a page is hidden. A quiet
 * section, closed until it is asked for; open, it shows the pages as small pictures in a grid
 * that scrolls inside its own box, so one page and two hundred take about the same room.
 *
 * - Under each page: its number, how many areas are hidden on it, and the switch that leaves it
 *   out or brings it back. A page left out is dimmed and says so.
 * - A page opens large in a dialog (PdfPageEditor), where areas are drawn.
 * - The line at the top says what is changed and takes it all back.
 *
 * The component holds no edits of its own: it shows `edits` and sends the full new set through
 * `onChange` after every action; the host applies it (Core's `applyPdfEdits`) and answers with the
 * new `edits` and `covered`. While a host that answers later (a promise) works, the view shows the
 * set it sent. Pictures
 * are rendered only for pages in sight, and pdf.js is opened only while the section is open.
 */
import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { PdfEdits, PdfExtraction, PdfRegion, Rect } from '@doccloak/core/pdf';
import { useFeatureStrings } from '../../i18n/features/index.ts';
import { pdfEditStrings, type PdfEditStrings } from '../../i18n/features/pdfEdit.ts';
import { countEdits, isEmptyEdits, keepsAPage, regionsOf, sameEdits, togglePage } from '../pdfEdits.ts';
import { fitInto, userRectToBox } from './pdf/geometry.ts';
import { CanvasHost, PdfPageEditor } from './pdf/PdfPageEditor.tsx';
import { THUMB_BOX, usePageThumbs, usePdfPreview, type PageImage, type PdfModule, type PreviewSource } from './pdf/preview.ts';

export interface PdfPagesProps {
  /** The extraction as it is now, edited or not: its bytes are opened for the pictures, its page count is that of the file as read. */
  extraction: PreviewSource & Pick<PdfExtraction, 'pageCount'>;
  /** The full set of edits now ({} when there are none). */
  edits: PdfEdits;
  /**
   * Called with the full new set after every action. The host applies it and passes the new
   * `edits` (and `covered`) down. A set that would leave every page out is never sent. What a
   * host returns at once (the app's hook says whether it applied the set) is not looked at; a
   * promise is waited for.
   */
  onChange: (edits: PdfEdits) => void | boolean | Promise<void>;
  /** The host is working on the last set: nothing can be changed meanwhile. */
  busy?: boolean;
  /** What the applied edits really paint (Core's `covered`): an area takes the letters it touches whole. */
  covered?: PdfRegion[];
  /** Start with the pages shown (default: closed, and then pdf.js is not opened). */
  defaultOpen?: boolean;
}

const NO_REGIONS: PdfRegion[] = [];
const FRAME = { width: THUMB_BOX.width + 2, height: THUMB_BOX.height + 2 };

interface PageCellProps {
  page: number;
  removed: boolean;
  areas: number;
  /** The page is the last one still in: it cannot be left out. */
  last: boolean;
  busy: boolean;
  thumb: PageImage | undefined;
  /** Rectangles painted black on this page (hidden areas and the letters they touch), in user space. */
  marks: Rect[] | undefined;
  pdf: PdfModule | null;
  s: PdfEditStrings;
  onOpen: (page: number) => void;
  onToggle: (page: number) => void;
}

const PageCell = memo(function PageCell({ page, removed, areas, last, busy, thumb, marks, pdf, s, onOpen, onToggle }: PageCellProps) {
  const number = page + 1;
  const size = thumb ? fitInto(thumb.widthPt, thumb.heightPt, THUMB_BOX) : null;
  const name = [s.openPage(number), removed ? s.leftOut : '', areas > 0 ? s.areasHidden(areas) : ''].filter(Boolean).join('. ');
  const locked = busy || (!removed && last);
  return (
    <li className="flex flex-col items-center" data-testid="pdf-page-cell">
      <button
        type="button"
        data-pdf-page={page}
        data-testid="pdf-page-thumb"
        onClick={() => onOpen(page)}
        aria-label={name}
        aria-haspopup="dialog"
        className="relative flex cursor-pointer items-center justify-center border border-[#C8C5BC] bg-white transition-colors hover:border-[#111111] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111]"
        style={FRAME}
      >
        {thumb && size ? (
          <span className={`relative block ${removed ? 'opacity-30' : ''}`} style={{ width: size.width, height: size.height }}>
            <CanvasHost canvas={thumb.canvas} className="absolute inset-0" />
            {pdf && marks?.map((rect, i) => {
              const box = userRectToBox(pdf, thumb, rect);
              return (
                <span
                  key={i}
                  className="absolute bg-[#111111]"
                  style={{ left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`, width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%` }}
                />
              );
            })}
          </span>
        ) : (
          <span className="text-xs tabular-nums text-[#8A8A85]" aria-hidden="true">{number}</span>
        )}
        {removed && (
          <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-[#111111] px-1 py-0.5 text-center text-[10px] font-semibold uppercase leading-tight tracking-[0.08em] text-[#F9F9F7]">
            {s.leftOut}
          </span>
        )}
      </button>
      <div className="mt-1 flex items-center justify-between gap-1 text-[11px] text-[#111111]" style={{ width: FRAME.width }}>
        <span className="font-medium tabular-nums">{number}</span>
        {areas > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums" title={s.areasHidden(areas)} data-testid="pdf-page-areas">
            <span className="inline-block h-2.5 w-2.5 bg-[#111111]" aria-hidden="true" />
            {areas}
          </span>
        )}
      </div>
      <button
        type="button"
        data-testid="pdf-page-toggle"
        onClick={() => onToggle(page)}
        aria-label={removed ? s.bringBackPage(number) : s.leaveOutPage(number)}
        aria-disabled={locked}
        title={!removed && last ? s.lastPage : undefined}
        className={`inline-flex min-h-11 cursor-pointer items-center justify-center px-1 text-center text-[11px] leading-tight underline underline-offset-2 transition-colors aria-disabled:cursor-not-allowed aria-disabled:no-underline aria-disabled:opacity-40 md:min-h-7 ${
          removed ? 'font-semibold text-[#111111]' : 'text-[#525252] hover:text-[#111111]'
        }`}
        style={{ maxWidth: FRAME.width + 8 }}
      >
        {removed ? s.bringBack : s.leaveOut}
      </button>
    </li>
  );
});

export function PdfPages({ extraction, edits, onChange, busy = false, covered = NO_REGIONS, defaultOpen = false }: PdfPagesProps) {
  const s = useFeatureStrings(pdfEditStrings);
  const bodyId = useId();
  const pageCount = extraction.pageCount;
  const [open, setOpen] = useState(defaultOpen);
  /** The page shown large, or null. */
  const [editorPage, setEditorPage] = useState<number | null>(null);
  /** The set sent to the host and not answered yet: shown while `edits` is still the set it was made from. */
  const [sent, setSent] = useState<{ base: PdfEdits; next: PdfEdits } | null>(null);
  const shown = sent && sent.base === edits ? sent.next : edits;

  // Another file: the large view of the file before has nothing to show.
  const [bytes, setBytes] = useState(extraction.bytes);
  if (bytes !== extraction.bytes) {
    setBytes(extraction.bytes);
    setEditorPage(null);
  }

  const preview = usePdfPreview(extraction, open || editorPage !== null);
  const gridRef = useRef<HTMLUListElement>(null);
  const { thumbs } = usePageThumbs(open ? preview.renderer : null, gridRef, pageCount);

  const live = useRef({ edits, shown, busy, onChange, pageCount, editorPage });
  live.current = { edits, shown, busy, onChange, pageCount, editorPage };

  const send = useCallback((next: PdfEdits) => {
    const now = live.current;
    if (now.busy || sameEdits(next, now.shown) || !keepsAPage(next, now.pageCount)) return;
    const base = now.edits;
    let answer: void | boolean | Promise<void>;
    try {
      answer = now.onChange(next);
    } catch (err) {
      console.error('[DocCloak] The PDF edits were not applied:', err);
      return;
    }
    // A host that answers later: the set that was sent is shown until it has answered. From then on
    // the host's `edits` is what counts, also when it kept the old set.
    if (typeof answer !== 'object' || answer === null || typeof answer.then !== 'function') return;
    setSent({ base, next });
    void answer
      .catch((err) => console.error('[DocCloak] The PDF edits were not applied:', err))
      .finally(() => setSent((held) => (held && held.base === base && held.next === next ? null : held)));
  }, []);

  const toggle = useCallback((page: number) => {
    const now = live.current;
    send(togglePage(now.shown, page, now.pageCount));
  }, [send]);

  const openPage = useCallback((page: number) => setEditorPage(page), []);

  // The dialog closed: the focus goes back to the page that was shown last.
  const returnTo = useRef<number | null>(null);
  const closeEditor = useCallback(() => {
    returnTo.current = live.current.editorPage;
    setEditorPage(null);
  }, []);
  useLayoutEffect(() => {
    if (editorPage !== null || returnTo.current === null) return;
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${returnTo.current}"]`);
    returnTo.current = null;
    cell?.focus();
  }, [editorPage]);

  const counts = useMemo(() => countEdits(shown), [shown]);
  const removed = useMemo(() => new Set(shown.removedPages ?? []), [shown]);
  /** One page is still in: it cannot be left out (a file needs a page). */
  const oneLeft = pageCount - counts.pages <= 1;
  /** What is black on each page: the areas as drawn, and what Core says they really cover. */
  const marks = useMemo(() => {
    const byPage = new Map<number, Rect[]>();
    for (const region of [...regionsOf(shown), ...covered]) {
      const list = byPage.get(region.page) ?? [];
      list.push(region.rect);
      byPage.set(region.page, list);
    }
    return byPage;
  }, [shown, covered]);

  const changed = !isEmptyEdits(shown);
  const summary = [counts.pages > 0 ? s.pagesLeftOut(counts.pages) : '', counts.areas > 0 ? s.areasHidden(counts.areas) : ''].filter(Boolean).join(', ');
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, page) => page), [pageCount]);

  return (
    <section aria-label={s.title} data-testid="pdf-pages" className="animate-content-reveal mb-4 border border-[#C8C5BC] bg-[#F4F3EE]">
      <div className="flex flex-wrap items-center gap-x-4 px-4">
        <button
          type="button"
          onClick={() => setOpen((now) => !now)}
          aria-expanded={open}
          aria-controls={bodyId}
          data-testid="pdf-pages-toggle"
          className="flex min-h-11 flex-1 cursor-pointer items-center gap-x-3 py-2 text-left"
        >
          <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#111111] transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            <span className="label-meta text-[#111111]">{s.title}</span>
            <span className="text-xs tabular-nums text-[#525252]">{pageCount}</span>
          </span>
          {!changed && <span className="text-xs leading-snug text-[#525252]">{s.hint}</span>}
        </button>
        <div className="flex items-center gap-x-4">
          <p role="status" data-testid="pdf-pages-summary" className={`text-xs font-medium text-[#111111] ${changed ? 'py-2' : ''}`}>{summary}</p>
          {changed && (
            <button
              type="button"
              onClick={() => send({})}
              aria-disabled={busy}
              data-testid="pdf-pages-undo"
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center whitespace-nowrap text-xs text-[#111111] underline underline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 md:min-h-8"
            >
              {s.undoAll}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div id={bodyId} className="border-t border-[#C8C5BC] px-4 pb-4 pt-3">
          <p className="max-w-xl text-xs leading-relaxed text-[#525252]">{s.note}</p>
          {preview.status === 'error' && (
            <p className="mt-2 flex items-start gap-2 text-xs text-[#111111]" data-testid="pdf-pages-failed">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {s.failed}
            </p>
          )}
          {preview.status === 'loading' && <p className="mt-2 text-xs text-[#525252]">{s.loading}</p>}
          <ul
            ref={gridRef}
            data-testid="pdf-pages-grid"
            className="-mx-1 mt-3 grid max-h-[26rem] grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-x-2 gap-y-3 overflow-y-auto px-1 py-1"
          >
            {pages.map((page) => {
              const isRemoved = removed.has(page);
              return (
                <PageCell
                  key={page}
                  page={page}
                  removed={isRemoved}
                  areas={counts.areasByPage.get(page) ?? 0}
                  last={!isRemoved && oneLeft}
                  busy={busy}
                  thumb={thumbs.get(page)}
                  marks={marks.get(page)}
                  pdf={preview.pdf}
                  s={s}
                  onOpen={openPage}
                  onToggle={toggle}
                />
              );
            })}
          </ul>
        </div>
      )}

      {editorPage !== null && createPortal(
        <PdfPageEditor
          page={editorPage}
          pageCount={pageCount}
          edits={shown}
          covered={covered}
          busy={busy}
          pdf={preview.pdf}
          renderer={preview.renderer}
          failed={preview.status === 'error'}
          onSend={send}
          onPage={setEditorPage}
          onClose={closeEditor}
        />,
        document.body,
      )}
    </section>
  );
}
