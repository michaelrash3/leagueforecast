import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backtestPredictions } from "../../lib/backtest";
import { forecastGame } from "../../lib/gameForecast";
import { buildPredictionEngine, type ExternalResult } from "../../lib/predictionEngine";
import { attachAdjustedRatings, calculateTeams } from "../../lib/sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type PitchMode,
  type TeamBase,
} from "../../lib/types";
import { DashboardView } from "./DashboardView";

/*
 * A prediction card reads as one forecast: the win chance, the projected winner's margin, the
 * expected score, both ranges and the Model Read all come from the per-game model the Gold odds
 * play by (`forecastGame`). The card used to give the prediction engine's expected score, margin
 * and reading beside the per-game model's chance: "Aces by 3.5", expected 6.4 to 2.9 and "Aces
 * holds the stronger opponent-adjusted rating", beside a 65% from a model that had them 8 to 3.
 * Placeholder teams.
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
  const engine = buildPredictionEngine(live, matchups, logs, settings);
  const rated = attachAdjustedRatings(live, engine.ratings);
  render(
    <DashboardView
      engine={engine}
      backtestResult={backtestPredictions([], [], {}, settings)}
      teamsById={new Map(live.map((team) => [team.id, team]))}
      matchups={matchups}
      setActiveView={vi.fn()}
      findings={[]}
      gameForecast={(game) => forecastGame(game, rated, settings)}
    />
  );
  const card = screen.getByRole("heading", { name: "Aces vs Bears" }).closest("article");
  if (!(card instanceof HTMLElement)) throw new Error("No prediction card");
  return card;
};

/** What a card's block says under its label. */
const blockOf = (card: HTMLElement, label: string) =>
  within(card).getByText(label).nextElementSibling?.textContent ?? "";

const played = { g1: final(8, 2), g2: final(5, 4), g3: final(3, 6) };

describe("a prediction card", () => {
  it("gives the per-game model's score and margin, and the range the Gold odds draw it in", () => {
    // Aces 8 to 3 at 65%: margins on the curve 8.0 runs wide around 5, eight in ten, and each side's
    // runs as the Gold odds split the projected 11 at the ends of that range.
    const card = draw("player", played);
    expect(blockOf(card, "Projected Winner")).toBe("Aces by 5");
    expect(within(card).getByText("Range: Bears by 6 to Aces by 15")).toBeVisible();
    expect(blockOf(card, "Win Probability")).toBe("Aces65%Bears35%");
    expect(blockOf(card, "Expected Score")).toBe("8-3");
    expect(within(card).getByText("Range: Aces 3–15, Bears 0–9")).toBeVisible();
  });

  it("is narrower at machine pitch, as the Gold odds draw it", () => {
    const card = draw("machine", played);
    expect(blockOf(card, "Expected Score")).toBe("9-3");
    expect(within(card).getByText("Range: Bears by 5 to Aces by 14")).toBeVisible();
    expect(within(card).getByText("Range: Aces 4–14, Bears 0–9")).toBeVisible();
  });

  it("reads the game as the per-game model does, not as the engine's rating table", () => {
    const card = draw("player", played);
    expect(blockOf(card, "Model Read")).toMatch(
      /^This league's games alone \(runs scored and allowed, and form\) make it Aces by \d+\.\d; the ratings, Aces by 3\.1\. The projection counts the ratings 60%\./
    );
    expect(card).not.toHaveTextContent("opponent-adjusted rating");
  });

  it("gives the margin but no score where the ratings come from Team Rankings results alone", () => {
    // No league final, so nothing to put a scoring level on; the ratings still split the sides.
    const settings = DEFAULT_SETTINGS;
    const live = calculateTeams(teams, matchups, {}, settings);
    const outside: ExternalResult[] = [
      { away: "A", home: "X1", homeMargin: -6, date: "2026-04-11", neutral: true },
      { away: "B", home: "X1", homeMargin: 4, date: "2026-04-11", neutral: true },
    ];
    const engine = buildPredictionEngine(live, matchups, {}, settings, outside);
    const rated = attachAdjustedRatings(live, engine.ratings);
    render(
      <DashboardView
        engine={engine}
        backtestResult={backtestPredictions([], [], {}, settings)}
        teamsById={new Map(live.map((team) => [team.id, team]))}
        matchups={matchups}
        setActiveView={vi.fn()}
        findings={[]}
        gameForecast={(game) => forecastGame(game, rated, settings)}
      />
    );
    const [card] = screen
      .getAllByRole("heading", { name: "Aces vs Bears" })
      .map((heading) => heading.closest("article"));
    if (!(card instanceof HTMLElement)) throw new Error("No prediction card");
    expect(blockOf(card, "Projected Winner")).toMatch(/^Aces by \d+$/);
    expect(blockOf(card, "Expected Score")).toBe("Needs scores");
    // The margin's range alone: each side's runs wait for a scoring level.
    expect(
      within(card)
        .getAllByText(/^Range:/)
        .map((line) => line.textContent)
    ).toEqual([expect.stringMatching(/^Range: Bears by \d+ to Aces by \d+$/)]);
    expect(blockOf(card, "Model Read")).toMatch(
      /^With fewer than two league games behind Aces and Bears, the projection reads the ratings, Aces by /
    );
  });

  it("gives no score or range before the model has a final to forecast from", () => {
    const card = draw("player", {});
    expect(within(card).queryByText(/^Range:/)).toBeNull();
    expect(blockOf(card, "Expected Score")).toBe("Needs scores");
    expect(blockOf(card, "Projected Winner")).toBe("Pending data");
    expect(blockOf(card, "Model Read")).toMatch(/^Add completed scores to unlock a model read\./);
  });
});
