import { buildStaffIndex, sharedStaff } from "./gcStaff";
import { teamNameKey, type ScoutTeam } from "./teamRankings";

/**
 * How many other pulled clubs of a name, all in one state, say where a club of that name with no
 * state is, with nothing else to go on. On the backup of 11 October 2026, a club with a state
 * whose name's other clubs were all in one state was in that state 98.3% of the time where there
 * were three or more of them, 95.8% where there were two and 89.9% where there was one.
 */
const NAMESAKES_TO_AGREE = 3;

/** Lower-cased for comparing; GameChanger's towns arrive as typed. */
const townKey = (city: string | undefined): string | undefined =>
  city?.trim().toLowerCase() || undefined;

/**
 * Fills in the state of a pulled club GameChanger gave none, from the club's other teams: the
 * pulled clubs sharing two or more coaches with it (`gcStaff.ts`), the clubs of its name in its
 * own town, and failing those the clubs of its name, three or more, all in one state. Any of the
 * three answering two states, or two of them answering differently, leaves it without one.
 *
 * A club's 9U page often says nothing of where it is while its 14U page does, and the tidy reads
 * a club with no state as being nowhere: a stand-in it named is filed onto a club only where that
 * club is in the namer's state or next door (`refileStandIns`), so none of its stand-ins ever was.
 * On the backup of 11 October 2026, 3,033 of the 68,919 pulled clubs had no state, and 4,316 rows
 * stood on stand-ins they had named. Tried on the 65,886 clubs that had one, the rule gave 25,715
 * of them a state and gave the right one to 25,498 (99.2%): the coaches 99.2% of the time, the
 * name and town 99.7%. It gave 372 of the 3,033 a state.
 *
 * A pull never writes the state of a club already in the pool, so a state filled here stands
 * until the owner changes it, as one GameChanger gave would.
 */
export const fillMissingStates = (teams: ScoutTeam[]): { teams: ScoutTeam[]; filled: number } => {
  const pulled = teams.filter((team) => team.gcTeams?.length);
  if (!pulled.some((team) => !team.state)) return { teams, filled: 0 };

  const clubOfLink = new Map<string, ScoutTeam>();
  pulled.forEach((team) => team.gcTeams?.forEach((link) => clubOfLink.set(link.teamId, team)));
  const staff = buildStaffIndex(
    pulled.flatMap((team) =>
      (team.gcTeams ?? []).map((link) => ({ teamId: link.teamId, staff: link.staff }))
    )
  );
  const byName = new Map<string, ScoutTeam[]>();
  pulled.forEach((team) => {
    if (!team.state) return;
    const key = teamNameKey(team.name);
    const bucket = byName.get(key);
    if (bucket) bucket.push(team);
    else byName.set(key, [team]);
  });

  /** The states of the clubs sharing two or more coaches with one of `club`'s GameChanger teams. */
  const statesByStaff = (club: ScoutTeam): Set<string> => {
    const states = new Set<string>();
    club.gcTeams?.forEach((link) =>
      (staff.staffByTeam.get(link.teamId) ?? []).forEach((key) =>
        (staff.teamsByStaff.get(key) ?? []).forEach((other) => {
          const mate = clubOfLink.get(other);
          if (!mate?.state || mate.id === club.id) return;
          if (sharedStaff(link.teamId, other, staff).length >= 2) states.add(mate.state);
        })
      )
    );
    return states;
  };
  const only = (states: Set<string>): string | undefined =>
    states.size === 1 ? [...states][0] : undefined;

  const stateOf = (club: ScoutTeam): string | undefined => {
    const byCoaches = statesByStaff(club);
    const namesakes = (byName.get(teamNameKey(club.name)) ?? []).filter(
      (other) => other.id !== club.id
    );
    const town = townKey(club.city);
    const inTown = new Set(
      namesakes
        .filter((other) => town !== undefined && townKey(other.city) === town)
        .map((other) => other.state!)
    );
    if (byCoaches.size > 1 || inTown.size > 1) return undefined;
    const named = new Set(namesakes.map((other) => other.state!));
    const answers = new Set(
      [
        only(byCoaches),
        only(inTown),
        namesakes.length >= NAMESAKES_TO_AGREE ? only(named) : undefined,
      ].filter((state): state is string => state !== undefined)
    );
    return only(answers);
  };

  let filled = 0;
  const next = teams.map((team) => {
    if (team.state || !team.gcTeams?.length) return team;
    const state = stateOf(team);
    if (!state) return team;
    filled += 1;
    return { ...team, state };
  });
  return filled === 0 ? { teams, filled: 0 } : { teams: next, filled };
};
