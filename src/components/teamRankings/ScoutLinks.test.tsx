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

/*
 * Scout, beside a game still to play: on Scouting's Next up and on the board's own club's next
 * game, the opponent set beside our club in Compare with, the one card a pick there by hand reads.
 */
const on = seasonDate(2027);
const pool = () => ({
  ageGroups: [ageGroup(10, 2027, { myTeamId: "S-OTT" })],
  teams: [
    team("S-OTT", "River Otters"),
    team("S-HAW", "Hill Hawks"),
    team("S-BEA", "Bears"),
    team("S-CUB", "Cubs"),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-OTT", "S-HAW", 6, 4, { date: on }),
    game("g2", "ag_10u_2027", "S-HAW", "S-BEA", 7, 2, { date: on }),
    game("g3", "ag_10u_2027", "S-BEA", "S-CUB", 5, 3, { date: on }),
    game("g4", "ag_10u_2027", "S-CUB", "S-OTT", 1, 9, { date: on }),
    // Still to play, undated so the day the suite runs does not matter.
    { id: "n1", ageGroupId: "ag_10u_2027", teamAId: "S-OTT", teamBId: "S-BEA" },
  ],
});

describe("Scout, beside a game still to play", () => {
  it("sets the opponent beside our club in Compare with, from Scouting's Next up", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    const nextUp = await screen.findByRole("table", { name: "Next up" });
    await user.click(within(nextUp).getByRole("button", { name: "Scout Bears" }));
    expect(
      await screen.findByRole("region", { name: "Forecast: River Otters against Bears" })
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "River Otters and Bears compared" })).toBeTruthy();
  });

  it("takes the board's own club to Scouting with its next opponent beside it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const mine = await screen.findByRole("region", { name: "My team" });
    await user.click(within(mine).getByRole("button", { name: "Scout Bears" }));
    expect(screen.getByRole("tab", { name: /scouting/i })).toHaveAttribute("aria-selected", "true");
    expect(
      await screen.findByRole("region", { name: "Forecast: River Otters against Bears" })
    ).toBeInTheDocument();
  });
});
