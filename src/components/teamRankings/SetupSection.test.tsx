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

    await user.click(screen.getByRole("button", { name: /download a backup/i }));

    expect(harness.requestConfirmation).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(harness.toasts().join(" ")).toMatch(/backup downloaded/i);
  });
});

describe("the age groups list", () => {
  it("shows what exists without offering to change it", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [
        ageGroup(9, 2027, { seasonIds: ["season-1"] }),
        ageGroup(11, 2027, { seasonIds: ["season-1"] }),
      ],
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

  /*
   * This used to assert the opposite: that a page with nothing on it said "No league season on
   * this page" rather than leaving the line blank. That was right when a pool held a handful of
   * pages and wrong the moment one held twenty-two, because twenty-one of them say it and the
   * sentence stops being information. The pages have not gone anywhere — nothing here creates or
   * manages them, and a season is attached through the card above — so what changed is only which
   * of them this card bothers to name.
   */
  it("leaves out a page with nothing on it, and counts it instead", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [ageGroup(9, 2027, { seasonIds: ["season-1"] }), ageGroup(11, 2027)],
      teams: [],
      games: [],
    });
    await openSetup(user);

    expect(screen.queryByText(/no league season on this page/i)).not.toBeInTheDocument();
    expect(screen.getByText("9U 2027")).toBeInTheDocument();
    expect(screen.queryByText("11U 2027")).not.toBeInTheDocument();
    expect(screen.getByText(/1 more with no league season/)).toBeInTheDocument();
  });

  it("explains where the pages come from when there are none", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: [], teams: [], games: [] });
    await openSetup(user);

    expect(screen.getByText(/the pages make themselves/i)).toBeInTheDocument();
  });
});

/*
 * A nationwide pull makes a page per age per squad year — twenty-two of them, with one league
 * season between the lot. The card listed every one, so it was twenty-one rows of "No league
 * season on this page" and a single row that mattered, which is the opposite of what a list is for.
 */
describe("the age groups card", () => {
  const poolOf = (ageGroups: ReturnType<typeof ageGroup>[]) => ({
    ageGroups,
    teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
    games: [
      game("g1", ageGroups[0]!.id, "S-A", "S-B", 5, 1, { date: seasonDate(ageGroups[0]!.year!) }),
    ],
  });

  it("lists only the pages it has something to say about", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      poolOf([
        ageGroup(9, 2027, { seasonIds: ["season-1"] }),
        ageGroup(10, 2027),
        ageGroup(11, 2027),
        ageGroup(12, 2027),
      ])
    );
    await openSetup(user);

    // The one with a season is named; the three with nothing are a count.
    expect(screen.queryByText(/No league season on this page/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/3 more with no league season and nothing carried forward/)
    ).toBeInTheDocument();
  });

  it("keeps a page that carries a squad forward, season or not", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      poolOf([
        ageGroup(10, 2027, { continuesFromId: "ag_9u_2026" }),
        ageGroup(9, 2026),
        ageGroup(11, 2027),
      ])
    );
    await openSetup(user);

    // "continues 9U 2026" is a thing somebody chose, and the only place it is written down.
    expect(screen.getByText(/continues 9U 2026/)).toBeInTheDocument();
    expect(screen.getByText(/2 more with no league season/)).toBeInTheDocument();
  });

  it("says so plainly when no page has anything on it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(poolOf([ageGroup(9, 2027), ageGroup(10, 2027)]));
    await openSetup(user);

    expect(screen.getByText(/2 pages, none with a league season on it/)).toBeInTheDocument();
    expect(screen.queryByText(/more with no league season/)).not.toBeInTheDocument();
  });
});
