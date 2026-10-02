import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadScoutGames } from "../../lib/teamRankingsStorage";
import type { ScoutGame } from "../../lib/teamRankings";
import {
  ageGroup,
  game,
  renderTeamRankings,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/*
 * The Games tab lists a week either side of the newest GameChanger pull, and the rest one click
 * away. The clock is pinned three days after the pull, so the window (22 September to 6 October)
 * is the pull's and not the reader's day: a window centred on the reader's day would keep the
 * game of 8 October and drop the one of 22 September.
 */
const TODAY = "2026-10-02T12:00:00";
const PULLED = new Date(2026, 8, 29, 12).toISOString();

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(TODAY));
});
afterAll(() => vi.useRealTimers());

const open = (id: string, ageGroupId: string, a: string, b: string, date?: string): ScoutGame => ({
  id,
  ageGroupId,
  teamAId: a,
  teamBId: b,
  ...(date === undefined ? {} : { date }),
});

const pool = (search = "?section=games"): Pool => ({
  ageGroups: [ageGroup(10, 2027), ageGroup(11, 2027), ageGroup(10, 2026)],
  teams: [
    team("S-OWLS", "Owls", {
      state: "KY",
      gcTeams: [{ teamId: "gc-owls", name: "Owls", ageGroupId: "ag_10u_2027", importedAt: PULLED }],
    }),
    team("S-HAWK", "Hawks", { state: "KY" }),
    team("S-WREN", "Wrens", { state: "KY" }),
    team("S-JAYS", "Jays", { state: "KY" }),
  ],
  games: [
    game("near-ahead", "ag_10u_2027", "S-OWLS", "S-HAWK", 4, 3, { date: "2026-10-06" }),
    game("near-pull", "ag_10u_2027", "S-HAWK", "S-WREN", 5, 1, { date: "2026-09-29" }),
    game("near-behind", "ag_10u_2027", "S-WREN", "S-JAYS", 2, 0, { date: "2026-09-22" }),
    open("far-ahead", "ag_10u_2027", "S-OWLS", "S-JAYS", "2026-10-08"),
    game("far-played", "ag_10u_2027", "S-JAYS", "S-OWLS", 9, 8, { date: "2026-09-12" }),
    open("far-open", "ag_10u_2027", "S-JAYS", "S-HAWK", "2026-09-05"),
    open("undated", "ag_10u_2027", "S-WREN", "S-OWLS"),
    game("other-page", "ag_11u_2027", "S-HAWK", "S-JAYS", 3, 2, { date: "2026-09-01" }),
    // Last season's page: its last fortnight, not the pull's week, which it has no games in.
    game("old-last", "ag_10u_2026", "S-OWLS", "S-WREN", 6, 5, { date: "2026-06-20" }),
    game("old-before", "ag_10u_2026", "S-HAWK", "S-OWLS", 1, 0, { date: "2026-06-14" }),
    game("old-early", "ag_10u_2026", "S-JAYS", "S-WREN", 7, 2, { date: "2026-04-11" }),
  ],
  search,
});

/** The logged games' card, and the ids of the games it lists, by their dates. */
const card = () => screen.getByText(/^Logged games/).closest<HTMLElement>("div.rounded-lg")!;
const listedDates = () =>
  within(card())
    .queryAllByRole("listitem")
    .map((item) => /\d{4}-\d{2}-\d{2}/.exec(item.textContent ?? "")?.[0] ?? "no date");

describe("the Games tab's week either side of the last pull", () => {
  it("lists the week either side of the pull, and says what it leaves out", () => {
    renderTeamRankings(pool());
    expect(listedDates()).toEqual(["2026-10-06", "2026-09-29", "2026-09-22"]);
    expect(screen.getByTestId("games-window")).toHaveTextContent(
      "Games within a week of the last GameChanger pull (Tue, Sep 29). 4 more are hidden (1 undated, 1 still need a score)."
    );
  });

  it("shows every game when asked, so an old game can still be scored", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("button", { name: "Show all 7 games" }));
    expect(listedDates()).toEqual([
      "2026-10-08",
      "2026-10-06",
      "2026-09-29",
      "2026-09-22",
      "2026-09-12",
      "2026-09-05",
      "no date",
    ]);
    expect(screen.getByTestId("games-window")).toHaveTextContent("All 7 games on this page.");

    const farOpen = within(card())
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("2026-09-05"))!;
    await user.click(within(farOpen).getByRole("button", { name: "Enter score" }));
    const [scoreA, scoreB] = within(farOpen).getAllByPlaceholderText("Score");
    await user.type(scoreA!, "6");
    await user.type(scoreB!, "4");
    await user.click(within(farOpen).getByRole("button", { name: "Save" }));
    expect(loadScoutGames().find((entry) => entry.id === "far-open")).toMatchObject({
      teamAScore: 6,
      teamBScore: 4,
    });

    await user.click(screen.getByRole("button", { name: "Show only games near Tue, Sep 29" }));
    expect(listedDates()).toEqual(["2026-10-06", "2026-09-29", "2026-09-22"]);
  });

  it("keeps a game just added on the list, however old its date", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.type(screen.getByPlaceholderText("Team name"), "Owls");
    await user.type(screen.getByPlaceholderText("Opponent name"), "Wrens");
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="date"]')!, {
      target: { value: "2026-08-15" },
    });
    await user.click(screen.getByRole("button", { name: "Add Game" }));

    expect(listedDates()).toContain("2026-08-15");
    expect(loadScoutGames().some((entry) => entry.date === "2026-08-15")).toBe(true);
  });

  it("opens another page on its own window, whatever was shown on the last", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("button", { name: "Show all 7 games" }));
    await user.click(
      within(screen.getByRole("navigation", { name: "Age level" })).getByRole("button", {
        name: /^11U/,
      })
    );
    expect(listedDates()).toEqual([]);
    expect(screen.getByText("No games within a week of Tue, Sep 29.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all 1 game" })).toBeInTheDocument();
  });

  it("shows a finished season its own last fortnight", () => {
    renderTeamRankings(pool("?section=games&age=10&year=2026"));
    expect(listedDates()).toEqual(["2026-06-20", "2026-06-14"]);
    expect(screen.getByTestId("games-window")).toHaveTextContent(
      "Games within a week of Sat, Jun 20, the nearest day this season has games. 1 more is hidden."
    );
  });
});
