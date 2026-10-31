import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import type { SeasonStore } from "./lib/seasonStore";
import { loadLogs, saveMatchups, saveTeams } from "./lib/storage";
import { adoptTabTurn } from "./lib/tabTurn";
import { createTabTurn } from "./lib/tabTurnChannel";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * League kept live runs in a window another window has the turn from (`tabTurn.ts`), so the season
 * on screen follows what other devices send while storage refuses every League write made there.
 * App's saves of that season are refused with the rest, and the banner says why.
 */
const live = vi.hoisted(() => ({ seasons: null as SeasonStore | null }));

vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: ({ seasons }: { seasons: SeasonStore }) => {
    live.seasons = seasons;
    return { state: { kind: "live" }, guardUndo: () => null, removeSeason: async () => true };
  },
}));

describe("a window another has the turn from, hearing another device", () => {
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
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    saveMatchups([{ id: "g1", date: "5/1", away: "A", home: "B" }]);
  });
  afterEach(() => {
    adoptTabTurn(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    live.seasons = null;
  });

  it("says nothing of storage being full", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    await screen.findByLabelText("Aces Runs");
    const turn = createTabTurn({ channel: null, openedAt: 0, id: "t", claimed: () => false });
    act(() => adoptTabTurn({ ...turn, readOnly: () => true }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const arrived = {
      awayRuns: "5",
      homeRuns: "2",
      awayHits: "",
      homeHits: "",
      awayK: "",
      homeK: "",
      innings: "6",
      isFinal: false,
    };
    act(() => {
      const seasons = live.seasons!;
      seasons.apply({ ...seasons.get().season, logs: { g1: arrived } });
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByLabelText("Aces Runs")).toHaveValue("5");
    // Refused by the turn, as storage is told to: no room was ever short.
    expect(loadLogs()).toEqual({});
    expect(screen.queryByText(/storage full/i)).toBeNull();
  });
});
