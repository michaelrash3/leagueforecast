import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backtestPredictions } from "../../lib/backtest";
import { buildPredictionEngine } from "../../lib/predictionEngine";
import { calculateTeams } from "../../lib/sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type PitchMode,
  type TeamBase,
} from "../../lib/types";
import { DashboardView } from "./DashboardView";

/*
 * Each prediction card's range (2.10): under the projected winner, the margins eight games in ten
 * like it end within, and under the expected score, each side's runs. Placeholder teams.
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
  { id: "C", name: "Comets" },
];
const matchups: Matchup[] = [
  { id: "g1", date: "5/2", away: "A", home: "B" },
  { id: "g2", date: "5/9", away: "B", home: "C" },
  { id: "g3", date: "5/16", away: "C", home: "A" },
  { id: "g4", date: "5/23", away: "A", home: "B" },
];

const draw = (pitchMode: PitchMode, logs: Record<string, GameLog>) => {
  const settings = { ...DEFAULT_SETTINGS, pitchMode };
  const live = calculateTeams(teams, matchups, logs, settings);
  render(
    <DashboardView
      engine={buildPredictionEngine(live, matchups, logs, settings)}
      backtestResult={backtestPredictions([], [], {}, settings)}
      teamsById={new Map(live.map((team) => [team.id, team]))}
      matchups={matchups}
      setActiveView={vi.fn()}
      findings={[]}
    />
  );
  const card = screen.getByRole("heading", { name: "Aces vs Bears" }).closest("article");
  if (!(card instanceof HTMLElement)) throw new Error("No prediction card");
  return card;
};

const played = { g1: final(8, 2), g2: final(5, 4), g3: final(3, 6) };

describe("a prediction card's range", () => {
  it("gives the margin and each side's runs eight games in ten end within", () => {
    // Aces by 3.5, expected 6.4 to 2.9: 9 runs either side of the margin, 6.5 of each score.
    const card = draw("player", played);
    expect(within(card).getByText("Range: Bears by 6 to Aces by 13")).toBeVisible();
    expect(within(card).getByText("Range: Aces 0–13, Bears 0–9")).toBeVisible();
  });

  it("is wider at machine pitch, where games swing further", () => {
    const card = draw("machine", played);
    expect(within(card).getByText("Range: Bears by 7 to Aces by 14")).toBeVisible();
    expect(within(card).getByText("Range: Aces 0–14, Bears 0–11")).toBeVisible();
  });

  it("is not given before the model has a final to forecast from", () => {
    const card = draw("player", {});
    expect(within(card).queryByText(/^Range:/)).toBeNull();
  });
});
