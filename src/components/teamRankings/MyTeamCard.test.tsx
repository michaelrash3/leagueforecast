import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/*
 * "Where are we ranked?" is asked at every field, and the page answered it only through Show all
 * and a hundred rows at a time. The team marked as yours now leads the page with its place in the
 * whole table and in its state, and its next game.
 */
const on = seasonDate(2027);
const pool = (myTeamId?: string) => ({
  ageGroups: [ageGroup(10, 2027, myTeamId ? { myTeamId } : {})],
  teams: [
    team("S-ACE", "Aces", { state: "TX" }),
    team("S-BEE", "Bees", { state: "OH" }),
    team("S-COW", "Cows", { state: "OH" }),
    team("S-DOE", "Does", { state: "OH" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-ACE", "S-BEE", 9, 1, { date: on }),
    game("g2", "ag_10u_2027", "S-BEE", "S-COW", 6, 2, { date: on }),
    game("g3", "ag_10u_2027", "S-COW", "S-DOE", 5, 3, { date: on }),
    game("g4", "ag_10u_2027", "S-ACE", "S-DOE", 8, 0, { date: on }),
    // Still to play, and undated, so the day the suite runs does not decide whether it is ahead.
    {
      id: "g5",
      ageGroupId: "ag_10u_2027",
      teamAId: "S-COW",
      teamBId: "S-ACE",
    },
  ],
});

describe("my team at a glance", () => {
  it("leads the boards with its place nationally and in its state, and its next game", async () => {
    renderTeamRankings(pool("S-COW"));

    const card = await screen.findByRole("region", { name: "My team" });
    expect(card).toHaveTextContent("Cows");
    expect(card).toHaveTextContent("#3 of 4 nationally");
    expect(card).toHaveTextContent("#2 of 3 in OH");
    expect(card).toHaveTextContent("1-1");
    expect(card).toHaveTextContent(/Next: date to come vs Aces \(#1\) — \d+% to win/);
  });

  it("opens the team from its name", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool("S-COW"));
    const card = await screen.findByRole("region", { name: "My team" });

    await user.click(within(card).getByRole("button", { name: /Cows/ }));

    expect(await screen.findByRole("region", { name: "Cows" })).toBeInTheDocument();
  });

  it("is not there until a team is marked as yours", async () => {
    renderTeamRankings(pool());
    await screen.findByText(/National top/i);
    expect(screen.queryByRole("region", { name: "My team" })).toBeNull();
  });
});
