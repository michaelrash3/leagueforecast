import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { readDefaultState } from "../../lib/preferences";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/*
 * Choosing the state Team Rankings' State top 10 opens on. The 10U page has two Ohio clubs and one
 * from Kentucky, so it opens on Ohio by itself; opening on Kentucky is the default's doing. Texas
 * has clubs only on the 9U page.
 */

const pool = (extra: Partial<Pool> = {}): Pool => ({
  ageGroups: [ageGroup(10, 2027), ageGroup(9, 2027)],
  teams: [
    team("S-A", "Aces", { state: "KY" }),
    team("S-B", "Badgers", { state: "OH" }),
    team("S-C", "Comets", { state: "OH" }),
    team("S-D", "Drifters", { state: "TX" }),
    team("S-E", "Embers", { state: "TX" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) }),
    game("g2", "ag_10u_2027", "S-B", "S-C", 4, 2, { date: seasonDate(2027) }),
    game("g3", "ag_9u_2027", "S-D", "S-E", 3, 2, { date: seasonDate(2027) }),
  ],
  search: "?view=rankings&age=10&year=2027",
  ...extra,
});

/** The State top 10's picker, the first of the two things labelled "State". */
const topState = () =>
  (screen.getAllByRole("combobox", { name: "State" })[0] as HTMLSelectElement).value;

describe("a default state for the State top 10", () => {
  it("is kept when made, and opens there the next time", async () => {
    const user = userEvent.setup();
    const first = renderTeamRankings(pool());
    expect(topState()).toBe("OH");

    // A pick during the visit is only that.
    await user.selectOptions(screen.getByRole("combobox", { name: "State" }), "KY");
    expect(topState()).toBe("KY");
    expect(readDefaultState()).toBeNull();

    await user.click(screen.getByRole("button", { name: "Make KY my default state" }));
    expect(readDefaultState()).toBe("KY");
    expect(screen.getByText("Opens on KY")).toBeInTheDocument();
    // The same button, its words changed, so the keyboard's place is not lost.
    const clear = screen.getByRole("button", { name: "Clear KY as the default state" });
    expect(clear).toHaveTextContent("Clear");
    expect(clear).toHaveFocus();
    first.unmount();

    renderTeamRankings(pool({ defaultState: readDefaultState() ?? "" }));
    expect(topState()).toBe("KY");
  });

  it("opens as before on a page with no club from the kept state, and keeps it", () => {
    renderTeamRankings(pool({ defaultState: "TX" }));
    expect(topState()).toBe("OH");
    expect(screen.getByRole("button", { name: "Make OH my default state" })).toBeInTheDocument();
    expect(readDefaultState()).toBe("TX");
  });

  it("is not offered for a state picked elsewhere that has no club on this page", () => {
    // Texas, picked on the board before it handed over, where this page has nobody from there.
    renderTeamRankings(pool({ handover: { stateTop: "TX" } }));
    expect(screen.getByText("No ranked teams in TX yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /default state/ })).toBeNull();
  });

  it("is forgotten by Clear, which leaves the card where it is until the next open", async () => {
    const user = userEvent.setup();
    const first = renderTeamRankings(pool({ defaultState: "KY" }));
    expect(topState()).toBe("KY");

    await user.click(screen.getByRole("button", { name: "Clear KY as the default state" }));
    expect(readDefaultState()).toBeNull();
    expect(topState()).toBe("KY");
    expect(screen.getByRole("button", { name: "Make KY my default state" })).toHaveFocus();
    first.unmount();

    renderTeamRankings(pool());
    expect(topState()).toBe("OH");
  });
});
