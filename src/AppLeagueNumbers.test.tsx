import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { loadSettings, saveLogs, saveMatchups, saveSettings, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * The numbers League Standings shows on each tab, pinned (2.1). Splitting the views into chunks of
 * their own, and later computing only what is on screen (2.2), must leave every one of them where
 * it was; a change that is meant to move one updates this file, and its commit says so. A table's
 * rows are kept whole, so a team moving rows shows; the rest of a tab is kept as its numbers, in
 * order, so a reworded label does not count as a moved number. The forecast is seeded from the
 * season (`simulationSeed`), so it comes out the same every run. Placeholder names.
 */

const final = (away: number, home: number, awayHits = 6, homeHits = 5): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: String(awayHits),
  homeHits: String(homeHits),
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

const TEAMS = ["Aces", "Bears", "Comets", "Ducks", "Eagles", "Foxes"].map((name) => ({
  id: name[0] ?? name,
  name,
}));

/** Each team plays each other once, three dates' worth played and two to come. */
const GAMES: Array<[string, string, string]> = [
  ["2026-09-05", "A", "B"],
  ["2026-09-05", "C", "D"],
  ["2026-09-05", "E", "F"],
  ["2026-09-12", "A", "C"],
  ["2026-09-12", "B", "E"],
  ["2026-09-12", "D", "F"],
  ["2026-09-19", "A", "D"],
  ["2026-09-19", "B", "F"],
  ["2026-09-19", "C", "E"],
  ["2026-10-03", "A", "E"],
  ["2026-10-03", "B", "D"],
  ["2026-10-03", "C", "F"],
  ["2026-10-10", "A", "F"],
  ["2026-10-10", "B", "C"],
  ["2026-10-10", "D", "E"],
];

const SCORES: Record<string, GameLog> = {
  g1: final(7, 3),
  g2: final(4, 5, 7, 6),
  g3: final(2, 9, 3, 11),
  g4: final(6, 6, 8, 8),
  g5: final(3, 1),
  g6: final(10, 4, 12, 5),
  g7: final(5, 2),
  g8: final(1, 8, 2, 9),
  g9: final(4, 3, 6, 6),
};

/**
 * What a tab shows: its tables' rows whole, and every other number on it in order. Nothing while
 * the tab is still loading (2.1), whose placeholder is no reading of it.
 */
const reading = (): string => {
  const main = document.querySelector("main");
  if (!main) return "";
  const loading = [...main.querySelectorAll('[role="status"]')].some((status) =>
    /^Loading .*…$/.test(status.textContent ?? "")
  );
  if (loading) return "";
  const rows = [...main.querySelectorAll("tr")].map((row) =>
    (row.textContent ?? "").replace(/\s+/g, " ").trim()
  );
  const rest = main.cloneNode(true) as HTMLElement;
  rest.querySelectorAll("table").forEach((table) => table.remove());
  const numbers = (rest.textContent ?? "").match(/[-+−]?\d+(?:[.,:]\d+)*%?/g) ?? [];
  return [...rows, `numbers: ${numbers.join(" ")}`].join("\n");
};

/**
 * The tab's reading once it has held for four looks in a row, 250 ms apart: the forecast and the
 * trend land a beat after the tab, and a chart or matrix the tab loads on its own a beat after
 * that, so two looks that agree can still be early.
 */
const settled = async (): Promise<string> => {
  let last = "";
  let held = 0;
  await waitFor(
    () => {
      const now = reading();
      held = now === last && now !== "" ? held + 1 : 0;
      last = now;
      expect(held).toBeGreaterThanOrEqual(3);
    },
    { interval: 250, timeout: 20_000 }
  );
  return last;
};

describe("League Standings' numbers on every tab (2.1 pin)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-25T16:00:00Z"));
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
    saveMatchups(GAMES.map(([date, away, home], at) => ({ id: `g${at + 1}`, date, away, home })));
    saveLogs(SCORES);
    saveSettings({ ...loadSettings(), goldCutoff: 4 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stay where they were pinned", async () => {
    const user = userEvent.setup();
    render(<App />);
    const pinned: Record<string, string> = {};
    for (const tab of ["Dashboard", "Power Ratings", "Standings", "League Stats", "Forecast"]) {
      await user.click(await screen.findByRole("tab", { name: tab }));
      pinned[tab] = await settled();
    }
    expect(pinned).toMatchSnapshot();
  }, 120_000);
});
