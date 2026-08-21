// Regression test for manual tagging on touch devices: iOS long-press
// selection never fires mouseup, so the entity picker must also open from
// a settled selectionchange when the pointer is coarse.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import type { DetectedEntity } from '@doccloak/core';
import { TextInput } from '../../src/ui/components/TextInput.tsx';
import { LanguageProvider } from '../../src/i18n/LanguageContext.tsx';
import { ToastProvider } from '../../src/ui/components/Toast.tsx';

const TEXT = 'Contact Jan Kowalski today';
const ENTITIES: DetectedEntity[] = [
  { type: 'PERSON', value: 'Jan Kowalski', start: 8, end: 20, confidence: 1, detector: 'test' },
];

function mockMatchMedia(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('pointer: coarse') ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

function renderInput(onAddEntity: (start: number, end: number, type: string) => void) {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <TextInput
          value={TEXT}
          onChange={() => {}}
          onClear={() => {}}
          entities={ENTITIES}
          onAddEntity={onAddEntity}
        />
      </ToastProvider>
    </LanguageProvider>,
  );
}

function selectFirstWord(container: HTMLElement) {
  // "Contact" is the first non-entity word span (data-start="0").
  const span = container.querySelector('[data-start="0"]')!;
  const range = document.createRange();
  range.selectNodeContents(span);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

describe('TextInput touch selection', () => {
  beforeEach(() => {
    window.localStorage.setItem('doccloak-lang', 'en');
    // jsdom ranges have no layout; the component anchors the picker to the
    // selection rect, so give it a fixed one.
    Range.prototype.getBoundingClientRect = () =>
      ({ left: 40, right: 120, top: 100, bottom: 120, width: 80, height: 20, x: 40, y: 100, toJSON: () => ({}) }) as DOMRect;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.getSelection()?.removeAllRanges();
  });

  it('opens the entity picker after a settled selection on coarse pointers', async () => {
    mockMatchMedia(true);
    const onAddEntity = vi.fn();
    const { container } = renderInput(onAddEntity);

    selectFirstWord(container);

    const dialog = await screen.findByRole('dialog', {}, { timeout: 2000 });
    expect(dialog).toHaveTextContent('Contact');

    // The selection is cleared when the picker opens, dismissing the
    // native iOS callout that would otherwise cover it.
    await waitFor(() => expect(window.getSelection()?.isCollapsed ?? true).toBe(true));

    screen.getByRole('button', { name: 'Name' }).click();
    expect(onAddEntity).toHaveBeenCalledWith(0, 7, 'PERSON');
  });

  it('does not open the picker from selectionchange on fine pointers', async () => {
    mockMatchMedia(false);
    const onAddEntity = vi.fn();
    const { container } = renderInput(onAddEntity);

    selectFirstWord(container);

    await new Promise((r) => setTimeout(r, 800));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAddEntity).not.toHaveBeenCalled();
  });
});
