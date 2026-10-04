import { withRulesMoved } from "./ageUnknown";
import { todayIsoDay } from "./date";
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
