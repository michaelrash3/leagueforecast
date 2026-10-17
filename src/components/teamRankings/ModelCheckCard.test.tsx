import { act, render, screen, within } from "@testing-library/react";
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
        /Held at 125% of those values instead, the ratings predicted the 400 held-back games between two rated clubs better: 0\.012 runs a game lower, give or take 0\.004\./
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

  /** The re-measure as the owner's backup of 11 October 2026 gave it, asked the Monday after. */
  const remeasured: NonNullable<ModelCheckAnswer["closedLevels"]> = {
    held: -1.6,
    level: -1.7417,
    standardError: 0.1628,
    games: 79_981,
    clusters: 10_590,
    weeks: [
      { from: "2026-09-14", to: "2026-09-20", games: 19_710, level: -1.8923 },
      { from: "2026-09-21", to: "2026-09-27", games: 25_909, level: -1.6357 },
      { from: "2026-09-28", to: "2026-10-04", games: 27_834, level: -1.6999 },
      { from: "2026-10-05", to: "2026-10-11", games: 6_528, level: -1.7444 },
    ],
    paired: { by: -0.000102, standardError: 0.000133, samples: 79_981 },
    better: false,
  };

  it("says where a rating starts, and that the level held stands, in one line", async () => {
    await show(answer({ closedLevels: remeasured }));

    expect(
      screen.getByText(
        "Starting level for leagues with few outside games: held at −1.6; the four weeks to 11 Oct read −1.74 ± 0.16 on 79,981 games; not yet clearly better."
      )
    ).toBeInTheDocument();
  });

  it("says a change is ready when the level the weeks read is clearly better", async () => {
    await show(
      answer({
        closedLevels: {
          ...remeasured,
          level: -1.9234,
          paired: { by: 0.0012, standardError: 0.0004, samples: 79_981 },
          better: true,
        },
      })
    );

    expect(
      screen.getByText(
        /; clearly better, by 0\.0012 runs a game, give or take 0\.0004, so a change to −1\.92 is ready\.$/
      )
    ).toBeInTheDocument();
  });

  it("marks no club or league as closed", async () => {
    await show(answer({ closedLevels: remeasured }));

    const card = screen.getByRole("heading", {
      name: "Does the model predict anything?",
    }).parentElement!;
    expect(card).toHaveTextContent(/Where a rating starts/);
    expect(card.textContent).not.toMatch(/closed/i);
    pool.teams.forEach((club) => expect(card.textContent).not.toContain(club.name));
  });

  it("shows the last Monday's re-measure as it opens, before anything is run", async () => {
    let asked = 0;
    render(
      <ModelCheckCard
        ageGroupId={groupId}
        groupName="10U 2027"
        teams={pool.teams}
        games={pool.games}
        ageGroups={pool.ageGroups}
        check={() => Promise.resolve(answer({}))}
        lastWeekly={() => {
          asked += 1;
          return Promise.resolve({
            format: 1,
            measuredOn: "2026-10-12",
            measuredAt: "2026-10-12T04:40:00.000Z",
            year: 2027,
            check: remeasured,
          });
        }}
      />
    );

    expect(
      await screen.findByText(
        "Last weekly re-measure, 12 Oct. Starting level for leagues with few outside games: held at −1.6; the four weeks to 11 Oct read −1.74 ± 0.16 on 79,981 games; not yet clearly better."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check the model" })).toBeInTheDocument();
    expect(screen.queryByText(/games predicted/i)).toBeNull();
    expect(asked).toBe(1);
  });

  it("says nothing of a weekly re-measure where none was kept", async () => {
    let asked = 0;
    const none = Promise.resolve(null);
    render(
      <ModelCheckCard
        ageGroupId={groupId}
        groupName="10U 2027"
        teams={pool.teams}
        games={pool.games}
        ageGroups={pool.ageGroups}
        lastWeekly={() => {
          asked += 1;
          return none;
        }}
      />
    );
    // The reader's own answer, and the render it sets off, before looking: a single tick passed
    // before the card had drawn what it was handed, so a card showing a line anyway still passed.
    await act(async () => {
      await none;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(asked).toBe(1);
    expect(screen.queryByText(/Last weekly re-measure/)).toBeNull();
  });

  it("leaves the line out for a page with no table", async () => {
    await show(answer({ closedLevels: null }));

    expect(screen.queryByText(/Where a rating starts/)).toBeNull();
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
