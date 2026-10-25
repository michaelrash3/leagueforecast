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

describe("games between the league's clubs not on the schedule", () => {
  const missing: NonNullable<LeagueFillPlan["missing"]> = [
    {
      scoutGameId: "s1",
      date: "9/27",
      awayTeamId: "A",
      homeTeamId: "H",
      awayName: "Placeholder Aces",
      homeName: "Placeholder Hive",
      awayRuns: 6,
      homeRuns: 2,
    },
    {
      scoutGameId: "s2",
      date: "10/4",
      awayTeamId: "H",
      homeTeamId: "A",
      awayName: "Placeholder Hive",
      homeName: "Placeholder Aces",
      awayRuns: 3,
      homeRuns: 9,
      tournament: "Entered under Fall Classic.",
    },
  ];
  const quiet: LeagueFillPlan = {
    rows: [],
    missing,
    unmatched: 0,
    unusedResults: 2,
    seasonLinked: true,
  };

  it("are offered with nothing else to fill, the tournament's unticked, and added as left", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <LeagueScoreFillPanel plan={quiet} seasonLabel="Fall" onApply={onApply} onClose={() => {}} />
    );
    expect(
      screen.getByRole("checkbox", { name: "Add Placeholder Aces at Placeholder Hive, 9/27" })
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Add Placeholder Hive at Placeholder Aces, 10/4" })
    ).not.toBeChecked();
    expect(screen.getByText("Entered under Fall Classic.")).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "Swap home and away for Placeholder Aces at Placeholder Hive, 9/27",
      })
    );
    expect(screen.getByText("Placeholder Hive 2, Placeholder Aces 6")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add 1 game" }));
    expect(onApply).toHaveBeenCalledWith([], [], { add: ["s1"], swap: ["s1"] });
  });

  it("can be added where no score is ticked to fill", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const unticked = { ...plan, rows: plan.rows.filter((row) => row.action !== "fill"), missing };
    render(
      <LeagueScoreFillPanel
        plan={unticked}
        seasonLabel="Fall"
        onApply={onApply}
        onClose={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: "Add 1 game" }));
    expect(onApply).toHaveBeenCalledWith([], [], { add: ["s1"], swap: [] });
  });

  it("are added beside the scores filled, and not asked for when none is ticked", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <LeagueScoreFillPanel
        plan={{ ...plan, missing }}
        seasonLabel="Fall"
        onApply={onApply}
        onClose={() => {}}
      />
    );
    const fills = plan.rows.filter((row) => row.action === "fill").length;
    await user.click(
      screen.getByRole("button", { name: `Fill ${fills} game${fills === 1 ? "" : "s"} and add 1` })
    );
    expect(onApply).toHaveBeenLastCalledWith(expect.any(Array), expect.any(Array), {
      add: ["s1"],
      swap: [],
    });
  });
});

describe("a game the schedule has, played on another day", () => {
  const rainedOut: LeagueFillPlan = {
    rows: [],
    missing: [
      {
        scoutGameId: "s9",
        date: "9/27",
        awayTeamId: "BEAR",
        homeTeamId: "ACES",
        awayName: "Bears",
        homeName: "Aces",
        awayRuns: 2,
        homeRuns: 6,
      },
    ],
    unmatched: 0,
    unusedResults: 0,
    seasonLinked: true,
  };

  it("is offered as moved, and applied as a move rather than an added game", async () => {
    const onApply = vi.fn();
    render(
      <LeagueScoreFillPanel
        plan={rainedOut}
        seasonLabel="Fall"
        onApply={onApply}
        onClose={() => {}}
        schedule={[{ id: "g1", date: "9/20", away: "ACES", home: "BEAR" }]}
        logs={{}}
      />
    );

    expect(screen.getByText(/Moved 9\/20 → 9\/27/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Swap home and away/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Fill|^Add|^Apply/ }));

    expect(onApply).toHaveBeenCalledWith([], [], { add: ["s9"], swap: [], move: ["s9"] });
  });

  it("is no longer a move once a looser match for the same game is ticked to fill", async () => {
    const onApply = vi.fn();
    const looser: LeagueFillPlan = {
      ...rainedOut,
      rows: [
        {
          matchupId: "g1",
          date: "9/20",
          awayTeamId: "ACES",
          awayName: "Aces",
          homeTeamId: "BEAR",
          homeName: "Bears",
          awayRuns: 7,
          homeRuns: 3,
          action: "suggested",
          detail: "Bears Baseball Club on GameChanger.",
          scoutGameId: "s1",
        },
      ],
    };
    render(
      <LeagueScoreFillPanel
        plan={looser}
        seasonLabel="Fall"
        onApply={onApply}
        onClose={() => {}}
        schedule={[{ id: "g1", date: "9/20", away: "ACES", home: "BEAR" }]}
        logs={{}}
      />
    );

    expect(screen.getByText(/Moved 9\/20 → 9\/27/)).toBeInTheDocument();
    // Filled where it stands, the 9/20 game cannot also be moved to 9/27 and overwritten there.
    await userEvent.click(screen.getByRole("checkbox", { name: "Fill Aces at Bears" }));
    expect(screen.queryByText(/Moved 9\/20 → 9\/27/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Fill|^Add|^Apply/ }));

    expect(onApply).toHaveBeenCalledWith(["g1"], [], { add: ["s9"], swap: [] });
  });
});
