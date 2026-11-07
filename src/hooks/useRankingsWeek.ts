import { useMemo } from "react";
import { recordVsExpected, withSeason } from "../lib/clubForm";
import type { AllKnown } from "../lib/live/allKnown";
import { myTeamGlance } from "../lib/myTeamGlance";
import { withGcIds } from "../lib/myTeamLook";
import {
  type AgeGroup,
  ageGroupYear,
  buildUpcomingSchedule,
  inSegment,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type UpcomingMatchup,
} from "../lib/teamRankings";
import type { SeasonSegment } from "../lib/teamRankings/seasons";
import { teamWeek, theWeekly } from "../lib/theWeekly";
import { weekMovers } from "../lib/thisWeek";
import type { LastWeek } from "./useRankingsWorker";

/**
 * The page's week and our team's: the board's movers since last week's places, the Weekly (the
 * upsets, the game ahead and the streaks of the half), our team's week, its record against the
 * clubs rated here beside the one its ratings expected, and where it stands and plays next.
 *
 * TeamRankingsView.tsx worked these out among its board's values. They moved here whole and are
 * called where they were, so their memos keep their place among the view's.
 */
export type RankingsWeekInputs = {
  ageGroups: AgeGroup[];
  allKnown: AllKnown;
  lastWeek: LastWeek | null;
  myTeamId: string | undefined;
  poolGames: ScoutGame[];
  rankedTeams: ScoutTeam[];
  rankings: ScoutRankingRow[];
  reportForId: string;
  selectedAgeGroupId: string;
  selectedSegment: SeasonSegment | undefined;
  today: string;
  upcomingRows: UpcomingMatchup[];
};

export function useRankingsWeek({
  ageGroups,
  allKnown,
  lastWeek,
  myTeamId,
  poolGames,
  rankedTeams,
  rankings,
  reportForId,
  selectedAgeGroupId,
  selectedSegment,
  today,
  upcomingRows,
}: RankingsWeekInputs) {
  /*
   * The page's week (`theWeekly`): the board's movers since last week's places, and the upsets,
   * the game ahead and the streaks from the half's games, as a published board carries them.
   */
  const thisWeek = useMemo(
    () => weekMovers(rankings, lastWeek?.ranks ?? null),
    [rankings, lastWeek]
  );
  const weekly = useMemo(
    () =>
      rankings.length > 0
        ? theWeekly(selectedAgeGroupId, rankings, poolGames, today, {
            year: ageGroupYear(ageGroups.find((group) => group.id === selectedAgeGroupId)),
            segment: selectedSegment,
          })
        : null,
    [rankings, selectedAgeGroupId, poolGames, today, ageGroups, selectedSegment]
  );
  const myWeek = useMemo(
    () => (myTeamId === undefined ? null : teamWeek(myTeamId, poolGames, rankings, today)),
    [myTeamId, poolGames, rankings, today]
  );
  // Its record against the clubs rated here, beside the one its ratings expected, over the half.
  const myExpected = useMemo(() => {
    if (myTeamId === undefined) return undefined;
    const year = ageGroupYear(ageGroups.find((group) => group.id === selectedAgeGroupId));
    const byId = new Map(rankings.map((row) => [row.teamId, row]));
    return recordVsExpected(
      myTeamId,
      poolGames.filter((game) => inSegment(game.date, year, selectedSegment)),
      (teamId) => byId.get(teamId),
      today
    );
  }, [myTeamId, ageGroups, selectedAgeGroupId, rankings, poolGames, selectedSegment, today]);

  /** The team marked as yours, where it stands on this page and what it plays next. */
  const myTeam = useMemo(() => {
    if (myTeamId === undefined) return null;
    const stateById = new Map(rankedTeams.map((team) => [team.id, team.state]));
    const upcoming =
      myTeamId === reportForId
        ? upcomingRows
        : buildUpcomingSchedule(myTeamId, rankings, poolGames, allKnown.teams, today);
    const stateOf = (teamId: string) => stateById.get(teamId);
    const glance = myTeamGlance(rankings, myTeamId, stateOf, upcoming, lastWeek?.ranks ?? null);
    // With its GameChanger ids, which its look is read by (`myTeamLook.ts`).
    const club = allKnown.teams.find((team) => team.id === myTeamId);
    return (
      glance &&
      withGcIds(
        withSeason(glance, rankings, stateOf, upcoming),
        club,
        selectedAgeGroupId,
        ageGroups
      )
    );
  }, [
    lastWeek,
    myTeamId,
    selectedAgeGroupId,
    ageGroups,
    reportForId,
    upcomingRows,
    rankings,
    rankedTeams,
    poolGames,
    allKnown.teams,
    today,
  ]);

  return { myExpected, myTeam, myWeek, thisWeek, weekly };
}
