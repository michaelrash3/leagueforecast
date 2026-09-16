import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
};

describe("the add-an-age-group form", () => {
  it("opens on an age level that actually ranks", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: [], teams: [], games: [] });
    await openSetup(user);

    // It used to default to 8U, which is not ranked: accepting the defaults built a page that
    // could never show a table, and nothing on the form said so.
    const age = screen.getByLabelText("Age") as HTMLSelectElement;
    expect(age.value).toBe("9");
    expect(screen.getByText("9U 2027")).toBeInTheDocument();
  });

  it("marks the levels that do not rank, so picking one is a choice", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: [], teams: [], games: [] });
    await openSetup(user);

    const age = screen.getByLabelText("Age");
    expect(within(age).getByRole("option", { name: "8U (not ranked)" })).toBeInTheDocument();
    expect(within(age).getByRole("option", { name: "9U" })).toBeInTheDocument();
  });

  it("refuses a second page for a squad year that already has one", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings({
      ageGroups: [ageGroup(9, 2027)],
      teams: [],
      games: [],
    });
    await openSetup(user);

    await user.selectOptions(screen.getByLabelText("Age"), "9");
    await user.selectOptions(screen.getByLabelText("Year"), "2027");
    await user.click(screen.getByRole("button", { name: "Create age group" }));

    // Two pages for one squad year would split its schedule in half and rank neither correctly.
    expect(harness.toasts()).toContain("9U 2027 already exists.");
    expect(screen.getAllByRole("button", { name: "9U" })).toHaveLength(1);
  });
});

describe("editing an age group saved before the season picker", () => {
  it("pre-selects the level its name says, rather than resetting it", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      // No ageLevel or year fields: this is what a group created by hand used to look like.
      ageGroups: [{ id: "ag_legacy", name: "2027, 11U", seasonIds: [] }],
      teams: [],
      games: [],
    });
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    // Opening the form on 9U 2027 and saving would silently relabel an 11U page, which is exactly
    // what happened before the name was read back.
    expect((screen.getByLabelText("Age") as HTMLSelectElement).value).toBe("11");
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe("2027");
  });

  it("keeps the level when the edit is saved unchanged", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [{ id: "ag_legacy", name: "2027, 11U", seasonIds: [] }],
      teams: [],
      games: [],
    });
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("button", { name: "11U" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "9U" })).toBeNull();
  });
});

describe("downloading a backup", () => {
  /** jsdom has no object URLs and no real downloads; this is enough for the click to complete. */
  const stubDownload = () => {
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:stub";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    return created;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("just downloads a pool one league's size", async () => {
    const user = userEvent.setup();
    const created = stubDownload();
    const harness = renderTeamRankings({
      ageGroups: [ageGroup(10, 2027)],
      teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
      games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) })],
    });
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: /download/i }));

    expect(harness.requestConfirmation).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(harness.toasts().join(" ")).toMatch(/backup downloaded/i);
  });
});
