import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { saveLogs, saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog, Matchup } from "./lib/types";

/*
 * A club's name is never cut to "…" on a league page.
 *
 * #274 fixed one Team Rankings card; the same `truncate` stood on eight more lists. On a 360px
 * phone a name had 112 to 134px, and the reviewers measured 5 of 8 Standings names, 21 Schedule
 * cells and 6 of 7 Title odds cut, "Cincinnati Hor…" beside "Cincinnati Ang…". jsdom lays nothing
 * out, so what is checked is the cause: the element holding a name, and the two around it, carry no
 * `truncate`. A class for wider screens only (`xl:truncate`, `sm:truncate`) is a different token.
 */
const names = [
  "Trash Pandas Baseball Club",
  "Cincinnati Angels- Red",
  "Cincinnati Hornets Baseball",
  "513 FORCE - BOULEY",
];
const teams = names.map((name, index) => ({ id: `T${index}`, name }));
const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  awayHits: "5",
  awayK: "3",
  homeRuns: String(home),
  homeHits: "4",
  homeK: "2",
  innings: "6",
  isFinal: true,
});
const matchups: Matchup[] = [];
const logs: Record<string, GameLog> = {};
teams.forEach((home, i) =>
  teams.slice(i + 1).forEach((away, j) => {
    const id = `g${i}${j}`;
    matchups.push({ id, date: `9/${5 + i + j}`, away: away.id, home: home.id });
    logs[id] = final(3 + j, 2 + i);
    // And once more each, still to be played, so the forecast has something to forecast.
    matchups.push({ id: `r${i}${j}`, date: `10/${5 + i + j}`, away: home.id, home: away.id });
  })
);

/** Every element on the page whose own text is a club's name, and the two elements around it. */
const clipped = () =>
  names.flatMap((name) =>
    screen.queryAllByText(name).flatMap((element) => {
      const chain: Element[] = [];
      for (let node: Element | null = element; node && chain.length < 3; node = node.parentElement)
        chain.push(node);
      return chain.some((node) => node.classList.contains("truncate")) ? [name] : [];
    })
  );

describe("club names on the league pages, on a phone", () => {
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
    saveTeams(teams);
    saveMatchups(matchups);
    saveLogs(logs);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("are written out whole on every tab", async () => {
    const user = userEvent.setup();
    render(<App />);
    const tabs = screen.getByRole("tablist", { name: "Main views" });
    const seen: string[] = [];
    for (const label of [
      "Dashboard",
      "Power Ratings",
      "Schedule",
      "Standings",
      "League Stats",
      "Forecast",
    ]) {
      await user.click(within(tabs).getByRole("tab", { name: label }));
      expect(clipped(), label).toEqual([]);
      if (names.some((name) => screen.queryAllByText(name).length > 0)) seen.push(label);
    }
    // The walk is worth something: every tab put the names on the page.
    expect(seen).toEqual([
      "Dashboard",
      "Power Ratings",
      "Schedule",
      "Standings",
      "League Stats",
      "Forecast",
    ]);
  });
});
