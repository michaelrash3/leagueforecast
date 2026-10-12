import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeamRankingsView } from "../TeamRankingsView";
import type { Command } from "../CommandPalette";
import { ageGroup, game, seasonDate, team } from "../../test/teamRankingsHarness";
import {
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
} from "../../lib/teamRankingsStorage";
import { poolSignature } from "../../lib/gameChangerImport";

/**
 * The palette used to exist only on the league half, which left the half holding a nationwide pool
 * — and the most places to be — without one. Team Rankings owns its own navigation, so it hands
 * its commands up rather than lifting a route's worth of state into App.
 *
 * The hazard in doing that is the one the league half already had: the navigators are rebuilt
 * every render, so a command list depending on them would be rebuilt, republished and re-stated
 * every render, which is a loop rather than a stale closure. The list therefore depends on the
 * years it is made of, and the count below is what would catch that coming back.
 */
const renderWithCommands = () => {
  resetTeamRankingsStore();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");

  const groups = [ageGroup(10, 2027), ageGroup(10, 2028)];
  const teams = [team("t1", "Rays"), team("t2", "Jays")];
  const games = [game("gm1", groups[0]!.id, "t1", "t2", 6, 3, { date: seasonDate(2027) })];

  saveAgeGroups(groups);
  saveScoutTeams(teams);
  saveScoutGames(games);
  saveTidyStamp(poolSignature({ ageGroups: groups, teams, games }));

  const onCommands = vi.fn();
  const result = render(
    <TeamRankingsView
      seasons={[]}
      showToast={vi.fn()}
      requestConfirmation={vi.fn().mockResolvedValue(true)}
      onDataChange={vi.fn()}
      onCommands={onCommands}
    />
  );
  const latest = () => {
    const calls = onCommands.mock.calls;
    return (calls.length ? calls[calls.length - 1]?.[0] : []) as Command[];
  };
  return { ...result, onCommands, latest };
};

describe("the commands Team Rankings offers the palette", () => {
  it("offers every section and every season year in the pool", async () => {
    const { latest } = renderWithCommands();

    await waitFor(() => expect(latest().length).toBeGreaterThan(0));
    const labels = latest().map((command) => command.label);

    for (const section of ["Rankings", "Games", "Import", "Scouting", "Archive", "Setup"]) {
      expect(labels).toContain(`Go to ${section}`);
    }
    expect(labels).toContain("Show the 2027 season");
    expect(labels).toContain("Show the 2028 season");
  });

  it("opens the section a command names", async () => {
    const user = userEvent.setup();
    const { latest, findByRole } = renderWithCommands();

    await waitFor(() => expect(latest().length).toBeGreaterThan(0));
    const games = latest().find((command) => command.label === "Go to Games");
    expect(games).toBeTruthy();

    await user.click(await findByRole("tab", { name: "Rankings" }));
    games!.run();

    await waitFor(() => expect(document.location.search).toContain("section=games"));
  });

  it("republishes only when the years change, not on every render", async () => {
    const { latest, onCommands, rerender } = renderWithCommands();

    await waitFor(() => expect(latest().length).toBeGreaterThan(0));
    const publishes = onCommands.mock.calls.length;

    // A re-render with the same pool must not produce a new list; if it does, publishing it sets
    // state, which renders again, which publishes again.
    rerender(
      <TeamRankingsView
        seasons={[]}
        showToast={vi.fn()}
        requestConfirmation={vi.fn().mockResolvedValue(true)}
        onDataChange={vi.fn()}
        onCommands={onCommands}
      />
    );

    await waitFor(() => expect(onCommands.mock.calls.length).toBe(publishes));
  });
});
