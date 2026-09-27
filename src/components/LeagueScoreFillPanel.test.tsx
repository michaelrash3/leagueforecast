import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LeagueScoreFillPanel } from "./LeagueScoreFillPanel";
import type { LeagueFillPlan, LeagueFillRow } from "../lib/leagueScoreFill";

/*
 * The review, for the rows the names could not settle: a club's own game against a slot, and a
 * game the two clubs' schedules score differently. Neither is ticked unasked where it could change
 * a result, and where the two schedules differ a person picks whose score goes in.
 */
const base = (over: Partial<LeagueFillRow>): LeagueFillRow => ({
  matchupId: "m",
  date: "9/25",
  awayTeamId: "A",
  awayName: "Away",
  homeTeamId: "H",
  homeName: "Home",
  awayRuns: 0,
  homeRuns: 0,
  action: "fill",
  ...over,
});
const plan: LeagueFillPlan = {
  rows: [
    base({
      matchupId: "slot",
      awayName: "513 FORCE - BOULEY",
      homeName: "Cincinnati Hornets",
      awayRuns: 0,
      homeRuns: 13,
      action: "slot",
      detail: "513 FORCE - BOULEY’s own schedule has this game against “TBD- 09/25/26, 7:15 PM”.",
    }),
    base({
      matchupId: "close",
      awayName: "Trash Pandas Baseball Club",
      homeName: "Yeager Dreyer",
      awayRuns: 7,
      homeRuns: 13,
      action: "fill",
      reportedBy: "Trash Pandas Baseball Club",
      alternative: { awayRuns: 7, homeRuns: 12, reportedBy: "Yeager Dreyer" },
    }),
    base({
      matchupId: "flip",
      awayName: "Diesel Black",
      homeName: "Indiana Bulls West",
      awayRuns: 4,
      homeRuns: 2,
      action: "disputed",
      reportedBy: "Diesel Black",
      alternative: { awayRuns: 5, homeRuns: 18, reportedBy: "Indiana Bulls West" },
    }),
  ],
  unmatched: 0,
  unusedResults: 0,
  seasonLinked: true,
};

describe("the fill review's rows the names could not settle", () => {
  it("names them for what they are and ticks only the plain fill", () => {
    render(
      <LeagueScoreFillPanel plan={plan} seasonLabel="Fall" onApply={vi.fn()} onClose={vi.fn()} />
    );

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Check opponent")).toBeInTheDocument();
    expect(table.getByText("Check score")).toBeInTheDocument();
    expect(screen.getByLabelText(/Fill 513 FORCE - BOULEY at/)).not.toBeChecked();
    expect(screen.getByLabelText(/Fill Trash Pandas Baseball Club at/)).toBeChecked();
    expect(screen.getByLabelText(/Fill Diesel Black at/)).not.toBeChecked();
  });

  it("fills the version a person picks where the two schedules differ", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <LeagueScoreFillPanel plan={plan} seasonLabel="Fall" onApply={onApply} onClose={vi.fn()} />
    );

    const flip = screen.getByRole("group", { name: /Whose score for Diesel Black at/ });
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(2);
    await user.click(screen.getByRole("radio", { name: /5–18 Indiana Bulls West/ }));
    await user.click(screen.getByLabelText(/Fill Diesel Black at/));
    await user.click(screen.getByRole("button", { name: /Fill 2 games/ }));

    expect(flip).toBeInTheDocument();
    expect(onApply).toHaveBeenCalledWith(["close", "flip"], ["flip"]);
  });

  it("does not carry a picked version for a row left unticked", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <LeagueScoreFillPanel plan={plan} seasonLabel="Fall" onApply={onApply} onClose={vi.fn()} />
    );

    await user.click(screen.getByRole("radio", { name: /5–18 Indiana Bulls West/ }));
    await user.click(screen.getByRole("button", { name: /Fill 1 game/ }));

    expect(onApply).toHaveBeenCalledWith(["close"], []);
  });
});
