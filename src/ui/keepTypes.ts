// Types that are never anonymized (WLojek/DocCloak#4, T263): a choice made once, before detection,
// that holds for the next documents too. Stored like the dictionary and the ignore list: a small
// list in localStorage, on this device only. The items of such a type stay in the list of
// detections, shown as not redacted, so the choice is visible in every document it applies to.
import type { EntityType } from '@doccloak/core';
import { ENTITY_COLORS } from '@doccloak/core';

export const KEEP_TYPES_STORAGE_KEY = 'doccloak-keep-types';

/** Every entity type the app knows, in the order the picker shows them. */
export const ALL_ENTITY_TYPES = Object.keys(ENTITY_COLORS) as EntityType[];

const KNOWN = new Set<string>(ALL_ENTITY_TYPES);

/** The stored list; anything unreadable or unknown is ignored (an empty list is the safe reading). */
export function loadKeepTypes(): EntityType[] {
  try {
    const raw = localStorage.getItem(KEEP_TYPES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return ALL_ENTITY_TYPES.filter((type) => parsed.includes(type));
  } catch {
    return [];
  }
}

export function saveKeepTypes(types: readonly EntityType[]): void {
  const clean = ALL_ENTITY_TYPES.filter((type) => types.includes(type) && KNOWN.has(type));
  try {
    if (clean.length === 0) localStorage.removeItem(KEEP_TYPES_STORAGE_KEY);
    else localStorage.setItem(KEEP_TYPES_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Storage unavailable (private mode): the choice lasts for this visit only.
  }
}

// Reminder to save the replacement table before the tab closes (T261). 'off' = never remind.
export const TABLE_REMINDER_STORAGE_KEY = 'doccloak-table-reminder';

export function isTableReminderOff(): boolean {
  try {
    return localStorage.getItem(TABLE_REMINDER_STORAGE_KEY) === 'off';
  } catch {
    return false;
  }
}

export function setTableReminderOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(TABLE_REMINDER_STORAGE_KEY, 'off');
    else localStorage.removeItem(TABLE_REMINDER_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing to remember.
  }
}
