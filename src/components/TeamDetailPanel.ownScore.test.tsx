import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../test/teamRankingsHarness";

/*
 * The Dragons' schedule says they beat the Hens 11-8; the Hens' says they lost 8-10. One game, and
 * each club's panel shows what its own schedule says rather than the other's.
 */
const pool = () => ({
  ageGroups: [ageGroup(11, 2027)],
  teams: [team("S-D", "Dragons", { state: "KY" }), team("S-H", "Hens", { state: "KY" })],
  games: [
    game("d1", "ag_11u_2027", "S-D", "S-H", 11, 8, {
      date: "2026-09-12",
      reportedByB: { teamAScore: 10, teamBScore: 8 },
    }),
  ],
});

const open = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole("button", { name: /show all/i }));
  await user.click(within(screen.getByRole("table")).getByRole("button", { name }));
  return screen.getByRole("region", { name });
};

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2027-07-31T12:00:00"));
});
afterAll(() => vi.useRealTimers());

describe("a game two schedules scored differently", () => {
  it("shows the Dragons their own 11-8", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await open(user, "Dragons");
    expect(within(panel).getByText(/^11–8 · 2026-09-12$/)).toBeInTheDocument();
    expect(within(panel).queryByText(/10–8/)).not.toBeInTheDocument();
  });

  it("shows the Hens their own 8-10", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await open(user, "Hens");
    expect(within(panel).getByText(/^8–10 · 2026-09-12$/)).toBeInTheDocument();
    expect(within(panel).queryByText(/8–11/)).not.toBeInTheDocument();
  });
});
