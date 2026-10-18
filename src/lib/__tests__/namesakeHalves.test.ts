import { describe, expect, it } from "vitest";
import { createGcImporter, describeTidy, tidyPool, type GcImportState } from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { refusalOf } from "../notThisTeam";
import {
  filedTeamIds,
  gcRowId,
  withFiledRepointed,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import { countsTowardRating, scoreSeenBy } from "../teamRankings/games";

/*
 * One game held twice because both pulled clubs filed their copy against a stand-in. Club A's own
 * row is against a stand-in carrying club B's very name, and club B's own row of the same game, at
 * the same hour with the result mirrored, is against a stand-in or a slot standing for A. Neither
 * row names the other club as GameChanger lists it, so the crossed-halves join, the slot settle and
 * the claim step each pass them by, and both clubs count the game. The pools here are built as a
 * backup holds them, with invented clubs.
 */

const ageGroups: AgeGroup[] = [
  { id: "ag11", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
  { id: "ag12", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
  { id: "ag13", name: "13U 2027", ageLevel: 13, year: 2027, seasonIds: [] },
  { id: "ag14", name: "14U 2027", ageLevel: 14, year: 2027, seasonIds: [] },
  { id: "ag15", name: "15U 2027", ageLevel: 15, year: 2027, seasonIds: [] },
];
const levelOf = (page: string) => Number(page.slice(2));

const club = (id: string, name: string, state: string, page: string): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: page, ageLevel: levelOf(page) }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const slot = (id: string, name: string): ScoutTeam => ({ id, name, placeholder: true });

/** `clubId`'s own row `gameId`, standing as a game against `against`, its own score first. */
const row = (
  clubId: string,
  gameId: string,
  against: string,
  page: string,
  start: string,
  score?: [number, number]
): ScoutGame => ({
  id: `gc_gc${clubId}_${gameId}`,
  teamAId: clubId,
  teamBId: against,
  ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
  ageGroupId: page,
  date: start.slice(0, 10),
  ageLevelA: levelOf(page),
  season: "Fall 2026",
  startTs: `${start}:00.000Z`,
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});

const pool = (teams: ScoutTeam[], games: ScoutGame[]): GcImportState => ({
  ageGroups,
  teams,
  games,
});

/** Each game as one line, by the names of its sides: what the tidy did, readable in a diff. */
const linesOf = (state: GcImportState): string[] => {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const label = (id: string) => {
    const team = teamById.get(id);
    if (!team) return `${id}?`;
    return `${team.name}${team.gcTeams?.length ? "" : team.placeholder ? " (slot)" : " (stand-in)"}`;
  };
  return state.games
    .map((game) => {
      const score = game.teamAScore === undefined ? "v" : `${game.teamAScore}-${game.teamBScore}`;
      const levels = `${game.ageLevelA ?? "-"}/${game.ageLevelB ?? "-"}`;
      const held = (game.alsoRows ?? [])
        .map(
          (record) =>
            `${record.teamId}:${record.gameId}` +
            (record.filedAgainst ? ` filed against ${label(record.filedAgainst)}` : "")
        )
        .join("; ");
      return (
        `${game.date} ${game.startTs?.slice(11, 16)} ${game.ageGroupId} ${levels} ` +
        `${label(game.teamAId)} ${score} ${label(game.teamBId)}` +
        (held ? ` [holds ${held}]` : "")
      );
    })
    .sort();
};
/** What a tidy did to a pool: each game as a line, and the steps that changed anything. */
const tidied = (state: GcImportState) => {
  const out = tidyPool(state);
  const counts = Object.fromEntries(
    Object.entries(out).filter(([key, value]) => key !== "state" && key !== "passes" && value !== 0)
  );
  return { lines: linesOf(out.state), counts };
};

const DAY = "2026-10-03";
const ridge = club("RIDGE", "North Ridge Bombers", "IN", "ag12");
const hustle = club("HUSTLE", "Lakeshore Hustle", "IN", "ag13");

/** The shape the audit found most: a stand-in each side, one level apart. */
const standInEachSide = () =>
  pool(
    [
      ridge,
      hustle,
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-RIDGE", "NR - Ridge Bombers"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h1", "S-RIDGE", "ag13", `${DAY}T14:00`, [11, 4]),
    ]
  );

/** A slot on B's side, two clubs a country apart at one level: out of the import's reach. */
const slotOnB = () =>
  pool(
    [
      club("WAR", "Valley Warriors", "CA", "ag12"),
      club("STARS", "Hudson Stars", "NY", "ag12"),
      standIn("S-STARS", "Hudson Stars"),
      slot("TBD-1", "TBD- 09/11/26, 6:00 PM"),
    ],
    [
      row("WAR", "w1", "S-STARS", "ag12", "2026-09-11T22:00", [8, 3]),
      row("STARS", "s1", "TBD-1", "ag12", "2026-09-11T22:00", [3, 8]),
    ]
  );

/** A slot on B's side an hour off, B a level below A. */
const slotAnHourOff = () =>
  pool(
    [
      club("TIGERS", "Lakeview Tigers", "IL", "ag15"),
      club("HEAT", "Prairie Heat - Ortiz", "IL", "ag14"),
      standIn("S-HEAT", "Prairie Heat-Ortiz"),
      slot("TBD-2", "TBD- 10/03/26, 6:00 PM"),
    ],
    [
      row("TIGERS", "t1", "S-HEAT", "ag15", `${DAY}T22:00`, [5, 8]),
      row("HEAT", "p1", "TBD-2", "ag14", `${DAY}T23:00`, [8, 5]),
    ]
  );

/** B's mirrored row a week after A's, at the same clock: another meeting, not this one. */
const aWeekOff = () =>
  pool(
    [
      ridge,
      hustle,
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-RIDGE", "NR - Ridge Bombers"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h8", "S-RIDGE", "ag13", "2026-10-10T14:00", [11, 4]),
    ]
  );

/** B's row gives A's result from its own seat: two results, not one game seen from two sides. */
const notMirrored = () =>
  pool(
    [
      ridge,
      hustle,
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-RIDGE", "NR - Ridge Bombers"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h1", "S-RIDGE", "ag13", `${DAY}T14:00`, [4, 11]),
    ]
  );

/** Two pulled clubs carry the stand-in's name, and each has a mirrored row within the hour. */
const twoNamesakes = () =>
  pool(
    [
      ridge,
      hustle,
      club("HUSTLE2", "Lakeshore Hustle", "OH", "ag11"),
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      slot("TBD-3", "TBD"),
      slot("TBD-4", "TBD"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h1", "TBD-3", "ag13", `${DAY}T14:00`, [11, 4]),
      row("HUSTLE2", "o1", "TBD-4", "ag11", `${DAY}T14:30`, [11, 4]),
    ]
  );

/** Two clubs each filed a row against a stand-in of B's name that B's one row mirrors. */
const twoNamers = () =>
  pool(
    [
      ridge,
      hustle,
      club("PINES", "North Pines Bombers", "IN", "ag12"),
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-HUSTLE-2", "Lakeshore Hustle"),
      slot("TBD-5", "TBD"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("PINES", "n1", "S-HUSTLE-2", "ag12", `${DAY}T14:20`, [4, 11]),
      row("HUSTLE", "h1", "TBD-5", "ag13", `${DAY}T14:00`, [11, 4]),
    ]
  );

/** Neither side has a result yet, at the very same minute. */
const unscored = () =>
  pool(
    [
      ridge,
      hustle,
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-RIDGE", "NR - Ridge Bombers"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`),
      row("HUSTLE", "h1", "S-RIDGE", "ag13", `${DAY}T14:00`),
    ]
  );

/** B's stand-in shares no word with A's name. */
const noWordShared = () =>
  pool(
    [ridge, hustle, standIn("S-HUSTLE", "Lakeshore Hustle"), standIn("S-COMETS", "Saginaw Comets")],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h1", "S-COMETS", "ag13", `${DAY}T14:00`, [11, 4]),
    ]
  );

/** B's page three levels from A's. */
const threeLevelsApart = () =>
  pool(
    [
      club("RIDGE11", "North Ridge Bombers", "IN", "ag11"),
      club("HUSTLE14", "Lakeshore Hustle", "IN", "ag14"),
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      slot("TBD-6", "TBD"),
    ],
    [
      row("RIDGE11", "r1", "S-HUSTLE", "ag11", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE14", "h1", "TBD-6", "ag14", `${DAY}T14:00`, [11, 4]),
    ]
  );

describe("the tidy with the namesake join, against the pin from before it", () => {
  /*
   * The pin from before the join, each shape's line by line: both copies stood, each counted for
   * its own club. The three shapes the join reads as one game now hold one game between the two
   * clubs, on A's row and A's page, at B's own level, with B's row held as a claim against the team
   * it named; the decoys read as they did, to the line.
   */
  it("holds the stand-in each side shape once, where it held it twice", () => {
    expect(tidied(standInEachSide())).toEqual({
      counts: { namesakeJoined: 1 },
      lines: [
        "2026-10-03 14:00 ag12 12/13 North Ridge Bombers 4-11 Lakeshore Hustle [holds gcHUSTLE:h1 filed against NR - Ridge Bombers (stand-in)]",
      ],
    });
  });

  it("holds the slot on B's side once, where it held it twice", () => {
    expect(tidied(slotOnB())).toEqual({
      counts: { namesakeJoined: 1 },
      lines: [
        "2026-09-11 22:00 ag12 12/12 Valley Warriors 8-3 Hudson Stars [holds gcSTARS:s1 filed against TBD- 09/11/26, 6:00 PM (slot)]",
      ],
    });
  });

  it("holds the slot an hour off once, where it held it twice", () => {
    expect(tidied(slotAnHourOff())).toEqual({
      counts: { namesakeJoined: 1 },
      lines: [
        "2026-10-03 22:00 ag15 15/14 Lakeview Tigers 5-8 Prairie Heat - Ortiz [holds gcHEAT:p1 filed against TBD- 10/03/26, 6:00 PM (slot)]",
      ],
    });
  });

  it.each([
    [
      "a week off",
      aWeekOff,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-10 14:00 ag13 13/- Lakeshore Hustle 11-4 NR - Ridge Bombers (stand-in)",
      ],
    ],
    [
      "a result not mirrored",
      notMirrored,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 4-11 NR - Ridge Bombers (stand-in)",
      ],
    ],
    [
      "two namesakes",
      twoNamesakes,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 11-4 TBD (slot)",
        "2026-10-03 14:30 ag11 11/- Lakeshore Hustle 11-4 TBD (slot)",
      ],
    ],
    [
      "two namers",
      twoNamers,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 11-4 TBD (slot)",
        "2026-10-03 14:20 ag12 12/- North Pines Bombers 4-11 Lakeshore Hustle (stand-in)",
      ],
    ],
    [
      "no result yet",
      unscored,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers v Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle v NR - Ridge Bombers (stand-in)",
      ],
    ],
    [
      "no word shared",
      noWordShared,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 11-4 Saginaw Comets (stand-in)",
      ],
    ],
    [
      "three levels apart",
      threeLevelsApart,
      [
        "2026-10-03 14:00 ag11 11/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag14 14/- Lakeshore Hustle 11-4 TBD (slot)",
      ],
    ],
  ])("leaves %s as it was", (_, build, lines) => {
    expect(tidied(build())).toEqual({ counts: {}, lines });
  });
});

/** A club's record as its page reads it: wins, losses and ties, each game once. */
const recordOf = (state: GcImportState, clubId: string) => {
  const tally = [0, 0, 0];
  state.games.forEach((game) => {
    if (game.teamAId !== clubId && game.teamBId !== clubId) return;
    if (!countsTowardRating(game, "2026-10-11")) return;
    const seen = scoreSeenBy(game, clubId);
    if (!seen) return;
    tally[seen.own > seen.opponent ? 0 : seen.own < seen.opponent ? 1 : 2]! += 1;
  });
  return tally.join("-");
};

/** A tidy, and a second over its result that finds nothing: the pool the join converges on. */
const settled = (state: GcImportState) => {
  const first = tidyPool(state);
  const again = tidyPool(first.state);
  expect(again.passes).toBe(1);
  expect(again.state.games).toBe(first.state.games);
  return first.state;
};

/** Every game holding the row, standing on it or folded in. */
const holdersOf = (state: GcImportState, rowId: string) =>
  state.games.filter(
    (game) =>
      (game.source && gcRowId(game.source.teamId, game.source.gameId) === rowId) ||
      game.alsoRows?.some((record) => gcRowId(record.teamId, record.gameId) === rowId)
  );

const RIDGE_ROW = gcRowId("gcRIDGE", "r1");
const HUSTLE_ROW = gcRowId("gcHUSTLE", "h1");

/** `state` with the game standing on `rowId` changed by `change`. */
const withGame = (
  state: GcImportState,
  rowId: string,
  change: (game: ScoutGame) => ScoutGame
): GcImportState => ({
  ...state,
  games: state.games.map((game) => (game.id === rowId ? change(game) : game)),
});

type Played = GcTeamSchedule["games"][number];
const played = (
  id: string,
  opponentName: string,
  start: string,
  score?: [number, number]
): Played => ({
  id,
  date: start.slice(0, 10),
  opponentName,
  status: score ? "completed" : "scheduled",
  ...(score ? { teamScore: score[0], opponentScore: score[1] } : {}),
  startTs: `${start}:00.000Z`,
});
const schedule = (club: ScoutTeam, level: number, games: Played[]): GcTeamSchedule => ({
  profile: {
    id: club.gcTeams![0]!.teamId,
    name: club.name,
    ageLevel: level,
    season: { season: "fall", year: 2026 },
    state: club.state!,
  },
  games,
  fetchedAt: "2026-10-11T12:00:00.000Z",
});
/** The schedules pulled again into `state`, as a refresh files them. */
const repulled = (state: GcImportState, schedules: GcTeamSchedule[]): GcImportState => {
  const importer = createGcImporter(state, { today: "2026-10-11" });
  schedules.forEach((pulledAgain) => importer.add(pulledAgain));
  return importer.state;
};
const ridgeAgain = (score: [number, number] = [4, 11]) =>
  schedule(ridge, 12, [played("r1", "Lakeshore Hustle", `${DAY}T14:00`, score)]);
const hustleAgain = (
  rows: Played[] = [played("h1", "NR - Ridge Bombers", `${DAY}T14:00`, [11, 4])]
) => schedule(hustle, 13, rows);

describe("the namesake join", () => {
  it("keeps the game on A's row and page, puts B in at B's own level, and holds B's row as a claim", () => {
    const after = settled(standInEachSide());
    expect(after.games).toHaveLength(1);
    const [game] = after.games as [ScoutGame];
    expect(game).toMatchObject({
      id: RIDGE_ROW,
      teamAId: "RIDGE",
      teamBId: "HUSTLE",
      teamAScore: 4,
      teamBScore: 11,
      ageGroupId: "ag12",
      ageLevelA: 12,
      // B's own row says 13U; read at A's page it would be 12U.
      ageLevelB: 13,
      joinedFrom: "S-HUSTLE",
      reportedByB: { teamAScore: 4, teamBScore: 11 },
      alsoFrom: ["gcHUSTLE"],
      alsoRows: [
        {
          teamId: "gcHUSTLE",
          gameId: "h1",
          startTs: `${DAY}T14:00:00.000Z`,
          ownScore: 11,
          opponentScore: 4,
          onSideB: true,
          filedAgainst: "S-RIDGE",
        },
      ],
    });
    // The name the row gave carried no age, so there is no level to put back.
    expect(game.joinedFromLevel).toBeUndefined();
    expect(recordOf(after, "RIDGE")).toBe("0-1-0");
    expect(recordOf(after, "HUSTLE")).toBe("1-0-0");
    // Both stand-ins stay in the roster, as where the two rows go back to.
    expect(after.teams.map((team) => team.id).sort()).toEqual(
      ["HUSTLE", "RIDGE", "S-HUSTLE", "S-RIDGE"].sort()
    );
    expect([...filedTeamIds(after.games)].sort()).toEqual(["S-HUSTLE", "S-RIDGE"]);
  });

  it("says what it did, in the tidy's summary", () => {
    expect(describeTidy(tidyPool(standInEachSide()))).toContain(
      "1 game one club filed under the other's very name and the other against a stand-in, now one game between them, or put back apart."
    );
  });

  it("counts each club once, where both counted the game before", () => {
    expect(recordOf(standInEachSide(), "RIDGE")).toBe("0-1-0");
    expect(recordOf(standInEachSide(), "HUSTLE")).toBe("1-0-0");
    const pool = standInEachSide();
    expect(pool.games.filter((game) => countsTowardRating(game, "2026-10-11"))).toHaveLength(2);
    expect(
      settled(pool).games.filter((game) => countsTowardRating(game, "2026-10-11"))
    ).toHaveLength(1);
  });

  it("joins a slot on B's side, and one an hour off at B's own level", () => {
    const slot = settled(slotOnB());
    expect(slot.games).toHaveLength(1);
    expect(slot.games[0]).toMatchObject({
      teamAId: "WAR",
      teamBId: "STARS",
      joinedFrom: "S-STARS",
    });
    const hour = settled(slotAnHourOff());
    expect(hour.games).toHaveLength(1);
    expect(hour.games[0]).toMatchObject({ teamBId: "HEAT", ageLevelB: 14, ageGroupId: "ag15" });
  });

  it("keeps the level the name gave, to put back", () => {
    const typed = withGame(standInEachSide(), RIDGE_ROW, (game) => ({ ...game, ageLevelB: 13 }));
    expect(settled(typed).games[0]).toMatchObject({ joinedFrom: "S-HUSTLE", joinedFromLevel: 13 });
  });

  it("joins where one coach typed an age a level off and the other's fits", () => {
    // A class year read a year out, or the event's age, on A's side; B typed A's own.
    const typed = withGame(
      withGame(standInEachSide(), RIDGE_ROW, (game) => ({ ...game, ageLevelB: 12 })),
      HUSTLE_ROW,
      (game) => ({ ...game, ageLevelB: 12 })
    );
    const [game] = settled(typed).games as [ScoutGame];
    expect(game).toMatchObject({ teamBId: "HUSTLE", ageLevelB: 13, joinedFromLevel: 12 });
    expect(game.alsoRows?.[0]).toMatchObject({ filedAgainst: "S-RIDGE", filedLevel: 12 });
  });

  describe("leaves a pair alone", () => {
    it("where both coaches typed an age and neither is the other club's own", () => {
      // Sibling squads: each coach typed its own squad's age for the other club's.
      const siblings = withGame(
        withGame(standInEachSide(), RIDGE_ROW, (game) => ({ ...game, ageLevelB: 12 })),
        HUSTLE_ROW,
        (game) => ({ ...game, ageLevelB: 13 })
      );
      expect(tidied(siblings).counts).toEqual({});
    });

    it("where B's stand-in is a team A's own schedule has played", () => {
      const pool = standInEachSide();
      const met = row("RIDGE", "r0", "S-RIDGE", "ag12", "2026-09-27T15:00", [6, 2]);
      expect(tidied({ ...pool, games: [...pool.games, met] }).counts).toEqual({});
    });

    it("where the user has thrown either row out", () => {
      const thrownA = withGame(standInEachSide(), RIDGE_ROW, (game) => ({
        ...game,
        excluded: true,
      }));
      const thrownB = withGame(standInEachSide(), HUSTLE_ROW, (game) => ({
        ...game,
        excluded: true,
      }));
      expect(tidied(thrownA).counts).toEqual({});
      expect(tidied(thrownB).counts).toEqual({});
    });

    it("where the owner has said A's name for B is not B", () => {
      const refused = new Set([refusalOf("gcRIDGE", "Lakeshore Hustle", "gcHUSTLE")]);
      const out = tidyPool(standInEachSide(), undefined, undefined, refused);
      expect(out.namesakeJoined).toBe(0);
      expect(out.state.games).toHaveLength(2);
    });
  });

  describe("a pull after the join", () => {
    const joined = () => settled(standInEachSide());

    it("finds both rows by their ids and neither splits the game nor files it again", () => {
      const before = joined();
      const importer = createGcImporter(before, { today: "2026-10-11" });
      // Nothing either schedule says is new: the level the join wrote is not read as a change.
      expect(importer.add(ridgeAgain())).toMatchObject({ gamesUpdated: 0, gamesUnchanged: 1 });
      expect(importer.add(hustleAgain())).toMatchObject({ gamesUpdated: 0, gamesUnchanged: 1 });
      expect(importer.state.games).toEqual(before.games);
      const pulled = repulled(before, [ridgeAgain(), hustleAgain()]);
      expect(holdersOf(pulled, RIDGE_ROW)).toHaveLength(1);
      expect(holdersOf(pulled, HUSTLE_ROW)).toHaveLength(1);
      const out = tidyPool(pulled);
      expect(out.namesakeJoined).toBe(0);
      expect(out.state.games).toHaveLength(1);
      expect(out.state.games[0]).toMatchObject({
        teamBId: "HUSTLE",
        joinedFrom: "S-HUSTLE",
        alsoRows: [{ gameId: "h1", filedAgainst: "S-RIDGE" }],
      });
      expect(recordOf(out.state, "HUSTLE")).toBe("1-0-0");
    });

    it("folds a refresh's second copy of B's row back into the game, newest word and all", () => {
      // A refresh of B's own page cannot see the game on A's, and files the row again.
      const before = joined();
      const again = row("HUSTLE", "h1", "S-RIDGE", "ag13", `${DAY}T14:05`, [11, 4]);
      const after = settled({ ...before, games: [...before.games, again] });
      expect(after.games).toHaveLength(1);
      expect(after.games[0]!.alsoRows?.[0]).toMatchObject({
        gameId: "h1",
        startTs: `${DAY}T14:05:00.000Z`,
        filedAgainst: "S-RIDGE",
      });
    });
  });

  describe("taken back, as a claim is", () => {
    const joined = () => settled(standInEachSide());
    const asFiled = [
      "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
      "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 11-4 NR - Ridge Bombers (stand-in)",
    ];

    it("puts both rows back where B's schedule has since moved its row a week", () => {
      const moved = repulled(joined(), [
        hustleAgain([played("h1", "NR - Ridge Bombers", "2026-10-10T14:00", [11, 4])]),
      ]);
      const out = settled(moved);
      expect(linesOf(out)).toEqual([
        asFiled[0],
        "2026-10-10 14:00 ag13 13/- Lakeshore Hustle 11-4 NR - Ridge Bombers (stand-in)",
      ]);
      expect(recordOf(out, "HUSTLE")).toBe("1-0-0");
    });

    it("puts both rows back where A's score no longer mirrors B's", () => {
      const out = settled(repulled(joined(), [ridgeAgain([5, 11])]));
      expect(linesOf(out)).toEqual([
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 5-11 Lakeshore Hustle (stand-in)",
        asFiled[1],
      ]);
    });

    it("puts A's row back where B's schedule no longer lists its row", () => {
      const gone = repulled(joined(), [
        hustleAgain([played("h9", "Saginaw Comets", "2026-09-27T16:00", [4, 4])]),
      ]);
      const out = settled(gone);
      expect(holdersOf(out, HUSTLE_ROW)).toEqual([]);
      expect(linesOf(out).filter((line) => line.includes("North Ridge Bombers"))).toEqual([
        asFiled[0],
      ]);
    });

    it("puts both rows back once the owner refuses A's name for B", () => {
      const refused = new Set([refusalOf("gcRIDGE", "Lakeshore Hustle", "gcHUSTLE")]);
      const out = tidyPool(joined(), undefined, undefined, refused);
      expect(out.namesakeJoined).toBe(1);
      expect(linesOf(out.state)).toEqual(asFiled);
    });

    it("puts both rows back where a second club of B's name has a row that fits", () => {
      const pool = joined();
      const second = club("HUSTLE2", "Lakeshore Hustle", "OH", "ag11");
      const out = settled({
        ...pool,
        teams: [...pool.teams, second, slot("TBD-9", "TBD")],
        games: [...pool.games, row("HUSTLE2", "o1", "TBD-9", "ag11", `${DAY}T14:10`, [11, 4])],
      });
      expect(linesOf(out)).toEqual([
        asFiled[0],
        asFiled[1],
        "2026-10-03 14:10 ag11 11/- Lakeshore Hustle 11-4 TBD (slot)",
      ]);
    });

    it("keeps the join as a plain claim once the stand-in it named has gone from the roster", () => {
      // Nothing is left to put A's row back against, so the mark goes and the claim step reads
      // B's row as any claim from then on.
      const pool = joined();
      const out = tidyPool({ ...pool, teams: pool.teams.filter((team) => team.id !== "S-HUSTLE") });
      expect(out.namesakeJoined).toBe(1);
      expect(out.state.games).toHaveLength(1);
      expect(out.state.games[0]!.joinedFrom).toBeUndefined();
      expect(out.state.games[0]).toMatchObject({
        teamBId: "HUSTLE",
        alsoRows: [{ gameId: "h1", filedAgainst: "S-RIDGE" }],
      });
      expect(tidyPool(out.state).state.games).toBe(out.state.games);
    });

    it("leaves a game the user has thrown out as the user left it", () => {
      const thrown = withGame(joined(), RIDGE_ROW, (game) => ({
        ...game,
        excluded: true,
        teamAScore: 4,
      }));
      const out = tidyPool(thrown);
      expect(out.namesakeJoined).toBe(0);
      expect(out.state.games).toHaveLength(1);
      expect(out.state.games[0]).toMatchObject({ teamBId: "HUSTLE", joinedFrom: "S-HUSTLE" });
    });
  });

  describe("read as B's own row by the steps after it", () => {
    it("is not given back by the claim step", () => {
      // Read as an ordinary claim, the copy holding it was not one B's rows could go into, and the
      // claim step gave it back every pass for the join to make again.
      const out = tidyPool(standInEachSide());
      expect(out.passes).toBe(2);
      expect(out.claimed).toBe(0);
    });

    it("takes no second row of B's into the game", () => {
      // B's 14:30 game against another North Ridge shorthand, a run off: its own game, not a copy.
      const pool = standInEachSide();
      const other = row("HUSTLE", "h2", "S-NR", "ag13", `${DAY}T14:30`, [12, 4]);
      const after = settled({
        ...pool,
        teams: [...pool.teams, standIn("S-NR", "N Ridge")],
        games: [...pool.games, other],
      });
      expect(holdersOf(after, gcRowId("gcHUSTLE", "h2"))).toEqual([
        expect.objectContaining({ id: gcRowId("gcHUSTLE", "h2"), teamBId: "S-NR" }),
      ]);
      expect(recordOf(after, "HUSTLE")).toBe("2-0-0");
    });

    it("keeps B's other game against A that day apart from it", () => {
      // B's 7-3 against A at six, filed by A's name, which A's own schedule does not list: the
      // regroup used to give it to the one copy of A's that day read as holding none of B's rows.
      const pool = standInEachSide();
      const named = row("HUSTLE", "h3", "RIDGE", "ag13", `${DAY}T18:00`, [7, 3]);
      const after = settled({ ...pool, games: [...pool.games, named] });
      expect(holdersOf(after, gcRowId("gcHUSTLE", "h3"))).toHaveLength(1);
      expect(recordOf(after, "HUSTLE")).toBe("2-0-0");
      expect(recordOf(after, "RIDGE")).toBe("0-2-0");
    });

    it("is not moved to another club of B's name whose own row has the game at its start", () => {
      // An Ohio club of B's name pulled after the join, its own row naming A at the very start with
      // no result yet: the reclaim moves a copy whose named club's schedule holds nothing of it to
      // such a club, and the joined game holds B's own row. With a result, the row is a second
      // copy of the game, which takes the join apart (below).
      const pool = settled(standInEachSide());
      const second = club("HUSTLE2", "Lakeshore Hustle", "OH", "ag13");
      const theirs = row("HUSTLE2", "o1", "RIDGE", "ag13", `${DAY}T14:00`);
      const out = tidyPool({
        ...pool,
        teams: [...pool.teams, second],
        games: [...pool.games, theirs],
      });
      expect(out.reclaimed).toBe(0);
      expect(out.namesakeJoined).toBe(0);
      const game = out.state.games.find((each) => each.id === RIDGE_ROW);
      expect(game).toMatchObject({ teamBId: "HUSTLE", joinedFrom: "S-HUSTLE" });
      expect(recordOf(out.state, "RIDGE")).toBe("0-1-0");
    });
  });

  /*
   * A copy of the game standing between either club and another pulled club, within the hour with
   * the result mirrored or within four runs of it, is a second reading of the game: beside it the
   * pair is not the only one. Read past it, a club pulled after the join whose own row named A or B
   * went onto that club by name beside the joined game, and the club counted the game twice
   * through every tidy after, where the tidy before the join counted it once.
   */
  describe("beside a copy naming either club itself", () => {
    const named = (theirs: [number, number]) => {
      const pool = settled(standInEachSide());
      return {
        ...pool,
        teams: [...pool.teams, club("HUSTLE2", "Lakeshore Hustle", "OH", "ag13")],
        games: [...pool.games, row("HUSTLE2", "o1", "RIDGE", "ag13", `${DAY}T14:00`, theirs)],
      };
    };

    it.each([
      ["mirrored", [11, 4] as [number, number]],
      ["a run off", [12, 4] as [number, number]],
    ])("comes apart where another club of B's name has its own row naming A, %s", (_, theirs) => {
      const out = tidyPool(named(theirs));
      expect(out.namesakeJoined).toBe(1);
      expect(recordOf(out.state, "RIDGE")).toBe("0-1-0");
      expect(recordOf(out.state, "HUSTLE")).toBe("1-0-0");
      expect(recordOf(out.state, "HUSTLE2")).toBe("1-0-0");
      // A's row goes into the copy that names A, and B's row back against the team it named.
      expect(holdersOf(out.state, RIDGE_ROW)).toEqual([
        expect.objectContaining({ id: gcRowId("gcHUSTLE2", "o1"), teamBId: "RIDGE" }),
      ]);
      expect(out.state.games.find((game) => game.id === HUSTLE_ROW)).toMatchObject({
        teamBId: "S-RIDGE",
      });
      expect(out.state.games.some((game) => game.joinedFrom !== undefined)).toBe(false);
      settled(out.state);
    });

    it("comes apart where A's own other team has the game against another club of B's name", () => {
      // A's second GameChanger team typed B's name, and the import put it on the club of that
      // name in reach: A's two rows of the game, the copy with A on its side A.
      const pool = settled(standInEachSide());
      const twoLinks: ScoutTeam = {
        ...ridge,
        gcTeams: [
          ...ridge.gcTeams!,
          { teamId: "gcRIDGE2", name: ridge.name, ageGroupId: "ag12", ageLevel: 12 },
        ],
      };
      const other: ScoutGame = {
        ...row("RIDGE", "x1", "HUSTLE2", "ag12", `${DAY}T14:00`, [4, 11]),
        id: gcRowId("gcRIDGE2", "x1"),
        source: { kind: "gamechanger", teamId: "gcRIDGE2", gameId: "x1" },
      };
      const out = tidyPool({
        ...pool,
        teams: [
          ...pool.teams.map((team) => (team.id === "RIDGE" ? twoLinks : team)),
          club("HUSTLE2", "Lakeshore Hustle", "IN", "ag12"),
        ],
        games: [...pool.games, other],
      });
      expect(out.namesakeJoined).toBe(1);
      expect(recordOf(out.state, "RIDGE")).toBe("0-1-0");
      expect(recordOf(out.state, "HUSTLE")).toBe("1-0-0");
      settled(out.state);
    });

    it("stays joined beside one more than an hour off, another game that day", () => {
      const pool = settled(standInEachSide());
      const out = tidyPool({
        ...pool,
        teams: [...pool.teams, club("HUSTLE2", "Lakeshore Hustle", "OH", "ag13")],
        games: [...pool.games, row("HUSTLE2", "o1", "RIDGE", "ag13", `${DAY}T16:30`, [11, 4])],
      });
      expect(out.namesakeJoined).toBe(0);
      expect(out.state.games.find((game) => game.id === RIDGE_ROW)).toMatchObject({
        teamBId: "HUSTLE",
        joinedFrom: "S-HUSTLE",
      });
    });

    it("stays joined beside one scored further apart than two scorekeepers are", () => {
      // 3-15 against 4-11 at the same start is two results, which the claim step leaves apart too.
      const out = tidyPool(named([15, 3]));
      expect(out.namesakeJoined).toBe(0);
      expect(out.state.games.find((game) => game.id === RIDGE_ROW)).toMatchObject({
        teamBId: "HUSTLE",
        joinedFrom: "S-HUSTLE",
      });
    });

    /** A pool built only by pulls, schedule by schedule, as a device's import files them. */
    const pulledInOrder = (...rounds: GcTeamSchedule[][]) =>
      rounds.reduce<GcImportState>((state, schedules) => repulled(state, schedules), pool([], []));
    /** A club's record as its page reads it, found by the GameChanger id the pull filed it under. */
    const recordOfGc = (state: GcImportState, gcId: string) =>
      recordOf(
        state,
        state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === gcId))?.id ?? gcId
      );
    // A, and B out of A's reach in Texas, so the import files each row against a stand-in.
    const farHustle = club("HUSTLE", "Lakeshore Hustle", "TX", "ag13");
    const ridgeRows = () =>
      schedule(ridge, 12, [played("r1", "Lakeshore Hustle", `${DAY}T14:00`, [4, 11])]);
    const hustleRows = () =>
      schedule(farHustle, 13, [played("h1", "NR - Ridge Bombers", `${DAY}T14:00`, [11, 4])]);

    it.each([
      [
        "a second club of B's name whose own row names A",
        () =>
          schedule(club("LAKE12", "Lakeshore Hustle", "IN", "ag12"), 12, [
            played("m1", "North Ridge Bombers", `${DAY}T14:00`, [11, 4]),
          ]),
        ["gcRIDGE", "gcHUSTLE", "gcLAKE12"],
        ["0-1-0", "1-0-0", "1-0-0"],
      ],
      [
        "a club whose own row names B",
        () =>
          schedule(club("NRB", "NR - Ridge Bombers", "TX", "ag13"), 13, [
            played("d1", "Lakeshore Hustle", `${DAY}T14:00`, [4, 11]),
          ]),
        ["gcRIDGE", "gcHUSTLE", "gcNRB"],
        ["0-1-0", "1-0-0", "0-1-0"],
      ],
    ])(
      "counts the game once where %s is pulled after the join, as pulled all at once",
      (_, later, ids, records) => {
        const first = tidyPool(pulledInOrder([ridgeRows()], [hustleRows()]));
        expect(first.namesakeJoined).toBe(1);
        // The import files the later row straight onto the club it names, beside the joined game.
        const afterwards = tidyPool(repulled(first.state, [later()]));
        expect(ids.map((id) => recordOfGc(afterwards.state, id))).toEqual(records);
        const atOnce = tidyPool(pulledInOrder([ridgeRows(), hustleRows(), later()]));
        expect(linesOf(afterwards.state)).toEqual(linesOf(atOnce.state));
        // A refresh of all three changes nothing more.
        const again = tidyPool(repulled(afterwards.state, [ridgeRows(), hustleRows(), later()]));
        expect(linesOf(again.state)).toEqual(linesOf(afterwards.state));
        expect(ids.map((id) => recordOfGc(again.state, id))).toEqual(records);
      }
    );
  });

  it("follows a stand-in it would put the row back against into the team it is merged with", () => {
    const [game] = settled(standInEachSide()).games as [ScoutGame];
    const merged = withFiledRepointed(game, (id) => (id === "S-HUSTLE" ? "S-MERGED" : id));
    expect(merged.joinedFrom).toBe("S-MERGED");
    expect(filedTeamIds([merged]).has("S-MERGED")).toBe(true);
  });
});
