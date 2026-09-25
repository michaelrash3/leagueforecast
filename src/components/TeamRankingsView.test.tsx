import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
  type Pool,
} from "../test/teamRankingsHarness";
import { loadScoutTeams } from "../lib/teamRankingsStorage";

/**
 * Two age groups in the same season year, each with its own teams and its own results. The 9U and
 * 11U pools are rated together — one season year is one fit — but each page lists only its own.
 */
const twoAgePool = (): Pool => ({
  ageGroups: [ageGroup(9, 2026), ageGroup(11, 2026)],
  teams: [
    team("S-ROCK", "Rockets", { state: "KY" }),
    team("S-COMET", "Comets", { state: "KY" }),
    team("S-BOLT", "Thunderbolts", { state: "OH" }),
    team("S-TITAN", "Titans", { state: "OH" }),
  ],
  games: [
    game("g1", "ag_9u_2026", "S-ROCK", "S-COMET", 7, 3, { date: seasonDate(2026) }),
    game("g2", "ag_9u_2026", "S-ROCK", "S-COMET", 5, 4, { date: seasonDate(2026) }),
    game("g3", "ag_11u_2026", "S-BOLT", "S-TITAN", 2, 8, { date: seasonDate(2026) }),
    game("g4", "ag_11u_2026", "S-BOLT", "S-TITAN", 1, 6, { date: seasonDate(2026) }),
  ],
});

/** The full table is collapsed by default; every test that reads a row opens it first. */
const openFullTable = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /show all \d+ teams/i }));
};

describe("which teams a page lists", () => {
  it("lists only this age group's teams, never the ones a year apart", async () => {
    const user = userEvent.setup();
    renderTeamRankings(twoAgePool());
    await openFullTable(user);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("button", { name: "Rockets" })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Comets" })).toBeInTheDocument();
    // Same season year, so they are rated in the same fit — but an 11U team has no business on a
    // 9U page, and showing one there was the bug that made this test worth writing.
    expect(within(table).queryByRole("button", { name: "Thunderbolts" })).toBeNull();
    expect(within(table).queryByRole("button", { name: "Titans" })).toBeNull();
  });

  it("swaps the list when another age tab is opened", async () => {
    const user = userEvent.setup();
    renderTeamRankings(twoAgePool());

    await user.click(screen.getByRole("button", { name: "11U" }));
    await openFullTable(user);

    const table = screen.getByRole("table");
    expect(within(table).getByRole("button", { name: "Thunderbolts" })).toBeInTheDocument();
    expect(within(table).queryByRole("button", { name: "Rockets" })).toBeNull();
  });

  it("puts the open age group in the URL, so the page can be linked to", async () => {
    const user = userEvent.setup();
    renderTeamRankings(twoAgePool());

    await user.click(screen.getByRole("button", { name: "11U" }));
    // The age level, not the group id: a link travels between browsers, and an id minted on one
    // machine means nothing on another, while "11U in 2026" means the same thing everywhere.
    expect(new URLSearchParams(window.location.search).get("age")).toBe("11");
  });

  it("opens the age group a link names rather than the first one", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ...twoAgePool(), search: "?age=11" });
    await openFullTable(user);

    expect(screen.getByRole("table")).toHaveTextContent("Thunderbolts");
  });
});

describe("opening a team", () => {
  it("opens the team whose name was clicked", async () => {
    const user = userEvent.setup();
    renderTeamRankings(twoAgePool());
    await openFullTable(user);

    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Comets" }));

    // The panel names itself after the team it is showing, which is what catches the id-namespace
    // bug: the panel opened a different team than the row clicked, because the table and the
    // roster numbered teams differently.
    const panel = screen.getByRole("region", { name: "Comets" });
    expect(within(panel).getByRole("heading", { name: "Comets" })).toBeInTheDocument();
  });

  it("shows that team's record, not a blank one", async () => {
    const user = userEvent.setup();
    renderTeamRankings(twoAgePool());
    await openFullTable(user);

    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Rockets" }));

    // Two games, both won. A panel that reported 0-0 for a team with results was a real bug.
    expect(screen.getByRole("region", { name: "Rockets" })).toHaveTextContent("2-0");
  });

  it("closes without leaving the previous team behind", async () => {
    const user = userEvent.setup();
    renderTeamRankings(twoAgePool());
    await openFullTable(user);
    const table = screen.getByRole("table");

    await user.click(within(table).getByRole("button", { name: "Rockets" }));
    const panel = screen.getByRole("region", { name: "Rockets" });
    await user.click(within(panel).getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("region", { name: "Rockets" })).toBeNull();

    await user.click(within(table).getByRole("button", { name: "Comets" }));
    expect(screen.getByRole("region", { name: "Comets" })).toBeInTheDocument();
  });
});

describe("removing a team from a page", () => {
  it("actually removes them", async () => {
    const user = userEvent.setup();
    renderTeamRankings(twoAgePool());
    await openFullTable(user);

    const table = screen.getByRole("table");
    const row = within(table).getByRole("button", { name: "Comets" }).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));

    // The button used to toast success and leave the team exactly where it was.
    expect(within(screen.getByRole("table")).queryByText("Comets")).toBeNull();
    // Their only opponent had no other games, so the page empties rather than leaving a stray row.
    expect(within(screen.getByRole("table")).queryByText("Rockets")).toBeNull();
  });

  it("keeps a team in the roster that a claimed row on another page was filed against", async () => {
    // The 11U game holds a row of another club's schedule, filed against the Comets by name and
    // claimed for this copy (`FoldedRow.filedAgainst`): the Comets are where that row goes back.
    const user = userEvent.setup();
    const pool = twoAgePool();
    renderTeamRankings({
      ...pool,
      games: pool.games.map((one) =>
        one.id === "g3"
          ? { ...one, alsoRows: [{ teamId: "gcOTHER", gameId: "o1", filedAgainst: "S-COMET" }] }
          : one
      ),
    });
    await openFullTable(user);

    const row = within(screen.getByRole("table"))
      .getByRole("button", { name: "Comets" })
      .closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));

    expect(within(screen.getByRole("table")).queryByText("Comets")).toBeNull();
    expect(loadScoutTeams().some((one) => one.id === "S-COMET")).toBe(true);
  });

  it("asks first, and does nothing when the answer is no", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(twoAgePool());
    harness.requestConfirmation.mockResolvedValue(false);
    await openFullTable(user);

    const table = screen.getByRole("table");
    const row = within(table).getByRole("button", { name: "Comets" }).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Remove" }));

    expect(harness.requestConfirmation).toHaveBeenCalled();
    expect(
      within(screen.getByRole("table")).getByRole("button", { name: "Comets" })
    ).toBeInTheDocument();
  });
});

describe("an age level that is not ranked", () => {
  it("says why there is no table instead of looking empty", () => {
    renderTeamRankings({
      ageGroups: [ageGroup(8, 2026)],
      teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
      games: [game("g1", "ag_8u_2026", "S-A", "S-B", 4, 2, { date: seasonDate(2026) })],
    });

    expect(screen.getByText(/8U is not ranked/i)).toBeInTheDocument();
  });

  it("marks the tab so an unranked level is visible before it is opened", () => {
    renderTeamRankings({
      ageGroups: [ageGroup(8, 2026), ageGroup(9, 2026)],
      teams: [],
      games: [],
    });

    expect(screen.getByRole("button", { name: "8U ·" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "9U" })).toBeInTheDocument();
  });
});

describe("a game dated outside the squad year", () => {
  it("is left out of the page it was filed under", () => {
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027)],
      teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
      games: [
        // 10U 2027 runs August 2026 to July 2027. This is the spring before, which belongs to the
        // squad a year younger — GameChanger lists a club's older games under a new id often
        // enough that letting them through put thousands of stale rows on the wrong tables.
        game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: "2026-05-01" }),
      ],
    });

    expect(screen.getByText(/add a game in games to start ranking/i)).toBeInTheDocument();
  });

  it("counts one dated inside it", () => {
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027)],
      teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
      games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) })],
    });

    expect(screen.getByText("of 2 ranked")).toBeInTheDocument();
  });
});

describe("a browser with nothing in it yet", () => {
  it("offers the two ways in rather than an empty table", () => {
    renderTeamRankings({ ageGroups: [], teams: [], games: [] });

    expect(screen.getByText(/nothing ranked yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pull from gamechanger/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /set one up by hand/i })).toBeInTheDocument();
  });
});
