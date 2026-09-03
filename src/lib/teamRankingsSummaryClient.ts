/**
 * Builds the "why is this team ranked here" request for Team Rankings, reusing the same
 * `/api/league-summary` endpoint/contract as League Standings' AI write-ups (see
 * `leagueSummary.ts`'s "team-rank-explanation" kind) rather than standing up a parallel Gemini
 * integration for a separate feature that otherwise has nothing to do with League Standings.
 */
import type { LeagueSummaryFact, LeagueSummaryRequest } from "./leagueSummary";
import type { MatchupPreview, ScoutRankingRow } from "./teamRankings";

const MAX_COMPARISONS = 8;

export const buildTeamRankExplanationRequest = (
  team: ScoutRankingRow,
  totalTeams: number,
  opponents: MatchupPreview[],
  seasonLabel: string
): LeagueSummaryRequest => {
  const facts: LeagueSummaryFact[] = [
    {
      kind: "rank",
      text: `Ranked #${team.rank} of ${totalTeams} teams, record ${team.record} over ${team.games} game${
        team.games === 1 ? "" : "s"
      }.`,
      impactScore: 100,
    },
    {
      kind: "rating",
      text: `Opponent-adjusted rating: ${team.rating >= 0 ? "+" : ""}${team.rating.toFixed(1)} runs vs an average team in this pool.`,
      impactScore: 90,
    },
    {
      kind: "sos",
      text: team.sosRank
        ? `Strength-of-schedule rank: #${team.sosRank} of ${totalTeams} (1 = toughest opponents faced).`
        : "No games played yet, so there is no schedule strength to report.",
      impactScore: 60,
    },
    ...opponents.slice(0, MAX_COMPARISONS).map((opponent, index) => ({
      kind: "comparison",
      text: `Projected vs ${opponent.opponentName} (#${opponent.opponentRank}): ${
        opponent.projectedMargin >= 0 ? "wins" : "loses"
      } by about ${Math.abs(opponent.projectedMargin).toFixed(1)} runs, ${Math.round(
        opponent.winProb * 100
      )}% win probability (${opponent.tier}).`,
      impactScore: 50 - index,
    })),
  ];

  return {
    kind: "team-rank-explanation",
    seasonLabel,
    cutoff: 1,
    hasCutLine: false,
    updateTitle: `${team.teamName} — rank #${team.rank} of ${totalTeams}`,
    facts,
  };
};
