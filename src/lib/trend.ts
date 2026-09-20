import { calculateTeams, simulationSeed } from "./sim";
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
 */
export const buildTrendStates = (
  teams: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  /** Every game with a result, oldest first. */
  completedGames: Matchup[],
  options: { states: number; goldCutoff: number; settings: Settings }
): TrendState[] => {
  const drawn = completedGames.slice(-options.states);
  /*
   * Where the drawn window starts in the whole season. Everything before it happened and counts
   * toward every point; the window only decides which points are worth drawing.
   */
  const before = completedGames.length - drawn.length;

  const built: TrendState[] = [];
  for (let index = 1; index <= drawn.length; index += 1) {
    const allowed = new Set(completedGames.slice(0, before + index).map((game) => game.id));
    const stateLogs: Record<string, GameLog> = {};
    matchups.forEach((game) => {
      const log = logs[game.id];
      if (allowed.has(game.id) && log) stateLogs[game.id] = log;
    });
    built.push({
      teams: calculateTeams(teams, matchups, stateLogs, options.settings),
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
