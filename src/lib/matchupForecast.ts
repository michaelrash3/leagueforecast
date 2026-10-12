import { MATCHUP_MARGIN_CAP } from "./teamRankings";
import type { MatchupPreview } from "./teamRankings/types";

/** "2.3 runs", "1.0 run", and the clamp the projection never states past. */
const runsOf = (margin: number): string => {
  const runs = Math.abs(margin);
  if (runs >= MATCHUP_MARGIN_CAP) return `${MATCHUP_MARGIN_CAP} or more runs`;
  const shown = runs.toFixed(1);
  return `${shown} ${shown === "1.0" ? "run" : "runs"}`;
};

export type ForecastWords = {
  /** True when no winner is named. */
  even: boolean;
  /** "Hill Hawks should beat River Otters by 2.3 runs", or the dead-even call. */
  headline: string;
  /** "Win chance: Hill Hawks 64%, River Otters 36%", the favourite first. */
  chances: string;
};

/**
 * What Compare with's forecast says: who should win, who should lose, by how many runs, and each
 * side's chance, from one club's preview of the other (`previewMatchup`).
 *
 * A margin too small to move either side's chance off 50% names no winner. "Should beat by 0.1
 * runs" printed beside 50% and 50% would be a winner picked by a rounding error, and a margin
 * that rounds to 0.0 always leaves both chances at 50%, so the one test covers both. The two
 * chances are printed to add up to 100: the loser's is what the winner's leaves, because two
 * roundings of one probability (64.5 and 35.5) can make 101.
 */
export const forecastWords = (
  forName: string,
  againstName: string,
  preview: Pick<MatchupPreview, "projectedMargin" | "winProb">
): ForecastWords => {
  // The favourite's chance is rounded, never the first-picked club's: rounding 64.5% from one
  // side and 35.5% from the other would print 65-35 one way round and 64-36 the other.
  const forFavoured = preview.winProb > 0.5;
  const winnerPct = Math.round((forFavoured ? preview.winProb : 1 - preview.winProb) * 100);
  if (winnerPct === 50) {
    return {
      even: true,
      headline: "Too close to call: dead even",
      chances: `Win chance: ${forName} 50%, ${againstName} 50%`,
    };
  }
  const [winner, loser] = forFavoured ? [forName, againstName] : [againstName, forName];
  return {
    even: false,
    headline: `${winner} should beat ${loser} by ${runsOf(preview.projectedMargin)}`,
    chances: `Win chance: ${winner} ${winnerPct}%, ${loser} ${100 - winnerPct}%`,
  };
};

/** "+2.1", "-0.4", and "0.0" for anything that rounds to nothing, which `toFixed` signs "-0.0". */
export const formatRating = (rating: number): string => {
  const tenths = Math.round(rating * 10);
  if (tenths === 0) return "0.0";
  return `${tenths > 0 ? "+" : "-"}${(Math.abs(tenths) / 10).toFixed(1)}`;
};
