import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LeagueSchedulePaste from "./LeagueSchedulePaste";
import { SeasonEditable } from "./EditLock";
import type { PastedSeason } from "../../lib/leaguePaste";
import { DEFAULT_SETTINGS, type TeamBase } from "../../lib/types";
import { blankLog } from "../../lib/util";

const settings = { ...DEFAULT_SETTINGS, seasonLabel: "Fall 2026", defaultGameInnings: 6 };

const open = (
  teams: TeamBase[],
  text = "",
  onApply: (made: PastedSeason) => boolean = () => true,
  editable = true
) => {
  const onClose = vi.fn();
  const apply = vi.fn(onApply);
  render(
    <SeasonEditable value={editable}>
      <LeagueSchedulePaste
        text={text}
        teams={teams}
        settings={settings}
        onApply={apply}
        onClose={onClose}
      />
    </SeasonEditable>
  );
  return { onClose, apply };
};

const rowOf = (label: RegExp) => {
  const box = screen.getByRole("checkbox", { name: label });
  const row = box.closest("tr");
  if (!row) throw new Error("no row");
  return { box, row };
};

describe("pasting the league's schedule", () => {
  it("reads a paste, swaps a game the other way round, and hands over the season it makes", async () => {
    const user = userEvent.setup();
    const teams = [
      { id: "WOLV", name: "Wolves" },
      { id: "FALC", name: "Falcons" },
    ];
    const { apply, onClose } = open(teams);
    await user.type(
      screen.getByLabelText("League schedule to read"),
      "9/12 Falcons @ Wolves 5-6{enter}9/19 Falcons vs Wolves"
    );
    await user.click(screen.getByRole("button", { name: "Read the schedule" }));

    expect(screen.getByText(/Dates with no year are placed between August 2026 and July 2027/));
    // Both teams are the season's, so both games start ticked.
    expect(rowOf(/Add Falcons at Wolves/).box).toBeChecked();
    expect(rowOf(/Add Wolves at Falcons/).box).toBeChecked();

    // The first game the other way round: the score goes with the teams.
    await user.click(screen.getByRole("button", { name: "Swap home and away: Falcons at Wolves" }));
    const [, swappedRow] = screen.getAllByRole("row");
    if (!swappedRow) throw new Error("no row");
    expect(
      within(swappedRow).getByRole("checkbox", { name: "Add Wolves at Falcons" })
    ).toBeTruthy();
    expect(within(swappedRow).getByText("6–5")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add 2 games" }));
    expect(apply).toHaveBeenCalledTimes(1);
    const made = apply.mock.calls[0]?.[0];
    expect(made?.base).toBe(teams);
    expect(made?.teams).toBe(teams);
    expect(made?.matchups.map(({ date, away, home }) => ({ date, away, home }))).toEqual([
      { date: "9/12", away: "WOLV", home: "FALC" },
      { date: "9/19", away: "WOLV", home: "FALC" },
    ]);
    const [first, second] = made?.matchups ?? [];
    expect(made?.logs[first?.id ?? ""]).toEqual({
      ...blankLog("6"),
      awayRuns: "6",
      homeRuns: "5",
      isFinal: true,
    });
    expect(made?.logs[second?.id ?? ""]).toEqual(blankLog("6"));
    expect(made?.said).toBe("Added 2 games from the pasted schedule; 1 has a final score.");
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves a name that is no team here unticked, and adds it as a team once ticked", async () => {
    const user = userEvent.setup();
    const teams = [{ id: "WOLV", name: "Wolves" }];
    const { apply } = open(teams, "9/12 Comets @ Wolves\n9/19 Wolves @ Wolvess");

    expect(screen.getByText(/Not a team in this season: Comets, Wolvess/)).toBeTruthy();
    expect(rowOf(/Add Comets at Wolves/).box).not.toBeChecked();
    expect(within(rowOf(/Add Comets at Wolves/).row).getByText("new team")).toBeTruthy();
    // A close name is only a suggestion, and taking it makes the game one team against itself.
    expect(within(rowOf(/Add Wolves at Wolvess/).row).getByText("close to Wolves")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: 'Read "Wolvess" as Wolves' }));
    expect(rowOf(/Add Wolves at Wolvess/).box).toBeDisabled();
    expect(screen.getByText("the same team twice")).toBeTruthy();

    await user.click(rowOf(/Add Comets at Wolves/).box);
    await user.click(screen.getByRole("button", { name: "Add 1 game" }));
    const made = apply.mock.calls[0]?.[0];
    expect(made?.teams).toEqual([...teams, { id: "COME", name: "Comets" }]);
    expect(made?.matchups.map(({ away, home }) => [away, home])).toEqual([["COME", "WOLV"]]);
    expect(made?.said).toBe("Added 1 game from the pasted schedule, with 1 new team.");
  });

  it("puts each game on the team it names, and says which where the name differs", async () => {
    const user = userEvent.setup();
    const teams = [
      { id: "HEAT", name: "Heat (Ealey)" },
      { id: "HEA1", name: "Heat (Smith)" },
      { id: "WOLV", name: "Wolves" },
    ];
    const { apply } = open(teams, "9/13 Heat (Smith) @ Wolves\n9/14 Heat 9U (Ealey) @ Wolves");

    const smith = rowOf(/Add Heat \(Smith\) at Wolves/);
    expect(smith.box).toBeChecked();
    expect(within(smith.row).queryByText(/^as /)).toBeNull();
    // An age more than the team's name is that team, said so.
    const ealey = rowOf(/Add Heat 9U \(Ealey\) at Wolves/);
    expect(ealey.box).toBeChecked();
    expect(within(ealey.row).getByText("as Heat (Ealey)")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Add 2 games" }));
    const made = apply.mock.calls[0]?.[0];
    expect(made?.teams).toBe(teams);
    expect(made?.matchups.map(({ away, home }) => [away, home])).toEqual([
      ["HEA1", "WOLV"],
      ["HEAT", "WOLV"],
    ]);
  });

  it("adds two teams told apart by a coach's name, in a season with none, as two", async () => {
    const user = userEvent.setup();
    const { apply } = open([], "9/12 Heat (Ealey) @ Heat (Smith)");
    expect(rowOf(/Add Heat \(Ealey\) at Heat \(Smith\)/).box).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Add 1 game" }));
    const made = apply.mock.calls[0]?.[0];
    expect(made?.teams.map((team) => team.name)).toEqual(["Heat (Ealey)", "Heat (Smith)"]);
    expect(made?.said).toBe("Added 1 game from the pasted schedule, with 2 new teams.");
  });

  it("moves focus into the panel, to the games once read, and back to the text", async () => {
    const user = userEvent.setup();
    open([]);
    const box = screen.getByLabelText("League schedule to read");
    expect(box).toHaveFocus();
    await user.type(box, "Falcons @ Wolves");
    await user.click(screen.getByRole("button", { name: "Read the schedule" }));
    expect(screen.getByText(/^1 game read\./)).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Back to the text" }));
    expect(screen.getByLabelText("League schedule to read")).toHaveFocus();
  });

  it("opens on the games when handed text that reads as some", () => {
    open([], "Falcons @ Wolves");
    expect(screen.getByText(/^1 game read\./)).toHaveFocus();
  });

  it("makes every name a team in a season that has none, and says what it could not read", () => {
    open([], "Saturday, April 10\nFalcons @ Wolves\nApr 31 Comets @ Rockets\nGuessed\tTBD");
    expect(rowOf(/Add Falcons at Wolves/).box).toBeChecked();
    expect(screen.queryByText(/Not a team in this season/)).toBeNull();
    expect(screen.getByText("2 lines could not be read and were left out")).toBeTruthy();
    expect(screen.getByText("Apr 31 Comets @ Rockets")).toBeTruthy();
  });

  it("says so, and keeps the games, when App does not take them", async () => {
    const user = userEvent.setup();
    const { onClose } = open([], "Falcons @ Wolves", () => false);
    await user.click(screen.getByRole("button", { name: "Add 1 game" }));
    expect(screen.getByRole("alert").textContent).toMatch(/the season changed just now/);
    expect(onClose).not.toHaveBeenCalled();
    expect(rowOf(/Add Falcons at Wolves/).box).toBeChecked();
  });

  it("reads the team-list box again when it is handed other text", () => {
    const props = { teams: [], settings, onApply: () => true, onClose: () => undefined };
    const { rerender } = render(<LeagueSchedulePaste text="Falcons @ Wolves" {...props} />);
    expect(rowOf(/Add Falcons at Wolves/).box).toBeChecked();
    rerender(<LeagueSchedulePaste text="Comets @ Rockets" {...props} />);
    expect(screen.queryByRole("checkbox", { name: /Add Falcons at Wolves/ })).toBeNull();
    expect(rowOf(/Add Comets at Rockets/).box).toBeChecked();
  });

  it("adds nothing while the season may not be edited", () => {
    open([], "Falcons @ Wolves", () => true, false);
    expect(screen.getByRole("button", { name: "Add 1 game" })).toBeDisabled();
  });

  it("says what it needs when nothing could be read, and goes back to the text", async () => {
    const user = userEvent.setup();
    open([], "Falcons and Wolves");
    expect(screen.getByRole("alert").textContent).toMatch(/No games could be read/);
    expect(screen.getByLabelText("League schedule to read")).toHaveValue("Falcons and Wolves");
    await user.clear(screen.getByLabelText("League schedule to read"));
    await user.type(screen.getByLabelText("League schedule to read"), "Falcons @ Wolves");
    await user.click(screen.getByRole("button", { name: "Read the schedule" }));
    await user.click(screen.getByRole("button", { name: "Back to the text" }));
    expect(screen.getByLabelText("League schedule to read")).toHaveValue("Falcons @ Wolves");
  });
});
