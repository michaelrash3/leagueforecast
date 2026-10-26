import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { saveLogs, saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * A team's panel opened from any tab but Forecast: its Range is the best and worst seed one
 * remaining result can move it to. The walk that works it out ran only while Forecast was open, so
 * a panel opened from the Dashboard or Standings showed the projection at both ends, "#2–#2", and
 * its two swing games "win → #2, loss → #2", as if nothing left could move the team. Placeholder
 * names.
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
  });
});
