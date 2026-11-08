import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { saveLogs, saveMatchups, saveSettings, saveTeams } from "./lib/storage";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "./lib/types";

/*
 * A team's panel opened from any tab but Forecast: its Range is the best and worst seed one
 * remaining result can move it to. The walk that works it out ran only while Forecast was open, so
 * a panel opened from the Dashboard or Standings showed the projection at both ends, "#2–#2", and
 * its two swing games "win → #2, loss → #2", as if nothing left could move the team. With more
 * games left than the walk is run for (60) it showed the same, and still did after the Forecast's
 * table learned to say the walk was paused. Placeholder names.
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

describe("a team's panel away from the Forecast tab", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Comets" },
      { id: "D", name: "Ducks" },
    ]);
    // Every side one and one, with two games left: Aces against Comets, Bears against Ducks.
    saveMatchups([
      { id: "g1", date: "4/1", away: "A", home: "B" },
      { id: "g2", date: "4/1", away: "C", home: "D" },
      { id: "g3", date: "4/8", away: "B", home: "C" },
      { id: "g4", date: "4/8", away: "D", home: "A" },
      { id: "g5", date: "12/1", away: "A", home: "C" },
      { id: "g6", date: "12/1", away: "B", home: "D" },
    ]);
    saveLogs({ g1: final(5, 3), g2: final(4, 2), g3: final(6, 1), g4: final(3, 2) });
    window.history.replaceState(null, "", "/?team=A");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("works out the range one remaining result can move the team to", async () => {
    render(<App />);
    const panel = await screen.findByRole("dialog", undefined, { timeout: 20_000 });
    const range = within(panel).getByText("Range").nextElementSibling;
    await waitFor(() => {
      const [best, worst] = (range?.textContent ?? "").match(/\d+/g)?.map(Number) ?? [];
      expect(best).toBeDefined();
      expect(best).toBeLessThan(worst ?? 0);
    });
    // And the seed either result of its game left leaves, from the same walk, nothing paused.
    expect(within(panel).getByText(/^Win: #\d+$/)).toBeInTheDocument();
    expect(within(panel).getByText(/^Loss: #\d+$/)).toBeInTheDocument();
    expect(within(panel).queryByText(/paused until 60/)).toBeNull();
  });
});

describe("a team's panel, too many games out for the walk", () => {
  const TEAMS: TeamBase[] = ["Aces", "Bears", "Comets", "Ducks", "Eagles", "Foxes"].map((name) => ({
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

  beforeEach(() => {
    window.localStorage.clear();
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
    // A cut line the Bears are outside of, so their panel has clinch scenarios to give.
    saveSettings({ ...DEFAULT_SETTINGS, goldCutoff: 3 });
    window.history.replaceState(null, "", "/?team=B");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("says the walk is paused, and shows no seed it has not worked out", async () => {
    expect(GAMES.length - Object.keys(SCORES).length).toBeGreaterThan(60);
    render(<App />);
    const panel = await screen.findByRole("dialog", undefined, { timeout: 20_000 });

    expect(within(panel).getByText("Range").nextElementSibling).toHaveTextContent(/^—$/);
    expect(
      within(panel).getByText(
        "Range is paused until 60 or fewer games remain to keep team modals responsive."
      )
    ).toBeInTheDocument();
    // Its next two games are still listed, with the model's pick, but not the seed each leaves.
    expect(within(panel).getAllByText("Win: —")).toHaveLength(2);
    expect(within(panel).getAllByText("Loss: —")).toHaveLength(2);
    expect(
      within(panel).getByText(
        "The seed a win or a loss leaves is paused until 60 or fewer games remain to keep team modals responsive."
      )
    ).toBeInTheDocument();
    // The clinch scenarios are those same seeds in words: "win projects #5; loss projects #5".
    expect(
      within(panel).getByText(
        "Clinch scenarios are paused until 60 or fewer games remain to keep team modals responsive."
      )
    ).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/#\d+–#\d+|(?:Win|Loss): #\d|projects #\d/);
  }, 60_000);
});
