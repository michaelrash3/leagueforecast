import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { GcTeamLink } from "../../lib/teamRankings";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/*
 * Finding a club by who coaches it. A nationwide pool holds forty clubs of some names, and the
 * person looking for one usually knows its coach better than its GameChanger name, so every club
 * picker searches the coaches off the club's GameChanger teams and lists them under each result.
 * The names here are invented.
 */
const link = (teamId: string, ageGroupId: string, staff: string[]): GcTeamLink => ({
  teamId,
  name: teamId,
  ageGroupId,
  staff,
});

const pool = () => ({
  ageGroups: [ageGroup(10, 2027), ageGroup(11, 2028)],
  teams: [
    team("S-RAPT", "River City Raptors", {
      state: "KY",
      city: "Hebron",
      gcTeams: [link("gcRAPT", "ag_10u_2027", ["Pat Placeholder", "Sam Sample"])],
    }),
    team("S-RAP2", "River City Raptors", {
      state: "OH",
      gcTeams: [link("gcRAP2", "ag_10u_2027", ["Alex Example"])],
    }),
    team("S-PION", "South Kenton Pioneers", { state: "KY" }),
    team("S-CANE", "Canes Triad Black", {
      state: "NC",
      gcTeams: [
        link("gcCANE", "ag_11u_2028", [
          "Dana Dummy",
          "Robin Roster",
          "Casey Clipboard",
          "Jordan Jersey",
        ]),
      ],
    }),
    team("S-LEGA", "Legacy Baseball Club", { state: "KY" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-RAPT", "S-PION", 15, 7, { date: seasonDate(2027) }),
    game("g2", "ag_11u_2028", "S-CANE", "S-LEGA", 6, 2, { date: seasonDate(2028) }),
    game("g3", "ag_10u_2027", "S-RAP2", "S-PION", 4, 3, { date: seasonDate(2027) }),
  ],
});

/** A search box's own results: the page's native selects carry the option role too. */
const resultsOf = (box: HTMLElement) =>
  within(document.getElementById(box.getAttribute("aria-controls") ?? "") as HTMLElement)
    .queryAllByRole("option")
    .filter((option) => !/No team matches/.test(option.textContent ?? ""));

const typeInto = async (
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLElement,
  text: string
) => {
  await user.click(box);
  await user.type(box, text);
  return resultsOf(box);
};

describe("finding a club by its coach", () => {
  it("finds it from Find a team, on a page not on screen, and says which coach matched", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const box = screen.getByRole("combobox", { name: /find a team/i });

    const results = await typeInto(user, box, "sample");
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent("River City Raptors");
    expect(results[0]).toHaveTextContent("Hebron, KY");
    expect(results[0]).toHaveTextContent("Coaches: Sam Sample, Pat Placeholder");
    // The coach the search found is marked, and listed first; the others are not.
    const marked = [...results[0]!.querySelectorAll("strong")].map((node) => node.textContent);
    expect(marked).toEqual(["Sam Sample"]);
  });

  it("lists each club's coaches, so two clubs of one name can be told apart", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const box = screen.getByRole("combobox", { name: /find a team/i });

    const results = await typeInto(user, box, "raptors");
    const lines = results.map((option) => option.textContent ?? "");
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("Coaches: Pat Placeholder, Sam Sample"))).toBe(true);
    expect(lines.some((line) => line.includes("Coaches: Alex Example"))).toBe(true);
  });

  it("names three coaches and counts the rest, keeping the one searched for", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const box = screen.getByRole("combobox", { name: /find a team/i });

    const results = await typeInto(user, box, "jersey");
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent(
      "Coaches: Jordan Jersey, Dana Dummy, Robin Roster and 1 more"
    );
  });

  it("finds it from the Scouting pickers", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));

    const results = await typeInto(
      user,
      screen.getByRole("combobox", { name: /how would/i }),
      "example"
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent("River City Raptors");
    expect(results[0]).toHaveTextContent("Coaches: Alex Example");
  });

  it("finds it from a club's Same team as picker", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("button", { name: /show all \d+ teams/i }));
    await user.click(
      within(screen.getByRole("table")).getByRole("button", { name: "South Kenton Pioneers" })
    );

    const results = await typeInto(
      user,
      await screen.findByRole("combobox", { name: /same team as/i }),
      "example"
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent("River City Raptors");
    expect(results[0]).toHaveTextContent("Coaches: Alex Example");
  });
});
