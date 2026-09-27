import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/**
 * The scouting report, read on a phone.
 *
 * Next up was a six-column table, and at 360px the win chance and the outlook — the two it exists
 * for — were past the right edge of every row; the top-25 and state lists were the same, the
 * what-if answer was as wide as the table, and "fare?" was printed over the name in the picker.
 * Below `sm` each fixture and each opponent is a card now, one shape rendered as the rankings table
 * does. What is checked: each card carries the numbers, the warning and the what-if the table does,
 * the what-if opens inside its own card at the id its button names, a wide screen still gets the
 * table, and the pickers look like fields.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-15T12:00:00"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

const atWidth = (wide: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: wide,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  );
};

const pool = (): Pool => {
  const teams = Array.from({ length: 12 }, (_, i) => team(`S-${i}`, `Club ${i}`, { state: "KY" }));
  const games = [];
  for (let i = 0; i < 11; i += 1) {
    games.push(
      game(`p${i}`, "ag_10u_2027", `S-${i}`, `S-${i + 1}`, 7, 2, { date: "2026-09-12" }),
      game(`q${i}`, "ag_10u_2027", `S-${i + 1}`, `S-${i}`, 3, 5, { date: "2026-09-26" })
    );
  }
  // Two clubs that have only played each other: joined to nobody on the ladder.
  games.push(game("iso", "ag_10u_2027", "S-ISLE", "S-ISLE2", 4, 3, { date: "2026-09-20" }));
  return {
    ageGroups: [ageGroup(10, 2027, { myTeamId: "S-6" })],
    teams: [
      ...teams,
      team("S-ISLE", "Island Club", { state: "KY" }),
      team("S-ISLE2", "Island Two", { state: "KY" }),
      team("S-STRANGER", "Nobody has pulled them"),
    ],
    games: [
      ...games,
      { id: "u0", ageGroupId: "ag_10u_2027", teamAId: "S-6", teamBId: "S-2", date: "2026-11-07" },
      {
        id: "u1",
        ageGroupId: "ag_10u_2027",
        teamAId: "S-6",
        teamBId: "S-STRANGER",
        date: "2026-11-14",
      },
      {
        id: "u2",
        ageGroupId: "ag_10u_2027",
        teamAId: "S-6",
        teamBId: "S-ISLE",
        date: "2026-11-21",
      },
    ],
  };
};

describe("the scouting report on a phone", () => {
  it("lists each fixture as a card carrying its win probability, outlook and warning", async () => {
    atWidth(false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));

    expect(screen.queryByRole("table", { name: "Next up" })).toBeNull();
    const cards = within(screen.getByRole("list", { name: "Next up" })).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    const [rated, stranger, island] = cards;
    expect(within(rated!).getByText(/^\d+%$/)).toBeInTheDocument();
    expect(within(rated!).getByText(/^(Favored|Underdog|Toss-up)$/i)).toBeInTheDocument();
    expect(within(stranger!).getByText("Not rated here yet")).toBeInTheDocument();
    expect(within(island!).getByText("no shared opponents yet")).toBeInTheDocument();
  });

  it("opens what-if inside the fixture's own card, at the id its button names", async () => {
    atWidth(false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    const card = within(screen.getByRole("list", { name: "Next up" })).getAllByRole("listitem")[0]!;
    const trigger = within(card).getByRole("button", { name: /^What if\?/ });
    await user.click(trigger);
    const answer = await within(card).findByRole("table", {
      name: /What a win or a loss against Club 2/,
    });
    const panel = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(panel!.contains(answer)).toBe(true);
  });

  it("lists the top of the page the same way, with the win chance on each card", async () => {
    atWidth(false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    const [top] = screen.getAllByRole("list", { name: /Against the top/ });
    const cards = within(top!).getAllByRole("listitem");
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => {
      expect(within(card).getByText("Win chance")).toBeInTheDocument();
      expect(within(card).getByText(/^\d+%$/)).toBeInTheDocument();
    });
  });

  it("is still a table on a wide screen", async () => {
    atWidth(true);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    expect(screen.getByRole("table", { name: "Next up" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Next up" })).toBeNull();
  });

  it("gives the pickers a visible field", async () => {
    atWidth(false);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    expect(screen.getByRole("combobox", { name: /how would/i }).className).toMatch(/\bborder\b/);
    expect(screen.getByRole("combobox", { name: /check a team/i }).className).toMatch(/\bborder\b/);
  });
});
