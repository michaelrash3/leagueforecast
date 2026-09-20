import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildTeamRankings,
  RATING_CAP,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import { holdsFrom, whatIfCurve, whatIfDecline } from "../scoutWhatIf";

/**
 * A day inside the autumn of baseball year 2027, which is where this file's clock sits. Every
 * played game is behind it and every fixture ahead of it, which is what an upcoming game is.
 */
const TODAY = "2026-10-15";
const FIXTURE_DAY = "2026-11-01";
const SPRING_DAY = "2027-03-19";

/*
 * The clock this file reasons from.
 *
 * Every fixture here is dated ahead of it — that is what an upcoming game is — and
 * `buildTeamRankings` reads the wall clock when nobody tells it otherwise. Read against the real
 * one the hypothetical would be a game on a day that has not happened, which the selection drops,
 * and the "real re-fit" this file compares against would quietly be the baseline.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
});
afterAll(() => vi.useRealTimers());

const GROUPS: AgeGroup[] = [
  { id: "ag_9u_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
];
const AG = "ag_9u_2027";

/** A pool of `n` clubs on a strength ladder, each playing near neighbours. Seeded, so it is the
 *  same pool every run and a pinned number stays pinned. */
const ladder = (n: number): { teams: ScoutTeam[]; games: ScoutGame[] } => {
  let seed = 20260920;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const teams: ScoutTeam[] = Array.from({ length: n }, (_, i) => ({
    id: `T${i}`,
    name: `Club ${i}`,
  }));
  const strength = teams.map((_, i) => (i / n - 0.5) * -10);
  const games: ScoutGame[] = [];
  let g = 0;
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < 6; k += 1) {
      const j = Math.max(0, Math.min(n - 1, i + 1 + Math.floor(rnd() * 12)));
      if (j === i) continue;
      const drawn = Math.round(strength[i]! - strength[j]! + (rnd() - 0.5) * 7);
      const margin = drawn === 0 ? 1 : drawn;
      games.push({
        id: `g${g++}`,
        ageGroupId: AG,
        teamAId: `T${i}`,
        teamBId: `T${j}`,
        teamAScore: 5 + Math.max(0, margin),
        teamBScore: 5 + Math.max(0, -margin),
        date: "2026-09-12",
      });
    }
  }
  return { teams, games };
};

const POOL = ladder(120);
/** The club the whole file asks about, and an opponent it has not yet played. */
const ME = "T60";
const THEM = "T40";

const fixture = (extra: Partial<ScoutGame> = {}): ScoutGame => ({
  id: "next-up",
  ageGroupId: AG,
  teamAId: ME,
  teamBId: THEM,
  date: FIXTURE_DAY,
  ...extra,
});

const curveFor = (
  game: ScoutGame,
  segment?: "fall" | "spring",
  pool: { teams: ScoutTeam[]; games: ScoutGame[] } = POOL
) => whatIfCurve(game, ME, AG, pool.teams, pool.games, undefined, GROUPS, segment, TODAY);

const declineFor = (
  game: ScoutGame,
  segment?: "fall" | "spring",
  pool: { teams: ScoutTeam[]; games: ScoutGame[] } = POOL
) => whatIfDecline(game, ME, AG, pool.teams, pool.games, GROUPS, segment, TODAY);

/** Where the club stands before any of this. */
const liveRank = () =>
  buildTeamRankings(AG, POOL.teams, POOL.games, undefined, GROUPS).find((row) => row.teamId === ME)!
    .rank;

/** The board with the fixture genuinely played at `margin`, dated today. The what-if's answer has
 *  to equal this, because this is the thing it claims to predict. */
const reallyPlayed = (margin: number) => {
  const played: ScoutGame = {
    ...fixture(),
    date: TODAY,
    teamAScore: 5 + Math.max(0, margin),
    teamBScore: 5 + Math.max(0, -margin),
  };
  return buildTeamRankings(AG, POOL.teams, [...POOL.games, played], undefined, GROUPS).find(
    (row) => row.teamId === ME
  )!;
};

describe("the what-if curve", () => {
  /*
   * The pin. These are the numbers the feature shows, on a pool that cannot drift, written in the
   * commit that creates them. A later change to the fit, the margin cap, the recency scheme or the
   * evidence discount shows up here as a diff that has to be explained rather than as a table that
   * quietly says something else.
   */
  it("is this, to the digit", () => {
    const curve = curveFor(fixture())!;
    expect(curve.points.map((point) => [point.margin, point.rank])).toEqual([
      [-8, 104],
      [-7, 103],
      [-6, 101],
      [-5, 98],
      [-4, 94],
      [-3, 85],
      [-2, 78],
      [-1, 74],
      [1, 57],
      [2, 52],
      [3, 47],
      [4, 42],
      [5, 38],
      [6, 31],
      [7, 26],
      [8, 21],
    ]);
    expect(curve.winRecord).toBe("7-5");
    expect(curve.lossRecord).toBe("6-6");
    expect(curve.rankedCount).toBe(120);
    expect(curve.points.find((point) => point.margin === 3)!.rating).toBeCloseTo(0.1992, 4);
  });

  /*
   * The curve is two fits and fourteen straight lines. This is the assertion that the lines are
   * where the fits would have been: both ends and a point in the middle, each against a board
   * built by actually playing the game.
   */
  it("lands where a real re-fit lands, at both ends and in between", () => {
    const curve = curveFor(fixture())!;
    for (const margin of [-RATING_CAP, -3, 3, RATING_CAP]) {
      const point = curve.points.find((one) => one.margin === margin)!;
      const truth = reallyPlayed(margin);
      expect(point.rank).toBe(truth.rank);
      expect(point.rating).toBeCloseTo(truth.rating, 2);
    }
  });

  it("counts a fixture that has not been played yet", () => {
    // The trap this whole module is shaped around: a hypothetical carries a score on a day that
    // has not happened, which is the one shape `countsTowardRating` exists to reject. If the copy
    // kept the fixture's own date every point would collapse onto the club's live rank.
    const curve = curveFor(fixture())!;
    // Some single margin may well leave the club exactly where it stands. What cannot happen is
    // the whole curve sitting on the live rank, which is precisely what a dropped hypothetical
    // looks like: sixteen identical answers.
    const live = liveRank();
    expect(curve.points.every((point) => point.rank === live)).toBe(false);
    expect(curve.points[0]!.rank).toBeGreaterThan(live);
    expect(curve.points[curve.points.length - 1]!.rank).toBeLessThan(live);
  });

  it("never offers a tie", () => {
    const curve = curveFor(fixture())!;
    expect(curve.points.some((point) => point.margin === 0)).toBe(false);
    expect(curve.winRecord).not.toMatch(/-\d+-/);
    expect(curve.lossRecord).not.toMatch(/-\d+-/);
  });

  it("can show a loss that costs nothing, because a game is also evidence", () => {
    // Not a curiosity — it is the most interesting thing the feature says, and it is why the panel
    // must not paint losses red. A narrow loss to a stronger club adds a result against good
    // opposition and one more game for the rating to stand on.
    const thin = ladder(40);
    // Keep only three of this club's games, so its rating is carrying very little.
    let kept = 0;
    thin.games = thin.games.filter((game) => {
      if (game.teamAId !== "T20" && game.teamBId !== "T20") return true;
      kept += 1;
      return kept <= 3;
    });
    const before = buildTeamRankings(AG, thin.teams, thin.games, undefined, GROUPS).find(
      (row) => row.teamId === "T20"
    )!.rank;
    const narrowLoss = whatIfCurve(
      { id: "x", ageGroupId: AG, teamAId: "T20", teamBId: "T0", date: FIXTURE_DAY },
      "T20",
      AG,
      thin.teams,
      thin.games,
      undefined,
      GROUPS,
      undefined,
      TODAY
    )!.points.find((point) => point.margin === -1)!;
    expect(narrowLoss.rank).toBeLessThanOrEqual(before);
  });
});

describe("the fixtures a what-if will not answer for", () => {
  it("refuses the other half of the year, judged on the fixture's own date", () => {
    // The copy the fit is shown is dated today, which is in the autumn — so only the fixture's own
    // date can say that this game belongs to the spring.
    expect(declineFor(fixture({ date: SPRING_DAY }), "fall")).toBe("other-half");
    expect(curveFor(fixture({ date: SPRING_DAY }), "fall")).toBeNull();
  });

  it("refuses a dateless fixture on a half board, and allows it on the whole year", () => {
    expect(declineFor(fixture({ date: undefined }), "fall")).toBe("no-date");
    expect(declineFor(fixture({ date: undefined }))).toBeNull();
  });

  it("refuses an opponent nobody has played, because a result would grow the table", () => {
    const withStranger = {
      teams: [...POOL.teams, { id: "T-NEW", name: "Nobody has played them" }],
      games: POOL.games,
    };
    expect(declineFor(fixture({ teamBId: "T-NEW" }), undefined, withStranger)).toBe(
      "unrated-opponent"
    );
  });

  it("refuses a game that is already played, one marked not to count, and one against itself", () => {
    expect(declineFor(fixture({ teamAScore: 6, teamBScore: 2 }))).toBe("played");
    expect(declineFor(fixture({ excluded: true }))).toBe("excluded");
    expect(declineFor(fixture({ teamBId: ME }))).toBe("self");
  });

  it("allows an ordinary upcoming fixture", () => {
    expect(declineFor(fixture())).toBeNull();
    expect(declineFor(fixture(), "fall")).toBeNull();
  });
});

describe("the narrowest win that holds a place", () => {
  it("counts a win that lands exactly on the current place as holding it", () => {
    const curve = curveFor(fixture())!;
    const exact = curve.points.find((point) => point.margin > 0)!;
    expect(holdsFrom(curve, exact.rank)).toBe(exact.margin);
  });

  it("says so when no win up to the cap can hold the place", () => {
    const curve = curveFor(fixture())!;
    expect(holdsFrom(curve, 1)).toBeNull();
  });
});
