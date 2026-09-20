import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScoutLinkPanel } from "./ScoutLinkPanel";
import type { LeagueScoutBridge, ScoutLinkCandidate, ScoutTeam } from "../lib/teamRankings";

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
      allClubs={() => [wideClub("S-9", 9), wideClub("S-10", 10)]}
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
