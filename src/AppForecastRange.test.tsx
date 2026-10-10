import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { saveLogs, saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog, Matchup } from "./lib/types";

/*
 * The Forecast tab's Range with more games left than the scenario walk is run for (60): App passes
 * the limit down while the walk is off, so the table says it is waiting rather than showing every
 * team's projection at both ends as a seed nothing left can move. The other side, the walk on, is
 * the League numbers pin (`AppLeagueNumbers.test.tsx`), whose Range column is worked out.
 * Placeholder names.
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

const TEAMS = ["Aces", "Bears", "Comets", "Ducks", "Eagles", "Foxes"].map((name) => ({
  id: name[0] ?? name,
  name,
}));

/** Each pair meets five times, a week apart: 75 games, of which the first six are played. */
const GAMES: Matchup[] = Array.from({ length: 5 }, (_, round) =>
  TEAMS.flatMap((away, at) =>
    TEAMS.slice(at + 1).map((home) => ({ away: away.id, home: home.id }))
  ).map((pair, at) => ({
    ...pair,
    id: `r${round + 1}-${at + 1}`,
    date: `2026-${String(4 + round).padStart(2, "0")}-${String(1 + at).padStart(2, "0")}`,
  }))
).flat();
const SCORES: Record<string, GameLog> = Object.fromEntries(
  GAMES.slice(0, 6).map((game, at) => [game.id, final(3 + (at % 4), 2 + (at % 3))])
);

describe("the Forecast tab's Range, too many games out for the walk", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })
    );
    saveTeams(TEAMS);
    saveMatchups(GAMES);
    saveLogs(SCORES);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("says the walk is paused until 60 or fewer games remain, and shows no seed span", async () => {
    expect(GAMES.length - Object.keys(SCORES).length).toBeGreaterThan(60);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Forecast" }));
    expect(
      await screen.findByText(
        "Range, the best and worst seed one remaining result can move a team's projection to, is paused until 60 or fewer games remain to keep this page responsive.",
        undefined,
        { timeout: 20_000 }
      )
    ).toBeInTheDocument();
    const standings = screen
      .getByRole("heading", { name: "Projected Standings" })
      .closest("section");
    if (!standings) throw new Error("No Projected Standings");
    const table = within(standings).getByRole("table");
    const column = within(table)
      .getAllByRole("columnheader")
      .findIndex((cell) => cell.textContent === "Range");
    const cells = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[column]?.textContent);
    expect(cells).toEqual(TEAMS.map(() => "—"));
  }, 60_000);
});
