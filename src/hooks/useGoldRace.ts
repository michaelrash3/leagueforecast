import { useCallback, useMemo } from "react";
import { clinchingPathsForTeams, goldCutLineSnapshot } from "../lib/clinchingPaths";
import { formatGameDate } from "../lib/date";
import { displayName } from "../lib/format";
import { seasonDaysFromToday } from "../lib/leagueFindings";
import { rememberLast } from "../lib/rememberLast";
import { scheduleDifficultyForTeam as buildScheduleDifficultyForTeam } from "../lib/scheduleDifficulty";
import { EXACT_MAGIC_REMAINING_GAME_LIMIT } from "../lib/searchLimits";
import { buildSeasonTimeline, type SeasonTimelineEntry } from "../lib/seasonTimeline";
import { predictGame } from "../lib/sim";
import {
  formatGoldPct as formatGoldPctValue,
  titleRaceBadgeForTeam as titleRaceBadgeForTeamValue,
} from "../lib/standingsView";
import { inPlayingOrder } from "../lib/stillToCome";
import type {
  ActiveShareView,
  GameLog,
  Matchup,
  Settings,
  SwingGame,
  Team,
  TeamBase,
  TeamWithProjection,
} from "../lib/types";
import { clamp } from "../lib/util";
import { raceBadgeClasses, raceToneForTeam, raceToneWords } from "../styles/raceTone";
import { useClinchScenarios } from "./useClinchScenarios";
import { useSeedRanges } from "./useSeedRanges";

/*
 * The Forecast's timeline remembers its last answer, so going back to the tab on an unchanged
 * season gives it at once (`rememberLast`, 2.2); and stands empty while the tab is not open. The
 * backtest, the other calculation one tab alone shows, does the same in App.tsx.
 */
const rememberedTimeline = rememberLast(buildSeasonTimeline);
const NO_TIMELINE: SeasonTimelineEntry[] = [];

/**
 * The race for the Gold cut line as League Standings reads it: each team's next two games and the
 * seed either result leaves it at, its clinching paths, how hard what it has left is, the games
 * that matter most and what one result would do to the table, and the words, tiers and badges a
 * row is drawn with.
 *
 * App.tsx worked all of this out among its other sections, under "Scenario helpers". It moved here
 * whole and is called where it was, so its memos, its callbacks and the two hooks it calls keep
 * their place among App's, and every view reads the same values it did.
 */
export type GoldRaceInputs = {
  activeView: ActiveShareView;
  dashboardById: Map<string, TeamWithProjection>;
  dashboardRows: TeamWithProjection[];
  exactScenarioAnalysisEnabled: boolean;
  finalLogs: Record<string, GameLog>;
  goldCutoff: number;
  hasCutLine: boolean;
  liveById: Map<string, Team>;
  liveTeams: Team[];
  matchups: Matchup[];
  projectedById: Map<string, Team & { rank: number }>;
  ranked: (Team & { rank: number })[];
  remainingCounts: Record<string, number>;
  remainingGames: Matchup[];
  seasonSettings: Settings;
  seasonStart: number;
  seedWalkEnabled: boolean;
  settings: Settings;
  teamBaseById: Map<string, TeamBase>;
  teams: TeamBase[];
  today: Date;
};

export function useGoldRace({
  activeView,
  dashboardById,
  dashboardRows,
  exactScenarioAnalysisEnabled,
  finalLogs,
  goldCutoff,
  hasCutLine,
  liveById,
  liveTeams,
  matchups,
  projectedById,
  ranked,
  remainingCounts,
  remainingGames,
  seasonSettings,
  seasonStart,
  seedWalkEnabled,
  settings,
  teamBaseById,
  teams,
  today,
}: GoldRaceInputs) {
  // The season's dates on one timeline, so a game whose date has passed is known for one.
  const daysFromToday = useMemo(
    () =>
      seasonDaysFromToday(
        matchups.map((game) => game.date),
        today
      ),
    [matchups, today]
  );

  const { seedForScenario, seedRangeForTeam } = useSeedRanges({
    exact: seedWalkEnabled,
    liveTeams,
    remainingGames,
    settings: seasonSettings,
    projectedById,
    ranked,
  });

  const nextTwoSwingGames = useCallback(
    (teamId: string): SwingGame[] => {
      // A rained-out game still on its old date comes after the games that will be played first.
      return inPlayingOrder(
        remainingGames.filter((game) => game.away === teamId || game.home === teamId),
        daysFromToday
      )
        .slice(0, 2)
        .map((game) => {
          const teamIsAway = game.away === teamId;
          const opponentId = teamIsAway ? game.home : game.away;
          const opponentName = displayName(teamBaseById.get(opponentId)?.name || opponentId);
          const prediction = predictGame(game, liveTeams, settings, liveById);
          const baselineSeed =
            projectedById.get(teamId)?.rank ??
            ranked.find((item) => item.id === teamId)?.rank ??
            99;
          const winSeed = seedWalkEnabled ? seedForScenario(teamId, game, teamId) : baselineSeed;
          const lossSeed = seedWalkEnabled
            ? seedForScenario(teamId, game, opponentId)
            : baselineSeed;
          const teamWinPct = teamIsAway ? prediction.awayWinPct : 1 - prediction.awayWinPct;
          const modelPick = displayName(
            teamBaseById.get(prediction.winnerId)?.name || prediction.winnerId
          );
          return {
            game,
            opponentName,
            teamIsAway,
            winSeed,
            lossSeed,
            modelPick,
            winPct: teamWinPct,
          };
        });
    },
    [
      remainingGames,
      daysFromToday,
      teamBaseById,
      liveTeams,
      settings,
      liveById,
      projectedById,
      ranked,
      seedWalkEnabled,
      seedForScenario,
    ]
  );

  const clinchingPaths = useMemo(
    () =>
      activeView === "model"
        ? clinchingPathsForTeams(
            dashboardRows,
            remainingGames,
            goldCutoff,
            seasonSettings,
            nextTwoSwingGames,
            {
              limit: 8,
              exactLimit: EXACT_MAGIC_REMAINING_GAME_LIMIT,
              daysFromToday,
            }
          )
        : [],
    [
      activeView,
      dashboardRows,
      remainingGames,
      goldCutoff,
      seasonSettings,
      nextTwoSwingGames,
      daysFromToday,
    ]
  );

  const cutLineSnapshot = useMemo(
    () => goldCutLineSnapshot(dashboardRows, goldCutoff, settings),
    [dashboardRows, goldCutoff, settings]
  );

  // The Forecast's timeline, which plays the season through game by game: as heavy as the
  // backtest, and only the Forecast shows it (2.2).
  const timelineEntries = useMemo(
    () =>
      activeView === "model"
        ? rememberedTimeline(teams, matchups, finalLogs, seasonSettings, 6)
        : NO_TIMELINE,
    [activeView, teams, matchups, finalLogs, seasonSettings]
  );

  const bubbleTierForTeam = useCallback(
    (team: TeamWithProjection) => {
      if (team.goldStatus === "Clinched") return "Locked In";
      if (team.goldStatus === "Eliminated") return "Eliminated";
      const currentSeed = team.rank ?? 99;
      const projectedSeed = team.projectedRank ?? 99;
      if (currentSeed <= goldCutoff - 2 && projectedSeed <= goldCutoff && team.goldPct >= 80) {
        return "Likely In";
      }
      if (currentSeed <= goldCutoff || projectedSeed <= goldCutoff) return "Bubble In";
      const cutoffRow = dashboardRows[Math.min(goldCutoff - 1, dashboardRows.length - 1)] ?? team;
      if (team.goldPct >= 20 || projectedSeed <= goldCutoff + 2 || team.maxPct >= cutoffRow.pct) {
        return "Bubble Out";
      }
      return "Long Shot";
    },
    [goldCutoff, dashboardRows]
  );

  const scheduleDifficultyForTeam = useCallback(
    (teamId: string) =>
      buildScheduleDifficultyForTeam(teamId, remainingGames, dashboardRows, matchups, finalLogs),
    [remainingGames, dashboardRows, matchups, finalLogs]
  );

  const gameImportance = useCallback(
    (game: Matchup) => {
      const away = dashboardById.get(game.away);
      const home = dashboardById.get(game.home);
      if (!away || !home) return 0;
      const seedScore = (team: TeamWithProjection) =>
        Math.max(0, 8 - Math.abs((team.rank ?? 99) - goldCutoff));
      const oddsScore = (team: TeamWithProjection) =>
        Math.max(0, 50 - Math.abs(team.goldPct - 50)) / 10;
      const projectedScore = (team: TeamWithProjection) =>
        Math.max(0, 5 - Math.abs((team.projectedRank ?? 99) - goldCutoff));
      return (
        seedScore(away) +
        seedScore(home) +
        oddsScore(away) +
        oddsScore(home) +
        projectedScore(away) +
        projectedScore(home)
      );
    },
    [dashboardById, goldCutoff]
  );

  const getGameScenarioImpactMap = useMemo(() => {
    const map = new Map<
      string,
      {
        awaySeedWin: number;
        awaySeedLoss: number;
        homeSeedWin: number;
        homeSeedLoss: number;
        seedImpact: number;
        impactLabel: "High" | "Medium" | "Low";
        awayGoldSwing: number;
        homeGoldSwing: number;
        awayName: string;
        homeName: string;
      }
    >();
    if (!exactScenarioAnalysisEnabled) return map;
    remainingGames.forEach((game) => {
      const prediction = predictGame(game, liveTeams, settings, liveById);
      const away = dashboardById.get(game.away);
      const home = dashboardById.get(game.home);
      const awaySeedWin = seedForScenario(game.away, game, game.away);
      const awaySeedLoss = seedForScenario(game.away, game, game.home);
      const homeSeedWin = seedForScenario(game.home, game, game.home);
      const homeSeedLoss = seedForScenario(game.home, game, game.away);
      const seedImpact = Math.max(
        Math.abs(awaySeedWin - awaySeedLoss),
        Math.abs(homeSeedWin - homeSeedLoss)
      );
      const impactLabel: "High" | "Medium" | "Low" =
        seedImpact >= 3 ? "High" : seedImpact >= 1 ? "Medium" : "Low";
      const awayGoldSwing = clamp(
        (awaySeedLoss - awaySeedWin) * 8 + (prediction.winnerId === game.away ? 4 : -4),
        -25,
        25
      );
      const homeGoldSwing = clamp(
        (homeSeedLoss - homeSeedWin) * 8 + (prediction.winnerId === game.home ? 4 : -4),
        -25,
        25
      );
      map.set(game.id, {
        awaySeedWin,
        awaySeedLoss,
        homeSeedWin,
        homeSeedLoss,
        seedImpact,
        impactLabel,
        awayGoldSwing,
        homeGoldSwing,
        awayName: displayName(away?.name || game.away),
        homeName: displayName(home?.name || game.home),
      });
    });
    return map;
  }, [
    exactScenarioAnalysisEnabled,
    remainingGames,
    liveTeams,
    settings,
    liveById,
    dashboardById,
    seedForScenario,
  ]);

  /**
   * What one more result would do to the table: who clinches, who goes out, what a game is worth.
   *
   * Seven of these, all the same shape — play the game forward, rank what comes out, ask the
   * clinching maths — and they sat here among everything else App does. Out in a hook they are a
   * closed question over the season, and they have a test, which they did not before.
   */
  const { gameStatusForGame } = useClinchScenarios({
    liveTeams,
    settings: seasonSettings,
    remainingGames,
    seasonStart,
    goldCutoff,
    hasCutLine,
    dashboardById,
    scenarioImpact: getGameScenarioImpactMap,
  });

  const gameStatusClasses = (label: string) => {
    if (label.startsWith("Title Clinch-")) return "bg-purple-100 text-purple-700";
    if (label.startsWith("Clinch Game-")) return "bg-emerald-100 text-emerald-700";
    if (label.startsWith("Clinch Watch-")) return "bg-teal-100 text-teal-700";
    if (label.startsWith("Clinch Scenario:")) return "bg-emerald-100 text-emerald-700";
    if (label.startsWith("Elimination Game-")) return "bg-red-100 text-red-700";
    if (label.startsWith("Elimination Scenario:")) return "bg-red-100 text-red-700";
    if (label === "High Impact") return "bg-amber-100 text-amber-700";
    if (label === "Bubble Game" || label === "Seeding Game") return "bg-blue-100 text-blue-700";
    return "bg-slate-200 text-slate-600";
  };

  // The Forecast's list alone, and the clinch questions behind each line are not free (2.2).
  const gamesThatMatterMost = useMemo(() => {
    if (activeView !== "model") return [];
    return [...remainingGames]
      .sort((a, b) => gameImportance(b) - gameImportance(a))
      .slice(0, 5)
      .map((game, index) => {
        const away = dashboardById.get(game.away);
        const home = dashboardById.get(game.home);
        const impact = getGameScenarioImpactMap.get(game.id);
        const status = gameStatusForGame(game);
        const reason =
          status === "Low Impact"
            ? `${impact?.impactLabel ?? "Low"} projected seed impact`
            : status;
        return {
          game,
          rank: index + 1,
          label: `${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`,
          reason,
          date: formatGameDate(game.date),
        };
      });
  }, [
    activeView,
    remainingGames,
    dashboardById,
    getGameScenarioImpactMap,
    gameStatusForGame,
    gameImportance,
  ]);

  const clinchScenariosForTeam = useCallback(
    (teamId: string) => {
      const team = dashboardById.get(teamId);
      if (!team) return [];
      const teamName = displayName(team.name);

      if (team.goldStatus === "Clinched")
        return [`${teamName} have already clinched a Gold Bracket spot.`];
      if (team.goldStatus === "Eliminated")
        return [`${teamName} are eliminated from Gold Bracket contention.`];

      const scenarios = nextTwoSwingGames(teamId)
        .slice(0, 2)
        .map((swing) => {
          const opponentLine = `${swing.teamIsAway ? "at" : "vs"} ${swing.opponentName}`;
          if (swing.winSeed <= goldCutoff && swing.lossSeed > goldCutoff) {
            return `${opponentLine}: win projects inside the Gold cut line at #${swing.winSeed}; loss drops outside the Gold cut line at #${swing.lossSeed}.`;
          }
          if (swing.winSeed <= goldCutoff && swing.lossSeed <= goldCutoff) {
            return `${opponentLine}: win improves or protects the Gold Bracket path at #${swing.winSeed}; loss still projects #${swing.lossSeed}.`;
          }
          if (swing.winSeed > goldCutoff && swing.lossSeed > goldCutoff) {
            return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}, so outside help is still needed.`;
          }
          return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}.`;
        });

      if (!scenarios.length) {
        // None on the schedule, but games owed under games per team are games left all the same.
        const owed = remainingCounts[teamId] ?? 0;
        return [
          owed > 0
            ? `${teamName} have ${owed} game${owed === 1 ? "" : "s"} left that the schedule does not show yet.`
            : `${teamName} have no remaining games; Gold Bracket status depends only on outside results.`,
        ];
      }
      return scenarios;
    },
    [dashboardById, nextTwoSwingGames, goldCutoff, remainingCounts]
  );

  const formatGoldPct = useCallback((team: TeamWithProjection) => formatGoldPctValue(team), []);

  // The badge says the row's own tone, so the legend over the table names every badge a row shows.
  const statusLabel = useCallback(
    (team: TeamWithProjection) => raceToneWords[raceToneForTeam(team, goldCutoff)],
    [goldCutoff]
  );

  const statusClass = (team: TeamWithProjection) =>
    raceBadgeClasses[raceToneForTeam(team, goldCutoff)];

  const titleRaceBadgeForTeam = useCallback(
    (team: TeamWithProjection) =>
      titleRaceBadgeForTeamValue(team, dashboardRows, remainingCounts, settings),
    [dashboardRows, remainingCounts, settings]
  );

  return {
    bubbleTierForTeam,
    clinchScenariosForTeam,
    clinchingPaths,
    cutLineSnapshot,
    formatGoldPct,
    gameStatusClasses,
    gamesThatMatterMost,
    getGameScenarioImpactMap,
    nextTwoSwingGames,
    scheduleDifficultyForTeam,
    seedRangeForTeam,
    statusClass,
    statusLabel,
    timelineEntries,
    titleRaceBadgeForTeam,
  };
}
