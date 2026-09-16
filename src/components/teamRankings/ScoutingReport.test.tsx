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
} from "../../test/teamRankingsHarness";
import { SCOUT_REPORT_NATIONAL_TOP, SCOUT_REPORT_STATE_TOP } from "../../lib/teamRankings";

/**
 * Forty teams in a ladder, alternating states, so both cuts have to bite: more than the national
 * top 25 and more than either state's top 10.
 */
const bigPool = (): Pool => {
  const teams = Array.from({ length: 40 }, (_, index) =>
    team(`S-${index}`, `Team ${index}`, { state: index % 2 === 0 ? "KY" : "OH" })
  );
  const games = Array.from({ length: 39 }, (_, index) =>
    game(`g${index}`, "ag_10u_2027", `S-${index}`, `S-${index + 1}`, 6, 2, {
      date: seasonDate(2027),
    })
  );
  return { ageGroups: [ageGroup(10, 2027)], teams, games };
};

const openScouting = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: /scouting/i }));
};

/** The body rows of the named table. */
const rowsOf = (name: RegExp): HTMLElement[] =>
  within(screen.getByRole("table", { name })).queryAllByRole("row").slice(1);

describe("the scouting report", () => {
  it("shows the top of the national table rather than every ranked team", async () => {
    // It used to be a row per ranked team, which on a nationwide pool is thousands of them.
    const user = userEvent.setup();
    renderTeamRankings(bigPool());
    await openScouting(user);

    expect(rowsOf(/against the top 25/i)).toHaveLength(SCOUT_REPORT_NATIONAL_TOP);
  });

  it("shows the scouted team's own state next to it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());
    await openScouting(user);

    const stateRows = rowsOf(/against the top 10 in (KY|OH)/i);
    expect(stateRows.length).toBeGreaterThan(0);
    expect(stateRows.length).toBeLessThanOrEqual(SCOUT_REPORT_STATE_TOP);
  });

  it("says how many more there are to search, rather than listing them", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());
    await openScouting(user);

    expect(screen.getByText(/39 ranked teams to choose from/i)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /check a team/i })).toBeInTheDocument();
  });

  it("adds a team the two lists do not reach, and takes it back off", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());
    await openScouting(user);

    const box = screen.getByRole("combobox", { name: /check a team/i });
    await user.click(box);
    await user.type(box, "Team 39");
    const listbox = document.getElementById(box.getAttribute("aria-controls") ?? "")!;
    await user.click(within(listbox).getAllByRole("option")[0]!.querySelector("button")!);

    const remove = await screen.findByRole("button", { name: /remove team 39 from the report/i });
    expect(remove).toBeInTheDocument();

    await user.click(remove);
    expect(
      screen.queryByRole("button", { name: /remove team 39 from the report/i })
    ).not.toBeInTheDocument();
  });

  it("never offers the scouted team as its own opponent", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());
    await openScouting(user);

    const scouted = (screen.getByRole("combobox", { name: /how would/i }) as HTMLInputElement)
      .value;
    const box = screen.getByRole("combobox", { name: /check a team/i });
    await user.click(box);
    await user.type(box, scouted);
    const listbox = document.getElementById(box.getAttribute("aria-controls") ?? "")!;

    expect(
      within(listbox)
        .queryAllByRole("option")
        .map((option) => option.textContent)
        .some((text) => text?.startsWith(scouted))
    ).toBe(false);
  });
});
