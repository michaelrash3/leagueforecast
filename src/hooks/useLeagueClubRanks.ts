import { useEffect } from "react";
import { clubRankPage, leagueClubRanksFrom, writeLeagueClubRanks } from "../lib/leagueClubRanks";
import type { AllKnown } from "../lib/live/allKnown";
import {
  type AgeGroup,
  ageGroupLevel,
  ageGroupYear,
  type ScoutRankingRow,
  type ScoutTeam,
  segmentLabel,
} from "../lib/teamRankings";
import type { ClubLookup } from "../lib/teamRankings/leagueBridge";
import type { SeasonSegment } from "../lib/teamRankings/seasons";
import type { LastWeek } from "./useRankingsWorker";

/**
 * Where the clubs of the league seasons a page claims stand on it, written for League Standings'
 * "Our team" card (`leagueClubRanksFrom`), which has no board of its own to read: off a board that
 * is this page's and settled, and only off a half the season plays its games in.
 *
 * TeamRankingsView.tsx ran this effect among its board's values. It moved here whole and is called
 * where it was, so it runs in the order it did. It hands nothing back.
 */
export type LeagueClubRanksInputs = {
  ageGroups: AgeGroup[];
  allKnown: AllKnown;
  fieldClubs: { lookup: ClubLookup; gcOf: (teamId: string) => string[] | undefined };
  lastWeek: LastWeek | null;
  rankedTeams: ScoutTeam[];
  rankings: ScoutRankingRow[];
  rankingsStale: boolean;
  selectedAgeGroupId: string;
  selectedSegment: SeasonSegment | undefined;
  selectedYear: number | undefined;
};

export function useLeagueClubRanks({
  ageGroups,
  allKnown,
  fieldClubs,
  lastWeek,
  rankedTeams,
  rankings,
  rankingsStale,
  selectedAgeGroupId,
  selectedSegment,
  selectedYear,
}: LeagueClubRanksInputs) {
  /**
   * Where the clubs of the league seasons this page claims stand on it, written for League
   * Standings' "Our team" card (`leagueClubRanksFrom`), which cannot fit a board of its own. Only
   * off a board that is this page's and settled, so a switch between pages never writes one page's
   * places under another's seasons. A settled board with nobody on it is written too: it takes
   * away places the card would otherwise go on showing.
   *
   * And only off a half the season plays its games in. A fall league's clubs are on the fall
   * board; the spring one, with none of the league's games on it, took away the places the card
   * was showing the moment anybody looked at it, as a board opened on the spring in January did.
   */
  useEffect(() => {
    if (rankingsStale) return;
    const group = ageGroups.find((one) => one.id === selectedAgeGroupId);
    if (!group || group.seasonIds.length === 0) return;
    const stateById = new Map(rankedTeams.map((team) => [team.id, team.state]));
    const board =
      selectedSegment === undefined || selectedYear === undefined
        ? group.name
        : `${group.name} · ${segmentLabel(selectedYear, selectedSegment)}`;
    const at = new Date().toISOString();
    const page = clubRankPage(ageGroupLevel(group), ageGroupYear(group), selectedSegment);
    group.seasonIds.forEach((seasonId) => {
      const clubs = allKnown.leagueClubs.get(group.id)?.get(seasonId);
      if (!clubs) return;
      const halves = allKnown.leagueHalves.get(group.id)?.get(seasonId);
      if (selectedSegment !== undefined && halves && halves.size > 0) {
        if (!halves.has(selectedSegment)) return;
      }
      writeLeagueClubRanks(
        seasonId,
        leagueClubRanksFrom(
          rankings,
          clubs,
          (teamId) => stateById.get(teamId),
          lastWeek?.ranks ?? null,
          board,
          at,
          page,
          fieldClubs.gcOf
        )
      );
    });
  }, [
    rankings,
    rankingsStale,
    rankedTeams,
    ageGroups,
    selectedAgeGroupId,
    selectedSegment,
    selectedYear,
    allKnown.leagueClubs,
    allKnown.leagueHalves,
    lastWeek,
    fieldClubs,
  ]);
}
