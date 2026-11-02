import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";
import { formatStartTime } from "../../lib/date";

/*
 * After a tournament weekend the question is "did we climb?", and a board keeps no history. The
 * national board and the my-team card now say how far each club has moved since the board of a
 * week ago, fitted on the games played by then.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T12:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

// Aces lead the first fortnight; Does win everything the week before the 21st and climb.
const pool = (myTeamId?: string) => ({
  ageGroups: [ageGroup(10, 2027, myTeamId ? { myTeamId } : {})],
  teams: [
    team("S-ACE", "Aces", { state: "TX" }),
    team("S-BEE", "Bees", { state: "OH" }),
    team("S-COW", "Cows", { state: "OH" }),
    team("S-DOE", "Does", { state: "OH" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-ACE", "S-BEE", 8, 1, { date: "2026-09-05" }),
    game("g2", "ag_10u_2027", "S-ACE", "S-COW", 7, 2, { date: "2026-09-06" }),
    game("g3", "ag_10u_2027", "S-BEE", "S-DOE", 6, 3, { date: "2026-09-12" }),
    game("g4", "ag_10u_2027", "S-COW", "S-DOE", 5, 4, { date: "2026-09-13" }),
    game("g5", "ag_10u_2027", "S-DOE", "S-ACE", 9, 1, { date: "2026-09-19" }),
    game("g6", "ag_10u_2027", "S-DOE", "S-BEE", 9, 2, { date: "2026-09-20" }),
  ],
});

describe("movement since last week", () => {
  it("marks a club's climb on the national board", async () => {
    renderTeamRankings(pool());
    const board = (await screen.findByText(/National top/i)).closest("div")!.parentElement!;
    const does = within(board).getByRole("button", { name: /Does/ }).closest("li")!;
    // Last on the 14th, and somewhere above that now.
    expect(await within(does).findByLabelText(/^up \d+ since last week$/)).toBeInTheDocument();
    // A board's row keeps the mark alone, its words said only to a screen reader.
    expect(does).not.toHaveTextContent("since last week");
  });

  it("says it on the my-team card too, in words", async () => {
    renderTeamRankings(pool("S-DOE"));
    const card = await screen.findByRole("region", { name: "My team" });
    await waitFor(() => expect(card.textContent).toMatch(/nationally ▲\d+ since last week ·/));
    expect(within(card).getByRole("img", { name: "up" })).toHaveTextContent("▲");
  });
});

/*
 * The marked club's standing week by week, a line under its place on the "My team" card: the share
 * of each week's board at or above it, each week a fit of the year as it stood that day, walked
 * back until the half had not begun.
 */
describe("the standing line", () => {
  it("draws the club's share of each week's board up to now", async () => {
    renderTeamRankings(pool("S-DOE"));
    const card = await screen.findByRole("region", { name: "My team" });
    // Does had not played by the 7th and were last of the four on the 14th, the bottom quarter;
    // they lead now.
    const line = await within(card).findByRole("img", { name: /^Standing by week:/ });
    expect(line.getAttribute("aria-label")).toMatch(
      /^Standing by week: bottom 25% on .+, top 25% now$/
    );
    expect(card).toHaveTextContent(/Bottom 25% on .+, top 25% now/);
  });

  it("walks back past last week to the weeks before it", async () => {
    renderTeamRankings(pool("S-COW"));
    const card = await screen.findByRole("region", { name: "My team" });
    // Cows played on the 6th, so the board of the 7th has them as well as the 14th's and today's.
    const line = await within(card).findByRole("img", {
      name: /^Standing by week: (top|bottom) \d+% on .+, (top|bottom) \d+% on .+, (top|bottom) \d+% now$/,
    });
    expect(line).toBeInTheDocument();
  });

  it("draws nothing for a club with only today's place", async () => {
    renderTeamRankings({
      ...pool("S-DOE"),
      games: pool().games.filter((one) => one.date !== undefined && one.date >= "2026-09-19"),
    });
    const card = await screen.findByRole("region", { name: "My team" });
    await screen.findByText(/National top/i);
    expect(within(card).queryByRole("img", { name: /^Standing by week:/ })).toBeNull();
  });
});

/*
 * The Weekly on a page kept on this device: worked out from the pool as a published board carries
 * it (`theWeekly`, `teamWeek`), with the board's movers since last week.
 */
describe("The Weekly on this device", () => {
  it("says our club's week just played, with its best win, and the board's climbs", async () => {
    renderTeamRankings(pool("S-DOE"));
    const week = await screen.findByRole("region", { name: /^The Weekly/ });
    // Does beat Aces on the 19th and Bees on the 20th, the week before the 21st.
    await waitFor(() =>
      expect(week.textContent).toMatch(
        /Your week: Does went 2–0; best win over (Aces|Bees) \(#\d\)/
      )
    );
    // The climbs wait on last week's fit, a second fit that comes after the board.
    await waitFor(() => expect(week.textContent).toContain("Biggest climbs: Does #4 → #1 (up 3)"));
  });
});

describe("The Weekly's game ahead on this device", () => {
  it("says when the game of the week starts, worked out from the pool", async () => {
    // Aces and Does, a week apart in the standings and both rated, meet on Saturday the 26th.
    const start = "2026-09-26T15:00:00.000Z";
    const ahead = {
      id: "g7",
      ageGroupId: "ag_10u_2027",
      teamAId: "S-ACE",
      teamBId: "S-DOE",
      date: "2026-09-26",
      startTs: start,
    };
    renderTeamRankings({ ...pool(), games: [...pool().games, ahead] });
    const week = await screen.findByRole("region", { name: /^The Weekly/ });
    await waitFor(() =>
      expect(week.textContent).toMatch(
        new RegExp(`Game of the week: Sat, Sep 26 · ${formatStartTime(start)} · (Aces|Does) `)
      )
    );
  });
});

describe("the My Team card's season on this device", () => {
  it("says the schedule's toughness in its state and the record beside the expected one", async () => {
    renderTeamRankings(pool("S-DOE"));
    const card = await screen.findByRole("region", { name: "My team" });
    // Does lost to Bees and Cows, then beat Aces and Bees: 2-2 against clubs all rated here.
    await waitFor(() => expect(card.textContent).toMatch(/2–2 against rated clubs, .+ \(\d\.\d\)/));
    expect(card.textContent).toMatch(/Schedule: [1-3](st|nd|rd) toughest of 3 in OH/);
  });
});
