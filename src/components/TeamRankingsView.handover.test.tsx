import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TEAM_PANEL_ID } from "./TeamDetailPanel";
import { ageGroup, game, renderTeamRankings, seasonDate, team } from "../test/teamRankingsHarness";

/*
 * Team Rankings taking over from the live board (`LiveTeamRankings`): it opens where the board
 * left off, on the club tapped, the search asked for, the clubs Scouting was on, and the state
 * boards as they were.
 */

const pool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [
    team("S-A", "Aces", { state: "KY" }),
    team("S-B", "Badgers", { state: "OH" }),
    team("S-C", "Comets", { state: "OH" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) }),
    game("g2", "ag_10u_2027", "S-B", "S-C", 4, 2, { date: seasonDate(2027) }),
  ],
});

describe("Team Rankings taking over from the live board", () => {
  it("opens as it always has with nothing handed over", () => {
    renderTeamRankings(pool());
    expect(document.getElementById(TEAM_PANEL_ID)).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide the full table" })).toBeNull();
  });

  it("opens the club tapped on the board", () => {
    renderTeamRankings({ ...pool(), handover: { openTeamId: "S-B" } });
    expect(document.getElementById(TEAM_PANEL_ID)?.textContent).toContain("Badgers");
  });

  it("keeps the state boards and the full table as they were", () => {
    renderTeamRankings({
      ...pool(),
      handover: { stateTop: "KY", stateFilter: "OH", showAll: true },
    });
    // The state top ten's picker, and the full table's filter, both labelled "State".
    const [top, filter] = screen.getAllByRole("combobox", { name: "State" }) as HTMLSelectElement[];
    expect(top?.value).toBe("KY");
    expect(filter?.id).toBe("scout-state-filter");
    expect((document.getElementById("scout-state-filter") as HTMLSelectElement).value).toBe("OH");
    expect(screen.getByRole("button", { name: "Hide the full table" })).toBeTruthy();
  });

  it("puts the cursor in the search asked for", async () => {
    renderTeamRankings({ ...pool(), handover: { focusSearch: true } });
    await waitFor(() =>
      expect(document.activeElement).toBe(document.getElementById("scout-team-search"))
    );
  });

  it("reports in Scouting on the club the board's Scouting was reporting on", async () => {
    renderTeamRankings({
      ...pool(),
      search: "?view=rankings&age=10&year=2027&section=scouting",
      handover: { reportTeamId: "S-B" },
    });
    const box = await screen.findByRole("combobox", { name: /How would/ });
    await waitFor(() => expect(box).toHaveValue("Badgers"));
  });

  it("sets beside it the club compared on the board, with the opponents asked for", async () => {
    renderTeamRankings({
      ...pool(),
      search: "?view=rankings&age=10&year=2027&section=scouting",
      handover: { reportTeamId: "S-B", compareTeamId: "S-C", pickedOpponentIds: ["S-A"] },
    });
    expect(await screen.findByRole("region", { name: "Badgers and Comets compared" })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Compare with")).toHaveValue("Comets"));
    expect(screen.getAllByRole("button", { name: "Remove Aces from the report" }).length).toBe(1);
  });

  it("says so when the club compared on the board is not ranked here, rather than going blank", async () => {
    renderTeamRankings({
      ...pool(),
      search: "?view=rankings&age=10&year=2027&section=scouting",
      handover: { reportTeamId: "S-B", compareTeamId: "S-GONE" },
    });
    expect(
      await screen.findByText(/The club picked to compare is not ranked on this board/)
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: /compared/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /^Forecast/ })).toBeNull();
  });
});
