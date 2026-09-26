import { describe, expect, it } from "vitest";
import {
  createGcImporter,
  joinCrossedHalves,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { nameFitsWithin, scoreSeenBy } from "../teamRankings";
import { borderingStates, inOneRegion } from "../stateBorders";

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };

type Played = GcTeamSchedule["games"][number];

const played = (
  id: string,
  opponentName: string,
  date: string,
  teamScore: number | undefined,
  opponentScore: number | undefined,
  startTs?: string
): Played => ({
  id,
  date,
  opponentName,
  status: teamScore === undefined ? "scheduled" : "completed",
  ...(teamScore === undefined ? {} : { teamScore }),
  ...(opponentScore === undefined ? {} : { opponentScore }),
  ...(startTs ? { startTs } : {}),
});

const fall = { season: "fall" as const, year: 2026 };
const spring = { season: "spring" as const, year: 2027 };

const club = (
  id: string,
  name: string,
  state: string,
  games: Played[],
  options: { city?: string; season?: typeof fall | typeof spring } = {}
): GcTeamSchedule => ({
  profile: {
    id,
    name,
    ageLevel: 9,
    season: options.season ?? fall,
    state,
    ...(options.city ? { city: options.city } : {}),
  },
  games,
  fetchedAt: "2026-09-22T12:00:00.000Z",
});

/**
 * The schedules, pulled in order. `today` is the day of the pull, for fixtures whose games are
 * scored on dates still ahead of the real clock: a schedule that is nothing but results from the
 * future is refused as invented (`isInventedSchedule`), which is not what these tests are about.
 */
const fold = (
  schedules: GcTeamSchedule[],
  today?: string,
  from: GcImportState = empty
): GcImportState => {
  const importer = createGcImporter(from, today === undefined ? {} : { today });
  schedules.forEach((schedule) => importer.add(schedule));
  return importer.state;
};

const pulled = (state: GcImportState, gcId: string) =>
  state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === gcId))!;

/** The stand-ins that have a game on this day. */
const standIns = (state: GcImportState, date = DAY) => {
  const busy = new Set(
    state.games.filter((game) => game.date === date).flatMap((game) => [game.teamAId, game.teamBId])
  );
  return state.teams.filter((team) => team.nameOnly && busy.has(team.id)).map((team) => team.name);
};

/** The games a club is on, on one day. */
const onDay = (state: GcImportState, teamId: string, date: string) =>
  state.games.filter((game) => game.date === date && [game.teamAId, game.teamBId].includes(teamId));

/** The result from `teamId`'s seat. */
const resultFor = (
  game: { teamAId: string; teamAScore?: number; teamBScore?: number },
  teamId: string
) =>
  game.teamAId === teamId ? [game.teamAScore, game.teamBScore] : [game.teamBScore, game.teamAScore];

/**
 * Two schedules as they were pasted from GameChanger on 22 September 2026: the Cincy Stix 9U Navy
 * of Harrison, Ohio, and an Ohio club called just "Hurricanes". They met on the 20th and the Stix
 * won 13-2. Each coach typed the other side's name by hand: the Stix wrote "Hurricanes", which is
 * the club's whole name, and the Hurricanes wrote "Stix", which is one word of "Cincy Stix Navy".
 * The start times here are invented — the paste showed none for a finished game — and differ by
 * half an hour, because two coaches typing a time independently often do.
 */
const DAY = "2026-09-20";
const STIX = "tu9c21dMzowB";
const HURRICANES = "bKpjvY5AVqOV";
/** A second Ohio 9U club of the same name, which is what the name alone cannot tell apart. */
const TOLEDO = "gcTOLEDOHUR1";

const stix = (
  startTs = "2026-09-20T17:30:00.000Z",
  score: [number | undefined, number | undefined] = [13, 2]
) =>
  club(STIX, "Cincy Stix 9U Navy", "OH", [played("s-0920", "Hurricanes", DAY, ...score, startTs)], {
    city: "Harrison",
    season: spring,
  });
const hurricanes = (
  options: {
    opponent?: string;
    state?: string;
    score?: [number | undefined, number | undefined];
    startTs?: string;
  } = {}
) =>
  club(HURRICANES, "Hurricanes", options.state ?? "OH", [
    played(
      "h-0920",
      options.opponent ?? "Stix",
      DAY,
      ...(options.score ?? [2, 13]),
      options.startTs ?? "2026-09-20T17:00:00.000Z"
    ),
  ]);
const toledo = club(
  TOLEDO,
  "Hurricanes 9U",
  "OH",
  [played("t-0913", "Mud Hens 9U", "2026-09-13", 4, 3)],
  {
    city: "Toledo",
  }
);

describe("the Stix and the Hurricanes, 20 September 2026", () => {
  /*
   * With another Ohio "Hurricanes" at 9U in the pool the Stix's "Hurricanes" names nobody in
   * particular, and with the times disagreeing the import cannot tell from the fixture either. The
   * Hurricanes' half went on a "Stix" stand-in, the Stix's half on a "Hurricanes" stand-in, and two
   * clubs that had met had no game between them.
   */
  it("is one game between the two clubs when each end was filed against a stand-in", () => {
    const folded = fold([toledo, hurricanes(), stix()]);
    expect(standIns(folded).sort()).toEqual(["Hurricanes", "Stix"]);

    const pool = tidyPool(folded).state;
    const a = pulled(pool, STIX);
    const b = pulled(pool, HURRICANES);
    const day = onDay(pool, a.id, DAY);
    expect(day).toHaveLength(1);
    expect([day[0]!.teamAId, day[0]!.teamBId].sort()).toEqual([a.id, b.id].sort());
    expect(resultFor(day[0]!, a.id)).toEqual([13, 2]);
    expect(onDay(pool, pulled(pool, TOLEDO).id, DAY)).toEqual([]);
    expect(standIns(pool)).toEqual([]);
  });

  /*
   * The same two schedules with the Stix pulled before the real Hurricanes: the Stix's "Hurricanes"
   * went by name to the Toledo club, the only one there was, and the real Hurricanes' own copy of the
   * game sat against a "Stix" stand-in. Nothing could move it, because the only schedule that could
   * vouch for the row did not name the Stix the way GameChanger lists them.
   */
  it("takes the result off a namesake when the real club's schedule holds it against a stand-in", () => {
    const folded = fold([toledo, stix(), hurricanes()]);
    expect(onDay(folded, pulled(folded, TOLEDO).id, DAY)).toHaveLength(1);

    const pool = tidyPool(folded).state;
    const a = pulled(pool, STIX);
    const b = pulled(pool, HURRICANES);
    const day = onDay(pool, a.id, DAY);
    expect(day).toHaveLength(1);
    expect([day[0]!.teamAId, day[0]!.teamBId].sort()).toEqual([a.id, b.id].sort());
    expect(resultFor(day[0]!, b.id)).toEqual([2, 13]);
    expect(onDay(pool, pulled(pool, TOLEDO).id, DAY)).toEqual([]);
    expect(standIns(pool)).toEqual([]);
  });

  it("leaves the namesake's row alone when the real club's schedule gives another result", () => {
    // Two games, or two scorekeepers who disagree: either way not evidence the row is misfiled.
    const pool = tidyPool(fold([toledo, stix(), hurricanes({ score: [2, 12] })])).state;
    expect(onDay(pool, pulled(pool, TOLEDO).id, DAY)).toHaveLength(1);
    expect(standIns(pool)).toEqual(["Stix"]);
  });

  it("leaves the namesake's row alone on two results that contradict at two different times", () => {
    // At another time a contradicting result is as likely a second game as this one scored apart.
    const pool = tidyPool(fold([toledo, stix(), hurricanes({ score: [3, 13] })])).state;
    expect(onDay(pool, pulled(pool, TOLEDO).id, DAY)).toHaveLength(1);
  });

  it("leaves the namesake's row alone on an unscored game at two different times", () => {
    const pool = tidyPool(
      fold([
        toledo,
        club(STIX, "Cincy Stix 9U Navy", "OH", [
          played(
            "s-1004",
            "Hurricanes",
            "2026-10-04",
            undefined,
            undefined,
            "2026-10-04T15:00:00.000Z"
          ),
        ]),
        club(HURRICANES, "Hurricanes", "OH", [
          played("h-1004", "Stix", "2026-10-04", undefined, undefined, "2026-10-04T16:00:00.000Z"),
        ]),
      ])
    ).state;
    expect(onDay(pool, pulled(pool, TOLEDO).id, "2026-10-04")).toHaveLength(1);
  });
});

describe("joinCrossedHalves", () => {
  type Half = {
    /** What this club's coach typed for the other side. */
    typed: string;
    score?: [number, number];
    startTs?: string;
  };
  /**
   * A pool holding exactly the two halves, built by hand: which of the import's routes leaves a
   * game in this shape depends on the order the clubs arrived in and on what else is pulled, and
   * the tests above cover that. These pin the join itself.
   */
  const halves = (
    ours: Half & { date?: string },
    theirs: Half & { state?: string; name?: string; gcId?: string },
    extra: { gcId: string; name: string; half: Half }[] = []
  ): GcImportState => {
    const date = ours.date ?? DAY;
    const clubs = [
      { gcId: STIX, name: "Cincy Stix 9U Navy", state: "OH", half: ours },
      {
        gcId: theirs.gcId ?? HURRICANES,
        name: theirs.name ?? "Hurricanes",
        state: theirs.state ?? "OH",
        half: theirs,
      },
      ...extra.map((entry) => ({ ...entry, state: "OH" })),
    ];
    const base = fold(clubs.map((entry) => club(entry.gcId, entry.name, entry.state, [])));
    const ageGroupId = base.ageGroups[0]!.id;
    const teams = [...base.teams];
    const games = clubs.map((entry, at) => {
      const standIn = { id: `stand-${at}`, name: entry.half.typed, nameOnly: true as const };
      teams.push(standIn);
      const [mine, theirs] = entry.half.score ?? [undefined, undefined];
      return {
        id: `gc_${entry.gcId}_${at}`,
        teamAId: pulled(base, entry.gcId).id,
        teamBId: standIn.id,
        ageGroupId,
        date,
        ...(mine === undefined ? {} : { teamAScore: mine, teamBScore: theirs }),
        ...(entry.half.startTs ? { startTs: entry.half.startTs } : {}),
        source: { kind: "gamechanger" as const, teamId: entry.gcId, gameId: String(at) },
      };
    });
    return { ...base, teams, games };
  };
  const stixHalf: Half = {
    typed: "Hurricanes",
    score: [13, 2],
    startTs: "2026-09-20T17:30:00.000Z",
  };
  const hurricanesHalf: Half = {
    typed: "Stix",
    score: [2, 13],
    startTs: "2026-09-20T17:00:00.000Z",
  };

  it("joins the two halves into one game between the two clubs", () => {
    const out = joinCrossedHalves(halves(stixHalf, hurricanesHalf));
    expect(out.joined).toBe(1);
    const a = pulled(out.state, STIX);
    const b = pulled(out.state, HURRICANES);
    expect(out.state.games).toHaveLength(1);
    const row = out.state.games[0]!;
    expect([row.teamAId, row.teamBId].sort()).toEqual([a.id, b.id].sort());
    expect(resultFor(row, a.id)).toEqual([13, 2]);
    // The other club's schedule is remembered on the row that survives.
    expect(row.alsoFrom).toEqual([HURRICANES]);
    expect(out.state.teams.filter((team) => team.nameOnly)).toEqual([]);
  });

  it("keeps a stand-in it empties that a claimed row elsewhere goes back to", () => {
    // Another game holds a row of some schedule's that was filed against the Stix's "Hurricanes"
    // stand-in and claimed: the stand-in is where that row goes back, whatever the join takes.
    const pool = halves(stixHalf, hurricanesHalf);
    const standIn = pool.games[0]!.teamBId;
    const holder = {
      ...pool.games[1]!,
      teamBId: pulled(pool, STIX).id,
      id: "gc_OTHER_1",
      date: "2026-09-27",
      startTs: "2026-09-27T17:00:00.000Z",
      source: { kind: "gamechanger" as const, teamId: "OTHER", gameId: "1" },
      alsoFrom: ["ELSE"],
      alsoRows: [{ teamId: "ELSE", gameId: "e1", filedAgainst: standIn }],
    };
    const out = joinCrossedHalves({ ...pool, games: [...pool.games, holder] });
    expect(out.joined).toBe(1);
    expect(out.state.teams.filter((team) => team.nameOnly).map((team) => team.id)).toEqual([
      standIn,
    ]);
  });

  it("joins a stand-in whose name is longer than the club's, the word they share not its first", () => {
    // "NKY Hurricanes" fits "Hurricanes", every word of the shorter in the longer; a lookup filed
    // under the stand-in's first word alone looks for "nky" and finds no club.
    const out = joinCrossedHalves(halves({ ...stixHalf, typed: "NKY Hurricanes" }, hurricanesHalf));
    expect(out.joined).toBe(1);
    expect(out.state.games).toHaveLength(1);
  });

  it("joins across a state line into a neighbouring state", () => {
    expect(joinCrossedHalves(halves(stixHalf, { ...hurricanesHalf, state: "KY" })).joined).toBe(1);
  });

  it("does not join two clubs a country apart, whatever their names", () => {
    const pool = halves(stixHalf, { ...hurricanesHalf, state: "FL" });
    const out = joinCrossedHalves(pool);
    expect(out.joined).toBe(0);
    expect(out.state).toBe(pool);
  });

  it("does not join two results that do not mirror at two different times", () => {
    // At another time a contradicting result is as likely a second game as a dispute about this one.
    expect(joinCrossedHalves(halves(stixHalf, { ...hurricanesHalf, score: [2, 12] })).joined).toBe(
      0
    );
  });

  /*
   * The Stix have posted nothing; the Hurricanes' 2-13 is the only result, and the join lends it to
   * the Stix's row. Lent, so the Hurricanes' correction to 11-2 reaches both clubs rather than
   * leaving the Stix holding a win no schedule gives.
   */
  it("lends a result only the other half has, and follows that club's correction", () => {
    const unscored: Half = { typed: "Hurricanes", startTs: stixHalf.startTs! };
    const lent: Half = { ...hurricanesHalf, startTs: stixHalf.startTs! };
    const out = joinCrossedHalves(halves(unscored, lent));
    expect(out.joined).toBe(1);
    expect(out.state.games[0]!.scoreFromB).toBe(true);
    let pool = tidyPool(halves(unscored, lent)).state;
    const corrected = club(HURRICANES, "Hurricanes", "OH", [
      played("1", "Stix", DAY, 11, 2, stixHalf.startTs!),
    ]);
    pool = tidyPool(fold([corrected], undefined, pool)).state;
    const stixId = pulled(pool, STIX).id;
    expect(onDay(pool, stixId, DAY).map((game) => scoreSeenBy(game, stixId))).toEqual([
      { own: 2, opponent: 11 },
    ]);
  });

  describe("two coaches who scored one game apart", () => {
    const apart: Half = { ...hurricanesHalf, score: [3, 13], startTs: stixHalf.startTs! };

    it("joins them at one start time, each club keeping its own schedule's score", () => {
      const out = joinCrossedHalves(halves(stixHalf, apart));
      expect(out.joined).toBe(1);
      expect(out.state.games).toHaveLength(1);
      const row = out.state.games[0]!;
      const stixId = pulled(out.state, STIX).id;
      expect([row.teamAId, row.teamBId].sort()).toEqual(
        [stixId, pulled(out.state, HURRICANES).id].sort()
      );
      expect(resultFor(row, stixId)).toEqual([13, 2]);
      // In the row's own order, Stix first: the Hurricanes had it 13-3, and read it so.
      expect(row.teamAId).toBe(stixId);
      expect(row.reportedByB).toEqual({ teamAScore: 13, teamBScore: 3 });
      expect(scoreSeenBy(row, pulled(out.state, HURRICANES).id)).toEqual({ own: 3, opponent: 13 });
      expect(row.note).toBeUndefined();
    });

    it("takes a half that agrees over one at the same instant that does not", () => {
      const gold = { gcId: "gcHURGOLD001", name: "Hurricanes Gold", half: apart };
      const out = joinCrossedHalves(halves(stixHalf, hurricanesHalf, [gold]));
      expect(out.joined).toBe(1);
      const row = out.state.games.find((game) => game.alsoFrom?.length)!;
      expect(row.alsoFrom).toEqual([HURRICANES]);
      expect(row.note).toBeUndefined();
    });

    it("does not fall back on a disputed half when two that agree could not be told apart", () => {
      /*
       * Two Hurricanes squads lost 2-13 to a "Stix" that day at other times, and a third was beaten
       * at the Stix's own start time and scored it 3-13. The clock could not choose between the
       * first two, and that is a guess between games, not a dispute about one.
       */
      const black = {
        gcId: "gcHURBLACK01",
        name: "Hurricanes Black",
        half: { ...hurricanesHalf, startTs: "2026-09-20T17:45:00.000Z" },
      };
      const gold = { gcId: "gcHURGOLD001", name: "Hurricanes Gold", half: apart };
      expect(joinCrossedHalves(halves(stixHalf, hurricanesHalf, [black, gold])).joined).toBe(0);
    });

    it("does not choose between two that scored it apart", () => {
      const gold = {
        gcId: "gcHURGOLD001",
        name: "Hurricanes Gold",
        half: { ...apart, score: [4, 13] as [number, number] },
      };
      expect(joinCrossedHalves(halves(stixHalf, apart, [gold])).joined).toBe(0);
    });

    it("keeps the one game through the whole tidy", () => {
      const at = "2026-09-20T17:30:00.000Z";
      const pool = tidyPool(
        fold([toledo, stix(at), hurricanes({ score: [3, 13], startTs: at })])
      ).state;
      const stixId = pulled(pool, STIX).id;
      const rows = onDay(pool, stixId, DAY);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.teamAId === stixId ? rows[0]!.teamBId : rows[0]!.teamAId).toBe(
        pulled(pool, HURRICANES).id
      );
      expect(resultFor(rows[0]!, stixId)).toEqual([13, 2]);
      expect(rows[0]!.reportedByB).toEqual({ teamAScore: 13, teamBScore: 3 });
      expect(standIns(pool)).toEqual([]);
    });
  });

  /*
   * The Hurricanes pulled before the Stix, each against a stand-in for the other at one start. The
   * join put the Stix's own row on record against the stand-in, where it read as neither side,
   * and the collapse later in the same tidy stood it back up on the Hurricanes' side.
   */
  describe("joined with the Hurricanes pulled first", () => {
    const at = "2026-09-20T17:30:00.000Z";

    it("keeps each club's own score through the tidy when the two disagree", () => {
      const pool = tidyPool(
        fold([toledo, hurricanes({ score: [5, 4], startTs: at }), stix(at, [6, 4])])
      ).state;
      const stixId = pulled(pool, STIX).id;
      const rows = onDay(pool, stixId, DAY);
      expect(rows).toHaveLength(1);
      expect(scoreSeenBy(rows[0]!, stixId)).toEqual({ own: 6, opponent: 4 });
      expect(scoreSeenBy(rows[0]!, pulled(pool, HURRICANES).id)).toEqual({ own: 5, opponent: 4 });
      expect(rows[0]!.note).toBeUndefined();
    });

    it("writes no note when the two agree", () => {
      const pool = tidyPool(fold([toledo, hurricanes({ startTs: at }), stix(at)])).state;
      const rows = onDay(pool, pulled(pool, STIX).id, DAY);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.note).toBeUndefined();
    });

    /*
     * The Stix have posted nothing and the Hurricanes' 2-13 is the only result. It is lent to the
     * Stix's row, so the Hurricanes' correction to 11-2 is both clubs' result, and not the Stix
     * still holding a win nobody's schedule gives.
     */
    it("follows the lending schedule's correction", () => {
      let pool = tidyPool(
        fold([toledo, hurricanes({ startTs: at }), stix(at, [undefined, undefined])])
      ).state;
      const hurricanesAt = hurricanes({ score: [11, 2], startTs: at });
      pool = tidyPool(fold([hurricanesAt], undefined, pool)).state;
      const stixId = pulled(pool, STIX).id;
      const rows = onDay(pool, stixId, DAY);
      expect(rows).toHaveLength(1);
      expect(scoreSeenBy(rows[0]!, stixId)).toEqual({ own: 2, opponent: 11 });
    });
  });

  it("does not join when a stand-in's name is not a shorthand for the other club", () => {
    expect(joinCrossedHalves(halves(stixHalf, { ...hurricanesHalf, typed: "Sharks" })).joined).toBe(
      0
    );
    expect(joinCrossedHalves(halves({ ...stixHalf, typed: "Sharks" }, hurricanesHalf)).joined).toBe(
      0
    );
  });

  it("does not join two clubs whose levels are far apart", () => {
    const pool = halves(stixHalf, hurricanesHalf);
    const older = {
      ...pool,
      games: pool.games.map((game) =>
        game.source?.teamId === HURRICANES ? { ...game, ageLevelA: 14 } : game
      ),
    };
    expect(joinCrossedHalves(older).joined).toBe(0);
  });

  it("does not guess between two halves that fit equally well", () => {
    // A second Hurricanes squad also lost 2-13 that day, to somebody it wrote down as "Stix".
    const black = {
      gcId: "gcHURBLACK01",
      name: "Hurricanes Black",
      half: { ...hurricanesHalf, startTs: "2026-09-20T17:45:00.000Z" },
    };
    expect(joinCrossedHalves(halves(stixHalf, hurricanesHalf, [black])).joined).toBe(0);
  });

  it("does not join when the other end could be the partner of two", () => {
    // The Stix's Gold squad also beat somebody it wrote down as "Hurricanes" 13-2 that day. From the
    // Navy's end there is one partner; from the Hurricanes' end "Stix" fits both squads.
    const gold = {
      gcId: "gcSTIXGOLD01",
      name: "Cincy Stix 9U Gold",
      half: { ...stixHalf, startTs: "2026-09-20T17:45:00.000Z" },
    };
    expect(joinCrossedHalves(halves(stixHalf, hurricanesHalf, [gold])).joined).toBe(0);
  });

  it("lets the clock pick between two that fit when only one starts at the same time", () => {
    const black = {
      gcId: "gcHURBLACK01",
      name: "Hurricanes Black",
      half: { ...hurricanesHalf, startTs: "2026-09-20T17:45:00.000Z" },
    };
    const out = joinCrossedHalves(
      halves(stixHalf, { ...hurricanesHalf, startTs: stixHalf.startTs }, [black])
    );
    expect(out.joined).toBe(1);
    const row = onDay(out.state, pulled(out.state, STIX).id, DAY)[0]!;
    expect([row.teamAId, row.teamBId]).toContain(pulled(out.state, HURRICANES).id);
  });

  it("does not guess between two that fit and both start at the same time", () => {
    const black = {
      gcId: "gcHURBLACK01",
      name: "Hurricanes Black",
      half: { ...hurricanesHalf, startTs: stixHalf.startTs },
    };
    expect(
      joinCrossedHalves(halves(stixHalf, { ...hurricanesHalf, startTs: stixHalf.startTs }, [black]))
        .joined
    ).toBe(0);
  });

  /*
   * The Hurricanes' coach wrote two different Headlines clubs as "Headlines1" and "Headlines2".
   * The name reads both as "Headlines" and cannot tell them apart; the game does. Each row joins the
   * Headlines club whose own schedule holds that fixture, and never the other.
   */
  it("sends Headlines1 and Headlines2 each to the club whose schedule holds that game", () => {
    // Both Headlines won 6-4, and every pair of coaches typed a different start time, so the day is
    // the only thing telling the two fixtures apart. The Toledo namesake keeps the import from
    // settling either game by the name "Hurricanes", which leaves them both to the join.
    const pool = tidyPool(
      fold(
        [
          toledo,
          club(HURRICANES, "Hurricanes", "OH", [
            played("h-1002", "Headlines1", "2026-10-02", 4, 6, "2026-10-02T21:30:00.000Z"),
            played("h-1009", "Headlines2", "2026-10-09", 4, 6, "2026-10-09T23:15:00.000Z"),
          ]),
          club("gcHEADNAGEL1", "Headlines 9U Nagel", "OH", [
            played("n-1009", "Hurricanes", "2026-10-09", 6, 4, "2026-10-09T23:00:00.000Z"),
          ]),
          club("gcHEADRED001", "Headlines 9U Red", "OH", [
            played("r-1002", "Hurricanes", "2026-10-02", 6, 4, "2026-10-02T21:00:00.000Z"),
          ]),
        ],
        // Pulled once both games had been played.
        "2026-10-31"
      )
    ).state;
    const b = pulled(pool, HURRICANES);
    const opponentOn = (date: string) => {
      const rows = onDay(pool, b.id, date);
      expect(rows).toHaveLength(1);
      return rows[0]!.teamAId === b.id ? rows[0]!.teamBId : rows[0]!.teamAId;
    };
    expect(opponentOn("2026-10-02")).toBe(pulled(pool, "gcHEADRED001").id);
    expect(opponentOn("2026-10-09")).toBe(pulled(pool, "gcHEADNAGEL1").id);
    expect(standIns(pool, "2026-10-02")).toEqual([]);
    expect(standIns(pool, "2026-10-09")).toEqual([]);
  });

  it("does not join two halves of a game not yet played, whatever the clock says", () => {
    /*
     * An unplayed game counts for nothing yet, and joining it on the clock alone threw away the
     * dropped row's id: when the game was put back a day and both clubs scored it, the dropped
     * club's re-pull could not find its own row and filed the game a second time. Once both
     * results are in, the mirrored result joins them.
     */
    const at = (a: string, b: string) =>
      joinCrossedHalves(halves({ typed: "Hurricanes", startTs: a }, { typed: "Stix", startTs: b }))
        .joined;
    expect(at("2026-09-20T15:00:00.000Z", "2026-09-20T15:00:00.000Z")).toBe(0);
    expect(at("2026-09-20T15:00:00.000Z", "2026-09-20T16:00:00.000Z")).toBe(0);
  });

  it("takes a result onto a game not yet scored only at the same start time", () => {
    const unscored = (startTs: string) => ({ typed: "Stix", startTs });
    expect(joinCrossedHalves(halves(stixHalf, unscored(stixHalf.startTs!))).joined).toBe(1);
    // Within the hour but not the same instant: with one result, the clock is all there is.
    expect(joinCrossedHalves(halves(stixHalf, unscored("2026-09-20T17:45:00.000Z"))).joined).toBe(
      0
    );
  });

  it("joins two mirrored results whatever the two clocks say that day", () => {
    /*
     * On the stand-in fixtures export of 22 September 2026, 104 of the 1,211 games this joins had
     * start times more than an hour apart and 19 were twelve hours apart, AM for PM; the same
     * searches a week off, where the game is not, joined no more with the clock ignored than with
     * it held to the hour.
     */
    const at = (startTs: string) =>
      joinCrossedHalves(halves(stixHalf, { ...hurricanesHalf, startTs })).joined;
    // Half an hour, as the two coaches typed it, and a full hour, as a clock a zone out would be.
    expect(at("2026-09-20T17:00:00.000Z")).toBe(1);
    expect(at("2026-09-20T18:30:00.000Z")).toBe(1);
    // Three hours, and twelve.
    expect(at("2026-09-20T20:30:00.000Z")).toBe(1);
    expect(at("2026-09-20T05:30:00.000Z")).toBe(1);
  });

  it("leaves idle stand-ins it did not empty where they are", () => {
    const pool = halves(stixHalf, hurricanesHalf);
    const idle = { id: "idle-1", name: "Idle Club", nameOnly: true as const };
    const out = joinCrossedHalves({ ...pool, teams: [...pool.teams, idle] });
    expect(out.joined).toBe(1);
    expect(out.state.teams.some((team) => team.id === "idle-1")).toBe(true);
  });

  it("takes the result from the other end when only it has one", () => {
    const out = joinCrossedHalves(
      halves({ typed: "Hurricanes", startTs: hurricanesHalf.startTs }, hurricanesHalf)
    );
    expect(out.joined).toBe(1);
    const a = pulled(out.state, STIX);
    expect(resultFor(out.state.games[0]!, a.id)).toEqual([13, 2]);
    // One result is no dispute, from either end.
    expect(out.state.games[0]!.note).toBeUndefined();
    const other = joinCrossedHalves(halves(stixHalf, { typed: "Stix", startTs: stixHalf.startTs }));
    expect(other.joined).toBe(1);
    expect(other.state.games[0]!.note).toBeUndefined();
  });
});

describe("nameFitsWithin", () => {
  it("reads a coach's shorthand for a club's listed name", () => {
    expect(nameFitsWithin("Stix", "Cincy Stix 9U Navy")).toBe(true);
    expect(nameFitsWithin("Hurricanes", "Hurricanes")).toBe(true);
    expect(nameFitsWithin("Dragons", "Dragons baseball 9u")).toBe(true);
    expect(nameFitsWithin("Angels", "Cincy Angels 9U - Hampton 9U")).toBe(true);
    // Either way round: the longer name can be the stand-in's.
    expect(nameFitsWithin("Northern Kentucky Hurricanes", "Hurricanes")).toBe(true);
  });

  it("takes a squad number off the end of a word", () => {
    expect(nameFitsWithin("Headlines1", "Headlines 9U Nagel")).toBe(true);
  });

  it("does not fit two names that each have a word the other lacks", () => {
    expect(nameFitsWithin("Stix Gold", "Cincy Stix Navy")).toBe(false);
    expect(nameFitsWithin("Sharks", "Cincy Stix Navy")).toBe(false);
  });

  it("does not fit a name that is nothing but filler", () => {
    expect(nameFitsWithin("Baseball Club", "Dragons Baseball Club")).toBe(false);
    expect(nameFitsWithin("9U", "Dragons 9U")).toBe(false);
  });
});

describe("inOneRegion", () => {
  it("is one region across a shared border, either way round", () => {
    expect(inOneRegion("OH", "KY")).toBe(true);
    expect(inOneRegion("KY", "OH")).toBe(true);
    expect(inOneRegion("OH", "IN")).toBe(true);
    expect(inOneRegion("MO", "KS")).toBe(true);
    expect(inOneRegion("VA", "DC")).toBe(true);
  });

  it("is not one region two states apart", () => {
    expect(inOneRegion("OH", "TN")).toBe(false);
    expect(inOneRegion("OH", "FL")).toBe(false);
    // Lake Superior is not a border anybody drives across for a game.
    expect(inOneRegion("MI", "MN")).toBe(false);
  });

  it("does not call a state nobody knows far away", () => {
    expect(inOneRegion(undefined, "OH")).toBe(true);
    expect(inOneRegion("OH", "")).toBe(true);
  });

  it("is read both ways for every border", () => {
    ["OH", "TX", "NY", "CA", "TN", "MO"].forEach((state) => {
      borderingStates(state).forEach((neighbour) => {
        expect(borderingStates(neighbour).has(state)).toBe(true);
      });
    });
    expect(borderingStates("TN").size).toBe(8);
    expect(borderingStates("MO").size).toBe(8);
    expect(borderingStates("HI").size).toBe(0);
  });
});
