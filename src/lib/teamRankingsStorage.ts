import {
  isPlaceholderName,
  type AgeGroup,
  type GcTeamLink,
  type ScoutGame,
  type ScoutGameSource,
  type ScoutTeam,
} from "./teamRankings";
import { isNumber, isRecord, isString } from "./validate";
import { coercePullProgress, type GcPullProgress } from "./gameChangerPull";
import type { RefreshLog } from "./gameChangerSchedule";
import { PULL_TRACKER_VERSION, type PullRunLog } from "./pullTracker";
import { coerceAgeUnknown, type AgeUnknownList } from "./ageUnknown";
import {
  archiveEntryOf,
  coerceArchivedSeason,
  withUniqueIds,
  type ArchivedSeason,
  type ArchiveEntry,
} from "./teamRankingsArchive";
import { idbGet, idbKeys, idbSet, openPoolDb } from "./idb";
import {
  listenForLocalPoolWrites,
  openPoolBroadcast,
  SILENT_BROADCAST,
  type PoolBroadcast,
} from "./poolSync";
import {
  decodeScoutGames,
  decodeScoutTeams,
  encodeScoutGames,
  encodeScoutTeams,
} from "./teamRankingsCompact";

/**
 * Team Rankings persistence is intentionally separate from `storage.ts`'s season-namespaced
 * layout: this is a single global pool, not scoped to any one League Standings season — age groups
 * are the only scoping concept here, and one age group can bundle several League Standings seasons.
 */
const TEAMS_KEY = "league_forecast_scout_teams_v1";
const GAMES_KEY = "league_forecast_scout_games_v1";
const AGE_GROUPS_KEY = "league_forecast_scout_age_groups_v1";
/** Where an interrupted GameChanger pull keeps its place. Its own key, so clearing it never touches the pool. */
const GC_PULL_KEY = "league_forecast_gc_pull_v1";
/** When each age level last had its turn in the weekly rotation. */
const GC_REFRESH_KEY = "league_forecast_gc_refresh_v1";
/** The shape of the pool the last time it was tidied, so a load can tell whether it needs to be. */
const GC_TIDY_KEY = "league_forecast_gc_tidy_v1";
/**
 * The last pull's own record of itself — a row per team asked for, and the run's totals.
 *
 * Its own key, written independently of the pool, because it is the largest thing here after the
 * games and the one thing that must never be the reason a run stops. A refused pool save aborts
 * the pull; a refused record is a blank cell in a file.
 */
const GC_TRACK_KEY = "league_forecast_gc_track_v1";
/**
 * The teams GameChanger answered for and nobody could age.
 *
 * Kept because they are in no other list: the fetch worked, so they are not failures, and they are
 * on no page, so the weekly rotation never walks over them. Without this they are simply gone.
 */
const GC_AGELESS_KEY = "league_forecast_gc_ageless_v1";
/**
 * The list of finished seasons kept as tables — names, dates and counts, no rows.
 *
 * In the pool's keys because it is small and because everything that walks them should find it: a
 * reset that left the index behind would list archives whose rows it had just deleted.
 */
const GC_ARCHIVE_KEY = "league_forecast_scout_archive_v1";
/**
 * One archived season's rows, a key each.
 *
 * Emphatically *not* in `POOL_KEYS`, and that is the whole design. A season is a hundred thousand
 * rows; loading every archive at startup would put back exactly the memory the archiving was for.
 * So the index loads with the pool and the rows load when somebody asks to see them — which is
 * also why these go through `putBlob`/`getBlob` below rather than `readValue`/`writeValue`, and
 * are never broadcast. A cached, cross-tab-synced blob is a blob in every tab.
 */
const ARCHIVE_ROWS_PREFIX = "league_forecast_scout_archive_rows_v1:";
const archiveRowsKey = (id: string): string => `${ARCHIVE_ROWS_PREFIX}${id}`;
/**
 * A crumb left in localStorage once the pool has moved into IndexedDB. Tiny on purpose: it is the
 * only way a later session can tell "this browser has no IndexedDB" from "this browser's pool is
 * in IndexedDB and it would not open today", which are the same silence and very different facts.
 */
const MIGRATED_KEY = "league_forecast_pool_in_idb_v1";

/**
 * Where the pool actually lives.
 *
 * The compact format stretched `localStorage` to something like fourteen thousand teams; past that
 * there is nowhere to put it, and IndexedDB is where a browser keeps anything of size. The catch
 * is that IndexedDB is asynchronous and this app reads its pool during render, so the values are
 * cached in memory — filled once by `initTeamRankingsStore` — and reads answer from the cache
 * while writes go out behind them.
 *
 * A browser with no IndexedDB, or one that refuses it, never sets `usingIdb` and everything below
 * behaves exactly as it did: straight to `localStorage`, synchronously. That is also what happens
 * in tests, which is why none of them had to change.
 */
const cache = new Map<string, unknown>();
/** The pool decoded from the cache's compact form, once per version of it; see `loadScoutTeams`. */
let decodedTeams: { source: unknown; teams: ScoutTeam[] } | null = null;
let decodedGames: { source: unknown; games: ScoutGame[] } | null = null;
let usingIdb = false;
/**
 * The pool is known to live in IndexedDB and IndexedDB would not open. Reads answer empty because
 * there is nothing to answer with, and writes refuse rather than going to a localStorage the
 * migration emptied — a write accepted here would be stranded where nothing will ever read it.
 */
let poolUnavailable = false;

/** Whether this session is looking at a pool it cannot reach. The app says so; nothing else can. */
export const isPoolUnavailable = (): boolean => poolUnavailable;

let reportWriteError: ((key: string) => void) | null = null;

/**
 * Called when a write that had already been reported as saved turns out not to have landed. The
 * app shows it; nothing else can, because by then the caller has long returned.
 */
export const onPoolWriteError = (handler: ((key: string) => void) | null): void => {
  reportWriteError = handler;
};

/**
 * Told when another tab changes the pool, so a view holding it in component state can read it
 * again. Nothing here re-renders anything; it only says the thing you are holding is old now.
 */
const poolListeners = new Set<() => void>();

/**
 * Subscribes to changes made by *other* tabs. Returns the unsubscribe.
 *
 * Deliberately not called for this tab's own writes: the caller made those and already has the
 * value, and telling it would only send it back through its own state for no reason.
 */
export const onPoolChangedElsewhere = (handler: () => void): (() => void) => {
  poolListeners.add(handler);
  return () => {
    poolListeners.delete(handler);
  };
};

const announceChange = () => {
  poolListeners.forEach((handler) => {
    // One listener that throws must not stop the others hearing about it.
    try {
      handler();
    } catch {
      /* a view that cannot cope with a refresh is not this module's problem */
    }
  });
};

/** How this tab tells the others. Set up by `initTeamRankingsStore`; silent until then. */
let broadcast: PoolBroadcast = SILENT_BROADCAST;
/**
 * The store this session is actually talking to, fixed once at startup.
 *
 * Every read and write below goes through it rather than calling IndexedDB directly, so standing
 * in for the store in a test stands in for all of it and not merely for the migration.
 */
let activeIo: PoolStoreIo | null = null;
let stopLocalListener: (() => void) | null = null;

/**
 * Another tab changed a key. On IndexedDB the cache is now wrong, so it is re-read before anyone
 * is told — a listener that reads during the notification must get the new value, not the old one.
 */
export const notePoolChangedElsewhere = async (key: string): Promise<void> => {
  /*
   * Only the pool's own keys, matching what the localStorage listener already filters on. An
   * archived season's rows live in a key of their own and are never broadcast, but a key this
   * version does not recognise — a newer tab's, a blob's — must not be pulled into the cache
   * either: the cache holds what every tab keeps in memory for as long as the tab is open, and
   * load-on-demand means nothing if hearing about a write is enough to load it.
   */
  if (key && !POOL_KEYS.includes(key)) return;
  if (usingIdb && key) cache.set(key, await (activeIo ?? browserIo).get(key));
  announceChange();
};

/** Only for tests and for starting over: drops the listeners and closes the channel. */
export const resetPoolSync = (): void => {
  poolListeners.clear();
  broadcast.close();
  broadcast = SILENT_BROADCAST;
  stopLocalListener?.();
  stopLocalListener = null;
};

/**
 * Writes are coalesced per key. A pull saves the whole pool every twenty-five teams, and each save
 * supersedes the last — queueing them all would mean writing the same growing value a hundred
 * times over.
 */
const pendingWrites = new Map<string, unknown>();
let flushing = false;

/** Whether everything queued since the last check actually landed. */
let landed = true;

const flushWrites = async (): Promise<void> => {
  if (flushing) return;
  flushing = true;
  try {
    while (pendingWrites.size > 0) {
      const batch = [...pendingWrites.entries()];
      pendingWrites.clear();
      for (const [key, value] of batch) {
        const ok = await (activeIo ?? browserIo).set(key, value);
        if (ok) continue;
        landed = false;
        // A handler that throws must not take the rest of the batch down with it.
        try {
          reportWriteError?.(key);
        } catch {
          /* the report is a courtesy; the writes are the job */
        }
      }
    }
  } finally {
    flushing = false;
  }
};

/**
 * Waits for everything queued to actually reach the store, and says whether it did.
 *
 * `writeValue` can only report that a write was *accepted*, since the transaction has not finished
 * when the caller returns. Anything that must not act on an acknowledgement — a pull advancing its
 * cursor past teams it believes are saved — waits here first.
 */
export const flushPoolWrites = async (): Promise<boolean> => {
  if (!usingIdb) return !poolUnavailable;
  // Whoever is already flushing will drain the queue; wait for it to be empty and idle.
  while (pendingWrites.size > 0 || flushing) {
    await flushWrites();
    if (pendingWrites.size > 0 || flushing) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const ok = landed;
  landed = true;
  return ok;
};

const safeGet = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const safeSet = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};
const safeRemove = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    /* a storage that will not forget is not worth failing over */
  }
};
const parseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** The keys the pool is made of. The cursor rides along; it is small and belongs with them. */
const POOL_KEYS = [
  TEAMS_KEY,
  GAMES_KEY,
  AGE_GROUPS_KEY,
  GC_PULL_KEY,
  GC_REFRESH_KEY,
  GC_TIDY_KEY,
  GC_TRACK_KEY,
  GC_AGELESS_KEY,
  GC_ARCHIVE_KEY,
];

/**
 * A stored value. From the cache once the store has been opened, and straight off `localStorage`
 * before that or where IndexedDB is not to be had — so a read is always answerable, and always
 * synchronous.
 */
const readValue = (key: string): unknown => {
  // The pool is in a store this session cannot open. There is nothing to answer with, and reading
  // the localStorage the migration emptied would answer "empty" as though that were the truth.
  if (poolUnavailable) return null;
  // Without IndexedDB there is nothing to cache *for*: localStorage is already synchronous, and a
  // cache in front of it could only go stale against a write from another tab.
  if (!usingIdb) return parseJson(safeGet(key));
  return cache.get(key) ?? null;
};

/**
 * Writes a value. On IndexedDB this returns whether the write was *accepted* — the cache has it
 * and it is queued — because the transaction has not finished yet and the caller cannot wait. A
 * write that then fails is reported through `onPoolWriteError`. On `localStorage` it is the old
 * answer: whether it actually landed.
 */
const writeValue = (key: string, value: unknown): boolean => {
  // Refused rather than written somewhere nothing will read it back.
  if (poolUnavailable) return false;
  // On localStorage the browser raises `storage` in every other tab by itself, so there is nothing
  // to send: the value is already shared and the notification comes free.
  if (!usingIdb) return safeSet(key, JSON.stringify(value));
  cache.set(key, value);
  pendingWrites.set(key, value);
  void flushWrites();
  // Announced on acceptance rather than after the flush. A tab told a moment early re-reads and
  // finds either the new value or the old one; a tab told late can have written over it by then.
  broadcast.post(key);
  return true;
};

const forgetValue = (key: string): void => {
  if (!usingIdb) {
    safeRemove(key);
    return;
  }
  cache.set(key, null);
  pendingWrites.set(key, null);
  void flushWrites();
  broadcast.post(key);
};

/**
 * Opens the pool's store and fills the cache, once, before the app reads anything. Everything
 * already in `localStorage` moves across the first time, and is cleared afterwards — leaving a
 * copy behind would go on occupying the very quota this was done to escape.
 *
 * Never throws and never blocks the app: a browser without IndexedDB, or one that refuses it,
 * simply carries on using `localStorage`.
 */
/** The store's dealings with the outside world, gathered so a test can stand in for them. */
export type PoolStoreIo = {
  keys: () => Promise<string[]>;
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<boolean>;
  readLocal: (key: string) => unknown;
  clearLocal: (key: string) => void;
};

const browserIo: PoolStoreIo = {
  keys: idbKeys,
  get: idbGet,
  set: idbSet,
  readLocal: (key) => parseJson(safeGet(key)),
  clearLocal: safeRemove,
};

/**
 * Moves the pool into the store and reads it back, or reports that it could not.
 *
 * Migration is all-or-nothing on purpose. A value that will not write means the whole move is
 * abandoned with `localStorage` untouched — a pool half in one store and half in another is worse
 * than one that never moved. The old copies are only dropped once every value is known to be in
 * the new store, and dropping them matters: leaving them behind would go on occupying the very
 * quota this was done to escape.
 */
export const fillPoolCache = async (io: PoolStoreIo): Promise<Map<string, unknown>> => {
  const existing = new Set(await io.keys());

  for (const key of POOL_KEYS) {
    // Already carried across; localStorage has nothing to say about it.
    if (existing.has(key)) continue;
    const raw = io.readLocal(key);
    if (raw === null || raw === undefined) continue;
    // Cleared only once the store has it, so a key is never in neither place. A key that will not
    // write stays in localStorage and is tried again next time.
    if (await io.set(key, raw)) io.clearLocal(key);
  }

  /*
   * Read together rather than one after another. These keys are independent, and this runs on the
   * startup path — `main.tsx` waits on it before anything mounts — so serial reads made the wait
   * the sum of every key rather than the slowest one. The migration above stays serial: it writes,
   * and a key is only cleared from localStorage once the store has confirmed it.
   */
  const values = await Promise.all(POOL_KEYS.map((key) => io.get(key)));
  const filled = new Map<string, unknown>();
  POOL_KEYS.forEach((key, at) => {
    // A key that could not be carried is still readable where it is, so a failed move costs
    // nothing but a retry — rather than hiding data that is sitting in localStorage.
    filled.set(key, values[at] ?? io.readLocal(key));
  });
  return filled;
};

/**
 * Opens the pool's store and fills the cache, once, before the app reads anything.
 *
 * Never throws and never blocks the app: a browser without IndexedDB, or one that refuses it,
 * simply carries on using `localStorage`.
 */
export const initTeamRankingsStore = async (io?: PoolStoreIo): Promise<void> => {
  if (!io && !(await openPoolDb())) {
    /*
     * No store. Which of two very different things that is depends on whether this pool has ever
     * been moved: a browser that never had IndexedDB still has its pool in localStorage and is
     * fine, while one whose pool was moved is looking at a localStorage the migration emptied.
     * Falling through silently there shows an empty pool and accepts edits nothing will keep.
     */
    if (safeGet(MIGRATED_KEY)) poolUnavailable = true;
    return;
  }
  try {
    activeIo = io ?? browserIo;
    const filled = await fillPoolCache(activeIo);
    filled.forEach((value, key) => cache.set(key, value));
    usingIdb = true;
    if (!io) safeSet(MIGRATED_KEY, "1");
  } catch {
    // Anything unexpected leaves `usingIdb` false, which is the working localStorage path.
  }
  startPoolSync();
};

/**
 * Starts hearing from the other tabs. Both paths are wired up because which one is in use is
 * decided per browser, not per build: IndexedDB needs a channel of its own, since its values are
 * cached per tab, and localStorage needs only the `storage` event the browser already sends.
 */
const startPoolSync = (): void => {
  broadcast = openPoolBroadcast((key) => void notePoolChangedElsewhere(key)) ?? SILENT_BROADCAST;
  stopLocalListener = listenForLocalPoolWrites(
    () => announceChange(),
    (key) => POOL_KEYS.includes(key)
  );
};

/**
 * Empties Team Rankings outright: every age group, every team, every game, the cursor an
 * interrupted GameChanger pull left behind and the weekly rotation's log. Afterwards this browser
 * is in the state of one that has never opened Team Rankings.
 *
 * It walks `POOL_KEYS` rather than naming the five keys again, so a key added to the pool later is
 * cleared by this too — a reset that quietly left one key behind would be worse than no reset at
 * all. League Standings lives in its own season-namespaced keys (see `storage.ts`) and is not
 * touched, and neither is the crumb that records the pool has moved into IndexedDB: where the pool
 * lives is not part of what the pool holds.
 *
 * `false` means the pool is in a store this session cannot reach, so nothing was cleared and the
 * data is still there — the caller must say so rather than reporting an empty pool as a reset one.
 */
export const clearTeamRankings = (): boolean => {
  if (poolUnavailable) return false;
  /*
   * The archived rows first, and by the index, because they are the one thing here that does not
   * live in a pool key: a reset that walked `POOL_KEYS` alone would drop the list of archives and
   * leave their rows in the store with nothing naming them — megabytes nothing will ever read or
   * be able to find again. Read the list before it goes.
   */
  const archived = loadArchiveIndex();
  POOL_KEYS.forEach((key) => forgetValue(key));
  archived.forEach((entry) => void dropBlob(archiveRowsKey(entry.id)));
  return true;
};

/** Only for tests: forgets the cache and goes back to reading storage directly. */
export const resetTeamRankingsStore = (): void => {
  cache.clear();
  // The decoded copies would invalidate themselves on the next read - a cleared cache answers null,
  // which is never the identity they hold - but a reset should not keep a pool's worth of objects
  // alive until somebody happens to ask.
  decodedTeams = null;
  decodedGames = null;
  pendingWrites.clear();
  usingIdb = false;
  poolUnavailable = false;
  landed = true;
  activeIo = null;
  resetPoolSync();
};

/** A string with something in it — an id made of whitespace identifies nothing. */
const isFilledString = (value: unknown): value is string => isString(value) && value.trim() !== "";

const coerceGcRecord = (raw: unknown): GcTeamLink["record"] | undefined =>
  isRecord(raw) && isNumber(raw.win) && isNumber(raw.loss) && isNumber(raw.tie)
    ? { win: raw.win, loss: raw.loss, tie: raw.tie }
    : undefined;

/**
 * One GameChanger link, or null when it cannot be one. The three ids are what a link *is* — the
 * GameChanger team, what it is called there, and the page its schedule is filed under — so a link
 * missing any of them is dropped. Everything else is what GameChanger said last time and is kept
 * only when it is the right shape; a bad record or a numeric season loses that field, not the link.
 */
export const coerceGcTeamLink = (raw: unknown): GcTeamLink | null => {
  if (!isRecord(raw)) return null;
  if (!isFilledString(raw.teamId) || !isString(raw.name) || !isFilledString(raw.ageGroupId)) {
    return null;
  }
  const record = coerceGcRecord(raw.record);
  return {
    teamId: raw.teamId,
    name: raw.name,
    ageGroupId: raw.ageGroupId,
    ...(isString(raw.season) ? { season: raw.season } : {}),
    ...(isNumber(raw.seasonYear) ? { seasonYear: raw.seasonYear } : {}),
    ...(isNumber(raw.ageLevel) ? { ageLevel: raw.ageLevel } : {}),
    ...(isString(raw.avatarKey) ? { avatarKey: raw.avatarKey } : {}),
    ...(record ? { record } : {}),
    ...(isString(raw.importedAt) ? { importedAt: raw.importedAt } : {}),
  };
};

/** The usable links out of a stored list; anything that is not a list yields none. */
export const coerceGcTeamLinks = (raw: unknown): GcTeamLink[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const link = coerceGcTeamLink(entry);
    return link ? [link] : [];
  });
};

/**
 * Where a game came from, when the stored shape says GameChanger. Anything else — an unknown
 * kind, a missing id — reads as no source, which turns the game back into a typed-in one rather
 * than losing it: the result is still real even if its provenance is not.
 */
const coerceGameSource = (raw: unknown): ScoutGameSource | undefined =>
  isRecord(raw) &&
  raw.kind === "gamechanger" &&
  isFilledString(raw.teamId) &&
  isFilledString(raw.gameId)
    ? { kind: "gamechanger", teamId: raw.teamId, gameId: raw.gameId }
    : undefined;

export const coerceScoutTeams = (raw: unknown): ScoutTeam[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) && isString(entry.id) && isString(entry.name)
    )
    .map((entry) => {
      // Malformed links are dropped one at a time; the team itself is never lost over one.
      const gcTeams = coerceGcTeamLinks(entry.gcTeams);
      return {
        id: entry.id as string,
        name: entry.name as string,
        ...(entry.isMine === true ? { isMine: true } : {}),
        ...(isString(entry.state) ? { state: entry.state } : {}),
        ...(isString(entry.city) ? { city: entry.city } : {}),
        ...(entry.placeholder === true ? { placeholder: true as const } : {}),
        ...(gcTeams.length ? { gcTeams } : {}),
      };
    });
};

export const coerceScoutGames = (raw: unknown): ScoutGame[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        isString(entry.id) &&
        isString(entry.teamAId) &&
        isString(entry.teamBId) &&
        isString(entry.ageGroupId) &&
        (entry.teamAScore === undefined || isNumber(entry.teamAScore)) &&
        (entry.teamBScore === undefined || isNumber(entry.teamBScore))
    )
    .map((entry) => {
      const source = coerceGameSource(entry.source);
      return {
        id: entry.id as string,
        teamAId: entry.teamAId as string,
        teamBId: entry.teamBId as string,
        ageGroupId: entry.ageGroupId as string,
        ...(isNumber(entry.teamAScore) ? { teamAScore: entry.teamAScore } : {}),
        ...(isNumber(entry.teamBScore) ? { teamBScore: entry.teamBScore } : {}),
        ...(isString(entry.date) ? { date: entry.date } : {}),
        ...(isString(entry.event) ? { event: entry.event } : {}),
        ...(isString(entry.note) ? { note: entry.note } : {}),
        ...(entry.excluded === true ? { excluded: true } : {}),
        ...(isNumber(entry.ageLevelA) ? { ageLevelA: entry.ageLevelA } : {}),
        ...(isNumber(entry.ageLevelB) ? { ageLevelB: entry.ageLevelB } : {}),
        ...(isString(entry.season) ? { season: entry.season } : {}),
        ...(isString(entry.startTs) ? { startTs: entry.startTs } : {}),
        ...(Array.isArray(entry.alsoFrom) && entry.alsoFrom.some(isString)
          ? { alsoFrom: entry.alsoFrom.filter(isString) }
          : {}),
        ...(source ? { source } : {}),
      };
    });
};

export const coerceAgeGroups = (raw: unknown): AgeGroup[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        isString(entry.id) &&
        isString(entry.name) &&
        Array.isArray(entry.seasonIds)
    )
    .map((entry) => ({
      id: entry.id as string,
      name: entry.name as string,
      seasonIds: (entry.seasonIds as unknown[]).filter(isString),
      ...(isNumber(entry.ageLevel) ? { ageLevel: entry.ageLevel } : {}),
      ...(isNumber(entry.year) ? { year: entry.year } : {}),
      ...(isString(entry.continuesFromId) ? { continuesFromId: entry.continuesFromId } : {}),
      ...(isString(entry.myTeamId) ? { myTeamId: entry.myTeamId } : {}),
    }));
};

/**
 * Written compactly — tuples and dictionaries rather than the objects themselves — because a
 * GameChanger pull reaches a size the readable form does not fit in: see `teamRankingsCompact.ts`.
 * A pool saved before that existed is an array, and is still read as one; the next save rewrites
 * it. The in-memory shape is unchanged either way, so nothing above this line knows.
 */
/**
 * Marks the teams that were never teams.
 *
 * A pool saved before placeholders were understood holds them as ordinary clubs, and GameChanger
 * writes an undecided bracket slot as "TBD- 08/04/26, 5:00 PM" — a different string every time —
 * so a season of them filled the rankings with a row apiece. Reading the name again on the way out
 * drops them from the tables without asking anyone to import it all a second time. It happens here
 * rather than in either decoder because a pool can arrive through either, and a slot missed by one
 * path would be a slot ranked.
 *
 * The games they hold are untouched: the result happened, whoever it turned out to be against.
 */
const markPlaceholders = (teams: ScoutTeam[]): ScoutTeam[] =>
  teams.map((team) =>
    team.placeholder || !isPlaceholderName(team.name) ? team : { ...team, placeholder: true }
  );

/**
 * The pool, decoded once per version of it rather than once per read.
 *
 * The cache holds the compact form — tuples and a dictionary, the shape IndexedDB stores — and
 * every `loadScoutTeams()` used to decode the whole of it into fresh objects. Nothing stopped a
 * caller reading it in a loop, and one did: the club-linking panel asked for the pool once per
 * league team, on every render, and Settings re-renders on every keystroke in any of its inputs.
 * Measured on a 40,000-team pool that is ~270 ms and ~28 MB of new objects per read, so a
 * twelve-team league paid about four seconds and two-thirds of a gigabyte of allocation for each
 * character typed. The site was not slow; it was decoding a nationwide pool twelve times a keystroke.
 *
 * Keyed on the identity of the compact value, not its contents. `writeValue` installs a new object
 * in the cache on every save, and the cross-tab listener does the same when another tab writes, so
 * the identity changes exactly when the pool does and never merely because something rendered.
 * Contents are never compared: that would cost a walk of the pool, which is the thing being saved.
 *
 * The decoded arrays are handed out shared, so they must not be mutated in place by a caller. None
 * does — every consumer treats them as React state or as input to a pure function — and the
 * compact codec builds fresh objects, so the shared copy is never aliased with anything stored.
 *
 * One decoded copy is therefore resident for as long as the pool is unchanged, including on the
 * League Standings side, where it used to be transient. That is the trade: about 28 MB held at
 * nationwide scale, in exchange for never allocating 28 MB on a render again. In Team Rankings it
 * is not even an extra copy — the view's state holds this same array by reference.
 *
 * The localStorage fallback path is not memoised. `readValue` parses the string afresh there, so the
 * identity is new on every read; but that path exists for browsers without IndexedDB, which cannot
 * hold a pool large enough for this to matter.
 */
export const loadScoutTeams = (): ScoutTeam[] => {
  const source = readValue(TEAMS_KEY);
  if (decodedTeams && decodedTeams.source === source) return decodedTeams.teams;
  const teams = markPlaceholders(decodeScoutTeams(source, coerceScoutTeams));
  decodedTeams = { source, teams };
  return teams;
};
export const saveScoutTeams = (teams: ScoutTeam[]): boolean =>
  writeValue(TEAMS_KEY, encodeScoutTeams(teams));

export const loadScoutGames = (): ScoutGame[] => {
  const source = readValue(GAMES_KEY);
  if (decodedGames && decodedGames.source === source) return decodedGames.games;
  const games = decodeScoutGames(source, coerceScoutGames);
  decodedGames = { source, games };
  return games;
};
export const saveScoutGames = (games: ScoutGame[]): boolean =>
  writeValue(GAMES_KEY, encodeScoutGames(games));

export const loadAgeGroups = (): AgeGroup[] => coerceAgeGroups(readValue(AGE_GROUPS_KEY));
export const saveAgeGroups = (ageGroups: AgeGroup[]): boolean =>
  writeValue(AGE_GROUPS_KEY, ageGroups);

/**
 * The cursor of a GameChanger pull, so closing the tab mid-run costs nothing but the request in
 * flight. Only the cursor — the schedules themselves are folded into the pool as they arrive.
 */
export const loadPullProgress = (): GcPullProgress | null =>
  coercePullProgress(readValue(GC_PULL_KEY));
export const savePullProgress = (progress: GcPullProgress): boolean =>
  writeValue(GC_PULL_KEY, progress);
export const clearPullProgress = (): void => forgetValue(GC_PULL_KEY);

/**
 * The weekly rotation's record of which level was refreshed when. Day keys only — a level either
 * had its turn today or it did not — so an unreadable entry is simply dropped rather than
 * pretending a refresh happened.
 */
export const loadRefreshLog = (): RefreshLog => {
  const raw = readValue(GC_REFRESH_KEY);
  if (!isRecord(raw)) return {};
  const log: RefreshLog = {};
  Object.entries(raw).forEach(([level, day]) => {
    if (isString(day) && /^\d{4}-\d{2}-\d{2}$/.test(day)) log[level] = day;
  });
  return log;
};

export const saveRefreshLog = (log: RefreshLog): boolean => writeValue(GC_REFRESH_KEY, log);

/**
 * The pool as it stood when it was last tidied (`poolSignature`). The tidy runs at the end of
 * every pull; this is how the app knows, on opening, whether the pool has changed since — a
 * restored backup, a pull that was closed mid-tidy, a pool from before the tidy existed — and
 * runs it again unasked.
 */
export const loadTidyStamp = (): string | null => {
  const raw = readValue(GC_TIDY_KEY);
  return isString(raw) ? raw : null;
};
export const saveTidyStamp = (stamp: string): boolean => writeValue(GC_TIDY_KEY, stamp);

/**
 * The last pull's record, so the files can still be written after a reload.
 *
 * Unvalidated on the way back in beyond its version: it is read only to be turned into a CSV, and
 * a record that has drifted is better read as the odd blank cell than refused outright — refusing
 * it would throw away the only account of a run that cannot be repeated.
 */
export const loadPullLog = (): PullRunLog | null => {
  const raw = readValue(GC_TRACK_KEY);
  if (!raw || typeof raw !== "object") return null;
  const log = raw as PullRunLog;
  return log.version === PULL_TRACKER_VERSION ? log : null;
};

export const savePullLog = (log: PullRunLog): boolean => writeValue(GC_TRACK_KEY, log);

export const clearPullLog = (): void => forgetValue(GC_TRACK_KEY);

/** The teams still waiting for somebody to say what age they are. */
export const loadAgeUnknown = (): AgeUnknownList => coerceAgeUnknown(readValue(GC_AGELESS_KEY));

export const saveAgeUnknown = (list: AgeUnknownList): boolean => writeValue(GC_AGELESS_KEY, list);

/**
 * A value that is too big to keep in memory, read and written straight past the cache.
 *
 * Everything else here answers from a cache filled once at startup, because the app reads its pool
 * during render and IndexedDB is asynchronous. An archived season's rows are the opposite case:
 * nobody renders them until they ask for them, and there can be a dozen archives of a hundred
 * thousand rows each. So these three go directly to the store — not cached, not queued behind the
 * pool's coalesced writes, and not broadcast. Being told about a write is what makes a tab load
 * something, and a tab that loads every archive has archived nothing.
 *
 * `putBlob` is awaited rather than fire-and-forget, which matters more here than anywhere else in
 * this module: the caller is about to delete the games this blob replaces, and must not do that on
 * an acknowledgement that turns out to be wrong.
 */
const putBlob = async (key: string, value: unknown): Promise<boolean> => {
  if (poolUnavailable) return false;
  if (!usingIdb) return safeSet(key, JSON.stringify(value));
  return (activeIo ?? browserIo).set(key, value);
};

const getBlob = async (key: string): Promise<unknown> => {
  if (poolUnavailable) return null;
  if (!usingIdb) return parseJson(safeGet(key));
  return (await (activeIo ?? browserIo).get(key)) ?? null;
};

const dropBlob = async (key: string): Promise<void> => {
  if (poolUnavailable) return;
  if (!usingIdb) {
    safeRemove(key);
    return;
  }
  await (activeIo ?? browserIo).set(key, null);
};

/** The usable entries out of a stored index; anything that is not a list yields none. */
export const coerceArchiveIndex = (raw: unknown): ArchiveEntry[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (!isFilledString(entry.id) || !isString(entry.name)) return [];
    return [
      {
        id: entry.id,
        name: entry.name,
        ...(isNumber(entry.ageLevel) ? { ageLevel: entry.ageLevel } : {}),
        ...(isNumber(entry.year) ? { year: entry.year } : {}),
        archivedAt: isString(entry.archivedAt) ? entry.archivedAt : "",
        fromGames: isNumber(entry.fromGames) ? entry.fromGames : 0,
        fromTeams: isNumber(entry.fromTeams) ? entry.fromTeams : 0,
        teams: isNumber(entry.teams) ? entry.teams : 0,
      },
    ];
  });
};

/** What archives exist, without loading any of them. Synchronous, like every other pool read. */
export const loadArchiveIndex = (): ArchiveEntry[] => coerceArchiveIndex(readValue(GC_ARCHIVE_KEY));

/**
 * One archived season's rows, fetched on demand.
 *
 * `null` for an archive that is not there, and also for one whose blob will not read — which are
 * the same silence and different facts, so the caller says "could not load" rather than "empty".
 * An archive with no rows would never have been written.
 */
export const loadArchivedSeason = async (id: string): Promise<ArchivedSeason | null> =>
  coerceArchivedSeason(await getBlob(archiveRowsKey(id)));

/**
 * Writes finished seasons and adds them to the index, rows first.
 *
 * Returns the seasons as they were stored — ids included, because a name that is already archived
 * is given a fresh one — or `null` if any blob refused, in which case nothing was added to the
 * index and whatever this call had already written is taken back out. The caller is about to
 * delete the games these tables replace and must only do so on `null`'s absence: a half-written
 * archive plus a completed delete is the one outcome there is no recovering from.
 */
export const saveArchivedSeasons = async (
  seasons: ArchivedSeason[]
): Promise<ArchivedSeason[] | null> => {
  if (seasons.length === 0) return [];
  const index = loadArchiveIndex();
  const stored = withUniqueIds(
    seasons,
    index.map((entry) => entry.id)
  );
  const written: string[] = [];
  for (const season of stored) {
    if (await putBlob(archiveRowsKey(season.id), season)) {
      written.push(season.id);
      continue;
    }
    // Back out, so a refused write leaves the pool exactly as it was rather than half-archived.
    for (const id of written) await dropBlob(archiveRowsKey(id));
    return null;
  }
  if (!writeValue(GC_ARCHIVE_KEY, [...index, ...stored.map(archiveEntryOf)])) {
    for (const id of written) await dropBlob(archiveRowsKey(id));
    return null;
  }
  return stored;
};

/**
 * Drops an archive: its rows and its line in the index.
 *
 * The index goes last, so an interrupted delete leaves an archive that lists and will not load
 * rather than rows nothing lists — the first is visible and fixable, the second is a leak.
 */
export const forgetArchivedSeason = async (id: string): Promise<boolean> => {
  await dropBlob(archiveRowsKey(id));
  return writeValue(
    GC_ARCHIVE_KEY,
    loadArchiveIndex().filter((entry) => entry.id !== id)
  );
};

/** Every archive with its rows, for a backup. Loads all of them, so only the backup path calls it. */
export const loadAllArchivedSeasons = async (): Promise<ArchivedSeason[]> => {
  // Independent reads, so they go together; the index order is kept because `Promise.all` resolves
  // in the order it was given rather than the order the reads finished.
  const loaded = await Promise.all(loadArchiveIndex().map((entry) => loadArchivedSeason(entry.id)));
  return loaded.filter((season): season is ArchivedSeason => season !== null);
};

/**
 * Swaps the archives for the ones in a restored backup.
 *
 * Replaces rather than adds, because a restore replaces the pool outright and the two must agree:
 * restoring the same file twice would otherwise leave two copies of every season, suffixed apart by
 * `withUniqueIds` and indistinguishable to read.
 *
 * The old rows go first and the index is written once at the end by `saveArchivedSeasons`, so an
 * interruption leaves archives that list and will not load rather than rows nothing names.
 */
export const replaceArchivedSeasons = async (seasons: ArchivedSeason[]): Promise<boolean> => {
  const going = loadArchiveIndex();
  // Together: they are separate keys, and the ordering that matters is only that every drop lands
  // before the index is rewritten below — which awaiting them all still guarantees.
  await Promise.all(going.map((entry) => dropBlob(archiveRowsKey(entry.id))));
  if (!writeValue(GC_ARCHIVE_KEY, [])) return false;
  return (await saveArchivedSeasons(seasons)) !== null;
};
