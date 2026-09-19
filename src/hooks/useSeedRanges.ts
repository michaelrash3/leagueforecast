import { useCallback, useMemo } from "react";
import { applyResult, projectStandings } from "../lib/sim";
import type { Matchup, Settings, Team } from "../lib/types";

/** Where a team can still finish: its projection now, and the two ends of what is left to play. */
export type SeedRange = { best: number; worst: number; baseline: number };

type SeedRangeInput = {
  /**
   * Whether the exact walk is on. Off — too many games left to enumerate, or a view that does not
   * ask — every team's range is its projection three times over, which is honest: nothing here
   * has looked at what the remaining games could do.
   */
  exact: boolean;
  liveTeams: Team[];
  remainingGames: Matchup[];
  settings: Settings;
  /** The projected table, by id, which is where a baseline comes from when there is one. */
  projectedById: Map<string, Team & { rank: number }>;
  /** The table as it stands, for a team the projection has no row for. */
  ranked: (Team & { rank?: number })[];
};

/**
 * The scenario walk: what each remaining game does to the table, and the best and worst seed each
 * team can still reach.
 *
 * Every answer is cached, because the walk is expensive — one projection per remaining game per
 * team — and the model table asks for the same team's range three times over while it draws.
 *
 * The cache is emptied by *following its inputs during render*, not from an effect. These are read
 * while rendering, and an effect runs after the render that read them: a score edit therefore drew
 * once from the previous standings, and emptying a ref schedules no re-render, so that stale
 * answer stayed on screen until something unrelated happened to draw again. The table moved and
 * the range beside it did not.
 *
 * Identity, not digests: these arrays are new exactly when the data is, which is the rule the rest
 * of the app follows.
 */
export const useSeedRanges = ({
  exact,
  liveTeams,
  remainingGames,
  settings,
  projectedById,
  ranked,
}: SeedRangeInput) => {
  /*
   * The caches, and the season they are about, in one object that is rebuilt whenever that season
   * changes. Holding the inputs here rather than closing over them separately is what makes this a
   * memo rather than a ref followed during render — refs may not be read while rendering, and
   * these are read while rendering — and it leaves one place, rather than four, that decides which
   * teams and games an answer in here was worked out from.
   */
  const caches = useMemo(
    () => ({
      teams: liveTeams,
      games: remainingGames,
      settings,
      scenarios: new Map<string, Map<string, number>>(),
      teamScenarios: new Map<string, number>(),
      ranges: new Map<string, SeedRange>(),
    }),
    [liveTeams, remainingGames, settings]
  );

  /** The whole projected table as it would stand if this game went this way. */
  const getScenarioRankMap = useCallback(
    (game: Matchup, winnerId: string) => {
      const scenarioKey = `${game.id}|${winnerId}`;
      if (!exact) return new Map<string, number>();
      const cached = caches.scenarios.get(scenarioKey);
      if (cached) return cached;
      const scenario = applyResult(caches.teams, game, winnerId, caches.teams, caches.settings);
      const scenarioGames = caches.games.filter((item) => item.id !== game.id);
      const finalProjected = projectStandings(scenario, scenarioGames, caches.settings);
      const rankMap = new Map<string, number>();
      finalProjected.forEach((team) => rankMap.set(team.id, team.rank ?? 99));
      caches.scenarios.set(scenarioKey, rankMap);
      return rankMap;
    },
    [exact, caches]
  );

  /** One team's seed in that scenario, kept separately so a row does not re-read the whole map. */
  const seedForScenario = useCallback(
    (teamId: string, game: Matchup, winnerId: string) => {
      const cacheKey = `${teamId}|${game.id}|${winnerId}`;
      const cached = caches.teamScenarios.get(cacheKey);
      if (cached != null) return cached;
      const seed = getScenarioRankMap(game, winnerId).get(teamId) ?? 99;
      caches.teamScenarios.set(cacheKey, seed);
      return seed;
    },
    [getScenarioRankMap, caches]
  );

  /**
   * The best and worst seed this team can still reach, over every way its remaining games can go.
   *
   * Always a range: a team with nothing left to play gets its baseline three times over. The
   * caller used to wrap this in `?? { best: 99, worst: 99, baseline: 99 }`, which was a branch
   * nothing could take, standing where a reader would read it as a case the code handles.
   */
  const seedRangeForTeam = useCallback(
    (teamId: string): SeedRange => {
      const cached = caches.ranges.get(teamId);
      if (cached) return cached;
      const baseline =
        projectedById.get(teamId)?.rank ?? ranked.find((item) => item.id === teamId)?.rank ?? 99;
      if (!exact) {
        const result = { best: baseline, worst: baseline, baseline };
        caches.ranges.set(teamId, result);
        return result;
      }
      let best = baseline;
      let worst = baseline;
      caches.games
        .filter((game) => game.away === teamId || game.home === teamId)
        .forEach((game) => {
          const opponentId = game.away === teamId ? game.home : game.away;
          const winSeed = seedForScenario(teamId, game, teamId);
          const lossSeed = seedForScenario(teamId, game, opponentId);
          if (winSeed < best) best = winSeed;
          if (winSeed > worst) worst = winSeed;
          if (lossSeed < best) best = lossSeed;
          if (lossSeed > worst) worst = lossSeed;
        });
      const result = { best, worst, baseline };
      caches.ranges.set(teamId, result);
      return result;
    },
    [projectedById, ranked, exact, seedForScenario, caches]
  );

  return { getScenarioRankMap, seedForScenario, seedRangeForTeam };
};
