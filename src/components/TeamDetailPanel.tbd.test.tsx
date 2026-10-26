import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../test/teamRankingsHarness";

/**
 * A game against a TBD slot the tidy set not to count (`markTbdGames`) says why on the club's page:
 * the game at that hour that counts in its place, or that nothing pairs it. The owner's rule of 26
 * October 2026, found on the Edgewood Longhorns, 9-0 on the board against a league that had them
 * 8-0. The clubs are invented.
 */
const AG = "ag_9u_2027";
const at = (clock: string) => ({ date: "2026-08-29", startTs: `2026-08-29T${clock}:00.000Z` });
const pool = (games: ReturnType<typeof game>[]) => ({
  ageGroups: [ageGroup(9, 2027)],
  teams: [
    team("S-A", "Stags", { state: "KY" }),
    team("S-B", "Cruisers", { state: "KY" }),
    team("S-T", "TBD- 08/29/26, 3:00 PM", { placeholder: true }),
  ],
  games,
});
const overTbd = game("t1", AG, "S-A", "S-T", 20, 5, { ...at("15:00"), countedElsewhere: true });

const openStags = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /show all/i }));
  await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Stags" }));
  return screen.getByRole("region", { name: "Stags" });
};

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-26T12:00:00"));
});
afterAll(() => vi.useRealTimers());

describe("a game against a TBD slot, set not to count", () => {
  it("says nothing pairs it where no other game of the club's is at that time", async () => {
    renderTeamRankings(pool([overTbd, game("g1", AG, "S-A", "S-B", 6, 2, at("18:00"))]));
    const panel = await openStags();

    expect(within(panel).getByText(/1-0 in 9U 2027, from 1 game/)).toBeInTheDocument();
    expect(
      within(panel).getByTitle(
        "TBD on the schedule, and no other team's game at that date and time pairs it: not counted"
      )
    ).toHaveTextContent("W");
  });

  it("names the game at that time that counts in its place", async () => {
    renderTeamRankings(pool([overTbd, game("g1", AG, "S-B", "S-A", 4, 6, at("15:30"))]));
    const panel = await openStags();

    expect(within(panel).getByText(/1-0 in 9U 2027, from 1 game/)).toBeInTheDocument();
    expect(
      within(panel).getByTitle(
        "TBD on the schedule: the game against Cruisers at that time counts in its place"
      )
    ).toHaveTextContent("W");
  });
});
