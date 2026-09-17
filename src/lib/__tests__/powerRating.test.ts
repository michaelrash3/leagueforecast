import { describe, expect, it } from "vitest";
import {
  AGE_GAP_RUNS_PER_YEAR,
  DEFAULT_AGE_GAP_SHRINKAGE,
  SPARSE_SOLVER_THRESHOLD,
  buildOpponentAdjustedRatings,
  type OpponentAdjustedOptions,
  type OpponentAdjustedRatings,
  type RatingGame,
} from "../powerRating";
import { clamp } from "../util";

const ids = ["A", "B", "C", "D"];

describe("buildOpponentAdjustedRatings", () => {
  it("ranks a dominant team highest and a bottom team lowest", () => {
    // A beats everyone by 5, D loses to everyone by 5; B and C in the middle.
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 5 },
      { home: "A", away: "C", homeMargin: 5 },
      { home: "A", away: "D", homeMargin: 5 },
      { home: "B", away: "C", homeMargin: 2 },
      { home: "B", away: "D", homeMargin: 5 },
      { home: "C", away: "D", homeMargin: 5 },
    ];
    const result = buildOpponentAdjustedRatings(ids, games);
    expect(result.ratings.get("A")!).toBeGreaterThan(result.ratings.get("B")!);
    expect(result.ratings.get("B")!).toBeGreaterThan(result.ratings.get("D")!);
    expect(result.ratings.get("A")!).toBeGreaterThan(result.ratings.get("D")!);
  });

  it("caps blowouts so they do not dominate", () => {
    const modest: RatingGame[] = [{ home: "A", away: "B", homeMargin: 8 }];
    const blowout: RatingGame[] = [{ home: "A", away: "B", homeMargin: 40 }];
    const a = buildOpponentAdjustedRatings(["A", "B"], modest, { cap: 8 });
    const b = buildOpponentAdjustedRatings(["A", "B"], blowout, { cap: 8 });
    // A 40-run win is clamped to the same 8-run margin as an 8-run win.
    expect(a.ratings.get("A")!).toBeCloseTo(b.ratings.get("A")!, 6);
    expect(a.cap).toBe(8);
  });

  it("adjusts for opponent strength: same margins vs tougher schedule rate higher", () => {
    // X beats a strong opponent (S) by 3; Y beats a weak opponent (W) by 3.
    const games: RatingGame[] = [
      { home: "S", away: "W", homeMargin: 8 }, // S is clearly strong, W clearly weak
      { home: "S", away: "W", homeMargin: 8 },
      { home: "X", away: "S", homeMargin: 3 }, // X beats strong S
      { home: "Y", away: "W", homeMargin: 3 }, // Y beats weak W
    ];
    const result = buildOpponentAdjustedRatings(["S", "W", "X", "Y"], games);
    expect(result.ratings.get("X")!).toBeGreaterThan(result.ratings.get("Y")!);
    expect(result.strengthOfSchedule.get("X")!).toBeGreaterThan(
      result.strengthOfSchedule.get("Y")!
    );
  });

  it("regresses teams with no games to the league mean (0)", () => {
    const games: RatingGame[] = [{ home: "A", away: "B", homeMargin: 6 }];
    const result = buildOpponentAdjustedRatings(ids, games);
    expect(result.ratings.get("C")).toBe(0);
    expect(result.ratings.get("D")).toBe(0);
    expect(result.games.get("C")).toBe(0);
  });

  it("keeps the home-field term near zero when results are location-independent", () => {
    // The same team wins by the same margin regardless of venue → no home-field signal.
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 4 }, // A wins by 4 at home
      { home: "B", away: "A", homeMargin: -4 }, // A wins by 4 on the road
      { home: "C", away: "D", homeMargin: 4 },
      { home: "D", away: "C", homeMargin: -4 },
    ];
    const result = buildOpponentAdjustedRatings(ids, games);
    expect(Math.abs(result.homeAdvantage)).toBeLessThan(1);
  });

  it("detects a real home-field advantage when the home team consistently wins", () => {
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 4 },
      { home: "B", away: "A", homeMargin: 4 },
      { home: "C", away: "D", homeMargin: 4 },
      { home: "D", away: "C", homeMargin: 4 },
    ];
    const result = buildOpponentAdjustedRatings(ids, games);
    expect(result.homeAdvantage).toBeGreaterThan(1);
  });

  it("is deterministic", () => {
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 3 },
      { home: "C", away: "D", homeMargin: 2 },
    ];
    const a = buildOpponentAdjustedRatings(ids, games);
    const b = buildOpponentAdjustedRatings(ids, games);
    expect([...a.ratings.entries()]).toEqual([...b.ratings.entries()]);
  });
});

describe("neutral-site games and the home-field estimate", () => {
  it("does not invent a home edge from games that had no home team", () => {
    // Every row entered with the stronger side first. If those counted toward home field, the
    // model would conclude that being listed first is worth runs.
    const games = [
      { home: "A", away: "B", homeMargin: 6, neutral: true },
      { home: "A", away: "C", homeMargin: 5, neutral: true },
      { home: "B", away: "C", homeMargin: 4, neutral: true },
    ];
    const out = buildOpponentAdjustedRatings(["A", "B", "C"], games);
    expect(out.homeAdvantage).toBe(0);
  });

  it("still finds one from real home games", () => {
    const games = [
      { home: "A", away: "B", homeMargin: 6 },
      { home: "B", away: "A", homeMargin: 2 },
      { home: "A", away: "C", homeMargin: 5 },
      { home: "C", away: "A", homeMargin: 1 },
    ];
    const out = buildOpponentAdjustedRatings(["A", "B", "C"], games);
    expect(out.homeAdvantage).toBeGreaterThan(0);
  });

  it("still rates teams from neutral games — only the home term is excluded", () => {
    const out = buildOpponentAdjustedRatings(
      ["A", "B"],
      [{ home: "A", away: "B", homeMargin: 8, neutral: true }]
    );
    expect(out.ratings.get("A") ?? 0).toBeGreaterThan(out.ratings.get("B") ?? 0);
  });

  it("keeps a real home edge out of the neutral rows' reach", () => {
    // Two league games with a genuine home edge, plus a lopsided neutral one entered A-first.
    // The neutral row must move the ratings without touching homeAdvantage's evidence.
    const leagueOnly = buildOpponentAdjustedRatings(
      ["A", "B"],
      [
        { home: "A", away: "B", homeMargin: 4 },
        { home: "B", away: "A", homeMargin: 4 },
      ]
    );
    const withNeutral = buildOpponentAdjustedRatings(
      ["A", "B"],
      [
        { home: "A", away: "B", homeMargin: 4 },
        { home: "B", away: "A", homeMargin: 4 },
        { home: "A", away: "B", homeMargin: 9, neutral: true },
      ]
    );
    expect(withNeutral.homeAdvantage).toBeCloseTo(leagueOnly.homeAdvantage, 6);
    expect(withNeutral.ratings.get("A") ?? 0).toBeGreaterThan(leagueOnly.ratings.get("A") ?? 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Shared helpers for the age-gap and solver tests below.
// ---------------------------------------------------------------------------------------------

/**
 * A small deterministic PRNG (mulberry32) so the random graphs are the same on every run and on
 * every machine. Math.random would make a failure impossible to reproduce.
 */
const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Graph = { ids: string[]; games: RatingGame[] };

/**
 * A random pool: teams at levels 8–11 with hidden strengths, games between random pairs with a
 * home edge, a two-run-per-year age effect and noise. `withGaps` decides whether the age gap is
 * recorded on the games (as GameChanger-fed pools do) or left off (as today's single-level data).
 */
const randomGraph = (
  seed: number,
  teamCount: number,
  gameCount: number,
  withGaps: boolean
): Graph => {
  const random = mulberry32(seed);
  const ids = Array.from({ length: teamCount }, (_, i) => `T${i}`);
  const level = ids.map(() => 8 + Math.floor(random() * 4));
  const strength = ids.map(() => (random() - 0.5) * 8);
  const games: RatingGame[] = [];
  while (games.length < gameCount) {
    const h = Math.floor(random() * teamCount);
    const w = Math.floor(random() * teamCount);
    if (h === w) continue;
    const gap = level[h]! - level[w]!;
    const neutral = random() < 0.5;
    const noise = (random() - 0.5) * 6;
    const homeMargin = Math.round(
      strength[h]! - strength[w]! + (neutral ? 0 : 0.5) + 2 * gap + noise
    );
    const game: RatingGame = { home: ids[h]!, away: ids[w]!, homeMargin };
    if (neutral) game.neutral = true;
    if (withGaps && gap !== 0) game.ageGap = gap;
    games.push(game);
  }
  return { ids, games };
};

/** The hand-built game sets from the tests above, reused as fixtures for the solver comparisons. */
const fixtures: Array<{ name: string; ids: string[]; games: RatingGame[] }> = [
  {
    name: "dominant team",
    ids,
    games: [
      { home: "A", away: "B", homeMargin: 5 },
      { home: "A", away: "C", homeMargin: 5 },
      { home: "A", away: "D", homeMargin: 5 },
      { home: "B", away: "C", homeMargin: 2 },
      { home: "B", away: "D", homeMargin: 5 },
      { home: "C", away: "D", homeMargin: 5 },
    ],
  },
  {
    name: "schedule strength",
    ids: ["S", "W", "X", "Y"],
    games: [
      { home: "S", away: "W", homeMargin: 8 },
      { home: "S", away: "W", homeMargin: 8 },
      { home: "X", away: "S", homeMargin: 3 },
      { home: "Y", away: "W", homeMargin: 3 },
    ],
  },
  {
    name: "idle teams",
    ids,
    games: [{ home: "A", away: "B", homeMargin: 6 }],
  },
  {
    name: "home edge",
    ids,
    games: [
      { home: "A", away: "B", homeMargin: 4 },
      { home: "B", away: "A", homeMargin: 4 },
      { home: "C", away: "D", homeMargin: 4 },
      { home: "D", away: "C", homeMargin: 4 },
    ],
  },
  {
    name: "neutral rows",
    ids: ["A", "B", "C"],
    games: [
      { home: "A", away: "B", homeMargin: 6, neutral: true },
      { home: "A", away: "C", homeMargin: 5, neutral: true },
      { home: "B", away: "C", homeMargin: 4, neutral: true },
    ],
  },
  {
    name: "mixed venues with a blowout",
    ids: ["A", "B"],
    games: [
      { home: "A", away: "B", homeMargin: 4 },
      { home: "B", away: "A", homeMargin: 4 },
      { home: "A", away: "B", homeMargin: 19, neutral: true },
    ],
  },
];

const mapsBitIdentical = (actual: Map<string, number>, expected: Map<string, number>) => {
  expect([...actual.keys()]).toEqual([...expected.keys()]);
  expected.forEach((value, key) => {
    const got = actual.get(key);
    // Object.is rather than toBeCloseTo: "bit for bit" includes the sign of zero.
    expect(Object.is(got, value), `${key}: ${got} vs ${value}`).toBe(true);
  });
};

/**
 * Every field of two results identical, bar the two the legacy reference does not produce.
 *
 * `ageGapRuns` and `residualScale` are both derived after the solve rather than part of it, so the
 * reference has no opinion about either; what is under test here is that the fit itself is
 * unchanged, digit for digit.
 */
const expectBitIdentical = (
  actual: OpponentAdjustedRatings,
  expected: Omit<OpponentAdjustedRatings, "ageGapRuns" | "residualScale">
) => {
  mapsBitIdentical(actual.ratings, expected.ratings);
  mapsBitIdentical(actual.rawMargin, expected.rawMargin);
  mapsBitIdentical(actual.strengthOfSchedule, expected.strengthOfSchedule);
  mapsBitIdentical(actual.games, expected.games);
  expect(Object.is(actual.homeAdvantage, expected.homeAdvantage)).toBe(true);
  expect(actual.cap).toBe(expected.cap);
};

const mapsClose = (
  actual: Map<string, number>,
  expected: Map<string, number>,
  tolerance: number
) => {
  expect([...actual.keys()]).toEqual([...expected.keys()]);
  expected.forEach((value, key) => {
    const got = actual.get(key) ?? Number.NaN;
    expect(Math.abs(got - value), `${key}: ${got} vs ${value}`).toBeLessThanOrEqual(tolerance);
  });
};

/** Every field of two results within `tolerance` — the dense/sparse agreement check. */
const expectClose = (
  actual: OpponentAdjustedRatings,
  expected: OpponentAdjustedRatings,
  tolerance: number
) => {
  mapsClose(actual.ratings, expected.ratings, tolerance);
  mapsClose(actual.strengthOfSchedule, expected.strengthOfSchedule, tolerance);
  // Raw margins and game counts never pass through a solver, so they must be identical.
  mapsBitIdentical(actual.rawMargin, expected.rawMargin);
  mapsBitIdentical(actual.games, expected.games);
  expect(Math.abs(actual.homeAdvantage - expected.homeAdvantage)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.ageGapRuns - expected.ageGapRuns)).toBeLessThanOrEqual(tolerance);
  expect(actual.cap).toBe(expected.cap);
};

// ---------------------------------------------------------------------------------------------
// The legacy model, verbatim, as it stood before the age-gap term and the sparse solver were
// added. It is the reference for "no game carries an age gap → the numbers do not change at all":
// same elimination, same order of additions, same rounding.
// ---------------------------------------------------------------------------------------------

const legacySolve = (matrix: number[][], vector: number[]): number[] => {
  const n = vector.length;
  const a = matrix.map((row) => row.slice());
  const b = vector.slice();

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-9) continue;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    }
    const pivotValue = a[col]![col]!;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row]![col]! / pivotValue;
      if (factor === 0) continue;
      for (let k = col; k < n; k += 1) {
        a[row]![k]! -= factor * a[col]![k]!;
      }
      b[row]! -= factor * b[col]!;
    }
  }

  return b.map((value, index) => {
    const diag = a[index]![index]!;
    return Math.abs(diag) < 1e-9 ? 0 : value / diag;
  });
};

const legacyBuild = (
  teamIds: string[],
  games: RatingGame[],
  options: OpponentAdjustedOptions = {}
): Omit<OpponentAdjustedRatings, "ageGapRuns" | "residualScale"> => {
  const cap = options.cap ?? 8;
  const shrinkage = options.shrinkage ?? 1.5;
  const homeFieldShrinkage = options.homeFieldShrinkage ?? 3;

  const ratings = new Map<string, number>();
  const rawMarginSum = new Map<string, number>();
  const gameCount = new Map<string, number>();
  const opponents = new Map<string, string[]>();
  teamIds.forEach((id) => {
    ratings.set(id, 0);
    rawMarginSum.set(id, 0);
    gameCount.set(id, 0);
    opponents.set(id, []);
  });

  const index = new Map(teamIds.map((id, i) => [id, i]));
  const n = teamIds.length;
  if (n === 0) {
    return {
      ratings,
      rawMargin: new Map(),
      strengthOfSchedule: new Map(),
      games: gameCount,
      homeAdvantage: 0,
      cap,
    };
  }

  const size = n + 1;
  const hfa = n;
  const a: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const rhs = new Array<number>(size).fill(0);

  games.forEach((game) => {
    const h = index.get(game.home);
    const w = index.get(game.away);
    if (h === undefined || w === undefined) return;
    const margin = clamp(game.homeMargin, -cap, cap);
    const hf = game.neutral ? 0 : 1;
    a[h]![h]! += 1;
    a[h]![w]! -= 1;
    a[h]![hfa]! += hf;
    a[w]![h]! -= 1;
    a[w]![w]! += 1;
    a[w]![hfa]! -= hf;
    a[hfa]![h]! += hf;
    a[hfa]![w]! -= hf;
    a[hfa]![hfa]! += hf * hf;
    rhs[h]! += margin;
    rhs[w]! -= margin;
    rhs[hfa]! += hf * margin;

    rawMarginSum.set(game.home, (rawMarginSum.get(game.home) ?? 0) + margin);
    rawMarginSum.set(game.away, (rawMarginSum.get(game.away) ?? 0) - margin);
    gameCount.set(game.home, (gameCount.get(game.home) ?? 0) + 1);
    gameCount.set(game.away, (gameCount.get(game.away) ?? 0) + 1);
    opponents.get(game.home)?.push(game.away);
    opponents.get(game.away)?.push(game.home);
  });

  for (let i = 0; i < n; i += 1) a[i]![i]! += shrinkage;
  a[hfa]![hfa]! += homeFieldShrinkage;

  const solution = legacySolve(a, rhs);
  teamIds.forEach((id, i) => ratings.set(id, solution[i] ?? 0));
  const homeAdvantage = solution[hfa] ?? 0;

  const rawMargin = new Map<string, number>();
  const strengthOfSchedule = new Map<string, number>();
  teamIds.forEach((id) => {
    const played = gameCount.get(id) ?? 0;
    rawMargin.set(id, played ? (rawMarginSum.get(id) ?? 0) / played : 0);
    const faced = opponents.get(id) ?? [];
    strengthOfSchedule.set(
      id,
      faced.length ? faced.reduce((sum, opp) => sum + (ratings.get(opp) ?? 0), 0) / faced.length : 0
    );
  });

  return { ratings, rawMargin, strengthOfSchedule, games: gameCount, homeAdvantage, cap };
};

// ---------------------------------------------------------------------------------------------

describe("age-gap model constants", () => {
  it("publishes the values the rankings code and method panel read", () => {
    expect(AGE_GAP_RUNS_PER_YEAR).toBe(2);
    expect(DEFAULT_AGE_GAP_SHRINKAGE).toBe(6);
    expect(SPARSE_SOLVER_THRESHOLD).toBe(150);
  });
});

describe("without age gaps the dense path is the legacy model, bit for bit", () => {
  it("matches the legacy solver on the hand-built fixtures", () => {
    fixtures.forEach(({ ids: teamIds, games }) => {
      expectBitIdentical(
        buildOpponentAdjustedRatings(teamIds, games, { solver: "dense" }),
        legacyBuild(teamIds, games)
      );
      // "auto" is dense below the threshold, so the default call is the legacy call too.
      expectBitIdentical(buildOpponentAdjustedRatings(teamIds, games), legacyBuild(teamIds, games));
    });
  });

  it("matches the legacy solver on random graphs, with and without custom options", () => {
    [1, 2, 3, 4, 5].forEach((seed) => {
      const { ids: teamIds, games } = randomGraph(seed, 40, 220, false);
      expectBitIdentical(buildOpponentAdjustedRatings(teamIds, games), legacyBuild(teamIds, games));
      const options = { cap: 6, shrinkage: 2.25, homeFieldShrinkage: 1 };
      expectBitIdentical(
        buildOpponentAdjustedRatings(teamIds, games, options),
        legacyBuild(teamIds, games, options)
      );
    });
  });

  it("treats ageGap 0, undefined and non-finite as no gap", () => {
    const { ids: teamIds, games } = randomGraph(11, 12, 40, false);
    const decorated = games.map((game, i) => ({
      ...game,
      ageGap: i % 3 === 0 ? 0 : i % 3 === 1 ? undefined : Number.NaN,
    }));
    expectBitIdentical(
      buildOpponentAdjustedRatings(teamIds, decorated),
      legacyBuild(teamIds, games)
    );
    expect(buildOpponentAdjustedRatings(teamIds, decorated).ageGapRuns).toBe(AGE_GAP_RUNS_PER_YEAR);
  });

  it("reports the prior as ageGapRuns when no game crosses levels", () => {
    const { ids: teamIds, games } = randomGraph(12, 10, 30, false);
    expect(buildOpponentAdjustedRatings(teamIds, games).ageGapRuns).toBe(AGE_GAP_RUNS_PER_YEAR);
    expect(buildOpponentAdjustedRatings(teamIds, games, { ageGapPrior: 3 }).ageGapRuns).toBe(3);
    expect(buildOpponentAdjustedRatings([], [], { ageGapPrior: 2.5 }).ageGapRuns).toBe(2.5);
    expect(buildOpponentAdjustedRatings([], []).ageGapRuns).toBe(AGE_GAP_RUNS_PER_YEAR);
  });
});

describe("age gap term", () => {
  // Four 9U teams that tie each other pin the level at a rating of 0; then an 8U meets one.
  const nineU = ["N1", "N2", "N3", "N4"];
  const balanced: RatingGame[] = [
    { home: "N1", away: "N2", homeMargin: 0, neutral: true },
    { home: "N1", away: "N3", homeMargin: 0, neutral: true },
    { home: "N1", away: "N4", homeMargin: 0, neutral: true },
    { home: "N2", away: "N3", homeMargin: 0, neutral: true },
    { home: "N2", away: "N4", homeMargin: 0, neutral: true },
    { home: "N3", away: "N4", homeMargin: 0, neutral: true },
  ];

  it("(a) an 8U losing by the prior to a 9U rated about 0 comes out even, not −2", () => {
    const withGap = buildOpponentAdjustedRatings(
      [...nineU, "E8"],
      [...balanced, { home: "N1", away: "E8", homeMargin: 2, neutral: true, ageGap: 1 }]
    );
    expect(withGap.ratings.get("N1")!).toBeCloseTo(0, 6);
    // The two-run loss is exactly the prior, so nothing is left to explain: even, not −2.
    expect(withGap.ratings.get("E8")!).toBeCloseTo(0, 6);
    expect(withGap.rawMargin.get("E8")).toBe(-2);
    expect(withGap.ageGapRuns).toBeCloseTo(AGE_GAP_RUNS_PER_YEAR, 6);
    // And its schedule shows it played up: one opponent rated 0, worth two runs from its seat.
    expect(withGap.strengthOfSchedule.get("E8")!).toBeCloseTo(AGE_GAP_RUNS_PER_YEAR, 6);

    // The same score sheet with the gap unrecorded reads as a plain two-run loss (shrunk toward
    // the mean, as any single game is).
    const withoutGap = buildOpponentAdjustedRatings(
      [...nineU, "E8"],
      [...balanced, { home: "N1", away: "E8", homeMargin: 2, neutral: true }]
    );
    expect(withoutGap.ratings.get("E8")!).toBeLessThan(-0.25);
    expect(withoutGap.ratings.get("N1")!).toBeGreaterThan(0);
    expect(withGap.ratings.get("E8")!).toBeGreaterThan(withoutGap.ratings.get("E8")! + 0.25);
  });

  it("(a) an 8U beating a 9U outright is rated well above the 9U", () => {
    const out = buildOpponentAdjustedRatings(
      [...nineU, "E8"],
      [...balanced, { home: "N1", away: "E8", homeMargin: -3, neutral: true, ageGap: 1 }]
    );
    // Five runs better than the prior expected: split across the two teams and δ by the ridge.
    expect(out.ratings.get("E8")!).toBeGreaterThan(out.ratings.get("N1")! + 1);
  });

  it("keeps rawMargin as the capped raw margin, unadjusted for the gap", () => {
    const out = buildOpponentAdjustedRatings(
      ["N1", "E8"],
      [
        { home: "N1", away: "E8", homeMargin: 2, neutral: true, ageGap: 1 },
        { home: "E8", away: "N1", homeMargin: -20, neutral: true, ageGap: -1 },
      ],
      { cap: 8 }
    );
    expect(out.rawMargin.get("N1")).toBe(5);
    expect(out.rawMargin.get("E8")).toBe(-5);
    expect(out.games.get("N1")).toBe(2);
    expect(out.games.get("E8")).toBe(2);
  });

  it("(b) strength of schedule credits playing up and debits playing down", () => {
    // O is a 10U rated 0 (every game goes exactly to the prior). X (10U) plays it level, Y (9U)
    // plays up against it, Z (11U) plays down against it.
    const out = buildOpponentAdjustedRatings(
      ["O", "X", "Y", "Z"],
      [
        { home: "O", away: "X", homeMargin: 0, neutral: true },
        { home: "O", away: "Y", homeMargin: 2, neutral: true, ageGap: 1 },
        { home: "O", away: "Z", homeMargin: -2, neutral: true, ageGap: -1 },
      ]
    );
    const sos = (id: string) => out.strengthOfSchedule.get(id)!;
    expect(out.ratings.get("O")!).toBeCloseTo(0, 9);
    expect(sos("Y")).toBeGreaterThan(sos("X"));
    expect(sos("X")).toBeGreaterThan(sos("Z"));
    expect(sos("Y")).toBeCloseTo(out.ageGapRuns, 9);
    expect(sos("X")).toBeCloseTo(0, 9);
    expect(sos("Z")).toBeCloseTo(-out.ageGapRuns, 9);
    // O's own schedule: X worth 0, Y worth two less, Z worth two more — a wash.
    expect(sos("O")).toBeCloseTo(0, 9);
  });

  it("(b) the seat, not the pair order, decides the sign of the schedule credit", () => {
    // The same 9U-plays-up game written with either side first.
    const olderFirst = buildOpponentAdjustedRatings(
      ["O", "Y"],
      [{ home: "O", away: "Y", homeMargin: 3, neutral: true, ageGap: 1 }]
    );
    const youngerFirst = buildOpponentAdjustedRatings(
      ["O", "Y"],
      [{ home: "Y", away: "O", homeMargin: -3, neutral: true, ageGap: -1 }]
    );
    expect(youngerFirst.ratings.get("Y")!).toBeCloseTo(olderFirst.ratings.get("Y")!, 9);
    expect(youngerFirst.ratings.get("O")!).toBeCloseTo(olderFirst.ratings.get("O")!, 9);
    expect(youngerFirst.ageGapRuns).toBeCloseTo(olderFirst.ageGapRuns, 9);
    expect(youngerFirst.strengthOfSchedule.get("Y")!).toBeCloseTo(
      olderFirst.strengthOfSchedule.get("Y")!,
      9
    );
    expect(youngerFirst.strengthOfSchedule.get("Y")!).toBeGreaterThan(
      youngerFirst.strengthOfSchedule.get("O")!
    );
  });

  // Six 9U teams each play all six 8U teams; the older side wins every one by six.
  const older = ["P1", "P2", "P3", "P4", "P5", "P6"];
  const younger = ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6"];
  const season: RatingGame[] = older.flatMap((p) =>
    younger.map((q): RatingGame => ({ home: p, away: q, homeMargin: 6, neutral: true, ageGap: 1 }))
  );

  it("(c) a season of cross-age results moves ageGapRuns off the prior", () => {
    const out = buildOpponentAdjustedRatings([...older, ...younger], season);
    expect(out.ageGapRuns).toBeGreaterThan(3);
    expect(out.ageGapRuns).toBeLessThan(6);
    // Strength of schedule uses the fitted figure, not the prior: each 8U faced six 9Us.
    const olderMean = older.reduce((sum, id) => sum + out.ratings.get(id)!, 0) / older.length;
    expect(out.strengthOfSchedule.get("Q1")!).toBeCloseTo(olderMean + out.ageGapRuns, 9);
    const youngerMean = younger.reduce((sum, id) => sum + out.ratings.get(id)!, 0) / younger.length;
    expect(out.strengthOfSchedule.get("P1")!).toBeCloseTo(youngerMean - out.ageGapRuns, 9);
  });

  it("(c) shrinkage keeps a single lopsided game from rewriting the gap", () => {
    const one = buildOpponentAdjustedRatings(
      ["P1", "Q1"],
      [{ home: "P1", away: "Q1", homeMargin: 12, neutral: true, ageGap: 1 }]
    );
    const single = Math.abs(one.ageGapRuns - AGE_GAP_RUNS_PER_YEAR);
    expect(single).toBeLessThan(0.5);
    const many = buildOpponentAdjustedRatings([...older, ...younger], season);
    expect(many.ageGapRuns - AGE_GAP_RUNS_PER_YEAR).toBeGreaterThan(3 * single);
  });

  it("(c) heavier ageGapShrinkage holds the fit closer to the prior", () => {
    const loose = buildOpponentAdjustedRatings([...older, ...younger], season, {
      ageGapShrinkage: 1,
    });
    const normal = buildOpponentAdjustedRatings([...older, ...younger], season);
    const tight = buildOpponentAdjustedRatings([...older, ...younger], season, {
      ageGapShrinkage: 1e6,
    });
    expect(loose.ageGapRuns).toBeGreaterThan(normal.ageGapRuns);
    expect(normal.ageGapRuns).toBeGreaterThan(tight.ageGapRuns);
    expect(tight.ageGapRuns).toBeCloseTo(AGE_GAP_RUNS_PER_YEAR, 4);
  });

  it("(c) the prior is honoured: a pool that plays exactly to it fits δ = 0", () => {
    const out = buildOpponentAdjustedRatings([...older, ...younger], season, { ageGapPrior: 6 });
    expect(out.ageGapRuns).toBeCloseTo(6, 9);
    [...older, ...younger].forEach((id) => expect(out.ratings.get(id)!).toBeCloseTo(0, 9));
  });

  it("does not mistake the older side's edge for home-field advantage", () => {
    // Older teams host and win by the prior; younger teams host and lose by it. With the gap
    // recorded there is nothing left to explain, so HFA, δ and every rating sit at zero.
    const games: RatingGame[] = [
      { home: "P1", away: "Q1", homeMargin: 2, ageGap: 1 },
      { home: "Q1", away: "P2", homeMargin: -2, ageGap: -1 },
      { home: "P2", away: "Q2", homeMargin: 2, ageGap: 1 },
      { home: "Q2", away: "P1", homeMargin: -2, ageGap: -1 },
    ];
    const out = buildOpponentAdjustedRatings(["P1", "P2", "Q1", "Q2"], games);
    expect(out.homeAdvantage).toBeCloseTo(0, 9);
    expect(out.ageGapRuns).toBeCloseTo(AGE_GAP_RUNS_PER_YEAR, 9);
    ["P1", "P2", "Q1", "Q2"].forEach((id) => expect(out.ratings.get(id)!).toBeCloseTo(0, 9));
    // Unrecorded, the same sheet says the P teams are simply better.
    const blind = buildOpponentAdjustedRatings(
      ["P1", "P2", "Q1", "Q2"],
      games.map(({ ageGap: _gap, ...game }) => game)
    );
    expect(blind.ratings.get("P1")!).toBeGreaterThan(blind.ratings.get("Q1")! + 1);
  });

  it("leaves the home-field term at zero when the cross-age games are neutral", () => {
    const out = buildOpponentAdjustedRatings([...older, ...younger], season);
    expect(out.homeAdvantage).toBe(0);
  });

  it("caps the margin before the prior is taken off", () => {
    const modest = buildOpponentAdjustedRatings(
      ["P1", "Q1"],
      [{ home: "P1", away: "Q1", homeMargin: 8, neutral: true, ageGap: 1 }],
      { cap: 8 }
    );
    const blowout = buildOpponentAdjustedRatings(
      ["P1", "Q1"],
      [{ home: "P1", away: "Q1", homeMargin: 30, neutral: true, ageGap: 1 }],
      { cap: 8 }
    );
    expect(blowout.ratings.get("P1")).toBe(modest.ratings.get("P1"));
    expect(blowout.ageGapRuns).toBe(modest.ageGapRuns);
  });
});

describe("sparse (conjugate gradient) solver", () => {
  it("agrees with the dense solver to 1e-6 on a random 300-team graph", () => {
    const { ids: teamIds, games } = randomGraph(300, 300, 1500, true);
    const dense = buildOpponentAdjustedRatings(teamIds, games, { solver: "dense" });
    const sparse = buildOpponentAdjustedRatings(teamIds, games, { solver: "sparse" });
    expectClose(sparse, dense, 1e-6);
    // Sanity: the graph actually exercised every term.
    expect(dense.homeAdvantage).not.toBe(0);
    expect(dense.ageGapRuns).not.toBe(AGE_GAP_RUNS_PER_YEAR);
    expect(games.some((game) => game.ageGap !== undefined)).toBe(true);
  });

  it("agrees with the dense solver on a second seed without gaps and with custom options", () => {
    const { ids: teamIds, games } = randomGraph(301, 300, 1500, false);
    const options: OpponentAdjustedOptions = { cap: 10, shrinkage: 1, homeFieldShrinkage: 2 };
    const dense = buildOpponentAdjustedRatings(teamIds, games, { ...options, solver: "dense" });
    const sparse = buildOpponentAdjustedRatings(teamIds, games, { ...options, solver: "sparse" });
    expectClose(sparse, dense, 1e-6);
    expect(sparse.ageGapRuns).toBe(AGE_GAP_RUNS_PER_YEAR);
  });

  it("(d) agrees with the dense/legacy path on the hand-built fixtures", () => {
    fixtures.forEach(({ ids: teamIds, games }) => {
      const dense = buildOpponentAdjustedRatings(teamIds, games, { solver: "dense" });
      const sparse = buildOpponentAdjustedRatings(teamIds, games, { solver: "sparse" });
      expectClose(sparse, dense, 1e-9);
      expectBitIdentical(dense, legacyBuild(teamIds, games));
    });
  });

  it("agrees with the dense solver on the cross-age examples", () => {
    const older = ["P1", "P2", "P3"];
    const younger = ["Q1", "Q2", "Q3"];
    const games: RatingGame[] = [
      ...older.flatMap((p) =>
        younger.map((q): RatingGame => ({ home: p, away: q, homeMargin: 5, ageGap: 1 }))
      ),
      { home: "Q1", away: "P1", homeMargin: -1, ageGap: -1 },
      { home: "P2", away: "P3", homeMargin: 3 },
      { home: "Q2", away: "Q3", homeMargin: -2, neutral: true },
    ];
    const dense = buildOpponentAdjustedRatings([...older, ...younger], games, { solver: "dense" });
    const sparse = buildOpponentAdjustedRatings([...older, ...younger], games, {
      solver: "sparse",
    });
    expectClose(sparse, dense, 1e-9);
    expect(sparse.ageGapRuns).toBeGreaterThan(AGE_GAP_RUNS_PER_YEAR);
  });

  it("regresses teams with no games to exactly 0", () => {
    const out = buildOpponentAdjustedRatings(ids, [{ home: "A", away: "B", homeMargin: 6 }], {
      solver: "sparse",
    });
    expect(out.ratings.get("C")).toBe(0);
    expect(out.ratings.get("D")).toBe(0);
    expect(out.strengthOfSchedule.get("C")).toBe(0);
    expect(out.ratings.get("A")!).toBeGreaterThan(0);
  });

  it("returns zeros for a pool where every game was a tie", () => {
    const out = buildOpponentAdjustedRatings(
      ids,
      [
        { home: "A", away: "B", homeMargin: 0 },
        { home: "C", away: "D", homeMargin: 0, neutral: true },
      ],
      { solver: "sparse" }
    );
    ids.forEach((id) => expect(out.ratings.get(id)).toBe(0));
    expect(out.homeAdvantage).toBe(0);
    expect(out.ageGapRuns).toBe(AGE_GAP_RUNS_PER_YEAR);
  });

  it("(e) is deterministic", () => {
    const { ids: teamIds, games } = randomGraph(7, 200, 900, true);
    const first = buildOpponentAdjustedRatings(teamIds, games, { solver: "sparse" });
    const second = buildOpponentAdjustedRatings(teamIds, games, { solver: "sparse" });
    expectBitIdentical(first, second);
    expect(Object.is(first.ageGapRuns, second.ageGapRuns)).toBe(true);
    const denseFirst = buildOpponentAdjustedRatings(teamIds, games, { solver: "dense" });
    const denseSecond = buildOpponentAdjustedRatings(teamIds, games, { solver: "dense" });
    expectBitIdentical(denseFirst, denseSecond);
  });

  it('"auto" is dense up to the threshold and sparse above it', () => {
    const atThreshold = randomGraph(21, SPARSE_SOLVER_THRESHOLD, 600, true);
    const auto = buildOpponentAdjustedRatings(atThreshold.ids, atThreshold.games);
    expectBitIdentical(
      auto,
      buildOpponentAdjustedRatings(atThreshold.ids, atThreshold.games, { solver: "dense" })
    );

    const above = randomGraph(22, SPARSE_SOLVER_THRESHOLD + 1, 600, true);
    const autoAbove = buildOpponentAdjustedRatings(above.ids, above.games);
    const sparse = buildOpponentAdjustedRatings(above.ids, above.games, { solver: "sparse" });
    const dense = buildOpponentAdjustedRatings(above.ids, above.games, { solver: "dense" });
    expectBitIdentical(autoAbove, sparse);
    expect(Object.is(autoAbove.ageGapRuns, sparse.ageGapRuns)).toBe(true);
    expectClose(autoAbove, dense, 1e-6);
  });

  it("skips games naming teams outside the pool, like the dense solver", () => {
    const games: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 3 },
      { home: "A", away: "ghost", homeMargin: 9 },
      { home: "ghost", away: "B", homeMargin: 9, ageGap: 2 },
    ];
    const dense = buildOpponentAdjustedRatings(["A", "B"], games, { solver: "dense" });
    const sparse = buildOpponentAdjustedRatings(["A", "B"], games, { solver: "sparse" });
    expect(dense.games.get("A")).toBe(1);
    expect(sparse.games.get("A")).toBe(1);
    expect(dense.ageGapRuns).toBe(AGE_GAP_RUNS_PER_YEAR);
    expectClose(sparse, dense, 1e-9);
  });

  it("handles an empty pool", () => {
    const out = buildOpponentAdjustedRatings([], [{ home: "A", away: "B", homeMargin: 3 }], {
      solver: "sparse",
    });
    expect(out.ratings.size).toBe(0);
    expect(out.homeAdvantage).toBe(0);
    expect(out.ageGapRuns).toBe(AGE_GAP_RUNS_PER_YEAR);
  });
});

describe("weighting a game", () => {
  const base: RatingGame[] = [
    { home: "A", away: "B", homeMargin: 4, neutral: true },
    { home: "B", away: "C", homeMargin: 2, neutral: true },
    { home: "C", away: "D", homeMargin: 3, neutral: true },
  ];
  const fit = (games: RatingGame[], options: OpponentAdjustedOptions = {}) =>
    buildOpponentAdjustedRatings(ids, games, options);
  const ratingsOf = (result: OpponentAdjustedRatings) => ids.map((id) => result.ratings.get(id)!);

  it("changes nothing when every game weighs the same as before", () => {
    const explicit = base.map((game) => ({ ...game, weight: 1 }));
    expect(ratingsOf(fit(explicit))).toEqual(ratingsOf(fit(base)));
  });

  /*
   * The property that makes a weight mean what it says. Counting a game twice and counting it once
   * at double weight are the same statement about the world, so the fit has to agree — if it does
   * not, "weight" is just a knob rather than a number of games.
   */
  it("counts a game of weight two exactly as it counts the game twice", () => {
    const twice = [...base, base[0]!];
    const doubled = [{ ...base[0]!, weight: 2 }, ...base.slice(1)];
    ratingsOf(fit(doubled)).forEach((rating, at) => {
      expect(rating).toBeCloseTo(ratingsOf(fit(twice))[at]!, 10);
    });
  });

  it("drops a game of weight zero from the fit, without pretending it never happened", () => {
    const muted = [{ ...base[0]!, weight: 0 }, ...base.slice(1)];
    const absent = base.slice(1);
    ratingsOf(fit(muted)).forEach((rating, at) => {
      expect(rating).toBeCloseTo(ratingsOf(fit(absent))[at]!, 10);
    });
    // Still played, though: the record is a fact about the season, not a belief about the team.
    expect(fit(muted).games.get("A")).toBe(1);
    expect(fit(absent).games.get("A")).toBe(0);
  });

  it("leans toward the games that weigh more", () => {
    /*
     * A beat B by 4 early and lost to B by 4 late. Unweighted they cancel and both sit at the
     * mean; leaning on the later game has to put B ahead.
     */
    const split: RatingGame[] = [
      { home: "A", away: "B", homeMargin: 4, neutral: true, weight: 0.25 },
      { home: "A", away: "B", homeMargin: -4, neutral: true, weight: 1 },
    ];
    const level = fit(split.map((game) => ({ ...game, weight: 1 })));
    expect(level.ratings.get("A")).toBeCloseTo(level.ratings.get("B")!, 10);

    const recent = fit(split);
    expect(recent.ratings.get("B")!).toBeGreaterThan(recent.ratings.get("A")!);
  });

  /*
   * The other side of "a weight is a count". The ridge is denominated in games and stays constant,
   * so halving every weight really does halve the evidence and regress everything twice as far.
   * Arithmetically right, and never what anybody means by a weighting scheme — which is why the
   * schemes normalise to an average of one and this case does not arise in practice.
   */
  it("regresses further when every weight is halved, because that is less evidence", () => {
    const halved = base.map((game) => ({ ...game, weight: 0.5 }));
    const shrunk = ratingsOf(fit(halved));
    const full = ratingsOf(fit(base));
    expect(Math.abs(shrunk[0]!)).toBeLessThan(Math.abs(full[0]!));
  });

  it("reads a nonsense weight as a full one rather than a smaller opinion", () => {
    const junk = base.map((game) => ({ ...game, weight: Number.NaN }));
    expect(ratingsOf(fit(junk))).toEqual(ratingsOf(fit(base)));
    const negative = base.map((game) => ({ ...game, weight: -2 }));
    expect(ratingsOf(fit(negative))).toEqual(ratingsOf(fit(base)));
  });

  it("weighs the same in the sparse solver as in the dense one", () => {
    const weighted = base.map((game, at) => ({ ...game, weight: 1 / (at + 1) }));
    const dense = fit(weighted, { solver: "dense" });
    const sparse = fit(weighted, { solver: "sparse" });
    ratingsOf(dense).forEach((rating, at) => {
      expect(rating).toBeCloseTo(ratingsOf(sparse)[at]!, 8);
    });
  });
});
