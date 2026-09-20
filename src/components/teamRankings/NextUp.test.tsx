import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/**
 * The clock the whole file reasons from. It sits in the autumn of baseball year 2027, with the
 * played games behind it and the fixtures ahead of it — which is the only arrangement in which
 * "Next up" has anything to list.
 *
 * Pinned at midday, and deliberately not near midnight. The day the page works from used to be the
 * UTC one, which for a reader in the Americas is tomorrow's date all evening, and a fixture dated
 * today would drop off this table for those hours.
 */
const TODAY = "2026-10-15T12:00:00";

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(TODAY));
});
afterAll(() => vi.useRealTimers());

const pool = (): Pool => {
  const teams = Array.from({ length: 6 }, (_, i) =>
    team(`S-${i}`, `Club ${i}`, { state: "KY", city: "Prosper" })
  );
  const games = [
    game("p0", "ag_10u_2027", "S-0", "S-1", 7, 2, { date: "2026-09-12" }),
    game("p1", "ag_10u_2027", "S-1", "S-2", 6, 3, { date: "2026-09-19" }),
    game("p2", "ag_10u_2027", "S-2", "S-3", 5, 4, { date: "2026-09-26" }),
    game("p3", "ag_10u_2027", "S-3", "S-4", 8, 1, { date: "2026-10-03" }),
    game("p4", "ag_10u_2027", "S-4", "S-5", 4, 3, { date: "2026-10-10" }),
    game("p5", "ag_10u_2027", "S-5", "S-0", 2, 9, { date: "2026-10-10" }),
    // Still to play: one against a ranked club, one against a club nobody has pulled.
    { id: "u0", ageGroupId: "ag_10u_2027", teamAId: "S-0", teamBId: "S-3", date: "2026-11-07" },
    {
      id: "u1",
      ageGroupId: "ag_10u_2027",
      teamAId: "S-0",
      teamBId: "S-STRANGER",
      date: "2026-11-14",
    },
  ];
  return {
    ageGroups: [ageGroup(10, 2027)],
    teams: [...teams, team("S-STRANGER", "Nobody has pulled them")],
    games,
  };
};

const openScouting = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: /scouting/i }));
  await user.click(screen.getByRole("combobox", { name: /how would/i }));
};

const nextUp = () => within(screen.getByRole("table", { name: "Next up" }));

describe("the next-up table", () => {
  /*
   * The pin. "Next up" had no test and no accessible name, and the day it reads is about to change
   * from the UTC one to the reader's own — which alters which fixtures it lists. This is the
   * before-picture that makes that change reviewable rather than invisible.
   */
  it("lists the games still to play, with what the projection says", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openScouting(user);

    const headers = nextUp()
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Date",
      "Opponent",
      "Opponent rank",
      "Projected margin",
      "Win probability",
      "Outlook",
    ]);

    const rows = nextUp().getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Sat, Nov 7")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Club 3")).toBeInTheDocument();
    // The club nobody pulled has no rating, and a made-up one would be worse than none.
    expect(within(rows[1]!).getByText("Nobody has pulled them")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Not rated here yet")).toBeInTheDocument();
  });
});
