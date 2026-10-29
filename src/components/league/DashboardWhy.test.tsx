import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backtestPredictions } from "../../lib/backtest";
import { CLOSE_GAME_RISK, SMALL_SAMPLE_RISK } from "../../lib/confidenceTier";
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

  it("on a phone shows each upcoming game as a line until it is opened", () => {
    // jsdom has no `matchMedia`, so the phone's width is said out loud.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    );
    try {
      draw();
      expect(screen.queryByRole("button", { name: /^Why / })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /^Bears vs Aces/ }));
      expect(screen.getByRole("button", { name: /^Why / })).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

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

describe("the Dashboard's confidence and risk lines", () => {
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

  /*
   * The tile averaged a 5-94 score made of hand-set weights and showed it as a percent beside
   * "Prediction accuracy", where it read as a chance. It is the confidence card's own word now, the
   * tier and the score of 100 that the "Why" panel gives each game.
   */
  it("says the forecasts' confidence as a tier and a score of 100, not a percent", () => {
    const [prediction] = engine.predictions;
    if (!prediction) throw new Error("No forecast");
    draw();
    const tile = screen.getByText("Confidence").nextElementSibling?.textContent ?? "";
    expect(tile).toBe(`${prediction.confidence.tier} (${prediction.confidence.score} of 100)`);
    expect(screen.queryByText("Avg confidence")).toBeNull();
  });

  /*
   * Every close game's card said "Risk: Similar team ratings create a close-game risk.", and every
   * card led with the league's own data warnings: the same line on each, which the win chance and
   * the Data Quality tab already say. A card says only what is its game's own.
   */
  it("says no risk every card would say, only the game's own", () => {
    const [prediction] = engine.predictions;
    if (!prediction) throw new Error("No forecast");
    const close = {
      ...prediction,
      riskFactors: ["Some teams have played no games yet.", CLOSE_GAME_RISK],
    };
    const { unmount } = draw([close]);
    expect(screen.queryByText(/^Risk:/)).toBeNull();
    unmount();

    draw([{ ...close, riskFactors: [...close.riskFactors, SMALL_SAMPLE_RISK] }]);
    expect(screen.getByText(`Risk: ${SMALL_SAMPLE_RISK}`)).toBeInTheDocument();
  });
});
