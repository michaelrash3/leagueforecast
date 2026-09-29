import { coerceBackup } from "../backup";
import { getActiveSeasonId, readLeagueSnapshot, replaceLeagueSnapshot } from "../storage";
import {
  applyCloudPoolValues,
  cloudPoolKeys,
  flushPoolWrites,
  isCloudPoolKey,
  isPoolUnavailable,
  loadArchiveIndex,
  poolHoldsNoTeams,
  poolKeysNotStored,
  readCloudPoolValue,
} from "../teamRankingsStorage";
import { isEmptyLeague } from "./leagueMerge";
import { LEAGUE_PART, type Area } from "./cloudPlan";

export { LEAGUE_PART };

/**
 * This browser's data as the cloud copy sees it: every League Standings season as one value under
 * `league`, and the Team Rankings pool key by key, as it is stored (`cloudPoolKeys`), so a
 * nationwide pool travels as the compact values it already is and a change to one year sends that
 * year.
 *
 * The seasons travel without the one a device has open. That is the device's own, like its theme,
 * and carried in the copy it made switching seasons on a phone a change that collides with scores
 * entered on the laptop.
 */
export type LocalSource = {
  /** The keys of an area this device holds a value for. */
  keys: (area: Area) => string[];
  /** A key's value, or null for a key this device does not hold. */
  read: (key: string) => Promise<unknown>;
  /**
   * Writes the cloud copy's values here, null removing a key, as the copy's own arriving rather
   * than changes made here. Writes nothing, and says so, if any of it is not a value this device
   * knows how to hold; otherwise says whether all of it landed. `renamed` moves this device's open
   * season to the id a merge gave it (`leagueMerge.ts`).
   */
  apply: (
    values: ReadonlyMap<string, unknown>,
    options?: { renamed?: Readonly<Record<string, string>> }
  ) => Promise<boolean>;
  /**
   * Whether this device's stores can be read at all. One that cannot holds less than it has, and
   * syncs nothing until it can.
   */
  usable: () => boolean;
  /** Whether this device's data in an area is nothing anybody made (`cloudPlan.ts`). */
  empty: (area: Area) => boolean;
  /** Waits for writes still on their way to the store, and says whether they all landed. */
  flush: () => Promise<boolean>;
  /** Keys whose latest write the store refused: what this device holds is not what it shows. */
  notStored: () => ReadonlySet<string>;
};

const leagueNow = () => ({ seasons: readLeagueSnapshot().seasons });

/**
 * A pool with no teams and no archived season. An archive's tables cannot be made again once its
 * games are gone, so a pool holding only archives is somebody's work, and meeting a copy keeps it.
 */
const poolIsEmpty = (): boolean => poolHoldsNoTeams() && loadArchiveIndex().length === 0;

export const appLocalSource: LocalSource = {
  keys: (area) => (area === "league" ? [LEAGUE_PART] : cloudPoolKeys()),
  read: async (key) => (key === LEAGUE_PART ? leagueNow() : readCloudPoolValue(key)),
  usable: () => !isPoolUnavailable(),
  empty: (area) => (area === "league" ? isEmptyLeague(leagueNow()) : poolIsEmpty()),
  flush: flushPoolWrites,
  notStored: poolKeysNotStored,
  apply: async (values, { renamed = {} } = {}) => {
    const league = values.get(LEAGUE_PART);
    // A copy with no league value leaves the seasons alone: there is always at least one to open.
    const carriesLeague = league !== null && league !== undefined;
    // Read the way a backup file is, and before anything is written, so a malformed copy is
    // refused whole rather than landing as a new pool beside the old seasons.
    const parsed = carriesLeague ? coerceBackup(league) : null;
    if (carriesLeague && parsed?.kind !== "full") return false;
    // Every pool key is checked here too, before the seasons are written: the pool refuses a key it
    // does not keep, and by then the seasons would already be the copy's.
    const pool = new Map([...values].filter(([key]) => key !== LEAGUE_PART));
    if (isPoolUnavailable() && pool.size > 0) return false;
    if ([...pool.keys()].some((key) => !isCloudPoolKey(key))) return false;
    if (parsed?.kind === "full") {
      const open = getActiveSeasonId();
      // This device stays on the season it had open, under whatever id it now has.
      const replaced = replaceLeagueSnapshot(
        { activeSeasonId: renamed[open] ?? open, seasons: parsed.backup.seasons },
        { fromCloud: true }
      );
      if (!replaced) return false;
    }
    return pool.size === 0 || (await applyCloudPoolValues(pool));
  },
};
