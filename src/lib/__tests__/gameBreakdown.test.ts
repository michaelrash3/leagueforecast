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

/** The club's rating with game `gameId` refitted away, every other game's weight held as it was. */
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
    { cap: RATING_CAP }
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

  it("is the whole rating of a club with one game, which goes with it", () => {
    for (const leaf of ["L2", "L3", "L4", "L5"]) {
      const lines = [...(of(leaf)?.lines ?? [])];
      expect(lines).toHaveLength(1);
      const [[id, line]] = lines as [[string, GameLine]];
      const r = fit.adjusted.ratings.get(leaf) ?? Number.NaN;
      expect(Math.abs(line.scorePart - r), leaf).toBeLessThan(1e-9);
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
                "g1565 3.8473 -0.015117 -0.078277 0.063161 6 6 4 -1",
                "g1796 6.359899 0.641077 0.568274 0.072803 9 9 0 0",
                "g1869 4.230135 0.024593 -0.042256 0.066849 4 4 0 0",
                "g2005 4.7276 0.135857 0.069008 0.066849 1 1 -3 1",
                "g2140 6.5783 0.60793 0.533964 0.073965 0.5 1 -3 1",
              ],
              "pointRating": 4.372945,
              "rating": 4.392111,
              "teamId": "S-10u_2027-0080",
            },
            {
              "lines": [
                "g1561 1.158 0.174068 0.119418 0.05465 3.5 4 4 -1",
                "g1970 0.906892 0.126049 0.069926 0.056123 0 0 0 0",
                "g1971 -1.5674 -0.108442 -0.158238 0.049795 -4.5 -5 -3 1",
                "g1972 -1.564211 -0.22964 -0.285764 0.056123 -2 -2 0 0",
                "g1973 0.2243 0.063881 0.009231 0.05465 3 3 0 0",
                "g1987 2.022046 0.360147 0.301995 0.058152 2 2 0 0",
              ],
              "pointRating": 0.119401,
              "rating": 0.197605,
              "teamId": "S-10u_2027-0115",
            },
            {
              "lines": [
                "g1372 -5.7821 -0.588327 -0.682054 0.093727 -5.5 -5 4 -1",
                "g1755 -2.660201 0.335312 0.23804 0.097272 -1.5 -1 0 0",
                "g1756 -3.363488 0.189099 0.09794 0.09116 -0.5 0 0 0",
                "g1757 -6.0353 -0.742307 -0.817427 0.07512 -8 -8 0 0",
              ],
              "pointRating": -3.735852,
              "rating": -3.788277,
              "teamId": "S-10u_2027-0036",
            },
          ],
          "span": "year",
        },
        {
          "clubs": [
            {
              "lines": [
                "g1802 4.4125 0.436457 0.338688 0.097769 9 9 4 -1",
                "g1803 3.22106 0.255606 0.123018 0.132588 6 6 0 0",
                "g1805 7.5895 1.341752 1.22197 0.119783 9 9 0 0",
              ],
              "pointRating": 2.831443,
              "rating": 2.780301,
              "teamId": "S-10u_2027-0053",
            },
            {
              "lines": [
                "g1638 2.6365 0.696679 0.566177 0.130502 2 2 0 0",
                "g1639 -0.2157 -0.067444 -0.173769 0.106325 -0.5 -1 0 0",
                "pulled-league-copy -0.591927 -0.135844 -0.242169 0.106325 -1 -1 0 0",
              ],
              "pointRating": 0.266293,
              "rating": 0.188887,
              "teamId": "S-10u_2027-0003",
            },
            {
              "lines": [
                "g1815 -3.736087 0.100864 0.073516 0.027348 -1 -1 0 0",
                "g1819 -0.236087 0.315465 0.288117 0.027348 2.5 3 0 0",
                "g1820 -4.736087 -0.007882 -0.035231 0.027348 -2 -2 0 0",
                "g1824 -6.843903 -0.312195 -0.335843 0.023647 -7 -7 0 0",
                "g1872 -9.502205 -0.255044 -0.281156 0.026111 -10 -10 0 0",
                "g1873 -5.556538 -0.145748 -0.166234 0.020486 -6 -6 0 0",
                "g1874 -6.502205 -0.105711 -0.131822 0.026111 -7 -7 0 0",
                "g1875 -8.040495 -0.216542 -0.241049 0.024507 -10.5 -10 0 0",
                "g1876 -5.21256 -0.053463 -0.079472 0.026009 -5 -5 0 0",
                "g1877 -5.77894 -0.061043 -0.083455 0.022412 -3 -3 0 0",
                "g1878 -2.578874 0.16532 0.144834 0.020486 -1.5 -2 0 0",
              ],
              "pointRating": -4.513775,
              "rating": -4.132205,
              "teamId": "S-10u_2027-0083",
            },
          ],
          "span": "fall",
        },
        {
          "clubs": [
            {
              "lines": [
                "g1565 3.5592 -0.016189 -0.081675 0.065487 6 6 4 -1",
                "g1796 7.331475 0.911631 0.842303 0.069327 9 9 0 0",
                "g1869 4.330641 0.123122 0.053795 0.069327 4 4 0 0",
                "g2005 4.3677 0.107492 0.042006 0.065487 1 1 -3 1",
                "g2140 6.1137 0.511457 0.44213 0.069327 0.5 1 -3 1",
              ],
              "pointRating": 4.137733,
              "rating": 4.311061,
              "teamId": "S-10u_2027-0080",
            },
            {
              "lines": [
                "g1797 -2.0156 -0.540524 -0.604779 0.064256 -5.5 -5 0 0",
                "g1798 2.0826 0.605054 0.53018 0.074873 0 0 -3 1",
                "g1799 -0.2899 -0.007212 -0.060201 0.052989 -0.5 0 0 0",
                "g1800 1.3074 0.338827 0.268127 0.0707 1 1 0 0",
                "g2174 -0.5128 -0.046572 -0.124368 0.077796 0 0 -3 1",
              ],
              "pointRating": 0.026603,
              "rating": 0.180176,
              "teamId": "S-10u_2027-0051",
            },
            {
              "lines": [
                "g1372 -6.0346 -0.73514 -0.831768 0.096628 -5.5 -5 4 -1",
                "g1755 -2.465094 0.278264 0.181636 0.096628 -1.5 -1 0 0",
                "g1756 -2.841921 0.217018 0.124093 0.092925 -0.5 0 0 0",
                "g1757 -5.8813 -0.748854 -0.814237 0.065383 -8 -8 0 0",
              ],
              "pointRating": -3.347902,
              "rating": -3.251793,
              "teamId": "S-10u_2027-0036",
            },
          ],
          "span": "spring",
        },
      ]
    `);
  });
});
