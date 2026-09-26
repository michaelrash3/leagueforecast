import { describe, expect, it } from "vitest";
import type { GcTeamSchedule } from "../gameChangerApi";
import { importGcSchedule, type GcImportState } from "../gameChangerImport";

/*
 * An opponent named by graduating class is filed at the age its class plays, read against the
 * page's squad year: "Mojo Gold 2036" on a 10U page of 2027 is a 9U squad. It was looked up at the
 * page's level, so every 10U club that named it made a stand-in of its own.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const schedule = (
  id: string,
  name: string,
  ageLevel: number,
  state: string,
  games: [string, string, string, number, number][]
): GcTeamSchedule => ({
  profile: { id, name, ageLevel, state, season: { season: "fall", year: 2026 } },
  games: games.map(([gameId, date, opponentName, teamScore, opponentScore]) => ({
    id: gameId,
    date,
    opponentName,
    status: "completed",
    teamScore,
    opponentScore,
  })),
  fetchedAt: "2026-09-25T12:00:00.000Z",
});
const pull = (...schedules: GcTeamSchedule[]) =>
  schedules.reduce((state, next) => importGcSchedule(next, state).state, empty);
const named = (state: GcImportState, name: string) =>
  state.teams.filter((team) => team.name === name);

describe("an opponent named by graduating class", () => {
  it("is found at its class's age, one stand-in for every club that names it", () => {
    const state = pull(
      schedule("gcPIRATES0001", "Pirates 10U", 10, "OK", [
        ["p1", "2026-09-13", "Mojo Gold 2036", 1, 9],
        ["p2", "2026-09-13", "Mojo Gold 2036", 5, 9],
      ]),
      schedule("gcRYAL0000001", "Ryal 10U", 10, "OK", [
        ["r1", "2026-08-30", "Mojo Gold 2036", 2, 6],
      ]),
      schedule("gcROYALS00001", "Royals 9U", 9, "OK", [
        ["o1", "2026-08-31", "Mojo Gold 2036", 3, 11],
      ])
    );
    const mojo = named(state, "Mojo Gold 2036");
    expect(mojo).toHaveLength(1);
    const against = state.games.filter((game) => game.teamBId === mojo[0]!.id);
    expect(against).toHaveLength(4);
    expect(new Set(against.map((game) => game.ageLevelB))).toEqual(new Set([9]));
  });

  it("still finds a club pulled under the name at the page's level", () => {
    // Listed at 10U though its class reads 11U: the club the 10U schedules played.
    const state = pull(
      schedule("gcNWNC0000001", "NWNC Elite 2034", 10, "NC", [
        ["n1", "2026-08-02", "Some Other Club", 4, 2],
      ]),
      schedule("gcROWAN000001", "Rowan Rangers 10U", 10, "NC", [
        ["w1", "2026-08-28", "NWNC Elite 2034", 3, 7],
      ])
    );
    const club = named(state, "NWNC Elite 2034");
    expect(club).toHaveLength(1);
    expect(club[0]!.gcTeams?.length).toBe(1);
    const row = state.games.find((game) => game.id.endsWith("w1"))!;
    expect(row.teamBId).toBe(club[0]!.id);
  });
});
