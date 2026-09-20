import { ageGroupYear, type AgeGroup, type ScoutGame, type ScoutTeam } from "./teamRankings";
import { isNumber, isRecord, isString } from "./validate";
import { coercePullProgress, type GcPullProgress } from "./gameChangerPull";
import {
  DEFAULT_REFRESH_CADENCE,
  isRefreshCadence,
  type RefreshCadence,
  type RefreshLog,
} from "./gameChangerSchedule";
import { PULL_TRACKER_VERSION, type PullRunLog } from "./pullTracker";
import { coerceAgeUnknown, type AgeUnknownList } from "./ageUnknown";
import { coerceKeptApart, keptApartList, type KeptApart } from "./keptApart";
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
  decodePoolGames,
  decodePoolTeams,
  encodeScoutGames,
  encodeScoutTeams,
  isFilledString,
  markPlaceholders,
  storedGamesStats,
} from "./teamRankingsCompact";

/**
 * The readers of a stored pool live with the codec now, so the workers can decode a compact pool
 * without pulling this module — and its IndexedDB, its broadcast channel — into their bundles.
 * Re-exported because this is where everything has always found them.
 */
export {
  coerceGcTeamLink,
  coerceGcTeamLinks,
  coerceScoutGames,
  coerceScoutTeams,
} from "./teamRankingsCompact";

/**
 * Team Rankings persistence is intentionally separate from `storage.ts`'s season-namespaced
 * layout: this is a single global pool, not scoped to any one League Standings season — age groups
 * are the only scoping concept here, and one age group can bundle several League Standings seasons.
 */
const TEAMS_KEY = "league_forecast_scout_teams_v1";
/**
 * Where every game used to live, as one value. Still read — a pool written before the years were
 * split is moved out of it on first access, and the key emptied — and still in `POOL_KEYS`, so it
 * is loaded, cleared and heard about like the rest until that happens.
 */
const GAMES_KEY = "league_forecast_scout_games_v1";
/**
 * The games, one key per squad year.
 *
 * `GAMES_KEY` held every game the pool had ever seen as one value, and reading the pool meant
 * decoding all of it: two hundred thousand objects for the season on screen and as many again for
 * the one before it, which nobody was looking at. A squad year is already its own rating pool —
 * nothing in one year's fit reads another year's games — so it is the natural unit of storage too.
 * The year on screen is decoded and kept (`loadScoutGamesForYear`); the others stay compact until
 * something asks for the whole pool — a tidy, a pull, a backup, an archive — and are let go of
 * again afterwards.
 *
 * The suffix is the squad year of the game's age group, or `none` for a game whose group has no
 * year, or is no longer there. Teams are not split this way: a club can be named by games in two
 * years, and one copy of it is the only way a rename in one year is a rename in the other.
 */
const GAMES_SHARD_PREFIX = "league_forecast_scout_games_v2:";
const NO_YEAR_SHARD = "none";
/**
 * Which years have games stored, as their labels. One small key rather than enumerating the
 * store's keys: `localStorage` cannot be enumerated where it is stubbed, IndexedDB's listing is
 * asynchronous, and what a pool holds must be answerable during a render. Kept true by
 * `writeShards`, the only thing that writes a year.
 */
const GAMES_INDEX_KEY = "league_forecast_scout_games_v2_index";
const AGE_GROUPS_KEY = "league_forecast_scout_age_groups_v1";
/** Where an interrupted GameChanger pull keeps its place. Its own key, so clearing it never touches the pool. */
const GC_PULL_KEY = "league_forecast_gc_pull_v1";
/** When each age level last had its turn in the weekly rotation. */
const GC_REFRESH_KEY = "league_forecast_gc_refresh_v1";
/** How much comes round at once: the week's rotation, or every age group every day. */
const GC_CADENCE_KEY = "league_forecast_gc_cadence_v1";
/** The shape of the pool the last time it was tidied, so a load can tell whether it needs to be. */
const GC_TIDY_KEY = "league_forecast_gc_tidy_v1";
/**
 * The last pull's own record of itself — a row per team asked for, and the run's totals.
 *
 * Its own key, written independently of the pool, because it is the largest thing here after the
 * games and the one thing that must never be the reason a run stops. A refused pool save aborts
 * the pull; a refused record is a blank cell in a file.
 *
 * Not in `POOL_KEYS`, for the same reason an archive's rows are not: it is read only to be turned
 * into a CSV from one panel, and a row per team in a nationwide pull is tens of thousands of rows
 * that every page was holding in memory for the sake of a download button on one of them. It goes
 * through `putBlob`/`getBlob` below — loaded when the import panel asks, never cached, never
 * broadcast — and is still carried out of `localStorage` with the pool (see `LAZY_KEYS`) and
 * dropped by a reset.
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
 * The pairs of GameChanger ids the user has said are two different clubs.
 *
 * In `POOL_KEYS` because it is about the pool and is nothing like big enough to be anywhere else:
 * a few dozen pairs of twelve-character ids, which is what makes the read path that walks those
 * keys the right one for it. The one key the reset below steps over, and the reason is that the
 * answers outlive the data they were given about: a GameChanger id is minted once and comes back
 * unchanged on the next pull, so clearing these would ask the user every one of the same
 * questions again about exactly the same two teams.
 */
const GC_APART_KEY = "league_forecast_gc_apart_v1";
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
/**
 * One year's games, decoded, for as long as that year's stored value is the one it was decoded
 * from. A single slot on purpose: the view shows one year at a time, and pinning every year ever
 * looked at would put back the memory the shards exist to save. See `loadScoutGamesForYear`.
 */
let decodedYear: { key: string; source: unknown; games: ScoutGame[] } | null = null;
/** Whether a pool written as one value is on its way into shards and has not yet been let go of. */
let migratingGames = false;
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
  if (key && !isPoolKey(key)) return;
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
  GAMES_INDEX_KEY,
  AGE_GROUPS_KEY,
  GC_PULL_KEY,
  GC_REFRESH_KEY,
  GC_CADENCE_KEY,
  GC_TIDY_KEY,
  GC_AGELESS_KEY,
  GC_ARCHIVE_KEY,
  GC_APART_KEY,
];
/**
 * Keys that live beside the pool in the store but are read on demand rather than into the cache.
 * They move out of `localStorage` with everything else the first time the store opens, and that is
 * the only thing the startup path does with them.
 */
const LAZY_KEYS = [GC_TRACK_KEY];

const isGamesShardKey = (key: string): boolean => key.startsWith(GAMES_SHARD_PREFIX);
/** Whether a key is part of the pool: one of the fixed keys above, or one year's games. */
const isPoolKey = (key: string): boolean => POOL_KEYS.includes(key) || isGamesShardKey(key);

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

/** The stored shard labels a raw index value names; anything else names none. */
const coerceShardIndex = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((entry): entry is string => isFilledString(entry)) : [];

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
  // Years' games written while this browser was on localStorage travel with the rest; the index
  // there says which they are.
  const localShards = coerceShardIndex(io.readLocal(GAMES_INDEX_KEY)).map(
    (label) => `${GAMES_SHARD_PREFIX}${label}`
  );

  for (const key of [...POOL_KEYS, ...LAZY_KEYS, ...localShards]) {
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
   *
   * The years' games are read by the index that names them, plus any stored under the prefix that
   * the index has lost track of, so an interrupted write cannot hide a year that is in the store.
   */
  const wanted = [...POOL_KEYS, ...new Set([...existing, ...localShards].filter(isGamesShardKey))];
  const values = await Promise.all(wanted.map((key) => io.get(key)));
  const filled = new Map<string, unknown>();
  wanted.forEach((key, at) => {
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
    await splitLegacyGames(activeIo);
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
  // Each year's games has a key of its own, named by the index; read them before the index goes.
  const shards = gamesShardKeys();
  POOL_KEYS.filter((key) => key !== GC_APART_KEY).forEach((key) => forgetValue(key));
  shards.forEach((key) => forgetValue(key));
  decodedYear = null;
  archived.forEach((entry) => void dropBlob(archiveRowsKey(entry.id)));
  // The pull's record is read on demand and so is in no key the walk above reaches.
  void dropBlob(GC_TRACK_KEY);
  return true;
};

/** Only for tests: forgets the cache and goes back to reading storage directly. */
export const resetTeamRankingsStore = (): void => {
  cache.clear();
  // The decoded copies would invalidate themselves on the next read - a cleared cache answers null,
  // which is never the identity they hold - but a reset should not keep a pool's worth of objects
  // alive until somebody happens to ask.
  decodedTeams = null;
  decodedYear = null;
  migratingGames = false;
  pendingWrites.clear();
  usingIdb = false;
  poolUnavailable = false;
  landed = true;
  activeIo = null;
  resetPoolSync();
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
  const teams = decodePoolTeams(source);
  decodedTeams = { source, teams };
  return teams;
};
/**
 * Saving also seeds the decoded copy. The caller holds the very array it just encoded, so the next
 * `loadScoutTeams()` — which every save triggers, through the bridge and the refit — need not
 * decode the pool it was handed a moment ago. Without this, a pull flush or a score edit paid a
 * full decode (~270 ms and ~28 MB at nationwide scale) to read back what it had just written.
 *
 * `markPlaceholders` is applied so the seeded copy is exactly what a decode would have produced;
 * it is a `.map`, so the objects are shared with the caller's array and only the pointer array is
 * new. Seeded on acceptance only: a refused write leaves the cache holding the old compact value,
 * and a seed keyed on the new one would simply never be hit.
 */
export const saveScoutTeams = (teams: ScoutTeam[]): boolean => {
  const encoded = encodeScoutTeams(teams);
  const accepted = writeValue(TEAMS_KEY, encoded);
  if (accepted) decodedTeams = { source: encoded, teams: markPlaceholders(teams) };
  return accepted;
};

/* -------------------------------------------------------------------- the games, by squad year */

const shardKeyFor = (label: string): string => `${GAMES_SHARD_PREFIX}${label}`;
const shardLabelOf = (key: string): string => key.slice(GAMES_SHARD_PREFIX.length);
const labelForYear = (year: number | undefined): string =>
  year === undefined ? NO_YEAR_SHARD : String(year);
const yearForLabel = (label: string): number | undefined =>
  label === NO_YEAR_SHARD ? undefined : Number(label);

/** Shard labels in the order the pool reads back: years ascending, then the games with none. */
const orderedLabels = (labels: Iterable<string>): string[] =>
  [...new Set(labels)].sort((a, b) => {
    if (a === NO_YEAR_SHARD) return 1;
    if (b === NO_YEAR_SHARD) return -1;
    return Number(a) - Number(b);
  });

/**
 * Every stored year's key, by the index. On IndexedDB a year in the cache that the index has lost
 * track of counts too: the cache is what the store holds, and a year with games in it is a year.
 */
const gamesShardKeys = (): string[] => {
  if (poolUnavailable) return [];
  const keys = new Set(coerceShardIndex(readValue(GAMES_INDEX_KEY)).map(shardKeyFor));
  if (usingIdb) {
    cache.forEach((value, key) => {
      if (isGamesShardKey(key) && value !== null && value !== undefined) keys.add(key);
    });
  }
  return [...keys];
};

const storedShardLabels = (): string[] => orderedLabels(gamesShardKeys().map(shardLabelOf));

const yearsByGroup = (ageGroups: AgeGroup[]): Map<string, number | undefined> =>
  new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));

/** The given games, each under the label of its year, in the order given. */
const splitByYear = (games: ScoutGame[], ageGroups: AgeGroup[]): Map<string, ScoutGame[]> => {
  const years = yearsByGroup(ageGroups);
  const shards = new Map<string, ScoutGame[]>();
  games.forEach((game) => {
    const label = labelForYear(years.get(game.ageGroupId));
    const list = shards.get(label);
    if (list) list.push(game);
    else shards.set(label, [game]);
  });
  // All one year: the caller's own array is the shard, so the pin after a save is the array the
  // caller holds and the read that follows does not even copy it.
  if (shards.size === 1) {
    const [label] = shards.keys();
    shards.set(label!, games);
  }
  return shards;
};

/** One year's games, decoded; the pinned copy when this is the year that is pinned. */
const decodeShard = (key: string): ScoutGame[] => {
  const source = readValue(key);
  if (decodedYear && decodedYear.key === key && decodedYear.source === source) {
    return decodedYear.games;
  }
  return decodePoolGames(source);
};

/**
 * Writes each year given: to its own key, or to nothing when it has no games left. A year that is
 * the pinned one is re-pinned to the array just written, so the read that follows a save does not
 * decode the pool it was handed a moment ago.
 */
const writeShards = (shards: Map<string, ScoutGame[]>): boolean => {
  let ok = true;
  shards.forEach((games, label) => {
    const key = shardKeyFor(label);
    if (games.length === 0) {
      forgetValue(key);
      if (decodedYear?.key === key) decodedYear = { key, source: null, games };
      return;
    }
    const encoded = encodeScoutGames(games);
    if (!writeValue(key, encoded)) {
      ok = false;
      return;
    }
    if (decodedYear?.key === key) decodedYear = { key, source: encoded, games };
  });
  // The index follows what was actually written: a year emptied leaves it, a year written joins it.
  const index = new Set(coerceShardIndex(readValue(GAMES_INDEX_KEY)));
  shards.forEach((games, label) => {
    if (games.length === 0) index.delete(label);
    else index.add(label);
  });
  const next = orderedLabels(index);
  const current = coerceShardIndex(readValue(GAMES_INDEX_KEY));
  if (next.join("|") !== current.join("|") && !writeValue(GAMES_INDEX_KEY, next)) ok = false;
  return ok;
};

/**
 * Writes games already filed by year.
 *
 * The years in `replacing` are rewritten to hold exactly the games filed under them, and dropped
 * when that is none. A game filed under any other year is laid over that year's stored games by
 * id — so a save that holds one year's list cannot empty a year it was not holding, and a game
 * moved to another year's page arrives there rather than being lost with the page it left.
 */
const writeSplit = (split: Map<string, ScoutGame[]>, replacing: ReadonlySet<string>): boolean => {
  const toWrite = new Map<string, ScoutGame[]>();
  replacing.forEach((label) => toWrite.set(label, split.get(label) ?? []));
  split.forEach((strays, label) => {
    if (replacing.has(label)) return;
    const byId = new Map(decodeShard(shardKeyFor(label)).map((game) => [game.id, game]));
    strays.forEach((game) => byId.set(game.id, game));
    toWrite.set(label, [...byId.values()]);
  });
  return writeShards(toWrite);
};

/** The same, for a caller that has the games rather than the split. */
const writeRouted = (games: ScoutGame[], replacing: ReadonlySet<string>): boolean =>
  writeSplit(splitByYear(games, loadAgeGroups()), replacing);

/**
 * Moves a pool written as one value into a key per year, on the store's own terms.
 *
 * Awaited, and the old key is emptied only once every year's write has been confirmed, so a
 * write that fails leaves the pool exactly where it was and this runs again next time. Runs on
 * the startup path, before anything mounts, so the app never sees both shapes at once.
 */
const splitLegacyGames = async (io: PoolStoreIo): Promise<void> => {
  const legacy = cache.get(GAMES_KEY);
  if (legacy === null || legacy === undefined) return;
  const groups = coerceAgeGroups(cache.get(AGE_GROUPS_KEY));
  const shards = splitByYear(decodePoolGames(legacy), groups);
  const entries = [...shards].map(
    ([label, games]) => [shardKeyFor(label), encodeScoutGames(games)] as const
  );
  // A year left over from an attempt that did not finish is rewritten below or emptied here.
  const stale = gamesShardKeys().filter((key) => !shards.has(shardLabelOf(key)));
  const index = orderedLabels(shards.keys());
  const landed = await Promise.all([
    ...entries.map(([key, value]) => io.set(key, value)),
    ...stale.map((key) => io.set(key, null)),
    io.set(GAMES_INDEX_KEY, index),
  ]);
  if (!landed.every(Boolean)) return;
  entries.forEach(([key, value]) => cache.set(key, value));
  stale.forEach((key) => cache.set(key, null));
  cache.set(GAMES_INDEX_KEY, index);
  if (await io.set(GAMES_KEY, null)) cache.set(GAMES_KEY, null);
};

/**
 * The same move, where it could not be awaited: on localStorage, where every write is synchronous
 * and truthful, and as the fallback for a startup whose move did not finish.
 *
 * On IndexedDB the shards are in the cache at once and the old key is emptied only after the
 * queued writes have landed. Until then the old value is authoritative and every read goes to the
 * shards it was copied into, which hold the same games; a startup that finds it still there does
 * the move again from it.
 */
const ensureGamesSharded = (): void => {
  if (migratingGames) return;
  const legacy = readValue(GAMES_KEY);
  if (legacy === null || legacy === undefined) return;
  const shards = splitByYear(decodePoolGames(legacy), loadAgeGroups());
  storedShardLabels().forEach((label) => {
    if (!shards.has(label)) shards.set(label, []);
  });
  const accepted = writeShards(shards);
  if (!usingIdb) {
    if (accepted) forgetValue(GAMES_KEY);
    return;
  }
  migratingGames = true;
  void flushPoolWrites().then((landed) => {
    migratingGames = false;
    if (landed && accepted) forgetValue(GAMES_KEY);
  });
};

/**
 * Every game in the pool, every year.
 *
 * Decodes the years that are not pinned and keeps none of them: this is for the operations that
 * genuinely need the whole pool — a tidy, a pull, a backup, an archive, merging or renaming a
 * club — and they hold the array only for as long as they run. Read on a render it would put back
 * exactly the memory the shards exist to save, so the view reads its year instead.
 */
export const loadScoutGames = (): ScoutGame[] => {
  ensureGamesSharded();
  return storedShardLabels().flatMap((label) => decodeShard(shardKeyFor(label)));
};

/**
 * One squad year's games — `undefined` for the games whose age group has no year — decoded once
 * per version of that year and kept while it is the year asked for. This is what the view holds:
 * the season on screen, and nothing from the seasons that are not.
 */
export const loadScoutGamesForYear = (year: number | undefined): ScoutGame[] => {
  ensureGamesSharded();
  const key = shardKeyFor(labelForYear(year));
  const source = readValue(key);
  if (decodedYear && decodedYear.key === key && decodedYear.source === source) {
    return decodedYear.games;
  }
  const games = decodePoolGames(source);
  decodedYear = { key, source, games };
  return games;
};

/**
 * The games of the years these age groups sit in — for the League Standings side, which reads the
 * pool only through the age groups a season is linked to, and had been decoding every year to do
 * it. Callers still filter to their groups; this only spares them the years none of them is in.
 */
export const loadScoutGamesForGroups = (groupIds: readonly string[]): ScoutGame[] => {
  ensureGamesSharded();
  const years = yearsByGroup(loadAgeGroups());
  const labels = groupIds.filter((id) => years.has(id)).map((id) => labelForYear(years.get(id)));
  const stored = new Set(storedShardLabels());
  const wanted = orderedLabels(labels).filter((label) => stored.has(label));
  // One year is the common case, and a season's groups are all in one year, so it is pinned: the
  // League Standings side re-reads on every edit of its own and must not decode each time.
  if (wanted.length === 1) return loadScoutGamesForYear(yearForLabel(wanted[0]!));
  return wanted.flatMap((label) => decodeShard(shardKeyFor(label)));
};

/**
 * The games filed under these pages, and nothing else of the years they sit in.
 *
 * The read that mirrors `saveScoutGamesForGroups`, for the caller holding part of the pool on
 * purpose: a sectioned pull reads back the pages it is about to refresh, folds into those, and
 * writes them to the same pages. `loadScoutGamesForGroups` is the wrong tool for that — it answers
 * with whole years, and at six age pages to a year a whole year is most of what sectioning exists
 * to avoid holding.
 *
 * Nothing is pinned. `decodeShard` reads the pinned year if it happens to be one of these and
 * never sets it, so a run that walks every year in turn does not leave the pool decoded behind it.
 */
export const loadScoutGamesForPages = (groupIds: readonly string[]): ScoutGame[] => {
  ensureGamesSharded();
  const owned = new Set(groupIds);
  if (owned.size === 0) return [];
  const years = yearsByGroup(loadAgeGroups());
  const stored = new Set(storedShardLabels());
  const labels = orderedLabels(
    [...owned].filter((id) => years.has(id)).map((id) => labelForYear(years.get(id)))
  ).filter((label) => stored.has(label));
  return labels.flatMap((label) =>
    decodeShard(shardKeyFor(label)).filter((game) => owned.has(game.ageGroupId))
  );
};

/** The games of the years whose age groups include this League Standings season. */
export const loadScoutGamesForSeason = (seasonId: string): ScoutGame[] =>
  loadScoutGamesForGroups(
    loadAgeGroups()
      .filter((group) => group.seasonIds.includes(seasonId))
      .map((group) => group.id)
  );

/**
 * What each stored year holds, without decoding any of it: how many games, and how many distinct
 * teams they name. What the archive card lists, on a pool it would cost a full decode to walk.
 */
export const storedGamesByYear = (): {
  year: number | undefined;
  games: number;
  teams: number | null;
}[] => {
  ensureGamesSharded();
  return storedShardLabels().map((label) => ({
    year: yearForLabel(label),
    ...storedGamesStats(readValue(shardKeyFor(label))),
  }));
};

/** What became of a save that holds the whole pool. */
export type PoolWrite = {
  /** Every key the save needed landed. */
  written: boolean;
  /**
   * The stored squad years the save held no games for and was not told to empty, so they were
   * left exactly as they were.
   *
   * A save that really does hold the whole pool spares nothing, so anything in here is a caller
   * saving a pool it does not have — and that is worth putting in front of somebody rather than
   * counting as a successful save.
   */
  spared: (number | undefined)[];
};

/**
 * Saves the whole pool back: every year rewritten from `games`.
 *
 * A stored year that `games` holds nothing for is emptied only when `emptying` names it. That
 * default is the whole point of the signature. The old one had no such parameter and emptied
 * every such year unasked, which reads as obviously right — the caller holds the whole pool, so a
 * year it has nothing for is a year with nothing in it — and is ruinous for a caller that does
 * not. Handed an empty array by a wiring mistake, this deleted a hundred thousand games and
 * reported success, because "the whole pool" is a claim about the caller that the array itself
 * cannot make. Now the array cannot make it: emptying a year is a thing a caller says, and the
 * one caller that means it says which year.
 *
 * It is not a whole guarantee and is not meant to read as one. A save holding a year's games can
 * still overwrite that year with fewer of them, and no arithmetic here can tell that from a
 * deletion the user asked for. What it does close is the whole-year case, which is the one that
 * loses a season, and it closes it without decoding anything: a stored year with no games is
 * dropped rather than written empty, so the stored labels already are the years that hold games.
 */
export const saveScoutGames = (
  games: ScoutGame[],
  emptying: readonly (number | undefined)[] = []
): PoolWrite => {
  ensureGamesSharded();
  const split = splitByYear(games, loadAgeGroups());
  const replacing = new Set([...split.keys(), ...emptying.map(labelForYear)]);
  const spared = storedShardLabels().filter((label) => !replacing.has(label));
  return { written: writeSplit(split, replacing), spared: spared.map(yearForLabel) };
};

/**
 * Replaces the games of some age groups, leaving every other page of their years alone.
 *
 * For a caller that holds part of the pool on purpose. A pull of a nationwide pool cannot hold all
 * of it: measured at forty thousand teams and two hundred thousand games, the fold's index alone
 * is 253 MB on top of 79 MB of pool, and that is what runs a tab out of memory. Scoped to one age
 * group of six it is 83 MB on top of 16 MB, because the roster is only 25 MB of it and the games
 * are the rest — so a section holds its own pages and nothing else.
 *
 * `groupIds` is what the caller is authoritative for: rows filed under those pages are replaced
 * outright, and a page of the same year that is not named keeps everything it had. A game the
 * caller holds that has moved to a page it does not own is laid over that year by id rather than
 * dropped, the same way a single year's save treats a game that has left it — a fold can refile a
 * game, and a refiled game has to arrive somewhere.
 */
export const saveScoutGamesForGroups = (
  groupIds: readonly string[],
  games: ScoutGame[]
): boolean => {
  ensureGamesSharded();
  const owned = new Set(groupIds);
  if (owned.size === 0) return true;
  const ageGroups = loadAgeGroups();
  const years = yearsByGroup(ageGroups);
  const labelsOwned = new Set([...owned].map((id) => labelForYear(years.get(id))));

  const split = splitByYear(games, ageGroups);
  const toWrite = new Map<string, ScoutGame[]>();

  labelsOwned.forEach((label) => {
    const key = shardKeyFor(label);
    // What that year holds for pages this caller does not own, which has to survive untouched.
    const kept = decodeShard(key).filter((game) => !owned.has(game.ageGroupId));
    const mine = (split.get(label) ?? []).filter((game) => owned.has(game.ageGroupId));
    toWrite.set(label, [...kept, ...mine]);
  });

  layOverUnowned(toWrite, split, owned);

  return writeShards(toWrite);
};

/**
 * Adds the games of `split` that no page in `owned` covers to `toWrite`, over whatever their year
 * already holds, matching by id. Nothing is dropped: a year not already in `toWrite` is decoded
 * and added to rather than replaced.
 */
const layOverUnowned = (
  toWrite: Map<string, ScoutGame[]>,
  split: Map<string, ScoutGame[]>,
  owned: ReadonlySet<string>
): void => {
  split.forEach((strays, label) => {
    const outside = strays.filter((game) => !owned.has(game.ageGroupId));
    if (outside.length === 0) return;
    const base = toWrite.get(label) ?? decodeShard(shardKeyFor(label));
    const byId = new Map(base.map((game) => [game.id, game]));
    outside.forEach((game) => byId.set(game.id, game));
    toWrite.set(label, [...byId.values()]);
  });
};

/**
 * Lays these games over the pool by id and replaces nothing.
 *
 * For the caller holding no page in full: the section of a sectioned pull that fetches ids nobody
 * has pulled before. It cannot say what any page ought to contain — it never read one — so the
 * only honest write is the one that adds. `saveScoutGamesForGroups` with no pages is not this: it
 * writes nothing at all, on purpose, so that an empty list can never be the thing that quietly
 * skips a save.
 *
 * The cost is that this cannot delete. A game these schedules no longer list stays until the tidy
 * prunes it, which is the same bargain every additive fold in the pull makes.
 */
export const addScoutGames = (games: ScoutGame[]): boolean => {
  ensureGamesSharded();
  if (games.length === 0) return true;
  const toWrite = new Map<string, ScoutGame[]>();
  layOverUnowned(toWrite, splitByYear(games, loadAgeGroups()), new Set());
  return writeShards(toWrite);
};

/**
 * What a caller is holding, when it is not the whole pool — how its save must be applied.
 *
 * A sectioned pull holds one age page at a time, so the difference matters more than it reads:
 * saving a section as the whole pool deletes every page it is not holding.
 */
export type PoolHolding =
  /** These pages, in full. Replace them; leave every other page of their years untouched. */
  | { kind: "pages"; ageGroupIds: readonly string[] }
  /** No page in full. Lay what is here over the pool by id and replace nothing. */
  | { kind: "additions" };

/**
 * Replaces the pool outright, from something that is not the pool: a restored backup. Every
 * stored year the file has no games for goes, because the file is the pool now.
 *
 * Its own function rather than a flag on `saveScoutGames`, so that emptying every year is
 * something a caller can only do by naming this — and restoring a backup is the only caller that
 * has any business doing it.
 */
export const replaceScoutGames = (games: ScoutGame[]): boolean => {
  ensureGamesSharded();
  const split = splitByYear(games, loadAgeGroups());
  return writeSplit(split, new Set([...storedShardLabels(), ...split.keys()]));
};

/**
 * Replaces one squad year's games, leaving every other year exactly as stored. `games` is that
 * year's complete list as it should now be; a game in it filed under another year's page is filed
 * there (see `writeRouted`). The year is pinned afterwards, so the read that follows is free.
 */
export const saveScoutGamesForYear = (year: number | undefined, games: ScoutGame[]): boolean => {
  ensureGamesSharded();
  const label = labelForYear(year);
  const key = shardKeyFor(label);
  // Pin first, so `writeShards` re-pins this year to the array it writes.
  if (decodedYear?.key !== key) decodedYear = { key, source: readValue(key), games: [] };
  return writeRouted(games, new Set([label]));
};

/** The shard label of a year, for callers that key their own caches the way storage does. */
export const gamesShardLabel = labelForYear;

export const loadAgeGroups = (): AgeGroup[] => coerceAgeGroups(readValue(AGE_GROUPS_KEY));

/**
 * Saves the age groups and moves games between years when a group's year moved.
 *
 * A game is filed under its group's year, so changing a group's year — or deleting the group —
 * changes which key its games belong in. The years on either side of every such change are read,
 * their games filed again by the groups as they now stand, and written back; a group that merely
 * changed its name or its seasons touches nothing.
 */
export const saveAgeGroups = (ageGroups: AgeGroup[]): boolean => {
  const before = yearsByGroup(loadAgeGroups());
  const ok = writeValue(AGE_GROUPS_KEY, ageGroups);
  if (!ok) return false;
  const after = yearsByGroup(ageGroups);
  const touched = new Set<string>();
  before.forEach((year, id) => {
    if (!after.has(id) || after.get(id) !== year) {
      touched.add(labelForYear(year));
      touched.add(labelForYear(after.get(id)));
    }
  });
  if (touched.size === 0) return true;
  ensureGamesSharded();
  const stored = storedShardLabels().filter((label) => touched.has(label));
  if (stored.length === 0) return true;
  const games = stored.flatMap((label) => decodeShard(shardKeyFor(label)));
  return writeRouted(games, touched);
};

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
 * Which cadence the refresh offers. Anything unreadable falls back to the default rather than to
 * the other choice, so a corrupted preference cannot quietly halve or septuple a day's work.
 */
export const loadRefreshCadence = (): RefreshCadence => {
  const raw = readValue(GC_CADENCE_KEY);
  return isRefreshCadence(raw) ? raw : DEFAULT_REFRESH_CADENCE;
};

export const saveRefreshCadence = (cadence: RefreshCadence): boolean =>
  writeValue(GC_CADENCE_KEY, cadence);

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
 * Read from the store when asked rather than from the startup cache — see `GC_TRACK_KEY` — which
 * is why it is asynchronous where its neighbours are not. Unvalidated on the way back in beyond
 * its version: it is read only to be turned into a CSV, and a record that has drifted is better
 * read as the odd blank cell than refused outright — refusing it would throw away the only account
 * of a run that cannot be repeated.
 */
export const loadPullLog = async (): Promise<PullRunLog | null> => {
  const raw = await getBlob(GC_TRACK_KEY);
  if (!raw || typeof raw !== "object") return null;
  const log = raw as PullRunLog;
  return log.version === PULL_TRACKER_VERSION ? log : null;
};

/** Resolves to whether the record landed; a refusal is the caller's to note in the record. */
export const savePullLog = (log: PullRunLog): Promise<boolean> => putBlob(GC_TRACK_KEY, log);

export const clearPullLog = (): Promise<void> => dropBlob(GC_TRACK_KEY);

/** The teams still waiting for somebody to say what age they are. */
export const loadAgeUnknown = (): AgeUnknownList => coerceAgeUnknown(readValue(GC_AGELESS_KEY));

export const saveAgeUnknown = (list: AgeUnknownList): boolean => writeValue(GC_AGELESS_KEY, list);

/** The pairs of GameChanger ids the user has said are two clubs, never to be offered again. */
export const loadKeptApart = (): Set<string> => coerceKeptApart(readValue(GC_APART_KEY));

export const saveKeptApart = (apart: KeptApart): boolean =>
  writeValue(GC_APART_KEY, keptApartList(apart));

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
