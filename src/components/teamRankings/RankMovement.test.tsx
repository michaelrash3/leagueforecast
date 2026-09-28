import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";

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
  });

  it("says it on the my-team card too", async () => {
    renderTeamRankings(pool("S-DOE"));
    const card = await screen.findByRole("region", { name: "My team" });
    expect(await within(card).findByLabelText(/^up \d+ since last week$/)).toBeInTheDocument();
  });
});
