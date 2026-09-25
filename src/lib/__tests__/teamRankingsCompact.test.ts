import { describe, expect, it } from "vitest";
import {
  decodeDate,
  decodeScoutGames,
  decodeScoutTeams,
  encodeDate,
  encodeScoutGames,
  encodeScoutTeams,
} from "../teamRankingsCompact";
import { coerceScoutGames, coerceScoutTeams } from "../teamRankingsStorage";
import type { ScoutGame, ScoutTeam } from "../teamRankings";

const roundTripGames = (games: ScoutGame[]): ScoutGame[] =>
  decodeScoutGames(JSON.parse(JSON.stringify(encodeScoutGames(games))), coerceScoutGames);

const roundTripTeams = (teams: ScoutTeam[]): ScoutTeam[] =>
  decodeScoutTeams(JSON.parse(JSON.stringify(encodeScoutTeams(teams))), coerceScoutTeams);

describe("dates as day numbers", () => {
  it("round-trips a plain date", () => {
    expect(decodeDate(encodeDate("2026-08-22"))).toBe("2026-08-22");
    expect(decodeDate(encodeDate("2020-01-01"))).toBe("2020-01-01");
    expect(decodeDate(encodeDate("2031-12-31"))).toBe("2031-12-31");
  });

  it("round-trips a leap day", () => {
    expect(decodeDate(encodeDate("2028-02-29"))).toBe("2028-02-29");
  });

  it("will not turn text into a day number", () => {
    expect(encodeDate(undefined)).toBeNull();
    expect(encodeDate("")).toBeNull();
    expect(encodeDate("last Tuesday")).toBeNull();
    expect(decodeDate(null)).toBeUndefined();
  });

  // Text in the date slot is a date the encoder could not read and kept verbatim rather than
  // discard, so reading it back gives the text, not nothing.
  it("gives back text in the date slot as it found it", () => {
    expect(decodeDate("August 22 2026")).toBe("August 22 2026");
    expect(decodeDate("")).toBeUndefined();
  });
});

describe("games round-trip", () => {
  it("keeps a game entered by hand exactly as it was", () => {
    const games: ScoutGame[] = [
      {
        id: "sg_manual_1",
        teamAId: "S-LEXI",
        teamBId: "S-OWEN",
        teamAScore: 7,
        teamBScore: 3,
        ageGroupId: "ag_1",
        date: "2026-08-22",
        event: "Fall Classic",
        note: "Rain delay",
        ageLevelA: 10,
        ageLevelB: 9,
        season: "Fall 2026",
        excluded: true,
      },
    ];
    expect(roundTripGames(games)).toEqual(games);
  });

  it("keeps a game pulled from GameChanger, source and all", () => {
    const games: ScoutGame[] = [
      {
        id: "gc_gcTEAM01_g9",
        teamAId: "S-LEXI",
        teamBId: "S-OWEN",
        teamAScore: 12,
        teamBScore: 2,
        ageGroupId: "ag_1",
        date: "2026-08-22",
        season: "Fall 2026",
        ageLevelA: 9,
        ageLevelB: 9,
        source: { kind: "gamechanger", teamId: "gcTEAM01", gameId: "g9" },
      },
    ];
    expect(roundTripGames(games)).toEqual(games);
  });

  it("keeps the start, every row folded into a game and the other club's score", () => {
    const games: ScoutGame[] = [
      {
        id: "gc_gcLEGACY01_l2",
        teamAId: "S-LEGA",
        teamBId: "S-RIVE",
        teamAScore: 14,
        teamBScore: 2,
        ageGroupId: "ag_1",
        date: "2026-08-29",
        startTs: "2026-08-29T17:00:00.000Z",
        alsoFrom: ["gcRAPTOR01"],
        alsoRows: [
          {
            teamId: "gcRAPTOR01",
            gameId: "r2",
            startTs: "2026-08-29T18:00:00.000Z",
            ownScore: 3,
            opponentScore: 14,
            onSideB: true,
          },
          { teamId: "gcLEGACY01", gameId: "l2-again", startTs: "2026-08-29T17:00:00.355Z" },
        ],
        scoreFromB: true,
        reportedByB: { teamAScore: 14, teamBScore: 3 },
        source: { kind: "gamechanger", teamId: "gcLEGACY01", gameId: "l2" },
      },
      {
        id: "gc_gcLEGACY01_l3",
        teamAId: "LEG",
        teamBId: "RAP",
        ageGroupId: "ag_1",
        teamAScore: 5,
        teamBScore: 3,
        date: "2026-08-30",
        alsoRows: [{ teamId: "gcLEGACY01", gameId: "l3b", ownScore: 5, opponentScore: 3 }],
        scoreFromTwin: true,
        source: { kind: "gamechanger", teamId: "gcLEGACY01", gameId: "l3" },
      },
    ];
    expect(roundTripGames(games)).toEqual(games);
  });

  // A scheduled game has no scores at all, and that is the difference between "not played" and
  // "nil-nil", so it must survive the trip as absence rather than as zero.
  it("keeps a scheduled game unscored", () => {
    const games: ScoutGame[] = [
      { id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag_1", date: "2026-09-01" },
    ];
    const [back] = roundTripGames(games);
    expect(back).toEqual(games[0]);
    expect(back?.teamAScore).toBeUndefined();
    expect(back?.teamBScore).toBeUndefined();
  });

  it("keeps a nil-nil game as nil-nil", () => {
    const games: ScoutGame[] = [
      { id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag_1", teamAScore: 0, teamBScore: 0 },
    ];
    const [back] = roundTripGames(games);
    expect(back?.teamAScore).toBe(0);
    expect(back?.teamBScore).toBe(0);
  });

  it("keeps many games, and the ids that tell them apart", () => {
    const games: ScoutGame[] = Array.from({ length: 50 }, (_, index) => ({
      id: `gc_gcTEAM01_g${index}`,
      teamAId: `T${index % 7}`,
      teamBId: `T${(index + 3) % 7}`,
      teamAScore: index,
      teamBScore: 50 - index,
      ageGroupId: index % 2 ? "ag_1" : "ag_2",
      date: `2026-08-${String((index % 28) + 1).padStart(2, "0")}`,
      source: { kind: "gamechanger" as const, teamId: "gcTEAM01", gameId: `g${index}` },
    }));
    expect(roundTripGames(games)).toEqual(games);
    expect(new Set(roundTripGames(games).map((game) => game.id)).size).toBe(50);
  });

  it("is empty for an empty pool", () => {
    expect(roundTripGames([])).toEqual([]);
  });
});

describe("teams round-trip", () => {
  it("keeps a plain team", () => {
    const teams: ScoutTeam[] = [{ id: "S-LEXI", name: "Lexington Legends" }];
    expect(roundTripTeams(teams)).toEqual(teams);
  });

  it("keeps everything a pulled team carries", () => {
    const teams: ScoutTeam[] = [
      {
        id: "S-TROS",
        name: "Trosky Illinois",
        isMine: true,
        state: "IL",
        city: "Chicago",
        gcTeams: [
          {
            teamId: "FtEExZwB4b8E",
            name: "2026 Fall Trosky Illinois 9U",
            ageGroupId: "ag_1",
            season: "fall",
            seasonYear: 2026,
            ageLevel: 9,
            avatarKey: "5192a689-d888-4ae5-abce-446885dca7c7",
            record: { win: 11, loss: 1, tie: 0 },
            importedAt: "2026-09-14T12:44:04.965Z",
          },
          {
            teamId: "aBcDeFgHiJkL",
            name: "2027 Spring Trosky Illinois 9U",
            ageGroupId: "ag_1",
            season: "spring",
            seasonYear: 2027,
            ageLevel: 9,
          },
        ],
      },
    ];
    expect(roundTripTeams(teams)).toEqual(teams);
  });

  it("keeps a nil-nil record rather than losing it", () => {
    const teams: ScoutTeam[] = [
      {
        id: "S-NEW",
        name: "New Club",
        gcTeams: [
          {
            teamId: "gcNEW0000000",
            name: "New Club 9U",
            ageGroupId: "ag_1",
            record: { win: 0, loss: 0, tie: 0 },
          },
        ],
      },
    ];
    expect(roundTripTeams(teams)[0]?.gcTeams?.[0]?.record).toEqual({ win: 0, loss: 0, tie: 0 });
  });

  it("is empty for an empty roster", () => {
    expect(roundTripTeams([])).toEqual([]);
  });
});

describe("a pool written before this format existed", () => {
  // The old format was the objects themselves, in an array. It must still load, or upgrading the
  // app would read as having lost every game.
  it("still loads games", () => {
    const legacy = [
      {
        id: "g1",
        teamAId: "A",
        teamBId: "B",
        teamAScore: 5,
        teamBScore: 4,
        ageGroupId: "ag_1",
        date: "2026-08-22",
      },
    ];
    const games = decodeScoutGames(legacy, coerceScoutGames);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: "g1", teamAScore: 5, teamBScore: 4 });
  });

  it("still loads teams", () => {
    const legacy = [{ id: "S-LEXI", name: "Lexington Legends", state: "KY" }];
    expect(decodeScoutTeams(legacy, coerceScoutTeams)).toEqual(legacy);
  });

  it("reads as empty when the stored value is nonsense", () => {
    expect(decodeScoutGames(null, coerceScoutGames)).toEqual([]);
    expect(decodeScoutGames("corrupt", coerceScoutGames)).toEqual([]);
    expect(decodeScoutGames({ v: 2 }, coerceScoutGames)).toEqual([]);
    expect(decodeScoutTeams(null, coerceScoutTeams)).toEqual([]);
    expect(decodeScoutTeams(42, coerceScoutTeams)).toEqual([]);
  });
});

describe("rows that cannot be trusted", () => {
  it("drops a game that lost a team or its page", () => {
    const pool = encodeScoutGames([
      { id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag_1" },
      { id: "g2", teamAId: "A", teamBId: "B", ageGroupId: "ag_1" },
    ]);
    // A row pointing at a team index that is not in the dictionary.
    pool.r[0]![0] = 99;
    const games = decodeScoutGames(pool, coerceScoutGames);
    expect(games).toHaveLength(1);
    expect(games[0]?.id).toBe("g2");
  });

  it("drops a team that lost its id or name", () => {
    const pool = encodeScoutTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    pool.r[0]![1] = null;
    expect(decodeScoutTeams(pool, coerceScoutTeams)).toHaveLength(1);
  });

  it("drops a link that lost the ids that make it one", () => {
    const pool = encodeScoutTeams([
      {
        id: "A",
        name: "Aces",
        gcTeams: [{ teamId: "gc1", name: "Aces 9U", ageGroupId: "ag_1" }],
      },
    ]);
    const links = pool.r[0]?.[5];
    if (Array.isArray(links)) (links[0] as unknown[])[0] = null;
    expect(decodeScoutTeams(pool, coerceScoutTeams)[0]?.gcTeams).toBeUndefined();
  });
});

describe("the size it is all for", () => {
  it("writes a pulled game in a fraction of what it took", () => {
    const games: ScoutGame[] = Array.from({ length: 500 }, (_, index) => ({
      id: `gc_gcTEAM000123_${index}`,
      teamAId: "S-CLUB0002",
      teamBId: "S-CLUB0003",
      teamAScore: 5,
      teamBScore: 3,
      ageGroupId: "ag_1789412345_123",
      date: "2026-08-01",
      ageLevelA: 9,
      ageLevelB: 9,
      season: "Fall 2026",
      source: { kind: "gamechanger" as const, teamId: "gcTEAM000123", gameId: `${index}` },
    }));

    const plain = JSON.stringify(games).length;
    const compact = JSON.stringify(encodeScoutGames(games)).length;
    // Measured around seven times on this shape; asserted loosely so a field added later is a
    // judgement call rather than a failing test.
    expect(compact * 4).toBeLessThan(plain);
    expect(roundTripGames(games)).toEqual(games);
  });
});

describe("what the encoder accepts, the decoder keeps", () => {
  // `cleanTeamName` leaves nothing behind for a team called only "9U", so an empty name is a real
  // thing to store. It used to encode fine and vanish on the next load, taking its games' opponent
  // with it.
  it("keeps a team whose name is empty", () => {
    const teams: ScoutTeam[] = [{ id: "S-X", name: "" }];
    expect(roundTripTeams(teams)).toEqual(teams);
  });

  it("keeps a GameChanger link whose name is empty", () => {
    const teams: ScoutTeam[] = [
      { id: "S-X", name: "Aces", gcTeams: [{ teamId: "gc1", name: "", ageGroupId: "ag_1" }] },
    ];
    expect(roundTripTeams(teams)).toEqual(teams);
  });

  // A date in a shape this does not parse is still a date somebody entered.
  it("keeps a date it cannot read as a day number", () => {
    const games: ScoutGame[] = [
      { id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag_1", date: "August 22 2026" },
    ];
    expect(roundTripGames(games)).toEqual(games);
  });

  it("still reads a plain date as a day number", () => {
    const games: ScoutGame[] = [
      { id: "g1", teamAId: "A", teamBId: "B", ageGroupId: "ag_1", date: "2026-08-22" },
    ];
    expect(roundTripGames(games)).toEqual(games);
    // Stored as a number, not as the eleven characters it came in as.
    expect(typeof encodeScoutGames(games).r[0]?.[5]).toBe("number");
  });

  // Written straight back out, "NaN-NaN-NaN" would be stored as though it were a date.
  it("reads a day number the calendar cannot hold as no date at all", () => {
    expect(decodeDate(Number.MAX_SAFE_INTEGER)).toBeUndefined();
    expect(decodeDate(-1e15)).toBeUndefined();
  });
});

describe("fields added after the format existed", () => {
  it("carries a slot's flag through a round trip", () => {
    const teams = [
      { id: "S-ACES", name: "Aces", isMine: true as const },
      { id: "S-TBD", name: "TBD- 08/04/26, 5:00 PM", placeholder: true as const },
    ];
    expect(decodeScoutTeams(encodeScoutTeams(teams), () => [])).toEqual(teams);
  });

  it("carries a game's start time through a round trip", () => {
    const games = [
      {
        id: "g1",
        teamAId: "S-ACES",
        teamBId: "S-TBD",
        ageGroupId: "ag1",
        teamAScore: 7,
        teamBScore: 3,
        date: "2026-09-05",
        startTs: "2026-09-05T18:00:00.000Z",
      },
    ];
    expect(decodeScoutGames(encodeScoutGames(games), () => [])).toEqual(games);
  });

  it("still reads a pool written before either field existed", () => {
    const teams = [{ id: "S-ACES", name: "Aces" }];
    const older = encodeScoutTeams(teams);
    // A row from before the flag existed simply stops earlier.
    older.r = older.r.map((row) => row.slice(0, 2));
    expect(decodeScoutTeams(older, () => [])).toEqual(teams);
  });
});

describe("the coaches and the roster size on a link", () => {
  const withStaff = (teamId: string, staff: string[], playerCount?: number): ScoutTeam => ({
    id: teamId,
    name: `Team ${teamId}`,
    gcTeams: [
      {
        teamId: `gc-${teamId}`,
        name: `GC ${teamId}`,
        ageGroupId: "ag_1",
        staff,
        ...(playerCount === undefined
          ? {}
          : { playerCount, countedAt: "2026-09-16T12:00:00.000Z" }),
      },
    ],
  });

  const roundTrip = (teams: ScoutTeam[]): ScoutTeam[] =>
    decodeScoutTeams(encodeScoutTeams(teams), () => []);

  it("comes back exactly as it went in", () => {
    const teams = [withStaff("a", ["Eric Varela", "Sam Wilson"], 23)];
    expect(roundTrip(teams)).toEqual(teams);
  });

  it("writes a name shared across a club once", () => {
    const encoded = encodeScoutTeams([
      withStaff("a", ["Eric Varela", "Sam Wilson"]),
      withStaff("b", ["Eric Varela", "Sam Wilson"]),
      withStaff("c", ["Eric Varela", "Cyndee Varela"]),
    ]);
    // A club's officer sits on every team it runs; three links, three distinct names.
    expect(encoded.p).toEqual(["Eric Varela", "Sam Wilson", "Cyndee Varela"]);
  });

  it("leaves the dictionary off a pool that has no staff", () => {
    const encoded = encodeScoutTeams([{ id: "a", name: "Aces" }]);
    // A pool typed in by hand is written exactly as it was before staff was stored.
    expect(encoded.p).toBeUndefined();
  });

  it("reads a pool written before staff existed as having none", () => {
    const encoded = encodeScoutTeams([withStaff("a", ["Eric Varela"], 12)]);
    // What an older writer produced: the first eleven slots and no dictionary.
    const older = {
      ...encoded,
      p: undefined,
      r: encoded.r.map((row) =>
        row.map((cell) =>
          Array.isArray(cell)
            ? (cell as unknown[]).map((link) => (Array.isArray(link) ? link.slice(0, 11) : link))
            : cell
        )
      ),
    };
    const [team] = decodeScoutTeams(older, () => []);
    expect(team?.gcTeams?.[0]?.staff).toBeUndefined();
    expect(team?.gcTeams?.[0]?.playerCount).toBeUndefined();
    // Everything that was always there is still there.
    expect(team?.gcTeams?.[0]?.teamId).toBe("gc-a");
  });

  it("keeps a roster of zero rather than reading it as no roster", () => {
    const teams = [withStaff("a", [], 0)];
    expect(roundTrip(teams)[0]?.gcTeams?.[0]?.playerCount).toBe(0);
  });

  it("drops a staff index pointing at a name that is not there", () => {
    const encoded = encodeScoutTeams([withStaff("a", ["Eric Varela"])]);
    const broken = { ...encoded, p: [] };
    // A truncated dictionary loses the names, never the link they were on.
    const [team] = decodeScoutTeams(broken, () => []);
    expect(team?.gcTeams?.[0]?.staff).toBeUndefined();
    expect(team?.gcTeams?.[0]?.teamId).toBe("gc-a");
  });
});
