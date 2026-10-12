import { describe, expect, it, vi } from "vitest";
import { NO_REMOVALS } from "../../autoRemoved";
import { FIXTURE_TODAY, poolFixture } from "../../../../scripts/poolFixture";
import { DEFAULT_SHRINKAGE } from "../../powerRating";
import { weightsForGames, recencyBasisFor, recencyWeightOf } from "../../ratingRecency";
import {
  ageGroupYear,
  EVIDENCE_STANDARD_ERRORS,
  fitScoutYearFor,
  RATING_CAP,
  rankingPoolGroupIds,
  rowsOfYearFit,
  type AgeGroup,
  type ScoutGame,
  type ScoutYearFit,
} from "../../teamRankings";
import { deriveAllKnown, gamesOnPages, type SeasonReader } from "../allKnown";
import {
  asWorkerSees,
  BOARD_FIT_VERSION,
  BOARD_HALVES,
  boardFitOf,
  boardViews,
  buildBoardsAndFacts,
  coerceBoardFit,
  coerceBoardView,
  type BoardFit,
  type PageBoard,
} from "../views/board";

/**
 * What each board carries of the fit its rows were cut from (`boardFitOf`, `BoardFit`): the fit's
 * constants, the basis of its games' weights, and every side a row's rated game names that has no
 * row on the board, with its fitted rating and its rated games. A device works out what each of a
 * club's games did from this and the club's card alone, so every number here is held to the fit
 * itself, on every page and span of the seeded fixture.
 */

/**
 * `recencyBasisFor`, as the module has it unless a test says there is no basis to give: what the
 * active scheme would say were it not by days.
 */
const scheme = vi.hoisted(() => ({ byDays: true }));
vi.mock("../../ratingRecency", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../ratingRecency")>();
  return {
    ...real,
    recencyBasisFor: (...args: Parameters<typeof real.recencyBasisFor>) =>
      scheme.byDays ? real.recencyBasisFor(...args) : undefined,
  };
});

const fixture = poolFixture({ seed: 7, clubsPerPage: 120 });
const { ageGroups, teams } = fixture;
const NOTHING = { teams: [], matchups: [], logs: {} };
const readSeason: SeasonReader = (id) => fixture.seasons[id] ?? NOTHING;
const gamesOfYear = (year: number | undefined): ScoutGame[] =>
  fixture.games.filter(
    (game) =>
      ageGroupYear(ageGroups.find((group: AgeGroup) => group.id === game.ageGroupId)) === year
  );
const built = buildBoardsAndFacts({
  autoRemoved: NO_REMOVALS,
  ageGroups,
  teams,
  gamesOfYear,
  readSeason,
  today: FIXTURE_TODAY,
});

/** The fit a board was cut from, fitted again here as the builder fits the page's pool. */
const fitOf = (board: PageBoard): ScoutYearFit | null => {
  const page = ageGroups.find((group) => group.id === board.pageId);
  const year = ageGroupYear(page);
  const known = deriveAllKnown({
    ageGroups,
    teams,
    yearGames: gamesOfYear(year),
    readSeason,
    autoRemoved: NO_REMOVALS,
  });
  const pool = asWorkerSees(
    known.teams,
    gamesOnPages(known.games, rankingPoolGroupIds(board.pageId, ageGroups))
  );
  const segment = BOARD_HALVES.find(({ half }) => half === board.half)?.segment;
  return fitScoutYearFor(board.pageId, pool.teams, pool.games, ageGroups, segment, FIXTURE_TODAY);
};

/** Each board with rows, beside its fit. */
const fitted = built.boards
  .filter((board) => board.rows.length > 0)
  .map((board) => {
    const fit = fitOf(board);
    if (!fit) throw new Error(`no fit for ${board.pageId} ${board.half}`);
    return { board, fit };
  });

/** A board's fit, which every board with rows carries. */
const fitIn = (board: PageBoard): BoardFit => {
  if (!board.fit) throw new Error(`${board.pageId} ${board.half} carries no fit`);
  return board.fit;
};

describe("what each board carries of its fit", () => {
  it("is on every board with rows and no other, for every page and span", () => {
    expect(built.boards).toHaveLength(33);
    // Enough of each that a rule holding on all of them says something.
    expect(fitted.length).toBeGreaterThanOrEqual(15);
    expect(built.boards.some((board) => board.rows.length === 0)).toBe(true);
    for (const board of built.boards) {
      expect(board.fit !== undefined, `${board.pageId} ${board.half}`).toBe(board.rows.length > 0);
    }
  });

  it("is cut from the very fit the board's rows were", () => {
    for (const { board, fit } of fitted) {
      const rows = rowsOfYearFit(fit, board.pageId, undefined, ageGroups);
      expect(board.rows.map((row) => [row.teamId, row.pointRating, row.rating])).toEqual(
        rows.map((row) => [row.teamId, row.pointRating, row.rating])
      );
    }
  });

  it("names exactly the sides off the board that the rows' rated games name", () => {
    const kinds = { nameOnly: 0, standIn: 0, otherPage: 0 };
    const byId = new Map(teams.map((team) => [team.id, team]));
    for (const { board, fit } of fitted) {
      // Each row's own opponents, walked club by club, rather than the builder's one pass.
      const opponents = new Map<string, string[]>();
      const meet = (id: string, other: string) =>
        opponents.set(id, [...(opponents.get(id) ?? []), other]);
      fit.rated.forEach(({ game }) => {
        meet(game.teamAId, game.teamBId);
        meet(game.teamBId, game.teamAId);
      });
      const rows = new Set(board.rows.map((row) => row.teamId));
      const expected = new Set<string>();
      for (const id of rows) {
        for (const other of opponents.get(id) ?? []) if (!rows.has(other)) expected.add(other);
      }
      const { away } = fitIn(board);
      expect(new Set(away.ids).size).toBe(away.ids.length);
      expect([...away.ids].sort()).toEqual([...expected].sort());
      for (const id of away.ids) {
        const team = byId.get(id);
        if (team?.nameOnly) kinds.nameOnly += 1;
        else if (team?.placeholder) kinds.standIn += 1;
        else kinds.otherPage += 1;
      }
    }
    // Every kind of side away is there to be named, so leaving one out fails.
    expect(kinds.nameOnly).toBeGreaterThan(0);
    expect(kinds.standIn).toBeGreaterThan(0);
    expect(kinds.otherPage).toBeGreaterThan(0);
  });

  it("gives each side away its fitted rating to within 5e-5 and its rated games", () => {
    let largest = 0;
    for (const { board, fit } of fitted) {
      const { away } = fitIn(board);
      expect(away.ratings).toHaveLength(away.ids.length);
      expect(away.games).toHaveLength(away.ids.length);
      away.ids.forEach((id, at) => {
        const error = Math.abs(
          (away.ratings[at] ?? Number.NaN) - (fit.adjusted.ratings.get(id) ?? 0)
        );
        largest = Math.max(largest, error);
        expect(error).toBeLessThanOrEqual(5e-5);
        expect(away.games[at]).toBe(fit.adjusted.games.get(id));
      });
    }
    // Rounded, not cut: some rating is off by more than half the next place.
    expect(largest).toBeGreaterThan(5e-6);
  });

  it("gives a side whose rating rounds to nothing 0, which reads back through JSON as itself", () => {
    const first = fitted[0];
    if (!first) throw new Error("no board has rows");
    const { board, fit } = first;
    const side = fitIn(board).away.ids[0];
    if (!side) throw new Error("no side away");
    // A fit like it but for that side's rating, just below nothing: 4 places make it -0 unless told.
    const ratings = new Map(fit.adjusted.ratings).set(side, -4e-5);
    const nudged = { ...fit, adjusted: { ...fit.adjusted, ratings } };
    const carried = boardFitOf(nudged, board.rows, FIXTURE_TODAY);
    expect(Object.is(carried?.away.ratings[0], 0)).toBe(true);
    expect(JSON.parse(JSON.stringify(carried))).toEqual(carried);
  });

  it("says the fit's own constants and day, which give back every row's shown rating to the last digit", () => {
    for (const { board, fit } of fitted) {
      const carried = fitIn(board);
      expect(carried).toMatchObject({
        v: BOARD_FIT_VERSION,
        day: FIXTURE_TODAY,
        errors: EVIDENCE_STANDARD_ERRORS,
        cap: RATING_CAP,
        shrink: DEFAULT_SHRINKAGE,
      });
      expect(carried.scale).toBe(fit.adjusted.residualScale);
      expect(carried.middle).toBe(fit.middle);
      expect(carried.gapRuns).toBe(fit.adjusted.ageGapRuns);
      expect(carried.cap).toBe(fit.adjusted.cap);
      // The discount from the fit's rating to the shown one, from these numbers alone.
      for (const row of board.rows) {
        const effective = fit.effective.get(row.teamId) ?? 0;
        const spread = carried.scale / Math.sqrt(Math.max(0, effective) + carried.shrink);
        expect(row.pointRating - carried.errors * (spread - carried.middle)).toBe(row.rating);
      }
    }
  });

  it("says what every game's weight was built from, so each is rebuilt exactly from its date", () => {
    let weighed = 0;
    for (const { board, fit } of fitted) {
      const { recency } = fitIn(board);
      expect(recency).toEqual(recencyBasisFor(fit.rated.map(({ game }) => game)));
      // Every game weighs 1 where the fit weighed none, as a fit whose games carry no date does.
      const weights = weightsForGames(
        fit.rated.map(({ game }) => ({ date: game.date, home: game.teamAId, away: game.teamBId }))
      );
      expect(recency === null).toBe(weights === null);
      fit.rated.forEach(({ game }, at) => {
        expect(recencyWeightOf(game.date, recency)).toBe(weights ? weights[at] : 1);
        if (weights) weighed += 1;
      });
    }
    expect(weighed).toBeGreaterThan(1000);
  });

  it("is the same on boards built with last week's places and rank lines and without", () => {
    const bare = buildBoardsAndFacts({
      autoRemoved: NO_REMOVALS,
      ageGroups,
      teams,
      gamesOfYear,
      readSeason,
      today: FIXTURE_TODAY,
      past: false,
    });
    expect(bare.boards.map((board) => board.fit)).toEqual(built.boards.map((board) => board.fit));
    // The page that names its own club takes the return with a rank line.
    expect(built.boards.some((board) => board.history && board.fit)).toBe(true);
    expect(built.boards.some((board) => !board.history && board.past && board.fit)).toBe(true);
  });

  it("is left off a board with no rows, and off any board whose weights no date can rebuild", () => {
    const first = fitted[0];
    if (!first) throw new Error("no board has rows");
    const { board, fit } = first;
    expect(boardFitOf(fit, [], FIXTURE_TODAY)).toBeUndefined();
    expect(boardFitOf(fit, board.rows, FIXTURE_TODAY)).toEqual(board.fit);
    // A fit the builder has not seen, so no basis is held for it.
    const fresh = fitOf(board);
    if (!fresh) throw new Error("no fit");
    scheme.byDays = false;
    try {
      expect(boardFitOf(fresh, board.rows, FIXTURE_TODAY)).toBeUndefined();
    } finally {
      scheme.byDays = true;
    }
  });
});

describe("a board's fit as published and read back", () => {
  const views = boardViews(ageGroups, built);
  const withFit = views.filter(({ value }) => value.fit);

  it("is written beside the rows, and kept through JSON and the board's check", () => {
    expect(withFit).toHaveLength(fitted.length);
    views.forEach(({ value }, at) => expect(value.fit).toEqual(built.boards[at]?.fit));
    for (const { value } of withFit) {
      expect(coerceBoardView(JSON.parse(JSON.stringify(value)))).toEqual(value);
    }
  });

  const sample = withFit[0]?.value;
  if (!sample?.fit) throw new Error("no board carries a fit");
  const good = JSON.parse(JSON.stringify(sample.fit)) as BoardFit;
  const { away } = good;

  it("reads a fit with no weights, and lists of nothing away", () => {
    const plain = { ...good, recency: null, away: { ids: [], ratings: [], games: [] } };
    expect(coerceBoardFit(plain)).toEqual(plain);
  });

  /** A fit whose damage is `damaged`, and the board it came on read back without it. */
  const dropped = (damaged: unknown) => {
    expect(coerceBoardFit(damaged)).toBeNull();
    const raw = JSON.parse(JSON.stringify({ ...sample, fit: damaged })) as unknown;
    const { fit: _fit, ...rest } = sample;
    expect(coerceBoardView(raw)).toEqual(JSON.parse(JSON.stringify(rest)));
  };

  it.each<[string, unknown]>([
    ["another version", { ...good, v: BOARD_FIT_VERSION + 1 }],
    ["no version", { ...good, v: undefined }],
    ["no day", { ...good, day: undefined }],
    ["a day that is not an ISO day", { ...good, day: "4/15/2027" }],
    ["a scale that is not a number", { ...good, scale: null }],
    ["a centre that is not finite", { ...good, middle: Number.POSITIVE_INFINITY }],
    ["no standard errors", { ...good, errors: undefined }],
    ["an age gap in words", { ...good, gapRuns: "2" }],
    ["no cap", { ...good, cap: undefined }],
    ["no ridge", { ...good, shrink: undefined }],
    ["no weights said either way", { ...good, recency: undefined }],
    ["a newest game on no ISO day", { ...good, recency: { ...good.recency, newest: "soon" } }],
    ["a mean weight of nothing", { ...good, recency: { ...good.recency, mean: 0 } }],
    ["a half-life of nothing", { ...good, recency: { ...good.recency, halfLifeDays: 0 } }],
    ["no sides away", { ...good, away: undefined }],
    ["a list in place of a record", [good]],
  ])("is dropped with %s, the board read without it", (_case, damaged) => {
    dropped(damaged);
  });

  it.each<[string, unknown]>([
    ["one rating short", { ...away, ratings: away.ratings.slice(1) }],
    ["one count short", { ...away, games: away.games.slice(1) }],
    ["no ids", { ...away, ids: undefined }],
    ["an empty id", { ...away, ids: ["", ...away.ids.slice(1)] }],
    ["a rating in words", { ...away, ratings: ["1.5", ...away.ratings.slice(1)] }],
    ["a side with no games", { ...away, games: [0, ...away.games.slice(1)] }],
    ["a part of a game", { ...away, games: [1.5, ...away.games.slice(1)] }],
  ])("is dropped with %s among the sides away, the board read without it", (_case, damaged) => {
    dropped({ ...good, away: damaged });
  });
});
