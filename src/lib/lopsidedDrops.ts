import type { AutoRemovals } from "./autoRemoved";
import type { ScoutTeam } from "./teamRankings";
import { clubsByGcId } from "./unrealClubs";

/**
 * The clubs a sweep's marks say to delete outright, as Delete club deletes one (`club.drop`): every
 * club marked for a game its own schedule reports won or lost by `LOPSIDED_MARGIN` or more (sign H,
 * `hundred`). The owner's rule of 27 October 2026: "40+ run win or loss should equate to auto
 * deletion ... of the entire team, because they are clearly fake". The club goes with every game it
 * is in, and its GameChanger ids are remembered, so a later pull refuses them; every other sign
 * stays a mark, taken off the boards for the owner to put back or delete.
 *
 * Never a club `spared` names by its club id or any of its GameChanger ids: those said to be real,
 * and those a League Standings team links (`leagueLinkedClubsOf`), as the tidy deletes none of them
 * (`sparedByTidy`), since a club deleted under a season's pick leaves the pick pointing at nothing.
 * The sweep marks no club the owner vouched for, so the first only matters for a word given since.
 */
export const lopsidedDrops = (
  marks: AutoRemovals,
  teams: readonly ScoutTeam[],
  spared: ReadonlySet<string>
): string[] => {
  const clubOfGcId = clubsByGcId(teams);
  const byId = new Map(teams.map((team) => [team.id, team]));
  const drops = new Set<string>();
  marks.forEach((mark, gcId) => {
    if (!mark.signs.includes("hundred")) return;
    const clubId = clubOfGcId.get(gcId);
    if (clubId === undefined || spared.has(clubId)) return;
    if ((byId.get(clubId)?.gcTeams ?? []).some((link) => spared.has(link.teamId))) return;
    drops.add(clubId);
  });
  return [...drops];
};
