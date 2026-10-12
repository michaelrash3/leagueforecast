import { describe, expect, it } from "vitest";
import { FIXTURE_TODAY, poolFixture } from "../../../scripts/poolFixture";
import {
  ACTIVE_RECENCY_SCHEME,
  byBlock,
  byDays,
  byGamesSince,
  dayInstant,
  noDecay,
  normalizeWeights,
  RECENCY_SCHEMES,
  recencyBasisFor,
  recencyWeightOf,
  weightsForGames,
  type DatedRatingGame,
  type RecencyBasis,
} from "../ratingRecency";
import { scoutRatingGames, type ScoutGame, type SeasonSegment } from "../teamRankings";

const DAY = 24 * 60 * 60 * 1000;
const day = (iso: string) => Date.parse(`${iso}T12:00:00.000Z`);

/** A fall block, the winter, then a spring block — the shape this whole module exists for. */
const seasonShaped = (): DatedRatingGame[] => [
  { at: day("2025-09-06"), home: "A", away: "B" },
  { at: day("2025-09-20"), home: "A", away: "C" },
  { at: day("2025-10-11"), home: "A", away: "D" },
  { at: day("2026-04-11"), home: "A", away: "B" },
  { at: day("2026-04-25"), home: "A", away: "C" },
];

const mean = (values: readonly number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

describe("normalising weights", () => {
  /*
   * The ridge in the fit is denominated in games and is a constant, so a scheme whose weights
   * averaged a half would hand the fit half the evidence and regress every rating twice as far —
   * and a sweep comparing such schemes would be measuring shrinkage as much as recency.
   */
  it("leaves the average at one, and the ratios alone", () => {
    const out = normalizeWeights([1, 0.5, 0.25]);
    expect(mean(out)).toBeCloseTo(1, 12);
    expect(out[0]! / out[1]!).toBeCloseTo(2, 12);
    expect(out[1]! / out[2]!).toBeCloseTo(2, 12);
  });

  it("treats a scheme with no opinion as no opinion, not as a pool of nothing", () => {
    // All zeros would rate every team exactly average rather than say it cannot tell.
    expect(normalizeWeights([0, 0, 0])).toEqual([1, 1, 1]);
    expect(normalizeWeights([])).toEqual([]);
  });
});

describe("the schemes", () => {
  it("every one of them averages one, on a real season shape", () => {
    const games = seasonShaped();
    const asOf = day("2026-05-01");
    RECENCY_SCHEMES.forEach((scheme) => {
      expect(mean(scheme.weigh(games, asOf))).toBeCloseTo(1, 10);
    });
  });

  it("the control has no opinion at all", () => {
    expect(noDecay.weigh(seasonShaped(), day("2026-05-01"))).toEqual([1, 1, 1, 1, 1]);
  });

  it("gives every scheme a distinct key, so a sweep can name its winner", () => {
    const keys = RECENCY_SCHEMES.map((scheme) => scheme.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("decaying by days", () => {
  it("halves the weight over a half-life", () => {
    const games: DatedRatingGame[] = [
      { at: day("2026-05-01"), home: "A", away: "B" },
      { at: day("2026-05-01") - 60 * DAY, home: "A", away: "C" },
    ];
    const [fresh, old] = byDays(60).weigh(games, day("2026-05-01"));
    expect(fresh! / old!).toBeCloseTo(2, 8);
  });

  /*
   * The winter problem, stated as a test. A squad that played its whole season in the fall is by
   * spring being read almost entirely off the ridge rather than off its results — even though
   * those fall results are the only evidence anybody has about it.
   */
  it("all but erases a fall season by the spring", () => {
    const games = seasonShaped();
    const weights = byDays(60).weigh(games, day("2026-05-01"));
    const fall = mean(weights.slice(0, 3));
    const spring = mean(weights.slice(3));
    // Measured: a September-to-October block read on 1 May weighs about a tenth of an April one.
    expect(fall / spring).toBeCloseTo(0.092, 3);
  });

  it("measures age from the day you are reading, not from the newest game", () => {
    // A pool that stopped two months ago is old, not fresh.
    const games = seasonShaped();
    const soon = byDays(60).weigh(games, day("2026-05-01"));
    const later = byDays(60).weigh(games, day("2026-09-01"));
    // Read later, the fall and spring blocks are both old, so they weigh more alike.
    const spread = (w: number[]) => mean(w.slice(3)) / mean(w.slice(0, 3));
    expect(spread(later)).toBeLessThan(spread(soon));
  });
});

describe("decaying by games since", () => {
  /*
   * The answer to the winter gap. A squad that played twelve games in the fall and none since is
   * being read off twelve recent games, because from that squad's point of view nothing has
   * happened since — time has passed, evidence has not.
   */
  it("does not care how long the break was", () => {
    const games = seasonShaped();
    const spring = byGamesSince(10).weigh(games, day("2026-05-01"));
    const muchLater = byGamesSince(10).weigh(games, day("2027-05-01"));
    expect(spring).toEqual(muchLater);
  });

  it("still leans on what happened most recently", () => {
    const weights = byGamesSince(2).weigh(seasonShaped(), day("2026-05-01"));
    expect(weights[4]!).toBeGreaterThan(weights[0]!);
  });

  it("keeps a game as fresh as the fresher side thinks it is", () => {
    /*
     * A game has two sides and they will disagree: this is B's only game and A's first of four.
     * Reading it as stale because A played on would throw away the half we most wanted — it is
     * everything anybody knows about B.
     */
    const games: DatedRatingGame[] = [
      { at: day("2026-04-01"), home: "A", away: "B" },
      { at: day("2026-04-08"), home: "A", away: "C" },
      { at: day("2026-04-15"), home: "A", away: "D" },
      { at: day("2026-04-22"), home: "A", away: "E" },
    ];
    const weights = byGamesSince(1).weigh(games, day("2026-05-01"));
    // Three games later from A's seat, but B's only game — so it keeps full weight.
    expect(weights[0]!).toBeCloseTo(weights[3]!, 10);
  });
});

describe("decaying by block", () => {
  it("keeps the last block whole and steps the earlier one down", () => {
    const weights = byBlock(0.25).weigh(seasonShaped(), day("2026-05-01"));
    const fall = weights.slice(0, 3);
    const spring = weights.slice(3);
    // One step, not a slide: every game inside a block weighs the same.
    expect(new Set(fall.map((w) => w.toFixed(9))).size).toBe(1);
    expect(new Set(spring.map((w) => w.toFixed(9))).size).toBe(1);
    expect(spring[0]! / fall[0]!).toBeCloseTo(4, 8);
  });

  it("finds no break in a season played straight through", () => {
    const games: DatedRatingGame[] = [0, 14, 28, 42].map((offset) => ({
      at: day("2026-04-01") + offset * DAY,
      home: "A",
      away: "B",
    }));
    expect(byBlock(0.25).weigh(games, day("2026-05-20"))).toEqual([1, 1, 1, 1]);
  });
});

describe("dating a game the way the pool stores it", () => {
  it("reads a full ISO day at noon UTC, so the day is whole in every zone", () => {
    expect(dayInstant("2026-04-11")).toBe(Date.parse("2026-04-11T12:00:00Z"));
  });

  it("refuses anything that is not a full ISO day rather than guessing at it", () => {
    ["4/11", "2026-4-11", "11-04-2026", "", undefined].forEach((value) => {
      expect(Number.isNaN(dayInstant(value))).toBe(true);
    });
  });

  it("orders a squad year correctly, which is the whole reason it is not parseDateValue", () => {
    // August-to-July: the spring must sort AFTER the autumn it followed, not before it.
    expect(dayInstant("2025-09-06")).toBeLessThan(dayInstant("2026-04-11"));
  });
});

describe("weighing a pool's games for the fit", () => {
  /*
   * The same pair every time, on purpose. `byGamesSince` takes the larger of the two sides' weights
   * — a game stays as fresh as the fresher side considers it — so a fixture of one-off opponents
   * gives every game weight 1, because each is somebody's newest. Only a pair that keeps playing
   * ages its own earlier meetings.
   */
  const dated = [
    { date: "2025-09-06", home: "A", away: "B" },
    { date: "2025-09-20", home: "A", away: "B" },
    { date: "2026-04-11", home: "A", away: "B" },
  ];

  it("has no opinion when the scheme has none, so the fit is handed the games unchanged", () => {
    expect(weightsForGames(dated, noDecay)).toBeNull();
  });

  it("has no opinion when no game carries a date it can place", () => {
    expect(
      weightsForGames([
        { home: "A", away: "B" },
        { date: "4/11", home: "A", away: "C" },
      ])
    ).toBeNull();
  });

  it("counts a recent game for more than an old one", () => {
    const weights = weightsForGames(dated, byGamesSince(1))!;
    expect(weights).toHaveLength(3);
    expect(weights[2]!).toBeGreaterThan(weights[0]!);
  });

  it("keeps an undated game at 1 rather than dropping it, and leaves it in place", () => {
    const mixed = [
      { date: "2025-09-06", home: "A", away: "B" },
      { home: "A", away: "C" },
      { date: "2025-09-20", home: "A", away: "B" },
      { date: "2026-04-11", home: "A", away: "B" },
    ];
    const weights = weightsForGames(mixed, byGamesSince(1))!;
    // Same length and same order as the games it was given: a caller indexes it by position.
    expect(weights).toHaveLength(4);
    expect(weights[1]).toBe(1);
    // And the dated games are still weighed against each other, not flattened by the neighbour.
    expect(weights[3]!).toBeGreaterThan(weights[0]!);
  });

  it("weighs a day-based scheme by the gaps between games alone, not by the clock", () => {
    const shifted = dated.map((game) => ({
      ...game,
      date: new Date(day(game.date) + 400 * DAY).toISOString().slice(0, 10),
    }));
    const original = weightsForGames(dated, byDays(90))!;
    const later = weightsForGames(shifted, byDays(90))!;
    expect(later).toHaveLength(original.length);
    later.forEach((weight, i) => expect(weight).toBeCloseTo(original[i]!, 12));
    // And it is weighting: the spring game outweighs the autumn ones by the gap between them.
    expect(original[2]!).toBeGreaterThan(original[0]!);
  });

  it("is a real scheme rather than a no-op, so shipping it changes something", () => {
    expect(ACTIVE_RECENCY_SCHEME.key).not.toBe(noDecay.key);
    expect(RECENCY_SCHEMES.map((scheme) => scheme.key)).toContain(ACTIVE_RECENCY_SCHEME.key);
    // It must be one the sweep can put on trial, or "tune it later" is not actually offered.
    expect(weightsForGames(dated)).not.toBeNull();
  });
});

describe("rebuilding one game's weight from its date", () => {
  /*
   * A device holds a club's games and the board they were rated on, never the pool, so it is
   * handed three numbers (`recencyBasisFor`) and rebuilds each game's weight from them. It is only
   * worth anything if every weight comes back to the bit: the device checks its sums against the
   * board's own numbers and draws nothing if they disagree.
   */
  const crossingWinter = [
    { date: "2022-03-05", home: "A", away: "E" },
    { date: "2025-09-06", home: "A", away: "B" },
    { date: "2025-10-11", home: "A", away: "C" },
    { home: "A", away: "D" },
    { date: "4/11", home: "B", away: "C" },
    { date: "2026-04-11", home: "A", away: "B" },
    { date: "2026-04-25", home: "C", away: "D" },
    { date: "2026-04-25", home: "B", away: "D" },
  ];

  it("gives back every weight the pool's weighing gave, to the bit", () => {
    // A half-life of a day takes the 2022 game's raw weight below the smallest number there is.
    [ACTIVE_RECENCY_SCHEME, byDays(30), byDays(180), byDays(1)].forEach((scheme) => {
      const basis = recencyBasisFor(crossingWinter, scheme);
      const weights = weightsForGames(crossingWinter, scheme);
      expect(basis).not.toBeNull();
      expect(weights).not.toBeNull();
      crossingWinter.forEach(({ date }, at) =>
        expect(recencyWeightOf(date, basis ?? null)).toBe(weights?.[at])
      );
    });
    expect(weightsForGames(crossingWinter, byDays(1))?.[0]).toBe(0);
  });

  it("is the newest game's day, the half-life and the mean it divided by", () => {
    const basis = recencyBasisFor(crossingWinter);
    expect(basis?.newest).toBe("2026-04-25");
    expect(basis?.halfLifeDays).toBe(90);
    // The two games of the newest day weigh the same and the most, one over the mean.
    expect(recencyWeightOf("2026-04-25", basis ?? null)).toBe(1 / (basis?.mean ?? 0));
  });

  it("weighs a day after the newest as the newest, never more than a fresh game", () => {
    const basis = recencyBasisFor(crossingWinter) ?? null;
    expect(recencyWeightOf("2026-06-30", basis)).toBe(recencyWeightOf("2026-04-25", basis));
  });

  it("keeps a game with no date it can place at 1, as the pool's weighing does", () => {
    const basis = recencyBasisFor(crossingWinter) ?? null;
    [undefined, "", "4/11", "2026-4-25"].forEach((date) =>
      expect(recencyWeightOf(date, basis)).toBe(1)
    );
  });

  it("has no basis where the weighing has no opinion, and none to give for a scheme of counts", () => {
    expect(recencyBasisFor(crossingWinter, noDecay)).toBeNull();
    // Counting games since, or blocks of play, reads the rest of the pool: no date alone gives it.
    expect(recencyBasisFor(crossingWinter, byGamesSince(10))).toBeUndefined();
    expect(recencyBasisFor(crossingWinter, byBlock(0.35))).toBeUndefined();
    // No date it can place, so the weighing hands the fit its games unchanged.
    const undated = [
      { home: "A", away: "B" },
      { date: "4/11", home: "A", away: "C" },
    ];
    expect(weightsForGames(undated)).toBeNull();
    expect(recencyBasisFor(undated)).toBeNull();
    // A half-life of nothing weighs every game nothing, which normalising reads as no opinion.
    expect(weightsForGames(crossingWinter, byDays(0))).toEqual(crossingWinter.map(() => 1));
    expect(recencyBasisFor(crossingWinter, byDays(0))).toBeNull();
    // And no basis is every weight 1, a pool fitted unweighted.
    expect(recencyWeightOf("2026-04-25", null)).toBe(1);
  });

  it("rebuilds the weights of every page and half of the fixture from the rated games", () => {
    /*
     * The fixture holds games the fit leaves out that are newer than any it reads: scores on a day
     * still to come, and the spring when the fall is fitted. So the basis has to be read off the
     * rated games, and one read off the pool's every game would not give the fit's weights back.
     */
    const { teams, games, ageGroups } = poolFixture({ seed: 7, clubsPerPage: 300 });
    const asFitted = (rated: readonly ScoutGame[]) =>
      weightsForGames(
        rated.map((game) => ({ date: game.date, home: game.teamAId, away: game.teamBId }))
      );
    const missed = (rated: readonly ScoutGame[], basis: RecencyBasis | null) => {
      const weights = asFitted(rated);
      return rated.filter((game, at) => recencyWeightOf(game.date, basis) !== (weights?.[at] ?? 1))
        .length;
    };
    let checked = 0;
    let missedFromPool = 0;
    ageGroups.forEach((group) =>
      ([undefined, "fall", "spring"] as const).forEach((segment: SeasonSegment | undefined) => {
        const rated = scoutRatingGames(
          group.id,
          teams,
          games,
          ageGroups,
          segment,
          FIXTURE_TODAY
        ).map(({ game }) => game);
        const basis = recencyBasisFor(rated);
        expect(basis).not.toBeUndefined();
        expect(missed(rated, basis ?? null), `${group.id} ${segment ?? "year"}`).toBe(0);
        checked += rated.length;
        missedFromPool += missed(rated, recencyBasisFor(games) ?? null);
      })
    );
    expect(checked).toBe(68004);
    expect(missedFromPool).toBeGreaterThan(0);
  });
});
