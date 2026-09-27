import { describe, expect, it } from "vitest";
import { tidyPool, type GcImportState } from "../gameChangerImport";
import { gcRowId, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

/*
 * Across regions, the clock alone is not a game.
 *
 * A copy names a club because its coach typed a name the import found in the pool, and a common
 * name is found in many places. A 9U club in North Liberty, Iowa, that played "Cubs" at 15:45 was
 * filed against the 11U Cubs of Frisco, Texas, one of 75 teams of that name; the Texas club's own
 * row at the same 15:45 named the Diamondbacks, and the slot settle and the claim step each put it
 * into the Iowa club's blank copy as that club's 6-11 loss, on the clock and nothing else. A result
 * both rows give still joins them, as it always did, and so does the clock within one region.
 */
const ageGroups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
];
const club = (id: string, name: string, state: string): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: "ag9", ageLevel: 9 }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const DAY = "2026-09-26";
const START = `${DAY}T15:45:00.000Z`;
const own = (
  clubId: string,
  gameId: string,
  against: string,
  score?: [number, number]
): ScoutGame => ({
  id: gcRowId(`gc${clubId}`, gameId),
  teamAId: clubId,
  teamBId: against,
  ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
  ageGroupId: "ag9",
  date: DAY,
  startTs: START,
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});
/** Which game holds the row, standing or folded in, and whether as a claim. */
const placeOf = (state: GcImportState, rowId: string) =>
  state.games.flatMap((game) => {
    if (game.source && gcRowId(game.source.teamId, game.source.gameId) === rowId) {
      return [`${game.id} standing`];
    }
    const record = game.alsoRows?.find((row) => gcRowId(row.teamId, row.gameId) === rowId);
    if (!record) return [];
    return [`${game.id} ${record.filedAgainst === undefined ? "folded" : "claimed"}`];
  });

describe("a stand-in's row at the very start of a blank copy naming its club", () => {
  const pool = (boltsState: string, boltsScore?: [number, number]): GcImportState => ({
    ageGroups,
    teams: [
      club("BOLTS", "Bolts Fall Ball", boltsState),
      club("CUBS", "Cubs", "TX"),
      standIn("S-DBACKS", "Diamondbacks"),
    ],
    games: [own("BOLTS", "b1", "CUBS", boltsScore), own("CUBS", "k1", "S-DBACKS", [11, 6])],
  });
  const cubsRow = gcRowId("gcCUBS", "k1");
  const boltsCopy = gcRowId("gcBOLTS", "b1");

  it("is left standing when the two clubs are regions apart", () => {
    const after = tidyPool(pool("IA")).state;
    expect(placeOf(after, cubsRow)).toEqual([`${cubsRow} standing`]);
    const bolts = after.games.find((game) => game.id === boltsCopy)!;
    expect(bolts.teamAScore).toBeUndefined();
    expect(bolts.alsoRows ?? []).toEqual([]);
  });

  it("settles into it as it always did within one region", () => {
    const after = tidyPool(pool("OK")).state;
    expect(placeOf(after, cubsRow)).toEqual([`${boltsCopy} folded`]);
  });

  it("settles into it regions apart where both give the same result", () => {
    const after = tidyPool(pool("IA", [6, 11])).state;
    expect(placeOf(after, cubsRow)).toEqual([`${boltsCopy} folded`]);
  });
});

describe("a claim already made on the clock alone", () => {
  // The pool of 26 September 2026 held one: a Connecticut club's blank row naming a New York team,
  // claimed into an Indiana club's blank copy of a game against it.
  const pool = (blueState: string): GcImportState => {
    const blue = own("BLUE", "u1", "NORWALK");
    const row = own("NORWALK", "n1", "S-MARUCCI");
    return {
      ageGroups,
      teams: [
        club("BLUE", "Blue", blueState),
        club("NORWALK", "Norwalk Mariners Fall26", "CT"),
        standIn("S-MARUCCI", "Marucci Prospects New York Blue"),
      ],
      games: [
        {
          ...blue,
          alsoFrom: ["gcNORWALK"],
          alsoRows: [
            {
              teamId: "gcNORWALK",
              gameId: "n1",
              startTs: row.startTs,
              onSideB: true,
              filedAgainst: "S-MARUCCI",
            },
          ],
        },
      ],
    };
  };
  const row = gcRowId("gcNORWALK", "n1");

  it("goes back to the team its row named when the two clubs are regions apart", () => {
    const first = tidyPool(pool("IN"));
    expect(placeOf(first.state, row)).toEqual([`${row} standing`]);
    expect(first.state.games.find((game) => game.id === row)!.teamBId).toBe("S-MARUCCI");
    expect(tidyPool(first.state).passes).toBe(1);
  });

  it("stays within one region", () => {
    expect(placeOf(tidyPool(pool("NY")).state, row)).toEqual([
      `${gcRowId("gcBLUE", "u1")} claimed`,
    ]);
  });
});
