import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ageGroup, game, renderTeamRankings, seasonDate, team } from "../test/teamRankingsHarness";
import type { GcTeamLink } from "../lib/teamRankings";

const link = (teamId: string, extra: Partial<GcTeamLink> = {}): GcTeamLink => ({
  teamId,
  name: `GC ${teamId}`,
  ageGroupId: "ag_12u_2027",
  ...extra,
});

/**
 * Three clubs on one page. "Hidden Duke" and "HD 2029" are one club under two names — nothing in
 * those strings says so, and the coaches are the only thing that does. Modelled on a real pair
 * from the export.
 */
const pool = () => ({
  ageGroups: [ageGroup(12, 2027)],
  teams: [
    team("S-HD1", "Hidden Duke", {
      state: "NM",
      gcTeams: [link("gc-hd1", { staff: ["Eric Varela", "Sam Wilson"] })],
    }),
    team("S-HD2", "HD 2029", {
      state: "NM",
      gcTeams: [link("gc-hd2", { staff: ["Eric Varela", "Sam Wilson", "Cyndee Varela"] })],
    }),
    team("S-ONE", "Anchorage Drillers", {
      state: "AK",
      gcTeams: [link("gc-one", { staff: ["Sam Wilson", "Kendall Wilson"] })],
    }),
    team("S-NONE", "Unrelated Club", { state: "TX", gcTeams: [link("gc-none")] }),
  ],
  games: [
    game("g1", "ag_12u_2027", "S-HD1", "S-ONE", 7, 3, { date: seasonDate(2027) }),
    game("g2", "ag_12u_2027", "S-HD2", "S-NONE", 5, 4, { date: seasonDate(2027) }),
    game("g3", "ag_12u_2027", "S-ONE", "S-NONE", 2, 1, { date: seasonDate(2027) }),
  ],
});

const openTeam = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole("button", { name: /show all/i }));
  await user.click(within(screen.getByRole("table")).getByRole("button", { name }));
  return screen.getByRole("region", { name });
};

/** The merge picker is a search box; its list only exists once it has the focus. */
const openMergePicker = async (
  user: ReturnType<typeof userEvent.setup>,
  panel: HTMLElement
): Promise<HTMLElement[]> => {
  await user.click(within(panel).getByRole("combobox"));
  return within(panel).getAllByRole("option");
};

describe("finding the same club in the merge picker", () => {
  it("puts the club the coaches point to first", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await openTeam(user, "Hidden Duke");

    const options = await openMergePicker(user, panel);
    // Two shared coaches: the same club 98% of the time by state. Alphabetically it would be third.
    expect(options[0]).toHaveTextContent("HD 2029");
  });

  it("says why, in the terms somebody deciding would want", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await openTeam(user, "Hidden Duke");

    const options = await openMergePicker(user, panel);
    expect(options[0]).toHaveTextContent(/Shares 2 coaches.*almost always the same club/i);
  });

  it("marks one shared coach as a hint rather than a match", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await openTeam(user, "Hidden Duke");

    // Sam Wilson coaches in Albuquerque and Anchorage. Same name, nothing else.
    const drillers = (await openMergePicker(user, panel)).find((option) =>
      option.textContent?.includes("Anchorage Drillers")
    );
    expect(drillers).toHaveTextContent(/hint rather than a match/i);
  });

  it("still offers the teams no coach connects, after the ones that do", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await openTeam(user, "Hidden Duke");

    const labels = (await openMergePicker(user, panel)).map((option) => option.textContent ?? "");
    // Nothing is hidden: a proposal this strong is still only a proposal.
    expect(labels.some((label) => label.includes("Unrelated Club"))).toBe(true);
    expect(labels.findIndex((label) => label.includes("Unrelated Club"))).toBeGreaterThan(
      labels.findIndex((label) => label.includes("HD 2029"))
    );
  });

  it("falls back to the plain picker when nobody's staff is known", async () => {
    const user = userEvent.setup();
    const bare = pool();
    renderTeamRankings({
      ...bare,
      teams: bare.teams.map((entry) => ({
        ...entry,
        gcTeams: entry.gcTeams?.map(({ staff: _staff, ...rest }) => rest),
      })),
    });
    const panel = await openTeam(user, "Hidden Duke");

    // A pool built by hand, or pulled before the list carried staff, works exactly as it did.
    const options = await openMergePicker(user, panel);
    expect(options.length).toBeGreaterThan(0);
    options.forEach((option) => expect(option).not.toHaveTextContent(/coach/i));
  });
});

describe("a GameChanger page that may not be a team", () => {
  it("shows how few players are on it", async () => {
    const user = userEvent.setup();
    const short = pool();
    renderTeamRankings({
      ...short,
      teams: short.teams.map((entry) =>
        entry.id === "S-HD1"
          ? { ...entry, gcTeams: [link("gc-hd1", { staff: ["Eric Varela"], playerCount: 6 })] }
          : entry
      ),
    });
    const panel = await openTeam(user, "Hidden Duke");

    // It takes nine to field a side, so six is a page somebody has not finished.
    expect(within(panel).getByText("6 players")).toBeInTheDocument();
  });

  it("says nothing about a full roster", async () => {
    const user = userEvent.setup();
    const full = pool();
    renderTeamRankings({
      ...full,
      teams: full.teams.map((entry) =>
        entry.id === "S-HD1" ? { ...entry, gcTeams: [link("gc-hd1", { playerCount: 14 })] } : entry
      ),
    });
    const panel = await openTeam(user, "Hidden Duke");

    expect(within(panel).queryByText(/14 players/)).toBeNull();
  });

  it("names the coaches it knows about", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await openTeam(user, "Hidden Duke");

    expect(within(panel).getByText(/Eric Varela, Sam Wilson/)).toBeInTheDocument();
  });
});
