import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../test/teamRankingsHarness";

/*
 * A club's form on its panel: its last games, newest first, against the margins its ratings
 * expected of them, over the half its record is counted on.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-20T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const PAGE = "ag_12u_2027";

const pool = () => ({
  ageGroups: [ageGroup(12, 2027)],
  teams: [team("S-A", "Aces"), team("S-B", "Bears"), team("S-C", "Cubs"), team("S-D", "Dukes")],
  games: [
    game("g1", PAGE, "S-A", "S-B", 6, 2, { date: "2026-09-12" }),
    game("g2", PAGE, "S-B", "S-C", 5, 4, { date: "2026-09-19" }),
    game("g3", PAGE, "S-C", "S-D", 7, 1, { date: "2026-09-26" }),
    game("g4", PAGE, "S-A", "S-C", 3, 4, { date: "2026-10-03" }),
    game("g5", PAGE, "S-D", "S-A", 0, 9, { date: "2026-10-10" }),
    // The season before, still filed under this year's page: outside the half, as in the record.
    game("old", PAGE, "S-A", "S-B", 2, 1, { date: "2026-05-02" }),
  ],
});

describe("a club's form on its panel", () => {
  it("says its last games, newest first, against the margins its ratings expected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings({ ...pool(), search: "?age=12&year=2027" });
    await user.click(await screen.findByRole("button", { name: /show all/i }));
    const table = screen.getByRole("table");
    await user.click(within(table).getByRole("button", { name: "Aces" }));
    const panel = await screen.findByRole("region", { name: "Aces" });
    expect(panel.textContent).toMatch(
      /Form, last 3: W L W · beat the margin its ratings expected in [0-3] of 3, \d+\.\d runs a game (better|worse) on average/
    );
  });
});
