import { useMemo } from "react";
import { eliminationNumberForGold, magicForGold } from "../lib/magic";
import { EXACT_MAGIC_REMAINING_GAME_LIMIT } from "../lib/searchLimits";
import { buildTeamSplitSummary, emptySplitLine } from "../lib/teamStats";
import { buildTeamTrendSummary } from "../lib/teamTrend";
import type { GameLog, Matchup, Settings, TeamWithProjection } from "../lib/types";
import type { useGoldRace } from "./useGoldRace";
import type { SeedRange } from "./useSeedRanges";

/**
 * The team open in the drawer, and the one it is compared with: its row of the table, its home and
 * away split and its trend over the season, and the drawer's detail, which is its bubble tier,
 * schedule strength, Gold % as the table words it, seed range, next two swing games, title race,
 * clinch scenarios and its magic and elimination numbers while those searches are quick.
 *
 * App.tsx worked these out under "Header / selection". The detail's memo sat further down, after
 * "Since you last looked"; it reads nothing declared in between, so it moved up beside the team it
 * details, and then all of them moved here whole. The split's and trend's memos keep their place
 * among App's; the detail's now runs before Our team's, the season's final and the digest's.
 */
export type SelectedTeamInputs = {
  bubbleTierForTeam: ReturnType<typeof useGoldRace>["bubbleTierForTeam"];
  clinchScenariosForTeam: ReturnType<typeof useGoldRace>["clinchScenariosForTeam"];
  compareTeamId: string | null;
  currentSosRanks: Record<string, number>;
  dashboardById: Map<string, TeamWithProjection>;
  dashboardRows: TeamWithProjection[];
  formatGoldPct: ReturnType<typeof useGoldRace>["formatGoldPct"];
  goldCutoff: number;
  logs: Record<string, GameLog>;
  matchups: Matchup[];
  nextTwoSwingGames: ReturnType<typeof useGoldRace>["nextTwoSwingGames"];
  remainingGames: Matchup[];
  runsOnly: boolean;
  scheduleDifficultyForTeam: ReturnType<typeof useGoldRace>["scheduleDifficultyForTeam"];
  searchedCount: number;
  seasonSettings: Settings;
  seedRangeForTeam: (teamId: string) => SeedRange;
  selectedTeamId: string | null;
  titleRaceBadgeForTeam: ReturnType<typeof useGoldRace>["titleRaceBadgeForTeam"];
};

export function useSelectedTeam({
  bubbleTierForTeam,
  clinchScenariosForTeam,
  compareTeamId,
  currentSosRanks,
  dashboardById,
  dashboardRows,
  formatGoldPct,
  goldCutoff,
  logs,
  matchups,
  nextTwoSwingGames,
  remainingGames,
  runsOnly,
  scheduleDifficultyForTeam,
  searchedCount,
  seasonSettings,
  seedRangeForTeam,
  selectedTeamId,
  titleRaceBadgeForTeam,
}: SelectedTeamInputs) {
  const selectedTeam = selectedTeamId ? (dashboardById.get(selectedTeamId) ?? null) : null;
  const selectedTeamSplitSummary = useMemo(
    () =>
      selectedTeam
        ? buildTeamSplitSummary(selectedTeam.id, matchups, logs)
        : {
            all: emptySplitLine("Overall"),
            home: emptySplitLine("Home"),
            away: emptySplitLine("Away"),
          },
    [selectedTeam, matchups, logs]
  );
  const selectedTeamTrendSummary = useMemo(
    () =>
      selectedTeam
        ? buildTeamTrendSummary(selectedTeam.id, matchups, logs, runsOnly)
        : buildTeamTrendSummary("", [], {}, runsOnly),
    [selectedTeam, matchups, logs, runsOnly]
  );
  const compareTeam = compareTeamId ? (dashboardById.get(compareTeamId) ?? null) : null;
  const selectedTeamDetail = useMemo(() => {
    if (!selectedTeam) return null;
    const swings = nextTwoSwingGames(selectedTeam.id);
    return {
      bubble: bubbleTierForTeam(selectedTeam),
      currentSosRank: currentSosRanks[selectedTeam.id] ?? null,
      goldPctLabel: formatGoldPct(selectedTeam),
      range: seedRangeForTeam(selectedTeam.id),
      sos: scheduleDifficultyForTeam(selectedTeam.id),
      swings,
      titleRace: titleRaceBadgeForTeam(selectedTeam),
      clinchScenarios: clinchScenariosForTeam(selectedTeam.id),
      magic:
        searchedCount <= EXACT_MAGIC_REMAINING_GAME_LIMIT
          ? magicForGold(selectedTeam.id, dashboardRows, remainingGames, goldCutoff, seasonSettings)
          : {
              type: "magic" as const,
              ownWinsNeeded: 0,
              opponentLossesNeeded: 0,
              description: `Exact magic number is paused until ${EXACT_MAGIC_REMAINING_GAME_LIMIT} or fewer games remain to keep team modals responsive.`,
            },
      elimination:
        searchedCount <= EXACT_MAGIC_REMAINING_GAME_LIMIT
          ? eliminationNumberForGold(
              selectedTeam.id,
              dashboardRows,
              remainingGames,
              goldCutoff,
              seasonSettings
            )
          : {
              type: "elimination" as const,
              ownWinsNeeded: 0,
              opponentLossesNeeded: 0,
              description: `Exact elimination number is paused until ${EXACT_MAGIC_REMAINING_GAME_LIMIT} or fewer games remain to keep team modals responsive.`,
            },
    };
  }, [
    selectedTeam,
    nextTwoSwingGames,
    bubbleTierForTeam,
    currentSosRanks,
    formatGoldPct,
    seedRangeForTeam,
    scheduleDifficultyForTeam,
    titleRaceBadgeForTeam,
    clinchScenariosForTeam,
    dashboardRows,
    searchedCount,
    remainingGames,
    goldCutoff,
    seasonSettings,
  ]);

  return {
    compareTeam,
    selectedTeam,
    selectedTeamDetail,
    selectedTeamSplitSummary,
    selectedTeamTrendSummary,
  };
}
