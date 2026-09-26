import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../test/teamRankingsHarness";

/**
 * The whole-year board has no case here because the header only offers the two halves — a board
 * with no half is a legacy age group with no year at all, and `teamRecordInPool`'s own tests cover
 * that window. What is testable here is the wiring: that the half the board is on reaches the
 * panel, which no test of the function alone can show.
 *
 * The record in the detail panel and the record in the row above it are the same claim, and they
 * were counted over different sets of games: the row over the half the board was fitted on, the
 * panel over everything in the pool. So a board showing the autumn sat above a panel showing the
 * whole year — and the whole-year board disagreed too, over a game dated in the season before.
 *
 * Four games for the Aces in squad year 2027: two in the autumn, one in the spring, one from the
 * year before that is still filed under this year's id. Every other club plays once, so the Aces
 * are the only row whose record can move between halves.
 */
const pool = () => ({
  ageGroups: [ageGroup(12, 2027)],
  teams: [
    team("S-A", "Aces", { state: "KY" }),
    team("S-B", "Bears", { state: "KY" }),
    team("S-C", "Cubs", { state: "KY" }),
  ],
  games: [
    game("f1", "ag_12u_2027", "S-A", "S-B", 6, 2, { date: "2026-09-12" }),
    game("f2", "ag_12u_2027", "S-A", "S-C", 5, 4, { date: "2026-10-03" }),
    game("s1", "ag_12u_2027", "S-A", "S-B", 1, 9, { date: "2027-04-11" }),
    game("old", "ag_12u_2027", "S-A", "S-C", 9, 0, { date: "2025-05-02" }),
  ],
});

const openAces = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /show all/i }));
  const table = screen.getByRole("table");
  const row = within(table).getByRole("button", { name: "Aces" }).closest("tr")!;
  await user.click(within(table).getByRole("button", { name: "Aces" }));
  return { panel: screen.getByRole("region", { name: "Aces" }), row };
};

const openHalf = async (user: ReturnType<typeof userEvent.setup>, label: RegExp) => {
  await user.click(screen.getByRole("button", { name: label }));
};

/**
 * The clock this file reasons from.
 *
 * Its fixtures describe a whole squad year, August to July, and a game dated in a day that has not
 * happened does not count towards a record — you cannot score a game early. Read against the wall
 * clock, half of a squad year is always in the future and the suite would answer differently as
 * the year moved. Pinned to the last day of squad year 2027 so every fixture is genuinely behind
 * us and the tests say what they mean.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2027-07-31T12:00:00"));
});
afterAll(() => vi.useRealTimers());

describe("the record in the panel against the record in the row", () => {
  it("reads the autumn's record when the autumn is the board being shown", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openHalf(user, /^Fall 2026/);
    const { panel, row } = await openAces(user);

    // Two autumn wins. The spring loss and the game from 2025 are both out of this board.
    expect(row).toHaveTextContent("2-0");
    expect(within(panel).getByText(/2-0 in 12U 2027, from 2 games/)).toBeInTheDocument();
    // And it accounts for the other two rather than leaving a four-game list unexplained.
    expect(
      within(panel).getByText(/2 more played here are outside this half of the season/)
    ).toBeInTheDocument();
  });

  it("reads the spring's record when the spring is the board being shown", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openHalf(user, /^Spring 2027/);
    const { panel, row } = await openAces(user);

    expect(row).toHaveTextContent("0-1");
    expect(within(panel).getByText(/0-1 in 12U 2027, from 1 game[,.]/)).toBeInTheDocument();
  });
});

/**
 * A game a club's schedule lists against the club's own name: a scrimmage of its own squad, or a
 * namesake the import could not tell from it. Counted, it read as two wins from both seats.
 */
describe("a game against the club's own name", () => {
  it("is listed and said, and counted in neither record", async () => {
    const user = userEvent.setup();
    const base = pool();
    renderTeamRankings({
      ...base,
      games: [...base.games, game("x1", "ag_12u_2027", "S-A", "S-A", 6, 4, { date: "2026-09-19" })],
    });
    await openHalf(user, /^Fall 2026/);
    const { panel, row } = await openAces(user);

    expect(row).toHaveTextContent("2-0");
    expect(within(panel).getByText(/2-0 in 12U 2027, from 2 games/)).toBeInTheDocument();
    expect(within(panel).getByText(/1 more is against its own name/)).toBeInTheDocument();
    expect(within(panel).getByTitle("Against its own name, not counted")).toHaveTextContent("W");
  });
});
