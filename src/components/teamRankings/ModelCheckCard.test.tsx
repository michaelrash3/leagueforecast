import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ModelCheckCard } from "./ModelCheckCard";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";
import { checkTheModel, RUN_CAPS_TO_TRY, type ModelCheckAnswer } from "../../lib/scoutBacktest";
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
   * The run cap was for a long time the least justified number in the model — eight, inherited
   * from a League Standings rule that does not apply here — and the sweep is what moved it, so the
   * card has to show its work: a row per candidate, every one fitted at its own cap and scored
   * against the same target.
   */
  it("shows what each run cap would have cost", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));

    const sweep = screen.getByRole("table", { name: "Run cap sweep" });
    expect(within(sweep).getAllByRole("row")).toHaveLength(RUN_CAPS_TO_TRY.length + 1);
    RUN_CAPS_TO_TRY.filter(Number.isFinite).forEach((cap) => {
      expect(within(sweep).getByText(new RegExp(`^${cap} runs`))).toBeInTheDocument();
    });
    // Exactly one row is the number the app is actually using, and it says so.
    expect(within(sweep).getAllByText("in use")).toHaveLength(1);
    // The open end is a sentence, not Infinity printed at somebody.
    expect(within(sweep).getByText("No cap")).toBeInTheDocument();
    expect(within(sweep).queryByText(/Infinity/)).toBeNull();
    expect(
      within(sweep).getByRole("row", { name: new RegExp(`^${RATING_CAP} runs in use`) })
    ).toBeInTheDocument();
  });

  it("names no cap on too few held-back games to tell the caps apart", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));

    expect(screen.getByText(/too few to tell the caps apart/i)).toBeInTheDocument();
    expect(screen.queryByText(/predicted these games better/i)).toBeNull();
  });

  it("can be run again", async () => {
    const user = userEvent.setup();
    renderTeamRankings(ladder(8));
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: "Check the model" }));
    expect(screen.getByRole("button", { name: "Run it again" })).toBeInTheDocument();
  });
});

/*
 * What the card names. A setting other than the one in use is named only when the check found it
 * clearly better, game by game (`betterGap`, `betterCap`), with how much and how sure; otherwise
 * the card says the one in use stands, and why.
 */
describe("naming a better setting", () => {
  const pool = ladder(8);
  const groupId = pool.ageGroups[0]!.id;
  const plain = checkTheModel(groupId, pool.teams, pool.games, pool.ageGroups);
  /** The ladder's answer with cross-age games and enough held back to compare on. */
  const answer = (changes: Partial<ModelCheckAnswer>, ratedSamples = 400): ModelCheckAnswer => ({
    ...plain,
    result: { ...plain.result, crossAgeSamples: 12, ratedSamples },
    caps: plain.caps.map((row) => ({ ...row, sampleSize: 400 })),
    ...changes,
  });
  const show = async (shown: ModelCheckAnswer) => {
    const user = userEvent.setup();
    render(
      <ModelCheckCard
        ageGroupId={groupId}
        groupName="10U 2027"
        teams={pool.teams}
        games={pool.games}
        ageGroups={pool.ageGroups}
        check={() => Promise.resolve(shown)}
      />
    );
    await user.click(screen.getByRole("button", { name: "Check the model" }));
    await screen.findByText(/games predicted/i);
  };

  it("names a held age gap that clearly did better, and by how much", async () => {
    await show(
      answer({ betterGap: { value: 2.5, by: 0.012, standardError: 0.004, samples: 400 } })
    );

    expect(
      screen.getByText(
        /Held at 2\.5 instead, the ratings predicted the 400 held-back games between two rated clubs better: 0\.012 runs a game lower, give or take 0\.004\./
      )
    ).toBeInTheDocument();
  });

  it("says no held value did better beyond chance when none did", async () => {
    await show(answer({ betterGap: null }));

    expect(
      screen.getByText(
        /No other value held predicted the 400 held-back games .* by more than chance/
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/instead/)).toBeNull();
  });

  it("says too few games were between rated clubs to tell", async () => {
    await show(answer({ betterGap: null }, 12));

    expect(
      screen.getByText(/Only 12 held-back games were between two rated clubs, too few/)
    ).toBeInTheDocument();
  });

  it("names a cap that clearly did better, and marks its row", async () => {
    await show(
      answer({ betterCap: { value: Infinity, by: 0.02, standardError: 0.005, samples: 400 } })
    );

    expect(
      screen.getByText(
        new RegExp(
          `^Leaving margins uncapped predicted these games better than the ${RATING_CAP} in use .* 0\\.020 runs a game lower, give or take 0\\.005\\.$`
        )
      )
    ).toBeInTheDocument();
    const sweep = screen.getByRole("table", { name: "Run cap sweep" });
    const bold = within(sweep)
      .getAllByRole("cell")
      .filter((cell) => cell.className.includes("font-bold"));
    expect(bold).toHaveLength(1);
    expect(bold[0]!.closest("tr")).toHaveTextContent(/^No cap/);
  });

  it("keeps the cap in use when no other did better beyond chance", async () => {
    await show(answer({ betterCap: null }));

    expect(
      screen.getByText(
        `No other cap predicted these games better than the ${RATING_CAP} in use by more than chance, so it stands.`
      )
    ).toBeInTheDocument();
    const sweep = screen.getByRole("table", { name: "Run cap sweep" });
    const bold = within(sweep)
      .getAllByRole("cell")
      .filter((cell) => cell.className.includes("font-bold"));
    expect(bold).toHaveLength(1);
    expect(bold[0]!.closest("tr")).toHaveTextContent(new RegExp(`^${RATING_CAP} runs`));
  });
});
