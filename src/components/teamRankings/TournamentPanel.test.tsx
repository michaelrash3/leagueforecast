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
 * A travel coach picks a tournament most weekends. The field is built on the Scouting tab and
 * played out: how strong it is, and each club's chance to win its pool, reach the final and win.
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
    // Still to play this weekend, undated so the day the suite runs does not matter.
    { id: "n1", ageGroupId: "ag_10u_2027", teamAId: "S-OTT", teamBId: "S-BEA" },
    { id: "n2", ageGroupId: "ag_10u_2027", teamAId: "S-CUB", teamBId: "S-OTT" },
  ],
});

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  renderTeamRankings(pool());
  await user.click(screen.getByRole("tab", { name: /scouting/i }));
  return screen.findByRole("region", { name: "Tournament field" });
};

describe("the tournament field", () => {
  it("plays out our weekend's field, with the chances summing as a tournament's must", async () => {
    const user = userEvent.setup();
    const panel = await open(user);

    await user.click(within(panel).getByRole("button", { name: "Add our next opponents" }));
    expect(
      within(within(panel).getByRole("list", { name: "The field" })).getAllByRole("listitem")
    ).toHaveLength(3);

    const odds = within(panel).getByRole("table", { name: "Tournament odds" });
    const rows = within(odds).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const wins = rows.map((row) =>
      Number(within(row).getAllByRole("cell")[4]!.textContent!.replace("%", ""))
    );
    // Rounded to whole percents, so within a point or two of the one winner there is.
    expect(Math.abs(wins.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(2);
    expect(panel).toHaveTextContent(/Field strength: average rating/);
  });

  it("adds a club by name, saves the field, and opens it again", async () => {
    const user = userEvent.setup();
    const panel = await open(user);
    const box = within(panel).getByRole("combobox", { name: /add a club/i });
    for (const name of ["hawks", "bears"]) {
      await user.click(box);
      await user.type(box, name);
      await user.keyboard("{Enter}");
    }
    await user.type(within(panel).getByPlaceholderText("Event name"), "Fall Classic");
    await user.click(within(panel).getByRole("button", { name: "Save field" }));
    await user.click(within(panel).getByRole("button", { name: "Clear field" }));
    expect(within(panel).queryByRole("table")).toBeNull();

    await user.selectOptions(within(panel).getByLabelText("Saved fields"), "Fall Classic");

    expect(within(panel).getByRole("list", { name: "The field" })).toHaveTextContent(
      /Hill Hawks.*Bears/
    );
    expect(within(panel).getByRole("table", { name: "Tournament odds" })).toBeInTheDocument();
  });
});
