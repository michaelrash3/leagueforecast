import { describe, expect, it } from "vitest";
import { reclaimMisfiled, tidyPool, type GcImportState } from "../gameChangerImport";
import { gcRowId, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

/*
 * A copy filed on the wrong club of its name, moved to the one whose own schedule has the game at
 * its very start with the result mirrored.
 *
 * The import files a row against a pulled club of the name the coach typed, and with many clubs of
 * one name it often picks the wrong one. The misfile check moved the copy only where the right
 * club's own row stood against the puller, or against a stand-in whose name fits the puller's. It
 * stayed put where that club's coach typed the puller as "TBD", or as another name, or where the
 * right club's own row went to the puller's own namesake. The wrong club then carried a game it
 * never played, and the pool held the game twice.
 */
const ageGroups: AgeGroup[] = [
  { id: "ag8", name: "8U 2027", ageLevel: 8, year: 2027, seasonIds: [] },
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const club = (id: string, name: string, state: string, level = 9): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: `ag${level}`, ageLevel: level }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const slot = (id: string): ScoutTeam => ({ id, name: "TBD", placeholder: true });
const DAY = "2026-09-22";
/** `clubId`'s own row, against `against`, its own score first. */
const own = (
  clubId: string,
  gameId: string,
  against: string,
  score: [number, number],
  clock = "23:00",
  day = DAY,
  page = "ag9"
): ScoutGame => ({
  id: gcRowId(`gc${clubId}`, gameId),
  teamAId: clubId,
  teamBId: against,
  teamAScore: score[0],
  teamBScore: score[1],
  ageGroupId: page,
  date: day,
  startTs: `${day}T${clock}:00.000Z`,
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});
const sidesOf = (state: GcImportState, id: string) => {
  const game = state.games.find((one) => one.id === id)!;
  return [game.teamAId, game.teamBId];
};

describe("a copy on the wrong club of its name", () => {
  it("goes to the namesake whose own row stands against a stand-in at its start", () => {
    // Mini MafiaBoys' 2-17 went to the 10U Smithtown Bulls Red by name; the 9U Smithtown Bulls
    // Red filed it 17-2 against "5 Star National NY FALL".
    const teams = [
      club("MAFIA", "Mini MafiaBoys", "NY"),
      club("SMITH10", "Smithtown Bulls Red", "NY", 10),
      club("SMITH9", "Smithtown Bulls Red", "NY"),
      standIn("S-5STAR", "5 Star National NY FALL"),
    ];
    const row = own("MAFIA", "m1", "SMITH10", [2, 17]);
    const state: GcImportState = {
      ageGroups,
      teams,
      games: [row, own("SMITH9", "s1", "S-5STAR", [17, 2])],
    };
    const moved = reclaimMisfiled(state);
    expect(moved.reclaimed).toBe(1);
    expect(sidesOf(moved.state, row.id)).toEqual(["MAFIA", "SMITH9"]);
  });

  it("goes to the namesake whose own row stands against a slot at its start", () => {
    // California Baseball 9U held Heat Waves' game; California Baseball 8U filed it against TBD.
    const teams = [
      club("HEAT", "Heat Waves", "CA", 8),
      club("CAL9", "California Baseball", "CA"),
      club("CAL8", "California Baseball", "CA", 8),
      slot("S-TBD"),
    ];
    const row = own("HEAT", "h1", "CAL9", [4, 6], "17:00", "2026-09-12", "ag8");
    const state: GcImportState = {
      ageGroups,
      teams,
      games: [row, own("CAL8", "c1", "S-TBD", [6, 4], "17:00", "2026-09-12", "ag8")],
    };
    const moved = reclaimMisfiled(state);
    expect(moved.reclaimed).toBe(1);
    expect(sidesOf(moved.state, row.id)).toEqual(["HEAT", "CAL8"]);
  });

  it("goes to a club whose name fits, in one region, whose own row names the puller otherwise", () => {
    // OC Osos' game sat on "Lonestar"; it was Lonestar -Eubanks', whose own row says "Oakcliff Osos".
    const teams = [
      club("OSOS", "OC Osos", "TX", 8),
      club("LONE", "Lonestar", "TX", 8),
      club("EUBANKS", "Lonestar -Eubanks", "TX", 8),
      standIn("S-OAK", "Oakcliff Osos"),
    ];
    const row = own("OSOS", "o1", "LONE", [3, 8], "15:00", "2026-09-20", "ag8");
    const state: GcImportState = {
      ageGroups,
      teams,
      games: [row, own("EUBANKS", "e1", "S-OAK", [8, 3], "15:00", "2026-09-20", "ag8")],
    };
    const moved = reclaimMisfiled(state);
    expect(moved.reclaimed).toBe(1);
    expect(sidesOf(moved.state, row.id)).toEqual(["OSOS", "EUBANKS"]);

    // Not a club whose name fits in another region.
    const far = {
      ...state,
      teams: teams.map((team) => (team.id === "EUBANKS" ? { ...team, state: "WA" } : team)),
    };
    expect(reclaimMisfiled(far).reclaimed).toBe(0);
  });

  it("puts a crossed pair back together as one game", () => {
    // Padres A's own 5-9 went to Marlins B by name, and Marlins A's own 9-5 to Padres B.
    const teams = [
      club("PADA", "Padres", "TX"),
      club("PADB", "Padres", "TX"),
      club("MARA", "Marlins", "TX"),
      club("MARB", "Marlins", "TX"),
    ];
    const padres = own("PADA", "p1", "MARB", [5, 9]);
    const marlins = own("MARA", "k1", "PADB", [9, 5]);
    const state: GcImportState = { ageGroups, teams, games: [padres, marlins] };
    const once = reclaimMisfiled(state);
    expect(once.reclaimed).toBe(2);

    const after = tidyPool(state).state;
    expect(after.games).toHaveLength(1);
    const game = after.games[0]!;
    expect(new Set([game.teamAId, game.teamBId])).toEqual(new Set(["PADA", "MARA"]));
    expect(game.alsoRows?.map((record) => record.teamId)).toEqual([
      game.source?.teamId === "gcPADA" ? "gcMARA" : "gcPADA",
    ]);
    expect(tidyPool(after).passes).toBe(1);
  });
});

describe("a copy left where it is", () => {
  const teams = [
    club("MAFIA", "Mini MafiaBoys", "NY"),
    club("SMITH10", "Smithtown Bulls Red", "NY", 10),
    club("SMITH9", "Smithtown Bulls Red", "NY"),
    club("SMITH9B", "Smithtown Bulls Red", "NY"),
    club("OTHER", "Long Island Ducks", "NY"),
    standIn("S-5STAR", "5 Star National NY FALL"),
  ];
  const row = own("MAFIA", "m1", "SMITH10", [2, 17]);

  it("where the namesake's row is a week off", () => {
    const state: GcImportState = {
      ageGroups,
      teams,
      games: [row, own("SMITH9", "s1", "S-5STAR", [17, 2], "23:00", "2026-09-29")],
    };
    expect(reclaimMisfiled(state).reclaimed).toBe(0);
  });

  it("where two namesakes have the game at its start", () => {
    const state: GcImportState = {
      ageGroups,
      teams,
      games: [
        row,
        own("SMITH9", "s1", "S-5STAR", [17, 2]),
        own("SMITH9B", "b1", "S-5STAR", [17, 2]),
      ],
    };
    expect(reclaimMisfiled(state).reclaimed).toBe(0);
  });

  it("where the club it sits on has the game at its start itself", () => {
    const state: GcImportState = {
      ageGroups,
      teams,
      games: [
        row,
        own("SMITH10", "t1", "S-5STAR", [17, 2], "23:00", DAY, "ag10"),
        own("SMITH9", "s1", "S-5STAR", [17, 2]),
      ],
    };
    expect(reclaimMisfiled(state).reclaimed).toBe(0);
  });

  it("where the namesake's row stands against a pulled club that is not the puller", () => {
    const state: GcImportState = {
      ageGroups,
      teams,
      games: [row, own("SMITH9", "s1", "OTHER", [17, 2])],
    };
    expect(reclaimMisfiled(state).reclaimed).toBe(0);
  });

  it("and never onto the club whose row it is", () => {
    // Texas Takeover 10U's own 9-9 against "Texas Takeover", filed on the 11U squad. A tie mirrors
    // itself, and the row is at its own start against a club of its own name: moved onto the
    // puller, the 10U played itself.
    const tt = [club("TT10", "Texas Takeover", "TX", 10), club("TT11", "Texas Takeover", "TX", 11)];
    const tie = own("TT10", "t1", "TT11", [9, 9], "18:30", "2026-08-30", "ag10");
    const state: GcImportState = { ageGroups, teams: tt, games: [tie] };
    expect(reclaimMisfiled(state).reclaimed).toBe(0);
    const after = tidyPool(state).state;
    expect(after.games.every((game) => game.teamAId !== game.teamBId)).toBe(true);
    // The 11U's own schedule has no game that day, so the name leaves it for a stand-in of the
    // name, and the refile does not put it back on the 10U whose row it is.
    const [, against] = sidesOf(after, tie.id);
    const landed = after.teams.find((team) => team.id === against);
    expect([landed?.name, landed?.nameOnly]).toEqual(["Texas Takeover", true]);
    // With the 11U playing that day, the row stays on it as before.
    const played = tidyPool({
      ...state,
      games: [tie, own("TT11", "u1", "S-ELSE", [4, 1], "15:00", "2026-08-30", "ag10")],
      teams: [...tt, standIn("S-ELSE", "Elsewhere")],
    }).state;
    expect(sidesOf(played, tie.id)).toEqual(["TT10", "TT11"]);
  });
});
