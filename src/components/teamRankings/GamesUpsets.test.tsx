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

/*
 * The Games tab's Upsets (The Weekly): every result on the page its ratings called the other way,
 * the winner given less than a quarter of a chance by the board shown, whatever its day.
 */

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-12T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const PAGE = "ag_10u_2027";

/** Aces beat everyone by plenty, Cubs lose to everyone, except one day Cubs beat Aces. */
const pool = (): Pool => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [team("S-A", "Aces"), team("S-B", "Bears"), team("S-C", "Cubs"), team("S-O", "Owls")],
  games: [
    game("g1", PAGE, "S-A", "S-B", 10, 1, { date: "2026-08-22" }),
    game("g2", PAGE, "S-A", "S-O", 10, 1, { date: "2026-08-23" }),
    game("g3", PAGE, "S-B", "S-C", 9, 2, { date: "2026-08-29" }),
    game("g4", PAGE, "S-O", "S-C", 9, 2, { date: "2026-08-30" }),
    game("g5", PAGE, "S-A", "S-C", 12, 1, { date: "2026-09-05" }),
    game("g6", PAGE, "S-A", "S-C", 11, 0, { date: "2026-09-06" }),
    game("g7", PAGE, "S-C", "S-A", 3, 2, { date: "2026-09-07" }),
  ],
});

const loggedCard = () =>
  screen.getByText(/^Logged games/).closest<HTMLElement>("div.rounded-lg") as HTMLElement;

describe("the Games tab's upsets", () => {
  it("lists the results the ratings called the other way, and every game again", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings({ ...pool(), search: "?age=10&year=2027" });
    await user.click(await screen.findByRole("tab", { name: /^games$/i }));
    await user.click(await screen.findByRole("button", { name: "Upsets" }));
    const rows = within(loggedCard()).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Cubs 3 – Aces 2"),
    ]);
    expect(
      within(loggedCard()).getByText(/^1 game was an upset: the winner had less than a 25% chance/)
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Every game" }));
    expect(screen.getByRole("button", { name: "Upsets" })).toBeInTheDocument();
    expect(within(loggedCard()).queryByText(/was an upset/)).toBeNull();
  });
});
