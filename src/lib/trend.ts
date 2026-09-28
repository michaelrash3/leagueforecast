import { attachAdjustedRatings, calculateTeams, simulationSeed } from "./sim";
import { buildPredictionEngine, playedOn, type ExternalResult } from "./predictionEngine";
import { seasonStartMonth } from "./date";
import { isFinal } from "./util";
import type { GameLog, Matchup, Settings, Team, TeamBase } from "./types";

/** One point on the Gold-odds trend: the season as it stood, and the key it is cached under. */
export type TrendState = { teams: Team[]; remaining: Matchup[]; seedText: string };

/**
 * The seasons behind the Gold-odds trend chart, one per point, oldest first.
 *
 * A trend is a sequence of *cumulative* seasons: each point is the league as it stood after one
 * more game, so the last point is the league as it stands now and reads the same as the odds
 * printed everywhere else on the page. `states` chooses how many points to draw, which is a
 * question about the chart; it is not a question about which games happened.
 *
 * It was being read as both. The window was applied to the logs as well as to the points, so
 * every state — the last one included — simulated a season in which every game before the window
 * had never been played. On a six-team league with forty games played and a window of eight, the
 * right-hand end of the chart put the runaway leader on 2.4% while the season it is drawn beside
 * had them on 100%, and a team already eliminated on 28.2%. That end of the line is the one a
 * reader takes for where things stand.
 *
 * Each point also carries the opponent-adjusted rating the Gold % beside it is simulated with.
 * The points were the league's records alone, while the column is simulated from teams carrying
 * the rating (`attachAdjustedRatings`), so the line ended away from the number it stands beside:
 * measured on a rebuilt league, The Generals at 69% in the column and 59% at the end of the line,
 * and 7 points apart with no Team Rankings results at all. A point is rated from its own finals and
 * the outside results played by its last game; the last point takes every outside result, so it is
 * rated exactly as the column is. Past points move with this, which is the fix, not a side effect.
 */
export const buildTrendStates = (
  teams: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  /** Every game with a result, oldest first. */
  completedGames: Matchup[],
  options: {
    states: number;
    goldCutoff: number;
    settings: Settings;
    /** Team Rankings results, as the forecast reads them (`buildPredictionEngine`). */
    externalResults?: ExternalResult[];
    /** The squad year the season is linked to, which places its dates among theirs (`playedOn`). */
    squadYear?: number;
  }
): TrendState[] => {
  const outside = options.externalResults ?? [];
  // The season's own order where no squad year places it, over the outside results' days too.
  const start = seasonStartMonth([
    ...matchups.map((game) => game.date),
    ...outside.map((result) => result.date),
  ]);
  const drawn = completedGames.slice(-options.states);
  /*
   * Where the drawn window starts in the whole season. Everything before it happened and counts
   * toward every point; the window only decides which points are worth drawing.
   */
  const before = completedGames.length - drawn.length;

  /*
   * The latest day the season has reached by each point: its own game's, or, for a game logged
   * with no date, the last day before it that has one. Read as its own date, an undated game is
   * the end of time (`playedOn`), and a point in the middle of the chart took every outside
   * result the season will ever hold, the ones played after it included.
   */
  let through = Number.NEGATIVE_INFINITY;
  completedGames.slice(0, before).forEach((game) => {
    const at = playedOn(game.date, options.squadYear, start);
    if (Number.isFinite(at)) through = Math.max(through, at);
  });

  const built: TrendState[] = [];
  for (let index = 1; index <= drawn.length; index += 1) {
    const allowed = new Set(completedGames.slice(0, before + index).map((game) => game.id));
    const stateLogs: Record<string, GameLog> = {};
    matchups.forEach((game) => {
      const log = logs[game.id];
      if (allowed.has(game.id) && log) stateLogs[game.id] = log;
    });
    const asOf = calculateTeams(teams, matchups, stateLogs, options.settings);
    const at = playedOn(completedGames[before + index - 1]?.date, options.squadYear, start);
    if (Number.isFinite(at)) through = Math.max(through, at);
    const played =
      index === drawn.length
        ? outside
        : outside.filter((result) => playedOn(result.date, options.squadYear, start) <= through);
    const engine = buildPredictionEngine(
      asOf,
      matchups,
      stateLogs,
      options.settings,
      played,
      options.squadYear
    );
    built.push({
      teams: attachAdjustedRatings(asOf, engine.ratings),
      remaining: matchups.filter((game) => !isFinal(stateLogs[game.id])),
      seedText: simulationSeed(
        matchups,
        stateLogs,
        `trend-${index}-${options.goldCutoff}-${options.settings.modelAggression}`
      ),
    });
  }
  return built;
};
