import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backtestPredictions } from "../../lib/backtest";
import { buildDemoSeason } from "../../lib/demoSeason";
import { buildPredictionEngine } from "../../lib/predictionEngine";
import { attachAdjustedRatings, calculateTeams, predictGame } from "../../lib/sim";
import type { Matchup } from "../../lib/types";
import { DashboardView } from "./DashboardView";

/*
 * One win chance for each game (sweep item 29). The Dashboard's list showed the prediction engine's
 * chance, read off a rating margin, where the Our team card, the Schedule and the Gold odds read the
 * per-game model's (`predictGame`): the demo season's second game still to play was 54% on the list
 * and 57% on the Schedule, and its last game had each model backing a different side. The list
 * shows the per-game model's chance now, and its pick. The demo season, its teams renamed to
 * placeholders.
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
const nameOf = (id: string) => byId.get(id)?.name ?? id;
const gameOf = (id: string): Matchup => {
  const game = matchups.find((one) => one.id === id);
  if (!game) throw new Error(`No game ${id}`);
  return game;
};
const percent = (chance: number) => `${Math.round(chance * 100)}%`;

const draw = (predictions = engine.predictions) =>
  render(
    <DashboardView
      engine={{ ...engine, predictions }}
      backtestResult={backtestPredictions([], [], {}, settings)}
      teamsById={byId}
      matchups={matchups}
      setActiveView={vi.fn()}
      findings={[]}
      gameOdds={gameOdds}
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
    draw([call]);
    const card = cardOf(game);
    expect(blockOf(card, "Projected Winner")).toMatch(new RegExp(`^${nameOf(game.away)}(Range|$)`));
    expect(blockOf(card, "Win Probability")).toBe(`${nameOf(game.away)}52%${nameOf(game.home)}48%`);
    expect(
      within(card).getByRole("button", { name: `Why ${nameOf(game.away)} at 52%?` })
    ).toBeInTheDocument();
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
