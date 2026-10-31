import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScoutLinkPanel } from "./ScoutLinkPanel";
import type { LeagueScoutBridge, ScoutLinkCandidate, ScoutTeam } from "../lib/teamRankings";
import { clubPickOption } from "../lib/leagueLinkOptions";
import { LEAGUE_CANDIDATES_MAX } from "../lib/live/queries";
import { TEAM_SEARCH_LIMIT } from "./TeamSearchSelect";

/**
 * Two clubs of one name in one town, which is the ordinary case on a nationwide pool and the one
 * the picker used to be unable to show a difference between: the rows read "Cincy Stix Navy ·
 * Harrison, OH" twice over, and the only way to choose was to guess.
 */
const candidate = (
  scoutTeamId: string,
  ageLevel: number | undefined,
  sharedOpponents: string[] = []
): ScoutLinkCandidate => ({
  scoutTeamId,
  name: "Stix Navy",
  city: "Harrison",
  state: "OH",
  sharedOpponents,
  games: 4,
  ...(ageLevel === undefined ? {} : { ageLevel }),
});

const bridge: LeagueScoutBridge = {
  results: [],
  seasonLinked: true,
  rows: [{ leagueTeamId: "L-A", leagueTeamName: "Stix Navy", how: "none" }],
  linkedCount: 0,
  countedResults: 0,
};

const wideClub = (id: string, ageLevel: number): ScoutTeam & { ageLevel?: number } => ({
  id,
  name: "Stix Navy",
  city: "Harrison",
  state: "OH",
  ageLevel,
});

const renderPanel = (over: Partial<Parameters<typeof ScoutLinkPanel>[0]> = {}) =>
  render(
    <ScoutLinkPanel
      bridge={bridge}
      candidatesFor={() => [candidate("S-9", 9), candidate("S-10", 10)]}
      wideOptions={() => [wideClub("S-9", 9), wideClub("S-10", 10)].map(clubPickOption)}
      seasonLabel="Spring 2027"
      countingOn
      onPick={vi.fn()}
      {...over}
    />
  );

const optionsInPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("combobox"));
  return screen.getAllByRole("option");
};

describe("picking which club a league team is", () => {
  it("says it is drawn, and that it has gone, so the clubs are asked for while it is open", () => {
    const onShown = vi.fn();
    const { unmount } = renderPanel({ onShown });
    expect(onShown.mock.calls).toEqual([[true]]);
    unmount();
    expect(onShown.mock.calls).toEqual([[true], [false]]);
  });

  it("finds a club by its coach, and lists who coaches each one", async () => {
    // Invented names: the coach is often the one thing about a club in your own league you know.
    const user = userEvent.setup();
    renderPanel({
      candidatesFor: () => [
        { ...candidate("S-9", 9), coaches: ["Pat Placeholder"] },
        { ...candidate("S-10", 10), coaches: ["Sam Sample"] },
      ],
    });
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "sample");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("10U");
    expect(options[0]).toHaveTextContent("Coaches: Sam Sample");
  });

  it("finds a club by its coach in the wide search too", async () => {
    const user = userEvent.setup();
    renderPanel({
      wideOptions: () =>
        [
          wideClub("S-9", 9),
          {
            ...wideClub("S-10", 10),
            gcTeams: [
              { teamId: "gc10", name: "Stix Navy", ageGroupId: "ag10", staff: ["Sam Sample"] },
            ],
          },
        ].map(clubPickOption),
    });
    await user.click(screen.getByRole("checkbox", { name: /search every gamechanger club/i }));
    await user.click(screen.getByRole("combobox"));
    await user.type(screen.getByRole("combobox"), "sample");
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Coaches: Sam Sample");
  });

  it("puts the age on each row, so two clubs of one name in one town can be told apart", async () => {
    const user = userEvent.setup();
    renderPanel();

    const options = await optionsInPicker(user);
    const text = options.map((option) => option.textContent ?? "");
    expect(text.some((line) => line.includes("Harrison, OH") && line.includes("9U"))).toBe(true);
    expect(text.some((line) => line.includes("Harrison, OH") && line.includes("10U"))).toBe(true);
  });

  it("puts the age on the wide search's rows too", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: /search every gamechanger club/i }));
    const options = await optionsInPicker(user);
    expect(options.map((option) => option.textContent ?? "").join("|")).toContain("10U");
  });

  it("is sent by the server as many of a team's clubs as its picker draws at once", () => {
    // A member's device is sent each team's best clubs alone (`leagueCandidates`), so the list a
    // picker opens on is the one the device would have drawn from all of them.
    expect(LEAGUE_CANDIDATES_MAX).toBe(TEAM_SEARCH_LIMIT);
  });

  it("keeps the GameChanger id of the club picked beside the pick, from either list", async () => {
    // A club's id is the pool's own and can come to name another club; its GameChanger id is
    // never another team's, so the pick keeps one to follow the club by (`readPick`).
    const user = userEvent.setup();
    /** What picking the club of `age` hands on, off a panel drawn afresh. */
    const picked = async (age: string, wide = false) => {
      const onPick = vi.fn();
      const { unmount } = renderPanel({
        onPick,
        candidatesFor: () => [
          candidate("S-9", 9),
          { ...candidate("S-10", 10), gcIds: ["gc10fall", "gc10spring"] },
        ],
        wideOptions: () =>
          [
            wideClub("S-9", 9),
            {
              ...wideClub("S-10", 10),
              gcTeams: [{ teamId: "gc10wide", name: "Stix Navy", ageGroupId: "ag10" }],
            },
          ].map(clubPickOption),
      });
      if (wide) {
        await user.click(screen.getByRole("checkbox", { name: /search every gamechanger club/i }));
      }
      const options = await optionsInPicker(user);
      await user.click(
        within(options.find((option) => option.textContent?.includes(age))!).getByRole("button")
      );
      unmount();
      return onPick.mock.calls;
    };
    expect(await picked("10U")).toEqual([["L-A", "S-10", "gc10fall"]]);
    // A club GameChanger has no id for keeps none.
    expect(await picked("9U")).toEqual([["L-A", "S-9", undefined]]);
    // And off the wide list, as a member's phone has it from the server.
    expect(await picked("10U", true)).toEqual([["L-A", "S-10", "gc10wide"]]);
  });

  it("says a pick whose place another club has now has moved, and to pick again", () => {
    renderPanel({
      bridge: {
        ...bridge,
        rows: [
          {
            leagueTeamId: "L-A",
            leagueTeamName: "Stix Navy",
            how: "none",
            movedScoutTeamId: "S-9",
          },
        ],
      },
    });
    expect(screen.getByText("Moved")).toBeInTheDocument();
    expect(
      screen.getByText(/no one club carries the GameChanger team you picked/)
    ).toBeInTheDocument();
  });

  it("says what it is and is not offering, rather than leaving it to be inferred", () => {
    renderPanel();

    // The two rules, in the panel's own words: GameChanger knows it, and it is this age or below.
    expect(
      screen.getByText(/Only clubs GameChanger knows are offered, and only at this/)
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("checkbox", { name: /search every gamechanger club/i }).closest("label")!
      ).getByText(/at this age level/)
    ).toBeInTheDocument();
  });
});
