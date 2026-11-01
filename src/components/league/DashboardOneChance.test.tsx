import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backtestPredictions } from "../../lib/backtest";
import { buildDemoSeason } from "../../lib/demoSeason";
import { forecastGame, type GameForecast } from "../../lib/gameForecast";
import { buildPredictionEngine, type LeaguePrediction } from "../../lib/predictionEngine";
import { attachAdjustedRatings, calculateTeams, predictGame } from "../../lib/sim";
import type { Matchup } from "../../lib/types";
import { DashboardView } from "./DashboardView";

/*
 * One win chance for each game (sweep item 29). The Dashboard's list showed the prediction engine's
 * chance, read off a rating margin, where the Our team card, the Schedule and the Gold odds read the
 * per-game model's (`predictGame`): the demo season's second game still to play was 54% on the list
 * and 57% on the Schedule, and its last game had each model backing a different side. The list
 * shows the per-game model's chance now, and its pick, and beside them the same model's score and
 * margin (`forecastGame`). The demo season, its teams renamed to placeholders.
 */

const NAMES = ["Aces", "Bears", "Comets", "Ducks", "Eagles", "Foxes", "Giants", "Hawks"];
const demo = buildDemoSeason();
const teams = demo.teams.map((team, at) => ({ ...team, name: NAMES[at] ?? team.name }));
const { matchups, logs, settings } = demo;
const base = calculateTeams(teams, matchups, logs, settings);
const engine = buildPredictionEngine(base, matchups, logs, settings);
const live = attachAdjustedRatings(base, engine.ratings);
const byId = new Map(live.map((team) => [team.id, team]));
/** The per-game model's chance for the away side, as the app hands the Dashboard it. */
const gameOdds = (game: Matchup) => predictGame(game, live, settings, byId).awayWinPct;
/** The per-game model's forecast, as the app hands the Dashboard it, its chance where given. */
const forecastAt =
  (chance?: (game: Matchup) => number) =>
  (game: Matchup): GameForecast => ({
    ...forecastGame(game, live, settings, byId),
    ...(chance ? { awayWinPct: chance(game) } : {}),
  });
const nameOf = (id: string) => byId.get(id)?.name ?? id;
const gameOf = (id: string): Matchup => {
  const game = matchups.find((one) => one.id === id);
  if (!game) throw new Error(`No game ${id}`);
  return game;
};
const percent = (chance: number) => `${Math.round(chance * 100)}%`;

const draw = ({
  forecast = engine,
  predictions = forecast.predictions,
  odds = gameOdds,
}: {
  forecast?: typeof engine;
  predictions?: LeaguePrediction[];
  odds?: (game: Matchup) => number;
} = {}) =>
  render(
    <DashboardView
      engine={{ ...forecast, predictions }}
      backtestResult={backtestPredictions([], [], {}, settings)}
      teamsById={byId}
      matchups={matchups}
      setActiveView={vi.fn()}
      findings={[]}
      gameForecast={forecastAt(odds)}
    />
  );

const cardOf = (game: Matchup) => {
  const card = screen
    .getByRole("heading", { name: `${nameOf(game.away)} vs ${nameOf(game.home)}` })
    .closest("article");
  if (!(card instanceof HTMLElement)) throw new Error(`No card for ${game.id}`);
  return card;
};
const blockOf = (card: HTMLElement, label: string) =>
  within(card).getByText(label).nextElementSibling?.textContent ?? "";

describe("the Dashboard's upcoming games", () => {
  it("each show the chance the Schedule and the Our team card give the game", () => {
    draw();
    for (const id of ["demo-19", "demo-20", "demo-21"]) {
      const game = gameOf(id);
      const chance = gameOdds(game);
      expect(blockOf(cardOf(game), "Win Probability")).toBe(
        `${nameOf(game.away)}${percent(chance)}${nameOf(game.home)}${percent(1 - chance)}`
      );
    }
    // The engine's own reading of the second was 54% for its away side; the page says 57%.
    const second = cardOf(gameOf("demo-20"));
    expect(blockOf(second, "Win Probability")).toContain("57%");
    expect(second).not.toHaveTextContent("54%");
    expect(
      within(second).getByRole("button", { name: `Why ${nameOf(gameOf("demo-20").away)} at 57%?` })
    ).toBeInTheDocument();
  });

  it("pick the side the per-game model picks where the rating's margin backs the other", () => {
    const game = gameOf("demo-28");
    const call = engine.predictions.find((one) => one.gameId === game.id);
    if (!call) throw new Error("No forecast");
    // The margin leans to the home side, and the per-game model makes the away side the pick.
    expect(call.predictedWinnerId).toBe(game.home);
    expect(percent(gameOdds(game))).toBe("52%");
    draw({ predictions: [call] });
    const card = cardOf(game);
    // The per-game model scores it level, 9 to 9, so the pick is named by nothing.
    expect(blockOf(card, "Projected Winner")).toBe(nameOf(game.away));
    expect(blockOf(card, "Win Probability")).toBe(`${nameOf(game.away)}52%${nameOf(game.home)}48%`);
    expect(blockOf(card, "Expected Score")).toBe("9-9");
    expect(
      within(card).getByRole("button", { name: `Why ${nameOf(game.away)} at 52%?` })
    ).toBeInTheDocument();
  });

  /*
   * A toss-up, both sides at 50% once rounded. The Schedule's pick names a side even there, the
   * per-game model's own (`predictGame`: the away side from 50% up), and the card named the
   * engine's instead: the other side in 121 of the 249 toss-ups among the 11,773 forecast games of
   * 400 made-up leagues. The engine's margin is 0.2 runs each time, the away side's in demo-23 and
   * the home side's in demo-28. The margin beside the pick is the per-game model's score's, 8 to 7
   * in demo-23 and 9 to 9 in demo-28, given only where it backs the pick.
   */
  it.each([
    { id: "demo-23", chance: 0.497, engineBacks: "away", pick: "home", shown: "" },
    { id: "demo-28", chance: 0.503, engineBacks: "home", pick: "away", shown: "" },
    { id: "demo-28", chance: 0.5, engineBacks: "home", pick: "away", shown: "" },
    // Where the margin backs the pick, it is still given beside it.
    { id: "demo-23", chance: 0.503, engineBacks: "away", pick: "away", shown: " by 1" },
  ] as const)(
    "name the Schedule's pick in a toss-up ($id at $chance)",
    ({ id, chance, engineBacks, pick, shown }) => {
      const game = gameOf(id);
      const call = engine.predictions.find((one) => one.gameId === game.id);
      if (!call) throw new Error("No forecast");
      expect(call.predictedWinnerId).toBe(game[engineBacks]);
      draw({ predictions: [call], odds: () => chance });
      const card = cardOf(game);
      expect(blockOf(card, "Win Probability")).toBe(
        `${nameOf(game.away)}50%${nameOf(game.home)}50%`
      );
      expect(blockOf(card, "Projected Winner")).toBe(`${nameOf(game[pick])}${shown}`);
      expect(within(card).getByRole("button", { name: "Why a toss-up?" })).toBeInTheDocument();
    }
  );

  it("name no winner where the engine has nothing to forecast and the chance is even", () => {
    // Before any score is in, every game is even and the engine forecasts none of them: naming
    // each game's away side the winner would be a pick made of nothing.
    const unplayed = calculateTeams(teams, matchups, {}, settings);
    const none = buildPredictionEngine(unplayed, matchups, {}, settings);
    const known = attachAdjustedRatings(unplayed, none.ratings);
    const knownById = new Map(known.map((team) => [team.id, team]));
    const evenOdds = (game: Matchup) => predictGame(game, known, settings, knownById).awayWinPct;
    draw({ forecast: none, odds: evenOdds });
    expect(
      screen.getAllByText("Expected Score").map((label) => label.nextElementSibling?.textContent)
    ).toEqual(["Needs scores", "Needs scores", "Needs scores"]);
    const winners = screen
      .getAllByText("Projected Winner")
      .map((label) => label.nextElementSibling?.textContent);
    expect(winners).toEqual(["Pending data", "Pending data", "Pending data"]);
    for (const label of screen.getAllByText("Win Probability"))
      expect(label.nextElementSibling?.textContent).toMatch(/^\D+50%\D+50%$/);
  });

  it("say the per-game model's pick and chance on a phone, a line each", () => {
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
      const game = gameOf("demo-20");
      const line = screen.getByRole("button", {
        name: new RegExp(`^${nameOf(game.away)} vs ${nameOf(game.home)}`),
      });
      expect(line).toHaveTextContent(`Pick: ${nameOf(game.away)} · 57%`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
