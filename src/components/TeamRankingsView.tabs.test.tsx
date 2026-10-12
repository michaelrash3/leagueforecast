import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ageGroup, game, renderTeamRankings, seasonDate, team } from "../test/teamRankingsHarness";
import {
  loadScoutGames,
  loadScoutTeams,
  notePoolChangedElsewhere,
  saveScoutGames,
  saveScoutTeams,
} from "../lib/teamRankingsStorage";

const pool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [team("S-A", "Aces", { state: "KY" }), team("S-B", "Badgers", { state: "KY" })],
  games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) })],
});

/**
 * Stands in for the other tab: writes to the same storage, then raises the notification the
 * channel would have carried. The write itself is what a second tab does; the notification is what
 * this tab would hear.
 */
const anotherTabWrites = async (write: () => void) => {
  write();
  await act(async () => {
    await notePoolChangedElsewhere("");
  });
};

describe("a second tab changing the pool", () => {
  it("brings in a team the other tab added", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("button", { name: /show all/i }));
    expect(within(screen.getByRole("table")).queryByText("Comets")).toBeNull();

    await anotherTabWrites(() => {
      saveScoutTeams([...loadScoutTeams(), team("S-C", "Comets", { state: "KY" })]);
      saveScoutGames([
        ...loadScoutGames(),
        game("g2", "ag_10u_2027", "S-A", "S-C", 3, 2, { date: seasonDate(2027) }),
      ]);
    });

    // Without this the tab goes on showing the pool it read at mount, and the next thing it saves
    // is that pool — over whatever the other tab has been doing for the last forty minutes.
    expect(within(screen.getByRole("table")).getByText("Comets")).toBeInTheDocument();
  });

  it("does not lose what the other tab did when this tab then saves", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());

    await anotherTabWrites(() => {
      saveScoutTeams([...loadScoutTeams(), team("S-C", "Comets", { state: "KY" })]);
      saveScoutGames([
        ...loadScoutGames(),
        game("g2", "ag_10u_2027", "S-A", "S-C", 3, 2, { date: seasonDate(2027) }),
      ]);
    });

    // A save from this tab, made after hearing: it builds on the pool including the other tab's
    // work rather than on the one from mount.
    await user.click(screen.getByRole("button", { name: /show all/i }));
    const row = within(screen.getByRole("table")).getByText("Badgers").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));

    expect(loadScoutTeams().map((t) => t.name)).toContain("Comets");
  });

  it("picks up a rename rather than keeping the old name on screen", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("button", { name: /show all/i }));

    await anotherTabWrites(() => {
      saveScoutTeams(
        loadScoutTeams().map((t) => (t.id === "S-B" ? { ...t, name: "Badgers 16U Gold" } : t))
      );
    });

    const table = screen.getByRole("table");
    expect(within(table).getByText("Badgers 16U Gold")).toBeInTheDocument();
    expect(within(table).queryByText("Badgers")).toBeNull();
  });
});
