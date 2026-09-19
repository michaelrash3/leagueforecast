import { useCallback, useMemo } from "react";
import { displayName } from "../lib/format";
import {
  applyResult,
  getMathGoldStatus,
  getRemainingCounts,
  rankOptionsFromSettings,
  rankTeams,
  standingsPoints,
} from "../lib/sim";
import { parseDateValue } from "../lib/date";
import type { Matchup, Settings, Team, TeamWithProjection } from "../lib/types";

/** What the seed-impact pass worked out about a game; only the one number is read here. */
export type ScenarioImpact = { seedImpact: number };

export type ClinchScenarioInputs = {
  /** The teams as the standings have them now, which every scenario is played forward from. */
  liveTeams: Team[];
  settings: Settings;
  remainingGames: Matchup[];
  /** How many qualify. Zero in a league with no postseason, every team in an all-in one. */
  goldCutoff: number;
  /** Only a "cut" league has a line to be inside or outside of; see `App`'s own note. */
  hasCutLine: boolean;
  /** The standings rows, for the status a team is already in before any scenario is played. */
  dashboardById: Map<string, TeamWithProjection>;
  scenarioImpact: Map<string, ScenarioImpact>;
};

export type ClinchScenarios = {
  /**
   * One label for what a game is worth, most consequential first: a title clinched, a place
   * clinched or a season ended, a game near the cut line, a game that moves a seed, or none of
   * those.
   *
   * The only thing App asks for. The six questions behind it — whose next game this is, who
   * clinches with a win, who goes out with a loss, who takes the title, everyone clinched by
   * either result, and the badges that come out of those — are answered inside, because nothing
   * outside ever wanted one on its own. Narrow because that is what is used, not because the rest
   * is secret: any of them is a line away from being returned if a caller turns up.
   */
  gameStatusForGame: (game: Matchup) => string;
};

/**
 * What one more result would do to the table.
 *
 * Every answer here is the same shape: play a game forward from the standings as they stand, rank
 * what comes out, and ask the clinching maths about it. That is why they were seven hundred lines
 * in the middle of App among everything else it does, and why they are worth having out here —
 * they are a closed question over the season, testable without standing the app up, and they had
 * no test of their own.
 *
 * They are memoised, and that is not a rendering optimisation. They are read inside memos, and a
 * plain function redeclared every render cannot be listed as a dependency of one; that is exactly
 * how a stale "Bubble Game" survived on a league that no longer had a cut line.
 */
export function useClinchScenarios({
  liveTeams,
  settings,
  remainingGames,
  goldCutoff,
  hasCutLine,
  dashboardById,
  scenarioImpact,
}: ClinchScenarioInputs): ClinchScenarios {
  const nextGameByTeam = useMemo(() => {
    const map = new Map<string, Matchup>();
    [...remainingGames]
      .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
      .forEach((game) => {
        if (!map.has(game.away)) map.set(game.away, game);
        if (!map.has(game.home)) map.set(game.home, game);
      });
    return map;
  }, [remainingGames]);

  const isTeamNextGame = useCallback(
    (teamId: string, game: Matchup) => nextGameByTeam.get(teamId)?.id === game.id,
    [nextGameByTeam]
  );

  /**
   * The table as it would stand with this game decided, and what each side would have left.
   *
   * Three of the answers below were each building this for themselves, the same five lines three
   * times over. It is the whole of a scenario: rank the result, and drop the game just played out
   * of everyone's remaining count, because a team cannot win it twice.
   */
  const afterResult = useCallback(
    (game: Matchup, winnerId: string) => {
      const teams = rankTeams(
        applyResult(liveTeams, game, winnerId, liveTeams, settings),
        rankOptionsFromSettings(settings)
      );
      const counts = getRemainingCounts(
        teams,
        remainingGames.filter((item) => item.id !== game.id)
      );
      return { teams, counts };
    },
    [liveTeams, settings, remainingGames]
  );

  const goldStatusAfterScenario = useCallback(
    (teamId: string, game: Matchup, winnerId: string) => {
      const { teams, counts } = afterResult(game, winnerId);
      const scenarioTeam = teams.find((team) => team.id === teamId);
      if (!scenarioTeam) return null;
      return getMathGoldStatus(scenarioTeam, teams, counts, goldCutoff, settings).goldStatus;
    },
    [afterResult, goldCutoff, settings]
  );

  /** A side already finished either way cannot be clinched or eliminated by anything further. */
  const stillInPlay = useCallback(
    (teamId: string) => {
      const team = dashboardById.get(teamId);
      if (!team) return false;
      return team.goldStatus !== "Clinched" && team.goldStatus !== "Eliminated";
    },
    [dashboardById]
  );

  const teamsClinchingAfterGameResult = useCallback(
    (game: Matchup, winnerId: string) => {
      const { teams, counts } = afterResult(game, winnerId);
      return teams
        .filter(
          (scenarioTeam) =>
            stillInPlay(scenarioTeam.id) &&
            getMathGoldStatus(scenarioTeam, teams, counts, goldCutoff, settings).goldStatus ===
              "Clinched"
        )
        .map((team) => team.id);
    },
    [afterResult, stillInPlay, goldCutoff, settings]
  );

  const teamClinchesGoldWithWin = useCallback(
    (teamId: string, game: Matchup) =>
      stillInPlay(teamId) &&
      isTeamNextGame(teamId, game) &&
      goldStatusAfterScenario(teamId, game, teamId) === "Clinched",
    [stillInPlay, isTeamNextGame, goldStatusAfterScenario]
  );

  const teamCanBeEliminatedWithLoss = useCallback(
    (teamId: string, game: Matchup) => {
      if (!stillInPlay(teamId) || !isTeamNextGame(teamId, game)) return false;
      const opponentId = game.away === teamId ? game.home : game.away;
      return goldStatusAfterScenario(teamId, game, opponentId) === "Eliminated";
    },
    [stillInPlay, isTeamNextGame, goldStatusAfterScenario]
  );

  const teamClinchesRegularSeasonTitleWithWin = useCallback(
    (teamId: string, game: Matchup) => {
      const team = dashboardById.get(teamId);
      // A clinched side can still take the title outright, so this one only rules out the dead.
      if (!team || team.goldStatus === "Eliminated") return false;
      if (!isTeamNextGame(teamId, game)) return false;

      const { teams, counts } = afterResult(game, teamId);
      const scenarioTeam = teams.find((item) => item.id === teamId);
      if (!scenarioTeam) return false;

      const titlePoints = standingsPoints(scenarioTeam, settings);
      return teams.every((other) => {
        if (other.id === teamId) return true;
        const otherMax =
          standingsPoints(other, settings) + (counts[other.id] ?? 0) * settings.winPoints;
        return otherMax < titlePoints;
      });
    },
    [dashboardById, isTeamNextGame, afterResult, settings]
  );

  /** The two sides of a game, as standings rows, skipping any the table does not know. */
  const sidesOf = useCallback(
    (game: Matchup) =>
      [dashboardById.get(game.away), dashboardById.get(game.home)].filter(
        (team): team is TeamWithProjection => Boolean(team)
      ),
    [dashboardById]
  );

  const gameScenarioBadgesForGame = useCallback(
    (game: Matchup) => {
      const badges: string[] = [];
      const teamsInGame = sidesOf(game);

      const clinchTeams = new Set<string>();
      teamsInGame.forEach((team) => {
        if (teamClinchesGoldWithWin(team.id, game)) clinchTeams.add(displayName(team.name));
      });
      // Either result, because a game can clinch a place for somebody who is not playing in it.
      [game.away, game.home].forEach((winnerId) => {
        teamsClinchingAfterGameResult(game, winnerId).forEach((teamId) => {
          clinchTeams.add(displayName(dashboardById.get(teamId)?.name || teamId));
        });
      });
      if (clinchTeams.size > 0) badges.push(`Clinch Scenario: ${[...clinchTeams].join(", ")}`);

      const eliminationTeams = new Set<string>();
      teamsInGame.forEach((team) => {
        if (teamCanBeEliminatedWithLoss(team.id, game))
          eliminationTeams.add(displayName(team.name));
      });
      if (eliminationTeams.size > 0) {
        badges.push(`Elimination Scenario: ${[...eliminationTeams].join(", ")}`);
      }

      return badges;
    },
    [
      sidesOf,
      dashboardById,
      teamClinchesGoldWithWin,
      teamsClinchingAfterGameResult,
      teamCanBeEliminatedWithLoss,
    ]
  );

  const gameStatusForGame = useCallback(
    (game: Matchup) => {
      const teamsInGame = sidesOf(game);
      const titleTeam = teamsInGame.find((team) =>
        teamClinchesRegularSeasonTitleWithWin(team.id, game)
      );
      if (titleTeam) return `Title Clinch-${displayName(titleTeam.name)}`;
      const scenarioBadges = gameScenarioBadgesForGame(game);
      if (scenarioBadges.length > 0) return scenarioBadges[0] ?? "Clinch Scenario";

      // "Bubble" only means something relative to a cut line; without one, a tight game is just a
      // high-leverage seeding game.
      const impact = scenarioImpact.get(game.id);
      const nearCutLine =
        hasCutLine && teamsInGame.some((team) => Math.abs((team.rank ?? 99) - goldCutoff) <= 1);
      if (impact && impact.seedImpact >= 2) return "High Impact";
      if (nearCutLine) return "Bubble Game";
      if (impact && impact.seedImpact >= 1) return "Seeding Game";
      return "Low Impact";
    },
    [
      sidesOf,
      scenarioImpact,
      teamClinchesRegularSeasonTitleWithWin,
      gameScenarioBadgesForGame,
      hasCutLine,
      goldCutoff,
    ]
  );

  return { gameStatusForGame };
}
