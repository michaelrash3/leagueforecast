import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ageGroup, game, renderTeamRankings, seasonDate, team } from "../test/teamRankingsHarness";

/**
 * A nationwide export is forty megabytes and a hundred and fifty thousand lines.
 *
 * It used to go straight into the textarea's `value`, which asks the browser to lay out forty
 * megabytes of monospaced text in a box eight rows tall and re-parse the lot on every keystroke
 * after. That is not a wait, it is a hang, and it happens before a single request is made.
 */
const pool = () => {
  const teams = [team("S-A", "Aces"), team("S-B", "Badgers")];
  return {
    ageGroups: [ageGroup(12, 2027)],
    teams,
    games: [game("g1", "ag_12u_2027", "S-A", "S-B", 6, 2, { date: seasonDate(2027) })],
  };
};

const HEADER = "Team Name,Team ID,Age Group,Season,City,State\n";
/** The count pill renders its number and its word as separate nodes, so match on the whole span. */
const pill = (label: string) =>
  screen.getAllByText(
    (_content, element) => element?.tagName === "SPAN" && element.textContent === label
  );

const csv = (rows: number): string =>
  HEADER +
  Array.from(
    { length: rows },
    // GameChanger ids are 8-24 characters, and a shorter one is not read as an id at all.
    (_unused, at) => `Club ${at} 12U,gcteam${String(at).padStart(6, "0")},12U,Fall 2026,Town,KY`
  ).join("\n");

describe("choosing a team list file", () => {
  it("does not put the file's contents in the textarea", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: "Import" }));

    const text = csv(400);
    await user.upload(
      screen.getByLabelText("Team list CSV"),
      new File([text], "teams.csv", { type: "text/csv" })
    );

    // The box is gone, replaced by what was chosen — so nothing renders the file itself.
    await waitFor(() => expect(screen.getByText("teams.csv")).toBeInTheDocument());
    expect(screen.queryByLabelText("Teams")).not.toBeInTheDocument();
    // And it was read: 400 teams, and a line count that includes the header.
    expect(screen.getByText(/401 lines/)).toBeInTheDocument();
    expect(pill("400 teams")).not.toHaveLength(0);
  });

  it("gives the box back, empty, when a different file is asked for", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: "Import" }));
    await user.upload(
      screen.getByLabelText("Team list CSV"),
      new File([csv(3)], "teams.csv", { type: "text/csv" })
    );
    await waitFor(() => expect(screen.getByText("teams.csv")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Choose a different file" }));
    expect(screen.getByLabelText("Teams")).toHaveValue("");
  });

  it("still takes a handful of ids typed in by hand", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: "Import" }));

    await user.type(screen.getByLabelText("Teams"), "gcteamaaa001\ngcteamaaa002");
    expect(pill("2 teams")).not.toHaveLength(0);
  });
});
