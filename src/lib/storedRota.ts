import { withRulesMoved } from "./ageUnknown";
import { todayIsoDay } from "./date";
import { isDeletedClub } from "./deletedGames";
import { dueRefresh, idsPlayingAround, type DueRefresh } from "./gameChangerSchedule";
import { orgAgesByTeam, withOrgAges } from "./orgMembership";
import { segmentOn } from "./teamRankings/seasons";
import {
  loadAgeGroups,
  loadAgeUnknown,
  loadDroppedClubs,
  loadNamedAges,
  loadOrgMembership,
  loadRefreshCadence,
  loadRefreshLog,
  loadScoutGames,
  loadScoutTeams,
} from "./teamRankingsStorage";

/**
 * The teams the Refresh button would pull at `now`, from the settings the pool store holds: the
 * season being played, the cadence, the day log, the waiting list and the ages named for it, the
 * thrown-out clubs, and the teams with a game today, which are never held back. What the nightly
 * pulls (`cloudRunner.ts`), and what the live Import tab says it will (`import.status`), kept apart
 * from the pull itself so the question's code does not carry the whole pull with it.
 */
export const storedRota = (now: Date, force = false): DueRefresh => {
  const today = todayIsoDay(now);
  const ageless = loadAgeUnknown();
  const membership = loadOrgMembership();
  return dueRefresh(now, loadRefreshLog(), loadAgeGroups(), loadScoutTeams(), {
    seasonYear: segmentOn(today).year,
    ageless,
    cadence: loadRefreshCadence(),
    namedAges: withRulesMoved(
      withOrgAges(loadNamedAges(), orgAgesByTeam(membership), membership.savedAt),
      ageless
    ),
    refused: loadDroppedClubs(),
    force,
    playing: idsPlayingAround(loadScoutGames(), today),
  });
};

/** What "Refresh now" pulls: its teams, the levels they are for, and whether it is them again. */
export type RefreshNow = {
  teamIds: string[];
  /** The levels the run is for, which the copy's refresh log marks once every team was asked. */
  ageLevels: number[];
  /** Teams of those levels held back for having been pulled within `MIN_PULL_GAP_HOURS`. */
  heldBack: number;
  /** Whether today's levels had been refreshed already, so the run is them again. */
  again: boolean;
};

/**
 * What the live Import tab's "Refresh now" pulls at `now` (README, "Refresh now"): the refresh the
 * nightly would run now, while today's levels are still to do; once they are done, those levels
 * again, as the device's own button runs a finished day again (`force`). Either way held to
 * `MIN_PULL_GAP_HOURS`, which `dueRefresh` keeps to when forced too, and without the clubs thrown
 * out, which the pull would skip without asking (`runCloudPull`). The card's count and the list
 * the cloud walks are both this one call, so what the card says is what is pulled.
 *
 * `tonight` is the nightly's own answer where the caller has worked it out already.
 */
export const refreshNow = (now: Date, tonight: DueRefresh = storedRota(now)): RefreshNow => {
  const again = tonight.ageLevels.length === 0;
  const due = again ? storedRota(now, true) : tonight;
  const dropped = loadDroppedClubs();
  return {
    teamIds: due.teamIds.filter((teamId) => !isDeletedClub(dropped, teamId)),
    ageLevels: due.ageLevels,
    heldBack: due.heldBack,
    again,
  };
};
