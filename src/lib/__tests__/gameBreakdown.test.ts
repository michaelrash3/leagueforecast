import { describe, expect, it } from "vitest";
import { FIXTURE_TODAY, mulberry32, poolFixture } from "../../../scripts/poolFixture";
import { gameBreakdown, type Breakdown, type GameLine } from "../gameBreakdown";
import { boardFitOf } from "../live/views/board";
import {
  BOARD_FIT_VERSION,
  coerceBoardView,
  type BoardFit,
  type BoardView,
} from "../live/views/boardShape";
import { cardGamesOf } from "../live/views/clubs";
import { buildOpponentAdjustedRatings, byRating } from "../powerRating";
import { weightsForGames } from "../ratingRecency";
import { startingLevels } from "../scheduleCommunities";
import {
  effectiveGames,
  fitScoutYearFor,
  RATING_CAP,
  ratedMargin,
  rowsOfYearFit,
  SCOUT_SHRINKAGE,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
  type ScoutYearFit,
  type SeasonSegment,
} from "../teamRankings";

/**
 * What each of a club's games did to its rating, worked out from the club's card and the board on
 * screen alone (`gameBreakdown`), held to the fit the board was cut from: on small pools drawn by
 * hand, where every case is placed on purpose, and on the seeded fixture against exact
 * leave-one-out refits.
 */

const DAY = "2027-04-15";
const SPANS: ReadonlyArray<SeasonSegment | undefined> = [undefined, "fall", "spring"];

/** A board as a device holds it: built as the publisher builds it, then through JSON and its check. */
const boardOf = (fit: ScoutYearFit, pageId: string, ageGroups: AgeGroup[]): BoardView => {
  const rows = rowsOfYearFit(fit, pageId, undefined, ageGroups);
  const carried = boardFitOf(fit, rows, DAY);
  const published = {
    rows: rows.map(({ isMine: _mine, ...row }) => row),
    ...(carried ? { fit: carried } : {}),
  };
  const read = coerceBoardView(JSON.parse(JSON.stringify(published)));
  if (!read) throw new Error("the board does not read back");
  return read;
};

/** The board of page `pageId` over `segment` in a pool, with the fit it was cut from. */
const boardIn = (
  pool: { teams: ScoutTeam[]; games: ScoutGame[]; ageGroups: AgeGroup[] },
  pageId: string,
  segment: SeasonSegment | undefined,
  day = DAY
) => {
  const fit = fitScoutYearFor(pageId, pool.teams, pool.games, pool.ageGroups, segment, day);
  if (!fit) throw new Error(`no fit for ${pageId}`);
  return { fit, board: boardOf(fit, pageId, pool.ageGroups) };
};

/** The fit's own played-like rating for each of a club's rated games, by the game's id. */
const playedLikeOf = (fit: ScoutYearFit, teamId: string): Map<string, number> => {
  const out = new Map<string, number>();
  for (const { game, ageGap } of fit.rated) {
    if (game.teamAId !== teamId && game.teamBId !== teamId) continue;
    const side = game.teamAId === teamId ? 1 : -1;
    const opponent = side === 1 ? game.teamBId : game.teamAId;
    const margin = Math.max(-RATING_CAP, Math.min(RATING_CAP, ratedMargin(game) ?? Number.NaN));
    const y = margin - ageGap * fit.adjusted.ageGapRuns;
    out.set(game.id, (fit.adjusted.ratings.get(opponent) ?? Number.NaN) + side * y);
  }
  return out;
};

/**
 * The club's rating with game `gameId` refitted away, every other game's weight and every club's
 * starting level held as they were, on the boards' own ridge (`SCOUT_SHRINKAGE`): the score part is
 * what the game's margin did to the fit, and a start is read off the schedule, not off a margin.
 */
const ratingWithout = (fit: ScoutYearFit, gameId: string, teamId: string): number => {
  const weights = weightsForGames(
    fit.rated.map(({ game }) => ({ date: game.date, home: game.teamAId, away: game.teamBId }))
  );
  const games = fit.rated.flatMap(({ game, ageGap }, at) =>
    game.id === gameId
      ? []
      : [
          {
            home: game.teamAId,
            away: game.teamBId,
            homeMargin: ratedMargin(game) ?? Number.NaN,
            neutral: true,
            ...(ageGap ? { ageGap } : {}),
            ...(weights ? { weight: weights[at] ?? 1 } : {}),
          },
        ]
  );
  const refit = buildOpponentAdjustedRatings(
    fit.nodes.map((team) => team.id),
    games,
    { cap: RATING_CAP, shrinkage: SCOUT_SHRINKAGE, priorCentre: startingLevels(fit.communities) }
  );
  return refit.ratings.get(teamId) ?? Number.NaN;
};

/**
 * The club's evidence (`effectiveGames`) with game `gameId` taken out, counted again from the fit's
 * rated games with every side's games recounted without it.
 */
const evidenceWithout = (fit: ScoutYearFit, gameId: string, teamId: string): number => {
  const kept = fit.rated.filter(({ game }) => game.id !== gameId);
  const games = new Map<string, number>();
  for (const { game } of kept) {
    games.set(game.teamAId, (games.get(game.teamAId) ?? 0) + 1);
    games.set(game.teamBId, (games.get(game.teamBId) ?? 0) + 1);
  }
  const pairs = kept.map(({ game }) => [game.teamAId, game.teamBId] as const);
  return effectiveGames({ games }, pairs).get(teamId) ?? 0;
};

const lineOf = (breakdown: Breakdown | null, gameId: string): GameLine => {
  const line = breakdown?.lines.get(gameId);
  if (!line) throw new Error(`no line for ${gameId}`);
  return line;
};

// ---------- A pool drawn by hand ----------

const groups: AgeGroup[] = [
  { id: "ag_9u", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag_10u", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const club = (id: string): ScoutTeam => ({ id, name: `${id} Club` });
const handTeams: ScoutTeam[] = [
  ...["A", "B", "C", "D", "E", "F", "J", "K"].map(club),
  { id: "N", name: "Rivals", nameOnly: true },
  { id: "S", name: "Winner of Game 3", placeholder: true },
];
const game = (
  id: string,
  teamAId: string,
  teamAScore: number | undefined,
  teamBId: string,
  teamBScore: number | undefined,
  date: string | undefined,
  more: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  teamAId,
  teamBId,
  ageGroupId: "ag_10u",
  ...(teamAScore === undefined ? {} : { teamAScore }),
  ...(teamBScore === undefined ? {} : { teamBScore }),
  ...(date === undefined ? {} : { date }),
  ...more,
});
const handGames: ScoutGame[] = [
  // A 15-1 rout, counted as a 12-run win.
  game("rout", "A", 15, "B", 1, "2026-09-12"),
  // A and C meet twice, once from each side.
  game("ac1", "A", 6, "C", 4, "2026-10-03"),
  game("ac2", "C", 7, "A", 5, "2027-03-20"),
  // D's own schedule says 5-8 where C's says 8-3: the fit reads the game at the average, C by 4.
  game("disputed", "C", 8, "D", 3, "2027-02-14", {
    reportedByB: { teamAScore: 8, teamBScore: 5 },
  }),
  // No date: in the year, in neither half, weighed 1.
  game("undated", "E", 4, "F", 4, undefined),
  // J, a 9U club, playing up against C.
  game("up", "C", 9, "J", 2, "2026-11-07", { ageLevelA: 10, ageLevelB: 9 }),
  game("nine", "J", 3, "K", 5, "2026-10-10", { ageGroupId: "ag_9u" }),
  // Against a club known only from this schedule, and against a stand-in.
  game("rival", "A", 7, "N", 2, "2027-04-01"),
  game("slot", "B", 10, "S", 0, "2026-09-20"),
  game("de", "D", 3, "E", 5, "2027-01-17"),
  game("fb", "F", 2, "B", 9, "2027-03-07"),
  game("ea", "E", 6, "A", 1, "2026-12-05"),
  game("df", "D", 4, "F", 4, "2026-08-22"),
  game("bc", "B", 3, "C", 2, "2027-04-12"),
  // Nothing the fit reads: a game still to come, one scored ahead of its day, one set not to
  // count, a club's game against its own name, and one against a side the roster does not hold.
  game("later", "A", undefined, "D", undefined, "2027-05-01"),
  game("ahead", "A", 9, "D", 0, "2027-05-02"),
  game("struck", "B", 4, "C", 1, "2027-02-02", { excluded: true }),
  game("itself", "C", 3, "C", 2, "2027-01-09"),
  game("ghost", "A", 3, "Z", 1, "2027-02-27"),
];
const hand = { teams: handTeams, games: handGames, ageGroups: groups };

describe("what each game did, on a pool drawn by hand", () => {
  it("gives every club with a row its lines, exactly the games the fit read, each played like the fit's", () => {
    let boards = 0;
    for (const pageId of ["ag_10u", "ag_9u"]) {
      for (const segment of SPANS) {
        const { fit, board } = boardIn(hand, pageId, segment);
        if (board.rows.length === 0) continue;
        boards += 1;
        for (const row of board.rows) {
          const at = `${row.teamId} on ${pageId} ${segment ?? "year"}`;
          const breakdown = gameBreakdown({
            teamId: row.teamId,
            games: cardGamesOf(handGames, row.teamId),
            pageId,
            ageGroups: groups,
            segment,
            board,
          });
          expect(breakdown, at).not.toBeNull();
          expect(breakdown?.rating, at).toBe(row.rating);
          expect(breakdown?.pointRating, at).toBe(row.pointRating);
          const expected = playedLikeOf(fit, row.teamId);
          expect([...(breakdown?.lines.keys() ?? [])].sort(), at).toEqual(
            [...expected.keys()].sort()
          );
          for (const [id, playedLike] of expected) {
            expect(
              Math.abs(lineOf(breakdown, id).playedLike - playedLike),
              `${at} ${id}`
            ).toBeLessThan(1e-4);
          }
        }
      }
    }
    expect(boards).toBe(5);
  });

  const { board } = boardIn(hand, "ag_10u", undefined);
  const of = (teamId: string) =>
    gameBreakdown({
      teamId,
      games: cardGamesOf(handGames, teamId),
      pageId: "ag_10u",
      ageGroups: groups,
      segment: undefined,
      board,
    });

  it("counts a rout as the cap, from both sides", () => {
    expect(lineOf(of("A"), "rout")).toMatchObject({ counted: 12, margin: 14, shownMargin: 14 });
    expect(lineOf(of("B"), "rout")).toMatchObject({ counted: -12, margin: -14, shownMargin: -14 });
  });

  it("counts a game the two schedules scored apart at the average, and shows each its own", () => {
    expect(lineOf(of("C"), "disputed")).toMatchObject({ counted: 4, margin: 4, shownMargin: 5 });
    expect(lineOf(of("D"), "disputed")).toMatchObject({ counted: -4, margin: -4, shownMargin: -3 });
  });

  it("adds the runs a year up is worth for the younger club and takes them off the older", () => {
    // J has no row here: it is at home on the 9U page, and this board carries it as a side away.
    expect(board.rows.some((row) => row.teamId === "J")).toBe(false);
    expect(board.fit?.away.ids).toContain("J");
    // 9U against 10U: one year, worth four runs at that age (`AGE_STEP_RUNS`).
    expect(lineOf(of("C"), "up")).toMatchObject({ counted: 7, ageRuns: 4, levelsUp: -1 });
    const { board: nine } = boardIn(hand, "ag_9u", undefined);
    const j = gameBreakdown({
      teamId: "J",
      games: cardGamesOf(handGames, "J"),
      pageId: "ag_9u",
      ageGroups: groups,
      segment: undefined,
      board: nine,
    });
    expect(lineOf(j, "up")).toMatchObject({ counted: -7, ageRuns: -4, levelsUp: 1 });
  });

  it("reads an undated game and both meetings of a repeat, and leaves alone what the fit did not read", () => {
    expect(of("E")?.lines.has("undated")).toBe(true);
    expect(lineOf(of("A"), "ac1").counted).toBe(2);
    expect(lineOf(of("A"), "ac2").counted).toBe(-2);
    for (const id of ["later", "ahead", "struck", "itself", "ghost"]) {
      for (const teamId of ["A", "B", "C", "D"]) expect(of(teamId)?.lines.has(id)).toBe(false);
    }
  });

  it("reads only the club's own games when handed more than its card", () => {
    const handed = gameBreakdown({
      teamId: "A",
      games: handGames,
      pageId: "ag_10u",
      ageGroups: groups,
      segment: undefined,
      board,
    });
    expect(handed).toEqual(of("A"));
  });

  it("adds the score part and the record part into the move, the record part always above nought", () => {
    for (const row of board.rows) {
      for (const line of of(row.teamId)?.lines.values() ?? []) {
        expect(line.moved).toBe(line.scorePart + line.recordPart);
        expect(line.recordPart).toBeGreaterThan(0);
      }
    }
  });
});

// ---------- A star: one club, and opponents who meet nobody else ----------

const starGames: ScoutGame[] = [
  game("h1", "H", 8, "L1", 2, "2026-09-05"),
  game("h2", "L1", 5, "H", 4, "2027-02-20"),
  game("h3", "H", 3, "L2", 6, "2026-10-10"),
  game("h4", "H", 10, "L3", 1, "2026-11-14"),
  game("h5", "H", 15, "L4", 0, "2027-03-13"),
  game("h6", "H", 2, "L5", 2, "2027-04-10"),
];
const star = {
  teams: ["H", "L1", "L2", "L3", "L4", "L5"].map(club),
  games: starGames,
  ageGroups: [groups[1] as AgeGroup],
};

describe("the score part on a star, where it is exact", () => {
  const { fit, board } = boardIn(star, "ag_10u", undefined);
  const of = (teamId: string) =>
    gameBreakdown({
      teamId,
      games: cardGamesOf(starGames, teamId),
      pageId: "ag_10u",
      ageGroups: star.ageGroups,
      segment: undefined,
      board,
    });

  it("is each game's own change to the hub's rating, a repeat meeting's included", () => {
    const hub = of("H");
    expect(hub?.lines.size).toBe(6);
    const r = fit.adjusted.ratings.get("H") ?? Number.NaN;
    for (const [id, line] of hub?.lines ?? []) {
      expect(Math.abs(line.scorePart - (r - ratingWithout(fit, id, "H"))), id).toBeLessThan(1e-9);
    }
    // The games are weighed apart, so a sum that ignored the weights could not land here.
    const weights = weightsForGames(
      fit.rated.map(({ game }) => ({ date: game.date, home: game.teamAId, away: game.teamBId }))
    );
    expect(new Set(weights?.map((weight) => weight.toFixed(6))).size).toBe(6);
  });

  it("is all a club with one game has beyond its start, which goes with it", () => {
    for (const leaf of ["L2", "L3", "L4", "L5"]) {
      const breakdown = of(leaf);
      const lines = [...(breakdown?.lines ?? [])];
      expect(lines).toHaveLength(1);
      const [[id, line]] = lines as [[string, GameLine]];
      const r = fit.adjusted.ratings.get(leaf) ?? Number.NaN;
      // Without its one game a club is rated where it started, and no lower or higher.
      expect(breakdown?.levelPrior).toBeLessThan(0);
      expect(Math.abs(line.scorePart - (r - breakdown!.levelPrior!)), leaf).toBeLessThan(1e-9);
      expect(Math.abs(line.scorePart - (r - ratingWithout(fit, id, leaf))), leaf).toBeLessThan(
        1e-9
      );
    }
  });
});

// ---------- The seeded fixture, against exact leave-one-out ----------

const fixture = poolFixture({ seed: 7, clubsPerPage: 120 });
const PAGE = "ag_10u_2027";
const fixtureBoard = (segment: SeasonSegment | undefined) =>
  boardIn(fixture, PAGE, segment, FIXTURE_TODAY);
const fixtureLines = (board: BoardView, teamId: string, segment: SeasonSegment | undefined) =>
  gameBreakdown({
    teamId,
    games: cardGamesOf(fixture.games, teamId),
    pageId: PAGE,
    ageGroups: fixture.ageGroups,
    segment,
    board,
  });

describe("the score part on the fixture, against exact leave-one-out", () => {
  /*
   * About sixty games of clubs with three games or more on the 10U page's year, drawn with the
   * fixture's own generator, each refitted without the game and every other weight held. Measured
   * on Node 22 over the 65 games of the 11 clubs drawn, with a year of age worth what each level's
   * step is (`AGE_STEP_RUNS`): the star estimate was off by 0.0057 in the middle, 0.052 at the
   * 95th percentile and 0.068 at most, and gave the same tenth on 58; the one-node form was off by
   * 0.018, 0.128 and 0.303. (With every year at two runs: 0.0048, 0.038 and 0.056, against 0.027,
   * 0.123 and 0.336.) That was on the ridge of 1.5. On half a game (`SCOUT_SHRINKAGE`, since 18
   * November 2026), measured on Node 24 over the 63 games of the 10 clubs drawn, the star estimate
   * is off by 0.012 in the middle, 0.070 at the 95th percentile and 0.097 at most, and gives the
   * same tenth on 45, never the wrong way; the one-node form is off by 0.038, 0.203 and 0.231. A
   * weaker pull lets each opponent's rating answer the game more, through games of its own the star
   * leaves out. The bounds sit a little above the star's.
   */
  const P95_BOUND = 0.075;
  const MAX_BOUND = 0.1;

  type Drawn = { teamId: string; id: string; line: GameLine; exact: number; node: number };
  let drawn: Drawn[] | undefined;
  const sample = (): Drawn[] => {
    if (drawn) return drawn;
    const { fit, board } = fixtureBoard(undefined);
    const shrink = board.fit?.shrink ?? Number.NaN;
    const weights = weightsForGames(
      fit.rated.map(({ game }) => ({ date: game.date, home: game.teamAId, away: game.teamBId }))
    );
    const weightOf = new Map(fit.rated.map(({ game }, at) => [game.id, weights?.[at] ?? 1]));
    const random = mulberry32(34);
    const candidates = board.rows.filter((row) => row.games >= 3);
    const out: Drawn[] = [];
    const seen = new Set<string>();
    while (out.length < 60 && seen.size < candidates.length) {
      const row = candidates[Math.floor(random() * candidates.length)];
      if (!row || seen.has(row.teamId)) continue;
      seen.add(row.teamId);
      const breakdown = fixtureLines(board, row.teamId, undefined);
      if (!breakdown) throw new Error(`no lines for ${row.teamId}`);
      let weight = 0;
      for (const id of breakdown.lines.keys()) weight += weightOf.get(id) ?? Number.NaN;
      for (const [id, line] of breakdown.lines) {
        const w = weightOf.get(id) ?? Number.NaN;
        out.push({
          teamId: row.teamId,
          id,
          line,
          exact: row.pointRating - ratingWithout(fit, id, row.teamId),
          // The game alone against the club's other games, every other rating held.
          node: (w * (line.playedLike - row.pointRating)) / (weight + shrink - w),
        });
      }
    }
    drawn = out;
    return out;
  };
  const quantile = (values: number[], p: number) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? Number.NaN;
  };

  it("draws about sixty games", () => {
    expect(sample().length).toBeGreaterThanOrEqual(60);
  });

  it("is within its measured bounds, and never the wrong way", () => {
    const errors = sample().map(({ line, exact }) => Math.abs(line.scorePart - exact));
    expect(quantile(errors, 0.95)).toBeLessThanOrEqual(P95_BOUND);
    expect(Math.max(...errors)).toBeLessThanOrEqual(MAX_BOUND);
    for (const { teamId, id, line, exact } of sample()) {
      if (Math.abs(exact) >= 1e-9) {
        expect(Math.sign(line.scorePart), `${teamId} ${id}`).toBe(Math.sign(exact));
      }
    }
  });

  it("holds bounds the one-node form would not", () => {
    const errors = sample().map(({ node, exact }) => Math.abs(node - exact));
    expect(quantile(errors, 0.95)).toBeGreaterThan(P95_BOUND);
    expect(Math.max(...errors)).toBeGreaterThan(MAX_BOUND);
  });
});

// ---------- The record part ----------

describe("the record part", () => {
  /** Each line's record part against the fit's own discount with the game counted out of the evidence. */
  const check = (fit: ScoutYearFit, teamId: string, breakdown: Breakdown | null) => {
    const r = fit.adjusted.ratings.get(teamId) ?? Number.NaN;
    const evidence = fit.effective.get(teamId) ?? Number.NaN;
    for (const [id, line] of breakdown?.lines ?? []) {
      const expected =
        fit.confident(r, evidence) - fit.confident(r, evidenceWithout(fit, id, teamId));
      expect(Math.abs(line.recordPart - expected), `${teamId} ${id}`).toBeLessThan(1e-12);
    }
    return breakdown?.lines.size ?? 0;
  };

  it("is what the discount loses with the game, a repeat meeting's other games recounted", () => {
    const { fit, board } = boardIn(hand, "ag_10u", undefined);
    let lines = 0;
    for (const row of board.rows) {
      lines += check(
        fit,
        row.teamId,
        gameBreakdown({
          teamId: row.teamId,
          games: cardGamesOf(handGames, row.teamId),
          pageId: "ag_10u",
          ageGroups: groups,
          segment: undefined,
          board,
        })
      );
    }
    expect(lines).toBeGreaterThan(20);
  });

  it("is the same on every club of the fixture's 10U page, in each span", () => {
    let repeats = 0;
    for (const segment of SPANS) {
      const { fit, board } = fixtureBoard(segment);
      for (const row of board.rows) {
        const breakdown = fixtureLines(board, row.teamId, segment);
        expect(breakdown, row.teamId).not.toBeNull();
        check(fit, row.teamId, breakdown);
        const opponents = [...(breakdown?.lines.keys() ?? [])].map((id) => {
          const met = fixture.games.find((game) => game.id === id);
          return met?.teamAId === row.teamId ? met.teamBId : met?.teamAId;
        });
        repeats += opponents.length - new Set(opponents).size;
      }
    }
    // Clubs that met an opponent more than once, so the recount is exercised.
    expect(repeats).toBeGreaterThan(10);
  });
});

// ---------- When there are no lines ----------

describe("no lines", () => {
  const { fit: full, board } = boardIn(hand, "ag_10u", undefined);
  const fit = board.fit as BoardFit;
  const cardA = cardGamesOf(handGames, "A");
  const of = (view: BoardView, games: readonly ScoutGame[] = cardA, teamId = "A") =>
    gameBreakdown({
      teamId,
      games,
      pageId: "ag_10u",
      ageGroups: groups,
      segment: undefined,
      board: view,
    });
  const withRow = (change: Partial<BoardView["rows"][number]>): BoardView => ({
    ...board,
    rows: board.rows.map((row) => (row.teamId === "A" ? { ...row, ...change } : row)),
  });
  const rowA = board.rows.find((row) => row.teamId === "A");
  if (!rowA) throw new Error("A has no row");

  it("are drawn for the board as it is", () => {
    expect(of(board)).not.toBeNull();
  });

  it.each<[string, () => BoardView]>([
    [
      "a board with no fit",
      () => {
        const { fit: _fit, ...bare } = board;
        return bare;
      },
    ],
    ["a fit of another version", () => ({ ...board, fit: { ...fit, v: BOARD_FIT_VERSION + 1 } })],
    // Published by a build from before each level's year had its own worth, which read a game's age
    // gap as the plain difference in levels.
    ["a fit from before the age table", () => ({ ...board, fit: { ...fit, v: 1 } })],
    // Published by a build from before each club's starting level, which played a club's virtual
    // games at nought rather than at its row's levelPrior: a club with a long record and a start
    // near nought would rebuild within the tolerance and draw lines a hair off the fit's.
    ["a fit from before the starting levels", () => ({ ...board, fit: { ...fit, v: 2 } })],
    [
      "the row's rating from its games a hundredth off",
      () => withRow({ pointRating: rowA.pointRating + 0.01 }),
    ],
    ["the row's shown rating a hundredth off", () => withRow({ rating: rowA.rating + 0.01 })],
    ["the row's mean margin a millionth off", () => withRow({ rawMargin: rowA.rawMargin + 1e-6 })],
    ["one game more on the row than on the card", () => withRow({ games: rowA.games + 1 })],
    [
      "a side away missing from the board",
      () => {
        const at = fit.away.ids.indexOf("N");
        if (at < 0) throw new Error("N is not away");
        const cut = <T>(list: T[]) => list.filter((_, index) => index !== at);
        return {
          ...board,
          fit: {
            ...fit,
            away: {
              ids: cut(fit.away.ids),
              ratings: cut(fit.away.ratings),
              games: cut(fit.away.games),
            },
          },
        };
      },
    ],
  ])("with %s", (_case, view) => {
    expect(of(view())).toBeNull();
  });

  it("with a counted game on the card the fit never read", () => {
    const extra = game("extra", "A", 4, "B", 3, "2027-03-01");
    expect(of(board, [...cardA, extra])).toBeNull();
  });

  it("for a club with no row on the board", () => {
    expect(of(board, cardGamesOf(handGames, "J"), "J")).toBeNull();
  });

  it("for a half the board is not of", () => {
    expect(
      gameBreakdown({
        teamId: "A",
        games: cardA,
        pageId: "ag_10u",
        ageGroups: groups,
        segment: "fall",
        board,
      })
    ).toBeNull();
  });

  it("with a side met more often than the board says it played, every other number agreeing", () => {
    // A met C twice. Say C played once, and give A's row the shown rating that count would give, so
    // only the meetings say the board and card do not belong together.
    const before =
      1 - 1 / (fit.shrink + (board.rows.find((row) => row.teamId === "C")?.games ?? 0));
    const after = 1 - 1 / (fit.shrink + 1);
    const evidence = (full.effective.get("A") ?? Number.NaN) + 2 * (after - before);
    const spread = fit.scale / Math.sqrt(evidence + fit.shrink);
    const rating = rowA.pointRating - fit.errors * (spread - fit.middle);
    const view: BoardView = {
      ...board,
      rows: board.rows.map((row) =>
        row.teamId === "A" ? { ...row, rating } : row.teamId === "C" ? { ...row, games: 1 } : row
      ),
    };
    expect(of(view)).toBeNull();
  });

  it("with a ridge of nothing, which leaves a one-game club's move undefined", () => {
    // Made to agree with itself in every other way: one game, its margin, a rating with no ridge.
    const lone: BoardView = {
      rows: [{ ...rowA, teamId: "X", games: 1, rawMargin: 3, pointRating: 3.5, rating: 3.5 }],
      fit: {
        ...fit,
        shrink: 0,
        recency: null,
        away: { ids: ["Y"], ratings: [0.5], games: [1] },
      },
    };
    const played = [game("xy", "X", 5, "Y", 2, "2027-03-01")];
    expect(of(lone, played, "X")).toBeNull();
  });
});

// ---------- Pinned ----------

describe("what each game did, pinned", () => {
  it("is three clubs' lines a span on the fixture's 10U page, to the millionth", () => {
    const round = (value: number | null) =>
      value === null ? null : Math.round(value * 1e6) / 1e6 || 0;
    const pinned = SPANS.map((segment) => {
      const { board } = fixtureBoard(segment);
      // By rating, not by the board's order, which lists a club whose web of games falls short
      // after the rest (board rules 10): the same three clubs as before that, to the millionth.
      const deep = board.rows.filter((row) => row.games >= 3).sort(byRating);
      const picks = [deep[0], deep[Math.floor(deep.length / 2)], deep[deep.length - 1]];
      return {
        span: segment ?? "year",
        clubs: picks.map((row) => {
          if (!row) throw new Error("too few clubs");
          const breakdown = fixtureLines(board, row.teamId, segment);
          return {
            teamId: row.teamId,
            rating: round(breakdown?.rating ?? null),
            pointRating: round(breakdown?.pointRating ?? null),
            lines: [...(breakdown?.lines ?? [])].map(([id, line]) =>
              [
                id,
                line.playedLike,
                line.moved,
                line.scorePart,
                line.recordPart,
                line.counted,
                line.shownMargin,
                line.ageRuns,
                line.levelsUp,
              ]
                .map((value) => (typeof value === "string" ? value : round(value)))
                .join(" ")
            ),
          };
        }),
      };
    });
    expect(pinned).toMatchInlineSnapshot(`
      [
        {
          "clubs": [
            {
              "lines": [
                "g1565 4.04 0.040658 -0.070497 0.111155 6 6 4 -1",
                "g1796 5.411854 0.483132 0.344133 0.138999 9 9 0 0",
                "g1869 3.491792 -0.219256 -0.341805 0.12255 4 4 0 0",
                "g2005 4.3276 0.096966 -0.025584 0.12255 1 1 -3 1",
                "g2140 6.4521 0.740653 0.598689 0.141964 0.5 1 -3 1",
              ],
              "pointRating": 4.43655,
              "rating": 4.519847,
              "teamId": "S-10u_2027-0080",
            },
            {
              "lines": [
                "g1386 -1.5421 -0.730883 -1.129096 0.398213 3 3 4 -1",
                "g1913 1.790785 1.642613 1.2876 0.355013 -0.5 -1 0 0",
                "g1914 -0.2952 0.044868 -0.070997 0.115865 0 0 0 0",
              ],
              "pointRating": -0.083756,
              "rating": -0.394504,
              "teamId": "S-10u_2027-0093",
            },
            {
              "lines": [
                "g1372 -5.9551 -0.19156 -0.385921 0.194361 -5.5 -5 4 -1",
                "g1755 -3.937387 0.538094 0.333475 0.204619 -1.5 -1 0 0",
                "g1756 -4.910878 0.247762 0.061191 0.18657 -0.5 0 0 0",
                "g1757 -6.4216 -0.473743 -0.603275 0.129532 -8 -8 0 0",
              ],
              "pointRating": -5.088353,
              "rating": -5.145093,
              "teamId": "S-10u_2027-0036",
            },
          ],
          "span": "year",
        },
        {
          "clubs": [
            {
              "lines": [
                "g1802 3.168 0.350741 0.205359 0.145382 9 9 4 -1",
                "g1803 1.917524 -0.088384 -0.458589 0.370205 6 6 0 0",
                "g1805 5.9893 1.943395 1.649295 0.294099 9 9 0 0",
              ],
              "pointRating": 2.62867,
              "rating": 2.478549,
              "teamId": "S-10u_2027-0053",
            },
            {
              "lines": [
                "g1876 -1.094205 0.133207 0.037394 0.095813 5 5 0 0",
                "g1899 0.373913 0.551529 0.45345 0.098079 2 2 0 0",
                "g1905 -1.626087 0.039732 -0.058348 0.098079 0 0 0 0",
                "g1915 -0.771662 0.192327 0.160261 0.032067 2 2 0 0",
                "g1916 -2.61799 -0.23927 -0.311948 0.072677 -3 -3 0 0",
                "g1917 -3.0659 -0.27077 -0.330776 0.060006 -4 -4 0 0",
                "g1918 -1.0197 0.074086 0.04202 0.032067 4.5 5 4 -1",
                "g1919 -1.395555 0.016197 -0.01587 0.032067 -0.5 -1 0 0",
              ],
              "pointRating": -1.291929,
              "rating": -0.814921,
              "teamId": "S-10u_2027-0094",
            },
            {
              "lines": [
                "g1815 -5.107471 0.15315 0.11063 0.04252 -1 -1 0 0",
                "g1819 -1.607471 0.399225 0.356705 0.04252 2.5 3 0 0",
                "g1820 -6.107471 0.039998 -0.002522 0.04252 -2 -2 0 0",
                "g1824 -7.905417 -0.281699 -0.316631 0.034932 -7 -7 0 0",
                "g1872 -10.253634 -0.230816 -0.271043 0.040227 -10 -10 0 0",
                "g1873 -6.58693 -0.067325 -0.093866 0.02654 -6 -6 0 0",
                "g1874 -7.253634 -0.049078 -0.089305 0.040227 -7 -7 0 0",
                "g1875 -8.551044 -0.165168 -0.202044 0.036876 -10.5 -10 0 0",
                "g1876 -6.291929 0.012671 -0.027321 0.039991 -5 -5 0 0",
                "g1877 -7.082476 -0.046203 -0.078108 0.031906 -3 -3 0 0",
                "g1878 -4.290737 0.187551 0.161011 0.02654 -1.5 -2 0 0",
              ],
              "pointRating": -6.094205,
              "rating": -5.382439,
              "teamId": "S-10u_2027-0083",
            },
          ],
          "span": "fall",
        },
        {
          "clubs": [
            {
              "lines": [
                "g1565 3.6375 0.024188 -0.082489 0.106677 6 6 4 -1",
                "g1796 6.093035 0.825279 0.707561 0.117718 9 9 0 0",
                "g1869 3.459444 -0.117309 -0.235027 0.117718 4 4 0 0",
                "g2005 3.6878 0.011291 -0.095387 0.106677 1 1 -3 1",
                "g2140 5.5382 0.548473 0.430755 0.117718 0.5 1 -3 1",
              ],
              "pointRating": 4.087538,
              "rating": 4.45647,
              "teamId": "S-10u_2027-0080",
            },
            {
              "lines": [
                "g1797 -1.685 -0.231403 -0.339551 0.108148 -5.5 -5 0 0",
                "g1798 0.4662 0.645836 0.499497 0.146339 0 0 -3 1",
                "g1799 -1.1023 -0.002129 -0.05869 0.056561 -0.5 0 0 0",
                "g1800 0.5007 0.538773 0.406459 0.132314 1 1 0 0",
                "g2174 -2.2851 -0.31768 -0.473182 0.155501 0 0 -3 1",
              ],
              "pointRating": -0.869059,
              "rating": -0.574519,
              "teamId": "S-10u_2027-0051",
            },
            {
              "lines": [
                "g1372 -6.4885 -0.506002 -0.704726 0.198724 -5.5 -5 4 -1",
                "g1755 -4.287759 0.453171 0.254447 0.198724 -1.5 -1 0 0",
                "g1756 -4.756602 0.311845 0.125202 0.186642 -0.5 0 0 0",
                "g1757 -6.1989 -0.427812 -0.498605 0.070793 -8 -8 0 0",
              ],
              "pointRating": -5.082477,
              "rating": -4.875231,
              "teamId": "S-10u_2027-0036",
            },
          ],
          "span": "spring",
        },
      ]
    `);
  });
});
