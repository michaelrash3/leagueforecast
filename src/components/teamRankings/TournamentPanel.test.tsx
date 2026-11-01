import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { readSavedFields } from "../../lib/tournamentFields";
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
    // The last column, Win.
    const wins = rows.map((row) => {
      const cells = within(row).getAllByRole("cell");
      return Number(cells[cells.length - 1]!.textContent!.replace("%", ""));
    });
    // Rounded to whole percents, so within a point or two of the one winner there is.
    expect(Math.abs(wins.reduce((a, b) => a + b, 0) - 100)).toBeLessThanOrEqual(2);
    expect(panel).toHaveTextContent(/Field strength: average rating/);
  });

  it("gives each club's record and rating, and our margin and chance against it", async () => {
    const user = userEvent.setup();
    const panel = await open(user);
    await user.click(within(panel).getByRole("button", { name: "Add our next opponents" }));
    const odds = within(panel).getByRole("table", { name: "Tournament odds" });
    const headings = within(odds)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headings).toEqual([
      "Club",
      "Pool",
      "Record",
      "Rating",
      "Us by",
      "Our chance",
      "Win pool",
      "Final",
      "Win",
    ]);
    const rowOf = (name: string) =>
      within(odds)
        .getAllByRole("row")
        .find((row) => row.textContent?.includes(name)) as HTMLElement;
    const cells = (name: string) =>
      within(rowOf(name))
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    // The Otters are us: no margin against themselves.
    expect(cells("River Otters").slice(2, 6)).toEqual([
      "2-0",
      expect.stringMatching(/^[+-]\d\.\d$/),
      "—",
      "—",
    ]);
    // The Cubs lost to everyone, us included: we are favoured, by a margin the chance agrees with.
    const [, , record, rating, margin, chance] = cells("Cubs");
    expect(record).toBe("0-2");
    expect(rating).toMatch(/^-\d\.\d$/);
    expect(margin).toMatch(/^\+\d\.\d$/);
    expect(Number(chance?.replace("%", ""))).toBeGreaterThan(50);
    expect(panel).toHaveTextContent("Us by and Our chance are for River Otters against each club.");
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

  /*
   * Each club of a saved field is kept with a GameChanger id it carried, and read by it off the
   * pool: a club whose id is another club's now is not ranked here, never played as that club.
   */
  it("saves each club with its GameChanger id, and never plays another club under its id", async () => {
    const link = (teamId: string) => ({ teamId, name: teamId, ageGroupId: "ag_10u_2027" });
    const withIds = (kept?: Record<string, string>) => {
      const base = pool();
      return {
        ...base,
        teams: base.teams.map((one) => ({ ...one, gcTeams: [link(`gc${one.id.slice(2)}`)] })),
        ...(kept ? { kept } : {}),
      };
    };
    const user = userEvent.setup();
    renderTeamRankings(withIds());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    const panel = await screen.findByRole("region", { name: "Tournament field" });
    const box = within(panel).getByRole("combobox", { name: /add a club/i });
    for (const name of ["hawks", "bears"]) {
      await user.click(box);
      await user.type(box, name);
      await user.keyboard("{Enter}");
    }
    await user.type(within(panel).getByPlaceholderText("Event name"), "Fall Classic");
    await user.click(within(panel).getByRole("button", { name: "Save field" }));
    expect(readSavedFields("ag_10u_2027")).toEqual([
      {
        name: "Fall Classic",
        teamIds: ["S-HAW", "S-BEA"],
        pools: 1,
        advance: 4,
        gc: ["gcHAW", "gcBEA"],
      },
    ]);
  });

  it("opens a field whose club's id is another club's now with that club not ranked here", async () => {
    const link = (teamId: string) => ({ teamId, name: teamId, ageGroupId: "ag_10u_2027" });
    const base = pool();
    const user = userEvent.setup();
    renderTeamRankings({
      ...base,
      teams: base.teams.map((one) => ({ ...one, gcTeams: [link(`gc${one.id.slice(2)}`)] })),
      kept: {
        lf_tournament_fields_v1: JSON.stringify({
          ag_10u_2027: [
            {
              name: "Fall Classic",
              // The Bears' id kept for a club it no longer names, and the Hawks kept as they are.
              teamIds: ["S-HAW", "S-BEA"],
              pools: 1,
              advance: 4,
              gc: ["gcHAW", "gcOldBears"],
            },
          ],
        }),
      },
    });
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    const panel = await screen.findByRole("region", { name: "Tournament field" });
    await user.selectOptions(within(panel).getByLabelText("Saved fields"), "Fall Classic");
    const list = within(panel).getByRole("list", { name: "The field" });
    expect(list).toHaveTextContent("Hill Hawks");
    expect(list).not.toHaveTextContent("Bears");
    expect(list).toHaveTextContent("Not ranked here");
    expect(panel).toHaveTextContent("1 club is not ranked on this board");
    // Saved again, the club shown gone keeps the GameChanger id it was kept with, which a club
    // pulled back later is found by.
    await user.click(within(panel).getByRole("button", { name: "Save field" }));
    expect(readSavedFields("ag_10u_2027")[0]?.gc).toEqual(["gcHAW", "gcOldBears"]);
  });
});
