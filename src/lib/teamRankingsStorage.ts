import type { AgeGroup, GcTeamLink, ScoutGame, ScoutGameSource, ScoutTeam } from "./teamRankings";
import { isNumber, isRecord, isString } from "./validate";
import { coercePullProgress, type GcPullProgress } from "./gameChangerPull";
import type { RefreshLog } from "./gameChangerSchedule";
import { idbGet, idbKeys, idbSet, openPoolDb } from "./idb";
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
        const ok = await idbSet(key, value);
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
const POOL_KEYS = [TEAMS_KEY, GAMES_KEY, AGE_GROUPS_KEY, GC_PULL_KEY, GC_REFRESH_KEY];

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
  if (!usingIdb) return safeSet(key, JSON.stringify(value));
  cache.set(key, value);
  pendingWrites.set(key, value);
  void flushWrites();
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

  const filled = new Map<string, unknown>();
  for (const key of POOL_KEYS) {
    const stored = await io.get(key);
    // A key that could not be carried is still readable where it is, so a failed move costs
    // nothing but a retry — rather than hiding data that is sitting in localStorage.
    filled.set(key, stored ?? io.readLocal(key));
  }
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
    const filled = await fillPoolCache(io ?? browserIo);
    filled.forEach((value, key) => cache.set(key, value));
    usingIdb = true;
    if (!io) safeSet(MIGRATED_KEY, "1");
  } catch {
    // Anything unexpected leaves `usingIdb` false, which is the working localStorage path.
  }
};

/** Only for tests: forgets the cache and goes back to reading storage directly. */
export const resetTeamRankingsStore = (): void => {
  cache.clear();
  pendingWrites.clear();
  usingIdb = false;
  poolUnavailable = false;
  landed = true;
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
export const loadScoutTeams = (): ScoutTeam[] =>
  decodeScoutTeams(readValue(TEAMS_KEY), coerceScoutTeams);
export const saveScoutTeams = (teams: ScoutTeam[]): boolean =>
  writeValue(TEAMS_KEY, encodeScoutTeams(teams));

export const loadScoutGames = (): ScoutGame[] =>
  decodeScoutGames(readValue(GAMES_KEY), coerceScoutGames);
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
