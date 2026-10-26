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
 * The Games tab's two additions (PR 4): one club's games picked by name, every one of them whatever
 * its day, and a What if on any game, the two clubs met today on the ratings the board shows.
 */

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-12T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const PAGE = "ag_10u_2027";

/** Aces beat everyone, Cubs lose to everyone; today's game is Bears and Owls, still to play. */
const pool = (): Pool => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [team("S-A", "Aces"), team("S-B", "Bears"), team("S-C", "Cubs"), team("S-O", "Owls")],
  games: [
    game("g1", PAGE, "S-A", "S-B", 9, 2, { date: "2026-08-22" }),
    game("g2", PAGE, "S-A", "S-C", 12, 1, { date: "2026-08-29" }),
    game("g3", PAGE, "S-B", "S-C", 7, 3, { date: "2026-09-05" }),
    game("g4", PAGE, "S-O", "S-C", 6, 4, { date: "2026-09-05" }),
    { id: "g5", ageGroupId: PAGE, teamAId: "S-B", teamBId: "S-O", date: "2026-09-12" },
  ],
});

const loggedCard = () =>
  screen.getByText(/^Logged games/).closest<HTMLElement>("div.rounded-lg") as HTMLElement;

describe("the Games tab", () => {
  it("lists one club's games, every one whatever its day, and every club's again", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings({ ...pool(), search: "?age=10&year=2027" });
    await user.click(await screen.findByRole("tab", { name: /^games$/i }));
    // Today's games only, to begin with.
    expect(within(loggedCard()).getAllByRole("listitem")).toHaveLength(1);

    await user.click(screen.getByRole("combobox", { name: "One club's games" }));
    await user.keyboard("Aces");
    await user.click(
      within(await screen.findByRole("option", { name: /Aces/ })).getByRole("button")
    );
    const rows = within(loggedCard()).getAllByRole("listitem");
    // Newest first, as the page lists them.
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Aces 12 – Cubs 1"),
      expect.stringContaining("Aces 9 – Bears 2"),
    ]);
    expect(within(loggedCard()).getByText("2 games for Aces.")).toBeInTheDocument();
    // The day's window line is the club's list's no longer.
    expect(screen.queryByTestId("games-window")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Every club" }));
    expect(within(loggedCard()).getAllByRole("listitem")).toHaveLength(1);
  });

  it("says what the board makes of any game's two clubs today", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings({ ...pool(), search: "?age=10&year=2027" });
    await user.click(await screen.findByRole("tab", { name: /^games$/i }));
    await user.click(screen.getByRole("combobox", { name: "One club's games" }));
    await user.keyboard("Cubs");
    await user.click(
      within(await screen.findByRole("option", { name: /Cubs/ })).getByRole("button")
    );
    const aces = within(loggedCard())
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes("Aces 12"));
    expect(aces).toBeDefined();
    if (!aces) return;
    const button = within(aces).getByRole("button", { name: "What if Aces and Cubs met today" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(aces).toHaveTextContent(/Aces should beat Cubs by \d+\.\d runs/);
    expect(aces).toHaveTextContent(/Win chance: Aces \d+%, Cubs \d+%/);
    // One at a time, and closed again by the same button.
    await user.click(button);
    expect(aces).not.toHaveTextContent("Win chance");
  });
});
