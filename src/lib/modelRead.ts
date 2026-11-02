import type { GameForecast } from "./gameForecast";

/**
 * A game card's Model Read (2.10): what the per-game model's projected score is made of, in a
 * sentence, as that model reads the game (`GameRead`). It reads the league's own games (runs scored
 * and allowed, and form) and the ratings, each a margin of its own, and goes a share of the way from
 * the first to the second, more the more rated games the thinner-rated side has. With either side on
 * fewer than two league games it reads the ratings alone against an even game.
 *
 * It was the prediction engine's line, "Aces holds the stronger opponent-adjusted rating", which is
 * a reading of the ratings alone, beside a chance and a score from the per-game model: where the two
 * models parted ways the card's read backed one side and its chance the other. Here only in the
 * Dashboard's own download, which alone shows it.
 */
export const modelRead = (
  { read, few }: Pick<GameForecast, "read" | "few">,
  names: { away: string; home: string }
): string => {
  const lean = (margin: number) =>
    Math.abs(margin) < 0.05
      ? "even"
      : `${margin > 0 ? names.away : names.home} by ${Math.abs(margin).toFixed(1)}`;
  const weight = `${Math.round(read.weight * 100)}%`;
  const games = "This league's games alone (runs scored and allowed, and form) make it";
  if (read.runs !== null)
    return read.rating !== null
      ? `${games} ${lean(read.runs)}; the ratings, ${lean(read.rating)}. The projection counts the ratings ${weight}.`
      : `${games} ${lean(read.runs)}, and with no rating for one side they are all the projection reads.`;
  const thin = few.map((side) => names[side]).join(" and ");
  return read.rating !== null
    ? `With fewer than two league games behind ${thin}, the projection reads the ratings, ${lean(read.rating)}, counted ${weight} against an even game.`
    : `With fewer than two league games behind ${thin} and no ratings, the projection has only their records to go on.`;
};
