import { coerceBackup } from "../backup";
import { getActiveSeasonId, readLeagueSnapshot, replaceLeagueSnapshot } from "../storage";
import {
  applyCloudPoolValues,
  cloudPoolKeys,
  isCloudPoolKey,
  isPoolUnavailable,
  poolHoldsNoTeams,
  readCloudPoolValue,
} from "../teamRankingsStorage";
import type { LocalSource } from "./cloudEngine";

/**
 * This browser's data as the cloud copy sees it: every League Standings season as one value under
 * `league`, and the Team Rankings pool key by key, as it is stored (`cloudPoolKeys`), so a nationwide
 * pool travels as the compact values it already is and a change to one year sends that year.
 *
 * The seasons travel without the one a device has open. That is the device's own, like its theme,
 * and carried in the copy it made switching seasons on a phone a change that collides with scores
 * entered on the laptop.
 */
export const LEAGUE_PART = "league";

export const appLocalSource: LocalSource = {
  keys: () => [LEAGUE_PART, ...cloudPoolKeys()],
  read: async (key) =>
    key === LEAGUE_PART ? { seasons: readLeagueSnapshot().seasons } : readCloudPoolValue(key),
  usable: () => !isPoolUnavailable(),
  apply: async (values) => {
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
    if (isPoolUnavailable() || [...pool.keys()].some((key) => !isCloudPoolKey(key))) return false;
    if (
      parsed?.kind === "full" &&
      // This device stays on the season it had open, where the copy still has it.
      !replaceLeagueSnapshot({
        activeSeasonId: getActiveSeasonId(),
        seasons: parsed.backup.seasons,
      })
    ) {
      return false;
    }
    return pool.size === 0 || (await applyCloudPoolValues(pool));
  },
};

/**
 * Whether this browser holds nothing a cloud copy could throw away: no season with a team or a
 * game, and no team in the pool. Such a browser takes the cloud copy without being asked.
 */
export const localHoldsNothing = (): boolean =>
  readLeagueSnapshot().seasons.every(
    (season) => season.teams.length === 0 && season.matchups.length === 0
  ) && poolHoldsNoTeams();
