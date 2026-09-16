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

/**
 * Two age groups a year apart, each with its own teams. Finding a club on the page you are not
 * looking at is the whole point: the age tabs cannot help you when you do not know which tab.
 */
const pool = () => ({
  ageGroups: [ageGroup(10, 2027), ageGroup(11, 2028)],
  teams: [
    team("S-RAPT", "River City Raptors", { state: "KY", city: "Hebron" }),
    team("S-PION", "South Kenton Pioneers", { state: "KY" }),
    team("S-CANE", "Canes Triad Black", { state: "NC", city: "Clemmons" }),
    team("S-LEGA", "Legacy Baseball Club", { state: "KY" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-RAPT", "S-PION", 15, 7, { date: seasonDate(2027) }),
    game("g2", "ag_11u_2028", "S-CANE", "S-LEGA", 6, 2, { date: seasonDate(2028) }),
  ],
});

/**
 * The season-year and state pickers are native selects, whose `<option>`s carry the option role
 * too — so a search's results have to be read out of its own listbox rather than off the page.
 */
const listboxOf = (box: HTMLElement): HTMLElement => {
  const id = box.getAttribute("aria-controls");
  return document.getElementById(id ?? "") as HTMLElement;
};

const search = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  const box = screen.getByRole("combobox", { name: /find a team/i });
  await user.click(box);
  await user.type(box, text);
  return { box, results: () => within(listboxOf(box)).getAllByRole("option") };
};

describe("finding a team from the Rankings tab", () => {
  it("offers a search box above the boards", () => {
    renderTeamRankings(pool());
    expect(screen.getByRole("combobox", { name: /find a team/i })).toBeInTheDocument();
  });

  it("narrows to what was typed", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const { results } = await search(user, "canes");

    expect(results()).toHaveLength(1);
    expect(results()[0]).toHaveTextContent("Canes Triad Black");
  });

  it("says which page each team is on, so two clubs of a name can be told apart", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const { results } = await search(user, "canes");

    // The club is on a page a year and a level away from the one on screen.
    expect(results()[0]).toHaveTextContent("11U 2028");
    expect(results()[0]).toHaveTextContent("Clemmons, NC");
  });

  it("finds a team filed under a season that is not on screen", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    // The page opens on 10U 2027; Canes Triad Black is 11U 2028 and not in this table at all.
    const { results } = await search(user, "canes");

    expect(results()).toHaveLength(1);
  });

  it("goes to that team's page and opens it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const { results } = await search(user, "canes");
    await user.click(within(results()[0]!).getByRole("button"));

    // Landed on the right page, with the team open — without knowing the season or the level.
    expect(screen.getByRole("region", { name: "Canes Triad Black" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("age")).toBe("11");
    expect(new URLSearchParams(window.location.search).get("year")).toBe("2028");
  });

  it("opens a team already on this page without navigating away", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const { results } = await search(user, "raptors");
    await user.click(within(results()[0]!).getByRole("button"));

    expect(screen.getByRole("region", { name: "River City Raptors" })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("age")).toBe("10");
  });

  it("stays out of the way when there is nothing to search", () => {
    renderTeamRankings({ ageGroups: [], teams: [], games: [] });
    expect(screen.queryByRole("combobox", { name: /find a team/i })).toBeNull();
  });
});

describe("the scouting report picker", () => {
  const openScouting = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("tab", { name: "Scouting" }));
  };

  it("is a search box rather than a dropdown", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openScouting(user);

    // A native select over a nationwide pool is a wall: no way to type at it.
    const box = document.getElementById("scout-report-team")!;
    expect(box.tagName).toBe("INPUT");
    expect(box).toHaveAttribute("role", "combobox");
  });

  it("narrows to what was typed", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openScouting(user);

    const box = document.getElementById("scout-report-team")!;
    await user.click(box);
    await user.type(box, "pion");

    const options = within(listboxOf(box)).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("South Kenton Pioneers");
  });

  it("reports on the team that was picked", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openScouting(user);

    const box = document.getElementById("scout-report-team")!;
    await user.click(box);
    await user.type(box, "pion");
    await user.click(within(within(listboxOf(box)).getAllByRole("option")[0]!).getByRole("button"));

    // Closed, the box shows the team it is reporting on rather than the search that found it.
    expect((box as HTMLInputElement).value).toBe("South Kenton Pioneers");
  });
});
