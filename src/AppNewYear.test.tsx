import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { saveLogs, saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog } from "./lib/types";
import { prefetchAllViews } from "./components/league/leagueViews";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * A League Standings season played over New Year, as a fall league that runs into winter is.
 * Its dates are "M/D" with no year, and were ordered inside one calendar year, so 9 January came
 * before 12 December and the Dashboard gave January's game as the Aces' next one.
 */
const final = (awayRuns: string, homeRuns: string): GameLog => ({
  awayRuns,
  homeRuns,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

describe("a season with games either side of 1 January", () => {
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
      { id: "C", name: "Comets" },
    ]);
    saveMatchups([
      { id: "g1", date: "11/14", away: "A", home: "B" },
      { id: "g2", date: "12/12", away: "C", home: "A" },
      { id: "g3", date: "1/9", away: "A", home: "B" },
    ]);
    saveLogs({ g1: final("7", "2") });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gives 12 December as the Aces' next game, not 9 January", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    await user.selectOptions(
      within(screen.getByRole("region", { name: "Our team" })).getByRole("combobox"),
      "Aces"
    );
    expect(screen.getByRole("region", { name: "Our team" })).toHaveTextContent(
      /Next: 12\/12 vs Comets/
    );
  });

  it("lists December's game before January's on the Schedule", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    const cards = [...container.querySelectorAll('[id^="game-card-"]')].map((card) => card.id);
    expect(cards.filter((id) => id !== "game-card-g1")).toEqual(["game-card-g2", "game-card-g3"]);
  });

  it("puts December's game first in the playoff machine", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("tab", { name: "Forecast" }));
    const machine = await screen.findByRole("region", { name: "Playoff machine" });
    const games = within(machine)
      .getAllByRole("group")
      .map((group) => group.getAttribute("aria-label"))
      .filter((label) => label?.includes(" at "));
    expect(games).toEqual(["Comets at Aces", "Aces at Bears"]);
  });
});
