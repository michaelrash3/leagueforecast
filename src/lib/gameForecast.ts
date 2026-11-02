import {
  drawnMarginSpan,
  drawnRuns,
  drawWidths,
  predictGame,
  type GameRead,
  type SeasonDraws,
} from "./sim";
import type { Matchup, Settings, Team } from "./types";

/** A span of whole runs, both ends in. */
export type RunSpan = { low: number; high: number };

/**
 * One game's forecast as a card gives it (2.10), all of it the per-game model's (`predictGame`), the
 * model the Gold odds play every game by: the chance, the projected score and its margin, the range
 * eight games in ten end within, and what the margin is made of.
 *
 * The card used to give the prediction engine's expected score, margin and reading beside the
 * per-game model's chance: in the Dashboard's own test league, Aces at 65% beside an expected 6.4 to
 * 2.9 and a range around Aces by 3.5, where the model behind the 65% had them 8 to 3. Now nothing on
 * the card is read off a second model, and the engine's account of its own margin is left to the
 * "Why" panel's words.
 */
export type GameForecast = {
  /** The away side's chance of winning: the one every League screen gives the game. */
  awayWinPct: number;
  /** The projected score, the runs the per-game model gives each side. */
  awayScore: number;
  homeScore: number;
  /**
   * Whether the league has a final to put a scoring level on. Before one the model scores every
   * side at 7 a game, a placeholder rather than a forecast, so the card gives no score.
   */
  scored: boolean;
  /** The sides with fewer than two league games, whom the model reads no runs for. */
  few: ("away" | "home")[];
  /**
   * The margins, from the away side, and each side's runs that the Gold odds draw the game at eight
   * times in ten (`drawnMarginSpan`, `drawnRuns`).
   */
  range: { margin: RunSpan; away: RunSpan; home: RunSpan };
  /** What the projected margin is made of (`GameRead`). */
  read: GameRead;
};

/**
 * A game's forecast as the per-game model gives it (`GameForecast`). The range is the Gold odds'
 * own: the margin drawn from a normal curve around the projected one, 8.0 runs wide at kid pitch and
 * 6.7 at machine and coach pitch, on the side of level the winner is drawn on at its chance, and
 * each side's runs the projected total split by that margin, as every simulated game is booked.
 * `widths` is the league's (`drawWidths`), worked out once for a page of cards.
 */
export const forecastGame = (
  game: Matchup,
  teams: Team[],
  settings: Pick<Settings, "modelAggression" | "pitchMode">,
  byId?: Map<string, Team>,
  widths: Pick<SeasonDraws, "tieShare" | "spread"> = drawWidths(teams, settings)
): GameForecast => {
  const read: GameRead = { runs: null, rating: null, weight: 0, margin: 0 };
  const prediction = predictGame(game, teams, settings, byId, undefined, read);
  const margin = drawnMarginSpan(
    widths,
    prediction.awayWinPct,
    prediction.awayScore - prediction.homeScore
  );
  const total = prediction.awayScore + prediction.homeScore;
  const lookup = byId ?? new Map(teams.map((team) => [team.id, team]));
  const few = (["away", "home"] as const).filter(
    (side) => (lookup.get(game[side])?.games ?? 0) < 2
  );
  return {
    awayWinPct: prediction.awayWinPct,
    awayScore: prediction.awayScore,
    homeScore: prediction.homeScore,
    scored: teams.some((team) => team.games > 0),
    few,
    range: {
      margin,
      // A side's runs rise with its margin, so its two ends are the margin's.
      away: { low: drawnRuns(total, margin.low), high: drawnRuns(total, margin.high) },
      home: { low: drawnRuns(total, -margin.high), high: drawnRuns(total, -margin.low) },
    },
    read,
  };
};
