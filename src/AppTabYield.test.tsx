import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { loadLogs, saveMatchups, saveTeams } from "./lib/storage";
import { flushBeforeYield } from "./lib/tabTurn";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * Another tab's Use here asks this one, the writer, for the turn (`tabTurnChannel.ts`). App holds a
 * typed score half a second before saving it, and a writer read-only at once had that save
 * refused, so the tab taking over reloaded without the score. The writer writes it first.
 */
describe("a tab giving its turn to another", () => {
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
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("writes a score still waiting to be saved before it gives the turn", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    const away = await screen.findByLabelText("Aces Runs");
    // The half second's wait never ends on its own here.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    act(() => {
      fireEvent.change(away, { target: { value: "7" } });
    });
    expect(loadLogs().g1?.awayRuns ?? "").toBe("");

    act(() => flushBeforeYield());

    expect(loadLogs().g1?.awayRuns).toBe("7");
  });
});
