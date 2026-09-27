import { describe, expect, it } from "vitest";
import { tidyPool, type GcImportState } from "../gameChangerImport";
import {
  gcRowId,
  type AgeGroup,
  type FoldedRow,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import { countsTowardRating, scoreSeenBy } from "../teamRankings/games";

/*
 * One GameChanger row, one place in the pool.
 *
 * A game played across two ages is filed on one club's page with the other club's row folded in.
 * A refresh of that club's own page cannot see the other page, and filed the row again as a game
 * of its own against a stand-in, so the club was credited twice with one game. On the pool of 26
 * September 2026, 256 rows were held twice and 155 of them counted twice for their own club.
 */
const ageGroups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag8", name: "8U 2027", ageLevel: 8, year: 2027, seasonIds: [] },
];
const club = (id: string, name: string, page: string, state = "CA"): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [
    {
      teamId: `gc${id}`,
      name,
      ageGroupId: page,
      ageLevel: page === "ag8" ? 8 : 9,
    },
  ],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const DAY = "2026-09-20";
const at = (clock: string) => `${DAY}T${clock}:00.000Z`;
/** `clubId`'s own row `gameId`, standing as a game against `against`, its own score first. */
const own = (
  clubId: string,
  gameId: string,
  against: string,
  page: string,
  clock: string,
  score?: [number, number]
): ScoutGame => ({
  id: gcRowId(`gc${clubId}`, gameId),
  teamAId: clubId,
  teamBId: against,
  ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
  ageGroupId: page,
  date: DAY,
  startTs: at(clock),
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});
/** `clubId`'s row `gameId` as a game holding it on side B has it on record. */
const record = (
  clubId: string,
  gameId: string,
  clock: string,
  score?: [number, number]
): FoldedRow => ({
  teamId: `gc${clubId}`,
  gameId,
  startTs: at(clock),
  ...(score ? { ownScore: score[0], opponentScore: score[1] } : {}),
  onSideB: true,
});
/** `game` holding `row` on side B, and that side's score beside its own. */
const holding = (game: ScoutGame, row: FoldedRow, borrowed = false): ScoutGame => {
  const report =
    row.ownScore === undefined
      ? undefined
      : { teamAScore: row.opponentScore!, teamBScore: row.ownScore };
  return {
    ...game,
    alsoFrom: [row.teamId],
    alsoRows: [row],
    ...(report ? { reportedByB: report } : {}),
    ...(borrowed && report ? { ...report, scoreFromB: true } : {}),
  };
};

/** Every game holding the row, standing on it or folded in. */
const holdersOf = (state: GcImportState, rowId: string) =>
  state.games.filter(
    (game) =>
      (game.source && gcRowId(game.source.teamId, game.source.gameId) === rowId) ||
      game.alsoRows?.some((row) => gcRowId(row.teamId, row.gameId) === rowId)
  );
/** A club's record in the pool, as its page reads it. */
const recordOf = (state: GcImportState, clubId: string) => {
  const tally = [0, 0, 0];
  state.games.forEach((game) => {
    if (game.teamAId !== clubId && game.teamBId !== clubId) return;
    if (!countsTowardRating(game, "2026-09-27")) return;
    const seen = scoreSeenBy(game, clubId);
    if (!seen) return;
    tally[seen.own > seen.opponent ? 0 : seen.own < seen.opponent ? 1 : 2]! += 1;
  });
  return tally.join("-");
};
const settled = (state: GcImportState) => {
  const first = tidyPool(state);
  const again = tidyPool(first.state);
  expect(again.passes).toBe(1);
  expect(again.state.games).toBe(first.state.games);
  return first.state;
};

describe("a row standing as a game and folded into another", () => {
  it("goes into the other game with the newer word, where it stood against a stand-in", () => {
    // The San Diego Hawks' own row, folded into the 8U Cowboys' copy as a 17-10 win, filed again
    // on the Hawks' 9U page by a refresh as a 15-10 win over a stand-in of the Cowboys' name.
    const teams = [
      club("HAWKS", "San Diego Hawks", "ag9"),
      club("COWS", "SD Cowboys Select", "ag8"),
      standIn("S-COWS", "SD Cowboys Select"),
    ];
    const cowboys = holding(
      own("COWS", "c1", "HAWKS", "ag8", "17:00", [10, 17]),
      record("HAWKS", "h1", "17:00", [17, 10])
    );
    const refiled = own("HAWKS", "h1", "S-COWS", "ag9", "17:30", [15, 10]);
    const before: GcImportState = { ageGroups, teams, games: [cowboys, refiled] };
    expect(recordOf(before, "HAWKS")).toBe("2-0-0");

    const after = settled(before);
    const held = holdersOf(after, gcRowId("gcHAWKS", "h1"));
    expect(held).toHaveLength(1);
    expect(held[0]!.source?.teamId).toBe("gcCOWS");
    expect(held[0]!.alsoRows?.[0]).toMatchObject({ ownScore: 15, opponentScore: 10 });
    expect(recordOf(after, "HAWKS")).toBe("1-0-0");
    expect(recordOf(after, "COWS")).toBe("0-1-0");
  });

  it("stays where it stands against another club's own row, and leaves the stale claim", () => {
    // Mattoon's 1-0 over Effingham holds Effingham's own 0-1; the same Mattoon row is also claimed
    // into Oblong's copy, filed against a stand-in, and that claim is the stale one.
    const teams = [
      club("MATT", "Mattoon Pride", "ag9", "IL"),
      club("EFF", "Effingham Heaters", "ag9", "IL"),
      club("OBL", "Oblong panthers", "ag9", "IL"),
      standIn("S-OBL", "Oblong"),
    ];
    const standing = holding(
      own("MATT", "m1", "EFF", "ag9", "18:00", [1, 0]),
      record("EFF", "e1", "18:00", [0, 1])
    );
    const oblong = {
      ...holding(
        own("OBL", "o1", "MATT", "ag9", "17:30", [16, 19]),
        record("MATT", "m1", "17:30", [19, 16])
      ),
    };
    oblong.alsoRows = oblong.alsoRows!.map((row) => ({ ...row, filedAgainst: "S-OBL" }));
    const before: GcImportState = { ageGroups, teams, games: [standing, oblong] };

    const after = settled(before);
    const held = holdersOf(after, gcRowId("gcMATT", "m1"));
    expect(held).toHaveLength(1);
    expect(held[0]!.source?.teamId).toBe("gcMATT");
    expect(held[0]!.alsoRows?.map((row) => row.teamId)).toEqual(["gcEFF"]);
    const oblongNow = after.games.find((game) => game.source?.teamId === "gcOBL")!;
    expect(oblongNow.alsoRows ?? []).toEqual([]);
  });

  it("stays where it stands between two real clubs", () => {
    // Throwdown's own 5-13 row names the PA Defenders, a pulled club, and the same row sits folded
    // into another club's copy of a game its own row scores 9-2, from before the name found them.
    const teams = [
      club("THROW", "Throwdown", "ag9", "PA"),
      club("DEF", "PA Defenders", "ag9", "PA"),
      club("OLD", "Keystone Kids", "ag9", "PA"),
    ];
    const standing = own("THROW", "t1", "DEF", "ag9", "13:00", [5, 13]);
    const stale = holding(
      own("OLD", "k1", "THROW", "ag8", "13:00", [9, 2]),
      record("THROW", "t1", "13:00", [5, 13])
    );
    const before: GcImportState = { ageGroups, teams, games: [stale, standing] };
    expect(recordOf(before, "THROW")).toBe("0-2-0");

    const after = settled(before);
    expect(holdersOf(after, gcRowId("gcTHROW", "t1")).map((game) => game.id)).toEqual([
      standing.id,
    ]);
    const other = after.games.find((game) => game.id === stale.id)!;
    expect(other.alsoRows ?? []).toEqual([]);
    expect(other.reportedByB).toBeUndefined();
    // The other club's own row still names Throwdown: which club that schedule meant is not this
    // pass's to say, and Pool Health lists the pair (`countedTwice`).
    expect(recordOf(after, "THROW")).toBe("0-2-0");
  });

  it("stays where its own result says the other game is another game", () => {
    // Western Reserve's own 5-6 loss to "Western 2", and the same row folded into Milan's game,
    // whose own row has Western Reserve winning 16-3. Folded, the loss read as Milan winning 6-5.
    const teams = [
      club("WR", "Western Reserve GOOD Fall Ball", "ag9", "OH"),
      club("MILAN", "Milan Indians - Taylor", "ag9", "OH"),
      standIn("S-W2", "Western 2"),
    ];
    const milan = holding(
      own("MILAN", "x1", "WR", "ag9", "15:00", [3, 16]),
      record("WR", "w1", "15:00", [16, 3])
    );
    const refiled = own("WR", "w1", "S-W2", "ag9", "15:00", [5, 6]);
    const before: GcImportState = { ageGroups, teams, games: [milan, refiled] };

    const after = settled(before);
    const held = holdersOf(after, gcRowId("gcWR", "w1"));
    expect(held).toHaveLength(1);
    expect(held[0]!.id).toBe(refiled.id);
    expect(held[0]!.teamBId).toBe("S-W2");
    // Milan keeps its own word, and Western Reserve's loss is its own game.
    expect(recordOf(after, "MILAN")).toBe("0-1-0");
    expect(recordOf(after, "WR")).toBe("1-1-0");
  });

  it("stays where the other game's only score was the one it lent", () => {
    // A club's blank row against the Cubs held the Cubs' old 6-6 as its only score. The Cubs' row
    // since says 11-6 over the Diamondbacks, and the club is in Iowa, the Cubs in Texas.
    const teams = [
      club("BOLTS", "Bolts Fall Ball", "ag9", "IA"),
      club("CUBS", "Cubs", "ag9", "TX"),
      standIn("S-DBACKS", "Diamondbacks"),
    ];
    const bolts = holding(
      own("BOLTS", "b1", "CUBS", "ag9", "15:45"),
      record("CUBS", "k1", "15:45", [6, 6]),
      true
    );
    const refiled = own("CUBS", "k1", "S-DBACKS", "ag9", "15:45", [11, 6]);
    const before: GcImportState = { ageGroups, teams, games: [bolts, refiled] };
    expect(recordOf(before, "BOLTS")).toBe("0-0-1");

    const after = settled(before);
    expect(holdersOf(after, gcRowId("gcCUBS", "k1")).map((game) => game.id)).toEqual([refiled.id]);
    // Not an 11-6 loss: the Bolts have posted nothing, and nothing else says who they played.
    expect(recordOf(after, "BOLTS")).toBe("0-0-0");
    expect(recordOf(after, "CUBS")).toBe("1-0-0");
  });
});

describe("a row folded into two games", () => {
  it("stays in the one whose own result agrees with it", () => {
    // 5 Star Coastal Gold's 6-13, in CBU Georgia's own 13-6 at 14:00, and in the WA Bulldogs'
    // blank copy at 15:00, the row's own start, whose only score is the one the row lent it.
    const teams = [
      club("STAR", "5 Star Coastal Gold", "ag9", "GA"),
      club("CBU", "CBU Georgia 2032- Strickland", "ag9", "GA"),
      club("WAB", "WA Bulldogs", "ag9", "GA"),
    ];
    const cbu = holding(
      own("CBU", "c1", "STAR", "ag9", "14:00", [13, 6]),
      record("STAR", "s1", "15:00", [6, 13])
    );
    const bulldogs = holding(
      own("WAB", "w1", "STAR", "ag9", "15:00"),
      record("STAR", "s1", "15:00", [6, 13]),
      true
    );
    const before: GcImportState = { ageGroups, teams, games: [bulldogs, cbu] };
    expect(recordOf(before, "WAB")).toBe("1-0-0");

    const after = settled(before);
    expect(holdersOf(after, gcRowId("gcSTAR", "s1")).map((game) => game.id)).toEqual([cbu.id]);
    expect(recordOf(after, "WAB")).toBe("0-0-0");
    expect(recordOf(after, "STAR")).toBe("0-1-0");
  });
});

/*
 * The property, on pools made at random from the shapes above: no pulled club has two counted
 * games holding one of its own rows, and a second tidy finds nothing. Not "no row id twice": that
 * holds while a club is still credited twice, the other game standing on the other club's row with
 * this club as a side, which is Pool Health's to show (`countedTwice`).
 */
describe("one row, one place, on pools made at random", () => {
  /** A small seeded generator, so a failure names its pool. */
  const random = (seed: number) => () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const pick = <T>(next: () => number, items: readonly T[]): T =>
    items[Math.floor(next() * items.length)]!;
  const scoreOrNot = (next: () => number): [number, number] | undefined =>
    next() < 0.25 ? undefined : [Math.floor(next() * 12), Math.floor(next() * 12)];

  const poolOf = (seed: number): GcImportState => {
    const next = random(seed);
    const states = ["CA", "TX", "IA"];
    const clubs = Array.from({ length: 8 }, (_, i) =>
      club(`C${i}`, `Club ${i}`, i % 3 === 0 ? "ag8" : "ag9", pick(next, states))
    );
    const standIns = Array.from({ length: 4 }, (_, i) => standIn(`S-${i}`, `Stand-in ${i}`));
    const games: ScoutGame[] = [];
    for (let n = 0; n < 12; n += 1) {
      const [x, y] = [pick(next, clubs), pick(next, clubs)];
      if (x.id === y.id) continue;
      const clock = pick(next, ["10:00", "12:00", "14:00", "16:00"]);
      const theirs = scoreOrNot(next);
      const mine = scoreOrNot(next);
      const row = record(x.id, `r${n}`, clock, mine && [mine[0], mine[1]]);
      const page = y.gcTeams![0]!.ageGroupId;
      games.push(
        holding(
          own(y.id, `o${n}`, x.id, page, clock, theirs),
          row,
          theirs === undefined && mine !== undefined
        )
      );
      const shape = next();
      if (shape < 0.5) {
        // The refresh's copy, against a stand-in or, now and then, another club.
        const against = next() < 0.8 ? pick(next, standIns).id : pick(next, clubs).id;
        if (against === x.id) continue;
        const clockNow = next() < 0.7 ? clock : pick(next, ["11:00", "15:00"]);
        games.push(
          own(x.id, `r${n}`, against, x.gcTeams![0]!.ageGroupId, clockNow, scoreOrNot(next))
        );
      } else if (shape < 0.7) {
        // Folded a second time into another club's copy.
        const z = pick(next, clubs);
        if (z.id === x.id || z.id === y.id) continue;
        games.push(holding(own(z.id, `z${n}`, x.id, page, clock, scoreOrNot(next)), row));
      }
    }
    return { ageGroups, teams: [...clubs, ...standIns], games };
  };

  /** Rows of a club's own held by two of the games counted for it. */
  const countedTwice = (state: GcImportState) => {
    const clubOf = new Map(
      state.teams.flatMap((team) => (team.gcTeams ?? []).map((link) => [link.teamId, team.id]))
    );
    const holders = new Map<string, ScoutGame[]>();
    state.games.forEach((game) => {
      if (!countsTowardRating(game, "2026-09-27")) return;
      const rows = [
        ...(game.source ? [[game.source.teamId, game.source.gameId]] : []),
        ...(game.alsoRows ?? []).map((row) => [row.teamId, row.gameId]),
      ];
      rows.forEach(([schedule, gameId]) => {
        const clubId = clubOf.get(schedule!);
        if (clubId === undefined || (game.teamAId !== clubId && game.teamBId !== clubId)) return;
        const key = gcRowId(schedule!, gameId!);
        holders.set(key, [...(holders.get(key) ?? []), game]);
      });
    });
    return [...holders].filter(([, games]) => new Set(games).size > 1).map(([key]) => key);
  };

  it("leaves no club two counted games holding one of its own rows", () => {
    let doubledBefore = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const pool = poolOf(seed);
      doubledBefore += countedTwice(pool).length;
      const first = tidyPool(pool);
      expect(countedTwice(first.state), `seed ${seed}`).toEqual([]);
      const again = tidyPool(first.state);
      expect(again.passes, `seed ${seed}`).toBe(1);
    }
    // The pools are worth something: they start with rows counted twice.
    expect(doubledBefore).toBeGreaterThan(30);
  });
});
