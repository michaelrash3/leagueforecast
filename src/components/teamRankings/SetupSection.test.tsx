import { screen } from "@testing-library/react";
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

describe("the age groups list", () => {
  it("shows what exists without offering to change it", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [ageGroup(9, 2027), ageGroup(11, 2027)],
      teams: [],
      games: [],
    });
    await openSetup(user);

    // GameChanger owns them: a 9U schedule lands on the 9U page whether or not anybody made it.
    expect(screen.getByText("9U 2027")).toBeInTheDocument();
    expect(screen.getByText("11U 2027")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add an age group/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: /advance to new season/i })).toBeNull();
  });

  it("says a page has no league season on it rather than leaving it blank", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: [ageGroup(9, 2027)], teams: [], games: [] });
    await openSetup(user);

    expect(screen.getByText(/no league season on this page/i)).toBeInTheDocument();
  });

  it("explains where the pages come from when there are none", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: [], teams: [], games: [] });
    await openSetup(user);

    expect(screen.getByText(/the pages make themselves/i)).toBeInTheDocument();
  });
});
