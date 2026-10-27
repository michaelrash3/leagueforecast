import { useCallback, useSyncExternalStore } from "react";

/*
 * The clubs a reader keeps an eye on, a few to a page (the owner's choice of 26 October 2026: per
 * page, up to five, a card at the top of that board). Kept on this device alone, never in the
 * cloud copy: what one device watches is nobody else's business and costs the cloud nothing.
 *
 * Each club is kept with its name as it was watched, so a club with no row on the board on screen
 * (the other half of the season, or a club since taken off) is still named on the card.
 */

/** The most clubs a page's card holds. */
export const WATCH_MAX = 5;

const KEY = "lf_watch_v1";

export type Watched = { id: string; name: string };
type Store = Record<string, Watched[]>;

const isWatched = (value: unknown): value is Watched =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).id === "string" &&
  typeof (value as Record<string, unknown>).name === "string";

const read = (): Store => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const store: Store = {};
    for (const [page, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) store[page] = list.filter(isWatched).slice(0, WATCH_MAX);
    }
    return store;
  } catch {
    return {};
  }
};

const listeners = new Set<() => void>();
/** The store as last read, so every reader of one page is handed the same array until it moves. */
let cached: Store | null = null;
const store = (): Store => (cached ??= read());

const write = (next: Store): void => {
  cached = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* kept for this visit only, where storage will not take it */
  }
  listeners.forEach((heard) => heard());
};

const NONE: Watched[] = [];

/** The clubs watched on a page, in the order they were watched. */
export const watchedOn = (pageId: string): Watched[] => store()[pageId] ?? NONE;

/**
 * Watches a club on a page, or stops watching it. A sixth is refused (false): the card is a
 * glance, and the owner's limit is five.
 */
export const toggleWatch = (pageId: string, club: Watched): boolean => {
  const list = watchedOn(pageId);
  if (list.some((one) => one.id === club.id)) {
    write({ ...store(), [pageId]: list.filter((one) => one.id !== club.id) });
    return true;
  }
  if (list.length >= WATCH_MAX) return false;
  write({ ...store(), [pageId]: [...list, club] });
  return true;
};

/** Only for tests: forgets what was read, so the next read is storage's. */
export const forgetWatchList = (): void => {
  cached = null;
};

const subscribe = (heard: () => void) => {
  listeners.add(heard);
  const fromAnotherTab = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cached = null;
    heard();
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(heard);
    window.removeEventListener("storage", fromAnotherTab);
  };
};

/** A page's watched clubs, drawn again whenever they change, here or in another tab. */
export const useWatchList = (pageId: string) => {
  const watched = useSyncExternalStore(
    subscribe,
    () => watchedOn(pageId),
    () => NONE
  );
  const toggle = useCallback((club: Watched) => toggleWatch(pageId, club), [pageId]);
  return { watched, toggle, full: watched.length >= WATCH_MAX };
};
