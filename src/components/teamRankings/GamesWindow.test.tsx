import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadScoutGames } from "../../lib/teamRankingsStorage";
import { formatIsoDayShort, formatStartTime } from "../../lib/date";
import type { ScoutGame } from "../../lib/teamRankings";
import {
  ageGroup,
  game,
  renderTeamRankings,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/*
 * The Games tab lists today's games, and the rest one click away; a day with none opens on the
 * next day that has them. The clock is pinned three days after the newest pull, so the list is the
 * reader's day and not the pull's: one measured from the pull would show the game of 29 September
 * and hide both of 2 October.
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
    open("tomorrow", "ag_10u_2027", "S-OWLS", "S-JAYS", "2026-10-03"),
    open("today-open", "ag_10u_2027", "S-OWLS", "S-HAWK", "2026-10-02"),
    game("today-played", "ag_10u_2027", "S-WREN", "S-JAYS", 2, 0, { date: "2026-10-02" }),
    game("pull-day", "ag_10u_2027", "S-HAWK", "S-WREN", 5, 1, { date: "2026-09-29" }),
    game("far-played", "ag_10u_2027", "S-JAYS", "S-OWLS", 9, 8, { date: "2026-09-12" }),
    open("far-open", "ag_10u_2027", "S-JAYS", "S-HAWK", "2026-09-05"),
    open("undated", "ag_10u_2027", "S-WREN", "S-OWLS"),
    game("other-page", "ag_11u_2027", "S-HAWK", "S-JAYS", 3, 2, { date: "2026-09-01" }),
    // Last season's page: its last day with games, since it has no today.
    game("old-last", "ag_10u_2026", "S-OWLS", "S-WREN", 6, 5, { date: "2026-06-20" }),
    game("old-near", "ag_10u_2026", "S-JAYS", "S-OWLS", 4, 2, { date: "2026-06-18" }),
    game("old-early", "ag_10u_2026", "S-JAYS", "S-WREN", 7, 2, { date: "2026-04-11" }),
  ],
  search,
});

/** Each day a game here is on, by the words the list says it in ("Fri, Oct 2"). */
const DAYS = new Map(
  [...pool().games.map((one) => one.date), "2026-08-15"].flatMap((day) =>
    day ? [[formatIsoDayShort(day), day] as const] : []
  )
);

/** The logged games' card, and the days of the games it lists, as ISO days, in its order. */
const card = () => screen.getByText(/^Logged games/).closest<HTMLElement>("div.rounded-lg")!;
const listedDates = () =>
  within(card())
    .queryAllByRole("listitem")
    .map((item) => {
      const said = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]+ \d{1,2}(?!\d)/.exec(
        item.textContent ?? ""
      )?.[0];
      return (said && DAYS.get(said)) ?? "no date";
    });

describe("the Games tab's games of today", () => {
  it("lists today's games, and says what it leaves out", () => {
    renderTeamRankings(pool());
    expect(listedDates()).toEqual(["2026-10-02", "2026-10-02"]);
    expect(screen.getByTestId("games-window")).toHaveTextContent(
      "Today's games (Fri, Oct 2). 5 more are hidden (1 undated, 1 still need a score)."
    );
  });

  it("shows every game when asked, so an old game can still be scored", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("button", { name: "Show all 7 games" }));
    // The two still to play first, soonest first, then the rest newest first.
    expect(listedDates()).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-02",
      "2026-09-29",
      "2026-09-12",
      "2026-09-05",
      "no date",
    ]);
    expect(screen.getByTestId("games-window")).toHaveTextContent("All 7 games on this page.");

    const farOpen = within(card())
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes(formatIsoDayShort("2026-09-05")))!;
    await user.click(within(farOpen).getByRole("button", { name: "Enter score" }));
    const [scoreA, scoreB] = within(farOpen).getAllByPlaceholderText("Score");
    await user.type(scoreA!, "6");
    await user.type(scoreB!, "4");
    await user.click(within(farOpen).getByRole("button", { name: "Save" }));
    expect(loadScoutGames().find((entry) => entry.id === "far-open")).toMatchObject({
      teamAScore: 6,
      teamBScore: 4,
    });

    await user.click(screen.getByRole("button", { name: "Show only today's games" }));
    expect(listedDates()).toEqual(["2026-10-02", "2026-10-02"]);
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

  it("opens another page on its own day again, whatever was shown on the last", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("button", { name: "Show all 7 games" }));
    await user.click(
      within(screen.getByRole("navigation", { name: "Age level" })).getByRole("button", {
        name: /^11U/,
      })
    );
    // Its one game is behind it and none is to come, so it opens on that game's day.
    expect(listedDates()).toEqual(["2026-09-01"]);
    expect(screen.getByTestId("games-window")).toHaveTextContent(
      "No games today (Fri, Oct 2). The last games were on Tue, Sep 1."
    );
    // Every game it has is on the list, so there is no more to show.
    expect(screen.queryByRole("button", { name: /^Show all/ })).not.toBeInTheDocument();
  });

  it("opens a day with no games on the next day that has them, a step from the last", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const quiet = pool();
    // Today's two games taken off, so today has none.
    quiet.games = quiet.games.filter((one) => one.date !== "2026-10-02");
    renderTeamRankings(quiet);
    expect(listedDates()).toEqual(["2026-10-03"]);
    expect(screen.getByTestId("games-window")).toHaveTextContent(
      "No games today (Fri, Oct 2). The next games are on Sat, Oct 3. 4 more are hidden (1 undated, 1 still need a score)."
    );

    await user.click(screen.getByRole("button", { name: "Last game day: Tue, Sep 29" }));
    expect(listedDates()).toEqual(["2026-09-29"]);
    expect(screen.getByTestId("games-window")).toHaveTextContent(
      "No games today (Fri, Oct 2). The last games were on Tue, Sep 29."
    );

    await user.click(screen.getByRole("button", { name: "Next game day: Sat, Oct 3" }));
    expect(listedDates()).toEqual(["2026-10-03"]);
  });

  it("lists a day's games still to play soonest first, as Show all does", () => {
    const quiet = pool();
    // Today's two taken off, and the day after given a second game, starting first but stored after.
    quiet.games = [
      ...quiet.games.filter((one) => one.date !== "2026-10-02"),
      {
        ...open("early", "ag_10u_2027", "S-WREN", "S-HAWK", "2026-10-03"),
        startTs: "2026-10-03T13:00:00.000Z",
      },
    ].map((one) => (one.id === "tomorrow" ? { ...one, startTs: "2026-10-03T20:00:00.000Z" } : one));
    renderTeamRankings(quiet);
    const items = within(card()).getAllByRole("listitem");
    const pairs = ["Wrens vs Hawks", "Owls vs Jays"];
    expect(items.map((item) => pairs.find((pair) => item.textContent?.startsWith(pair)))).toEqual([
      "Wrens vs Hawks",
      "Owls vs Jays",
    ]);
  });

  it("says each game's day in words, and its start where GameChanger gave one", () => {
    const start = "2026-10-02T23:00:00.000Z";
    const timed = pool();
    timed.games = timed.games.map((one) =>
      one.id === "today-open" ? { ...one, startTs: start } : one
    );
    renderTeamRankings(timed);
    const items = within(card()).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(`Fri, Oct 2 · ${formatStartTime(start)}`);
    expect(items[1]).toHaveTextContent("Fri, Oct 2");
    expect(card()).not.toHaveTextContent(/\d{4}-\d{2}-\d{2}/);
  });

  it("shows a finished season its own last day of games", () => {
    renderTeamRankings(pool("?section=games&age=10&year=2026"));
    expect(listedDates()).toEqual(["2026-06-20"]);
    expect(screen.getByTestId("games-window")).toHaveTextContent(
      "This season's last day of games (Sat, Jun 20). 2 more are hidden."
    );
  });
});
