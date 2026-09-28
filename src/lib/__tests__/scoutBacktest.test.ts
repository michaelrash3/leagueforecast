import { describe, expect, it } from "vitest";
import {
  AGE_GAPS_TO_TRY,
  backtestGames,
  backtestScoutRatings,
  beatsTheBaseline,
  checkTheModel,
  compareAgeGaps,
  compareRecencySchemes,
  compareRunCaps,
  describeDecayCurve,
  MODEL_CHECK_RUNS,
  modelCheckAnswer,
  pairedImprovement,
  clearlyBetterBar,
  RUN_CAPS_TO_TRY,
  type ScoutBacktestOptions,
  type ScoutBacktestResult,
} from "../scoutBacktest";
import { byGamesSince, noDecay, RECENCY_SCHEMES } from "../ratingRecency";
import { RATING_CAP } from "../teamRankings";
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
  it("holds a year of age at the rule of thumb, whatever the data was built with", () => {
    // Built so that the older side wins by three runs a year, not the two the model holds.
    const { teams, games } = syntheticPool({
      teamCount: 14,
      gamesPerPair: 2,
      ageGapRuns: 3,
      olderCount: 5,
    });
    const result = backtestScoutRatings("ag_9", teams, games, groups);

    expect(result.crossAgeSamples).toBeGreaterThan(0);
    expect(result.fittedAgeGapRuns).toBe(2);
    // What the data says is the comparison's to tell: held at three, the same games read better.
    const [best] = compareAgeGaps("ag_9", teams, games, groups);
    expect(best?.ageGapPrior).toBe(3);
  });

  it("says nothing new when a pool has no cross-age games at all", () => {
    const { teams, games } = syntheticPool({ teamCount: 10, olderCount: 0 });
    const results = compareAgeGaps("ag_9", teams, games, groups);

    // Every prior gives the same answer, which is the honest one: this pool cannot tell you.
    const errors = new Set(results.map((result) => result.meanAbsoluteError?.toFixed(6)));
    expect(results).toHaveLength(AGE_GAPS_TO_TRY.length);
    expect(errors.size).toBe(1);
    expect(results.every((result) => result.crossAgeSamples === 0)).toBe(true);
  });

  it("puts the held value closest to the truth first", () => {
    const { teams, games } = syntheticPool({
      teamCount: 14,
      gamesPerPair: 2,
      ageGapRuns: 4,
      olderCount: 5,
    });
    const [best] = compareAgeGaps("ag_9", teams, games, groups);

    // Sorted by held-out error, so the winner is the value the data actually supports.
    expect(best?.ageGapPrior).toBe(3);
  });

  it("judges a held year on the games between clubs the fit had seen", () => {
    // Built at two runs a year. Then eight newcomers, seen only after the cut, each play up and
    // hold every 11U to an even game: predicted by the gap alone, they argue for a year worth less.
    const { teams, games } = syntheticPool({
      teamCount: 12,
      gamesPerPair: 2,
      ageGapRuns: 2,
      olderCount: 4,
    });
    const newcomers: ScoutTeam[] = Array.from({ length: 8 }, (_, i) => ({
      id: `NEW-${i}`,
      name: `Newcomer ${i}`,
    }));
    const even: ScoutGame[] = newcomers.flatMap((team, i) =>
      [8, 9, 10, 11].map((older) => ({
        id: `n-${i}-${older}`,
        ageGroupId: "ag_9",
        teamAId: team.id,
        teamBId: `S-${older}`,
        teamAScore: 5,
        teamBScore: 5,
        date: dayOf(299),
        ageLevelA: 9,
        ageLevelB: 11,
      }))
    );
    const results = compareAgeGaps("ag_9", [...teams, ...newcomers], [...games, ...even], groups);
    const onEveryGame = [...results].sort(
      (a, b) => (a.meanAbsoluteError ?? 0) - (b.meanAbsoluteError ?? 0)
    );
    expect(onEveryGame[0]!.ageGapPrior).toBe(1);
    // Ranked on the games between two clubs rated before them, where the newcomers have no say.
    const rated = results.map((result) => result.ratedError!);
    expect(rated).toEqual([...rated].sort((a, b) => a - b));
    const [best] = results;
    expect(best!.ageGapPrior).toBeGreaterThanOrEqual(2);
    expect(best!.unratedSides).toBe(even.length);
    expect(best!.ratedSamples).toBe(best!.sampleSize - even.length);
  });

  it("reports the prior each run started from", () => {
    const { teams, games } = syntheticPool({ teamCount: 10, olderCount: 3, ageGapRuns: 2 });
    const results = compareAgeGaps("ag_9", teams, games, groups, [0, 2]);

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

/*
 * Two clubs that never share an opponent have never been compared, and an opponent-adjusted rating
 * is nothing but a comparison. The model will still print a difference between them: every game row
 * is +1 on one side and −1 on the other, so each row sums to zero across the teams, and with the
 * same ridge constant on every team that forces each connected piece to average exactly zero on its
 * own. Two pieces are then two scales that merely happen to share a centre.
 */
describe("teams the fit never joined up", () => {
  /** Two round-robins that share no team: a "fall" four and a "spring" four. */
  const twoIslands = (): { teams: ScoutTeam[]; games: ScoutGame[] } => {
    const teams: ScoutTeam[] = [];
    const games: ScoutGame[] = [];
    (["F", "S"] as const).forEach((island, block) => {
      for (let index = 0; index < 4; index += 1) {
        teams.push({ id: `${island}-${index}`, name: `${island} ${index}` });
      }
      let played = 0;
      for (let a = 0; a < 4; a += 1) {
        for (let b = a + 1; b < 4; b += 1) {
          const date = new Date(Date.UTC(2026, 8, 5) + (block * 24 + played) * 7 * 86_400_000);
          games.push({
            id: `${island}-${a}-${b}`,
            teamAId: `${island}-${a}`,
            teamBId: `${island}-${b}`,
            teamAScore: 6 + (b - a),
            teamBScore: 6,
            ageGroupId: "ag_9",
            date: date.toISOString().slice(0, 10),
          });
          played += 1;
        }
      }
    });
    return { teams, games };
  };

  it("counts the pieces the training games fall into", () => {
    const { teams, games } = twoIslands();
    // A cut past both round-robins: everything either side trained on, nothing joined.
    const result = backtestScoutRatings("ag_9", teams, games, groups, { trainShare: 0.9 });
    expect(result.trainComponents).toBe(2);
    expect(result.largestComponent).toBe(4);
  });

  it("is one piece when every team is reachable from every other", () => {
    const { teams, games } = syntheticPool({ teamCount: 8 });
    const result = backtestScoutRatings("ag_9", teams, games, groups);
    expect(result.trainComponents).toBe(1);
    expect(result.largestComponent).toBe(8);
  });

  it("flags a held-out game whose two sides were never compared", () => {
    const { teams, games } = twoIslands();
    const crossing: ScoutGame = {
      id: "crossing",
      teamAId: "F-0",
      teamBId: "S-3",
      teamAScore: 9,
      teamBScore: 2,
      ageGroupId: "ag_9",
      // After both blocks, so it is held out rather than joining them up.
      date: "2027-06-05",
    };
    const result = backtestScoutRatings("ag_9", teams, [...games, crossing], groups, {
      trainShare: 0.95,
      keepResiduals: true,
    });
    expect(result.splitSamples).toBe(1);
    expect(result.unratedSides).toBe(0);
    expect(result.residuals.find((row) => row.gameId === "crossing")!.connected).toBe(false);
  });
});

describe("keeping the held-out games one by one", () => {
  it("hands back a row per scored game, agreeing with the aggregate", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const result = backtestScoutRatings("ag_9", teams, games, groups, { keepResiduals: true });
    expect(result.residuals).toHaveLength(result.sampleSize);
    const mean = (values: number[]) => values.reduce((sum, x) => sum + x, 0) / values.length;
    expect(mean(result.residuals.map((row) => row.error))).toBeCloseTo(
      result.meanAbsoluteError!,
      9
    );
    expect(mean(result.residuals.map((row) => row.baseline))).toBeCloseTo(result.baselineError!, 9);
  });

  it("keeps nothing unless asked, so the card does not pay for the sweep", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    expect(backtestScoutRatings("ag_9", teams, games, groups).residuals).toEqual([]);
  });

  /** Every scheme faces the identical hold-out, which is what makes a paired comparison possible. */
  it("scores every scheme on the same games", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const ids = RECENCY_SCHEMES.map((recency) =>
      backtestScoutRatings("ag_9", teams, games, groups, { recency, keepResiduals: true })
        .residuals.map((row) => row.gameId)
        .join(",")
    );
    expect(new Set(ids).size).toBe(1);
  });
});

describe("what the run cap is costing", () => {
  /**
   * The guard that makes the whole sweep believable.
   *
   * `RATING_CAP` used to clamp both the fit and the held-out margin the fit is scored against, so
   * a smaller cap was a smaller error for nothing at all — the target moved under the model. The
   * even-game baseline is the clean probe for it: that model predicts zero whatever the fit does,
   * so its error is the mean of the clamped actual margins and nothing else. One baseline across
   * the sweep means one target across the sweep.
   */
  it("grades every cap against the same target", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const rows = compareRunCaps("ag_9", teams, games, groups);

    expect(rows).toHaveLength(RUN_CAPS_TO_TRY.length);
    expect(new Set(rows.map((row) => row.baselineError)).size).toBe(1);
  });

  it("puts the cap that predicted best first", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const errors = compareRunCaps("ag_9", teams, games, groups, [2, 4, 8]).map(
      (row) => row.meanAbsoluteError ?? Infinity
    );

    expect(errors).toEqual([...errors].sort((a, b) => a - b));
  });

  /**
   * A cap tighter than the margins in the pool is the model being told it may not believe how big
   * a win was, and the ratings come in accordingly: at two runs the fit predicts margins averaging
   * 0.95 runs where at twelve it predicts 2.31, against a truth that spans eight. That is the cap
   * doing what a cap does, and it is what a sweep is varying.
   */
  it("holds the ratings in when the cap is tighter than the games", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const tight = backtestScoutRatings("ag_9", teams, games, groups, { cap: 2 });
    const loose = backtestScoutRatings("ag_9", teams, games, groups, { cap: 12 });

    expect(tight.meanAbsolutePrediction!).toBeLessThan(loose.meanAbsolutePrediction!);
    // Both were scored against the same margins, so the error is comparable and the squeeze costs.
    expect(tight.baselineError).toBe(loose.baselineError);
    expect(tight.meanAbsoluteError!).toBeGreaterThan(loose.meanAbsoluteError!);
  });

  /**
   * Every fourth game becomes a rout, which is what a cap exists for and what the plain synthetic
   * pool has none of: its margins are the difference between two strengths spanning four runs, so
   * they never reach eight and no cap from eight up ever bites.
   */
  const withRouts = (
    pool: { teams: ScoutTeam[]; games: ScoutGame[] },
    runs: number
  ): { teams: ScoutTeam[]; games: ScoutGame[] } => ({
    teams: pool.teams,
    games: pool.games.map((game, at) =>
      at % 4 === 0 ? { ...game, teamAScore: runs, teamBScore: 0 } : game
    ),
  });

  /*
   * The sweep is there to check the cap in use against its neighbours, so it has to hold it — a list
   * without it leaves the card nothing to compare against and it would never name a better cap —
   * and a finite cap either side of it, as well as no cap at all.
   */
  it("tries the cap in use, a finite cap either side of it, and no cap", () => {
    expect(RUN_CAPS_TO_TRY).toContain(RATING_CAP);
    expect(RUN_CAPS_TO_TRY.some((cap) => cap < RATING_CAP)).toBe(true);
    expect(RUN_CAPS_TO_TRY.some((cap) => cap > RATING_CAP && Number.isFinite(cap))).toBe(true);
    expect(RUN_CAPS_TO_TRY).toContain(Infinity);
  });

  it("offers no cap at all, and lets that fit see the whole margin", () => {
    const { teams, games } = withRouts(syntheticPool({ teamCount: 12, gamesPerPair: 2 }), 20);
    const rows = compareRunCaps("ag_9", teams, games, groups);

    const open = rows.find((row) => row.cap === Infinity);
    const inUse = rows.find((row) => row.cap === RATING_CAP);
    expect(open).toBeDefined();
    // Not NaN, which is what an Infinity mishandled anywhere in the fit would produce.
    expect(Number.isFinite(open!.meanAbsoluteError!)).toBe(true);
    // Handed 20-run margins whole, it believes in bigger gaps than the row at the cap in use does.
    expect(open!.meanAbsolutePrediction!).toBeGreaterThan(inUse!.meanAbsolutePrediction!);
  });

  /**
   * Where the shared target sits, not just that it is shared. Clipping it at `RATING_CAP` marks a
   * wider candidate down for swinging where the target is flat, and on a pool whose margins really
   * do run past eight that inverts the answer — so the sweep grades on the margin as played.
   */
  it("grades on the margin as played rather than on a clipped one", () => {
    const { teams, games } = withRouts(syntheticPool({ teamCount: 12, gamesPerPair: 2 }), 20);
    const rows = compareRunCaps("ag_9", teams, games, groups);
    const clipped = backtestScoutRatings("ag_9", teams, games, groups, { scoreCap: RATING_CAP });

    expect(new Set(rows.map((row) => row.baselineError)).size).toBe(1);
    // The even-game baseline is the mean absolute target, so a looser target is a larger one.
    expect(rows[0]!.baselineError!).toBeGreaterThan(clipped.baselineError!);
  });

  /**
   * A clamp that never reaches is not a clamp, so these three have to agree to the digit: the plain
   * pool's margins never reach eight, so neither eight, the cap in use nor no cap bites.
   */
  it("says nothing new about a pool whose margins all fit inside the cap", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const errors = [8, RATING_CAP, Infinity].map(
      (cap) => backtestScoutRatings("ag_9", teams, games, groups, { cap }).meanAbsoluteError
    );

    expect(errors[0]).not.toBeNull();
    expect(errors[1]).toBe(errors[0]);
    expect(errors[2]).toBe(errors[0]);
  });

  it("fits at the cap the app ships with when nobody says otherwise", () => {
    const { teams, games } = syntheticPool({ teamCount: 12, gamesPerPair: 2 });
    const asShipped = backtestScoutRatings("ag_9", teams, games, groups);
    const spelledOut = backtestScoutRatings("ag_9", teams, games, groups, {
      cap: RATING_CAP,
      scoreCap: RATING_CAP,
    });

    expect(asShipped.cap).toBe(RATING_CAP);
    expect(asShipped.meanAbsoluteError).toBe(spelledOut.meanAbsoluteError);
    expect(asShipped.meanAbsolutePrediction).toBe(spelledOut.meanAbsolutePrediction);
  });
});

/*
 * Setup's model check, as one call and as the rankings worker asks for it: run by run, from one
 * ordering of the page's games. It must be exactly what the card showed when it called the three
 * sweeps itself, fit for fit, since the card's numbers are the same claim either way.
 */
describe("the model check in one pass", () => {
  const pool = syntheticPool({ teamCount: 14, gamesPerPair: 2, ageGapRuns: 1.5, olderCount: 4 });

  it("is exactly the plain run and the two sweeps", () => {
    const { result, gaps, caps } = checkTheModel("ag_9", pool.teams, pool.games, groups);
    expect({ result, gaps, caps }).toEqual({
      result: backtestScoutRatings("ag_9", pool.teams, pool.games, groups),
      gaps: compareAgeGaps("ag_9", pool.teams, pool.games, groups),
      caps: compareRunCaps("ag_9", pool.teams, pool.games, groups),
    });
    // The per-game errors the comparison needed stay behind: the card has no use for them.
    [result, ...gaps, ...caps].forEach((run) => {
      expect(run.errors).toBeUndefined();
      expect(run.ratedFlags).toBeUndefined();
    });
  });

  it("gives the same run from the games put in order once", () => {
    const ordered = backtestGames("ag_9", pool.teams, pool.games, groups);
    expect(ordered.length).toBeGreaterThan(0);
    [{}, { ageGapPrior: 0 }, { cap: 4, scoreCap: Infinity }].forEach((options) => {
      expect(
        backtestScoutRatings("ag_9", pool.teams, pool.games, groups, options, ordered)
      ).toEqual(backtestScoutRatings("ag_9", pool.teams, pool.games, groups, options));
    });
  });

  it("tries the default prior among the others, which is what makes it the plain run", () => {
    expect(AGE_GAPS_TO_TRY).toContain(
      checkTheModel("ag_9", pool.teams, pool.games, groups).result.ageGapPrior
    );
  });
});

/*
 * A better setting is named only when it wins clearly, game by game against the one in use. The
 * lowest average alone named a year of age held at 1.5 best on the 9U pool of 27 September 2026,
 * 0.0011 runs a game better than the 2 in use over 21,986 games between rated clubs, with a paired
 * standard error of 0.00095: the card was reading noise out as an answer.
 */
describe("naming a better setting only when it clearly wins", () => {
  it("names a held age gap that predicts the held-back games clearly better", () => {
    // Held at three, this pool's 55 games between rated clubs read 0.073 runs a game better
    // than at two, paired, with a standard error of 0.012.
    const { teams, games } = syntheticPool({
      teamCount: 14,
      gamesPerPair: 2,
      ageGapRuns: 3,
      olderCount: 5,
    });
    const answer = checkTheModel("ag_9", teams, games, groups);

    expect(answer.betterGap?.value).toBe(3);
    expect(answer.betterGap!.by).toBeGreaterThan(2 * answer.betterGap!.standardError);
    expect(answer.betterGap!.samples).toBe(answer.result.ratedSamples);
  });

  it("names none when the lowest average is within the noise", () => {
    // Held at three this pool reads 0.0015 runs a game better than at two on the averages, with
    // a paired standard error of 0.0057: the card used to name three best all the same.
    const { teams, games } = syntheticPool({
      teamCount: 16,
      gamesPerPair: 3,
      ageGapRuns: 3,
      olderCount: 6,
    });
    const answer = checkTheModel("ag_9", teams, games, groups);

    expect(answer.gaps[0]!.ageGapPrior).toBe(3);
    expect(answer.result.ratedSamples).toBeGreaterThanOrEqual(30);
    expect(answer.betterGap).toBeNull();
  });

  /** One run dressed with per-game errors made to order, as `MODEL_CHECK_RUNS` would return it. */
  const base = syntheticPool({ teamCount: 14, gamesPerPair: 2 });
  const plain = backtestScoutRatings("ag_9", base.teams, base.games, groups);
  const run = (
    options: ScoutBacktestOptions,
    errors: readonly number[],
    rated: readonly number[]
  ): ScoutBacktestResult => {
    const mean = (values: number[]) =>
      values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
    const ratedErrors = errors.filter((_, at) => rated[at] === 1);
    return {
      ...plain,
      ageGapPrior: options.ageGapPrior ?? plain.ageGapPrior,
      cap: options.cap ?? plain.cap,
      meanAbsoluteError: mean([...errors]),
      ratedError: mean(ratedErrors),
      ratedSamples: ratedErrors.length,
      errors: Float32Array.from(errors),
      ratedFlags: Uint8Array.from(rated),
    };
  };
  /** Every run at `reference` except those given, in the order the check makes them. */
  const answerFrom = (
    reference: readonly number[],
    rated: readonly number[],
    changed: { gaps?: Map<number, number[]>; caps?: Map<number, number[]> }
  ) =>
    modelCheckAnswer(
      MODEL_CHECK_RUNS.map((options) => {
        const errors =
          (options.cap === undefined
            ? changed.gaps?.get(options.ageGapPrior!)
            : changed.caps?.get(options.cap)) ?? reference;
        return run(options, errors, rated);
      })
    );
  // Two hundred held-back games with errors between two and four runs, every other one rated.
  const reference = Array.from({ length: 200 }, (_, at) => 2 + ((at * 37) % 11) / 5);
  const everyOther = reference.map((_, at) => (at % 2 === 0 ? 1 : 0));

  it("names a setting that is lower on nearly every game", () => {
    const lower = reference.map((error, at) => error - 0.2 + (((at * 13) % 5) - 2) * 0.01);
    const answer = answerFrom(reference, everyOther, {
      gaps: new Map([[3, lower]]),
      caps: new Map([[10, lower]]),
    });

    expect(answer.betterGap).toMatchObject({ value: 3, samples: 100 });
    expect(answer.betterGap!.by).toBeCloseTo(0.2, 2);
    expect(answer.betterCap).toMatchObject({ value: 10, samples: 200 });
  });

  it("names nothing when the lower average is within the noise of the one in use", () => {
    // A hundredth of a run lower on average, half a run either way game by game.
    const noisy = reference.map((error, at) => error - 0.01 + (at % 4 < 2 ? 0.5 : -0.5));
    const answer = answerFrom(reference, everyOther, {
      gaps: new Map([[1.5, noisy]]),
      caps: new Map([[Infinity, noisy]]),
    });

    // Best on the averages, which is what the card used to name.
    expect(answer.gaps[0]!.ageGapPrior).toBe(1.5);
    expect(answer.caps[0]!.cap).toBe(Infinity);
    expect(answer.betterGap).toBeNull();
    expect(answer.betterCap).toBeNull();
  });

  it("names a clear runner-up when the lowest average is only noise", () => {
    const noisy = reference.map((error, at) => error - 0.1 + (at % 4 < 2 ? 1.5 : -1.5));
    const lower = reference.map((error, at) => error - 0.05 + (((at * 13) % 5) - 2) * 0.01);
    const answer = answerFrom(reference, everyOther, {
      caps: new Map([
        [Infinity, noisy],
        [10, lower],
      ]),
    });

    expect(answer.caps[0]!.cap).toBe(Infinity);
    expect(answer.betterCap?.value).toBe(10);
  });

  it("judges a held age gap on the games between rated clubs alone", () => {
    // A full run better on every game with an unrated side, identical on the rest.
    const unratedOnly = reference.map((error, at) => (everyOther[at] === 1 ? error : error - 1));
    const answer = answerFrom(reference, everyOther, { gaps: new Map([[1, unratedOnly]]) });

    expect(answer.betterGap).toBeNull();
    // The cap sweep reads every game, so the same errors there are a clear answer.
    const asCap = answerFrom(reference, everyOther, { caps: new Map([[6, unratedOnly]]) });
    expect(asCap.betterCap?.value).toBe(6);
  });

  it("names nothing on too few games to tell", () => {
    const few = reference.slice(0, 20);
    const allRated = few.map(() => 1);
    const lower = few.map((error) => error - 0.3);
    const answer = answerFrom(few, allRated, {
      gaps: new Map([[3, lower]]),
      caps: new Map([[10, lower]]),
    });

    expect(answer.betterGap).toBeNull();
    expect(answer.betterCap).toBeNull();
  });

  it("pairs two runs game by game", () => {
    const worse = run({}, [3, 4, 5], [1, 1, 0]);
    const better = run({}, [2, 4, 3], [1, 1, 0]);

    const paired = pairedImprovement(better, worse, false);
    // Lower by 1, 0 and 2 runs: a mean of one, a sample deviation of one.
    expect(paired).toMatchObject({ by: 1, samples: 3 });
    expect(paired!.standardError).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(pairedImprovement(better, worse, true)).toMatchObject({ by: 0.5, samples: 2 });
    expect(pairedImprovement(better, { ...worse, errors: undefined }, false)).toBeNull();
  });

  it("counts the games that share a club as moving together", () => {
    // Ten games, five of one club's against five others and five of a second club's: the first
    // club's all two runs lower, the second's level. Read as ten independent games the mean of one
    // is a third of a run either way; read by club it is two clubs' worth, √0.5 either way.
    const of = (values: number[]) =>
      run(
        {},
        values,
        values.map(() => 1)
      );
    const sides = Uint32Array.from([0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 6, 7, 6, 8, 6, 9, 6, 10, 6, 11]);
    const worse = { ...of([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), sides };
    const better = of([1, 1, 1, 1, 1, 3, 3, 3, 3, 3]);

    const paired = pairedImprovement(better, worse, false)!;
    expect(paired.by).toBeCloseTo(1, 12);
    expect(paired.standardError).toBeCloseTo(Math.sqrt(0.5), 12);
    const { sides: _sides, ...unsided } = worse;
    expect(pairedImprovement(better, unsided, false)!.standardError).toBeCloseTo(1 / 3, 12);

    // The rating never counts a club's game against itself, but read as one, such a game is in its
    // club's sum once and in no pair's: the five lower here all one club's, the five level between
    // five pairs of others. √0.3, where taking the club's sum back as a pair's left a third of a run.
    const alone = Uint32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pairedImprovement(better, { ...worse, sides: alone }, false)!.standardError).toBeCloseTo(
      Math.sqrt(0.3),
      12
    );
  });

  it("holds each of several rivals to a bar that splits chance between them", () => {
    expect(clearlyBetterBar(1)).toBeCloseTo(2, 3);
    expect(clearlyBetterBar(4)).toBeCloseTo(2.531, 2);
    expect(clearlyBetterBar(5)).toBeCloseTo(2.608, 2);
    expect(clearlyBetterBar(6)).toBeCloseTo(2.67, 2);
    // About 2.3 standard errors lower on the games between rated clubs: past the one-rival bar of
    // 2, which named it, and short of the 2.53 four age gaps tried share.
    const shade = reference.map((error, at) => error - 0.115 + (at % 4 < 2 ? 0.5 : -0.5));
    const paired = pairedImprovement(
      run({}, shade, everyOther),
      run({}, reference, everyOther),
      true
    )!;
    expect(paired.by / paired.standardError).toBeGreaterThan(2);
    expect(paired.by / paired.standardError).toBeLessThan(clearlyBetterBar(4));
    expect(answerFrom(reference, everyOther, { gaps: new Map([[3, shade]]) }).betterGap).toBeNull();
  });
});
