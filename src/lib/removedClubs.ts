import type { AgeGroup, ScoutTeam } from "./teamRankings/types";
import type { AutoRemovals } from "./autoRemoved";

/**
 * Which clubs the marks of clubs plainly made up (`autoRemoved.ts`) take off: kept apart from the
 * marks themselves, which storage reads on every visit, League Standings' alone included, while
 * this is read only where the boards are derived, Pool health is drawn and a list is published.
 */

/**
 * The clubs `marks` take off: those with GameChanger ids, every one of them marked, that are no
 * page's own team. A club folded together from a marked id and an unmarked one stands, and the
 * user's own team stands whatever is said of it. A League Standings team linked to a club keeps it
 * too, which only a pass that reads League Standings can tell (`deriveAllKnown`, or
 * `leagueKeptClubs` for the whole pool): such a caller names those clubs in `leagueKept`.
 */
export const removedClubIds = (
  teams: readonly ScoutTeam[],
  ageGroups: readonly AgeGroup[],
  marks: AutoRemovals,
  leagueKept: ReadonlySet<string> = new Set()
): Set<string> => {
  const removed = new Set<string>();
  if (marks.size === 0) return removed;
  const mine = new Set(ageGroups.flatMap((group) => (group.myTeamId ? [group.myTeamId] : [])));
  teams.forEach((team) => {
    const links = team.gcTeams ?? [];
    if (links.length === 0 || mine.has(team.id) || leagueKept.has(team.id)) return;
    if (links.every((link) => marks.has(link.teamId))) removed.add(team.id);
  });
  return removed;
};

/** Each marked GameChanger id and the day it was marked, as Find a team says where an id went. */
export const removedDays = (marks: AutoRemovals): Map<string, string> =>
  new Map([...marks].map(([id, mark]) => [id, mark.on]));
