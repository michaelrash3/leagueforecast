import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { backtestPredictions } from "./lib/backtest";
import { scheduleDifficultyForTeam } from "./lib/scheduleDifficulty";
import { buildSeasonTimeline } from "./lib/seasonTimeline";
import { calculateTeams } from "./lib/sim";
import { saveLogs, saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * League Standings works out only what is on screen (2.2). A score typed into a game still being
 * played moves no number, so it works nothing out; marking the game final works the season out
 * again, but not what only the Dashboard or the Forecast shows while the Schedule is open; and a
 * tab opened again on a season that has not changed gives what it worked out before.
 *
 * Counted at the calculations themselves, each wrapped to count its calls and otherwise as it is.
 */
vi.mock("./lib/sim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/sim")>();
  return { ...actual, calculateTeams: vi.fn(actual.calculateTeams) };
});
vi.mock("./lib/backtest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/backtest")>();
  return { ...actual, backtestPredictions: vi.fn(actual.backtestPredictions) };
});
vi.mock("./lib/scheduleDifficulty", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/scheduleDifficulty")>();
  return { ...actual, scheduleDifficultyForTeam: vi.fn(actual.scheduleDifficultyForTeam) };
});
vi.mock("./lib/seasonTimeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/seasonTimeline")>();
  return { ...actual, buildSeasonTimeline: vi.fn(actual.buildSeasonTimeline) };
});

beforeAll(() => prefetchAllViews());

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

const counted = {
  season: vi.mocked(calculateTeams),
  backtest: vi.mocked(backtestPredictions),
  timeline: vi.mocked(buildSeasonTimeline),
  /** Each team's schedule strength, which the Forecast's bubble reads for every team. */
  bubble: vi.mocked(scheduleDifficultyForTeam),
};
const forget = () => Object.values(counted).forEach((spy) => spy.mockClear());

/** Placeholder teams, each pair once, three games played. */
const seed = () => {
  saveTeams(["Aces", "Bears", "Comets", "Ducks"].map((name) => ({ id: name[0] ?? name, name })));
  saveMatchups([
    { id: "g1", date: "2026-09-05", away: "A", home: "B" },
    { id: "g2", date: "2026-09-05", away: "C", home: "D" },
    { id: "g3", date: "2026-09-12", away: "A", home: "C" },
    { id: "g4", date: "2026-10-03", away: "B", home: "D" },
    { id: "g5", date: "2026-10-03", away: "A", home: "D" },
    { id: "g6", date: "2026-10-10", away: "B", home: "C" },
  ]);
  saveLogs({ g1: final(7, 3), g2: final(4, 5), g3: final(6, 2) });
};

/** Waits for the season to have been worked out, and for nothing more to come of it. */
const settled = async () => {
  let calls = -1;
  await waitFor(
    () => {
      const now = counted.season.mock.calls.length;
      const same = now === calls;
      calls = now;
      expect(same).toBe(true);
    },
    { interval: 200, timeout: 10_000 }
  );
};

describe("League Standings works out only what is on screen (2.2)", () => {
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
    seed();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("while a score is entered, and when a tab is opened again", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: "Schedule" }));
    const card = await waitFor(() => {
      const found = document.getElementById("game-card-g4");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    await settled();
    forget();

    // Typed into a game still being played: nothing is worked out again.
    await user.type(within(card).getByLabelText("Bears Runs"), "5");
    await user.type(within(card).getByLabelText("Ducks Runs"), "2");
    await within(card).findByText("Scores entered — verify final");
    await settled();
    expect(counted.season).not.toHaveBeenCalled();
    expect(counted.backtest).not.toHaveBeenCalled();
    expect(counted.timeline).not.toHaveBeenCalled();

    // Marked final: the season is worked out again, but not the Dashboard's and the Forecast's.
    await user.click(within(card).getByRole("button", { name: "Mark game as final" }));
    await waitFor(() => expect(counted.season).toHaveBeenCalled());
    await settled();
    expect(counted.backtest).not.toHaveBeenCalled();
    expect(counted.timeline).not.toHaveBeenCalled();
    expect(counted.bubble).not.toHaveBeenCalled();

    // Opened, each works out its own once; opened again on the same season, nothing.
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    await waitFor(() => expect(counted.backtest).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("tab", { name: "Forecast" }));
    await waitFor(() => expect(counted.timeline).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(counted.bubble).toHaveBeenCalled());
    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    await user.click(screen.getByRole("tab", { name: "Forecast" }));
    await settled();
    expect(counted.backtest).toHaveBeenCalledTimes(1);
    expect(counted.timeline).toHaveBeenCalledTimes(1);
  }, 60_000);
});
