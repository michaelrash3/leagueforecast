import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import {
  createSeason,
  getActiveSeasonId,
  loadLogs,
  loadLogsForSeason,
  saveMatchups,
  saveTeams,
} from "./lib/storage";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * App writes a score half a second after the last keystroke. A score typed in that half second
 * and then left, by opening another season or by the page being hidden or closed, was never
 * written: the switch made the other season's scores the ones held, and a page gone has no timer.
 */
describe("a score still held when the page moves on", () => {
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  /** Types the away side's runs into the first game, and holds the save's half second still. */
  const typeScore = async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    const away = await screen.findByLabelText("Aces Runs");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      fireEvent.change(away, { target: { value: "7" } });
    });
    expect(loadLogs().g1?.awayRuns ?? "").toBe("");
  };

  it("is written into its own season before another season opens", async () => {
    const fall = createSeason("Fall");
    const opened = getActiveSeasonId();
    await typeScore();
    act(() => {
      fireEvent.change(screen.getByLabelText("Active season"), { target: { value: fall.id } });
    });
    expect(getActiveSeasonId()).toBe(fall.id);
    expect(loadLogsForSeason(opened).g1?.awayRuns).toBe("7");
    // And into no other: once the switch is made, a save goes into the season switched to.
    expect(window.localStorage.getItem(`league_season_${fall.id}_logs_v1`) ?? "").not.toContain(
      "g1"
    );
  });

  it("is written as the page is hidden", async () => {
    await typeScore();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(loadLogs().g1?.awayRuns).toBe("7");
  });

  it("is written as the page is closed", async () => {
    await typeScore();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(loadLogs().g1?.awayRuns).toBe("7");
  });
});
