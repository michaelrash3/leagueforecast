import { describe, expect, it } from "vitest";
import {
  byBlock,
  byDays,
  byGamesSince,
  noDecay,
  normalizeWeights,
  RECENCY_SCHEMES,
  type DatedRatingGame,
} from "../ratingRecency";

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
