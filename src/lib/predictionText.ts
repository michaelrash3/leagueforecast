import { displayName } from "./format";
import type { Matchup, Prediction, Team } from "./types";

export const projectedRunLine = (prediction: Prediction, byId: Map<string, Team>) => {
  const favorite = byId.get(prediction.winnerId);
  const favoriteName = favorite ? displayName(favorite.name) : prediction.winnerId;
  const rawMargin = Math.abs(prediction.awayScore - prediction.homeScore);
  const halfRunLine = Math.max(0.5, rawMargin - 0.5);
  return `${favoriteName} -${halfRunLine.toFixed(1)}`;
};

export const upsetRiskLabel = (winnerPct: number, margin: number) => {
  if (winnerPct < 0.58 || margin <= 2) return "High";
  if (winnerPct < 0.7 || margin <= 5) return "Medium";
  return "Low";
};

export const describePrediction = (
  game: Matchup,
  prediction: Prediction,
  byId: Map<string, Team>
) => {
  const away = byId.get(game.away);
  const home = byId.get(game.home);
  const winner = byId.get(prediction.winnerId);

  const awayName = displayName(away?.name || game.away);
  const homeName = displayName(home?.name || game.home);
  const winnerName = displayName(winner?.name || prediction.winnerId);

  if (!away || !home) {
    return `Model leans ${winnerName}, but one or both teams are missing from the imported team list.`;
  }

  const winnerPct =
    prediction.winnerId === game.away ? prediction.awayWinPct : 1 - prediction.awayWinPct;
  const tpiEdge = away.tpi - home.tpi;
  const scoringEdge = away.rsg - home.rsg;
  const preventionEdge = home.rag - away.rag;
  const kEdge = (home.homeK6 ?? 4.5) - ((away.awayK6 ?? 4.5) + home.machineDifficulty);

  const reasons: string[] = [];
  if (Math.abs(scoringEdge) >= 1.2) {
    reasons.push(`${scoringEdge > 0 ? awayName : homeName} has the stronger scoring profile`);
  }
  if (Math.abs(preventionEdge) >= 1.2) {
    reasons.push(`${preventionEdge > 0 ? awayName : homeName} has allowed fewer runs`);
  }
  if (Math.abs(tpiEdge) >= 1.5) {
    reasons.push(`${tpiEdge > 0 ? awayName : homeName} owns the better adjusted profile`);
  }
  if (Math.abs(kEdge) >= 1.0) {
    reasons.push(`${kEdge > 0 ? awayName : homeName} gets a contact/machine edge`);
  }
  if (!reasons.length) {
    reasons.push("the teams grade close, so the lean is mostly from projected run balance");
  }

  const confidenceText =
    prediction.confidence === "High"
      ? "a strong lean"
      : prediction.confidence === "Medium"
        ? "a clear lean"
        : "a light lean";

  return `${projectedRunLine(prediction, byId)} is ${confidenceText}: ${reasons.slice(0, 2).join(" and ")}. That gives ${winnerName} a ${Math.round(
    winnerPct * 100
  )}% win chance without treating the forecast like a literal final score.`;
};
