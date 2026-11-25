// T284 (WLojek/DocCloak.Core#6): the page view of a loaded PDF. Core's preview is mocked (pdf.js
// does not run in jsdom); the rectangle converters are Core's own, so a rectangle drawn on the
// fake page must come out in user space exactly as Core would compute it, also on a page with
// /Rotate. jsdom has no layout, no PointerEvent and no IntersectionObserver: the page's box on
// screen is given by a stubbed getBoundingClientRect, and the two missing classes by small doubles.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import type { PdfEdits, PdfRegion } from '@doccloak/core/pdf';
import { pixelRectToUserRect } from '@doccloak/core/pdf';
import { PdfPages, type PdfPagesProps } from '../../src/ui/components/PdfPages.tsx';
import { NUDGE_DELAY } from '../../src/ui/components/pdf/PdfPageEditor.tsx';
import { THUMB_CACHE } from '../../src/ui/components/pdf/preview.ts';
import { KEY_STEP } from '../../src/ui/components/pdf/geometry.ts';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { pdfEditStrings } from '../../src/i18n/features/pdfEdit.ts';

const mocks = vi.hoisted(() => ({ openPdfPreview: vi.fn() }));

vi.mock('@doccloak/core/pdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@doccloak/core/pdf')>();
  return { ...actual, openPdfPreview: (...args: unknown[]) => mocks.openPdfPreview(...args) };
});

const en = pdfEditStrings.en;

/* ---------------- doubles ---------------- */

class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

class FakeObserver {
  static all: FakeObserver[] = [];
  private readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit | undefined;
  readonly cells = new Set<HTMLElement>();
  disconnected = false;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeObserver.all.push(this);
  }
  observe(el: HTMLElement) { this.cells.add(el); }
  unobserve(el: HTMLElement) { this.cells.delete(el); }
  disconnect() { this.disconnected = true; this.cells.clear(); }
  /** The cells of `pages` come into sight (or leave it). */
  set(pages: number[], inSight: boolean) {
    const entries = [...this.cells]
      .filter((el) => pages.includes(Number(el.dataset.pdfPage)))
      .map((target) => ({ target, isIntersecting: inSight }) as unknown as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
  static get current(): FakeObserver {
    const live = FakeObserver.all.filter((o) => !o.disconnected);
    return live[live.length - 1];
  }
}

interface FakePage { width: number; height: number; rotate: 0 | 90 }

/**
 * A preview whose pages render at once into empty canvases, with the transform pdf.js gives a
 * page of that size: [s 0 0 -s 0 H*s] upright, [0 s s 0 0 0] with /Rotate 90.
 */
function fakePreview(pageCount: number, page: FakePage = { width: 400, height: 300, rotate: 0 }) {
  const rendered: Array<{ page: number; scale: number }> = [];
  const shownWidth = page.rotate === 90 ? page.height : page.width;
  const shownHeight = page.rotate === 90 ? page.width : page.height;
  const preview = {
    pageCount,
    pageSize: vi.fn(async () => ({ width: shownWidth, height: shownHeight, rotate: page.rotate })),
    render: vi.fn(async (index: number, scale: number) => {
      rendered.push({ page: index, scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(shownWidth * scale);
      canvas.height = Math.ceil(shownHeight * scale);
      return {
        widthPx: canvas.width,
        heightPx: canvas.height,
        widthPt: shownWidth,
        heightPt: shownHeight,
        transform: page.rotate === 90 ? [0, scale, scale, 0, 0, 0] : [scale, 0, 0, -scale, 0, page.height * scale],
        canvas: { canvas },
      };
    }),
    close: vi.fn(async () => {}),
  };
  return { preview, rendered };
}

function extractionOf(pageCount: number, bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])) {
  return { bytes, pageCount };
}

interface HarnessProps extends Partial<Pick<PdfPagesProps, 'busy' | 'covered' | 'defaultOpen'>> {
  pageCount?: number;
  initial?: PdfEdits;
  onChange?: (edits: PdfEdits) => void;
  extraction?: PdfPagesProps['extraction'];
}

/** A host that applies every set it is sent, as the app will. */
function Harness({ pageCount = 3, initial = {}, onChange, extraction, busy, covered, defaultOpen = true }: HarnessProps) {
  const [edits, setEdits] = useState(initial);
  // The bytes stay the same object over every edit, as in the app.
  const [source] = useState(() => extraction ?? extractionOf(pageCount));
  return (
    <LanguageProvider>
      <button type="button">before</button>
      <PdfPages
        extraction={source}
        edits={edits}
        onChange={(next) => {
          onChange?.(next);
          setEdits(next);
        }}
        busy={busy}
        covered={covered}
        defaultOpen={defaultOpen}
      />
    </LanguageProvider>
  );
}

const thumbs = () => screen.getAllByTestId('pdf-page-thumb');
const toggles = () => screen.getAllByTestId('pdf-page-toggle');
const canvasesIn = (el: HTMLElement) => el.querySelectorAll('canvas').length;

async function previewOpened() {
  await waitFor(() => expect(mocks.openPdfPreview).toHaveBeenCalled());
  await waitFor(() => expect(FakeObserver.current).toBeDefined());
}

/** Open page `number` (1-based) large and wait for its picture; the page's box on screen is `bounds`. */
async function openEditor(number: number, bounds = { left: 0, top: 0, width: 400, height: 300 }) {
  fireEvent.click(thumbs()[number - 1]);
  const dialog = await screen.findByRole('dialog');
  const surface = await within(dialog).findByTestId('pdf-page-surface');
  surface.getBoundingClientRect = () => ({ ...bounds, right: bounds.left + bounds.width, bottom: bounds.top + bounds.height, x: bounds.left, y: bounds.top, toJSON: () => ({}) });
  return { dialog, surface };
}

function drag(surface: HTMLElement, from: [number, number], to: [number, number], pointerType = 'mouse') {
  fireEvent.pointerDown(surface, { clientX: from[0], clientY: from[1], pointerId: 7, pointerType, button: 0 });
  fireEvent.pointerMove(surface, { clientX: (from[0] + to[0]) / 2, clientY: (from[1] + to[1]) / 2, pointerId: 7, pointerType });
  fireEvent.pointerMove(surface, { clientX: to[0], clientY: to[1], pointerId: 7, pointerType });
  fireEvent.pointerUp(surface, { clientX: to[0], clientY: to[1], pointerId: 7, pointerType });
}

function expectRect(actual: { x0: number; y0: number; x1: number; y1: number }, expected: { x0: number; y0: number; x1: number; y1: number }) {
  expect(actual.x0).toBeCloseTo(expected.x0, 6);
  expect(actual.y0).toBeCloseTo(expected.y0, 6);
  expect(actual.x1).toBeCloseTo(expected.x1, 6);
  expect(actual.y1).toBeCloseTo(expected.y1, 6);
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  localStorage.setItem('doccloak-lang', 'en');
  mocks.openPdfPreview.mockReset();
  FakeObserver.all = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  vi.stubGlobal('devicePixelRatio', 1);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ---------------- the section and its pictures ---------------- */

describe('PdfPages: the section', () => {
  it('is closed at first and opens pdf.js only when the pages are asked for', async () => {
    const { preview } = fakePreview(3);
    mocks.openPdfPreview.mockResolvedValue(preview);
    render(<Harness defaultOpen={false} />);
    const section = screen.getByRole('region', { name: en.title });
    const toggle = within(section).getByTestId('pdf-pages-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent(en.hint);
    expect(screen.queryByTestId('pdf-pages-grid')).toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(mocks.openPdfPreview).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(thumbs()).toHaveLength(3);
    await previewOpened();
    expect(mocks.openPdfPreview).toHaveBeenCalledTimes(1);
    // The bytes of the extraction, with the self-hosted pdf.js assets.
    const [source] = mocks.openPdfPreview.mock.calls[0];
    expect(source.bytes).toBeInstanceOf(Uint8Array);
    expect(source.assets.pdfjsWorkerUrl).toContain('/pdf/pdf.worker.mjs');

    // Closed again: pdf.js is let go.
    fireEvent.click(toggle);
    await waitFor(() => expect(preview.close).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('pdf-pages-grid')).toBeNull();
  });

  it('renders a thumbnail only when its page comes into sight', async () => {
    const { preview, rendered } = fakePreview(200);
    mocks.openPdfPreview.mockResolvedValue(preview);
    render(<Harness pageCount={200} />);
    expect(thumbs()).toHaveLength(200);
    await previewOpened();
    // Every cell is watched, inside the scrolling box of the grid; nothing is rendered yet.
    expect(FakeObserver.current.cells.size).toBe(200);
    expect(FakeObserver.current.options?.root).toBe(screen.getByTestId('pdf-pages-grid'));
    expect(preview.render).not.toHaveBeenCalled();

    await act(async () => { FakeObserver.current.set([0, 1, 2, 3, 4, 5], true); });
    await waitFor(() => expect(canvasesIn(screen.getByTestId('pdf-pages-grid'))).toBe(6));
    expect(rendered.map((r) => r.page)).toEqual([0, 1, 2, 3, 4, 5]);
    // A thumbnail is small: 96 x 128 CSS pixels at most, here 96 x 72 at one pixel per CSS pixel.
    expect(rendered[0].scale).toBeCloseTo(96 / 400);
    expect(canvasesIn(thumbs()[0])).toBe(1);
    expect(canvasesIn(thumbs()[6])).toBe(0);
    // Until its picture is there a cell shows its number.
    expect(thumbs()[6]).toHaveTextContent('7');
  });

  it('lets go of thumbnails out of sight above the cap', async () => {
    const { preview } = fakePreview(200);
    mocks.openPdfPreview.mockResolvedValue(preview);
    render(<Harness pageCount={200} />);
    await previewOpened();
    const grid = screen.getByTestId('pdf-pages-grid');
    // Scroll through the whole file, twenty pages at a time.
    for (let from = 0; from < 200; from += 20) {
      const pages = Array.from({ length: 20 }, (_, i) => from + i);
      await act(async () => { FakeObserver.current.set(pages, true); });
      await waitFor(() => expect(canvasesIn(thumbs()[from + 19])).toBe(1));
      expect(canvasesIn(grid)).toBeLessThanOrEqual(THUMB_CACHE);
      await act(async () => { FakeObserver.current.set(pages, false); });
    }
    expect(preview.render).toHaveBeenCalledTimes(200);
    expect(canvasesIn(grid)).toBe(THUMB_CACHE);
    // The first pages were let go; back in sight they are rendered again.
    expect(canvasesIn(thumbs()[0])).toBe(0);
    await act(async () => { FakeObserver.current.set([0], true); });
    await waitFor(() => expect(canvasesIn(thumbs()[0])).toBe(1));
    expect(preview.render).toHaveBeenCalledTimes(201);
  });

  it('keeps one preview per file: an edit does not open it again, another file does, unmount closes it', async () => {
    const first = fakePreview(3);
    const second = fakePreview(2);
    mocks.openPdfPreview.mockResolvedValueOnce(first.preview).mockResolvedValueOnce(second.preview);
    const bytes = new Uint8Array([1, 2, 3]);
    const onChange = vi.fn();
    const view = (extraction: PdfPagesProps['extraction'], edits: PdfEdits) => (
      <LanguageProvider><PdfPages extraction={extraction} edits={edits} onChange={onChange} defaultOpen /></LanguageProvider>
    );
    const { rerender, unmount } = render(view({ bytes, pageCount: 3 }, {}));
    await previewOpened();
    // The edited extraction is another object over the same bytes.
    rerender(view({ bytes, pageCount: 3 }, { removedPages: [1] }));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.openPdfPreview).toHaveBeenCalledTimes(1);
    expect(first.preview.close).not.toHaveBeenCalled();

    rerender(view({ bytes: new Uint8Array([9, 9, 9]), pageCount: 2 }, {}));
    await waitFor(() => expect(mocks.openPdfPreview).toHaveBeenCalledTimes(2));
    expect(first.preview.close).toHaveBeenCalledTimes(1);
    expect(thumbs()).toHaveLength(2);
    await waitFor(() => expect(FakeObserver.current.cells.size).toBe(2));

    unmount();
    await waitFor(() => expect(second.preview.close).toHaveBeenCalledTimes(1));
  });

  it('says so when the file cannot be opened for pictures, and pages can still be left out', async () => {
    mocks.openPdfPreview.mockRejectedValue(new Error('pdf.js cannot open this PDF'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(await screen.findByTestId('pdf-pages-failed')).toHaveTextContent(en.failed);
    fireEvent.click(toggles()[2]);
    expect(onChange).toHaveBeenCalledWith({ removedPages: [2], regions: [] });
  });
});

/* ---------------- pages left out ---------------- */

describe('PdfPages: leaving pages out', () => {
  const AREA: PdfRegion = { page: 0, rect: { x0: 40, y0: 210, x1: 200, y1: 270 } };

  beforeEach(() => {
    mocks.openPdfPreview.mockResolvedValue(fakePreview(3).preview);
  });

  it('sends the full set when a page is left out and when it is brought back', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ regions: [AREA] }} onChange={onChange} />);
    await previewOpened();
    expect(toggles()[1]).toHaveAccessibleName(en.leaveOutPage(2));
    expect(toggles()[1]).toHaveTextContent(en.leaveOut);
    fireEvent.click(toggles()[1]);
    expect(onChange).toHaveBeenLastCalledWith({ removedPages: [1], regions: [AREA] });
    // The page says it is left out, and its switch now brings it back.
    expect(thumbs()[1]).toHaveTextContent(en.leftOut);
    expect(thumbs()[1]).toHaveAccessibleName(`${en.openPage(2)}. ${en.leftOut}`);
    expect(toggles()[1]).toHaveAccessibleName(en.bringBackPage(2));
    expect(toggles()[1]).toHaveTextContent(en.bringBack);
    expect(screen.getByTestId('pdf-pages-summary')).toHaveTextContent(`${en.pagesLeftOut(1)}, ${en.areasHidden(1)}`);

    fireEvent.click(toggles()[1]);
    expect(onChange).toHaveBeenLastCalledWith({ removedPages: [], regions: [AREA] });
    expect(thumbs()[1]).not.toHaveTextContent(en.leftOut);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('never lets the last page be left out', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ removedPages: [0] }} onChange={onChange} />);
    await previewOpened();
    fireEvent.click(toggles()[1]);
    expect(onChange).toHaveBeenLastCalledWith({ removedPages: [0, 1], regions: [] });
    // One page is left: its switch is locked and says why; the other two can come back.
    expect(toggles()[2]).toHaveAttribute('aria-disabled', 'true');
    expect(toggles()[2]).toHaveAttribute('title', en.lastPage);
    expect(toggles()[0]).toHaveAttribute('aria-disabled', 'false');
    fireEvent.click(toggles()[2]);
    expect(onChange).toHaveBeenCalledTimes(1);
    // In the large view of that page too.
    const { dialog } = await openEditor(3);
    const inDialog = within(dialog).getByTestId('pdf-editor-toggle-page');
    expect(inDialog).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(inDialog);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('locks the only page of a one-page file', async () => {
    const onChange = vi.fn();
    render(<Harness pageCount={1} onChange={onChange} />);
    expect(toggles()).toHaveLength(1);
    expect(toggles()[0]).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(toggles()[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('marks a page with hidden areas with their number, and takes everything back in one step', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ removedPages: [2], regions: [AREA, { ...AREA }, { page: 1, rect: AREA.rect }, { page: 2, rect: AREA.rect }] }} onChange={onChange} />);
    await previewOpened();
    const marks = screen.getAllByTestId('pdf-page-areas');
    expect(marks.map((m) => m.textContent)).toEqual(['2', '1', '1']);
    expect(thumbs()[0]).toHaveAccessibleName(`${en.openPage(1)}. ${en.areasHidden(2)}`);
    // The area on the page left out does not count in the summary.
    expect(screen.getByTestId('pdf-pages-summary')).toHaveTextContent(`${en.pagesLeftOut(1)}, ${en.areasHidden(3)}`);
    expect(screen.getByTestId('pdf-pages-toggle')).not.toHaveTextContent(en.hint);

    fireEvent.click(screen.getByTestId('pdf-pages-undo'));
    expect(onChange).toHaveBeenCalledWith({});
    expect(screen.queryByTestId('pdf-pages-undo')).toBeNull();
    expect(screen.queryAllByTestId('pdf-page-areas')).toHaveLength(0);
    expect(screen.getByTestId('pdf-pages-summary')).toHaveTextContent('');
    expect(screen.getByTestId('pdf-pages-toggle')).toHaveTextContent(en.hint);
  });

  it('changes nothing while the host is busy', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ removedPages: [0], regions: [{ page: 1, rect: AREA.rect }] }} onChange={onChange} busy />);
    await previewOpened();
    for (const toggle of toggles()) expect(toggle).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('pdf-pages-undo')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(toggles()[0]);
    fireEvent.click(toggles()[1]);
    fireEvent.click(screen.getByTestId('pdf-pages-undo'));
    // The controls keep the focus they have (they are not taken out of the tab order).
    for (const toggle of toggles()) expect(toggle).not.toBeDisabled();

    const { dialog, surface } = await openEditor(2);
    expect(within(dialog).getByTestId('pdf-add-area')).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).getByTestId('pdf-editor-toggle-page')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(within(dialog).getByTestId('pdf-add-area'));
    fireEvent.click(within(dialog).getByTestId('pdf-editor-toggle-page'));
    drag(surface, [40, 30], [200, 90]);
    expect(screen.queryByTestId('pdf-area-draft')).toBeNull();
    const area = within(dialog).getByTestId('pdf-area');
    fireEvent.click(within(area).getByRole('button'));
    fireEvent.keyDown(area, { key: 'Delete' });
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    await act(async () => { await new Promise((r) => setTimeout(r, NUDGE_DELAY + 100)); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows the set it sent until the host answers, then what the host says', async () => {
    // A host that takes its time and then refuses the change.
    let answer: () => void = () => {};
    const onChange = vi.fn(() => new Promise<void>((resolve) => { answer = resolve; }));
    render(<LanguageProvider><PdfPages extraction={extractionOf(3)} edits={{}} onChange={onChange} defaultOpen /></LanguageProvider>);
    await previewOpened();
    fireEvent.click(toggles()[0]);
    expect(onChange).toHaveBeenCalledWith({ removedPages: [0], regions: [] });
    expect(thumbs()[0]).toHaveTextContent(en.leftOut);
    await act(async () => { answer(); });
    await waitFor(() => expect(thumbs()[0]).not.toHaveTextContent(en.leftOut));
  });
});

/* ---------------- the large view ---------------- */

describe('PdfPages: the large view of a page', () => {
  it('is a labelled modal dialog that keeps the focus and gives it back to the page', async () => {
    mocks.openPdfPreview.mockResolvedValue(fakePreview(3).preview);
    render(<Harness />);
    await previewOpened();
    thumbs()[1].focus();
    const { dialog } = await openEditor(2);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(en.pageOf(2, 3));
    expect(dialog).toHaveAccessibleDescription(en.areaHelp);
    // What hiding does to the downloaded file is said in the dialog.
    expect(within(dialog).getByTestId('pdf-page-help')).toHaveTextContent('painted black in the downloaded file');
    expect(document.activeElement).toBe(dialog);
    expect(document.body.style.overflow).toBe('hidden');

    // Tab goes round inside the dialog, both ways.
    const stops = within(dialog).getAllByRole('button');
    const first = stops[0];
    const last = stops[stops.length - 1];
    expect(last).toHaveTextContent(en.done);
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    // Focus that lands outside comes back.
    act(() => { screen.getByText('before').focus(); });
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(thumbs()[1]);
    expect(document.body.style.overflow).toBe('');
  });

  it('goes to the page before and after, and returns the focus to the page shown last', async () => {
    const { preview, rendered } = fakePreview(3);
    mocks.openPdfPreview.mockResolvedValue(preview);
    render(<Harness />);
    await previewOpened();
    const { dialog } = await openEditor(1);
    const previous = within(dialog).getByRole('button', { name: en.previous });
    const next = within(dialog).getByRole('button', { name: en.next });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(previous);
    expect(dialog).toHaveAccessibleName(en.pageOf(1, 3));
    fireEvent.click(next);
    expect(dialog).toHaveAccessibleName(en.pageOf(2, 3));
    await within(dialog).findByTestId('pdf-page-surface');
    fireEvent.click(next);
    expect(dialog).toHaveAccessibleName(en.pageOf(3, 3));
    expect(next).toHaveAttribute('aria-disabled', 'true');
    await within(dialog).findByTestId('pdf-page-surface');
    // One large picture per page shown, each bigger than a thumbnail.
    expect(rendered.filter((r) => r.scale > 1).map((r) => r.page)).toEqual([0, 1, 2]);
    // Only the page in view keeps its picture.
    expect(canvasesIn(dialog)).toBe(1);

    fireEvent.click(within(dialog).getByTestId('pdf-editor-done'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(thumbs()[2]);
  });

  it('hides the area a mouse drag covers, in the page user space', async () => {
    // A screen with two canvas pixels per CSS pixel: the result must not depend on it.
    vi.stubGlobal('devicePixelRatio', 2);
    const { preview, rendered } = fakePreview(3);
    mocks.openPdfPreview.mockResolvedValue(preview);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await previewOpened();
    // The 400 x 300 pt page is shown 400 x 300 CSS pixels at (100, 50) of the window.
    const { dialog, surface } = await openEditor(2, { left: 100, top: 50, width: 400, height: 300 });
    const large = rendered[rendered.length - 1];
    expect(large.page).toBe(1);
    expect(large.scale).toBeGreaterThan(2);

    fireEvent.pointerDown(surface, { clientX: 140, clientY: 80, pointerId: 7, pointerType: 'mouse', button: 0 });
    fireEvent.pointerMove(surface, { clientX: 220, clientY: 110, pointerId: 7, pointerType: 'mouse' });
    // While the pointer is down the area is shown where it will be.
    const draft = screen.getByTestId('pdf-area-draft');
    expect(parseFloat(draft.style.left)).toBeCloseTo(10);
    expect(parseFloat(draft.style.top)).toBeCloseTo(10);
    expect(parseFloat(draft.style.width)).toBeCloseTo(20);
    expect(parseFloat(draft.style.height)).toBeCloseTo(10);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(surface, { clientX: 300, clientY: 140, pointerId: 7, pointerType: 'mouse' });
    fireEvent.pointerUp(surface, { clientX: 300, clientY: 140, pointerId: 7, pointerType: 'mouse' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const sent = onChange.mock.calls[0][0] as PdfEdits;
    expect(sent.removedPages).toEqual([]);
    expect(sent.regions).toHaveLength(1);
    expect(sent.regions![0].page).toBe(1);
    // 40..200 pt from the left, 30..90 pt from the top of a 300 pt page: y 210..270 from the bottom.
    expectRect(sent.regions![0].rect, { x0: 40, y0: 210, x1: 200, y1: 270 });
    // And it is what Core computes from the pixels of the canvas that was rendered.
    const k = large.scale;
    expectRect(sent.regions![0].rect, pixelRectToUserRect([k, 0, 0, -k, 0, 300 * k], { x0: 40 * k, y0: 30 * k, x1: 200 * k, y1: 90 * k }));

    // The area is on the page as a black box at the same place, with a way to remove it.
    expect(screen.queryByTestId('pdf-area-draft')).toBeNull();
    const area = within(dialog).getByTestId('pdf-area');
    expect(area).toHaveAccessibleName(en.area(1, 1));
    expect(parseFloat(area.style.left)).toBeCloseTo(10);
    expect(parseFloat(area.style.top)).toBeCloseTo(10);
    expect(parseFloat(area.style.width)).toBeCloseTo(40);
    expect(parseFloat(area.style.height)).toBeCloseTo(20);
    expect(within(area).getByRole('button', { name: en.removeArea(1) })).toBeInTheDocument();
    // The page behind shows the mark.
    expect(screen.getByTestId('pdf-page-areas')).toHaveTextContent('1');
  });

  it('hides the area a finger drag covers on a page with /Rotate 90', async () => {
    // The file's page is 400 x 300 pt and turned: it is shown 300 x 400.
    const { preview, rendered } = fakePreview(2, { width: 400, height: 300, rotate: 90 });
    mocks.openPdfPreview.mockResolvedValue(preview);
    const onChange = vi.fn();
    render(<Harness pageCount={2} onChange={onChange} />);
    await previewOpened();
    const { surface } = await openEditor(1, { left: 100, top: 50, width: 300, height: 400 });
    // Dragged from the bottom right to the top left: the direction does not count.
    drag(surface, [190, 250], [130, 90], 'touch');
    expect(onChange).toHaveBeenCalledTimes(1);
    const region = (onChange.mock.calls[0][0] as PdfEdits).regions![0];
    expect(region.page).toBe(0);
    // Across the shown page 30..90 pt is the page's y, down it 40..200 pt is the page's x.
    expectRect(region.rect, { x0: 40, y0: 30, x1: 200, y1: 90 });
    const k = rendered[rendered.length - 1].scale;
    expectRect(region.rect, pixelRectToUserRect([0, k, k, 0, 0, 0], { x0: 30 * k, y0: 40 * k, x1: 90 * k, y1: 200 * k }));
  });

  it('takes a click or a tiny drag for no area, and a cancelled drag for none', async () => {
    mocks.openPdfPreview.mockResolvedValue(fakePreview(3).preview);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await previewOpened();
    const { surface } = await openEditor(1);
    drag(surface, [100, 100], [100, 100]);
    // A wobble of the hand, and a line without height.
    drag(surface, [100, 100], [104, 103]);
    drag(surface, [100, 100], [101, 180]);
    fireEvent.pointerDown(surface, { clientX: 50, clientY: 50, pointerId: 3, pointerType: 'touch' });
    fireEvent.pointerMove(surface, { clientX: 150, clientY: 150, pointerId: 3, pointerType: 'touch' });
    expect(screen.getByTestId('pdf-area-draft')).toBeInTheDocument();
    fireEvent.pointerCancel(surface, { pointerId: 3, pointerType: 'touch' });
    expect(screen.queryByTestId('pdf-area-draft')).toBeNull();
    // The right mouse button does not draw.
    fireEvent.pointerDown(surface, { clientX: 50, clientY: 50, pointerId: 4, pointerType: 'mouse', button: 2 });
    expect(screen.queryByTestId('pdf-area-draft')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    // A thin drag along one line of small text is an area (on a phone a line is a few pixels high).
    drag(surface, [100, 100], [220, 104], 'touch');
    expect(onChange).toHaveBeenCalledTimes(1);
    expectRect((onChange.mock.calls[0][0] as PdfEdits).regions![0].rect, { x0: 100, y0: 196, x1: 220, y1: 200 });
  });

  it('removes an area with its cross and keeps the focus in the dialog', async () => {
    mocks.openPdfPreview.mockResolvedValue(fakePreview(3).preview);
    const onChange = vi.fn();
    const one = { page: 0, rect: { x0: 40, y0: 210, x1: 200, y1: 270 } };
    const two = { page: 0, rect: { x0: 40, y0: 30, x1: 120, y1: 60 } };
    const other = { page: 2, rect: { x0: 1, y0: 2, x1: 30, y1: 40 } };
    render(<Harness initial={{ regions: [one, other, two] }} onChange={onChange} />);
    await previewOpened();
    const { dialog } = await openEditor(1);
    const areas = within(dialog).getAllByTestId('pdf-area');
    expect(areas).toHaveLength(2);
    expect(areas[1]).toHaveAccessibleName(en.area(2, 2));
    fireEvent.click(within(areas[1]).getByRole('button', { name: en.removeArea(2) }));
    expect(onChange).toHaveBeenCalledWith({ removedPages: [], regions: [one, other] });
    expect(within(dialog).getAllByTestId('pdf-area')).toHaveLength(1);
    expect(document.activeElement).toBe(within(dialog).getByTestId('pdf-add-area'));
  });

  it('works from the keyboard: add an area, move and resize it with the arrows, delete it', async () => {
    const { preview } = fakePreview(3);
    mocks.openPdfPreview.mockResolvedValue(preview);
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await previewOpened();
    const { dialog } = await openEditor(1);
    const add = within(dialog).getByTestId('pdf-add-area');
    expect(add).toHaveTextContent(en.addArea);
    fireEvent.click(add);
    expect(onChange).toHaveBeenCalledTimes(1);
    // In the middle of the page: 30..70 % across, 45..55 % down a 400 x 300 pt page.
    const placed = (onChange.mock.calls[0][0] as PdfEdits).regions![0];
    expect(placed.page).toBe(0);
    expectRect(placed.rect, { x0: 120, y0: 135, x1: 280, y1: 165 });
    // The new area has the focus, and says how the keys work on it.
    const area = within(dialog).getByTestId('pdf-area');
    expect(document.activeElement).toBe(area);
    expect(area).toHaveAccessibleDescription(en.keysHint);

    // Two steps right and one down: shown at once, sent once, a moment after the last key.
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    fireEvent.keyDown(area, { key: 'ArrowRight' });
    fireEvent.keyDown(area, { key: 'ArrowDown' });
    expect(parseFloat(area.style.left)).toBeCloseTo(30 + 2 * KEY_STEP * 100);
    expect(parseFloat(area.style.top)).toBeCloseTo(45 + KEY_STEP * 100);
    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2), { timeout: NUDGE_DELAY + 1500 });
    const moved = (onChange.mock.calls[1][0] as PdfEdits).regions!;
    expect(moved).toHaveLength(1);
    expectRect(moved[0].rect, { x0: 120 + 4, y0: 135 - 1.5, x1: 280 + 4, y1: 165 - 1.5 });
    expect(document.activeElement).toBe(within(dialog).getByTestId('pdf-area'));

    // Shift with the arrows resizes (right and bottom edges); Enter sends without waiting.
    fireEvent.keyDown(within(dialog).getByTestId('pdf-area'), { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(within(dialog).getByTestId('pdf-area'), { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(within(dialog).getByTestId('pdf-area'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(3);
    expectRect((onChange.mock.calls[2][0] as PdfEdits).regions![0].rect, { x0: 124, y0: 133.5 + 1.5, x1: 284 + 2, y1: 163.5 });

    // A move that is not sent yet goes out when the dialog is left for another page.
    fireEvent.keyDown(within(dialog).getByTestId('pdf-area'), { key: 'ArrowLeft' });
    fireEvent.click(within(dialog).getByRole('button', { name: en.next }));
    expect(onChange).toHaveBeenCalledTimes(4);
    expectRect((onChange.mock.calls[3][0] as PdfEdits).regions![0].rect, { x0: 122, y0: 135, x1: 284, y1: 163.5 });
    fireEvent.click(within(dialog).getByRole('button', { name: en.previous }));
    await within(dialog).findByTestId('pdf-area');

    // Delete removes the area; the focus goes to "Add an area".
    fireEvent.keyDown(within(dialog).getByTestId('pdf-area'), { key: 'Delete' });
    expect(onChange).toHaveBeenCalledTimes(5);
    expect(onChange.mock.calls[4][0]).toEqual({ removedPages: [], regions: [] });
    expect(within(dialog).queryByTestId('pdf-area')).toBeNull();
    expect(document.activeElement).toBe(add);
    // Nothing more arrives later.
    await act(async () => { await new Promise((r) => setTimeout(r, NUDGE_DELAY + 100)); });
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it('draws what the applied edits really cover, and dims a page that is left out', async () => {
    mocks.openPdfPreview.mockResolvedValue(fakePreview(3).preview);
    const onChange = vi.fn();
    const area = { page: 0, rect: { x0: 40, y0: 210, x1: 200, y1: 270 } };
    // Core says a letter beside the area is painted too.
    const covered: PdfRegion[] = [{ page: 0, rect: { x0: 200, y0: 240, x1: 240, y1: 270 } }, { page: 1, rect: { x0: 0, y0: 0, x1: 10, y1: 10 } }];
    render(<Harness initial={{ regions: [area] }} covered={covered} onChange={onChange} />);
    await previewOpened();
    const { dialog } = await openEditor(1);
    const painted = within(dialog).getAllByTestId('pdf-covered');
    expect(painted).toHaveLength(1);
    expect(parseFloat(painted[0].style.left)).toBeCloseTo(50);
    expect(parseFloat(painted[0].style.top)).toBeCloseTo(10);
    expect(parseFloat(painted[0].style.width)).toBeCloseTo(10);
    expect(parseFloat(painted[0].style.height)).toBeCloseTo(10);

    // Left out from the large view: the page says so, and nothing can be drawn on it.
    const toggle = within(dialog).getByTestId('pdf-editor-toggle-page');
    expect(toggle).toHaveTextContent(en.leaveOutPage(1));
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith({ removedPages: [0], regions: [area] });
    expect(within(dialog).getByTestId('pdf-page-help')).toHaveTextContent(en.leftOutHelp);
    expect(within(dialog).getByTestId('pdf-editor-toggle-page')).toHaveTextContent(en.bringBackPage(1));
    expect(within(dialog).getByTestId('pdf-add-area')).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).queryByTestId('pdf-area')).toBeNull();
    expect(within(dialog).queryByTestId('pdf-covered')).toBeNull();
    const surface = within(dialog).getByTestId('pdf-page-surface');
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) });
    drag(surface, [40, 30], [200, 90]);
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByTestId('pdf-editor-toggle-page'));
    expect(onChange).toHaveBeenLastCalledWith({ removedPages: [], regions: [area] });
    expect(within(dialog).getByTestId('pdf-area')).toBeInTheDocument();
  });
});
