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
import { buildOpponentAdjustedRatings } from "../powerRating";
import { weightsForGames } from "../ratingRecency";
import { startingLevels } from "../scheduleCommunities";
import {
  effectiveGames,
  fitScoutYearFor,
  RATING_CAP,
  ratedMargin,
  rowsOfYearFit,
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
 * starting level held as they were: the score part is what the game's margin did to the fit, and a
 * start is read off the schedule, not off a margin.
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
    { cap: RATING_CAP, priorCentre: startingLevels(fit.communities) }
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
   * 0.123 and 0.336.) The bounds sit a little above the first.
   */
  const P95_BOUND = 0.06;
  const MAX_BOUND = 0.08;

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
      const deep = board.rows.filter((row) => row.games >= 3);
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
                "g1565 3.1568 -0.016611 -0.079887 0.063277 6 6 4 -1",
                "g1796 5.65836 0.634961 0.562025 0.072937 9 9 0 0",
                "g1869 3.490664 0.007027 -0.059945 0.066972 4 4 0 0",
                "g2005 4.075 0.14125 0.074278 0.066972 1 1 -3 1",
                "g2140 5.9173 0.612591 0.538489 0.074102 0.5 1 -3 1",
              ],
              "pointRating": 3.693258,
              "rating": 3.712459,
              "teamId": "S-10u_2027-0080",
            },
            {
              "lines": [
                "g1869 -0.306742 0.157902 0.069004 0.088898 -4 -4 0 0",
                "g1963 1.8807 0.932845 0.852134 0.080711 6 6 0 0",
                "g1964 -5.198308 -0.982817 -1.077659 0.094842 -4.5 -4 0 0",
                "g2291 0.5553 0.373884 0.280567 0.093317 -1 -1 -3 1",
              ],
              "pointRating": -0.509336,
              "rating": -0.554544,
              "teamId": "S-10u_2027-0108",
            },
            {
              "lines": [
                "g1372 -6.5054 -0.58304 -0.676939 0.093899 -5.5 -5 4 -1",
                "g1755 -3.364617 0.343066 0.245615 0.097451 -1.5 -1 0 0",
                "g1756 -4.10097 0.189573 0.098246 0.091328 -0.5 0 0 0",
                "g1757 -6.847 -0.768139 -0.843397 0.075258 -8 -8 0 0",
              ],
              "pointRating": -4.474497,
              "rating": -4.527018,
              "teamId": "S-10u_2027-0036",
            },
          ],
          "span": "year",
        },
        {
          "clubs": [
            {
              "lines": [
                "g1865 2.595486 0.182534 0.116458 0.066077 3 3 0 0",
                "g1866 3.095486 0.397581 0.331504 0.066077 3.5 3 0 0",
                "g1875 5.101199 0.421657 0.35375 0.067907 10.5 11 0 0",
                "g1904 -1.595927 -0.692339 -0.761598 0.06926 0 0 0 0",
                "g1907 3.404073 0.633745 0.564485 0.06926 5 5 0 0",
              ],
              "pointRating": 1.604713,
              "rating": 1.78825,
              "teamId": "S-10u_2027-0107",
            },
            {
              "lines": [
                "g1662 -1.48637 -0.103394 -0.23039 0.126996 0.5 1 0 0",
                "g1700 -1.909998 -0.079263 -0.191874 0.112611 0 0 0 0",
                "g1722 0.246529 0.585526 0.462309 0.123217 -1 -1 0 0",
              ],
              "pointRating": -0.953195,
              "rating": -0.938302,
              "teamId": "S-10u_2027-0028",
            },
            {
              "lines": [
                "g1815 -4.65609 0.097623 0.070209 0.027413 -1 -1 0 0",
                "g1819 -1.15609 0.313174 0.285761 0.027413 2.5 3 0 0",
                "g1820 -5.65609 -0.01336 -0.040773 0.027413 -2 -2 0 0",
                "g1824 -7.808572 -0.323618 -0.347322 0.023704 -7 -7 0 0",
                "g1872 -10.404514 -0.255956 -0.28213 0.026173 -10 -10 0 0",
                "g1873 -6.382368 -0.136263 -0.156797 0.020535 -6 -6 0 0",
                "g1874 -7.404514 -0.106794 -0.132968 0.026173 -7 -7 0 0",
                "g1875 -8.895287 -0.214418 -0.238983 0.024565 -10.5 -10 0 0",
                "g1876 -6.221728 -0.06752 -0.09359 0.026071 -5 -5 0 0",
                "g1877 -6.835389 -0.072297 -0.094762 0.022465 -3 -3 0 0",
                "g1878 -3.380822 0.171588 0.151053 0.020535 -1.5 -2 0 0",
              ],
              "pointRating": -5.398801,
              "rating": -5.016325,
              "teamId": "S-10u_2027-0083",
            },
          ],
          "span": "fall",
        },
        {
          "clubs": [
            {
              "lines": [
                "g1565 2.6442 -0.005288 -0.070837 0.06555 6 6 4 -1",
                "g1796 6.428242 0.935047 0.865653 0.069394 9 9 0 0",
                "g1869 3.357579 0.128406 0.059011 0.069394 4 4 0 0",
                "g2005 3.3578 0.104244 0.038694 0.06555 1 1 -3 1",
                "g2140 5.0644 0.498651 0.429257 0.069394 0.5 1 -3 1",
              ],
              "pointRating": 3.145964,
              "rating": 3.31946,
              "teamId": "S-10u_2027-0080",
            },
            {
              "lines": [
                "g1797 -3.094 -0.549011 -0.613329 0.064318 -5.5 -5 0 0",
                "g1798 1.0346 0.605521 0.530575 0.074945 0 0 -3 1",
                "g1799 -1.3497 -0.009115 -0.062155 0.05304 -0.5 0 0 0",
                "g1800 0.257 0.338714 0.267945 0.070768 1 1 0 0",
                "g2174 -1.4942 -0.030788 -0.108659 0.077871 0 0 -3 1",
              ],
              "pointRating": -1.022928,
              "rating": -0.869206,
              "teamId": "S-10u_2027-0051",
            },
            {
              "lines": [
                "g1372 -6.9639 -0.723635 -0.820356 0.096721 -5.5 -5 4 -1",
                "g1755 -3.455399 0.27339 0.176668 0.096721 -1.5 -1 0 0",
                "g1756 -3.752822 0.230661 0.137646 0.093015 -0.5 0 0 0",
                "g1757 -6.8659 -0.754717 -0.820163 0.065446 -8 -8 0 0",
              ],
              "pointRating": -4.314064,
              "rating": -4.217863,
              "teamId": "S-10u_2027-0036",
            },
          ],
          "span": "spring",
        },
      ]
    `);
  });
});
