import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import { clubLookupOf } from "../../lib/teamRankings/leagueBridge";
import { readSavedFields, saveField } from "../../lib/tournamentFields";
import { TournamentPanel } from "./TournamentPanel";

/*
 * Another tab folds a club while this one stays on Scouting: this tab's roster is read again
 * (`onPoolChangedElsewhere`), and the panel is handed a new lookup. The saved fields were read by
 * the lookup of the panel's first render alone, so a field opened after the fold named the folded
 * club by an id no club has now and played the weekend without it, and a field already open did
 * the same (Codex on #510). Placeholder names.
 */
type Club = { id: string; name: string; gc: string[] };
const ACES: Club = { id: "S-ACE", name: "Aces", gc: ["gcACE"] };
const BEARS: Club = { id: "S-BEA", name: "Bears", gc: ["gcBEA"] };
const CUBS: Club = { id: "S-CUB", name: "Cubs", gc: ["gcCUB"] };
const BEFORE = [ACES, BEARS, CUBS];
// The Bears folded into the Cubs, who carry the Bears' GameChanger team on (`mergeScoutTeams`).
const FOLDED = [ACES, { ...CUBS, gc: ["gcCUB", "gcBEA"] }];

const PAGE = "ag_10u_2027";

const props = (roster: Club[]) => {
  const teams = roster.map((club) => ({
    id: club.id,
    gcTeams: club.gc.map((teamId) => ({ teamId })),
  }));
  return {
    ageGroupId: PAGE,
    rankings: roster.map(
      (club, at) =>
        ({
          teamId: club.id,
          teamName: club.name,
          record: "1-1",
          rating: 2 - at,
          rank: at + 1,
          componentId: "one",
        }) as ScoutRankingRow
    ),
    reportForId: "",
    upcomingRows: [],
    placeOf: () => undefined,
    clubs: {
      lookup: clubLookupOf(teams),
      gcOf: (teamId: string) => roster.find((club) => club.id === teamId)?.gc,
    },
  };
};

const fieldNames = () =>
  within(screen.getByRole("list", { name: "The field" }))
    .getAllByRole("listitem")
    .map((item) => item.firstChild?.textContent);

const oddsRows = () =>
  within(screen.getByRole("table", { name: "Tournament odds" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.firstChild?.textContent);

beforeEach(() => localStorage.clear());

describe("a tournament field when another tab folds one of its clubs", () => {
  it("opens a saved field with the club its club was folded into", async () => {
    saveField(PAGE, {
      name: "Fall Classic",
      teamIds: ["S-ACE", "S-BEA"],
      pools: 1,
      advance: 4,
      gc: [["gcACE"], ["gcBEA"]],
    });
    const user = userEvent.setup();
    const { rerender } = render(<TournamentPanel {...props(BEFORE)} />);
    rerender(<TournamentPanel {...props(FOLDED)} />);

    await user.selectOptions(screen.getByLabelText("Saved fields"), "Fall Classic");

    expect(fieldNames()).toEqual(["Aces", "Cubs"]);
    expect(oddsRows()).toEqual(["Aces", "Cubs"]);
    expect(screen.queryByText(/not ranked on this board/)).toBeNull();
  });

  it("follows an open field's club to the one it was folded into, keeping the rest", async () => {
    saveField(PAGE, {
      name: "Fall Classic",
      teamIds: ["S-ACE", "S-BEA"],
      pools: 1,
      advance: 4,
      gc: [["gcACE"], ["gcBEA"]],
    });
    const user = userEvent.setup();
    const { rerender } = render(<TournamentPanel {...props(BEFORE)} />);
    await user.selectOptions(screen.getByLabelText("Saved fields"), "Fall Classic");
    await user.selectOptions(screen.getByLabelText("Pools"), "2");
    await user.selectOptions(screen.getByLabelText("Bracket of"), "2");
    expect(fieldNames()).toEqual(["Aces", "Bears"]);

    rerender(<TournamentPanel {...props(FOLDED)} />);

    expect(fieldNames()).toEqual(["Aces", "Cubs"]);
    expect(oddsRows()).toEqual(["Aces", "Cubs"]);
    expect(screen.queryByText(/not ranked on this board/)).toBeNull();
    // The rest of the panel as it was: the fold moves a club, not the coach's work.
    expect(screen.getByPlaceholderText("Event name")).toHaveValue("Fall Classic");
    expect(screen.getByLabelText("Pools")).toHaveValue("2");
    expect(screen.getByLabelText("Bracket of")).toHaveValue("2");
    // Saved again, it is saved as the clubs it plays.
    await user.click(screen.getByRole("button", { name: "Save field" }));
    expect(readSavedFields(PAGE)).toEqual([
      {
        name: "Fall Classic",
        teamIds: ["S-ACE", "S-CUB"],
        pools: 2,
        advance: 2,
        gc: [["gcACE"], ["gcCUB", "gcBEA"]],
      },
    ]);
  });

  it("makes two clubs built by name one, once one is folded into the other", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<TournamentPanel {...props(BEFORE)} />);
    const box = screen.getByRole("combobox", { name: /add a club/i });
    for (const name of ["bears", "cubs"]) {
      await user.click(box);
      await user.type(box, name);
      await user.keyboard("{Enter}");
    }
    expect(fieldNames()).toEqual(["Bears", "Cubs"]);

    rerender(<TournamentPanel {...props(FOLDED)} />);

    expect(fieldNames()).toEqual(["Cubs"]);
  });

  /*
   * A club shown gone is one whose id named another club by the time the field was read. Read again
   * by a new lookup it is gone still, never the club under its old id, nor the one that id's own
   * club was folded into.
   */
  it("keeps a club shown gone gone", async () => {
    saveField(PAGE, {
      name: "Fall Classic",
      teamIds: ["S-ACE", "S-BEA"],
      pools: 1,
      advance: 4,
      // The Bears' id kept for a club it no longer names.
      gc: [["gcACE"], ["gcOldBears"]],
    });
    const user = userEvent.setup();
    const { rerender } = render(<TournamentPanel {...props(BEFORE)} />);
    await user.selectOptions(screen.getByLabelText("Saved fields"), "Fall Classic");
    expect(fieldNames()).toEqual(["Aces", "Not ranked here"]);

    rerender(<TournamentPanel {...props(FOLDED)} />);

    expect(fieldNames()).toEqual(["Aces", "Not ranked here"]);
    expect(screen.getByText(/1 club is not ranked on this board/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save field" }));
    expect(readSavedFields(PAGE)[0]?.gc).toEqual([["gcACE"], ["gcOldBears"]]);
  });
});
