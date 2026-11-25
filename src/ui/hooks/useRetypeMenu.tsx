/**
 * The menu that changes the type of a found value (WLojek/DocCloak#5), shared by its two ways in:
 * the type of a row in the list and a marked place in the source text.
 *
 * It reads as one question, "what is this value": one of the types, or not redacted at all. The
 * answer holds for every place of the value, because a label belongs to a value. A type means
 * "redact it, as this": for a value that is not redacted anywhere it redacts every place, and for
 * a place of the text that is not redacted (the menu was opened on it) that place, as marking it
 * by hand did. What the user left readable elsewhere stays readable. Every answer says what it did
 * and can be undone on the spot.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DetectedEntity, EntityType } from '@doccloak/core';
import { EntityTypePicker } from '../components/EntityTypePicker.tsx';
import { useToast } from '../components/Toast.tsx';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { useFeatureStrings } from '../../i18n/features/index.ts';
import { retypeStrings } from '../../i18n/features/retype.ts';

/** Where the menu opens and for which value. */
export interface RetypeRequest {
  value: string;
  /** The type shown where the menu was opened. */
  type: EntityType;
  /** The place of the text the menu was opened on (its number in the list); none for a row of the list. */
  place?: number;
  x: number;
  y: number;
  /** Where the menu ends when it opens upwards (the top of what opened it); `y` when not given. */
  yAbove?: number;
  /** What opened the menu: it gets the focus back. */
  opener?: HTMLElement | null;
  /**
   * Finds the opener again when the change replaced it (a row of the list is made anew under its
   * new type): the element that carries this value in `data-retype`.
   */
  focusKey?: string;
}

interface RetypeMenuOptions {
  /** The analysed text: an Undo only acts on the text it was offered for. */
  text: string;
  entities: DetectedEntity[];
  /** Places that are found but not redacted. */
  excluded?: ReadonlySet<number>;
  /** Without it there is no menu. */
  onChangeType?: (value: string, type: EntityType) => void;
  /** Without it the menu has no "do not redact". */
  onSetExcluded?: (indices: number[], excluded: boolean) => void;
  /** Where the focus goes when what opened the menu is gone (a filtered list no longer shows the row). */
  focusFallback?: () => HTMLElement | null;
}

const placeOf = (entity: DetectedEntity) => `${entity.start}:${entity.end}:${entity.value}`;
const NONE: ReadonlySet<number> = new Set();

export function useRetypeMenu({ text, entities, excluded = NONE, onChangeType, onSetExcluded, focusFallback }: RetypeMenuOptions): {
  /** False when the host was given no way to change a type. */
  enabled: boolean;
  open: (request: RetypeRequest) => void;
  /** The value whose menu is open. */
  openFor: string | null;
  menu: ReactNode;
} {
  const { t } = useTranslation();
  const strings = useFeatureStrings(retypeStrings);
  const { showToast } = useToast();
  const [request, setRequest] = useState<RetypeRequest | null>(null);
  // The list as it is now, for the Undo of a toast (it outlives the render it was made in).
  const textRef = useRef(text);
  textRef.current = text;
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const open = useCallback((next: RetypeRequest) => {
    if (onChangeType) setRequest(next);
  }, [onChangeType]);

  // After a choice the focus goes back to what opened the menu. A row of the list is a new element
  // by then, so it is looked for once the list is drawn again.
  const refocus = useRef<RetypeRequest | null>(null);
  const fallbackRef = useRef(focusFallback);
  fallbackRef.current = focusFallback;
  useEffect(() => {
    const from = refocus.current;
    if (from === null) return;
    refocus.current = null;
    let target: HTMLElement | null = from.opener?.isConnected ? from.opener : null;
    if (target === null && from.focusKey !== undefined) {
      for (const candidate of document.querySelectorAll<HTMLElement>('[data-retype]')) {
        if (candidate.dataset.retype === from.focusKey) { target = candidate; break; }
      }
    }
    (target ?? fallbackRef.current?.())?.focus({ preventScroll: true });
  });

  // A value that left the list (a new text, a new detection) takes its menu along.
  const places = request === null ? [] : entities.flatMap((entity, index) => (entity.value === request.value ? [index] : []));
  const gone = request !== null && places.length === 0;
  useEffect(() => {
    if (gone) setRequest(null);
  }, [gone]);

  if (request === null || !onChangeType || gone) return { enabled: onChangeType !== undefined, open, openFor: null, menu: null };

  const { value, type: shownType } = request;
  const allKept = places.every((index) => excluded.has(index));
  // The same places later, wherever they stand in the list by then; none in another text.
  const source = text;
  const nowAt = (keys: Set<string>): number[] => (textRef.current !== source
    ? []
    : entitiesRef.current.flatMap((entity, index) => (keys.has(placeOf(entity)) ? [index] : [])));
  const done = () => {
    refocus.current = request;
    setRequest(null);
  };

  const chooseType = (type: EntityType) => {
    done();
    const changes = places.some((index) => entities[index].type !== type);
    // "Not redacted" was the answer until now, for the value or for the place the menu was opened
    // on: a type in its place means "redact it, as this".
    const here = request.place !== undefined && places.includes(request.place) && excluded.has(request.place) ? [request.place] : [];
    const redact = !onSetExcluded ? [] : allKept ? places : here;
    if (!changes && redact.length === 0) return;
    if (changes) onChangeType(value, type);
    const back = () => {
      if (changes && textRef.current === source) onChangeType(value, shownType);
    };
    if (redact.length > 0 && onSetExcluded) {
      const keys = new Set(redact.map((index) => placeOf(entities[index])));
      onSetExcluded(redact, false);
      showToast(t.entityTable.redactedToast(redact.length), {
        label: t.toast.undo,
        onClick: () => {
          back();
          const now = nowAt(keys);
          if (now.length > 0) onSetExcluded(now, true);
        },
      });
      return;
    }
    showToast(strings.changedToast(t.entityLabels[type], places.length), { label: t.toast.undo, onClick: back });
  };

  const keep = onSetExcluded && {
    label: strings.keep,
    chosen: allKept,
    onChoose: () => {
      done();
      const redacted = places.filter((index) => !excluded.has(index));
      if (redacted.length === 0) return;
      const keys = new Set(redacted.map((index) => placeOf(entities[index])));
      onSetExcluded(redacted, true);
      showToast(t.entityTable.keptToast(redacted.length), {
        label: t.toast.undo,
        onClick: () => {
          const now = nowAt(keys);
          if (now.length > 0) onSetExcluded(now, false);
        },
      });
    },
  };

  const menu = (
    <EntityTypePicker
      // A menu opened for another value while one is open starts anew (its focus, its place).
      key={`${request.x}:${request.y}:${value}`}
      word={value.length > 40 ? `${value.slice(0, 37)}...` : value}
      x={request.x}
      y={request.y}
      yAbove={request.yAbove}
      heading={strings.heading}
      note={places.length > 1 ? strings.scope(places.length) : undefined}
      current={allKept ? null : shownType}
      keep={keep || undefined}
      returnFocus={request.opener}
      onSelect={chooseType}
      onClose={() => setRequest(null)}
    />
  );
  // Drawn at the top of the page: inside the list or the text panel it could end up under the bar
  // that stays at the bottom of the window.
  return { enabled: true, open, openFor: value, menu: createPortal(menu, document.body) };
}
