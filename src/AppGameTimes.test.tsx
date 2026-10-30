import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { formatStartTime } from "./lib/date";
import type { LiveLeagueState } from "./lib/live/leagueSync";
import { saveMatchups, saveTeams } from "./lib/storage";

/*
 * The Schedule lists a day's games in the order they are played, by the start GameChanger gave,
 * and shows each start. A doubleheader stored second-game-first came out that way. Placeholder
 * names.
 */
beforeAll(() => prefetchAllViews());

const live = vi.hoisted(() => ({ state: { kind: "off" } as LiveLeagueState }));
vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: () => ({
    state: live.state,
    guardUndo: () => null,
    removeSeason: async () => true,
  }),
}));

const AT_TEN = "2026-10-24T14:00:00Z";
const AT_TWO = "2026-10-24T18:00:00Z";

describe("the Schedule in playing order", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    saveTeams([
      { id: "ACES", name: "Aces" },
      { id: "BEAR", name: "Bears" },
    ]);
    // The day's later game stored first, as a pull can leave it, and first by id too.
    saveMatchups([
      { id: "a_late", date: "10/24", away: "ACES", home: "BEAR", startTs: AT_TWO },
      { id: "b_early", date: "10/24", away: "BEAR", home: "ACES", startTs: AT_TEN },
      { id: "before", date: "10/23", away: "ACES", home: "BEAR" },
    ]);
  });
  afterEach(() => {
    live.state = { kind: "off" };
  });

  it("lists a day's games by start and shows each start", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("tab", { name: /schedule/i }));
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('[id^="game-card-"]')].map((card) =>
          card.id.replace("game-card-", "")
        )
      ).toEqual(["before", "b_early", "a_late"])
    );
    expect(screen.getByText(formatStartTime(AT_TEN))).toBeInTheDocument();
    expect(screen.getByText(formatStartTime(AT_TWO))).toBeInTheDocument();
  }, 30_000);
});
