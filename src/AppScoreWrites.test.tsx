import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { loadLogs, saveMatchups, saveTeams } from "./lib/storage";
import { prefetchAllViews } from "./components/league/leagueViews";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * A score typed and a game marked Final at once. A score's keystrokes are a transition, so the
 * press that marks the game can come before they are on screen; the press then wrote a whole map of
 * scores built from the screen before them, and the score was gone.
 */

describe("a score typed and the game marked Final at once", () => {
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
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("keeps the score", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    const away = await screen.findByLabelText("Aces Runs");
    const home = screen.getByLabelText("Bears Runs");
    const game = away.closest("article") ?? document.body;
    act(() => {
      fireEvent.change(away, { target: { value: "7" } });
      fireEvent.change(home, { target: { value: "3" } });
      fireEvent.click(within(game).getByRole("button", { name: "Mark game as final" }));
    });
    await waitFor(() =>
      expect(loadLogs().g1).toMatchObject({ awayRuns: "7", homeRuns: "3", isFinal: true })
    );
  });
});
