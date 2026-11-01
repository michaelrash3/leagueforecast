import { useCallback, useMemo, useSyncExternalStore } from "react";
import { isGcIds, type ClubLookup } from "./teamRankings/leagueBridge";
import { shownClubId } from "./teamRankings/rememberedClub";

/*
 * The clubs a reader keeps an eye on, a few to a page (the owner's choice of 26 October 2026: per
 * page, up to five, a card at the top of that board). Kept on this device alone, never in the
 * cloud copy: what one device watches is nobody else's business and costs the cloud nothing.
 *
 * Each club is kept with its name as it was watched, so a club with no row on the board on screen
 * (the other half of the season, or a club since taken off) is still named on the card, and with
 * GameChanger ids it carried, where it had any (`keptGcIds`): a club's id here is the pool's own,
 * and a fold or Start again can leave it naming another club. Read by them (`watchedNow`), a club
 * folded into another is watched as that club, and one whose id is another's now is shown gone.
 */

/** The most clubs a page's card holds. */
export const WATCH_MAX = 5;

const KEY = "lf_watch_v1";

export type Watched = { id: string; name: string; gc?: string[] };
type Store = Record<string, Watched[]>;

const isWatched = (value: unknown): value is Watched =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).id === "string" &&
  typeof (value as Record<string, unknown>).name === "string" &&
  ((value as Record<string, unknown>).gc === undefined ||
    isGcIds((value as Record<string, unknown>).gc));

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

/** The clubs watched on a page, in the order they were watched, as kept. */
export const watchedOn = (pageId: string): Watched[] => store()[pageId] ?? NONE;

/**
 * The clubs watched on a page as `lookup` reads them (`shownClubId`): each under the id of the club
 * it is now, followed or shown gone, and two folded into one club once. The same list where none
 * moved, and as kept with nothing to read them by.
 */
export const watchedNow = (
  list: readonly Watched[],
  lookup: ClubLookup | null
): readonly Watched[] => {
  if (!lookup || !list.some((one) => one.gc?.length)) return list;
  const seen = new Set<string>();
  const shown: Watched[] = [];
  let changed = false;
  for (const one of list) {
    const id = shownClubId(one, lookup);
    if (seen.has(id)) {
      changed = true;
      continue;
    }
    seen.add(id);
    changed ||= id !== one.id;
    shown.push(id === one.id ? one : { ...one, id });
  }
  return changed ? shown : list;
};

/**
 * Watches a club on a page, or stops watching it: every club kept that `lookup` shows under its
 * id, so a club followed or shown gone stops as it is shown. A sixth is refused (false): the card
 * is a glance, and the owner's limit is five.
 */
export const toggleWatch = (
  pageId: string,
  club: Watched,
  lookup: ClubLookup | null = null
): boolean => {
  const list = watchedOn(pageId);
  // By the id each is shown under alone: one shown gone keeps the id now another club's, and
  // watching that club is not stopping it.
  const kept = list.filter((one) => shownClubId(one, lookup) !== club.id);
  if (kept.length < list.length) {
    write({ ...store(), [pageId]: kept });
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

/**
 * A page's watched clubs, drawn again whenever they change, here or in another tab, each as the
 * clubs `lookup` knows read it (`watchedNow`): the device's own pool, or what a member's device
 * holds of the clubs.
 */
export const useWatchList = (pageId: string, lookup: ClubLookup | null = null) => {
  const kept = useSyncExternalStore(
    subscribe,
    () => watchedOn(pageId),
    () => NONE
  );
  const watched = useMemo(() => watchedNow(kept, lookup), [kept, lookup]);
  const toggle = useCallback(
    (club: Watched) => toggleWatch(pageId, club, lookup),
    [pageId, lookup]
  );
  return { watched, toggle, full: kept.length >= WATCH_MAX };
};
