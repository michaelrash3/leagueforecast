import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import { loadArchiveIndex, loadScoutGames } from "../../lib/teamRankingsStorage";

const go = async (user: ReturnType<typeof userEvent.setup>, tab: string) => {
  await user.click(screen.getByRole("tab", { name: tab }));
};

/**
 * Two finished years and a live one, at two ages, so archiving one year is a real choice rather
 * than a wipe.
 *
 * 8U is below the level anything is ranked at, which is the case worth having in a fixture: its
 * games feed the ages above and keep no table of their own, and on the real pool that was a
 * hundred and seventy-five thousand games a page-at-a-time archive would have deleted for nothing.
 */
const pool = () => {
  const ageGroups: AgeGroup[] = [
    ageGroup(8, 2026),
    ageGroup(9, 2026),
    ageGroup(10, 2026),
    ageGroup(9, 2027),
  ];
  const teams: ScoutTeam[] = [
    team("S-A", "Aces", { state: "KY" }),
    team("S-B", "Badgers", { state: "OH" }),
    team("S-C", "Cougars", { state: "KY" }),
    team("S-TEN1", "Tenners", { state: "IN" }),
    team("S-TEN2", "Dimes", { state: "IN" }),
    team("S-TEN3", "Deckers", { state: "IN" }),
    team("S-TINY", "Tinies", { state: "KY" }),
    team("S-NEXT", "Nexters", { state: "TN" }),
  ];
  const on = (
    level: number,
    year: number,
    id: string,
    a: string,
    b: string,
    sa: number,
    sb: number
  ): ScoutGame => game(id, `ag_${level}u_${year}`, a, b, sa, sb, { date: seasonDate(year) });

  const games: ScoutGame[] = [
    on(9, 2026, "g1", "S-A", "S-B", 9, 2),
    on(9, 2026, "g2", "S-B", "S-C", 5, 4),
    on(9, 2026, "g3", "S-C", "S-A", 1, 8),
    on(10, 2026, "g4", "S-TEN1", "S-TEN2", 6, 3),
    on(10, 2026, "g5", "S-TEN2", "S-TEN3", 5, 1),
    on(10, 2026, "g6", "S-TEN3", "S-TEN1", 2, 7),
    on(8, 2026, "g7", "S-TINY", "S-A", 2, 8),
    on(8, 2026, "g8", "S-TINY", "S-B", 1, 7),
    // The live year, which must survive untouched.
    on(9, 2027, "g9", "S-NEXT", "S-A", 4, 3),
  ];
  return { ageGroups, teams, games };
};

const archive2026 = async (user: ReturnType<typeof userEvent.setup>) => {
  await go(user, "Setup");
  await user.selectOptions(screen.getByLabelText("Baseball year"), "2026");
  await user.click(screen.getByRole("button", { name: "Archive this year" }));
};

describe("archiving a finished season from the app", () => {
  it("says what a year holds before anything is pressed", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await go(user, "Setup");
    await user.selectOptions(screen.getByLabelText("Baseball year"), "2026");

    // The size of the decision is on the card, not behind the button.
    expect(screen.getByText(/holds 3 pages, 8 games and 7 teams/)).toBeInTheDocument();
  });

  it("keeps the tables, deletes the games, and leaves the other year alone", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    await archive2026(user);

    await waitFor(() => expect(harness.toasts().join(" ")).toContain("2026 archived"));

    // Only the live year's game is left, and only its two teams.
    expect(loadScoutGames().map((one) => one.id)).toEqual(["g9"]);
    expect(
      loadArchiveIndex()
        .map((entry) => entry.name)
        .sort()
      // A table per half, named by the half. `seasonDate` puts every fixture in September, so only
      // the autumn of this baseball year has anything and only it keeps a board.
    ).toEqual(["10U · Fall 2025", "9U · Fall 2025"]);
  });

  it("warns that the ages it cannot rank keep no table of their own", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    await archive2026(user);

    const asked = String(harness.requestConfirmation.mock.calls[0]?.[0]?.message ?? "");
    expect(asked).toContain("8U 2026");
    expect(asked).toContain("those ages are not ranked");
    // And it says what is kept and what goes, in games rather than in reassurance.
    expect(asked).toContain("8 stored games");
  });

  it("changes nothing when the confirmation is declined", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    harness.requestConfirmation.mockResolvedValue(false);
    await archive2026(user);

    expect(loadScoutGames()).toHaveLength(9);
    expect(loadArchiveIndex()).toEqual([]);
  });

  it("shows the frozen table under Archive, read-only", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    await archive2026(user);
    await waitFor(() => expect(harness.toasts().join(" ")).toContain("2026 archived"));

    await go(user, "Archive");
    await user.click(screen.getByRole("button", { name: "9U · Fall 2025" }));

    const national = await screen.findByRole("heading", { name: /National top/ });
    const board = national.closest("div")?.parentElement as HTMLElement;
    expect(within(board).getByText("Aces")).toBeInTheDocument();

    // Nothing to click through to and nothing to change: the games are gone.
    expect(within(board).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /Mark mine/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("finds a club in a finished season by name, which is all a row has", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    await archive2026(user);
    await waitFor(() => expect(harness.toasts().join(" ")).toContain("2026 archived"));

    await go(user, "Archive");
    await user.click(screen.getByRole("button", { name: "9U · Fall 2025" }));
    const box = await screen.findByLabelText("Find a team in this season");
    await user.type(box, "badg");

    // Scoped to the search card: "Badgers" is on the national board too, which is the point —
    // searching is for finding a club without scrolling, not for hiding the rest.
    const inCard = within(box.closest("div") as HTMLElement);
    expect(inCard.getByText("1 match.")).toBeInTheDocument();
    expect(inCard.getByRole("cell", { name: "Badgers" })).toBeInTheDocument();
    expect(inCard.queryByRole("cell", { name: "Aces" })).toBeNull();
  });

  it("says there is nothing to look at before anything is archived", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await go(user, "Archive");
    expect(screen.getByText(/Nothing archived yet/)).toBeInTheDocument();
  });
});
