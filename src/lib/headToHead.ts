import type { GameLog, Matchup } from "./types";
import { isFinal, parseNumber } from "./util";
import type { H2HCell } from "../components/charts/HeadToHeadMatrix";

export const h2hCellFor = (
  rowId: string,
  colId: string,
  matchups: Matchup[],
  logs: Record<string, GameLog>
): H2HCell => {
  if (rowId === colId) return "self";
  let wins = 0;
  let losses = 0;
  let ties = 0;

  matchups.forEach((game) => {
    const log = logs[game.id];
    if (!log || !isFinal(log)) return;

    const involves =
      (game.away === rowId && game.home === colId) ||
      (game.away === colId && game.home === rowId);
    if (!involves) return;

    const awayRuns = parseNumber(log.awayRuns);
    const homeRuns = parseNumber(log.homeRuns);

    if (awayRuns === homeRuns) {
      ties += 1;
      return;
    }

    const rowWon =
      (game.away === rowId && awayRuns > homeRuns) ||
      (game.home === rowId && homeRuns > awayRuns);
    if (rowWon) wins += 1;
    else losses += 1;
  });

  if (wins === 0 && losses === 0 && ties === 0) return "none";
  if (wins > losses) return "win";
  if (losses > wins) return "loss";
  return "tie";
};
