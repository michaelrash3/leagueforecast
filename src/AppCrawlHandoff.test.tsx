import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { HANDOFF_CHANNEL } from "./lib/crawlHandoff";
import { resetHandoffForTests } from "./lib/crawlHandoffStore";
import { parseRankingsRoute } from "./lib/rankingsRoute";
import { saveMatchups, saveTeams } from "./lib/storage";
import { prefetchAllViews } from "./components/league/leagueViews";

beforeAll(() => prefetchAllViews());

/*
 * The crawl's files arriving from the owner's userscript while League Standings is open: Team
 * Rankings' Import opens, with Back returning to the page the reader was on. Placeholder names.
 */

describe("the crawl's files arriving at the app", () => {
  beforeEach(() => {
    resetHandoffForTests();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/?view=league");
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
    resetHandoffForTests();
    window.history.replaceState(null, "", "/");
  });

  it("open Team Rankings' Import, a page Back can leave", async () => {
    render(<App />);
    const before = window.history.length;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            channel: HANDOFF_CHANNEL,
            v: 1,
            from: "miner",
            type: "files",
            id: "run_1",
            createdAt: "2026-10-25T18:00:00.000Z",
            teams: {
              name: "GC_Teams_New.csv",
              text: '"Team Name","Team ID"\r\n"Owls","Ab3dE5gH7jK9"',
            },
          },
          origin: window.location.origin,
          source: window,
        })
      );
    });
    await waitFor(() =>
      expect(parseRankingsRoute(window.location.search)).toMatchObject({
        mode: "rankings",
        section: "import",
      })
    );
    expect(window.history.length).toBe(before + 1);
  });
});
