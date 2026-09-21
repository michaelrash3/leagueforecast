import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";
import { RUN_CAPS_TO_TRY } from "../../lib/scoutBacktest";
import { RATING_CAP } from "../../lib/teamRankings";

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
};

/** A ladder of teams inside the 2027 squad year, connected enough for a fit to have an opinion. */
const ladder = (teamCount: number, rounds = 2) => {
  const teams = Array.from({ length: teamCount }, (_, index) =>
    team(`S-${index}`, `Team ${index}`)
  );
  const games = [];
  let day = 0;
  for (let round = 0; round < rounds; round += 1) {
    for (let a = 0; a < teamCount; a += 1) {
      for (let b = a + 1; b < teamCount; b += 1) {
        const date = new Date(Date.UTC(2026, 8, 1) + (day % 300) * 86_400_000)
          .toISOString()
          .slice(0, 10);
        games.push(
          game(`g${round}-${a}-${b}`, "ag_10u_2027", `S-${a}`, `S-${b}`, 6 + (b - a), 6, { date })
        );
        day += 1;
      }
    }
  }
  return { ageGroups: [ageGroup(10, 2027)], teams, games };
};

describe("checking the model on the real pool", () => {
  it("does not run until it is asked", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    // Refitting the pool several times over is not something opening Setup should pay for.
    expect(screen.getByRole("button", { name: "Check the model" })).toBeInTheDocument();
    expect(screen.queryByText(/games predicted/i)).toBeNull();
  });

  it("reports what it found once it is asked", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));

    expect(screen.getByText(/games predicted/i)).toBeInTheDocument();
    expect(screen.getByText(/winner called right/i)).toBeInTheDocument();
    // The ladder is a real ordering, so the ratings should beat calling every game even.
    expect(screen.getByText(/better than a coin/i)).toBeInTheDocument();
  });

  it("says so rather than inventing a number when there is nothing to hold back", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027)],
      teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
      games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: "2026-09-12" })],
    });
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));

    expect(screen.getByText(/not enough dated games/i)).toBeInTheDocument();
  });

  it("admits a pool with no cross-age games cannot say what a year of age is worth", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));

    expect(screen.getByText(/nothing in this pool crosses an age level/i)).toBeInTheDocument();
  });

  /**
   * The run cap is the least justified number in the model — eight, inherited from a League
   * Standings rule that does not apply here — so the card has to show its work: a row per
   * candidate, every one fitted at its own cap and scored against the same target.
   */
  it("shows what each run cap would have cost", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));

    const sweep = screen.getByRole("table", { name: "Run cap sweep" });
    expect(within(sweep).getAllByRole("row")).toHaveLength(RUN_CAPS_TO_TRY.length + 1);
    RUN_CAPS_TO_TRY.forEach((cap) => {
      expect(within(sweep).getByText(new RegExp(`^${cap} runs`))).toBeInTheDocument();
    });
    // Exactly one row is the number the app is actually using, and it says so.
    expect(within(sweep).getAllByText("in use")).toHaveLength(1);
    expect(
      within(sweep).getByRole("row", { name: new RegExp(`^${RATING_CAP} runs in use`) })
    ).toBeInTheDocument();
  });

  it("names the cap that predicted these games best", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));

    expect(screen.getByText(/predicted these games best/i)).toBeInTheDocument();
  });

  it("can be run again", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));
    expect(screen.getByRole("button", { name: "Run it again" })).toBeInTheDocument();
  });
});
