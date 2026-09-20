import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
