import { describe, expect, it } from "vitest";
import {
  AGE_GAP_PRIORS_TO_TRY,
  backtestScoutRatings,
  beatsTheBaseline,
  compareAgeGapPriors,
  compareRecencySchemes,
  describeDecayCurve,
} from "../scoutBacktest";
import { byGamesSince, noDecay, RECENCY_SCHEMES } from "../ratingRecency";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

const groups: AgeGroup[] = [
  { id: "ag_9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag_11", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
];

/** A day inside the 2027 squad year, which runs August 2026 to July 2027. */
const dayOf = (index: number): string => {
  const date = new Date(Date.UTC(2026, 8, 1) + index * 86_400_000);
  return date.toISOString().slice(0, 10);
};

/**
 * A pool with a truth behind it: every team has a real strength, and a game's margin is the
 * difference between the two plus whatever a year of age is worth, rounded to whole runs. If the
 * fit cannot recover a strength ordering it was handed, nothing built on it means anything.
 */
const syntheticPool = ({
  teamCount = 12,
  gamesPerPair = 1,
  ageGapRuns = 0,
  olderCount = 0,
}: {
  teamCount?: number;
  gamesPerPair?: number;
  ageGapRuns?: number;
  olderCount?: number;
} = {}): { teams: ScoutTeam[]; games: ScoutGame[]; strength: Map<string, number> } => {
  const teams: ScoutTeam[] = [];
  const strength = new Map<string, number>();
  for (let index = 0; index < teamCount; index += 1) {
    const id = `S-${index}`;
    teams.push({ id, name: `Team ${index}` });
    // Evenly spread from −4 to +4 runs against an average side.
    strength.set(id, ((index - (teamCount - 1) / 2) / ((teamCount - 1) / 2)) * 4);
  }
  // The last `olderCount` teams play a level up, which is what makes a game cross-age.
  const levelOf = (index: number) => (index >= teamCount - olderCount ? 11 : 9);

  const games: ScoutGame[] = [];
  let day = 0;
  for (let round = 0; round < gamesPerPair; round += 1) {
    for (let a = 0; a < teamCount; a += 1) {
      for (let b = a + 1; b < teamCount; b += 1) {
        const gap = levelOf(a) - levelOf(b);
        const margin = Math.round(
          (strength.get(`S-${a}`) ?? 0) - (strength.get(`S-${b}`) ?? 0) + gap * ageGapRuns
        );
        // Scores that produce exactly that margin; the model only ever reads the difference.
        const base = 6;
        games.push({
          id: `g-${round}-${a}-${b}`,
          // Filed on the younger side's page, which is where a cross-age game is logged.
          ageGroupId: levelOf(a) === 11 && levelOf(b) === 11 ? "ag_11" : "ag_9",
          teamAId: `S-${a}`,
          teamBId: `S-${b}`,
          teamAScore: Math.max(0, base + margin),
          teamBScore: base,
          date: dayOf(day % 300),
          ...(levelOf(a) === levelOf(b) ? {} : { ageLevelA: levelOf(a), ageLevelB: levelOf(b) }),
        });
        day += 1;
      }
    }
  }
  return { teams, games, strength };
};

describe("holding games back and predicting them", () => {
  it("beats calling every game even", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const result = backtestScoutRatings("ag_9", teams, games, groups);

    // Twelve teams twice round is 132 games; thirty per cent of them are held back.
    expect(result.sampleSize).toBe(40);
    // The least a rating has to do to be worth having one.
    expect(beatsTheBaseline(result)).toBe(true);
  });

  it("calls the winner far more often than a coin would", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const result = backtestScoutRatings("ag_9", teams, games, groups);

    expect(result.winnerAccuracy).not.toBeNull();
    expect(result.winnerAccuracy ?? 0).toBeGreaterThan(0.8);
  });

  it("scores only the games it did not see", () => {
    const { teams, games } = syntheticPool({ teamCount: 8 });
    const result = backtestScoutRatings("ag_9", teams, games, groups, { trainShare: 0.5 });

    // Twenty-eight pairings, cut in half.
    expect(result.sampleSize).toBe(14);
  });

  it("has nothing to say about a pool too small to cut", () => {
    const { teams, games } = syntheticPool({ teamCount: 2 });
    const result = backtestScoutRatings("ag_9", teams, games, groups);

    expect(result.sampleSize).toBe(0);
    expect(result.meanAbsoluteError).toBeNull();
    expect(result.winnerAccuracy).toBeNull();
  });

  it("leaves out a game with no date rather than guessing where it goes", () => {
    const { teams, games } = syntheticPool({ teamCount: 8 });
    const undated = games.map((game, index) => (index % 2 === 0 ? { ...game, date: "" } : game));
    const result = backtestScoutRatings("ag_9", teams, undated, groups, { trainShare: 0.5 });

    // Half the games have nowhere on the timeline, so half of what was there is scored.
    expect(result.sampleSize).toBe(7);
  });

  it("never fits on a game it is about to predict", () => {
    const { teams, games } = syntheticPool({ teamCount: 10 });
    const full = backtestScoutRatings("ag_9", teams, games, groups, { trainShare: 0.95 });
    const half = backtestScoutRatings("ag_9", teams, games, groups, { trainShare: 0.5 });

    // More training data cannot make held-out prediction worse on a pool with a real signal; if it
    // did, the fit would be seeing what it is scored on.
    expect(full.meanAbsoluteError ?? 9).toBeLessThanOrEqual((half.meanAbsoluteError ?? 0) + 0.5);
  });
});

describe("what a year of age is actually worth", () => {
  it("recovers a gap the data was built with", () => {
    // Built so that the older side wins by three runs a year, not the two the model assumes.
    const { teams, games } = syntheticPool({
      teamCount: 14,
      gamesPerPair: 2,
      ageGapRuns: 3,
      olderCount: 5,
    });
    const result = backtestScoutRatings("ag_9", teams, games, groups);

    expect(result.crossAgeSamples).toBeGreaterThan(0);
    // The prior is pulled toward the truth by the data rather than held at 2.
    expect(result.fittedAgeGapRuns).toBeGreaterThan(2.3);
  });

  it("says nothing new when a pool has no cross-age games at all", () => {
    const { teams, games } = syntheticPool({ teamCount: 10, olderCount: 0 });
    const results = compareAgeGapPriors("ag_9", teams, games, groups);

    // Every prior gives the same answer, which is the honest one: this pool cannot tell you.
    const errors = new Set(results.map((result) => result.meanAbsoluteError?.toFixed(6)));
    expect(results).toHaveLength(AGE_GAP_PRIORS_TO_TRY.length);
    expect(errors.size).toBe(1);
    expect(results.every((result) => result.crossAgeSamples === 0)).toBe(true);
  });

  it("puts the prior closest to the truth first", () => {
    const { teams, games } = syntheticPool({
      teamCount: 14,
      gamesPerPair: 2,
      ageGapRuns: 4,
      olderCount: 5,
    });
    const [best] = compareAgeGapPriors("ag_9", teams, games, groups);

    // Sorted by held-out error, so the winner is the starting point the data actually supports.
    expect(best?.ageGapPrior).toBeGreaterThanOrEqual(3);
  });

  it("reports the prior each run started from", () => {
    const { teams, games } = syntheticPool({ teamCount: 10, olderCount: 3, ageGapRuns: 2 });
    const results = compareAgeGapPriors("ag_9", teams, games, groups, [0, 2]);

    expect(results.map((result) => result.ageGapPrior).sort()).toEqual([0, 2]);
  });
});

describe("reading the result", () => {
  it("cannot say whether an empty pool beat anything", () => {
    const { teams, games } = syntheticPool({ teamCount: 2 });
    expect(beatsTheBaseline(backtestScoutRatings("ag_9", teams, games, groups))).toBeNull();
  });
});

/**
 * A pool shaped like a real youth season, with a truth that moves.
 *
 * A fall block, a winter with no games in it, and a spring block — and between the two the teams
 * are not who they were: the ordering reverses, which is the extreme form of the thing recency
 * weighting exists to notice. A fit that reads both blocks as equally current is being told two
 * contradictory stories and averages them into nothing.
 */
const driftingPool = ({
  teamCount = 10,
  rounds = 2,
}: { teamCount?: number; rounds?: number } = {}): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  const teams: ScoutTeam[] = [];
  for (let index = 0; index < teamCount; index += 1) {
    teams.push({ id: `S-${index}`, name: `Team ${index}` });
  }
  const spread = (index: number) => ((index - (teamCount - 1) / 2) / ((teamCount - 1) / 2)) * 4;
  /** Fall: team 0 is the best. Spring: team 0 is the worst, and everyone else mirrors. */
  const strengthAt = (index: number, block: "fall" | "spring") =>
    block === "fall" ? spread(index) : -spread(index);

  const games: ScoutGame[] = [];
  let sequence = 0;
  (["fall", "spring"] as const).forEach((block, blockAt) => {
    for (let round = 0; round < rounds; round += 1) {
      for (let a = 0; a < teamCount; a += 1) {
        for (let b = a + 1; b < teamCount; b += 1) {
          const margin = Math.round(strengthAt(a, block) - strengthAt(b, block));
          // Fall runs from day 0; spring starts on day 210, so the winter is a real four months.
          const day = (blockAt === 0 ? 0 : 210) + Math.floor(sequence % 60);
          games.push({
            id: `d-${block}-${round}-${a}-${b}`,
            ageGroupId: "ag_9",
            teamAId: `S-${a}`,
            teamBId: `S-${b}`,
            teamAScore: Math.max(0, 6 + margin),
            teamBScore: 6,
            date: dayOf(day),
          });
          sequence += 1;
        }
      }
    }
  });
  return { teams, games };
};

describe("how fast the ratings go off", () => {
  it("groups the held-out games by how long after the fit they were played", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const result = backtestScoutRatings("ag_9", teams, games, groups);

    expect(result.buckets.length).toBeGreaterThan(0);
    // Every held-out game lands in exactly one bucket.
    const counted = result.buckets.reduce((sum, bucket) => sum + bucket.sampleSize, 0);
    expect(counted).toBe(result.sampleSize);
    // And they run in order, oldest cut first.
    result.buckets.forEach((bucket, at) => {
      if (at > 0) expect(bucket.fromDays).toBeGreaterThanOrEqual(result.buckets[at - 1]!.toDays);
    });
  });

  it("reads the curve as a line per bucket", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const lines = describeDecayCurve(backtestScoutRatings("ag_9", teams, games, groups));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/days later: \d+ games, [\d.]+ runs off/);
  });

  /*
   * A chronological hold-out flatters a recency-weighted model for free: the games being predicted
   * are always the newest, so leaning on recent games moves the fit toward the target by
   * construction. A gap makes the test games genuinely later rather than merely last.
   */
  it("leaves a gap between the last game fitted on and the first one scored", () => {
    const { teams, games } = driftingPool();
    const tight = backtestScoutRatings("ag_9", teams, games, groups);
    const gapped = backtestScoutRatings("ag_9", teams, games, groups, { gapDays: 20 });
    expect(gapped.sampleSize).toBeLessThan(tight.sampleSize);
    gapped.buckets.forEach((bucket) => expect(bucket.toDays).toBeGreaterThan(20));
  });

  it("never scores a game the fit saw the same day", () => {
    // A doubleheader split across the cut is not a prediction; it is the fit reading its own notes.
    const { teams, games } = syntheticPool({ teamCount: 8, gamesPerPair: 3 });
    const result = backtestScoutRatings("ag_9", teams, games, groups);
    expect(result.buckets.every((bucket) => bucket.fromDays >= 0)).toBe(true);
    expect(result.sampleSize).toBeGreaterThan(0);
  });
});

describe("comparing weighting schemes", () => {
  it("beats counting every game the same, when the teams have actually changed", () => {
    /*
     * The whole case for recency, as a test. The fit has seen a fall in which team 0 was the best
     * and a spring in which it is the worst; reading both as current averages them into nothing,
     * and the hold-out is spring.
     */
    const { teams, games } = driftingPool();
    const flat = backtestScoutRatings("ag_9", teams, games, groups, { recency: noDecay });
    const recent = backtestScoutRatings("ag_9", teams, games, groups, {
      recency: byGamesSince(10),
    });

    expect(recent.meanAbsoluteError!).toBeLessThan(flat.meanAbsoluteError!);
    expect(recent.winnerAccuracy!).toBeGreaterThan(flat.winnerAccuracy!);
  });

  it("ranks the schemes best first, with the control among them", () => {
    const { teams, games } = driftingPool();
    const ranked = compareRecencySchemes("ag_9", teams, games, groups);

    expect(ranked.length).toBe(RECENCY_SCHEMES.length);
    expect(ranked.map((result) => result.recencyKey)).toContain("none");
    ranked.forEach((result, at) => {
      if (at > 0) {
        expect(result.meanAbsoluteError ?? Infinity).toBeGreaterThanOrEqual(
          ranked[at - 1]!.meanAbsoluteError ?? Infinity
        );
      }
    });
    // On a pool whose teams reversed, a scheme that forgets the old block has to win.
    expect(ranked[0]!.recencyKey).not.toBe("none");
  });

  /*
   * The negative control, and the one that keeps this honest. On a pool where nothing changed,
   * forgetting the early games throws away evidence for no gain — so the control should not lose.
   *
   * Sixteen teams rather than twelve, and checked at several cuts, because at twelve it does not
   * measure anything. A round-robin cut part-way through a round leaves a lopsided tail, whichever
   * teams happened to play last carry it, and weighting by recency amplifies exactly that; the gap
   * between the two is then a couple of hundredths of a run and its *sign* flips with where the cut
   * falls. It used to be asserted at twelve teams and a single cut, and passed on the coin landing
   * the right way up. A wider pool puts the effect above that floor: there the control wins at
   * every cut, by a tenth of a run rather than a hundredth.
   */
  it("does not beat counting every game the same when nothing has changed", () => {
    const { teams, games } = syntheticPool({ teamCount: 16, gamesPerPair: 3 });
    [0.5, 0.6, 2 / 3, 0.7, 0.8].forEach((trainShare) => {
      const flat = backtestScoutRatings("ag_9", teams, games, groups, {
        recency: noDecay,
        trainShare,
      });
      const recent = backtestScoutRatings("ag_9", teams, games, groups, {
        recency: byGamesSince(5),
        trainShare,
      });
      expect(flat.meanAbsoluteError!).toBeLessThanOrEqual(recent.meanAbsoluteError!);
    });
  });
});

/*
 * A squad year runs August to July, so half of it falls in one calendar year and half in the next.
 * Ordering those games by month and day alone puts March ahead of the September it followed, and
 * every number downstream — which games are fitted on, which are scored, how old a game is, which
 * decay bucket it lands in — is then measured along a timeline that runs backwards through the
 * winter. It went unnoticed for a while because a noiseless round-robin still scores well when you
 * fit it upside down.
 */
describe("a squad year that crosses New Year", () => {
  /** Eight teams, a round in the fall of 2026 and another in the spring of 2027. */
  const acrossTheWinter = (): { teams: ScoutTeam[]; games: ScoutGame[] } => {
    const teams: ScoutTeam[] = Array.from({ length: 8 }, (_, index) => ({
      id: `W-${index}`,
      name: `Team ${index}`,
    }));
    const strength = (index: number) => ((index - 3.5) / 3.5) * 4;
    const games: ScoutGame[] = [];
    const blocks: Array<[number, number, number]> = [
      // [year, month index, day] — the Saturday each round-robin starts on.
      [2026, 8, 5],
      [2027, 2, 6],
    ];
    blocks.forEach(([year, month, day], block) => {
      let played = 0;
      for (let a = 0; a < teams.length; a += 1) {
        for (let b = a + 1; b < teams.length; b += 1) {
          const margin = Math.round(strength(a) - strength(b));
          // Four games a weekend, so twenty-eight of them fit in a seven-week block.
          const week = Math.floor(played / 4);
          const date = new Date(Date.UTC(year, month, day) + week * 7 * 86_400_000);
          games.push({
            id: `w${block}-${a}-${b}`,
            teamAId: `W-${a}`,
            teamBId: `W-${b}`,
            teamAScore: 5 + Math.max(margin, 0),
            teamBScore: 5 + Math.max(-margin, 0),
            ageGroupId: "ag_9",
            date: date.toISOString().slice(0, 10),
          });
          played += 1;
        }
      }
    });
    return { teams, games };
  };

  it("fits on the earlier games and scores the later ones", () => {
    const { teams, games } = acrossTheWinter();
    const result = backtestScoutRatings("ag_9", teams, games, groups);
    expect(result.span).not.toBeNull();
    const { trainFrom, trainTo, testFrom, testTo } = result.span!;
    // The whole method is this one inequality. Dates compare lexically in ISO.
    expect(trainTo < testFrom).toBe(true);
    expect(trainFrom <= trainTo).toBe(true);
    expect(testFrom <= testTo).toBe(true);
    // And it really does span the winter, or the assertion above proves nothing.
    expect(trainFrom.slice(0, 4)).toBe("2026");
    expect(testTo.slice(0, 4)).toBe("2027");
  });

  it("counts a spring game as later than a fall one, not earlier", () => {
    const { teams, games } = acrossTheWinter();
    const result = backtestScoutRatings("ag_9", teams, games, groups, { trainShare: 0.5 });
    // Half the games are the fall round, so a cut at half must land at the turn of the blocks.
    expect(result.span!.trainTo.slice(0, 4)).toBe("2026");
    expect(result.span!.testFrom.slice(0, 4)).toBe("2027");
    /*
     * The spring is more than four months after the fall ends, so it belongs in the last bucket —
     * the one that says what a fall season is worth in the spring. Under the old ordering this
     * bucket held games played before the training data.
     */
    const last = result.buckets[result.buckets.length - 1]!;
    expect(last.fromDays).toBe(120);
    expect(last.sampleSize).toBeGreaterThan(0);
  });
});

describe("what the cut keeps and what the fit is allowed to know", () => {
  /** Four games a day, so a row-index cut lands mid-day about as often as not. */
  const crowdedDays = (): { teams: ScoutTeam[]; games: ScoutGame[] } => {
    const teams: ScoutTeam[] = Array.from({ length: 8 }, (_, index) => ({
      id: `C-${index}`,
      name: `Team ${index}`,
    }));
    const games: ScoutGame[] = [];
    let played = 0;
    for (let a = 0; a < 8; a += 1) {
      for (let b = a + 1; b < 8; b += 1) {
        const date = new Date(Date.UTC(2026, 8, 5) + Math.floor(played / 4) * 7 * 86_400_000);
        games.push({
          id: `c-${a}-${b}`,
          teamAId: `C-${a}`,
          teamBId: `C-${b}`,
          teamAScore: 6 + Math.max(b - a - 3, 0),
          teamBScore: 6,
          ageGroupId: "ag_9",
          date: date.toISOString().slice(0, 10),
        });
        played += 1;
      }
    }
    return { teams, games };
  };

  /*
   * A game on the boundary day used to land in neither half: past the training slice's row index,
   * but not after the cut *day*, so the test filter dropped it too. Only the test set was counted,
   * so the loss was invisible.
   */
  it("keeps every game, whatever row the cut index lands on", () => {
    const { teams, games } = crowdedDays();
    // Every share from a tenth to nine tenths — most of them land mid-day.
    for (let step = 1; step <= 9; step += 1) {
      const result = backtestScoutRatings("ag_9", teams, games, groups, { trainShare: step / 10 });
      if (result.sampleSize === 0) continue;
      expect(result.trainSize + result.sampleSize).toBe(games.length);
    }
  });

  it("puts the whole of the boundary day on the training side", () => {
    const { teams, games } = crowdedDays();
    const result = backtestScoutRatings("ag_9", teams, games, groups, { trainShare: 0.55 });
    // Nothing scored may share a day with anything fitted on, or it is not a prediction.
    expect(result.span!.trainTo < result.span!.testFrom).toBe(true);
  });

  /*
   * A team that turns up only after the cut cannot be rated. It used to be rated zero, which is a
   * confident claim that it is exactly average — and the same margin the baseline predicts, so the
   * row cancelled out of the lift while still counting in the mean.
   */
  it("says how many held-out games involve a team it never saw", () => {
    const { teams, games } = crowdedDays();
    const debut: ScoutGame = {
      id: "c-debut",
      teamAId: "C-0",
      teamBId: "C-new",
      teamAScore: 11,
      teamBScore: 1,
      ageGroupId: "ag_9",
      date: "2026-12-05",
    };
    const withDebut = {
      teams: [...teams, { id: "C-new", name: "Newcomer" }],
      games: [...games, debut],
    };
    const result = backtestScoutRatings("ag_9", withDebut.teams, withDebut.games, groups, {
      trainShare: 0.9,
    });
    expect(result.unratedSides).toBe(1);

    // And without the newcomer, nothing is unrated.
    const plain = backtestScoutRatings("ag_9", teams, games, groups, { trainShare: 0.9 });
    expect(plain.unratedSides).toBe(0);
  });

  /*
   * The shrinkage tell. Decay pulls a thinly-weighted team's rating toward zero, and a rating of
   * zero predicts an even game — the baseline's own answer. A scheme can therefore lower its error
   * by predicting less rather than by knowing more, and the size of its predictions is what says
   * which of the two happened.
   */
  it("reports how big its predictions were, so shrinking is not mistaken for learning", () => {
    const { teams, games } = syntheticPool({ teamCount: 16, gamesPerPair: 3 });
    const flat = backtestScoutRatings("ag_9", teams, games, groups, { recency: noDecay });
    const steep = backtestScoutRatings("ag_9", teams, games, groups, {
      recency: byGamesSince(5),
    });
    expect(flat.meanAbsolutePrediction).not.toBeNull();
    // Measured: forgetting hard costs the fit evidence, and its predictions shrink for it.
    expect(steep.meanAbsolutePrediction!).toBeLessThan(flat.meanAbsolutePrediction!);
  });
});
