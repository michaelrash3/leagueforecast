import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, seasonDate, team } from "../test/teamRankingsHarness";

/**
 * One section is made to throw, to prove the boundary around the section panel is wired up and
 * that the rest of the page survives it. Mocking the module is the only honest way in: nothing a
 * test can put in the pool makes a healthy section throw, which is the point.
 */
vi.mock("./teamRankings/ScoutingSection", () => ({
  ScoutingSection: () => {
    throw new Error("the report blew up");
  },
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const pool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
  games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) })],
});

describe("a section that throws", () => {
  it("does not take the page with it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());

    await user.click(screen.getByRole("tab", { name: "Scouting" }));

    expect(screen.getByRole("alert")).toHaveTextContent("The scouting report could not be shown");
    // The tabs and the age picker are outside the boundary, so they are still there to leave by.
    expect(screen.getByRole("tab", { name: "Rankings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Team Rankings" })).toBeInTheDocument();
  });

  it("lets you walk away to a section that works", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());

    await user.click(screen.getByRole("tab", { name: "Scouting" }));
    await user.click(screen.getByRole("tab", { name: "Rankings" }));

    // Keying the boundary by section is what clears the caught error on the way out; without it
    // the boundary stays broken and every other section is unreachable too.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { name: /national top/i })).toBeInTheDocument();
  });

  it("still lets Setup be reached, so a backup can be taken out", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());

    await user.click(screen.getByRole("tab", { name: "Scouting" }));
    await user.click(screen.getByRole("tab", { name: "Setup" }));

    expect(screen.getByRole("button", { name: /download a backup/i })).toBeInTheDocument();
  });
});
