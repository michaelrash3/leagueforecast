import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import type { ScoutTeam } from "../../lib/teamRankings";

/**
 * A squad year that has lost its games has to be visible on the way past.
 *
 * A pull started from the Import section once saved an empty pool over every year it had not
 * itself refetched. The pull reported success and the year on screen was right, so the only sign
 * was a year nobody had opened lately being gone — and emptying a year drops it from storage
 * rather than writing it empty, so there is no gap in the games to find. The age groups survive
 * that, and they are the record that the year existed and was pulled.
 *
 * The fix for the pull landed separately; this is the part that says so out loud if anything ever
 * empties a year again, from that caller or another.
 */
const groups = [ageGroup(10, 2027), ageGroup(10, 2028)];

/** Both clubs have a page on both years, which is what says 2028 was pulled. */
const linked = (id: string, name: string): ScoutTeam =>
  team(id, name, {
    gcTeams: groups.map((group) => ({
      teamId: `gc-${id}-${group.year}`,
      name: `${name} ${group.year}`,
      ageGroupId: group.id,
    })),
  });

const teams = [linked("t1", "Rays"), linked("t2", "Jays")];

const bothYears = [
  game("g-2027", groups[0]!.id, "t1", "t2", 6, 3, { date: seasonDate(2027) }),
  game("g-2028", groups[1]!.id, "t1", "t2", 4, 1, { date: seasonDate(2028) }),
];

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
};

describe("a squad year that has lost its games", () => {
  it("is called out before anything is pressed", async () => {
    const user = userEvent.setup();
    // Only 2027 survives the seeding, which is exactly what the bad save left behind.
    renderTeamRankings({ ageGroups: groups, teams, games: [bothYears[0]!] });
    await openSetup(user);

    /*
     * Not behind the "Check the pool" button. That button walks every game, which is why it is a
     * button — but this costs a read of the stored sizes, and a year being gone is not something
     * to find only if you thought to look.
     */
    expect(await screen.findByText(/2028 has lost its games/i)).toBeInTheDocument();
    expect(screen.getByText(/restore a backup from before it went/i)).toBeInTheDocument();
  });

  it("says nothing when every year still has its games", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: groups, teams, games: bothYears });
    await openSetup(user);

    expect(await screen.findByText(/what each squad year holds/i)).toBeInTheDocument();
    expect(screen.queryByText(/lost its games/i)).toBeNull();
    expect(screen.queryByText(/lost their games/i)).toBeNull();
  });

  it("shows what every year holds, so a thin year is visible too", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: groups, teams, games: [bothYears[0]!] });
    await openSetup(user);

    await screen.findByText(/what each squad year holds/i);
    const rows = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(rows).toContain("2027 — 1 page, 2 teams, 1 game");
    expect(rows).toContain("2028 — 1 page, 2 teams, 0 games");
  });
});
