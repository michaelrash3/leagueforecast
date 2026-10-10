import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backtestPredictions } from "../../lib/backtest";
import { buildPredictionEngine } from "../../lib/predictionEngine";
import { calculateTeams } from "../../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../../lib/types";
import { DashboardView } from "./DashboardView";

/*
 * A prediction card's "Why…?" button (2.8) names the side it explains, or says the game is a
 * toss-up when the card shows the two sides even. Placeholder teams.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "6",
  homeHits: "5",
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
];
const matchups: Matchup[] = [
  { id: "g1", date: "5/2", away: "A", home: "B" },
  { id: "g2", date: "5/9", away: "B", home: "A" },
];
const logs = { g1: final(6, 2) };

describe("a prediction card's Why button", () => {
  const live = calculateTeams(teams, matchups, logs, DEFAULT_SETTINGS);
  const engine = buildPredictionEngine(live, matchups, logs, DEFAULT_SETTINGS);
  const draw = (predictions = engine.predictions) =>
    render(
      <DashboardView
        engine={{ ...engine, predictions }}
        backtestResult={backtestPredictions([], [], {}, DEFAULT_SETTINGS)}
        teamsById={new Map(live.map((team) => [team.id, team]))}
        matchups={matchups}
        setActiveView={vi.fn()}
        findings={[]}
      />
    );

  it("names the side it explains, at the chance the card shows", () => {
    const [prediction] = engine.predictions;
    if (!prediction) throw new Error("No forecast");
    draw();
    const favored = prediction.winProbability.teamA > 0.5 ? "Bears" : "Aces";
    const chance = Math.round(
      Math.max(prediction.winProbability.teamA, prediction.winProbability.teamB) * 100
    );
    expect(
      screen.getByRole("button", { name: `Why ${favored} at ${chance}%?` })
    ).toBeInTheDocument();
  });

  it("says a game the card shows even is a toss-up", () => {
    const [prediction] = engine.predictions;
    if (!prediction) throw new Error("No forecast");
    draw([{ ...prediction, winProbability: { teamA: 0.5, teamB: 0.5 } }]);
    expect(screen.getByRole("button", { name: "Why a toss-up?" })).toBeInTheDocument();
  });
});
