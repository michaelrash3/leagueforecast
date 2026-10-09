import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import { loadScoutGamesForYear, loadScoutTeams } from "../../lib/teamRankingsStorage";

/**
 * Deleting a club off the list of clubs that may not be real, which the user asked on 28 September
 * 2026 to happen without a dialog in front of it. Invented names.
 */
const group = ageGroup(10, 2027);
const day = seasonDate(2027);
const pool = {
  ageGroups: [group],
  teams: [
    team("S-ISLE", "Example Islanders", {
      state: "FL",
      gcTeams: [
        { teamId: "gcISLE000000", name: "Example Islanders", ageGroupId: group.id, ageLevel: 10 },
      ],
    }),
    team("S-OWLS", "Owls", { state: "FL" }),
    team("S-FOXES", "Foxes", { state: "FL" }),
  ],
  games: [
    game("w1", group.id, "S-ISLE", "S-OWLS", 9999, 0, {
      date: day,
      source: { kind: "gamechanger", teamId: "gcISLE000000", gameId: "w1" },
    }),
    game("g1", group.id, "S-OWLS", "S-FOXES", 6, 4, { date: day }),
  ],
};

describe("deleting a club that may not be real", () => {
  it("happens at once, without asking first", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool);
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(await screen.findByRole("button", { name: /check the pool/i }));

    const heading = await screen.findByText(/clubs that may not be real/i);
    const section = heading.closest("div")!;
    await user.click(within(section).getByRole("button", { name: "Delete club" }));

    expect(harness.requestConfirmation).not.toHaveBeenCalled();
    expect(harness.toasts()).toContain("Deleted Example Islanders.");
    expect(loadScoutTeams().map((one) => one.id)).not.toContain("S-ISLE");
    expect(loadScoutGamesForYear(2027).map((one) => one.id)).toEqual(["g1"]);
  });

  it("says where its GameChanger id went when it is searched for straight after", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool);
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(await screen.findByRole("button", { name: /check the pool/i }));
    const section = (await screen.findByText(/clubs that may not be real/i)).closest("div")!;
    await user.click(within(section).getByRole("button", { name: "Delete club" }));
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    const box = screen.getByRole("combobox", { name: /find a team/i });
    await user.click(box);
    await user.type(box, "gcISLE000000");
    expect(await screen.findByText(/That team was thrown out/)).toBeInTheDocument();
  });
});
