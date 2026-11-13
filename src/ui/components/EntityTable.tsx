import { useState, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { DetectedEntity, EntityType, ReplacementEntry } from '@doccloak/core';
import { ENTITY_COLORS } from '@doccloak/core';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ChevronDown, RotateCcw, Search, X } from 'lucide-react';
import { useTranslation } from '../../i18n/LanguageContext.tsx';
import { useToast } from './Toast.tsx';

/**
 * Comparison form for the text filter: lower case, accents folded, so
 * "mediterranee" finds "MÉDITERRANÉE" and "lodz" finds "Łódź".
 */
function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[łŁ]/g, 'l')
    .replace(/[øØ]/g, 'o')
    .replace(/ß/g, 'ss')
    .toLocaleLowerCase();
}

// One place for the certainty color bands used by both table layouts.
function confidenceColor(confidence: number): string {
  return confidence > LOW_CERTAINTY ? '#2D6A4F' : confidence > 0.5 ? '#B8860B' : '#CC0000';
}

/** Up to this the bar is not green. */
const LOW_CERTAINTY = 0.8;
/** Below it a find is listed under "Low certainty" (pattern rules report a flat 80%: those are not doubtful). */
const isLow = (confidence: number) => confidence < LOW_CERTAINTY;

/** A place of the text, whatever its number in the list. */
const placeOf = (entity: DetectedEntity) => `${entity.start}:${entity.end}:${entity.value}`;

/** Characters of the text shown on each side of an occurrence. */
const CONTEXT_LENGTH = 44;

/** One value of one type, with every place it stands in (T262). */
interface ValueGroup {
  key: string;
  type: EntityType;
  value: string;
  /** Indexes into `entities`, in text order. */
  indices: number[];
  /** The lowest certainty among its places: the one that deserves a look. */
  confidence: number;
}

// Filter chips and bulk buttons: compact with a mouse, 44 px tall under a finger.
const CHIP = 'inline-flex items-center gap-1.5 px-2.5 md:px-2 min-h-11 md:min-h-0 md:py-1 text-xs font-medium border cursor-pointer transition-colors';
const CHIP_ON = 'border-[#111111] bg-[#111111] text-[#F9F9F7]';
const CHIP_OFF = 'border-[#C8C5BC] bg-white text-[#525252] hover:border-[#111111] hover:text-[#111111]';
/** A 16 px box with a hit area of 44 px on touch screens and 24 px with a mouse (WCAG 2.5.8). */
const BOX_HIT = "relative after:absolute after:content-[''] after:-inset-4 md:after:-inset-[5px]";
const BULK = 'pressable h-11 md:h-8 px-3 text-xs font-medium border border-[#111111] bg-white text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] transition-colors cursor-pointer';

interface EntityTableProps {
  entities: DetectedEntity[];
  entries: ReplacementEntry[];
  excludedIndices: Set<number>;
  /** The analysed text: the words around each place of a repeated value. */
  text: string;
  onToggle: (index: number) => void;
  /** Keep (excluded = true) or redact (false) every listed place in one step (WLojek/DocCloak#4). */
  onSetExcluded: (indices: number[], excluded: boolean) => void;
  onRenameLabel: (original: string, newLabel: string) => void;
  /** Types that are never anonymized, also in the next documents (T263). */
  keepTypes: EntityType[];
  onKeepTypesChange: (types: EntityType[]) => void;
  /** Values whose label was renamed, and the way back to the numbered label. */
  renamedValues?: ReadonlySet<string>;
  onResetLabel?: (original: string) => void;
  /**
   * A request from outside (the line at the result) to open the list here; `kept` asks for the
   * places that are not redacted. A new `nonce` is a new request.
   */
  reveal?: { kept: boolean; nonce: number };
}

export function EntityTable({
  entities,
  entries,
  excludedIndices,
  text,
  onToggle,
  onSetExcluded,
  onRenameLabel,
  keepTypes,
  onKeepTypesChange,
  renamedValues,
  onResetLabel,
  reveal,
}: EntityTableProps) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  // The one cell being renamed: its value group and layout. Every group exists in both layouts; an
  // input in each would take the focus from the other and close the edit at once.
  const [editing, setEditing] = useState<{ key: string; layout: 'table' | 'card' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const prevEntityCount = useRef(0);
  // WLojek/DocCloak#4: narrow the list to some types and/or to the values that
  // contain a text, then keep or redact everything shown in one step.
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<EntityType>>(new Set());
  const [query, setQuery] = useState('');
  // Only the values with a place that is not redacted: the list of what leaves the document readable.
  const [keptOnly, setKeptOnly] = useState(false);
  const [lowOnly, setLowOnly] = useState(false);
  // Value groups whose places are listed one by one.
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());

  // Types in the list with their counts (places), most frequent first.
  const typeCounts = useMemo(() => {
    const counts = new Map<EntityType, number>();
    for (const entity of entities) counts.set(entity.type, (counts.get(entity.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entities]);

  // One row per value (T262): a name that stands in twelve places is one decision, not twelve.
  // Groups keep the order in which their value first appears.
  const groups = useMemo(() => {
    const byKey = new Map<string, ValueGroup>();
    entities.forEach((entity, index) => {
      const key = `${entity.type}\u0000${entity.value}`;
      const group = byKey.get(key);
      if (group) {
        group.indices.push(index);
        group.confidence = Math.min(group.confidence, entity.confidence);
      } else {
        byKey.set(key, { key, type: entity.type, value: entity.value, indices: [index], confidence: entity.confidence });
      }
    });
    return [...byKey.values()];
  }, [entities]);

  // A type that left the list (new detection, removed items) no longer filters.
  const activeTypes = useMemo(
    () => new Set([...typeFilter].filter((type) => typeCounts.some(([present]) => present === type))),
    [typeFilter, typeCounts],
  );
  const needle = foldForSearch(query.trim());
  const keptCount = useMemo(
    () => entities.reduce((n, _, index) => (excludedIndices.has(index) ? n + 1 : n), 0),
    [entities, excludedIndices],
  );
  // Nothing left to list under "not redacted": the chip goes away and so does its filter, for good
  // (left switched on, it came back by itself the moment one place was kept again).
  const showKeptOnly = keptOnly && keptCount > 0;
  useEffect(() => {
    if (keptOnly && keptCount === 0) setKeptOnly(false);
  }, [keptOnly, keptCount]);
  // Places of the values the detector was least sure about: the ones worth a look first.
  const lowCount = useMemo(
    () => groups.reduce((n, group) => (isLow(group.confidence) ? n + group.indices.length : n), 0),
    [groups],
  );
  const showLowOnly = lowOnly && lowCount > 0;
  const filtering = activeTypes.size > 0 || needle !== '' || showKeptOnly || showLowOnly;

  const rows = useMemo(
    () => groups.filter((group) =>
      (activeTypes.size === 0 || activeTypes.has(group.type))
      && (needle === '' || foldForSearch(group.value).includes(needle))
      && (!showKeptOnly || group.indices.some((index) => excludedIndices.has(index)))
      && (!showLowOnly || isLow(group.confidence))),
    [groups, activeTypes, needle, showKeptOnly, showLowOnly, excludedIndices],
  );
  // The bulk actions and the count line work in places, like the heading and the chips.
  // Under "Not redacted" only the places that are not redacted count: a value redacted in one of two
  // places used to show "2 places shown" under a chip that said 1.
  const shownPlaces = useMemo(
    () => rows.flatMap((group) => (showKeptOnly ? group.indices.filter((index) => excludedIndices.has(index)) : group.indices)),
    [rows, showKeptOnly, excludedIndices],
  );
  const shownRedacted = useMemo(() => shownPlaces.filter((index) => !excludedIndices.has(index)), [shownPlaces, excludedIndices]);
  const shownKept = useMemo(() => shownPlaces.filter((index) => excludedIndices.has(index)), [shownPlaces, excludedIndices]);

  const entryByOriginal = useMemo(() => new Map(entries.map((e) => [e.original, e])), [entries]);

  const toggleType = useCallback((type: EntityType) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const clearFilter = useCallback(() => {
    setTypeFilter(new Set());
    setQuery('');
    setKeptOnly(false);
    setLowOnly(false);
  }, []);
  /** Did this click come from the keyboard? (A pointer leaves the focus where it is.) */
  const fromKeyboard = (event: { detail: number }) => event.detail === 0;

  const toggleGroupOpen = useCallback((key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Undo only acts on the list it was offered for: after a new detection the indices mean other items.
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const textRef = useRef(text);
  textRef.current = text;
  // After a change of what is redacted the result text above the list changes length. Two things
  // must not move with it: the filter bar under the finger (measured: 205 px on a phone) and the
  // keyboard focus (the pressed button is gone; its opposite takes over, which is also the nearest Undo).
  const barRef = useRef<HTMLDivElement>(null);
  const keepButtonRef = useRef<HTMLButtonElement>(null);
  const redactButtonRef = useRef<HTMLButtonElement>(null);
  const allChipRef = useRef<HTMLButtonElement>(null);
  const neverNoteRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // The control last pressed in the list (a box of a row sits below the bar: when the bar grows by
  // a row of chips, it is the pressed box that must stay under the finger, measured 50 px on a phone).
  const pressedRef = useRef<Element | null>(null);
  const anchorBefore = useRef<{ bar: number | null; pressed: Element | null; pressedTop: number } | null>(null);
  const focusAfter = useRef<'keep' | 'redact' | 'all' | 'note' | null>(null);
  const holdBar = useCallback((row = false) => {
    const pressed = row && pressedRef.current?.isConnected ? pressedRef.current : null;
    anchorBefore.current = {
      bar: barRef.current?.getBoundingClientRect().top ?? null,
      pressed,
      pressedTop: pressed ? pressed.getBoundingClientRect().top : 0,
    };
  }, []);
  useLayoutEffect(() => {
    const before = anchorBefore.current;
    anchorBefore.current = null;
    if (before) {
      const delta = before.pressed?.isConnected
        ? before.pressed.getBoundingClientRect().top - before.pressedTop
        : before.bar !== null && barRef.current ? barRef.current.getBoundingClientRect().top - before.bar : 0;
      if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
    }
    const target = focusAfter.current;
    if (target === 'keep' || target === 'redact') {
      focusAfter.current = null;
      (target === 'keep' ? keepButtonRef : redactButtonRef).current?.focus({ preventScroll: true });
    }
  }, [excludedIndices]);
  // A control that removes itself hands the focus on, so a keyboard user is never dropped on the
  // page body: the offer to the note it turned into, the note's button and "Clear filter" to "All".
  useEffect(() => {
    const target = focusAfter.current;
    if (target !== 'all' && target !== 'note') return;
    focusAfter.current = null;
    const next = target === 'note' ? neverNoteRef.current?.querySelector('button') : allChipRef.current;
    (next ?? allChipRef.current)?.focus({ preventScroll: true });
  });

  // "Review the list" / "Show them" at the result: open the list, show the whole of it or what is
  // not redacted, and bring the bar into view.
  const revealNonce = reveal?.nonce;
  const revealKept = reveal?.kept ?? false;
  // Only a request made while this list is on screen counts: a list that mounts after a new
  // redaction must not jump to itself because of an old click.
  const handledReveal = useRef(revealNonce);
  useEffect(() => {
    if (revealNonce === undefined || revealNonce === handledReveal.current) return;
    handledReveal.current = revealNonce;
    setExpanded(true);
    setTypeFilter(new Set());
    setQuery('');
    setLowOnly(false);
    setKeptOnly(revealKept);
    // After the list has opened (its height animates from zero).
    // A long document puts the list tens of screens away: jump there, glide only when it is near.
    const timer = setTimeout(() => {
      const bar = barRef.current;
      if (!bar) return;
      const far = Math.abs(bar.getBoundingClientRect().top) > window.innerHeight * 1.5;
      bar.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'start' });
    }, 60);
    return () => clearTimeout(timer);
  }, [revealNonce, revealKept]);

  const togglePlace = useCallback((index: number) => {
    holdBar(true);
    onToggle(index);
  }, [holdBar, onToggle]);

  /** The box of a value: redact every place of it, or none (a mixed state resolves to "all"). */
  const toggleGroup = useCallback((group: ValueGroup) => {
    holdBar(true);
    const allRedacted = group.indices.every((index) => !excludedIndices.has(index));
    if (group.indices.length === 1) onToggle(group.indices[0]);
    else onSetExcluded(group.indices, allRedacted);
  }, [holdBar, excludedIndices, onToggle, onSetExcluded]);

  const setShown = useCallback((indices: number[], excluded: boolean) => {
    if (indices.length === 0) return;
    // Undo acts on these places, wherever they stand in the list by then: a value marked by hand
    // in between makes a new list, and the button used to do nothing then, without a word, with
    // the names still readable. Another text is another matter: there it does nothing.
    const source = textRef.current;
    const places = new Set(indices.map((index) => placeOf(entitiesRef.current[index])));
    holdBar();
    focusAfter.current = excluded ? 'redact' : 'keep';
    onSetExcluded(indices, excluded);
    showToast(excluded ? t.entityTable.keptToast(indices.length) : t.entityTable.redactedToast(indices.length), {
      label: t.toast.undo,
      onClick: () => {
        if (textRef.current !== source) return;
        const now = entitiesRef.current.map((entity, index) => (places.has(placeOf(entity)) ? index : -1)).filter((index) => index >= 0);
        if (now.length > 0) onSetExcluded(now, !excluded);
      },
    });
  }, [holdBar, onSetExcluded, showToast, t]);

  // Auto-expand when entities first appear (after redaction), reset when cleared
  useEffect(() => {
    if (entities.length > 0 && prevEntityCount.current === 0) {
      setExpanded(true);
    }
    if (entities.length === 0) {
      prevEntityCount.current = 0;
      // The next document starts with the whole list.
      setTypeFilter(new Set());
      setQuery('');
      setKeptOnly(false);
      setLowOnly(false);
      setOpenGroups(new Set());
    } else {
      prevEntityCount.current = entities.length;
    }
  }, [entities.length]);

  const startEditing = useCallback((key: string, layout: 'table' | 'card', currentLabel: string) => {
    setEditing({ key, layout });
    // Strip the current wrapper: typed/custom [X] or legacy <<X>>.
    const inner = currentLabel.startsWith('[') && currentLabel.endsWith(']')
      ? currentLabel.slice(1, -1)
      : currentLabel.startsWith('<<') && currentLabel.endsWith('>>')
        ? currentLabel.slice(2, -2)
        : currentLabel;
    setEditValue(inner);
  }, []);

  const commitEdit = useCallback(() => {
    const original = editing ? groups.find((group) => group.key === editing.key)?.value : undefined;
    // The brackets are added here: typed ones ("[CLIENT]") would give "[[CLIENT]]".
    const name = editValue.trim().replace(/^[[<\s]+|[\]>\s]+$/g, '');
    if (original && name) {
      onRenameLabel(original, `[${name}]`);
    }
    setEditing(null);
  }, [editing, groups, editValue, onRenameLabel]);

  // Enter or Escape in the rename field gives the focus back to the label it belongs to.
  const refocusLabel = useRef<string | null>(null);
  useEffect(() => {
    if (editing !== null || refocusLabel.current === null) return;
    const wanted = refocusLabel.current;
    refocusLabel.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLElement>('[data-rename]') ?? [];
    for (const button of buttons) {
      // The name carries the layout (table or card), so it is the one the user was in.
      if (button.dataset.rename === wanted) { button.focus({ preventScroll: true }); break; }
    }
  }, [editing]);

  const renderLabel = (group: ValueGroup, layout: 'table' | 'card') => {
    const entry = entryByOriginal.get(group.value);
    // No label: every place of the value is readable. Said in words, at full contrast: the state
    // that leaves data in the text must not be the faintest thing on screen.
    if (!entry) {
      return (
        <span className="inline-block px-1.5 py-0.5 font-sans font-medium text-[#111111] border border-[#8A6508] bg-[#F6EFD9]" data-testid="entity-kept-tag">
          {t.entityTable.keptChip}
        </span>
      );
    }
    const label = entry.replacement;
    if (editing !== null && editing.key === group.key && editing.layout === layout) {
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-[#525252]">[</span>
          <input
            autoFocus
            value={editValue}
            maxLength={40}
            aria-label={`${t.entityTable.clickToRename}: ${label}`}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== 'Escape') return;
              // The focus goes back to the label button while the key is still down: without this
              // the same Enter would press that button and open the field again.
              e.preventDefault();
              refocusLabel.current = `${layout}:${group.key}`;
              if (e.key === 'Enter') commitEdit();
              else setEditing(null);
            }}
            className="bg-[#E5E5E0] border border-[#111111] px-1.5 h-11 md:h-auto md:py-0.5 text-base md:text-xs font-mono text-[#111111] focus:outline-none focus:ring-1 focus:ring-[#111111]"
            // The padding and the border are inside the width: without them the first letter was cut off.
            style={{ width: `calc(${Math.max(editValue.length + 1, 5)}ch + 1rem)` }}
          />
          <span className="text-[#525252]">]</span>
        </span>
      );
    }
    // A real button: reachable with Tab, opened with Enter or Space (it was a click-only span).
    const renamed = onResetLabel !== undefined && (renamedValues?.has(group.value) ?? false);
    return (<>
      <button
        type="button"
        onClick={() => startEditing(group.key, layout, label)}
        className="inline-flex items-center min-h-11 md:min-h-0 md:py-1 font-mono text-left text-[#111111] cursor-pointer hover:text-[#CC0000] transition-colors underline decoration-dotted decoration-[#8A8A85] underline-offset-4"
        title={t.entityTable.clickToRename}
        aria-label={`${t.entityTable.clickToRename}: ${label}`}
        data-rename={`${layout}:${group.key}`}
      >
        {label}
      </button>
      {/* The way back from a renamed label (there was none: an emptied field kept the name). */}
      {renamed && (
        <button
          type="button"
          onClick={() => { refocusLabel.current = `${layout}:${group.key}`; onResetLabel?.(group.value); setEditing(null); }}
          aria-label={`${t.entityTable.resetLabel}: ${label}`}
          title={t.entityTable.resetLabel}
          data-testid="entity-label-reset"
          className="ml-1 inline-flex items-center justify-center min-h-11 min-w-11 md:min-h-6 md:min-w-6 align-middle text-[#525252] hover:text-[#111111] cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      )}
    </>);
  };

  /** Type badge: the colour is carried by the square and the tint, the word stays dark (4.5:1 and more). */
  const renderType = (type: EntityType) => (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium text-[#111111]"
      style={{ backgroundColor: ENTITY_COLORS[type] + '25' }}
    >
      <span className="w-2 h-2 shrink-0" style={{ backgroundColor: ENTITY_COLORS[type] }} aria-hidden="true" />
      {t.entityLabels[type]}
    </span>
  );

  /** State of a value's box: every place redacted, none, or some. */
  const groupState = (group: ValueGroup): boolean | 'indeterminate' => {
    const redacted = group.indices.filter((index) => !excludedIndices.has(index)).length;
    return redacted === group.indices.length ? true : redacted === 0 ? false : 'indeterminate';
  };

  // One stable name per box, "Redact: <value>": checked means redacted. (The name used to flip
  // with the state, so a screen reader said "Keep visible, checked" for a redacted value.)
  const groupBoxLabel = (group: ValueGroup) => `${t.entityTable.include}: ${group.value}`;

  /** "2 of 4 redacted" next to a value whose box shows a dash. */
  const renderPartly = (group: ValueGroup, state: boolean | 'indeterminate') => state === 'indeterminate' && (
    <span className="ml-2 font-sans text-xs font-medium text-[#111111] align-middle" data-testid="entity-group-partly">
      {t.entityTable.partly(group.indices.filter((index) => !excludedIndices.has(index)).length, group.indices.length)}
    </span>
  );

  const listId = useId();
  const placesId = (group: ValueGroup, layout: 'table' | 'card') => `${listId}-${layout}-${groups.indexOf(group)}`;

  /** The xN button of a repeated value: opens the list of its places. */
  const renderCount = (group: ValueGroup, open: boolean, layout: 'table' | 'card') => (
    <button
      type="button"
      onClick={() => toggleGroupOpen(group.key)}
      aria-expanded={open}
      aria-controls={open ? placesId(group, layout) : undefined}
      aria-label={group.indices.length > 1 ? t.entityTable.places(group.indices.length) : t.entityTable.showPlace}
      title={group.indices.length > 1 ? t.entityTable.places(group.indices.length) : t.entityTable.showPlace}
      data-testid={group.indices.length > 1 ? 'entity-group-count' : 'entity-group-where'}
      className="ml-2 inline-flex items-center justify-center gap-0.5 px-2.5 md:px-1.5 min-h-11 md:min-h-6 text-xs font-sans font-medium tabular-nums border border-[#C8C5BC] bg-white text-[#111111] hover:border-[#111111] cursor-pointer align-middle"
    >
      {group.indices.length > 1 && <>×{group.indices.length}</>}
      <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </button>
  );

  /** The places of a repeated value, each with the words around it and its own box. */
  const renderPlaces = (group: ValueGroup, layout: 'table' | 'card') => (
    <ul className="space-y-1 md:space-y-1.5" data-testid="entity-group-places" id={placesId(group, layout)}>
      {group.indices.map((index) => {
        const entity = entities[index];
        const excluded = excludedIndices.has(index);
        const inPlace = text.slice(entity.start, entity.end) === entity.value;
        const before = inPlace ? text.slice(Math.max(0, entity.start - CONTEXT_LENGTH), entity.start).replace(/\s+/g, ' ') : '';
        const after = inPlace ? text.slice(entity.end, entity.end + CONTEXT_LENGTH).replace(/\s+/g, ' ') : '';
        return (
          <li key={index} className="flex items-start gap-3 py-1 md:py-0">
            <Checkbox
              checked={!excluded}
              onCheckedChange={() => togglePlace(index)}
              aria-label={`${t.entityTable.include}: ${before}${entity.value}${after}`}
              className={`mt-0.5 ${BOX_HIT}`}
            />
            <p className="text-xs text-[#525252] leading-relaxed [overflow-wrap:anywhere] min-w-0 max-w-[100ch]">
              {entity.start > CONTEXT_LENGTH && inPlace ? '...' : ''}{before}
              <span className="font-mono text-[#111111] bg-[#E5E5E0]/60 px-0.5">{entity.value}</span>
              {after}{inPlace && entity.end + CONTEXT_LENGTH < text.length ? '...' : ''}
              <span className="ml-2 tabular-nums text-[#525252] whitespace-nowrap">{t.entityTable.confidence} {Math.round(entity.confidence * 100)}%</span>
            </p>
          </li>
        );
      })}
    </ul>
  );

  const singleType = activeTypes.size === 1 && needle === '' && !showKeptOnly && !showLowOnly ? [...activeTypes][0] : null;

  if (entities.length === 0) return null;

  return (
    <div className="mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between px-4 py-3 bg-[#111111] text-[#F9F9F7] cursor-pointer hover:bg-[#222222] transition-colors duration-150"
      >
        <div>
          <h3 className="label-meta text-[#F9F9F7] tracking-[0.15em]">
            {t.entityTable.title(entities.length)}
          </h3>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-[#F9F9F7] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
      <Card
        ref={listRef}
        className="overflow-hidden border-t-0 mt-0"
        onPointerDownCapture={(e) => { pressedRef.current = e.target as Element; }}
        onKeyDownCapture={(e) => { pressedRef.current = e.target as Element; }}
      >
        <div className="px-4 py-2.5 bg-[#E5E5E0]/20 border-b border-[#E5E5E0]">
          <p className="text-xs text-[#525252] leading-relaxed max-w-[85ch]">{t.entityTable.subtitle} {t.entityTable.certaintyHelp}</p>
        </div>
        {/* Filter + bulk actions (WLojek/DocCloak#4). Controls are 44 px tall on touch screens. */}
        <div
          ref={barRef}
          role="group"
          aria-label={t.entityTable.filterLabel}
          data-testid="entity-filter"
          className="px-4 py-3 border-b border-[#E5E5E0] space-y-2.5 scroll-mt-20"
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              ref={allChipRef}
              onClick={() => setTypeFilter(new Set())}
              aria-pressed={activeTypes.size === 0}
              className={`${CHIP} ${activeTypes.size === 0 ? CHIP_ON : CHIP_OFF}`}
            >
              {t.entityTable.allTypes} <span className="tabular-nums font-normal">{entities.length}</span>
            </button>
            {typeCounts.map(([type, count]) => {
              const on = activeTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  aria-pressed={on}
                  data-testid={`entity-filter-type-${type}`}
                  className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
                >
                  <span className="w-2 h-2" style={{ backgroundColor: ENTITY_COLORS[type] }} aria-hidden="true" />
                  {t.entityLabels[type]} <span className="tabular-nums font-normal">{count}</span>
                </button>
              );
            })}
            {/* What stays readable, as a filter of its own: one click lists it, one more redacts it again. */}
            {keptCount > 0 && (
              <button
                type="button"
                onClick={() => setKeptOnly((v) => !v)}
                aria-pressed={showKeptOnly}
                data-testid="entity-filter-kept"
                className={`${CHIP} md:ml-2 ${showKeptOnly ? CHIP_ON : 'border-[#111111] bg-white text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7]'}`}
              >
                {t.entityTable.keptChip} <span className="tabular-nums font-normal">{keptCount}</span>
              </button>
            )}
            {/* The finds the detector was least sure about (the amber and red bars), to check first. */}
            {lowCount > 0 && (
              <button
                type="button"
                onClick={() => setLowOnly((v) => !v)}
                aria-pressed={showLowOnly}
                data-testid="entity-filter-low"
                className={`${CHIP} ${showLowOnly ? CHIP_ON : CHIP_OFF}`}
              >
                <span className="w-2 h-2" style={{ backgroundColor: '#B8860B' }} aria-hidden="true" />
                {t.entityTable.lowChip} <span className="tabular-nums font-normal">{lowCount}</span>
              </button>
            )}
          </div>
          <div className="flex flex-col md:flex-row md:items-center gap-2.5">
            <div className="relative md:w-72">
              <Search className="w-3.5 h-3.5 text-[#525252] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.entityTable.filterPlaceholder}
                aria-label={t.entityTable.filterPlaceholder}
                className="w-full h-11 md:h-8 pl-8 pr-11 md:pr-9 text-base md:text-xs border border-[#C8C5BC] bg-white text-[#111111] placeholder:text-[#525252] focus:outline-none focus:border-[#111111] focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-1 [&::-webkit-search-cancel-button]:hidden"
              />
              {query !== '' && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={t.textInput.clear}
                  className="absolute right-0 top-0 h-full w-11 md:w-8 flex items-center justify-center text-[#525252] hover:text-[#111111] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* How much of the list is shown, and the lasting answer to "what leaves this document readable". */}
            <p className="text-xs text-[#525252] tabular-nums md:mr-auto" role="status" data-testid="entity-filter-count">
              {t.entityTable.showing(shownPlaces.length, entities.length)}
              <span aria-hidden="true"> · </span>
              <span className={keptCount > 0 ? 'text-[#111111] font-medium' : ''} data-testid="entity-filter-status">
                {t.entityTable.status(entities.length - keptCount, keptCount)}
              </span>
            </p>
            {/* The two actions exist only for a group the user narrowed down: without a filter one click
                would un-redact the whole document. */}
            {filtering ? (
              <div className="flex flex-wrap items-center gap-2">
                {shownRedacted.length > 0 && !showKeptOnly && (
                  <button
                    type="button"
                    ref={keepButtonRef}
                    onClick={() => setShown(shownRedacted, true)}
                    data-testid="entity-keep-shown"
                    className={BULK}
                  >
                    {t.entityTable.dontRedactThese(shownRedacted.length)}
                  </button>
                )}
                {shownKept.length > 0 && (
                  <button
                    type="button"
                    ref={redactButtonRef}
                    onClick={() => setShown(shownKept, false)}
                    data-testid="entity-redact-shown"
                    className={BULK}
                  >
                    {t.entityTable.redactThese(shownKept.length)}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-[#525252]" data-testid="entity-filter-hint">{t.entityTable.bulkHint}</p>
            )}
          </div>
          {/* T263: the same choice for the next documents. Offered where it is made (one type on
              screen), and always listed while it is in force, with a way out. */}
          {singleType && !keepTypes.includes(singleType) && (
            <button
              type="button"
              onClick={() => { focusAfter.current = 'note'; onKeepTypesChange([...keepTypes, singleType]); }}
              data-testid="entity-never-offer"
              className="inline-flex items-center min-h-11 md:min-h-6 text-left text-xs text-[#111111] leading-relaxed underline underline-offset-2 decoration-[#8A8A85] hover:decoration-[#111111] cursor-pointer"
            >
              {t.entityTable.neverOffer(t.entityLabels[singleType])}
            </button>
          )}
          {keepTypes.length > 0 && (
            <div ref={neverNoteRef} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border border-[#8A6508] bg-[#F6EFD9] px-3 py-2" data-testid="entity-never-note">
              <p className="text-xs text-[#111111] leading-relaxed">{t.entityTable.neverNote}</p>
              {keepTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={(e) => { if (fromKeyboard(e)) focusAfter.current = 'all'; onKeepTypesChange(keepTypes.filter((kept) => kept !== type)); }}
                  aria-label={t.entityTable.neverRemove(t.entityLabels[type])}
                  title={t.entityTable.neverRemove(t.entityLabels[type])}
                  className="inline-flex items-center gap-1.5 px-2.5 md:px-2 min-h-11 md:min-h-6 text-xs font-medium border border-[#111111] bg-white text-[#111111] hover:bg-[#111111] hover:text-[#F9F9F7] transition-colors cursor-pointer"
                >
                  {t.entityLabels[type]}
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </div>
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center" data-testid="entity-filter-empty">
            <p className="text-xs text-[#525252]">{t.entityTable.noMatches}</p>
            <button
              type="button"
              onClick={(e) => { if (fromKeyboard(e)) focusAfter.current = 'all'; clearFilter(); }}
              className="mt-1 inline-flex items-center min-h-11 md:min-h-8 px-3 text-xs text-[#111111] underline underline-offset-2 cursor-pointer"
            >
              {t.entityTable.clearFilter}
            </button>
          </div>
        )}
        {rows.length > 0 && (<>
        {/* Desktop table */}
        <table className="w-full text-sm hidden md:table" aria-label={t.entityTable.title(entities.length)}>
          <thead>
            <tr className="border-b border-[#E5E5E0] bg-[#E5E5E0]/30">
              <th scope="col" className="text-left p-3 label-meta text-[#525252]">{t.entityTable.type}</th>
              <th scope="col" className="text-left p-3 label-meta text-[#525252]">{t.entityTable.label}</th>
              <th scope="col" className="text-left p-3 label-meta text-[#525252]">{t.entityTable.originalValue}</th>
              <th scope="col" className="text-left p-3 label-meta text-[#525252]">{t.entityTable.confidence}</th>
              <th scope="col" className="text-center p-3 label-meta text-[#525252]">{t.entityTable.include}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((group) => {
              const state = groupState(group);
              const open = openGroups.has(group.key);
              return [
                <tr
                  key={group.key}
                  data-count={group.indices.length}
                  data-state={state === true ? 'redacted' : state === false ? 'kept' : 'mixed'}
                  className={`border-b border-[#E5E5E0] hover:bg-[#E5E5E0]/20 transition-colors ${open ? '' : 'last:border-0'}`}
                >
                  <td className="p-3">{renderType(group.type)}</td>
                  <td className="p-3 text-[#525252] text-xs font-mono">{renderLabel(group, 'table')}</td>
                  <td className="p-3 text-foreground font-mono text-xs">
                    <span className="[overflow-wrap:anywhere]">{group.value}</span>
                    {renderCount(group, open, 'table')}
                    {renderPartly(group, state)}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-14 bg-[#E5E5E0] h-1.5 overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{ width: `${Math.round(group.confidence * 100)}%`, backgroundColor: confidenceColor(group.confidence) }}
                        />
                      </div>
                      <span className="text-xs text-[#525252] tabular-nums">{Math.round(group.confidence * 100)}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-center">
                    <Checkbox
                      checked={state}
                      onCheckedChange={() => toggleGroup(group)}
                      aria-label={groupBoxLabel(group)}
                      className={BOX_HIT}
                    />
                  </td>
                </tr>,
                open && (
                  <tr key={`${group.key}-places`} className="border-b border-[#E5E5E0] last:border-0 bg-[#F4F3EE]">
                    <td colSpan={5} className="px-3 py-3 pl-12">{renderPlaces(group, 'table')}</td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>

        {/* Mobile card layout */}
        <div className="md:hidden divide-y divide-[#E5E5E0]">
          {rows.map((group) => {
            const state = groupState(group);
            const open = openGroups.has(group.key);
            return (
              <div key={`m-${group.key}`} className="p-3 space-y-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    {renderType(group.type)}
                    <span className="ml-auto mr-3 text-xs text-[#525252]" aria-hidden="true">{t.entityTable.include}</span>
                    <Checkbox
                      checked={state}
                      onCheckedChange={() => toggleGroup(group)}
                      aria-label={groupBoxLabel(group)}
                      className={`mr-1 ${BOX_HIT}`}
                    />
                  </div>
                  <div className="text-xs font-mono text-foreground [overflow-wrap:anywhere]">
                    {group.value}
                    {renderCount(group, open, 'card')}
                    {renderPartly(group, state)}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-[#525252]">{renderLabel(group, 'card')}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-10 bg-[#E5E5E0] h-1.5 overflow-hidden">
                        <div
                          className="h-full"
                          style={{ width: `${Math.round(group.confidence * 100)}%`, backgroundColor: confidenceColor(group.confidence) }}
                        />
                      </div>
                      <span className="text-xs text-[#525252] tabular-nums">{t.entityTable.confidence} {Math.round(group.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>
                {open && <div className="bg-[#F4F3EE] px-2 py-2">{renderPlaces(group, 'card')}</div>}
              </div>
            );
          })}
        </div>
        </>)}
      </Card>
        </div>
      </div>
    </div>
  );
}
