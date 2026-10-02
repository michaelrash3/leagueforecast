import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadScoutGames, loadScoutGamesForYear } from "../../lib/teamRankingsStorage";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/**
 * The view holds one squad year's games and reads the others only when something needs all of
 * them. Two years, a game in each: the page shows its own year's game and not the other's, the
 * other year is still in storage untouched, and the search — the one thing that must see every
 * year — still finds a club filed under the year that is not on screen.
 */
/*
 * The day after the games are dated. The Games tab lists a week either side of the last update
 * (`gamesWindow.ts`), and this pool has never been pulled, so the reader's day is that update: on
 * the real clock these games would drift out of the list as the season went on.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-13T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const pool = () => ({
  ageGroups: [ageGroup(10, 2027), ageGroup(11, 2028)],
  teams: [
    team("S-RAPT", "River City Raptors", { state: "KY" }),
    team("S-PION", "South Kenton Pioneers", { state: "KY" }),
    team("S-CANE", "Canes Triad Black", { state: "NC" }),
    team("S-LEGA", "Legacy Baseball Club", { state: "KY" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-RAPT", "S-PION", 15, 7, { date: seasonDate(2027) }),
    game("g2", "ag_11u_2028", "S-CANE", "S-LEGA", 6, 2, { date: seasonDate(2028) }),
  ],
});

describe("a page holds its own year", () => {
  it("lists the games of the year on screen and none from the other", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /^games$/i }));

    // The logged games are list items; a picker may name every team, so only the items are read.
    const items = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(items.some((text) => /River City Raptors/.test(text))).toBe(true);
    expect(items.some((text) => /Canes Triad Black/.test(text))).toBe(false);
  });

  it("leaves the other year exactly as stored, and the whole pool whole", () => {
    renderTeamRankings(pool());
    expect(loadScoutGamesForYear(2028).map((entry) => entry.id)).toEqual(["g2"]);
    expect(loadScoutGames().map((entry) => entry.id)).toEqual(["g1", "g2"]);
  });
});
