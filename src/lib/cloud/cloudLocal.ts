import { coerceBackup } from "../backup";
import { readLeagueSnapshot, replaceLeagueSnapshot } from "../storage";
import {
  applyCloudPoolValues,
  cloudPoolKeys,
  poolHoldsNoTeams,
  readCloudPoolValue,
} from "../teamRankingsStorage";
import type { LocalSource } from "./cloudEngine";

/**
 * This browser's data as the cloud copy sees it: every League Standings season as one value under
 * `league`, and the Team Rankings pool key by key, as it is stored (`cloudPoolKeys`), so a nationwide
 * pool travels as the compact values it already is and a change to one year sends that year.
 */
export const LEAGUE_PART = "league";

export const appLocalSource: LocalSource = {
  keys: () => [LEAGUE_PART, ...cloudPoolKeys()],
  read: async (key) => (key === LEAGUE_PART ? readLeagueSnapshot() : readCloudPoolValue(key)),
  apply: async (values) => {
    const league = values.get(LEAGUE_PART);
    // A copy with no league value leaves the seasons alone: there is always at least one to open.
    const carriesLeague = league !== null && league !== undefined;
    // Read the way a backup file is, and before anything is written, so a malformed copy is
    // refused whole rather than landing as a new pool beside the old seasons.
    const parsed = carriesLeague ? coerceBackup(league) : null;
    if (carriesLeague && parsed?.kind !== "full") return false;
    if (
      parsed?.kind === "full" &&
      !replaceLeagueSnapshot({
        activeSeasonId: parsed.backup.activeSeasonId,
        seasons: parsed.backup.seasons,
      })
    ) {
      return false;
    }
    const pool = new Map([...values].filter(([key]) => key !== LEAGUE_PART));
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
