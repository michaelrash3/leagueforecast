import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../test/teamRankingsHarness";

/**
 * GameChanger's own record for each id a club is known by, and when that id was last pulled, so a
 * record that looks off can be checked against GameChanger's without leaving the page.
 */
const group = ageGroup(12, 2027);
const pool = () => ({
  ageGroups: [group],
  teams: [
    team("S-A", "Aces", {
      state: "KY",
      gcTeams: [
        {
          teamId: "gcACESFALL26",
          name: "Aces 12U",
          ageGroupId: group.id,
          season: "fall",
          seasonYear: 2026,
          record: { win: 5, loss: 3, tie: 1 },
          importedAt: "2027-07-29T09:00:00.000Z",
        },
        {
          teamId: "gcACESSPRG27",
          name: "Aces 12U",
          ageGroupId: group.id,
          season: "spring",
          seasonYear: 2027,
        },
      ],
    }),
    team("S-B", "Bears", { state: "KY" }),
  ],
  games: [game("f1", group.id, "S-A", "S-B", 6, 2, { date: "2026-09-12" })],
});

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2027-07-31T12:00:00"));
});
afterAll(() => vi.useRealTimers());

describe("GameChanger's record on each link", () => {
  it("is shown with when the id was last pulled, and nothing where GameChanger gave none", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("button", { name: /^Fall 2026/ }));
    await user.click(screen.getByRole("button", { name: /show all/i }));
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Aces" }));
    const panel = screen.getByRole("region", { name: "Aces" });

    expect(within(panel).getByText("GameChanger 5-3-1, pulled 2 days ago")).toBeInTheDocument();
    // The spring id, pulled never and with no record of GameChanger's, says nothing.
    expect(within(panel).getAllByText(/^(GameChanger \d|No GameChanger record)/)).toHaveLength(1);
  });
});
